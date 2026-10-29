import assert from 'node:assert/strict';
import test from 'node:test';
import { planTopes, topeBumps } from '../js/world/topes.ts';
import { placeTopes, topeCap, topeJolt } from '../js/sim/traffic/topes.ts';

// Two-way residential streets east along z = 0 and z = 1000, 100 m between their corners: the paint's edges (each road
// both ways) with node ids picked so the guess gives each road its topes
function streets() {
  const edges = [];
  let id = 0;
  for (const z of [0, 1000]) {
    const a = { id: id++, x: 0, z, shape: false }, b = { id: id++, x: 100, z, shape: false };
    const mk = (from, to, sx, dx) => ({ from, to, axis: 'st', lift: null, sx, sz: z, dx, dz: 0, rx: 0, rz: dx, len: 88, half: 4, x0: from.x, z0: z, span: 100, lanes: [2] });
    edges.push(mk(a, b, 6, 1), mk(b, a, 94, -1));
  }
  return edges;
}

test('a mapped tope is drawn where it is, and none is guessed near it; elsewhere the streets get theirs', () => {
  const edges = streets();
  const guessed = planTopes(edges, []);
  const road = (t) => (t.z === 0 ? 0 : 1);
  // (with the ids above, whether a road gets guessed topes is fixed: find one that does)
  const withGuess = new Set(guessed.map(road));
  assert.ok(withGuess.size > 0, 'some street has a guessed tope');
  const r = [...withGuess][0];
  const z = r === 0 ? 0 : 1000;
  const topes = planTopes(edges, [55, z + 1, 0]);
  const mapped = topes.filter((t) => t.mapped);
  assert.equal(mapped.length, 1);
  assert.ok(Math.abs(mapped[0].x - 55) < 1e-9 && Math.abs(mapped[0].z - z) < 1e-9, 'where it is mapped, on the street\'s centre line');
  assert.ok(!topes.some((t) => !t.mapped && road(t) === r), 'no guessed one on its street');
});

test('the traffic eases off to cross a tope at a crawl, on either edge of its road', () => {
  const edges = streets().map((e) => ({ ...e, topes: [] }));
  for (const e of edges) { e.from.out ??= []; e.from.out.push(e); }
  placeTopes([{ x: 50, z: 0, dx: 1, dz: 0, rx: 0, rz: 1, half: 4, mapped: true }], edges);
  const [ab, ba] = edges;
  assert.deepEqual(ab.topes, [44]);
  assert.deepEqual(ba.topes, [44]);
  const v = { conn: null, edge: ab, s: 0, half: 2.2 };
  const far = topeCap(v);
  v.s = 30;
  const near = topeCap(v);
  v.s = 42;
  const over = topeCap(v);
  assert.ok(far > near && near > over, `${far} > ${near} > ${over}`);
  assert.ok(over < 2, 'about 6 km/h over it');
  v.s = 39; // (its front 2.8 m short of it: down to a crawl already)
  assert.ok(topeCap(v) < 2, `${topeCap(v)}`);
  v.s = 50;
  assert.equal(topeCap(v), Infinity, 'once past it');
  // turning in through the junction, 5 m of its curve still to go: already easing off for the tope ahead
  const turning = { conn: { len: 12 }, cs: 7, move: { to: ab }, half: 2.2 };
  assert.ok(topeCap(turning) < 15, `${topeCap(turning)}`);
});

test('a car of the traffic bucks as each axle rolls over a tope: the nose up, then down', () => {
  // (where it is once moved 1.5 m: its front axle from 42.8 to 44.3, over it)
  const v = { conn: null, edge: { topes: [44], topeOver: [1.6] }, s: 43, axle: 1.3, speed: 1.6, pitchVel: 0 };
  topeJolt(v, 1.5);
  assert.ok(v.pitchVel < 0, `${v.pitchVel}`); // (the nose up is negative)
  v.pitchVel = 0;
  v.s = 44.6;
  topeJolt(v, 1.5); // (its rear axle from 41.8 to 43.3: not yet)
  assert.equal(v.pitchVel, 0);
  v.s = 46;
  topeJolt(v, 1.5); // (and now)
  assert.ok(v.pitchVel > 0);
});

test("the player's car rides a tope's hump: 12 cm high in the middle of the street, nothing off it", () => {
  const bump = topeBumps([{ x: 50, z: 0, dx: 1, dz: 0, rx: 0, rz: 1, half: 4, mapped: true, boyas: false }]);
  assert.ok(Math.abs(bump(50, 0) - 0.12) < 1e-9);
  assert.ok(bump(50.2, 3) > 0.05 && bump(50.2, 3) < 0.12);
  assert.equal(bump(51, 0), 0);
  assert.equal(bump(50, 4.5), 0);
});

test('a rumble strip OpenStreetMap maps is a row of boyas: lower, crossed quicker, rattling rather than throwing', () => {
  const edges = streets().map((e) => ({ ...e, topes: [], topeOver: [] }));
  for (const e of edges) { e.from.out ??= []; e.from.out.push(e); }
  const [row] = planTopes(edges, [50, 0, 3]);
  assert.equal(row.boyas, true);
  assert.ok(Math.abs(topeBumps([row])(row.x, row.z) - 0.05) < 1e-9);
  placeTopes([row], edges);
  const [ab] = edges;
  assert.ok(ab.topeOver[0] > 4, 'about 15 km/h over them');
  const v = { conn: null, edge: ab, s: ab.topes[0] - 2.2, half: 2.2 };
  assert.ok(topeCap(v) > 4);
});
