// js/sim/crime/dispatch.ts
// Who turns up (sim/crime.ts): the police for the stars (and from four the army and the helicopter), the traffic's
// patrols that spot a wanted player (or a gang's armed men: they go for them), gangs on their turf, the cartel's trucks, thieves, and health, armour and a
// bazooka lying about.
import { POLICE, GANGS, NARCO, gangTurf } from '../crime-rules.ts';
import { MAX_AGENTS, MAX_TRUCKS, HEALTH_PICKUP, ARMOR_PICKUP, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';
import { t as tr } from '../../i18n/i18n.ts'; // (t is the dispatch's timers here)

const GANG_CALL_EVERY = 35; // s at least between two patrols going for a gang

export function dispatch(crime: CrimeSystem, dt: number): void {
  const t = crime.timers;
  const stars = crime.state === 'play' ? crime.wanted.stars : 0;
  t.dispatch -= dt;
  // (once the police have lost the player and it is well away from where they last saw it, they send nobody more: they
  // look for it there, round crime.huntX & huntZ)
  const lost = !crime.seen && Math.hypot(crime.px - crime.huntX, crime.pz - crime.huntZ) > 150;
  if (t.dispatch <= 0 && stars > 0 && !lost) {
    t.dispatch = 1.2;
    let cops = 0, soldiers = 0;
    for (const a of crime.agents) {
      if (a.kind !== 'cop' || a.fallen || a.state === 'leave') continue;
      if (a.army) soldiers++;
      else cops++;
    }
    let cars = 0, armyTrucks = 0;
    for (const cr of crime.cruisers) {
      if (!cr.active || cr.wreck || cr.state !== 'chase') continue;
      if (cr.faction === 'police') cars++;
      else if (cr.faction === 'army') armyTrucks++;
    }
    const onFoot = crime.mode !== 'helicopter';
    // an officer on foot first, else (or with no sidewalk about to send one to) a patrol car
    let sent = false;
    if (cops < POLICE.foot[stars] && onFoot) {
      const s = crime.traffic.sidewalkSpot(crime.huntX, crime.huntZ, 35, 75);
      if (s) sent = Boolean(crime.spawnAgent('cop', s.x, s.z, { weapon: POLICE.weapon[stars] || 'pistol' }));
    }
    if (!sent && cars < POLICE.cruisers[stars]) crime.spawnCruiser('police');
    // the army alongside the police, not after them: a couple of soldiers, then its trucks, then the rest
    const wantTruck = armyTrucks < POLICE.armyTrucks[stars];
    let marched = false;
    if (soldiers < POLICE.soldiers[stars] && onFoot && (soldiers < 2 || !wantTruck)) {
      const s = crime.traffic.sidewalkSpot(crime.huntX, crime.huntZ, 40, 85);
      if (s) marched = Boolean(crime.spawnAgent('cop', s.x, s.z, { weapon: 'rifle', army: true }));
    }
    if (!marched && wantTruck) crime.spawnCruiser('army');
  }

  // the traffic's own patrols: one that sees the wanted player takes up the chase
  t.patrols -= dt;
  if (t.patrols <= 0) {
    t.patrols = 0.5;
    const v = stars > 0 && crime.onStreet ? crime.trafficPatrolSees(crime.px, crime.pz, true) : null;
    if (v && crime.takeOverPatrol(v)) crime.toast(tr('toast.patrol'));
    else if (stars === 0 && t.gangCall <= 0) gangCall(crime);
  }
  t.gangCall -= dt;

  // the helicopter, from four stars (another a while after one is shot down)
  t.heli -= dt;
  if (POLICE.helicopter[stars] && !crime.heli.active && t.heli <= 0) crime.spawnHeli();

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
        if (crime.lastTurf !== turf) crime.toast(tr('toast.turf', { gang: GANGS[turf].name }));
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
    for (const cr of crime.cruisers) if (cr.active && !cr.wreck && cr.faction === 'narco' && cr.state === 'chase') trucks++;
    if (trucks < MAX_TRUCKS && crime.spawnCruiser('narco') && !trucks) crime.toast(tr('toast.cartel'));
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

// A patrol of the traffic that sees a gang's armed men on their corner goes for them (one at a time, now and then)
function gangCall(crime: CrimeSystem): void {
  if (crime.cruisers.some((cr) => cr.active && cr.state === 'respond')) return;
  for (const a of crime.agents) {
    if (a.kind !== 'gang' || a.fallen || a.dead || !a.weapon) continue;
    const v = crime.trafficPatrolSees(a.x, a.z, true);
    if (!v || !crime.respondToGang(v, a)) continue;
    crime.timers.gangCall = GANG_CALL_EVERY;
    if (Math.hypot(a.x - crime.px, a.z - crime.pz) < 120) crime.toast(tr('toast.copsGang'));
    return;
  }
}
