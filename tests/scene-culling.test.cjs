const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { stripTypes } = require('./helpers/module.cjs');

const source = stripTypes(readFileSync(join(__dirname, '../js/render/scene-culling.ts'), 'utf8'));
const topLevel = (name) => {
  const match = source.match(new RegExp(`^function ${name}\\s*\\([^]*?\\n\\}`, 'm'));
  assert.ok(match, `${name} is present`);
  return match[0];
};

// Just enough of three.js for splitMesh: world-space triangle centres, attributes, meshes in a parent
class Vector3 {
  constructor() { this.x = this.y = this.z = 0; }
  fromBufferAttribute(a, i) { [this.x, this.y, this.z] = a.array.slice(i * 3, i * 3 + 3); return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  applyMatrix4(m) { this.x += m.tx; this.z += m.tz; return this; } // (translations only here)
  copy(v) { return Object.assign(this, { x: v.x, y: v.y, z: v.z }); }
}
class BufferAttribute {
  constructor(array, itemSize, normalized = false) { Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize }); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
  setAttribute(name, a) { this.attributes[name] = a; }
  computeBoundingBox() {}
  computeBoundingSphere() {}
  dispose() { this.disposed = true; }
}
class Object3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.layers = { mask: 1 };
    this.userData = {};
    this.position = new Vector3();
    this.quaternion = new Vector3();
    this.scale = new Vector3();
    this.matrix = { copy() {} };
  }
  add(o) { o.parent = this; this.children.push(o); }
  remove(o) { this.children = this.children.filter((c) => c !== o); }
  updateMatrixWorld() {}
}
class Mesh extends Object3D {
  constructor(geometry, material) { super(); Object.assign(this, { geometry, material }); }
}
const THREE = { BufferAttribute, BufferGeometry, Mesh };
const context = { THREE, Math, Map, Object, Float64Array, _a: new Vector3(), _b: new Vector3(), _c: new Vector3() };
const splitMesh = vm.runInNewContext(`${topLevel('emptyLike')}\n${topLevel('copyObjectState')}\n(${topLevel('splitMesh')})`, context);

test('a large merged mesh is split into squares by where its triangles are, every triangle kept once', () => {
  const parent = new Object3D();
  // nine triangles spread over three 1 km squares, the mesh placed 200 m east
  const pos = [], uv = [];
  for (const [x, z] of [[100, 100], [300, 400], [900, 50], [1200, 100], [1500, 800], [1900, 900], [100, 1200], [400, 1700], [800, 1900]]) {
    pos.push(x, 0, z, x + 5, 0, z, x, 0, z + 5);
    uv.push(x, z, x, z, x, z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  const material = {};
  const mesh = new Mesh(geo, material);
  mesh.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 200, 0, 0, 1] };
  mesh.name = 'Curbs';
  mesh.receiveShadow = true;
  parent.add(mesh);
  splitMesh(mesh, 1000);
  assert.ok(!parent.children.includes(mesh) && geo.disposed);
  // (the centres in the world, 200 m further east: squares (0, 0), (1, 0), (2, 0), (0, 1) and (1, 1))
  assert.equal(parent.children.length, 5);
  let tris = 0;
  const seen = new Set();
  for (const piece of parent.children) {
    assert.equal(piece.material, material);
    assert.equal(piece.name, 'Curbs');
    assert.equal(piece.receiveShadow, true);
    const p = piece.geometry.attributes.position.array, u = piece.geometry.attributes.uv.array;
    tris += p.length / 9;
    for (let t = 0; t < p.length; t += 9) {
      seen.add(`${p[t]},${p[t + 2]}`);
      assert.equal(u[(t / 9) * 6], p[t], 'attributes travel with their triangle');
    }
  }
  assert.equal(tris, 9);
  assert.equal(seen.size, 9);
});

test('an indexed mesh is split by its triangles\' corners, each piece non-indexed', () => {
  const parent = new Object3D();
  const geo = new BufferGeometry();
  // two quads sharing their corners through the index, one each side of x = 1000
  geo.setAttribute('position', new BufferAttribute(new Float32Array([
    100, 0, 100, 200, 0, 100, 200, 0, 200, 100, 0, 200,
    1100, 0, 100, 1200, 0, 100, 1200, 0, 200, 1100, 0, 200
  ]), 3));
  geo.index = new BufferAttribute(new Uint16Array([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]), 1);
  const mesh = new Mesh(geo, {});
  mesh.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  parent.add(mesh);
  splitMesh(mesh, 1000);
  assert.equal(parent.children.length, 2);
  const xs = parent.children.map((p) => [...p.geometry.attributes.position.array].filter((_, i) => i % 3 === 0));
  assert.deepEqual(xs.map((x) => x.length), [6, 6]);
  assert.ok(xs[0].every((x) => x < 1000) && xs[1].every((x) => x > 1000));
  assert.deepEqual(xs[0].slice(0, 3), [100, 200, 200], 'the corners the index names, in order');
});

test('the frozen static city is left out of the per-frame matrix updates, everything else (even added later) is not', () => {
  const state = { culled: [], frozen: new Set() };
  const ctx = { state, Set };
  const { freeze, update } = vm.runInNewContext(
    `${topLevel('freezeStaticMatrices')}\n${topLevel('updateDynamicMatrices')}\n({ freeze: freezeStaticMatrices, update: updateDynamicMatrices })`,
    ctx
  );
  const updated = [];
  const node = (name, userData = {}) => ({ name, userData, updateMatrixWorld() { updated.push(name); } });
  const city = node('CityBlocks'), proxy = node('ShadowProxy', { shadowProxy: true }), player = node('Player');
  let sceneUpdates = 0;
  const scene = { children: [city, proxy, player], matrixWorldAutoUpdate: true, updateMatrixWorld() { sceneUpdates++; } };
  freeze(scene, [city]);
  assert.equal(sceneUpdates, 1, 'the static matrices are computed once');
  assert.equal(scene.matrixWorldAutoUpdate, false, 'rendering no longer walks the scene');
  scene.children.push(node('Rocket'));
  update(scene);
  assert.deepEqual(updated, ['Player', 'Rocket']);
});

test('the static city drops the CPU copies the GPU already holds, keeping what it may still need', () => {
  const ctx = { state: { culled: [], frozen: new Set(), pendingRelease: null }, Set, Map, Object, RELEASE_MIN_VERTICES: 2048 };
  const helpers = ['isMesh', 'isInstancedMesh', 'emptyLike', 'isBackendData'].map(topLevel).join('\n');
  const release = vm.runInNewContext(`${helpers}\n(${topLevel('releaseStaticArrays')})`, ctx);
  const uploaded = new Set();
  const renderer = { backend: { has: (a) => uploaded.has(a), get: () => ({ buffer: {} }) } };
  const attr = (n, itemSize, extra = {}) => Object.assign(new BufferAttribute(new Float32Array(n * itemSize), itemSize), extra);
  const geometry = (n) => {
    const g = new BufferGeometry();
    g.userData = {};
    g.boundingBox = g.boundingSphere = {};
    g.setAttribute('position', attr(n, 3));
    g.setAttribute('normal', attr(n, 3));
    return g;
  };
  const big = geometry(3000);
  big.index = new BufferAttribute(new Uint32Array(6000), 1);
  // (no bounds yet: they must come from the arrays while there are arrays)
  big.boundingBox = big.boundingSphere = null;
  big.computeBoundingBox = () => { big.boundingBox = { from: big.attributes.position.array.length }; };
  big.computeBoundingSphere = () => { big.boundingSphere = { from: big.attributes.position.array.length }; };
  const small = geometry(24); // (a unit box something may still clone)
  const pending = geometry(3000); // (not drawn yet: nothing on the GPU)
  const kept = geometry(3000);
  kept.userData.keepArrays = true;
  // (a tree field's cells: geometries of their own over one tree's shared attributes)
  const cell = new BufferGeometry();
  cell.userData = {};
  cell.boundingBox = cell.boundingSphere = {};
  cell.setAttribute('position', big.attributes.position);
  const props = geometry(3000);
  props.setAttribute('instanceTint', attr(10, 3, { isInstancedBufferAttribute: true }));
  for (const g of [big, small, kept, props]) for (const a of [...Object.values(g.attributes), g.index]) if (a) uploaded.add(a);
  const root = new Object3D();
  const meshes = [big, cell, small, pending, kept, props].map((g) => Object.assign(new Mesh(g, {}), { isMesh: true }));
  root.traverse = (fn) => meshes.forEach(fn);
  ctx.state.frozen.add(root);
  const bytes = release(renderer);
  assert.deepEqual([big.boundingBox.from, big.boundingSphere.from], [9000, 9000], 'the bounds came from the full arrays');
  assert.equal(big.attributes.position.array.length, 0);
  assert.equal(big.attributes.position.count, 3000, 'the count the draws use stays');
  assert.ok(big.attributes.position.array instanceof Float32Array, 'and the array type the pipelines read');
  assert.equal(big.index.array.length, 0);
  assert.ok(big.index.array instanceof Uint32Array);
  assert.equal(big.userData.arraysReleased, true);
  assert.equal(cell.userData.arraysReleased, true, 'every geometry sharing a released attribute is marked');
  assert.equal(small.attributes.position.array.length, 24 * 3);
  assert.equal(pending.attributes.position.array.length, 3000 * 3);
  assert.equal(pending.userData.arraysReleased, undefined);
  assert.equal(kept.attributes.position.array.length, 3000 * 3);
  assert.equal(props.attributes.position.array.length, 0);
  assert.equal(props.attributes.instanceTint.array.length, 30, 'instance data stays: knocked-over props change it');
  assert.equal(bytes, (3000 * 6 * 4 + 6000 * 4) + 3000 * 6 * 4);
  // ...and once the pending one has been drawn, the next call frees it (and nothing twice)
  for (const a of Object.values(pending.attributes)) uploaded.add(a);
  assert.equal(release(renderer), 3000 * 6 * 4);
  assert.equal(pending.attributes.position.array.length, 0);
  assert.equal(release(renderer), 0);
  assert.equal(ctx.state.pendingRelease.length, 0);
});

test('the shadow stand-ins are shown to the cascades only, and visible again between renders', () => {
  const showOnlyTo = vm.runInNewContext(`(${topLevel('showOnlyTo')})`, {});
  const calls = [];
  const scene = { onBeforeRender: () => calls.push('before'), onAfterRender: () => calls.push('after') };
  const group = { visible: true };
  const proxyLayers = { layer: 3 };
  showOnlyTo(scene, group, proxyLayers);
  // (a camera sees the stand-ins' layers if it has layer 3 enabled: the cascades do, the view doesn't)
  const camera = (enabled) => ({ layers: { test: (l) => l === proxyLayers && enabled.includes(l.layer) } });
  const view = camera([0]), cascade = camera([0, 3]);
  scene.onBeforeRender({}, scene, view);
  assert.equal(group.visible, false, 'hidden from the view');
  scene.onAfterRender({}, scene, view);
  assert.equal(group.visible, true, 'visible again after it');
  scene.onBeforeRender({}, scene, cascade);
  assert.equal(group.visible, true, 'shown to a cascade');
  assert.deepEqual(calls, ['before', 'after', 'before'], 'the hooks set before are still called');
});

test('a root\'s children that cast nothing gather in one group the cascades can skip, the casters and lights stay', () => {
  class Group extends Object3D {
    constructor() { super(); this.isGroup = true; }
  }
  const { gather } = vm.runInNewContext(
    `${topLevel('castsOrLights')}\n${topLevel('gatherQuietChildren')}\n({ gather: gatherQuietChildren })`,
    { THREE: { Group } }
  );
  const mesh = (castShadow) => Object.assign(new Mesh({}, {}), { isMesh: true, castShadow });
  const root = new Group();
  root.name = 'StreetDetails';
  root.renderOrder = 2;
  const pole = mesh(true), paint = mesh(false), wires = mesh(false);
  const cell = new Object3D(); // (a tree cell: one caster among non-casters keeps it whole)
  cell.add(mesh(false));
  cell.add(mesh(true));
  const lamps = new Object3D();
  lamps.add(Object.assign(new Object3D(), { isLight: true }));
  for (const o of [pole, paint, cell, wires, lamps]) root.add(o);
  const group = gather(root);
  assert.equal(group.name, 'StreetDetailsNoShadow');
  assert.equal(group.renderOrder, 2, 'the render order three.js hands down from groups');
  assert.deepEqual(group.children, [paint, wires]);
  assert.ok(group.children.every((c) => c.parent === group));
  assert.deepEqual([...root.children], [pole, cell, lamps, group]); // (the array comes from the module's context)
  // nothing to gather (or a single mesh): no group
  const plain = new Group();
  plain.add(mesh(true));
  plain.add(mesh(false));
  assert.equal(gather(plain), null);
  assert.equal(plain.children.length, 2);
});

test('the cascades skip the quiet groups, the stand-in regions off their frustum, and the far one the small props', () => {
  const inFrustum = new Set();
  const ctx = {
    Uint8Array,
    _pm: { multiplyMatrices() {} },
    _frustum: { setFromProjectionMatrix() {}, intersectsSphere: (s) => inFrustum.has(s) }
  };
  const cull = vm.runInNewContext(`(${topLevel('cullForCascades')})`, ctx);
  const calls = [];
  const scene = { onBeforeRender: () => calls.push('before'), onAfterRender: () => calls.push('after') };
  const near = { name: 'near' }, far = { name: 'far' }, view = { name: 'view' };
  const quiet = [{ visible: true }, { visible: true }];
  const regions = [{ group: { visible: true }, sphere: {} }, { group: { visible: true }, sphere: {} }];
  inFrustum.add(regions[0].sphere);
  const bin = { visible: true }, culledBin = { visible: false }; // (one hidden already by its draw distance)
  let live = false;
  cull(scene, [near, far], regions, quiet, [bin, culledBin], () => live);
  const state = () => [...quiet, ...regions.map((r) => r.group), bin, culledBin].map((o) => (o.visible ? 1 : 0)).join('');
  scene.onBeforeRender({}, scene, view);
  assert.equal(state(), '111110', 'the view is left alone');
  scene.onAfterRender({}, scene, view);
  scene.onBeforeRender({}, scene, near);
  assert.equal(state(), '001110', 'no region culling before the warm-up frame is done');
  scene.onAfterRender({}, scene, near);
  live = true;
  scene.onBeforeRender({}, scene, near);
  assert.equal(state(), '001010', 'the near cascade: quiet groups and the region off its frustum out, the props in');
  scene.onAfterRender({}, scene, near);
  assert.equal(state(), '111110');
  scene.onBeforeRender({}, scene, far);
  assert.equal(state(), '001000', 'the far cascade: the small props out too');
  scene.onAfterRender({}, scene, far);
  assert.equal(state(), '111110', 'everything as it was, the culled prop still hidden');
  assert.equal(calls.length, 8, 'the hooks set before are still called');
});

test('props hide at their own distance, scaled by the tier; only the glowing ones are kept at any distance', () => {
  const constant = (name) => Number(source.match(new RegExp(`^const ${name} = (\\d+);`, 'm'))[1]);
  const ctx = { Math, Infinity };
  for (const name of ['CULL_PER_METRE', 'CULL_MIN', 'GLOW_MAX', 'GLOW_CELL']) ctx[name] = constant(name);
  const cullDistance = vm.runInNewContext(`(${topLevel('cullDistance')})`, ctx);
  assert.equal(cullDistance(0.1, 1).distance, ctx.CULL_MIN, 'never closer than the shadow cascades reach');
  // no size is kept at any distance unless it glows: no cliff where a slightly bigger prop is drawn to the horizon
  for (const size of [2.67, 3.6, 3.7, 5.3, 19]) {
    const { distance } = cullDistance(size, 1);
    assert.ok(Number.isFinite(distance) && Math.abs(distance - size * ctx.CULL_PER_METRE) < 1e-6, `${size} m`);
  }
  assert.equal(cullDistance(0.77, 3).distance, Infinity, 'a lamp\'s glowing lens reads from across the valley at night');
  assert.equal(cullDistance(0.77, 3).cell, ctx.GLOW_CELL);
  assert.ok(cullDistance(0.3, 3).distance < Infinity, 'a small glow still hides');
  assert.equal(cullDistance(1, 1, 0.5).distance, 550, 'the low tier halves the distance');
  // ...over the same squares, not more smaller ones (every square in view is a draw)
  assert.equal(cullDistance(0.9, 1, 0.6).cell, cullDistance(0.9, 1).cell);
  assert.ok(cullDistance(0.9, 1).cell >= 0.5 * cullDistance(0.9, 1).distance, 'squares half the distance across');
  // the squares grow with the distance (a frustum holds about as many)
  const cells = [0.1, 1, 2, 19].map((s) => cullDistance(s, 1).cell);
  assert.deepEqual(cells, cells.slice().sort((a, b) => a - b));
  assert.ok(cells[0] >= 250);
});

test('a box mostly of air counts as smaller than its extents; a box, a card and a solid as big', () => {
  const surfaceFill = vm.runInNewContext(`(${topLevel('surfaceFill')})`, { Math });
  // a unit square as two triangles, one-sided (a card): half its flat box's shell
  const card = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  assert.ok(Math.abs(surfaceFill(card, null, { x: 1, y: 1, z: 0 }) - 0.5) < 1e-9);
  // the same card indexed
  assert.ok(Math.abs(surfaceFill([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3], { x: 1, y: 1, z: 0 }) - 0.5) < 1e-9);
  // a thin bar 2.3 m long, 10 cm square, inside a 2.3 x 3.1 x 0.1 m box (the CFE crossarm's): a few hundredths
  const bar = 4 * 2.3 * 0.1;
  const tri = [0, 0, 0, Math.sqrt(2 * bar), 0, 0, 0, Math.sqrt(2 * bar), 0]; // (one triangle of the bar's area)
  const fill = surfaceFill(tri, null, { x: 2.3, y: 3.1, z: 0.1 });
  assert.ok(fill > 0.04 && fill < 0.1, `${fill}`);
  assert.equal(surfaceFill(card, null, { x: 0, y: 0, z: 0 }), 1, 'no box, no shrinking');
});

test('meshes merge when they share a parent, a material, a layout and a square; never one moved, transparent or reachable', () => {
  class BufferAttribute {
    constructor(array, itemSize) { Object.assign(this, { array, itemSize, normalized: false }); }
  }
  const identity = { isIdentity: true };
  const ctx = {
    THREE: { BufferAttribute }, Object, String, Math, Infinity, MERGE_CELL: Number(source.match(/^const MERGE_CELL = (\d+);/m)[1]),
    _identity: identity
  };
  const mergeKey = vm.runInNewContext(`(${topLevel('mergeKey')})`, ctx);
  const parent = { uuid: 'p' };
  const material = { uuid: 'm', transparent: false };
  const mesh = (x, extra = {}) => ({
    material, matrixWorld: { equals: (m) => m === identity && !extra.moved }, castShadow: false, receiveShadow: true, renderOrder: 0,
    layers: { mask: 1 }, userData: extra.userData ?? {},
    geometry: {
      groups: [], drawRange: { start: 0, count: Infinity }, morphAttributes: {}, index: null,
      attributes: { position: new BufferAttribute(new Float32Array(9), 3) },
      boundingSphere: { center: { x, y: 0, z: 10 } }
    },
    ...(extra.material ? { material: extra.material } : {})
  });
  const key = mergeKey(mesh(10), parent);
  assert.ok(key);
  assert.equal(mergeKey(mesh(ctx.MERGE_CELL - 1), parent), key, 'the same square');
  assert.notEqual(mergeKey(mesh(ctx.MERGE_CELL + 1), parent), key, 'the next square');
  assert.notEqual(mergeKey(mesh(10), { uuid: 'q' }), key, 'another parent');
  assert.equal(mergeKey(mesh(10, { moved: true }), parent), null, 'moved by its matrix');
  assert.equal(mergeKey(mesh(10, { material: { uuid: 'w', transparent: true } }), parent), null, 'transparent: drawn sorted');
  assert.equal(mergeKey(mesh(10, { userData: { floods: 1 } }), parent), null, 'data something may reach it by');
  assert.equal(mergeKey(mesh(10, { userData: { sharesPipelineWith: {} } }), parent), key, 'a pipeline donor is no reason');
});
