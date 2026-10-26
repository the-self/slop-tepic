// js/player/car-physics/aids.ts
// The car's driver aids, a game's (as GTA's: the player steers with keys, all or nothing, and a kerb is no reason to
// end up on the roof): the steering held to what the front tyres grip, the stability control, the brakes' bias, the
// roll and pitch held when the ground throws a side or an end up, and the speed a kerb costs. Pure numbers:
// car-physics.ts applies them in Jolt, node --test checks them

const PEAK_SLIP = 0.07; // rad (~4°) the front tyres may slip at most: Jolt's lateral curve peaks at 3°, a little over
// it the front gives first (it runs wide), never the rear (it spins)
const ESC_FROM = 4; // m/s from which the stability control holds the car to the turn its wheels steer...
const ESC_MARGIN = 0.08; // ...beyond this (rad/s) and 15% more than that turn...
export const ESC_GAIN = 8; // ...taking the excess off at this rate (1/s)...
export const ESC_MOST = 0.5; // ...with a torque of at most this share of what the tyres' grip makes over the wheelbase
export const FRONT_BRAKES = 0.65; // the share of the braking on the front wheels (a road car's bias, 60-70%)
// The tip: a kerb or a bump taken fast throws one side or one end of the car up, and in Jolt it went on over onto
// its roof, sideways or end over end (a real car's tyres and bushes give, and it lands back on its wheels). A car
// someone drives rolls and pitches freely up to...
const TIP_FREE = 0.7; // ...this (rad/s: a hard corner's body roll, a hard stop's dive, are a fraction of it)...
export const TIP_HOLD = 10; // ...and the turn beyond it is taken off at this rate (1/s). Leant over further than...
const TIP_LEAN = 0.35; // ...this (rad, ~20°) and not on all its wheels (landing on one side's), it is turned back...
const TIP_RIGHT = 0.5; // ...upright at this rate (rad/s), rather than toppling over slowly
const CRASH_ROLL = 4; // m/s: a knock into a wall or another vehicle this hard (not the ground's) lets it roll...
export const TUMBLE = 2.5; // ...freely for this long (s): a crash still rolls a car over
const KERB_SCRUB = 0.03; // the share of its speed a wheel striking its bump stop costs (a kerb taken fast)...
const KERB_MOST = 1; // ...at most this much (m/s)

/**
 * The most a car's front wheels turn (rad) at `speed` (m/s): the turn its tyres hold at that speed on a `wheelbase`
 * (m) with `grip` (the tyres' friction on this road, 1 dry) plus the slip angle their grip peaks at, no more than its
 * full `lock` (rad). A key held at 100 km/h turns them ~6°, not the 12° that spun the car
 */
export function steerLimit(lock: number, wheelbase: number, grip: number, speed: number): number {
  const vv = speed * speed;
  if (vv < 1) return lock;
  return Math.min(lock, Math.atan(wheelbase * grip * 9.81 / vv) + PEAK_SLIP);
}

/**
 * How much faster (rad/s, + to its left) a car turning at `rate` (rad/s about its up, + to its left) turns than its
 * driver asks, the stability control's to take off: the turn its front wheels steer (`steer` rad, + left) at `forward`
 * m/s on a `wheelbase` (m), no more than its tyres' `grip` holds. 0 while it turns no faster than that, or less
 * (running wide is the tyres' to fix, not a push that would swing its tail out); slow, 0
 */
export function overTurn(rate: number, steer: number, forward: number, wheelbase: number, grip: number): number {
  const speed = Math.abs(forward);
  if (speed < ESC_FROM) return 0;
  const most = grip * 9.81 / speed;
  const asked = Math.max(-most, Math.min(most, forward * Math.tan(steer) / wheelbase));
  const margin = Math.abs(asked) * 0.15 + ESC_MARGIN;
  const hi = Math.max(asked, 0) + margin, lo = Math.min(asked, 0) - margin;
  return rate > hi ? rate - hi : rate < lo ? rate - lo : 0;
}

/**
 * How much of a car's roll or pitch `rate` (rad/s about its length or across it) is past what it tips at freely
 * (TIP_FREE): 0 under it
 */
export function tipExcess(rate: number): number {
  return rate > TIP_FREE ? rate - TIP_FREE : rate < -TIP_FREE ? rate + TIP_FREE : 0;
}

/**
 * How much of a car's roll `rate` (rad/s about its length, + leaning it over to its right) to take off, at `lean`
 * (rad, + over to its right), `allWheels` on the ground or not: what is past TIP_FREE (tipExcess); leant past
 * TIP_LEAN on fewer wheels, all that turns it otherwise than back upright at TIP_RIGHT
 */
export function rollExcess(rate: number, lean: number, allWheels: boolean): number {
  if (allWheels || Math.abs(lean) <= TIP_LEAN) return tipExcess(rate);
  return rate + Math.sign(lean) * TIP_RIGHT;
}

/**
 * Whether a knock (its approach `speed`, m/s, and the up part `ny` of the normal out of what it hit) into `vehicle`
 * (another vehicle, or not: a wall, the ground) is a crash that may roll the car over: a hard one into a wall or a
 * vehicle, never the ground under it
 */
export function crashRolls(speed: number, ny: number, vehicle: boolean): boolean {
  return speed > CRASH_ROLL && (vehicle || Math.abs(ny) < 0.7);
}

/** The speed (m/s) `strikes` wheels striking their bump stops at once take off a car moving at `speed` m/s */
export function kerbScrub(speed: number, strikes: number): number {
  return Math.min(speed, strikes * Math.min(KERB_MOST, speed * KERB_SCRUB));
}
