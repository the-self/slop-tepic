import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('the benches, bins & gas stations OpenStreetMap maps reach the game, each canopy of a canopy\'s size', () => {
  assert.ok(GEO.benches.length / 3 > 50);
  assert.equal(GEO.bins.length % 2, 0);
  assert.ok(GEO.fuel.length > 40);
  for (const [, , , len, wid] of GEO.fuel) {
    assert.ok(len >= 80 && len <= 300, `${len}`);
    assert.ok(wid >= 80 && wid <= 160, `${wid}`);
  }
});
