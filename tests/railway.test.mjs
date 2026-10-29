import assert from 'node:assert/strict';
import test from 'node:test';
import { chainMainLine, findLevelCrossings, mainLine, levelCrossings, railPoint, nearestOnLine, RAIL_ENVELOPE } from '../js/world/railway.ts';
import { trainRun, runsAt, headAt, onLine, summonRun, closes, hornOn, aheadOf, TRAIN_PERIOD } from '../js/sim/trains/schedule.ts';
import { poseCar, RAIL_TOP } from '../js/sim/trains/poses.ts';
import { placeRailCrossings, railBrake, railCap, railHold } from '../js/sim/traffic/rail-crossings.ts';
import { RAIL_CARS } from '../js/models/trains.ts';

// A line north from (0, 1000) to (0, -1000) in two pieces, the second one mapped backwards, and a siding beside it
const RAILS = [
  [[0, 1000, 0, 0], 0, 0, 1],
  [[0, -1000, 0, -500, 0, 0], 0, 0, 1],
  [[5, 200, 5, -200], 0, 0, 0]
];

test('the main line is chained from its south-eastern end, its sidings left out', () => {
  const line = chainMainLine(RAILS);
  assert.ok(line);
  assert.equal(line.length, 2000);
  assert.deepEqual([line.xs[0], line.zs[0]], [0, 1000]);
  assert.deepEqual([line.xs.at(-1), line.zs.at(-1)], [0, -1000]);
  const p = railPoint(line, 1250, { x: 0, z: 0, dx: 0, dz: 0 });
  assert.deepEqual([p.x, p.z, p.dx, p.dz], [0, -250, 0, -1]);
  const near = nearestOnLine(line, 30, -100);
  assert.equal(Math.round(near.s), 1100);
  assert.equal(Math.round(near.d), 30);
});

test("Tepic's main line runs across the map, and its level crossings lie along it", () => {
  const line = mainLine();
  assert.ok(line && line.length > 20000, 'over 20 km of main line');
  const crossings = levelCrossings();
  assert.ok(crossings.length >= 10, `${crossings.length} level crossings`);
  for (let i = 1; i < crossings.length; i++) assert.ok(crossings[i].s >= crossings[i - 1].s, 'in order along the line');
  for (const c of crossings) assert.ok(c.clear >= RAIL_ENVELOPE, 'traffic stops out of the train\'s way');
});

test('a road crosses the line at grade; a bridge over it, or a road lifted over it, does not; one met at a node is one', () => {
  const line = chainMainLine(RAILS);
  // nodes: a street west-east at z = 0 (split at the rails), a bridge at z = 300, a ramp lifted at z = -300
  const nodes = [-50, 0, 0, 0, 50, 0, -50, 300, 50, 300, -50, -300, 50, -300];
  const link = (a, b, width, lifts, way) => [a, b, 0, width, 2, 'TW', [], lifts, way, 0];
  const crossings = findLevelCrossings(line, nodes, [
    link(0, 1, 8, 0, 0), link(1, 2, 10, 0, 0), link(3, 4, 8, 0, 1), link(5, 6, 8, [60, 60], 0)
  ]);
  assert.equal(crossings.length, 1);
  const [c] = crossings;
  assert.deepEqual([c.x, c.z, c.s], [0, 0, 1000]);
  assert.equal(c.half, 5, 'the wider of the two links');
  assert.ok(Math.abs(c.clear - RAIL_ENVELOPE) < 1e-9, 'square across: just the envelope');
});

test('trains run in fleets: none meets another head on, nor catches up with the one ahead', () => {
  const L = 26584, cache = new Map(), out = [];
  const t0 = 1.8e9;
  for (let t = t0; t < t0 + 3 * 86400; t += 20) {
    runsAt(t, L, cache, out);
    assert.ok(new Set(out.map((r) => r.dir)).size <= 1, `two ways at once at ${t}`);
    const byHead = out.map((r) => ({ r, head: headAt(r, t, L) })).sort((a, b) => (a.head - b.head) * a.r.dir);
    for (let i = 1; i < byHead.length; i++) {
      const behind = byHead[i - 1], ahead = byHead[i];
      assert.ok((ahead.head - behind.head) * ahead.r.dir > ahead.r.length, 'a train clear of the one ahead');
    }
  }
  // (and they do run: a fleet is out about half the time)
  let busy = 0;
  for (let t = t0; t < t0 + 86400; t += 60) busy += runsAt(t, L, cache, out).length ? 1 : 0;
  assert.ok(busy > 400 && busy < 1200, `${busy} of 1440 minutes with a train out`);
});

test('a train is the same train for everyone: drawn from its number', () => {
  const a = trainRun(123456), b = trainRun(123456);
  assert.deepEqual(a, b);
  assert.ok(a.cars[0].kind === 'loco' && a.cars[1].kind === 'loco', 'two or three diesels at its head');
  assert.ok(a.cars.length >= 27 && a.cars.length <= 58);
  const total = a.cars.reduce((sum, c) => sum + RAIL_CARS[c.kind].length, 0);
  assert.ok(Math.abs(total - a.length) < 1e-9);
  assert.equal(a.cars[1].at, RAIL_CARS.loco.length * 1.5, "each car's middle, back from the head");
});

test('a crossing closes half a minute before the head and opens once the tail is past; the horn blows as it comes up', () => {
  const r = { ...trainRun(7), dir: 1, speed: 10, t0: 0 };
  const L = 20000, s = 5000;
  // (the head at s at t = 500)
  assert.equal(closes(r, headAt(r, 460, L), s), false);
  assert.equal(closes(r, headAt(r, 480, L), s), true);
  assert.equal(closes(r, headAt(r, 500 + r.length / 10, L), s), true);
  assert.equal(closes(r, headAt(r, 502 + r.length / 10, L), s), false);
  assert.equal(aheadOf(r, headAt(r, 490, L), s), 100);
  // long, long, short, long
  const pattern = [];
  for (let tau = 15.9; tau > 0; tau -= 0.5) pattern.push(hornOn(tau) ? 1 : 0);
  assert.deepEqual(pattern.join(''), '00111111001111110011011111111111');
  assert.equal(hornOn(30), false);
});

test('a summoned train gets to its spot when asked, whichever way it runs', () => {
  for (const seed of [4, 5]) {
    const r = summonRun(-1, seed, 3000, 1000, 10000, 40);
    assert.ok(Math.abs(headAt(r, 1040, 10000) - 3000) < 1e-6);
    assert.ok(onLine(r, 1040, 10000));
  }
});

test("a car stands with its trucks on the rails, its middle where the run puts it, turned the run's way", () => {
  const line = chainMainLine(RAILS);
  const r = { ...trainRun(9), dir: 1, speed: 10, t0: 0 };
  const out = {};
  assert.ok(poseCar(line, r, 0, 500, () => 100, out));
  assert.deepEqual([out.x, Math.round(out.z * 1000) / 1000, out.y], [0, 1000 - (500 - RAIL_CARS.loco.length / 2), 100 + RAIL_TOP]);
  assert.ok(Math.abs(out.yaw - Math.PI) < 1e-9, 'heading north (-z)');
  assert.deepEqual([Math.round(out.vx * 1e9) / 1e9, out.vz], [0, -10]);
  // (a car not yet on the line)
  assert.equal(poseCar(line, r, r.cars.length - 1, 50, () => 0, out), false);
});

test('the traffic stops short of a closed crossing, eases over the rails when open; people wait short of the track', () => {
  // an edge east along z = 0 from x = 0, 100 m, crossing the line (north-south at x = 60)
  const crossing = { x: 60, z: 0, s: 1000, rx: 1, rz: 0, half: 4, tx: 0, tz: -1, clear: RAIL_ENVELOPE };
  const edge = { sx: 0, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 100, half: 4, lift: null, rails: [] };
  assert.equal(placeRailCrossings([crossing], [edge]), 1);
  assert.equal(edge.rails[0].s, 60);
  assert.ok(edge.rails[0].stop < 60 - RAIL_ENVELOPE, 'stops further back than the train sweeps');
  const v = { edge, conn: null, s: 30, half: 2.2, speed: 10, v0: 14, driver: { a: 1.5, b: 3, s0: 2, T: 1.4 } };
  const ts = { railClosed: [false], railCrossings: [crossing], headway: 1, caution: 1 };
  assert.equal(railBrake(ts, v), 0);
  ts.railClosed[0] = true;
  assert.ok(railBrake(ts, v) < -1, 'brakes for it');
  v.s = 55; // (past the gate: clearing it)
  assert.equal(railBrake(ts, v), 0);
  v.s = 30;
  assert.ok(railCap(v) < 14 && railCap(v) > 5);
  v.s = 80;
  assert.equal(railCap(v), Infinity);
  // someone walking east along the sidewalk up to the track, and someone on it stepping off
  assert.equal(railHold(ts, 56.3, 6, 56.6, 6), true);
  assert.equal(railHold(ts, 58, 6, 57.5, 6), false);
  ts.railClosed[0] = false;
  assert.equal(railHold(ts, 56.3, 6, 56.6, 6), false);
});

test('trains come every PERIOD or so', () => {
  assert.ok(TRAIN_PERIOD >= 10 * 60 && TRAIN_PERIOD <= 30 * 60);
});
