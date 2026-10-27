// js/sim/weapons.ts
// The player's arsenal (fists, pistol, SMG, bazooka), and the ballistics the police and the gangs share:
// fire rates, lock-on auto-aim, hit-scan rays against round bodies and boxes, blast fall-off, how often a shooter
// hits. No three.js, so node --test imports it directly (tests/weapons.test.mjs).

// rate: shots per second. damage: hit points off a 100-point body. range & blast: metres. rocket: m/s.
// spread: radians either side of the aim. start: rounds carried at the start, pickup: rounds a dropped gun gives.
import type { MessageKey } from '../i18n/i18n.ts';

type WeaponId = 'fists' | 'pistol' | 'smg' | 'rifle' | 'bazooka';
interface Weapon {
  id: WeaponId;
  label: MessageKey; // its name, in the player's language (i18n/)
  melee?: boolean;
  auto: boolean; // fires while the trigger is held
  rate: number; // shots/s
  damage: number; // hit points off a 100-point body
  range: number; // m
  spread: number; // rad either side of the aim
  rocket?: number; // m/s: fires a rocket, not a hit-scan round
  blast?: number; // m: the rocket's blast radius
  start: number; // rounds carried at the start (Infinity for fists)
  pickup: number; // rounds a dropped one gives
}
// Rounds left per weapon
type Ammo = Record<WeaponId, number>;
interface WeaponStats {
  damage: number;
  rate: number;
  range: number;
  accuracy: number;
}
// A box on the ground: centred at (x, z), its length (hl either side, m) along heading (rad, 0 faces +z), its width (hw)
// across it
interface GroundBox {
  x: number;
  z: number;
  heading: number;
  hw: number;
  hl: number;
}
// boxOverlap()'s push: unit normal from a towards b, and depth (m)
interface BoxPush {
  nx: number;
  nz: number;
  pen: number;
}
// roundBox()'s box: its length axis given by its sine and cosine
interface TurnedBox {
  x: number;
  z: number;
  sn: number;
  cs: number;
  hw: number;
  hl: number;
}

// (each its own type, so WEAPONS.bazooka.rocket is known to be there)
const WEAPONS = {
  fists: { id: 'fists', label: 'weapon.fists', melee: true, auto: false, rate: 2.6, damage: 20, range: 1.7, spread: 0, start: Infinity, pickup: 0 },
  pistol: { id: 'pistol', label: 'weapon.pistol', auto: false, rate: 4.5, damage: 34, range: 70, spread: 0.018, start: 68, pickup: 34 },
  smg: { id: 'smg', label: 'weapon.smg', auto: true, rate: 11, damage: 16, range: 55, spread: 0.05, start: 240, pickup: 90 },
  // (the cartel's: none to start with, taken off them)
  rifle: { id: 'rifle', label: 'weapon.rifle', auto: true, rate: 8, damage: 28, range: 85, spread: 0.028, start: 0, pickup: 60 },
  bazooka: { id: 'bazooka', label: 'weapon.bazooka', auto: false, rate: 0.9, damage: 220, range: 170, spread: 0.004, rocket: 48, blast: 8, start: 8, pickup: 4 }

} satisfies Readonly<Record<WeaponId, Weapon>>;
const WEAPON_ORDER: readonly WeaponId[] = ['fists', 'pistol', 'smg', 'rifle', 'bazooka'];
const CLICK_BUFFER = 0.15; // s: a pull of a semi-automatic trigger just before it is ready again still fires

const wrapAngle = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// A string names a weapon (saved games and tests hand them in as plain strings)
const isWeaponId = (id: string): id is WeaponId => Object.hasOwn(WEAPONS, id);

class Arsenal {
  ammo: Ammo;
  current: WeaponId;
  cooldown: number; // s until the weapon in hand can fire again
  held: boolean; // the trigger, last step
  queued: number;

  constructor(ammo: Partial<Ammo> | null = null) {
    // (every weapon gets its count in the loop just below)
    this.ammo = {} as Ammo;
    for (const id of WEAPON_ORDER) {
      const given = ammo?.[id];
      this.ammo[id] = given !== undefined && Number.isFinite(given) ? given : WEAPONS[id].start;
    }
    this.current = 'pistol';
    this.cooldown = 0;
    this.held = false;
    this.queued = 0; // time left on a buffered pull
  }

  get weapon(): Weapon {
    return WEAPONS[this.current];
  }

  has(id: string): boolean {
    return isWeaponId(id) && this.ammo[id] > 0;
  }

  select(id: string): boolean {
    if (!isWeaponId(id) || !this.has(id)) return false;
    if (id !== this.current) {
      this.current = id;
      this.cooldown = Math.max(this.cooldown, 0.25); // drawing it
      this.queued = 0;
    }
    return true;
  }

  // The next (dir 1) or previous (-1) weapon with rounds left; fists always have
  cycle(dir = 1): WeaponId {
    const n = WEAPON_ORDER.length;
    let i = WEAPON_ORDER.indexOf(this.current);
    for (let k = 0; k < n; k++) {
      i = (i + (dir < 0 ? n - 1 : 1)) % n;
      if (this.select(WEAPON_ORDER[i])) return WEAPON_ORDER[i];
    }
    return this.current;
  }

  add(id: string, rounds: number): void {
    if (!isWeaponId(id) || !(rounds > 0)) return;
    this.ammo[id] += rounds;
  }

  // Shots fired this step (0 or 1) with the trigger `held`: automatic weapons fire while it is held, the others once
  // per pull. Out of rounds, it falls back to the next weapon that has some.
  trigger(held: boolean, dt: number): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const w = this.weapon;
    if (held && !this.held) this.queued = CLICK_BUFFER;
    else this.queued = Math.max(0, this.queued - dt);
    this.held = held;
    const wants = w.auto ? held : this.queued > 0;
    if (!wants || this.cooldown > 0) return 0;
    if (!(this.ammo[w.id] > 0)) {
      this.cycle(1);
      return 0;
    }
    this.queued = 0;
    this.cooldown = 1 / w.rate;
    if (this.ammo[w.id] !== Infinity) this.ammo[w.id]--;
    if (this.ammo[w.id] <= 0) this.ammo[w.id] = 0;
    return 1;
  }
}

/**
 * Lock-on: of `candidates` (objects with x, z), the one the shooter at (ox, oz) facing `heading` (0 faces +z) would
 * aim at within `range` metres and `cone` radians either side: the one nearest the line of fire, nearer ones first.
 * `accept(c)` (optional) filters them. Returns the candidate or null.
 */
function pickTarget<T extends { x: number; z: number }>(ox: number, oz: number, heading: number, candidates: Iterable<T | null | undefined>,
  range: number, cone: number, accept: ((c: T) => boolean) | null = null): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (!c || (accept && !accept(c))) continue;
    const dx = c.x - ox;
    const dz = c.z - oz;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 0.2) continue;
    const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - heading));
    if (off > cone) continue;
    const score = off / cone + (d / range) * 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Distance along the ray (ox, oz) + t·(dx, dz) (unit direction) to the circle of radius r at (cx, cz), or -1
function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const fx = cx - ox;
  const fz = cz - oz;
  const along = fx * dx + fz * dz;
  const across2 = fx * fx + fz * fz - along * along;
  if (across2 > r * r) return -1;
  const half = Math.sqrt(r * r - across2);
  const t = along - half;
  if (t >= 0) return t;
  return along + half >= 0 ? 0 : -1; // starting inside it
}

// Distance along the ray to a box centred at (cx, cz), turned `yaw` (its length along (sin yaw, cos yaw)), of half
// width hw and half length hl, or -1 (slab test in the box's frame)
function rayBox(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, yaw: number, hw: number, hl: number): number {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rx = ox - cx;
  const rz = oz - cz;
  // local axes: along (s, c), across (c, -s)
  const pa = rx * s + rz * c;
  const pc = rx * c - rz * s;
  const da = dx * s + dz * c;
  const dc = dx * c - dz * s;
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, d, h] of [[pa, da, hl], [pc, dc, hw]]) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p) > h) return -1;
      continue;
    }
    let a = (-h - p) / d;
    let b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

// Overlap of two boxes on the ground (x, z, heading, hw, hl): the push that moves b out of a, as a unit normal (nx, nz)
// from a towards b and a depth, or null (separating axis test)
function boxOverlap(a: GroundBox, b: GroundBox): BoxPush | null {
  const axes = [
    [Math.sin(a.heading), Math.cos(a.heading)], [Math.cos(a.heading), -Math.sin(a.heading)],
    [Math.sin(b.heading), Math.cos(b.heading)], [Math.cos(b.heading), -Math.sin(b.heading)]
  ];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  for (const [ax, az] of axes) {
    const ra = Math.abs(ax * Math.sin(a.heading) + az * Math.cos(a.heading)) * a.hl
      + Math.abs(ax * Math.cos(a.heading) - az * Math.sin(a.heading)) * a.hw;
    const rb = Math.abs(ax * Math.sin(b.heading) + az * Math.cos(b.heading)) * b.hl
      + Math.abs(ax * Math.cos(b.heading) - az * Math.sin(b.heading)) * b.hw;
    const d = dx * ax + dz * az;
    const pen = ra + rb - Math.abs(d);
    if (pen <= 0) return null;
    if (pen < best) {
      best = pen;
      nx = d >= 0 ? ax : -ax;
      nz = d >= 0 ? az : -az;
    }
  }
  return { nx, nz, pen: best };
}

/**
 * The way round a vehicle standing in a walker's way: the heading from (x, z) to just past the nearer end of the box's
 * face it stands by, `margin` m out from it, the end that makes the shorter way on to the goal (gx, gz). Past that end
 * the next face takes over, so a walker kept on it goes round the box to the goal. The box is { x, z, sn, cs, hw, hl }:
 * centred at (x, z), its length (hl either side) along (sn, cs), its width (hw) along (cs, -sn).
 */
function roundBox(x: number, z: number, gx: number, gz: number, b: TurnedBox, margin: number): number {
  const local = (px: number, pz: number): [number, number] => [(px - b.x) * b.sn + (pz - b.z) * b.cs, (px - b.x) * b.cs - (pz - b.z) * b.sn];
  const [u, v] = local(x, z);
  const [gu, gv] = local(gx, gz);
  const A = b.hl + margin, B = b.hw + margin;
  const PAST = 0.6; // m beyond the corner, so that it is round it
  let c1: [number, number], c2: [number, number];
  if (Math.abs(u) / A > Math.abs(v) / B) {
    const eu = Math.sign(u) * A; // by an end: round either side
    c1 = [eu, B + PAST];
    c2 = [eu, -B - PAST];
  } else {
    const ev = Math.sign(v || 1) * B; // along a side: round either end
    c1 = [A + PAST, ev];
    c2 = [-A - PAST, ev];
  }
  const cost = (c: [number, number]) => Math.hypot(c[0] - u, c[1] - v) + Math.hypot(gu - c[0], gv - c[1]);
  const [cu, cv] = cost(c1) <= cost(c2) ? c1 : c2;
  return Math.atan2(b.x + cu * b.sn + cv * b.cs - x, b.z + cu * b.cs - cv * b.sn - z);
}

// The wheel's bars for a weapon (ui/weapon-wheel.ts), each 0..1 against the strongest in the arsenal: damage per hit (a
// rocket's whole blast), fire rate, range, and accuracy (the spread either side of the aim; a fist always lands)
function weaponStats(id: string): WeaponStats | null {
  if (!isWeaponId(id)) return null;
  const w = WEAPONS[id];
  return {
    damage: clamp01(w.damage / 220),
    rate: clamp01(w.rate / 11),
    range: clamp01(Math.sqrt(w.range / 170)),
    accuracy: clamp01(1 - w.spread / 0.06)
  };
}

// Share of a blast's force felt at distance d from its centre (1 at the centre, 0 at the edge of its radius)
function blastFalloff(d: number, radius: number): number {
  const k = clamp01(1 - d / radius);
  return k * Math.sqrt(k);
}

// How likely an aimed shot from `distance` metres hits a target moving at `speed` m/s, for a shooter of `skill` (0..1)
// with a weapon reaching `range` metres: certain up close, half as likely at half range, a fast car is hard to hit
function hitChance(distance: number, speed: number, skill: number, range: number): number {
  return clamp01(skill * (1 - (distance / range) ** 2) / (1 + Math.max(0, speed) * 0.07));
}

export type { WeaponId, Weapon, Ammo, WeaponStats, GroundBox, BoxPush, TurnedBox };
export { WEAPONS, WEAPON_ORDER, isWeaponId, Arsenal, weaponStats, pickTarget, rayCircle, rayBox, boxOverlap, roundBox, blastFalloff, hitChance, wrapAngle };
