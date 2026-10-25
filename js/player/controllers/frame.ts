// js/player/controllers/frame.ts
// The player's frame: the active mode moved, the vehicles' Jolt bodies driven, stepped and read back in that order,
// the meshes posed, the lamps lit, and the skinned characters posed last
import { cityUniforms } from '../../render/tsl-materials.ts';
import { HEADLIGHTS } from '../../actors/vehicle-lights.ts';
import { personGround } from './constants.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
// where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
// pedals, helmet on its head
export function poseCharacters(ctl: ThirdPersonControllerManager, dt: number): void {
  const p = ctl.entities.person;
  if (ctl.activeMode === 'person') {
    const air = p.position.y - ctl.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    // (a ragdoll's pose is its own, sim/ragdolls.ts)
    if (!p.ragdoll) p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, ctl, air > 0.02 ? air : 0);
    p.crowd.begin();
    p.crowd.add(p.rig, 0);
    p.crowd.end();
  }

  const m = ctl.entities.moto;
  if (ctl.activeMode === 'moto') {
    // the moto's rider: feet on the pegs (a crank of no length), hands on the bars
    m.riderRig.ride(m.leanPivot, 0, m.bikeFrame);
    m.riderCrowd.begin();
    m.riderCrowd.add(m.riderRig, 0);
    m.riderCrowd.end();
    const { headQuaternion, headPosition } = m.riderRig; // (ride() has just set them)
    if (headQuaternion && headPosition) {
      m.helmet.quaternion.copy(headQuaternion);
      m.helmet.position.set(0, 0.16, 0).applyQuaternion(m.helmet.quaternion).add(headPosition);
    }
  }

  const b = ctl.entities.cyclist;
  if (ctl.activeMode !== 'cyclist') return;
  b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
  b.riderCrowd.begin();
  b.riderCrowd.add(b.riderRig, 0);
  b.riderCrowd.end();
  const { headQuaternion, headPosition } = b.riderRig;
  if (!headQuaternion || !headPosition) return;
  b.helmet.quaternion.copy(headQuaternion);
  b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(headPosition);
}

export function update(ctl: ThirdPersonControllerManager, dt: number, elapsed: number): void {
  const heli = ctl.entities.helicopter;
  // the rotor winds up in a few seconds with the pilot aboard and runs down once parked
  const flying = ctl.activeMode === 'helicopter';
  ctl.rotorSpin += ((flying ? 24 : 0) - ctl.rotorSpin) * Math.min(1, dt * (flying ? 1.6 : 0.5));
  heli.mainRotorPivot.rotation.y += dt * ctl.rotorSpin;
  heli.tailRotorPivot.rotation.x += dt * ctl.rotorSpin * 1.33;
  const active = ctl.getActiveEntity();
  const prevX = active.position.x;
  const prevZ = active.position.z;

  if (ctl.activeMode === 'person') {
    // (riding in a friend's car, net/multiplayer.ts: the walker waits where it got in, out of sight)
    if (!ctl.seated) ctl.updatePerson(dt);
  } else {
    // The pedestrian rides along (out of sight) in the vehicle it got into
    const p = ctl.entities.person;
    p.position.copy(active.position);
    p.heading = active.heading;
    p.speed = 0;
  }
  // A bicycle left standing leans on its kickstand
  const bike = ctl.entities.cyclist;
  // ...and a moto on its side stand (one fallen over, or still sliding along on its side, lies as it is)
  const moto = ctl.entities.moto;
  for (const two of (ctl._twoWheelers ??= [bike, moto])) {
    if (ctl.activeMode !== two.type && !two.vehicle && !two.fallen) two.leanPivot.rotation.z = two.leanAngle = two.standLean;
  }

  // (the mode ctl frame began in: a driver thrown out mid-frame is not stepped again on foot)
  const mode = ctl.activeMode;
  if (mode === 'helicopter') ctl.updateHelicopter(dt, elapsed);
  // The car, the moto and the bicycle are bodies in Jolt (car-physics.ts): their drives set, the world steps once
  // (the people thrown about with them), and where it left them is read back. The car stands (or rolls on, its driver
  // thrown out) with nobody in it
  ctl.driveCar(dt, mode === 'car');
  ctl.driveTwoWheeler(moto, dt, mode === 'moto');
  ctl.driveTwoWheeler(bike, dt, mode === 'cyclist');
  ctl.stepVehicles(dt);
  ctl.carMoved(dt, mode === 'car');
  ctl.twoWheelerMoved(moto, dt, mode === 'moto');
  ctl.twoWheelerMoved(bike, dt, mode === 'cyclist');
  // (the vehicles meet the hills in Jolt: a slope their tyres can't climb, they can't)
  if (mode === 'person' || mode === 'helicopter') ctl.keepOffHills(active, prevX, prevZ);
  if (ctl.activeMode === 'car' && active.type === 'car') ctl.recordVelocity(active);
  ctl.updateSmoke(dt);

  for (const e of Object.values(ctl.entities)) {
    e.mesh.position.copy(e.position);
    e.mesh.rotation.y = e.heading;
  }
  // the vehicles as their bodies lie, pitched, rolled, leant over, on a roof or a side (carMoved, twoWheelerMoved),
  // driven or not; a moto or bicycle once it has come to rest on its side
  for (const e of (ctl._bodied ??= [ctl.entities.car, moto, bike])) {
    const q = e.type === 'car' || e.vehicle || e.fallen ? e.bodyOut : null;
    if (!q) continue;
    e.mesh.rotation.order = 'YXZ'; // (so its Euler y is its heading, as for the other entities)
    e.mesh.quaternion.set(q.qx, q.qy, q.qz, q.qw);
  }
  // the walker's contact shadow lies on the slope under it
  if (ctl.activeMode === 'person') {
    const p = ctl.entities.person;
    const t = ctl.groundTilt(p.position.x, p.position.z, p.heading, 0.45, 0.45, (ctl._tilt ??= { pitch: 0, roll: 0 }), p.position.y);
    p.shadow.rotation.set(t.pitch, 0, t.roll, 'YXZ');
  }

  // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
  const glow = cityUniforms.uInteriorGlow.value;
  const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
  const car = ctl.entities.car;
  for (const spot of car.headLights) {
    // Accelerating does not change the headlamp output or range.
    spot.intensity = HEADLIGHTS.intensity * beamScale;
  }
  const bikeActive = ctl.activeMode === 'cyclist';
  bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
  moto.headLight.intensity = ctl.activeMode === 'moto' ? 260 * beamScale : 0;

  ctl.poseCharacters(dt);
}
