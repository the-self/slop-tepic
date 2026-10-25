// js/world/buildings/dice.ts
// The seeded dice the lots are filled with: one mulberry32 stream for the whole build, re-seeded from each block's
// (and each house's) position before it is laid out (seedDice), so every block is reproducible on its own.
import type { Weighted } from './types.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Re-seeded from each block's position (see populateBlock), so every block is reproducible on its own
export let rand = mulberry32(10019);
/** Starts the stream over from `seed`: a block's or a house's position hash, or 10019 for a new build */
export function seedDice(seed: number) {
  rand = mulberry32(seed);
}
export const range = (a: number, b: number) => a + (b - a) * rand();
export const irange = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
export const chance = (p: number) => rand() < p;
export const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
// Weighted pick from [[value, weight], ...]
export function pickW<T>(table: Weighted<T>): T {
  let total = 0;
  for (const e of table) total += e[1];
  let r = rand() * total;
  for (const e of table) {
    r -= e[1];
    if (r < 0) return e[0];
  }
  return table[table.length - 1][0];
}
