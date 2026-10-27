import {
  ALL_AVENUES,
  ALL_STREETS,
  ISLAND_BOUNDS,
  getIslandBoundsAtZ,
  BLOCKS,
  blockAt
} from './city-config.ts';
import type { CityBlock, GridStreet } from './city-config.ts';
import { GEO } from './city-geodata.js';

// js/world/road-network.ts
// Drivable road graph derived from the ground layout that city-grid.ts actually builds: avenue corridors
// between the raised curbs, cross-street gaps between curb rows, lanes that keep clear of medians, plazas
// and steam stacks, intersections (signalized where street-details.ts mounts signal heads) and the
// lane-to-lane curves used to drive straight through them or turn.
//
// Conventions: north = -z, east = +x. Every directed edge has a unit direction (dx, dz) and a right normal
// (rx, rz) = (-dz, dx). Lanes are lateral offsets to the right of the centreline, sorted left to right.

/** An axis-aligned ground footprint (m, world frame): a sidewalk slab (`curb`) or something standing on the ground */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  curb?: boolean;
}

/** An avenue / major road ('ave') or a street ('st'): right of way, paint, the traffic's demand */
export type RoadAxis = 'ave' | 'st';
/** A move's kind of turn at a junction: left, straight on, right */
export type Turn = 'L' | 'S' | 'R';
/** On a bridge or ramp: [distance from the edge's `from` node along it (m), lift over the ground (m; < 0 down in an
 *  underpass)], ascending */
export type LiftProfile = [number, number][];

/** An intersection or junction of the road graph (or a centreline street's bend: `shape`) */
export interface RoadNode {
  x: number;
  z: number;
  /** Half sizes of the intersection box across x and z (m; a grid intersection's, 0 at a centreline junction) */
  hx: number;
  hz: number;
  signal: boolean;
  /** The edges arriving at it and leaving it */
  in: RoadEdge[];
  out: RoadEdge[];
  /** The grid avenue corridor it stands on */
  avenue?: AvenueCorridor;
  /** A junction of the centreline streets (not of the grid) */
  general?: boolean;
  /** A bend of a centreline street: no corner to stop at */
  shape?: boolean;
  /** A stop along a street for a signal with no junction at it: a bend made a stop (a pedestrian crossing with lights,
   *  or a junction with a street the traffic doesn't drive, see 8.) */
  midblock?: boolean;
  /** On a bridge or ramp: its lift over the ground (m) */
  lift?: number;
  /** Grid and centreline roads meet here */
  mixed?: boolean;
  arms: RoadArm[];
  /** Its index in the network's nodes */
  id: number;
  /** Sides (crosswalks: grid 0 east, 1 west, 2 south, 3 north, other arms from 4) and right-of-way groups (step 9) */
  sideCount: number;
  groupCount: number;
}

/** One road leaving a node ("arm": one per direction a road leaves it in), see computeArms */
export interface RoadArm {
  /** Unit direction away from the node */
  ux: number;
  uz: number;
  /** The widest roadway's half width (m) */
  half: number;
  /** A major road's */
  ave: boolean;
  in: RoadEdge | null;
  out: RoadEdge | null;
  order: number;
  /** The arm it crosses the other roads as one with (itself, or an earlier one within 20°) */
  lead?: RoadArm;
  /** On a lead: the half width of the widest of the arms it leads (m) */
  wide: number;
  side: number;
  group: number;
}

/** A movement from an edge into the next one at its `to` node */
export interface RoadMove {
  to: RoadEdge;
  turn: Turn;
  /** Cross product of the two directions: > 0 bends right */
  cross: number;
  /** For each lane of the edge, the lane of `to` it leads to, or -1 */
  out: number[];
}

/** A directed edge between two nodes, its lanes running between the stop lines (sx, sz) and len m further on */
export interface RoadEdge {
  from: RoadNode;
  to: RoadNode;
  axis: RoadAxis;
  /** The centreline's start (at `from`, m) */
  x0: number;
  z0: number;
  /** Unit direction and right normal (-dz, dx) */
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  /** Node to node (m) */
  span: number;
  /** Half width of the road, curb to curb (m) */
  half: number;
  /** Lane offsets to the right of the centreline (m), left to right */
  lanes: number[];
  moves: RoadMove[];
  /** A centreline street's (not the grid's) */
  general?: boolean;
  /** Its candidate lanes, before the obstacle test (read on the centreline streets') */
  cand: number[];
  /** Runs both ways along one centreline with its other roadway */
  divided?: boolean;
  /** On a bridge or ramp (see edgeLift) */
  lift?: LiftProfile | null;
  /** The street's name (OpenStreetMap's; '' none) */
  name?: string;
  /** An alley's, a service road's or a track's (city-geodata.js links' `minor`): too narrow for lane lines */
  minor?: boolean;
  /** Its index among the one-way centreline edges (step 5; -1 none) */
  oneWay: number;
  /** A vehicle could both reach it and leave it */
  live: boolean;
  inArm: RoadArm | null;
  outArm: RoadArm | null;
  /** Its stop line pulled closer to the roads crossing ahead than they need */
  squeezed: boolean;
  /** Its start stop line (m) and the length between the stop lines (m) */
  sx: number;
  sz: number;
  len: number;
  /** Its index in the network's edges */
  id: number;
  /** The sides of e.to it arrives over and of e.from it leaves over; its right-of-way group at e.to */
  inSide: number;
  outSide: number;
  axisIndex: number;
  /** Lateral axis of its road, the same both ways (+x across north-south roads, +z across east-west ones) */
  clx: number;
  clz: number;
  /** The oncoming edge of its road at e.to */
  opposite: RoadEdge | null;
}

/** A node as the paint sees it: snapshot before routing renumbers the nodes */
export interface PaintNode {
  id: number;
  x: number;
  z: number;
  shape: boolean | undefined;
}

/** An edge as the paint sees it: every physical road, dead ends included (see paintEdges) */
export interface PaintEdge {
  from: PaintNode;
  to: PaintNode;
  axis: RoadAxis;
  x0: number;
  z0: number;
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  span: number;
  len: number;
  half: number;
  lanes: number[];
  lift: LiftProfile | null | undefined;
  /** An alley's, a service road's or a track's: no lane lines (RoadEdge.minor) */
  minor: boolean;
}

/** Cubic Bézier from one lane's stop line to the next edge's lane start (m): control points, arc-length table */
export interface LaneCurve {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  x3: number;
  z3: number;
  /** Arc length at t = k / 16 (m) */
  lut: Float32Array;
  len: number;
  /** The sharpest curvature along it (1 / m) */
  curv: number;
}

/** A position and unit tangent on a curve (curvePoint writes into it) */
export interface CurvePoint {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

/** What buildRoadNetwork returns */
export interface RoadNetwork {
  nodes: RoadNode[];
  edges: RoadEdge[];
  paintEdges: PaintEdge[];
  /** The cached curve from lane i of e into lane j of f */
  connector: (e: RoadEdge, i: number, f: RoadEdge, j: number) => LaneCurve;
  curvePoint: typeof curvePoint;
  /** Is the box clear of everything but the curbs (and on land)? */
  walkable: (minX: number, maxX: number, minZ: number, maxZ: number) => boolean;
  onSidewalk: (x: number, z: number) => boolean;
  /** Is (x, z) on a street, `clear` m from any curb, median or obstacle? */
  isRoadClear: (x: number, z: number, clear?: number) => boolean;
}

/** A grid avenue's lanes at some z: offsets from its corridor's centre for southbound and northbound traffic (m) */
interface LaneSet {
  south: number[];
  north: number[];
}

/** A grid avenue's corridor between the curbs */
export interface AvenueCorridor {
  index: number;
  name: string;
  /** Its centre x and half width curb to curb (m) */
  x: number;
  half: number;
  lanesAt: (z: number) => LaneSet | null;
  /** Per metre of z from Z_MIN: 1 where at least one lane is clear */
  free: Uint8Array;
  nodes: RoadNode[];
}

/** A cross street between two neighbouring avenue corridors */
interface CrossPiece {
  a: AvenueCorridor;
  b: AvenueCorridor;
  z: number;
  /** Free 1 m steps between the curbs */
  gap: number;
  half: number;
  east: number[];
  west: number[];
  from: RoadNode | null;
  to: RoadNode | null;
  /** Centreline junctions on it (4b) */
  mids?: RoadNode[];
}

/** A point of a centreline link, with its lift over the ground (m) on a bridge or ramp */
interface LinkPoint {
  x: number;
  z: number;
  lift?: number;
  /** A station whatever the bends: a junction's approach ends here (4b) */
  station?: boolean;
}

/** A centreline street link not on the grid (4b) */
interface StreetLink {
  a: number;
  b: number;
  name: string;
  minor: boolean;
  w: number;
  lanes: number;
  dir: number;
  pts: LinkPoint[];
  len: number;
}

/** A centreline street's lanes each way (offsets right of its centreline, m) */
interface RunLanes {
  half: number;
  axis: RoadAxis;
  fwd: number[];
  back: number[];
}

/** A straight run of a centreline street between two stations */
interface StreetRun extends RunLanes {
  from: RoadNode;
  to: RoadNode;
  profile: LinkPoint[] | null;
  name: string;
  minor: boolean;
  divided?: boolean;
  /** From or to a junction that stands off the link's own end (see 4b): its lanes aren't tested for obstacles */
  approach?: boolean;
}

/** An edge's end at a node, while its arms are being worked out */
interface EdgeEnd {
  e: RoadEdge;
  role: 'in' | 'out';
  ux: number;
  uz: number;
  order: number;
}

/** A road through a node: one arm, or two opposite ones */
interface NodeRoad {
  members: RoadArm[];
  group: number;
  rank: number;
}

const CELL = 32;
const Z_MIN = Math.floor(ISLAND_BOUNDS.minZ) - 20; // the detailed island, ~129th St to the Battery
const Z_MAX = Math.ceil(ISLAND_BOUNDS.maxZ) + 20;
const LANE_CLEAR = 1.2; // half width each lane keeps free of obstacles
const CHORD_STRAY = 0.5; // m a centreline street's edge (a chord between stations) may stray from the street it follows
const CROSSWALK = 2.5; // depth between an intersection box and its stop lines
const SIGNAL_CLEAR = 26; // m from a street's junctions a signal along it stands for a stop of its own (8.)
const SHORE_MARGIN = 6;

function buildRoadNetwork(sidewalks: readonly Footprint[], obstacles: readonly Footprint[]): RoadNetwork {
  // 1. Spatial hash of ground footprints: curbs bound the roads, everything else also blocks pedestrians
  const hash = new Map<number, Footprint[]>();
  const cellKey = (ix: number, iz: number) => (ix + 512) * 1024 + iz + 512;

  function insert(r: Footprint) {
    for (let ix = Math.floor(r.minX / CELL); ix <= Math.floor(r.maxX / CELL); ix++) {
      for (let iz = Math.floor(r.minZ / CELL); iz <= Math.floor(r.maxZ / CELL); iz++) {
        const k = cellKey(ix, iz);
        let list = hash.get(k);
        if (!list) hash.set(k, (list = []));
        list.push(r);
      }
    }
  }
  for (const r of sidewalks) insert({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, curb: true });
  for (const r of obstacles) insert(r);

  // Calls fn(rect) for every footprint overlapping the box until fn returns true
  function query(minX: number, maxX: number, minZ: number, maxZ: number, fn: (r: Footprint) => boolean | undefined) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const list = hash.get(cellKey(ix, iz));
        if (!list) continue;
        for (const r of list) {
          if (r.minX < maxX && r.maxX > minX && r.minZ < maxZ && r.maxZ > minZ && fn(r)) return true;
        }
      }
    }
    return false;
  }

  function onLand(minX: number, maxX: number, minZ: number, maxZ: number) {
    for (const z of [minZ, maxZ]) {
      const shore = getIslandBoundsAtZ(z);
      if (minX < shore.westX + SHORE_MARGIN || maxX > shore.eastX - SHORE_MARGIN) return false;
    }
    return true;
  }

  const blocked = (minX: number, maxX: number, minZ: number, maxZ: number) => !onLand(minX, maxX, minZ, maxZ) || query(minX, maxX, minZ, maxZ, () => true);
  const walkable = (minX: number, maxX: number, minZ: number, maxZ: number) => onLand(minX, maxX, minZ, maxZ) && !query(minX, maxX, minZ, maxZ, (r) => !r.curb);
  const onSidewalk = (x: number, z: number) => query(x, x, z, z, (r) => r.curb);
  // The same test for the centreline streets (4b), which follow the real streets: the rectangles standing in for
  // irregular sidewalks may reach a little past their curbs, a whole park's bounds take in the streets around it and a
  // median mall's bounds (Allen St, Chrystie St...) both its roadways, so only a curb right at (x, z), median malls by
  // their real outline and other obstacles under 50 m across count
  const MEDIANS = BLOCKS.filter((b) => b.median);
  const medianBox = (r: Footprint) => MEDIANS.some((b) => Math.abs(b.minX - r.minX) < 0.6 && Math.abs(b.maxX - r.maxX) < 0.6 && Math.abs(b.minZ - r.minZ) < 0.6 && Math.abs(b.maxZ - r.maxZ) < 0.6);
  const medianCells = new Map<number, CityBlock[]>(); // 64 m cells -> the medians reaching into them
  for (const b of MEDIANS) {
    for (let ix = Math.floor((b.minX - 2) / 64); ix <= Math.floor((b.maxX + 2) / 64); ix++) {
      for (let iz = Math.floor((b.minZ - 2) / 64); iz <= Math.floor((b.maxZ + 2) / 64); iz++) {
        const k = ix * 100000 + iz;
        let list = medianCells.get(k);
        if (!list) medianCells.set(k, (list = []));
        list.push(b);
      }
    }
  }
  function nearMedian(x: number, z: number, clear: number) {
    for (const b of medianCells.get(Math.floor(x / 64) * 100000 + Math.floor(z / 64)) ?? []) {
      if (x < b.minX - clear || x > b.maxX + clear || z < b.minZ - clear || z > b.maxZ + clear) continue;
      let inside = false;
      const P = b.poly;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const a = P[i];
        const c = P[j];
        if ((a.z > z) !== (c.z > z) && x < ((c.x - a.x) * (z - a.z)) / (c.z - a.z) + a.x) inside = !inside;
        const ex = c.x - a.x;
        const ez = c.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < clear) return true;
      }
      if (inside) return true;
    }
    return false;
  }
  // (a curb where an island's rectangles and its own outline agree: the rectangles standing in for an irregular island
  // reach past its curb along a diagonal street, the outline, laid out on the builder's raster, wanders a little past
  // it here and there; a lane is on the curb where both say so)
  const curbAt = (x: number, z: number) => query(x - 0.3, x + 0.3, z - 0.3, z + 0.3, (r) => r.curb) && !!blockAt(x, z);
  const blockedOnStreet = (x: number, z: number, clear: number) => !onLand(x - clear, x + clear, z - clear, z + clear) ||
    curbAt(x, z) ||
    nearMedian(x, z, clear) ||
    query(x - clear, x + clear, z - clear, z + clear, (r) => !r.curb && (r.maxX - r.minX < 50 || r.maxZ - r.minZ < 50) && !medianBox(r));

  // 2. Avenue corridors: the most common curb-to-curb gap around each avenue's nominal x along its own stretches
  //    (CSCL: an avenue only exists between its ends, e.g. Irving Pl 14th-20th St, so it never claims a neighbour's
  //    roadway), and the stretches of z (at least 30 m long) where at least one of its lanes is clear. Each stretch
  //    keeps its real direction: two-way stretches (Central Park West, West End Ave, York Ave...) carry half of the
  //    lanes each way
  const laneOffsets = (half: number) => (half >= 10.0 ? [-7.2, -3.6, 0, 3.6, 7.2]
    : half >= 8.5 ? [-5.4, -1.8, 1.8, 5.4]
      : half >= 6.8 ? [-3.6, 0, 3.6]
        : half >= 4.4 ? [-1.8, 1.8] : null);
  const avenues: AvenueCorridor[] = [];
  for (const ave of ALL_AVENUES) {
    if (ave.isHighway) continue;
    const segs = ave.segs ?? [{ z0: ave.minZ, z1: ave.maxZ, dir: ave.dir }];
    // the avenue's stretch at z (or the nearest one within an intersection's reach of its ends)
    const segAt = (z: number) => {
      let best: (typeof segs)[number] | null = null;
      let bestD = 15;
      for (const s of segs) {
        const d = z < s.z0 ? s.z0 - z : z > s.z1 ? z - s.z1 : 0;
        if (d <= bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    const votes = new Map<string, number>();
    for (let z = Z_MIN; z <= Z_MAX; z += 2) {
      if (!segAt(z)) continue;
      let left = -Infinity;
      let right = Infinity;
      let inside = false as boolean; // (set in the callback, where the type checker doesn't follow it)
      query(ave.x - 20, ave.x + 20, z, z, (r) => {
        if (!r.curb) return false;
        if (r.maxX <= ave.x) left = Math.max(left, r.maxX);
        else if (r.minX >= ave.x) right = Math.min(right, r.minX);
        else inside = true;
        return false;
      });
      if (inside || left === -Infinity || right === Infinity) continue;
      const k = `${left}:${right}`;
      votes.set(k, (votes.get(k) || 0) + 1);
    }
    let best: string | null = null;
    for (const [k, n] of votes) if (!best || n > (votes.get(best) ?? 0)) best = k;
    if (!best) continue;
    const [left, right] = best.split(':').map(Number);
    const half = (right - left) / 2;

    // Physical lane offsets from the corridor centre for southbound (+z) and northbound (-z) traffic, by direction
    // of the stretch (1: southbound, -1: northbound, 0: two-way)
    let byDir: Record<number, LaneSet>;
    if (ave.hasMedian) {
      // Park Ave: three lanes each way either side of the planted malls (lanes in the malls drop out below)
      const both = { south: [-11.4, -7.8, -4.2], north: [4.2, 7.8, 11.4] };
      byDir = { 1: both, '-1': both, 0: both };
    } else {
      // Real curb-to-curb roadways (CSCL): 21.3 m (8th, 3rd, 1st, 11th Aves) carry five lanes, 18.3 m (7th, 9th,
      // 10th, 2nd Aves) four, 14.6-15.8 m (5th, Madison, Lexington Aves) three
      const lanes = laneOffsets(half);
      if (!lanes) continue;
      byDir = {
        1: { south: lanes, north: [] },
        '-1': { south: [], north: lanes },
        0: { south: lanes.filter((o) => o < -0.5), north: lanes.filter((o) => o > 0.5) }
      };
    }
    const lanesAt = (z: number) => {
      const s = segAt(z);
      return s ? byDir[Math.sign(s.dir || 0)] : null;
    };

    const x = (left + right) / 2;
    const free = new Uint8Array(Z_MAX - Z_MIN + 1);
    for (let i = 0; i < free.length; i++) {
      const z = Z_MIN + i;
      const set = lanesAt(z);
      if (!set) continue;
      free[i] = [...set.south, ...set.north].some((o) => !blocked(x + o - LANE_CLEAR, x + o + LANE_CLEAR, z - 0.5, z + 0.5)) ? 1 : 0;
    }
    for (let i = 0; i < free.length;) {
      let j = i;
      while (j < free.length && free[j] === free[i]) j++;
      if (free[i] && j - i < 30) free.fill(0, i, j);
      i = j;
    }
    avenues.push({ index: avenues.length, name: ave.short, x, half, lanesAt, free, nodes: [] });
  }
  avenues.sort((a, b) => a.x - b.x);
  console.info('[roads] avenues', avenues.map((a) => `${a.name} x=${a.x.toFixed(1)} half=${a.half.toFixed(1)} free=${(a.free.reduce((s, v) => s + v, 0) / 1000).toFixed(1)}km`).join(' | '));

  // 3. Cross streets: free z intervals of the line joining two neighbouring active avenue corridors
  const pieces: CrossPiece[] = [];
  const runs = new Map<number, { a: AvenueCorridor; b: AvenueCorridor; z0: number }>();
  for (let i = 0; i <= Z_MAX - Z_MIN; i++) {
    const z = Z_MIN + i;
    const seen = new Set<number>();
    let prev: AvenueCorridor | null = null;
    for (const a of avenues) {
      if (!a.free[i]) continue;
      if (prev && !blocked(prev.x + prev.half, a.x - a.half, z - 0.5, z + 0.5)) {
        const k = prev.index * 64 + a.index;
        seen.add(k);
        if (!runs.has(k)) runs.set(k, { a: prev, b: a, z0: z });
      }
      prev = a;
    }
    for (const [k, run] of runs) {
      if (seen.has(k)) continue;
      runs.delete(k);
      const gap = z - run.z0;
      // streets are ~9-10 m curb to curb (half, the lanes each way and the nodes at its ends are filled in below)
      if (gap >= 7) pieces.push({ a: run.a, b: run.b, z: (run.z0 + z - 1) / 2, gap, half: 0, east: [], west: [], from: null, to: null });
    }
  }

  // One-way or two-way from the nearest named street inside the gap (majors and wide gaps are two-way)
  for (const p of pieces) {
    let st: GridStreet | null = null;
    for (const s of ALL_STREETS) {
      if (Math.abs(s.z - p.z) <= p.gap / 2 && (!st || Math.abs(s.z - p.z) < Math.abs(st.z - p.z))) st = s;
    }
    const twoWay = !st || st.dir === 0 || p.gap >= 20;
    const pair = p.gap >= 17 ? [1.8, 5.4] : [1.8];
    // (`!st`: twoWay already, said again for the type checker)
    p.east = twoWay || !st ? pair : st.dir > 0 ? [-1.8, 1.8] : [];
    p.west = twoWay || !st ? pair : st.dir < 0 ? [-1.8, 1.8] : [];
  }

  // 4. Intersections: street ends on avenue corridors (merged within 6 m)
  // (arms, id, sides and groups: filled in once the edges are known, steps 5-9)
  let nodes: RoadNode[] = [];
  function nodeAt(a: AvenueCorridor, z: number) {
    for (const n of a.nodes) if (Math.abs(n.z - z) < 6) return n;
    const n: RoadNode = { x: a.x, z, avenue: a, hx: a.half, hz: 0, signal: false, in: [], out: [], arms: [], id: -1, sideCount: 0, groupCount: 0 };
    a.nodes.push(n);
    nodes.push(n);
    return n;
  }
  for (const p of pieces) {
    p.half = (p.gap + 1) / 2; // the gap counts the free 1 m steps between the curbs
    p.from = nodeAt(p.a, p.z);
    p.to = nodeAt(p.b, p.z);
    for (const n of [p.from, p.to]) n.hz = Math.max(n.hz, Math.abs(p.z - n.z) + Math.min(p.half, 13));
  }

  // 4b. Non-grid streets: Lower Manhattan, Broadway and the curved avenues farther north, from
  //     the street centreline graph (GEO.roadGraph, tools/geo-roadgraph.mjs), minus the links the grid corridors above
  //     already carry. Its junctions join the grid where they meet it (at a grid intersection, on an avenue corridor or a
  //     cross street); a street's bends get shape nodes, so every edge stays straight.
  const genRuns = centrelineStreets();
  function centrelineStreets() {
    const RG = GEO.roadGraph;
    const runs: StreetRun[] = [];
    const pos: LinkPoint[] = [];
    for (let i = 0; i < RG.nodes.length; i += 2) pos.push({ x: RG.nodes[i], z: RG.nodes[i + 1] });
    const pieceRows = new Map<number, CrossPiece[]>();
    for (const p of pieces) {
      const k = Math.floor(p.z / 16);
      for (const kk of [k - 1, k, k + 1]) {
        let row = pieceRows.get(kk);
        if (!row) pieceRows.set(kk, (row = []));
        row.push(p);
      }
    }
    // The grid corridor at (x, z): an avenue's free stretch, or a cross street between two avenues (`inner`: clear of
    // the avenues' roadways)
    const aveAt = (x: number, z: number, margin: number) => {
      const i = Math.round(z) - Z_MIN;
      for (const a of avenues) if (Math.abs(x - a.x) <= a.half + margin && i >= 0 && i < a.free.length && a.free[i]) return a;
      return null;
    };
    const pieceAt = (x: number, z: number, margin: number, inner: boolean) => {
      for (const p of pieceRows.get(Math.floor(z / 16)) ?? []) {
        if (Math.abs(z - p.z) > p.half + margin) continue;
        if (inner ? x > p.a.x + p.a.half + 4 && x < p.b.x - p.b.half - 4 : x > p.a.x - 2 && x < p.b.x + 2) return p;
      }
      return null;
    };
    // Points every 4 m along a polyline, 7 m clear of its ends, with the direction there
    function samples(pts: LinkPoint[], fn: (x: number, z: number, dx: number, dz: number) => void) {
      let total = 0;
      for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].z - pts[k].z);
      const from = Math.min(7, total / 2);
      let s0 = 0;
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1e-6) continue;
        for (let s = Math.max(from, Math.ceil(s0 / 4) * 4); s <= Math.min(s0 + L, total - from); s += 4) {
          const t = (s - s0) / L;
          fn(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, (b.x - a.x) / L, (b.z - a.z) / L);
        }
        s0 += L;
      }
      return total;
    }
    // Links the grid already carries: most of their length runs along an avenue (north-south) or a cross street
    const links: StreetLink[] = [];
    for (const [a, b, ni, w, lanes, dir, inner, lifts, , minor] of RG.links) {
      const pts: LinkPoint[] = [pos[a]];
      for (let k = 0; k < inner.length; k += 2) pts.push({ x: inner[k], z: inner[k + 1] });
      pts.push(pos[b]);
      // a bridge's or ramp's lift over the ground at each point (geodata, m)
      if (lifts) for (let k = 0; k < pts.length; k++) pts[k] = { x: pts[k].x, z: pts[k].z, lift: lifts[k] / 10 };
      let n = 0;
      let hit = 0;
      const len = samples(pts, (x, z, dx, dz) => {
        n++;
        if ((Math.abs(dz) > 0.94 && aveAt(x, z, 1.5)) || (Math.abs(dx) > 0.94 && pieceAt(x, z, 1.5, false))) hit++;
      });
      if (n && hit > n * 0.5) continue;
      links.push({ a, b, name: RG.names[ni], minor: minor === 1, w, lanes, dir, pts, len });
    }
    // Junctions a few metres apart (divided roads, offset corners) are one: collapse links under 14 m
    const parent = pos.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of links) if (l.len < 14) parent[find(l.a)] = find(l.b);
    const sum = new Map<number, { x: number; z: number; n: number }>();
    const counted = new Set<number>();
    for (const l of links) {
      for (const i of [l.a, l.b]) {
        if (counted.has(i)) continue;
        counted.add(i);
        const r = find(i);
        const s = sum.get(r) ?? { x: 0, z: 0, n: 0 };
        s.x += pos[i].x;
        s.z += pos[i].z;
        s.n++;
        sum.set(r, s);
      }
    }
    // A junction joins the grid at a grid intersection within 12 m, on an avenue corridor or a cross street it lies on,
    // or stands on its own
    const junctions = new Map<number, RoadNode>();
    const gridCells = new Map<number, RoadNode[]>(); // 32 m cells -> grid nodes
    const indexNode = (g: RoadNode) => {
      const k = Math.floor(g.x / 32) * 100000 + Math.floor(g.z / 32);
      let cell = gridCells.get(k);
      if (!cell) gridCells.set(k, (cell = []));
      cell.push(g);
    };
    for (const g of nodes) indexNode(g);
    function junction(r: number) {
      const known = junctions.get(r);
      if (known) return known;
      const s = sum.get(r);
      if (!s) throw new Error(`[roads] junction ${r} has no links`); // (every root of a link's end has its sum)
      const x = s.x / s.n;
      const z = s.z / s.n;
      let node: RoadNode | null = null;
      let bd = 12;
      for (let ix = Math.floor((x - 12) / 32); ix <= Math.floor((x + 12) / 32); ix++) {
        for (let iz = Math.floor((z - 12) / 32); iz <= Math.floor((z + 12) / 32); iz++) {
          for (const g of gridCells.get(ix * 100000 + iz) ?? []) {
            const d = Math.hypot(g.x - x, g.z - z);
            if (d < bd) {
              bd = d;
              node = g;
            }
          }
        }
      }
      if (!node) {
        const a = aveAt(x, z, 3);
        if (a) {
          node = nodeAt(a, z);
          node.hz = Math.max(node.hz, 7);
          indexNode(node);
        }
      }
      if (!node) {
        const p = pieceAt(x, z, 3, true);
        if (p) {
          node = { x, z: p.z, hx: 7, hz: p.half, signal: false, in: [], out: [], arms: [], id: -1, sideCount: 0, groupCount: 0 };
          nodes.push(node);
          (p.mids ??= []).push(node);
          indexNode(node);
        }
      }
      if (!node) {
        node = { x, z, hx: 0, hz: 0, signal: false, in: [], out: [], general: true, arms: [], id: -1, sideCount: 0, groupCount: 0 };
        nodes.push(node);
      }
      junctions.set(r, node);
      return node;
    }
    // Lanes by the street's real lane count (OpenStreetMap's lanes, or the builder's guess by road class) and
    // curb-to-curb width: as many as fit at 2.9 m or wider, each up to 3.6 m wide (a one-way road 7 m wide with two
    // lanes, like the Libramiento's carriageways, has two of 3.5 m). Two-way roads split them each way. Wide or
    // named avenues are major.
    const MAJOR = /\bAVE\b|AVENUE|BROADWAY|BOWERY|BLVD|PARK ROW|^Avenida\b|^Av\.|Boulevard|Bulevar|Calzada|Libramiento|Perif[eé]rico|^Carretera|Prolongaci[oó]n Avenida/;
    function lanesOf(l: StreetLink): RunLanes {
      const w = l.w > 3 ? l.w : MAJOR.test(l.name) ? 18 : 9.1;
      const half = w / 2;
      const axis = w >= 14.5 || l.lanes >= 3 || MAJOR.test(l.name) ? 'ave' : 'st';
      if (l.dir !== 0) {
        const n = Math.max(1, Math.min(l.lanes || 1, Math.floor(w / 2.9)));
        const lw = Math.min(3.6, w / n);
        const lanes = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * lw);
        return { half, axis, fwd: l.dir > 0 ? lanes : [], back: l.dir < 0 ? lanes : [] };
      }
      const n = Math.max(1, Math.min(Math.round((l.lanes || 2) / 2), Math.floor(half / 2.9)));
      const lw = Math.min(3.6, half / n);
      const each = Array.from({ length: n }, (_, i) => (i + 0.5) * lw);
      return { half, axis, fwd: each, back: each };
    }
    const DEG = Math.PI / 180;
    // A station s m along the link's own line `line` (from its own first point, not the junction standing off it), put
    // into its points `pts` (the junctions at either end, the line's inner points and the stations so far) in order:
    // before the line's next point, after any station already put before it
    const insertAt = (pts: LinkPoint[], line: LinkPoint[], s: number) => {
      let walked = 0;
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k], b = line[k + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (walked + L >= s && L > 0) {
          const f = (s - walked) / L;
          const at = k + 2 < line.length ? pts.indexOf(b) : pts.length - 1; // (the line's last point is the junction's)
          pts.splice(at, 0, { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, lift: (a.lift ?? 0) + ((b.lift ?? 0) - (a.lift ?? 0)) * f, station: true });
          return;
        }
        walked += L;
      }
    };
    const farther = (a: number, b: number) => (Math.abs(b) > Math.abs(a) ? b : a); // (the lift farther from grade)
    // The signals standing along a street, clear of the junctions at its ends (a pedestrian crossing's lights): s m
    // along the link's own line where each stands within its roadway (and SIGNAL_CLEAR m of either end)
    const signalCells = new Map<number, number[]>();
    {
      const sig = GEO.roadGraph.signals;
      for (let i = 0; i + 1 < sig.length; i += 2) {
        const key = Math.floor(sig[i] / 64) * 100003 + Math.floor(sig[i + 1] / 64);
        let list = signalCells.get(key);
        if (!list) signalCells.set(key, (list = []));
        list.push(sig[i], sig[i + 1]);
      }
    }
    const signalsAlong = (l: StreetLink): number[] => {
      const out: number[] = [];
      const seen = new Set<number>();
      let walked = 0;
      for (let k = 0; k + 1 < l.pts.length; k++) {
        const a = l.pts[k], b = l.pts[k + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L > 0) {
          for (let i = Math.floor((Math.min(a.x, b.x) - 20) / 64); i <= Math.floor((Math.max(a.x, b.x) + 20) / 64); i++) {
            for (let j = Math.floor((Math.min(a.z, b.z) - 20) / 64); j <= Math.floor((Math.max(a.z, b.z) + 20) / 64); j++) {
              const list = signalCells.get(i * 100003 + j) ?? [];
              for (let m = 0; m < list.length; m += 2) {
                const t = ((list[m] - a.x) * (b.x - a.x) + (list[m + 1] - a.z) * (b.z - a.z)) / (L * L);
                if (t < 0 || t > 1) continue;
                const d = Math.abs((list[m] - a.x) * (b.z - a.z) - (list[m + 1] - a.z) * (b.x - a.x)) / L;
                const s = walked + t * L;
                const key = Math.round(list[m] * 10) * 1e6 + Math.round(list[m + 1] * 10);
                if (d > l.w / 2 + 1.5 || s < SIGNAL_CLEAR || s > l.len - SIGNAL_CLEAR || seen.has(key)) continue;
                seen.add(key);
                out.push(s);
              }
            }
          }
        }
        walked += L;
      }
      return out.sort((p, q) => p - q);
    };
    for (const l of links) {
      const A = junction(find(l.a));
      const B = junction(find(l.b));
      // (a street looping back to its own junction, a circuit round a block of a fraccionamiento: out and back from a
      // station half way round it; a short one, the junction's own connector, goes)
      if (A === B && l.len < 40) continue;
      // a junction on a bridge or ramp stands as high as the highest of the links' ends meeting there (down in an
      // underpass's cut, as low as the lowest)
      A.lift = farther(A.lift || 0, l.pts[0].lift || 0);
      B.lift = farther(B.lift || 0, l.pts[l.pts.length - 1].lift || 0);
      const pts: LinkPoint[] = [{ x: A.x, z: A.z, lift: l.pts[0].lift || 0 }, ...l.pts.slice(1, -1), { x: B.x, z: B.z, lift: l.pts[l.pts.length - 1].lift || 0 }];
      // a raised (or sunk) link's lift along each run: the link's points from one station to the next
      const raised = pts.some((p) => (p.lift ?? 0) !== 0);
      // A junction made of several a few metres apart stands off its links' own ends (in a divided road's median, 10 m
      // and more from either roadway): the chord from it would lean across the roadway all the way to the next
      // station. Each such end gets a station of its own on the link, a junction's approach from there in, and the
      // rest of the link keeps to its road
      const ownA = l.pts[0], ownB = l.pts[l.pts.length - 1];
      const offA = Math.hypot(A.x - ownA.x, A.z - ownA.z), offB = Math.hypot(B.x - ownB.x, B.z - ownB.z);
      let approachA = false, approachB = false;
      if (!raised) {
        const reach = (off: number) => Math.max(15, 2 * off);
        const sA = offA > CHORD_STRAY ? reach(offA) : 0, sB = offB > CHORD_STRAY ? reach(offB) : 0;
        const at: number[] = [];
        if (sA + sB + 15 < l.len) {
          if (sA) at.push(sA);
          if (sB) at.push(l.len - sB);
          approachA = sA > 0;
          approachB = sB > 0;
        }
        // (and a station under each signal along it, for its stop: 8.)
        for (const s of signalsAlong(l)) if (at.every((o) => Math.abs(o - s) > 5)) at.push(s);
        // (in order along the line: insertAt puts each after the ones before it)
        for (const s of at.sort((p, q) => p - q)) insertAt(pts, l.pts, s);
      }
      if (A === B) insertAt(pts, l.pts, l.len / 2); // (the loop's half-way station)
      // stations along it: the ends, the approaches' ends above, and every bend over 12° (or point where the road
      // strays CHORD_STRAY off the chord) at least 15 m from the last station and from the far end (on a bridge or down
      // an underpass every bend over 3° at least 8 m on: the traffic drives straight from station to station, and the
      // chord of a curving deck runs off it, into the air). A lane any obstacle stands in is dropped for its whole
      // run, so a chord that wanders off its road loses lanes, paint and all, for hundreds of metres
      const [minTurn, minRun] = raised ? [3 * DEG, 8] : [12 * DEG, 15];
      const stations = [A];
      let last = pts[0];
      let lastK = 0;
      let rest = l.len;
      // How far the road strays from a chord from the last station on to p2, at the points between: a long, gentle
      // curve (each bend under minTurn) laid as one chord would leave its lanes metres off the road mid-way, on the
      // curbs (the Libramiento's 700 m sweeps)
      const strays = (k: number) => {
        const p2 = pts[k + 1];
        const ux = p2.x - last.x, uz = p2.z - last.z;
        const L = Math.hypot(ux, uz) || 1;
        for (let m = lastK + 1; m <= k; m++) if (Math.abs((pts[m].x - last.x) * uz - (pts[m].z - last.z) * ux) / L > CHORD_STRAY) return true;
        return false;
      };
      for (let k = 1; k < pts.length - 1; k++) {
        const p1 = pts[k];
        const p2 = pts[k + 1];
        const d0 = Math.hypot(p1.x - last.x, p1.z - last.z);
        rest -= Math.hypot(p1.x - pts[k - 1].x, p1.z - pts[k - 1].z);
        let turn = Math.abs(Math.atan2(p2.z - p1.z, p2.x - p1.x) - Math.atan2(p1.z - last.z, p1.x - last.x));
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (!p1.station && ((turn < minTurn && !strays(k)) || d0 < minRun || rest < minRun)) continue;
        const s: RoadNode = { x: p1.x, z: p1.z, hx: 0, hz: 0, signal: false, in: [], out: [], general: true, shape: true, lift: p1.lift || 0, arms: [], id: -1, sideCount: 0, groupCount: 0 };
        nodes.push(s);
        stations.push(s);
        last = p1;
        lastK = k;
      }
      stations.push(B);
      const lanes = lanesOf(l);
      let at = 0;
      for (let k = 0; k + 1 < stations.length; k++) {
        let profile: LinkPoint[] | null = null;
        if (raised) {
          profile = [];
          while (at < pts.length && !(pts[at].x === stations[k].x && pts[at].z === stations[k].z)) at++;
          for (let m = Math.min(at, pts.length - 1); m < pts.length; m++) {
            profile.push(pts[m]);
            if (m > at && pts[m].x === stations[k + 1].x && pts[m].z === stations[k + 1].z) break;
          }
        }
        const approach = (k === 0 && approachA) || (k === stations.length - 2 && approachB);
        runs.push({ from: stations[k], to: stations[k + 1], ...lanes, profile, name: l.name || '', minor: l.minor, approach });
      }
    }
    console.info(`[roads] centreline streets: ${links.length} links not on the grid, ${runs.length} straight runs`);
    return runs;
  }

  // 5. Directed edges between intersections, keeping only the lanes clear of obstacles node to node
  let edges: RoadEdge[] = [];
  // (live, arms, stop lines, ids, sides and the oncoming edge: filled in below, steps 5-9)
  const unplaced = { oneWay: -1, live: false, inArm: null, outArm: null, squeezed: false, sx: 0, sz: 0, len: 0, id: -1, inSide: -1, outSide: -1, axisIndex: -1, clx: 0, clz: 0, opposite: null };
  function addEdge(from: RoadNode, to: RoadNode, axis: RoadAxis, x0: number, z0: number, x1: number, z1: number, lanes: number[], half: number) {
    const span = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / span;
    const dz = (z1 - z0) / span;
    const open = lanes.filter((o) => {
      const ax = x0 - dz * o;
      const az = z0 + dx * o;
      const cx = Math.abs(dz) * LANE_CLEAR;
      const cz = Math.abs(dx) * LANE_CLEAR;
      return !blocked(Math.min(ax, ax + dx * span) - cx, Math.max(ax, ax + dx * span) + cx,
        Math.min(az, az + dz * span) - cz, Math.max(az, az + dz * span) + cz);
    });
    if (!open.length) return;
    edges.push({ from, to, axis, x0, z0, dx, dz, rx: -dz, rz: dx, span, half, lanes: open.sort((p, q) => p - q), moves: [], cand: lanes, ...unplaced });
  }
  for (const a of avenues) {
    a.nodes.sort((m, n) => m.z - n.z);
    for (let k = 0; k + 1 < a.nodes.length; k++) {
      const n0 = a.nodes[k];
      const n1 = a.nodes[k + 1];
      let connected = true;
      for (let z = Math.ceil(n0.z); z <= n1.z && connected; z++) connected = a.free[z - Z_MIN] === 1;
      if (!connected) continue;
      const set = a.lanesAt((n0.z + n1.z) * 0.5) ?? a.lanesAt(n0.z) ?? a.lanesAt(n1.z);
      if (!set) continue;
      addEdge(n0, n1, 'ave', a.x, n0.z, a.x, n1.z, set.south.map((o) => -o), a.half);
      addEdge(n1, n0, 'ave', a.x, n1.z, a.x, n0.z, set.north, a.half);
    }
  }
  for (const p of pieces) {
    // a cross street runs between its two avenue nodes, through any centreline junctions on it (see 4b)
    if (!p.from || !p.to) continue; // (both set in 4.)
    const chain = [p.from, ...(p.mids ?? []).sort((m, n) => m.x - n.x), p.to];
    for (let k = 0; k + 1 < chain.length; k++) {
      const m = chain[k];
      const n = chain[k + 1];
      addEdge(m, n, 'st', m.x, p.z, n.x, p.z, p.east, p.half);
      addEdge(n, m, 'st', n.x, p.z, m.x, p.z, p.west, p.half);
    }
  }
  // Centreline streets: any direction, so their lanes are checked for obstacles every 2.5 m (clear of the junctions,
  // where neighbouring corners would get in the way of the test) instead of over one bounding box
  const laneOpen = (x0: number, z0: number, dx: number, dz: number, span: number, o: number) => {
    const clear = Math.min(12, span / 2);
    for (let t = clear; t <= span - clear + 1e-6; t += 2.5) {
      if (blockedOnStreet(x0 + dx * t - dz * o, z0 + dz * t + dx * o, LANE_CLEAR)) return false;
    }
    return true;
  };
  function addEdgeGeneral(from: RoadNode, to: RoadNode, axis: RoadAxis, lanes: number[], half: number, divided: boolean | undefined, profile: LinkPoint[] | null = null, name = '', approach = false, minor = false) {
    const x0 = from.x;
    const z0 = from.z;
    const span = Math.hypot(to.x - x0, to.z - z0);
    if (span < 8) return;
    const dx = (to.x - x0) / span;
    const dz = (to.z - z0) / span;
    // (a junction's approach leans across its roadway, to the junction's middle: the intersection's own ground)
    const open = approach ? lanes : lanes.filter((o) => laneOpen(x0, z0, dx, dz, span, o));
    if (!open.length) return;
    // on a bridge or ramp: [distance from `from` along the edge, lift (m over the ground)], ascending (see edgeLift)
    // (every point of a raised link's profile has its lift)
    const lift = profile ? profile.map((p): [number, number] => [(p.x - x0) * dx + (p.z - z0) * dz, p.lift ?? 0]).sort((p, q) => p[0] - q[0]) : null;
    // (`name`: the street's, OpenStreetMap's; the traffic weighs the busiest avenues by it, traffic-demand.ts)
    edges.push({ from, to, axis, x0, z0, dx, dz, rx: -dz, rz: dx, span, half, lanes: open.sort((p, q) => p - q), moves: [], general: true, cand: lanes, divided: !!divided, lift, name, minor, ...unplaced });
  }
  // A divided road drawn as two one-way roadways between the same two junctions (most of the Bowery) runs both ways
  // along one centreline here: each way keeps to the right of it, as on a two-way street, and the road is as wide as
  // both roadways. Not on a bridge or down an underpass: each roadway there has a deck or a cut of its own, and its
  // traffic keeps to it (on the other's centreline it would drive off the deck, in the air)
  const travel = (r: StreetRun) => (r.fwd.length ? [r.from, r.to] : [r.to, r.from]);
  const oneWays = new Map<RoadNode, Map<RoadNode, StreetRun>>(); // node -> next node -> the one-way run from one to the other
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length) continue;
    const [a, b] = travel(r);
    let next = oneWays.get(a);
    if (!next) oneWays.set(a, (next = new Map<RoadNode, StreetRun>()));
    next.set(b, r);
  }
  for (const r of genRuns) {
    if (!r.fwd.length === !r.back.length || r.divided || r.profile) continue;
    const [a, b] = travel(r);
    const o = oneWays.get(b)?.get(a);
    if (!o || o.divided || o.profile) continue;
    for (const q of [r, o]) {
      const lanes = q.fwd.length ? q.fwd : q.back;
      const right = lanes.map((x) => x - lanes[0] + 1.8); // as on a two-way street, from 1.8 m right of the centreline
      if (q.fwd.length) q.fwd = right;
      else q.back = right;
      q.divided = true;
    }
    r.half = o.half = r.half + o.half;
    if (r.half >= 7.25) r.axis = o.axis = 'ave'; // as wide as a major road (see lanesOf)
  }
  for (const r of genRuns) {
    if (r.fwd.length) addEdgeGeneral(r.from, r.to, r.axis, r.fwd, r.half, r.divided, r.profile, r.name, r.approach, r.minor);
    if (r.back.length) addEdgeGeneral(r.to, r.from, r.axis, r.back, r.half, r.divided, r.profile, r.name, r.approach, r.minor);
  }
  // Two edges from one node to the same next one (a service road whose ends were drawn onto its main road's junctions)
  // would drive through each other: keep the grid's, else the one with the most lanes
  const keptEdge = new Map<RoadNode, Map<RoadNode, RoadEdge>>();
  const edgeRank = (e: RoadEdge) => (e.general ? 0 : 1000) + e.lanes.length * 10 + e.half / 100;
  for (const e of edges) {
    let to = keptEdge.get(e.from);
    if (!to) keptEdge.set(e.from, (to = new Map<RoadNode, RoadEdge>()));
    const o = to.get(e.to);
    if (!o || edgeRank(e) > edgeRank(o)) to.set(e.to, e);
  }
  edges = edges.filter((e) => keptEdge.get(e.from)?.get(e.to) === e);
  // ...and where only some of the junctions on both sides of its median became one (Pike St), the stretches of its two
  // roadways that run on top of each other the same way (but on bridges and down underpasses, as above)
  {
    const oneWay = edges.filter((e) => e.general && !e.divided && !e.lift && e.cand[0] <= 0); // lanes about its centreline
    const cells = new Map<number, RoadEdge[]>(); // 16 m cells -> the one-way edges passing within 4 m
    oneWay.forEach((e, i) => {
      e.oneWay = i;
      for (let t = 0; t <= e.span; t += 8) {
        const x = e.x0 + e.dx * t;
        const z = e.z0 + e.dz * t;
        for (let ix = Math.floor((x - 4) / 16); ix <= Math.floor((x + 4) / 16); ix++) {
          for (let iz = Math.floor((z - 4) / 16); iz <= Math.floor((z + 4) / 16); iz++) {
            const k = (ix + 4096) * 8192 + (iz + 4096);
            const list = cells.get(k);
            if (!list) cells.set(k, [e]);
            else if (list[list.length - 1] !== e) list.push(e);
          }
        }
      }
    });
    // metres of e along f whose lanes overlap f's, their centres within 2 m (e's right is f's left; roadways side by
    // side, their lanes a lane's width apart, are a divided road drawn as it is, and keep their lanes)
    const onTop = (e: RoadEdge, f: RoadEdge) => {
      let hits = 0;
      for (let t = 0; t <= e.span; t += 2) {
        const px = e.x0 + e.dx * t - f.x0;
        const pz = e.z0 + e.dz * t - f.z0;
        const u = px * f.dx + pz * f.dz;
        if (u < 0 || u > f.span) continue;
        const side = px * f.rx + pz * f.rz;
        if (e.lanes.some((a) => f.lanes.some((b) => Math.abs(side - a - b) < 2))) hits += 2;
      }
      return hits;
    };
    // how far f runs to e's right (m, < 0 to its left), on average where it runs alongside it
    const beside = (e: RoadEdge, f: RoadEdge) => {
      let sum = 0, n = 0;
      for (let t = 0; t <= f.span; t += 2) {
        const px = f.x0 + f.dx * t - e.x0;
        const pz = f.z0 + f.dz * t - e.z0;
        const u = px * e.dx + pz * e.dz;
        if (u < 0 || u > e.span) continue;
        sum += px * e.rx + pz * e.rz;
        n++;
      }
      return n ? sum / n : 0;
    };
    // edge -> half width of the widest roadway running the other way on top of it, and how far to its right that runs
    const partner = new Map<RoadEdge, { half: number; side: number }>();
    const tested = new Set<number>();
    for (const list of cells.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const e = list[i];
          const f = list[j];
          if (e.dx * f.dx + e.dz * f.dz > -0.94) continue; // the other way, within 20°
          const key = Math.min(e.oneWay, f.oneWay) * 65536 + Math.max(e.oneWay, f.oneWay);
          if (tested.has(key)) continue;
          tested.add(key);
          if (Math.max(onTop(e, f), onTop(f, e)) < 6) continue;
          for (const [a, b] of [[e, f], [f, e]]) {
            const known = partner.get(a);
            if (!known || b.half > known.half) partner.set(a, { half: b.half, side: beside(a, b) });
          }
        }
      }
    }
    // Each keeps to the right of the line half way between them, as on a two-way street: from 1.8 m right of its own
    // centreline where they run on top of each other, less where the other runs a little to its left already (a
    // divided road drawn as two roadways side by side, overlapping: pushed out the whole 1.8 m, its lanes would run off
    // its outer curb, onto the grass beyond, Paseo de la Loma's round the park)
    for (const [e, { half: other, side }] of partner) {
      const mid = Math.min(0, side / 2);
      e.lanes = e.cand.map((o) => o - e.cand[0] + 1.8 + mid).filter((o) => laneOpen(e.x0, e.z0, e.dx, e.dz, e.span, o));
      e.half += other;
      if (e.half >= 7.25) e.axis = 'ave'; // as wide as a major road (see lanesOf)
      e.divided = true;
    }
    edges = edges.filter((e) => e.lanes.length);
  }
  // Edges no vehicle could both reach and leave (dead ends, and roads reached only from them) are dropped once the
  // moves are known (7.); know them already, so that no road keeps clear of a dead one merging with it or forking off it
  {
    const outsOf = new Map<RoadNode, RoadEdge[]>();
    for (const e of edges) {
      let outs = outsOf.get(e.from);
      if (!outs) outsOf.set(e.from, (outs = []));
      outs.push(e);
    }
    const live = largestComponent(edges, (e) => (outsOf.get(e.to) ?? []).filter((f) => f.to !== e.from && e.dx * f.dx + e.dz * f.dz >= -0.5));
    for (const e of edges) e.live = live.has(e);
  }
  const liveArm = (a: RoadArm) => !!(a.in?.live || a.out?.live);

  // The roads meeting at each node ("arms": one per direction a road leaves it in), from the edges into and out of it:
  // { ux, uz } (unit, away from the node), half (the widest roadway's half width), ave (a major road's), and its edge
  // `in` and edge `out`, if any. The two ways of a two-way street share an arm, and so do the two one-way roadways of a
  // divided road (within 20° of each other); a second road arriving or leaving within 20° of another (where streets
  // merge or fork) gets an arm of its own. With `only`, for just the nodes in that set.
  function computeArms(list: RoadEdge[], only: Set<RoadNode> | null = null) {
    for (const n of only ?? nodes) n.arms = [];
    const ends = new Map<RoadNode, EdgeEnd[]>(); // node -> the edge ends there, in the order the edges come
    list.forEach((e, i) => {
      for (const [n, role, ux, uz] of [[e.from, 'out', e.dx, e.dz], [e.to, 'in', -e.dx, -e.dz]] as const) {
        if (only && !only.has(n)) continue;
        if (role === 'out') e.outArm = null;
        else e.inArm = null;
        let at = ends.get(n);
        if (!at) ends.set(n, (at = []));
        at.push({ e, role, ux, uz, order: 2 * i + (role === 'in' ? 1 : 0) });
      }
    });
    const armed = (q: EdgeEnd) => (q.role === 'out' ? q.e.outArm : q.e.inArm);
    for (const [n, at] of ends) {
      // arms in the order of their first edge end, each pointing along it
      const newArm = (q: EdgeEnd) => {
        // (lead and wide: set once all the node's arms are known; side and group: in sidesAndGroups)
        const a: RoadArm = { ux: q.ux, uz: q.uz, half: 0, ave: false, in: null, out: null, order: q.order, wide: 0, side: -1, group: -1 };
        n.arms.push(a);
        return a;
      };
      const join = (a: RoadArm, q: EdgeEnd) => {
        a[q.role] = q.e;
        if (q.role === 'out') q.e.outArm = a;
        else q.e.inArm = a;
        a.half = Math.max(a.half, q.e.half);
        a.ave = a.ave || q.e.axis === 'ave';
        a.order = Math.min(a.order, q.order);
      };
      // both ways of a two-way street
      for (const q of at) {
        if (q.role !== 'out') continue;
        const r = at.find((p) => p.role === 'in' && p.e.from === q.e.to);
        if (!r) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // one-way roadways within 20°, one each way: a divided road's, the best aligned first
      const pairs: [number, EdgeEnd, EdgeEnd][] = [];
      for (const q of at) {
        if (q.role !== 'out' || armed(q)) continue;
        for (const r of at) {
          const d = q.ux * r.ux + q.uz * r.uz;
          if (r.role === 'in' && !armed(r) && d > 0.94) pairs.push([d, q, r]);
        }
      }
      pairs.sort((p, q) => q[0] - p[0]);
      for (const [, q, r] of pairs) {
        if (armed(q) || armed(r)) continue;
        const a = newArm(q.order < r.order ? q : r);
        join(a, q);
        join(a, r);
      }
      // and every other road alone
      for (const q of at) if (!armed(q)) join(newArm(q), q);
      n.arms.sort((a, b) => a.order - b.order);
      // an arm within 20° of an earlier one (where roads merge or fork) crosses the other roads as one with it (its
      // lead), as wide as the widest of them
      for (const a of n.arms) {
        a.lead = n.arms.find((b) => b.lead === b && b.ux * a.ux + b.uz * a.uz > 0.94) ?? a;
        a.lead.wide = Math.max(a.lead === a ? 0 : a.lead.wide, a.half);
      }
    }
  }
  computeArms(edges);
  // A centreline node where just one road goes on, bending less than 35°, is a shape node: no corner to stop at (nor a
  // fork: a road splitting in two live ones within 20°)
  const bends = (n: RoadNode) => {
    const leads = n.arms.filter((a) => a.lead === a);
    const forks = leads.some((l) => n.arms.filter((a) => a.lead === l && liveArm(a)).length > 1);
    return leads.length === 2 && leads[0].ux * leads[1].ux + leads[0].uz * leads[1].uz < -0.82 && !forks;
  };
  for (const n of nodes) if (n.general && !n.shape && bends(n)) n.shape = true;
  // Where two roads leave a node within 20° of each other (they merge or fork there), how far out every lane of one
  // first keeps 3 m (a car's width and some) from every lane of the other
  const lanesOut = (a: RoadArm, r: number, out: number[]) => {
    out.length = 0;
    for (const e of [a.in, a.out]) {
      if (!e?.live) continue;
      const t = e === a.out ? r : e.span - r; // r from its start leaving, r before its end arriving
      for (const o of e.lanes) out.push(e.x0 + e.dx * t + e.rx * o, e.z0 + e.dz * t + e.rz * o);
    }
    return out;
  };
  const lanesA: number[] = [];
  const lanesB: number[] = [];
  function apart(a: RoadArm, b: RoadArm) {
    for (let r = 2; r < 45; r++) {
      lanesOut(a, r, lanesA);
      lanesOut(b, r, lanesB);
      let near = Infinity;
      for (let i = 0; i < lanesA.length; i += 2) {
        for (let j = 0; j < lanesB.length; j += 2) near = Math.min(near, Math.hypot(lanesA[i] - lanesB[j], lanesA[i + 1] - lanesB[j + 1]));
      }
      if (near >= 3) return r;
    }
    return 45;
  }
  // How far before node n an edge arriving along `arm` stops: clear of every road crossing it (at whatever angle: its
  // curb corner reaches past the crossing road's far side by half its own width over the tangent) plus the crosswalk,
  // and clear of the lanes of a road merging with it or forking off it
  const goesOn = (p: RoadArm, q: RoadArm) => p.ux * q.ux + p.uz * q.uz < 0 && Math.abs(p.ux * q.uz - p.uz * q.ux) < 0.26; // q within 15° of straight on from p
  function stopBack(n: RoadNode, arm: RoadArm) {
    if (n.shape) return 1;
    const a = arm.lead ?? arm; // (every arm has its lead by now)
    let ext = 0;
    let fork = 0;
    for (const b of n.arms) {
      if (b === arm) continue;
      if (b.lead === a) {
        if (liveArm(arm) && liveArm(b)) fork = Math.max(fork, apart(arm, b) + 1); // side by side rather than across
        continue;
      }
      if (b.lead !== b) continue; // crossing as one with its lead
      // the same road going on (into either of two roads forking there, or out of either of two merging)
      if (n.arms.some((p) => p.lead === a && n.arms.some((q) => q.lead === b && goesOn(p, q)))) continue;
      const cos = a.ux * b.ux + a.uz * b.uz;
      const sin = Math.abs(a.ux * b.uz - a.uz * b.ux);
      ext = Math.max(ext, (b.wide + a.wide * Math.abs(cos)) / sin);
    }
    return Math.max(ext > 0 ? Math.min(ext, 20) + CROSSWALK : 2, fork);
  }
  // nodes where grid and centreline roads meet: grid edges stop no closer than the centreline arms need either
  for (const e of edges) if (e.general) e.from.mixed = e.to.mixed = true;

  // Edges run between stop lines: past the intersection box and its crosswalk at both ends (grid edges by the box,
  // centreline ones by the roads crossing them; where both meet, the further of the two). On a short centreline link
  // between acute corners the two pull in together, keeping at least 10 m (or half the link) to queue on.
  function place(e: RoadEdge) {
    const back = (n: RoadNode, arm: RoadArm) => {
      if (e.general) return stopBack(n, arm);
      const grid = (e.axis === 'ave' ? n.hz : n.hx) + CROSSWALK;
      return n.mixed && !n.general ? Math.max(grid, stopBack(n, arm)) : grid;
    };
    if (!e.outArm || !e.inArm) throw new Error('[roads] an edge without its arms'); // (computeArms gave every end one)
    let b0 = back(e.from, e.outArm);
    let b1 = back(e.to, e.inArm);
    const keep = Math.min(10, e.span * 0.5);
    e.squeezed = false;
    if (e.general && e.span - b0 - b1 < keep) {
      const k = (e.span - keep) / (b0 + b1);
      b0 *= k;
      b1 *= k;
      e.squeezed = !e.to.shape; // its stop line closer to the roads crossing ahead than they need (see the end of 6.)
    }
    e.sx = e.x0 + e.dx * b0;
    e.sz = e.z0 + e.dz * b0;
    e.len = e.span - b0 - b1;
  }
  for (const e of edges) place(e);
  const placed = edges; // (see 7.)
  const genCreated = edges.filter((e) => e.general).length;
  edges = edges.filter((e) => e.len > (e.general ? 4 : 6));

  // Paint describes the physical streets, including dead ends and roads AI traffic cannot circulate through.
  // Snapshot their geometry before routing moves stop lines, drops edges and renumbers the surviving junctions.
  // (with their lifts: the paint climbs the ramps and crosses the bridges with the traffic, road-paint.ts strip)
  const paintNodes = new Map(nodes.map((n, id): [RoadNode, PaintNode] => [n, { id, x: n.x, z: n.z, shape: n.shape }]));
  const paintOf = new Map<RoadEdge, PaintEdge>(); // (to move a stop line in the paint as well, 9.)
  const paintEdges = edges.map((e): PaintEdge => {
    const { from, to, axis, x0, z0, sx, sz, dx, dz, rx, rz, span, len, half, lanes, lift } = e;
    const pFrom = paintNodes.get(from), pTo = paintNodes.get(to);
    if (!pFrom || !pTo) throw new Error('[roads] an edge off the node list'); // (every node is in it)
    const paint = { from: pFrom, to: pTo, axis, x0, z0, sx, sz, dx, dz, rx, rz, span, len, half, lanes, lift, minor: e.minor === true };
    paintOf.set(e, paint);
    return paint;
  });

  // 6. Movements at each intersection (no U-turns) and the lane each lane leads to, along obstacle-free curves:
  //    straight on, lane i keeps to lane i + k ahead, k chosen to use as many lanes there as possible with the least
  //    sideways shift; turns go from the lane nearest the turn into the lane nearest it. Lanes left with no way on
  //    (where the road ends or narrows) turn alongside the turn lane, or merge. Across the road, lanes always run
  //    left turns, straight on, right turns, into lanes in the same order, so no two paths from one approach cross.
  const lateral = (e: RoadEdge, i: number) => e.x0 * e.rx + e.z0 * e.rz + e.lanes[i];
  const ORDER = { L: 0, S: 1, R: 2 };
  function pathClear(e: RoadEdge, i: number, f: RoadEdge, j: number) {
    const c = makeCurve(e, i, f, j);
    const p = { x: 0, z: 0, dx: 0, dz: 0 };
    const street = e.general || f.general; // through a centreline junction: tested like its lanes
    for (let k = 1; k < 10; k++) {
      curvePoint(c, c.len * k / 10, p);
      if (street ? blockedOnStreet(p.x, p.z, 0.8) : blocked(p.x - 1, p.x + 1, p.z - 1, p.z + 1)) return false;
    }
    return true;
  }
  function inOrder(e: RoadEdge, m: RoadMove, i: number, j: number) {
    for (const o of e.moves) {
      for (let k = 0; k < e.lanes.length; k++) {
        if (k === i || o.out[k] < 0) continue;
        // o from k is right of m from i: by its kind of turn, then (two of a kind, where a road forks) by how far right
        // it bends
        const right = ORDER[o.turn] - ORDER[m.turn] || (o === m ? o.out[k] - j : Math.sign(o.cross - m.cross));
        if (k < i ? right > 0 : right < 0) return false;
      }
    }
    return true;
  }
  function nearestLane(e: RoadEdge, i: number, f: RoadEdge) {
    let j = 0;
    for (let k = 1; k < f.lanes.length; k++) {
      if (Math.abs(lateral(f, k) - lateral(e, i)) < Math.abs(lateral(f, j) - lateral(e, i))) j = k;
    }
    return j;
  }
  // Let lane i of e make move m into lane j of its edge (clamped to the lanes there), if the way is clear
  function link(e: RoadEdge, m: RoadMove, i: number, j: number) {
    j = Math.max(0, Math.min(m.to.lanes.length - 1, j));
    if (m.out[i] < 0 && inOrder(e, m, i, j) && pathClear(e, i, m.to, j)) m.out[i] = j;
    return m.out[i] >= 0;
  }
  function serveEveryLane(e: RoadEdge) {
    const n = e.lanes.length;
    for (let i = 0; i < n; i++) {
      if (e.moves.some((m) => m.out[i] >= 0)) continue;
      const turnLane = (m: RoadMove, k: number) => link(e, m, i, m.turn === 'L' ? k : m.to.lanes.length - 1 - k);
      const side = (m: RoadMove) => (m.turn === 'L' ? i : n - 1 - i); // lanes between i and the turn's side of the road
      if (
        e.moves.some((m) => m.turn !== 'S' && side(m) <= (n - 1) / 2 && turnLane(m, side(m))) ||
        e.moves.some((m) => m.turn === 'S' && link(e, m, i, nearestLane(e, i, m.to))) ||
        e.moves.some((m) => m.turn !== 'S' && turnLane(m, side(m)))
      ) continue;
      e.moves.some((m) => m.to.lanes.some((_, j) => link(e, m, i, j)));
    }
    e.moves = e.moves.filter((m) => m.out.some((j) => j >= 0));
  }
  for (const e of edges) e.from.out.push(e);
  for (const e of edges) {
    const n = e.lanes.length;
    for (const f of e.to.out) {
      if (f.to === e.from || e.dx * f.dx + e.dz * f.dz < -0.5) continue;
      const cross = e.dx * f.dz - e.dz * f.dx;
      e.moves.push({ to: f, turn: cross > 0.5 ? 'R' : cross < -0.5 ? 'L' : 'S', cross, out: new Array<number>(n).fill(-1) });
    }
    // the straightest first: where a road forks, the branch going most nearly straight on keeps most of its lanes
    const ahead = (m: RoadMove) => e.dx * m.to.dx + e.dz * m.to.dz;
    for (const m of e.moves.slice().sort((p, q) => ahead(q) - ahead(p))) {
      const f = m.to;
      if (m.turn === 'L') link(e, m, 0, 0);
      else if (m.turn === 'R') link(e, m, n - 1, f.lanes.length - 1);
      else {
        let best = 0;
        let bestScore = -Infinity;
        for (let k = 1 - n; k < f.lanes.length; k++) {
          const used = new Set();
          let score = 0;
          for (let i = 0; i < n; i++) {
            const j = Math.max(0, Math.min(f.lanes.length - 1, i + k));
            used.add(j);
            score -= Math.abs(lateral(f, j) - lateral(e, i));
          }
          score += 100 * used.size;
          if (score > bestScore) {
            bestScore = score;
            best = k;
          }
        }
        for (let i = 0; i < n; i++) link(e, m, i, i + best);
      }
    }
    serveEveryLane(e);
  }

  // Sides & right-of-way groups of node n's arms (see 9.)
  const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function sidesAndGroups(n: RoadNode) {
    const arms = n.arms;
    let next = 4;
    for (const a of arms) a.side = -1;
    if (!n.general) {
      // each compass side goes to the arm best aligned with it, within 15°
      CARD.forEach(([cx, cz], c) => {
        let best: RoadArm | null = null;
        let bd = 0.966;
        for (const a of arms) {
          const d = a.ux * cx + a.uz * cz;
          if (a.side < 0 && d > bd) {
            bd = d;
            best = a;
          }
        }
        if (best) best.side = c;
      });
    }
    for (const a of arms) if (a.side < 0) a.side = next++;
    n.sideCount = Math.max(4, next);
    // roads: arms paired with the one most nearly opposite (beyond 145°), the likeliest pairs first: the straightest,
    // and of two about as straight, the one about as wide (a side street merging into a road nearly head on doesn't
    // take over the road's other side)
    const pairs: [number, RoadArm, RoadArm][] = [];
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const d = arms[i].ux * arms[j].ux + arms[i].uz * arms[j].uz;
        if (d < -0.82) pairs.push([d + 0.02 * Math.abs(arms[i].half - arms[j].half), arms[i], arms[j]]);
      }
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const mates = new Map<RoadArm, RoadArm>();
    for (const [, a, b] of pairs) {
      if (mates.has(a) || mates.has(b)) continue;
      mates.set(a, b);
      mates.set(b, a);
    }
    const roads: NodeRoad[] = [];
    const done = new Set<RoadArm>();
    for (const a of arms) {
      if (done.has(a)) continue;
      done.add(a);
      const mate = mates.get(a);
      if (mate) done.add(mate);
      const members = mate ? [a, mate] : [a];
      roads.push({ members, group: -1, rank: Math.max(...members.map((m) => (m.ave ? 100 : 0) + m.half)) });
    }
    let groups = 0;
    if (!n.general) {
      // on the grid the road with a north-south arm is the avenue (0), the one with an east-west arm the street (1)
      for (const r of roads) {
        if (r.members.some((m) => m.side === 2 || m.side === 3)) r.group = 0;
        else if (r.members.some((m) => m.side === 0 || m.side === 1)) r.group = 1;
      }
      groups = 2;
    }
    roads.sort((p, q) => q.rank - p.rank);
    for (const r of roads) if (r.group < 0) r.group = groups++;
    for (const r of roads) for (const m of r.members) m.group = r.group;
    n.groupCount = Math.max(2, groups);
  }

  // A short link squeezed between two corners may leave its stop line inside the road crossing ahead, where whoever
  // waits on it stands in the way of the traffic crossing there (of other roads, which share the junction with it).
  // Where the link comes off a bend (a shape node: nothing crosses there), its stop line goes back as far as that
  // takes, as long as a car waiting there still stands on the link (not around the bend, in the way of the next);
  // a link that can't keep clear even so is dropped.
  const inOf = new Map<RoadNode, RoadEdge[]>();
  for (const e of edges) {
    let ins = inOf.get(e.to);
    if (!ins) inOf.set(e.to, (ins = []));
    ins.push(e);
  }
  const HALF_CAR = 2.3;
  const HALF_WIDE = 0.95;
  const pathPt = { x: 0, z: 0, dx: 0, dz: 1 };
  function inTheWay(e: RoadEdge) {
    const n = e.to;
    sidesAndGroups(n);
    // a car standing at each of its lanes' stop line
    const cars = e.lanes.map((o) => [e.sx + e.dx * (e.len - HALF_CAR) + e.rx * o, e.sz + e.dz * (e.len - HALF_CAR) + e.rz * o]);
    for (const o of inOf.get(n) ?? []) {
      if (o === e || o.inArm?.group === e.inArm?.group) continue;
      for (const m of o.moves) {
        for (let i = 0; i < o.lanes.length; i++) {
          if (m.out[i] < 0) continue;
          const c = makeCurve(o, i, m.to, m.out[i]);
          for (let s = 0; s <= c.len; s += 1) {
            curvePoint(c, s, pathPt);
            for (const [cx, cz] of cars) {
              const dx = pathPt.x - cx;
              const dz = pathPt.z - cz;
              if (dx * dx + dz * dz > 36) continue;
              // how deep a car on the path overlaps it (separating axes)
              let depth = Infinity;
              for (const [ax, az] of [[e.dx, e.dz], [e.rx, e.rz], [pathPt.dx, pathPt.dz], [-pathPt.dz, pathPt.dx]]) {
                const ra = HALF_CAR * Math.abs(e.dx * ax + e.dz * az) + HALF_WIDE * Math.abs(e.rx * ax + e.rz * az);
                const rb = HALF_CAR * Math.abs(pathPt.dx * ax + pathPt.dz * az) + HALF_WIDE * Math.abs(pathPt.dz * ax - pathPt.dx * az);
                depth = Math.min(depth, ra + rb - Math.abs(dx * ax + dz * az));
              }
              if (depth > 0.25) return true;
            }
          }
        }
      }
    }
    return false;
  }
  const inTheWayOut = new Set<RoadEdge>();
  for (const e of edges) {
    if (!e.squeezed || !e.from.shape || !inTheWay(e)) continue;
    while (e.len > 6 && inTheWay(e)) e.len = Math.max(5.5, e.len - 1);
    if (inTheWay(e)) inTheWayOut.add(e); // even so
  }
  if (inTheWayOut.size) {
    edges = edges.filter((e) => !inTheWayOut.has(e));
    for (const e of edges) e.moves = e.moves.filter((m) => !inTheWayOut.has(m.to));
  }

  // 7. Keep the largest strongly connected set of edges so no vehicle can ever reach a dead end
  edges.forEach((e, i) => (e.id = i));
  const visited = new Uint8Array(edges.length);
  const order: RoadEdge[] = [];
  for (const root of edges) {
    if (visited[root.id]) continue;
    visited[root.id] = 1;
    const stack: [RoadEdge, number][] = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const e = top[0];
      if (top[1] < e.moves.length) {
        const f = e.moves[top[1]++].to;
        if (!visited[f.id]) {
          visited[f.id] = 1;
          stack.push([f, 0]);
        }
      } else {
        order.push(e);
        stack.pop();
      }
    }
  }
  const incoming = edges.map((): RoadEdge[] => []);
  for (const e of edges) for (const m of e.moves) incoming[m.to.id].push(e);
  const comp = new Int32Array(edges.length).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k].id] >= 0) continue;
    const stack = [order[k]];
    comp[order[k].id] = c;
    let size = 0;
    while (stack.length) {
      const e = stack.pop();
      if (!e) break;
      size++;
      for (const p of incoming[e.id]) {
        if (comp[p.id] < 0) {
          comp[p.id] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestComp = c;
    }
    c++;
  }
  const genShortKept = edges.filter((e) => e.general).length;
  const genLost = edges.filter((e) => e.general && comp[e.id] !== bestComp);
  edges = edges.filter((e) => comp[e.id] === bestComp);
  // Roads kept clear of a road merging with them or forking off them that is gone now (too short, or no way on from it
  // after all) get their stop lines placed again without it
  const kept = new Set(edges);
  const dropped = placed.filter((e) => e.live && !kept.has(e));
  if (dropped.length) {
    const redo = new Set<RoadNode>();
    for (const e of dropped) {
      e.live = false;
      redo.add(e.from).add(e.to);
    }
    computeArms(placed, redo);
    for (const n of redo) if (n.general && !n.shape && bends(n)) n.shape = true;
    for (const e of edges) if (redo.has(e.from) || redo.has(e.to)) place(e);
  }
  console.info(`[roads] centreline edges: ${genCreated} with clear lanes, ${genShortKept} long enough, ${genShortKept - genLost.length} connected`);
  for (const e of edges) {
    e.moves = e.moves.filter((m) => comp[m.to.id] === bestComp);
    serveEveryLane(e);
    // Lanes still leading nowhere (every curve out of them grazes a curb or obstacle): send them on to the nearest lane
    // of the straightest move anyway, so every lane always has a way on
    for (let i = 0; i < e.lanes.length; i++) {
      if (!e.moves.length || e.moves.some((m) => m.out[i] >= 0)) continue;
      const m = e.moves.find((q) => q.turn === 'S') ?? e.moves[0];
      m.out[i] = nearestLane(e, i, m.to);
    }
  }
  edges.forEach((e, i) => (e.id = i));

  for (const n of nodes) {
    n.in = [];
    n.out = [];
  }
  for (const e of edges) {
    e.from.out.push(e);
    e.to.in.push(e);
  }
  nodes = nodes.filter((n) => n.in.length > 0 && n.out.length > 0);
  nodes.forEach((n, i) => (n.id = i));

  // 8. Signalized intersections: the real traffic signals (OpenStreetMap highway=traffic_signals) mark their junction:
  // the nearest real junction within 26 m. The phases know an avenue and a street: the main road (group 0) runs on the
  // avenue's, and at a junction of more than two roads (a bridge landing, side streets offset across an avenue) the
  // others share the street's, the third and on giving way to the second (junctions.ts)
  // A signal with no junction near it (a pedestrian crossing's lights, or a junction with a street the traffic doesn't
  // drive, left a bend: its cross street dropped as a dead end) stops the traffic at the nearest bend within 15 m of its
  // own street (an edge there passing within its width of the signal), made a stop (midblock), or at a node of two
  // roads joining right there (within 4 m)
  const signalPts = GEO.roadGraph.signals;
  const signalled = new Map<RoadNode, number>(); // node -> how far its nearest signal is (m)
  const midblock: RoadNode[] = [];
  for (let i = 0; i < signalPts.length; i += 2) {
    const sx = signalPts[i], sz = signalPts[i + 1];
    let best: RoadNode | null = null, bd = 26, bend: RoadNode | null = null, bendD = 15;
    for (const n of nodes) {
      if (n.signal) continue;
      const d = Math.hypot(n.x - sx, n.z - sz);
      if (n.shape) {
        if (d < bendD && !n.lift && [...n.in, ...n.out].some((e) => {
          const t = Math.max(0, Math.min(e.span, (sx - e.x0) * e.dx + (sz - e.z0) * e.dz));
          return Math.hypot(e.x0 + e.dx * t - sx, e.z0 + e.dz * t - sz) < e.half + 1.5;
        })) { bendD = d; bend = n; }
      } else if (d < bd) { bd = d; best = n; }
    }
    if (!best && bend) {
      bend.shape = false;
      bend.midblock = true;
      midblock.push(bend);
      best = bend;
      bd = 0;
    }
    if (best) signalled.set(best, Math.min(bd, signalled.get(best) ?? Infinity));
  }

  // 9. Sides & right of way at each node, for traffic.ts. Its arms are its sides (one crosswalk and approach each): a
  //    grid intersection keeps east 0, west 1, south 2, north 3, any other arm counts from 4. The arms of one road (on
  //    opposite sides) form a group: vehicles of different groups never share the intersection box, and group 0 has
  //    the right of way at unsignalised corners (and the avenue phase at signals): the avenue on the grid (north-south
  //    arms 0, east-west 1), the widest road at a centreline junction.
  computeArms(edges);
  for (const n of nodes) sidesAndGroups(n);
  // The bends made stops: their edges' stop lines placed again, short of their crossing, in the paint too (its stop
  // bars and crosswalk); where that leaves an edge too short to keep (5.), the bend stays a bend, unsignalled
  for (const n of midblock) {
    const ends = [...n.in, ...n.out];
    for (const e of ends) place(e);
    if (ends.some((e) => e.len <= 4)) {
      n.shape = true;
      n.midblock = false;
      signalled.delete(n);
      for (const e of ends) place(e);
      continue;
    }
    const node = paintNodes.get(n);
    if (node) node.shape = false;
    for (const e of ends) {
      const paint = paintOf.get(e);
      if (!paint) continue;
      paint.sx = e.sx;
      paint.sz = e.sz;
      paint.len = e.len;
    }
  }
  let signalCount = 0;
  for (const [n, d] of signalled) {
    if (n.arms.length < 3 && !n.midblock && d > 4) continue;
    n.signal = true;
    signalCount++;
  }
  if (signalPts.length) console.info(`[roads] ${signalCount} signalised junctions of ${signalPts.length / 2} real traffic signals`);
  for (const e of edges) {
    if (!e.inArm || !e.outArm) throw new Error('[roads] an edge without its arms'); // (computeArms gave every end one)
    e.inSide = e.inArm.side; // the side of e.to it arrives over
    e.outSide = e.outArm.side; // the side of e.from it leaves over
    e.axisIndex = e.inArm.group; // its right-of-way group at e.to
    // lateral axis of its road, the same both ways (+x across north-south roads, +z across east-west ones)
    const flip = e.rx < -1e-6 || (Math.abs(e.rx) <= 1e-6 && e.rz < 0);
    e.clx = flip ? -e.rx : e.rx;
    e.clz = flip ? -e.rz : e.rz;
  }
  for (const e of edges) {
    e.opposite = e.to.in.find((o) => o !== e && o.axisIndex === e.axisIndex && o.dx * e.dx + o.dz * e.dz < -0.7) ?? null;
  }

  // Lane-to-lane curves are built on first use and cached
  const curves = new Map<number, LaneCurve>();
  function connector(e: RoadEdge, i: number, f: RoadEdge, j: number) {
    const k = ((e.id * 8 + i) * 16384 + f.id) * 8 + j;
    let c = curves.get(k);
    if (!c) curves.set(k, (c = makeCurve(e, i, f, j)));
    return c;
  }

  const isRoadClear = (x: number, z: number, clear = 0.15) => !blockedOnStreet(x, z, clear);
  return { nodes, edges, paintEdges, connector, curvePoint, walkable, onSidewalk, isRoadClear };
}

// The largest strongly connected set of `list` (a Set), going on from item e to the items next(e)
function largestComponent<T>(list: T[], next: (e: T) => T[]): Set<T> {
  const index = new Map(list.map((e, i) => [e, i]));
  const succ = list.map((e) => next(e).map((f) => index.get(f)).filter((j) => j !== undefined));
  const pred = list.map((): number[] => []);
  succ.forEach((s, i) => {
    for (const j of s) pred[j].push(i);
  });
  // Kosaraju: finishing order going forwards, then components going backwards from the last finished
  const visited = new Uint8Array(list.length);
  const order: number[] = [];
  for (let root = 0; root < list.length; root++) {
    if (visited[root]) continue;
    visited[root] = 1;
    const stack: [number, number][] = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top[1] < succ[top[0]].length) {
        const j = succ[top[0]][top[1]++];
        if (!visited[j]) {
          visited[j] = 1;
          stack.push([j, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(list.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let k = order.length - 1, c = 0; k >= 0; k--) {
    if (comp[order[k]] >= 0) continue;
    const stack = [order[k]];
    comp[order[k]] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      if (i === undefined) break;
      size++;
      for (const p of pred[i]) {
        if (comp[p] < 0) {
          comp[p] = c;
          stack.push(p);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  return new Set(list.filter((_, i) => comp[i] === best));
}

// Cubic Bézier from the end of lane i on edge e to the start of lane j on edge f: a quarter-circle-like
// arc around the corner for turns, an S-bend for straight lane shifts. Includes an arc-length table and
// the sharpest curvature along it (1 / tightest radius).
function makeCurve(e: RoadEdge, i: number, f: RoadEdge, j: number): LaneCurve {
  const x0 = e.sx + e.dx * e.len + e.rx * e.lanes[i];
  const z0 = e.sz + e.dz * e.len + e.rz * e.lanes[i];
  const x3 = f.sx + f.rx * f.lanes[j];
  const z3 = f.sz + f.rz * f.lanes[j];
  const cross = e.dx * f.dz - e.dz * f.dx;
  let k0: number;
  let k3: number;
  if (Math.abs(cross) < 0.5) {
    k0 = k3 = Math.hypot(x3 - x0, z3 - z0) / 3;
  } else {
    const t = ((x3 - x0) * f.dz - (z3 - z0) * f.dx) / cross;
    k0 = 0.552 * Math.abs(t);
    k3 = 0.552 * Math.hypot(x3 - (x0 + e.dx * t), z3 - (z0 + e.dz * t));
  }
  const c = {
    x0, z0, x3, z3,
    x1: x0 + e.dx * k0, z1: z0 + e.dz * k0,
    x2: x3 - f.dx * k3, z2: z3 - f.dz * k3,
    lut: new Float32Array(17),
    len: 0,
    curv: 0
  };
  let px = x0;
  let pz = z0;
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * x3;
    const z = u * u * u * z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * z3;
    c.len += Math.hypot(x - px, z - pz);
    c.lut[k] = c.len;
    px = x;
    pz = z;
    const dx = 3 * u * u * (c.x1 - x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (x3 - c.x2);
    const dz = 3 * u * u * (c.z1 - z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (z3 - c.z2);
    const ddx = 6 * u * (c.x2 - 2 * c.x1 + x0) + 6 * t * (x3 - 2 * c.x2 + c.x1);
    const ddz = 6 * u * (c.z2 - 2 * c.z1 + z0) + 6 * t * (z3 - 2 * c.z2 + c.z1);
    c.curv = Math.max(c.curv, Math.abs(dx * ddz - dz * ddx) / Math.max(1e-6, Math.hypot(dx, dz) ** 3));
  }
  return c;
}

// Position and unit tangent at arc length s along a curve
function curvePoint(c: LaneCurve, s: number, out: CurvePoint): CurvePoint {
  let k = 1;
  while (k < 16 && c.lut[k] < s) k++;
  const s0 = c.lut[k - 1];
  const s1 = c.lut[k];
  const t = (k - 1 + Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)))) / 16;
  const u = 1 - t;
  out.x = u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3;
  out.z = u * u * u * c.z0 + 3 * u * u * t * c.z1 + 3 * u * t * t * c.z2 + t * t * t * c.z3;
  const dx = 3 * u * u * (c.x1 - c.x0) + 6 * u * t * (c.x2 - c.x1) + 3 * t * t * (c.x3 - c.x2);
  const dz = 3 * u * u * (c.z1 - c.z0) + 6 * u * t * (c.z2 - c.z1) + 3 * t * t * (c.z3 - c.z2);
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l;
  out.dz = dz / l;
  return out;
}

/** An edge's lift (m over the ground: a bridge, a ramp; < 0 down an underpass) at distance t from its `from` node along
 *  it; 0 at grade */
function edgeLift(e: { lift?: LiftProfile | null }, t: number): number {
  const p = e.lift;
  if (!p) return 0;
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [t0, l0] = p[i - 1], [t1, l1] = p[i];
      return t1 > t0 ? l0 + ((l1 - l0) * (t - t0)) / (t1 - t0) : l1;
    }
  }
  return p[p.length - 1][1];
}

export { buildRoadNetwork, CROSSWALK, edgeLift };
