// js/sim/traffic/driving.ts
// Driving along a lane: lane changes (MOBIL), the acceleration from everything ahead, and moving on by it
import { LOOKAHEAD, clamp } from './constants.ts';
import type { DrivenVehicle, LaneEntry, OnEdge } from './types.ts';
import type { TrafficState } from './state.ts';
import { phaseOf } from './signals.ts';
import { ahead, cross, straddle } from './occupancy.ts';
import { bendSpeed, brake, follow, freeAcc, playerGap, stopAt } from './idm.ts';
import { nearestLane } from './routing.ts';
import { holdsOn, mergingAhead, pedsOut } from './right-of-way.ts';
import { enter, leave, mayEnter, signalAhead } from './junctions.ts';
import { curbBrake, curbside } from './pickups.ts';

// Overtake into an adjacent lane when it is clearly quicker (MOBIL), or work towards a lane the planned turn
// can be made from; either only if neither v nor its new follower has to brake hard for it. Not while still
// pulling out of an intersection, nor in the last 12 m before the next.
function changeLanes(ts: TrafficState, v: DrivenVehicle): void {
  const e = v.edge;
  if (v.wrecked || v.conn || v.commit || Math.abs(v.dl) > 0.5 || v.s < v.half || e.len - v.s - v.half < 12) return;
  let target = -1;
  if (v.move.out[v.lane] < 0) {
    const t = v.lane + Math.sign(nearestLane(v.move, v.lane) - v.lane);
    if (laneSafe(ts, v, t, -4)) target = t;
  } else if (v.stop) {
    // (a camión, combi or taxi pulling in to the curb ahead: over to the curb lane, pickups.ts)
    if (v.lane < e.lanes.length - 1 && laneSafe(ts, v, v.lane + 1, -3)) target = v.lane + 1;
  } else if (v.speed > 2) {
    let best = laneAcc(ts, v, v.lane) + 0.6;
    for (let t = v.lane - 1; t <= v.lane + 1; t += 2) {
      if (t < 0 || t >= e.lanes.length || v.move.out[t] < 0 || !laneSafe(ts, v, t, -3)) continue;
      const acc = laneAcc(ts, v, t);
      if (acc > best) {
        best = acc;
        target = t;
      }
    }
  }
  if (target < 0) return;
  v.dl += e.lanes[v.lane] - e.lanes[target]; // same spot, now measured from the new lane's centre
  v.lane = target;
  v.trail = null;
}

// Can v move into lane t leaving itself and its new follower at least bSafe (negative) acceleration?
function laneSafe(ts: TrafficState, v: OnEdge, t: number, bSafe: number): boolean {
  let lead: LaneEntry | null = null;
  let back: LaneEntry | null = null;
  for (const o of v.edge.occ[t]) {
    if (o.v === v) continue;
    if (o.s > v.s) {
      lead = o;
      break;
    }
    back = o;
  }
  if (lead) {
    const gap = lead.s - lead.v.half - v.s - v.half;
    if (gap < 1.5 || freeAcc(ts, v) + brake(ts, v, gap, lead.v.speed) < bSafe) return false;
  }
  if (back) {
    const f = back.v;
    const gap = v.s - v.half - back.s - f.half;
    if (gap < 1.5 || freeAcc(ts, f) + brake(ts, f, gap, v.speed) < bSafe) return false;
  }
  // ...and neither the player nor any vehicle the player left standing is alongside or close by in lane t
  const off = v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl;
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  const near = (x: number, z: number, halfW: number, halfL: number) => {
    const dx = x - v.x, dz = z - v.z;
    const ahead = dx * fx + dz * fz;
    const reach = v.half + halfL + 6;
    return Math.abs(dz * fx - dx * fz - off) < v.halfWidth + halfW + 0.4 && ahead > -reach && ahead < reach;
  };
  if (ts.player.active && near(ts.player.x, ts.player.z, ts.player.halfW, ts.player.halfL)) return false;
  return !ts.parked.some((o) => near(o.x, o.z, o.halfW, o.halfL));
}

// Acceleration v would have in lane t behind the vehicle (or player) ahead there
function laneAcc(ts: TrafficState, v: OnEdge, t: number): number {
  const o = ahead(v.edge.occ[t], v.s, v);
  let worst = o ? brake(ts, v, o.s - o.v.half - v.s - v.half, o.v.speed) : 0;
  const pg = playerGap(v, v.edge.lanes[t] - v.edge.lanes[v.lane] - v.dl);
  if (pg < LOOKAHEAD) worst = Math.min(worst, brake(ts, v, pg, v.pSpeed));
  return freeAcc(ts, v) + worst;
}

// IDM acceleration for vehicles ahead in the lane (and, through the intersection, in the lane it leads to),
// the stop line while v may not go, a red beyond, the player, and slowing down for turns and give-way lines
function accelerate(ts: TrafficState, v: DrivenVehicle, dt: number): void {
  if (v.wrecked) {
    v.acc = -7; // (its engine dead: it rolls to a stop and stays there)
    v.gap = Infinity;
    return;
  }
  const e = v.edge;
  let worst: number;
  let cap = Infinity;
  v.gap = Infinity;
  if (!v.conn) {
    worst = follow(ts, v, e.occ[v.lane], v.s);
    const side = straddle(v);
    if (side) worst = Math.min(worst, follow(ts, v, e.occ[v.lane + side], v.s));
    const d = e.len - v.s - v.half;
    if (d < LOOKAHEAD) {
      const go = mayEnter(ts, v, d);
      const f = v.move.to;
      const j = v.move.out[v.lane];
      const c = j < 0 ? null : ts.connector(e, v.lane, f, j);
      const vs = c ? v.s - e.len - c.len : 0; // position on f, measured from its start
      if (!go) {
        worst = Math.min(worst, stopAt(ts, v, d));
      } else {
        worst = Math.min(worst, follow(ts, v, f.occ[j], vs), signalAhead(ts, v, f, f.len - vs - v.half));
        // pulling in to wait inside: slow down for that spot already if it will have to wait there
        if (v.yielding && c && holdsOn(ts, v, pedsOut(v, d + c.len - 3))) worst = Math.min(worst, stopAt(ts, v, d + v.half + v.yieldAt, 0.5));
      }
      // easing off to fall in behind a vehicle from another lane merging ahead into the same lane (unless committed:
      // then the others wait for v)
      const o = c && !v.claimed && mergingAhead(ts, v, f, j);
      if (o) worst = Math.min(worst, Math.max(-v.driver.b, brake(ts, v, o.s - o.v.half - vs - v.half, o.v.speed)));
      let vt = c ? bendSpeed(ts, v, c) : Infinity;
      const cautious = e.to.signal ? v.isPolice && phaseOf(ts, e) !== 'green' : e.axisIndex !== 0;
      if (cautious) vt = Math.min(vt, 5);
      cap = Math.sqrt(vt * vt + 5 * Math.max(0, d));
    }
  } else {
    const f = v.move.to;
    const vs = v.cs - v.conn.len;
    worst = Math.min(follow(ts, v, f.occ[v.out], vs), follow(ts, v, e.occ[v.lane], e.len + v.cs), signalAhead(ts, v, f, f.len - vs - v.half));
    // someone crossing the way out: wait for them inside the intersection, short of the 2.5 m crosswalk
    const d = v.conn.len - 3 - v.cs - v.half;
    const peds = pedsOut(v, d);
    if (v.yielding && v.cs < v.yieldAt && holdsOn(ts, v, peds)) {
      worst = Math.min(worst, stopAt(ts, v, v.yieldAt - v.cs, 0.5)); // waiting inside to turn
    } else {
      if (v.yielding) cross(ts, v);
      if (peds) worst = Math.min(worst, stopAt(ts, v, d, 0.5));
    }
    cap = bendSpeed(ts, v, v.conn);
  }
  // the player in its way: a driver takes a moment to see them come into it, and only then brakes (and keeps an eye
  // on them for a while after). Only something left standing stops it dead short of it, as a vehicle ahead does:
  // the player cutting in too close gets hit, as by anyone (collisions.ts)
  const pg = playerGap(v, 0);
  // (swerving round them, out of its path now, it still has them in mind)
  v.pSeen = pg < LOOKAHEAD || v.swerve !== 0 ? Math.min(3, v.pSeen + dt) : Math.max(0, v.pSeen - 0.5 * dt);
  if (pg < LOOKAHEAD && (v.pParked || v.pSeen >= v.react)) {
    // (swerving round them it brakes no harder than the tyres leave grip to steer with as well)
    const b = brake(ts, v, Math.max(pg, 0), v.pSpeed);
    worst = Math.min(worst, v.swerve !== 0 ? Math.max(b, -5 * ts.roadGrip) : b);
    if (v.pParked && pg < v.gap) {
      v.gap = pg;
      v.leaderSpeed = 0;
    }
  }
  worst = Math.min(worst, curbBrake(ts, v));
  const acc = Math.min(freeAcc(ts, v) + worst, (cap - v.speed) * 2);
  v.acc = clamp(acc, -9 * ts.roadGrip, v.driver.a);
}

// Steering out of the way of the player coming straight at it (on the wrong side of the road, or across it), once
// its driver has seen them and they are under 3.5 s off: to the right, towards the curb, unless the player is on that
// side or only the left leaves room to clear them, and no further than the road leaves room (it brakes all the same,
// accelerate). Not through an intersection, where the road's width isn't its lane's: there it only brakes
function dodge(v: DrivenVehicle): void {
  v.swerve = 0;
  if (v.conn || v.pParked || v.wrecked || v.pSeen < v.react || v.pSpeed > -3 || v.pAhead > LOOKAHEAD) return;
  // (held till they are past, alongside as well)
  const gap = v.pAhead - v.half - v.pHalfL;
  if (v.pAhead < -(v.half + v.pHalfL) || gap > 3.5 * (v.speed - v.pSpeed)) return;
  // where the player is from v's lane centre, not from v (which is moving off it): what v must get clear of
  const across = v.pRight + v.dl;
  const clear = v.halfWidth + v.pHalfW + 0.6;
  if (Math.abs(across) > clear) return; // (in the lane beside, as oncoming traffic is: no need)
  const e = v.edge;
  // (up against the curb, or into the oncoming lanes)
  const right = Math.min(2.4, e.half - e.lanes[v.lane] - v.halfWidth - 0.05);
  const left = Math.min(2.4, e.half + e.lanes[v.lane] - v.halfWidth - 0.05);
  // as far as each side needs, or has room for, and whether that gets them past without touching
  const toRight = Math.min(across + clear, Math.max(right, 0));
  const toLeft = Math.max(across - clear, -Math.max(left, 0));
  const apartRight = toRight - across, apartLeft = across - toLeft;
  const touch = v.halfWidth + v.pHalfW + 0.1;
  const clearsRight = apartRight > touch, clearsLeft = apartLeft > touch;
  const goRight = clearsRight ? across < 0.5 || !clearsLeft : !clearsLeft && apartRight >= apartLeft;
  v.swerve = goRight ? toRight : toLeft;
}

function drive(ts: TrafficState, v: DrivenVehicle, dt: number): void {
  v.laneTimer -= dt;
  if (v.laneTimer <= 0) {
    v.laneTimer = 0.4 + Math.random() * 0.3;
    changeLanes(ts, v);
  }
  dodge(v);
  curbside(ts, v, dt);
  accelerate(ts, v, dt);
  const speed = v.speed;
  v.speed = Math.max(0, v.speed + v.acc * dt);
  let ds = v.speed * dt;
  if (ds > v.gap - 0.3) {
    // never into the vehicle ahead
    ds = Math.max(0, v.gap - 0.3);
    v.speed = Math.min(v.speed, v.leaderSpeed);
  }
  v.acc = Math.max(-9, (v.speed - speed) / dt); // as driven, for the body to pitch with: none standing still
  v.wait = v.speed < 0.5 ? v.wait + dt : 0;
  if (!v.conn) {
    v.s += ds;
    if (v.s + v.half >= v.edge.len) enter(ts, v);
  } else {
    v.cs += ds;
    if (v.cs >= v.conn.len) leave(ts, v);
  }
  // ease sideways onto the lane centre (after lane changes and knocks), or off it to dodge or to pull in to the curb,
  // steering the front bumper towards it so the nose doesn't swing on into the next lane, and no faster than the
  // wheels can steer it, though even stopped half way into a lane change a driver edges over. A swerve is a yank of
  // the wheel: quicker, though only as quick as it is rolling (a car standing still can't dodge)
  const dodging = v.swerve !== 0;
  const aim = dodging ? v.swerve : v.pullOver;
  const maxLat = dodging ? Math.min(3.2, (v.bus ? 0.15 : 0.3) * v.speed) : Math.min(1.7, 0.3 + (v.bus ? 0.1 : 0.22) * v.speed);
  const rate = Math.min(dodging ? 3 : 1.8, Math.max(v.speed, 1.5) / (v.axle + v.half));
  const target = clamp(rate * (aim - v.dl), -maxLat, maxLat);
  const steer = (dodging ? 6 : 2.5) * dt;
  v.dlv += clamp(target - v.dlv, -steer, steer);
  v.dl += v.dlv * dt;
}

export { drive };
