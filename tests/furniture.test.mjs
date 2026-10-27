import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('the benches & bins OpenStreetMap maps reach the game, and its gas stations join Overture\'s, none twice', () => {
  assert.ok(GEO.benches.length / 3 > 50);
  assert.equal(GEO.bins.length % 2, 0);
  assert.ok(GEO.fuel.length > 40, `${GEO.fuel.length} gas stations`);
  for (const [x, z, name] of GEO.fuel) {
    assert.ok(typeof name === 'string' && name.length > 0);
    for (const [ox, oz] of GEO.fuel) if (ox !== x || oz !== z) assert.ok(Math.hypot(ox - x, oz - z) >= 69.5);
  }
});