import assert from 'node:assert/strict';
import test from 'node:test';
import { cfeCircuits, poleOutage, outageSegments, fallenLine } from '../js/world/cfe-grid.ts';

// A street of 12 poles 30 m apart along x, strung one to the next, with transformers on poles 2 and 8; and a short
// side street of 2 poles (12, 13) strung to pole 5, and a lone pair (14, 15) strung to nothing else
const poles = [...Array.from({ length: 12 }, (_, i) => ({ x: i * 30, z: 0 })), { x: 150, z: 30 }, { x: 150, z: 60 }, { x: 900, z: 0 }, { x: 930, z: 0 }];
const spans = [...Array.from({ length: 11 }, (_, i) => [i, i + 1]), [5, 12], [12, 13], [14, 15]];
const transformer = poles.map((_, i) => i === 2 || i === 8);
const c = cfeCircuits(poles.length, spans, transformer);

test('each pole is fed by the transformer the fewest spans away', () => {
  assert.deepEqual(Array.from(c.run.subarray(0, 12)), [2, 2, 2, 2, 2, 2, 8, 8, 8, 8, 8, 8]);
  assert.equal(c.run[12], 2, 'the side street off pole 5 hangs on its transformer');
  assert.equal(c.run[13], 2);
  assert.equal(c.run[14], c.run[15], 'poles strung to no transformer make a run of their own');
  assert.notEqual(c.run[14], 2);
});

test('a pole knocked down puts out its own run only', () => {
  const out = poleOutage(c, 4).sort((a, b) => a - b);
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 12, 13]);
  assert.deepEqual(poleOutage(c, 10).sort((a, b) => a - b), [6, 7, 8, 9, 10, 11]);
});

test("a transformer's pole takes the runs strung to its run with it", () => {
  const out = poleOutage(c, 2).sort((a, b) => a - b);
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.ok(!out.includes(14), 'but not a run strung to none of them');
});

test('the stretches without power are the spans between dark poles, a lone pole as a point', () => {
  const segs = outageSegments(c, [6, 7, 8], (i) => poles[i]);
  assert.deepEqual(segs, [180, 0, 210, 0, 210, 0, 240, 0]);
  assert.deepEqual(outageSegments(c, [3], (i) => poles[i]), [90, 0, 90, 0]);
});

test('a fallen line hangs from its pole to the ground and lies along it to where the pole stood', () => {
  const ground = (x) => 1 + x * 0.01; // a gentle slope
  const pts = fallenLine({ x: 0, y: 11.8, z: 0 }, { x: 30, z: 0 }, 9, ground, 14, 0.03);
  assert.equal(pts.length % 3, 0);
  assert.deepEqual(pts.slice(0, 3), [0, 11.8, 0], 'from the insulator still on its pole');
  const last = pts.slice(-3);
  assert.ok(Math.abs(last[0] - 30) < 1e-9 && Math.abs(last[1] - (ground(30) + 0.03)) < 1e-9, 'to the fallen pole, on the ground');
  for (let k = 0; k < pts.length; k += 3) {
    assert.ok(pts[k + 1] >= ground(pts[k]) + 0.03 - 1e-9, 'never under the ground');
    if (k && pts[k] <= 9) assert.ok(pts[k + 1] <= pts[k - 2] + 1e-9, 'hanging, it falls all the way to the touchdown');
    if (k) assert.ok(pts[k] > pts[k - 3], 'on along the street');
  }
  // past the touchdown it lies on the ground
  const lying = [];
  for (let k = 0; k < pts.length; k += 3) if (pts[k] >= 9) lying.push(pts[k + 1] - ground(pts[k]));
  assert.ok(lying.length > 3 && lying.every((h) => Math.abs(h - 0.03) < 1e-9));
});
