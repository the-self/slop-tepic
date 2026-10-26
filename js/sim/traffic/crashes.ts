// js/sim/traffic/crashes.ts
// CRASHES IN JOLT: the cars of the traffic thrown about in a crash near the player, bodies in Jolt till they come to
// rest; and the smoke from a damaged engine
import * as THREE from 'three/webgpu';
import { suspensionOf } from '../../player/car-physics.ts';
import type { CarBodyDef, CarPhysics } from '../../player/car-physics.ts';
import { BODY_SPECS } from '../../actors/actor-models.ts';
import {
  CRASH_BRAKE, CRASH_LOOKAHEAD, CRASH_RANGE, CRASH_SPEED, CRASH_STILL, KNOCK_SPEED, MAX_CRASHED, VEHICLE_RADIUS,
  clamp, massOf, onEdge
} from './constants.ts';
import type { Car, CarCrash, CrashBody, CrashedCar, SmokeEmitter, TrafficEdge, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { reportCollision } from './hooks.ts';
import { visible } from './view.ts';
import { locate, place } from './motion.ts';
import { overlapWithPlayer } from './overlap.ts';
import { hurtVehicle } from './collisions.ts';
import { spawnCollisionSparks } from './sparks.ts';
import { bail } from './carjacking.ts';
import { knockBox } from './gunfire.ts';
import { retireVehicle } from './population.ts';

// A car of the traffic thrown about in a crash near the player is a body in Jolt's world, the player's car's
// (player/car-physics.ts): its body shape's bonnet & cabin, its model's weight, its wheels on springs; it spins, it
// shunts what it runs into, it rolls over hit from the side. Meanwhile the traffic only reads where the body is (to
// draw it, to steer round it, to dent it where it was struck) and its driver brakes. Once it lies still, upright and
// on a road it drives on from where it is; otherwise it is left there (its driver gets out) till the player is far
function setPhysics(ts: TrafficState, p: CarPhysics | null): void {
  ts.physics = p ?? null;
}

// What v's body is in Jolt (car-physics.ts add): its model's weight & footprint, its body shape's height, its wheels
// where they are drawn (the left instance's on its right: see placeWheels), springs by its class; never set back on
// its wheels (rescue): a car on its roof stays there; asleep while still
function crashDef(v: Car): CarBodyDef {
  const spec = BODY_SPECS[v.bodyType];
  const [springHz, roll] = suspensionOf(v.model?.class ?? 'family'); // (no model: a family car's)
  const hT = spec.wheelX * v.sx, hB = spec.wheelZ * v.sz, r = spec.wheelRadius * v.sw;
  const height = v.model?.size[2] || 1.45;
  const wheels: [x: number, z: number, front: boolean][] = [[-hT, hB, true], [hT, hB, true], [-hT, -hB, false], [hT, -hB, false]];
  return {
    kind: 'car', mass: massOf(v), halfW: v.halfWidth, halfL: v.half, height, cg: height * 0.38, springHz, roll,
    steerLock: 0.55, drive: 'fwd', rescue: false, sleeps: true,
    wheels: wheels.map(([x, z, front]) => ({ x, z, radius: r, front }))
  };
}

// v into Jolt where it is, moving as it was, out of its lane (the traffic steers round it: crashedObstacles). Whether
// it went (its crash, or null): only a car, near the player, and room for it (the stillest of MAX_CRASHED makes way)
function crash(ts: TrafficState, v: Vehicle): CarCrash | null {
  if (!ts.physics || v.crash || v.bus || v.bike || v.moto || !v.edge) return null;
  if (Math.hypot(v.x - ts.player.x, v.z - ts.player.z) > CRASH_RANGE) return null;
  if (ts.crashed.length >= MAX_CRASHED) {
    let stillest: CrashedCar | null = null;
    for (const o of ts.crashed) if (!o.crash.left && (!stillest || o.crash.speed < stillest.crash.speed)) stillest = o;
    if (stillest) settleCrash(ts, stillest, true);
    if (ts.crashed.length >= MAX_CRASHED) return null;
  }
  const rotY = v.yaw + v.yawOffset;
  const body: CrashBody = ts.physics.add(crashDef(v), v.x, v.hy || 0, v.z, rotY);
  body.owner = v;
  const vx = v.tx * v.speed + v.vx, vz = v.tz * v.speed + v.vz;
  ts.physics.shove(body, vx, 0, vz, 0, v.yawVel, 0);
  const car = Object.assign(v, {
    crash: {
      body, still: 0, speed: Math.hypot(vx, vz), left: false,
      box: { x: v.x, z: v.z, heading: rotY, halfW: v.halfWidth, halfL: v.half },
      input: { force: 0, airDrag: 0, steer: 0, handbrake: false, hold: false, grip: ts.roadGrip, spinning: false }
    }
  });
  body.input = car.crash.input;
  retireVehicle(car);
  car.blink = 0;
  ts.crashed.push(car);
  return car.crash;
}

// About to crash into the player's vehicle (a body in Jolt itself), or into a car already thrown about, faster than
// CRASH_SPEED: their boxes, grown by how far they close in CRASH_LOOKAHEAD s, overlap. (n from v towards the other)
function crashingInto(v: Vehicle, x: number, z: number, heading: number, halfW: number, halfL: number, ovx: number, ovz: number): boolean {
  const relX = x - v.x, relZ = z - v.z;
  if (Math.abs(relX) > 14 || Math.abs(relZ) > 14) return false;
  const cvx = v.tx * v.speed + v.vx, cvz = v.tz * v.speed + v.vz;
  const grow = Math.hypot(ovx - cvx, ovz - cvz) * CRASH_LOOKAHEAD + 0.1;
  const hit = overlapWithPlayer(relX, relZ, v.yaw + v.yawOffset, v.halfWidth + grow, v.half + grow, heading, halfW, halfL);
  return hit !== null && (ovx - cvx) * -hit.nx + (ovz - cvz) * -hit.nz > CRASH_SPEED;
}
function crashes(ts: TrafficState, v: Vehicle): boolean {
  if (ts.player.jolt && crashingInto(v, ts.player.x, ts.player.z, ts.player.heading, ts.player.halfW, ts.player.halfL, ts.player.vx, ts.player.vz)) return true;
  for (const o of ts.crashed) {
    const b = o.crash.body.out;
    if (crashingInto(v, o.x, o.z, o.yaw, o.halfWidth, o.half, b.vx, b.vz)) return true;
  }
  return false;
}

// Per frame, before the traffic drives: where Jolt's last step left each crashed car, the dents from what its body
// struck, its driver braking, the box the traffic steers round; those lying still drive on, or are left
const _q = new THREE.Quaternion();
function crashedStep(ts: TrafficState, dt: number): void {
  ts.crashedObstacles.length = 0;
  for (let i = ts.crashed.length - 1; i >= 0; i--) {
    const v = ts.crashed[i], c = v.crash, o = c.body.out;
    v.prevX = v.x;
    v.prevZ = v.z;
    v.x = o.x;
    v.z = o.z;
    v.hy = o.y;
    v.yaw = o.heading;
    v.yawOffset = 0;
    v.tx = Math.sin(v.yaw);
    v.tz = Math.cos(v.yaw);
    v.speed = Math.max(0, o.forward);
    v.acc = -1; // (its brake lamps on)
    c.speed = Math.hypot(o.vx, o.vy, o.vz);
    // dented where it was struck: the hit's side, in its own frame (n points out of what it hit, into it)
    const h = o.hit, other: CrashBody | null = h.other;
    if (h.speed > 1) {
      const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      hurtVehicle(ts, v, h.nx * h.speed, h.nz * h.speed, -h.nx * cs + h.nz * sn, -h.nx * sn - h.nz * cs, v.halfWidth, v.half);
      // (two of the traffic's: heard; the player's own crash reports itself, controllers.ts)
      if (other?.owner && other.owner !== ts.player.entity && h.speed > 1.5) {
        reportCollision(ts, v, other.owner, v.x - h.nx * v.halfWidth, 0.56, v.z - h.nz * v.halfWidth, h.nx, h.nz, h.speed, v.hy);
        if (h.speed > 2.2) spawnCollisionSparks(ts, v.x - h.nx * v.halfWidth, 0.56, v.z - h.nz * v.halfWidth, h.nx, h.nz, h.speed, v.hy);
      }
    }
    if (v.damage) smokeFrom(ts, v, dt);
    // whoever it slides into, thrown (the people aren't bodies in Jolt)
    if (c.speed > KNOCK_SPEED) knockBox(ts, v.x, v.z, v.yaw, v.halfWidth, v.half, o.vx, o.vz);
    // its driver brakes (none left in it: it rolls on)
    const fwd = o.forward, m = massOf(v);
    c.input.grip = ts.roadGrip;
    c.input.force = v.wrecked || Math.abs(fwd) < 0.3 ? 0 : -Math.sign(fwd) * Math.min(m * Math.abs(fwd) / dt, m * CRASH_BRAKE);
    c.input.hold = !v.wrecked && Math.abs(fwd) < 0.3;
    c.box.x = v.x;
    c.box.z = v.z;
    c.box.heading = v.yaw;
    ts.crashedObstacles.push(c.box);
    const spin = Math.hypot(o.wx, o.wy, o.wz);
    c.still = c.speed < 0.3 && spin < 0.3 ? c.still + dt : 0;
    if (c.left) {
      // left in the road: gone once the player is far and doesn't see it
      if (Math.hypot(v.x - ts.focusX, v.z - ts.focusZ) > VEHICLE_RADIUS && !(ts.hasView && visible(ts, v.x, v.z, v.half + 2, (v.hy || 0) + 1))) uncrash(ts, v);
    } else if (c.still > CRASH_STILL) settleCrash(ts, v, false);
  }
}

// v at rest after its crash: upright, whole and by a lane going its way, back in the traffic from where it stands
// (easing back onto the lane's centre, its dents kept); otherwise left there, its driver getting out. `forced`: one
// more car crashed, and this one must make way: if it can't drive on and nobody sees it, it goes
function settleCrash(ts: TrafficState, v: CrashedCar, forced: boolean): void {
  const o = v.crash.body.out;
  const spot = !v.wrecked && o.uy > 0.85 ? laneNear(ts, v.x, v.z, v.yaw) : null;
  if (spot) {
    const { damage } = v;
    const x = v.x, z = v.z, yaw = v.yaw;
    uncrash(ts, v);
    place(ts, v, spot.e, spot.lane, spot.s);
    v.damage = damage;
    v.speed = 0;
    // (where it stands, off the lane's centre and turned from it: the driver eases back)
    v.dl = -(x - v.x) * v.tz + (z - v.z) * v.tx;
    if (onEdge(v)) locate(ts, v); // (it is: just placed)
    let dyaw = yaw - v.yaw;
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    v.yawOffset = clamp(dyaw, -0.65, 0.65);
    return;
  }
  if (!v.crash.left) {
    v.crash.left = true;
    if (!v.wrecked) bail(ts, v.x + Math.cos(v.yaw) * (v.halfWidth + 0.55), v.z - Math.sin(v.yaw) * (v.halfWidth + 0.55), v.yaw, null);
  }
  if (forced && !(ts.hasView && visible(ts, v.x, v.z, v.half + 2, (v.hy || 0) + 1))) uncrash(ts, v);
}

// v out of Jolt (out of the traffic too, till placed again)
function uncrash(ts: TrafficState, v: CrashedCar): void {
  ts.physics?.remove(v.crash.body);
  const car: Car = v; // (no longer crashed)
  car.crash = null;
  ts.crashed.splice(ts.crashed.indexOf(v), 1);
}

// The lane nearest (x, z) on the roads round the player that runs along `yaw` (within ~45°), within 3 m of its
// centre and with room along it: { e, lane, s }, or null
function laneNear(ts: TrafficState, x: number, z: number, yaw: number): { e: TrafficEdge; lane: number; s: number } | null {
  let best: { e: TrafficEdge; lane: number; s: number } | null = null, bestOff = 3;
  for (const e of ts.nearEdges) {
    if (!e.lanes.length || e.len < 12) continue;
    const along = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
    if (along < 4 || along > e.len - 6) continue;
    let dyaw = yaw - Math.atan2(e.dx, e.dz);
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    if (Math.abs(dyaw) > 0.8) continue;
    const across = (x - e.sx) * e.rx + (z - e.sz) * e.rz;
    for (let i = 0; i < e.lanes.length; i++) {
      const off = Math.abs(across - e.lanes[i]);
      if (off < bestOff) {
        bestOff = off;
        best = { e, lane: i, s: along };
      }
    }
  }
  return best;
}

// A crashed car's wheels where its body holds them, on their springs, spinning (i: its slot, as placeWheels; spots: where
// a car model's file puts them, in the order of its body's wheels, instead of where its body shape's go)
const _wheelAt = new THREE.Vector3(), _spin = new THREE.Quaternion(), _xAxis = new THREE.Vector3(1, 0, 0);
function placeCrashedWheels(ts: TrafficState, crash: CarCrash, i: number, radius: number, baseRadius = 0.35, left: THREE.InstancedMesh = ts.carWheelLeftInst, right: THREE.InstancedMesh = ts.carWheelRightInst, spots: readonly { x: number; z: number }[] | null = null): void {
  const o = crash.body.out, wheels = crash.body.def.wheels;
  _q.set(o.qx, o.qy, o.qz, o.qw);
  const scale = radius / baseRadius;
  ts.dummy.scale.set(scale, scale, scale);
  for (let k = 0; k < 4; k++) {
    const w = wheels[k], ow = o.wheels.at(k); // (none yet: at rest on the floor, still)
    const at = spots?.[k] ?? w;
    _wheelAt.set(at.x, ow ? ow.y : radius, at.z).applyQuaternion(_q);
    ts.dummy.position.set(o.x + _wheelAt.x, o.y + _wheelAt.y, o.z + _wheelAt.z);
    ts.dummy.quaternion.copy(_q).multiply(_spin.setFromAxisAngle(_xAxis, ow ? ow.spin : 0));
    ts.dummy.updateMatrix();
    (k % 2 === 0 ? left : right).setMatrixAt(i * 2 + (k < 2 ? 0 : 1), ts.dummy.matrix);
  }
}

// Smoke from a damaged engine (grey, then black once it is about to die), through the player's smoke (main.ts)
function setSmokeEmitter(ts: TrafficState, emit: SmokeEmitter | null): void {
  ts.smokeEmitter = typeof emit === 'function' ? emit : null;
}
function smokeFrom(ts: TrafficState, v: Vehicle, dt: number): void {
  if (v.bike || v.moto) return; // (never damaged: hurtVehicle)
  const e = v.damage ? v.damage.engine : 0;
  if (e <= 0.4 || !ts.smokeEmitter || Math.hypot(v.x - ts.focusX, v.z - ts.focusZ) > 140) return;
  v.smokeCarry += dt * (e >= 1 ? 10 : (e - 0.4) * 14);
  if (v.smokeCarry < 1) return;
  const n = Math.floor(v.smokeCarry);
  v.smokeCarry -= n;
  const yaw = v.yaw + v.yawOffset;
  const ahead = v.bus ? 5.2 : v.half - 0.75; // (over the bonnet, or the bus's front engine)
  ts.smokeEmitter(v.x + Math.sin(yaw) * ahead, (v.hy || 0) + (v.bus ? 1.4 : 0.95 * v.sy), v.z + Math.cos(yaw) * ahead,
    v.tx * v.speed + v.vx, v.tz * v.speed + v.vz, n, e >= 0.85 ? 0.1 : 0.5 - e * 0.4, v.bus ? 1.3 : 0.9);
}

export { setPhysics, crash, crashes, crashedStep, placeCrashedWheels, setSmokeEmitter, smokeFrom };
