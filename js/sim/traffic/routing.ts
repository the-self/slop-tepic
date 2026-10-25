// js/sim/traffic/routing.ts
// Which way a vehicle goes at the end of its road: along its bus or combi route, else mostly straight on, sometimes a
// turn, keeping to the bigger roads
import { ROUTE_PULL, roadClass } from '../traffic-demand.ts';
import type { OnEdge, TrafficMove, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';

// The lane nearest to `lane` that move m can be made from (m.out[i] is the lane lane i leads to, or -1)
function nearestLane(m: TrafficMove, lane: number): number {
  let best = -1;
  for (let i = 0; i < m.out.length; i++) {
    if (m.out[i] >= 0 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
  }
  return best;
}

// Buses & combis on a route take the move that runs on along it (transit.ts pickMove); one that has strayed from it
// (its lane can't make the turn, the route runs where the road graph has no road) drives on like the rest while it
// looks further ahead for it, and gives it up after a few moves.
let laneOf: Vehicle | null = null;
const laneAllows = (m: TrafficMove) => laneOf !== null && m.out[laneOf.lane] >= 0;
function routeMove(ts: TrafficState, v: OnEdge, fromLane: boolean): TrafficMove | null {
  const e = v.edge;
  const path = v.path;
  if (!path) return null;
  laneOf = v;
  const r = ts.transit.pickMove(path, v.pathS, e.moves, fromLane ? laneAllows : null, v.lost * 150);
  if (r.index >= 0) {
    v.nextPathS = r.s;
    v.lost = 0;
    return e.moves[r.index];
  }
  v.nextPathS = v.pathS;
  if (++v.lost > 6) v.path = null;
  return null;
}

// Mostly straight on, sometimes a turn (buses off their routes keep to wide roads). Routes don't follow the camera;
// distant vehicles are recycled instead. With `fromLane`, only moves the current lane allows.
const weights: number[] = [];
function chooseMove(ts: TrafficState, v: OnEdge, fromLane: boolean): TrafficMove {
  const e = v.edge;
  if (v.path) {
    const m = routeMove(ts, v, fromLane);
    if (m) return m;
  }
  let total = 0;
  for (let k = 0; k < e.moves.length; k++) {
    const m = e.moves[k];
    let w = m.turn === 'S' ? (v.bus ? 8 : 3) : 1;
    if (v.bus && m.turn !== 'S' && m.to.lanes.length < 2) w *= 0.05;
    // drivers keep to the bigger roads: off an avenue into a colonia's street now and then, onto one readily
    w *= ROUTE_PULL[(m.to.roadClass ??= roadClass(m.to))] / ROUTE_PULL[(e.roadClass ??= roadClass(e))];
    if (fromLane) {
      if (m.out[v.lane] < 0) w = 0;
    } else if (Math.abs(nearestLane(m, v.lane) - v.lane) * 22 > e.len - v.s) {
      w *= 0.02; // too little road left to change lanes for it
    }
    weights[k] = w;
    total += w;
  }
  let r = Math.random() * total;
  let pick: TrafficMove | null = null;
  for (let k = 0; k < e.moves.length; k++) {
    if (weights[k] <= 0) continue;
    pick = e.moves[k];
    r -= weights[k];
    if (r < 0) break;
  }
  // No move from this lane (a lane the road graph couldn't lead anywhere): take any move, changing lanes for it
  if (!pick && fromLane) return chooseMove(ts, v, false);
  // (an edge always has a move: road-network.ts keeps only the road graph's largest connected part)
  return pick ?? e.moves[0];
}

export { nearestLane, chooseMove };
