// js/world/gas-station-plan.ts
// Where each of Tepic's gas stations (city-geodata.js `fuel`, OpenStreetMap's points & lots: fuel-lot-data.ts) lays its
// forecourt, worked out before the town is built so the houses, the yards' trees and the bardas keep off it (its
// PlaceClaims, handed down by app/city.ts): a concrete yard along its street, as big as a real one there (Tepic's run
// from 600 m² on a side street to 2,000 or more on the avenues; the mapped lots), inside its lot where OpenStreetMap
// draws one, never over a road, a car park, a hall or a place's grounds. On it the canopy over rows of pump islands
// (more rows the deeper the yard, two islands one behind the other the longer), the way in at one end of its front and
// the way out at the other, in the direction the near lane drives (on the right), and the lanes the customers' cars
// follow: in, to a pump or a place in the queue behind it, out. Plain data in, plain data out (no three.js):
// sim/gas-stations.ts builds and runs it.
import { GEO } from './city-geodata.js';
import { blockAt, nearestRoads } from './city-config.ts';
import { carParks, inCarPark } from './parking.ts';
import { insidePoly } from './rings.ts';
import { FUEL_LOTS } from './fuel-lot-data.ts';
import type { NearRoad, PointXZ } from './city-config.ts';
import type { LotReserve } from './landmark-models.ts';
import type { PlaceClaims } from './place-claims.ts';

/** A pump island: its middle (m, world) */
export interface PlannedIsland {
  x: number;
  z: number;
}
/** A place a customer's car stops at in its lane: how far along the lane's path (m), its middle (m, world), and
 *  whether it is beside a pump (else a place in the queue behind one) */
export interface LaneSpot {
  s: number;
  x: number;
  z: number;
  pump: boolean;
}
/** A lane the cars drive through the forecourt: its path from the street to the street (x, z pairs, m, world: in by the
 *  way in, along one side of a row of islands, out by the way out), its length (m), the places they stop at along it
 *  (in order, nearest the way out first) */
export interface StationLane {
  path: number[];
  length: number;
  spots: LaneSpot[];
  /** where it runs straight past the islands: its local v (m), the local u it starts at (m), and how far along the
   *  path it starts & ends (m) */
  v: number;
  u0: number;
  enter: number;
  leave: number;
}
/** A driveway: its curb point (m), the way in square to the curb (unit), its half width (m), and the forecourt's front
 *  edge (m in from the curb point) */
export interface PlannedDrive {
  x: number;
  z: number;
  nx: number;
  nz: number;
  half: number;
  depth: number;
}
/** A station as laid out */
export interface StationPlan {
  /** its index in GEO.fuel */
  index: number;
  name: string;
  /** the forecourt's middle (m) */
  x: number;
  z: number;
  /** the turn (rad: world = c + R_y(yaw)·local, local x along the street the way the cars go through, local z away from
   *  it) and those two directions (unit) */
  yaw: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  /** the forecourt's size (m): along the street, and deep */
  along: number;
  deep: number;
  /** the canopy: its middle (m, local) and size (m) */
  canopy: { u: number; v: number; along: number; across: number };
  islands: PlannedIsland[];
  /** the way in & the way out */
  drives: [PlannedDrive, PlannedDrive];
  lanes: StationLane[];
}

const SIDEWALK = GEO.frame.sidewalk || 2.2; // m: the sidewalk between the curb and the property line
const CELL = 2; // m: the raster a forecourt is fitted on
const REACH = 44; // m either side of the station's point along its street the forecourt may stand
const DEEP_MAX = 60; // m from the street's middle the raster runs
// The smallest (m): room for an island and the turns in & out either side of it, and a lane each side of it (a station
// squeezed between a street and its lateral)
const MIN: [along: number, deep: number] = [20, 12];
// The biggest forecourt (m: along, deep) by the street it is on: a highway's or a wide avenue's, a street's, a side
// street's (Tepic's on Insurgentes or the libramiento run 2,000 m² and more; a colonia's corner one, 600)
const BY_STREET: [along: number, deep: number][] = [[52, 36], [40, 30], [32, 24]];
// Stations whose size is known though OpenStreetMap draws no lot (m: within 40 m of the point; the biggest forecourt):
// the Pemex by Chedraui on Insurgentes, a big one; the one by Walmart, smaller (a player of Tepic's word, 2026)
const KNOWN: [x: number, z: number, along: number, deep: number][] = [[2779, 1989, 60, 40], [2010, 1464, 36, 26]];

const FRONT = 4.5; // m of the forecourt before its first lane (the cars come & go across it)
const BACK = 2.5; // m behind the last
const LANE_OFF = 2.3; // m from an island's middle to the middle of the car beside it
const ROW = 7.4; // m between rows of islands (two cars side by side between them)
const ISLAND_L = 4.8; // m: an island's length (a car's)
const TANDEM = 3.2; // m between two islands one behind the other
const OVERHANG = 2; // m the canopy runs past the islands
const DRIVE_W = 6.5; // m: a driveway's width (one car turning in)
const SIDE_MIN = 9; // m clear either end of the canopy, for the driveways and the turns
const TURN = 3.5; // m: the radius the cars turn in on
const QUEUE = 6; // m between the cars waiting in a queue
const BIG_HOUSE = 600; // m²: a building this big (or a hall, a plaza, a coto's) is no station's to clear
const OWN_CANOPY = 1500; // m²: the most a footprint on the station's point may be to be its own canopy
// A forecourt where OpenStreetMap draws no lot clears at most this share of its ground of houses (the station's own
// shop & canopy, Overture's footprints of them), and each m² of house cleared counts against it HOUSE_COST m² of yard
const HOUSES_MAX = 0.35;
const HOUSE_COST = 2;

// The buildings (GEO.houses) by 32 m cell: their middle, half sizes & turn, and whether the station may clear them
interface House {
  x: number;
  z: number;
  hx: number;
  hz: number;
  cs: number;
  sn: number;
  /** a hall, a plaza, a coto's house or anything over BIG_HOUSE m² */
  big: boolean;
  /** a hall, a plaza or a coto's house (never the station's own) */
  hall: boolean;
  /** m² */
  area: number;
}
const HOUSE_CELL = 32;
let houseCells: Map<number, House[]> | null = null;
function housesNear(x: number, z: number): House[] {
  if (!houseCells) {
    houseCells = new Map();
    const H = GEO.houses, S = GEO.houseStride || 8;
    for (let i = 0; i + 6 < H.length; i += S) {
      const w = H[i + 2] / 10, d = H[i + 3] / 10, th = H[i + 4] / 1000, kind = H[i + 6];
      const h: House = {
        x: H[i] / 10, z: H[i + 1] / 10, hx: w / 2, hz: d / 2, cs: Math.cos(th), sn: Math.sin(th),
        big: w * d > BIG_HOUSE || (kind & (8 | 16 | 32)) !== 0, hall: (kind & (8 | 16 | 32)) !== 0, area: w * d
      };
      const r = Math.hypot(h.hx, h.hz);
      for (let ix = Math.floor((h.x - r) / HOUSE_CELL); ix <= Math.floor((h.x + r) / HOUSE_CELL); ix++) {
        for (let iz = Math.floor((h.z - r) / HOUSE_CELL); iz <= Math.floor((h.z + r) / HOUSE_CELL); iz++) {
          const k = ix * 4096 + iz;
          let list = houseCells.get(k);
          if (!list) houseCells.set(k, (list = []));
          list.push(h);
        }
      }
    }
  }
  return houseCells.get(Math.floor(x / HOUSE_CELL) * 4096 + Math.floor(z / HOUSE_CELL)) ?? [];
}
// Whether (x, z) is in house h's turned box (world = c + R_y(θ)·local)
function inHouse(h: House, x: number, z: number): boolean {
  const dx = x - h.x, dz = z - h.z;
  return Math.abs(dx * h.cs - dz * h.sn) <= h.hx && Math.abs(dx * h.sn + dz * h.cs) <= h.hz;
}
// The building standing on (x, z), if any
function houseAt(x: number, z: number): House | null {
  for (const h of housesNear(x, z)) if (inHouse(h, x, z)) return h;
  return null;
}

// What a cell of a forecourt's raster is: no good (a road, a car park, a hall...), a house to clear, open ground
const BAD = 0, HOUSE = 1, OPEN = 2;

/** The rows of islands and the columns of them along a forecourt `along` x `deep` m (local: its middle the origin) */
function islandGrid(along: number, deep: number): { rows: number[]; cols: number[] } {
  const span = deep - FRONT - BACK;
  const rowCount = Math.max(1, Math.floor((span - 2 * (LANE_OFF + 1.2)) / ROW) + 1);
  const mid = (-deep / 2 + FRONT + deep / 2 - BACK) / 2;
  const colCount = (along - (2 * ISLAND_L + TANDEM + 2 * OVERHANG)) / 2 >= SIDE_MIN ? 2 : 1;
  return {
    rows: Array.from({ length: rowCount }, (_, r) => mid + (r - (rowCount - 1) / 2) * ROW),
    cols: Array.from({ length: colCount }, (_, c) => (c - (colCount - 1) / 2) * (ISLAND_L + TANDEM))
  };
}

/** A station's forecourt by its point (x, z): in its lot where OpenStreetMap draws one that has room for it, along
 *  whichever of the streets near it gives it the best; avoiding `avoid` (the places' grounds). Null where none has room */
function planStation(index: number, name: string, x: number, z: number, ring: PointXZ[] | null,
  avoid: (x: number, z: number) => boolean): StationPlan | null {
  // (its streets: the nearest that are streets first, then a lane through a lot, OpenStreetMap's service ways; a
  // station squeezed between a street and its lateral may front the lateral)
  const roads = nearestRoads(x, z, 90).filter((r) => r.dist < 60);
  const streets = [...roads.filter((r) => r.road.w >= 6), ...roads.filter((r) => r.road.w < 6)].slice(0, 3);
  for (const lot of ring ? [ring, null] : [null]) {
    let best: { plan: StationPlan; score: number } | null = null;
    for (const near of streets) {
      const fit = fitAlong(index, name, x, z, lot, avoid, near);
      if (fit && (!best || fit.score > best.score)) best = fit;
    }
    if (best) return best.plan;
  }
  return null;
}

// The best forecourt for the station at (x, z) along street `near` (its lot `ring`, if any), and how good it is
function fitAlong(index: number, name: string, x: number, z: number, ring: PointXZ[] | null,
  avoid: (x: number, z: number) => boolean, near: NearRoad): { plan: StationPlan; score: number } | null {
  // the street's segment nearest it: its direction, and the side the station is on
  const pts = near.road.pts;
  let best = Infinity, qx = x, qz = z, dx = 1, dz = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(px - x, pz - z);
    if (d < best) {
      best = d;
      qx = px;
      qz = pz;
      const l = Math.sqrt(l2);
      dx = ex / l;
      dz = ez / l;
    }
  }
  // n away from the street towards the station; u the way the near lane drives: with the station on its right, or on
  // a one-way street the way it runs ('FT' along its points, 'TF' against them)
  let nx = -dz, nz = dx;
  if ((x - qx) * nx + (z - qz) * nz < 0) { nx = -nx; nz = -nz; }
  let ux = nz, uz = -nx;
  const oneWay = near.road.dir === 'FT' ? 1 : near.road.dir === 'TF' ? -1 : 0;
  if (oneWay && (dx * ux + dz * uz) * oneWay < 0) { ux = -ux; uz = -uz; }
  const anchorU = (x - qx) * ux + (z - qz) * uz;
  const at = (u: number, v: number): [number, number] => [qx + ux * u + nx * v, qz + uz * u + nz * v];

  // the biggest forecourt for its street, or as known
  const road = near.road;
  const known = KNOWN.find(([kx, kz]) => Math.hypot(kx - x, kz - z) < 40);
  const [maxAlong, maxDeep] = known ? [known[2], known[3]]
    : BY_STREET[road.highway || road.w >= 9 || road.lanes >= 3 ? 0 : road.w >= 7 ? 1 : 2];

  // the raster: columns along the street (CELL m), rows away from it; each column's curb (m from the street's middle)
  const cols = Math.round((2 * REACH) / CELL), rows = Math.round(DEEP_MAX / CELL);
  const u0 = anchorU - REACH;
  const curb = new Float64Array(cols).fill(Infinity);
  for (let i = 0; i < cols; i++) {
    const u = u0 + (i + 0.5) * CELL;
    for (let v = 0; v <= 30; v += 0.5) {
      const [px, pz] = at(u, v);
      if (blockAt(px, pz)) { curb[i] = v; break; }
    }
  }
  const lots = carParksNear(x, z);
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const [px, pz] = at(u0 + (i + 0.5) * CELL, (j + 0.5) * CELL);
      let kind = OPEN;
      if (!blockAt(px, pz) || lots.some((l) => inCarPark(l, px, pz)) || avoid(px, pz)) kind = BAD;
      else if (ring && !insidePoly(ring, px, pz)) kind = BAD;
      else {
        // (a big one standing on the station's point, no hall nor plaza, is its own canopy, Overture's footprint of it:
        // cleared too)
        const h = houseAt(px, pz);
        if (h) kind = h.big && !(inHouse(h, x, z) && !h.hall && h.area < OWN_CANOPY) ? BAD : HOUSE;
      }
      cells[i * rows + j] = kind;
    }
  }

  // the bad & the house cells summed from the corner (sums[(i, j)]: those in columns < i, rows < j), so any forecourt's
  // are counted at once
  const W = rows + 1;
  const badSum = new Int32Array((cols + 1) * W), houseSum = new Int32Array((cols + 1) * W);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const c = cells[i * rows + j], k = (i + 1) * W + j + 1;
      badSum[k] = (c === BAD ? 1 : 0) + badSum[k - W] + badSum[k - 1] - badSum[k - W - 1];
      houseSum[k] = (c === HOUSE ? 1 : 0) + houseSum[k - W] + houseSum[k - 1] - houseSum[k - W - 1];
    }
  }
  const count = (sum: Int32Array, i0: number, i1: number, j0: number, j1: number) => sum[i1 * W + j1] - sum[i0 * W + j1] - sum[i1 * W + j0] + sum[i0 * W + j0];
  // every forecourt that fits (its front on the property line), the best of them: the biggest, not much longer than it
  // is deep (a long strip has no room to turn in) nor much deeper than long (no room for the pumps), clearing the
  // fewest houses, nearest the point; one over a third houses, where OpenStreetMap draws no lot, is no station's
  let pick: { u: number; front: number; along: number; deep: number; score: number } | null = null;
  for (let along = maxAlong; along >= MIN[0]; along -= 4) {
    for (let deep = maxDeep; deep >= MIN[1]; deep -= 2) {
      for (let du = 0; du <= REACH - along / 2; du += CELL) {
        for (const sign of du ? [1, -1] : [1]) {
          const u = anchorU + sign * du;
          const i0 = Math.round((u - along / 2 - u0) / CELL), i1 = Math.round((u + along / 2 - u0) / CELL);
          if (i0 < 0 || i1 > cols) continue;
          let front = 0;
          for (let i = i0; i < i1; i++) front = Math.max(front, curb[i]);
          if (!Number.isFinite(front)) continue;
          front += SIDEWALK;
          const j0 = Math.floor(front / CELL), j1 = Math.ceil((front + deep) / CELL);
          if (j1 > rows || count(badSum, i0, i1, j0, j1)) continue;
          const houses = count(houseSum, i0, i1, j0, j1) * CELL * CELL;
          if (!ring && houses > HOUSES_MAX * along * deep) continue;
          const score = Math.min(along, 1.8 * deep) * Math.min(deep, 1.2 * along) + 0.01 * along * deep - HOUSE_COST * houses - 10 * du;
          if (!pick || score > pick.score) pick = { u, front, along, deep, score };
        }
      }
    }
  }
  if (!pick) return null;
  const { u, front, along, deep, score } = pick;
  const [cx, cz] = at(u, front + deep / 2);
  // (the curb at a driveway, in the forecourt's frame: its front a sidewalk's width in from the curb's furthest out)
  const curbAt = (lu: number) => {
    const c = curb[Math.max(0, Math.min(cols - 1, Math.floor((u + lu - u0) / CELL)))];
    return (Number.isFinite(c) ? c : front - SIDEWALK) - front - deep / 2;
  };
  return { plan: layout(index, name, cx, cz, ux, uz, nx, nz, along, deep, curbAt), score };
}

// The car parks (parking.ts) by 200 m cell, made on first use
let parkCells: Map<number, ReturnType<typeof carParks>> | null = null;
function carParksNear(x: number, z: number): ReturnType<typeof carParks> {
  if (!parkCells) {
    parkCells = new Map();
    for (const l of carParks(GEO.parking)) {
      for (let ix = Math.floor((l.minX - 60) / 200); ix <= Math.floor((l.maxX + 60) / 200); ix++) {
        for (let iz = Math.floor((l.minZ - 60) / 200); iz <= Math.floor((l.maxZ + 60) / 200); iz++) {
          const k = ix * 4096 + iz;
          let list = parkCells.get(k);
          if (!list) parkCells.set(k, (list = []));
          list.push(l);
        }
      }
    }
  }
  return parkCells.get(Math.floor(x / 200) * 4096 + Math.floor(z / 200)) ?? [];
}

/** The forecourt `along` x `deep` m round (cx, cz), along (ux, uz) (n away from the street; `curbAt(u)`: the curb in
 *  front of it, m from its middle along n) laid out: the canopy, the islands, the driveways and the lanes */
function layout(index: number, name: string, cx: number, cz: number, ux: number, uz: number, nx: number, nz: number,
  along: number, deep: number, curbAt: (u: number) => number): StationPlan {
  const { rows, cols } = islandGrid(along, deep);
  const world = (u: number, v: number): [number, number] => [cx + ux * u + nx * v, cz + uz * u + nz * v];
  const islands: PlannedIsland[] = [];
  for (const v of rows) for (const u of cols) { const [x, z] = world(u, v); islands.push({ x, z }); }
  const canopyAlong = cols.length * ISLAND_L + (cols.length - 1) * TANDEM + 2 * OVERHANG;
  const canopyAcross = (rows.length - 1) * ROW + 2 * (LANE_OFF + 1.6);
  const canopyV = (rows[0] + rows[rows.length - 1]) / 2;
  // the driveways: across the sidewalk from the curb to the forecourt's front, one at either end of it
  const inU = -along / 2 + 0.5 + DRIVE_W / 2, outU = along / 2 - 0.5 - DRIVE_W / 2;
  const drive = (u: number): PlannedDrive => {
    const [x, z] = world(u, curbAt(u));
    return { x, z, nx, nz, half: DRIVE_W / 2, depth: -deep / 2 - curbAt(u) };
  };
  // the lanes: in from the street at the way in, a turn onto the lane, along it past the islands, a turn to the way
  // out and out onto the street; the places to stop along it, beside each island and queued behind the first
  const lanes: StationLane[] = [];
  const arc = (out: [number, number][], cu: number, cv: number, a0: number, a1: number) => {
    for (let k = 1; k <= 4; k++) {
      const a = a0 + ((a1 - a0) * k) / 4;
      out.push([cu + TURN * Math.cos(a), cv + TURN * Math.sin(a)]);
    }
  };
  for (const rv of rows) {
    for (const side of [-1, 1]) {
      const v = rv + side * LANE_OFF;
      // (in from 2 m out on the roadway; the turns a quarter circle each, in four)
      // (from up the street, in the lane by the curb: the cars come & go there as the traffic's)
      const cIn = curbAt(inU), cOut = curbAt(outU);
      const local: [number, number][] = [[inU - 16, cIn - 2], [inU - 4, cIn - 2], [inU - 1, cIn - 0.8], [inU, cIn + 1], [inU, v - TURN]];
      arc(local, inU + TURN, v - TURN, Math.PI, Math.PI / 2);
      const straight = local.length - 1; // (local[straight]: the lane's start, (inU + TURN, v))
      local.push([outU - TURN, v]);
      arc(local, outU - TURN, v - TURN, Math.PI / 2, 0);
      local.push([outU, cOut + 1], [outU + 1, cOut - 0.8], [outU + 4, cOut - 2], [outU + 16, cOut - 2]);
      const path: number[] = [];
      const sAt: number[] = [];
      let length = 0;
      local.forEach(([lu, lv], k) => {
        if (k) length += Math.hypot(lu - local[k - 1][0], lv - local[k - 1][1]);
        sAt.push(length);
        path.push(...world(lu, lv));
      });
      const sOf = (u: number) => sAt[straight] + (u - (inU + TURN));
      const spots: LaneSpot[] = [];
      for (let c = cols.length - 1; c >= 0; c--) {
        const [x, z] = world(cols[c], v);
        spots.push({ s: sOf(cols[c]), x, z, pump: true });
      }
      for (let u = cols[0] - QUEUE; u >= inU + TURN + 2.6; u -= QUEUE) {
        const [x, z] = world(u, v);
        spots.push({ s: sOf(u), x, z, pump: false });
      }
      const enter = sAt[straight];
      lanes.push({ path, length, spots, v, u0: inU + TURN, enter, leave: enter + (outU - TURN) - (inU + TURN) });
    }
  }
  return {
    index, name, x: cx, z: cz, yaw: Math.atan2(-uz, ux), ux, uz, nx, nz, along, deep,
    canopy: { u: 0, v: canopyV, along: canopyAlong, across: canopyAcross },
    islands, drives: [drive(inU), drive(outU)], lanes
  };
}

/** Whether (x, z) lies in a station's forecourt or its driveways (grown by `pad` m) */
function inStation(s: StationPlan, x: number, z: number, pad = 0): boolean {
  const dx = x - s.x, dz = z - s.z;
  const u = dx * s.ux + dz * s.uz, v = dx * s.nx + dz * s.nz;
  if (Math.abs(u) <= s.along / 2 + pad && Math.abs(v) <= s.deep / 2 + pad) return true;
  // (a driveway: from its curb point to the front, its width)
  for (const d of s.drives) {
    const a = (x - d.x) * d.nx + (z - d.z) * d.nz, t = (x - d.x) * s.ux + (z - d.z) * s.uz;
    if (a >= -pad && a <= d.depth + pad && Math.abs(t) <= d.half + pad) return true;
  }
  return false;
}

/** Whether (x, z) lies within `pad` m of a station's driveways or its canopy's posts (no lamp, pole nor tree there) */
function nearDrive(s: StationPlan, x: number, z: number, pad: number): boolean {
  for (const d of s.drives) {
    const a = (x - d.x) * d.nx + (z - d.z) * d.nz, t = (x - d.x) * s.ux + (z - d.z) * s.uz;
    if (a >= -pad - 1 && a <= d.depth + pad && Math.abs(t) <= d.half + pad) return true;
  }
  return false;
}

/**
 * The stations laid out, avoiding `avoid` (the places' grounds: the UAN's, Forum's, the Central's...), and what they
 * claim of the ground: the forecourts & driveways, no house, tree nor barda on them, no lamp or pole across a driveway
 */
function planGasStations(avoid: (x: number, z: number) => boolean = () => false): { stations: StationPlan[]; claims: PlaceClaims } {
  // (by the geodata's point each was matched to: a station regenerated elsewhere, or gone, has none)
  const osm = new Map(FUEL_LOTS.map((f) => [`${f[0]},${f[1]}`, f]));
  const stations: StationPlan[] = [];
  GEO.fuel.forEach(([x0, z0, name], index) => {
    const mapped = osm.get(`${x0},${z0}`);
    const ring: PointXZ[] | null = mapped?.[4].length ? [] : null;
    if (ring && mapped) for (let k = 0; k + 1 < mapped[4].length; k += 2) ring.push({ x: mapped[4][k], z: mapped[4][k + 1] });
    // (OpenStreetMap's point, else Overture's; in its lot, else the lot's middle)
    let x = mapped ? mapped[2] : x0, z = mapped ? mapped[3] : z0;
    if (ring && !insidePoly(ring, x, z)) {
      x = ring.reduce((t, p) => t + p.x, 0) / ring.length;
      z = ring.reduce((t, p) => t + p.z, 0) / ring.length;
    }
    // (none on another's ground: two entries of one station)
    const s = planStation(index, name, x, z, ring, (px, pz) => avoid(px, pz) || stations.some((o) => inStation(o, px, pz, 1)));
    if (s) stations.push(s);
  });
  // the stations by 64 m cell, for the claims' tests
  const cells = new Map<number, StationPlan[]>();
  for (const s of stations) {
    const r = Math.hypot(s.along, s.deep) / 2 + 12;
    for (let ix = Math.floor((s.x - r) / 64); ix <= Math.floor((s.x + r) / 64); ix++) {
      for (let iz = Math.floor((s.z - r) / 64); iz <= Math.floor((s.z + r) / 64); iz++) {
        const k = ix * 4096 + iz;
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(s);
      }
    }
  }
  const at = (x: number, z: number) => cells.get(Math.floor(x / 64) * 4096 + Math.floor(z / 64)) ?? [];
  const ground: LotReserve = { contains: (x, z) => at(x, z).some((s) => inStation(s, x, z, 0.5)) };
  const claims: PlaceClaims = {
    houses: ground,
    trees: ground,
    open: (x, z) => ground.contains(x, z),
    walled: (x, z) => ground.contains(x, z),
    nearBuilding: (x, z, pad) => at(x, z).some((s) => nearDrive(s, x, z, pad))
  };
  return { stations, claims };
}

export { planGasStations };
