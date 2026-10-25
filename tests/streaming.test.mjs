import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as tiles from '../js/world/tiles.js';
import * as lattice from '../js/world/lattice.js';
import * as waterways from '../js/world/waterways.js';

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
const lattice10 = { x0: 0, z0: 0, cell: 10 };
const reply = (worker, data) => worker.onmessage({ data });

test('a layer is bucketed by tile, each worker sent only its own tiles\' triangles, each of them once', () => {
  const { TileStreamer } = streamerModule();
  const scene = new Object3D();
  const streamer = new TileStreamer({ scene, lattice: lattice10, ground: null, workers: 2 });
  assert.ok(scene.children.includes(streamer.root));
  assert.deepEqual(workers.map((w) => w.sent[0].msg.type), ['init', 'init']);
  const g = streamer.grid;
  // an indexed quad across tiles (0, 0) and (1, 0) (120 m tiles), a triangle in (0, 0) and one in (0, 1)
  const position = new Float32Array([100, 0, 10, 140, 0, 10, 140, 0, 20, 100, 0, 20, 10, 0, 10, 20, 0, 10, 10, 0, 20, 10, 0, 130, 20, 0, 130, 10, 0, 140]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.index = { array: new Uint16Array([0, 3, 2, 0, 2, 1, 4, 6, 5, 7, 9, 8]) };
  const id = streamer.addLayer(geometry, {}, { name: 'Paint' });
  assert.ok(geometry.disposed);
  assert.deepEqual([...streamer.layers[id].keys].sort(), [g.key(0, 0), g.key(0, 1), g.key(1, 0)].sort());
  assert.deepEqual([...streamer.candidates].sort(), [...streamer.layers[id].keys].sort());
  let total = 0;
  workers.forEach((w, n) => {
    const { msg, transfer } = w.sent[1];
    assert.equal(msg.type, 'layer');
    const tris = msg.arrays[0].length / 9;
    total += tris;
    for (const [key, list] of msg.buckets) {
      assert.equal(key % 2, n, 'its own tiles only');
      assert.ok(list.every((t) => t < tris), 'numbered in its own copy');
    }
    assert.equal(transfer.length, msg.arrays.length + msg.buckets.length);
  });
  // the quad's two triangles go to both its tiles' workers (if they differ); the others once
  const owners = new Set([g.key(0, 0) % 2, g.key(1, 0) % 2]);
  assert.equal(total, 2 * owners.size + 2);
});

test('tiles are asked for nearest first a few at a time, shown as they come, and dropped once left behind', () => {
  const { TileStreamer } = streamerModule();
  const streamer = new TileStreamer({ scene: new Object3D(), lattice: lattice10, ground: null, workers: 1, box: { x0: 0, x1: 2400, z0: 0, z1: 2400 } });
  const g = streamer.grid;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  streamer.addLayer(geometry, {}, { name: 'Deck', covers: true });
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) streamer.candidates.add(g.key(i, j));
  streamer.layers[0].keys = new Set(streamer.candidates);
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
  const streamer = new TileStreamer({ scene: new Object3D(), lattice: lattice10, ground: null, workers: 1 });
  streamer.update({ x: 0, z: 0 }, 0, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS);
  streamer.update({ x: 0, z: 0 }, 300, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS + 300);
  streamer.update({ x: 0, z: 0 }, 1e5, 0.1);
  assert.equal(streamer.focus.radius, DETAIL_RADIUS * 2);
  for (let k = 1; k <= 20; k++) streamer.update({ x: k * 3, z: 0 }, 0, 0.1); // 30 m/s east
  assert.ok(streamer.focus.vx > 25 && streamer.focus.vx <= 30);
  streamer.update({ x: 5000, z: 0 }, 0, 0.1);
  assert.equal(streamer.focus.vx, 0, 'a jump is a teleport: no velocity to look ahead along');
  assert.equal(streamer.rush, false, 'nothing to rush for where nothing is to be laid');
});

test('a tile its worker could not lay is let go, not waited on, and its worker freed', async () => {
  const { TileStreamer } = streamerModule();
  const streamer = new TileStreamer({ scene: new Object3D(), lattice: lattice10, ground: null, workers: 1 });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([10, 0, 10, 20, 0, 10, 10, 0, 20]), 3));
  streamer.addLayer(geometry, {}, { covers: true });
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const done = streamer.preload(15, 15);
    const asked = workers[0].sent.filter((s) => s.msg.type === 'tile');
    assert.equal(asked.length, 1);
    reply(workers[0], { type: 'tile', key: asked[0].msg.key, parts: [], error: 'RangeError' });
    await done;
  } finally {
    console.error = error;
  }
  assert.equal(streamer.tiles.get(streamer.grid.key(0, 0)).state, 'failed');
  assert.equal(streamer.workers[0].busy, 0);
  assert.equal(errors.length, 1);
  assert.equal(JSON.stringify(streamer.stats), JSON.stringify({ loading: 0, shown: 0, layers: 1 }));
});

// The worker, run as a script with a `self` that keeps what it posts
function workerScope() {
  const posted = [];
  const self = { postMessage: (msg, transfer = []) => posted.push({ msg, transfer }) };
  loadModule(readFileSync(new URL('../js/world/tile-worker.js', import.meta.url), 'utf8'), {
    imports: { './tiles.js': tiles, './lattice.js': lattice, './waterways.js': waterways },
    globals: { self, Math, Map, Float32Array, Uint32Array, String, Infinity, atob }
  });
  return { send: (msg) => self.onmessage({ data: msg }), posted };
}

test('the worker lays a deck tile and opens it over the river channels reaching into that tile', () => {
  const { send, posted } = workerScope();
  // 120 m tiles; a channel's hole (a 10 m wide strip from z = 20 to 30 across x = 0..60) and one in another tile
  send({ type: 'init', lattice: lattice10, cells: 12, ground: null, holes: new Float32Array([0, 20, 60, 20, 60, 30, 0, 20, 60, 30, 0, 30, 500, 500, 510, 500, 510, 510]) });
  const k = tiles.createTileGrid(lattice10, 12).key(0, 0);
  // the deck: a 100 x 100 m square in tile (0, 0)
  const position = new Float32Array([0, 0, 0, 0, 0, 100, 100, 0, 100, 0, 0, 0, 100, 0, 100, 100, 0, 0]);
  send({ type: 'layer', id: 0, arrays: [position], sizes: [3], normalAt: -1, cutHoles: true, buckets: [[k, new Uint32Array([0, 1])]] });
  send({ type: 'layer', id: 1, arrays: [position.slice()], sizes: [3], normalAt: -1, cutHoles: false, buckets: [[k, new Uint32Array([0, 1])]] });
  send({ type: 'tile', key: k, layers: [0, 1] });
  const [{ msg, transfer }] = posted;
  assert.equal(msg.key, k);
  const area = (p) => {
    let a = 0;
    for (let t = 0; t < p.length; t += 9) a += Math.abs((p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]) - (p[t + 6] - p[t]) * (p[t + 5] - p[t + 2])) / 2;
    return a;
  };
  assert.ok(Math.abs(area(msg.parts[0].arrays[0]) - (100 * 100 - 60 * 10)) < 0.01, 'the deck opened over its channel');
  assert.ok(Math.abs(area(msg.parts[1].arrays[0]) - 100 * 100) < 0.01, 'the layers that don\'t ask, whole');
  assert.equal(transfer.length, 2, 'the arrays handed over');
  assert.deepEqual([...msg.parts[0].bounds], [0, 0, 0, 100, 0, 100]);
});

test('a tile the worker cannot lay comes back as an error', () => {
  const { send, posted } = workerScope();
  send({ type: 'init', lattice: lattice10, cells: 12, ground: null, holes: null });
  // (a layer whose triangle list points past its arrays)
  send({ type: 'layer', id: 0, arrays: null, sizes: [3], normalAt: -1, cutHoles: false, buckets: [[1, new Uint32Array([0])]] });
  send({ type: 'tile', key: 1, layers: [0] });
  assert.equal(posted[0].msg.key, 1);
  assert.equal(posted[0].msg.parts.length, 0);
  assert.match(posted[0].msg.error, /TypeError/);
});

test('in the flat city the worker cuts a deck tile in small cells before its holes, which would split it without end', () => {
  const { send, posted } = workerScope();
  send({ type: 'init', lattice: null, cells: 12, ground: null, holes: new Float32Array([0, 20, 60, 20, 60, 30, 0, 20, 60, 30, 0, 30]) });
  const k = tiles.createTileGrid(null, 12).key(0, 0);
  const position = new Float32Array([0, 0, 0, 0, 0, 450, 450, 0, 450, 0, 0, 0, 450, 0, 450, 450, 0, 0]);
  send({ type: 'layer', id: 0, arrays: [position], sizes: [3], normalAt: -1, cutHoles: true, buckets: [[k, new Uint32Array([0, 1])]] });
  send({ type: 'tile', key: k, layers: [0] });
  const p = posted[0].msg.parts[0].arrays[0];
  let a = 0;
  for (let t = 0; t < p.length; t += 9) a += Math.abs((p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]) - (p[t + 6] - p[t]) * (p[t + 5] - p[t + 2])) / 2;
  assert.ok(Math.abs(a - (450 * 450 - 600)) < 0.05);
  for (let v = 0; v < p.length; v += 3) assert.equal(p[v + 1], 0, 'left at its height');
});

test('after a teleport the tiles round the player are asked for at once and shown with a larger budget', () => {
  const { TileStreamer } = streamerModule();
  const streamer = new TileStreamer({ scene: new Object3D(), lattice: lattice10, ground: null, workers: 1 });
  const g = streamer.grid;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  streamer.addLayer(geometry, {});
  for (let i = 0; i < 60; i++) for (let j = 0; j < 4; j++) streamer.candidates.add(g.key(i, j));
  streamer.layers[0].keys = new Set(streamer.candidates);
  streamer.update({ x: 60, z: 60 }, 0, 0.016);
  streamer.update({ x: 60, z: 60 }, 0, 0.016);
  const before = workers[0].sent.filter((s) => s.msg.type === 'tile').length;
  // (the worker answers what it was asked, then the player is somewhere else, mid-plan-interval)
  for (const { msg } of workers[0].sent.filter((s) => s.msg.type === 'tile')) reply(workers[0], { type: 'tile', key: msg.key, parts: [] });
  streamer.sincePlan = 0;
  streamer.update({ x: 6000, z: 60 }, 0, 0.016);
  const asked = workers[0].sent.filter((s) => s.msg.type === 'tile').slice(before).map((s) => s.msg.key);
  assert.ok(asked.includes(g.key(50, 0)), 'the tile under the new place, this very frame');
  assert.equal(streamer.rush, true);
});
