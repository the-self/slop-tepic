// js/sim/traffic/pickups.ts
// Camiones, combis and taxis at the curb. Where OpenStreetMap maps the paradas (world/bus-stops.ts), a camión or
// combi on its route pulls in at them, for whoever waits there and whoever gets off; elsewhere in Tepic they stop
// wherever someone on the sidewalk hails them: the vehicle works over to the curb lane, pulls in beside them and
// stands while they step to its door and get on (and others get off), then pulls out again. A taxi takes its fare a
// while and lets them off at a curb, anywhere.
import { STOP_CELL, clamp } from './constants.ts';
import type { DrivenVehicle, Ped, PedTrack, TrafficEdge, Vehicle } from './types.ts';
import type { BusStop } from '../../world/bus-stops.ts';
import type { TrafficState } from './state.ts';
import { canStopBefore, stopAt } from './idm.ts';
import { retirePed } from './population.ts';

const LOOK = 1.5; // s between a vehicle's looks along the curb ahead
const STEP = 1.3; // m/s stepping to the door and off it
const PULL_IN = 35; // m before its stop it starts pulling over
const GIVE_UP = 25; // s a vehicle stands for someone who doesn't come
const STOP_COVER = 250; // m from a mapped stop within which a camión or combi stops at the stops only
const AT_STOP = 7; // m from a stop someone waiting there hails from
const LET_OFF = 0.4; // the share of stops a camión or combi lets someone off at

// The nearest bus stop to (x, z) within `reach` m, or null
function stopNear(ts: TrafficState, x: number, z: number, reach: number): BusStop<TrafficEdge> | null {
  let best: BusStop<TrafficEdge> | null = null, bestD = reach;
  const n = Math.ceil(reach / STOP_CELL);
  const ci = Math.floor(x / STOP_CELL), cj = Math.floor(z / STOP_CELL);
  for (let i = ci - n; i <= ci + n; i++) {
    for (let j = cj - n; j <= cj + n; j++) {
      for (const st of ts.stopCells.get(i * 100003 + j) ?? []) {
        const d = Math.hypot(st.x - x, st.z - z);
        if (d < bestD) { bestD = d; best = st; }
      }
    }
  }
  return best;
}

// Does v take people on? The camiones and combis on their routes, and the taxis
const serves = (v: DrivenVehicle) => v.fleet !== null || v.isTaxi === true;

// Its door, m ahead of its centre: a camión's front door, a combi's sliding door behind the front seats, a taxi's
// rear one
const doorOf = (v: DrivenVehicle) => (v.bus ? v.half - 1.3 : v.fleet === 'combi' ? 0.1 : -0.4);

// Would p hail v? Each person wants some routes and not others (a salt of v's own: its driver's reaction time), and
// a taxi seldom
const wants = (p: Ped, v: DrivenVehicle) => (p.wish * 9.7 + v.react * 31.3) % 1 < (v.isTaxi ? 0.06 : 0.2);

// m to the right of its lane centre v pulls in to, its wheels a hand off the curb
const curbRoom = (v: DrivenVehicle) => clamp(v.edge.half - v.edge.lanes[v.lane] - v.halfWidth - 0.35, 0, 2.4);

// Where v stops for p: its door level with them, m along its road
const stopFor = (v: DrivenVehicle, p: Ped, door: number) => (p.x - v.edge.sx) * v.edge.dx + (p.z - v.edge.sz) * v.edge.dz - door;

// Can p hail v? Out on its own, standing or walking along a sidewalk, and wanting it
const free = (p: Ped, v: DrivenVehicle) => p.placed && !p.fallen && !p.bail && !p.ride && !p.node && !p.cross && !p.conversation && wants(p, v);

// Someone waiting at stop st for v: the nearest that wants it
function waitingAt(ts: TrafficState, v: DrivenVehicle, st: BusStop<TrafficEdge>): Ped | null {
  let best: Ped | null = null, bestD = AT_STOP;
  for (const p of ts.peds) {
    if (!free(p, v)) continue;
    const d = Math.hypot(p.x - st.x, p.z - st.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Someone on the curb ahead of v, on its right, hailing it: the nearest that wants it, far enough ahead to pull in
// for and short of the end of the road
function hailer(ts: TrafficState, v: DrivenVehicle, door: number): Ped | null {
  const e = v.edge;
  const far = Math.min(v.s + 70, e.len - v.half - 8);
  let best: Ped | null = null, bestS = Infinity;
  for (const p of ts.peds) {
    if (!free(p, v)) continue;
    const right = (p.x - e.sx) * e.rx + (p.z - e.sz) * e.rz;
    if (right < e.half - 0.3 || right > e.half + 5) continue;
    const s = stopFor(v, p, door);
    if (s < v.s + 15 || s > far || s > bestS) continue;
    best = p;
    bestS = s;
  }
  return best;
}

// The curb side of v's door (m), a step out from its body, into `doorAt` (reused)
const doorAt = { x: 0, z: 0 };
function doorPoint(v: Vehicle, door: number): typeof doorAt {
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  doorAt.x = v.x + fx * door - fz * (v.halfWidth + 0.15);
  doorAt.z = v.z + fz * door + fx * (v.halfWidth + 0.15);
  return doorAt;
}

// v pulls in at s along its road, for p to get on (or none), and `off` to get off
function plan(ts: TrafficState, v: DrivenVehicle, p: Ped | null, off: number, door: number, s: number): void {
  if (!canStopBefore(ts, v, s - v.s)) return;
  const dwell = v.bus ? 4 + Math.random() * 3 : v.fleet === 'combi' ? 2.5 + Math.random() * 2.5 : 2 + Math.random() * 1.5;
  v.stop = { edge: v.edge, s, door, ped: p, boarded: false, off, stopped: false, t: 0, dwell, next: 0.6 };
  if (p) {
    p.ride = { v, phase: 'wait', x: v.x, z: v.z };
    p.v = 0;
  }
}

// Every LOOK s, a vehicle that takes people on and isn't stopping yet looks along the curb ahead: for someone
// hailing it (from the curb lane or the one beside it: over two lanes, a driver lets them be), or, already in the
// curb lane, for a spot to let someone off (a camión or combi now and then, a taxi once its fare is up)
function look(ts: TrafficState, v: DrivenVehicle): void {
  if (ts.clock < v.nextStop) return;
  v.nextStop = ts.clock + LOOK;
  const e = v.edge;
  const last = e.lanes.length - 1;
  if (v.conn || v.wrecked || v.isPolice || v.lane < last - 1 || v.move.out[last] < 0) return; // (its turn ahead isn't from the curb lane)
  const door = doorOf(v);
  const dropAt = v.lane === last ? v.s + 25 + Math.random() * 20 : Infinity;
  if (v.isTaxi && v.fare > 0) {
    if (ts.clock >= v.fare && dropAt < e.len - v.half - 8) plan(ts, v, null, 1, door, dropAt);
    return;
  }
  if (v.fleet !== null) {
    // a camión or combi on its route: at the next stop ahead on its road, if anyone waits there for it or is to get
    // off there (whether they are, the same for this vehicle at this stop each time it looks); and in a part of town
    // whose stops are mapped, nowhere else
    for (const st of e.stops) {
      const s = st.s - door;
      if (s < v.s + 15) continue;
      if (s > e.len - v.half - 8) break;
      const p = waitingAt(ts, v, st);
      const off = (v.react * 97.13 + st.x * 0.37 + st.z * 0.11) % 1 < LET_OFF ? 1 + Math.floor(Math.random() * 2) : 0;
      if (p || off) plan(ts, v, p, off, door, s);
      return;
    }
    if (stopNear(ts, v.x, v.z, STOP_COVER)) return;
  }
  const p = hailer(ts, v, door);
  if (p) {
    plan(ts, v, p, !v.isTaxi && Math.random() < 0.35 ? 1 + Math.floor(Math.random() * 2) : 0, door, stopFor(v, p, door));
  } else if (!v.isTaxi && Math.random() < 0.03 && dropAt < e.len - v.half - 8) {
    plan(ts, v, null, 1 + Math.floor(Math.random() * 2), door, dropAt);
  }
}

// Done at the curb (or giving it up): whoever was waiting walks on, and a taxi that took someone on has a fare
function leave(ts: TrafficState, v: DrivenVehicle, done: boolean): void {
  const st = v.stop;
  if (!st) return;
  if (st.ped?.ride?.v === v) st.ped.ride = null;
  v.stop = null;
  v.nextStop = ts.clock + (v.isTaxi ? 4 : 15 + Math.random() * 30);
  if (v.isTaxi && done) v.fare = st.boarded ? ts.clock + 40 + Math.random() * 80 : 0;
}

// Someone getting off v at its door, onto the nearest sidewalk track of its road (from the pool of those not out):
// they step up onto it and walk on from there
function alight(ts: TrafficState, v: DrivenVehicle, door: number): void {
  const q = ts.peds.find((p) => !p.placed);
  if (!q) return;
  const { x, z } = doorPoint(v, door);
  let best: PedTrack | null = null, bestD = 3.5, bestT = 0;
  for (const track of ts.pedRoutes.along(v.edge)) {
    const t = clamp((x - track.ax) * track.ux + (z - track.az) * track.uz, 0, track.len);
    const d = Math.hypot(track.ax + track.ux * t - x, track.az + track.uz * t - z);
    if (d < bestD) {
      best = track;
      bestD = d;
      bestT = t;
    }
  }
  if (!best) return;
  Object.assign(q, best);
  q.route = best;
  q.t = bestT;
  q.dir = Math.random() < 0.5 ? 1 : -1;
  q.x = x;
  q.z = z;
  q.v = q.pause = 0;
  q.nextRoute = null;
  q.nextLeg = 0;
  q.goalTime = 0;
  q.restTime = ts.clock + 25 + Math.random() * 45;
  q.socialTime = ts.clock + 5 + Math.random() * 15;
  q.wish = Math.random();
  q.ride = { v, phase: 'off', x: best.ax + best.ux * bestT, z: best.az + best.uz * bestT };
  q.rig.placed = false; // (stands afresh at the door)
  q.placed = true;
}

// v's part, every frame before it accelerates: looking for someone, working over to the curb and pulling in, standing
// there while they get on and off, and pulling out again
function curbside(ts: TrafficState, v: DrivenVehicle, dt: number): void {
  v.pullOver = 0;
  if (!serves(v)) return;
  const st = v.stop;
  if (!st) {
    look(ts, v);
    return;
  }
  const last = v.edge.lanes.length - 1;
  // (its road left behind, its engine dead, or whoever hailed it not coming: knocked down, run off, gone home)
  const p = st.ped;
  if (v.edge !== st.edge || v.conn || v.wrecked || (p && (p.ride?.v !== v || !p.placed || p.fallen || p.bail))) {
    leave(ts, v, false);
    return;
  }
  const d = st.s - v.s;
  if (!st.stopped) {
    // (not in the curb lane in time, or past the spot: on to the next)
    if (v.lane !== last ? d < 10 : d < -1.5) {
      leave(ts, v, false);
      return;
    }
    if (v.lane === last && d < PULL_IN) v.pullOver = curbRoom(v);
    if (v.lane === last && d < 1.2 && v.speed < 0.3) st.stopped = true;
    return;
  }
  v.pullOver = curbRoom(v);
  st.t += dt;
  if (p?.ride?.phase === 'wait' && Math.abs(v.dl - v.pullOver) < 0.3) p.ride.phase = 'board';
  if (st.off > 0 && st.t >= st.next) {
    alight(ts, v, st.door);
    st.off--;
    st.next = st.t + 1.4;
  }
  if ((st.t >= st.dwell && st.off === 0 && !st.ped) || st.t > GIVE_UP) leave(ts, v, true);
}

// The braking for its stop: up to the spot once in the curb lane, and standing there
function curbBrake(ts: TrafficState, v: DrivenVehicle): number {
  const st = v.stop;
  if (!st || v.conn || v.lane !== v.edge.lanes.length - 1) return 0;
  if (st.stopped) return -9;
  return stopAt(ts, v, Math.max(st.s - v.s, 0.05), 0.3);
}

// Someone's part, every frame instead of walking: standing for it (facing it), stepping to its door once it stands
// there and getting in (off the street: the pool's again), or stepping off it up onto the sidewalk. False once they
// got in
function rideStep(ts: TrafficState, p: Ped, dt: number): boolean {
  const r = p.ride;
  if (!r) return true;
  const v = r.v;
  if (r.phase !== 'off') {
    const st = v.stop;
    if (!v.edge || st?.ped !== p) {
      p.ride = null; // (it didn't stop after all)
      return true;
    }
    if (r.phase === 'wait') {
      r.x = v.x;
      r.z = v.z;
      return true;
    }
    const at = doorPoint(v, st.door);
    r.x = at.x;
    r.z = at.z;
  }
  const dx = r.x - p.x, dz = r.z - p.z;
  const d = Math.hypot(dx, dz);
  const step = STEP * dt;
  if (d > step) {
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return true;
  }
  p.x = r.x;
  p.z = r.z;
  if (r.phase === 'off') {
    p.ride = null; // (on its track: walks on)
    return true;
  }
  const st = v.stop;
  if (st) {
    st.ped = null;
    st.boarded = true;
  }
  retirePed(ts, p);
  return false;
}

export { curbside, curbBrake, rideStep, stopNear };
