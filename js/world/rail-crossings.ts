// js/world/rail-crossings.ts
// The level crossings' signals (railway.ts levelCrossings): at each, by the right-hand curb of either approach, a mast
// with its crossbuck, its two red lamps on their black backplate, its bell, and its gate across the approach's lanes.
// While a train closes the crossing (sim/trains.ts) the lamps flash in turn and the gates come down; once its tail is
// past they go up again. The masts are one merged mesh, standing on the ground; the lamps & the gates instanced.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { abs, attribute, color, float, fract, mix, step, smoothstep } from 'three/tsl';
import { liftAt } from './ground.ts';
import { part } from '../actors/vehicles/loft.ts';
import { cityUniforms } from '../render/tsl-materials.ts';
import type { LevelCrossing } from './railway.ts';

const MAST_H = 4.2; // m
const CURB = 0.7; // m out from the road's edge a mast stands
const LAMP_Y = 2.75; // m: the lamps' height
const LAMP_GAP = 0.36; // m either side of the mast
const GATE_Y = 1.05; // m: the gate's pivot
const GATE_RATE = 0.5; // of the way up or down a second (~2 s down, as the crossings' gates)

/** One approach's signal: its crossing, where its mast stands (m), the way the approach comes (yaw, rad: the mast's
 *  face towards it), the gate's length (m) and how far down it is (0 up, 1 across the road) */
interface Signal {
  crossing: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  gate: number;
  down: number;
}

// The signal in its own frame, the road coming from -z towards it: the mast, the crossbuck's two boards, the lamps'
// backplate & hoods, the bell, the gate's mechanism. Parts: 0 the galvanised steel, 1 the crossbuck's white, 2 black
function signalGeometry(): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  g.push(part(new THREE.CylinderGeometry(0.075, 0.09, MAST_H, 10).translate(0, MAST_H / 2, 0), 0));
  g.push(part(new THREE.CylinderGeometry(0.3, 0.35, 0.18, 12).translate(0, 0.09, 0), 0)); // its foot
  for (const a of [Math.PI / 4, -Math.PI / 4]) g.push(part(new THREE.BoxGeometry(1.22, 0.23, 0.03).rotateZ(a).translate(0, 3.6, -0.11), 1));
  g.push(part(new THREE.BoxGeometry(2 * LAMP_GAP + 0.5, 0.5, 0.04).translate(0, LAMP_Y, -0.1), 2)); // the backplate
  g.push(part(new THREE.BoxGeometry(2 * LAMP_GAP + 0.1, 0.06, 0.06).translate(0, LAMP_Y - 0.35, -0.04), 0)); // its arm
  for (const s of [-1, 1]) g.push(part(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 12, 1, true, -Math.PI / 2, Math.PI)
    .rotateX(Math.PI / 2).translate(s * LAMP_GAP, LAMP_Y + 0.02, -0.2), 2)); // the hoods
  g.push(part(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, MAST_H + 0.02, 0), 2)); // the bell
  g.push(part(new THREE.BoxGeometry(0.45, 0.7, 0.35).translate(0.3, GATE_Y - 0.1, 0.05), 0)); // the gate's mechanism
  return mergeGeometries(g);
}

let _signalMat: THREE.MeshStandardNodeMaterial | null = null;
function signalMaterial(): THREE.MeshStandardNodeMaterial {
  if (_signalMat) return _signalMat;
  const id = attribute('partId', 'float');
  const is = (k: number) => step(abs(id.sub(k)), 0.25);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(mix(color(0x9a9ea2), color(0xf0f0ec), is(1)), color(0x141414), is(2));
  mat.roughnessNode = mix(float(0.5), float(0.7), is(1));
  mat.metalnessNode = mix(float(0.6), float(0), is(1).add(is(2)));
  _signalMat = mat;
  return mat;
}

/**
 * The signals of `crossings` into `scene`. update(closed, dt): the lamps flashing at those closed (closed[i]: the
 * crossing i), the gates coming down there and going up elsewhere
 */
function buildRailCrossings(scene: THREE.Object3D, crossings: readonly LevelCrossing[]) {
  const group = new THREE.Group();
  group.name = 'RailCrossings';
  scene.add(group);
  const signals: Signal[] = [];
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i];
    // each way's approach: its mast on its right-hand curb, `clear` back from the line (and the traffic stopping
    // short of it, sim/traffic/rail-crossings.ts)
    for (const way of [1, -1]) {
      const rx = c.rx * way, rz = c.rz * way; // the way the approach comes
      const sx = -rz, sz = rx; // its right
      const back = c.clear + 0.5, out = c.half + CURB;
      const x = c.x - rx * back + sx * out, z = c.z - rz * back + sz * out;
      signals.push({ crossing: i, x, y: liftAt(x, z), z, yaw: Math.atan2(rx, rz), gate: Math.max(2.5, c.half + CURB - 0.3), down: 0 });
    }
  }
  const n = Math.max(1, signals.length);
  // the masts, merged in place
  const base = signalGeometry();
  const placed = signals.map((s) => base.clone().applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), new THREE.Vector3(1, 1, 1))));
  if (placed.length) {
    const masts = new THREE.Mesh(mergeGeometries(placed), signalMaterial());
    masts.name = 'RailCrossings:masts';
    masts.castShadow = true;
    masts.receiveShadow = true;
    group.add(masts);
  }
  // the lamps: two discs a signal, flashing in turn while closed (lampOn: 0 off, 1 the first of the pair, 2 the other)
  const lampGeo = new THREE.CircleGeometry(0.13, 14);
  const lampOn = new Float32Array(n * 2);
  lampGeo.setAttribute('lampOn', new THREE.InstancedBufferAttribute(lampOn, 1));
  const on = attribute('lampOn', 'float');
  const flash = step(0.5, fract(cityUniforms.uClock.mul(0.95).add(on.mul(0.5))));
  const lit = step(0.5, on).mul(flash);
  const lampMat = new THREE.MeshStandardNodeMaterial();
  lampMat.colorNode = mix(color(0x3a0806), color(0xe00c06), lit);
  lampMat.emissiveNode = color(0xff0a04).mul(lit.mul(float(2.5).add(smoothstep(0.3, 1.0, cityUniforms.uInteriorGlow).mul(4))));
  lampMat.roughnessNode = float(0.3);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, n * 2);
  lamps.name = 'RailCrossings:lamps';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
  signals.forEach((s, k) => {
    // (facing the approach: the disc's +z towards -z of the signal's frame)
    q.setFromAxisAngle(up, s.yaw + Math.PI);
    for (const side of [0, 1]) {
      const lx = (side ? 1 : -1) * LAMP_GAP, lz = -0.13;
      at.set(s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), s.y + LAMP_Y + 0.02, s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw));
      lamps.setMatrixAt(k * 2 + side, m.compose(at, q, one));
    }
  });
  lamps.count = signals.length * 2;
  lamps.frustumCulled = false;
  group.add(lamps);
  // the gates: a boom 1 m long along +x from its pivot, scaled to each one's length, its red & white stripes
  const gateGeo = new THREE.BoxGeometry(1, 0.1, 0.07).translate(0.5, 0, 0);
  const gateLen = new Float32Array(n);
  gateGeo.setAttribute('gateLen', new THREE.InstancedBufferAttribute(gateLen, 1));
  const gx = attribute('position', 'vec3').x.mul(attribute('gateLen', 'float'));
  const gateMat = new THREE.MeshStandardNodeMaterial();
  gateMat.colorNode = mix(color(0xf2f2ee), color(0xc8161a), step(0.5, fract(gx.div(1.2))));
  gateMat.roughnessNode = float(0.5);
  const gates = new THREE.InstancedMesh(gateGeo, gateMat, n);
  gates.name = 'RailCrossings:gates';
  gates.castShadow = true;
  gates.frustumCulled = false;
  signals.forEach((s, k) => { gateLen[k] = s.gate; });
  gates.count = signals.length;
  group.add(gates);
  const e = new THREE.Euler();
  const scale = new THREE.Vector3();
  // gate k's matrix: up (along the mast) to down (across the approach, leftwards from the curb), by s.down
  const placeGate = (s: Signal, k: number) => {
    // its pivot by the mechanism, at the road's side of the mast (the signal's +x: the approach's left, across the road)
    const px = 0.3, pz = -0.2;
    at.set(s.x + px * Math.cos(s.yaw) + pz * Math.sin(s.yaw), s.y + GATE_Y, s.z - px * Math.sin(s.yaw) + pz * Math.cos(s.yaw));
    // (raised, it is turned up about the approach's axis)
    e.set(0, s.yaw, (1 - s.down) * (Math.PI / 2) * 0.97, 'YXZ');
    q.setFromEuler(e);
    scale.set(s.gate, 1, 1);
    gates.setMatrixAt(k, m.compose(at, q, scale));
  };
  signals.forEach(placeGate);
  gates.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;

  const lampAttr = lampGeo.getAttribute('lampOn');
  function update(closed: readonly boolean[], dt: number): void {
    let lampsChanged = false, gatesMoved = false;
    for (let k = 0; k < signals.length; k++) {
      const s = signals[k], shut = closed[s.crossing] ?? false;
      const want = shut ? 1 : 0;
      if (lampOn[k * 2] !== want) {
        lampOn[k * 2] = want;
        lampOn[k * 2 + 1] = shut ? 2 : 0;
        lampsChanged = true;
      }
      const target = shut ? 1 : 0;
      if (s.down !== target) {
        s.down = target > s.down ? Math.min(1, s.down + GATE_RATE * dt) : Math.max(0, s.down - GATE_RATE * dt);
        placeGate(s, k);
        gatesMoved = true;
      }
    }
    if (lampsChanged && lampAttr instanceof THREE.BufferAttribute) lampAttr.needsUpdate = true;
    if (gatesMoved) gates.instanceMatrix.needsUpdate = true;
  }
  console.info(`[railway] ${crossings.length} level crossings, ${signals.length} signals`);
  return { group, update };
}

type RailCrossingsBuild = ReturnType<typeof buildRailCrossings>;

export type { RailCrossingsBuild };
export { buildRailCrossings };
