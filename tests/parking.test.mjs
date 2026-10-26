import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import { carParks, inCarPark, inMouth, layStalls, parkCars, STALL_W, STALL_D, AISLE } from '../js/world/parking.ts';
import { indexHouses } from '../js/world/lot-greenery.ts';

// A lot as the geodata gives it: [name, surface, θ (mrad), flat ring]
const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];

test('stalls fill a lot in rows along its long side, back to back across aisles', () => {
  const [lot] = carParks([['Prueba', 0, 0, rect(0, 0, 80, 40), []]]);
  assert.equal(lot.area, 3200);
  const stalls = layStalls(lot);
  // θ = 0: the rows run along x; across 40 m fit two pairs of rows (2 × 16.8 m) and their aisles
  const rows = new Set(stalls.map((s) => Math.round(s.z * 10)));
  assert.equal(rows.size, 4);
  const perRow = Math.floor((80 - 0.8) / STALL_W);
  assert.equal(stalls.length, 4 * perRow);
  for (const s of stalls) {
    assert.ok(inCarPark(lot, s.x, s.z));
    // the nose square to the rows: ±z
    assert.ok(Math.abs(Math.sin(s.heading)) < 1e-9);
  }
  // each pair of rows faces its aisle: the first row's noses point +z, the second's -z, AISLE m apart at the noses
  const zs = [...rows].sort((a, b) => a - b).map((z) => z / 10);
  assert.ok(Math.abs(zs[1] - zs[0] - (STALL_D + AISLE)) < 0.11);
  assert.ok(Math.abs(zs[2] - zs[1] - STALL_D) < 0.11, 'back to back');
  // one line between two stalls: the last of a row paints its far side too
  const row0 = stalls.filter((s) => Math.round(s.z * 10) === zs[0] * 10);
  assert.equal(row0.filter((s) => s.lineB).length, 1);
});

test('a lot turned off the grid keeps its rows along its own sides', () => {
  const th = 0.5; // the rows along (cos θ, -sin θ)
  const ux = Math.cos(th), uz = -Math.sin(th), vx = Math.sin(th), vz = Math.cos(th);
  const at = (u, v) => [u * ux + v * vx, u * uz + v * vz];
  const ring = [...at(0, 0), ...at(60, 0), ...at(60, 25), ...at(0, 25)];
  const [lot] = carParks([['', 0, th * 1000, ring, []]]);
  const stalls = layStalls(lot);
  assert.ok(stalls.length > 40);
  for (const s of stalls) {
    assert.ok(Math.abs(s.ux - ux) < 1e-9 && Math.abs(s.uz - uz) < 1e-9);
    // the nose square to the rows
    assert.ok(Math.abs(Math.sin(s.heading) * ux + Math.cos(s.heading) * uz) < 1e-9);
  }
});

test('no stall under a building standing on the lot, none without an aisle, none in a sliver', () => {
  const [lot] = carParks([['', 0, 0, rect(0, 0, 80, 40), []]]);
  // a 20 x 20 m hall in the middle (houses: x, z, w, d in dm, θ in mrad...)
  const walls = indexHouses([400, 200, 200, 200, 0, 1, 8, 0], 8);
  const stalls = layStalls(lot, walls.wallDistance);
  assert.ok(stalls.length > 0 && stalls.length < layStalls(lot).length);
  for (const s of stalls) assert.ok(walls.wallDistance(s.x, s.z, 5) > 1.3);
  const [strip] = carParks([['', 0, 0, rect(0, 0, 80, 10), []]]);
  assert.deepEqual(layStalls(strip), [], 'too narrow for a row and its aisle');
});

test('no car stands in an entrance\'s way: on its driveway or across its mouth', () => {
  // a 6 m driveway from the curb 4 m north of the lot, straight in (+z) at x = 40
  const door = [40, -4, Math.round((Math.PI / 2) * 1000), 6, [40, -4, 40, 0]];
  const [lot] = carParks([['', 0, 0, rect(0, 0, 80, 40), [door]]]);
  const [open] = carParks([['', 0, 0, rect(0, 0, 80, 40), []]]);
  const stalls = layStalls(lot);
  assert.ok(stalls.length < layStalls(open).length);
  for (const s of stalls) assert.ok(!(Math.abs(s.x - 40) < 3 + STALL_W / 2 && s.z < 9), `a stall at ${s.x}, ${s.z}`);
  assert.ok(inMouth(lot, 40, 5) && !inMouth(lot, 10, 5));
  assert.equal(lot.entrances[0].path.length, 2);
  assert.ok(Math.abs(lot.entrances[0].nz - 1) < 1e-6); // (the angle in whole mrad)
});

test('about half the stalls are taken, the same ones every time', () => {
  const [lot] = carParks([['', 0, 0, rect(0, 0, 200, 100), []]]);
  const stalls = layStalls(lot);
  const a = parkCars(stalls), b = parkCars(stalls);
  assert.deepEqual(a.map((c) => c.stall), b.map((c) => c.stall));
  const share = a.length / stalls.length;
  assert.ok(share > 0.3 && share < 0.7, `${share}`);
  for (const c of a) {
    assert.ok(c.model >= 0 && c.model < 1 && c.paint >= 0 && c.paint < 1);
    assert.ok(Math.abs(c.heading - c.stall.heading) < 0.03);
  }
  assert.ok(parkCars(stalls, { fill: 0.9 }).length > a.length);
});

test('the big stores\' car parks are in the geodata, inside the city', () => {
  const lots = carParks(GEO.parking);
  assert.ok(lots.length > 100);
  const { x0, x1, z0, z1 } = GEO.frame.box;
  for (const l of lots) {
    assert.ok(l.minX >= x0 && l.maxX <= x1 && l.minZ >= z0 && l.maxZ <= z1);
    assert.ok(l.area >= 150 && l.pts.length >= 3);
    assert.ok([0, 1, 2, 3].includes(l.surface));
  }
  // Walmart, Ley Álica & Soriana Cigarrera on Insurgentes: lots of 11-18 thousand m², each with its entrances
  const big = lots.filter((l) => l.area > 10000);
  assert.ok(big.length >= 4);
  for (const l of big) assert.ok(l.entrances.length >= 2);
  for (const l of lots) for (const e of l.entrances) assert.ok(e.width >= 3.5 && e.path.length >= 2);
});
