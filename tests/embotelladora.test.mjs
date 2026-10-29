import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { geoToWorld } from '../js/world/geo.ts';
import { GEO } from '../js/world/city-geodata.js';
import {
  SHED, FRONT, ANNEX, OFFICE, DEPOT, STORES, TANKS, CANOPY, GATE, BOOTH, FENCES, LOT, TRUCK_L, TRUCK_W, TRAILER_L,
  plantAt, plantFrame, plantHeading, truckBays, parkTrucks, trailers, inPlant
} from '../js/places/embotelladora/plan.ts';
import { carParks, inCarPark } from '../js/world/parking.ts';
import { onRoadway } from '../js/world/city-config.ts';

// A vehicle's four corners (m) standing at (x, z), facing `heading`
const corners = (x, z, heading, l, w) => {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, s]) => ({ x: x + fx * a * l / 2 + fz * s * w / 2, z: z + fz * a * l / 2 - fx * s * w / 2 }));
};
// Whether (u, v) of the plant's frame lies in a rectangle [u0, u1, v0, v1], grown by `pad` m
const inRect = ([u0, u1, v0, v1], u, v, pad = 0) => u > u0 - pad && u < u1 + pad && v > v0 - pad && v < v1 + pad;
const BUILDINGS = [...SHED, FRONT, ANNEX, OFFICE, DEPOT, ...STORES, CANOPY, ...TANKS.map(([u, v, r]) => [u - r, u + r, v - r, v + r])];

test('the plant\'s frame lies on its OpenStreetMap outline, its block between Insurgentes, Otranto & Hamburgo', () => {
  const o = plantAt(0, 0), [u, v] = plantFrame(o.x, o.z);
  assert.ok(Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9);
  const [ex, ez] = geoToWorld(21.4943811, -104.8826047);
  const [eu, ev] = plantFrame(ex, ez);
  assert.ok(eu > 250 && eu < 260 && Math.abs(ev) < 1e-6, `the corner on Otranto at u ${eu.toFixed(1)}`);
  assert.ok(inPlant(plantAt(128, 100).x, plantAt(128, 100).z));
  // Ley Álica across Otranto, and Insurgentes, lie outside it
  const [lx, lz] = geoToWorld(21.4930, -104.8832);
  assert.ok(!inPlant(lx, lz));
  assert.ok(!inPlant(plantAt(100, -10).x, plantAt(100, -10).z));
  // Overture's footprints in the block (its one box over the whole of it among them) are the plant's, drawn by it
  const stride = GEO.houseStride;
  let inside = 0;
  let big = 0;
  for (let i = 0; i < GEO.houses.length; i += stride) {
    if (!inPlant(GEO.houses[i] / 10, GEO.houses[i + 1] / 10)) continue;
    inside++;
    if (GEO.houses[i + 2] > 1000 && GEO.houses[i + 3] > 1000) big++;
  }
  assert.ok(inside >= 1 && big === 1, `${inside} houses in the block, ${big} over 100 m`);
});

test('the plant stands off the streets: its buildings, walls & fences inside the property lines', () => {
  const lot = LOT.map(([u, v]) => plantAt(u, v));
  for (const p of lot) assert.ok(!onRoadway(p.x, p.z), 'the lot\'s corners off the roadway');
  for (const r of BUILDINGS) {
    for (const [u, v] of [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]]) {
      const p = plantAt(u, v);
      assert.ok(inPlant(p.x, p.z) && !onRoadway(p.x, p.z), `building corner (${u}, ${v}) in the lot`);
    }
  }
  for (const { pts } of FENCES) {
    for (const [u, v] of pts) {
      const p = plantAt(u, v);
      assert.ok(!onRoadway(p.x, p.z), `fence (${u}, ${v}) off the roadway`);
    }
  }
});

test('the walls, fences, gate & buildings close the block all round: every run ends on another or on a wall', () => {
  const [g0, g1, gv] = GATE;
  // what a run may end on: the front's pilasters, the gate (its posts either end), the booth, the depot, the shed
  const walls = [[FRONT[0] - 0.45, FRONT[1] + 0.45, FRONT[2] - 0.7, FRONT[2]], [g0 - 0.5, g1 + 0.5, gv - 0.25, gv + 0.25], BOOTH, DEPOT, ...SHED];
  const reach = 0.35; // m: less than a person's width
  const near = ([u0, u1, v0, v1], [u, v]) => Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1)) < reach;
  FENCES.forEach((run, i) => {
    for (const end of [run.pts[0], run.pts.at(-1)]) {
      const met = FENCES.some((other, j) => j !== i && other.pts.some((p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < reach)) ||
        walls.some((r) => near(r, end));
      assert.ok(met, `run ${i} (${run.kind}) ends open at (${end})`);
    }
  });
  // the gate's posts close up to the fence on one side and the booth on the other
  assert.ok(BOOTH[0] - (g1 + 0.25) < 0.5 && BOOTH[2] < gv);
});

test('the fleet stands on the yard: clear of the buildings, the car park, the streets and each other', () => {
  const lots = carParks(GEO.parking).filter((l) => inPlant((l.minX + l.maxX) / 2, (l.minZ + l.maxZ) / 2));
  assert.equal(lots.length, 1, 'the staff\'s car park');
  const bays = truckBays();
  assert.ok(bays.length >= 50, `${bays.length} bays`);
  const trucks = parkTrucks(bays);
  assert.ok(trucks.length > bays.length / 2 && trucks.length < bays.length);
  assert.deepEqual(parkTrucks(bays), trucks, 'the same ones every load');
  const vehicles = [
    ...bays.map((b) => ({ ...b, l: TRUCK_L, w: TRUCK_W })),
    ...trailers().map((t) => ({ ...t, l: TRAILER_L, w: 2.6 }))
  ];
  assert.ok(vehicles.length > bays.length);
  for (const [i, t] of vehicles.entries()) {
    for (const p of corners(t.x, t.z, t.heading, t.l, t.w)) {
      const [u, v] = plantFrame(p.x, p.z);
      assert.ok(inPlant(p.x, p.z) && !onRoadway(p.x, p.z), `vehicle ${i}: its corner (${u.toFixed(1)}, ${v.toFixed(1)}) on the yard`);
      assert.ok(!lots.some((l) => inCarPark(l, p.x, p.z)), `vehicle ${i}: off the car park`);
      for (const r of BUILDINGS) assert.ok(!inRect(r, u, v, -0.05), `vehicle ${i}: (${u.toFixed(1)}, ${v.toFixed(1)}) clear of ${r}`);
    }
  }
  // no two overlap: their middles further apart, along the frame's u or its v, than their half sizes that way (the
  // trucks face -v, the tráilers ±u)
  const alongU = plantHeading(1, 0);
  const halves = (t) => (Math.abs(Math.sin(t.heading - alongU)) > 0.5 ? [t.w / 2, t.l / 2] : [t.l / 2, t.w / 2]);
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j];
      const [au, av] = plantFrame(a.x, a.z), [bu, bv] = plantFrame(b.x, b.z);
      const [ahu, ahv] = halves(a), [bhu, bhv] = halves(b);
      const apart = Math.abs(au - bu) > ahu + bhu + 0.3 || Math.abs(av - bv) > ahv + bhv + 0.3;
      assert.ok(apart, `vehicles ${i} & ${j} overlap`);
    }
  }
});

test('the plan lays the bays for the route truck the game draws: its size the model\'s', () => {
  const src = readFileSync(new URL('../js/actors/vehicles/route-truck.ts', import.meta.url), 'utf8');
  const m = /ROUTE_TRUCK_SIZE = \{ length: ([\d.]+), width: ([\d.]+)/.exec(src);
  assert.ok(m, 'ROUTE_TRUCK_SIZE in route-truck.ts');
  assert.equal(Number(m[1]), TRUCK_L);
  assert.equal(Number(m[2]), TRUCK_W);
});
