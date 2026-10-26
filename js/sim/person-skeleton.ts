// js/sim/person-skeleton.ts
// The people's 15-bone skeleton (sim/pedestrians.ts): its bones, its bind pose's measures and the rules a vertex is
// skinned by along the body, for the lofted body drawn there and for the person models tools/models/prepare-person.mjs
// skins to the same bones (they must agree, or a model's joints bend in the wrong places). No three.js here, so Node
// imports it (the tool, the tests).

export const BONE = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  UPPER_ARM_L: 3,
  FOREARM_L: 4,
  UPPER_ARM_R: 5,
  FOREARM_R: 6,
  THIGH_L: 7,
  SHIN_L: 8,
  FOOT_L: 9,
  TOE_L: 10,
  THIGH_R: 11,
  SHIN_R: 12,
  FOOT_R: 13,
  TOE_R: 14
};
export const BONE_COUNT = 15;

// Bind pose (metres, a 1.75 m person standing at the origin facing +Z, +X on their left): legs straight down, arms
// hanging 8 degrees out from the body
export const THIGH = 0.42;
export const SHIN = 0.42;
export const ANKLE_H = 0.08;
export const HIP_X = 0.09;
export const UPPER_ARM = 0.3;
export const FOREARM = 0.255;
export const ARM_BIND_ABDUCTION = 0.14;
export const PELVIS_Y = 0.96;
export const HIP_Y = ANKLE_H + SHIN + THIGH;
export const SIDES = [1, -1] as const; // left (+X), right (-X)
export const LIMB = {
  upperArm: [BONE.UPPER_ARM_L, BONE.UPPER_ARM_R],
  forearm: [BONE.FOREARM_L, BONE.FOREARM_R],
  thigh: [BONE.THIGH_L, BONE.THIGH_R],
  shin: [BONE.SHIN_L, BONE.SHIN_R],
  foot: [BONE.FOOT_L, BONE.FOOT_R],
  toe: [BONE.TOE_L, BONE.TOE_R]
};

export function shoulderJoint(female: boolean): [x: number, y: number, z: number] {
  return female ? [0.165, 1.415, -0.015] : [0.185, 1.43, -0.015];
}

/** m: from the shoulder joint to the fingertips (the drawn hand's last ring, pedestrians.ts HAND) */
export const ARM_REACH = 0.728;
/** m: a person of scale 1 stands this tall, to the top of the head */
export const PERSON_HEIGHT = 1.75;

/** Two bones a vertex is skinned to and the weight of the second */
export type SkinWeights = [boneA: number, boneB: number, weightB: number];

export function torsoSkin(y: number): SkinWeights {
  if (y > 1.6) return [BONE.CHEST, BONE.HEAD, 1];
  if (y > 1.56) return [BONE.CHEST, BONE.HEAD, 0.65];
  if (y > 1.52) return [BONE.CHEST, BONE.HEAD, 0.2];
  if (y > 1.15) return [BONE.CHEST, BONE.CHEST, 0];
  if (y > 1.1) return [BONE.PELVIS, BONE.CHEST, 0.5];
  if (y > 1.03) return [BONE.PELVIS, BONE.CHEST, 0.15];
  return [BONE.PELVIS, BONE.PELVIS, 0];
}

export function legSkin(y: number, k: number): SkinWeights {
  const thigh = LIMB.thigh[k];
  const shin = LIMB.shin[k];
  const foot = LIMB.foot[k];
  // the hip bends over 0.75-0.95 m, below the jacket's hem, so the thigh tops stay inside the pelvis
  if (y > 0.95) return [BONE.PELVIS, thigh, 0.05];
  if (y > 0.9) return [BONE.PELVIS, thigh, 0.3];
  if (y > 0.84) return [BONE.PELVIS, thigh, 0.72];
  if (y > 0.74) return [BONE.PELVIS, thigh, 0.93];
  if (y > 0.55) return [thigh, thigh, 0];
  if (y > 0.52) return [thigh, shin, 0.12];
  if (y > 0.48) return [thigh, shin, 0.5];
  if (y > 0.44) return [thigh, shin, 0.88];
  if (y > 0.15) return [shin, shin, 0];
  if (y > 0.115) return [shin, foot, 0.25];
  return [shin, foot, 0.5];
}

export function armSkin(d: number, k: number): SkinWeights {
  const ua = LIMB.upperArm[k];
  const fa = LIMB.forearm[k];
  if (d < -0.03) return [BONE.CHEST, ua, 0.32];
  if (d < 0) return [BONE.CHEST, ua, 0.6];
  if (d < 0.06) return [BONE.CHEST, ua, 0.88];
  if (d < 0.26) return [ua, ua, 0];
  if (d < 0.29) return [ua, fa, 0.15];
  if (d < 0.315) return [ua, fa, 0.5];
  if (d < 0.36) return [ua, fa, 0.85];
  return [fa, fa, 0];
}

export function shoeSkin(z: number, k: number): SkinWeights {
  const foot = LIMB.foot[k];
  const toe = LIMB.toe[k];
  if (z < 0.07) return [foot, foot, 0];
  if (z < 0.11) return [foot, toe, 0.12];
  if (z < 0.15) return [foot, toe, 0.55];
  return [toe, toe, 0];
}
