import * as THREE from 'three/webgpu';

// js/render/scene-culling.ts
// Spatial culling for the city-wide static geometry. Most of the street furniture and building massing is built as a
// handful of instanced meshes spanning the whole city (bounding spheres several km across), which three.js can never
// cull: every frame the GPU transformed every lamp post, signal and facade box of the city three times (the
// view and both sun shadow cascades). This module, run once after the city is built (main.ts):
// 1. Splits the instanced meshes of small props into spatial chunks, each culled by the view frustum and hidden beyond
//    the distance where its props shrink below a pixel or two (updateSceneCulling, every frame).
// 2. Gives the big static shadow casters (facade boxes, piers, viaducts...) position-only stand-ins cut into cells, on
//    a layer only the shadow cascade cameras render (they cull the cells outside the ~300 m the cascades cover); the
//    originals stop casting. The stand-ins share one material per face side, so a cell costs one draw.
// 3. Splits the remaining large batches into cells for view-frustum culling, keeping their full draw distance: the
//    instanced ones by instance, the plain merged ones (the city's curbs, sidewalks & meadows) by triangle.

const SHADOW_PROXY_LAYER = 3;
// Distance at which an instance of typical size s (m) is culled: about s / d * 1100 px tall on a 1300 px viewport
const CULL_PER_METRE = 1100;
const CULL_MIN = 300; // never closer: the shadow cascades reach ~300 m at street level
const CULL_MAX = 2000; // beyond this the props are kept at any distance
const PROXY_CELL = 500; // the far cascade spans ~400 m at street level: a cascade sees a few cells
const PROXY_TRIANGLES = 600; // ...but a sparse caster's cells grow to hold about as many triangles (the hills' 75 m cells)
const STATIC_CELL = 1000;

const _m = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const _size = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// three.js's own type flags rather than instanceof, here and in releaseStaticArrays: the tests hand these functions
// plain stand-ins
function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return 'isMesh' in o && o.isMesh === true;
}

function isInstancedMesh(o: THREE.Object3D): o is THREE.InstancedMesh {
  return 'isInstancedMesh' in o && o.isInstancedMesh === true;
}

// An empty typed array of the same kind as `array`, `length` long (what the pipelines read: its type)
function emptyLike<T extends THREE.TypedArray>(array: T, length: number): T {
  // (a typed array's constructor is its own class)
  const Kind = array.constructor as new (length: number) => T;
  return new Kind(length);
}

const triangleCount = (geo: THREE.BufferGeometry) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

// Typical size of an instance: sqrt(middle x largest of its extents), so thin poles count by their length and flat
// decals by their area. The 90th percentile, so the larger instances of a mesh set its cull distance.
function instanceSize(mesh: THREE.InstancedMesh) {
  const geo = mesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  geo.boundingBox?.getSize(_size);
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

function isStaticMesh(o: THREE.Object3D): o is THREE.Mesh {
  return isMesh(o) && !(o instanceof THREE.SkinnedMesh) && o.visible && o.frustumCulled && !o.morphTargetInfluences;
}

function copyObjectState(dst: THREE.Object3D, src: THREE.Object3D) {
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
  // (bound to the copy: three.js calls them as its methods, on it)
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeRender')) dst.onBeforeRender = src.onBeforeRender.bind(dst);
  if (Object.prototype.hasOwnProperty.call(src, 'onAfterRender')) dst.onAfterRender = src.onAfterRender.bind(dst);
}

// One InstancedMesh per `cell` x `cell` m square of the instances' positions, sharing the source's vertex data and
// material (so the same shader pipeline) with its per-instance data split up
function chunkInstancedMesh(mesh: THREE.InstancedMesh, cell: number) {
  const n = mesh.count;
  const src = mesh.instanceMatrix.array;
  const cells = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(src[i * 16 + 12] / cell)},${Math.floor(src[i * 16 + 14] / cell)}`;
    let ids = cells.get(key);
    if (!ids) cells.set(key, (ids = []));
    ids.push(i);
  }
  const geo0 = mesh.geometry;
  if (!geo0.boundingSphere) geo0.computeBoundingSphere();
  if (!geo0.boundingBox) geo0.computeBoundingBox();
  const attrs = Object.entries(geo0.attributes);
  const chunks = [];
  // where each source instance went: chunk number, slot (mayhem.ts hides knocked-over props through it)
  const where = new Int32Array(n * 2).fill(-1);
  for (const ids of cells.values()) {
    ids.forEach((id, j) => { where[id * 2] = chunks.length; where[id * 2 + 1] = j; });
    const geo = new THREE.BufferGeometry();
    geo.setIndex(geo0.index);
    for (const [name, a] of attrs) {
      if (!(a instanceof THREE.InstancedBufferAttribute)) {
        geo.setAttribute(name, a);
        continue;
      }
      const s = a.itemSize;
      const arr = emptyLike(a.array, ids.length * s);
      ids.forEach((id, j) => { arr.set(a.array.subarray(id * s, id * s + s), j * s); });
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, s, a.normalized, a.meshPerAttribute));
    }
    for (const g of geo0.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geo.setDrawRange(geo0.drawRange.start, geo0.drawRange.count);
    geo.boundingSphere = geo0.boundingSphere;
    geo.boundingBox = geo0.boundingBox;

    const chunk = new THREE.InstancedMesh(geo, mesh.material, ids.length);
    ids.forEach((id, j) => { chunk.instanceMatrix.array.set(src.subarray(id * 16, id * 16 + 16), j * 16); });
    if (mesh.instanceColor) {
      const c = mesh.instanceColor.array;
      const arr = new Float32Array(ids.length * 3);
      ids.forEach((id, j) => { arr.set(c.subarray(id * 3, id * 3 + 3), j * 3); });
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
// (the node & map slots of the node materials that do either)
interface MaterialSlots {
  transparent: boolean;
  alphaTest: number;
  alphaMap?: unknown;
  positionNode?: unknown;
  castShadowPositionNode?: unknown;
  castShadowNode?: unknown;
  alphaTestNode?: unknown;
  maskNode?: unknown;
  maskShadowNode?: unknown;
  depthNode?: unknown;
  displacementMap?: unknown;
}
function proxyableMaterial(mat: (THREE.Material & MaterialSlots) | THREE.Material[]) {
  return !Array.isArray(mat) && !mat.transparent && !(mat.alphaTest > 0) && !mat.alphaMap &&
    !mat.positionNode && !mat.castShadowPositionNode && !mat.castShadowNode && !mat.alphaTestNode &&
    !mat.maskNode && !mat.maskShadowNode && !mat.depthNode && !mat.displacementMap;
}

// A plain mesh's triangles in `cell` x `cell` m squares (by where their centres are in the world), each square its own
// mesh in the mesh's place, sharing its material (so the same shader pipeline)
function splitMesh(mesh: THREE.Mesh, cell: number) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count / 3;
  const cells = new Map<string, number[]>();
  for (let t = 0; t < n; t++) {
    _a.fromBufferAttribute(pos, t * 3).add(_b.fromBufferAttribute(pos, t * 3 + 1)).add(_c.fromBufferAttribute(pos, t * 3 + 2));
    _a.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.floor(_a.x / cell)},${Math.floor(_a.z / cell)}`;
    let tris = cells.get(key);
    if (!tris) cells.set(key, (tris = []));
    tris.push(t);
  }
  if (cells.size < 2) return;
  const parent = mesh.parent;
  if (!parent) return;
  for (const tris of cells.values()) {
    const part = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geo.attributes)) {
      const s = a.itemSize * 3;
      const arr = emptyLike(a.array, tris.length * s);
      tris.forEach((t, j) => { arr.set(a.array.subarray(t * s, t * s + s), j * s); });
      part.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    part.computeBoundingBox();
    part.computeBoundingSphere();
    const piece = new THREE.Mesh(part, mesh.material);
    copyObjectState(piece, mesh);
    piece.updateMatrixWorld(true);
    parent.add(piece);
  }
  parent.remove(mesh);
  if (geo !== mesh.geometry) geo.dispose();
  mesh.geometry.dispose();
}

function replaceWithChunks(mesh: THREE.InstancedMesh, cell: number) {
  const parent = mesh.parent;
  if (!parent) return [];
  const chunks = chunkInstancedMesh(mesh, cell);
  parent.remove(mesh);
  chunks.forEach((chunk, k) => {
    parent.add(chunk);
    // Shader precompile: every chunk shares the first chunk's pipeline (main.ts).
    if (k > 0) chunk.userData.sharesPipelineWith = chunks[0];
    chunk.updateMatrixWorld(true);
  });
  return chunks;
}

/** The sun's cascaded shadow (a SunLightShadow): the cameras of its cascades, when it has them */
export interface ShadowCascades {
  getCamera?(viewportIndex: number): THREE.Camera | null | undefined;
  getViewportCount?(): number;
}

/** A chunk culled by distance: its bounding sphere in the world (m) and the distance past which it hides (m) */
interface CulledChunk {
  mesh: THREE.InstancedMesh;
  x: number;
  y: number;
  z: number;
  r: number;
  d: number;
}

/** A face side the shadow stand-ins are drawn with (one material each) */
interface FaceSide {
  side: THREE.Side;
  shadowSide: THREE.Side | null;
}

/**
 * Sets up the culling of the static city under `roots` (Object3Ds). `shadow` is the SunLightShadow whose cascade
 * cameras render the shadow stand-ins (none are made without it). Per-frame culling runs in updateSceneCulling().
 */
function setupSceneCulling(scene: THREE.Scene, roots: THREE.Object3D[], shadow: ShadowCascades | null = null): void {
  scene.updateMatrixWorld(true);
  const culled: CulledChunk[] = [];

  // 1. Small props: chunked & distance culled
  const chunkable: THREE.InstancedMesh[] = [];
  const largeMeshes: THREE.InstancedMesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!isInstancedMesh(o) || !isStaticMesh(o) || o.count < 64 || o.count !== o.instanceMatrix.count) return;
      if (o.count * triangleCount(o.geometry) < 40000) return;
      if (!o.boundingSphere) o.computeBoundingSphere();
      if (!o.boundingSphere || o.boundingSphere.radius < 1500) return;
      chunkable.push(o);
    });
  }
  for (const mesh of chunkable) {
    // unlit (glowing) props, like signal lenses & lamp bulbs, read from much further away at night
    const mat = mesh.material;
    const glow = !Array.isArray(mat) && (mat instanceof THREE.MeshBasicNodeMaterial || mat.type === 'MeshBasicNodeMaterial') ? 3 : 1;
    const cullDist = Math.max(CULL_MIN, instanceSize(mesh) * CULL_PER_METRE * glow);
    if (cullDist > CULL_MAX) {
      largeMeshes.push(mesh);
      continue;
    }
    const cell = Math.min(600, Math.max(250, cullDist * 0.5));
    for (const chunk of replaceWithChunks(mesh, cell)) {
      if (!chunk.boundingSphere) continue;
      const sphere = chunk.boundingSphere.clone().applyMatrix4(chunk.matrixWorld);
      culled.push({ mesh: chunk, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, d: cullDist });
    }
  }

  // 2. Shadow stand-ins for the big static casters
  const cams: THREE.Camera[] = [];
  if (shadow && typeof shadow.getCamera === 'function') {
    const count = typeof shadow.getViewportCount === 'function' ? shadow.getViewportCount() : 2;
    for (let i = 0; i < count; i++) {
      const cam = shadow.getCamera(i);
      if (cam?.layers) cams.push(cam);
    }
  }
  if (cams.length) {
    // geometry signature + face side -> { geometry, material, cells: Map(key -> [matrices]) }
    const instancedBySig = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.MeshBasicNodeMaterial; cells: Map<string, number[]> }>();
    const triCells = new Map<FaceSide, Map<string, number[]>>(); // face side -> Map(key -> number[] world positions)
    const proxyMaterials = new Map<FaceSide, THREE.MeshBasicNodeMaterial>();
    const proxyMaterial = (side: FaceSide) => {
      let m = proxyMaterials.get(side);
      if (!m) {
        m = new THREE.MeshBasicNodeMaterial({ side: side.side, color: 0x000000 });
        m.shadowSide = side.shadowSide;
        m.name = 'ShadowProxy';
        proxyMaterials.set(side, m);
      }
      return m;
    };
    const sideKeys = new Map<string, FaceSide>();
    const sideOf = (mat: THREE.Material) => {
      const k = `${mat.side},${String(mat.shadowSide)}`;
      let s = sideKeys.get(k);
      if (!s) sideKeys.set(k, (s = { side: mat.side, shadowSide: mat.shadowSide }));
      return s;
    };
    const cellKey = (x: number, z: number, cell = PROXY_CELL) => `${cell}:${Math.floor(x / cell)},${Math.floor(z / cell)}`;

    const sources: THREE.Mesh[] = [];
    for (const root of roots) {
      root.traverse((o) => {
        // (meshes whose instances may still change, like knock-over props, keep casting their own shadows)
        if (!o.castShadow || !isStaticMesh(o) || !proxyableMaterial(o.material) || o.userData.keepOwnShadow) return;
        if (isInstancedMesh(o) && o.count !== o.instanceMatrix.count) return;
        const tris = triangleCount(o.geometry) * (isInstancedMesh(o) ? o.count : 1);
        if (tris < 20000) return;
        let radius;
        if (isInstancedMesh(o)) {
          if (!o.boundingSphere) o.computeBoundingSphere();
          radius = o.boundingSphere?.radius ?? 0;
        } else {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          radius = (o.geometry.boundingSphere?.radius ?? 0) * o.matrixWorld.getMaxScaleOnAxis();
        }
        if (radius > 600) sources.push(o);
      });
    }

    for (const o of sources) {
      if (Array.isArray(o.material)) continue; // (proxyableMaterial: never)
      const side = sideOf(o.material);
      const geo = o.geometry;
      if (isInstancedMesh(o)) {
        const pos = geo.attributes.position;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) continue;
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
        if (!bySide) triCells.set(side, (bySide = new Map<string, number[]>()));
        const pos = geo.attributes.position;
        const idx = geo.index;
        const start = geo.drawRange.start;
        const end = Math.min(idx ? idx.count : pos.count, start + geo.drawRange.count);
        if (!geo.boundingBox) geo.computeBoundingBox();
        geo.boundingBox?.getSize(_size);
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

    const firstProxy = new Map<string, THREE.Mesh>(); // material + kind -> the stand-in that compiles their shared pipeline
    const addProxy = (mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>) => {
      mesh.name = 'ShadowProxy';
      mesh.layers.set(SHADOW_PROXY_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.userData.shadowProxy = true;
      const kind = mesh.material.uuid + (isInstancedMesh(mesh) ? ':i' : ':m');
      if (firstProxy.has(kind)) mesh.userData.sharesPipelineWith = firstProxy.get(kind);
      else firstProxy.set(kind, mesh);
      scene.add(mesh);
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
  }

  // Preserve the shadow stand-ins above before splitting their visible geometry.
  // These large objects stay visible at any distance and need no per-frame distance checks.
  for (const mesh of largeMeshes) {
    if (!mesh.castShadow) replaceWithChunks(mesh, STATIC_CELL);
  }
  const largePlain: THREE.Mesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      if (!isStaticMesh(o) || isInstancedMesh(o) || o.castShadow || Array.isArray(o.material)) return;
      // (whole meshes only: one drawing part of its geometry keeps it as it is)
      const { drawRange, groups } = o.geometry;
      if (drawRange.start !== 0 || drawRange.count !== Infinity || groups.length > 1) return;
      if (triangleCount(o.geometry) < 20000) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if ((o.geometry.boundingSphere?.radius ?? 0) * o.matrixWorld.getMaxScaleOnAxis() > STATIC_CELL) largePlain.push(o);
    });
  }
  // (in a few dozen squares at most: the hills' mesh spans 38 km, and every square is a draw)
  for (const mesh of largePlain) splitMesh(mesh, Math.max(STATIC_CELL, (mesh.geometry.boundingSphere?.radius ?? 0) * mesh.matrixWorld.getMaxScaleOnAxis() / 4));

  state.culled = culled;
}

/** An attribute (or interleaved buffer) whose array may go, and the geometries sharing it */
interface ReleaseEntry {
  target: THREE.BufferAttribute | THREE.InterleavedBuffer;
  geos: Set<THREE.BufferGeometry>;
}

const state: { culled: CulledChunk[]; frozen: Set<THREE.Object3D>; pendingRelease: ReleaseEntry[] | null } = {
  culled: [],
  frozen: new Set(),
  pendingRelease: null
};

// Per frame (after the warm-up frame, which must see everything): hide the chunks beyond their cull distance
function updateSceneCulling(cameraPosition: THREE.Vector3): void {
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
function freezeStaticMatrices(scene: THREE.Scene, roots: THREE.Object3D[]): void {
  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;
  state.frozen = new Set(roots);
  for (const child of scene.children) if (child.userData.shadowProxy) state.frozen.add(child);
}

// Per frame, before rendering: the world matrices of everything else in the scene (the player, the traffic, the
// lights that follow the camera...), including whatever was added since
function updateDynamicMatrices(scene: THREE.Scene): void {
  const children = scene.children;
  for (const child of children) {
    if (!state.frozen.has(child)) child.updateMatrixWorld();
  }
}

// Below this many vertices a geometry keeps its arrays: the small shared ones (unit boxes, a prop's shape) may still be
// cloned or merged by something built later, and the memory is all in the big merged batches anyway
const RELEASE_MIN_VERTICES = 2048;

/**
 * Drops the CPU-side copies of the static city's vertex data once the GPU holds them. three.js keeps every attribute's
 * array after the upload, so the frozen city (its streets, facades, paint & shadow stand-ins: ~10M vertices) sat twice
 * in memory, ~1 GB of it in the JS heap alone. Only the attributes the renderer has already uploaded go, and never the
 * instance matrices & colours (knocked-over props change theirs: mayhem.ts). The warm-up frame draws one object per
 * shader pipeline, so the first call (after it) frees what it drew and keeps the rest as pending: call it again now and
 * then (main.ts does, every few seconds) and each part of the city goes once it has been drawn. Each attribute keeps
 * its count and its array's type (the pipelines read both); its array becomes empty, and its geometry is marked
 * `userData.arraysReleased`: nothing may read, clone or change it afterwards. Returns the bytes released by this call.
 */
// What releaseStaticArrays reads of the renderer's backend: the GPU data it keeps per attribute (three.js's Backend
// has these, untyped)
interface BackendData {
  has(object: object): boolean;
  get(object: object): { buffer?: unknown; bufferGPU?: unknown } | undefined;
}
function isBackendData(backend: object): backend is BackendData {
  return 'has' in backend && 'get' in backend && typeof backend.has === 'function' && typeof backend.get === 'function';
}

function releaseStaticArrays(renderer: { backend: object }): number {
  const backend = renderer.backend;
  if (!isBackendData(backend)) return 0;
  if (!state.pendingRelease) {
    const entries = new Map<ReleaseEntry['target'], ReleaseEntry>(); // attribute (or interleaved buffer) -> { target, geos: the geometries sharing it }
    const pendingRelease: ReleaseEntry[] = [];
    state.pendingRelease = pendingRelease;
    for (const root of state.frozen) {
      root.traverse((o) => {
        if (!isMesh(o)) return;
        const geo = o.geometry;
        if (geo.userData.keepArrays || !('position' in geo.attributes)) return;
        const pos = geo.attributes.position;
        if (pos.count < RELEASE_MIN_VERTICES) return;
        // (three.js would compute these from the arrays the first time it culled or bounded the object)
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (isInstancedMesh(o) && !o.boundingSphere) o.computeBoundingSphere();
        const attributes = Object.values(geo.attributes).filter((a) => !('isInstancedBufferAttribute' in a));
        if (geo.index) attributes.push(geo.index);
        for (const attribute of attributes) {
          const target = 'isInterleavedBufferAttribute' in attribute ? attribute.data : attribute;
          let entry = entries.get(target);
          if (!entry) {
            entries.set(target, (entry = { target, geos: new Set() }));
            pendingRelease.push(entry);
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
    target.array = emptyLike(target.array, 0);
    for (const geo of geos) geo.userData.arraysReleased = true;
  }
  pending.length = kept;
  return bytes;
}

export { setupSceneCulling, updateSceneCulling, freezeStaticMatrices, updateDynamicMatrices, releaseStaticArrays, SHADOW_PROXY_LAYER };
