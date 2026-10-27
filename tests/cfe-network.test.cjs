const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = (path) => readFileSync(join(__dirname, '../js/world', path), 'utf8');

// Just enough of three.js for the network's geometry: what it builds is counted, not drawn
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  distanceTo(v) { return Math.hypot(v.x - this.x, v.y - this.y, v.z - this.z); }
}
class Vector4 { set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } }
class Attribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
class BufferGeometry {
  constructor() { this.attributes = {}; this.disposed = false; }
  setAttribute(name, a) { this.attributes[name] = a; }
  setIndex(i) { this.index = i; }
  computeBoundingSphere() { this.boundingSphere = { radius: 1 }; }
  dispose() { this.disposed = true; }
}
class Group { constructor() { this.children = []; } add(o) { this.children.push(o); } remove(o) { this.children = this.children.filter((c) => c !== o); } }
class Mesh { constructor(geometry = new BufferGeometry(), material = null) { this.geometry = geometry; this.material = material; this.userData = {}; } }
const THREE = { Vector3, Vector4, Group, Mesh, BufferGeometry, Float32BufferAttribute: Attribute, Uint16BufferAttribute: Attribute, Uint32BufferAttribute: Attribute };

const BLACKOUT_MAX = 2; // stretches the facades take at once: the oldest outage gets its power back past them
const blackoutSpans = { array: Array.from({ length: BLACKOUT_MAX }, () => new Vector4()) };
const uBlackouts = { value: 0 };
class CfeSparks {
  constructor() { this.arcs = []; this.bangs = 0; }
  live(pole, x, y, z) { this.arcs.push({ pole, x, z }); }
  drop(pole) { this.arcs = this.arcs.filter((a) => a.pole !== pole); }
  bang() { this.bangs++; }
  update() {}
}
const grid = loadModule(read('cfe-grid.ts'), { filename: 'cfe-grid.ts' });
const hash = loadModule(read('hash.ts'), { filename: 'hash.ts' });
const { CfeNetwork } = loadModule(read('cfe-network.ts'), {
  imports: {
    'three/webgpu': THREE,
    '../render/tsl-materials.ts': { createWireMaterial: () => ({}), WIRE_FADE: 900, blackoutSpans, uBlackouts, BLACKOUT_MAX },
    './cfe-grid.ts': grid,
    './cfe-sparks.ts': { CfeSparks },
    './city-config.ts': { blockAt: () => ({ park: 0 }) },
    './ground.ts': { liftAt: () => 0 },
    './footways.ts': { surfaceY: () => 0 },
    './hash.ts': hash
  },
  filename: 'cfe-network.ts'
});

// Six poles 30 m apart down one curb (x east, the street to the south), strung one to the next, the transformers on
// poles 0 and 4: runs {0, 1, 2} and {3, 4, 5}. The street long enough to cross a 200 m cell
const network = () => {
  const poles = Array.from({ length: 6 }, (_, i) => ({ x: 120 + i * 30, z: 5, g: 0, ux: 1, uz: 0, outX: 0, outZ: 1, across: 10, edge: 0, i }));
  const spans = poles.slice(1).map((p, i) => [poles[i], p]);
  return new CfeNetwork({ add() {} }, new Group(), poles, spans, poles.map((_, i) => i === 0 || i === 4));
};
const vertices = (n) => n.cells.reduce((t, c) => t + (c.mesh.geometry.attributes.position?.count ?? 0), 0);
const camera = { position: { x: 0, z: 0 } };

test("a pole down: its cells strung again without its spans and cables, the others' left as they were", () => {
  const n = network();
  const before = n.cells.map((c) => c.mesh.geometry);
  n.fell(n.poles[2]);
  // the same as a network built with pole 2 already down
  const ref = network();
  ref.down.add(2);
  const expected = ref.cells.reduce((t, c) => t + ref.cellGeometry(c).attributes.position.count, 0);
  assert.equal(vertices(n), expected);
  n.cells.forEach((c, k) => {
    const touched = n.cellsOf[2].includes(k);
    assert.equal(c.mesh.geometry !== before[k], touched, `cell ${k} rebuilt only if pole 2 was strung in it`);
    if (touched) assert.ok(before[k].disposed, 'its old geometry let go');
  });
  assert.ok(n.cells.length > 1, 'the street crosses cells');
});

test('the lines fallen from each neighbour arc where each came down, between it and the fallen pole', () => {
  const n = network();
  n.fell(n.poles[2]);
  const arcs = n.sparks.arcs;
  assert.deepEqual(arcs.map((a) => a.pole).sort(), [1, 3]);
  assert.notEqual(arcs[0].x, arcs[1].x, 'two arcs, not one twice');
  for (const a of arcs) {
    const from = n.poles[a.pole].x, at = n.poles[2].x;
    assert.ok((a.x - from) * (a.x - at) < 0, 'between the pole standing and the one down');
  }
  assert.equal(n.hanging.size, 2);
  // the neighbour falling too: its lines and its arcs go with it
  n.fell(n.poles[3]);
  assert.ok(!n.hanging.has(3) && n.sparks.arcs.every((a) => a.pole !== 3));
});

test('a run goes dark after its flicker; past the stretches the facades take, the oldest has its power back', () => {
  const n = network();
  const calls = [];
  n.lampsOut = (segs, change) => { calls.push([segs.length / 4, change]); };
  n.fell(n.poles[1]); // run {0, 1, 2}: two stretches
  n.update(0.9, camera, null, false); // (flickering)
  assert.ok(calls.length && calls.every(([, c]) => c === 'off' || c === 'on'));
  n.update(1, camera, null, false);
  assert.deepEqual(calls.at(-1), [2, 'cut']);
  assert.equal(uBlackouts.value, 2);
  assert.deepEqual([...n.dark].sort(), [0, 1, 2]);
  n.fell(n.poles[4]); // the transformer of run {3, 4, 5}: two more stretches
  assert.equal(n.sparks.bangs, 1);
  n.update(2, camera, null, false);
  assert.deepEqual(calls.slice(-2), [[2, 'cut'], [2, 'restore']], 'the newest out, the oldest back');
  assert.deepEqual([...n.dark].sort(), [3, 4, 5]);
  assert.equal(uBlackouts.value, 2);
  assert.equal(blackoutSpans.array[0].x, n.poles[3].x, "the facades' stretches are the run out now");
});
