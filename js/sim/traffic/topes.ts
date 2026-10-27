// js/sim/traffic/topes.ts
// The topes (world/topes.ts) as the traffic drives them: on each edge where they lie, and a driver easing off to cross
// one at a crawl (the way Tepic's drivers take them), braking for it from far enough ahead to do so comfortably
import { LOOKAHEAD } from './constants.ts';
import { placeOnEdges } from '../../world/edge-places.ts';
import type { Tope } from '../../world/topes.ts';
import type { DrivenVehicle, TrafficEdge } from './types.ts';

const OVER = 2.8; // m/s over a tope (~10 km/h)
const EASE = 2; // m/s² a driver slows for one at

/** The topes `topes` on the traffic's edges: e.topes, m along each from its start stop line, in order (both ways) */
function placeTopes(topes: readonly Tope[], edges: readonly TrafficEdge[]): number {
  const flat: number[] = [];
  for (const t of topes) flat.push(t.x, t.z);
  let placed = 0;
  for (const { edge: e, raw } of placeOnEdges(flat, 2, edges, { reach: 1.5, aside: 0.5 })) {
    e.topes.push(raw);
    // (and the edge back along the same road)
    const back = e.to.out.find((o) => o.to === e.from && o.dx * e.dx + o.dz * e.dz < -0.9);
    if (back) back.topes.push((e.sx + e.dx * raw - back.sx) * back.dx + (e.sz + e.dz * raw - back.sz) * back.dz);
    placed++;
  }
  for (const e of edges) e.topes.sort((a, b) => a - b);
  return placed;
}

/**
 * The speed (m/s) v may go at now for a tope ahead on its edge (or under it), or, through a junction, on the edge it
 * turns into: Infinity with none near
 */
function topeCap(v: DrivenVehicle): number {
  // (its front's distance along the edge's topes: on its edge, or on the next one from the junction's curve)
  const e = v.conn ? v.move.to : v.edge;
  const front = v.conn ? v.cs - v.conn.len + v.half : v.s + v.half;
  for (const s of e.topes) {
    const d = s - front;
    if (d < -2 * v.half) continue; // (all of it over)
    if (d > LOOKAHEAD) break;
    return Math.sqrt(OVER * OVER + 2 * EASE * Math.max(0, d));
  }
  return Infinity;
}

export { placeTopes, topeCap };
