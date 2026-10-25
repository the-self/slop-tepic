// js/sim/traffic/motion.ts
// Where a vehicle is and how it sits: its pose along its path, the ground's pitch under it, shoves and knocks, and
// placing it on a lane
import type { CurvePoint } from '../../world/road-network.ts';
import { clamp, onEdge, onRoad } from './constants.ts';
import type { DrivenVehicle, OnEdge, TrafficEdge, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt, roadLift } from './surface.ts';
import { occupy } from './occupancy.ts';
import { chooseMove } from './routing.ts';

// Point and direction at distance c along v's path: its lane, the curve through the intersection, and the
// lane after it (or, just out of an intersection, the curve it came along)
function lanePoint(e: TrafficEdge, i: number, s: number, out: CurvePoint): CurvePoint {
  out.x = e.sx + e.dx * s + e.rx * e.lanes[i];
  out.z = e.sz + e.dz * s + e.rz * e.lanes[i];
  out.dx = e.dx;
  out.dz = e.dz;
  return out;
}
function pathPoint(ts: TrafficState, v: OnEdge, c: number, out: CurvePoint): CurvePoint {
  const e = v.edge;
  if (v.conn) {
    if (c < 0) return lanePoint(e, v.lane, e.len + c, out);
    if (c > v.conn.len && v.move) return lanePoint(v.move.to, v.out, c - v.conn.len, out);
    return ts.curvePoint(v.conn, c, out);
  }
  if (c < 0 && v.trail) return ts.curvePoint(v.trail, v.trail.len + c, out);
  return lanePoint(e, v.lane, c, out);
}

// World position and heading from where v's axles are along its path: the rear axle dl to the right of it, and the
// body turned `nose` to the right about the rear axle, into a lane change (so the rear axle never slides sideways)
const front: CurvePoint = { x: 0, z: 0, dx: 0, dz: 0 };
const rear: CurvePoint = { x: 0, z: 0, dx: 0, dz: 0 };
function locate(ts: TrafficState, v: OnEdge): void {
  const c = v.conn ? v.cs : v.s;
  pathPoint(ts, v, c + v.axle, front);
  pathPoint(ts, v, c - v.axle, rear);
  const l = Math.hypot(front.x - rear.x, front.z - rear.z) || 1;
  v.tx = (front.x - rear.x) / l;
  v.tz = (front.z - rear.z) / l;
  v.nose = Math.atan2(v.dlv, Math.max(v.speed, 1.5));
  const off = v.dl + v.axle * Math.sin(v.nose);
  v.x = (front.x + rear.x) / 2 - v.tz * off;
  v.z = (front.z + rear.z) / 2 + v.tx * off;
}

// The ground's pitch under v between its axles (its body, wheels & shadow tilt with it; the nose up is negative)
function groundPitch(ts: TrafficState, v: Vehicle): number {
  const a = v.axle || 1.3;
  const fx = v.x + v.tx * a, fz = v.z + v.tz * a, bx = v.x - v.tx * a, bz = v.z - v.tz * a;
  return -Math.atan2(hillAt(ts, fx, fz) + roadLift(v, fx, fz) - hillAt(ts, bx, bz) - roadLift(v, bx, bz), 2 * a);
}

// Move v along and across its path by (dx, dz), as far as the road allows
function shove(ts: TrafficState, v: DrivenVehicle, dx: number, dz: number): void {
  const along = dx * v.tx + dz * v.tz;
  if (v.conn) v.cs = clamp(v.cs + along, -v.half, v.conn.len - 0.01);
  else v.s = clamp(v.s + along, 0, v.edge.len - v.half);
  v.dl = clamp(v.dl + dz * v.tx - dx * v.tz, -2.5, 2.5);
  locate(ts, v);
}

// Heading, steering, turn signals, and body pitch & roll from acceleration & turning
function pose(v: DrivenVehicle, dt: number): void {
  const yaw = Math.atan2(v.tx, v.tz) - v.nose;
  let dYaw = yaw - v.yaw;
  dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
  v.yaw = yaw;
  v.yawRate += (dYaw / dt - v.yawRate) * Math.min(1, dt * 8);
  const wheelbase = 2 * v.axle;
  const steer = clamp(Math.atan((wheelbase * v.yawRate) / Math.max(v.speed, 0.5)), -0.6, 0.6);
  v.steer += (steer - v.steer) * Math.min(1, dt * 10);

  const turn = v.move.turn;
  if (Math.abs(v.dl) > 0.3 && Math.abs(v.dlv) > 0.05) v.blink = v.dl > 0 ? -1 : 1;
  else if (turn !== 'S' && (v.conn || v.edge.len - v.s < 35)) v.blink = turn === 'R' ? 1 : -1;
  else v.blink = 0;

  v.pitchVel += ((-0.008 * v.acc - v.pitch) * 68.0 - v.pitchVel * 10.8) * dt;
  v.pitch = clamp(v.pitch + v.pitchVel * dt, -0.22, 0.22);
  v.rollVel += ((0.01 * v.speed * v.yawRate - v.roll) * 68.0 - v.rollVel * 10.8) * dt;
  v.roll = clamp(v.roll + v.rollVel * dt, -0.26, 0.26);
  v.yawOffset += v.yawVel * dt;
  v.yawVel += (-v.yawOffset * 18.0 - v.yawVel * 6.8) * dt;
  v.yawOffset = clamp(v.yawOffset * Math.exp(-4.5 * dt), -0.85, 0.85);
}

// Knock velocity from collisions carries v along and across its path, and dies down
function knock(ts: TrafficState, v: DrivenVehicle, dt: number): void {
  if (v.vx === 0 && v.vz === 0) return;
  shove(ts, v, v.vx * dt, v.vz * dt);
  const damp = Math.exp(-5.5 * dt);
  v.vx *= damp;
  v.vz *= damp;
  if (v.vx * v.vx + v.vz * v.vz < 1e-4) v.vx = v.vz = 0;
}

function place(ts: TrafficState, v: Vehicle, e: TrafficEdge, lane: number, s: number): void {
  v.edge = e;
  v.lane = lane;
  v.s = s;
  v.conn = null;
  v.trail = null;
  v.commit = null;
  v.yielding = false;
  v.wait = 0;
  v.speed = v.v0 * 0.5;
  v.acc = 0;
  v.dl = v.dlv = 0;
  v.vx = v.vz = v.yawOffset = v.yawVel = v.pitch = v.pitchVel = v.roll = v.rollVel = 0;
  v.damage = null; // (it comes back as another car, like new)
  v.wrecked = false;
  if (!onEdge(v)) return; // (it is: on e)
  locate(ts, v);
  v.prevX = v.x;
  v.prevZ = v.z;
  v.yaw = Math.atan2(v.tx, v.tz);
  v.yawRate = v.steer = 0;
  v.move = chooseMove(ts, v, false);
  if (onRoad(v)) occupy(ts, e.occ[lane], v, s); // (it is: its move just chosen)
}

export { locate, groundPitch, shove, pose, knock, place };
