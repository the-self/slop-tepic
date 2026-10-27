// js/sim/traffic/right-of-way.ts
// Who gives way to whom at an intersection: oncoming traffic for a left turn, the main road at unsignalized corners,
// people on the crosswalks, room on the far side, vehicles from other lanes headed for the same one
import type { CurvePoint, LaneCurve } from '../../world/road-network.ts';
import type { DrivenVehicle, LaneEntry, OnEdge, TrafficEdge, TrafficNode, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { phaseOf, runsRed } from './signals.ts';
import { laneCoord, leadOf } from './occupancy.ts';
import { canStopBefore, timeTo } from './idm.ts';

// Could the vehicle of lane entry o, approaching the end of edge a, still stop easily before its line? Vehicles
// already standing can; drivers who have been waiting a while accept any gap it can still stop for comfortably.
function canStop(ts: TrafficState, o: LaneEntry, a: TrafficEdge, impatient: boolean): boolean {
  const sp = o.v.speed;
  if (sp < 0.5) return true;
  const d = a.len - o.s - o.v.half;
  return impatient ? canStopBefore(ts, o.v, d) : d > (sp * sp) / 5 + sp + 3;
}

// A left turn waits for oncoming traffic going straight or right (approach o); vehicles not on o yet haven't picked
// their way on, and at a red, only police and those already committed to crossing still come. Waiting at the line, v
// also takes turns with those waiting at theirs: whoever has waited longer goes first, if it has room to go.
function yieldOncoming(ts: TrafficState, o: TrafficEdge | null, impatient: boolean, v: Vehicle | null = null): boolean {
  if (!o) return false;
  if (o.through > 0) return true;
  const red = o.to.signal && phaseOf(ts, o) === 'red';
  for (const list of o.occ) {
    const lead = leadOf(list);
    if (!lead || (lead.v.edge === o && lead.v.move.turn === 'L')) continue;
    if (red && !runsRed(lead.v)) continue;
    if (!canStop(ts, lead, o, impatient)) return true;
    const u = lead.v;
    const j = u.edge === o ? u.move.out[u.lane] : -1;
    if (v && v.wait > 0 && u.wait > v.wait && j >= 0 && o.len - lead.s - u.half < 2 && room(u.move.to, j, u)) return true;
  }
  return false;
}

// How far along curve c, out of two-way edge e, v can pull forward before its front corner reaches the
// oncoming lanes (left of the centre line): where it waits for a gap to turn left
const corner: CurvePoint = { x: 0, z: 0, dx: 0, dz: 1 };
function yieldPoint(ts: TrafficState, v: Vehicle, c: LaneCurve, e: TrafficEdge): number {
  let cs = 0;
  for (; cs < c.len; cs += 0.5) {
    ts.curvePoint(c, cs + v.half, corner);
    const x = corner.x + corner.dz * v.halfWidth;
    const z = corner.z - corner.dx * v.halfWidth;
    if ((x - e.x0) * e.rx + (z - e.z0) * e.rz < 0.3) break;
  }
  return cs - 0.5;
}

// At unsignalized corners, give way to the main road. Police passing a non-green signal yield to approaching
// cross traffic as well as vehicles already in the intersection, instead of treating the light as a clear road.
function yieldToCrossTraffic(ts: TrafficState, v: OnEdge, n: TrafficNode): boolean {
  for (const a of n.in) {
    if (n.signal ? a.axisIndex === v.edge.axisIndex : a.axisIndex !== 0) continue;
    for (const list of a.occ) {
      const lead = leadOf(list);
      if (lead && !canStop(ts, lead, a, !n.signal && v.wait > 8)) return true;
    }
  }
  return false;
}

// Will anyone on crosswalk `side` of n be within reach of the lane meeting it at `coord` between t0 and t1
// seconds from now? Unless `onIt`, so is anyone waiting at the curb to step off, however far away: on the WALK, they
// only wait for the vehicles already holding the crosswalk.
function pedestrianOn(n: TrafficNode, side: number, coord: number, t0: number, t1: number, onIt = false): boolean {
  for (const p of n.walkers) {
    if (p.side !== side || (onIt && p.waiting)) continue;
    const toGo = (coord - p.coord) * p.dir; // metres p still has to walk to get there
    if (p.waiting || ((toGo + 2.6) / p.speed > t0 && (toGo - 2.6) / p.speed < t1)) return true;
  }
  return false;
}

// ...on the crosswalk v leaves the intersection over, while v, its front bumper d metres before it, passes? Once v
// holds that crosswalk (it isn't waiting inside to turn), people at the curb wait for it.
const pedsOut = (v: DrivenVehicle, d: number) => d > 0 && pedestrianOn(v.edge.to, v.move.to.outSide, laneCoord(v.move.to, v.out), timeTo(v, d), timeTo(v, d + 3 + 2 * v.half), !v.yielding);

// Must v, pulled into the intersection to turn, wait there: for people crossing its way out (`peds`) or, turning
// left, for oncoming traffic?
const holdsOn = (ts: TrafficState, v: DrivenVehicle, peds: boolean) => peds || (v.move.turn === 'L' && yieldOncoming(ts, v.edge.opposite, false));

// Of two vehicles on the same road headed for the same lane, the one whose front is nearer the line goes first (by
// the front: a bus waiting at the line goes before the cars that pull up beside it)
const precedence = (u: Vehicle, s: number) => s + u.half;

// Would there be room for v in lane j of edge f if everyone headed there queued bumper to bumper behind its far
// stop line? (An empty lane always has room, however short.) Vehicles take turns for it: whoever has waited longer
// to go there from another side, or goes first from v's own road, counts as already in.
function room(f: TrafficEdge, j: number, v: Vehicle): boolean {
  let free = f.len - 1;
  for (const o of f.occ[j]) if (o.v !== v && o.s - o.v.half < f.len) free -= 2 * o.v.half + o.v.driver.s0;
  for (const a of f.from.in) {
    for (const list of a.occ) {
      const o = leadOf(list);
      if (!o || o.v.claimed || o.v.move.to !== f || o.v.move.out[o.v.lane] !== j) continue;
      if (a === v.edge ? precedence(o.v, o.s) > precedence(v, v.s) : o.v.wait > v.wait) free -= 2 * o.v.half + o.v.driver.s0;
    }
  }
  return free >= Math.min(2 * v.half + 0.5, f.len - 1);
}

// Would v, crossing into lane j of f to arrive at position vs, come alongside another vehicle headed there, cut in
// ahead of one closing in on it, or close in on one ahead in a lane beside (which it doesn't follow)? Turning buses
// swing wide, so where a bus turns, the lanes either side count too, and for one turning beside v from v's road, so
// does how far apart they start turning (the outer one has further to go: side by side on f may be one behind the
// other at the line, and the other way round).
function alongside(f: TrafficEdge, j: number, v: OnEdge, vs: number, turn: boolean): boolean {
  for (let k = Math.max(0, j - 1); k <= Math.min(f.lanes.length - 1, j + 1); k++) {
    for (const o of f.occ[k]) {
      const swing = turn && (v.bus || o.v.bus);
      if (o.v === v || (k !== j && !swing)) continue;
      let lo = o.s - vs; // how far ahead of v o is
      let hi = lo;
      if (swing && o.v.edge === v.edge) {
        const atLine = (o.v.conn ? v.edge.len + o.v.cs : o.v.s) - v.s;
        lo = Math.min(lo, atLine);
        hi = Math.max(hi, atLine);
      }
      const closing = hi < 0 ? o.v.speed - v.speed : lo > 0 && k !== j ? v.speed - o.v.speed : 0;
      const w = o.v.half + v.half + 1 + 2 * Math.max(0, closing);
      if (lo < w && hi > -w) return true;
    }
  }
  return false;
}

// Is a bus at the line in the lane on the outside of v's turn? A bus starting to turn swings its tail out over it.
function besideTail(v: DrivenVehicle): boolean {
  const e = v.edge;
  const k = v.lane + (v.move.turn === 'R' ? -1 : 1);
  const o = v.move.turn !== 'S' && k >= 0 && k < e.lanes.length ? leadOf(e.occ[k]) : null;
  return !!o && o.v.bus && o.v !== v && e.len - o.s - o.v.half < 2;
}

// The lead of another of v's lanes that goes first into lane j of f or, turning where a bus is involved, into a lane
// beside it (turning buses swing wide): v falls in behind it. As an entry { v, s } of f's lane: where it would be on
// f now.
const merger: { v: DrivenVehicle | null; s: number } = { v: null, s: 0 };
function mergingAhead(ts: TrafficState, v: DrivenVehicle, f: TrafficEdge, j: number): LaneEntry | null {
  const e = v.edge;
  merger.v = null;
  for (let i = 0; i < e.lanes.length; i++) {
    const o = i === v.lane ? null : leadOf(e.occ[i]);
    if (!o || o.v === v || o.v.claimed || o.v.move.to !== f || precedence(o.v, o.s) <= precedence(v, v.s)) continue;
    if (o.v.bus && besideTail(o.v)) continue; // it waits for the bus beside its tail
    const oj = o.v.move.out[o.v.lane];
    if (oj < 0 || (oj !== j && !(Math.abs(oj - j) === 1 && v.move.turn !== 'S' && (v.bus || o.v.bus)))) continue;
    const s = o.s - e.len - ts.connector(e, o.v.lane, f, oj).len;
    if (!merger.v || s < merger.s) {
      merger.v = o.v;
      merger.s = s;
    }
  }
  // (an entry once it has a vehicle)
  return merger.v ? (merger as LaneEntry) : null;
}

export {
  canStop, yieldOncoming, yieldPoint, yieldToCrossTraffic, pedestrianOn, pedsOut, holdsOn, room, alongside,
  besideTail, mergingAhead
};
