import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// js/render/scene-culling.ts
// Spatial culling for the city-wide static geometry. Most of the street furniture and building massing is built as a
// handful of instanced meshes spanning the whole city (bounding spheres several km across), which three.js can never
// cull: every frame the GPU transformed every lamp post, signal and facade box of the city three times (the
// view and both sun shadow cascades). This module, run once after the city is built (app/install/rendering.ts):
// 1. Splits the instanced meshes of small props into spatial chunks, each culled by the view frustum and hidden beyond
//    the distance where its props shrink below a pixel or two (updateSceneCulling, every frame).
// 2. Gives the big static shadow casters (facade boxes, piers, viaducts...) position-only stand-ins cut into cells, on
//    a layer only the shadow cascade cameras render (they cull the cells outside the ~300 m the cascades cover); the
//    originals stop casting. The stand-ins share one material per face side, so a cell costs one draw.
// 3. Splits the remaining large batches into cells for view-frustum culling, keeping their full draw distance: the
//    glowing props seen across the valley at night by instance, the plain merged ones (the city's curbs, sidewalks &
//    meadows) by triangle.
// 4. Trims what the two cascades walk and draw (each re-renders the scene: ~6.5 ms of CPU a frame at street level,
//    half of it spent walking & culling objects, not drawing): the stand-ins in regions culled whole against each
//    cascade, the static meshes that cast nothing out of their walk, and the small props out of the far cascade,
//    whose texels (~22 cm at street level) they would cover a couple of.

const SHADOW_PROXY_LAYER = 3;
// Distance at which an instance of typical size s (m) is culled: about s / d * 1100 px tall on a 1300 px viewport
const CULL_PER_METRE = 1100;
const CULL_MIN = 300; // never closer: the shadow cascades reach ~300 m at street level
// Every prop hides at its own distance, however big: the high-voltage towers ~21 km out, the far massing's boxes ~6 km.
// Only the glowing ones drawn further than this are kept at any distance: at night the valley's streetlights read from
// across it, a fraction of a pixel each. (Everything past a fixed 2 km was once kept so: the CFE's poles & crossarms,
// the faroles, the bardas were drawn out to the horizon, ~350 of the view's ~1150 draws at street level.)
const GLOW_MAX = 2000;
const PROXY_CELL = 500; // the far cascade spans ~400 m at street level: a cascade sees a few cells
const PROXY_TRIANGLES = 600; // ...but a sparse caster's cells grow to hold about as many triangles (the hills' 75 m cells)
const STATIC_CELL = 1000;
// The plain meshes of a `merge` root (the hills', the rivers', the bridges') that share a parent and a material are
// merged a square this big at a time: they were ~180 of the view's ~800 draws at street level, the same few materials
// in dozens of pieces across the valley (at 2 km the squares still left ~10 a material in view)
const MERGE_CELL = 4000;
// The glowing props kept at any distance, in squares this big: every square in view is a draw, and the CPU's ~12 µs a
// draw costs more than the lenses beside the frustum
const GLOW_CELL = 2000;
// The stand-ins are culled against each cascade's frustum a region at a time (~2200 cells, of which a cascade draws a
// few dozen): a region holds the cells whose centres fall in it
const PROXY_REGION = 2000;
// Props smaller than this (typical size, instanceSize) cast into the near cascade only: in the far one a texel is
// ~22 cm at street level (690 m over 3072 px), so a lamp post's or a bin's shadow there is a texel or two wide. A
// smaller shadow map (a phone's, app/quality.ts) has coarser texels: the bar rises with them.
const FAR_SHADOW_MIN = 1.5;
const FAR_SHADOW_MAP = 3072; // px, the shadow map FAR_SHADOW_MIN is for

const _m = new THREE.Matrix4();
const _wm = new THREE.Matrix4();
const _size = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pm = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _identity = new THREE.Matrix4();

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

/**
 * How far props of typical size `size` (m) are drawn (m; Infinity: at any distance), unlit `glow` ones further, with
 * `scale` the graphics tier's (app/quality.ts); and the side of the squares (m) they are chunked into, half the
 * distance at full scale so a frustum holds about as many of them, whatever the prop (the tier's nearer distance draws
 * fewer of the same squares, not more smaller ones)
 */
function cullDistance(size: number, glow: number, scale = 1): { distance: number; cell: number } {
  const d = Math.max(CULL_MIN, size * CULL_PER_METRE * glow);
  if (glow > 1 && d > GLOW_MAX) return { distance: Infinity, cell: GLOW_CELL };
  return { distance: Math.max(CULL_MIN, d * scale), cell: Math.max(250, d * 0.5) };
}

/**
 * How much of its bounding box's surface a geometry's triangles cover, at most 1: ~1 for a box, 0.5 for a card, ~0.1
 * for a CFE pole's crossarm (a few 5-10 cm bars spread over a 2.3 x 3.1 m box). `position` and `index` are the
 * geometry's arrays (positions xyz), `box` its bounding box's extents (m).
 */
function surfaceFill(position: ArrayLike<number>, index: ArrayLike<number> | null, box: { x: number; y: number; z: number }): number {
  const shell = 2 * (box.x * box.y + box.y * box.z + box.z * box.x);
  if (!(shell > 0)) return 1;
  const n = index ? index.length : position.length / 3;
  let area = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const i = (index ? index[t] : t) * 3, j = (index ? index[t + 1] : t + 1) * 3, k = (index ? index[t + 2] : t + 2) * 3;
    const ux = position[j] - position[i], uy = position[j + 1] - position[i + 1], uz = position[j + 2] - position[i + 2];
    const vx = position[k] - position[i], vy = position[k + 1] - position[i + 1], vz = position[k + 2] - position[i + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return Math.min(1, area / shell);
}

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

// How big an instance looks for its size: a box mostly of air (the crossarm's bars) much smaller than its extents say,
// a card (0.5 of its box) or anything solider as big. Plain arrays only (no interleaved positions: those count as full).
function seenSize(mesh: THREE.InstancedMesh, size: number) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!(pos instanceof THREE.BufferAttribute) || pos.itemSize !== 3) return size;
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (!geo.boundingBox) return size;
  geo.boundingBox.getSize(_size);
  return size * Math.sqrt(Math.min(1, 2 * surfaceFill(pos.array, geo.index ? geo.index.array : null, _size)));
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
// mesh in the mesh's place, sharing its material (so the same shader pipeline). Straight on the arrays: the hills'
// floors are a few hundred thousand triangles, which three.js's per-vertex accessors took most of a second over
function splitMesh(mesh: THREE.Mesh, cell: number) {
  const geo = mesh.geometry;
  const index = geo.index ? geo.index.array : null;
  const pos = geo.attributes.position.array;
  const n = (index ? index.length : pos.length / 3) / 3;
  const e = mesh.matrixWorld.elements;
  const corner = (t: number, c: number) => (index ? (index[t * 3 + c] ?? 0) : t * 3 + c);
  // each triangle's square (by its centre in the world), and how many each square holds
  const cellOf = new Float64Array(n);
  const counts = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const i0 = corner(t, 0) * 3, i1 = corner(t, 1) * 3, i2 = corner(t, 2) * 3;
    const x = (pos[i0] + pos[i1] + pos[i2]) / 3, y = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3, z = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const key = Math.floor(wx / cell) * 1048576 + Math.floor(wz / cell);
    cellOf[t] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size < 2) return;
  const parent = mesh.parent;
  if (!parent) return;
  const attrs = Object.entries(geo.attributes);
  const parts = new Map<number, { arrays: THREE.TypedArray[]; used: number }>(); // square -> its arrays, triangles in them
  for (const [key, count] of counts) {
    parts.set(key, { arrays: attrs.map(([, a]) => emptyLike(a.array, count * 3 * a.itemSize)), used: 0 });
  }
  for (let t = 0; t < n; t++) {
    const part = parts.get(cellOf[t]);
    if (!part) continue;
    for (let c = 0; c < 3; c++) {
      const v = corner(t, c), w = part.used * 3 + c;
      attrs.forEach(([, a], k) => {
        const size = a.itemSize, src = a.array, dst = part.arrays[k];
        for (let q = 0; q < size; q++) dst[w * size + q] = src[v * size + q];
      });
    }
    part.used++;
  }
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

function replaceWithChunks(mesh: THREE.InstancedMesh, cell: number) {
  const parent = mesh.parent;
  if (!parent) return [];
  const chunks = chunkInstancedMesh(mesh, cell);
  parent.remove(mesh);
  chunks.forEach((chunk, k) => {
    parent.add(chunk);
    // Shader precompile: every chunk shares the first chunk's pipeline (app/frame-loop.ts).
    if (k > 0) chunk.userData.sharesPipelineWith = chunks[0];
    chunk.updateMatrixWorld(true);
  });
  return chunks;
}

/** The sun's cascaded shadow (a SunLightShadow): the cameras of its cascades, when it has them */
export interface ShadowCascades {
  getCamera?(viewportIndex: number): THREE.Camera | null | undefined;
  getViewportCount?(): number;
  /** its shadow map per cascade (px) */
  mapSize?: { x: number };
}

/** A chunk culled by distance: its bounding sphere in the world (m) and the distance past which it hides (m) */
interface CulledChunk {
  mesh: THREE.InstancedMesh;
  x: number;
  y: number;
  z: number;
  r: number;
  d: number;
  size: number; // the typical size of its props (m, instanceSize)
}

/** Shadow stand-ins whose cell centres fall in one PROXY_REGION square, and a world sphere bounding them all (m) */
interface ProxyRegion {
  group: THREE.Group;
  sphere: THREE.Sphere;
}

/** A face side the shadow stand-ins are drawn with (one material each) */
interface FaceSide {
  side: THREE.Side;
  shadowSide: THREE.Side | null;
}

/**
 * Shows `group` only to the cameras that see `layers`, render by render (scene.onBeforeRender), and visible again
 * after each (onAfterRender), so whatever walks the scene between renders (app/frame-loop.ts's shader warm-up) still
 * finds it
 */
function showOnlyTo(scene: THREE.Scene, group: THREE.Object3D, layers: THREE.Layers): void {
  // (three.js calls them on the scene: bound to it, as they were)
  const before = scene.onBeforeRender.bind(scene), after = scene.onAfterRender.bind(scene);
  scene.onBeforeRender = (...args: Parameters<THREE.Scene['onBeforeRender']>) => {
    before(...args);
    group.visible = args[2].layers.test(layers);
  };
  scene.onAfterRender = (...args: Parameters<THREE.Scene['onAfterRender']>) => {
    after(...args);
    group.visible = true;
  };
}

// Whether anything under `o` casts a shadow or is a light (the clustered lighting gathers the lights render by render).
// By three.js's type flags, as isMesh above
function castsOrLights(o: THREE.Object3D): boolean {
  if ('isLight' in o && o.isLight === true) return true;
  if (o.castShadow && (('isMesh' in o && o.isMesh === true) || ('isLine' in o && o.isLine === true) || ('isPoints' in o && o.isPoints === true))) return true;
  for (const c of o.children) if (castsOrLights(c)) return true;
  return false;
}

/**
 * Moves the children of `root` (a child of the scene) that neither cast a shadow nor hold a light into one group under
 * it, so the cascades can skip them whole (null when there are fewer than two). The group sits where they did, at
 * identity under the same parent, so their world matrices don't change; it carries the root's render order, which
 * three.js hands down from groups only.
 */
function gatherQuietChildren(root: THREE.Object3D): THREE.Group | null {
  const quiet: THREE.Object3D[] = [];
  const kept: THREE.Object3D[] = [];
  for (const c of root.children) (castsOrLights(c) ? kept : quiet).push(c);
  if (quiet.length < 2) return null;
  const group = new THREE.Group();
  group.name = `${root.name}NoShadow`;
  group.renderOrder = 'isGroup' in root && root.isGroup === true ? root.renderOrder : 0;
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
function cullForCascades(
  scene: THREE.Scene,
  cams: THREE.Camera[],
  regions: ProxyRegion[],
  quiet: THREE.Object3D[],
  nearOnly: THREE.Object3D[],
  live: () => boolean
): void {
  // (three.js calls them on the scene: bound to it, as they were)
  const before = scene.onBeforeRender.bind(scene), after = scene.onAfterRender.bind(scene);
  const shown = new Uint8Array(nearOnly.length);
  scene.onBeforeRender = (...args: Parameters<THREE.Scene['onBeforeRender']>) => {
    before(...args);
    const camera = args[2];
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
  scene.onAfterRender = (...args: Parameters<THREE.Scene['onAfterRender']>) => {
    after(...args);
    const i = cams.indexOf(args[2]);
    if (i < 0) return;
    for (const g of quiet) g.visible = true;
    for (const r of regions) r.group.visible = true;
    if (i === 1) for (let k = 0; k < nearOnly.length; k++) nearOnly[k].visible = shown[k] === 1;
  };
}

// What must match for meshes to be drawn as one: parent, material, the attributes' layout, indexed or not, how they
// cast & receive shadows, their order and layers, and the MERGE_CELL square their centres are in. Null for a mesh that
// stays as it is: moved by its matrix (its material may read local positions), transparent (drawn sorted), drawing part
// of its geometry, or carrying hooks or data something else may reach it by.
function mergeKey(o: THREE.Mesh, parent: THREE.Object3D): string | null {
  const mat = o.material;
  const geo = o.geometry;
  if (Array.isArray(mat) || mat.transparent || !o.matrixWorld.equals(_identity)) return null;
  if (geo.groups.length > 0 || geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity || Object.keys(geo.morphAttributes).length) return null;
  if (Object.prototype.hasOwnProperty.call(o, 'onBeforeRender') || Object.prototype.hasOwnProperty.call(o, 'onAfterRender')) return null;
  if (Object.keys(o.userData).some((k) => k !== 'sharesPipelineWith')) return null;
  const layout = [];
  for (const [name, a] of Object.entries(geo.attributes)) {
    if (!(a instanceof THREE.BufferAttribute)) return null; // (interleaved)
    layout.push(`${name}:${String(a.itemSize)}:${String(a.normalized)}:${a.array.constructor.name}`);
  }
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const c = geo.boundingSphere?.center;
  if (!c) return null;
  const cell = `${String(Math.floor(c.x / MERGE_CELL))},${String(Math.floor(c.z / MERGE_CELL))}`;
  return [parent.uuid, mat.uuid, layout.sort().join(' '), String(geo.index !== null), String(o.castShadow), String(o.receiveShadow),
    String(o.renderOrder), String(o.layers.mask), cell].join('|');
}

/** Merges the plain static meshes under `root` that mergeKey() puts together */
function mergeSiblings(root: THREE.Object3D): void {
  const groups = new Map<string, { parent: THREE.Object3D; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    if (!isStaticMesh(o) || isInstancedMesh(o) || !o.parent) return;
    const key = mergeKey(o, o.parent);
    if (key === null) return;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { parent: o.parent, meshes: [] }));
    g.meshes.push(o);
  });
  const removed = new Set<unknown>();
  for (const { parent, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    // (null when the geometries can't be merged, though mergeKey matched their layouts: the meshes stay)
    const geometry: THREE.BufferGeometry | null = mergeGeometries(meshes.map((m) => m.geometry));
    if (!(geometry instanceof THREE.BufferGeometry)) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, first.material);
    copyObjectState(merged, first);
    delete merged.userData.sharesPipelineWith;
    merged.updateMatrixWorld(true);
    for (const m of meshes) removed.add(m);
    parent.children = parent.children.filter((c) => !removed.has(c));
    parent.add(merged);
  }
  // (a pipeline donor merged away: whoever pointed at it compiles its own)
  if (removed.size) {
    root.traverse((o) => {
      const donor: unknown = o.userData.sharesPipelineWith;
      if (removed.has(donor)) delete o.userData.sharesPipelineWith;
    });
  }
}

/**
 * Sets up the culling of the static city under `roots` (Object3Ds). `shadow` is the SunLightShadow whose cascade
 * cameras render the shadow stand-ins (none are made without it). `propDistance` scales the props' draw distances (the
 * graphics tier's), and the plain meshes under the `merge` roots are merged by material (mergeSiblings). Per-frame
 * culling runs in updateSceneCulling().
 */
function setupSceneCulling(scene: THREE.Scene, roots: THREE.Object3D[], shadow: ShadowCascades | null = null, propDistance = 1,
  merge: readonly THREE.Object3D[] = []): void {
  scene.updateMatrixWorld(true);
  const culled: CulledChunk[] = [];

  // 1. Small props: chunked & distance culled
  const chunkable: THREE.InstancedMesh[] = [];
  const largeMeshes: { mesh: THREE.InstancedMesh; cell: number }[] = [];
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
    // (drawn as far as it looks big; cast into the far cascade by its extents, a crossarm's shadow being its box's)
    const size = instanceSize(mesh);
    const { distance, cell } = cullDistance(seenSize(mesh, size), glow, propDistance);
    if (distance === Infinity) {
      largeMeshes.push({ mesh, cell });
      continue;
    }
    for (const chunk of replaceWithChunks(mesh, cell)) {
      if (!chunk.boundingSphere) continue;
      const sphere = chunk.boundingSphere.clone().applyMatrix4(chunk.matrixWorld);
      culled.push({ mesh: chunk, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, d: distance, size });
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
  const regions: ProxyRegion[] = [];
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
    const firstProxy = new Map<string, THREE.Mesh>(); // material + kind -> the stand-in that compiles their shared pipeline
    const byRegion = new Map<string, ProxyRegion>();
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
      // (the stand-ins sit at identity: their bounding spheres are in the world already, computed before they come here)
      const bounds = isInstancedMesh(mesh) ? mesh.boundingSphere : mesh.geometry.boundingSphere;
      if (!bounds) {
        proxies.add(mesh);
        return;
      }
      _sphere.copy(bounds);
      const key = `${Math.floor(_sphere.center.x / PROXY_REGION)},${Math.floor(_sphere.center.z / PROXY_REGION)}`;
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

  // After the shadow stand-ins above, split the glowing props kept at any distance into cells. They need no per-frame
  // distance checks; those casting their own shadows are then drawn into each cascade only where it reaches.
  for (const { mesh, cell } of largeMeshes) replaceWithChunks(mesh, cell);
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
  // ...and the `merge` roots' pieces sharing a material, one mesh a MERGE_CELL square
  for (const root of merge) mergeSiblings(root);

  // 4. What the cascades walk and draw: each root's meshes that cast nothing in one group they skip (~1800 of them at
  //    street level, which they would cull & sort only to drop), the stand-ins by region, and the small props cast
  //    into the near cascade only
  if (cams.length) {
    const quiet: THREE.Group[] = [];
    for (const root of roots) {
      const group = root.parent === scene ? gatherQuietChildren(root) : null;
      if (group) quiet.push(group);
    }
    const farMin = FAR_SHADOW_MIN * Math.max(1, FAR_SHADOW_MAP / (shadow?.mapSize?.x ?? FAR_SHADOW_MAP));
    const nearOnly = culled.filter((c) => c.mesh.castShadow && c.size < farMin).map((c) => c.mesh);
    cullForCascades(scene, cams, regions, quiet, nearOnly, () => state.live);
  }

  state.culled = culled;
}

/** An attribute (or interleaved buffer) whose array may go, and the geometries sharing it */
interface ReleaseEntry {
  target: THREE.BufferAttribute | THREE.InterleavedBuffer;
  geos: Set<THREE.BufferGeometry>;
}

const state: {
  culled: CulledChunk[];
  frozen: Set<THREE.Object3D>;
  pendingRelease: ReleaseEntry[] | null;
  live: boolean; // (the warm-up frame is done: the cascades may cull the stand-in regions)
} = {
  culled: [],
  frozen: new Set(),
  pendingRelease: null,
  live: false
};

// Per frame (after the warm-up frame, which must see everything): hide the chunks beyond their cull distance
function updateSceneCulling(cameraPosition: THREE.Vector3): void {
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
 * then (app/frame-loop.ts does, every few seconds) and each part of the city goes once it has been drawn. Each
 * attribute keeps its count and its array's type (the pipelines read both); its array becomes empty, and its geometry
 * is marked `userData.arraysReleased`: nothing may read, clone or change it afterwards. Returns the bytes released by
 * this call.
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

export { setupSceneCulling, updateSceneCulling, freezeStaticMatrices, updateDynamicMatrices, releaseStaticArrays, showOnlyTo, SHADOW_PROXY_LAYER };
