// js/sim/traffic/collisions.ts
// Vehicles striking each other and the player: knocks passed on, the player shoved and shoving, crash damage, and the
// vehicles outside the traffic (police cars) bumping into it
import { MIN_IMPACT, applyImpact, createDamage } from '../../player/vehicle-damage.ts';
import { CRASH_SPEED, KNOCK_SPEED, RAM_SPEED, clamp, massOf, onRoad } from './constants.ts';
import type { BumpBody, Bus, Car, DrivenVehicle, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { reportCollision } from './hooks.ts';
import { shove } from './motion.ts';
import { overlapWithPlayer } from './overlap.ts';
import { crash } from './crashes.ts';
import { spawnCollisionSparks } from './sparks.ts';
import { throwRider } from './two-wheelers.ts';
import { bail } from './carjacking.ts';
import { hillAt } from './surface.ts';

// A knocked vehicle shunts the vehicles it runs into
function knockOn(ts: TrafficState, v: Vehicle): void {
  for (const o of ts.vehicles) {
    if (o === v || !o.edge) continue;
    const dx = o.x - v.x;
    const dz = o.z - v.z;
    const dist = Math.hypot(dx, dz);
    if (dist > v.half + o.half || dist < 0.001) continue;
    if (Math.abs(dz * v.tx - dx * v.tz) > v.halfWidth + o.halfWidth) continue; // side by side
    const nx = dx / dist;
    const nz = dz / dist;
    const relVn = (v.vx - o.vx) * nx + (v.vz - o.vz) * nz;
    if (relVn <= 0.5) continue;
    // (near the player and hard: both into Jolt, which takes the crash from here)
    if (relVn > CRASH_SPEED && crash(ts, v)) {
      crash(ts, o);
      return;
    }
    const approachSpeed = (v.tx * v.speed + v.vx - o.tx * o.speed - o.vx) * nx
      + (v.tz * v.speed + v.vz - o.tz * o.speed - o.vz) * nz;
    const base = ((v.hy || 0) + (o.hy || 0)) / 2; // (their road's surface: the ground, or a bridge's deck)
    reportCollision(ts, o, v, (v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, approachSpeed, base);
    // the momentum traded by their masses: a bus shoves a car aside and rolls on, a car bounces off a bus (two cars
    // as they always did: the one hit takes 0.68 of the closing speed, the other gives back 0.31)
    const mv = massOf(v), mo = massOf(o);
    const transfer = relVn * 1.36 * (mv / (mv + mo));
    o.vx += nx * transfer;
    o.vz += nz * transfer;
    const back = relVn * 0.61 * (mo / (mv + mo));
    v.vx -= nx * back;
    v.vz -= nz * back;
    const heft = Math.min(1.8, (2 * mv) / (mv + mo)); // how hard o is knocked about
    const across = nz * o.tx - nx * o.tz; // hit from the side spins it
    const along = nx * o.tx + nz * o.tz;
    o.yawVel += across * Math.min(2.8, relVn * 0.22) * heft;
    o.rollVel += across * Math.min(8.0, relVn) * 0.18 * heft;
    o.pitchVel -= along * Math.min(8.0, relVn) * 0.14 * heft;
    if (relVn > 2.2) spawnCollisionSparks(ts, (v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, relVn, base);
  }
}

// Player contact: push the player and the vehicle apart and trade momentum by their masses (a bus hardly moves and
// wrecks a car's run, a bicycle hardly slows it), with spin, suspension kicks and sparks
function collideWithPlayer(ts: TrafficState, v: DrivenVehicle, rotY: number, halfW: number, halfL: number): void {
  const pe = ts.player.entity;
  if (!pe) return;
  const relX = pe.position.x - v.x;
  const relZ = pe.position.z - v.z;
  if (Math.abs(relX) > halfL + 3 || Math.abs(relZ) > halfL + 3) return;
  const hit = overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pe.heading || 0, ts.player.halfW, ts.player.halfL);
  if (!hit) return;
  const { nx, nz, pen, localX, localZ, pSin, pCos } = hit;
  // massRatio: the vehicle's share of the separation and of the momentum change, pPush the player's
  const mv = massOf(v), mp = ts.player.mass;
  const massRatio = mp / (mp + mv);
  const pPush = 1.0 - massRatio;
  pe.position.x += nx * pen * pPush;
  pe.position.z += nz * pen * pPush;
  if (pe.mesh) pe.mesh.position.copy(pe.position);
  shove(ts, v, -nx * pen * massRatio, -nz * pen * massRatio);

  const sinY = Math.sin(rotY);
  const cosY = Math.cos(rotY);
  const pSpeed = pe.speed || 0;
  const pvx = pSin * pSpeed + (pe.vx || 0);
  const pvz = pCos * pSpeed + (pe.vz || 0);
  const cvx = v.tx * v.speed + v.vx;
  const cvz = v.tz * v.speed + v.vz;
  const approachSpeed = (pvx - cvx) * (-nx) + (pvz - cvz) * (-nz);
  if (approachSpeed <= 0) return;
  // on foot, what hurts is the vehicle's own speed into the player (n points from it to them), not their running
  if (pe.type === 'person' && ts.mayhemListener) {
    const into = cvx * nx + cvz * nz;
    if (into > 0) ts.mayhemListener('struck', pe.position.x, pe.position.y, pe.position.z, into, massOf(v));
  }

  // (the crumpling soaks up a hard hit: ~0.28 of it comes back from a knock, 0.05 from ~23 m/s, see
  // controllers.ts resolveHorizontalCollision)
  const restitution = Math.max(0.05, 0.28 - approachSpeed * 0.01);
  const jImpulse = (1.0 + restitution) * approachSpeed;
  const cImpulse = jImpulse * massRatio * 0.92;
  v.vx -= nx * cImpulse;
  v.vz -= nz * cImpulse;
  v.speed *= Math.max(0, 1 - 1.3 * massRatio); // (two cars: 0.35 of it left; a bus hit by a car keeps 0.87)

  // (n in v's own frame: +z ahead, +x its left, pointing from its centre to where it was hit)
  const localNx = nx * cosY - nz * sinY;
  const localNz = nx * sinY + nz * cosY;
  // the jump in its velocity is what bends it: a bus barely feels a car, a car hit by a bus is crushed
  hurtVehicle(ts, v, v.tx * v.speed + v.vx - cvx, v.tz * v.speed + v.vz - cvz, localNx, localNz, halfW, halfL);
  const vHeft = Math.min(1.8, 2 * massRatio); // how hard the vehicle is knocked about (1 between two cars)
  if (vHeft > 0.3) {
    const torque = localZ * localNx - localX * localNz;
    v.yawVel -= torque * Math.min(4.2, approachSpeed * 0.26) * vHeft;
    v.yawOffset = clamp(v.yawOffset - torque * Math.min(0.35, approachSpeed * 0.025) * vHeft, -0.65, 0.65);
    v.pitchVel -= localNz * Math.min(12.0, approachSpeed) * 0.18 * vHeft;
    v.rollVel += localNx * Math.min(12.0, approachSpeed) * 0.24 * vHeft;
  }

  const contactLocalX = clamp(localX, -halfW, halfW);
  const contactLocalZ = clamp(localZ, -halfL, halfL);
  const contactX = v.x + contactLocalX * cosY + contactLocalZ * sinY;
  const contactZ = v.z - contactLocalX * sinY + contactLocalZ * cosY;
  if (pe.type !== 'person') reportCollision(ts, pe, v, contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed, v.hy || 0);

  if (typeof pe.speed === 'number') {
    const along = pSin * nx + pCos * nz; // the push along the player's heading: + from behind, - into its nose
    const headOnDot = Math.abs(along);
    if (pe.speed * along < 0) {
      // driven into it: the speed lost by the player's share, half of it head on into a car, nearly all into a bus,
      // a few % into a bike
      pe.speed *= 1.0 - Math.min(0.95, pPush) * headOnDot;
    } else {
      // shunted the way it is going (rear-ended) or standing: the knock goes into its speed instead of braking it,
      // so a car hit from behind lurches on and can drive away
      pe.speed += jImpulse * pPush * along * 0.85;
    }
    if (pe.type === 'car') {
      // pushed off it: what of the hit comes back head on (its speed already lost it above), the approach itself
      // when it only grazes (so it slides off instead of through)
      const pImpulse = approachSpeed * pPush * (restitution + (1 - headOnDot) * 0.6);
      pe.vx = (pe.vx || 0) + nx * pImpulse;
      pe.vz = (pe.vz || 0) + nz * pImpulse;
      const pLocalNx = nx * pCos - nz * pSin;
      const pLocalNz = nx * pSin + nz * pCos;
      const pRelX = (contactX - pe.position.x) * pCos - (contactZ - pe.position.z) * pSin;
      const pRelZ = (contactX - pe.position.x) * pSin + (contactZ - pe.position.z) * pCos;
      const pTorque = pRelZ * pLocalNx - pRelX * pLocalNz;
      pe.angularVel = (pe.angularVel || 0) + pTorque * Math.min(3.0, approachSpeed * 0.18) * pPush;
      const pHeft = Math.min(1.8, 2 * pPush); // how hard the player's car is shaken (1 by a car, ~1.8 by a bus)
      const kick = Math.min(16.0, approachSpeed);
      pe.pitchVel = (pe.pitchVel || 0) + pLocalNz * kick * 0.18 * pHeft;
      pe.rollVel = (pe.rollVel || 0) - pLocalNx * kick * 0.24 * pHeft;
      pe.heaveVel = (pe.heaveVel || 0) + Math.min(1.6, approachSpeed * 0.11 * pHeft);
    }
  }
  if (approachSpeed > 1.8) spawnCollisionSparks(ts, contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed, v.hy || 0);
}

// A crash changed v's velocity by (dvx, dvz) at once, the hit coming from (dirX, dirZ) in its own frame: its damage
// (vehicle-damage.ts, as for the player's car), drawn crushed in there by the car material (renderCar packs it in carState). A dead
// engine stops it for good and its driver gets out
function hurtVehicle(ts: TrafficState, v: Vehicle, dvx: number, dvz: number, dirX: number, dirZ: number, halfW: number, halfL: number): void {
  if (v.bike || v.moto) return;
  const dv = Math.hypot(dvx, dvz);
  if (!(dv > MIN_IMPACT)) return;
  v.damage ??= createDamage();
  applyImpact(v.damage, dirX, dirZ, dv, halfW, halfL);
  killedIfDead(ts, v);
}
function killedIfDead(ts: TrafficState, v: Car | Bus): void {
  if (v.damage && v.damage.engine >= 1 && !v.wrecked) {
    v.wrecked = true;
    v.blink = 0;
    const yaw = v.yaw + v.yawOffset;
    const side = v.halfWidth + 0.55; // (out of the driver's door, on its left)
    bail(ts, v.x + Math.cos(yaw) * side, v.z - Math.sin(yaw) * side, yaw, null);
  }
}

// A vehicle not in the traffic (a police car chasing the player: { x, z, heading, halfW, halfL, speed, vx, vz,
// mass }) shoving the traffic it drives into, and shoved back: the vehicles' masses share the push. The cars already
// thrown about in a crash near the player are shoved through their bodies in Jolt, so it never drives through one;
// `ram` (a chase, not an ambulance on its way): one of the traffic it rams hard there is thrown about in Jolt too, as
// one the player rams is. `inJolt`: b is a body in Jolt itself (crime/cruiser-bodies.ts), and meets those cars there
function bumpBody(ts: TrafficState, b: BumpBody, ram = true, inJolt = false): void {
  const reach = b.halfL + 6;
  const bvx = Math.sin(b.heading) * b.speed + b.vx;
  const bvz = Math.cos(b.heading) * b.speed + b.vz;
  // (the cars in Jolt first: one it throws below is pushed out of it there, not struck a second time here)
  const physics = ts.physics;
  if (physics && !inJolt) {
    for (const v of ts.crashed) {
      const relX = b.x - v.x;
      const relZ = b.z - v.z;
      if (Math.abs(relX) > reach || Math.abs(relZ) > reach) continue;
      const hit = overlapWithPlayer(relX, relZ, v.yaw, v.halfWidth, v.half, b.heading, b.halfW, b.halfL);
      if (!hit) continue;
      const { nx, nz, pen } = hit;
      const o = v.crash.body.out;
      const approach = (bvx - o.vx) * -nx + (bvz - o.vz) * -nz;
      const ratio = b.mass / (b.mass + massOf(v));
      b.x += nx * pen * (1 - ratio);
      b.z += nz * pen * (1 - ratio);
      const j = approach > 0 ? 1.28 * approach : 0;
      const spin = (relX * nz - relZ * nx) / Math.max(1, v.half) * Math.min(3, j * 0.2);
      physics.shove(v.crash.body, -nx * j * ratio * 0.92, 0, -nz * j * ratio * 0.92, 0, spin, 0, -nx * pen * ratio, -nz * pen * ratio);
      if (approach <= 0) continue;
      bounceBody(b, nx, nz, j, ratio);
      const cx = b.x - nx * b.halfW, cz = b.z - nz * b.halfW, base = v.hy ?? hillAt(ts, cx, cz);
      reportCollision(ts, b, v, cx, 0.58, cz, nx, nz, approach, base);
      if (approach > 1.8) spawnCollisionSparks(ts, cx, 0.58, cz, nx, nz, approach, base);
    }
  }
  for (const v of ts.vehicles) {
    if (!onRoad(v)) continue;
    const relX = b.x - v.x;
    const relZ = b.z - v.z;
    if (Math.abs(relX) > reach || Math.abs(relZ) > reach) continue;
    const hit = overlapWithPlayer(relX, relZ, v.yaw + v.yawOffset, v.halfWidth, v.half, b.heading, b.halfW, b.halfL);
    if (!hit) continue;
    const { nx, nz, pen } = hit;
    const approach = (bvx - (v.tx * v.speed + v.vx)) * -nx + (bvz - (v.tz * v.speed + v.vz)) * -nz;
    if (v.bike || v.moto) {
      if (approach > KNOCK_SPEED) throwRider(ts, v, -nx, -nz, bvx, bvz, b.mass);
      continue;
    }
    // (rammed hard: thrown about in Jolt from here, shoved by the hit below)
    const thrown = ram && approach > RAM_SPEED ? crash(ts, v) : null;
    const mv = massOf(v);
    const ratio = b.mass / (b.mass + mv); // the vehicle's share of the separation and the momentum change
    b.x += nx * pen * (1 - ratio);
    b.z += nz * pen * (1 - ratio);
    if (!thrown) shove(ts, v, -nx * pen * ratio, -nz * pen * ratio);
    if (approach <= 0) continue; // (never thrown: it closed slower than RAM_SPEED)
    const j = 1.28 * approach;
    if (thrown) {
      // (a hit off its middle spins it: the push's lever about its centre)
      const spin = (relX * nz - relZ * nx) / Math.max(1, v.half) * Math.min(3, approach * 0.25);
      ts.physics?.shove(thrown.body, -nx * j * ratio * 0.92, Math.min(1.5, approach * 0.05), -nz * j * ratio * 0.92,
        0, spin, 0, -nx * pen * ratio, -nz * pen * ratio);
    } else {
      v.vx -= nx * j * ratio * 0.92;
      v.vz -= nz * j * ratio * 0.92;
      v.speed *= Math.max(0, 1 - 1.3 * ratio);
      v.yawVel += (Math.random() - 0.5) * Math.min(3, approach * 0.25);
    }
    bounceBody(b, nx, nz, j, ratio);
    // (over the road it is on: the ground, or a bridge's deck, as the vehicles' crashes with each other)
    const cx = b.x - nx * b.halfW, cz = b.z - nz * b.halfW, base = v.hy ?? hillAt(ts, cx, cz);
    reportCollision(ts, b, v, cx, 0.58, cz, nx, nz, approach, base);
    if (approach > 1.8) spawnCollisionSparks(ts, cx, 0.58, cz, nx, nz, approach, base);
  }
}
// b knocked back along n (from what it hit towards it) by its share (1 - ratio) of impulse j (m/s), and slowed by
// as much of its speed as went into it
function bounceBody(b: BumpBody, nx: number, nz: number, j: number, ratio: number): void {
  b.vx += nx * j * (1 - ratio) * 0.48;
  b.vz += nz * j * (1 - ratio) * 0.48;
  b.speed *= 1 - Math.min(0.9, 1 - ratio) * Math.abs(Math.sin(b.heading) * nx + Math.cos(b.heading) * nz);
}

export { knockOn, collideWithPlayer, hurtVehicle, killedIfDead, bumpBody };
