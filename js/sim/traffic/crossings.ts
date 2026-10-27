// js/sim/traffic/crossings.ts
// The street crossings along the roads (OpenStreetMap's highway=crossing, world/crossings.ts) as the traffic lives
// them: people step off the curb onto one on the WALK where it has lights, where drivers will stop for them at a zebra,
// and where the gap in the traffic is long enough to get over first at an unmarked one; and the vehicles stop short
// of one while anyone is out on it
import { LOOKAHEAD } from './constants.ts';
import { placeCrossings } from '../../world/crossings.ts';
import { stopAt } from './idm.ts';
import type { DrivenVehicle, Ped, StreetCrossing, TrafficEdge } from './types.ts';
import type { TrafficState } from './state.ts';

const SIGNAL_REACH = 8; // m from a signalled junction (or a signal's stop along the street) its crossing goes with its lights
const STOP_SHORT = 2.5; // m before a crossing's centre a vehicle stops for someone on it
const COMFORT = 3; // m/s² a driver brakes at, for someone at a zebra, without thinking twice
const SEEN = 0.8; // s a driver takes to see someone step onto the road
const MARGIN = 2.5; // s more than it takes to walk over that a gap in the traffic must leave, at an unmarked crossing

/**
 * The crossings of `flat` (GEO.crossings) on the traffic's edges: each with the edge back along its road and whether
 * it goes with a signal's lights; each edge's crossings ahead of it (e.crossings, by s)
 */
function placeStreetCrossings(flat: readonly number[], edges: readonly TrafficEdge[]): StreetCrossing[] {
  const out: StreetCrossing[] = [];
  for (const p of placeCrossings(flat, edges)) {
    const e = p.edge;
    const back = e.to.out.find((o) => o.to === e.from && o.dx * e.dx + o.dz * e.dz < -0.9) ?? null;
    const x = e.sx + e.dx * p.s, z = e.sz + e.dz * p.s;
    const bs = back ? (x - back.sx) * back.dx + (z - back.sz) * back.dz : 0;
    // (its lights: its own, or the junction's whose crosswalk it is)
    const atFrom = p.raw < SIGNAL_REACH && e.from.signal, atTo = p.raw > e.len - SIGNAL_REACH && e.to.signal;
    // the traffic it stops, by its group at the junction it goes with (on the WALK while that group has the red)
    const group = atTo ? e.axisIndex : atFrom && back ? back.axisIndex : e.axisIndex;
    out.push({ x, z, kind: p.kind, edge: e, s: p.s, back, bs, signal: atFrom || atTo || p.kind === 2, group, len: 2 * e.half, walkers: [] });
  }
  for (const c of out) {
    for (const [e, s] of [[c.edge, c.s], [c.back, c.bs]] as const) if (e) e.crossings.push({ c, s });
  }
  for (const e of edges) e.crossings.sort((a, b) => a.s - b.s);
  return out;
}

/**
 * May p, at the curb of its street crossing, step off? With lights, on the WALK; and only once every vehicle coming
 * along the road before the crossing, both ways, could stop short of it: at a zebra or the lights braking no harder
 * than COMFORT, at an unmarked one with the gap to walk over and MARGIN s more before it gets there
 */
function mayCrossStreet(ts: TrafficState, p: Ped): boolean {
  const c = p.cross;
  if (!c) return true;
  if (c.signal && !(c.group === 0 ? ts.stWalk : ts.aveWalk)) return false;
  const overIn = (c.len + 2) / Math.max(0.8, p.speed); // s to get over
  return clearUpTo(c, c.edge, c.s, overIn) && (!c.back || clearUpTo(c, c.back, c.bs, overIn));
}

// Could every vehicle on e (those turning into it too: claim() puts them in its lanes, short of its start) stop short
// of c, `at` m along e, before p is over it in `overIn` s?
function clearUpTo(c: StreetCrossing, e: TrafficEdge, at: number, overIn: number): boolean {
  for (const list of e.occ) {
    for (const o of list) {
      const gap = at - STOP_SHORT - o.s - o.v.half;
      if (gap < -2 * o.v.half - STOP_SHORT) continue; // (past it)
      if (gap < 0.5) return false; // (on it, or standing right at it)
      const v = o.v.speed;
      if (c.kind > 0 || c.signal) {
        if (v * SEEN + (v * v) / (2 * COMFORT) > gap) return false;
      } else if (v > 0.5 && gap / v < overIn + MARGIN) {
        return false;
      }
    }
  }
  return true;
}

/** The braking (m/s², <= 0) v wants for a street crossing ahead on its edge with someone out on the road on it; or,
 *  turning through an intersection, on the edge it is turning into (a crossing just round the corner) */
function crossingBrake(ts: TrafficState, v: DrivenVehicle): number {
  const e = v.conn ? v.move.to : v.edge;
  // (where v is along e: through an intersection, short of its start by what is left of the curve)
  const at = v.conn ? v.cs - v.conn.len : v.s;
  for (const { c, s } of e.crossings) {
    const d = s - STOP_SHORT - at - v.half;
    if (d < -STOP_SHORT) continue; // (its front past it)
    if (d > LOOKAHEAD) break;
    if (c.walkers.length) return stopAt(ts, v, Math.max(d, 0.05), 0.5);
  }
  return 0;
}

export { placeStreetCrossings, mayCrossStreet, crossingBrake };
