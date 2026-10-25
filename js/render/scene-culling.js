import * as THREE from 'three/webgpu';

// js/render/scene-culling.js
// Spatial culling for the city-wide static geometry. Most of the street furniture and building massing is built as a
// handful of instanced meshes spanning the whole city (bounding spheres several km across), which three.js can never
// cull: every frame the GPU transformed every lamp post, signal and facade box of the city three times (the
// view and both sun shadow cascades). This module, run once after the city is built (main.js):
// 1. Splits the instanced meshes of small props into spatial chunks, each culled by the view frustum and hidden beyond
//    the distance where its props shrink below a pixel or two (updateSceneCulling, every frame).
// 2. Gives the big static shadow casters (facade boxes, piers, viaducts...) position-only stand-ins cut into cells, on
//    a layer only the shadow cascade cameras render (they cull the cells outside the ~300 m the cascades cover); the
//    originals stop casting. The stand-ins share one material per face side, so a cell costs one draw.
// 3. Splits the remaining large batches into cells for view-frustum culling, keeping their full draw distance: the
//    instanced ones by instance, the plain merged ones (the city's curbs, sidewalks & meadows) by triangle.
// 4. Trims what the two cascades walk and draw (each re-renders the scene: ~6.5 ms of CPU a frame at street level,
//    half of it spent walking & culling objects, not drawing): the stand-ins in regions culled whole against each
//    cascade, the static meshes that cast nothing out of their walk, and the small props out of the far cascade,
//    whose texels (~22 cm at street level) they would cover a couple of.

const SHADOW_PROXY_LAYER = 3;
// Distance at which an instance of typical size s (m) is culled: about s / d * 1100 px tall on a 1300 px viewport
const CULL_PER_METRE = 1100;
const CULL_MIN = 300; // never closer: the shadow cascades reach ~300 m at street level
const CULL_MAX = 2000; // beyond this the props are kept at any distance
const PROXY_CELL = 500; // the far cascade spans ~400 m at street level: a cascade sees a few cells
const PROXY_TRIANGLES = 600; // ...but a sparse caster's cells grow to hold about as many triangles (the hills' 75 m cells)
const STATIC_CELL = 1000;
// The stand-ins are culled against each cascade's frustum a region at a time (~2200 cells, of which a cascade draws a
// few dozen): a region holds the cells whose centres fall in it
const PROXY_REGION = 2000;
// Props smaller than this (typical size, instanceSize) cast into the near cascade only: in the far one a texel is
// ~22 cm at street level (690 m over 3072 px), so a lamp post's or a bin's shadow there is a texel or two wide
const FAR_SHADOW_MIN = 1.5;

const _m = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const _size = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pm = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

const triangleCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

// Typical size of an instance: sqrt(middle x largest of its extents), so thin poles count by their length and flat
// decals by their area. The 90th percentile, so the larger instances of a mesh set its cull distance.
function instanceSize(mesh) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox.getSize(_size);
  const e = mesh.instanceMatrix.array;
  const n = mesh.count;
  const step = Math.max(1, Math.floor(n / 1024));
  const sizes = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 16;
    const d = [
      Math.hypot(e[o], e[o + 1], e[o + 2]) * _size.x,
      Math.hypot(e[o + 4], e[o + 5], e[o + 6]) * _size.y,
      Math.hypot(e[o + 8], e[o + 9], e[o + 10]) * _size.z
    ].sort((p, q) => p - q);
    sizes.push(Math.sqrt(d[1] * d[2]));
  }
  sizes.sort((p, q) => p - q);
  return sizes[Math.floor(sizes.length * 0.9)] || 0;
}

function isStaticMesh(o) {
  return o.isMesh && !o.isSkinnedMesh && o.visible && o.frustumCulled !== false && !o.morphTargetInfluences;
}

function copyObjectState(dst, src) {
  dst.name = src.name;
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.renderOrder = src.renderOrder;
  dst.layers.mask = src.layers.mask;
  dst.visible = src.visible;
  dst.userData = { ...src.userData };
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.matrixAutoUpdate = src.matrixAutoUpdate;
  dst.matrix.copy(src.matrix);
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeRender')) dst.onBeforeRender = src.onBeforeRender;
  if (Object.prototype.hasOwnProperty.call(src, 'onAfterRender')) dst.onAfterRender = src.onAfterRender;
}

// One InstancedMesh per `cell` x `cell` m square of the instances' positions, sharing the source's vertex data and
// material (so the same shader pipeline) with its per-instance data split up
function chunkInstancedMesh(mesh, cell) {
  const n = mesh.count;
  const src = mesh.instanceMatrix.array;
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(src[i * 16 + 12] / cell) + ',' + Math.floor(src[i * 16 + 14] / cell);
    let ids = cells.get(key);
    if (!ids) cells.set(key, (ids = []));
    ids.push(i);
  }
  const geo0 = mesh.geometry;
  if (!geo0.boundingSphere) geo0.computeBoundingSphere();
  if (!geo0.boundingBox) geo0.computeBoundingBox();
  const attrs = Object.entries(geo0.attributes);
  const chunks = [];
  // where each source instance went: chunk number, slot (mayhem.js hides knocked-over props through it)
  const where = new Int32Array(n * 2).fill(-1);
  for (const ids of cells.values()) {
    ids.forEach((id, j) => { where[id * 2] = chunks.length; where[id * 2 + 1] = j; });
    const geo = new THREE.BufferGeometry();
    geo.setIndex(geo0.index);
    for (const [name, a] of attrs) {
      if (!a.isInstancedBufferAttribute) {
        geo.setAttribute(name, a);
        continue;
      }
      const s = a.itemSize;
      const arr = new a.array.constructor(ids.length * s);
      ids.forEach((id, j) => arr.set(a.array.subarray(id * s, id * s + s), j * s));
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, s, a.normalized, a.meshPerAttribute));
    }
    for (const g of geo0.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.setDrawRange(geo0.drawRange.start, geo0.drawRange.count);
    geo.boundingSphere = geo0.boundingSphere;
    geo.boundingBox = geo0.boundingBox;

    const chunk = new THREE.InstancedMesh(geo, mesh.material, ids.length);
    ids.forEach((id, j) => chunk.instanceMatrix.array.set(src.subarray(id * 16, id * 16 + 16), j * 16));
    if (mesh.instanceColor) {
      const c = mesh.instanceColor.array;
      const arr = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => arr.set(c.subarray(id * 3, id * 3 + 3), j * 3));
      chunk.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    copyObjectState(chunk, mesh);
    chunk.computeBoundingSphere();
    chunks.push(chunk);
  }
  mesh.userData.chunked = { chunks, where };
  return chunks;
}

// A caster can stand in as bare positions only if its material neither moves its vertices nor cuts holes in it
function proxyableMaterial(mat) {
  return !!mat && !Array.isArray(mat) && !mat.transparent && !(mat.alphaTest > 0) && !mat.alphaMap &&
    !mat.positionNode && !mat.castShadowPositionNode && !mat.castShadowNode && !mat.alphaTestNode &&
    !mat.maskNode && !mat.maskShadowNode && !mat.depthNode && !mat.displacementMap;
}

// A plain mesh's triangles in `cell` x `cell` m squares (by where their centres are in the world), each square its own
// mesh in the mesh's place, sharing its material (so the same shader pipeline). Straight on the arrays: the hills'
// floors are a few hundred thousand triangles, which three.js's per-vertex accessors took most of a second over
function splitMesh(mesh, cell) {
  const geo = mesh.geometry;
  const index = geo.index ? geo.index.array : null;
  const pos = geo.attributes.position.array;
  const n = (index ? index.length : pos.length / 3) / 3;
  const e = mesh.matrixWorld.elements;
  const corner = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  // each triangle's square (by its centre in the world), and how many each square holds
  const cellOf = new Float64Array(n);
  const counts = new Map();
  for (let t = 0; t < n; t++) {
    const i0 = corner(t, 0) * 3, i1 = corner(t, 1) * 3, i2 = corner(t, 2) * 3;
    const x = (pos[i0] + pos[i1] + pos[i2]) / 3, y = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3, z = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const key = Math.floor(wx / cell) * 1048576 + Math.floor(wz / cell);
    cellOf[t] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size < 2) return;
  const attrs = Object.entries(geo.attributes);
  const parts = new Map(); // square -> { arrays, used }
  for (const [key, count] of counts) {
    parts.set(key, { arrays: attrs.map(([, a]) => new a.array.constructor(count * 3 * a.itemSize)), used: 0 });
  }
  for (let t = 0; t < n; t++) {
    const part = parts.get(cellOf[t]);
    for (let c = 0; c < 3; c++) {
      const v = corner(t, c), w = part.used * 3 + c;
      attrs.forEach(([, a], k) => {
        const size = a.itemSize, src = a.array, dst = part.arrays[k];
        for (let q = 0; q < size; q++) dst[w * size + q] = src[v * size + q];
      });
    }
    part.used++;
  }
  const parent = mesh.parent;
  for (const part of parts.values()) {
    const piece = new THREE.Mesh(new THREE.BufferGeometry(), mesh.material);
    attrs.forEach(([name, a], k) => piece.geometry.setAttribute(name, new THREE.BufferAttribute(part.arrays[k], a.itemSize, a.normalized)));
    piece.geometry.computeBoundingBox();
    piece.geometry.computeBoundingSphere();
    copyObjectState(piece, mesh);
    piece.updateMatrixWorld(true);
    parent.add(piece);
  }
  parent.remove(mesh);
  geo.dispose();
}

function replaceWithChunks(mesh, cell) {
  const parent = mesh.parent;
  const chunks = chunkInstancedMesh(mesh, cell);
  parent.remove(mesh);
  chunks.forEach((chunk, k) => {
    parent.add(chunk);
    // Shader precompile: every chunk shares the first chunk's pipeline (main.js).
    if (k > 0) chunk.userData.sharesPipelineWith = chunks[0];
    chunk.updateMatrixWorld(true);
  });
  return chunks;
}

/**
 * Shows `group` only to the cameras that see `layers`, render by render (scene.onBeforeRender), and visible again
 * after each (onAfterRender), so whatever walks the scene between renders (main.js's shader warm-up) still finds it
 */
function showOnlyTo(scene, group, layers) {
  const before = scene.onBeforeRender, after = scene.onAfterRender;
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    before.call(this, renderer, scn, camera, target);
    group.visible = camera.layers.test(layers);
  };
  scene.onAfterRender = function (renderer, scn, camera, target) {
    after.call(this, renderer, scn, camera, target);
    group.visible = true;
  };
}

// Whether anything under `o` casts a shadow or is a light (the clustered lighting gathers the lights render by render)
function castsOrLights(o) {
  if (o.isLight || (o.castShadow && (o.isMesh || o.isLine || o.isPoints))) return true;
  for (const c of o.children) if (castsOrLights(c)) return true;
  return false;
}

/**
 * Moves the children of `root` (a child of the scene) that neither cast a shadow nor hold a light into one group under
 * it, so the cascades can skip them whole (null when there are fewer than two). The group sits where they did, at
 * identity under the same parent, so their world matrices don't change; it carries the root's render order, which
 * three.js hands down from groups only.
 */
function gatherQuietChildren(root) {
  const quiet = [];
  const kept = [];
  for (const c of root.children) (castsOrLights(c) ? kept : quiet).push(c);
  if (quiet.length < 2) return null;
  const group = new THREE.Group();
  group.name = root.name + 'NoShadow';
  group.renderOrder = root.isGroup ? root.renderOrder : 0;
  // (straight on the arrays: Object3D.remove splices one child at a time, and StreetDetails has ~7000)
  root.children = kept;
  for (const c of quiet) {
    c.parent = group;
    group.children.push(c);
  }
  root.add(group);
  return group;
}

/**
 * Culls for the two cascade cameras `cams` (near, far), render by render: the stand-in `regions` ({ group, sphere })
 * outside the cascade's frustum, the `quiet` groups (nothing in them casts), and in the far cascade the `nearOnly`
 * props. Everything is as it was after each render. The regions wait for `live()`: the warm-up frame must see every
 * stand-in to compile its pipeline.
 */
function cullForCascades(scene, cams, regions, quiet, nearOnly, live) {
  const before = scene.onBeforeRender, after = scene.onAfterRender;
  const shown = new Uint8Array(nearOnly.length);
  scene.onBeforeRender = function (renderer, scn, camera, target) {
    before.call(this, renderer, scn, camera, target);
    const i = cams.indexOf(camera);
    if (i < 0) return;
    for (const g of quiet) g.visible = false;
    if (live()) {
      // (the frustum three.js culls each object with, from the same matrices)
      _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pm, camera.coordinateSystem, camera.reversedDepth);
      for (const r of regions) r.group.visible = _frustum.intersectsSphere(r.sphere);
    }
    if (i === 1) {
      for (let k = 0; k < nearOnly.length; k++) {
        shown[k] = nearOnly[k].visible ? 1 : 0;
        nearOnly[k].visible = false;
      }
    }
  };
  scene.onAfterRender = function (renderer, scn, camera, target) {
    after.call(this, renderer, scn, camera, target);
    const i = cams.indexOf(camera);
    if (i < 0) return;
    for (const g of quiet) g.visible = true;
    for (const r of regions) r.group.visible = true;
    if (i === 1) for (let k = 0; k < nearOnly.length; k++) nearOnly[k].visible = shown[k] === 1;
  };
}

/**
 * Sets up the culling of the static city under `roots` (Object3Ds). `shadow` is the SunLightShadow whose cascade
 * cameras render the shadow stand-ins (none are made without it). Per-frame culling runs in updateSceneCulling().
 */
function setupSceneCulling(scene, roots, shadow = null) {
  scene.updateMatrixWorld(true);
  const culled = [];

  // 1. Small props: chunked & distance culled
  const chunkable = [];
  const largeMeshes = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isInstancedMesh || !isStaticMesh(o) || o.count < 64 || o.count !== o.instanceMatrix.count) return;
      if (o.count * triangleCount(o.geometry) < 40000) return;
      if (!o.boundingSphere) o.computeBoundingSphere();
      if (o.boundingSphere.radius < 1500) return;
      chunkable.push(o);
    });
  }
  for (const mesh of chunkable) {
    // unlit (glowing) props, like signal lenses & lamp bulbs, read from much further away at night
    const glow = mesh.material.isMeshBasicNodeMaterial || mesh.material.type === 'MeshBasicNodeMaterial' ? 3 : 1;
    const size = instanceSize(mesh);
    const cullDist = Math.max(CULL_MIN, size * CULL_PER_METRE * glow);
    if (cullDist > CULL_MAX) {
      largeMeshes.push(mesh);
      continue;
    }
    const cell = Math.min(600, Math.max(250, cullDist * 0.5));
    for (const chunk of replaceWithChunks(mesh, cell)) {
      const sphere = chunk.boundingSphere.clone().applyMatrix4(chunk.matrixWorld);
      culled.push({ mesh: chunk, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, d: cullDist, size });
    }
  }

  // 2. Shadow stand-ins for the big static casters
  const cams = [];
  if (shadow && typeof shadow.getCamera === 'function') {
    const count = typeof shadow.getViewportCount === 'function' ? shadow.getViewportCount() : 2;
    for (let i = 0; i < count; i++) {
      const cam = shadow.getCamera(i);
      if (cam && cam.layers) cams.push(cam);
    }
  }
  const regions = [];
  if (cams.length) {
    const instancedBySig = new Map(); // geometry signature + face side -> { geometry, material, cells: Map(key -> [matrices]) }
    const triCells = new Map(); // face side -> Map(key -> number[] world positions)
    const proxyMaterials = new Map();
    const proxyMaterial = (side) => {
      let m = proxyMaterials.get(side);
      if (!m) {
        m = new THREE.MeshBasicNodeMaterial({ side: side.side, color: 0x000000 });
        m.shadowSide = side.shadowSide;
        m.name = 'ShadowProxy';
        proxyMaterials.set(side, m);
      }
      return m;
    };
    const sideKeys = new Map();
    const sideOf = (mat) => {
      const k = mat.side + ',' + mat.shadowSide;
      let s = sideKeys.get(k);
      if (!s) sideKeys.set(k, (s = { side: mat.side, shadowSide: mat.shadowSide }));
      return s;
    };
    const cellKey = (x, z, cell = PROXY_CELL) => cell + ':' + Math.floor(x / cell) + ',' + Math.floor(z / cell);

    const sources = [];
    for (const root of roots) {
      root.traverse((o) => {
        // (meshes whose instances may still change, like knock-over props, keep casting their own shadows)
        if (!o.castShadow || !isStaticMesh(o) || !proxyableMaterial(o.material) || o.userData.keepOwnShadow) return;
        if (o.isInstancedMesh && o.count !== o.instanceMatrix.count) return;
        const tris = triangleCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
        if (tris < 20000) return;
        let radius;
        if (o.isInstancedMesh) {
          if (!o.boundingSphere) o.computeBoundingSphere();
          radius = o.boundingSphere.radius;
        } else {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          radius = o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
        }
        if (radius > 600) sources.push(o);
      });
    }

    for (const o of sources) {
      const side = sideOf(o.material);
      const geo = o.geometry;
      if (o.isInstancedMesh) {
        const pos = geo.attributes.position;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const sig = [pos.count, geo.index ? geo.index.count : -1, bb.min.toArray().map((v) => v.toFixed(3)), bb.max.toArray().map((v) => v.toFixed(3)), side.side, side.shadowSide].join('|');
        let entry = instancedBySig.get(sig);
        if (!entry) {
          const g = new THREE.BufferGeometry();
          g.setIndex(geo.index);
          g.setAttribute('position', pos);
          entry = { geometry: g, material: proxyMaterial(side), cells: new Map() };
          instancedBySig.set(sig, entry);
        }
        const e = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          _wm.multiplyMatrices(o.matrixWorld, _m.fromArray(e, i * 16));
          const key = cellKey(_wm.elements[12], _wm.elements[14]);
          let list = entry.cells.get(key);
          if (!list) entry.cells.set(key, (list = []));
          list.push(..._wm.elements);
        }
      } else {
        let bySide = triCells.get(side);
        if (!bySide) triCells.set(side, (bySide = new Map()));
        const pos = geo.attributes.position;
        const idx = geo.index;
        const start = geo.drawRange.start;
        const end = Math.min(idx ? idx.count : pos.count, start + geo.drawRange.count);
        if (!geo.boundingBox) geo.computeBoundingBox();
        geo.boundingBox.getSize(_size);
        const cell = Math.max(PROXY_CELL, Math.sqrt((PROXY_TRIANGLES * _size.x * _size.z) / Math.max(1, (end - start) / 3)));
        for (let t = start; t + 2 < end; t += 3) {
          const i0 = idx ? idx.getX(t) : t;
          const i1 = idx ? idx.getX(t + 1) : t + 1;
          const i2 = idx ? idx.getX(t + 2) : t + 2;
          _a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
          _b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
          _c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
          const key = cellKey((_a.x + _b.x + _c.x) / 3, (_a.z + _b.z + _c.z) / 3, cell);
          let list = bySide.get(key);
          if (!list) bySide.set(key, (list = []));
          list.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
        }
      }
      o.castShadow = false;
    }

    // All of them under one group, shown only to the cameras that draw them (the cascades): every scene render walks
    // the scene's tree, and the view's would otherwise visit each of the ~2000 stand-ins only to find them on a layer
    // it doesn't draw
    const proxies = new THREE.Group();
    proxies.name = 'ShadowProxies';
    proxies.userData.shadowProxy = true;
    scene.add(proxies);
    const proxyLayers = new THREE.Layers();
    proxyLayers.set(SHADOW_PROXY_LAYER);
    showOnlyTo(scene, proxies, proxyLayers);
    const firstProxy = new Map(); // material + kind -> the stand-in that compiles their shared pipeline
    const byRegion = new Map(); // region key -> { group, sphere }
    const addProxy = (mesh) => {
      mesh.name = 'ShadowProxy';
      mesh.layers.set(SHADOW_PROXY_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.userData.shadowProxy = true;
      const kind = mesh.material.uuid + (mesh.isInstancedMesh ? ':i' : ':m');
      if (firstProxy.has(kind)) mesh.userData.sharesPipelineWith = firstProxy.get(kind);
      else firstProxy.set(kind, mesh);
      // (the stand-ins sit at identity: their bounding spheres are in the world already)
      _sphere.copy(mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry.boundingSphere);
      const key = Math.floor(_sphere.center.x / PROXY_REGION) + ',' + Math.floor(_sphere.center.z / PROXY_REGION);
      let region = byRegion.get(key);
      if (!region) {
        region = { group: new THREE.Group(), sphere: _sphere.clone() };
        region.group.name = 'ShadowProxyRegion';
        region.group.userData.shadowProxy = true;
        proxies.add(region.group);
        byRegion.set(key, region);
      }
      region.sphere.union(_sphere);
      region.group.add(mesh);
    };
    for (const entry of instancedBySig.values()) {
      for (const list of entry.cells.values()) {
        const n = list.length / 16;
        const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, n);
        mesh.instanceMatrix.array.set(list);
        mesh.computeBoundingSphere();
        addProxy(mesh);
      }
    }
    for (const [side, bySide] of triCells) {
      for (const list of bySide.values()) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
        g.computeBoundingSphere();
        addProxy(new THREE.Mesh(g, proxyMaterial(side)));
      }
    }
    for (const cam of cams) cam.layers.enable(SHADOW_PROXY_LAYER);
    regions.push(...byRegion.values());
  }

  // After the shadow stand-ins above, split the large props into cells. They stay visible at any distance and need no
  // per-frame distance checks; those still casting their own shadows (the knock-over ones, like the plazas' faroles:
  // ~3000 of them, 1.2M triangles in one batch) are then drawn into each cascade only where it reaches.
  for (const mesh of largeMeshes) replaceWithChunks(mesh, STATIC_CELL);
  const largePlain = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!isStaticMesh(o) || o.isInstancedMesh || o.castShadow || Array.isArray(o.material)) return;
      // (whole meshes only: one drawing part of its geometry keeps it as it is)
      const { drawRange, groups } = o.geometry;
      if (drawRange.start !== 0 || drawRange.count !== Infinity || groups.length > 1) return;
      if (triangleCount(o.geometry) < 20000) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis() > STATIC_CELL) largePlain.push(o);
    });
  }
  // (in a few dozen squares at most: the hills' mesh spans 38 km, and every square is a draw)
  for (const mesh of largePlain) splitMesh(mesh, Math.max(STATIC_CELL, mesh.geometry.boundingSphere.radius * mesh.matrixWorld.getMaxScaleOnAxis() / 4));

  // 4. What the cascades walk and draw: each root's meshes that cast nothing in one group they skip (~1800 of them at
  //    street level, which they would cull & sort only to drop), the stand-ins by region, and the small props cast
  //    into the near cascade only
  if (cams.length) {
    const quiet = [];
    for (const root of roots) {
      const group = root.parent === scene ? gatherQuietChildren(root) : null;
      if (group) quiet.push(group);
    }
    const nearOnly = culled.filter((c) => c.mesh.castShadow && c.size < FAR_SHADOW_MIN).map((c) => c.mesh);
    cullForCascades(scene, cams, regions, quiet, nearOnly, () => state.live);
  }

  state.culled = culled;
}

const state = { culled: [], frozen: new Set(), pendingRelease: null, live: false };

// Per frame (after the warm-up frame, which must see everything): hide the chunks beyond their cull distance
function updateSceneCulling(cameraPosition) {
  state.live = true;
  const { x, y, z } = cameraPosition;
  for (const c of state.culled) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    c.mesh.visible = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r < c.d;
  }
}

/**
 * Computes the world matrices of the static city under `roots` (and of the shadow stand-ins) once, for good. three.js
 * calls scene.updateMatrixWorld() in every scene render (the view and each shadow cascade: three a frame), and as the
 * scene's own matrix auto-updates, that recomputes every object's world matrix each time: ~42k objects (the tree
 * field's dormant cells are most of them) cost ~18 ms a frame. Nothing under these roots moves after the build (their
 * props change through instance matrices & visibility). Rendering stops updating the scene; updateDynamicMatrices()
 * updates the rest of it, once a frame.
 */
function freezeStaticMatrices(scene, roots) {
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  state.frozen = new Set(roots);
  for (const child of scene.children) if (child.userData.shadowProxy) state.frozen.add(child);
}

// Per frame, before rendering: the world matrices of everything else in the scene (the player, the traffic, the
// lights that follow the camera...), including whatever was added since
function updateDynamicMatrices(scene) {
  const children = scene.children;
  for (let i = 0; i < children.length; i++) {
    if (!state.frozen.has(children[i])) children[i].updateMatrixWorld();
  }
}

// Below this many vertices a geometry keeps its arrays: the small shared ones (unit boxes, a prop's shape) may still be
// cloned or merged by something built later, and the memory is all in the big merged batches anyway
const RELEASE_MIN_VERTICES = 2048;

/**
 * Drops the CPU-side copies of the static city's vertex data once the GPU holds them. three.js keeps every attribute's
 * array after the upload, so the frozen city (its streets, facades, paint & shadow stand-ins: ~10M vertices) sat twice
 * in memory, ~1 GB of it in the JS heap alone. Only the attributes the renderer has already uploaded go, and never the
 * instance matrices & colours (knocked-over props change theirs: mayhem.js). The warm-up frame draws one object per
 * shader pipeline, so the first call (after it) frees what it drew and keeps the rest as pending: call it again now and
 * then (main.js does, every few seconds) and each part of the city goes once it has been drawn. Each attribute keeps
 * its count and its array's type (the pipelines read both); its array becomes empty, and its geometry is marked
 * `userData.arraysReleased`: nothing may read, clone or change it afterwards. Returns the bytes released by this call.
 */
function releaseStaticArrays(renderer) {
  const backend = renderer.backend;
  if (!state.pendingRelease) {
    const entries = new Map(); // attribute (or interleaved buffer) -> { target, geos: the geometries sharing it }
    state.pendingRelease = [];
    for (const root of state.frozen) {
      root.traverse((o) => {
        const geo = o.geometry;
        if (!o.isMesh || !geo || geo.userData.keepArrays) return;
        const pos = geo.attributes.position;
        if (!pos || pos.count < RELEASE_MIN_VERTICES) return;
        // (three.js would compute these from the arrays the first time it culled or bounded the object)
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
        const attributes = Object.values(geo.attributes).filter((a) => !a.isInstancedBufferAttribute);
        if (geo.index) attributes.push(geo.index);
        for (const attribute of attributes) {
          const target = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
          let entry = entries.get(target);
          if (!entry) {
            entries.set(target, (entry = { target, geos: new Set() }));
            state.pendingRelease.push(entry);
          }
          entry.geos.add(geo);
        }
      });
    }
  }
  let bytes = 0;
  let kept = 0;
  const pending = state.pendingRelease;
  for (const entry of pending) {
    const { target, geos } = entry;
    const data = backend.has(target) ? backend.get(target) : null;
    if (!data || !(data.buffer || data.bufferGPU)) {
      pending[kept++] = entry; // (not drawn yet)
      continue;
    }
    bytes += target.array.byteLength;
    target.array = new target.array.constructor(0);
    for (const geo of geos) geo.userData.arraysReleased = true;
  }
  pending.length = kept;
  return bytes;
}

export { setupSceneCulling, updateSceneCulling, freezeStaticMatrices, updateDynamicMatrices, releaseStaticArrays, showOnlyTo, SHADOW_PROXY_LAYER };
