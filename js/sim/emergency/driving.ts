// js/sim/emergency/driving.ts
// A fire truck or ambulance on its way (sim/emergency.ts): set out from its station along the road graph, driven as a
// patrol car is (crime/cruisers.ts pursue & moveCruiser), on the right of the street, out round what is stopped in its
// way, slowing to a stop short of where it is going.
import type { EmergencyServices, Responder } from '../emergency.ts';
import type { Cruiser, XZ } from '../crime/types.ts';
import type { Station } from './stations.ts';
import { routeFrom } from '../crime/road-graph.ts';

// Intersections a route across the city may search (a chase's own stop at 4000: Tepic's graph has some tens of thousands)
const ROUTE_LIMIT = 60000;
const OUT = 120; // m round its station it may set out from
const LANE = 1.7; // m right of the street's middle it keeps to
const PASS = -1.9; // m right (so: left) of it, going round something stopped
const MARGIN = 0.3; // m it keeps clear of what it goes by
const SQUEEZE = -0.4; // m right of the middle its left side may come to, squeezing past what pulls over for it
const SQUEEZE_SPEED = 9; // m/s squeezing past
const PASS_SPEED = 11; // m/s going round on the oncoming side
const LOOK = 40; // m ahead it watches the traffic
const BRAKE = 4; // m/s² it brakes at for what is ahead (a truck of 14 t)
const CROSSING = 7; // m/s it crosses an intersection at (the light may be red: the others stop, or not)
const NUDGE = 2.5; // m/s it edges on at, shoving aside what has stood in its way BLOCKED s
const BLOCKED = 2.5;

// What is ahead of cr within LOOK m whose body comes into the strip `lo`..`hi` m right of the street's middle (the
// line through (mx, mz) running (fx, fz)): the strip it would take up in its own lane, or passing. The gap to the
// nearest (m, 0 alongside, Infinity none), its speed along the street (m/s, negative: coming at it), how far right of
// the middle its left side is (m), and whether it is pulling over for the siren (traffic/driving.ts giveWay).
// (Module scratch, not a closure: this runs for every vehicle twice a frame per unit on its way)
const _ahead = { gap: Infinity, speed: 0, left: 0, yields: false };
let _cr: Cruiser | null = null, _fx = 0, _fz = 1, _mx = 0, _mz = 0, _lo = 0, _hi = 0;
function consider(x: number, z: number, halfW: number, halfL: number, vx: number, vz: number, yields: boolean): void {
  const cr = _cr;
  if (!cr) return;
  const dx = x - cr.x, dz = z - cr.z;
  if (Math.abs(dx) > LOOK + 8 || Math.abs(dz) > LOOK + 8) return;
  const gap = dx * _fx + dz * _fz - halfL - cr.halfL;
  if (gap < -cr.halfL || gap > Math.min(LOOK, _ahead.gap)) return;
  const right = -(x - _mx) * _fz + (z - _mz) * _fx;
  if (right + halfW < _lo || right - halfW > _hi) return;
  _ahead.gap = Math.max(0, gap);
  _ahead.speed = vx * _fx + vz * _fz;
  _ahead.left = right - halfW;
  _ahead.yields = yields;
}
function ahead(svc: EmergencyServices, cr: Cruiser, fx: number, fz: number, mx: number, mz: number, lo: number, hi: number): typeof _ahead {
  _ahead.gap = Infinity;
  _ahead.speed = _ahead.left = 0;
  _ahead.yields = false;
  _cr = cr;
  _fx = fx;
  _fz = fz;
  _mx = mx;
  _mz = mz;
  _lo = lo;
  _hi = hi;
  const t = svc.crime.traffic;
  for (const v of t.cars) if (v.edge) consider(v.x, v.z, v.halfWidth, v.half, v.tx * v.speed, v.tz * v.speed, v.sirenNear);
  for (const v of t.buses) if (v.edge) consider(v.x, v.z, v.halfWidth, v.half, v.tx * v.speed, v.tz * v.speed, v.sirenNear);
  for (const o of svc.crime.cruisers) if (o !== cr && o.active) consider(o.x, o.z, o.halfW, o.halfL, Math.sin(o.heading) * o.speed, Math.cos(o.heading) * o.speed, false);
  _cr = null;
  return _ahead;
}

// Each station's ways out: the four intersections nearest it a street leads on from, and how far each is from it (m)
const waysOut = new Map<Station, [number, number][]>();
function startsFor(svc: EmergencyServices, home: Station): [number, number][] {
  let out = waysOut.get(home);
  if (!out) {
    const crime = svc.crime;
    out = [];
    for (let i = 0; i < crime.nodes.length; i++) {
      const d = Math.hypot(crime.nodes[i].x - home.x, crime.nodes[i].z - home.z);
      if (crime.ways[i].length && d < OUT) out.push([i, d]);
    }
    out = out.sort((a, b) => a[1] - b[1]).slice(0, 4);
    if (!out.length) {
      const n = crime.nearestNode(home.x, home.z);
      if (n >= 0) out.push([n, 0]);
    }
    waysOut.set(home, out);
  }
  return out;
}

/** Puts u's vehicle at the intersection by its station it has the shortest way to (gx, gz) from (the street out of it
 *  may be one way: the nearest isn't always the one to set out from), facing its way, its route planned: one search
 *  from them all, the ways the lanes run (any way, if that leads nowhere). False if there is no way there */
export function setOut(svc: EmergencyServices, u: Responder, gx: number, gz: number): boolean {
  const crime = svc.crime, cr = u.cr;
  const starts = startsFor(svc, u.home);
  const path = routeFrom(crime, starts, gx, gz, ROUTE_LIMIT, true) ?? routeFrom(crime, starts, gx, gz, ROUTE_LIMIT);
  if (!path) return false;
  const start = path[0];
  const next = path.find((p) => Math.hypot(p.x - start.x, p.z - start.z) > 3) ?? { x: gx, z: gz };
  Object.assign(cr, {
    active: true, x: start.x, z: start.z, heading: Math.atan2(next.x - start.x, next.z - start.z), speed: 0, vx: 0, vz: 0,
    wreck: 0, state: 'chase', path, pathI: 0, replan: 0, stuckT: 0, stuckCount: 0, checkX: start.x, checkZ: start.z,
    reverseT: 0, deployed: false, life: 0, pitch: 0, roll: 0, lift: 0, vy: 0, slowT: 0, startX: start.x, startZ: start.z,
    goalX: gx, goalZ: gz, passSide: 0, siren: true
  });
  cr.y = crime.groundAt(cr.x, cr.z);
  cr.mesh.position.set(cr.x, cr.y, cr.z);
  cr.bodyMesh.material = cr.paint;
  cr.lightbar.visible = true;
  return true;
}

// A new route from where it is to (gx, gz) (the old one left behind: it got stuck and backed out), or straight there
function replan(svc: EmergencyServices, u: Responder, gx: number, gz: number): void {
  const crime = svc.crime, cr = u.cr;
  // (the right way round the streets; any way, if that leads nowhere)
  let path = crime.route(cr.x, cr.z, gx, gz, ROUTE_LIMIT, true) ?? crime.route(cr.x, cr.z, gx, gz, ROUTE_LIMIT);
  // (without the intersections it is already past: on the way from the first to the second)
  while (path && path.length > 1 &&
    Math.hypot(path[1].x - cr.x, path[1].z - cr.z) < Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z)) {
    path.shift();
  }
  path ??= [{ x: gx, z: gz }];
  Object.assign(cr, { path, pathI: 0, startX: cr.x, startZ: cr.z, goalX: gx, goalZ: gz });
}

/**
 * Drives u towards (gx, gz) at up to `top` m/s, slowing to stop `stop` m short of it. Returns how far it still is (m)
 */
export function driveTo(svc: EmergencyServices, u: Responder, dt: number, gx: number, gz: number, stop: number, top: number): number {
  const crime = svc.crime, cr = u.cr;
  if (!cr.path || Math.hypot(cr.goalX - gx, cr.goalZ - gz) > 1) replan(svc, u, gx, gz);
  const d = Math.hypot(gx - cr.x, gz - cr.z);
  let tx = gx, tz = gz, lane = 0;
  // along its route on the right of the street; the last stretch (past the graph's last intersection) straight there
  if (crime.pursue(cr, 10 + Math.abs(cr.speed) * 0.6) && crime._aim) {
    tx = crime._aim.x;
    tz = crime._aim.z;
    lane = LANE;
  }
  // the traffic ahead, measured across the street from its middle along the leg it is on (not towards the aim, which
  // lies across the street from it): what pulls over for it (giveWay in traffic/driving.ts) it squeezes past; what is
  // stopped it goes round on the left while the oncoming lane is clear (passSide 1: passing), back on the right once
  // past it; else it follows
  let follow = Infinity, cap = top;
  if (lane && cr.path) {
    const path = cr.path, i = Math.min(cr.pathI, path.length - 1);
    const a = i > 0 ? path[i - 1] : { x: cr.startX, z: cr.startZ }, b = path[i];
    const ld = Math.hypot(b.x - a.x, b.z - a.z);
    if (ld > 0.5) {
      const fx = (b.x - a.x) / ld, fz = (b.z - a.z) / ld;
      const w = cr.halfW + MARGIN; // (the strip it takes up either side of where it drives)
      const own = ahead(svc, cr, fx, fz, a.x, a.z, LANE - w, LANE + w);
      const { left, yields } = own;
      let { gap, speed } = own; // (copied: the next look reuses the one result)
      if (gap < LOOK && yields && left - w > SQUEEZE) {
        // pulled over: past it, a little over the middle if need be
        lane = Math.min(LANE, left - w - 0.1);
        cap = SQUEEZE_SPEED;
        ({ gap, speed } = ahead(svc, cr, fx, fz, a.x, a.z, lane - w, lane + w));
      }
      const other = ahead(svc, cr, fx, fz, a.x, a.z, PASS - w, PASS + w);
      if (cr.passSide === 1) {
        // (back on its side once that is clear 12 m ahead; meanwhile what counts is what is in the lane it passes in)
        if (gap > 12) cr.passSide = 0;
        else ({ gap, speed } = other);
      } else if (gap < 25 && speed < 6 && other.gap > 30 && other.speed > -2) {
        cr.passSide = 1;
        ({ gap, speed } = other);
      }
      if (gap < LOOK) follow = Math.max(0, speed) + Math.sqrt(2 * BRAKE * Math.max(0, gap - 3));
      if (cr.passSide === 1) {
        lane = PASS;
        cap = PASS_SPEED;
      }
    }
    // the intersection ahead: slowing to cross it
    const node = path[cr.pathI] as XZ | undefined;
    if (node && svc.junctions.has(node)) follow = Math.min(follow, CROSSING + Math.sqrt(2 * BRAKE * Math.max(0, Math.hypot(node.x - cr.x, node.z - cr.z) - 12)));
  }
  // stood behind something that won't move (cars waiting on it at a junction): it edges on, shoving them aside
  u.blocked = follow < 1 && Math.abs(cr.speed) < 1 ? u.blocked + dt : 0;
  if (u.blocked > BLOCKED) follow = Math.max(follow, NUDGE);
  if (lane) {
    const ax = tx - cr.x, az = tz - cr.z, ad = Math.hypot(ax, az) || 1;
    // (right of the way it is heading: x east, z south)
    tx -= (az / ad) * lane;
    tz += (ax / ad) * lane;
  }
  // easing off to stop short of it (a truck of 14 t brakes at ~4 m/s²: v² = 2·a·d)
  const want = d <= stop ? 0 : Math.min(cap, follow, 1.5 + Math.sqrt(2 * 3.5 * (d - stop)));
  crime.moveCruiser(cr, dt, want, tx, tz);
  return d;
}

/** Stands it where it is (parked by the scene: the patrol cars' braking, on the ground) */
export function park(svc: EmergencyServices, u: Responder, dt: number): void {
  svc.crime.moveCruiser(u.cr, dt, 0);
}

/** Back in its station: out of the world till sent again */
export function stable(svc: EmergencyServices, u: Responder): void {
  svc.crime.removeCruiser(u.cr);
}
