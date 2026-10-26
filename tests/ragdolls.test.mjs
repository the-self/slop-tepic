import assert from 'node:assert/strict';
import test from 'node:test';
import { throwVelocity, bleedOf, landing, partLayout, poseFromParts, PARTS, PART_OF_BONE, qmul, qrot } from '../js/sim/ragdolls.ts';

// pedestrians.js's bind joints for a man (1.75 m, facing +z, +x his left), as plain points
const V = (x, y, z) => ({ x, y, z });
const J = [];
J[0] = V(0, 0.96, 0); J[1] = V(0, 1.12, -0.01); J[2] = V(0, 1.52, -0.012);
[[1, 3, 4, 7, 8, 9, 10], [-1, 5, 6, 11, 12, 13, 14]].forEach(([s, ua, fa, th, sn, ft, to]) => {
  J[ua] = V(s * 0.185, 1.43, -0.015); J[fa] = V(s * 0.227, 1.132, -0.015);
  J[th] = V(s * 0.09, 0.92, 0); J[sn] = V(s * 0.09, 0.5, 0); J[ft] = V(s * 0.09, 0.08, 0); J[to] = V(s * 0.09, 0.02, 0.135);
});
// every bone at rest, the person turned `yaw` about the vertical and standing at (x, 0, z)
function standing(yaw = 0, x = 0, z = 0) {
  const pose = new Float32Array(15 * 8);
  for (let b = 0; b < 15; b++) pose.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), x, 0, z, 1], b * 8);
  return pose;
}
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('a hit throws a body along it, a little outwards, and up the more the faster it came', () => {
  const slow = throwVelocity(0, 3, 1, 0), fast = throwVelocity(0, 20, 1, 0);
  assert.ok(fast.vz > slow.vz && fast.vy > slow.vy && slow.vx > 0);
  near(fast.vy, 1.6 + 6.4);
});

test('a knock draws no blood; a hit bleeds more the faster it came, up to all of it', () => {
  assert.equal(bleedOf(4), 0);
  assert.ok(bleedOf(10) > 0 && bleedOf(10) < bleedOf(18));
  assert.equal(bleedOf(40), 1);
});

test('the blood smear starts where the body came down, not where it flew from through the air', () => {
  // the pelvis every 0.1 s: struck at x 0 standing (0.95 m), flying 6 m through the air, then sliding 4 m on the ground
  const path = [[0, 0.95], [2, 1.6], [4, 1.4], [6, 0.3], [7.5, 0.25], [9, 0.2], [10, 0.18]];
  const track = new Float32Array(48 * 3);
  path.forEach(([x, y], i) => track.set([x, y, 0], i * 3));
  const h = { track, tracked: path.length, px: 10, py: 0.18, pz: 0, x0: 0, z0: 0 };
  landing(h);
  assert.equal(h.x0, 6);
  // knocked down where it stood (it never left the ground): no slide
  const still = { track: new Float32Array(48 * 3), tracked: 0, px: 3, py: 0.2, pz: 1, x0: 0, z0: 0 };
  landing(still);
  assert.deepEqual([still.x0, still.z0], [3, 1]);
});

test('the parts lie along the bones of the pose, each joined to its parent where the joint is', () => {
  const parts = partLayout(J, standing(Math.PI / 2, 10, -5), 1);
  assert.equal(parts.length, PARTS.length);
  // turned to face +x, his left now -z: the left shin hangs at x ≈ 10, z ≈ -5 - 0.09, between knee & ankle heights
  const shinL = parts[8];
  near(shinL.position[0], 10, 1e-6);
  near(shinL.position[2], -5 - 0.09, 1e-6);
  near(shinL.position[1], (0.5 + 0.08) / 2, 1e-6);
  // the knee joint at the shin's top; a hinge about his side (-z)
  near(shinL.joint.anchor[1], 0.5, 1e-6);
  assert.equal(shinL.joint.kind, 'hinge');
  near(shinL.joint.side[2], -1, 1e-6);
  const mass = parts.reduce((m, p) => m + p.mass, 0);
  assert.ok(mass > 65 && mass < 85, `${mass} kg`);
});

test('every bone follows its part: the feet ride on the shins', () => {
  assert.equal(PART_OF_BONE[9], PART_OF_BONE[8]);
  assert.equal(PART_OF_BONE[14], PART_OF_BONE[12]);
  const base = standing();
  const parts = partLayout(J, base, 1);
  const rot0 = parts.map((p) => p.rotation), pos0 = parts.map((p) => p.position);
  // the left shin swung back 90° about the knee (+x), everything else still
  const rot = rot0.map((q) => [...q]), pos = pos0.map((p) => [...p]);
  const swing = [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)];
  rot[8] = qmul(swing, rot0[8]);
  const knee = [0.09, 0.5, 0];
  const c = qrot(swing, [pos0[8][0] - knee[0], pos0[8][1] - knee[1], pos0[8][2] - knee[2]]);
  pos[8] = [knee[0] + c[0], knee[1] + c[1], knee[2] + c[2]];
  const pose = new Float32Array(base);
  poseFromParts(pose, base, rot0, pos0, rot, pos);
  // the left foot's bone: its joint (the ankle, 0.42 m under the knee) now 0.42 m behind it, level with it
  const o = 9 * 8, q = [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]];
  const ankle = qrot(q, [0.09, 0.08, 0]);
  near(ankle[0] + pose[o + 4], 0.09, 1e-6);
  near(ankle[1] + pose[o + 5], 0.5, 1e-6);
  near(ankle[2] + pose[o + 6], -0.42, 1e-6);
  // the right leg's untouched
  for (let k = 11 * 8; k < 12 * 8; k++) near(pose[k], base[k]);
});
