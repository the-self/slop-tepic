// js/sim/traffic/idm.ts
// How drivers follow: the Intelligent Driver Model's acceleration and braking for the vehicle (or the player) ahead, and
// how fast a bend can be taken
import type { LaneCurve } from '../../world/road-network.ts';
import { LOOKAHEAD } from './constants.ts';
import type { LaneEntry, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { ahead } from './occupancy.ts';

// Where the player is relative to v: metres ahead, metres to the right, how fast it moves v's way (negative: at v)
// and across, and how big it is. A vehicle the player left standing in the road (main.ts: setParked) counts instead
// when it is nearer ahead in v's own lane
function relateToPlayer(ts: TrafficState, v: Vehicle): void {
  v.pAhead = Infinity;
  v.pParked = false;
  const fx = Math.sin(v.yaw);
  const fz = Math.cos(v.yaw);
  if (ts.player.active) {
    const dx = ts.player.x - v.x;
    const dz = ts.player.z - v.z;
    if (Math.abs(dx) <= LOOKAHEAD + 10 && Math.abs(dz) <= LOOKAHEAD + 10) {
      v.pAhead = dx * fx + dz * fz;
      v.pRight = dz * fx - dx * fz;
      v.pSpeed = ts.player.vx * fx + ts.player.vz * fz;
      v.pSide = ts.player.vz * fx - ts.player.vx * fz;
      v.pHalfW = ts.player.halfW;
      v.pHalfL = ts.player.halfL;
    }
  }
  for (const o of ts.parked) {
    const dx = o.x - v.x;
    const dz = o.z - v.z;
    if (Math.abs(dx) > LOOKAHEAD + 10 || Math.abs(dz) > LOOKAHEAD + 10) continue;
    const ahead = dx * fx + dz * fz;
    const right = dz * fx - dx * fz;
    if (ahead < 0 || Math.abs(right) > v.halfWidth + o.halfW + 0.4) continue;
    if (v.pAhead >= 0 && v.pAhead < ahead && Math.abs(v.pRight) <= v.halfWidth + v.pHalfW + 0.4) continue;
    v.pAhead = ahead;
    v.pRight = right;
    v.pSpeed = v.pSide = 0;
    v.pHalfW = o.halfW;
    v.pHalfL = o.halfL;
    v.pParked = true;
  }
}

// Gap to the player if it is ahead in the lane whose centre is `off` metres to the right of v. Not when it is
// alongside rather than ahead (passing v or squeezing by: no driver stops for that, and touching is collisions.ts's),
// nor when it is crossing v's way and will be out of it before v gets there (looked at no more than 1.5 s on: one
// changing lanes into v's stops moving sideways once in it)
function playerGap(v: Vehicle, off: number): number {
  if (v.pAhead < 0 || v.pAhead > LOOKAHEAD) return Infinity;
  const clear = v.halfWidth + v.pHalfW + (v.pParked ? 0.4 : 0.25);
  const across = v.pRight - off;
  if (Math.abs(across) > clear) return Infinity;
  const gap = v.pAhead - v.half - v.pHalfL;
  if (v.pParked) return gap;
  if (gap < -0.5) return Infinity;
  if (Math.abs(v.pSide) > 1.5) {
    const t = Math.min(1.5, Math.max(gap, 0) / Math.max(v.speed - v.pSpeed, 0.5));
    if (Math.abs(across + v.pSide * t) > clear + 0.8) return Infinity;
  }
  return gap;
}

// Intelligent Driver Model: acceleration on a free road, and the braking term for an obstacle `gap` metres
// (bumper to bumper) ahead moving at `speed`
const freeAcc = (ts: TrafficState, v: Vehicle) => v.driver.a * (1 - (v.speed / (v.v0 * ts.caution)) ** 4);
function brake(ts: TrafficState, v: Vehicle, gap: number, speed: number, s0 = v.driver.s0, T = v.driver.T): number {
  const { a, b } = v.driver;
  const desired = s0 + Math.max(0, v.speed * T * ts.headway + (v.speed * (v.speed - speed)) / (2 * Math.sqrt(a * b)));
  return -a * (desired / Math.max(gap, 0.1)) ** 2;
}
// ...and for a line d metres ahead to stop s0 short of: no time gap to keep to a line
const stopAt = (ts: TrafficState, v: Vehicle, d: number, s0 = 1) => brake(ts, v, d, 0, s0, 0);

// Braking for the vehicle ahead of position s in a lane list; remembers the nearest one
function follow(ts: TrafficState, v: Vehicle, list: readonly LaneEntry[], s: number): number {
  const o = ahead(list, s, v);
  if (!o) return 0;
  const gap = o.s - o.v.half - s - v.half;
  if (gap > LOOKAHEAD) return 0;
  if (gap < v.gap) {
    v.gap = gap;
    v.leaderSpeed = o.v.speed;
  }
  return brake(ts, v, gap, o.v.speed);
}

// Can v, d metres before a line, still stop at it braking no harder than its driver comfortably does?
const canStopBefore = (ts: TrafficState, v: Vehicle, d: number) => freeAcc(ts, v) + stopAt(ts, v, d) > -v.driver.b;

// Seconds v takes to cover dist metres from now, speeding up from rest if it has to
const timeTo = (v: Vehicle, dist: number) => dist / Math.max(v.speed, Math.sqrt((v.driver.a * dist) / 2), 0.1);

// Fastest v can take curve c at without exceeding the sideways acceleration its driver accepts
const bendSpeed = (ts: TrafficState, v: Vehicle, c: LaneCurve) => Math.sqrt(v.driver.aLat * ts.roadGrip / Math.max(c.curv, 1e-3));

export { relateToPlayer, playerGap, freeAcc, brake, stopAt, follow, canStopBefore, timeTo, bendSpeed };
