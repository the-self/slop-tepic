import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import {
  TERMINAL, PLATFORM, COACH_L, COACH_W, centralAt, centralFrame, coachBays, parkCoaches, inPatio, inCentral
} from '../js/world/central-plan.ts';
import { DOCK_CHAINS, atDock, inDockYard, loadingDocks } from '../js/world/loading-docks.ts';
import { carParks, inCarPark, inMouth } from '../js/world/parking.ts';
import { indexHouses } from '../js/world/lot-greenery.ts';
import { onRoadway } from '../js/world/city-config.ts';

// A coach's four corners (m) standing at (x, z), facing `heading`
const corners = (x, z, heading, l = COACH_L, w = COACH_W) => {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, s]) => ({ x: x + fx * a * l / 2 + fz * s * w / 2, z: z + fz * a * l / 2 - fx * s * w / 2 }));
};

test('the Central\'s frame lies on its OpenStreetMap outline: u along Insurgentes, v towards the patio', () => {
  const o = centralAt(0, 0), [u, v] = centralFrame(o.x, o.z);
  assert.ok(Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9);
  // the teleport spot (on a street round the block) lies outside it, alongside the hall
  const spot = GEO.teleports.central;
  assert.ok(spot);
  const [su] = centralFrame(spot.x, spot.z);
  assert.ok(su > TERMINAL[0] - 40 && su < TERMINAL[1] + 40);
  assert.ok(!inCentral(spot.x, spot.z));
  assert.ok(inCentral(centralAt(40, 50).x, centralAt(40, 50).z));
});

test('the coaches stand in their bays on the patio, clear of the hall, the andén and each other', () => {
  const bays = coachBays();
  assert.ok(bays.length >= 30, `${bays.length} bays`);
  const coaches = parkCoaches(bays, 8);
  assert.ok(coaches.length > bays.length / 2 && coaches.length < bays.length);
  for (const { line } of coaches) assert.ok(line >= 0 && line < 8);
  const boxes = bays.map((b) => corners(b.x, b.z, b.heading));
  for (const [i, box] of boxes.entries()) {
    for (const p of box) {
      assert.ok(inPatio(p.x, p.z), `bay ${i}: its corner on the patio`);
      const [, v] = centralFrame(p.x, p.z);
      assert.ok(v > PLATFORM[3] - 0.05, `bay ${i}: clear of the andén (v ${v.toFixed(2)})`);
    }
  }
  // no two coaches overlap: each one's middle further from the next one's sides than half its width
  for (let i = 0; i + 1 < bays.length; i++) {
    const a = bays[i], b = bays[i + 1];
    if (a.row !== b.row) continue;
    const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
    const across = Math.abs((b.x - a.x) * fz - (b.z - a.z) * fx);
    assert.ok(across > COACH_W + 0.5, `bays ${i} & ${i + 1} ${across.toFixed(2)} m apart`);
  }
  // the same ones every load
  assert.deepEqual(parkCoaches(bays, 8).map((c) => c.line), coaches.map((c) => c.line));
});

test('the supermarkets\' loading docks: open yard behind the store, off the streets and car parks', () => {
  const lots = carParks(GEO.parking);
  const blocked = (x, z) => lots.some((l) => inCarPark(l, x, z) || inMouth(l, x, z));
  const docks = loadingDocks(blocked);
  assert.ok(docks.length >= 8, `${docks.length} docks`);
  const stores = new Set(docks.map((d) => `${d.storeX},${d.storeZ}`));
  assert.ok(stores.size >= 5, `${stores.size} stores`);
  const walls = indexHouses(GEO.houses, GEO.houseStride);
  for (const d of docks) {
    assert.ok(d.chain >= 0 && d.chain < DOCK_CHAINS.length);
    // in the small hours, gone by the morning's rush
    assert.ok(d.arrive >= 0 && d.leave > d.arrive && d.leave <= 7);
    assert.ok(atDock(d, (d.arrive + d.leave) / 2) && !atDock(d, 12) && !atDock(d, d.leave));
    // its truck's body on open ground: no building, no street, no car park under it; its doors to the store's wall
    for (const p of corners(d.x, d.z, d.heading, 22, 2)) {
      assert.ok(walls.wallDistance(p.x, p.z, 1) > 0.3 && !onRoadway(p.x, p.z) && !blocked(p.x, p.z));
    }
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    assert.ok(walls.wallDistance(d.x - fx * 12.6, d.z - fz * 12.6, 3) < 1.5, 'backed up to the wall');
    assert.ok(inDockYard(docks, d.x, d.z));
  }
});
