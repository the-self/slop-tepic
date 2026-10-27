// js/sim/crime/agents.ts
// The people on foot of the street's crime (sim/crime.ts): police (soldiers among them, from four stars), gang members
// (the cartel's among them) and thieves:
// spawning them, hurting and knocking them down, what each kind does every frame, walking round walls and vehicles,
// the police and the cartel finding each other, and their shots.
import { PersonRig, OUTFIT, OUTFIT_SEED } from '../pedestrians.ts';
import type { StreetGun } from '../crime-rules.ts';
import { boxHit } from '../mayhem.ts';
import { throwVelocity, bleedOf } from '../ragdolls.ts';
import { roundBox, hitChance, wrapAngle } from '../weapons.ts';
import { POLICE, GANGS, NARCO } from '../crime-rules.ts';
import type { AgentKind, NpcGun, Agent } from './types.ts';
import { MAX_AGENTS, BODY_R, RUN, THIEF_RUN, WALK, DOWN_TIME, DEAD_TIME, DESPAWN, NPC_GUN, FOE_DAMAGE, FOE_RANGE, SKILL, clamp, rand, dummy } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';
import { t } from '../../i18n/i18n.ts';

const TYRE_HIT = 0.08; // share of the rounds hitting the player's car that burst a tyre
const REVIVED_HP = 35; // what someone the paramédicos brought round has left of their health

// (a soldier, `army`, is one of the police: kind 'cop', in fatigues, with a rifle and more to them)
export function spawnAgent(
  crime: CrimeSystem, kind: AgentKind, x: number, z: number,
  { gang = -1, weapon = null, army = false }: { gang?: number; weapon?: StreetGun | null; army?: boolean } = {}
): Agent | null {
  if (crime.agents.length >= MAX_AGENTS) return null;
  const outfit = army ? OUTFIT.soldier : kind === 'cop' ? OUTFIT.police : kind === 'thief' ? OUTFIT.thief : GANGS[gang].outfit;
  const rig = new PersonRig({
    seed: outfit * OUTFIT_SEED + Math.floor(Math.random() * 997) + 0.5,
    scale: rand(0.95, 1.06), girth: rand(0.95, 1.12), hair: rand(0, 0.25), armSwing: rand(0.9, 1.1)
  });
  const a: Agent = {
    kind, gang, army, rig, x, z, heading: Math.atan2(crime.huntX - x, crime.huntZ - z), speed: 0, hp: army ? 150 : kind === 'cop' ? 100 : 80,
    fallen: null, dead: false, state: kind === 'thief' ? 'approach' : kind === 'gang' ? 'idle' : 'chase',
    t: 0, weapon, cooldown: rand(0.5, 1.5), burst: 0, homeX: x, homeZ: z, money: 0, arrest: 0, idleYaw: Math.random() * 6.28,
    wanderT: rand(2, 6), los: false, losT: 0, stepT: 0, foe: null, foeT: Math.random() * 0.5
  };
  crime.agents.push(a);
  return a;
}

// The player took a gang on: they come after it (the cartel sends its trucks, see dispatch)
export function angerGang(crime: CrimeSystem, g: number): void {
  if (g === NARCO && crime.gangAnger[g] <= 0) crime.timers.trucks = Math.min(crime.timers.trucks, 4);
  crime.gangAnger[g] = g === NARCO ? 120 : 90;
}

export function removeAgent(crime: CrimeSystem, a: Agent): void {
  crime.ragdolls?.release(a.fallen);
  a.fallen = null;
  const i = crime.agents.indexOf(a);
  if (i >= 0) crime.agents.splice(i, 1);
}

// Someone hurt: `damage` hit points, knocked along (nx, nz) at `throwSpeed` m/s if it brings them down
export function damageAgent(crime: CrimeSystem, a: Agent, damage: number, nx: number, nz: number, byPlayer: boolean, throwSpeed = 3): void {
  if (a.dead) return;
  a.hp -= damage;
  const killed = a.hp <= 0;
  if (byPlayer) {
    // (crimes against the police: they saw it themselves)
    if (a.kind === 'cop') crime.report(killed ? 'killCop' : damage > 15 ? 'shootCop' : 'hitCop', true);
    if (a.kind === 'gang') crime.angerGang(a.gang);
  }
  if (a.kind === 'cop' && byPlayer && crime.wanted.stars === 0) crime.report('hitCop', true);
  if (!killed && throwSpeed < 6) {
    // a flinch: shot but still standing
    a.stepT = 0.25;
    if (a.kind === 'thief' && a.state === 'approach') a.state = 'leave';
    return;
  }
  crime.knockAgent(a, nx * throwSpeed, nz * throwSpeed, nx, nz);
  if (killed) crime.kill(a);
}

// Brings `a` down as a ragdoll (sim/ragdolls.ts), hit at (vx, vz) along (nx, nz); by the player's car (`byCar`) its
// body throws theirs itself. `bleed` (0..1): how badly they bleed where they come to rest (kill: the dead do)
export function knockAgent(crime: CrimeSystem, a: Agent, vx: number, vz: number, nx: number, nz: number, byCar = false, bleed = 0): void {
  if (a.fallen || !crime.ragdolls) return;
  a.rig.update(1 / 60, a.x, a.z, a.heading, crime.personGround, a, 0, true);
  a.rig.aim = 0;
  const v = byCar ? { vx: 0, vy: 0, vz: 0 } : throwVelocity(vx, vz, nx, nz);
  a.fallen = crime.ragdolls.spawn(a.rig, { ...v, spin: byCar ? 0 : 2 + Math.hypot(vx, vz) * 0.3, bleed });
}

export function kill(crime: CrimeSystem, a: Agent): void {
  a.dead = true;
  a.hp = 0;
  if (a.fallen) a.fallen.bleed = Math.max(a.fallen.bleed, 0.9);
  // what they leave behind
  if (a.kind === 'thief' && a.money > 0) {
    crime.drop('money', a.x, a.z, a.money);
    crime.toast(t('toast.getMoneyBack'));
    a.money = 0;
  } else if (a.kind === 'cop' && Math.random() < 0.7) {
    crime.drop(a.weapon === 'smg' || a.weapon === 'rifle' ? a.weapon : 'pistol', a.x, a.z);
  } else if (a.kind === 'gang') {
    const narco = a.gang === NARCO;
    if (Math.random() < (narco ? 0.75 : 0.6)) crime.drop(a.weapon ?? 'pistol', a.x, a.z);
    if (Math.random() < 0.7) crime.drop('money', a.x + 0.6, a.z, Math.round(narco ? rand(60, 220) : rand(15, 70)));
  }
}

export function updateAgent(crime: CrimeSystem, a: Agent, dt: number): void {
  const dx = crime.px - a.x, dz = crime.pz - a.z;
  const dist = Math.hypot(dx, dz);
  a.t += dt;
  // (a body an ambulance is coming for lies there till the paramédicos take it, sim/emergency.ts)
  if (dist > DESPAWN || (a.dead && a.fallen && a.fallen.rest > DEAD_TIME && !a.fallen.awaiting)) {
    crime.removeAgent(a);
    return;
  }
  if (a.fallen) {
    const f = a.fallen;
    a.x = f.px;
    a.z = f.pz;
    // brought round by the paramédicos (sim/emergency.ts): alive again, weak, and unarmed (what they had was dropped
    // when they died: kill)
    if (a.dead && f.revived) {
      a.dead = false;
      a.hp = REVIVED_HP;
      a.weapon = null;
    }
    if (!a.dead && f.rest > DOWN_TIME) {
      // back on their feet, and angry
      crime.ragdolls?.release(f);
      a.fallen = null;
      a.rig.reset(a.x, a.z, a.heading, crime.personGround, a);
      if (a.kind === 'thief' && a.state === 'approach') a.state = 'leave';
      if (a.kind === 'gang' && crime.state === 'play' && dist < 80) crime.gangAnger[a.gang] = Math.max(crime.gangAnger[a.gang], 60);
    } else {
      // (its pose the ragdoll's)
      crime.crowd.add(a.rig, dist);
      return;
    }
  }

  // run over by the player
  const size = crime.playerSize();
  if (crime.onStreet && crime.mode !== 'person' && size && crime.pspeed > 2.2) {
    const hit = boxHit(crime.px, crime.pz, crime.player.heading, size[0], size[1], a.x, a.z, 0.3);
    if (hit) {
      const dmg = crime.pspeed * (crime.mode === 'car' ? 7 : crime.mode === 'moto' ? 4 : 2.5);
      crime.audio?.crash?.({ a: crime.player, b: a, x: a.x, y: crime.groundAt(a.x, a.z) + 1, z: a.z, speed: crime.pspeed });
      a.hp -= dmg;
      crime.knockAgent(a, crime.pvx, crime.pvz, hit.nx, hit.nz, crime.mode === 'car', bleedOf(crime.pspeed));
      crime.fx.splatter(a.x, crime.groundAt(a.x, a.z) + 0.9, a.z, crime.pspeed, hit.nx, hit.nz);
      crime.controllers.bloodyCar?.(a.x, a.z, crime.pspeed);
      if (a.kind === 'cop') crime.report(a.hp <= 0 ? 'killCop' : 'hitCop', true);
      else crime.report('runOver');
      if (a.kind === 'gang') crime.angerGang(a.gang);
      if (a.hp <= 0) crime.kill(a);
      crime.crowd.add(a.rig, dist);
      return;
    }
  }

  let goalYaw: number; // (every kind's branch below sets it)
  let speed = 0;
  let aim = 0;
  a.stepT = Math.max(0, a.stepT - dt);
  a.cooldown -= dt;
  // a clear line of sight to the player, checked a few times a second
  a.losT -= dt;
  if (a.losT <= 0) {
    a.losT = 0.3 + Math.random() * 0.2;
    a.los = dist < 70 && crime.clearLine(a.x, a.z, crime.px, crime.pz);
  }
  const toPlayer = Math.atan2(dx, dz);
  const playing = crime.state === 'play';
  // the police and the cartel shoot it out wherever they meet
  const fights = a.kind === 'cop' || a.gang === NARCO;
  if (fights) {
    a.foeT -= dt;
    if (a.foe && (a.foe.fallen || !crime.agents.includes(a.foe))) a.foe = null;
    if (a.foeT <= 0) {
      a.foeT = 0.5 + Math.random() * 0.3;
      a.foe = crime.findFoe(a);
    }
  }
  const foeDist = a.foe ? Math.hypot(a.foe.x - a.x, a.foe.z - a.z) : Infinity;

  if (a.foe && (a.kind === 'cop' ? crime.wanted.stars === 0 || foeDist < dist : !crime.gangAnger[NARCO] || foeDist < dist)) {
    // fighting the other side: facing them, shooting
    goalYaw = Math.atan2(a.foe.x - a.x, a.foe.z - a.z);
    aim = 1;
    speed = foeDist > 30 ? RUN * 0.6 : 0;
    const gun = NPC_GUN[a.weapon ?? 'pistol'];
    if (a.stepT <= 0) crime.npcShoot(a, gun, a.kind === 'cop' ? SKILL.cop : SKILL.narco, foeDist, dt, a.foe);
    if (a.kind === 'cop' && a.state === 'leave') a.t = 0; // (still on the job)
  } else if (a.kind === 'cop') {
    const stars = crime.wanted.stars;
    const called = stars > 0 && (!a.army || POLICE.soldiers[stars] > 0); // (the army only from four stars)
    if (!playing || !called || a.state === 'leave') {
      a.state = playing && called ? 'chase' : 'leave';
      if (crime.state === 'busted') {
        goalYaw = toPlayer; // standing over the arrested player
      } else {
        goalYaw = Math.atan2(-dx, -dz);
        speed = WALK;
        if (dist > 70 || a.t > 60) {
          crime.removeAgent(a);
          return;
        }
      }
    } else if (!crime.seen) {
      // lost: to where the police last saw the player, and looking round there
      const hx = crime.lastSeen.x - a.x, hz = crime.lastSeen.z - a.z;
      const far = Math.hypot(hx, hz) > 4;
      goalYaw = far ? Math.atan2(hx, hz) : a.heading + dt * 1.2;
      speed = far ? RUN * 0.7 : 0;
      a.arrest = Math.max(0, a.arrest - dt);
    } else {
      const gun = POLICE.shoots[stars] || a.army ? NPC_GUN[a.weapon ?? 'pistol'] : null;
      goalYaw = toPlayer;
      if (gun && a.los && dist < gun.range && dist > 2.2) {
        aim = 1;
        speed = dist > 16 ? RUN * 0.55 : 0;
        if (a.stepT <= 0) crime.npcShoot(a, gun, a.army ? SKILL.army : SKILL.cop, dist, dt);
      } else {
        speed = dist > 1.2 ? RUN : 0;
      }
      // an arrest: close enough to grab a player on foot (or in a car that has stopped)
      const grab = crime.mode === 'person' ? dist < 1.5 && crime.pspeed < 3.5 : dist < 3.6 && crime.pspeed < 1.5 && crime.mode !== 'helicopter';
      a.arrest = grab ? a.arrest + dt : Math.max(0, a.arrest - dt);
      if (a.arrest > (crime.mode === 'person' ? 1.1 : 2.2)) {
        crime.toast(t('toast.busted'));
        crime.down('busted');
      }
    }
  } else if (a.kind === 'gang') {
    const g = GANGS[a.gang];
    const provoked = crime.gangAnger[a.gang] > 0;
    const near = dist < g.sight && crime.onStreet;
    const hostile = playing && (provoked || (g.hostile && near));
    const reach = g.narco ? 50 : 34;
    if (hostile && a.los && dist < reach) {
      goalYaw = toPlayer;
      aim = 1;
      speed = dist > reach * 0.65 ? RUN * 0.7 : 0;
      if (a.stepT <= 0) crime.npcShoot(a, NPC_GUN[a.weapon ?? 'pistol'], g.narco ? SKILL.narco : SKILL.gang, dist, dt);
      // opening fire on the player in their turf is taking them on
      if (g.narco && !provoked && a.cooldown > 0.5) crime.angerGang(NARCO);
    } else if (hostile && dist < 60) {
      goalYaw = toPlayer;
      speed = RUN * 0.8;
    } else {
      // hanging about their corner: facing their friends, now and then a few steps
      a.wanderT -= dt;
      const hx = a.homeX - a.x, hz = a.homeZ - a.z;
      if (Math.hypot(hx, hz) > 2.5) {
        goalYaw = Math.atan2(hx, hz);
        speed = WALK;
      } else {
        goalYaw = a.idleYaw;
        if (a.wanderT <= 0) {
          a.wanderT = rand(3, 8);
          a.idleYaw = Math.atan2(a.homeX - a.x + rand(-1, 1), a.homeZ - a.z + rand(-1, 1)) + rand(-0.6, 0.6);
        }
        if (dist < 12 && !hostile) goalYaw = toPlayer; // eyeing the player
      }
    }
  } else {
    // a thief
    if (a.state === 'approach' && (!playing || crime.mode !== 'person' || a.t > 30)) a.state = 'leave';
    if (a.state === 'approach') {
      goalYaw = toPlayer;
      speed = dist > 6 ? THIEF_RUN : 3.2;
      if (dist < 1.1 && playing) {
        const take = Math.min(crime.money, Math.round(20 + crime.money * 0.15));
        if (take > 0) {
          crime.money -= take;
          a.money = take;
          crime.toast(t('toast.thief', { take }));
        }
        a.state = 'flee';
        a.t = 0;
      }
    } else if (a.state === 'flee') {
      goalYaw = Math.atan2(-dx, -dz);
      speed = THIEF_RUN;
      if (dist > 140 || a.t > 45) {
        if (a.money) crime.toast(t('toast.thiefGone'));
        crime.removeAgent(a);
        return;
      }
    } else {
      goalYaw = Math.atan2(-dx, -dz);
      speed = WALK * 1.4;
      if (dist > 60 || a.t > 40) {
        crime.removeAgent(a);
        return;
      }
    }
  }

  if (a.stepT > 0) speed *= 0.3;
  crime.walkAgent(a, goalYaw, speed, dt);
  // keep clear of the player on foot
  if (crime.mode === 'person' && dist < 0.75 && dist > 0.01) {
    a.x -= (dx / dist) * (0.75 - dist);
    a.z -= (dz / dist) * (0.75 - dist);
  }
  const rig = a.rig;
  rig.aim += (aim - rig.aim) * Math.min(1, dt * 8);
  rig.aimYaw = a.heading;
  rig.aimBoth = a.weapon === 'smg' || a.weapon === 'rifle';
  const draw = dist < 140;
  rig.update(dt, a.x, a.z, a.heading, crime.personGround, a, 0, draw);
  if (!draw) return;
  crime.crowd.add(rig, dist);
  const guns = a.weapon && (crime.npcGuns[a.weapon] ?? crime.npcGuns.pistol);
  if (guns && rig.aim > 0.05 && guns.count < MAX_AGENTS) {
    dummy.position.copy(rig.handPosition);
    dummy.rotation.set((1 - rig.aim) * 1.25, rig.aimYaw, 0, 'YXZ');
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    guns.mesh.setMatrixAt(guns.count++, dummy.matrix);
  }
}

// Turns a towards `goalYaw` and walks it `speed` m/s, around walls and vehicles (the first clear heading either side)
export function walkAgent(crime: CrimeSystem, a: Agent, goalYaw: number, speed: number, dt: number): void {
  // a vehicle standing in its way: it makes for the nearer end and goes round it
  const traffic = crime.traffic;
  if (speed > 0 && traffic.vehicleBoxAt) {
    const sn = Math.sin(goalYaw), cs = Math.cos(goalYaw);
    // (looked for a step and two steps ahead, so it doesn't cut across a corner either)
    const box = traffic.vehicleBoxAt(a.x + sn * 0.3, a.z + cs * 0.3, BODY_R) ?? traffic.vehicleBoxAt(a.x + sn * 0.7, a.z + cs * 0.7, BODY_R);
    if (box && !traffic.vehicleAt?.(a.x, a.z, BODY_R)) {
      goalYaw = roundBox(a.x, a.z, a.x + Math.sin(goalYaw) * 20, a.z + Math.cos(goalYaw) * 20, box, BODY_R + 0.4);
    }
  }
  a.heading += clamp(wrapAngle(goalYaw - a.heading), -7 * dt, 7 * dt);
  a.speed = speed;
  if (speed <= 0) return;
  const step = speed * dt;
  // (standing in a car already, one that drove up onto it: it walks on out rather than freeze)
  const inCar = crime.traffic.vehicleAt?.(a.x, a.z, BODY_R) ?? false;
  for (const veer of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
    const h = a.heading + veer;
    const sn = Math.sin(h), cs = Math.cos(h);
    const nx = a.x + sn * step;
    const nz = a.z + cs * step;
    // a wall ahead, at the middle of the body or either shoulder, so it can't cut a building's corner
    const ax = nx + sn * 0.4, az = nz + cs * 0.4;
    if (crime.solidAt(ax, az) || crime.solidAt(ax + cs * BODY_R, az - sn * BODY_R) || crime.solidAt(ax - cs * BODY_R, az + sn * BODY_R)) continue;
    if (!inCar && crime.traffic.vehicleAt?.(nx + sn * 0.25, nz + cs * 0.25, BODY_R)) continue;
    a.x = nx;
    a.z = nz;
    if (veer) a.heading += veer * Math.min(1, dt * 4);
    return;
  }
}

// The nearest of the other side (the police for the cartel, the cartel for the police) within FOE_RANGE in sight
export function findFoe(crime: CrimeSystem, a: Agent): Agent | null {
  let best: Agent | null = null;
  let bestD = FOE_RANGE;
  for (const o of crime.agents) {
    if (o.fallen || (a.kind === 'cop' ? o.gang !== NARCO : o.kind !== 'cop')) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < bestD && crime.clearLine(a.x, a.z, o.x, o.z)) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// Someone on foot firing at the player (or at `foe`, one of the other side): in bursts for an SMG or a rifle,
// hitting by distance, the target's speed and their skill
export function npcShoot(crime: CrimeSystem, a: Agent, gun: NpcGun, skill: number, dist: number, _dt: number, foe: Agent | null = null): void {
  if (a.cooldown > 0 || (crime.state !== 'play' && !foe)) return;
  if (gun.burst > 1) {
    a.burst = a.burst > 0 ? a.burst - 1 : gun.burst - 1;
    a.cooldown = a.burst > 0 ? 0.11 : 1 / gun.rate + rand(0.2, 0.9);
  } else {
    a.cooldown = 1 / gun.rate + rand(0, 0.6);
  }
  const yaw = a.heading;
  const hx = a.rig.handPosition.x + Math.sin(yaw) * 0.3;
  const hy = a.rig.handPosition.y + 0.05;
  const hz = a.rig.handPosition.z + Math.cos(yaw) * 0.3;
  crime.fx.muzzle(hx, hy, hz, yaw);
  crime.audio?.gunfire?.(a.weapon === 'rifle' ? 'smg' : a.weapon ?? 'pistol', hx, hy, hz);
  if (foe) {
    const fy = crime.groundAt(foe.x, foe.z) + 1.2;
    if (Math.random() < hitChance(dist, foe.speed, skill, gun.range)) {
      crime.fx.tracer(hx, hy, hz, foe.x, fy, foe.z);
      crime.fx.impact(foe.x, fy, foe.z, 'blood', Math.sin(yaw), Math.cos(yaw));
      crime.damageAgent(foe, gun.damage * FOE_DAMAGE, Math.sin(yaw), Math.cos(yaw), false);
    } else {
      crime.fx.tracer(hx, hy, hz, foe.x + rand(-2, 2) + Math.sin(yaw) * 5, fy + rand(-0.5, 0.5), foe.z + rand(-2, 2) + Math.cos(yaw) * 5);
    }
    crime.traffic.panic(a.x, a.z, 40);
    return;
  }
  const hits = Math.random() < hitChance(dist, crime.pspeed, skill, gun.range);
  const py = crime.player.position.y + (crime.mode === 'person' ? 1.2 : 0.9);
  if (hits) {
    crime.fx.tracer(hx, hy, hz, crime.px, py, crime.pz);
    crime.fx.impact(crime.px, py, crime.pz, crime.mode === 'person' ? 'blood' : 'metal', -Math.sin(yaw), -Math.cos(yaw));
    crime.hurt(gun.damage, a.x, a.z);
    // a round into the car low: one of its tyres now and then
    if (crime.mode === 'car' && Math.random() < TYRE_HIT) crime.controllers.popTyre?.(Math.floor(Math.random() * 4));
  } else {
    // a miss: past the player, into whatever is behind
    const miss = rand(0.8, 2.2) * (Math.random() < 0.5 ? -1 : 1);
    const ex = crime.px + Math.cos(yaw) * miss + Math.sin(yaw) * 6;
    const ez = crime.pz - Math.sin(yaw) * miss + Math.cos(yaw) * 6;
    crime.fx.tracer(hx, hy, hz, ex, py + rand(-0.6, 0.6), ez);
  }
  crime.traffic.panic(a.x, a.z, 30);
}
