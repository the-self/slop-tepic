// js/sim/crime/helicopter.ts
// The police helicopter (sim/crime.ts), from four stars: it comes in high from out of sight, circles the player and
// keeps up with it, its gunner firing bursts from the door when the roofs don't hide the player; shot down, it spins
// out of the sky and blows up where it comes down. It leaves once the stars drop below four.
import { POLICE } from '../crime-rules.ts';
import { wrapAngle, hitChance } from '../weapons.ts';
import type { Helicopter } from './types.ts';
import { PARKED_Y, HELI_ALT, HELI_ORBIT, HELI_SPEED, HELI_HP, HELI_GUN, HELI_RESPAWN, SKILL, clamp, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

// It comes in from ~240 m off, high, out of sight
export function spawnHeli(crime: CrimeSystem): void {
  const h = crime.heli;
  const ang = Math.random() * Math.PI * 2;
  h.x = crime.huntX + Math.cos(ang) * 240;
  h.z = crime.huntZ + Math.sin(ang) * 240;
  h.y = Math.max(crime.groundAt(h.x, h.z), crime.groundAt(crime.huntX, crime.huntZ)) + HELI_ALT + 30;
  h.heading = Math.atan2(crime.huntX - h.x, crime.huntZ - h.z);
  h.vx = h.vy = h.vz = 0;
  h.active = true;
  h.state = 'chase';
  h.hp = HELI_HP;
  h.orbit = ang + Math.PI;
  h.life = 0;
  h.cooldown = 3;
  h.burst = 0;
  h.spin = 0;
  crime.toast('A police helicopter is after you');
}

export function removeHeli(h: Helicopter): void {
  h.active = false;
  h.mesh.position.y = PARKED_Y;
  h.position.set(0, PARKED_Y, 0);
}

export function damageHeli(crime: CrimeSystem, damage: number, byPlayer: boolean): void {
  const h = crime.heli;
  if (!h.active || h.state === 'down') return;
  h.hp -= damage;
  if (byPlayer) crime.report('shootCop', damage > 10 || crime.wanted.stars === 0);
  if (h.hp > 0) return;
  // shot down: it spins out of the sky, smoking, and blows up where it comes down
  h.state = 'down';
  h.spin = (Math.random() < 0.5 ? -1 : 1) * 2.6;
  crime.fx.explosion(h.x, h.y + 1.4, h.z, 3);
  crime.audio?.gunfire?.('explosion', h.x, h.y + 1.4, h.z);
  crime.timers.heli = HELI_RESPAWN;
  if (byPlayer) {
    crime.report('killCop', true);
    crime.toast('Helicopter down!');
  }
}

export function updateHeli(crime: CrimeSystem, dt: number): void {
  const h = crime.heli;
  if (!h.active) return;
  h.life += dt;
  const dx = crime.px - h.x, dz = crime.pz - h.z;
  const dist = Math.hypot(dx, dz);
  if (h.state === 'down') {
    h.vy -= 9.8 * dt;
    h.vx *= Math.exp(-0.5 * dt);
    h.vz *= Math.exp(-0.5 * dt);
    h.heading += h.spin * dt;
    if (Math.random() < dt * 20) crime.fx.smoke(h.x, h.y + 1.8, h.z, 2.4, 0.9);
    if (Math.random() < dt * 12) crime.fx.flame(h.x + rand(-0.6, 0.6), h.y + 1.6, h.z + rand(-0.6, 0.6), 1.2);
  } else {
    if (h.state === 'chase' && (crime.state !== 'play' || !POLICE.helicopter[crime.wanted.stars])) h.state = 'leave';
    const ground = Math.max(crime.groundAt(h.x, h.z), crime.groundAt(crime.px, crime.pz));
    let tx, tz, ty, follow = 0;
    if (h.state === 'leave') {
      // off away from the player, climbing, gone once far enough
      if (dist > 330 || h.life > 240) {
        removeHeli(h);
        return;
      }
      tx = h.x - dx / Math.max(1, dist) * 200;
      tz = h.z - dz / Math.max(1, dist) * 200;
      ty = ground + HELI_ALT + 40;
    } else {
      // round the player, keeping up with it; once the police have lost it, wider round where they last saw it
      const seen = crime.seen;
      const cx = crime.huntX, cz = crime.huntZ;
      h.orbit += dt * 0.2;
      tx = cx + Math.cos(h.orbit) * HELI_ORBIT * (seen ? 1 : 2);
      tz = cz + Math.sin(h.orbit) * HELI_ORBIT * (seen ? 1 : 2);
      ty = ground + HELI_ALT;
      follow = seen ? 1 : 0;
    }
    const ex = tx - h.x, ez = tz - h.z;
    const ed = Math.hypot(ex, ez) || 1;
    const cruise = Math.min(HELI_SPEED, ed * 0.5);
    const wantX = ex / ed * cruise + crime.pvx * follow, wantZ = ez / ed * cruise + crime.pvz * follow;
    const k = Math.min(1, dt * 0.9);
    h.vx += (wantX - h.vx) * k;
    h.vz += (wantZ - h.vz) * k;
    // a building ahead at its height: up over it
    const climb = crime.controllers.isSolidAt(h.x + h.vx * 1.5, h.z + h.vz * 1.5, 3, h.y - 1);
    h.vy += ((climb ? 10 : clamp((ty - h.y) * 0.8, -6, 8)) - h.vy) * Math.min(1, dt * 2);
    // facing the player while it hunts it (the gunner's door towards it), its way when it leaves
    const face = h.state === 'chase' ? Math.atan2(dx, dz) : Math.atan2(h.vx, h.vz);
    h.heading += clamp(wrapAngle(face - h.heading), -1.3 * dt, 1.3 * dt);
    if (h.state === 'chase') heliShoot(crime, h, dt);
  }
  h.x += h.vx * dt;
  h.y += h.vy * dt;
  h.z += h.vz * dt;
  h.speed = Math.hypot(h.vx, h.vz);
  if (h.state === 'down') {
    const g = crime.groundAt(h.x, h.z);
    if (h.y <= g + 0.2 || crime.controllers.isSolidAt(h.x, h.z, 1.5, h.y)) {
      crime.explode(h.x, Math.max(h.y, g + 0.6), h.z, 9, 140, false);
      removeHeli(h);
      return;
    }
  }
  // leaning into its way: nose down going ahead, banked into a sideways drift (+x is its left)
  const fwd = h.vx * Math.sin(h.heading) + h.vz * Math.cos(h.heading);
  const side = h.vx * Math.cos(h.heading) - h.vz * Math.sin(h.heading);
  h.pitch += (clamp(fwd * 0.012, -0.3, 0.3) - h.pitch) * Math.min(1, dt * 3);
  h.roll += (clamp(-side * 0.012, -0.3, 0.3) - h.roll) * Math.min(1, dt * 3);
  h.rotor.rotation.y += dt * 28;
  h.tail.rotation.x += dt * 42;
  const flash = (h.life * 2.5) % 1 < 0.5;
  h.red.visible = flash;
  h.blue.visible = !flash;
  h.mesh.position.set(h.x, h.y, h.z);
  h.mesh.rotation.y = h.heading;
  h.tiltPivot.rotation.set(h.pitch, 0, h.roll, 'YXZ');
  h.position.set(h.x, h.y, h.z);
}

// The gunner at the helicopter's door: bursts at the player when it can see it past the roofs
function heliShoot(crime: CrimeSystem, h: Helicopter, dt: number): void {
  h.cooldown -= dt;
  if (h.cooldown > 0 || crime.state !== 'play') return;
  // (the left door: +x of its heading)
  const gx = h.x + Math.cos(h.heading) * 1.1, gy = h.y + 1.2, gz = h.z - Math.sin(h.heading) * 1.1;
  const py = crime.player.position.y + (crime.mode === 'person' ? 1.2 : 0.9);
  const range = Math.hypot(crime.px - gx, py - gy, crime.pz - gz);
  if (range > HELI_GUN.range || !skyLine(crime, gx, gy, gz, crime.px, py, crime.pz)) {
    h.cooldown = 0.4;
    return;
  }
  h.burst = h.burst > 0 ? h.burst - 1 : HELI_GUN.burst - 1;
  h.cooldown = h.burst > 0 ? 0.1 : 1 / HELI_GUN.rate + rand(0.2, 0.8);
  const yaw = Math.atan2(crime.px - gx, crime.pz - gz);
  crime.fx.muzzle(gx, gy, gz, yaw);
  crime.audio?.gunfire?.('smg', gx, gy, gz);
  if (Math.random() < hitChance(range, crime.pspeed, SKILL.heli, HELI_GUN.range)) {
    crime.fx.tracer(gx, gy, gz, crime.px, py, crime.pz);
    crime.fx.impact(crime.px, py, crime.pz, crime.mode === 'person' ? 'blood' : 'metal', -Math.sin(yaw), -Math.cos(yaw));
    crime.hurt(HELI_GUN.damage, h.x, h.z);
  } else {
    // a miss: into the street round the player
    const mx = crime.px + rand(-2.5, 2.5), mz = crime.pz + rand(-2.5, 2.5);
    const my = crime.groundAt(mx, mz);
    crime.fx.tracer(gx, gy, gz, mx, my, mz);
    crime.fx.impact(mx, my + 0.03, mz, 'dust', -Math.sin(yaw), -Math.cos(yaw));
  }
  crime.traffic.panic(crime.px, crime.pz, 30);
}

// Can one see from (x0, y0, z0) down to (x1, y1, z1) past the buildings? (eight points along it)
export function skyLine(crime: CrimeSystem, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    if (crime.controllers.isSolidAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.2, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}
