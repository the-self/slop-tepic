const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// The car files' parsing and their levels of detail by distance (js/actors/vehicles/car-files.ts), without three.js:
// nothing here is drawn
const source = readFileSync(join(__dirname, '../js/actors/vehicles/car-files.ts'), 'utf8');
const { wheelsOf, lodFor, MODEL_LOD_DISTANCES } = loadModule(source, {
  imports: { 'three/webgpu': {}, '../../models/cars/index.ts': { CAR_MODELS: [] } }
});

test('a car file says where its wheels go in its body mesh\'s extras', () => {
  // (spread: the module runs in a context of its own, its objects another realm's)
  assert.deepEqual({ ...wheelsOf({ wheels: { x: 0.77, z: [1.749, -1.394], radius: 0.379 } }) }, { x: 0.77, front: 1.749, rear: -1.394, radius: 0.379 });
});

test('a file without wheels, or with them malformed, has none (its own drawn on its body)', () => {
  assert.equal(wheelsOf({}), null);
  assert.equal(wheelsOf({ wheels: null }), null);
  assert.equal(wheelsOf({ wheels: { x: 0.7, z: [1.3], radius: 0.3 } }), null, 'one axle');
  assert.equal(wheelsOf({ wheels: { x: '0.7', z: [1.3, -1.2], radius: 0.3 } }), null, 'a string');
  assert.equal(wheelsOf({ wheels: { x: 0.7, z: [1.3, null], radius: 0.3 } }), null, 'a missing rear axle');
});

test('a car is drawn at its own level near the camera, then at its lighter ones', () => {
  const [near, mid] = MODEL_LOD_DISTANCES;
  assert.equal(lodFor(0, 3), 0);
  assert.equal(lodFor(near - 0.1, 3), 0);
  assert.equal(lodFor(near, 3), 1);
  assert.equal(lodFor(mid - 0.1, 3), 1);
  assert.equal(lodFor(mid, 3), 2);
  assert.equal(lodFor(500, 3), 2, 'never past its lightest');
});

test('a light car with no lighter levels is always its own', () => {
  for (const d of [0, 30, 80]) assert.equal(lodFor(d, 1), 0);
});
