// server/checks.ts
// What the server checks of a player it can't see play: its moves no faster than its mode goes (a teleport now and
// then, as the map's and a respawn are), and its hits only where its shots went (shared/combat.ts): a gun's hit on a
// round of that gun the server saw fired lately from where the shooter stood, passing the target (each round strikes
// once); a blast near a rocket's line or where a round ended; a punch within arm's reach. No more damage than the weapon
// does, no faster than it fires, and all its guns and fists together no more damage a second than the strongest of them
// alone. And whose hit struck a player last, so a kill is credited to the one who really landed it.
// No physics and no line of sight (the server has no city): a modified client can still aim perfectly, or shoot
// through a wall, but not hit someone it didn't shoot at, from across the city, for 100 with a pistol, or faster than
// its gun fires.
import {
  HIT_LIMITS, HAND_KINDS, HAND_DPS, RATE_SLACK, LAG_S, SHOT_FRESH_MS, ANY_SHOT_FRESH_MS, LINE_SLACK, ROCKET_REACH, SHOT_BLAST_REACH,
  ROCKET_FRESH_MS, ORIGIN_SLACK, BODY_UP, KILL_WINDOW_MS, MODE_SPEED, TELEPORT_EVERY_S
} from '../shared/combat.ts';
import { MODES } from '../shared/protocol.ts';
import type { HitKind, WirePose, WireShot } from '../shared/protocol.ts';

const MOVE_SLACK = 1.3; // a mode's top speed times this, for a slope, a ramp, a shove
const MOVE_SAVED_S = 2; // s of movement a player may save up (its poses come in bursts after a stall)
const MOVE_FREE_M = 10; // m it may always move at once (a wall pushing it, a car's crash)
const SHOTS_KEPT = 32; // a player's last shots kept to check its hits on (the SMG's 11 a second, three seconds' worth)
const SHOT_ROCKET = 1; // a shot's flags: a rocket (protocol.ts)

/** A shot the server saw: its two ends (cm), its weapon, whether a rocket, when (ms), and whether a hit took it */
interface SeenShot {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  weapon: string;
  rocket: boolean;
  at: number;
  used: boolean;
}

// The distance (cm) from (px, py, pz) to the segment of shot s
function toLine(s: SeenShot, px: number, py: number, pz: number): number {
  const dx = s.ex - s.ox, dy = s.ey - s.oy, dz = s.ez - s.oz;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.ox) * dx + (py - s.oy) * dy + (pz - s.oz) * dz) / len2)) : 0;
  return Math.hypot(s.ox + dx * t - px, s.oy + dy * t - py, s.oz + dz * t - pz);
}

// The lag's slack (cm) a pose's speed (dm/s) adds
const lag = (pose: WirePose) => (Math.abs(pose.s) / 10) * LAG_S * 100;

/** One player's checks: its last moves and shots, and who hurt it last */
class PlayerChecks {
  private moveBudget = MOVE_FREE_M * 100; // cm it may still move now
  private movedAt = 0; // ms (Date.now()) the budget was last topped up
  private teleports = 2; // teleports saved up
  private readonly shots: SeenShot[] = []; // its last SHOTS_KEPT shots, a ring
  private shotNext = 0;
  private readonly hitTokens = new Map<HitKind, number>(); // hits each kind may still land now (a token bucket each)
  private readonly hitAt = new Map<HitKind, number>(); // ms each bucket was last topped up
  private handDamage = HAND_DPS * RATE_SLACK; // hit points its guns & fists may still deal now (one bucket for all)
  private handAt = -Infinity; // ms that bucket was last topped up
  hurtBy = 0; // the player whose hit struck this one last, and when (ms)
  hurtAt = -Infinity;
  /** what it was refused lately, its moves and its hits, each count fading by half a minute (server/conduct.ts) */
  refusedMoves = 0;
  refusedHits = 0;
  private refusedAt = 0;

  /** Whether the player may move from `last` to `next` (wire units, cm) at `now` (ms): false, and its pose stays */
  move(last: WirePose | null, next: WirePose, now: number): boolean {
    const mode = MODES.at(next.m) ?? 'person';
    const top = Math.max(MODE_SPEED[mode], last ? MODE_SPEED[MODES.at(last.m) ?? 'person'] : 0) * MOVE_SLACK * 100; // cm/s
    const dt = this.movedAt ? Math.max(0, now - this.movedAt) / 1000 : MOVE_SAVED_S;
    this.movedAt = now;
    this.moveBudget = Math.min(top * MOVE_SAVED_S + MOVE_FREE_M * 100, this.moveBudget + top * dt);
    this.teleports = Math.min(2, this.teleports + dt / TELEPORT_EVERY_S);
    if (!last) return true;
    // (across the ground: a fall out of the helicopter goes down far faster than anyone walks)
    const d = Math.hypot(next.x - last.x, next.z - last.z);
    if (d <= this.moveBudget) {
      this.moveBudget -= d;
      return true;
    }
    // further than it could go: a teleport (the map's, a respawn, however near), if it has one saved up. Refused
    // otherwise, the next pose measured from the same place again: a jump turned down goes through as soon as a
    // teleport comes back, instead of leaving the player stuck there for the others
    if (this.teleports >= 1) {
      this.teleports -= 1;
      this.moveBudget = Math.min(this.moveBudget, MOVE_FREE_M * 100);
      return true;
    }
    this.refuse(now, 'move');
    return false;
  }

  /** The player fired shot `s` (wire units) standing at `from` (its last pose) at `now` (ms): false when it can't have
   *  (it starts too far from the player), and then it neither shows nor counts for a hit */
  shot(s: WireShot, from: WirePose | null, now: number): boolean {
    if (!from || Math.hypot(s.ox - from.x, s.oz - from.z) > ORIGIN_SLACK * 100 + lag(from) || Math.abs(s.oy - from.y) > (ORIGIN_SLACK + 4) * 100) {
      this.refuse(now, 'hit');
      return false;
    }
    let seen = this.shots.at(this.shotNext);
    if (!seen) {
      seen = { ox: 0, oy: 0, oz: 0, ex: 0, ey: 0, ez: 0, weapon: '', rocket: false, at: 0, used: false };
      this.shots.push(seen);
    }
    this.shotNext = (this.shotNext + 1) % SHOTS_KEPT;
    seen.ox = s.ox; seen.oy = s.oy; seen.oz = s.oz; seen.ex = s.ex; seen.ey = s.ey; seen.ez = s.ez;
    seen.weapon = s.weapon;
    seen.rocket = (s.flags & SHOT_ROCKET) !== 0;
    seen.at = now;
    seen.used = false;
    return true;
  }

  /**
   * Whether a hit of `kind` for `damage` from this player, standing at `from`, on a player at `to` (their speeds in
   * the poses, dm/s), is one its shots could have landed now (ms). A round that strikes is spent
   */
  hit(kind: HitKind, damage: number, from: WirePose, to: WirePose, now: number): boolean {
    const limit = HIT_LIMITS[kind];
    const reach = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / 100;
    const near = reach <= limit.reach + limit.slack + (lag(to) + lag(from)) / 100;
    const round = near && damage <= limit.damage ? this.roundFor(kind, to, now) : null;
    if (round === null || !this.take(kind, damage, now)) {
      this.refuse(now, 'hit');
      return false;
    }
    if (round !== true) round.used = true;
    return true;
  }

  /** Player `by` struck this one (its hit passed) at `now` (ms) */
  struck(by: number, now: number): void {
    this.hurtBy = by;
    this.hurtAt = now;
  }

  /** Who killed this player, now (ms): whoever's hit struck it last, lately (0: nobody) */
  killer(now: number): number {
    return now - this.hurtAt < KILL_WINDOW_MS ? this.hurtBy : 0;
  }

  // What a hit of `kind` on a player at `to` rests on: the round that struck it (a gun's), true (a punch; a blast near
  // a rocket's line or where a round ended), or null (none of its shots went there)
  private roundFor(kind: HitKind, to: WirePose, now: number): SeenShot | true | null {
    const shotKind = HIT_LIMITS[kind].shot;
    if (shotKind === 'none') return true;
    const ty = to.y + BODY_UP * 100;
    const slack = lag(to);
    for (const s of this.shots) {
      const age = now - s.at;
      if (shotKind === 'same') {
        if (s.used || s.rocket || s.weapon !== kind || age > SHOT_FRESH_MS) continue;
        if (toLine(s, to.x, ty, to.z) <= LINE_SLACK * 100 + slack) return s;
      } else if (s.rocket) {
        if (age <= ROCKET_FRESH_MS && toLine(s, to.x, ty, to.z) <= ROCKET_REACH * 100 + slack) return true;
      } else if (age <= ANY_SHOT_FRESH_MS && Math.hypot(s.ex - to.x, s.ez - to.z) <= SHOT_BLAST_REACH * 100 + slack) {
        return true;
      }
    }
    return null;
  }

  // One hit of `kind` for `damage` out of its buckets: its kind's (its rate a second, RATE_SLACK more for the lag that
  // bunches them, a second's worth saved up, two at least) and, for a gun or a fist, the hand's damage (HAND_DPS a
  // second, as much saved up). Neither is spent when the other turns it down
  private take(kind: HitKind, damage: number, now: number): boolean {
    const rate = HIT_LIMITS[kind].rate * RATE_SLACK;
    const cap = Math.max(2, rate);
    const at = this.hitAt.get(kind);
    const tokens = Math.min(cap, (this.hitTokens.get(kind) ?? cap) + (at === undefined ? 0 : ((now - at) / 1000) * rate));
    this.hitAt.set(kind, now);
    this.hitTokens.set(kind, tokens);
    const hand = HAND_KINDS.includes(kind);
    if (hand) {
      const dps = HAND_DPS * RATE_SLACK;
      this.handDamage = Math.min(dps, this.handDamage + (Number.isFinite(this.handAt) ? ((now - this.handAt) / 1000) * dps : 0));
      this.handAt = now;
    }
    if (tokens < 1 || (hand && this.handDamage < damage)) return false;
    this.hitTokens.set(kind, tokens - 1);
    if (hand) this.handDamage -= damage;
    return true;
  }

  // One more move or hit refused at `now` (ms), the older ones fading by half a minute
  private refuse(now: number, what: 'move' | 'hit'): void {
    const fade = this.refusedAt ? 0.5 ** ((now - this.refusedAt) / 60000) : 1;
    this.refusedAt = now;
    this.refusedMoves = this.refusedMoves * fade + (what === 'move' ? 1 : 0);
    this.refusedHits = this.refusedHits * fade + (what === 'hit' ? 1 : 0);
  }
}

export { PlayerChecks };
