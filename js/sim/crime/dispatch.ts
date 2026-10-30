// js/sim/crime/dispatch.ts
// Who turns up (sim/crime.ts): the police for the stars (and from four the army and the helicopter), the traffic's
// patrols that spot a wanted player (or a gang's armed men: they go for them), gangs on the corners of their colonias, the cartel's trucks, thieves, and health, armour and a
// bazooka lying about.
import { POLICE, GANGS, NARCO } from '../crime-rules.ts';
import { townTurf } from '../gang-turf.ts';
import type { TurfCorner } from '../gang-turf.ts';
import { MAX_AGENTS, MAX_TRUCKS, HEALTH_PICKUP, ARMOR_PICKUP, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';
import { t as tr } from '../../i18n/i18n.ts'; // (t is the dispatch's timers here)

const GANG_CALL_EVERY = 35; // s at least between two patrols going for a gang
const CREW_REACH = 150; // m: a gang's corner has its crew out once the player comes this near (gone past DESPAWN, 200)
const CREW_NEAR = 40; // m: nearer than this the player would see a crew come out of thin air: none comes out
const CREW_SEEN = 110; // m: nearer than this, none comes out in the camera's view either
const MAX_GANG = 12; // gang members about at once, every corner's
const CLEAR_REACH = 6; // m from a corner its crew can stand, off a wall or a stall on it
const TURF_AWAY = 120; // s out of a gang's colonia before coming back into it is told again
const near: TurfCorner[] = [];

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

  // gangs: a word on coming into a colonia of theirs, and their crews out on its corners when the player comes by
  // (gang-turf.ts): on a corner or two of the colonia, not on whatever sidewalk the player walks. Not from the
  // helicopter: no crew is out for it, and over the town it would be told of every colonia it flies over.
  t.gangs -= dt;
  if (t.gangs <= 0 && crime.mode !== 'helicopter') {
    t.gangs = 1.5;
    const turf = townTurf();
    const c = turf.coloniaAt(crime.px, crime.pz);
    const gang = c >= 0 ? turf.colonias[c].gang : -1;
    if (gang >= 0) {
      // (once on coming in, not again each time the player steps along its edge with nobody's ground: only after a
      // while away)
      if (crime.lastTurf !== c || crime.clock - crime.lastTurfAt > TURF_AWAY) {
        crime.toast(tr('toast.turf', { gang: GANGS[gang].name, colonia: turf.colonias[c].name }));
      }
      crime.lastTurf = c;
      crime.lastTurfAt = crime.clock;
    }
    for (const k of turf.cornersNear(crime.px, crime.pz, CREW_REACH, near)) manCorner(crime, k, turf.colonias[k.colonia].gang);
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

// A corner of gang `gang`'s colonia gets its crew, unless it has one, or lost the last of it not long ago
// (CORNER_QUIET), or the player would see them come out of thin air: close by, or in view and not far off
function manCorner(crime: CrimeSystem, k: TurfCorner, gang: number): void {
  if (crime.agents.length >= MAX_AGENTS - 6 || crime.clock < (crime.cornerQuiet.get(k.id) ?? 0)) return;
  const d = Math.hypot(k.x - crime.px, k.z - crime.pz);
  if (d < CREW_NEAR || (d < CREW_SEEN && crime.traffic.inView(k.x, k.z, 3))) return;
  const g = GANGS[gang];
  const n = 3 + Math.floor(Math.random() * 2) + (g.narco ? 1 : 0);
  let members = 0;
  for (const a of crime.agents) {
    if (a.kind !== 'gang' || a.dead) continue;
    if (a.corner === k.id) return;
    members++;
  }
  if (members + n > MAX_GANG || !clearSpot(crime, k.x, k.z)) return;
  const cx = spot.x, cz = spot.z;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    let x = cx + Math.cos(ang) * 1.2, z = cz + Math.sin(ang) * 1.2;
    if (crime.solidAt(x, z)) {
      x = cx;
      z = cz;
    }
    const a = crime.spawnAgent('gang', x, z, { gang, weapon: g.narco || Math.random() < 0.5 ? g.weapon : 'pistol', corner: k.id });
    if (a) {
      a.homeX = cx;
      a.homeZ = cz;
      a.idleYaw = Math.atan2(cx - x, cz - z);
    }
  }
}

// The clear ground nearest (x, z) into `spot`, rings out to CLEAR_REACH m, false if none: a corner whose sidewalk a
// lot's wall or a stall stands on keeps its crew a step off it, the same step every time
const spot = { x: 0, z: 0 };
function clearSpot(crime: CrimeSystem, x: number, z: number): boolean {
  for (let r = 0; r <= CLEAR_REACH; r += 1.5) {
    const steps = r ? 8 : 1;
    for (let i = 0; i < steps; i++) {
      const sx = x + Math.cos((i / steps) * Math.PI * 2) * r, sz = z + Math.sin((i / steps) * Math.PI * 2) * r;
      if (crime.solidAt(sx, sz)) continue;
      spot.x = sx;
      spot.z = sz;
      return true;
    }
  }
  return false;
}
