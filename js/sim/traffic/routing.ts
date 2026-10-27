// js/sim/traffic/routing.ts
// Which way a vehicle goes at the end of its road: along its bus or combi route, else mostly straight on, sometimes a
// turn, keeping to the bigger roads (a cyclist to the streets)
import { AVENUE, ROUTE_PULL, roadClass } from '../traffic-demand.ts';
import type { OnEdge, TrafficEdge, TrafficMove, Vehicle } from './types.ts';
import type { Transit, TransitPath } from '../transit.ts';
import type { TrafficState } from './state.ts';

// The lane nearest to `lane` that move m can be made from (m.out[i] is the lane lane i leads to, or -1)
function nearestLane(m: TrafficMove, lane: number): number {
  let best = -1;
  for (let i = 0; i < m.out.length; i++) {
    if (m.out[i] >= 0 && (best < 0 || Math.abs(i - lane) < Math.abs(best - lane))) best = i;
  }
  return best;
}

// The way back onto a route where no move runs on along it (a turn the road network doesn't make, a stretch the route
// drives where the network has no road, a lane that can't make the turn): the shortest drive from road e, its first
// move one `ok` allows, to a road on path p ahead of cursor s, found over the network (Dijkstra, as far as
// DETOUR_REACH; a road off the line of the route counts DETOUR_OFF times its length, so the way back keeps to the
// route's own streets where the network has them a few metres off it, and a one-lane one off it DETOUR_NARROW times
// more, as buses keep out of the colonias' narrow streets). Each road it reaches on p scores its distance
// driven plus the route it would skip or go back over (|ahead - driven|), so the detour rejoins where the route went
// on, not a stretch further. Writes the roads into `out` (from the first move's to the road on p) and returns where
// that last one ends on p, or -1 when none is in reach.
const DETOUR_REACH = 2500; // m: far enough to turn round where the route makes a U-turn the network doesn't
const DETOUR_TURN = 15; // m a turn costs: of two ways round, the one going straight on
const DETOUR_OFF = 3;
const DETOUR_NARROW = 2;
const DETOUR_NEAR = 10; // m: a road whose middle is this close to the route's line is on it
// by edge id: the cheapest drive to the end of it found (its cost, and its length in m), the edge it is reached from
// (null: a first move), and the search that found it (stale entries from earlier searches need no clearing); and
// whether its middle is off the route's line, and the search that found that
let dist = new Float64Array(0);
let metres = new Float64Array(0);
let seen = new Int32Array(0);
let offLine = new Uint8Array(0);
let offSeen = new Int32Array(0);
const prev: (TrafficEdge | null)[] = [];
let search = 0;
const heapEdge: TrafficEdge[] = [];
const heapDist: number[] = [];
let popped = 0; // the distance heapPop's edge was pushed with
function heapPush(e: TrafficEdge, d: number): void {
  let i = heapEdge.length;
  heapEdge.push(e);
  heapDist.push(d);
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (heapDist[up] <= d) break;
    heapEdge[i] = heapEdge[up];
    heapDist[i] = heapDist[up];
    i = up;
  }
  heapEdge[i] = e;
  heapDist[i] = d;
}
function heapPop(): TrafficEdge | undefined {
  const top = heapEdge[0];
  popped = heapDist[0];
  const e = heapEdge.pop();
  const d = heapDist.pop();
  const n = heapEdge.length;
  if (n === 0 || !e || d === undefined) return top;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && heapDist[c + 1] < heapDist[c]) c++;
    if (heapDist[c] >= d) break;
    heapEdge[i] = heapEdge[c];
    heapDist[i] = heapDist[c];
    i = c;
  }
  heapEdge[i] = e;
  heapDist[i] = d;
  return top;
}
// The arrays by edge id, grown to hold edge `id` (mid-search: keeping what it has found)
function holds(id: number): void {
  if (id < dist.length) return;
  const n = Math.max(id + 1, 2 * dist.length);
  const d0 = dist, m0 = metres, s0 = seen, o0 = offLine, os0 = offSeen;
  dist = new Float64Array(n);
  metres = new Float64Array(n);
  seen = new Int32Array(n);
  offLine = new Uint8Array(n);
  offSeen = new Int32Array(n);
  dist.set(d0);
  metres.set(m0);
  seen.set(s0);
  offLine.set(o0);
  offSeen.set(os0);
}
// f reached at cost d, m metres on, from edge `at`: kept if no cheaper way to it is known yet
function relax(f: TrafficEdge, d: number, m: number, at: TrafficEdge | null): void {
  holds(f.id);
  if (seen[f.id] === search && dist[f.id] <= d) return;
  seen[f.id] = search;
  dist[f.id] = d;
  metres[f.id] = m;
  prev[f.id] = at;
  heapPush(f, d);
}
// m: what taking move m costs a detour along p
function detourCost(transit: Transit, p: TransitPath, m: TrafficMove): number {
  const f = m.to;
  holds(f.id);
  if (offSeen[f.id] !== search) {
    offSeen[f.id] = search;
    offLine[f.id] = transit.offPath(p, f.sx + f.dx * f.len * 0.5, f.sz + f.dz * f.len * 0.5) > DETOUR_NEAR ? 1 : 0;
  }
  const off = offLine[f.id] === 1;
  return f.len * (off ? DETOUR_OFF * (f.lanes.length < 2 ? DETOUR_NARROW : 1) : 1) + (m.turn === 'S' ? 0 : DETOUR_TURN);
}
function detourTo(transit: Transit, e: TrafficEdge, p: TransitPath, s: number, ok: ((m: TrafficMove) => boolean) | null, out: TrafficEdge[]): number {
  search++;
  heapEdge.length = heapDist.length = 0;
  for (const m of e.moves) if (!ok || ok(m)) relax(m.to, detourCost(transit, p, m), m.to.len, null);
  let best: TrafficEdge | null = null;
  let bestScore = Infinity;
  let bestS = -1;
  for (let f = heapPop(); f; f = heapPop()) {
    const d = popped;
    if (d > dist[f.id]) continue; // (reached shorter since it was pushed)
    if (d >= bestScore || d > DETOUR_REACH * DETOUR_OFF) break;
    const driven = metres[f.id];
    if (f.transit) {
      for (const on of f.transit) {
        if (on.path !== p) continue;
        let ahead = on.s - s;
        if (p.loop) ahead = ((ahead % p.len) + p.len) % p.len;
        if (ahead < 2 || ahead > DETOUR_REACH) continue;
        const score = d + Math.abs(ahead - driven);
        if (score < bestScore) {
          bestScore = score;
          best = f;
          bestS = on.s;
        }
      }
    }
    if (driven < DETOUR_REACH) for (const m of f.moves) relax(m.to, d + detourCost(transit, p, m), driven + m.to.len, f);
  }
  out.length = 0;
  if (!best) return -1;
  // the roads from the first move's to best, by the edge each was reached from
  for (let f: TrafficEdge | null = best; f; f = prev[f.id] ?? null) out.push(f);
  out.reverse();
  return bestS;
}

// Buses & combis on a route take the move that runs on along it (transit.ts pickMove); where none does, the way back
// onto it (detourTo), road by road. One that can't find its way (the route runs out of the network's reach) drives on
// like the rest while it looks further ahead for it, and gives it up after a few moves (searching for a way back once:
// a search that finds none has gone over thousands of roads, too many to go over again at every junction).
let laneOf: Vehicle | null = null;
const laneAllows = (m: TrafficMove) => laneOf !== null && m.out[laneOf.lane] >= 0;
function routeMove(ts: TrafficState, v: OnEdge, fromLane: boolean): TrafficMove | null {
  const e = v.edge;
  const path = v.path;
  if (!path) return null;
  laneOf = v;
  const ok = fromLane ? laneAllows : null;
  // choosing again before it has left e (mayEnter: its lane can't make the move it chose): that move's road is still
  // the detour's next
  if (v.detourAt > 0 && v.move && v.move.to !== e && v.move.to === v.detour[v.detourAt - 1]) v.detourAt--;
  if (v.detourAt < v.detour.length) {
    const next = v.detour[v.detourAt];
    for (const m of e.moves) {
      if (m.to !== next || (ok && !ok(m))) continue;
      v.nextPathS = ++v.detourAt < v.detour.length ? v.pathS : v.detourS; // (the last: back on the route)
      return m;
    }
    v.detour.length = v.detourAt = 0; // (its lane can't make the detour's turn: another way back)
  }
  const r = ts.transit.pickMove(path, v.pathS, e.moves, ok, v.lost * 150);
  if (r.index >= 0) {
    v.nextPathS = r.s;
    v.lost = 0;
    return e.moves[r.index];
  }
  const back = v.lost > 0 ? -1 : detourTo(ts.transit, e, path, v.pathS, ok, v.detour);
  if (back >= 0) {
    v.detourS = back;
    v.detourAt = 0;
    v.lost = 0;
    return routeMove(ts, v, fromLane);
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
    // drivers keep to the bigger roads: off an avenue into a colonia's street now and then, onto one readily; a
    // cyclist turns onto an avenue only where the street gives it no other way
    const to = (m.to.roadClass ??= roadClass(m.to));
    if (v.bike) w *= to === AVENUE ? 0.01 : 1;
    else w *= ROUTE_PULL[to] / ROUTE_PULL[(e.roadClass ??= roadClass(e))];
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
  // No move from this lane (a lane the road graph couldn't lead anywhere): take any move, changing lanes for it; nor
  // one for a cyclist off the avenues, while the junction has one
  if (!pick && fromLane) return chooseMove(ts, v, false);
  if (fromLane && v.bike && pick?.to.roadClass === AVENUE && e.moves.some((m) => m.to.roadClass !== AVENUE)) return chooseMove(ts, v, false);
  // (an edge always has a move: road-network.ts keeps only the road graph's largest connected part)
  return pick ?? e.moves[0];
}

export { nearestLane, chooseMove };
