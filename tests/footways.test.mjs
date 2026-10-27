import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('Tepic\'s footways, paths, pedestrian streets & steps reach the game, each its kind and width', () => {
  const kinds = [0, 0, 0, 0];
  const { box } = GEO.frame;
  for (const [kind, width, pts] of GEO.footways) {
    kinds[kind]++;
    assert.ok(width >= 1 && width <= 12);
    assert.ok(pts.length >= 4);
    for (let i = 0; i + 1 < pts.length; i += 2) assert.ok(pts[i] >= box.x0 - 1 && pts[i] <= box.x1 + 1 && pts[i + 1] >= box.z0 - 1 && pts[i + 1] <= box.z1 + 1);
  }
  assert.ok(kinds[0] > 200 && kinds[1] > 100 && kinds[2] > 100 && kinds[3] > 5, kinds.join(' '));
});
