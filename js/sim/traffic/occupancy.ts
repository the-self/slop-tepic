// js/sim/traffic/occupancy.ts
// Who is where: the vehicles in each lane (pooled entries sorted by position, rebuilt every frame) and the
// intersections and crosswalks they hold
import { onRoad } from './constants.ts';
import type { DrivenVehicle, LaneEntry, TrafficEdge, TrafficNode, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';

// Sides of an intersection (road-network.ts step 9): a grid intersection's are 0 east, 1 west, 2 south, 3 north;
// centreline junctions number their arms from 4. Where lane i of edge e meets a crosswalk, measured along the
// crosswalk: along its road's lateral axis (x across north-south roads, z across east-west ones)
const laneCoord = (e: TrafficEdge, i: number) => (e.sx + e.rx * e.lanes[i]) * e.clx + (e.sz + e.rz * e.lanes[i]) * e.clz;

// Is the intersection box held by vehicles of any road but group g's?
const boxBusy = (n: TrafficNode, g: number) => {
  for (let k = 0; k < n.box.length; k++) if (k !== g && n.box[k] > 0) return true;
  return false;
};

// Lane lists hold pooled { v, s } entries sorted by position s along the lane, rebuilt every frame
function occupy(ts: TrafficState, list: LaneEntry[], v: DrivenVehicle, s: number): void {
  let o = ts.pool[ts.poolUsed++] as LaneEntry | undefined;
  if (!o) ts.pool.push((o = { v, s: 0 }));
  o.v = v;
  o.s = s;
  if (!list.length) ts.filled.push(list);
  list.push(o);
  for (let k = list.length - 1; k > 0 && list[k - 1].s > s; k--) {
    list[k] = list[k - 1];
    list[k - 1] = o;
  }
}

// Half way through a lane change a vehicle still occupies the lane it is leaving (-1 left, 1 right)
function straddle(v: DrivenVehicle): number {
  if (v.conn) return 0;
  if (v.dl > 0.5 && v.lane + 1 < v.edge.lanes.length) return 1;
  if (v.dl < -0.5 && v.lane > 0) return -1;
  return 0;
}

// A vehicle crossing an intersection, or committed to crossing it, holds it against crossing traffic and
// pedestrians on the crosswalks it passes, and its place in the lane it heads for. The counters it raises are reset
// next frame for just the nodes and edges touched (a few hundred out of thousands)
const touchNode = (ts: TrafficState, n: TrafficNode) => {
  if (!n.touched) {
    n.touched = true;
    ts.touchedNodes.push(n);
  }
  return n;
};
const touchEdge = (ts: TrafficState, e: TrafficEdge) => {
  if (!e.touched) {
    e.touched = true;
    ts.touchedEdges.push(e);
  }
  return e;
};
function claim(ts: TrafficState, v: DrivenVehicle): void {
  if (v.claimed) return;
  v.claimed = true;
  const e = v.edge;
  const f = v.move.to;
  touchNode(ts, e.to).box[e.axisIndex]++;
  if (!v.conn || v.cs < v.half + 2.5) e.to.crossing[e.inSide]++; // until its tail is past the crosswalk on its way in
  if (v.move.turn !== 'L') touchEdge(ts, e).through++;
  if (!v.yielding) cross(ts, v);
  occupy(ts, f.occ[v.out], v, v.conn ? v.cs - v.conn.len : v.s - e.len - ts.connector(e, v.lane, f, v.out).len);
}

// ...and, unless still waiting inside to turn left, the oncoming lanes and the crosswalk on its way out
function cross(ts: TrafficState, v: DrivenVehicle): void {
  const e = v.edge;
  if (v.move.turn === 'L') touchEdge(ts, e).lefts++;
  touchNode(ts, e.to).crossing[v.move.to.outSide]++;
  v.yielding = false;
}

function buildOccupancy(ts: TrafficState): void {
  for (const list of ts.filled) list.length = 0;
  ts.filled.length = 0;
  ts.poolUsed = 0;
  for (const n of ts.touchedNodes) {
    n.box.fill(0);
    n.crossing.fill(0);
    n.touched = false;
  }
  ts.touchedNodes.length = 0;
  for (const e of ts.touchedEdges) {
    e.through = e.lefts = 0;
    e.touched = false;
  }
  ts.touchedEdges.length = 0;
  for (const v of ts.vehicles) v.claimed = false;
  for (const v of ts.vehicles) {
    if (!onRoad(v)) continue;
    const e = v.edge;
    if (!v.conn) {
      occupy(ts, e.occ[v.lane], v, v.s);
      const side = straddle(v);
      if (side) occupy(ts, e.occ[v.lane + side], v, v.s);
      if (v.commit === e.to) claim(ts, v);
      if (v.s < v.half) touchNode(ts, e.from).crossing[e.outSide]++; // its tail still over the crosswalk behind it
    } else {
      claim(ts, v);
      occupy(ts, e.occ[v.lane], v, e.len + v.cs); // until it is out of the intersection, still ahead of those behind it
    }
  }
}

// First vehicle ahead of position s in a lane list
function ahead(list: readonly LaneEntry[], s: number, v: Vehicle): LaneEntry | null {
  for (const o of list) if (o.s > s && o.v !== v) return o;
  return null;
}

// The front-most vehicle still approaching the end of a lane: not crossing at its end yet, though maybe still coming
// out of the intersection at its start (at s < 0)
function leadOf(list: readonly LaneEntry[]): LaneEntry | null {
  for (let k = list.length - 1; k >= 0; k--) if (!list[k].v.conn || list[k].s < 0) return list[k];
  return null;
}

// Room at s in a lane list: margin metres to the vehicles either side, and two seconds more for the one behind
function laneClear(list: readonly LaneEntry[], s: number, margin: number): boolean {
  for (const o of list) if (Math.abs(o.s - s) < o.v.half + margin + (o.s < s ? 2 * o.v.speed : 0)) return false;
  return true;
}

export { laneCoord, boxBusy, occupy, straddle, claim, cross, buildOccupancy, ahead, leadOf, laneClear };
