// js/sim/traffic/gunfire.ts
// GUNFIRE & BLASTS (crime.ts): the street's people and vehicles shot at, blown about and running for cover
import { boxHit } from '../mayhem.ts';
import { bleedOf } from '../ragdolls.ts';
import { blastFalloff, rayBox, rayCircle } from '../weapons.ts';
import { createDamage } from '../../player/vehicle-damage.ts';
import { KNOCK_SPEED, MASS, massOf } from './constants.ts';
import type { Ped, RayAccept, TrafficRayHit, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';
import { hurtVehicle, killedIfDead } from './collisions.ts';
import { crash } from './crashes.ts';
import { spawnCollisionSparks } from './sparks.ts';
import { throwPed } from './peds.ts';
import { throwRider } from './two-wheelers.ts';
import { BAIL_STUN } from './carjacking.ts';
import { endConversation } from './walking.ts';

// The first pedestrian or vehicle a shot from (ox, oz) along the unit direction (dx, dz) meets within `range`:
// { kind: 'ped' | 'vehicle', target, t } (reused), or null. `accept(kind, target, t)` (optional) passes over those it
// turns down (a shot aimed over a car's roof, crime.ts)
function rayHit(ts: TrafficState, ox: number, oz: number, dx: number, dz: number, range: number, accept: RayAccept | null = null): TrafficRayHit | null {
  let best = range;
  let target: Ped | Vehicle | null = null;
  let kind: TrafficRayHit['kind'] = '';
  for (const p of ts.peds) {
    if (!p.placed || p.fallen) continue;
    const fx = p.x - ox, fz = p.z - oz;
    if (Math.abs(fx) > range + 1 || Math.abs(fz) > range + 1) continue;
    const t = rayCircle(ox, oz, dx, dz, p.x, p.z, 0.34);
    if (t >= 0 && t < best && (!accept || accept('ped', p, t))) {
      best = t;
      target = p;
      kind = 'ped';
    }
  }
  for (const v of ts.vehicles) {
    if (!v.edge) continue;
    const fx = v.x - ox, fz = v.z - oz;
    if (Math.abs(fx) > range + 6 || Math.abs(fz) > range + 6) continue;
    const t = rayBox(ox, oz, dx, dz, v.x, v.z, v.yaw + v.yawOffset, v.halfWidth, v.half);
    if (t >= 0 && t < best && (!accept || accept('vehicle', v, t))) {
      best = t;
      target = v;
      kind = 'vehicle';
    }
  }
  if (!target) return null;
  ts.rayResult.kind = kind;
  ts.rayResult.target = target;
  ts.rayResult.t = best;
  return ts.rayResult;
}

// A pedestrian shot (or punched) along (dx, dz): knocked to the ground, `power` m/s
function shootPed(ts: TrafficState, p: Ped, dx: number, dz: number, power = 3): void {
  if (!p.placed || p.fallen) return;
  throwPed(ts, p, dx * power, dz * power, dx, dz, false, 0.7);
}

// A vehicle shot at (x, y, z) along (dx, dz): sparks off its body; a cyclist is knocked off
function shootVehicle(ts: TrafficState, v: Vehicle, x: number, y: number, z: number, dx: number, dz: number): void {
  if (v.bike || v.moto) {
    if (v.edge) throwRider(ts, v, dx, dz, dx * 4, dz * 4, MASS.person);
    return;
  }
  spawnCollisionSparks(ts, x, y - hillAt(ts, x, z), z, -dx, -dz, 5);
  const m = massOf(v);
  v.vx += dx * 600 / m;
  v.vz += dz * 600 / m;
  // a round through the bodywork: a little of its engine every time (a dozen or two kill it, fewer up front)
  v.damage ??= createDamage();
  const yaw = v.yaw + v.yawOffset;
  const ahead = ((x - v.x) * Math.sin(yaw) + (z - v.z) * Math.cos(yaw)) / Math.max(1, v.half);
  v.damage.engine = Math.min(1, v.damage.engine + (ahead > 0.4 ? 0.09 : 0.045));
  killedIfDead(ts, v);
}

// An explosion at (x, z): people within `radius` m are thrown off their feet, cyclists off their bikes, vehicles shoved
// and spun by up to `power` m/s (by their weight). Returns how many people it threw.
function blast(ts: TrafficState, x: number, z: number, radius: number, power: number): number {
  let thrown = 0;
  for (const p of ts.peds) {
    if (!p.placed || p.fallen) continue;
    const dx = p.x - x, dz = p.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const k = blastFalloff(d, radius);
    const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
    throwPed(ts, p, nx * power * k, nz * power * k, nx, nz, false, 0.8 * k, 6 * k);
    thrown++;
  }
  for (const v of ts.vehicles) {
    if (!v.edge && !v.crash) continue;
    const dx = v.x - x, dz = v.z - z;
    const d = Math.hypot(dx, dz);
    if (d > radius + v.half) continue;
    const k = blastFalloff(Math.max(0, d - v.half * 0.5), radius);
    if (k <= 0) continue;
    const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0;
    if (v.bike || v.moto) {
      throwRider(ts, v, nx, nz, nx * power * k, nz * power * k, 4000);
      thrown++;
      continue;
    }
    const heft = Math.min(1.5, MASS.sedan / massOf(v)); // a bus hardly moves
    const shove = power * k * heft;
    // near the player, a car is thrown in Jolt: up, over, rolling
    const thrownAbout = v.crash ?? crash(ts, v);
    if (thrownAbout) {
      const across = Math.random() - 0.5;
      ts.physics?.shove(thrownAbout.body, nx * shove, (2 + power * 0.25) * k, nz * shove, nz * across * 3 * k, (Math.random() - 0.5) * 2 * k, -nx * across * 3 * k);
      const yaw = v.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw);
      hurtVehicle(ts, v, nx * shove * 1.6, nz * shove * 1.6, -(nx * cs - nz * sn), -(nx * sn + nz * cs), v.halfWidth, v.half);
      spawnCollisionSparks(ts, v.x, 0.6, v.z, -nx, -nz, 6 + shove);
      continue;
    }
    v.vx += nx * shove;
    v.vz += nz * shove;
    v.speed *= 1 - k;
    const across = nz * v.tx - nx * v.tz;
    v.yawVel += (across * 3 + (Math.random() - 0.5) * 2) * k * heft;
    v.rollVel += across * 9 * k * heft;
    v.pitchVel += (Math.random() - 0.5) * 6 * k * heft;
    // ...and crushed on the side facing it as by a crash of that much
    const yaw = v.yaw + v.yawOffset, cs = Math.cos(yaw), sn = Math.sin(yaw);
    hurtVehicle(ts, v, nx * shove * 1.6, nz * shove * 1.6, -(nx * cs - nz * sn), -(nx * sn + nz * cs), v.bus ? 1.3 : v.halfWidth, v.bus ? 5.72 : v.half);
    spawnCollisionSparks(ts, v.x, 0.6, v.z, -nx, -nz, 6 + shove);
  }
  return thrown;
}

// Gunfire or a blast at (x, z): the people within `radius` m run from it
function panic(ts: TrafficState, x: number, z: number, radius: number): void {
  for (const p of ts.peds) {
    if (!p.placed || p.fallen) continue;
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz > radius * radius) continue;
    if (p.bail && p.bail.flee && p.bail.time >= BAIL_STUN && p.bail.time < BAIL_STUN + p.bail.runFor) {
      p.bail.fromX = x; // already running: away from the latest shot
      p.bail.fromZ = z;
      continue;
    }
    if (p.conversation) endConversation(ts, p.conversation);
    const heading = p.bail ? p.bail.heading : Math.atan2(p.ux * p.dir, p.uz * p.dir);
    Object.assign(p, { node: null, waiting: false, v: 0, pause: 0 });
    p.bail = {
      time: BAIL_STUN * Math.random(), heading, flee: true, runFor: 6 + Math.random() * 5, goal: null, nextSearch: 0,
      best: Infinity, since: 0, fromX: x, fromZ: z
    };
  }
}

// People a moving box (centre x, z, facing heading, half width hw & length hl, velocity vx, vz) runs into: thrown like
// the player's car throws them. Returns how many.
function knockBox(ts: TrafficState, x: number, z: number, heading: number, hw: number, hl: number, vx: number, vz: number): number {
  if (vx * vx + vz * vz < KNOCK_SPEED * KNOCK_SPEED) return 0;
  let thrown = 0;
  for (const p of ts.peds) {
    if (!p.placed || p.fallen) continue;
    if (Math.abs(p.x - x) > hl + 1 || Math.abs(p.z - z) > hl + 1) continue;
    const hit = boxHit(x, z, heading, hw, hl, p.x, p.z, 0.3);
    if (!hit) continue;
    const speed = Math.hypot(vx, vz);
    throwPed(ts, p, vx, vz, hit.nx, hit.nz, false, bleedOf(speed));
    thrown++;
  }
  return thrown;
}

export { rayHit, shootPed, shootVehicle, blast, panic, knockBox };
