const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

test('an override pinned to a point finds the turned building around it, else the nearest within a few metres', async () => {
  const { houseAt } = await import('../tools/tepic-lib.mjs');
  // two houses (stride 8): a 10 x 20 m one at (100, 50) turned 30°, and a 6 x 6 m one at (130, 50)
  const th = Math.PI / 6;
  const houses = [1000, 500, 100, 200, Math.round(th * 1000), 2, 0, 0, 1300, 500, 60, 60, 0, 1, 0, 0];
  // a point 8 m along the first house's local z: inside it though off its axis-aligned bounds' middle
  const u = 0, v = 8;
  const x = 100 + u * Math.cos(th) + v * Math.sin(th), z = 50 - u * Math.sin(th) + v * Math.cos(th);
  assert.equal(houseAt(houses, 8, x, z), 0);
  assert.equal(houseAt(houses, 8, 130, 51), 1);
  assert.equal(houseAt(houses, 8, 134.5, 50), 1, 'just outside: the nearest within the slack');
  assert.equal(houseAt(houses, 8, 160, 50), -1, 'nothing nearby');
});

test('landmark models are placed with the builder projection, facing their compass heading', async () => {
  const { GEO } = await import('../js/world/city-geodata.js');
  const source = readFileSync(join(__dirname, '../js/world/landmark-models.js'), 'utf8');
  const mod = loadModule(source, {
    imports: { 'three/webgpu': {}, './city-geodata.js': { GEO }, './ground.js': { landHeight: () => 0 } },
    globals: { Math, console }
  });
  // runway 02/20's north end (OpenStreetMap node 21.42873, -104.83763) lands where the builder put it: within the
  // 0.01° the frame's bearing is rounded to (~1.5 m at the airport, 10 km out; a few cm in the centro)
  const [, , pts] = GEO.airport.runways[0];
  const [x, z] = mod.geoToWorld(21.42873, -104.83763);
  assert.ok(Math.hypot(x - pts[0], z - pts[1]) < 2, `${x.toFixed(1)}, ${z.toFixed(1)} vs ${pts[0]}, ${pts[1]}`);
  // a facade facing the compass bearing of the grid's north (the frame's bearing) faces -z
  const f = mod.modelFrame({ lat: GEO.frame.lat0, lon: GEO.frame.lon0, heading: GEO.frame.bearingDeg, size: [10, 20] });
  assert.ok(Math.abs(f.x) < 1e-6 && Math.abs(f.z) < 1e-6, 'the plaza is the origin');
  assert.ok(Math.abs(f.fx) < 1e-9 && Math.abs(f.fz + 1) < 1e-9, 'a bearing along the grid faces grid north (-z)');
  assert.equal(f.hx, 5);
  assert.equal(f.hz, 10);
  assert.ok(Array.isArray(mod.LANDMARK_MODELS) && Array.isArray(mod.MODEL_RESERVES));
});
