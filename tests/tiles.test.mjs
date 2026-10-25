import assert from 'node:assert/strict';
import test from 'node:test';
import { createTileGrid, bucketTriangles, drapeTile } from '../js/world/tiles.js';
import { clipToRect } from '../js/world/lattice.js';

// A 10 m lattice from (-5, -5): tiles of 4 cells, 40 m a side
const lattice = { x0: -5, z0: -5, cell: 10 };
const grid = createTileGrid(lattice, 4);
const floor = (x, z) => 100 + 0.1 * x + 0.05 * z;

// Area (in x & z) of non-indexed triangles
function area(pos) {
  let a = 0;
  for (let t = 0; t < pos.length; t += 9) a += Math.abs((pos[t + 3] - pos[t]) * (pos[t + 8] - pos[t + 2]) - (pos[t + 6] - pos[t]) * (pos[t + 5] - pos[t + 2])) / 2;
  return a;
}

test('tiles are keyed by one integer each way round, their edges on the lattice', () => {
  assert.equal(grid.size, 40);
  for (const [i, j] of [[0, 0], [-3, 7], [120, -45]]) {
    const k = grid.key(i, j);
    assert.deepEqual([grid.i(k), grid.j(k)], [i, j]);
  }
  assert.equal(grid.keyAt(-5, -5), grid.key(0, 0));
  assert.equal(grid.keyAt(34.9, 0), grid.key(0, 0));
  assert.equal(grid.keyAt(35, 0), grid.key(1, 0));
  assert.equal(grid.keyAt(-6, -46), grid.key(-1, -2));
  assert.deepEqual(grid.rect(grid.key(1, -1)), { x0: 35, x1: 75, z0: -45, z1: -5 });
  // the flat city's tiles, without a lattice
  assert.equal(createTileGrid(null).size, 450);
});

test('a layer spread over several tiles is cut on their edges: every piece in its tile, none twice, none lost', () => {
  // a big slab (two triangles, 130 x 90 m) and a small one inside the first tile, both facing up; one facing down
  const position = new Float32Array([
    -20, 0.2, -10, 110, 0.2, 80, 110, 0.2, -10,
    -20, 0.2, -10, -20, 0.2, 80, 110, 0.2, 80,
    0, 0.2, 0, 10, 0.2, 10, 10, 0.2, 0,
    0, 0, 0, 10, 0, 0, 10, 0, 10
  ]);
  const uv = new Float32Array(position.length / 3 * 2).map((_, i) => i % 2);
  const normal = new Float32Array(position.length).map((_, i) => (i % 3 === 1 ? (i < 27 ? 1 : -1) : 0));
  const layer = { arrays: [position, normal, uv], sizes: [3, 3, 2], index: null, normalAt: 1 };
  const buckets = bucketTriangles(position, null, grid, { undersides: false });
  // the big slab spans tiles -1..2 east & -1..2 south of the lattice's origin tile
  assert.equal(buckets.size, 4 * 4);
  assert.ok(![...buckets.values()].some((tris) => tris.includes(3)), 'the underside is left out');
  let total = 0;
  for (const [k, tris] of buckets) {
    const out = drapeTile(layer, tris, k, grid, lattice, floor);
    if (!out) continue;
    const [p, n] = out;
    const r = grid.rect(k);
    for (let v = 0; v < p.length; v += 3) {
      assert.ok(p[v] >= r.x0 - 1e-4 && p[v] <= r.x1 + 1e-4 && p[v + 2] >= r.z0 - 1e-4 && p[v + 2] <= r.z1 + 1e-4, 'inside its tile');
      assert.ok(Math.abs(p[v + 1] - (0.2 + floor(p[v], p[v + 2]))) < 1e-3, 'on the floor');
    }
    for (let v = 0; v < n.length; v += 3) assert.ok(n[v + 1] > 0.99 && n[v] < 0, 'tilted with the slope (it rises east)');
    total += area(p);
  }
  assert.ok(Math.abs(total - (130 * 90 + 50)) < 0.05, `all of it, once: ${total}`);
  // a tile none of it reaches
  assert.equal(drapeTile(layer, buckets.get(grid.key(9, 9)), grid.key(9, 9), grid, lattice, floor), null);
  // the flat city: cut on the edges only, left at its height
  const k = grid.key(0, 0);
  const [flat] = drapeTile(layer, buckets.get(k), k, grid, null, floor);
  assert.ok(flat.every((v, i) => i % 3 !== 1 || v === Math.fround(0.2)));
});

test('a triangle wholly inside the rectangle goes through as it is; the rest is cut on its edges', () => {
  const pos = new Float32Array([1, 0, 1, 2, 0, 1, 1, 0, 2, -10, 0, 0, 10, 0, 0, 0, 0, 10]);
  const [p] = clipToRect([pos], [3], null, { x0: 0, x1: 5, z0: 0, z1: 5 });
  assert.deepEqual([...p.slice(0, 9)], [1, 0, 1, 2, 0, 1, 1, 0, 2]);
  // the big one covers all of the rectangle: its part is the 5 x 5 square
  assert.ok(Math.abs(area(p) - 0.5 - 25) < 1e-4);
});
