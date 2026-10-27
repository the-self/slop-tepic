// js/sim/traffic/gunfire.ts
// GUNFIRE & BLASTS (crime.ts): the street's people and vehicles shot at, blown about and running for cover
import { boxHit } from '../mayhem.ts';
import { bleedOf } from '../ragdolls.ts';
import { blastFalloff, rayBox, rayCircle } from '../weapons.ts';
import { createDamage } from '../../player/vehicle-damage.ts';
import { BODY_SPECS } from '../../actors/actor-models.ts';
import { KNOCK_SPEED, MASS, massOf } from './constants.ts';
import type { Car, Ped, RayAccept, TrafficRayHit, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';
import { hurtVehicle, killedIfDead } from './collisions.ts';
import { crash } from './crashes.ts';
import { spawnCollisionSparks } from './sparks.ts';
import { throwPed } from './peds.ts';
import { throwRider } from './two-wheelers.ts';
import { BAIL_STUN, abandon } from './carjacking.ts';
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

// A vehicle shot at (x, y, z) along (dx, dz): sparks off its body; a cyclist is knocked off. A round through the cab
// may kill its driver (the car rolls to a stop, nobody in it but them); else they either floor it or stop and get out
// and run (frighten)
function shootVehicle(ts: TrafficState, v: Vehicle, x: number, y: number, z: number, dx: number, dz: number): void {
  if (v.bike || v.moto) {
    if (v.edge) throwRider(ts, v, dx, dz, dx * 4, dz * 4, MASS.person);
    return;
  }
  spawnCollisionSparks(ts, x, y - hillAt(ts, x, z), z, -dx, -dz, 5);
  // (a patrol's officer doesn't run: the crime's dispatch sends it after whoever shot)
  if (v.edge && !v.wrecked && !v.isPolice) {
    const yaw = v.yaw + v.yawOffset;
    // (the cab: the middle third of a car, a camión's nose where its driver sits)
    const along = (x - v.x) * Math.sin(yaw) + (z - v.z) * Math.cos(yaw);
    const cab = v.bus ? along > v.half - 2.5 : Math.abs(along) < v.half * 0.45;
    if (cab && Math.random() < DRIVER_HIT) abandon(ts, v, false);
    else frighten(v, x - dx * 15, z - dz * 15, 0, true);
  }
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
      spawnCollisionSparks(ts, v.x, 0.6, v.z, -nx, -nz, 6 + shove, v.hy ?? hillAt(ts, v.x, v.z)); // (over its road: a bridge's deck too)
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
    spawnCollisionSparks(ts, v.x, 0.6, v.z, -nx, -nz, 6 + shove, v.hy ?? hillAt(ts, v.x, v.z)); // (over its road: a bridge's deck too)
  }
  return thrown;
}

const DRIVER_HIT = 0.3; // the share of the rounds into a car's cab that hit its driver

// What a driver does about gunfire from (x, z) (`near`: how close, 0 at it .. 1 at the edge of earshot; `shot`: a round
// into their own car): on a bicycle or a moto, or rolling along, most floor it out of there; some freeze where they
// are, heads down; close by, stopped, or shot at, many stop and get out and run. A camión's driver stays with it. Those
// already frightened stay so, for longer
function frighten(v: Vehicle, x: number, z: number, near: number, shot = false): void {
  v.frightX = x;
  v.frightZ = z;
  if (v.fright) {
    if (v.fright !== 'bail') v.frightT = Math.max(v.frightT, 4 + Math.random() * 3);
    return;
  }
  const r = Math.random();
  if (v.bike || v.moto) v.fright = 'flee';
  else if (v.bus) v.fright = r < 0.6 ? 'flee' : 'freeze';
  else {
    const out = shot ? 0.5 : (v.speed < 6 ? 0.4 : 0.15) * (1.4 - near);
    const freeze = shot ? 0 : 0.3;
    v.fright = r < out ? 'bail' : r < out + freeze ? 'freeze' : 'flee';
  }
  v.frightT = v.fright === 'freeze' ? 4 + Math.random() * 6 : 8 + Math.random() * 7;
  v.blink = 0;
}

// Gunfire or a blast at (x, z): the people within `radius` m run from it, and the drivers (unless `drivers` is false:
// a scream, not a shot) are frightened by it
function panic(ts: TrafficState, x: number, z: number, radius: number, drivers = true): void {
  if (drivers) {
    for (const v of ts.vehicles) {
      if (!v.edge || v.wrecked || v.isPolice) continue;
      const dx = v.x - x, dz = v.z - z, d2 = dx * dx + dz * dz;
      if (d2 <= radius * radius) frighten(v, x, z, Math.sqrt(d2) / radius);
    }
  }
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
    Object.assign(p, { node: null, waiting: false, v: 0, pause: 0, ride: null }); // (no camión for them now, pickups.ts)
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

// Where car v's wheels are drawn (render.ts): its model's own (its file's), else its body shape's stretched to its size.
// Its tyres' middles either side (m), its front & rear axles' z (m, the rear's negative), their radius (m)
const _wheels = { x: 0, front: 0, rear: 0, radius: 0 };
function wheelsOf(ts: TrafficState, v: Car): typeof _wheels {
  const own = v.model ? ts.modelBodies.get(v.model.id)?.wheels : null;
  if (own) return Object.assign(_wheels, own);
  const spec = BODY_SPECS[v.bodyType];
  _wheels.x = spec.wheelX * v.sx;
  _wheels.front = spec.wheelZ * v.sz;
  _wheels.rear = -spec.wheelZ * v.sz;
  _wheels.radius = spec.wheelRadius * v.sw;
  return _wheels;
}

// A shot striking car v at (x, y, z), low (its wheels' height): the tyre nearest, within 0.45 m of its tread, bursts.
// Whether one did (a bus's and a bike's are left whole)
function shootTyre(ts: TrafficState, v: Vehicle, x: number, y: number, z: number): boolean {
  if (v.bus || v.bike || v.moto || !v.edge) return false;
  const w = wheelsOf(ts, v), r = w.radius;
  if (y - (v.hy ?? hillAt(ts, x, z)) > r * 2 + 0.1) return false;
  const yaw = v.yaw + v.yawOffset, sn = Math.sin(yaw), cs = Math.cos(yaw);
  // (in its frame: + to its left, + ahead)
  const lx = (x - v.x) * cs - (z - v.z) * sn, lz = (x - v.x) * sn + (z - v.z) * cs;
  const bit = (lx < 0 ? 2 : 0) + (lz < (w.front + w.rear) / 2 ? 1 : 0);
  const wz = bit & 1 ? w.rear : w.front;
  if (Math.hypot(Math.abs(lx) - w.x, lz - wz) > r + 0.45 || (v.flats >> bit) & 1) return false;
  v.flats |= 1 << bit;
  spawnCollisionSparks(ts, x, 0.25, z, -sn, -cs, 4, v.hy ?? hillAt(ts, x, z));
  return true;
}

// Every tyre of the traffic's cars on a spike strip lying across the road: its middle (cx, cz), heading (rad, along
// it), half its length & width (m)
function spikeTraffic(ts: TrafficState, cx: number, cz: number, heading: number, halfLen: number, halfW: number): void {
  const ax = Math.sin(heading), az = Math.cos(heading);
  for (const v of ts.cars) {
    if (!v.edge || Math.abs(v.x - cx) > halfLen + 4 || Math.abs(v.z - cz) > halfLen + 4) continue;
    const w = wheelsOf(ts, v);
    const yaw = v.yaw + v.yawOffset, sn = Math.sin(yaw), cs = Math.cos(yaw);
    for (let bit = 0; bit < 4; bit++) {
      const lx = (bit & 2 ? -1 : 1) * w.x, lz = bit & 1 ? w.rear : w.front;
      const dx = v.x + lx * cs + lz * sn - cx, dz = v.z - lx * sn + lz * cs - cz;
      if (Math.abs(dx * ax + dz * az) <= halfLen && Math.abs(dx * az - dz * ax) <= halfW + 0.15) v.flats |= 1 << bit;
    }
  }
}

export { rayHit, shootPed, shootVehicle, shootTyre, spikeTraffic, blast, panic, knockBox };
