// js/sim/emergency/driving.ts
// A fire truck or ambulance on its way (sim/emergency.ts): set out from its station along the road graph, driven as a
// patrol car is (crime/cruisers.ts pursue & moveCruiser), on the right of the street, out round what is stopped in its
// way, slowing to a stop short of where it is going.
import type { EmergencyServices, Responder } from '../emergency.ts';
import type { Cruiser, XZ } from '../crime/types.ts';

// Intersections a route across the city may search (a chase's own stop at 4000: Tepic's graph has some tens of thousands)
const ROUTE_LIMIT = 60000;
const OUT = 120; // m round its station it may set out from
const LANE = 1.7; // m right of the street's middle it keeps to
const PASS = -1.9; // m right (so: left) of it, going round something stopped
const WIDE = 3.6; // m: a lane's width, each side of the middle
const LOOK = 40; // m ahead it watches the traffic
const BRAKE = 4; // m/s² it brakes at for what is ahead (a truck of 14 t)
const CROSSING = 7; // m/s it crosses an intersection at (the light may be red: the others stop, or not)
const NUDGE = 2.5; // m/s it edges on at, shoving aside what has stood in its way BLOCKED s
const BLOCKED = 2.5;

// What is ahead of cr within LOOK m in the band `lo`..`hi` m right of the street's middle (through (mx, mz), running
// (fx, fz)): 0..WIDE its own side, -WIDE..0 the other. The gap to the nearest (m, 0 alongside, Infinity none) and its
// speed along the street (m/s, negative: coming at it)
const _ahead = { gap: Infinity, speed: 0 };
function ahead(svc: EmergencyServices, cr: Cruiser, fx: number, fz: number, mx: number, mz: number, lo: number, hi: number): typeof _ahead {
  _ahead.gap = Infinity;
  _ahead.speed = 0;
  const look = (x: number, z: number, halfW: number, halfL: number, vx: number, vz: number) => {
    const dx = x - cr.x, dz = z - cr.z;
    if (Math.abs(dx) > LOOK + 8 || Math.abs(dz) > LOOK + 8) return;
    const gap = dx * fx + dz * fz - halfL - cr.halfL;
    if (gap < -cr.halfL || gap > Math.min(LOOK, _ahead.gap)) return;
    // (into the band by 0.3 m or more)
    const right = -(x - mx) * fz + (z - mz) * fx;
    if (right + halfW < lo + 0.3 || right - halfW > hi - 0.3) return;
    _ahead.gap = Math.max(0, gap);
    _ahead.speed = vx * fx + vz * fz;
  };
  const t = svc.crime.traffic;
  for (const list of [t.cars, t.buses]) for (const v of list) if (v.edge) look(v.x, v.z, v.halfWidth, v.half, v.tx * v.speed, v.tz * v.speed);
  for (const o of svc.crime.cruisers) if (o !== cr && o.active) look(o.x, o.z, o.halfW, o.halfL, Math.sin(o.heading) * o.speed, Math.cos(o.heading) * o.speed);
  return _ahead;
}

const length = (path: readonly XZ[]): number => {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return m;
};

/** Puts u's vehicle at the intersection by its station it has the shortest way to (gx, gz) from (the street out of it
 *  may be one way: the nearest isn't always the one to set out from), facing its way, its route planned. False if
 *  there is no way there */
export function setOut(svc: EmergencyServices, u: Responder, gx: number, gz: number): boolean {
  const crime = svc.crime, cr = u.cr, home = u.home;
  const near: number[] = [];
  for (let i = 0; i < crime.nodes.length; i++) if (crime.ways[i].length && Math.hypot(crime.nodes[i].x - home.x, crime.nodes[i].z - home.z) < OUT) near.push(i);
  near.sort((a, b) => Math.hypot(crime.nodes[a].x - home.x, crime.nodes[a].z - home.z) - Math.hypot(crime.nodes[b].x - home.x, crime.nodes[b].z - home.z));
  let start: XZ | null = null, path: XZ[] | null = null, best = Infinity;
  for (const i of near.slice(0, 4)) {
    const n = crime.nodes[i];
    const p = crime.route(n.x, n.z, gx, gz, ROUTE_LIMIT, true);
    const m = p ? length(p) + Math.hypot(n.x - home.x, n.z - home.z) : Infinity;
    if (p && m < best) {
      best = m;
      start = n;
      path = p;
    }
  }
  if (!start || !path) {
    // (none by the ways the lanes run: any way there)
    const n = crime.nearestNode(home.x, home.z);
    if (n < 0) return false;
    start = crime.nodes[n];
    path = crime.route(start.x, start.z, gx, gz, ROUTE_LIMIT);
  }
  if (!path) return false;
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
  // the traffic ahead (pulled over for it, giveWay in traffic/driving.ts): round it on the left while the oncoming lane
  // is clear (passSide 1: passing), back on the right once past it; else behind it
  let follow = Infinity;
  if (lane) {
    const ad = Math.hypot(tx - cr.x, tz - cr.z) || 1, fx = (tx - cr.x) / ad, fz = (tz - cr.z) / ad;
    let { gap, speed } = ahead(svc, cr, fx, fz, tx, tz, 0, WIDE);
    const other = ahead(svc, cr, fx, fz, tx, tz, -WIDE, 0);
    if (cr.passSide === 1) {
      // (back on its side once it is clear 12 m ahead; meanwhile what counts is what is in the lane it is passing in)
      if (gap > 12) cr.passSide = 0;
      else ({ gap, speed } = other);
    } else if (gap < 25 && speed < 6 && other.gap > 30 && other.speed > -2) {
      cr.passSide = 1;
      ({ gap, speed } = other);
    }
    if (gap < LOOK) follow = Math.max(0, speed) + Math.sqrt(2 * BRAKE * Math.max(0, gap - 3));
    if (cr.passSide === 1) lane = PASS;
    // the intersection ahead: slowing to cross it
    const node = cr.path ? cr.path[cr.pathI] : undefined;
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
  const want = d <= stop ? 0 : Math.min(top, follow, lane === PASS ? 11 : top, 1.5 + Math.sqrt(2 * 3.5 * (d - stop)));
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
