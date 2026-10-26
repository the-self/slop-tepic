// js/sim/traffic/spawning.ts
// Placing the population round the focus: vehicles in free lanes (buses & combis on their routes), pedestrians on
// sidewalks and crosswalks, out of the near view; and the spots where police and gangs turn up
import type { PathAlong, TransitPath } from '../transit.ts';
import { pickMoto } from '../../models/motos/index.ts';
import { NUM_PEDS, PED_SPAWN_DISTANCE, ROUTE_HEADWAY, VEHICLE_SPAWN_DISTANCE, liveryOf } from './constants.ts';
import type { Ped, RoadSpot, TrafficEdge, Vehicle, VehicleBase } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';
import { visible } from './view.ts';
import { pickWeighted } from './near.ts';
import { laneClear } from './occupancy.ts';
import { place } from './motion.ts';
import { drawModel } from './fleet.ts';
import { vehicleAt } from './bodies.ts';
import { KERB, QUEUE_GAP, atCurb, crosswalkTrack, sidewalkTrack } from './sidewalks.ts';
import { endConversation } from './walking.ts';

function nearView(ts: TrafficState, x: number, z: number, radius: number, distance: number): boolean {
  return ts.hasView && Math.hypot(x - ts.camX, ts.camY - hillAt(ts, x, z), z - ts.camZ) < distance && visible(ts, x, z, radius);
}

// A route of v's fleet that road e runs along ({ path, s }), at random, or null; only one whose last unit is
// ROUTE_HEADWAY m from (x, z) or more (a route runs every 10-20 minutes, its units kilometres apart: dropped all
// around the player at random they came in convoys of one route)
const fleetRoutes: PathAlong[] = [];
function routeOn(ts: TrafficState, e: TrafficEdge, fleet: VehicleBase['fleet'], x: number, z: number, v: Vehicle): PathAlong | null {
  fleetRoutes.length = 0;
  if (!e.transit) return null;
  for (const on of e.transit) if ((!on.path.fleet || on.path.fleet === fleet) && routeFree(ts, on.path, x, z, v)) fleetRoutes.push(on);
  return fleetRoutes.length ? fleetRoutes[Math.floor(Math.random() * fleetRoutes.length)] : null;
}
function routeFree(ts: TrafficState, path: TransitPath, x: number, z: number, v: Vehicle): boolean {
  for (const u of ts.vehicles) if (u !== v && u.edge && u.path === path && Math.hypot(u.x - x, u.z - z) < ROUTE_HEADWAY) return false;
  return true;
}
function joinRoute(v: Vehicle, on: PathAlong): void {
  v.path = on.path;
  v.pathS = on.s;
  v.lost = 0;
  v.sign = on.path.routeIndex;
  if (v.bus) v.livery = liveryOf(on.path.name);
}

// Put v in a free lane around the focus. Normal replenishment protects the near view; teleports can fill it. Buses
// & combis go on the roads of their routes (where the map has any).
function spawnVehicle(ts: TrafficState, v: Vehicle, rMin: number, rMax: number, protectView: boolean): boolean {
  if (!v.bus && !v.bike && !v.moto) drawModel(v); // (a car comes back as another model, a motorcyclist on another moto)
  else if (v.moto) v.model = pickMoto();
  const onRoutes = !!v.fleet && ts.transit.paths.length > 0;
  const pool = onRoutes ? ts.nearTransitEdges : ts.nearEdges;
  for (let attempt = 0; attempt < 12; attempt++) {
    const e = onRoutes ? pool[Math.floor(Math.random() * pool.length)] : pickWeighted(pool, ts.nearCarWeights);
    if (!e || (v.bus && !onRoutes && e.axis !== 'ave') || e.len < 2 * v.half + 10) continue;
    if (onRoutes && !e.transit?.length) continue;
    const lane = v.bike ? e.lanes.length - 1 : Math.floor(Math.random() * e.lanes.length);
    const along = (ts.focusX - e.sx) * e.dx + (ts.focusZ - e.sz) * e.dz;
    const minS = Math.max(v.half + 5, along - rMax);
    const maxS = Math.min(e.len - v.half - 5, along + rMax);
    if (minS > maxS) continue;
    const s = minS + Math.random() * (maxS - minS);
    const x = e.sx + e.dx * s + e.rx * e.lanes[lane];
    const z = e.sz + e.dz * s + e.rz * e.lanes[lane];
    const d = Math.hypot(x - ts.focusX, z - ts.focusZ);
    if (d < rMin || d > rMax || (protectView && nearView(ts, x, z, v.half + 4, VEHICLE_SPAWN_DISTANCE))) continue;
    if (ts.player.active && Math.hypot(x - ts.player.x, z - ts.player.z) < 25) continue;
    if (!laneClear(e.occ[lane], s, v.half + 8)) continue;
    const on = onRoutes ? routeOn(ts, e, v.fleet, x, z, v) : null;
    if (onRoutes && !on) continue;
    if (on) joinRoute(v, on);
    else v.path = null;
    place(ts, v, e, lane, s);
    return true;
  }
  return false;
}

// Try crosswalks first for crossing pedestrians, then fall back to sidewalks if no suitable crossing fits.
function spawnPed(ts: TrafficState, p: Ped, rMin: number, rMax: number, protectView: boolean): boolean {
  for (let attempt = 0; attempt < 10; attempt++) {
    const crosswalk = p.crossesStreets && ts.nearSignals.length > 0 && attempt < 5;
    const ok = crosswalk
      ? crosswalkTrack(ts, ts.nearSignals[Math.floor(Math.random() * ts.nearSignals.length)])
      : ts.nearEdges.length > 0 && sidewalkTrack(ts, pickWeighted(ts.nearEdges, ts.nearPedWeights));
    if (!ok) continue;
    const along = (ts.focusX - ts.track.ax) * ts.track.ux + (ts.focusZ - ts.track.az) * ts.track.uz;
    const minT = Math.max(0, along - rMax), maxT = Math.min(ts.track.len, along + rMax);
    if (minT > maxT) continue;
    const t = crosswalk ? (Math.random() < 0.5 ? Math.random() * KERB : ts.track.len - Math.random() * KERB) : minT + Math.random() * (maxT - minT);
    const x = ts.track.ax + ts.track.ux * t;
    const z = ts.track.az + ts.track.uz * t;
    const d = Math.hypot(x - ts.focusX, z - ts.focusZ);
    if (d < rMin || d > rMax || (protectView && nearView(ts, x, z, 2, PED_SPAWN_DISTANCE))) continue;
    if (ts.player.active && Math.hypot(x - ts.player.x, z - ts.player.z) < 10) continue;
    if (vehicleAt(ts, x, z, 0.4) || ts.wallAt?.(x, z)) continue; // (not inside a car or a building)
    if (crosswalk && ts.track.node?.curb.some((q) => Math.hypot(q.x - x, q.z - z) < QUEUE_GAP)) continue;
    if (p.conversation) endConversation(ts, p.conversation);
    Object.assign(p, ts.track);
    p.t = t;
    p.dir = t < ts.track.len * 0.5 ? 1 : -1;
    p.x = x;
    p.z = z;
    p.v = crosswalk ? 0 : p.speed;
    p.pause = 0;
    p.nextRoute = null;
    p.nextLeg = 0;
    p.goalTime = 0;
    p.restTime = ts.clock + 25 + Math.random() * 45;
    p.socialTime = ts.clock + 5 + Math.random() * 15;
    p.wish = Math.random();
    p.ride = null;
    p.rig.placed = false; // stands afresh where it now is
    p.placed = true;
    if (crosswalk) atCurb(ts, p);
    return true;
  }
  return false;
}

// A spot in a lane `rMin`..`rMax` m from (x, z), out of the camera's view when it can be: { x, z, heading } (reused),
// or null. Where police cars turn up.
function roadSpot(ts: TrafficState, x: number, z: number, rMin: number, rMax: number): RoadSpot | null {
  for (let attempt = 0; attempt < 24; attempt++) {
    const e = ts.nearEdges[Math.floor(Math.random() * ts.nearEdges.length)] as TrafficEdge | undefined; // (none: no roads near)
    if (!e || e.len < 12) continue;
    const lane = Math.floor(Math.random() * e.lanes.length);
    const s = 5 + Math.random() * (e.len - 10);
    const px = e.sx + e.dx * s + e.rx * e.lanes[lane];
    const pz = e.sz + e.dz * s + e.rz * e.lanes[lane];
    const d = Math.hypot(px - x, pz - z);
    if (d < rMin || d > rMax) continue;
    if (attempt < 16 && ts.hasView && visible(ts, px, pz, 3)) continue;
    ts.spot.x = px;
    ts.spot.z = pz;
    ts.spot.heading = Math.atan2(e.dx, e.dz);
    return ts.spot;
  }
  return null;
}

// A spot on a sidewalk `rMin`..`rMax` m from (x, z) (where someone walks), out of view when it can be: { x, z } or null.
// Where officers on foot, gangs and thieves turn up.
function sidewalkSpot(ts: TrafficState, x: number, z: number, rMin: number, rMax: number): RoadSpot | null {
  let fallback: Ped | null = null;
  const start = Math.floor(Math.random() * NUM_PEDS);
  for (let k = 0; k < NUM_PEDS; k++) {
    const p = ts.peds[(start + k) % NUM_PEDS];
    if (!p.placed || p.fallen || p.bail) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < rMin || d > rMax) continue;
    if (ts.hasView && visible(ts, p.x, p.z, 3)) {
      fallback = fallback ?? p;
      continue;
    }
    ts.spot.x = p.x;
    ts.spot.z = p.z;
    return ts.spot;
  }
  if (!fallback) return null;
  ts.spot.x = fallback.x;
  ts.spot.z = fallback.z;
  return ts.spot;
}

export { nearView, routeOn, routeFree, joinRoute, spawnVehicle, spawnPed, roadSpot, sidewalkSpot };
