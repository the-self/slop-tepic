import assert from 'node:assert/strict';
import test from 'node:test';
import { extrapolate } from '../js/net/motion.ts';

const pose = (t, x, z, heading = 0, speed = 0) => ({ t, x, y: 0, z, heading, speed });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('past its last pose a player goes on as its last two poses moved: sidestep, slide and all', () => {
  const out = { x: 0, z: 0 };
  // a walker stepping sideways (+x) while it faces +z, so its own speed says 0: 3 m over the 300 ms between them
  extrapolate(pose(0, 0, 0, 0, 0), pose(300, 3, 0, 0, 0), 0.2, 100, false, out);
  assert.ok(near(out.x, 5) && near(out.z, 0), `${out.x}, ${out.z}`);
  // a car sliding: its heading says +z, its poses show it going +x too
  extrapolate(pose(0, 0, 0, 0, 10), pose(100, 1, 1, 0, 10), 0.1, 100, true, out);
  assert.ok(near(out.x, 2) && near(out.z, 2));
});

test('the ticks between two poses are counted whole: bunched or spread packets give the speed they were sent at', () => {
  const out = { x: 0, z: 0 };
  // two poses a tick apart (1 m) that arrived 10 ms apart: still 10 m/s, not 100
  extrapolate(pose(0, 0, 0), pose(10, 1, 0, 0, 10), 0.1, 100, true, out);
  assert.ok(near(out.x, 2));
  // three ticks apart (3 m), arriving 340 ms apart: still 10 m/s
  extrapolate(pose(0, 0, 0), pose(340, 3, 0, 0, 10), 0.1, 100, true, out);
  assert.ok(near(out.x, 4));
});

test('a vehicle that stopped stays put; one pose alone goes along its heading at its speed; none past nothing', () => {
  const out = { x: 0, z: 0 };
  extrapolate(pose(0, 0, 0, 0, 10), pose(100, 1, 0, 0, 0), 0.3, 100, true, out);
  assert.deepEqual(out, { x: 1, z: 0 }, 'its last step was its braking');
  extrapolate(undefined, pose(0, 5, 5, Math.PI / 2, 4), 0.5, 100, true, out);
  assert.ok(near(out.x, 7) && near(out.z, 5), 'heading π/2 is +x');
  extrapolate(pose(0, 0, 0), pose(100, 1, 0, 0, 10), 0, 100, true, out);
  assert.deepEqual(out, { x: 1, z: 0 });
});
