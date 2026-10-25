// js/player/car-blood.ts
// The blood the player's car picks up running people down: stains on its nose (bumper & grille), its bonnet and its
// windscreen, where the body struck it and as far up as the speed carried it (a slow knock marks the bumper; past
// ~30 km/h the body rolls onto the bonnet, past ~45 km/h into the glass). They build up hit after hit in a fixed set of
// slots (drawn by the car's own material, actors/actor-models.ts createLoftedCarMaterial's `blood`: no draw calls of
// their own), a stain near an old one darkening and spreading it; heavy rain washes them off over a minute or two, a
// repair at once. Plain numbers, no three.js (node --test runs it).
//
// Frame: the car's body shape's own (the geometry's, before it is stretched to its model's size): x across (+ its
// left), y up from the ground, z along (+ ahead).

import type { BodySpec, CabinSpec } from '../models/bodies.ts';

/** A car's stains: flat [x, y, size, amount] per nose slot and [x, z, size, amount] per bonnet & windscreen slot (m, 0..1) */
export interface Stains {
  front: Float32Array;
  top: Float32Array;
}

/** Where on a body shape the stains go (its own frame, m): half width, nose tip, nose height, windscreen's foot & top */
export interface BloodFrame {
  halfW: number;
  zFront: number;
  noseY: number;
  cowl: number;
  roofFront: number;
}

/** What bloodFrame reads of a body spec */
export type BloodSpec = Pick<BodySpec, 'zFront' | 'bumpers' | 'bumperLine'> & { cabin: Pick<CabinSpec, 'cowl' | 'roofFront'> };

const FRONT_SLOTS = 4; // stains on the nose, each (x, y, size, amount)
const TOP_SLOTS = 6; // ...on the bonnet & windscreen, each (x, z, size, amount)
const MAX_SIZE = 0.5; // m across a stain grows to at most
const MERGE = 0.7; // a new stain this close (in its size) to an old one darkens & spreads that one instead
const WASH_FROM = 0.35; // rain (0..1, weather.ts rainIntensity) under which nothing washes off...
const WASH_RATE = 0.022; // ...and the share of a stain heavy rain takes a second (full rain: ~70 s)

/** Pure: an empty set of stains, as the uniforms want them: flat [x, y|z, size, amount] per slot */
function createStains(): Stains {
  return { front: new Float32Array(FRONT_SLOTS * 4), top: new Float32Array(TOP_SLOTS * 4) };
}

/**
 * Pure: where on a body shape the stains go, from its spec (actors/actor-models.ts BODY_SPECS: zFront, bumpers,
 * bumperLine, cabin.cowl & roofFront) and its half width: the nose's height, and the bonnet's & windscreen's run along
 * it
 */
function bloodFrame(spec: BloodSpec, halfW: number): BloodFrame {
  return {
    halfW,
    zFront: spec.zFront,
    noseY: (spec.bumpers[0][0] + spec.bumperLine[0]) / 2,
    cowl: spec.cabin.cowl,
    roofFront: spec.cabin.roofFront
  };
}

// One stain into `slots` (count of them, flat [a, b, size, amount]): onto a near one, else the first empty or faintest
function stain(slots: Float32Array, count: number, a: number, b: number, size: number, amount: number): void {
  let best = -1, faint = -1;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if (slots[o + 3] > 0 && Math.hypot(slots[o] - a, slots[o + 1] - b) < (slots[o + 2] + size) * MERGE / 2) {
      best = i;
      break;
    }
    if (faint < 0 || slots[o + 3] < slots[faint * 4 + 3]) faint = i;
  }
  if (best >= 0) {
    const o = best * 4;
    const w = amount / (slots[o + 3] + amount);
    slots[o] += (a - slots[o]) * w * 0.5;
    slots[o + 1] += (b - slots[o + 1]) * w * 0.5;
    slots[o + 2] = Math.min(MAX_SIZE, Math.max(slots[o + 2], size) + size * 0.25);
    slots[o + 3] = Math.min(1, slots[o + 3] + amount * 0.7);
    return;
  }
  const o = faint * 4;
  slots[o] = a;
  slots[o + 1] = b;
  slots[o + 2] = size;
  slots[o + 3] = amount;
}

/**
 * Pure: a person struck at `speed` m/s, `bleed` (0..1, sim/ragdolls.ts bleedOf) as bad, `across` m to the left of the
 * car's middle (in its body shape's frame): their blood on the nose there, and on the bonnet and the windscreen as the
 * speed threw them up it. `rand` (0..1) scatters it a little
 */
function addHit(stains: Stains, frame: BloodFrame, across: number, speed: number, bleed: number, rand: () => number = Math.random): void {
  if (!(bleed > 0)) return;
  const x = Math.max(-frame.halfW + 0.15, Math.min(frame.halfW - 0.15, across));
  const jitter = () => (rand() - 0.5) * 0.16;
  stain(stains.front, FRONT_SLOTS, x + jitter(), frame.noseY + jitter() * 0.5, 0.2 + 0.2 * bleed, 0.5 + 0.5 * bleed);
  // onto the bonnet, further up it the faster
  if (speed > 8) {
    const up = Math.min(frame.zFront - frame.cowl - 0.25, 0.2 + (speed - 8) * 0.08);
    stain(stains.top, TOP_SLOTS, x + jitter(), frame.zFront - up, 0.22 + 0.25 * bleed, 0.45 + 0.5 * bleed);
  }
  // ...and into the glass
  if (speed > 12.5) {
    const up = Math.min((frame.cowl - frame.roofFront) * 0.6, 0.15 + (speed - 12.5) * 0.03);
    stain(stains.top, TOP_SLOTS, x * 0.8 + jitter(), frame.cowl - up, 0.25 + 0.2 * bleed, 0.4 + 0.5 * bleed);
  }
}

/** Pure: `dt` s of rain falling as hard as `rain` (0..1): heavy rain washes the stains off a little. Whether any is left */
function wash(stains: Stains, dt: number, rain: number): boolean {
  const k = rain > WASH_FROM ? WASH_RATE * (rain - WASH_FROM) / (1 - WASH_FROM) * dt : 0;
  const front = fade(stains.front, k), top = fade(stains.top, k);
  return front || top;
}

// Every stain in `slots` `k` fainter; whether any is left
function fade(slots: Float32Array, k: number): boolean {
  let left = false;
  for (let o = 3; o < slots.length; o += 4) {
    if (k) slots[o] = Math.max(0, slots[o] - k);
    if (slots[o] > 0) left = true;
  }
  return left;
}

/** Pure: every stain gone (the car repaired) */
function clean(stains: Stains): void {
  stains.front.fill(0);
  stains.top.fill(0);
}

export { createStains, bloodFrame, addHit, wash, clean, FRONT_SLOTS, TOP_SLOTS, MAX_SIZE };
