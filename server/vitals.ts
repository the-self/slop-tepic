// server/vitals.ts
// A player's health and armour as the server keeps them, so a game that ignores its hurts (god mode) still dies: the
// other players' hits take them as the player's own game does (js/sim/crime/player.ts hurt: a vehicle shields 45%, the
// armour takes three quarters of what it can), its own reports (VITALS) only ever lower them (the city's harm, the
// police's and the falls, which the server doesn't see), and its pickups (HEAL) raise them no more often than the
// game drops them (crime/dispatch.ts: one every 40 s at most). When the health runs out it is dead, whatever its game
// says, until it is back up RESPAWN_MS later.
import type { HealKind } from '../shared/protocol-play.ts';
import type { Mode } from '../shared/protocol.ts';

const FULL = 100; // hit points
const VEHICLE_SHIELD = 0.55; // a hit's share that gets through a vehicle (crime/player.ts hurt)
const ARMOR_TAKES = 0.75; // the share of a hit the armour takes while it lasts
const HEALS: Readonly<Record<HealKind, number>> = { health: 50, armor: 100 }; // a pickup's points (crime/constants.ts)
const HEAL_EVERY_MS = 35000; // a pickup of each kind this often, two saved up (the game drops one every 40 s)
const RESPAWN_MS = 4000; // dead this long (the game's WASTED screen: 4.2 s)

class Vitals {
  health = FULL;
  armor = 0;
  alive = true;
  private diedAt = -Infinity; // ms (Date.now())
  private readonly heals: Record<HealKind, number> = { health: 2, armor: 2 }; // pickups saved up
  private healAt = -Infinity; // ms the pickups were last topped up

  /** A hit of `damage` hit points on the player in `mode`: what it took off its health */
  hurt(damage: number, mode: Mode): number {
    if (!this.alive) return 0;
    const amount = mode === 'person' ? damage : damage * VEHICLE_SHIELD;
    const absorbed = Math.min(this.armor, amount * ARMOR_TAKES);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    return amount - absorbed;
  }

  /** Out of health (after a hurt): the player is dead */
  get spent(): boolean {
    return this.alive && this.health <= 0;
  }

  /** What the player's game says it has: lowered to it, never raised */
  report(health: number, armor: number): void {
    if (!this.alive) return;
    this.health = Math.min(this.health, health);
    this.armor = Math.min(this.armor, armor);
  }

  /** The player took a pickup of `kind` at `now` (ms): false when it can't have had one so soon */
  heal(kind: HealKind, now: number): boolean {
    if (!this.alive) return false;
    if (Number.isFinite(this.healAt)) {
      const more = (now - this.healAt) / HEAL_EVERY_MS;
      this.heals.health = Math.min(2, this.heals.health + more);
      this.heals.armor = Math.min(2, this.heals.armor + more);
    }
    this.healAt = now;
    if (this.heals[kind] < 1) return false;
    this.heals[kind] -= 1;
    if (kind === 'health') this.health = Math.min(FULL, this.health + HEALS.health);
    else this.armor = Math.min(FULL, this.armor + HEALS.armor);
    return true;
  }

  /** The player died at `now` (ms): false when it already was dead */
  die(now: number): boolean {
    if (!this.alive) return false;
    this.alive = false;
    this.health = 0;
    this.diedAt = now;
    return true;
  }

  /** Back up, its health whole and its armour kept, once RESPAWN_MS have gone by since it died; true when it got up */
  revive(now: number): boolean {
    if (this.alive || now - this.diedAt < RESPAWN_MS) return false;
    this.alive = true;
    this.health = FULL;
    return true;
  }
}

export { Vitals, RESPAWN_MS };
