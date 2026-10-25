// js/sim/ragdolls.js
// People knocked down, run over, shot or thrown from a car as ragdolls in Jolt Physics (the world player/car-physics.js
// runs): eleven capsules over the 15-bone rig of pedestrians.js (pelvis, chest, head, upper arms & forearms, thighs &
// shins, the feet riding on the shins) joined as a body is: the spine, neck, shoulders and hips swing within cones and
// twist a little, elbows and knees bend one way only, every joint with some friction. Thrown at a person's own pose and
// speed, they meet the car (over its bonnet, into its glass), the walls and the ground, and settle as they fall; once
// still they freeze (their bodies leave the world) and keep their last pose until the game lets them go.
//
// Each part moves its bones with it: a bone's transform (pedestrians.js pose: world vertex = q·bind·s + t) is the
// part's rotation and move since the throw applied to the bone's transform at the throw, so every bone of the mesh
// follows the physics. Plain numbers and Jolt only, no three.js (node --test runs the pure parts).

// pedestrians.js BONE (PERSON_BONES)
const B = {
  PELVIS: 0, CHEST: 1, HEAD: 2, UPPER_ARM_L: 3, FOREARM_L: 4, UPPER_ARM_R: 5, FOREARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, FOOT_L: 9, TOE_L: 10, THIGH_R: 11, SHIN_R: 12, FOOT_R: 13, TOE_R: 14
};
const BONES = 15;

// The parts: the bone each one is, its parent part (-1: the root), how it joins it ('cone': swing & twist, 'hinge'), its
// share of the body's mass, its capsule's radius (m at 1.75 m tall) and the bind-pose segment it spans (from the bind
// joints J), and the joint's anchor (bind). Swing cones (rad): about the person's side (forward & back) & front (out
// to the side), and the twist about the bone
const PARTS = [
  { bone: B.PELVIS, parent: -1, mass: 0.15, r: 0.12, seg: (J) => [[J[B.THIGH_L].x + 0.02, 0.95, 0], [J[B.THIGH_R].x - 0.02, 0.95, 0]] },
  { bone: B.CHEST, parent: 0, mass: 0.28, r: 0.15, seg: (J) => [[0, J[B.CHEST].y + 0.05, J[B.CHEST].z], [0, 1.38, -0.01]],
    at: (J) => J[B.CHEST], joint: 'cone', swing: [0.45, 0.3], twist: 0.35 },
  { bone: B.HEAD, parent: 1, mass: 0.07, r: 0.1, seg: (J) => [[0, J[B.HEAD].y + 0.08, J[B.HEAD].z], [0, J[B.HEAD].y + 0.17, J[B.HEAD].z + 0.01]],
    at: (J) => J[B.HEAD], joint: 'cone', swing: [0.6, 0.45], twist: 0.8 },
  ...[[B.UPPER_ARM_L, B.FOREARM_L], [B.UPPER_ARM_R, B.FOREARM_R]].flatMap(([upper, fore]) => [
    { bone: upper, parent: 1, mass: 0.028, r: 0.05, seg: (J) => [J[upper], J[fore]], at: (J) => J[upper],
      joint: 'cone', swing: [1.5, 1.3], twist: 0.8 },
    // (forearm & hand: on along the arm 0.33 m)
    { bone: fore, parent: 'upper', mass: 0.022, r: 0.045, seg: (J) => [J[fore], along(J[upper], J[fore], 0.33)], at: (J) => J[fore],
      joint: 'hinge', bend: [-2.4, 0.05] } // (the hand comes up in front: about the person's side, negative)
  ]),
  ...[[B.THIGH_L, B.SHIN_L, B.FOOT_L], [B.THIGH_R, B.SHIN_R, B.FOOT_R]].flatMap(([thigh, shin, foot]) => [
    { bone: thigh, parent: 0, mass: 0.1, r: 0.075, seg: (J) => [J[thigh], J[shin]], at: (J) => J[thigh],
      joint: 'cone', swing: [1.3, 0.55], twist: 0.4 },
    { bone: shin, parent: 'thigh', mass: 0.06, r: 0.055, seg: (J) => [J[shin], J[foot]], at: (J) => J[shin],
      joint: 'hinge', bend: [-0.05, 2.4] } // (the foot goes back: about the person's side, positive)
  ])
];
// (a forearm's parent is the upper arm just before it, a shin's the thigh)
PARTS.forEach((p, i) => { if (typeof p.parent === 'string') p.parent = i - 1; });
// the part each bone rides on (the feet and toes on the shins)
const PART_OF_BONE = new Int8Array(BONES).fill(-1);
PARTS.forEach((p, i) => { PART_OF_BONE[p.bone] = i; });
PART_OF_BONE[B.FOOT_L] = PART_OF_BONE[B.TOE_L] = PART_OF_BONE[B.SHIN_L];
PART_OF_BONE[B.FOOT_R] = PART_OF_BONE[B.TOE_R] = PART_OF_BONE[B.SHIN_R];

const MASS = 75; // kg, a person
const MAX_ACTIVE = 14; // ragdolls simulated at once: a slow one (on the ground) freezes as a new one starts...
const MAX_ACTIVE_HARD = 24; // ...or, none slow, the stillest once this many are moving
const SETTLE_SPEED = 0.35; // m/s every part under for SETTLE_TIME: still
const SETTLE_TIME = 0.8;
const SLOW = 1; // m/s: a body moving no faster than this lies on the ground (slipping, twitching): freezing it shows
const MAX_LIFE = 9; // s after which one only crawling along (SLOW) freezes; any one after MAX_LIFE_HARD
const MAX_LIFE_HARD = 25;
const GROUND_SAMPLES = 32; // the ground under each: 32 samples 1 m apart, sampled again once it is 8 m off its centre
const GROUND_CELL = 1;
const GROUND_RECENTRE = 8;

function along(a, b, length) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const k = length / (Math.hypot(dx, dy, dz) || 1);
  return { x: b.x + dx * k, y: b.y + dy * k, z: b.z + dz * k };
}

// ---- Quaternions as [x, y, z, w] (pure) ------------------------------------------------------------------------
function qmul(a, b, out = [0, 0, 0, 1]) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
const qconj = (q, out = [0, 0, 0, 1]) => { out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3]; return out; };
function qrot(q, v, out = [0, 0, 0]) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
  out[0] = vx + 2 * (w * cx + y * cz - z * cy);
  out[1] = vy + 2 * (w * cy + z * cx - x * cz);
  out[2] = vz + 2 * (w * cz + x * cy - y * cx);
  return out;
}
// The rotation taking unit vector a to unit vector b
function qbetween(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) return [1, 0, 0, 0]; // (half a turn about any axis square to a: a is y here, so x)
  const q = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d];
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
}

/**
 * Pure: the velocity a person is thrown at by a hit of velocity (vx, vz) pushing outwards along (nx, nz) (a blast, a
 * shot, a bicycle or a moto: what the player's car does its body works out itself, against theirs): along the hit, a
 * little outwards, and up, more the faster it came
 */
function throwVelocity(vx, vz, nx, nz) {
  const speed = Math.hypot(vx, vz);
  return {
    vx: vx * 0.85 + nx * (1.2 + speed * 0.12),
    vy: 1.6 + Math.min(9, speed * 0.32),
    vz: vz * 0.85 + nz * (1.2 + speed * 0.12)
  };
}

/** Pure: how badly (0..1) someone hit at `speed` m/s bleeds where they come to rest: nothing from a knock */
function bleedOf(speed) {
  return speed > 6 ? Math.min(1, speed / 22) : 0;
}

/**
 * Pure: the parts of a person of scale `s` with bind joints `J` posed by `pose` (pedestrians.js: per bone quaternion,
 * translation & scale, 8 floats): for each, its body's rotation (its bone's), position (its segment's centre in the
 * world), its capsule (half height & radius, and its axis's rotation from +y in the body's frame), its mass, and its
 * joint to its parent (anchor in the world; the bone's direction & the person's side, in the world).
 */
function partLayout(J, pose, s) {
  // a bind-space point of `bone` in the world
  const world = (bone, p) => {
    const o = bone * 8, q = [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]], k = pose[o + 7] || s;
    const v = qrot(q, [p[0] * k, p[1] * k, p[2] * k]);
    return [v[0] + pose[o + 4], v[1] + pose[o + 5], v[2] + pose[o + 6]];
  };
  const pt = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
  return PARTS.map((part) => {
    const o = part.bone * 8, q = [pose[o], pose[o + 1], pose[o + 2], pose[o + 3]];
    const k = pose[o + 7] || s;
    const [a, b] = part.seg(J).map(pt);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d) * k;
    const dir = d.map((v) => v / (Math.hypot(...d) || 1));
    const r = part.r * k;
    const centre = world(part.bone, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const layout = {
      rotation: q, position: centre, halfHeight: Math.max(0.01, len / 2 - r), radius: r,
      axis: qbetween([0, 1, 0], dir), mass: part.mass * MASS * k * k * k, parent: part.parent
    };
    if (part.parent >= 0) {
      layout.joint = {
        kind: part.joint, anchor: world(part.bone, pt(part.at(J))),
        twist: qrot(q, dir), side: qrot(q, [1, 0, 0]), front: qrot(q, [0, 0, 1]),
        swing: part.swing, twistLimit: part.twist, bend: part.bend
      };
    }
    return layout;
  });
}

/**
 * Pure: writes into `pose` the bones moved with their parts: part i turned by rot[i]·rot0[i]⁻¹ and moved from pos0[i]
 * to pos[i] since the throw, applied to `base` (the bones at the throw). Arrays of [x, y, z, w] / [x, y, z]; `delta`
 * (one quaternion a part) is scratch space, so nothing is allocated per frame.
 */
const _q = [0, 0, 0, 1], _v = [0, 0, 0], _out = [0, 0, 0, 1], _t = [0, 0, 0], _inv = [0, 0, 0, 1];
function poseFromParts(pose, base, rot0, pos0, rot, pos, delta = rot.map(() => [0, 0, 0, 1])) {
  for (let i = 0; i < rot.length; i++) qmul(rot[i], qconj(rot0[i], _inv), delta[i]);
  const q = _q, v = _v, out = _out, t = _t;
  for (let b = 0; b < BONES; b++) {
    const i = PART_OF_BONE[b], o = b * 8;
    q[0] = base[o]; q[1] = base[o + 1]; q[2] = base[o + 2]; q[3] = base[o + 3];
    qmul(delta[i], q, out);
    pose[o] = out[0]; pose[o + 1] = out[1]; pose[o + 2] = out[2]; pose[o + 3] = out[3];
    v[0] = base[o + 4] - pos0[i][0]; v[1] = base[o + 5] - pos0[i][1]; v[2] = base[o + 6] - pos0[i][2];
    qrot(delta[i], v, t);
    pose[o + 4] = t[0] + pos[i][0]; pose[o + 5] = t[1] + pos[i][1]; pose[o + 6] = t[2] + pos[i][2];
    pose[o + 7] = base[o + 7];
  }
}

/**
 * The ragdolls in the world of `physics` (player/car-physics.js createCarPhysics). spawn(rig, { vx, vy, vz, bleed })
 * throws a PersonRig from its pose as it stands (its pose array then follows the physics); the handle it returns has
 * px, py, pz (the pelvis), x0, z0 (where it was thrown from), rest (s it has lain still) and settled; release(handle)
 * lets it go. `onSettle(handle)` is called as one comes to rest (main.js: a pool of blood under someone hit hard, and
 * their smear back to where they were struck).
 */
function createRagdolls(physics) {
  const { Jolt, system, bodies, layers } = physics.world;
  const filter = new Jolt.GroupFilterTable(PARTS.length);
  filter.AddRef(); // (ours for good: the bodies' references alone would free it with the last of them)
  PARTS.forEach((p, i) => { if (p.parent >= 0) filter.DisableCollision(i, p.parent); });
  // (neither do the thighs knock against each other, nor the arms against the pelvis)
  filter.DisableCollision(7, 9);
  for (const arm of [3, 4, 5, 6]) filter.DisableCollision(arm, 0);
  const tmpV = new Jolt.Vec3(0, 0, 0), tmpV2 = new Jolt.Vec3(0, 0, 0), tmpR = new Jolt.RVec3(0, 0, 0);
  const tmpQ = new Jolt.Quat(0, 0, 0, 1);
  const vec = (a, v = tmpV) => { v.Set(a[0], a[1], a[2]); return v; };
  const rvec = (a) => { tmpR.Set(a[0], a[1], a[2]); return tmpR; };
  const quat = (q) => { tmpQ.Set(q[0], q[1], q[2], q[3]); return tmpQ; };
  const handles = new Set();
  let group = 0;
  const api = { onSettle: null };

  // Takes its bodies out of the world, its pose kept; one come to rest on the ground (not one stopped short, mid-air)
  // is told to onSettle
  function freeze(h) {
    if (!h.parts) return;
    for (const c of h.joints) system.RemoveConstraint(c);
    for (const body of h.parts) physics.world.dropBody(body);
    if (h.ground) physics.world.dropBody(h.ground);
    h.parts = h.joints = h.ground = null;
    if (!h.settled) {
      h.settled = true;
      if (h.speed <= SLOW) api.onSettle?.(h);
    }
  }

  api.spawn = function spawn(rig, { vx = 0, vy = 0, vz = 0, spin = 2, bleed = 0 } = {}) {
    // one too many: the slowest freezes where it lies; none slow (a blast's crowd in the air), they all go on up to a
    // harder limit, where the stillest freezes even so
    let active = 0, slowest = null;
    for (const h of handles) {
      if (!h.parts) continue;
      active++;
      if (!slowest || h.speed < slowest.speed) slowest = h;
    }
    if (slowest && (active >= MAX_ACTIVE_HARD || (active >= MAX_ACTIVE && slowest.speed <= SLOW))) freeze(slowest);
    const base = Float32Array.from(rig.pose.subarray(0, BONES * 8));
    const layout = partLayout(rig.bind, base, rig.s || 1);
    const id = ++group;
    const parts = layout.map((l, i) => {
      const capsule = new Jolt.CapsuleShapeSettings(l.halfHeight, l.radius);
      const shaped = new Jolt.RotatedTranslatedShapeSettings(vec([0, 0, 0], tmpV2), quat(l.axis), capsule);
      const result = shaped.Create();
      const bcs = new Jolt.BodyCreationSettings(result.Get(), rvec(l.position), quat(l.rotation), Jolt.EMotionType_Dynamic, layers.ragdoll);
      bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
      bcs.mMassPropertiesOverride.mMass = l.mass;
      bcs.mFriction = 0.8;
      bcs.mRestitution = 0.05;
      bcs.mLinearDamping = 0.05;
      bcs.mAngularDamping = 0.3;
      const collision = new Jolt.CollisionGroup(filter, id, i);
      bcs.mCollisionGroup = collision;
      const body = bodies.CreateBody(bcs);
      Jolt.destroy(collision);
      Jolt.destroy(bcs);
      Jolt.destroy(result);
      Jolt.destroy(shaped);
      bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);
      // thrown as one, turning a little about the way it goes (its side) as it is hit low
      const w = spin * (0.7 + Math.random() * 0.6);
      const sideX = vz, sideZ = -vx, sl = Math.hypot(sideX, sideZ) || 1;
      bodies.SetLinearAndAngularVelocity(body.GetID(), vec([vx, vy, vz]), vec([sideX / sl * w, (Math.random() - 0.5) * spin, sideZ / sl * w], tmpV2));
      return body;
    });
    const joints = [];
    layout.forEach((l, i) => {
      if (!l.joint) return;
      const j = l.joint;
      let settings;
      if (j.kind === 'hinge') {
        settings = new Jolt.HingeConstraintSettings();
        settings.mSpace = Jolt.EConstraintSpace_WorldSpace;
        settings.mPoint1 = rvec(j.anchor);
        settings.mPoint2 = rvec(j.anchor);
        settings.mHingeAxis1 = vec(j.side);
        settings.mHingeAxis2 = vec(j.side);
        settings.mNormalAxis1 = vec(j.twist);
        settings.mNormalAxis2 = vec(j.twist);
        settings.mLimitsMin = j.bend[0];
        settings.mLimitsMax = j.bend[1];
        settings.mMaxFrictionTorque = 2 * l.mass;
      } else {
        settings = new Jolt.SwingTwistConstraintSettings();
        settings.mSpace = Jolt.EConstraintSpace_WorldSpace;
        settings.mPosition1 = rvec(j.anchor);
        settings.mPosition2 = rvec(j.anchor);
        settings.mTwistAxis1 = vec(j.twist);
        settings.mTwistAxis2 = vec(j.twist);
        settings.mPlaneAxis1 = vec(j.front);
        settings.mPlaneAxis2 = vec(j.front);
        settings.mNormalHalfConeAngle = j.swing[0];
        settings.mPlaneHalfConeAngle = j.swing[1];
        settings.mTwistMinAngle = -j.twistLimit;
        settings.mTwistMaxAngle = j.twistLimit;
        settings.mMaxFrictionTorque = 1.5 * l.mass;
      }
      const c = settings.Create(parts[l.parent], parts[i]);
      Jolt.destroy(settings);
      system.AddConstraint(c);
      joints.push(c);
    });
    const p = layout[0].position;
    const h = {
      rig, base, parts, joints, ground: null, gx: NaN, gz: NaN, gy: NaN,
      rot0: layout.map((l) => l.rotation), pos0: layout.map((l) => l.position),
      rot: layout.map(() => [0, 0, 0, 1]), pos: layout.map(() => [0, 0, 0]), delta: layout.map(() => [0, 0, 0, 1]),
      px: p[0], py: p[1], pz: p[2], x0: p[0], z0: p[2], age: 0, still: 0, rest: 0, speed: Infinity, settled: false, bleed
    };
    handles.add(h);
    return h;
  };

  api.release = function release(h) {
    if (!h || !handles.has(h)) return;
    h.settled = true; // (no onSettle for one let go)
    freeze(h);
    handles.delete(h);
  };

  // Before each step: the ground under each one moving, at its level
  api.before = function before() {
    for (const h of handles) {
      if (!h.parts) continue;
      if (Math.hypot(h.px - h.gx, h.pz - h.gz) < GROUND_RECENTRE && Math.abs(h.py - h.gy) < 3) continue;
      h.ground = physics.world.groundField(h.ground, h.px, h.pz, h.py + 0.5, GROUND_SAMPLES, GROUND_CELL);
      h.gx = h.px; h.gz = h.pz; h.gy = h.py;
    }
  };

  // After each step: the bones follow the parts; still ones freeze
  api.after = function after(dt) {
    for (const h of handles) {
      if (!h.parts) {
        h.rest += dt;
        continue;
      }
      h.age += dt;
      let fastest = 0;
      for (let i = 0; i < h.parts.length; i++) {
        const body = h.parts[i];
        const r = body.GetRotation(), p = body.GetPosition(), v = body.GetLinearVelocity();
        const q = h.rot[i], x = h.pos[i];
        q[0] = r.GetX(); q[1] = r.GetY(); q[2] = r.GetZ(); q[3] = r.GetW();
        x[0] = p.GetX(); x[1] = p.GetY(); x[2] = p.GetZ();
        fastest = Math.max(fastest, Math.hypot(v.GetX(), v.GetY(), v.GetZ()));
      }
      poseFromParts(h.rig.pose, h.base, h.rot0, h.pos0, h.rot, h.pos, h.delta);
      h.px = h.pos[0][0]; h.py = h.pos[0][1]; h.pz = h.pos[0][2];
      h.speed = fastest;
      h.still = fastest < SETTLE_SPEED ? h.still + dt : 0;
      h.rest = h.still;
      // still; or long after, only crawling along the ground; or very long after, whatever it is doing
      if (h.still > SETTLE_TIME || (h.age > MAX_LIFE && fastest <= SLOW) || h.age > MAX_LIFE_HARD) freeze(h);
    }
  };

  api.count = () => [...handles].filter((h) => h.parts).length;
  physics.addSystem(api);
  return api;
}

export { createRagdolls, throwVelocity, bleedOf, partLayout, poseFromParts, PARTS, PART_OF_BONE, qmul, qrot };
