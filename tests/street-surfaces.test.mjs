import assert from 'node:assert/strict';
import test from 'node:test';
import { SURFACES } from '../js/world/street-surfaces.ts';
import { PAVEMENTS } from '../js/world/pavement-data.ts';
import { GEO } from '../js/world/city-geodata.js';

test('the town\'s earth tracks & concrete alleys join the streets\' surfaces', () => {
  assert.equal(SURFACES.length, PAVEMENTS.length + GEO.minorSurfaces.length);
  assert.ok(GEO.minorSurfaces.filter(([kind]) => kind === 2).length > 50, 'the tracks in town, in earth');
  // they are narrow ways, as the road graph has them
  for (const [kind, width, pts] of GEO.minorSurfaces) {
    assert.ok(kind === 2 || kind === 3);
    assert.ok(width > 3 && width < 6);
    assert.ok(pts.length >= 4);
  }
});
