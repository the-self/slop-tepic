import assert from 'node:assert/strict';
import test from 'node:test';
import { placeCrossings, CROSSING_AT_JUNCTION } from '../js/world/crossings.ts';
import { placeStreetCrossings, mayCrossStreet, crossingBrake } from '../js/sim/traffic/crossings.ts';
import { GEO } from '../js/world/city-geodata.js';

// A two-way street 10 m wide east along z = 0, its stop lines 6 m in from the junctions at x = 0 and x = 100: one edge
// each way, 88 m between the stop lines; and a one-way street north along x = 300
function roads() {
  const node = (x, z, signal = false) => ({ x, z, signal, in: [], out: [] });
  const A = node(0, 0), B = node(100, 0, true), C = node(300, 0), D = node(300, -100);
  const edge = (from, to, sx, sz, dx, dz, len, half, axisIndex = 0) => {
    const e = { from, to, sx, sz, dx, dz, rx: -dz, rz: dx, len, half, lift: null, axisIndex, occ: [[]], crossings: [] };
    from.out.push(e);
    to.in.push(e);
    return e;
  };
  const ab = edge(A, B, 6, 0, 1, 0, 88, 5), ba = edge(B, A, 94, 0, -1, 0, 88, 5, 1);
  const cd = edge(C, D, 300, -6, 0, -1, 88, 4);
  return { A, B, ab, ba, cd, edges: [ab, ba, cd] };
}

test('a mapped crossing is taken onto the edge whose roadway it stands in, kept inside its stop lines', () => {
  const { ab, ba, cd, edges } = roads();
  const placed = placeCrossings([50, 1, 1, 2, -0.5, 0, 300.5, -60, 2, 50, 30, 1, 500, 500, 1], edges);
  assert.equal(placed.length, 3); // (the one 30 m off the street and the one far away: on none)
  const [mid, corner, oneWay] = placed;
  assert.ok(mid.edge === ab || mid.edge === ba);
  assert.equal(mid.kind, 1);
  // in the junction's crosswalk, 4 m before the stop line: taken on the middle of it
  assert.equal(corner.kind, 0);
  assert.equal(corner.edge === ab ? corner.s : corner.edge.len - corner.s, -CROSSING_AT_JUNCTION);
  assert.ok(corner.raw < 0 || corner.raw > corner.edge.len);
  assert.equal(oneWay.edge, cd);
  assert.equal(oneWay.kind, 2);
  assert.ok(Math.abs(oneWay.s - 54) < 1e-9);
});

test('a crossing knows its road both ways and the lights of the junction whose crosswalk it is', () => {
  const { ab, ba, edges } = roads();
  const [mid, near] = placeStreetCrossings([50, 0, 1, 97, 0, 0], edges);
  assert.ok(mid.back === (mid.edge === ab ? ba : ab));
  assert.ok(Math.abs(mid.s + mid.bs - 88) < 1e-9);
  assert.equal(mid.signal, false);
  // 3 m from the signalled junction B: with its lights
  assert.equal(near.signal, true);
  // each edge lists its crossings in order along it
  for (const e of [ab, ba]) {
    assert.equal(e.crossings.length, 2);
    assert.ok(e.crossings[0].s <= e.crossings[1].s);
  }
});

test('people step off at a zebra once the traffic can stop, at an unmarked one only in a gap, at lights on the WALK', () => {
  const { edges, ab } = roads();
  const [zebra, unmarked, lit] = placeStreetCrossings([30, 0, 1, 60, 0, 0, 80, 0, 2], edges);
  const ts = { stWalk: false, aveWalk: false };
  const p = { speed: 1.3, cross: zebra };
  assert.ok(mayCrossStreet(ts, p), 'an empty road');
  // a car on ab 40 m before the zebra at 12 m/s: it could stop comfortably, so they go
  const car = { half: 2.2, speed: 12 };
  const placeCar = (c, d) => { const e = c.edge === ab ? ab : c.back; e.occ[0] = [{ v: car, s: (e === c.edge ? c.s : c.bs) - 2.5 - car.half - d }]; };
  placeCar(zebra, 40);
  assert.ok(mayCrossStreet(ts, p));
  // ...but at 20 m/s it couldn't
  car.speed = 20;
  assert.ok(!mayCrossStreet(ts, p));
  // at the unmarked one, the same car 40 m off at 12 m/s arrives in 3.3 s: too soon to get over 10 m first
  car.speed = 12;
  ab.occ[0] = [];
  if (unmarked.back) unmarked.back.occ[0] = [];
  placeCar(unmarked, 40);
  assert.ok(!mayCrossStreet(ts, { speed: 1.3, cross: unmarked }));
  placeCar(unmarked, 200);
  assert.ok(mayCrossStreet(ts, { speed: 1.3, cross: unmarked }));
  // the lights: only on the WALK of the road's group
  for (const e of edges) e.occ[0] = [];
  const atLights = { speed: 1.3, cross: lit };
  assert.ok(!mayCrossStreet(ts, atLights));
  if (lit.group === 0) ts.stWalk = true; else ts.aveWalk = true;
  assert.ok(mayCrossStreet(ts, atLights));
});

test('a vehicle stops short of a crossing with someone out on it, and drives on over an empty one', () => {
  const { edges, ab } = roads();
  const [c] = placeStreetCrossings([50, 0, 1], edges);
  const s = c.edge === ab ? c.s : c.bs;
  const v = { edge: ab, conn: null, s: s - 30, half: 2.2, speed: 10, driver: { a: 1.5, b: 2, T: 1.2, s0: 2 }, desired: 14 };
  const ts = { roadGrip: 1, headway: 1, caution: 1 };
  assert.equal(crossingBrake(ts, v), 0);
  c.walkers.push({});
  assert.ok(crossingBrake(ts, v) < -1);
  // once past it, no more
  v.s = s + 5;
  assert.equal(crossingBrake(ts, v), 0);
});

test('a vehicle turning through an intersection stops short of a crossing just round the corner', () => {
  const { edges, ab, ba } = roads();
  // a crossing 4 m into ab, and a car on the curve into it, 6 m from its end
  const [c] = placeStreetCrossings([10, 1, 1], edges);
  assert.ok(c.edge === ab || c.back === ab);
  const v = { edge: ba, conn: { len: 12 }, cs: 6, move: { to: ab }, s: 0, half: 2.2, speed: 5, driver: { a: 1.5, b: 2, T: 1.2, s0: 2 }, desired: 14 };
  const ts = { roadGrip: 1, headway: 1, caution: 1 };
  assert.equal(crossingBrake(ts, v), 0);
  c.walkers.push({});
  assert.ok(crossingBrake(ts, v) < -1);
  // ...and someone stepping off there sees it coming: claim() puts it in ab's lane, short of its start
  c.walkers.length = 0;
  ab.occ[0] = [{ v, s: v.cs - v.conn.len }];
  ba.occ[0] = [];
  assert.ok(!mayCrossStreet({ stWalk: true, aveWalk: true }, { speed: 1.3, cross: c }));
});

test('Tepic\'s mapped crossings: most on the streets, the marked ones as zebras', () => {
  const n = GEO.crossings.length / 3;
  assert.ok(n > 300);
  let marked = 0;
  for (let k = 2; k < GEO.crossings.length; k += 3) if (GEO.crossings[k] === 1) marked++;
  assert.ok(marked > 150);
});
