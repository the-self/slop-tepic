// js/player/controllers/car-drive.ts
// The car in Jolt Physics (car-physics.ts): its drive (drivetrain.ts) and steering set before the world's step,
// its body read back after it, its crashes, brake lamps and smoke; its body's definition, and the gearbox keys
import { createDriveState, stepDrive } from '../drivetrain.ts';
import { enginePower } from '../vehicle-damage.ts';
import { wash } from '../car-blood.ts';
import { suspensionOf, steerLimit } from '../car-physics.ts';
import { EJECT_SPEED, FUEL_IDLE, FUEL_BURN } from './constants.ts';
import { TOPE_H } from '../../world/topes.ts';
import type { DriveInput, DriveSpec, DriveState } from '../drivetrain.ts';
import type { CarDamage } from '../vehicle-damage.ts';
import type { CarBodyDef, CarPhysics, PhysicsVehicle, VehicleOut } from '../car-physics.ts';
import type { HeldGearKeys, CarWheel, CarEntity, CyclistEntity, MotoEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

const STEER_IN = 5; // 1/s the wheels turn towards the lock asked (~0.2 s)...
const STEER_BACK = 10; // ...and back towards the middle
const SLIDE = 0.05; // rad (~3°) of sideways slide before the steering catches it
// A flat tyre (shot, a spike strip: CarDamage flats): a front one pulls the steering FLAT_PULL rad its way; each drags
// FLAT_DRAG m/s² against its going (four of them: a crawl); drawn squashed by FLAT_SINK of its radius
const FLAT_PULL = 0.03;
const FLAT_SINK = 0.18;
const FLAT_DRAG = 0.9;
// A tope taken fast (car-drive.ts topeHit): from TOPE_EASY m/s the axle striking it kicks the body up and pitches it,
// harder the faster, as the springs bottom out on a hump of poured concrete
const TOPE_EASY = 4; // m/s (~15 km/h): slower, the springs take it
const TOPE_HEAVE = 0.07; // m/s up per m/s over TOPE_EASY
const TOPE_PITCH = 0.05; // rad/s per m/s over TOPE_EASY
const TOPE_MAX = 2.6; // m/s up at most

// The car: a rigid body on its sprung wheels in Jolt Physics (car-physics.ts, set up by app/install/player.ts before
// the first frame). Before the world's step (stepVehicles): what the traffic did to it since the last one carried over,
// and drivetrain.ts's drive for its tyres. Not `driving`, it stands (or rolls on, its driver thrown out) on its own
export function driveCar(ctl: ThirdPersonControllerManager, dt: number, driving: boolean): void {
  const c = ctl.entities.car;
  const P = ctl.carPhysics;
  if (!P) return;
  const spec = c.spec;
  const d = (c.drive ??= createDriveState(spec));
  const dmg = c.damage;
  // what hit it since the last frame (the traffic and the street furniture push it about after it has moved); with
  // nobody in it, nothing to compare with when someone gets back in
  if (driving) ctl.checkImpact(c);
  else c.impactArmed = false;

  const throttle = driving ? Number(ctl.keys.forward) || 0 : 0;
  const brake = driving ? Number(ctl.keys.backward) || 0 : 0;
  const handbrake = driving && Boolean(ctl.keys.handbrake);
  const shift = driving ? ctl.gearKeys(c, d) : 0;

  const sn0 = Math.sin(c.heading), cs0 = Math.cos(c.heading);
  if (!c.vehicle || c.physicsLook !== c.look) {
    if (c.vehicle) P.remove(c.vehicle);
    c.vehicle = P.add(ctl.carBodyDef(c, spec), c.position.x, c.position.y, c.position.z, c.heading);
    c.physicsLook = c.look;
    c.physicsPlaced = false;
  }
  const v = c.vehicle;
  const out = (c.bodyOut ??= { x: 0, z: 0, vx: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
  if (!c.physicsPlaced) {
    // set down where it stands (on the kerb if it is on one: the ground Jolt is given), moving as it was
    const y = ctl.getGroundHeight(c.position.x, c.position.z, 'person', c.position.y + 0.5);
    P.place(v, c.position.x, y, c.position.z, c.heading);
    P.shove(v, sn0 * c.speed + c.vx, 0, cs0 * c.speed + c.vz, 0, 0, 0);
    c.physicsPlaced = true;
  } else if (driving) {
    // the traffic's shove (traffic.ts collideWithPlayer moves the car and changes its velocity, spin & sway)
    const dvx = sn0 * c.speed + c.vx - out.vx, dvz = cs0 * c.speed + c.vz - out.vz;
    const pitch = (c.pitchVel || 0) * 0.35, roll = (c.rollVel || 0) * 0.35;
    // (the sway about the car's own axes: its left (cos h, 0, -sin h) and its nose (sin h, 0, cos h))
    P.shove(v, dvx, Math.min(1.5, (c.heaveVel || 0) * 0.3), dvz,
      cs0 * pitch + sn0 * roll, c.angularVel || 0, -sn0 * pitch + cs0 * roll,
      c.position.x - out.x, c.position.z - out.z);
  }
  c.angularVel = c.pitchVel = c.rollVel = c.heaveVel = 0;

  const u = P.read(v).forward;
  const input: DriveInput = (c.driveInput ??= {});
  input.throttle = throttle;
  input.brake = brake;
  input.handbrake = false; // (Jolt's own: it locks the rear wheels)
  input.nitro = driving && Boolean(ctl.keys.boost);
  input.shift = shift;
  input.slope = 0; // (gravity is Jolt's)
  // in a flood: over ~0.55 m the water is in the air intake and the engine dies until it is out of it
  const water = ctl.waterAt && !c.flying ? ctl.waterAt(c.position.x, c.position.z) : 0;
  c.drowned = water > 0.55;
  // its fuel burnt driving (with the engine running: someone in it); none left, the engine dies (world/gas-stations.ts)
  if (driving && c.fuel > 0) {
    c.fuel = Math.max(0, c.fuel - dt * (FUEL_IDLE + FUEL_BURN * throttle));
    if (c.fuel <= 0) ctl.onFuelOut?.();
  }
  input.power = c.drowned || c.fuel <= 0 ? 0 : enginePower(dmg);
  input.grip = ctl.roadGrip * (water > 0.15 ? 0.75 : 1);
  let force = ctl.driveForce(d, spec, input, u, water, dt);
  // a flat tyre's rim dragging on the road: FLAT_DRAG m/s² each, against its going (no more than stops it)
  if (dmg.flats) {
    let n = 0;
    for (let b = dmg.flats; b; b >>= 1) n += b & 1;
    force -= Math.sign(u) * Math.min(Math.abs(u) * spec.mass / dt, spec.mass * FLAT_DRAG * n);
  }

  let steerInput = 0;
  if (driving && ctl.keys.left) steerInput = Number(ctl.keys.left);
  if (driving && ctl.keys.right) steerInput = -Number(ctl.keys.right);
  // The steering, a game's (the keys are all or nothing): the wheels turn no more than the front tyres hold at this
  // speed (steerLimit), in over STEER_IN's ~0.2 s and back twice as quick; sliding sideways going forward, they point
  // the way it goes, as a driver catches it (less the slide's first SLIDE rad); a bent front corner pulls it aside
  const lock = steerLimit(spec.steerLock, spec.wheelbase, spec.grip * input.grip, u);
  const sideways = c.vx * cs0 - c.vz * sn0; // m/s to its left
  const slide = u > 3 ? Math.atan2(sideways, u) : 0;
  const catchIt = Math.sign(slide) * Math.max(0, Math.abs(slide) - SLIDE) * Math.min(1, (u - 3) / 5);
  const target = Math.max(-spec.steerLock, Math.min(spec.steerLock, steerInput * lock + catchIt));
  const back = Math.abs(target) < Math.abs(c.steerAngle) || target * c.steerAngle < 0;
  c.steerAngle += (target - c.steerAngle) * Math.min(1, dt * (back ? STEER_BACK : STEER_IN));
  // (a flat front tyre drags its side back: the car pulls that way)
  let flatPull = 0;
  if (dmg.flats) c.wheels.forEach((w, i) => { if (w.isFront && (dmg.flats >> i) & 1) flatPull += w.side * FLAT_PULL; });
  const steer = c.steerAngle + (dmg.pull + flatPull) * Math.min(1, Math.abs(u) / 5);

  const body = v.out;
  const before = (c.before ??= { vx: 0, vy: 0, vz: 0 });
  before.vx = body.vx; before.vy = body.vy; before.vz = body.vz;
  const speed = Math.hypot(body.vx, body.vy, body.vz);
  const go = (v.input ??= { force: 0 });
  go.force = force;
  go.airDrag = 0.5 * 1.2 * spec.dragArea * speed * speed;
  go.steer = Math.max(-1, Math.min(1, -steer / spec.steerLock)); // (Jolt's: +1 full right)
  go.handbrake = handbrake;
  go.hold = !throttle && !brake && Math.abs(u) < 0.5;
  go.grip = spec.grip * input.grip;
  go.spinning = d.wheelspin;
  go.assist = driving; // (the stability control: car-physics.ts stabilise, off while the handbrake swings it round)
  go.flats = dmg.flats;
  const frame = (c.frame ??= { throttle: 0, steer: 0, water: 0 });
  frame.throttle = throttle;
  frame.steer = steer;
  frame.water = water;
}

// drivetrain.ts's step for a vehicle moving at `u` m/s along itself, as the force (N) that makes it: its drive and
// what slows it, and the water's drag on it pushing through a flood (its depth & the speed squared)
export function driveForce(d: DriveState, spec: DriveSpec, input: DriveInput, u: number, water: number, dt: number): number {
  let next = stepDrive(d, spec, input, u, dt);
  if (water > 0.03) next -= Math.sign(next) * Math.min(Math.abs(next), 0.09 * Math.min(water, 1) * next * next * dt + water * 2.5 * dt);
  return spec.mass * (next - u) / dt;
}

// One step of Jolt's world (the car, the moto, the people thrown about), the walls fed in round the player
export function stepVehicles(ctl: ThirdPersonControllerManager, dt: number): void {
  const P = ctl.carPhysics;
  if (!P) return;
  const focus = (ctl._physicsFocus ??= { x: 0, y: 0, z: 0 });
  const at = ctl.getActiveEntity().position;
  focus.x = at.x;
  focus.y = at.y;
  focus.z = at.z;
  P.step(dt, focus);
}

// Where Jolt's step left vehicle `ent` (the car or the moto, its body `v`): held inside the map's edges and the shore,
// as everyone is (keepInBounds), then its position, heading and velocity in the game's terms (speed along it, slip
// across it), and its pose for its mesh
export function followBody(ctl: ThirdPersonControllerManager, ent: CarEntity | CyclistEntity | MotoEntity, v: PhysicsVehicle): VehicleOut {
  const o = v.out;
  const pos = (ctl._bodyBounds ??= { x: 0, z: 0 });
  pos.x = o.x;
  pos.z = o.z;
  if (ctl.keepInBounds(pos)) ctl.carPhysics?.confine(v, pos.x, pos.z, o.vx * 0.4, o.vz * 0.4);
  ent.position.set(o.x, o.y, o.z);
  ent.heading = o.heading;
  const sn = Math.sin(ent.heading), cs = Math.cos(ent.heading);
  ent.speed = o.vx * sn + o.vz * cs;
  ent.vx = o.vx - sn * ent.speed;
  ent.vz = o.vz - cs * ent.speed;
  ent.vy = o.vy;
  ent.flying = o.contacts === 0;
  const out = (ent.bodyOut ??= { x: 0, z: 0, vx: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
  out.x = o.x; out.z = o.z; out.vx = o.vx; out.vz = o.vz;
  out.qx = o.qx; out.qy = o.qy; out.qz = o.qz; out.qw = o.qw;
  return o;
}

// An axle of car `c` (its body `v`) coming onto a tope's hump (world/topes.ts topeBumps) faster than TOPE_EASY: its
// body kicked up and pitched, the front throwing the nose up, the rear the tail, and the camera jolted; by a row of
// boyas less, as much less as they are lower. (The hump is in the ground it rides too, but at 0.5 m between the
// ground's samples its springs barely feel 12 cm of it)
function topeHit(ctl: ThirdPersonControllerManager, c: CarEntity, v: PhysicsVehicle): void {
  const bump = ctl.bumpAt;
  if (!bump || c.flying) {
    c.onTope = 0;
    return;
  }
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading), axle = c.halfL * 0.65;
  // (bit 0 the front axle, 1 the rear)
  const on = (bump(c.position.x + sn * axle, c.position.z + cs * axle) > 0 ? 1 : 0) | (bump(c.position.x - sn * axle, c.position.z - cs * axle) > 0 ? 2 : 0);
  const fast = Math.abs(c.speed) - TOPE_EASY, struck = on & ~(c.onTope ?? 0);
  c.onTope = on;
  if (!struck || fast <= 0 || !ctl.carPhysics) return;
  // how high it is: its crest, within half a metre along of the axle that struck it
  const k = struck & 1 ? 1 : -1;
  let crest = 0;
  for (let a = -0.5; a <= 0.5; a += 0.125) crest = Math.max(crest, bump(c.position.x + sn * (axle * k + a), c.position.z + cs * (axle * k + a)));
  const hard = crest / TOPE_H;
  // (about its left (cos, 0, -sin): + raises its nose; the rear axle the other way)
  const pitch = TOPE_PITCH * fast * hard * -k * Math.sign(c.speed);
  ctl.carPhysics.shove(v, 0, Math.min(TOPE_MAX, TOPE_HEAVE * fast) * hard, 0, cs * pitch, 0, -sn * pitch);
  c.cameraKick = Math.max(c.cameraKick || 0, Math.min(0.8, (fast / 18) * Math.max(hard, 0.6)));
}

// After the step: the car's body's pose, speed and wheels read back; a knock the body itself took is a crash
export function carMoved(ctl: ThirdPersonControllerManager, dt: number, driving: boolean): void {
  const c = ctl.entities.car;
  const v = c.vehicle;
  // (frame, drive & before: set by driveCar with the body)
  if (!v || !c.frame || !c.drive || !c.before) return;
  const { throttle, steer, water } = c.frame;
  const o = ctl.followBody(c, v);
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
  const slip = Math.hypot(c.vx, c.vz);
  c.drifting = slip > 2.2 && Math.abs(c.speed) > 5 && !c.flying;

  // A crash: the body itself (not its tyres) struck something, a wall, a pole, a parked car or the ground (on its
  // roof), coming at it ctl fast
  const hit = o.hit;
  if (hit.speed > 1.5) {
    const hx = c.position.x - hit.nx * c.halfL * 0.9, hz = c.position.z - hit.nz * c.halfL * 0.9;
    // (it hurts whoever is in it: nobody, when it rolls on alone; a car of the traffic thrown about in Jolt, traffic.ts
    // crash, as hard as a car)
    const other = hit.other?.owner;
    if (driving) ctl.reportCollision(c, other || (ctl._wall ??= { type: 'building' }), other ? 'vehicle' : 'building', hx, c.position.y + 0.56, hz, hit.nx, 0, hit.nz, hit.speed);
    ctl.impactCar(c, hit.nx * hit.speed, hit.nz * hit.speed);
    c.cameraKick = Math.max(c.cameraKick || 0, Math.min(1, (hit.speed - 1.5) / 14)); // (cameras.ts speedEffects)
    if (hit.speed > 2.2) c.lastCollisionSpark = { x: hx, y: 0.56, z: hz, nx: hit.nx, nz: hit.nz, speed: hit.speed };
    // head on (what it hit faces its nose) and hard: out through the windscreen
    if (driving && hit.speed > EJECT_SPEED && hit.nx * sn + hit.nz * cs < -0.7) ctl.ejectDriver(c, c.before, hit.speed);
  }
  // a kerb taken fast, a landing: its springs struck their stops (car-physics.ts strike), a jolt but no crash
  if (o.bump > 0.3) c.cameraKick = Math.max(c.cameraKick || 0, Math.min(0.6, o.bump / 5));
  topeHit(ctl, c, v);

  // the wheels: on their springs, steered, rolling
  const flats = c.damage.flats;
  o.wheels.forEach((w, i) => {
    const wheel = c.wheels[i] as CarWheel | undefined; // (Jolt's may outnumber the drawn ones)
    if (!wheel) return;
    // a flat tyre squashed under the rim, sparks off the rim on the road at speed
    const flat = (flats >> i) & 1;
    const r = wheel.restY ?? 0.33;
    wheel.steerPivot.position.y = w.y - (flat ? r * FLAT_SINK : 0);
    wheel.steerPivot.scale.y = flat ? 1 - FLAT_SINK : 1;
    if (flat && w.contact && Math.abs(c.speed) > 6 && Math.random() < dt * 12) {
      const p = wheel.steerPivot.position;
      c.lastCollisionSpark = {
        x: c.position.x + p.x * cs + p.z * sn, y: 0.12, z: c.position.z - p.x * sn + p.z * cs,
        nx: -sn * Math.sign(c.speed), nz: -cs * Math.sign(c.speed), speed: Math.abs(c.speed) * 0.4
      };
    }
    wheel.tire.rotation.x = w.spin;
    if (wheel.isFront) wheel.steerPivot.rotation.y = steer;
  });
  ctl.carEffects(c, c.drive, c.damage, throttle, c.speed, slip, water, dt);
  // heavy rain washing its stains off (ctl.rain: app/weather-effects.ts, the rain falling, 0..1)
  if (c.bloody && c.blood && (ctl.rain || 0) > 0.35) {
    c.bloody = wash(c.stains, dt, ctl.rain);
    ctl.showBlood(c);
  }
}

// The brake lamps, and the smoke: the engine's once it is damaged (grey, then black), the tyres' when they slide or
// spin, the spray off a wet road; `u` the car's speed along itself, `slip` across it (m/s)
export function carEffects(ctl: ThirdPersonControllerManager, c: CarEntity, d: DriveState, dmg: CarDamage, throttle: number, u: number, slip: number, water: number, dt: number): void {
  const braking = d.braking || (c.speed === 0 && !throttle) ? 1 : 0;
  if (c.carState) c.carState.value.x = braking;
  const lamps = c.kit?.lamps;
  if (lamps && lamps.array[0] !== braking) {
    lamps.array[0] = braking;
    lamps.needsUpdate = true;
  }
  const e = dmg.engine;
  if (e > 0.4) ctl.emitSmoke(c, 0, 0.95, (c.zFront || 2.2) - 0.75, dt * (e >= 1 ? 16 : (e - 0.4) * 22), e >= 0.85 ? 0.1 : 0.5 - e * 0.4, 0.9);
  if ((c.drifting || d.wheelspin) && Math.abs(u) > 1.5) {
    const rate = dt * (d.wheelspin ? 18 : Math.min(26, slip * 4));
    for (const side of [-0.75, 0.75]) ctl.emitSmoke(c, side, 0.18, -1.35, rate * 0.5, 0.86, 1.25);
  }
  // On a wet road the tyres throw up a spray behind them, more the faster it goes
  if (water > 0.05 && Math.abs(u) > 2) {
    const rate = dt * Math.min(30, Math.abs(u) * 2.2) * Math.min(1, water * 3);
    for (const side of [-0.95, 0.95]) ctl.emitSmoke(c, side, 0.2, 1.6, rate * 0.5, 0.78, 1.1);
  }
  if ((ctl.roadWet || 0) > 0.25 && !c.flying && Math.abs(u) > 6) {
    const rate = dt * Math.min(14, (Math.abs(u) - 6) * 0.9) * ctl.roadWet;
    for (const side of [-0.8, 0.8]) ctl.emitSmoke(c, side, 0.12, -1.5, rate * 0.5, 0.94, 0.8);
  }
}

// Jolt's vehicles (car-physics.ts), from app/install/player.ts before the game starts
export function setCarPhysics(ctl: ThirdPersonControllerManager, physics: CarPhysics | null | undefined): void {
  ctl.carPhysics = physics ?? null;
  ctl.entities.car.vehicle = null;
  ctl.entities.moto.vehicle = null;
}

// What the car's body is: its model's mass, its footprint & height, its wheels where they stand on the body, and
// springs & anti-roll bars by its class (trucks & SUVs soft and leaning, sports cars & supercars flat)
export function carBodyDef(c: CarEntity, spec: DriveSpec): CarBodyDef {
  const [springHz, roll] = suspensionOf(spec.cls);
  const height = c.bodyHeight || 1.45;
  return {
    kind: 'car', mass: spec.mass, halfW: c.halfW, halfL: c.halfL, height, cg: height * (c.kit?.wheels ? 0.4 : 0.36),
    steerLock: spec.steerLock, drive: spec.drive, springHz, roll,
    wheels: c.wheels.map((w) => ({
      x: w.steerPivot.position.x, z: w.steerPivot.position.z, radius: (w.restY ??= w.steerPivot.position.y), front: w.isFront
    }))
  };
}

// E / Q shift (and switch to the manual gearbox), T goes back and forth between automatic and manual: the shift
// ctl frame (+1, -1 or 0), from the keys' presses (not their holding)
export function gearKeys(ctl: ThirdPersonControllerManager, ent: CarEntity | MotoEntity, d: DriveState): number {
  const held = (ent.heldKeys ??= { shiftUp: false, shiftDown: false, gearbox: false });
  const pressed = (key: keyof HeldGearKeys) => {
    const now = Boolean(ctl.keys[key]);
    const edge = now && !held[key];
    held[key] = now;
    return edge;
  };
  const shift = (pressed('shiftUp') ? 1 : 0) - (pressed('shiftDown') ? 1 : 0);
  if (pressed('gearbox')) d.manual = !d.manual;
  return shift;
}
