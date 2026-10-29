// js/world/railway.ts
// Ferromex's main line through Tepic as the trains run it: OpenStreetMap's pieces of it (city-geodata.js `rails`, the
// main line's, not the yard's sidings) chained into one line from the south-east edge of the map (towards Guadalajara)
// to the north (towards Mazatlán & Nogales), measured in m along it; and its level crossings, where a road at grade
// crosses it (bridges.ts sets the rails flush into the asphalt there): the trains close them, the traffic waits.
// No three.js here, so node --test imports it.
import { GEO } from './city-geodata.js';
import type { GraphLink, Rail } from './city-geodata.d.ts';

/** The line: its points (m) and how far along it each is (m from its south-eastern end), and its length (m) */
export interface RailLine {
  xs: Float64Array;
  zs: Float64Array;
  at: Float64Array;
  length: number;
}

/** A point along the line (m) and the line's direction there (unit, the way its m grow: north-west, overall) */
export interface RailPoint {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

/** A level crossing: where the road crosses the line (m), m along the line, the road's direction (unit) and half its
 *  width (m), the line's direction (unit), and m along the road from the line to where traffic stops short of it */
export interface LevelCrossing {
  x: number;
  z: number;
  s: number;
  rx: number;
  rz: number;
  half: number;
  tx: number;
  tz: number;
  clear: number;
}

const JOIN = 1; // m: two pieces' ends this close are joined
const GAUGE = 1.435; // m: standard gauge (Ferromex's line through Tepic)
const BED_TOP = 0.25; // m: the ballast's top over the ground
const RAIL_H = 0.16; // m: the rails on the sleepers
const RAIL_TOP = BED_TOP + RAIL_H + 0.02; // m: the rails' top over the ground (bridges.ts lays them on 2 cm of sleeper)
const ENVELOPE = 4.5; // m either side of the track a train sweeps (its 1.6 m half width, overhang & a margin): stay out
const AT_GRADE = 0.5; // m: a road this close to the ground where it crosses meets the rails there
const SAME = 3; // m: crossings this close are one
const CELL = 64; // m: the cells the line's segments are looked up in

/**
 * The main line's pieces (`rails`, main = 1) chained end to end into the longest line they make, from its south-
 * eastern end (the greater z). Null with no main line.
 */
function chainMainLine(rails: readonly Rail[]): RailLine | null {
  const pieces: number[][] = rails.filter((r) => r[3] === 1 && r[0].length >= 4).map((r) => r[0].slice());
  const end = (p: number[], last: boolean): [number, number] => (last ? [p[p.length - 2], p[p.length - 1]] : [p[0], p[1]]);
  const meets = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN;
  // (an end no other piece meets starts a chain)
  const loose = (p: number[], last: boolean) => !pieces.some((q) => q !== p && (meets(end(p, last), end(q, false)) || meets(end(p, last), end(q, true))));
  let best: number[] | null = null;
  for (const first of pieces) {
    for (const fromLast of [false, true]) {
      if (!loose(first, fromLast)) continue;
      const used = new Set([first]);
      // (walked from its loose end: a piece starting there as it is, one from its last point reversed)
      const pts = fromLast ? reversed(first) : first.slice();
      for (;;) {
        const tip = end(pts, true);
        let next: number[] | null = null;
        for (const q of pieces) {
          if (used.has(q)) continue;
          if (meets(tip, end(q, false))) next = q;
          else if (meets(tip, end(q, true))) next = reversed(q);
          if (next) { used.add(q); break; }
        }
        if (!next) break;
        pts.push(...next.slice(2)); // (its first point is the tip)
      }
      if (!best || lengthOf(pts) > lengthOf(best)) best = pts;
    }
  }
  if (!best) return null;
  // from the south-eastern end
  if (best[1] < best[best.length - 1]) best = reversed(best);
  const n = best.length / 2;
  const xs = new Float64Array(n), zs = new Float64Array(n), at = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = best[i * 2];
    zs[i] = best[i * 2 + 1];
    at[i] = i ? at[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]) : 0;
  }
  return { xs, zs, at, length: at[n - 1] };
}

function reversed(p: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1]);
  return out;
}

function lengthOf(p: readonly number[]): number {
  let l = 0;
  for (let k = 2; k + 1 < p.length; k += 2) l += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
  return l;
}

/** The point `s` m along `line` (held to its ends) into `out` */
function railPoint(line: RailLine, s: number, out: RailPoint): RailPoint {
  const { xs, zs, at } = line;
  const n = at.length;
  // (the segment s falls in: at[i] <= s < at[i + 1])
  let lo = 0, hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (at[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const len = at[lo + 1] - at[lo] || 1;
  const f = Math.min(1, Math.max(0, (s - at[lo]) / len));
  out.dx = (xs[lo + 1] - xs[lo]) / len;
  out.dz = (zs[lo + 1] - zs[lo]) / len;
  out.x = xs[lo] + (xs[lo + 1] - xs[lo]) * f;
  out.z = zs[lo] + (zs[lo + 1] - zs[lo]) * f;
  return out;
}

/** m along `line` of its point nearest (x, z), and how far that is (m) */
function nearestOnLine(line: RailLine, x: number, z: number): { s: number; d: number } {
  const { xs, zs, at } = line;
  let bestS = 0, bestD = Infinity;
  for (let i = 0; i + 1 < at.length; i++) {
    const ux = xs[i + 1] - xs[i], uz = zs[i + 1] - zs[i], l2 = ux * ux + uz * uz || 1;
    const f = Math.min(1, Math.max(0, ((x - xs[i]) * ux + (z - zs[i]) * uz) / l2));
    const d = Math.hypot(xs[i] + ux * f - x, zs[i] + uz * f - z);
    if (d < bestD) { bestD = d; bestS = at[i] + f * (at[i + 1] - at[i]); }
  }
  return { s: bestS, d: bestD };
}

/**
 * Where the road graph's links (`nodes`, `links`: GEO.roadGraph) cross `line` at grade: not a bridge's or a tunnel's
 * way, nor lifted over the ground there. In order along the line.
 */
function findLevelCrossings(line: RailLine, nodes: readonly number[], links: readonly GraphLink[]): LevelCrossing[] {
  const { xs, zs, at } = line;
  const out: LevelCrossing[] = [];
  // the line's segments in CELL m cells, each looked at once per road segment (`seen`: the road segment's number)
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  const span = (a: number, b: number) => [Math.floor(Math.min(a, b) / CELL), Math.floor(Math.max(a, b) / CELL)];
  for (let i = 0; i + 1 < at.length; i++) {
    const [i0, i1] = span(xs[i], xs[i + 1]), [j0, j1] = span(zs[i], zs[i + 1]);
    for (let ci = i0; ci <= i1; ci++) {
      for (let cj = j0; cj <= j1; cj++) {
        const list = cells.get(key(ci, cj));
        if (list) list.push(i);
        else cells.set(key(ci, cj), [i]);
      }
    }
  }
  const seen = new Int32Array(at.length).fill(-1);
  let segment = 0;
  for (const link of links) {
    if (link[8] !== 0) continue; // (a bridge's or a tunnel's way)
    const pts = [nodes[link[0] * 2], nodes[link[0] * 2 + 1], ...link[6], nodes[link[1] * 2], nodes[link[1] * 2 + 1]];
    const lifts = link[7];
    for (let k = 0; k + 3 < pts.length; k += 2, segment++) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const [i0, i1] = span(ax, bx), [j0, j1] = span(az, bz);
      const near: number[] = [];
      for (let ci = i0; ci <= i1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          for (const i of cells.get(key(ci, cj)) ?? []) {
            if (seen[i] === segment) continue;
            seen[i] = segment;
            near.push(i);
          }
        }
      }
      for (const i of near) {
        const cx = xs[i], cz = zs[i], ex = xs[i + 1], ez = zs[i + 1];
        // (the road's segment a-b crossing the line's c-e: f along a-b, g along c-e)
        const den = (bx - ax) * (ez - cz) - (bz - az) * (ex - cx);
        if (Math.abs(den) < 1e-9) continue;
        const f = ((cx - ax) * (ez - cz) - (cz - az) * (ex - cx)) / den;
        const g = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
        if (f < 0 || f > 1 || g < 0 || g > 1) continue;
        const lift = lifts ? (lifts[k / 2] + (lifts[k / 2 + 1] - lifts[k / 2]) * f) / 10 : 0;
        if (Math.abs(lift) > AT_GRADE) continue;
        const rl = Math.hypot(bx - ax, bz - az) || 1, tl = at[i + 1] - at[i] || 1;
        const rx = (bx - ax) / rl, rz = (bz - az) / rl, tx = (ex - cx) / tl, tz = (ez - cz) / tl;
        // (the road crossing at a slant: further along it to be out of the train's way)
        const sin = Math.max(0.35, Math.abs(rx * tz - rz * tx));
        out.push({
          x: ax + (bx - ax) * f, z: az + (bz - az) * f, s: at[i] + g * tl, rx, rz, half: link[3] / 2, tx, tz,
          clear: (ENVELOPE + (link[3] / 2) * Math.sqrt(1 - sin * sin)) / sin
        });
      }
    }
  }
  out.sort((a, b) => a.s - b.s);
  // One where the road has a node on the rails (a junction there, or OSM's way split at them) is met by each link
  // into it: one crossing, the widest road's, the furthest of their clearances
  const merged: LevelCrossing[] = [];
  for (const c of out) {
    const last = merged.at(-1);
    if (last && Math.hypot(c.x - last.x, c.z - last.z) < SAME) {
      if (c.half > last.half) Object.assign(last, { rx: c.rx, rz: c.rz, half: c.half });
      last.clear = Math.max(last.clear, c.clear);
    } else merged.push(c);
  }
  return merged;
}

let MAIN: RailLine | null | undefined;
let CROSSINGS: LevelCrossing[] | undefined;

/** Tepic's main line (GEO.rails), worked out once; null in a city without one */
function mainLine(): RailLine | null {
  if (MAIN === undefined) MAIN = chainMainLine(GEO.rails);
  return MAIN;
}

/** The main line's level crossings (GEO.roadGraph), worked out once: their order is their index everywhere */
function levelCrossings(): readonly LevelCrossing[] {
  if (!CROSSINGS) {
    const line = mainLine();
    CROSSINGS = line ? findLevelCrossings(line, GEO.roadGraph.nodes, GEO.roadGraph.links) : [];
  }
  return CROSSINGS;
}

export {
  GAUGE as RAIL_GAUGE, BED_TOP as RAIL_BED_TOP, RAIL_H, RAIL_TOP, ENVELOPE as RAIL_ENVELOPE, chainMainLine, railPoint, nearestOnLine, findLevelCrossings, mainLine, levelCrossings
};
