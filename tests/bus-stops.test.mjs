import assert from 'node:assert/strict';
import test from 'node:test';
import { placeBusStops, STOP_CLEAR } from '../js/world/bus-stops.ts';
import { GEO } from '../js/world/city-geodata.js';

// A two-way street 10 m wide east along z = 0: one edge each way, 88 m between the stop lines (x 6 to 94)
const ab = { sx: 6, sz: 0, dx: 1, dz: 0, rx: 0, rz: 1, len: 88, half: 5, lift: null };
const ba = { sx: 94, sz: 0, dx: -1, dz: 0, rx: 0, rz: -1, len: 88, half: 5, lift: null };

test('a stop goes on the edge whose right curb it stands by, its shelter on the sidewalk square to the street', () => {
  // south of the street (z > 0: right of ab), north of it (right of ba), by a corner, and far off any street
  const stops = placeBusStops([40, 7, 3, 60, -6.5, 2, 2, 7, 0, 40, 60, 1], [ab, ba]);
  assert.equal(stops.length, 3);
  const [south, north, corner] = stops;
  assert.equal(south.edge, ab);
  assert.ok(south.shelter && south.bench);
  assert.ok(Math.abs(south.s - 34) < 1e-9);
  assert.ok(south.z > 5 && south.z < 7.2, 'on the sidewalk, by the curb');
  assert.equal(north.edge, ba);
  assert.ok(!north.shelter && north.bench);
  assert.ok(north.z < -5);
  // by the corner: pulled in to STOP_CLEAR m inside the stop line
  assert.equal(corner.s, STOP_CLEAR);
});

test('Tepic\'s stops: most with their shelter or bench', () => {
  const n = GEO.busStops.length / 3;
  assert.ok(n > 100);
  let sheltered = 0;
  for (let k = 2; k < GEO.busStops.length; k += 3) if (GEO.busStops[k] & 1) sheltered++;
  assert.ok(sheltered > n / 3);
});
