// js/player/controllers/two-wheelers.ts
// The moto and the bicycle in Jolt Physics (car-physics.ts): their drive, steering and brakes before the world's
// step, their bodies read back after it, their riders thrown off or stepping off, parked on their stands
import { createDriveState, pedalForce } from '../drivetrain.ts';
import { groundCollider, THROW_SPEED, DOWN_LEAN, BRAKE_LIMIT, BICYCLE_BODY } from './constants.ts';
import type { DriveInput } from '../drivetrain.ts';
import type { TwoWheelerDef } from '../car-physics.ts';
import type { CyclistEntity, MotoEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// A moto's or bicycle's rider thrown off it (a crash `impact` m/s hard, a fall at speed, or `bail`: jumping off it at
// that speed, boarding.ts leaveVehicle) as a ragdoll, from the seat as they sat, going on at its speed and over the
// bars; it slides on alone, nobody balancing it (twoWheelerMoved)
export function ejectRider(ctl: ThirdPersonControllerManager, m: CyclistEntity | MotoEntity, impact: number, bail = false): void {
  const p = ctl.entities.person;
  if (!ctl.ragdolls || p.ragdoll || !m.vehicle) return;
  const o = m.vehicle.out;
  const k = Math.min(1, impact / 20);
  ctl.throwPlayer(m.position.x, m.position.z, m.heading, m.position.y, m.riderRig,
    { vx: o.vx * 0.95, vy: Math.max(0, o.vy) + 1.5 + 2.5 * k, vz: o.vz * 0.95, spin: 3 + 4 * k, bleed: Math.min(1, impact / 16) });
  ctl.carPhysics?.unseat(m.vehicle);
  m.loose = true;
  m.restTime = 0;
  ctl.onEject?.(impact, m.position.x, m.position.z, m.type, bail);
}

// A moto or bicycle gone over at a crawl: its rider steps off it as it falls, on their feet, and it lies down on its
// own
export function stepOff(ctl: ThirdPersonControllerManager, m: CyclistEntity | MotoEntity): void {
  const p = ctl.entities.person;
  const side = m.leanAngle > 0 ? 1 : -1; // (off on its high side: to its left when it falls to its right)
  const x = m.position.x + Math.cos(m.heading) * 0.8 * side, z = m.position.z - Math.sin(m.heading) * 0.8 * side;
  if (m.vehicle) ctl.carPhysics?.unseat(m.vehicle);
  m.loose = true;
  m.restTime = 0;
  ctl.setMode('person');
  ctl.resetInput();
  p.heading = m.heading;
  p.position.set(x, ctl.getGroundHeight(x, z, 'person', m.position.y + 1), z);
  ctl.settle(p);
  ctl.onEject?.(0, x, z, m.type);
}

// The moto and the bicycle: rigid bodies on two sprung wheels in Jolt (car-physics.ts). The moto's drive is its
// model's engine & gearbox's (drivetrain.ts, like the car's), the bicycle's its rider's legs (pedalForce); either
// way the rider leans it into its turns as far as they need, rides the wheelie a strong moto pulls, brakes mostly on
// the front (S) or locks the rear and slides it round (Space). A body is in the world only while it is ridden, and
// after its rider is thrown off until it lies still; parked, it stands on its stand. Before the world's step: its
// drive, steering & brakes, the traffic's shove carried over
export function driveTwoWheeler(ctl: ThirdPersonControllerManager, m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
  const P = ctl.carPhysics;
  if (!P) return;
  if (!riding) {
    if (m.vehicle && !m.loose) ctl.parkTwoWheeler(m);
    return;
  }
  const moto = m.type === 'moto';
  const spec = moto ? m.spec : BICYCLE_BODY;
  // (back on it after a fall: stood up again where it lies)
  if (m.loose || m.fallen) ctl.parkTwoWheeler(m);
  if (!m.vehicle) {
    m.position.y = ctl.getGroundHeight(m.position.x, m.position.z, m.type, m.position.y + 0.5);
    m.vehicle = P.add(ctl.twoWheelerDef(m, spec), m.position.x, m.position.y, m.position.z, m.heading);
    m.leanPivot.rotation.z = 0; // (it leans with its body now)
    m.physicsPlaced = false;
  }
  const v = m.vehicle;
  const sn = Math.sin(m.heading), cs = Math.cos(m.heading);
  m.shoved = 0;
  if (!m.physicsPlaced) {
    P.place(v, m.position.x, m.position.y, m.position.z, m.heading);
    P.shove(v, sn * m.speed, 0, cs * m.speed, 0, 0, 0);
    m.physicsPlaced = true;
  } else if (m.bodyOut) {
    // the traffic's shove (traffic.ts collideWithPlayer moves it and takes its speed; bodyOut: followBody's)
    const o = m.bodyOut;
    const dvx = sn * m.speed + m.vx - o.vx, dvz = cs * m.speed + m.vz - o.vz;
    m.shoved = Math.hypot(dvx, dvz);
    P.shove(v, dvx, 0, dvz, 0, 0, 0, m.position.x - o.x, m.position.z - o.z);
  }

  const throttle = Number(ctl.keys.forward) || 0;
  const brake = Number(ctl.keys.backward) || 0;
  const u = P.read(v).forward;
  // (in a flood the water drags at it; over a moto's exhaust, ~0.4 m, its engine dies until it is out)
  const water = ctl.waterAt ? ctl.waterAt(m.position.x, m.position.z) : 0;
  const grip = ctl.roadGrip * (water > 0.15 ? 0.75 : 1);
  let force: number;
  if (moto) {
    const d = (m.drive ??= createDriveState(m.spec));
    const input: DriveInput = (m.driveInput ??= {});
    input.throttle = throttle;
    input.brake = brake;
    input.handbrake = false; // (Jolt's: the rear wheel locked)
    input.nitro = Boolean(ctl.keys.boost);
    input.shift = ctl.gearKeys(m, d);
    input.slope = 0; // (gravity is Jolt's)
    m.drowned = water > 0.4;
    input.power = m.drowned ? 0 : 1;
    input.grip = grip;
    force = ctl.driveForce(d, m.spec, input, u, water, dt);
  } else {
    // pedalling (walking it back on S from a standstill); rim brakes in the wet bite later; a flood's water drags
    const pedal = throttle || -brake;
    force = pedalForce(pedal, Boolean(ctl.keys.boost) && ctl.canSprint, u, spec.mass, grip);
    if (water > 0.03) force -= Math.sign(u) * spec.mass * Math.min(Math.abs(u) / dt, 4 * Math.min(0.6, water) * Math.abs(u));
    m.pedalling = pedal > 0;
  }

  // the bars turned towards the keys' side, quickly but not at once (Jolt's lean limit, car-physics.ts, keeps it
  // to what the tyres hold at speed)
  let steerInput = 0;
  if (ctl.keys.left) steerInput = Number(ctl.keys.left);
  if (ctl.keys.right) steerInput = -Number(ctl.keys.right);
  m.steerInput += (steerInput - m.steerInput) * Math.min(1, dt * 7);
  const speed = Math.hypot(v.out.vx, v.out.vy, v.out.vz);
  const go = (v.input ??= { force: 0 });
  go.force = force;
  go.airDrag = 0.5 * 1.2 * spec.dragArea * speed * speed;
  go.steer = -m.steerInput; // (Jolt's: +1 full right)
  go.handbrake = Boolean(ctl.keys.handbrake);
  go.hold = !throttle && !brake && Math.abs(u) < 0.5;
  go.grip = spec.grip * grip;
  go.spinning = Boolean(moto && m.drive?.wheelspin);
}

// After the step: a two-wheeler's body's pose, speed and wheels read back; its rider thrown off by a hard crash or a
// fall at speed; once nobody rides it and it lies still, out of the world, lying where it fell
export function twoWheelerMoved(ctl: ThirdPersonControllerManager, m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
  const v = m.vehicle;
  if (!v) return;
  const o = ctl.followBody(m, v);
  m.leanAngle = o.lean;
  m.shadow.rotation.z = -o.lean; // (its contact shadow stays on the ground under it as it leans)
  const rear = o.wheels.at(0), front = o.wheels.at(1); // (none before its first step)
  if (rear && front) {
    m.rearWheel.position.y = rear.y;
    m.rearWheel.rotation.x = rear.spin;
    // (the front wheel slides up its fork, about the steering pivot)
    m.frontWheel.position.set(0, front.y, front.z - m.steerPivot.position.z);
    m.frontWheel.rotation.x = front.spin;
    m.steerPivot.rotation.y = front.steer;
    if (m.type === 'cyclist') {
      // the cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
      // freewheel otherwise; the rider's feet follow the pedals (poseCharacters)
      // (Jolt keeps the wheel's angle within a turn: the step across its wrap taken the short way)
      const step = rear.spin - (m.lastSpin ?? rear.spin);
      const turned = step - 2 * Math.PI * Math.round(step / (2 * Math.PI));
      m.lastSpin = rear.spin;
      if (m.pedalling && riding && turned > 0) m.pedalPhase += turned / 3.2;
      m.crankPivot.rotation.x = m.pedalPhase;
      for (const pedal of m.pedals) pedal.rotation.x = -m.pedalPhase;
    }
  }
  if (m.loose) {
    // on its own: lying still a moment, it stays where it is, out of Jolt
    const still = Math.hypot(o.vx, o.vy, o.vz) < 0.25 && Math.hypot(o.wx, o.wy, o.wz) < 0.3;
    m.restTime = still ? m.restTime + dt : 0;
    if (m.restTime > 1) {
      ctl.carPhysics?.remove(v);
      m.vehicle = null;
      m.loose = false;
      m.fallen = Math.abs(o.lean) > 0.6;
      if (!m.fallen) ctl.settle(m); // (left upright: back on its stand)
    }
    return;
  }
  if (!riding) return;
  const sn = Math.sin(m.heading), cs = Math.cos(m.heading);
  const hit = o.hit;
  let thrown = 0;
  if (hit.speed > 1.5) {
    const hx = m.position.x - hit.nx * 0.9, hz = m.position.z - hit.nz * 0.9;
    const other = hit.other?.owner;
    ctl.reportCollision(m, other || (ctl._wall ??= { type: 'building' }), other ? 'vehicle' : 'building', hx, m.position.y + 0.6, hz, hit.nx, 0, hit.nz, hit.speed);
    m.cameraKick = Math.max(m.cameraKick || 0, Math.min(1, (hit.speed - 1.5) / 10));
    if (hit.speed > 2.2) m.lastCollisionSpark = { x: hx, y: 0.5, z: hz, nx: hit.nx, nz: hit.nz, speed: hit.speed };
    // head on (what it hit faces its front wheel) at ~30 km/h, or anything that hard from any side: over the bars
    const headOn = hit.nx * sn + hit.nz * cs < -0.5;
    if (hit.speed > (headOn ? THROW_SPEED : THROW_SPEED * 1.5)) thrown = hit.speed;
  }
  // stopped short (whatever it met, however it touched it: its speed gone faster than any brakes take it), or knocked
  // off by the traffic
  m.peak = Math.max(m.speed, (m.peak ?? m.speed) - BRAKE_LIMIT * dt);
  const lost = m.peak - m.speed;
  if (lost > THROW_SPEED * 0.85) thrown = Math.max(thrown, lost);
  if (m.shoved > THROW_SPEED * 0.8) thrown = Math.max(thrown, m.shoved);
  // down on its side: at speed the rider goes sliding and tumbling after it, slower they step off as it goes over
  const along = Math.hypot(o.vx, o.vz);
  const down = Math.abs(o.lean) > DOWN_LEAN && o.contacts < 2;
  if (down && !thrown && along > THROW_SPEED) {
    ctl.reportCollision(m, groundCollider, 'ground', m.position.x, m.position.y + 0.3, m.position.z, 0, 1, 0, along);
    thrown = along;
  }
  // tyre smoke off a moto's locked or spinning rear wheel, or its tyres sliding across the road
  const slip = Math.hypot(m.vx, m.vz);
  if (m.type === 'moto' && rear?.contact && Math.abs(m.speed) > 2 && (ctl.keys.handbrake || m.drive?.wheelspin || slip > 1.5)) {
    ctl.emitSmoke(m, 0, 0.15, m.wheelSpots.rear, dt * Math.min(16, 4 + slip * 3 + Math.abs(m.speed) * 0.3) * 0.5, 0.86, 0.9);
  }
  if (thrown) ctl.ejectRider(m, thrown);
  else if (down) ctl.stepOff(m);
}

// A two-wheeler's body taken out of Jolt: standing on its stand where it is
export function parkTwoWheeler(ctl: ThirdPersonControllerManager, m: CyclistEntity | MotoEntity): void {
  if (m.vehicle) ctl.carPhysics?.remove(m.vehicle);
  m.vehicle = null;
  m.loose = m.fallen = false;
  m.restTime = 0;
  ctl.settle(m);
}

// What a two-wheeler's body is: its mass with its rider, its wheels where they stand (`wheelSpots`: the rear's on a
// swing arm or the frame, the front's fork raked back), the bike up to its seat and its rider over it, their centre of
// mass a little behind the middle (the rider's weight on the seat). The moto's ~0.72 m up: it leans to ~47° and lifts
// its front wheel at ~0.75 g; the bicycle's ~1 m (a light frame, its rider sitting high). (Its body reaches over its
// tyres' ends: what it rides into, it hits, rather than its front wheel climbing it)
export function twoWheelerDef(m: CyclistEntity | MotoEntity, spec: { mass: number }): TwoWheelerDef {
  const { radius, rear, front, caster, travel } = m.wheelSpots;
  const moto = m.type === 'moto';
  return {
    kind: 'two-wheeler', mass: spec.mass, halfW: moto ? 0.17 : 0.12, halfL: Math.max(-rear, front) + radius + 0.03,
    height: moto ? 0.9 : 0.85, cg: moto ? 0.72 : 1.0, cgZ: moto ? -0.12 : -0.1,
    rider: moto ? [0, 1.18, -0.22, 0.2, 0.32, 0.22] : [0, 1.3, -0.12, 0.2, 0.38, 0.2],
    steerLock: 0.6, drive: 'rwd', springHz: moto ? 2.2 : 3.5, wheelMass: moto ? 10 : 1.8,
    wheels: [
      { x: 0, z: rear, radius, front: false, travel: travel * 0.8 },
      { x: 0, z: front, radius, front: true, caster, travel }
    ]
  };
}
