import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import { geoToWorld } from '../js/world/geo.ts';
import { nearestStation, FIRE_STATIONS, AMBULANCE_BASES } from '../js/sim/emergency/stations.ts';

const poi = (name) => GEO.pois.find((p) => p.name === name);

test('stations land where the geodata puts the same places (the builder\'s projection)', () => {
  // OpenStreetMap's ISSSTE hospital node, as the geodata builder placed it
  const issste = poi("ISSSTE Hospital General 'B' Dr. Aquiles Calles Ramirez");
  const [x, z] = geoToWorld(21.5019819, -104.897768);
  assert.ok(Math.hypot(x - issste.x, z - issste.z) < 0.5, `${x}, ${z}`);
  // the Cruz Roja (Overture's point) by OpenStreetMap's, and the bomberos next door on Insurgentes
  const cruz = poi('Cruz Roja Mexicana');
  const base = AMBULANCE_BASES.find((s) => s.name.startsWith('Cruz Roja'));
  assert.ok(Math.hypot(base.x - cruz.x, base.z - cruz.z) < 40);
  assert.ok(Math.hypot(FIRE_STATIONS[0].x - cruz.x, FIRE_STATIONS[0].z - cruz.z) < 80);
});

test('every station is inside the city\'s box', () => {
  const b = GEO.frame.box;
  for (const s of [...FIRE_STATIONS, ...AMBULANCE_BASES]) {
    assert.ok(s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1, s.name);
  }
});

test('the ambulance comes from the base nearest the call', () => {
  const imss = AMBULANCE_BASES.find((s) => s.name.startsWith('IMSS'));
  assert.equal(nearestStation(AMBULANCE_BASES, imss.x + 30, imss.z - 20), imss);
  assert.equal(nearestStation([], 0, 0), null);
});
