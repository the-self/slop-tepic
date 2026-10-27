const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

class Matrix4 {}
class Vector3 {}
const { boxHit, riderKnocked, closingSpeed, toppleSpin, bodyOf, hideInstance, PROP_BODIES } = loadModule(
  readFileSync(join(__dirname, '../js/sim/mayhem.ts'), 'utf8'),
  { imports: { 'three/webgpu': { Matrix4, Vector3 } }, filename: 'mayhem.ts' }
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

test('the street furniture breaks loose at its own speeds: a loose bin at a nudge, a lamp mast only at a good knock', () => {
  const { cobra, post, sign, hydrant, bin } = PROP_BODIES;
  assert.ok(bin.breakAt < sign.breakAt && sign.breakAt <= post.breakAt && post.breakAt < cobra.breakAt);
  assert.ok(hydrant.breakAt >= 2.5, 'a hydrant is bolted to its main');
  // as heavy as the real thing: a steel cobra mast & arm well over a farol, a bin a few kilos
  assert.ok(cobra.mass > post.mass && post.mass > sign.mass && bin.mass < 20);
  for (const p of Object.values(PROP_BODIES)) assert.ok(p.cyl[0] > 0 && p.cyl[1] > 0.5 && p.reach > 0);
});

test('a CFE pole and a tree give to a car only, far harder than a lamp mast, and topple on the way they were struck', () => {
  const { cobra, cfe, tree } = PROP_BODIES;
  assert.ok(cfe.heavy && tree.heavy && !cobra.heavy);
  assert.ok(cfe.breakAt > cobra.breakAt * 2 && cfe.mass > cobra.mass * 4, 'spun concrete, not a steel mast');
  // struck going +z: it spins about -x... its top (+y) swept towards +z
  const [wx, wy, wz] = toppleSpin(0, 1, 15, 11);
  assert.equal(wy, 0);
  const top = [0, 1, 0];
  const sweep = [wy * top[2] - wz * top[1], wz * top[0] - wx * top[2], wx * top[1] - wy * top[0]]; // w × top
  assert.ok(sweep[2] > 0 && Math.abs(sweep[0]) < 1e-9, 'the top goes ahead of the car');
  assert.ok(Math.hypot(...toppleSpin(1, 0, 15, 11)) > Math.hypot(...toppleSpin(1, 0, 15, 22)), 'a taller one tips slower');
  // a tree's own body over its kind's
  const own = { ...tree, breakAt: 14 };
  assert.equal(bodyOf({ kind: 'tree', def: own }), own);
  assert.equal(bodyOf({ kind: 'tree' }), tree);
});

test('only the speed a vehicle closes on a prop at counts, not its speed past it', () => {
  assert.equal(closingSpeed(0, 10, 0, 1), 10, 'head on');
  assert.ok(Math.abs(closingSpeed(0, 10, Math.SQRT1_2, Math.SQRT1_2) - 10 * Math.SQRT1_2) < 1e-9);
  assert.equal(closingSpeed(0, 10, 1, 0), 0, 'alongside');
  assert.equal(closingSpeed(0, -10, 0, 1), 0, 'moving away');
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
