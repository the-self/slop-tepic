// js/sim/crime/player.ts
// The player in the street's crime (sim/crime.ts): its input (fire: X, the left button (aim.ts): on foot, or taking
// aim with the right one from a vehicle; touch & gamepad through controllers.keys.fire; weapons 1-4, R to cycle, Tab
// for the wheel: ui/weapon-wheel.ts), firing, aiming and punching, getting hurt, and being WASTED or BUSTED.
import * as THREE from 'three/webgpu';
import type { Point3 } from '../ragdolls.ts';
import type { Weapon, WeaponId } from '../weapons.ts';
import type { Ped } from '../traffic.ts';
import { throwVelocity } from '../ragdolls.ts';
import { WEAPONS, Arsenal, pickTarget, wrapAngle } from '../weapons.ts';
import { isTypingInField } from '../../world/city-config.ts';
import { keyBindings } from '../../input/keybindings.ts';
import type { DownKind, Agent, LockTarget } from './types.ts';
import { PARKED_Y, DRAW_TIME, RESPAWN_TIME, clamp } from './constants.ts';
import { isResponder } from './cruisers.ts';
import type { CrimeSystem } from '../crime.ts';
import { t } from '../../i18n/i18n.ts';

const _qHand = new THREE.Quaternion();
const _qDown = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
// Aimed along the crosshair, an automatic weapon's spread is this much of its own (a single shot has none)
const AIMED_SPREAD = 0.6;

export function bindInput(crime: CrimeSystem, canvas: HTMLElement | null): void {
  // (without the aim, aim.ts, the right button fires from a vehicle)
  if (canvas && !crime.aim) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) crime.mouseFire = true;
    });
  }
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) crime.mouseFire = false;
  });
  window.addEventListener('blur', () => { crime.mouseFire = false; });
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const keys: Partial<Record<string, WeaponId>> = { Digit1: 'fists', Digit2: 'pistol', Digit3: 'smg', Digit4: 'bazooka' };
    let pick = keys[e.code];
    // 3 switches between the SMG and the rifle (once one has been taken off the cartel)
    if (pick === 'smg' && crime.arsenal.has('rifle') && (crime.arsenal.current === 'smg' || !crime.arsenal.has('smg'))) pick = 'rifle';
    if (pick) crime.selectWeapon(pick);
    else if (keyBindings.is('nextWeapon', e.code)) crime.cycleWeapon(e.shiftKey ? -1 : 1);
  });
}

export function updatePlayer(crime: CrimeSystem, dt: number, _elapsed: number): void {
  const c = crime.controllers;
  const p = c.entities.person;
  // aiming (aim.ts), on foot or from a vehicle: the shots go where the crosshair is, and the right button aims rather
  // than fires; the left button fires (aim.ts: aiming, or from the hip on foot with the pointer locked)
  const aimCtl = crime.aim;
  const free = freeAim(crime);
  const mouse = aimCtl ? aimCtl.fire : crime.mouseFire;
  const held = Boolean(c.keys.fire) || mouse;
  const w = crime.arsenal.weapon;
  // a change of weapon (the keys, the wheel, the mouse wheel, or out of rounds): the last one put away, this one
  // brought up, with the rack of its slide
  if (w.id !== crime.drawn) {
    crime.drawn = w.id;
    crime.drawT = DRAW_TIME;
    if (!w.melee) {
      const hand = p.rig.handPosition;
      crime.audio?.gunfire?.('draw', crime.mode === 'person' ? hand.x : crime.px, crime.mode === 'person' ? hand.y : crime.player.position.y + 1, crime.mode === 'person' ? hand.z : crime.pz);
    }
  }
  crime.drawT = Math.max(0, crime.drawT - dt);
  // what this weapon can do from here: no guns from the helicopter, no fists or bazooka from a car or a bicycle
  const usable = !crime.fireBlocked && (crime.mode === 'person' || (crime.mode !== 'helicopter' && !w.melee && !w.rocket));
  const shots = crime.arsenal.trigger(held && usable && crime.onStreet, dt);
  if (held && usable) crime.aimHold = w.melee ? 0.2 : 0.7;
  else crime.aimHold = Math.max(0, crime.aimHold - dt);

  if (free && aimCtl) {
    crime.lockTarget = null;
    // (taking aim from a vehicle with the fists or the bazooka in hand: the pistol, if it has rounds)
    if (crime.mode !== 'person' && (w.melee || w.rocket) && crime.arsenal.has('pistol')) crime.arsenal.select('pistol');
    const hit = crime.aimAlong(crime.camera, w);
    aimCtl.onTarget = !w.melee && (hit.kind === 'agent' || hit.kind === 'ped' || hit.kind === 'cruiser' || hit.kind === 'vehicle' || hit.kind === 'heli' || hit.kind === 'remote');
  } else if (crime.aim) {
    crime.aim.onTarget = false;
  }

  // lock-on while the trigger is held
  if (free) {
    // (none: the player aims itself)
  } else if (held && usable && !w.melee) {
    const range = w.range * (crime.mode === 'person' ? 1 : 0.7);
    crime.lockTarget = crime.findTarget(crime.px, crime.pz, crime.player.heading, range, crime.mode === 'person' ? 0.6 : 0.3);
  } else if (!held) {
    crime.lockTarget = null;
  }
  // on foot the player turns to face what it aims at
  if (crime.mode === 'person' && crime.lockTarget && held) {
    const want = Math.atan2(crime.lockTarget.x - crime.px, crime.lockTarget.z - crime.pz);
    p.heading += clamp(wrapAngle(want - p.heading), -8 * dt, 8 * dt);
  }
  if (shots) crime.playerFire(w);

  // the arms: raised while aiming, a jab for a punch
  const rig = p.rig;
  crime.punchT = Math.max(0, crime.punchT - dt);
  let aimWant = crime.mode === 'person' ? (w.melee ? (crime.punchT > 0 ? 1 : 0) : crime.aimHold > 0 || free ? 1 : 0) : 0;
  if (crime.drawT > DRAW_TIME * 0.45) aimWant = 0; // (the arms come down for the change, then up with the new one)
  rig.aim += (aimWant - rig.aim) * Math.min(1, dt * (aimWant ? 14 : 6));
  rig.aimYaw = crime.lockTarget && crime.mode === 'person' ? Math.atan2(crime.lockTarget.x - crime.px, crime.lockTarget.z - crime.pz) : p.heading;
  rig.aimBoth = w.id === 'smg' || w.id === 'rifle' || w.id === 'bazooka';
  crime.placePlayerGun(w);
}

// The gun in the player's hand (when on foot): along the arm, pointing down when it isn't aiming
export function placePlayerGun(crime: CrimeSystem, w: Weapon): void {
  const p = crime.controllers.entities.person;
  for (const [id, g] of Object.entries(crime.playerGuns)) {
    const show = crime.mode === 'person' && id === w.id && crime.state === 'play';
    if (!show) {
      g.position.y = PARKED_Y;
      continue;
    }
    // (a gun just drawn comes up from lower down, its muzzle to the ground)
    const k = (crime.drawT / DRAW_TIME) ** 2;
    g.position.copy(p.rig.handPosition);
    g.position.y -= k * 0.12;
    g.rotation.set((1 - p.rig.aim) * 1.25 + k * 1.1, p.rig.aimYaw, 0, 'YXZ');
    // (held in the hand as the player's body swings it, actors/person-body.ts; level along the aim once raised)
    const turn = p.rig.handTurn;
    if (turn) g.quaternion.slerp(_qHand.copy(turn).multiply(_qDown.setFromAxisAngle(_xAxis, 1.25 + k * 1.1)), 1 - p.rig.aim);
  }
}

// The best target to lock on to ahead: the police, gangs and thieves first, then patrol cars, then passers-by
export function findTarget(crime: CrimeSystem, x: number, z: number, heading: number, range: number, cone: number): LockTarget | null {
  const list = crime.candidates;
  list.length = 0;
  for (const a of crime.agents) if (!a.fallen) list.push(a);
  for (const r of crime.remotes) list.push(r);
  const person = pickTarget(x, z, heading, list, range, cone);
  if (person) return person;
  list.length = 0;
  for (const cr of crime.cruisers) if (cr.active && !cr.wreck) list.push(cr);
  if (crime.heli.active && crime.heli.state !== 'down') list.push(crime.heli);
  const car = pickTarget(x, z, heading, list, range, cone);
  if (car) return car;
  list.length = 0;
  for (const ped of crime.traffic.peds) {
    if (ped.placed && !ped.fallen && Math.abs(ped.x - x) < range && Math.abs(ped.z - z) < range) list.push(ped);
  }
  return pickTarget(x, z, heading, list, range, cone);
}

// Aiming freely (aim.ts): on foot, or from a car, a moto or a bicycle
function freeAim(crime: CrimeSystem): boolean {
  return crime.aim != null && crime.aim.active && crime.mode !== 'helicopter';
}

// Where the player's shots leave from: the hand on foot, the driver's window in a vehicle (the other one, across the
// car, aiming out of that side), a rider's hand on the side it aims
export function muzzle(crime: CrimeSystem, out: Point3): Point3 {
  const pe = crime.player;
  if (crime.mode === 'person') {
    const h = crime.controllers.entities.person.rig;
    out.x = h.handPosition.x + Math.sin(h.aimYaw) * 0.3;
    out.y = h.handPosition.y + 0.05;
    out.z = h.handPosition.z + Math.cos(h.aimYaw) * 0.3;
  } else {
    const car = crime.mode === 'car';
    const ahead = car ? 0.4 : 0.3;
    // (its left is (cos h, -sin h): the driver's side)
    const lx = Math.cos(pe.heading), lz = -Math.sin(pe.heading);
    const a = crime.aimPoint;
    const side = freeAim(crime) && (a.x - pe.position.x) * lx + (a.z - pe.position.z) * lz < 0 ? -1 : 1;
    const across = (car ? (pe.halfW || 0.86) + 0.1 : 0.45) * side;
    out.x = pe.position.x + Math.sin(pe.heading) * ahead + lx * across;
    out.y = pe.position.y + (car ? 1.15 : 1.35);
    out.z = pe.position.z + Math.cos(pe.heading) * ahead + lz * across;
  }
  return out;
}

export function playerFire(crime: CrimeSystem, w: Weapon): void {
  const pe = crime.player;
  if (w.melee) {
    crime.punch();
    return;
  }
  const m = crime.muzzle(crime._muzzle ??= { x: 0, y: 0, z: 0 });
  const t = crime.lockTarget;
  const aimCtl = crime.aim;
  const free = aimCtl != null && freeAim(crime);
  let yaw = t ? Math.atan2(t.x - m.x, t.z - m.z) : pe.heading;
  let slope: number | null = null; // (free aim: m up per m along, from the gun to the crosshair's point)
  let spread = w.spread; // rad either side of the aim
  if (free) {
    const a = crime.aimPoint;
    const d = Math.hypot(a.x - m.x, a.z - m.z);
    if (d > 0.6) {
      yaw = Math.atan2(a.x - m.x, a.z - m.z);
      slope = (a.y - m.y) / d;
    } else {
      slope = Math.tan(aimCtl.pitch); // (right up against it: along the camera)
    }
    // aimed, a single shot goes where the crosshair is; a burst still climbs and strays a little
    spread = w.auto ? w.spread * AIMED_SPREAD : 0;
    slope += (Math.random() - 0.5) * 2 * spread;
  } else if (t && t === crime.heli) {
    // locked on to the helicopter: up at its cabin
    slope = (crime.heli.y + 1.3 - m.y) / Math.max(1, Math.hypot(t.x - m.x, t.z - m.z)) + (Math.random() - 0.5) * 2 * w.spread;
  }
  yaw += (Math.random() - 0.5) * 2 * spread;
  crime.fx.muzzle(m.x, m.y, m.z, yaw, Boolean(w.rocket));
  crime.audio?.gunfire?.(w.id, m.x, m.y, m.z);
  crime.traffic.panic(m.x, m.z, w.rocket ? 45 : 35);
  crime.report('gunfire', crime.witnessed(m.x, m.z));
  if (w.rocket) {
    const pitch = Math.atan(slope ?? 0);
    const reach = w.range * Math.cos(pitch);
    crime.onPlayerShot?.({ ox: m.x, oy: m.y, oz: m.z, ex: m.x + Math.sin(yaw) * reach, ey: m.y + Math.sin(pitch) * w.range, ez: m.z + Math.cos(yaw) * reach, weapon: w.id, rocket: true });
    const r = crime.fx.launchRocket(m.x, m.y, m.z, yaw, -pitch);
    if (r) crime.rockets.push({ r, x: m.x, y: m.y, z: m.z, dx: Math.sin(yaw), dz: Math.cos(yaw), dh: Math.cos(pitch), dy: Math.sin(pitch), t: 0 });
    return;
  }
  // aimed at a target's chest (a person's hit is at 1.2 m over its feet), else level
  let ty = m.y;
  if (t) ty = (t.y ?? crime.groundAt(t.x, t.z)) + (t.mesh ? 0.9 : 1.2);
  crime.hitScan(m.x, m.y, m.z, yaw, ty, w, true, slope);
}

// A punch at whoever stands within reach in front
export function punch(crime: CrimeSystem): void {
  const p = crime.controllers.entities.person;
  crime.punchT = 0.18;
  const reach = WEAPONS.fists.range;
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  // (widened: TS can't see `consider` set it)
  let best = null as Agent | Ped | null;
  let bestD = reach;
  const consider = (o: Agent | Ped) => {
    const dx = o.x - crime.px, dz = o.z - crime.pz;
    const d = Math.hypot(dx, dz);
    if (d > bestD || (dx * fx + dz * fz) < d * 0.45) return;
    best = o;
    bestD = d;
  };
  for (const a of crime.agents) if (!a.fallen) consider(a);
  for (const ped of crime.traffic.peds) {
    if (ped.placed && !ped.fallen && Math.abs(ped.x - crime.px) < 3 && Math.abs(ped.z - crime.pz) < 3) consider(ped);
  }
  // another player on foot within reach, and nearer than anyone else in front: the punch is theirs
  for (const r of crime.remotes) {
    if (!r.person) continue;
    const dx = r.x - crime.px, dz = r.z - crime.pz;
    const d = Math.hypot(dx, dz);
    if (d > bestD || (dx * fx + dz * fz) < d * 0.45) continue;
    crime.audio?.gunfire?.('punch', r.x, r.y + 1.2, r.z);
    crime.onRemoteHit?.(r.id, WEAPONS.fists.damage);
    crime.report('punch');
    return;
  }
  if (!best) return;
  const d = Math.max(0.01, bestD);
  const nx = (best.x - crime.px) / d, nz = (best.z - crime.pz) / d;
  crime.audio?.gunfire?.('punch', best.x, crime.groundAt(best.x, best.z) + 1.2, best.z);
  if (crime.isAgent(best)) {
    crime.damageAgent(best, WEAPONS.fists.damage, nx, nz, true, 2.5);
  } else {
    crime.traffic.shootPed(best, nx, nz, 2.2);
    crime.report('punch');
  }
}

// The player hurt by `amount` (from the direction of (fromX, fromZ)): armour first, a vehicle takes some of it
export function hurt(crime: CrimeSystem, amount: number, fromX = crime.px, fromZ = crime.pz): void {
  if (crime.state !== 'play' || amount <= 0) return;
  if (crime.mode !== 'person') amount *= 0.55;
  const absorbed = Math.min(crime.armor, amount * 0.75);
  crime.armor -= absorbed;
  crime.health -= amount - absorbed;
  crime.hurtFlash = Math.min(1, crime.hurtFlash + 0.25 + amount * 0.03);
  crime.lastHit.x = fromX;
  crime.lastHit.z = fromZ;
  if (crime.health <= 0) crime.down('wasted');
}

export function down(crime: CrimeSystem, kind: DownKind): void {
  if (crime.state !== 'play') return;
  crime.state = kind;
  crime.stateTime = 0;
  crime.lockTarget = null;
  crime.controllers.resetInput();
  crime.health = Math.max(0, crime.health);
  // killed on foot: the player's body falls like anyone's
  const p = crime.controllers.entities.person;
  if (kind === 'wasted' && crime.controllers.activeMode === 'person' && crime.ragdolls) { // (crime.mode lags: thrown out of a car this frame)
    const d = Math.hypot(crime.px - crime.lastHit.x, crime.pz - crime.lastHit.z) || 1;
    const nx = (crime.px - crime.lastHit.x) / d, nz = (crime.pz - crime.lastHit.z) / d;
    // (already thrown, out of a car: that body it is)
    crime.playerFall = p.ragdoll ?? crime.ragdolls.spawn(p.rig, { ...throwVelocity(nx * 2, nz * 2, nx, nz), bleed: 1 });
    crime.playerFall.bleed = 1;
    p.ragdoll = crime.playerFall;
    p.ragdollOwner = 'crime'; // (it gets up at the hospital, not where it lies)
  } else {
    crime.playerFall = null;
  }
}

export function updateDown(crime: CrimeSystem, dt: number): void {
  crime.stateTime += dt;
  crime.controllers.resetInput();
  const p = crime.controllers.entities.person;
  p.rig.aim = 0;
  crime.placePlayerGun(crime.arsenal.weapon);
  if (crime.playerFall && crime.mode === 'person') {
    // (its pose the ragdoll's; the player's body, once loaded, follows it instead: controllers/frame.ts)
    p.crowd.begin();
    if (p.body) p.body.follow(p.rig);
    else p.crowd.add(p.rig, 0);
    p.crowd.end();
  }
  if (crime.stateTime < RESPAWN_TIME) return;
  const kind = crime.state;
  if (kind === 'play') return; // (never: only while down)
  crime.state = 'play';
  crime.ragdolls?.release(crime.playerFall);
  if (p.ragdoll === crime.playerFall) p.ragdoll = null;
  crime.playerFall = null;
  p.rig.placed = false; // stands up afresh where it is put
  crime.health = 100;
  crime.armor = kind === 'busted' ? 0 : crime.armor;
  if (kind === 'wasted') {
    const fee = Math.min(crime.money, 100);
    crime.money -= fee;
    crime.toast(fee ? t('toast.hospital', { fee }) : t('toast.backUp'));
  } else {
    // arrested: the guns are taken, and a bribe
    const fee = Math.min(crime.money, 150);
    crime.money -= fee;
    crime.arsenal = new Arsenal({ pistol: 17, smg: 0, bazooka: 0 });
    crime.toast(fee ? t('toast.gunsTakenFee', { fee }) : t('toast.gunsTaken'));
  }
  crime.wanted.clear();
  // a fresh start: the police and the gangs forget the player (no cartel trucks after it from the hospital)
  crime.gangAnger.fill(0);
  crime.timers.trucks = 0;
  for (let i = crime.agents.length - 1; i >= 0; i--) {
    const a = crime.agents[i];
    if (a.kind === 'cop') a.state = 'leave';
    else if (a.kind === 'gang' && !a.fallen) crime.removeAgent(a);
  }
  for (const cr of crime.cruisers) if (cr.active && !isResponder(cr)) crime.removeCruiser(cr); // (the bomberos & ambulances go on)
  crime.removeHeli();
  crime.onRespawn?.(kind);
}

// The player's half width & half length on the ground (its car's own, a motorcycle's, a bicycle's, on foot), or null
export function playerSize(crime: CrimeSystem): [number, number] | null {
  const pe = crime.player;
  const s = (crime._size ??= [0, 0]);
  if (crime.mode === 'car') {
    s[0] = pe.halfW || 0.86;
    s[1] = pe.halfL || 2.18;
  } else if (crime.mode === 'moto') {
    s[0] = 0.4;
    s[1] = 1.0;
  } else if (crime.mode === 'cyclist') {
    s[0] = 0.35;
    s[1] = 0.85;
  } else if (crime.mode === 'person') {
    s[0] = s[1] = 0.32;
  } else {
    return null;
  }
  return s;
}
