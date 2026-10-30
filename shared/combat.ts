// shared/combat.ts
// What the room server holds a player's hits and moves to (server/checks.ts): each HIT kind's most damage, reach and
// rate, where a hit has to lie from the shots the server saw, and how fast each mode can go. The weapons' numbers are js/sim/weapons.ts's (tests/multiplayer.test.mjs checks
// they agree); the slack is for the lag between the shooter's view of a target and where the server last heard it.
import type { HitKind, Mode } from './protocol.ts';

/** A HIT kind's limits: hit points one hit takes at most, the farthest it reaches (m) and how much farther a target
 *  may stand on the server (m: it moved since the shooter saw it), the hits a second it can land, and whether it needs
 *  a SHOT of its own fired lately (a gun's round; a blast needs any shot, a punch none) */
export interface HitLimit {
  damage: number;
  reach: number;
  slack: number;
  rate: number;
  shot: 'same' | 'any' | 'none';
}

const HIT_LIMITS: Readonly<Record<HitKind, HitLimit>> = {
  fists: { damage: 20, reach: 1.7, slack: 2, rate: 2.6, shot: 'none' },
  pistol: { damage: 34, reach: 70, slack: 8, rate: 4.5, shot: 'same' },
  smg: { damage: 16, reach: 55, slack: 8, rate: 11, shot: 'same' },
  rifle: { damage: 28, reach: 85, slack: 8, rate: 8, shot: 'same' },
  // (a rocket that struck: its blast, 95 at the middle as crime/gunfire.ts explode deals the others; 300 m of flight)
  bazooka: { damage: 95, reach: 310, slack: 8, rate: 4, shot: 'same' },
  // what the player's shots blew up (a car, a gas station's pumps) or its rocket's blast: a few at once, near the shot
  blast: { damage: 95, reach: 400, slack: 8, rate: 6, shot: 'any' }
};

// The kinds a player lands one at a time, by hand: its guns and its fists. Between them all it deals no more damage a
// second than the strongest of them does alone (else three guns' shots, interleaved, would each fill a bucket of
// their own). A blast is its own: one rocket strikes several players at once
const HAND_KINDS: readonly HitKind[] = ['fists', 'pistol', 'smg', 'rifle'];
const HAND_DPS = Math.max(...HAND_KINDS.map((k) => HIT_LIMITS[k].damage * HIT_LIMITS[k].rate)); // hit points/s (the rifle's 224)
const RATE_SLACK = 1.5; // the rates times this, for the lag that bunches hits together

const LAG_S = 0.6; // s of the shooter's and the target's own speeds added to a kind's slack (a car crossing the sights)
const SHOT_FRESH_MS = 2000; // a gun's hit needs one of its SHOTs this recent, passing the target (each round strikes once)...
const ANY_SHOT_FRESH_MS = 12000; // ...a blast a rocket or a round this recent (a car burns a while before it blows)
// Where a hit has to lie, from the server's poses (which lag the shooter's view of its target, so the target's speed
// times LAG_S is added to each): a round's line within LINE_SLACK of the target's body; a rocket's blast within
// ROCKET_REACH of its line (crime/gunfire.ts explode: the blast's 8 m × 1.3 the others take); what a round blew up
// (a car's tank, 5.5 m; a gas station's pumps, 10 m; × 1.3) within SHOT_BLAST_REACH of where the round ended
const LINE_SLACK = 3; // m
const ROCKET_REACH = 14; // m
const SHOT_BLAST_REACH = 17; // m
const ROCKET_FRESH_MS = 8000; // a rocket's blast this soon after it was fired (300 m at 48 m/s: 6.3 s)
const ORIGIN_SLACK = 6; // m from the shooter's pose a shot may start (its muzzle, ahead of it; plus its speed's lag)
const BODY_UP = 1; // m over a pose's feet its body's middle is (a shot aims there)
const KILL_WINDOW_MS = 10000; // a kill is the killer's when its hit struck the victim this lately

// The fastest a player goes in each mode (m/s): a sprint and a fall, the fastest bicycle downhill, a sports moto, the
// fastest car in js/models/cars (340 km/h, and faster downhill), the helicopter, a passenger as its driver's car
const MODE_SPEED: Readonly<Record<Mode, number>> = {
  person: 20,
  cyclist: 26,
  moto: 85,
  car: 115,
  helicopter: 95,
  passenger: 115
};
// A jump further than the player could have gone is a teleport (the map's, a respawn), allowed this often, a couple
// saved up
const TELEPORT_EVERY_S = 4;

export {
  HIT_LIMITS, HAND_KINDS, HAND_DPS, RATE_SLACK, LAG_S, SHOT_FRESH_MS, ANY_SHOT_FRESH_MS, LINE_SLACK, ROCKET_REACH, SHOT_BLAST_REACH,
  ROCKET_FRESH_MS, ORIGIN_SLACK, BODY_UP, KILL_WINDOW_MS, MODE_SPEED, TELEPORT_EVERY_S };
