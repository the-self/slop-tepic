// js/world/central-runs.ts
// The coaches that come and go at the Central de Autobuses (central-plan.ts lays out its bays and its gate). Each waits
// nose in at its bay on the andén, backs out swinging its tail away from Preparatoria, drives out through the gate's
// way out onto Av. Preparatoria and away along the road network to the highway its line takes out of Tepic, to
// Guadalajara, Mazatlán or Miramar, fading out at the far end of it (`departure`, on the route a router hands it: the
// police's, sim/crime/road-graph.ts); another comes in from there the same way (`arrival`), through the way in to the
// bay. With no route, the coach goes round the block on the right instead (Calle Dr. Bernardo Martínez, República de
// Chile, Av. Insurgentes, Preparatoria again: the streets round the buses' loop, OpenStreetMap's way 295445292). The lanes are the road network's (its edges round the block, measured in the
// Central's frame: Preparatoria's centre u 112, half 6 m; Dr. Martínez's v 88.5, one way west; República de Chile's
// u -61.5; Insurgentes' carriageway east its axis v -23 at u -43 to v -26 at u 95, 3 lanes). A path is laid here as
// samples every STEP m, each with the speed the coach may take there (the bends', the patio's, the street's), plain
// data (no three.js) for node --test: central/runs.ts drives and draws them.

import { hash } from './hash.ts';
import { ROWS, inBlock, centralAt, centralFrame } from './central-plan.ts';
import type { CoachBay } from './central-plan.ts';

const STEP = 0.5; // m between a path's samples
const PATIO_SPEED = 4.2; // m/s on the patio (15 km/h)
const STREET_SPEED = 8.3; // m/s in town (30 km/h)
const HIGHWAY_SPEED = 16; // m/s out on the highway, past HIGHWAY m from the Central (58 km/h)
const HIGHWAY = 1800; // m
const REVERSE_SPEED = 1.4; // m/s backing out of the bay
const LATERAL = 1.3; // m/s²: the most a bend may swing the passengers (sets the speed round it)
const ACCEL = 0.8; // m/s²
const BRAKE = 1.1; // m/s²
/** The bays the runs leave from, by their middles' u along the andén (the nearest bay to each) */
const RUN_BAYS = [26, 52, 78];

/** A path: its samples' world position (m), the way the nose faces there (heading, rad: the traffic's convention),
 *  the speed it may take there (m/s), its length (m) */
export interface RunPath {
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  length: number;
  /** backing up it: the nose faces back along it */
  reverse: boolean;
}

/** A coach's run: its bay, its line (an index into central.ts's LINES), its two paths (out of the bay backwards, then
 *  round the block forwards back into it) and how long it first waits (s) */
export interface CoachRun {
  bay: CoachBay;
  line: number;
  out: RunPath;
  loop: RunPath;
  wait: number;
}

/** A waypoint of the frame (u, v; m), rounded off by a bend of radius r (m) when it is a corner */
type Way = [u: number, v: number, r?: number];

/** The points of a run of waypoints in the frame, each corner rounded by a circular arc of its radius (shrunk where the
 *  legs either side are too short for it: half a leg's length to a corner, nearly all of it to the run's ends) */
function rounded(ways: readonly Way[]): [number, number][] {
  const out: [number, number][] = [[ways[0][0], ways[0][1]]];
  for (let i = 1; i + 1 < ways.length; i++) {
    const [pu, pv] = ways[i - 1], [bu, bv, r = 0] = ways[i], [nu, nv] = ways[i + 1];
    const l1 = Math.hypot(bu - pu, bv - pv), l2 = Math.hypot(nu - bu, nv - bv);
    const d1u = (bu - pu) / l1, d1v = (bv - pv) / l1, d2u = (nu - bu) / l2, d2v = (nv - bv) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, d1u * d2u + d1v * d2v)));
    const t = Math.min(r * Math.tan(turn / 2), (i === 1 ? 0.9 : 0.5) * l1, (i + 2 === ways.length ? 0.9 : 0.5) * l2);
    if (!(t > 0.01) || turn < 1e-3) {
      out.push([bu, bv]);
      continue;
    }
    // the arc: from t short of the corner to t past it, round its centre on the inside of the turn
    const radius = t / Math.tan(turn / 2), side = d1u * d2v - d1v * d2u > 0 ? 1 : -1;
    const au = bu - d1u * t, av = bv - d1v * t;
    const cu = au - side * d1v * radius, cv = av + side * d1u * radius;
    const from = Math.atan2(av - cv, au - cu), steps = Math.max(4, Math.ceil((turn * radius) / 0.25));
    for (let k = 0; k <= steps; k++) {
      const a = from + (side * turn * k) / steps;
      out.push([cu + Math.cos(a) * radius, cv + Math.sin(a) * radius]);
    }
  }
  const last = ways[ways.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** A path along waypoints of the frame, sampled every STEP m, `reverse` for backing up it */
function layPath(ways: readonly Way[], reverse: boolean): RunPath {
  const pts = rounded(ways).map(([u, v]) => centralAt(u, v));
  // even samples along it
  const xs: number[] = [pts[0].x], zs: number[] = [pts[0].z];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, az = pts[i - 1].z, L = Math.hypot(pts[i].x - ax, pts[i].z - az);
    if (L < 1e-6) continue;
    let s = STEP - carry;
    for (; s <= L; s += STEP) {
      xs.push(ax + ((pts[i].x - ax) * s) / L);
      zs.push(az + ((pts[i].z - az) * s) / L);
    }
    carry = L - (s - STEP);
  }
  const end = pts[pts.length - 1];
  if (Math.hypot(end.x - xs[xs.length - 1], end.z - zs[zs.length - 1]) > STEP * 0.2) { xs.push(end.x); zs.push(end.z); }
  const n = xs.length;
  const x = Float32Array.from(xs), z = Float32Array.from(zs);
  const heading = new Float32Array(n), speed = new Float32Array(n);
  const motion = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    motion[i] = Math.atan2(x[b] - x[a], z[b] - z[a]);
    heading[i] = reverse ? motion[i] + Math.PI : motion[i];
  }
  // the speed: the patio's or the street's, the bends' (the turn over a few samples either side), then what braking
  // and pulling away allow, from a crawl at its start to a stop at its end
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    let turn = motion[b] - motion[a];
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const radius = Math.abs(turn) > 1e-4 ? ((b - a) * STEP) / Math.abs(turn) : Infinity;
    const [u, v] = centralFrame(x[i], z[i]);
    const top = reverse ? REVERSE_SPEED : inBlock(u, v) ? PATIO_SPEED : Math.hypot(u, v) > HIGHWAY ? HIGHWAY_SPEED : STREET_SPEED;
    speed[i] = Math.min(top, Math.sqrt(LATERAL * radius));
  }
  speed[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] ** 2 + 2 * BRAKE * STEP));
  speed[0] = Math.min(speed[0], 0.6);
  for (let i = 1; i < n; i++) speed[i] = Math.min(speed[i], Math.sqrt(speed[i - 1] ** 2 + 2 * ACCEL * STEP));
  return { x, z, heading, speed, length: (n - 1) * STEP, reverse };
}

/** The bays the runs use (the andén's nearest to each of RUN_BAYS) */
function runBays(bays: readonly CoachBay[]): CoachBay[] {
  return RUN_BAYS.map((want) => {
    let best = bays[0], bestD = Infinity;
    for (const b of bays) {
      if (b.row !== 0) continue;
      const d = Math.abs(centralFrame(b.x, b.z)[0] - want);
      if (d < bestD) [best, bestD] = [b, d];
    }
    return best;
  });
}
/** The bays left empty of parked coaches: the runs', and theirs either side (room to swing in and out of them) */
function runRoom(bays: readonly CoachBay[]): CoachBay[] {
  const runs = runBays(bays);
  return bays.filter((b, i) => runs.some((r) => {
    const k = bays.indexOf(r);
    return Math.abs(i - k) <= 1 && b.row === r.row;
  }));
}

/**
 * The runs: for each of its bays (runBays), out of it backwards, then out the gate, round the block and in the gate
 * again to it (its way round the block, when no road out is found); each coach of one of `lines` lines, the first
 * waits a little, the next longer
 */
function coachRuns(bays: readonly CoachBay[], lines: number): CoachRun[] {
  const { slant } = ROWS[0];
  // the nose's way in the frame, nose in to the andén
  const du = Math.sin(slant), dv = -Math.cos(slant);
  return runBays(bays).map((bay, k) => {
    const [cu, cv] = centralFrame(bay.x, bay.z);
    // backing out along the bay, the tail swung round towards República de Chile: the nose ends up towards the gate
    const k1: Way = [cu - du * 10, cv - dv * 10, 7];
    const out = layPath([[cu, cv], k1, [k1[0] - 7, k1[1]]], true);
    // in the bay's line, the lane up to it on the patio (where the arc into it starts)
    const along = (53 - cv) / -dv;
    const loop = layPath([
      [k1[0] - 7, k1[1]], [84, k1[1], 10], [96, 61, 8],
      // out the gate onto Preparatoria, swinging wide into its lane towards Dr. Martínez
      [110, 61, 7], [110, 88.5, 8],
      // Dr. Martínez west, República de Chile towards Insurgentes, Insurgentes east in its outer lane
      [-59.6, 88.5, 8], [-59.6, -20.5, 7], [-43, -19.9], [95, -22.8], [108.5, -23.5, 7],
      // Preparatoria towards Dr. Martínez again, in at the gate's way in, along the patio and round into the bay
      [108.5, 49.7, 6], [cu - du * along, 53, 8], [cu, cv]
    ], false);
    return { bay, line: Math.floor(hash(bay.x, bay.z, 63) * lines) % lines, out, loop, wait: 15 + 40 * k };
  });
}

/** Where the lines leave Tepic: the far ends of the highways, as the road network has them (m, world) */
const ROADS_OUT: Record<CoachRoad, [number, number]> = {
  guadalajara: [12552, 3060], // (Autopista Guadalajara - Tepic)
  mazatlan: [-4995, -303], // (Avenida Tepic-Mazatlán)
  miramar: [-5293, 1896] // (Carretera Miramar-Tepic)
};
/** A line's road out of town */
export type CoachRoad = 'guadalajara' | 'mazatlan' | 'miramar';
/** A route along the road network from (x0, z0) to (x1, z1): its nodes (m, world), or none */
export type Router = (x0: number, z0: number, x1: number, z1: number) => readonly { x: number; z: number }[] | null;

const LANE = 1.9; // m right of a road's centre line the coach keeps
const CORNER = 9; // m: the bends' radius at the route's nodes
// The two junctions on Preparatoria either side of the gate (the road network's nodes): with Calle Dr. Martínez
// (south) and with Insurgentes (north)
const J_SOUTH: [number, number] = [112, 89];
const J_NORTH: [number, number] = [112, -33];
// Out the gate's way out onto Preparatoria, turning right (into its lane towards Dr. Martínez) or left (towards
// Insurgentes); in from it at the way in, coming up it from Insurgentes or down it from Dr. Martínez
const EXIT_RIGHT: Way = [110, 61, 7], EXIT_LEFT: Way = [114.5, 61, 7];
const ENTER_UP: Way = [108.5, 49.7, 6], ENTER_DOWN: Way = [114.5, 49.7, 7];
/** Whether (u, v) of the frame lies on Preparatoria between the junctions, north of v0 or south of v1 */
const onPreparatoria = (u: number, v: number, v0: number, v1: number) => u > 104 && u < 120 && v > v0 && v < v1;

/** A route's nodes in the frame, kept LANE m to the right of the road (the normal at a node: its two legs' mean),
 *  near-repeats dropped */
function laneOf(nodes: readonly { x: number; z: number }[]): Way[] {
  const pts: [number, number][] = [];
  for (const n of nodes) {
    const last = pts.at(-1);
    if (!last || Math.hypot(n.x - last[0], n.z - last[1]) > 1) pts.push([n.x, n.z]);
  }
  return pts.map(([x, z], i) => {
    const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = qx - px, dz = qz - pz, L = Math.hypot(dx, dz) || 1;
    // (right of the way: heading +z, the right is -x)
    const [u, v] = centralFrame(x - (dz / L) * LANE, z + (dx / L) * LANE);
    return [u, v, CORNER];
  });
}

/** The route from the junction at `j` (frame) to the far end `to` (world), or from there to it: none where it would
 *  turn back past the gate along Preparatoria */
function routeVia(router: Router, j: [number, number], to: [number, number], inbound: boolean): Way[] | null {
  const a = centralAt(j[0], j[1]);
  const nodes = inbound ? router(to[0], to[1], a.x, a.z) : router(a.x, a.z, to[0], to[1]);
  if (!nodes || nodes.length < 3) return null;
  // (the node next to the junction, on its way: not back along Preparatoria towards the gate)
  const next = nodes[inbound ? nodes.length - 2 : 1], [nu, nv] = centralFrame(next.x, next.z);
  if (j === J_SOUTH ? onPreparatoria(nu, nv, -40, 86) : onPreparatoria(nu, nv, -30, 95)) return null;
  return laneOf(nodes);
}

/** The length of a run of waypoints (m) */
const lengthOf = (ways: readonly Way[]) => ways.reduce((sum, w, i) => sum + (i ? Math.hypot(w[0] - ways[i - 1][0], w[1] - ways[i - 1][1]) : 0), 0);

/**
 * A coach's way out from where it has backed out of its bay to the far end of its road (`road`): out the gate's way out
 * turning right towards Dr. Martínez or left towards Insurgentes, whichever is the shorter way there; none without a
 * route
 */
function departure(run: CoachRun, road: CoachRoad, router: Router): RunPath | null {
  const start = run.out.x.length - 1;
  const [eu, ev] = centralFrame(run.out.x[start], run.out.z[start]);
  const patio: Way[] = [[eu, ev], [84, ev, 10], [96, 61, 8]];
  const right = routeVia(router, J_SOUTH, ROADS_OUT[road], false), left = routeVia(router, J_NORTH, ROADS_OUT[road], false);
  const ways = right && (!left || lengthOf(right) + 28 < lengthOf(left) + 94)
    ? [...patio, EXIT_RIGHT, ...right]
    : left ? [...patio, EXIT_LEFT, ...left] : null;
  return ways ? layPath(ways, false) : null;
}

/**
 * A coach's way in from the far end of its road to its bay: up Preparatoria from Insurgentes turning right in at the
 * gate's way in, or down it from Dr. Martínez turning left, whichever is the shorter; none without a route
 */
function arrival(run: CoachRun, road: CoachRoad, router: Router): RunPath | null {
  const [cu, cv] = centralFrame(run.bay.x, run.bay.z);
  const { slant } = ROWS[0];
  const du = Math.sin(slant), dv = -Math.cos(slant), along = (53 - cv) / -dv;
  const bay: Way[] = [[cu - du * along, 53, 8], [cu, cv]];
  const north = routeVia(router, J_NORTH, ROADS_OUT[road], true), south = routeVia(router, J_SOUTH, ROADS_OUT[road], true);
  const ways = north && (!south || lengthOf(north) + 83 < lengthOf(south) + 40)
    ? [...north, ENTER_UP, ...bay]
    : south ? [...south, ENTER_DOWN, ...bay] : null;
  return ways ? layPath(ways, false) : null;
}

/** How long a run's coach waits in its bay before its next run (s): a minute or two, the same every load */
function nextWait(run: CoachRun, laps: number): number {
  return 60 + 90 * hash(run.bay.x + laps, run.bay.z, 64);
}

export { STEP, ROADS_OUT, layPath, runBays, runRoom, coachRuns, departure, arrival, nextWait };
