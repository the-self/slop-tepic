// js/sim/crime/gunfire.ts
// Shots, rockets and explosions (sim/crime.ts): free aim along the crosshair, what a shot meets first and what it does
// to it, rockets in flight, and blasts that throw people, shove cars and hurt the player.
import type * as THREE from 'three/webgpu';
import type { Weapon } from '../weapons.ts';
import type { Ped, Vehicle } from '../traffic.ts';
import { WEAPONS, rayCircle, rayBox, blastFalloff } from '../weapons.ts';
import type { TraceKind, XZ, Agent, Cruiser, TraceTarget, TraceHit } from './types.ts';
import { BODY_R, PERSON_H, CAR_H, BUS_H, inBody, clamp } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

// Free aim: what the crosshair's ray (the middle of the screen, from the camera) meets first, past the player, within
// the weapon's reach; its point goes into crime.aimPoint (the shots are fired from the gun at it). Returns the trace.
export function aimAlong(crime: CrimeSystem, camera: THREE.Camera | null, w: Weapon): TraceHit {
  const a = crime.aimPoint;
  if (!camera) return crime._trace;
  const d = camera.getWorldDirection(crime._camDir);
  const o = camera.position;
  const h = Math.max(0.05, Math.hypot(d.x, d.z));
  const yaw = Math.atan2(d.x, d.z);
  const slope = d.y / h;
  // (from level with the player on: no one behind it, between it and the camera, takes the shot)
  const from = Math.max(0, (crime.px - o.x) * d.x / h + (crime.pz - o.z) * d.z / h + 0.3);
  const reach = from + (w.melee ? 6 : w.range);
  const hit = crime.trace(o.x, o.y, o.z, yaw, reach, slope, from);
  const t = hit.kind === 'none' ? reach : hit.t;
  a.x = o.x + Math.sin(yaw) * t;
  a.z = o.z + Math.cos(yaw) * t;
  a.y = o.y + slope * t;
  return hit;
}

// What a shot from (ox, oy, oz) along `yaw` meets first within `range` m (past `from` m), into crime._trace
// { t, kind: 'none' | 'wall' | 'ground' | 'agent' | 'cruiser' | 'ped' | 'vehicle', target }. Level (slope null), it
// takes whoever stands in the line on the map; with a `slope` (m up per m along: aimed up or down) it passes over or
// under people and vehicles, meets walls at its own height, and can hit the street.
export function trace(crime: CrimeSystem, ox: number, oy: number, oz: number, yaw: number, range: number, slope: number | null = null, from = 0): TraceHit {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const out = crime._trace;
  let best = range;
  let kind: TraceKind = 'none';
  let target: TraceTarget | null = null;
  const pitched = slope !== null;
  // (the height of the shot over the ground at t m: on someone's body, or on a car's?)
  const over = (t: number, x: number, z: number) => oy + (slope ?? 0) * t - crime.groundAt(x, z);
  // walls (and the street), every 0.8 m
  for (let t = Math.max(0.6, from); t < best; t += 0.8) {
    const x = ox + dx * t, z = oz + dz * t;
    if (pitched) {
      const y = oy + slope * t;
      if (y < crime.groundAt(x, z)) {
        best = Math.max(from, t - 0.4);
        kind = 'ground';
        break;
      }
      if (crime.controllers.isSolidAt(x, z, 0.2, y - 0.1)) {
        best = t;
        kind = 'wall';
        break;
      }
    } else if (crime.solidAt(x, z)) {
      best = t;
      kind = 'wall';
      break;
    }
  }
  for (const a of crime.agents) {
    if (a.fallen) continue;
    const t = rayCircle(ox, oz, dx, dz, a.x, a.z, BODY_R);
    if (t < from || t >= best) continue;
    if (pitched && !inBody(over(t, a.x, a.z), PERSON_H)) continue;
    best = t;
    kind = 'agent';
    target = a;
  }
  for (const cr of crime.cruisers) {
    if (!cr.active) continue;
    const t = rayBox(ox, oz, dx, dz, cr.x, cr.z, cr.heading, cr.halfW, cr.halfL);
    if (t < from || t >= best) continue;
    if (pitched && !inBody(over(t, cr.x, cr.z), CAR_H)) continue;
    best = t;
    kind = 'cruiser';
    target = cr;
  }
  const accept = pitched || from > 0
    ? (k: 'ped' | 'vehicle', o: XZ & { bus?: boolean }, t: number) => t >= from && (!pitched || inBody(over(t, o.x, o.z), k === 'ped' ? PERSON_H : o.bus ? BUS_H : CAR_H))
    : null;
  const street = crime.traffic.rayHit(ox, oz, dx, dz, best, accept);
  if (street?.kind) {
    best = street.t;
    kind = street.kind;
    target = street.target;
  }
  out.t = best;
  out.kind = kind;
  out.target = target;
  return out;
}

// A shot from (ox, oy, oz) along `yaw`, sloping towards height ty at the end (or along `slope`, aimed freely): the
// first thing in its way takes it
export function hitScan(crime: CrimeSystem, ox: number, oy: number, oz: number, yaw: number, ty: number, w: Weapon, byPlayer: boolean, slope: number | null = null): void {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const { t: best, kind, target } = crime.trace(ox, oy, oz, yaw, w.range, slope);
  const ex = ox + dx * best, ez = oz + dz * best;
  let ey;
  if (slope !== null) ey = oy + slope * best;
  else {
    ey = kind === 'none' || kind === 'wall' ? oy + (ty - oy) / Math.max(1, best) * best : 0;
    if (kind === 'agent' || kind === 'ped') ey = crime.groundAt(ex, ez) + 1.2;
    else if (kind === 'cruiser' || kind === 'vehicle') ey = crime.groundAt(ex, ez) + 0.85;
  }
  if (kind === 'ground') ey = crime.groundAt(ex, ez) + 0.03;
  crime.fx.tracer(ox, oy, oz, ex, ey, ez);

  if (kind === 'wall' || kind === 'ground') crime.fx.impact(ex, ey, ez, 'dust', -dx, -dz);
  else if (kind === 'agent') {
    crime.fx.impact(ex, ey, ez, 'blood', dx, dz);
    crime.damageAgent(target as Agent, w.damage, dx, dz, byPlayer);
  } else if (kind === 'cruiser') {
    crime.fx.impact(ex, ey, ez, 'metal', -dx, -dz);
    crime.damageCruiser(target as Cruiser, w.damage * 0.22, byPlayer);
  } else if (kind === 'ped') {
    crime.fx.impact(ex, ey, ez, 'blood', dx, dz);
    crime.traffic.shootPed(target as Ped, dx, dz, 3.5);
    if (byPlayer) crime.report('shootPed');
  } else if (kind === 'vehicle') {
    crime.fx.impact(ex, ey, ez, 'metal', -dx, -dz);
    crime.traffic.shootVehicle(target as Vehicle, ex, ey, ez, dx, dz);
    if (byPlayer) crime.report('shootCar', crime.copNear(ex, ez, 50));
  }
}

export function updateRockets(crime: CrimeSystem, dt: number): void {
  const w = WEAPONS.bazooka;
  for (let i = crime.rockets.length - 1; i >= 0; i--) {
    const k = crime.rockets[i];
    k.t += dt;
    const step = w.rocket * dt;
    let hit = k.t > w.range / w.rocket;
    let travelled = 0;
    // in 1 m steps so it can't skip through a wall or a car
    while (!hit && travelled < step) {
      const s = Math.min(1, step - travelled);
      travelled += s;
      k.x += k.dx * (k.dh ?? 1) * s;
      k.z += k.dz * (k.dh ?? 1) * s;
      k.y += (k.dy || 0) * s;
      const g = crime.groundAt(k.x, k.z);
      // (over the roofs and the people, aimed up: it flies on)
      const low = k.y < g + 2.2;
      if (k.y < g + 0.15 || (low ? crime.solidAt(k.x, k.z) : crime.controllers.isSolidAt(k.x, k.z, 0.3, k.y - 0.15))) hit = true;
      for (const a of crime.agents) if (!hit && low && !a.fallen && Math.hypot(a.x - k.x, a.z - k.z) < 0.6) hit = true;
      for (const cr of crime.cruisers) {
        if (!hit && low && cr.active && rayBox(k.x, k.z, k.dx, k.dz, cr.x, cr.z, cr.heading, cr.halfW, cr.halfL) === 0) hit = true;
      }
      if (!hit && k.y < g + BUS_H) {
        const street = crime.traffic.rayHit(k.x - k.dx * 0.5, k.z - k.dz * 0.5, k.dx, k.dz, 0.6);
        if (street) hit = true;
      }
    }
    if (hit) {
      crime.fx.dropRocket(k.r);
      crime.rockets.splice(i, 1);
      crime.explode(k.x, Math.max(k.y, crime.groundAt(k.x, k.z) + 0.4), k.z, w.blast, w.damage, true);
    } else {
      crime.fx.placeRocket(k.r, k.x, k.y, k.z, Math.atan2(k.dx, k.dz), -Math.asin(k.dy || 0));
    }
  }
}

// An explosion at (x, y, z) of `radius` m: fire & smoke, people thrown, cars shoved, patrol cars and the player hurt
export function explode(crime: CrimeSystem, x: number, y: number, z: number, radius: number, damage: number, byPlayer: boolean): void {
  crime.fx.explosion(x, y, z, radius);
  crime.onExplosion?.(x, y, z, radius); // (a burning wreck, a house catching: fires.ts)
  crime.audio?.gunfire?.('explosion', x, y, z);
  const near = Math.hypot(crime.camera ? crime.camera.position.x - x : 0, crime.camera ? crime.camera.position.z - z : 0);
  crime.shake = Math.min(1.6, crime.shake + clamp(1.6 - near / 40, 0, 1.6));
  const thrown = crime.traffic.blast(x, z, radius * 1.4, 24);
  crime.traffic.panic(x, z, 70);
  if (byPlayer) crime.report(thrown > 0 ? 'shootPed' : 'explosion');
  if (byPlayer && thrown > 1) crime.report('explosion');
  for (const a of [...crime.agents]) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d > radius * 1.4) continue;
    const k = blastFalloff(d, radius * 1.4);
    const nx = d > 0.01 ? (a.x - x) / d : 1, nz = d > 0.01 ? (a.z - z) / d : 0;
    crime.damageAgent(a, damage * k, nx, nz, byPlayer, 22 * k);
  }
  for (const cr of crime.cruisers) {
    if (!cr.active) continue;
    const d = Math.hypot(cr.x - x, cr.z - z);
    if (d > radius + cr.halfL) continue;
    const k = blastFalloff(Math.max(0, d - cr.halfW), radius);
    const nx = d > 0.01 ? (cr.x - x) / d : 1, nz = d > 0.01 ? (cr.z - z) / d : 0;
    cr.vx += nx * 14 * k;
    cr.vz += nz * 14 * k;
    if (!cr.wreck) crime.damageCruiser(cr, damage * k, byPlayer);
  }
  // the player
  const pd = Math.hypot(crime.px - x, crime.pz - z);
  if (pd < radius * 1.3 && crime.state === 'play') {
    const k = blastFalloff(pd, radius * 1.3);
    crime.hurt(95 * k, x, z);
    const pe = crime.player;
    if (crime.mode === 'car') {
      pe.vx = (pe.vx || 0) + (crime.px - x) / Math.max(pd, 0.5) * 12 * k;
      pe.vz = (pe.vz || 0) + (crime.pz - z) / Math.max(pd, 0.5) * 12 * k;
      pe.rollVel = (pe.rollVel || 0) + 6 * k;
      pe.heaveVel = (pe.heaveVel || 0) + 3 * k;
    }
  }
}
