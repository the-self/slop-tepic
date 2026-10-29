// js/sim/traffic/topes.ts
// The topes (world/topes.ts) as the traffic drives them: on each edge where they lie, a driver easing off to cross one
// at a crawl, nearly stopping (the way Tepic's drivers take them, braking for it from well ahead), and the body bucking
// as each axle rolls over it (topeJolt)
import { LOOKAHEAD } from './constants.ts';
import { placeOnEdges } from '../../world/edge-places.ts';
import type { Tope } from '../../world/topes.ts';
import type { DrivenVehicle, TrafficEdge } from './types.ts';

const OVER = 1.6; // m/s over a tope (~6 km/h)
const OVER_BOYAS = 4.2; // m/s over a row of boyas (~15 km/h: they rattle, they don't throw)
const EASE = 2.5; // m/s² a driver slows for one at
const BEFORE = 3; // m short of it a driver is already down to OVER (the front wheels roll onto it at a crawl)
const BUCK = 0.35; // rad/s of pitch an axle rolling over one gives the body, per m/s it goes (~4° at a crawl)

/** The topes `topes` on the traffic's edges: e.topes, m along each from its start stop line, in order (both ways), and
 *  e.topeOver, the speed each is crossed at */
function placeTopes(topes: readonly Tope[], edges: readonly TrafficEdge[]): number {
  const flat: number[] = [];
  for (const t of topes) flat.push(t.x, t.z);
  let placed = 0;
  const found = new Map<TrafficEdge, [s: number, over: number][]>();
  const add = (e: TrafficEdge, s: number, over: number) => {
    const list = found.get(e);
    if (list) list.push([s, over]);
    else found.set(e, [[s, over]]);
  };
  for (const { i, edge: e, raw } of placeOnEdges(flat, 2, edges, { reach: 1.5, aside: 0.5 })) {
    const over = topes[i].boyas ? OVER_BOYAS : OVER;
    add(e, raw, over);
    // (and the edge back along the same road)
    const back = e.to.out.find((o) => o.to === e.from && o.dx * e.dx + o.dz * e.dz < -0.9);
    if (back) add(back, (e.sx + e.dx * raw - back.sx) * back.dx + (e.sz + e.dz * raw - back.sz) * back.dz, over);
    placed++;
  }
  for (const [e, list] of found) {
    list.sort((a, b) => a[0] - b[0]);
    e.topes = list.map(([s]) => s);
    e.topeOver = list.map(([, over]) => over);
  }
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
  for (let i = 0; i < e.topes.length; i++) {
    const d = e.topes[i] - front;
    if (d < -2 * v.half) continue; // (all of it over)
    if (d > LOOKAHEAD) break;
    const over = e.topeOver[i] ?? OVER;
    return Math.sqrt(over * over + 2 * EASE * Math.max(0, d - BEFORE));
  }
  return Infinity;
}

/** v's body bucking as an axle rolls over a tope on its edge, having gone `ds` m along it this frame: the nose
 *  thrown up as the front wheels climb it, down as the rear ones do */
function topeJolt(v: DrivenVehicle, ds: number): void {
  if (v.conn || ds <= 0) return;
  const axle = v.axle || 1.3;
  const { topes, topeOver } = v.edge, front = v.s + axle, rear = v.s - axle;
  for (let i = 0; i < topes.length; i++) {
    const s = topes[i];
    // (a row of boyas only shakes it: a third of a hump's)
    const k = (topeOver[i] ?? OVER) > OVER ? BUCK / 3 : BUCK;
    if (s > front - ds && s <= front) v.pitchVel -= k * v.speed;
    if (s > rear - ds && s <= rear) v.pitchVel += k * v.speed;
  }
}

export { placeTopes, topeCap, topeJolt };
