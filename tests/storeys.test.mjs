import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('the buildings whose storeys OpenStreetMap maps are drawn whole at as many', () => {
  const HS = GEO.houseStride;
  const mapped = GEO.overrides.filter(([, , paint]) => paint === -1);
  assert.ok(mapped.length > 70);
  for (const [n, storeys] of mapped) {
    assert.ok(storeys >= 1 && storeys <= 12);
    assert.equal(GEO.houses[n * HS + 5], storeys);
  }
});
