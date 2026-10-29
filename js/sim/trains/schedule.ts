// js/sim/trains/schedule.ts
// When Ferromex's trains come through, and what they are. The line is one track, so they run in fleets: RUNS trains
// one way, a PERIOD or so apart, then none for as long as the last takes to clear the line, then RUNS the other way
// (no two meet head on). Each drawn from its number (the same train at the same time for everyone, in multiplayer
// too: the clock is the wall's): two or three diesels at the head, then 25 to 55 cars of grain, of everything, of
// containers or of new cars, at 32 to 40 km/h through the town. And the crossings' rules: closed from WARN s before the head gets there till
// its tail is past, the horn's long, long, short, long as the head comes up to each. No three.js here, so node --test
// imports it.
import { CONSISTS, CONSIST_KINDS, RAIL_CARS } from '../../models/trains.ts';
import type { ConsistKind, Livery, RailCarKind } from '../../models/trains.ts';

/** A car in a train: its kind, m from the train's head to its middle, its paints (0xrrggbb; a stack car's second
 *  container the second), a diesel's livery, and whether it runs back to front (a trailing diesel turned) */
export interface TrainCar {
  kind: RailCarKind;
  at: number;
  paint: number;
  paint2: number;
  livery: Livery;
  flip: boolean;
}

/** One run of a train down the line: its number, its way along the line (+1 north-west, -1 south-east), when its
 *  head comes onto the line (s, on the wall clock), its speed (m/s), its cars and its length (m) */
export interface TrainRun {
  id: number;
  dir: 1 | -1;
  t0: number;
  speed: number;
  consist: ConsistKind;
  cars: TrainCar[];
  length: number;
}

const PERIOD = 15 * 60; // s between two trains of a fleet, on average
const JITTER = 0.2; // of PERIOD a train is early or late by (never catching the one ahead)
const FLEET = 8; // slots of PERIOD a fleet & the gap after it take...
const RUNS = 4; // ...the first RUNS of them with a train (the rest: the line clearing for the other way's)
const SPEED = [9, 11] as const; // m/s (~32-40 km/h, Ferromex's limit through the town)
const CARS = [25, 55] as const; // cars behind the diesels
const WARN = 30; // s before the head gets to a crossing that its lights start flashing and its gates come down
const CLEAR = 6; // m past a crossing the tail must be before it opens
// The horn's pattern for a crossing, by the s left till the head gets there (long, long, short, long till it is over)
const HORN: readonly (readonly [from: number, to: number])[] = [[15, 12], [11, 8], [7, 6], [5.5, -1]];

// A small seeded generator (mulberry32, its seed mixed first: trains k and k + 1 alike otherwise): 0..1
function random(seed: number): () => number {
  let s = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
  s = (s ^ (s >>> 16)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let r = rnd() * total;
  for (const [item, w] of weighted) {
    r -= w;
    if (r <= 0) return item;
  }
  return weighted[weighted.length - 1][0];
}

/** Train number `k`'s cars and speed, drawn from k, its way its fleet's; its head comes on at `t0` (s), else at k's slot */
function trainRun(k: number, t0?: number, period = PERIOD): TrainRun {
  const rnd = random(k);
  const consist = pick(rnd, CONSIST_KINDS.map((kind) => [kind, CONSISTS[kind].weight] as const));
  const dir = Math.floor(k / FLEET) % 2 === 0 ? 1 : -1;
  const speed = SPEED[0] + rnd() * (SPEED[1] - SPEED[0]);
  const start = t0 ?? k * period + (rnd() * 2 - 1) * JITTER * period;
  const cars: TrainCar[] = [];
  let length = 0;
  const add = (kind: RailCarKind, livery: Livery, flip: boolean) => {
    const spec = RAIL_CARS[kind], paints = spec.paints;
    const paint = paints.length ? paints[Math.floor(rnd() * paints.length)] : 0;
    const paint2 = paints.length ? paints[Math.floor(rnd() * paints.length)] : 0;
    cars.push({ kind, at: length + spec.length / 2, paint, paint2, livery, flip });
    length += spec.length;
  };
  const locos = rnd() < 0.7 ? 2 : 3;
  for (let i = 0; i < locos; i++) add('loco', rnd() < 0.5 ? 0 : 1, i > 0 && rnd() < 0.4);
  const n = CARS[0] + Math.floor(rnd() * (CARS[1] - CARS[0] + 1));
  for (let i = 0; i < n; i++) add(pick(rnd, CONSISTS[consist].cars), 0, false);
  return { id: k, dir, t0: start, speed, consist, cars, length };
}

/** m along a line `lineLength` long of run r's head at `time` (s); off the line's ends before & after its run */
function headAt(r: TrainRun, time: number, lineLength: number): number {
  const run = (time - r.t0) * r.speed;
  return r.dir > 0 ? run : lineLength - run;
}

/** Whether any of run r is on the line at `time` */
function onLine(r: TrainRun, time: number, lineLength: number): boolean {
  const run = (time - r.t0) * r.speed;
  return run >= 0 && run <= lineLength + r.length;
}

/**
 * The runs on a line `lineLength` long at `time` (s) into `out`; `cache` keeps the runs drawn by their number (those
 * long gone are let go)
 */
function runsAt(time: number, lineLength: number, cache: Map<number, TrainRun>, out: TrainRun[], period = PERIOD): TrainRun[] {
  out.length = 0;
  // (the slowest, longest run's time on the line, and its slot's jitter either side)
  const longest = (lineLength + (CARS[1] + 3) * RAIL_CARS.autorack.length) / SPEED[0];
  const k0 = Math.floor((time - longest) / period - JITTER) - 1, k1 = Math.ceil(time / period + JITTER) + 1;
  for (const k of cache.keys()) if (k >= 0 && k < k0) cache.delete(k);
  for (let k = k0; k <= k1; k++) {
    if (((k % FLEET) + FLEET) % FLEET >= RUNS) continue;
    let r = cache.get(k);
    if (!r) cache.set(k, (r = trainRun(k, undefined, period)));
    if (onLine(r, time, lineLength)) out.push(r);
  }
  return out;
}

/**
 * A run of its own (number `id` < 0) whose head gets to `s` m along the line `lead` s after `time`: the next train
 * past the player, for ?train=1. Its way, cars & speed drawn from `seed`
 */
function summonRun(id: number, seed: number, s: number, time: number, lineLength: number, lead = 40): TrainRun {
  const r = trainRun(seed, 0);
  r.dir = seed % 2 ? 1 : -1;
  const ahead = r.dir > 0 ? s : lineLength - s;
  return { ...r, id, t0: time + lead - ahead / r.speed };
}

/** m from the head of run r (at `head` m along the line) on to a point `s` m along it: < 0 behind the head */
function aheadOf(r: TrainRun, head: number, s: number): number {
  return (s - head) * r.dir;
}

/** Whether run r, its head `head` m along the line, closes a crossing `s` m along it */
function closes(r: TrainRun, head: number, s: number): boolean {
  const d = aheadOf(r, head, s);
  return d < r.speed * WARN && d > -r.length - CLEAR;
}

/** Whether the horn sounds, `tau` s before the head gets to a crossing (Infinity: none ahead) */
function hornOn(tau: number): boolean {
  for (const [from, to] of HORN) if (tau <= from && tau > to) return true;
  return false;
}

export { PERIOD as TRAIN_PERIOD, WARN as CROSSING_WARN, trainRun, headAt, onLine, runsAt, summonRun, aheadOf, closes, hornOn };
