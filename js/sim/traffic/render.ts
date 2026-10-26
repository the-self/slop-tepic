// js/sim/traffic/render.ts
// Drawing the cars and camiones each frame: instance slots, wheels, lamp states, and the clustered headlights and
// police lights of the nearest
import * as THREE from 'three/webgpu';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from '../../actors/vehicle-lights.ts';
import { BODY_SPECS, BUS_SPEC } from '../../actors/actor-models.ts';
import { clamp } from './constants.ts';
import type { Bus, Car, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import type { ModelBody, ModelLevel } from './meshes.ts';
import { lodFor } from '../../actors/vehicles/car-files.ts';
import { surfaceAt } from './surface.ts';
import { visible } from './view.ts';
import { placeCrashedWheels } from './crashes.ts';

// (A car model of its own is drawn at its level of detail before that: car-files.ts lodFor.)
// Beyond CAR_PROXY_DISTANCE, cars use the ~250-triangle stand-in with built-in wheels instead of the full lofted
// body + 4 separate wheel instances; vehicles outside the view frustum (with a margin for cast shadows and headlight
// cones) are skipped altogether.
const CAR_PROXY_DISTANCE = 90;

const HEADLIGHT_POOL_SIZE = 96;
const POLICE_LIGHT_POOL_SIZE = 6;
const MAX_LIGHT_DIST = 115;
const MAX_LIGHT_DIST_SQ = MAX_LIGHT_DIST * MAX_LIGHT_DIST;

// The clustered headlight SpotLights and police PointLights, parked out of sight until updateTrafficLights hands them out
function createLightPools(group: THREE.Group) {
  const trafficLightsGroup = new THREE.Group();
  trafficLightsGroup.name = 'TrafficClusteredLights';
  group.add(trafficLightsGroup);

  const headlightPool: THREE.SpotLight[] = [];
  for (let i = 0; i < HEADLIGHT_POOL_SIZE; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    trafficLightsGroup.add(spot, spot.target);
    headlightPool.push(spot);
  }

  const policeLightPool: THREE.PointLight[] = [];
  for (let i = 0; i < POLICE_LIGHT_POOL_SIZE; i++) {
    const pt = new THREE.PointLight(0xff1828, 0, 12.0, 1.25);
    pt.position.set(0, -1000, 0);
    trafficLightsGroup.add(pt);
    policeLightPool.push(pt);
  }
  return { headlightPool, policeLightPool };
}

function flagRange(attr: THREE.BufferAttribute, n: number) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}
// ...by name, of a geometry given it as an InstancedBufferAttribute (paintColor, carState)
function flagAttribute(geo: THREE.BufferGeometry, name: string, n: number) {
  const attr = geo.getAttribute(name);
  if (attr instanceof THREE.BufferAttribute) flagRange(attr, n);
}

// 3D spinning alloy wheels & tires (left & right, front & rear), exact 1:1 ground rolling, steering front wheels.
// The wheel geometry is modelled at baseRadius (the sedan's 0.35 m car wheel), scaled to the vehicle's radius
// (mid: the axles' middle ahead of the origin, m: a car model's file has its wheels where its maker put them)
function placeWheels(ts: TrafficState, v: Vehicle, i: number, rotY: number, roll: number, radius: number, halfTrack: number, halfBase: number, leftInst: THREE.InstancedMesh, rightInst: THREE.InstancedMesh, baseRadius = 0.35, mid = 0): void {
  const sinY = Math.sin(rotY);
  const cosY = Math.cos(rotY);
  const scale = radius / baseRadius;
  ts.dummy.scale.set(scale, scale, scale);
  const rise = -Math.tan(v.gp || 0); // the ground's rise per metre ahead
  for (let w = 0; w < 2; w++) {
    const wz = mid + (w === 0 ? halfBase : -halfBase);
    const y = radius + (v.hy || 0) + wz * rise;
    ts.dummy.rotation.set(v.wheelSpin + w * 0.55, rotY + (w === 0 ? v.steer : 0), roll, 'YXZ');
    ts.dummy.position.set(v.x - halfTrack * cosY + wz * sinY, y, v.z + halfTrack * sinY + wz * cosY);
    ts.dummy.updateMatrix();
    leftInst.setMatrixAt(i * 2 + w, ts.dummy.matrix);

    ts.dummy.position.set(v.x + halfTrack * cosY + wz * sinY, y, v.z - halfTrack * sinY + wz * cosY);
    ts.dummy.updateMatrix();
    rightInst.setMatrixAt(i * 2 + w, ts.dummy.matrix);
  }
}

// Lamp state for the car & bus materials: brake lights while slowing down or standing, the turn signal on the side
// v is heading for (left = +x)
function writeLampState(ts: TrafficState, v: Vehicle, array: THREE.TypedArray, o: number): void {
  const blinkOn = v.blink !== 0 && (ts.clock + v.blinkPhase) % 0.8 <= 0.4;
  array[o] = v.acc < -0.8 || v.speed < 0.3 ? 1 : 0;
  array[o + 1] = blinkOn && v.blink < 0 ? 1 : 0;
  array[o + 2] = blinkOn && v.blink > 0 ? 1 : 0;
}

function renderCar(ts: TrafficState, c: Car): void {
  const rotY = c.yaw + c.yawOffset;
  const sinY = Math.sin(rotY);
  const cosY = Math.cos(rotY);
  const spec = BODY_SPECS[c.bodyType];
  // (its model's own body, once its file has loaded, and its wheels' size)
  const model = c.model ? ts.modelBodies.get(c.model.id) : undefined;
  const wheelR = model?.wheels?.radius ?? spec.wheelRadius * c.sw;
  const forwardDist = (c.x - c.prevX) * sinY + (c.z - c.prevZ) * cosY;
  const rawStep = forwardDist / wheelR;
  c.wheelSpin = (c.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
  if (ts.hasView && !visible(ts, c.x, c.z, 18, (c.hy || 0) + 1)) return;

  const dist = Math.hypot(c.x - ts.focusX, c.z - ts.focusZ), near = dist < CAR_PROXY_DISTANCE;
  // (a model of its own near the camera: at its real size already, its wheels its file's; no crumpling)
  // (its level by distance, car-files.ts lodFor)
  const own = near && model ? model.levels[lodFor(dist, model.levels.length)] : undefined;
  const bodyInst = own?.mesh ?? (near ? ts.bodies[c.bodyType].near : ts.bodies[c.bodyType].far);
  const slot = bodyInst.count++;

  ts.dummy.position.set(c.x, c.hy || 0, c.z);
  // (a crashed car as its body lies in Jolt)
  if (c.crash) ts.dummy.quaternion.set(c.crash.body.out.qx, c.crash.body.out.qy, c.crash.body.out.qz, c.crash.body.out.qw);
  else ts.dummy.rotation.set(c.pitch + (c.gp || 0), rotY, c.roll, 'YXZ');
  if (own) ts.dummy.scale.set(1, 1, 1);
  else ts.dummy.scale.set(c.sx, c.sy, c.sz); // (the body shape stretched to the model's size)
  ts.dummy.updateMatrix();
  bodyInst.setMatrixAt(slot, ts.dummy.matrix);
  if (c.isPolice) ts.policeLightbarInst.setMatrixAt(ts.policeDrawn++, ts.dummy.matrix);
  if (c.fleet === 'combi' && c.sign >= 0) {
    ts.combiSignInst.setMatrixAt(ts.combisDrawn, ts.dummy.matrix);
    ts.combiSignRows.array[ts.combisDrawn++] = c.sign;
  }

  const attrs = bodyInst.geometry.attributes;
  const paint = attrs.paintColor.array;
  const o3 = slot * 3;
  if (paint[o3] !== c.paint[0] || paint[o3 + 1] !== c.paint[1] || paint[o3 + 2] !== c.paint[2]) {
    paint[o3] = c.paint[0];
    paint[o3 + 1] = c.paint[1];
    paint[o3 + 2] = c.paint[2];
    ts.dirtyPaint.add(bodyInst);
  }
  const state = attrs.carState.array;
  const o4 = slot * 4;
  const blinkOn = c.blink !== 0 && (ts.clock + c.blinkPhase) % 0.8 <= 0.4;
  const b0 = c.acc < -0.8 || c.speed < 0.3 ? 1 : 0;
  const b1 = blinkOn && c.blink < 0 ? 1 : 0;
  const b2 = blinkOn && c.blink > 0 ? 1 : 0;
  // (the livery, and how crushed it is: 4 × 4 bits, see createLoftedCarMaterial's crumple)
  const dm = c.damage;
  const q = (x: number) => Math.round(Math.min(1, x) * 15);
  const b3 = (c.isPolice ? 1 : 0) + (dm ? 2 * (q(dm.front) + 16 * q(dm.rear) + 256 * q(dm.left) + 4096 * q(dm.right)) : 0);
  if (state[o4] !== b0 || state[o4 + 1] !== b1 || state[o4 + 2] !== b2 || state[o4 + 3] !== b3) {
    state[o4] = b0;
    state[o4 + 1] = b1;
    state[o4 + 2] = b2;
    state[o4 + 3] = b3;
    ts.dirtyState.add(bodyInst);
  }

  // Soft Under-Car Contact Shadow (AO) stays flat on the asphalt (on its slope)
  const visIdx = ts.visibleCars++;
  ts.dummy.rotation.set(c.gp || 0, rotY, 0, 'YXZ');
  // (a crashed car's on what is under it: the street, a bridge's deck, whatever height it is flying at)
  ts.dummy.position.set(c.x, 0.018 + (c.crash ? surfaceAt(ts, c.x, c.z, (c.hy || 0) + 0.5) : c.hy || 0), c.z);
  ts.dummy.scale.set(c.halfWidth * 2 + 0.5, 1.0, c.half * 2 + 0.55);
  ts.dummy.updateMatrix();
  ts.carShadowInst.setMatrixAt(visIdx, ts.dummy.matrix);

  const dxCam = c.x - ts.camX;
  const dyCam = (c.hy || 0) - ts.camY;
  const dzCam = c.z - ts.camZ;
  const distSq = dxCam * dxCam + dyCam * dyCam + dzCam * dzCam;
  if (distSq < MAX_LIGHT_DIST_SQ) {
    const d = Math.sqrt(distSq);
    const forwardDot = dxCam * ts.camFwdX + dzCam * ts.camFwdZ;
    const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
    if (effDist < MAX_LIGHT_DIST) {
      c._camDistSq = distSq;
      c._effDist = effDist;
      c._sinY = sinY;
      c._cosY = cosY;
      c._braking = b0;
      ts.litVehicles[ts.litVehicleCount++] = c;
    }
  }

  if (own && model) {
    placeModelWheels(ts, c, model, own, rotY);
    return;
  }
  if (near && c.crash) placeCrashedWheels(ts, c.crash, ts.wheelCars++, spec.wheelRadius * c.sw);
  else if (near) {
    placeWheels(ts, c, ts.wheelCars++, rotY, c.roll, spec.wheelRadius * c.sw, spec.wheelX * c.sx, spec.wheelZ * c.sz, ts.carWheelLeftInst, ts.carWheelRightInst);
  }
}

// A car model's own wheels (its file's, sim/traffic/meshes.ts): two more on each side, where its file puts them, or
// where its crashed body's are
function placeModelWheels(ts: TrafficState, c: Car, model: ModelBody, own: ModelLevel, rotY: number): void {
  const w = model.wheels, left = own.left, right = own.right;
  if (!w || !left || !right) return;
  const i = left.count >> 1;
  left.count += 2;
  right.count += 2;
  if (c.crash) placeCrashedWheels(ts, c.crash, i, w.radius, w.radius, left, right, model.spots);
  else placeWheels(ts, c, i, rotY, c.roll, w.radius, w.x, (w.front - w.rear) / 2, left, right, w.radius, (w.front + w.rear) / 2);
}

function renderBus(ts: TrafficState, b: Bus): void {
  const rotY = b.yaw + b.yawOffset;
  const sinY = Math.sin(rotY);
  const cosY = Math.cos(rotY);
  const forwardDist = (b.x - b.prevX) * sinY + (b.z - b.prevZ) * cosY;
  const rawStep = forwardDist / BUS_SPEC.wheelRadius;
  b.wheelSpin = (b.wheelSpin + Math.sign(rawStep) * Math.min(Math.abs(rawStep), 0.48)) % (Math.PI * 2);
  if (ts.hasView && !visible(ts, b.x, b.z, 22, (b.hy || 0) + 1)) return;

  const i = ts.visibleBuses++;
  ts.dummy.position.set(b.x, 0.018 + (b.hy || 0), b.z);
  ts.dummy.rotation.set(b.gp || 0, rotY, 0, 'YXZ');
  ts.dummy.scale.set(2.92, 1.0, 12.1);
  ts.dummy.updateMatrix();
  ts.busShadowInst.setMatrixAt(i, ts.dummy.matrix);

  // Lofted Bus Body is defined in ground-relative Y (0.36m skirt to 3.0m roof crown)
  ts.dummy.position.set(b.x, b.hy || 0, b.z);
  ts.dummy.rotation.set(b.pitch + (b.gp || 0), rotY, b.roll, 'YXZ');
  ts.dummy.scale.set(1, 1, 1);
  ts.dummy.updateMatrix();
  ts.busBodyInst.setMatrixAt(i, ts.dummy.matrix);
  ts.busHeaderInst.setMatrixAt(i, ts.dummy.matrix);
  writeLampState(ts, b, ts.busStates.array, i * 4);
  ts.busStates.array[i * 4 + 3] = b.livery;
  ts.busSignRows.array[i] = Math.max(0, b.sign);

  const dxCam = b.x - ts.camX;
  const dyCam = (b.hy || 0) - ts.camY;
  const dzCam = b.z - ts.camZ;
  const distSq = dxCam * dxCam + dyCam * dyCam + dzCam * dzCam;
  if (distSq < MAX_LIGHT_DIST_SQ) {
    const d = Math.sqrt(distSq);
    const forwardDot = dxCam * ts.camFwdX + dzCam * ts.camFwdZ;
    const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
    if (effDist < MAX_LIGHT_DIST) {
      b._camDistSq = distSq;
      b._effDist = effDist;
      b._sinY = sinY;
      b._cosY = cosY;
      b._braking = b.acc < -0.8 || b.speed < 0.3 ? 1 : 0;
      ts.litVehicles[ts.litVehicleCount++] = b;
    }
  }

  placeWheels(ts, b, i, rotY, 0, BUS_SPEC.wheelRadius, BUS_SPEC.wheelX, BUS_SPEC.wheelZ, ts.busWheelLeftInst, ts.busWheelRightInst, BUS_SPEC.wheelRadius);
}

function smoothDistFade(d: number, start: number, end: number): number {
  const t = clamp((end - d) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function updateTrafficLights(ts: TrafficState): void {
  ts.litVehicles.length = ts.litVehicleCount;
  if (ts.litVehicleCount > 1) {
    ts.litVehicles.sort((a, b) => a._effDist - b._effDist);
  }

  const glow = cityUniforms.uInteriorGlow.value;
  // Front headlights are off during Midday (0.24) & Golden Hour (0.48); fade in smoothly for Dusk (1.25) & Night (1.55)
  const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
  const tailScale = clamp(0.18 + glow * 0.66, 0.24, 1.22);

  const maxDualVehicles = HEADLIGHT_POOL_SIZE >> 1;
  const vehCutoff = ts.litVehicleCount > maxDualVehicles
    ? Math.min(MAX_LIGHT_DIST, ts.litVehicles[maxDualVehicles]._effDist)
    : MAX_LIGHT_DIST;
  let spotUsed = 0;
  if (beamScale > 0.001) {
    for (let i = 0; i < ts.litVehicleCount && spotUsed + 2 <= HEADLIGHT_POOL_SIZE; i++) {
      const v = ts.litVehicles[i];
      const fade = smoothDistFade(v._effDist, vehCutoff * 0.62, vehCutoff);
      if (fade <= 0.001) continue;
      const spec = v.bus ? BUS_SPEC : BODY_SPECS[v.bodyType];
      const fullReach = HEADLIGHTS.distance;
      let maxReach = fullReach;
      if (v.pAhead > 0 && v.pAhead < 30) {
        const latWeight = smoothDistFade(Math.abs(v.pRight), 2.2, 5.5);
        const clampedReach = Math.max(4.5, v.pAhead - v.pHalfL - 1.5);
        maxReach = fullReach + (clampedReach - fullReach) * latWeight;
      }

      const baseInt = (v.bus ? HEADLIGHTS.busIntensity : HEADLIGHTS.intensity) * beamScale * fade;
      // Match the body instance, including suspension and impact rotation.
      ts.dummy.position.set(v.x, v.hy || 0, v.z);
      ts.dummy.rotation.set(v.pitch + (v.gp || 0), v.yaw + v.yawOffset, v.roll, 'YXZ');
      if (v.bus) ts.dummy.scale.set(1, 1, 1);
      else ts.dummy.scale.set(v.sx, v.sy, v.sz);
      ts.dummy.updateMatrix();
      for (let side = -1; side <= 1; side += 2) {
        const spot = ts.headlightPool[spotUsed++];
        placeVehicleHeadlight(spot, spec, side, ts.dummy.matrix);
        spot.distance = maxReach;
        spot.intensity = baseInt;
      }
    }
  }
  for (let i = spotUsed; i < HEADLIGHT_POOL_SIZE; i++) {
    const spot = ts.headlightPool[i];
    spot.intensity = 0;
    spot.position.set(0, -1000, 0);
  }

  // 1. NYPD emergency roof lightbar flashes (smoothly pulsing red/blue 360° PointLights on nearby patrol cruisers)
  let policeLightsUsed = 0;
  for (let i = 0; i < ts.litVehicleCount && policeLightsUsed < POLICE_LIGHT_POOL_SIZE; i++) {
    const v = ts.litVehicles[i];
    if (!v.isPolice || v._effDist >= 88) continue;
    const fade = smoothDistFade(v._effDist, 52, 88);
    if (fade <= 0.001) continue;
    const wave = Math.sin((ts.clock + v.blinkPhase) * Math.PI * 6.0);
    const redPhase = wave >= 0;
    const pulse = 0.35 + 0.65 * Math.abs(wave);
    const side = redPhase ? -0.36 : 0.36;
    const pt = ts.policeLightPool[policeLightsUsed++];
    pt.color.setHex(redPhase ? 0xff1828 : 0x1868ff);
    pt.position.set(v.x + side * v._cosY - 0.25 * v._sinY, 1.85 + (v.hy || 0), v.z - side * v._sinY - 0.25 * v._cosY);
    pt.distance = 12.0;
    pt.intensity = 42.0 * tailScale * fade * pulse;
  }
  for (let i = policeLightsUsed; i < POLICE_LIGHT_POOL_SIZE; i++) {
    const pt = ts.policeLightPool[i];
    pt.intensity = 0;
    pt.position.set(0, -1000, 0);
  }
}

export { createLightPools, flagRange, flagAttribute, renderCar, renderBus, updateTrafficLights };
