import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as tiles from '../js/world/tiles.js';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');
// (the harness runs it as a script: the worker's URL is made from the module's own)
const source = readFileSync(new URL('../js/world/streaming.js', import.meta.url), 'utf8').replace('import.meta.url', JSON.stringify('file:///js/world/streaming.js'));

// Just enough of three.js for the streamer
class Object3D {
  constructor() { this.children = []; this.name = ''; this.userData = {}; }
  add(...objects) { this.children.push(...objects); }
  remove(o) { this.children = this.children.filter((c) => c !== o); }
  updateMatrixWorld() {}
}
class Vec {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
}
class Box3 {
  constructor(min, max) { Object.assign(this, { min, max }); }
  getBoundingSphere(s) { return s; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.userData = {}; this.disposed = false; }
  setAttribute(name, a) { this.attributes[name] = a; }
  dispose() { this.disposed = true; }
}
class BufferAttribute {
  constructor(array, itemSize, normalized = false) { Object.assign(this, { array, itemSize, normalized }); }
}
class Mesh extends Object3D {
  constructor(geometry, material) { super(); Object.assign(this, { geometry, material }); }
}
class DataTexture {
  constructor(data, w, h) { Object.assign(this, { data, w, h }); }
}
const THREE = {
  Group: Object3D, Mesh, BufferGeometry, BufferAttribute, Box3, Sphere: class {}, Vector2: Vec, Vector3: Vec, DataTexture,
  NearestFilter: 1, RGBAFormat: 2, UnsignedByteType: 3
};

// Workers that keep what they are sent; the test answers for them
const workers = [];
class Worker {
  constructor() { this.sent = []; workers.push(this); }
  postMessage(msg, transfer = []) { this.sent.push({ msg, transfer }); }
}

function streamerModule() {
  workers.length = 0;
  return loadModule(source, {
    imports: { 'three/webgpu': THREE, './tiles.js': tiles },
    globals: { Worker, URL, performance, setTimeout, console, Math, Set, Map, Promise, Float32Array, Uint8Array, Infinity }
  });
}

// A lattice of 10 m cells from the origin: 120 m tiles
const lattice = { x0: 0, z0: 0, cell: 10 };
const reply = (worker, data) => worker.onmessage({ data });

test('a layer goes to every worker, the last one taking its arrays; the tiles it reaches are known once all reply', async () => {
  const { TileStreamer } = streamerModule();
  const scene = new Object3D();
  const streamer = new TileStreamer({ scene, lattice, ground: null, workers: 2 });
  assert.ok(scene.children.includes(streamer.root));
  assert.deepEqual(workers.map((w) => w.sent[0].msg.type), ['init', 'init']);
  const position = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  const material = {};
  const id = streamer.addLayer(geometry, material, { name: 'Paint' });
  assert.ok(geometry.disposed);
  const [a, b] = workers.map((w) => w.sent[1]);
  assert.notEqual(a.msg.arrays[0], position, 'a copy for the first');
  assert.equal(b.msg.arrays[0], position, 'the arrays themselves for the last');
  assert.equal(b.transfer.length, 1);
  assert.equal(b.transfer[0], position.buffer);
  let ready = false;
  streamer.ready().then(() => { ready = true; });
  const key = streamer.grid.key(0, 0);
  reply(workers[0], { type: 'layer', id, keys: [key] });
  await null;
  assert.equal(ready, false, 'not until both have bucketed it');
  reply(workers[1], { type: 'layer', id, keys: [key] });
  await null;
  assert.equal(ready, true);
  assert.ok(streamer.candidates.has(key));
});

test('tiles are asked for nearest first a few at a time, shown as they come, and dropped once left behind', () => {
  const { TileStreamer } = streamerModule();
  const streamer = new TileStreamer({ scene: new Object3D(), lattice, ground: null, workers: 1, box: { x0: 0, x1: 2400, z0: 0, z1: 2400 } });
  const g = streamer.grid;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  streamer.addLayer(geometry, {}, { name: 'Deck' });
  const keys = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) keys.push(g.key(i, j));
  reply(workers[0], { type: 'layer', id: 0, keys });
  // the camera over tile (5, 5)
  streamer.update({ x: 660, z: 660 }, 0, 0.016);
  const asked = workers[0].sent.filter((s) => s.msg.type === 'tile').map((s) => s.msg.key);
  assert.equal(asked.length, 2, 'two in flight for a worker');
  assert.equal(asked[0], g.key(5, 5), 'the one under the camera first');
  // its reply: shown in the next frame, its floor masked
  const part = { id: 0, arrays: [new Float32Array([600, 1, 600, 610, 1, 600, 600, 1, 610])], bounds: [600, 1, 600, 610, 1, 610] };
  reply(workers[0], { type: 'tile', key: asked[0], parts: [part] });
  streamer.update({ x: 660, z: 660 }, 0, 0.016);
  const tile = streamer.tiles.get(asked[0]);
  assert.equal(tile.state, 'shown');
  assert.ok(streamer.root.children.includes(tile.group));
  assert.equal(tile.group.children[0].name, 'Deck');
  assert.equal(tile.group.children[0].geometry.userData.keepArrays, true);
  const texel = (key) => streamer.mask.texture.data[((g.j(key)) * streamer.mask.texture.w + g.i(key)) * 4];
  assert.equal(texel(asked[0]), 255);
  // far off (a teleport): both dropped; the one still being laid ignored when it comes back
  streamer.update({ x: 2300, z: 2300 }, 0, 0.016);
  streamer.sincePlan = Infinity;
  streamer.update({ x: 2300, z: 2300 }, 0, 0.016);
  assert.ok(!streamer.tiles.has(asked[0]) && !streamer.tiles.has(asked[1]));
  assert.ok(tile.group.children[0].geometry.disposed);
  assert.ok(!streamer.root.children.includes(tile.group));
  assert.equal(texel(asked[0]), 0);
  reply(workers[0], { type: 'tile', key: asked[1], parts: [part] });
  assert.ok(!streamer.tiles.has(asked[1]));
  assert.equal(streamer.arrived.length, 0);
});

test('the radius grows with the camera\'s height, and its velocity looks ahead but not across a teleport', () => {
  const { TileStreamer, DETAIL_RADIUS } = streamerModule();
  const streamer = new TileStreamer({ scene: new Object3D(), lattice, ground: null, workers: 1 });
  streamer.update({ x: 0, z: 0 }, 0, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS);
  streamer.update({ x: 0, z: 0 }, 300, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS + 300);
  streamer.update({ x: 0, z: 0 }, 1e5, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS * 2);
  for (let k = 1; k <= 20; k++) streamer.update({ x: k * 3, z: 0 }, 0, 0.1); // 30 m/s east
  assert.ok(streamer.focus.vx > 25 && streamer.focus.vx <= 30);
  const vx = streamer.focus.vx;
  streamer.update({ x: 5000, z: 0 }, 0, 0.1);
  assert.equal(streamer.focus.vx, vx * 0.8, 'a jump counts as standing still');
});
