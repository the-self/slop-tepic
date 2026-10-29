// js/sim/traffic/rail-crossings.ts
// The railway's level crossings (world/railway.ts) as the traffic lives them: on each edge that crosses the line, the
// drivers ease over the rails at a crawl (Tepic's drivers take las vías as they take a tope), and while a train closes
// the crossing (sim/trains.ts, through hooks.ts setRailClosed) they stop short of its gate; whoever is already over it
// clears it. People walking stop short of the track while it is closed, and walk on once the gates are up.
import { LOOKAHEAD } from './constants.ts';
import { stopAt } from './idm.ts';
import { RAIL_ENVELOPE } from '../../world/railway.ts';
import type { LevelCrossing } from '../../world/railway.ts';
import type { DrivenVehicle, TrafficEdge } from './types.ts';
import type { TrafficState } from './state.ts';

const REACH = 12; // m past an edge's stop lines a crossing is still taken as on it (in the junction it ends at)
const ASIDE = 1; // m off its curb
const SLANT = 0.35; // sin of the shallowest angle a road crosses the line at (one running alongside it crosses nothing)
const GATE = 2.2; // m further back than the train's clearance a vehicle stops (the gate stands in front of it)
const OVER = 5.5; // m/s (~20 km/h) over the rails
const EASE = 2; // m/s² a driver slows for them at
const PED_CLEAR = RAIL_ENVELOPE - 1; // m from the track's middle people stop
const PED_NEAR = 30; // m: a crossing further off than this is no walker's

/**
 * The crossings `crossings` on the edges `edges` crossing the line there: each edge's (e.rails, by s) with the crossing's
 * index, m along the edge to it and to where a vehicle's front stops for it. Returns how many edges have one
 */
function placeRailCrossings(crossings: readonly LevelCrossing[], edges: readonly TrafficEdge[]): number {
  let placed = 0;
  for (const e of edges) {
    if (e.lift || e.len < 1) continue;
    for (let i = 0; i < crossings.length; i++) {
      const c = crossings[i];
      const raw = (c.x - e.sx) * e.dx + (c.z - e.sz) * e.dz;
      const right = (c.x - e.sx) * e.rx + (c.z - e.sz) * e.rz;
      if (raw < -REACH || raw > e.len + REACH || Math.abs(right) > e.half + ASIDE) continue;
      // (the edge's own slant over the line: a junction's other roads meet it at angles of their own)
      const sin = Math.abs(e.dx * c.tz - e.dz * c.tx);
      if (sin < SLANT) continue;
      const clear = (RAIL_ENVELOPE + e.half * Math.sqrt(1 - sin * sin)) / sin;
      e.rails.push({ c: i, s: raw, stop: raw - clear - GATE });
      placed++;
    }
  }
  for (const e of edges) e.rails.sort((a, b) => a.s - b.s);
  return placed;
}

// v's front, m along the edge whose crossings it looks at: its own, or through an intersection the one it turns into
function frontOn(v: DrivenVehicle): { e: TrafficEdge; front: number } {
  return v.conn ? { e: v.move.to, front: v.cs - v.conn.len + v.half } : { e: v.edge, front: v.s + v.half };
}

/** The braking (m/s², <= 0) v wants for a closed crossing ahead: to a stop short of its gate, unless already past it */
function railBrake(ts: TrafficState, v: DrivenVehicle): number {
  const { e, front } = frontOn(v);
  for (const r of e.rails) {
    const d = r.stop - front;
    if (d < -1) continue; // (past the gate: on over the rails, clearing them)
    if (d > LOOKAHEAD) break;
    if (ts.railClosed[r.c]) return stopAt(ts, v, Math.max(d, 0.05), 0.5);
  }
  return 0;
}

/** The speed (m/s) v may go at for the rails ahead of it or under it: Infinity with none near */
function railCap(v: DrivenVehicle): number {
  const { e, front } = frontOn(v);
  for (const r of e.rails) {
    const d = r.s - 2 - front;
    if (d < -2 * v.half - 4) continue; // (all of it over)
    if (d > LOOKAHEAD) break;
    return Math.sqrt(OVER * OVER + 2 * EASE * Math.max(0, d));
  }
  return Infinity;
}

/** Whether someone walking from (x, z) to (nx, nz) steps towards a closed crossing's track, inside where they wait */
function railHold(ts: TrafficState, x: number, z: number, nx: number, nz: number): boolean {
  for (let i = 0; i < ts.railClosed.length; i++) {
    if (!ts.railClosed[i]) continue;
    const c = ts.railCrossings[i];
    if (Math.abs(x - c.x) > PED_NEAR || Math.abs(z - c.z) > PED_NEAR) continue;
    // (how far off the track's middle, across it)
    const now = Math.abs((x - c.x) * c.tz - (z - c.z) * c.tx), next = Math.abs((nx - c.x) * c.tz - (nz - c.z) * c.tx);
    if (next < PED_CLEAR && next < now) return true;
  }
  return false;
}

export { placeRailCrossings, railBrake, railCap, railHold };
