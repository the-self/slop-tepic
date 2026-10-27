// js/world/topes.ts
// The topes: the speed bumps across Tepic's streets. Those OpenStreetMap maps (city-geodata.js `topes`) where they are;
// the town has thousands more than anyone has mapped, so a third of the two-way residential streets get one too (a
// little in from a corner, and a second near the other end of the longer blocks), but none within NO_GUESS m of a
// mapped one: there the map knows better. The paint draws them (road-paint.ts) and the traffic slows down for each
// (sim/traffic). Both plan them here, from the same edges, so they agree. No three.js here, so node --test imports it.
import { placeOnEdges } from './edge-places.ts';
import type { PaintEdge } from './road-network.ts';

/** A tope across a street: its middle (m), the street's direction & right there, half its width (m), and whether it is
 *  mapped (OpenStreetMap's) or guessed */
export interface Tope {
  x: number;
  z: number;
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  half: number;
  mapped: boolean;
}

const NO_GUESS = 200; // m round a mapped tope with none guessed
const MAPPED_REACH = 3; // m past an edge's stop lines a mapped tope is still taken onto it
const FROM_CORNER = 14; // m from a corner to a guessed tope
const MIN_BLOCK = 45; // m between corners a street needs for a guessed tope
const SECOND = 90; // m between corners for a second one, near the far end
const SHARE = 0.33; // of the two-way residential streets with one

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The topes on the road network's paint edges `edges` (road-network.ts paintEdges: every physical road, each way):
 * the mapped ones of `mapped` (GEO.topes: x, z, kind each) on the edge whose roadway they lie in, and the guessed
 * ones, away from them
 */
function planTopes(edges: readonly PaintEdge[], mapped: readonly number[]): Tope[] {
  const out: Tope[] = [];
  const across = (e: PaintEdge, s: number, isMapped: boolean) => {
    out.push({ x: e.sx + e.dx * s, z: e.sz + e.dz * s, dx: e.dx, dz: e.dz, rx: e.rx, rz: e.rz, half: e.half, mapped: isMapped });
  };
  // (one mapped at a bend of the street lies a metre or two past its edges' ends: taken just inside the nearest)
  for (const { edge, raw } of placeOnEdges(mapped, 3, edges, { reach: MAPPED_REACH, aside: 0.5, minLen: 4 })) {
    across(edge, Math.min(edge.len - 1, Math.max(1, raw)), true);
  }
  const real = out.slice();
  // the one or two directed edges of each road between a pair of nodes
  const roads = new Map<number, PaintEdge[]>();
  for (const e of edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    const road = roads.get(key);
    if (road) road.push(e);
    else roads.set(key, [e]);
  }
  for (const [e, ...back] of roads.values()) {
    if (!back.length || e.axis !== 'st' || e.lift || e.len < MIN_BLOCK || hash(e.from.id, e.to.id) > SHARE) continue;
    const mx = e.sx + e.dx * e.len / 2, mz = e.sz + e.dz * e.len / 2;
    if (real.some((t) => Math.hypot(t.x - mx, t.z - mz) < NO_GUESS + e.len / 2)) continue;
    across(e, Math.min(FROM_CORNER, e.len * 0.3), false);
    if (e.len > SECOND && hash(e.to.id, e.from.id) < 0.5) across(e, e.len - FROM_CORNER, false);
  }
  return out;
}

export { planTopes };
