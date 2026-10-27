import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('the walls & fences OpenStreetMap maps reach the game, each its kind', () => {
  const kinds = [0, 0, 0, 0, 0];
  for (const [kind, pts] of GEO.barriers) {
    kinds[kind]++;
    assert.ok(pts.length >= 4);
  }
  assert.ok(kinds[0] > 300, 'the bardas');
  assert.ok(kinds[2] > 20, 'the fences');
});
