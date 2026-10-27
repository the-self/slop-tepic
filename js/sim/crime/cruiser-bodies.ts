// js/sim/crime/cruiser-bodies.ts
// The patrol cars, the cartel's and the army's trucks, the fire trucks and the ambulances near the player as cars in
// Jolt (player/car-physics.ts), as the player's own is: a body on four sprung wheels that meets everything in that
// world (the player's car, moto and bicycle, the ones it left standing, the cars of the traffic thrown about in a crash,
// each other, the walls, the poles and the trees, the people thrown about) instead of driving through it. Their
// drivers (crime/cruisers.ts moveCruiser) only work the wheel and the pedals. Farther off, out of sight, they drive on
// the map as before (no body: Jolt's ground and walls are fed in only round what moves in it).
import { steerLimit, suspensionOf } from '../../player/car-physics.ts';
import type { CarBodyDef, CarPhysics, CarStepInput, PhysicsVehicle, VehicleOut } from '../../player/car-physics.ts';
import { wrapAngle } from '../weapons.ts';
import type { Cruiser, Faction } from './types.ts';
import { CRUISER, clamp } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

// m from the player within which a vehicle of the pool takes its body in Jolt (where it can meet the player and what
// the player sends flying: the walls are fed into Jolt 45 m round the player)...
const BODY_NEAR = 90;
const BODY_FAR = 110; // ...and past which it leaves it again
const JUMP = 4; // m: set down somewhere else (sim/emergency.ts brings an ambulance on, out of sight), not moved
const STEER_GAIN = 1.4; // rad of the front wheels per rad its driver is off the way it wants to go
// Height (m) of each kind's body, and its springs as a class of car (player/car-physics.ts suspensionOf)
const HEIGHT: Readonly<Record<Faction, number>> = { police: 1.45, narco: 1.8, army: 1.85, fire: 3.1, ambulance: 2.6 };
const SPRINGS: Readonly<Record<Faction, string>> = { police: 'premium', narco: 'truck', army: 'truck', fire: 'truck', ambulance: 'truck' };

/** A vehicle of the pool in Jolt: its body, its driver's input to it, and its state as it was read (what was done to
 *  it after that, a shove of the traffic's, a blast, is carried into the body before the next step: carryOver) */
export interface CruiserBody {
  v: PhysicsVehicle;
  input: CarStepInput;
  /** m, its origin as read */
  x: number;
  z: number;
  /** rad */
  heading: number;
  /** m/s, its velocity on the ground as read */
  vx: number;
  vz: number;
}

// Its body: its size and weight, its wheels inset from its corners (a truck's bigger), springs by its kind
function cruiserDef(cr: Cruiser): CarBodyDef {
  const [springHz, roll] = suspensionOf(SPRINGS[cr.faction]);
  const height = HEIGHT[cr.faction];
  const radius = cr.mass > 8000 ? 0.52 : cr.faction === 'police' ? 0.34 : 0.4;
  const wx = cr.halfW - 0.16, wz = cr.halfL - Math.max(0.8, cr.halfL * 0.3);
  return {
    kind: 'car', mass: cr.mass, halfW: cr.halfW, halfL: cr.halfL, height, cg: height * 0.38, springHz, roll,
    steerLock: 0.6, drive: 'rwd', rays: true, // (a ray a wheel: several of them in a chase)
    wheels: [
      { x: wx, z: wz, radius, front: true }, { x: -wx, z: wz, radius, front: true },
      { x: wx, z: -wz, radius, front: false }, { x: -wx, z: -wz, radius, front: false }
    ]
  };
}

// Its world velocity on the ground as the game keeps it: its speed along its heading and the slide (vx, vz) besides
function groundVelocity(cr: Cruiser): [vx: number, vz: number] {
  return [Math.sin(cr.heading) * cr.speed + cr.vx, Math.cos(cr.heading) * cr.speed + cr.vz];
}

/**
 * Per frame, before it drives (moveCruiser): its body taken or let go by how far it is from the player, what was done
 * to it since it was last read carried into the body, and its state read back into it (x, z, y, heading, speed along
 * itself, the slide in vx & vz). Returns its body, or null: it drives on the map
 */
export function cruiserBody(crime: CrimeSystem, cr: Cruiser): CruiserBody | null {
  const physics = crime.physics;
  if (!physics) return null;
  const d = Math.hypot(cr.x - crime.px, cr.z - crime.pz);
  let b = cr.body ?? null;
  if (b && d > BODY_FAR) {
    dropCruiserBody(crime, cr);
    return null;
  }
  if (!b) {
    if (d > BODY_NEAR) return null;
    const v = physics.add(cruiserDef(cr), cr.x, crime.groundAt(cr.x, cr.z), cr.z, cr.heading);
    v.owner = cr;
    const [vx, vz] = groundVelocity(cr);
    physics.shove(v, vx, 0, vz, 0, 0, 0);
    b = { v, input: { force: 0, steer: 0, hold: false, grip: 1, assist: true }, x: cr.x, z: cr.z, heading: cr.heading, vx, vz };
    v.input = b.input;
    cr.body = b;
    cr.vy = 0;
    cr.lift = 0;
  } else {
    carryOver(physics, cr, b);
  }
  readBack(cr, b, physics.read(b.v));
  return b;
}

// What was done to it since it was read (the traffic's shove and its own shoving of it, the player's car on foot, a
// blast throwing it): into the body for the next step, as the player's car takes the traffic's (controllers/car-drive.ts)
function carryOver(physics: CarPhysics, cr: Cruiser, b: CruiserBody): void {
  if (Math.hypot(cr.x - b.x, cr.z - b.z) > JUMP || Math.abs(wrapAngle(cr.heading - b.heading)) > 0.3) {
    // set down somewhere else: there, standing
    physics.place(b.v, cr.x, cr.y, cr.z, cr.heading);
    const [vx, vz] = groundVelocity(cr);
    physics.shove(b.v, vx, 0, vz, 0, 0, 0);
    cr.vy = 0;
    return;
  }
  const [vx, vz] = groundVelocity(cr);
  // (a blast's throw: up, spun about its length)
  const spin = cr.vy ? (Math.random() - 0.5) * cr.vy * 0.5 : 0;
  physics.shove(b.v, vx - b.vx, cr.vy, vz - b.vz, Math.cos(cr.heading) * spin, 0, -Math.sin(cr.heading) * spin, cr.x - b.x, cr.z - b.z);
  cr.vy = 0;
}

// Its state read off its body (o), into the game's terms
function readBack(cr: Cruiser, b: CruiserBody, o: VehicleOut): void {
  cr.x = b.x = o.x;
  cr.z = b.z = o.z;
  cr.y = o.y;
  cr.heading = b.heading = o.heading;
  const sn = Math.sin(cr.heading), cs = Math.cos(cr.heading);
  cr.speed = o.vx * sn + o.vz * cs;
  cr.vx = o.vx - sn * cr.speed;
  cr.vz = o.vz - cs * cr.speed;
  b.vx = o.vx;
  b.vz = o.vz;
}

/**
 * Its driver at the wheel for the next step: `want` m/s along it (backing up below 0), the front wheels turned
 * `steer` rad's worth towards where it wants to go (+ to its left), no more than its tyres hold at its speed; standing,
 * the brakes on
 */
export function driveCruiserBody(cr: Cruiser, b: CruiserBody, want: number, steer: number, dt: number): void {
  const u = b.v.out.forward;
  const accel = want > u ? (u < 0 ? CRUISER.brake : CRUISER.accel) : CRUISER.brake;
  const input = b.input;
  input.force = cr.mass * clamp(want - u, -accel * dt, accel * dt) / dt;
  const lock = b.v.def.steerLock;
  const most = steerLimit(lock, b.v.wheelbase, 1, u);
  input.steer = -clamp(steer * STEER_GAIN, -most, most) / lock; // (Jolt's: +1 full right)
  input.hold = want === 0 && Math.abs(u) < 0.5;
  input.handbrake = false;
}

/** Its mesh where its body is, tilted as it is (its own tilt, the map's, left level) */
export function placeCruiserMesh(cr: Cruiser, b: CruiserBody): void {
  const o = b.v.out;
  cr.mesh.position.set(o.x, o.y, o.z);
  cr.mesh.quaternion.set(o.qx, o.qy, o.qz, o.qw);
  cr.tiltPivot.rotation.set(0, 0, 0);
  cr.position.set(o.x, o.y + 0.7, o.z);
}

/** Its body out of Jolt (gone, or too far off): it drives on the map from where it is, as it was going */
export function dropCruiserBody(crime: CrimeSystem, cr: Cruiser): void {
  const b = cr.body;
  if (!b) return;
  crime.physics?.remove(b.v);
  cr.body = null;
  cr.pitch = cr.roll = 0;
  cr.mesh.rotation.set(0, cr.heading, 0); // (level again: the map's tilt is its tiltPivot's)
}
