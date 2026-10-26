// tools/models/prepare-person.mjs
// A person from Meshy (multi-image-to-3d, in A-pose, facing +z) made a body for the game's 15-bone skeleton
// (js/sim/pedestrians.ts): scaled to 1.75 m, its joints found from its shape, reposed into the game's bind pose (legs
// straight down, arms hanging 8 degrees out), each vertex skinned to two bones and a weight, simplified, its texture a
// JPEG. The crowd's own walk, run, aim and ragdoll then move it (sim/pedestrians.ts createModelPersonMaterial).
//   node tools/models/prepare-person.mjs <in.glb> <out.glb> [--faces 30000] [--far 3000] [--texture 2048] [--debug <png>]
// --faces: the near body's triangles; --far: the far level's ('lod1', for the crowd beyond its farDistance); --debug: a
// picture of the bones each vertex follows (front and side), before and after reposing.
// The weights follow the drawn body's own rules (torsoSkin, armSkin, legSkin, shoeSkin in pedestrians.ts), given by
// where each vertex lies along its limb, then blurred over the surface, so the joints bend as the drawn people's do;
// the blur goes over the mesh's edges, so it never jumps from an arm to the side it hangs by. The vertices carry
// _SKIN = (bone A, bone B, the weight of B, 0).
// Keep the numbers below in step with pedestrians.ts (the male bind pose).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const [inp, out] = args;
const faces = Number(opt('faces', 30000)), far = Number(opt('far', 3000)), texture = Number(opt('texture', 2048));
const debug = opt('debug', null);
if (!inp || !out || inp.startsWith('--')) throw new Error('usage: node tools/models/prepare-person.mjs <in.glb> <out.glb> [--faces 30000] [--far 3000] [--texture 2048] [--debug <png>]');

// ---- the game's skeleton (pedestrians.ts: BONE, bindJoints(false), the limbs' lengths) ----
const B = { PELVIS: 0, CHEST: 1, HEAD: 2, UA: [3, 5], FA: [4, 6], TH: [7, 11], SH: [8, 12], FT: [9, 13], TO: [10, 14] };
const SIDES = [1, -1]; // left (+x), right (-x)
const HEIGHT = 1.75; // m, the bind pose's person
const THIGH = 0.42, SHIN = 0.42, ANKLE_H = 0.08, HIP_X = 0.09, HIP_Y = ANKLE_H + SHIN + THIGH;
const UPPER_ARM = 0.3, FOREARM = 0.255, ARM_TIP = 0.728, ABDUCTION = 0.14;
const SHOULDER = [0.185, 1.43, -0.015];

// the drawn body's weights (pedestrians.ts): [bone A, bone B, weight of B]
function torsoSkin(y) {
  if (y > 1.6) return [B.CHEST, B.HEAD, 1];
  if (y > 1.56) return [B.CHEST, B.HEAD, 0.65];
  if (y > 1.52) return [B.CHEST, B.HEAD, 0.2];
  if (y > 1.15) return [B.CHEST, B.CHEST, 0];
  if (y > 1.1) return [B.PELVIS, B.CHEST, 0.5];
  if (y > 1.03) return [B.PELVIS, B.CHEST, 0.15];
  return [B.PELVIS, B.PELVIS, 0];
}
function legSkin(y, k) {
  const th = B.TH[k], sh = B.SH[k], ft = B.FT[k];
  if (y > 0.95) return [B.PELVIS, th, 0.05];
  if (y > 0.9) return [B.PELVIS, th, 0.3];
  if (y > 0.84) return [B.PELVIS, th, 0.72];
  if (y > 0.74) return [B.PELVIS, th, 0.93];
  if (y > 0.55) return [th, th, 0];
  if (y > 0.52) return [th, sh, 0.12];
  if (y > 0.48) return [th, sh, 0.5];
  if (y > 0.44) return [th, sh, 0.88];
  if (y > 0.15) return [sh, sh, 0];
  if (y > 0.115) return [sh, ft, 0.25];
  return [sh, ft, 0.5];
}
function armSkin(d, k) {
  const ua = B.UA[k], fa = B.FA[k];
  if (d < -0.03) return [B.CHEST, ua, 0.32];
  if (d < 0) return [B.CHEST, ua, 0.6];
  if (d < 0.06) return [B.CHEST, ua, 0.88];
  if (d < 0.26) return [ua, ua, 0];
  if (d < 0.29) return [ua, fa, 0.15];
  if (d < 0.315) return [ua, fa, 0.5];
  if (d < 0.36) return [ua, fa, 0.85];
  return [fa, fa, 0];
}
function shoeSkin(z, k) {
  const ft = B.FT[k], to = B.TO[k];
  if (z < 0.07) return [ft, ft, 0];
  if (z < 0.11) return [ft, to, 0.12];
  if (z < 0.15) return [ft, to, 0.55];
  return [to, to, 0];
}

// ---- small vector helpers (arrays of 3) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// the rotation turning unit a onto unit b (Rodrigues)
function rotation(a, b) {
  const v = cross(a, b), c = dot(a, b), s = len(v);
  if (s < 1e-9) return IDENTITY;
  const k = mul(v, 1 / s), t = 1 - c;
  const [x, y, z] = k;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c
  ];
}
// least-squares line through points: [centroid, unit direction] (the principal axis, by power iteration)
function fitLine(pts) {
  const c = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j];
  }
  let v = [0, -1, 0];
  for (let it = 0; it < 50; it++) v = unit(apply(C, v));
  if (v[1] > 0) v = mul(v, -1); // (pointing down, from the shoulder or hip)
  return [c, v];
}
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- the model ----
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const meshes = doc.getRoot().listMeshes();
if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error('expected one mesh of one primitive (as Meshy gives)');
const prim = meshes[0].listPrimitives()[0];
const posA = prim.getAttribute('POSITION'), norA = prim.getAttribute('NORMAL');
const P = posA.getArray(), N = norA.getArray(), I = prim.getIndices().getArray();
const n = P.length / 3;

// 1.75 m tall, its feet on y = 0, its torso's middle over the origin
let yMin = Infinity, yMax = -Infinity;
for (let i = 0; i < n; i++) {
  yMin = Math.min(yMin, P[i * 3 + 1]);
  yMax = Math.max(yMax, P[i * 3 + 1]);
}
const scale = HEIGHT / (yMax - yMin);
for (let i = 0; i < n * 3; i++) P[i] *= scale;
for (let i = 0; i < n; i++) P[i * 3 + 1] -= yMin * scale;
{
  let cx = 0, cz = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y < 1.0 || y > 1.3 || Math.abs(P[i * 3]) > 0.2) continue;
    cx += P[i * 3];
    cz += P[i * 3 + 2];
    c++;
  }
  for (let i = 0; i < n; i++) {
    P[i * 3] -= cx / c;
    P[i * 3 + 2] -= cz / c;
  }
}
const at = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

// corners joined by place (Meshy splits them along its texture's seams), and who neighbours whom
const place = new Map(), canon = new Int32Array(n), first = [];
for (let i = 0; i < n; i++) {
  const key = `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
  let id = place.get(key);
  if (id === undefined) {
    id = first.length;
    place.set(key, id);
    first.push(i);
  }
  canon[i] = id;
}
const m = first.length;
const nbrSets = Array.from({ length: m }, () => new Set());
for (let t = 0; t < I.length; t += 3) {
  const a = canon[I[t]], b = canon[I[t + 1]], c = canon[I[t + 2]];
  nbrSets[a].add(b).add(c);
  nbrSets[b].add(a).add(c);
  nbrSets[c].add(a).add(b);
}
const nbrs = nbrSets.map((s) => [...s]);
const V = first.map((i) => at(i));

const fmt = (a) => a.map((x) => x.toFixed(3)).join(', ');
// ---- the joints ----
// what a seed vertex reaches over the mesh's edges without going above yCut (a typed list of the vertices reached)
const reached = new Uint32Array(m), seen = new Int32Array(m).fill(-1);
let floods = 0;
function flood(seed, yCut) {
  const mark = floods++;
  let count = 0;
  if (V[seed][1] >= yCut) return reached.subarray(0, 0);
  reached[count++] = seed;
  seen[seed] = mark;
  for (let h = 0; h < count; h++) {
    for (const u of nbrs[reached[h]]) {
      if (seen[u] === mark || V[u][1] >= yCut) continue;
      seen[u] = mark;
      reached[count++] = u;
    }
  }
  return reached.subarray(0, count);
}
// the highest cut (between lo and hi) at which what the seed reaches stays clear of `far` (binary search, 0.5 mm)
function highestCut(seed, lo, hi, far) {
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    if (flood(seed, mid).some((u) => far(V[u]))) hi = mid;
    else lo = mid;
  }
  return lo;
}
const extreme = (score) => {
  let best = 0;
  for (let v = 1; v < m; v++) if (score(V[v]) > score(V[best])) best = v;
  return best;
};
const sole = SIDES.map((side) => extreme((p) => -p[1] * 10 + side * p[0])); // (each foot's lowest, outer vertex)
const finger = SIDES.map((side) => extreme((p) => side * p[0])); // (in A-pose the fingertips are the widest)

// the crotch: the highest cut where the left foot's leg stays apart from the right's
const crotchY = highestCut(sole[0], 0.3, 1.2, (p) => p[0] < -0.04);
// the armpits: the highest cut where each hand's arm stays apart from the torso's middle
const armpit = SIDES.map((side, k) => highestCut(finger[k], 0.9, 1.65, (p) => side * p[0] < 0.06));
if (crotchY > 1.15 || armpit.some((y) => y > 1.6)) throw new Error('the legs or the arms join the body too high: is the model in A-pose?');
// each arm below its armpit and each leg below the crotch (vertex flags)
const ARM = 1, LEG = 2;
const limb = new Uint8Array(m), limbSide = new Uint8Array(m);
for (let k = 0; k < 2; k++) {
  for (const u of flood(finger[k], armpit[k] - 0.01)) (limb[u] = ARM), (limbSide[u] = k);
  for (const u of flood(sole[k], crotchY - 0.005)) (limb[u] = LEG), (limbSide[u] = k);
}

const joints = SIDES.map((side, k) => {
  const armPts = [];
  for (let v = 0; v < m; v++) if (limb[v] === ARM && limbSide[v] === k) armPts.push(V[v]);
  const tipP = V[finger[k]];
  // (the mean of the arm's points `from` the fingertips, within 2 cm along `dir`: a ring of the arm)
  const ring = (origin, dir, at) => {
    const c = [0, 0, 0];
    let count = 0;
    for (const p of armPts) {
      if (Math.abs(dot(sub(p, origin), dir) - at) > 0.02) continue;
      for (let i = 0; i < 3; i++) c[i] += p[i];
      count++;
    }
    if (!count) throw new Error('an arm with a hole in it');
    return mul(c, 1 / count);
  };
  // the arm hangs straight in A-pose: its line from the fingertips through the forearm (0.25-0.45 m from them; nearer
  // the armpit the cut slants and pulls the middle out)
  const [, d0] = fitLine(armPts);
  const fore = mul(add(ring(tipP, d0, -0.25), ring(tipP, d0, -0.45)), 0.5);
  const up = unit(sub(fore, tipP));
  // the shoulder joint: 5 cm under the shoulder's top (its highest point 15-19 cm out, the drawn body's joint is 4 cm
  // under its own), on that line
  let top = 0;
  for (let v = 0; v < m; v++) {
    const p = V[v], x = side * p[0];
    if (limb[v] !== ARM && x > 0.15 && x < 0.19 && Math.abs(p[2]) < 0.08) top = Math.max(top, p[1]);
  }
  const yJ = top - 0.05;
  const onLine = add(tipP, mul(up, (yJ - tipP[1]) / up[1]));
  const shoulder = [side * Math.min(0.21, Math.max(0.14, side * onLine[0])), yJ, Math.min(0.03, Math.max(-0.06, onLine[2]))];
  // the elbow and the wrist: the arm's rings at the game's proportions (shoulder to fingertips 0.728 m: the elbow at
  // 0.3, the wrist at 0.555)
  const reach = unit(sub(tipP, shoulder)), tip = dot(sub(tipP, shoulder), reach);
  const elbow = ring(shoulder, reach, (tip * UPPER_ARM) / ARM_TIP);
  const wrist = ring(shoulder, reach, (tip * (UPPER_ARM + FOREARM)) / ARM_TIP);
  const ud = unit(sub(elbow, shoulder)), fd = unit(sub(wrist, elbow));
  const elbowT = len(sub(elbow, shoulder)), wristLen = len(sub(wrist, elbow));

  // the leg's axis, between the shins and the crotch; the hip joint on it at the drawn body's height (a pair of jeans
  // hangs its crotch lower than the body's, so the crotch doesn't say where the hips are: the legs are only
  // straightened, not stretched)
  const legPts = [];
  for (let v = 0; v < m; v++) if (limb[v] === LEG && limbSide[v] === k && V[v][1] > 0.2 && V[v][1] < crotchY - 0.04) legPts.push(V[v]);
  const [lc, ld] = fitLine(legPts);
  const onLeg = (y) => add(lc, mul(ld, (y - lc[1]) / ld[1]));
  const hip = onLeg(HIP_Y), ankle = onLeg(ANKLE_H);
  const knee = mul(add(hip, ankle), 0.5);
  return { shoulder, armDir: ud, elbowT, elbow, foreDir: fd, wristLen, tip, hip, knee, ankle };
});

// the chin: up the front of the neck (the middle 5 cm), where the profile steps out to the chin. The drawn body's head
// bone takes over from 1.52 m (torsoSkin), but a model's chin can sit lower, and its jaw would then stay with the chest.
let chinY = 1.52;
{
  const front = new Map();
  for (const p of V) if (Math.abs(p[0]) < 0.025 && p[1] > 1.35 && p[1] < 1.65) front.set(Math.round(p[1] * 100), Math.max(front.get(Math.round(p[1] * 100)) ?? -1, p[2]));
  for (let b = 138; b < 160; b++) {
    const lo = front.get(b - 1), hi = front.get(b + 1);
    if (lo !== undefined && hi !== undefined && hi - lo > 0.025) {
      chinY = b / 100;
      break;
    }
  }
}
// the jaw's line, from under the chin (10 cm forward) rising to the nape (8 cm back), and the head's weight across it
const headWeight = (p) => {
  const jaw = chinY + ((0.1 - p[2]) * 0.07) / 0.18;
  return smoothstep(jaw - 0.035, jaw + 0.01, p[1]);
};

// the game's joints
const game = SIDES.map((side) => {
  const sh = [side * SHOULDER[0], SHOULDER[1], SHOULDER[2]];
  const dir = [side * Math.sin(ABDUCTION), -Math.cos(ABDUCTION), 0];
  return {
    shoulder: sh,
    armDir: dir,
    elbow: add(sh, mul(dir, UPPER_ARM)),
    hip: [side * HIP_X, HIP_Y, 0],
    knee: [side * HIP_X, ANKLE_H + SHIN, 0],
    ankle: [side * HIP_X, ANKLE_H, 0]
  };
});

// ---- the weights: by the drawn body's rules, then blurred over the surface ----
const W = Array.from({ length: m }, () => new Float32Array(15));
const put = (w, [a, b, wb], f = 1) => {
  w[a] += (1 - wb) * f;
  w[b] += wb * f;
};
// a height on the model's leg to the game's (ankle, knee and hip matched; above the hip, as it is)
function legY(y, j) {
  if (y <= ANKLE_H) return y;
  if (y <= j.knee[1]) return ANKLE_H + ((y - ANKLE_H) / (j.knee[1] - ANKLE_H)) * SHIN;
  if (y <= j.hip[1]) return ANKLE_H + SHIN + ((y - j.knee[1]) / (j.hip[1] - j.knee[1])) * THIGH;
  return HIP_Y + (y - j.hip[1]);
}
for (let v = 0; v < m; v++) {
  const p = V[v], w = W[v];
  const k = p[0] >= 0 ? 0 : 1, side = SIDES[k], j = joints[k];
  // an arm: below its armpit, or above it along the arm from the shoulder and near its axis (the shoulder's cap)
  const rel = sub(p, j.shoulder), t = dot(rel, j.armDir), r = len(sub(rel, mul(j.armDir, t)));
  const isArm = limb[v] === ARM ? limbSide[v] === k : p[1] >= armpit[k] - 0.01 && t > -0.06 && r < 0.075 && side * p[0] > 0.1;
  if (isArm) {
    const d = t <= j.elbowT ? (t * UPPER_ARM) / j.elbowT : UPPER_ARM + (dot(sub(p, j.elbow), j.foreDir) * FOREARM) / j.wristLen;
    put(w, armSkin(d, k));
    continue;
  }
  if (p[1] < Math.max(crotchY + 0.14, HIP_Y + 0.06)) {
    // a leg (both, blended across the middle above the crotch)
    const left = limb[v] === LEG ? (limbSide[v] === 0 ? 1 : 0) : smoothstep(-0.03, 0.03, p[0]);
    for (let kk = 0; kk < 2; kk++) {
      const f = kk === 0 ? left : 1 - left;
      if (f <= 0) continue;
      const jj = joints[kk], y = legY(p[1], jj);
      if (y < 0.105) {
        put(w, shoeSkin(p[2] - jj.ankle[2], kk), f);
      } else {
        put(w, legSkin(y, kk), f);
      }
    }
    continue;
  }
  put(w, p[1] > 1.4 ? [B.CHEST, B.HEAD, headWeight(p)] : torsoSkin(p[1]));
}
// the blur: each vertex towards its neighbours' mean, a few times (about a centimetre a time)
{
  const next = Array.from({ length: m }, () => new Float32Array(15));
  for (let it = 0; it < 6; it++) {
    for (let v = 0; v < m; v++) {
      const o = next[v], nb = nbrs[v];
      for (let b = 0; b < 15; b++) {
        let s = 0;
        for (const u of nb) s += W[u][b];
        o[b] = nb.length ? 0.5 * W[v][b] + (0.5 * s) / nb.length : W[v][b];
      }
    }
    for (let v = 0; v < m; v++) W[v].set(next[v]);
  }
}
// the two heaviest bones
const skin = new Float32Array(m * 3);
for (let v = 0; v < m; v++) {
  let a = 0, b = -1;
  for (let i = 1; i < 15; i++) if (W[v][i] > W[v][a]) a = i;
  for (let i = 0; i < 15; i++) if (i !== a && (b < 0 || W[v][i] > W[v][b])) b = i;
  const wa = W[v][a], wb = W[v][b];
  if (wb < 0.02 * wa) skin.set([a, a, 0], v * 3);
  else skin.set([a, b, wb / (wa + wb)], v * 3);
}

// ---- reposed into the game's bind pose: each bone's own transform, blended by the weights ----
// (a limb's bone turns the model's limb onto the game's, about its upper joint, stretched along it to the game's length;
// the feet only move with the ankle, so they stay flat; the torso and head stay as they are)
const bones = Array.from({ length: 15 }, () => ({ from: [0, 0, 0], to: [0, 0, 0], rot: IDENTITY, axis: [0, 1, 0], stretch: 1 }));
for (let k = 0; k < 2; k++) {
  const j = joints[k], gj = game[k];
  bones[B.UA[k]] = { from: j.shoulder, to: gj.shoulder, rot: rotation(j.armDir, gj.armDir), axis: j.armDir, stretch: UPPER_ARM / j.elbowT };
  bones[B.FA[k]] = { from: j.elbow, to: gj.elbow, rot: rotation(j.foreDir, gj.armDir), axis: j.foreDir, stretch: FOREARM / j.wristLen };
  const legDir = unit(sub(j.ankle, j.hip)), legRot = rotation(legDir, [0, -1, 0]);
  bones[B.TH[k]] = { from: j.hip, to: gj.hip, rot: legRot, axis: legDir, stretch: THIGH / len(sub(j.knee, j.hip)) };
  bones[B.SH[k]] = { from: j.knee, to: gj.knee, rot: legRot, axis: legDir, stretch: SHIN / len(sub(j.ankle, j.knee)) };
  for (const b of [B.FT[k], B.TO[k]]) bones[b] = { from: j.ankle, to: gj.ankle, rot: IDENTITY, axis: [0, 1, 0], stretch: 1 };
}
const moved = (b, p) => {
  const bone = bones[b];
  const u = sub(p, bone.from);
  const along = dot(u, bone.axis);
  return add(bone.to, apply(bone.rot, add(u, mul(bone.axis, along * (bone.stretch - 1)))));
};
const R = V.map((p, v) => {
  const [a, b, w] = skin.subarray(v * 3, v * 3 + 3);
  return add(mul(moved(a, p), 1 - w), mul(moved(b, p), w));
});
for (let i = 0; i < n; i++) {
  const v = canon[i];
  P.set(R[v], i * 3);
  const [a, b, w] = skin.subarray(v * 3, v * 3 + 3);
  const nn = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  N.set(unit(add(mul(apply(bones[a].rot, nn), 1 - w), mul(apply(bones[b].rot, nn), w))), i * 3);
}
posA.setArray(P);
norA.setArray(N);
const SKIN = new Float32Array(n * 4);
for (let i = 0; i < n; i++) SKIN.set([...skin.subarray(canon[i] * 3, canon[i] * 3 + 3), 0], i * 4);
prim.setAttribute('_SKIN', doc.createAccessor('skin').setType('VEC4').setArray(SKIN).setBuffer(posA.getBuffer()));

console.log(`${m} vertices, scale ${scale.toFixed(3)}, crotch ${crotchY.toFixed(3)} m, chin ${chinY.toFixed(2)} m, armpits ${armpit.map((y) => y.toFixed(3)).join(' / ')} m`);
for (let k = 0; k < 2; k++) {
  const j = joints[k];
  console.log(`${k ? 'right' : 'left'}: shoulder (${fmt(j.shoulder)}) elbow (${fmt(j.elbow)}) forearm ${j.wristLen.toFixed(3)} tip ${j.tip.toFixed(3)} m, upper arm (${fmt(j.armDir)}) forearm (${fmt(j.foreDir)}); hip (${fmt(j.hip)}) knee (${fmt(j.knee)}) ankle (${fmt(j.ankle)})`);
}

// --debug: the vertices coloured by their heavier bone, front and side, before and after
if (debug) {
  const S = 500, Wd = S * 4, img = Buffer.alloc(Wd * S * 3, 255);
  const hue = (b) => [[200, 200, 200], [120, 120, 120], [60, 60, 60], [230, 40, 40], [250, 160, 40], [40, 90, 230], [40, 200, 230], [40, 170, 60], [150, 220, 80], [130, 60, 20], [220, 120, 200], [160, 40, 160], [120, 100, 200], [90, 50, 20], [240, 200, 230]][b];
  const dot2 = (u, y, o, c) => {
    const px = Math.round(S / 2 + u * S * 0.5) + o, py = Math.round(S * 0.97 - y * S * 0.53);
    if (px < o || px >= o + S || py < 0 || py >= S) return;
    img.set(c, (py * Wd + px) * 3);
  };
  for (let v = 0; v < m; v++) {
    const c = hue(skin[v * 3 + 2] > 0.5 ? skin[v * 3 + 1] : skin[v * 3]);
    dot2(V[v][0], V[v][1], 0, c);
    dot2(V[v][2], V[v][1], S, c);
    dot2(R[v][0], R[v][1], 2 * S, c);
    dot2(R[v][2], R[v][1], 3 * S, c);
  }
  await sharp(img, { raw: { width: Wd, height: S, channels: 3 } }).png().toFile(debug);
}

// ---- simplified, its far level, its texture ----
await MeshoptSimplifier.ready;
const mesh = meshes[0].setName('person');
for (const nd of doc.getRoot().listNodes()) if (nd.getMesh() === mesh) nd.setName('person');
await doc.transform(weld());
const count = (ms) => ms.listPrimitives().reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
const tris = count(mesh);
console.log(`${tris} triangles from Meshy`);
simplifyPrimitive(mesh.listPrimitives()[0], { simplifier: MeshoptSimplifier, ratio: Math.min(1, faces / tris), error: 0.0005 });
const farPrim = mesh.listPrimitives()[0].clone();
for (const sem of farPrim.listSemantics()) farPrim.setAttribute(sem, farPrim.getAttribute(sem).clone());
farPrim.setIndices(farPrim.getIndices().clone());
const farMesh = doc.createMesh('lod1').addPrimitive(farPrim);
doc.getRoot().listScenes()[0].addChild(doc.createNode('lod1').setMesh(farMesh));
simplifyPrimitive(farMesh.listPrimitives()[0], { simplifier: MeshoptSimplifier, ratio: Math.min(1, far / count(mesh)), error: 0.05 });
for (const ms of [mesh, farMesh]) console.log(`${ms.getName()}: ${count(ms)} triangles`);

for (const tex of doc.getRoot().listTextures()) {
  const img = tex.getImage();
  if (!img) continue;
  const jpg = await sharp(Buffer.from(img)).resize({ width: texture, height: texture, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
}
for (const mat of doc.getRoot().listMaterials()) mat.setMetallicFactor(0).setRoughnessFactor(0.85).setNormalTexture(null).setMetallicRoughnessTexture(null);
await doc.transform(prune());
await io.write(out, doc);
console.log('wrote', out);
