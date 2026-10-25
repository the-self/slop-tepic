// js/sim/crime/dispatch.ts
// Who turns up (sim/crime.ts): the police for the stars, gangs on their turf, the cartel's trucks, thieves, and
// health, armour and a bazooka lying about.
import { POLICE, GANGS, NARCO, gangTurf } from '../crime-rules.ts';
import { MAX_AGENTS, MAX_TRUCKS, HEALTH_PICKUP, ARMOR_PICKUP, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

export function dispatch(crime: CrimeSystem, dt: number): void {
  const t = crime.timers;
  const stars = crime.state === 'play' ? crime.wanted.stars : 0;
  t.dispatch -= dt;
  if (t.dispatch <= 0 && stars > 0) {
    t.dispatch = 1.2;
    let cops = 0;
    for (const a of crime.agents) if (a.kind === 'cop' && !a.fallen && a.state !== 'leave') cops++;
    let cars = 0;
    for (const cr of crime.cruisers) if (cr.active && !cr.wreck && cr.police && cr.state === 'chase') cars++;
    if (cops < POLICE.foot[stars] && crime.mode !== 'helicopter') {
      const s = crime.traffic.sidewalkSpot(crime.px, crime.pz, 35, 75);
      if (s) crime.spawnAgent('cop', s.x, s.z, { weapon: POLICE.weapon[stars] || 'pistol' });
    } else if (cars < POLICE.cruisers[stars]) {
      crime.spawnCruiser('police');
    }
  }

  // gangs: a group on the corner when the player is on their turf
  t.gangs -= dt;
  if (t.gangs <= 0) {
    t.gangs = 2.5;
    const turf = gangTurf(crime.px, crime.pz);
    let members = 0;
    for (const a of crime.agents) if (a.kind === 'gang' && !a.dead) members++;
    if (turf >= 0 && members < (turf === NARCO ? 10 : 8) && crime.agents.length < MAX_AGENTS - 6 && crime.mode !== 'helicopter') {
      const s = crime.traffic.sidewalkSpot(crime.px, crime.pz, 45, 95);
      if (s && gangTurf(s.x, s.z) === turf) {
        const n = 3 + Math.floor(Math.random() * 2);
        const cx = s.x, cz = s.z;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          let x = cx + Math.cos(ang) * 1.2, z = cz + Math.sin(ang) * 1.2;
          if (crime.solidAt(x, z)) {
            x = cx;
            z = cz;
          }
          const g = GANGS[turf];
          const a = crime.spawnAgent('gang', x, z, { gang: turf, weapon: g.narco || Math.random() < 0.5 ? g.weapon : 'pistol' });
          if (a) {
            a.homeX = cx;
            a.homeZ = cz;
            a.idleYaw = Math.atan2(cx - x, cz - z);
          }
        }
        if (crime.lastTurf !== turf) crime.toast(`${GANGS[turf].name} turf`);
        crime.lastTurf = turf;
      }
    } else if (turf < 0) {
      crime.lastTurf = -1;
    }
  }

  // the cartel, once provoked, sends its trucks after the player
  t.trucks -= dt;
  if (t.trucks <= 0 && crime.gangAnger[NARCO] > 0 && crime.state === 'play' && crime.mode !== 'helicopter') {
    t.trucks = 7;
    let trucks = 0;
    for (const cr of crime.cruisers) if (cr.active && !cr.wreck && !cr.police && cr.state === 'chase') trucks++;
    if (trucks < MAX_TRUCKS && crime.spawnCruiser('narco') && !trucks) crime.toast('The cartel is sending its people');
  }

  // a thief now and then, after a player on foot with money on it
  t.thief -= dt;
  if (t.thief <= 0) {
    t.thief = rand(50, 100);
    const busy = crime.agents.some((a) => a.kind === 'thief');
    if (!busy && crime.mode === 'person' && crime.money >= 30 && stars <= 1 && crime.state === 'play') {
      const s = crime.traffic.sidewalkSpot(crime.px, crime.pz, 22, 45);
      if (s) crime.spawnAgent('thief', s.x, s.z);
    }
  }

  // health & armour, and a bazooka when it has run dry, lying about on the sidewalks
  t.health -= dt;
  if (t.health <= 0) {
    t.health = 40;
    const kind = crime.health < 70 ? 'health' : crime.armor < 50 ? 'armor' : null;
    if (kind && crime.pickups.filter((p) => p.kind === kind).length < 2) {
      const s = crime.traffic.sidewalkSpot(crime.px, crime.pz, 25, 80);
      if (s) crime.drop(kind, s.x, s.z, kind === 'health' ? HEALTH_PICKUP : ARMOR_PICKUP, 240);
    }
  }
  t.bazooka -= dt;
  if (t.bazooka <= 0) {
    t.bazooka = 70;
    if (!crime.arsenal.has('bazooka') && !crime.pickups.some((p) => p.kind === 'bazooka')) {
      const s = crime.traffic.sidewalkSpot(crime.px, crime.pz, 30, 90);
      if (s) crime.drop('bazooka', s.x, s.z, 0, 300);
    }
  }
}
