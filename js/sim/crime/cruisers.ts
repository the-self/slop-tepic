// js/sim/crime/cruisers.ts
// The patrol cars, the cartel's and the army's trucks (sim/crime.ts): spawning them down the road (or taking a patrol
// of the traffic over), the chase along the road graph, overtaking, dropping officers, gunmen or soldiers off, driving
// & bumping, blowing up, and ramming the player and each other.
import { boxHit } from '../mayhem.ts';
import { boxOverlap, wrapAngle } from '../weapons.ts';
import { POLICE, NARCO } from '../crime-rules.ts';
import type { Car } from '../traffic.ts';
import type { Faction, Cruiser } from './types.ts';
import { PARKED_Y, DESPAWN, CRUISER, CRUISER_HP, clamp, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

const tilt = { pitch: 0, roll: 0 };

// The bomberos' fire trucks and the Cruz Roja's ambulances: in the patrol cars' pool for their driving, collisions,
// sirens & gunfire, but sent and driven by sim/emergency.ts, never in a chase
export const isResponder = (cr: Cruiser): boolean => cr.faction === 'fire' || cr.faction === 'ambulance';

// A patrol car (faction 'police'), a cartel truck ('narco') or an army truck ('army') coming after the player, out of
// sight down the road, or from `at` (a patrol of the traffic taking up the chase: where it is, heading rad, speed m/s)
export function spawnCruiser(
  crime: CrimeSystem, faction: Faction = 'police', at: { x: number; z: number; heading: number; speed: number } | null = null
): Cruiser | null {
  const cr = crime.cruisers.find((c) => !c.active && c.faction === faction);
  if (!cr) return null;
  const s = at ?? crime.traffic.roadSpot(crime.px, crime.pz, 70, 160);
  if (!s) return null;
  Object.assign(cr, {
    active: true, x: s.x, z: s.z, heading: at ? at.heading : Math.atan2(crime.px - s.x, crime.pz - s.z), speed: at ? at.speed : 6,
    vx: 0, vz: 0, hp: CRUISER_HP[faction],
    wreck: 0, state: 'chase', path: null, pathI: 0, replan: 0, stuckT: 0, checkX: s.x, checkZ: s.z, reverseT: 0,
    deployed: false, life: 0, pitch: 0, roll: 0, lift: 0, vy: 0, stuckCount: 0, slowT: 0, startX: s.x, startZ: s.z
  });
  cr.bodyMesh.material = cr.paint;
  cr.lightbar.visible = faction === 'police';
  return cr;
}

// A patrol of the traffic that sees the wanted player takes up the chase: it leaves the traffic and goes on as one of
// the chase's own patrol cars, from where it is
export function takeOverPatrol(crime: CrimeSystem, v: Car): Cruiser | null {
  if (!crime.cruisers.some((c) => !c.active && c.faction === 'police')) return null;
  const cr = crime.spawnCruiser('police', { x: v.x, z: v.z, heading: v.yaw + v.yawOffset, speed: v.speed });
  if (cr) crime.traffic.withdraw(v);
  return cr;
}

export function removeCruiser(cr: Cruiser): void {
  cr.active = false;
  cr.mesh.position.y = PARKED_Y;
  cr.position.set(0, PARKED_Y, 0);
  cr.path = null;
}

export function damageCruiser(crime: CrimeSystem, cr: Cruiser, damage: number, byPlayer: boolean): void {
  if (cr.wreck) return;
  cr.hp -= damage;
  const police = cr.police;
  // (the crew saw who did it; the odd stray round once wanted adds nothing)
  if (byPlayer && police) crime.report('shootCop', damage > 10 || crime.wanted.stars === 0);
  if (byPlayer && cr.faction === 'narco') crime.angerGang(NARCO);
  if (cr.hp > 0) return;
  // blown up: a burning wreck for a while
  cr.wreck = 20;
  cr.speed = 0;
  cr.bodyMesh.material = crime.burnt;
  cr.lightbar.visible = false;
  if (byPlayer && police) crime.report('killCop', true);
  crime.explode(cr.x, cr.y + 0.8, cr.z, 7, 120, byPlayer);
  cr.vy = 6;
}

export function updateCruiser(crime: CrimeSystem, cr: Cruiser, dt: number): void {
  cr.life += dt;
  const dx = crime.px - cr.x, dz = crime.pz - cr.z;
  const dist = Math.hypot(dx, dz);
  if (cr.wreck) {
    cr.wreck -= dt;
    cr.speed = 0;
    if (Math.random() < dt * 14) crime.fx.flame(cr.x + rand(-0.8, 0.8), cr.y + 1, cr.z + rand(-1.5, 1.5), 1.1);
    if (Math.random() < dt * 8) crime.fx.smoke(cr.x, cr.y + 1.6, cr.z, 2.6, 0.9);
    if (cr.wreck <= 0 || dist > DESPAWN) crime.removeCruiser(cr);
    else crime.moveCruiser(cr, dt, 0);
    return;
  }
  if (isResponder(cr)) return; // (a fire truck or an ambulance: sim/emergency.ts drives it)
  const stars = crime.wanted.stars;
  const narco = cr.faction === 'narco';
  // the police chase while there are stars, the army from four, the cartel while it is after the player
  const done = narco ? crime.gangAnger[NARCO] <= 0 : cr.faction === 'army' ? !POLICE.soldiers[stars] : stars === 0;
  if (done || crime.state !== 'play') cr.state = 'leave';
  if (cr.state === 'leave' && (dist > 90 || cr.life > 90)) {
    crime.removeCruiser(cr);
    return;
  }
  if (dist > 280 || (cr.stuckCount > 3 && dist > 30)) {
    // left far behind, or hopelessly stuck: it comes round again closer (out of sight)
    crime.removeCruiser(cr);
    return;
  }

  // where to: straight at the player when it can be seen, else along the roads
  let tx = crime.px, tz = crime.pz;
  if (cr.state === 'leave') {
    tx = cr.x + Math.sin(cr.heading) * 40;
    tz = cr.z + Math.cos(cr.heading) * 40;
  } else {
    cr.replan -= dt;
    const direct = dist < 55 && crime.clearLine(cr.x, cr.z, crime.px, crime.pz);
    if (direct) {
      const lead = Math.min(1.2, dist / 18);
      tx = crime.px + crime.pvx * lead;
      tz = crime.pz + crime.pvz * lead;
    } else {
      // a new route when the player has moved on from where the last one led (or it ran out, or the car got stuck)
      if (!cr.path || (cr.replan <= 0 && Math.hypot(crime.px - cr.goalX, crime.pz - cr.goalZ) > 25)) {
        cr.path = crime.route(cr.x, cr.z, crime.px, crime.pz);
        // (without the intersections it is already past: on the way from the first to the second)
        while (cr.path && cr.path.length > 1 &&
          Math.hypot(cr.path[1].x - cr.x, cr.path[1].z - cr.z) < Math.hypot(cr.path[1].x - cr.path[0].x, cr.path[1].z - cr.path[0].z)) {
          cr.path.shift();
        }
        cr.pathI = 0;
        cr.startX = cr.x;
        cr.startZ = cr.z;
        cr.goalX = crime.px;
        cr.goalZ = crime.pz;
        cr.replan = 3;
      }
      if (cr.path && crime.pursue(cr, 10 + Math.abs(cr.speed) * 0.6) && crime._aim) {
        tx = crime._aim.x;
        tz = crime._aim.z;
      }
    }
  }
  // overtaking: something slow ahead in its way (a car or bus queued at a light), it pulls out round it (chasing or
  // leaving)
  const pass = crime.blockerAhead(cr);
  if (pass) {
    const side = cr.passSide || 1; // (left first: the oncoming lane)
    const lx = Math.cos(cr.heading) * side, lz = -Math.sin(cr.heading) * side;
    if (crime.solidAt(cr.x + lx * 3.2 + Math.sin(cr.heading) * 5, cr.z + lz * 3.2 + Math.cos(cr.heading) * 5)) cr.passSide = -side;
    tx = cr.x + Math.sin(cr.heading) * 12 + lx * 3.4 * pass;
    tz = cr.z + Math.cos(cr.heading) * 12 + lz * 3.4 * pass;
  }
  let want = narco ? 22 : POLICE.speed[stars] || 13;
  // stop near a player on foot and send the officers out
  cr.slowT = Math.abs(cr.speed) < 1.5 ? (cr.slowT || 0) + dt : 0;
  if (cr.state === 'chase' && crime.mode === 'person' && (dist < 15 || (dist < 35 && cr.slowT > 1.5))) {
    if (dist < 15) want = 0;
    if (!cr.deployed && Math.abs(cr.speed) < 1.5) {
      cr.deployed = true;
      crime.deployOfficers(cr);
    }
  }
  if (cr.state === 'chase' && crime.mode !== 'person' && dist > 15) cr.deployed = false;
  crime.moveCruiser(cr, dt, want, tx, tz);
}

// Pure pursuit along a patrol car's route (where it was when it planned, then the intersections): the point `look`
// m on along the street from the nearest point of the leg it is on, into crime._aim. False at the route's end.
export function pursue(crime: CrimeSystem, cr: Cruiser, look: number): boolean {
  const path = cr.path;
  if (!path) return false;
  const aim = (crime._aim ??= { x: 0, z: 0 });
  for (;;) {
    if (cr.pathI >= path.length) return false;
    const a = cr.pathI === 0 ? { x: cr.startX, z: cr.startZ } : path[cr.pathI - 1];
    const b = path[cr.pathI];
    const lx = b.x - a.x, lz = b.z - a.z;
    const len = Math.hypot(lx, lz);
    if (len < 0.5) {
      cr.pathI++;
      continue;
    }
    const t = ((cr.x - a.x) * lx + (cr.z - a.z) * lz) / len;
    const rest = len - t;
    if (rest < 4 && cr.pathI < path.length - 1) {
      cr.pathI++; // round the corner onto the next leg
      continue;
    }
    if (rest >= look || cr.pathI === path.length - 1) {
      const k = Math.min(len, Math.max(0, t) + look) / len;
      aim.x = a.x + lx * k;
      aim.z = a.z + lz * k;
      return cr.pathI < path.length - 1 || rest > 6;
    }
    // the corner is nearer than the lookahead: aim past it, along the next leg
    const c = path[cr.pathI + 1];
    const nx = c.x - b.x, nz = c.z - b.z;
    const nl = Math.hypot(nx, nz) || 1;
    const over = Math.min(nl, look - rest);
    aim.x = b.x + nx / nl * over;
    aim.z = b.z + nz / nl * over;
    return true;
  }
}

// How much a slow vehicle of the traffic stands in a patrol car's way within 14 m ahead (0 none .. 1 dead ahead)
export function blockerAhead(crime: CrimeSystem, cr: Cruiser): number {
  const fx = Math.sin(cr.heading), fz = Math.cos(cr.heading);
  let worst = 0;
  for (const list of [crime.traffic.cars, crime.traffic.buses]) {
    for (const v of list) {
      if (!v.edge || v.speed > Math.max(4, Math.abs(cr.speed) * 0.6)) continue;
      const dx = v.x - cr.x, dz = v.z - cr.z;
      if (Math.abs(dx) > 22 || Math.abs(dz) > 22) continue;
      const ahead = dx * fx + dz * fz - v.half;
      const across = Math.abs(dx * fz - dz * fx);
      if (ahead < 0 || ahead > 14 || across > v.halfWidth + cr.halfW + 0.5) continue;
      worst = Math.max(worst, 1 - across / (v.halfWidth + cr.halfW + 0.5) * 0.5);
    }
  }
  return worst;
}

export function deployOfficers(crime: CrimeSystem, cr: Cruiser): void {
  if (cr.faction !== 'police') {
    // the cartel's gunmen or the soldiers jump out with their rifles
    for (const side of [1, -1, 1]) {
      const lx = Math.cos(cr.heading) * side * 1.7, lz = -Math.sin(cr.heading) * side * 1.7;
      const back = side === 1 && crime.agents.length % 2 ? -1.8 : 0;
      const x = cr.x + lx + Math.sin(cr.heading) * back, z = cr.z + lz + Math.cos(cr.heading) * back;
      if (crime.solidAt(x, z)) continue;
      if (cr.faction === 'army') crime.spawnAgent('cop', x, z, { weapon: 'rifle', army: true });
      else crime.spawnAgent('gang', x, z, { gang: NARCO, weapon: 'rifle' });
    }
    return;
  }
  const stars = crime.wanted.stars;
  const cops = crime.agents.reduce((n, a) => n + (a.kind === 'cop' && !a.fallen ? 1 : 0), 0);
  for (const side of [1, -1]) {
    if (cops >= POLICE.foot[stars] + 3) break;
    const lx = Math.cos(cr.heading) * side * 1.6, lz = -Math.sin(cr.heading) * side * 1.6;
    if (crime.solidAt(cr.x + lx, cr.z + lz)) continue;
    crime.spawnAgent('cop', cr.x + lx, cr.z + lz, { weapon: POLICE.weapon[stars] || 'pistol' });
  }
}

// Drives a patrol car towards (tx, tz) at up to `want` m/s: steering with the speed it has, feeling ahead for walls,
// backing out when stuck
export function moveCruiser(crime: CrimeSystem, cr: Cruiser, dt: number, want: number, tx = cr.x, tz = cr.z): void {
  let steer = 0;
  if (want > 0) {
    const desired = Math.atan2(tx - cr.x, tz - cr.z);
    steer = wrapAngle(desired - cr.heading);
    // whiskers: a wall ahead turns it towards the clearer side
    const look = 3 + Math.abs(cr.speed) * 0.45;
    const probe = (a: number) => crime.solidAt(cr.x + Math.sin(cr.heading + a) * look, cr.z + Math.cos(cr.heading + a) * look);
    if (probe(0)) {
      const l = probe(0.6), r = probe(-0.6);
      if (!l && r) steer = 1;
      else if (l && !r) steer = -1;
      else steer = steer >= 0 ? 1 : -1;
      want *= 0.4;
    }
    want *= 1 - Math.min(0.7, Math.abs(steer) / 1.5);
  }
  // stuck (barely moved in 2 s while trying to go): back up a little the other way
  cr.stuckT += dt;
  if (cr.stuckT > 2) {
    if (want > 3 && Math.hypot(cr.x - cr.checkX, cr.z - cr.checkZ) < 2.5 && cr.reverseT <= 0) {
      cr.reverseT = 1.3;
      cr.stuckCount = (cr.stuckCount || 0) + 1;
      cr.path = null;
    } else if (Math.hypot(cr.x - cr.checkX, cr.z - cr.checkZ) > 12) {
      cr.stuckCount = 0;
    }
    cr.stuckT = 0;
    cr.checkX = cr.x;
    cr.checkZ = cr.z;
  }
  if (cr.reverseT > 0) {
    cr.reverseT -= dt;
    want = -5;
    steer = -Math.sign(steer || 1);
  }
  const accel = want > cr.speed ? (cr.speed < 0 ? CRUISER.brake : CRUISER.accel) : CRUISER.brake;
  cr.speed += clamp(want - cr.speed, -accel * dt, accel * dt);
  const grip = clamp(Math.abs(cr.speed) / 5, 0, 1) * Math.sign(cr.speed || 1);
  cr.heading += clamp(steer, -1, 1) * CRUISER.turn * grip * dt;

  const ox = cr.x, oz = cr.z;
  cr.x += Math.sin(cr.heading) * cr.speed * dt + cr.vx * dt;
  cr.z += Math.cos(cr.heading) * cr.speed * dt + cr.vz * dt;
  const k = Math.exp(-4 * dt);
  cr.vx *= k;
  cr.vz *= k;
  // its bumpers against the buildings
  const way = cr.speed >= 0 ? 1 : -1;
  const bx = cr.x + Math.sin(cr.heading) * cr.halfL * way, bz = cr.z + Math.cos(cr.heading) * cr.halfL * way;
  if (crime.solidAt(bx, bz) || crime.solidAt(cr.x, cr.z)) {
    cr.x = ox;
    cr.z = oz;
    if (Math.abs(cr.speed) > 6) crime.traffic.sparks(bx, cr.y + 0.6, bz, -Math.sin(cr.heading) * way, -Math.cos(cr.heading) * way, Math.abs(cr.speed));
    cr.speed *= -0.2;
    cr.vx = cr.vz = 0;
  }
  if (!cr.wreck) {
    // (they shove the traffic aside as if they weighed three times as much: a chase doesn't wait in line)
    const mass = cr.mass; // (its own: a fire truck's is not a patrol car's)
    cr.mass = mass * 3;
    crime.traffic.bumpBody(cr);
    cr.mass = mass;
    crime.traffic.knockBox(cr.x, cr.z, cr.heading, cr.halfW, cr.halfL,
      Math.sin(cr.heading) * cr.speed + cr.vx, Math.cos(cr.heading) * cr.speed + cr.vz);
    // patrol cars knock down the gangs and thieves in their way, not their own
    if (Math.abs(cr.speed) > 3) {
      for (const a of crime.agents) {
        if (a.fallen || (cr.police ? a.kind === 'cop' : a.gang === NARCO)) continue;
        const hit = boxHit(cr.x, cr.z, cr.heading, cr.halfW, cr.halfL, a.x, a.z, 0.3);
        if (!hit) continue;
        a.hp -= Math.abs(cr.speed) * 6;
        crime.knockAgent(a, Math.sin(cr.heading) * cr.speed, Math.cos(cr.heading) * cr.speed, hit.nx, hit.nz);
        if (a.hp <= 0) crime.kill(a);
      }
    }
  }

  // on the ground, tilted with it
  cr.y = crime.groundAt(cr.x, cr.z);
  if (cr.vy) {
    cr.vy -= 9.8 * dt;
    cr.lift = Math.max(0, (cr.lift || 0) + cr.vy * dt);
    if (cr.lift === 0) cr.vy = 0;
  }
  crime.controllers.groundTilt(cr.x, cr.z, cr.heading, 1.4, 0.8, tilt);
  cr.pitch += (tilt.pitch - cr.pitch) * Math.min(1, dt * 10);
  cr.roll += (tilt.roll - cr.roll) * Math.min(1, dt * 10);
  cr.mesh.position.set(cr.x, cr.y + (cr.lift || 0), cr.z);
  cr.mesh.rotation.y = cr.heading;
  cr.tiltPivot.rotation.set(cr.pitch, 0, cr.roll + (cr.wreck ? 0.05 : 0), 'YXZ');
  cr.position.set(cr.x, cr.y + 0.7, cr.z);
}

// Patrol cars against the player and each other
export function collideCruisers(crime: CrimeSystem): void {
  const pe = crime.player;
  const box = crime._playerBox ??= { x: 0, z: 0, heading: 0, hw: 0, hl: 0 };
  const size = crime.playerSize();
  for (const cr of crime.cruisers) {
    if (!cr.active) continue;
    cr.hw = cr.halfW;
    cr.hl = cr.halfL;
    if (size && crime.onStreet) {
      box.x = pe.position.x;
      box.z = pe.position.z;
      box.heading = pe.heading;
      box.hw = size[0];
      box.hl = size[1];
      const hit = boxOverlap(cr, box);
      if (hit) {
        const pm = crime.mode === 'car' ? 1300 : crime.mode === 'moto' ? 260 : crime.mode === 'cyclist' ? 95 : 75;
        const share = cr.mass / (cr.mass + pm); // the player's share of the push
        pe.position.x += hit.nx * hit.pen * share;
        pe.position.z += hit.nz * hit.pen * share;
        cr.x -= hit.nx * hit.pen * (1 - share);
        cr.z -= hit.nz * hit.pen * (1 - share);
        const cvx = Math.sin(cr.heading) * cr.speed + cr.vx, cvz = Math.cos(cr.heading) * cr.speed + cr.vz;
        const approach = (cvx - crime.pvx) * hit.nx + (cvz - crime.pvz) * hit.nz;
        if (approach > 0.5) {
          if (crime.mode === 'car') {
            const kick = approach * share * 0.7;
            const fx = Math.sin(pe.heading), fz = Math.cos(pe.heading);
            const along = fx * hit.nx + fz * hit.nz; // the push along the player's heading: + rammed from behind
            if (pe.speed * along < 0) {
              // driven into it: it loses speed and is knocked back
              pe.speed *= 0.8;
              pe.vx = (pe.vx || 0) + hit.nx * kick;
              pe.vz = (pe.vz || 0) + hit.nz * kick;
            } else {
              // rammed from behind (or standing): shoved on its way, never braked, so it can still drive off
              pe.speed += kick * along;
              pe.vx = (pe.vx || 0) + (hit.nx - fx * along) * kick;
              pe.vz = (pe.vz || 0) + (hit.nz - fz * along) * kick;
            }
            pe.angularVel = (pe.angularVel || 0) + (Math.random() - 0.5) * approach * 0.15;
            pe.rollVel = (pe.rollVel || 0) + approach * 0.2;
          }
          cr.speed *= 0.6;
          cr.vx -= hit.nx * approach * (1 - share) * 0.5;
          cr.vz -= hit.nz * approach * (1 - share) * 0.5;
          crime.audio?.crash?.({ a: cr, b: pe, x: pe.position.x - hit.nx * size[0], y: pe.position.y + 0.6, z: pe.position.z - hit.nz * size[0], speed: approach });
          if (approach > 2) crime.traffic.sparks(pe.position.x - hit.nx * size[0], pe.position.y + 0.6, pe.position.z - hit.nz * size[0], hit.nx, hit.nz, approach);
          // a car ramming the player hurts it: badly on foot
          if (crime.mode === 'person' && approach > 3) crime.hurt(approach * 3.5, cr.x, cr.z);
          else if (approach > 7) crime.hurt((approach - 7) * 1.5, cr.x, cr.z);
        }
      }
    }
    for (const o of crime.cruisers) {
      if (o === cr || !o.active) continue;
      o.hw = o.halfW;
      o.hl = o.halfL;
      const hit = boxOverlap(cr, o);
      if (!hit) continue;
      o.x += hit.nx * hit.pen * 0.5;
      o.z += hit.nz * hit.pen * 0.5;
      cr.x -= hit.nx * hit.pen * 0.5;
      cr.z -= hit.nz * hit.pen * 0.5;
    }
  }
}
