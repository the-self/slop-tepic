const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class Matrix4 {}
const { boxHit, riderKnocked, startTopple, stepTopple, hideInstance } = loadModule(
  readFileSync(join(__dirname, '../js/sim/mayhem.js'), 'utf8'),
  { imports: { 'three/webgpu': { Matrix4 } }, filename: 'mayhem.js' }
);

test('the player box hits bodies along its length and width only', () => {
  // facing +x (heading π/2), 4.5 m long, 1.8 m wide
  assert.ok(boxHit(0, 0, Math.PI / 2, 0.9, 2.25, 2.3, 0, 0.3));
  assert.ok(boxHit(0, 0, Math.PI / 2, 0.9, 2.25, -2.3, 0.5, 0.3));
  assert.equal(boxHit(0, 0, Math.PI / 2, 0.9, 2.25, 2.7, 0, 0.3), null);
  assert.equal(boxHit(0, 0, Math.PI / 2, 0.9, 2.25, 0, 1.3, 0.3), null);
  const hit = boxHit(0, 0, 0, 0.9, 2.25, 0, 2, 0.3);
  assert.ok(Math.abs(hit.nz - 1) < 1e-9, 'the contact points away from the player');
});

test('a car or bicycle knocks a rider off when driven into them, whoever was moving', () => {
  // the rider is ahead of the player along +z: (nx, nz) = (0, 1)
  assert.ok(riderKnocked('car', 0, 9, 0, 1, 2.2), 'the player drives into a cyclist');
  assert.ok(riderKnocked('car', 0, 5, 0, 1, 2.2), 'a cyclist rides into the standing car (the same, seen from the car)');
  assert.ok(riderKnocked('cyclist', 0, 3, 0, 1, 2.2));
  assert.equal(riderKnocked('car', 0, 1.5, 0, 1, 2.2), false, 'a slow touch only eases them apart');
  assert.equal(riderKnocked('car', 0, -6, 0, 1, 2.2), false, 'nor do two pulling apart');
  // brushing past alongside: the rider is off to the side (1, 0), the speed between them along the road
  assert.equal(riderKnocked('car', 0, 3, 1, 0, 2.2), false, 'a car slipping past a cyclist');
  assert.ok(riderKnocked('car', 0.4, 9, 1, 0, 2.2), 'a car swiping past far faster than them');
  assert.equal(riderKnocked('person', 0, 9, 0, 1, 2.2), false, 'nobody on foot knocks a rider off');
  assert.equal(riderKnocked('helicopter', 0, 9, 0, 1, 2.2), false);
});

test('a knocked pole falls over and comes to rest lying down', () => {
  const f = startTopple(10, () => 0.5);
  let rest = 0;
  for (let t = 0; t < 6; t += 1 / 60) rest = stepTopple(f, 1 / 60, Math.PI / 2 - 0.04, 8.4);
  assert.ok(rest > 1);
  assert.ok(Math.abs(f.angle - (Math.PI / 2 - 0.04)) < 1e-9);
});

test('hiding a prop clears its instance where culling moved it', () => {
  const instance = () => ({ instanceMatrix: { array: new Float32Array(48).fill(1), ranges: [], addUpdateRange(o, n) { this.ranges.push([o, n]); }, needsUpdate: false } });
  const chunkA = instance();
  const chunkB = instance();
  const where = new Int32Array([0, 2, 1, 0]); // instance 0 -> chunk A slot 2, instance 1 -> chunk B slot 0
  const source = { userData: { chunked: { chunks: [chunkA, chunkB], where } } };
  hideInstance(source, 1);
  assert.deepEqual(Array.from(chunkB.instanceMatrix.array.subarray(0, 16)), new Array(16).fill(0));
  assert.equal(chunkB.instanceMatrix.array[16], 1, 'the neighbouring instance stays');
  assert.equal(chunkB.instanceMatrix.needsUpdate, true);
  assert.deepEqual(chunkB.instanceMatrix.ranges, [[0, 16]]);
  assert.equal(chunkA.instanceMatrix.needsUpdate, false);
  const plain = { userData: {}, ...instance() };
  hideInstance(plain, 2);
  assert.deepEqual(Array.from(plain.instanceMatrix.array.subarray(32, 48)), new Array(16).fill(0));
});
