import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import {
  TERMINAL, PLATFORM, ANNEX, WALLS, GATE, FRONT_DOORS, BACK_DOORS, COACH_L, COACH_W, centralAt, centralFrame, coachBays,
  parkCoaches, inPatio, inCentral, hallFurniture, busGate, carParkGates
} from '../js/world/central-plan.ts';
import { STEP, ROADS_OUT, coachRuns, runRoom, nextWait, departure, arrival } from '../js/world/central-runs.ts';
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

test('the patio is walled all round: what drives in from it gets out only through the gate on Preparatoria', () => {
  // flood the frame from the patio's middle on a 0.5 m grid, the walls, the hall, the andén & the KFC solid
  const S = 0.5, U0 = -60, U1 = 120, V0 = -10, V1 = 95;
  const nu = Math.round((U1 - U0) / S), nv = Math.round((V1 - V0) / S);
  const segDist = (u, v, [a0, b0, a1, b1]) => {
    const du = a1 - a0, dv = b1 - b0, L2 = du * du + dv * dv;
    const t = Math.max(0, Math.min(1, ((u - a0) * du + (v - b0) * dv) / L2));
    return Math.hypot(u - a0 - du * t, v - b0 - dv * t);
  };
  const inRect = (u, v, [r0, r1, s0, s1]) => u >= r0 && u <= r1 && v >= s0 && v <= s1;
  const solid = (u, v) => WALLS.some((w) => segDist(u, v, w) < 0.4) || inRect(u, v, TERMINAL) || inRect(u, v, PLATFORM) || inRect(u, v, ANNEX);
  const seen = new Uint8Array(nu * nv);
  const queue = [[Math.round((40 - U0) / S), Math.round((55 - V0) / S)]];
  const out = [];
  while (queue.length) {
    const [i, j] = queue.pop();
    if (i < 0 || j < 0 || i >= nu || j >= nv || seen[i * nv + j]) continue;
    seen[i * nv + j] = 1;
    const u = U0 + i * S, v = V0 + j * S;
    if (solid(u, v)) continue;
    // (out on Preparatoria: no further)
    if (u > GATE.u + 0.3) { out.push(v); continue; }
    // (never out onto the car parks: the front's, the one on República de Chile; nor onto the streets round it)
    assert.ok(u > -31 && v < 82 && v > 0 && (u > 0 || v > 27), `the patio's way out at (${u}, ${v})`);
    queue.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  assert.ok(out.length > 0, 'the gate opens onto Preparatoria');
  for (const v of out) assert.ok(v >= GATE.v0 && v <= GATE.v1, `out at v ${v}`);
});

test('the hall is walked through: from each front door past the taquillas and benches to the andén', () => {
  const f = hallFurniture(9);
  assert.equal(f.taquillas.length, 9);
  const R = 0.45; // m: someone walking, with room to spare
  const boxes = [
    ...f.taquillas.map((t) => [t.u0, t.u1, f.counterV[0], f.counterV[1] + 1.3]),
    ...f.benches.map(([a, b, v]) => [a, b, v, v + 0.55]),
    ...f.columns.map(([u, v]) => [u - 0.3, u + 0.3, v - 0.3, v + 0.3]),
    ...f.kiosks.map(([a, b, c, d]) => [a, b, c, d])
  ];
  const free = (u, v) => u > TERMINAL[0] + R && u < TERMINAL[1] - R && boxes.every(([a, b, c, d]) => u < a - R || u > b + R || v < c - R || v > d + R);
  const S = 0.25, nu = Math.round((TERMINAL[1] - TERMINAL[0]) / S), nv = Math.round((TERMINAL[3] - TERMINAL[2]) / S);
  for (const door of FRONT_DOORS) {
    const seen = new Uint8Array(nu * nv);
    const queue = [[Math.round(door / S), Math.round(1 / S)]];
    let reached = false;
    while (queue.length && !reached) {
      const [i, j] = queue.pop();
      if (i < 0 || j < 0 || i >= nu || j >= nv || seen[i * nv + j]) continue;
      seen[i * nv + j] = 1;
      const u = i * S, v = j * S;
      if (!free(u, v)) continue;
      if (v >= TERMINAL[3] - 1 && BACK_DOORS.some(([a, b]) => u > a + R && u < b - R)) reached = true;
      queue.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
    assert.ok(reached, `the door at u ${door} leads to the andén`);
  }
});

test('the gates: an arm across each way through the bus gate, and at the car parks\' entrances by the Central', () => {
  const bus = busGate();
  assert.equal(bus.arms.length, 2);
  for (const a of bus.arms) {
    // across the way in or out, square to it (the way through runs along u)
    assert.ok(Math.abs(a.ax * a.tx + a.az * a.tz) < 1e-6);
    const [, v0] = centralFrame(a.x, a.z), [, v1] = centralFrame(a.x + a.ax * a.length, a.z + a.az * a.length);
    assert.ok(Math.min(v0, v1) >= GATE.v0 && Math.max(v0, v1) <= GATE.v1, `the arm v ${v0.toFixed(1)}..${v1.toFixed(1)} within the gate`);
  }
  const cars = carParkGates(carParks(GEO.parking));
  assert.equal(cars.arms.length, 2, 'Preparatoria\'s and República de Chile\'s');
  assert.equal(cars.casetas.length, 2);
  assert.equal(cars.totems.length, 1);
  for (const k of cars.casetas) assert.ok(!onRoadway(k.x, k.z), 'a caseta off the street');
});

test('the coaches\' runs: out of the bay backwards, round the block and back into it, smooth and at a coach\'s speeds', () => {
  const bays = coachBays();
  const runs = coachRuns(bays, 9);
  assert.equal(runs.length, 3);
  const parked = parkCoaches(bays, 9, runRoom(bays));
  for (const run of runs) {
    assert.ok(!parked.some((p) => p.bay === run.bay), 'its bay left to it');
    const { out, loop } = run;
    assert.ok(out.reverse && !loop.reverse);
    const at = (p, i) => [p.x[i], p.z[i]];
    // it ends where it began, nose in to the andén, and the loop starts where backing out ends
    const n = loop.x.length - 1;
    assert.ok(Math.hypot(out.x[0] - run.bay.x, out.z[0] - run.bay.z) < 0.01);
    assert.ok(Math.hypot(loop.x[n] - run.bay.x, loop.z[n] - run.bay.z) < 0.3);
    assert.ok(Math.abs(Math.atan2(Math.sin(loop.heading[n] - run.bay.heading), Math.cos(loop.heading[n] - run.bay.heading))) < 0.15);
    assert.ok(Math.hypot(...at(out, out.x.length - 1).map((c, k) => c - at(loop, 0)[k])) < 0.01);
    // round the block: out on Preparatoria (u > 104) and on República de Chile (u < -55)
    const us = Array.from(loop.x, (x, i) => centralFrame(x, loop.z[i])[0]);
    assert.ok(Math.max(...us) > 106 && Math.min(...us) < -55);
    // samples evenly spaced, the heading turning no more than a coach can between them, speeds sane
    for (const p of [out, loop]) {
      for (let i = 1; i < p.x.length; i++) {
        const d = Math.hypot(p.x[i] - p.x[i - 1], p.z[i] - p.z[i - 1]);
        assert.ok(d < STEP * 1.05, `samples ${d.toFixed(2)} m apart`);
        const dh = Math.atan2(Math.sin(p.heading[i] - p.heading[i - 1]), Math.cos(p.heading[i] - p.heading[i - 1]));
        assert.ok(Math.abs(dh) < 0.12, `a turn of ${dh.toFixed(2)} rad in ${d.toFixed(2)} m`);
        assert.ok(p.speed[i] >= 0 && p.speed[i] <= 8.4);
      }
      assert.equal(p.speed[p.speed.length - 1], 0);
    }
    assert.ok(nextWait(run, 1) >= 60 && nextWait(run, 1) <= 150);
  }
});

test('the coaches\' roads out of town: out the gate to the far end of their highway, and in from it to their bay', () => {
  // a router along the straight line, a node every 50 m
  const router = (x0, z0, x1, z1) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 50));
    return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));
  };
  const runs = coachRuns(coachBays(), 9);
  for (const road of Object.keys(ROADS_OUT)) {
    const [ex, ez] = ROADS_OUT[road];
    for (const run of runs) {
      const out = departure(run, road, router), back = arrival(run, road, router);
      assert.ok(out && back, `${road}: a road out and in`);
      const n = out.x.length - 1;
      // from where it backed out to (a lane's width from) the far end, out through the gate
      assert.ok(Math.hypot(out.x[0] - run.out.x.at(-1), out.z[0] - run.out.z.at(-1)) < 0.01);
      assert.ok(Math.hypot(out.x[n] - ex, out.z[n] - ez) < 3, `${road}: out to its far end`);
      const us = Array.from(out.x, (x, i) => centralFrame(x, out.z[i]));
      assert.ok(us.some(([u, v]) => Math.abs(u - GATE.u) < 0.5 && v > GATE.outV[0] && v < GATE.outV[1]), 'through the way out');
      // in from the far end through the way in to its bay, nose in
      const m = back.x.length - 1;
      assert.ok(Math.hypot(back.x[0] - ex, back.z[0] - ez) < 3 && Math.hypot(back.x[m] - run.bay.x, back.z[m] - run.bay.z) < 0.3);
      const ins = Array.from(back.x, (x, i) => centralFrame(x, back.z[i]));
      assert.ok(ins.some(([u, v]) => Math.abs(u - GATE.u) < 0.5 && v > GATE.inV[0] && v < GATE.inV[1]), 'through the way in');
      for (const p of [out, back]) {
        assert.ok(p.speed.every((v) => v >= 0 && v <= 16.01));
        for (let i = 1; i < p.x.length; i++) {
          const dh = Math.atan2(Math.sin(p.heading[i] - p.heading[i - 1]), Math.cos(p.heading[i] - p.heading[i - 1]));
          assert.ok(Math.abs(dh) < 0.13, `${road}: a turn of ${dh.toFixed(2)} rad in ${STEP} m`);
        }
      }
    }
  }
  // no road found: none
  assert.equal(departure(runs[0], 'guadalajara', () => null), null);
});
