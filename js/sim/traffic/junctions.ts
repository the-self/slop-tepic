// js/sim/traffic/junctions.ts
// Into and out of an intersection: braking for a signal, whether a vehicle may enter now, and taking the curve through
// it onto the next road
import { LOOKAHEAD } from './constants.ts';
import type { DrivenVehicle, TrafficEdge, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { phaseOf } from './signals.ts';
import { ahead, boxBusy, claim, laneCoord } from './occupancy.ts';
import { canStopBefore, stopAt, timeTo } from './idm.ts';
import { chooseMove } from './routing.ts';
import {
  alongside, besideTail, mergingAhead, pedestrianOn, room, yieldOncoming, yieldPoint, yieldToCrossTraffic
} from './right-of-way.ts';

// Braking for a red (or an amber with room to stop) at the end of edge f, `d` metres ahead
function signalAhead(ts: TrafficState, v: Vehicle, f: TrafficEdge, d: number): number {
  if (v.isPolice || !f.to.signal || d > LOOKAHEAD) return 0;
  const phase = phaseOf(ts, f);
  if (phase === 'green' || (phase === 'amber' && !canStopBefore(ts, v, d))) return 0;
  return stopAt(ts, v, d);
}

// May v, its front bumper d metres before the stop line, enter the intersection now? Sets the exit lane.
// Once too close to stop, v is committed: it goes, and holds the intersection from then on.
function mayEnter(ts: TrafficState, v: DrivenVehicle, d: number): boolean {
  const e = v.edge;
  const n = e.to;
  const phase = n.signal ? phaseOf(ts, e) : 'green';
  // Could it still stop? For a light that isn't green, also by crawling up to it, closer than it stops for lines
  const stoppable = canStopBefore(ts, v, d) || (phase !== 'green' && v.speed * v.speed < 2 * v.driver.b * d);
  if (stoppable) v.commit = null; // could stop after all: decide afresh
  if (v.commit === n) return true;
  if (v.move.out[v.lane] < 0) {
    // missed the lane for the planned move: go wherever this lane goes instead
    if (d > 12) return false;
    v.move = chooseMove(ts, v, true);
  }
  const m = v.move;
  const f = m.to;
  const j = m.out[v.lane];
  if (!(j >= 0 && j < f.lanes.length)) {
    if (!ts.warnedNowhere) {
      ts.warnedNowhere = true;
      console.warn('[traffic] lane leads nowhere', { lane: v.lane, lanes: e.lanes.length, out: m.out.slice(), moves: e.moves.length, x: Math.round(v.x), z: Math.round(v.z) });
    }
    return false;
  }
  if (!v.isPolice && (phase === 'red' || (phase === 'amber' && stoppable))) return false;
  if (boxBusy(n, e.axisIndex)) return false; // crossing traffic inside
  const lead = ahead(e.occ[v.lane], v.s, v);
  if (lead?.v.yielding) return false; // the vehicle ahead waits inside to turn: wait behind the line
  if (v.bus && besideTail(v)) return false; // its tail would swing out over that bus as it starts to turn
  // At a signal, the first in line to turn pulls into the intersection to wait there for the people crossing the
  // road it turns into (they walk on the same green): short of their crosswalk or, turning left across oncoming
  // traffic, short of the oncoming lanes until there is a gap. The light changing stops both for it at the latest.
  const c = ts.connector(e, v.lane, f, j);
  const first = n.signal && (!v.isPolice || phase === 'green') && m.turn !== 'S' && !lead;
  const across = m.turn === 'L' && !!e.opposite;
  const wait = first ? (across ? yieldPoint(ts, v, c, e) : c.len - 3 - v.half) : -1; // < 0: no room inside to wait
  if (m.turn === 'L' ? across && wait < 0 && yieldOncoming(ts, e.opposite, v.wait > 8, v) : e.opposite && e.opposite.lefts > 0) return false;
  if ((n.signal ? v.isPolice && phase !== 'green' : e.axisIndex !== 0) && yieldToCrossTraffic(ts, v, n)) return false;
  // nobody on the crosswalks while it passes over them, on the way in and on the way out, and a free place to
  // clear the intersection to, taking turns with lanes merging into it
  if (pedestrianOn(n, e.inSide, laneCoord(e, v.lane), 0, timeTo(v, d + 2.5 + 2 * v.half))) return false;
  if (wait < 0 && pedestrianOn(n, f.outSide, laneCoord(f, j), timeTo(v, d + c.len - 3), timeTo(v, d + c.len + 2 * v.half))) return false;
  const vs = v.s - e.len - c.len; // where on f it would be now
  if (!room(f, j, v) || alongside(f, j, v, vs, m.turn !== 'S') || mergingAhead(ts, v, f, j)) return false;
  v.out = j;
  v.yielding = wait >= 0;
  v.yieldAt = wait;
  if (!stoppable) {
    v.commit = n;
    claim(ts, v); // at once, so vehicles and pedestrians deciding later this frame know
  }
  return true;
}

// Front bumper at the stop line: cross if allowed, or if going too fast to stop; otherwise wait there
function enter(ts: TrafficState, v: DrivenVehicle): void {
  const e = v.edge;
  if (!mayEnter(ts, v, 0)) {
    const j = v.move.out[v.lane];
    if (v.speed < 4 || j < 0) {
      v.s = e.len - v.half;
      v.speed = 0;
      return;
    }
    v.out = j;
    v.yielding = false;
  }
  v.cs = v.s - e.len;
  v.conn = ts.connector(e, v.lane, v.move.to, v.out);
  claim(ts, v); // at once, so vehicles deciding later this frame know
}

function leave(ts: TrafficState, v: DrivenVehicle): void {
  const conn = v.conn;
  if (!conn) return;
  v.s = v.cs - conn.len;
  v.edge = v.move.to;
  v.lane = v.out;
  v.trail = conn; // the rear axle is still on it
  v.conn = null;
  v.commit = null;
  if (v.path) v.pathS = v.nextPathS;
  v.move = chooseMove(ts, v, false);
}

export { signalAhead, mayEnter, enter, leave };
