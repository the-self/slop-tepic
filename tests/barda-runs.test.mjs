import assert from 'node:assert/strict';
import test from 'node:test';
import { bardaRuns, MIN_RUN, MAX_RUN } from '../js/world/barda-runs.ts';
import { indexHouses } from '../js/world/lot-greenery.ts';

// A curb island (x, z in m) as barda-runs reads it
const square = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const block = (id, x0, z0, x1, z1, extra = {}) => ({ id, poly: square(x0, z0, x1, z1), area: (x1 - x0) * (z1 - z0), park: 0, rural: false, median: false, ...extra });
const none = () => 99;

test('a big open plot is walled all round its property line, a portón in it', () => {
  const runs = bardaRuns([block(0, 0, 0, 100, 80)], none, { sidewalk: 2 });
  assert.equal(runs.length, 1);
  const [r] = runs;
  for (const p of r.pts) {
    // on the property line, 2 m in from the curb
    const d = Math.min(p.x, 100 - p.x, p.z, 80 - p.z);
    assert.ok(Math.abs(d - 2) < 1e-9, `${p.x}, ${p.z}`);
  }
  assert.ok(r.gate >= 0 && r.gate < r.pts.length);
  for (const [i, n] of r.inward.entries()) {
    // the way in points into the plot
    const p = r.pts[i];
    assert.ok(Math.min(p.x + n.x, 100 - p.x - n.x, p.z + n.z, 80 - p.z - n.z) > 2);
  }
});

test('no barda across a row of houses, a car park, a park, a field or a camellón', () => {
  // houses all along the north side of a 100 x 80 m block (x, z, w, d in dm, θ in mrad...)
  const houses = [];
  for (let x = 5; x < 100; x += 10) houses.push(x * 10, 80, 90, 100, 0, 1, 0, 0);
  const walls = indexHouses(houses, 8);
  const runs = bardaRuns([block(0, 0, 0, 100, 80)], walls.wallDistance, { sidewalk: 2 });
  for (const r of runs) for (const p of r.pts) assert.ok(p.z > 20 || p.x < 1 || p.x > 99, `a wall in front of the houses at ${p.x}, ${p.z}`);
  // the south side a car park: open to the street
  const lot = (_x, z) => z > 55;
  for (const r of bardaRuns([block(0, 0, 0, 100, 80)], none, { sidewalk: 2, keepOpen: lot })) for (const p of r.pts) assert.ok(p.z < 60);
  for (const extra of [{ park: 1 }, { rural: true }, { median: true }]) assert.deepEqual(bardaRuns([block(0, 0, 0, 100, 80, extra)], none), []);
  assert.deepEqual(bardaRuns([block(7, 0, 0, 100, 80)], none, { skip: new Set([7]) }), []);
});

test('a short gap between houses or a field is not walled', () => {
  // only a 20 m stretch open: shorter than a plot
  assert.ok(MIN_RUN > 20);
  const walls = (x) => (x > 40 && x < 60 ? 99 : 0);
  assert.deepEqual(bardaRuns([block(0, 0, 0, 100, 100)], walls, { sidewalk: 2 }).filter((r) => r.pts.length > 3), []);
  // a whole open block 300 x 300 m: a field, past MAX_RUN round
  assert.ok(MAX_RUN < 1200);
  assert.deepEqual(bardaRuns([block(0, 0, 0, 300, 300)], none), []);
});
