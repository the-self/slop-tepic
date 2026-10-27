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

test('round a mapped lamp no guessed one stands, and further off the lookup lets them be', async () => {
  const { lampFinder, LAMP_REPLACE } = await import('../js/world/mapped-lamps.ts');
  const near = lampFinder([10, 10, 500, -300]);
  assert.ok(near(10 + LAMP_REPLACE - 1, 10));
  assert.ok(near(480, -320));
  assert.ok(!near(10 + LAMP_REPLACE + 1, 10));
  assert.ok(!near(-200, 0));
  // (a reach wider than the lookup's cells still finds it)
  assert.ok(lampFinder([0, 0], 120)(0, 110));
  assert.ok(!lampFinder([], 45)(0, 0));
});

test('the road graph says which of its links are the alleys, service roads & tracks', () => {
  const links = GEO.roadGraph.links;
  const minor = links.filter((l) => l[9] === 1);
  assert.ok(minor.length > 500, `${minor.length} minor links`);
  assert.ok(minor.length < links.length / 4);
  // (named streets are all of the street classes: none of the town's avenues among them)
  const names = new Set(minor.map((l) => GEO.roadGraph.names[l[2]]));
  for (const avenue of ['Avenida México', 'Avenida Insurgentes']) assert.ok(!names.has(avenue), avenue);
});
