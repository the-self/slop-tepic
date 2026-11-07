import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import { blockAt, nearestRoads } from '../js/world/city-config.ts';
import { planGasStations } from '../js/world/gas-station-plan.ts';

const { stations, claims } = planGasStations();
const near = (x, z) => stations.find((s) => Math.hypot(s.x - x, s.z - z) < 60);
// (a point of a forecourt, u along its street, v away from it, in m from its middle)
const at = (s, u, v) => [s.x + s.ux * u + s.nx * v, s.z + s.uz * u + s.nz * v];

test('the gas stations get forecourts as big as the real ones, on their blocks, apart, kept clear by the town', () => {
  assert.ok(stations.length >= GEO.fuel.length * 0.9, `${stations.length} of ${GEO.fuel.length} laid out`);
  // the Pemex by Chedraui on Insurgentes is a big one, the one by Walmart smaller; none is a 17 m pad
  const chedraui = near(2779, 1990), walmart = near(2010, 1464);
  assert.ok(chedraui && walmart);
  assert.ok(chedraui.along * chedraui.deep > walmart.along * walmart.deep, 'Chedraui\'s bigger than Walmart\'s');
  // (the old forecourt was 17 x 11 m everywhere; most real ones are 600 m² and up)
  const areas = stations.map((s) => s.along * s.deep).sort((a, b) => a - b);
  assert.ok(areas[areas.length >> 1] >= 600, `median ${areas[areas.length >> 1]} m²`);
  for (const s of stations) {
    assert.ok(s.along >= 20 && s.deep >= 12, `${s.name}: ${s.along} x ${s.deep} m`);
    for (const [fu, fv] of [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45], [0, 0]]) {
      const [x, z] = at(s, fu * s.along, fv * s.deep);
      assert.ok(blockAt(x, z), `${s.name}'s forecourt off its block at ${x.toFixed(0)}, ${z.toFixed(0)}`);
      assert.ok(claims.houses.contains(x, z) && claims.walled(x, z), 'no house nor barda on it');
      for (const o of stations) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) > (o.deep + s.deep) / 2 - 1);
    }
  }
});

test('each station has a way in & a way out, and lanes past its pumps with places to queue behind them', () => {
  let queues = 0;
  for (const s of stations) {
    const [a, b] = s.drives;
    // (in at the end the near lane comes from, out at the other)
    assert.ok((b.x - a.x) * s.ux + (b.z - a.z) * s.uz > s.along / 2, `${s.name}: its driveways at its two ends`);
    assert.ok(s.islands.length >= 1 && s.lanes.length >= 2);
    for (const lane of s.lanes) {
      const pumps = lane.spots.filter((p) => p.pump);
      assert.ok(pumps.length >= 1);
      // nearest the way out first, the pumps before the line, each place behind the one before it
      lane.spots.forEach((p, k) => {
        if (k) assert.ok(p.s < lane.spots[k - 1].s - 4, 'room for a car between places');
        if (k && p.pump) assert.ok(lane.spots[k - 1].pump);
      });
      assert.ok(lane.spots.at(-1).s > 0 && lane.spots[0].s < lane.length, 'its places on its path');
      queues += lane.spots.length - pumps.length;
    }
  }
  assert.ok(queues > stations.length * 2, `${queues} places in line`);
});

test('on a one-way street the customers come & go the way it runs', () => {
  let oneWay = 0;
  for (const s of stations) {
    // (the street in front of its way in, 3 m out from the curb)
    const d = s.drives[0], x = d.x - d.nx * 3, z = d.z - d.nz * 3;
    const road = nearestRoads(x, z, 20)[0]?.road;
    if (!road || road.dir === 'TW') continue;
    let best = Infinity, ex = 0, ez = 0;
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i], b = road.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9)));
      const dd = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (dd < best) [best, ex, ez] = [dd, dx, dz];
    }
    oneWay++;
    assert.ok((ex * s.ux + ez * s.uz) * (road.dir === 'FT' ? 1 : -1) > 0, `${s.name} on ${road.name}: in & out against the traffic`);
  }
  assert.ok(oneWay >= 3, `${oneWay} stations on one-way streets`);
});
