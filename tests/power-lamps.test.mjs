import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';

test('the mapped street lamps lie in the town, and the high-voltage lines carry their kV and towers', () => {
  const { box } = GEO.frame;
  assert.ok(GEO.lamps.length / 2 > 100);
  for (let k = 0; k + 1 < GEO.lamps.length; k += 2) {
    assert.ok(GEO.lamps[k] >= box.x0 && GEO.lamps[k] <= box.x1 && GEO.lamps[k + 1] >= box.z0 && GEO.lamps[k + 1] <= box.z1);
  }
  assert.ok(GEO.powerLines.length > 10);
  const kvs = new Set(GEO.powerLines.map(([kv]) => kv));
  for (const kv of [115, 230, 400]) assert.ok(kvs.has(kv), `${kv} kV`);
  // every run has at least two towers, a span apart (no two towers on one spot)
  for (const [, pts] of GEO.powerLines) {
    assert.ok(pts.length >= 4);
    for (let i = 2; i + 1 < pts.length; i += 2) assert.ok(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) > 1);
  }
});
