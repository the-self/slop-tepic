// js/world/parking.ts
// Tepic's surface car parks (city-geodata.js `parking`, from OpenStreetMap's amenity=parking cut to the property lines
// by tools/build-tepic-geodata.mjs): the lots in front of Walmart, Soriana, Ley, Bodega Aurrera and the Home Depot, the
// plazas' and the hospitals'. Here they are laid out in stalls, rows along the lot's long side, back to back across
// the lot with a two-way aisle between each pair, and some stalls taken by a parked car. Plain data in, plain data out
// (no three.js), so node --test reads it directly: car-parks.ts draws the asphalt, the paint and the cars.

import { hash } from './hash.ts';
import { insidePoly } from './rings.ts';
import type { PointXZ } from './city-config.ts';
import type { ParkingLot, ParkingSurface } from './city-geodata.js';

/** A stall's size (m): Mexico's usual 2.5-2.7 x 5.0-5.5 m (Reglamento de Construcciones), and the aisle between the rows */
const STALL_W = 2.6;
const STALL_D = 5.2;
const AISLE = 6.6; // two-way, cars backing out of the stalls on either side
const EDGE = 0.4; // m clear of the lot's outline (its fence, its curb)

/** Where a lot opens onto the street: the curb's point (m), the way in square to the curb (unit), the driveway's width
 *  (m) and its path from the curb to the lot (the first point the curb's) */
export interface CarParkEntrance {
  x: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
  path: PointXZ[];
}

/** A car park, from its geodata record */
export interface CarPark {
  name: string;
  surface: ParkingSurface;
  /** The rows' direction (cos θ, -sin θ) and across them (sin θ, cos θ) */
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  pts: PointXZ[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Its area (m²) */
  area: number;
  entrances: CarParkEntrance[];
}

/** A stall: its centre (m), the way a car parked in it faces (heading: atan2 of the nose's x over its z, the
 *  traffic's convention), its row's direction (ux, uz), and whether the stall's side lines are painted on each end */
export interface Stall {
  x: number;
  z: number;
  heading: number;
  ux: number;
  uz: number;
  /** a line on its -u side / +u side (the next stall in the row shares the line between them) */
  lineA: boolean;
  lineB: boolean;
  lot: CarPark;
}

/** A car standing in a stall: the stall, and a draw in [0, 1) for its model and one for its paint */
export interface ParkedCar {
  stall: Stall;
  /** heading as parked (a little off the stall's, more on an earth lot) */
  heading: number;
  /** how far forward or back in the stall (m along its heading) */
  shift: number;
  model: number;
  paint: number;
}

/** What a stall needs to know of the buildings: the distance (m) to the nearest wall, 0 inside one (lot-greenery.ts) */
export type WallDistance = (x: number, z: number, reach: number) => number;

function carParkOf([name, surface, theta, ring, doors]: ParkingLot): CarPark {
  const pts: PointXZ[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, a2 = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i], z = ring[i + 1];
    pts.push({ x, z });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a2 += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const th = theta / 1000;
  const cs = Math.cos(th), sn = Math.sin(th);
  const entrances = doors.map(([x, z, angle, width, path]): CarParkEntrance => ({
    x, z, nx: Math.cos(angle / 1000), nz: Math.sin(angle / 1000), width,
    path: Array.from({ length: path.length / 2 }, (_, i) => ({ x: path[2 * i], z: path[2 * i + 1] }))
  }));
  return { name, surface, ux: cs, uz: -sn, vx: sn, vz: cs, pts, minX, maxX, minZ, maxZ, area: Math.abs(a2) / 2, entrances };
}

/** The car parks of the geodata */
function carParks(records: readonly ParkingLot[]): CarPark[] {
  return records.map(carParkOf);
}

/** Whether (x, z) lies in the lot */
function inCarPark(lot: CarPark, x: number, z: number): boolean {
  return x >= lot.minX && x <= lot.maxX && z >= lot.minZ && z <= lot.maxZ && insidePoly(lot.pts, x, z);
}

// Distance (m) from (x, z) to the segment a-b
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Whether a stall centred at (x, z) would stand in an entrance's way: on its driveway, or across its mouth (the
 *  driveway carried on MOUTH m into the lot, to the aisle) */
const MOUTH = 9;
function inMouth(lot: CarPark, x: number, z: number): boolean {
  for (const e of lot.entrances) {
    const clear = e.width / 2 + STALL_W / 2 + 0.3;
    const p = e.path;
    for (let i = 0; i + 1 < p.length; i++) if (segmentDistance(x, z, p[i].x, p[i].z, p[i + 1].x, p[i + 1].z) < clear) return true;
    const end = p.at(-1), before = p.at(-2);
    if (!end || !before) continue;
    const L = Math.hypot(end.x - before.x, end.z - before.z) || 1;
    const fx = (end.x - before.x) / L, fz = (end.z - before.z) / L;
    if (segmentDistance(x, z, end.x, end.z, end.x + fx * MOUTH, end.z + fz * MOUTH) < clear) return true;
  }
  return false;
}

/**
 * The stalls of a lot: rows along u, across v in the pattern row | aisle | row, row | aisle | row... from the lot's edge
 * (each pair of rows back to back), centred in the lot both ways. A stall is kept when its corners lie in the lot (EDGE
 * m in), its aisle too (a car can drive out of it), it leaves the entrances' way clear (inMouth), and no wall stands
 * in it (`wallAt`, the buildings standing on the lot: the store mapped inside its car park)
 */
function layStalls(lot: CarPark, wallAt: WallDistance | null = null): Stall[] {
  const { ux, uz, vx, vz } = lot;
  // the lot's extent along u and v
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of lot.pts) {
    const u = p.x * ux + p.z * uz, v = p.x * vx + p.z * vz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  // the rows across v: [start of the row, facing +v (1) or -v (-1)]; a row faces the aisle beside it
  const rows: [number, number][] = [];
  const period = 2 * STALL_D + AISLE; // row | aisle | row, the next pair's first row back to back with its last
  const span = v1 - v0 - 2 * EDGE;
  const pairs = Math.floor(span / period);
  const lone = span - pairs * period >= STALL_D + AISLE ? 1 : 0; // a last row on an aisle of its own (by the fence)
  if (!pairs && !lone) return [];
  let v = v0 + EDGE + (span - pairs * period - lone * (STALL_D + AISLE)) / 2;
  for (let k = 0; k < pairs; k++) {
    rows.push([v, 1], [v + STALL_D + AISLE, -1]);
    v += period;
  }
  if (lone) rows.push([v, 1]);
  const n = Math.floor((u1 - u0 - 2 * EDGE) / STALL_W);
  if (n < 1) return [];
  const uStart = u0 + (u1 - u0 - n * STALL_W) / 2;
  const at = (u: number, w: number): PointXZ => ({ x: u * ux + w * vx, z: u * uz + w * vz });
  const inside = (p: PointXZ) => inCarPark(lot, p.x, p.z);
  const stalls: Stall[] = [];
  for (const [rv, face] of rows) {
    const aisleV = face > 0 ? rv + STALL_D + AISLE * 0.5 : rv - AISLE * 0.5;
    const cv = rv + STALL_D / 2;
    const row: (Stall | null)[] = [];
    for (let i = 0; i < n; i++) {
      const a = uStart + i * STALL_W, b = a + STALL_W, cu = (a + b) / 2;
      const corners = [at(a + 0.15, rv + 0.15), at(b - 0.15, rv + 0.15), at(b - 0.15, rv + STALL_D - 0.15), at(a + 0.15, rv + STALL_D - 0.15)];
      const c = at(cu, cv);
      let ok = corners.every(inside) && inside(at(cu, aisleV)) && inside(at(cu, aisleV + (face > 0 ? 2 : -2))) && !inMouth(lot, c.x, c.z);
      if (ok && wallAt) ok = wallAt(c.x, c.z, 3) > 1.4 && corners.every((p) => wallAt(p.x, p.z, 1) > 0.2);
      // the car's nose towards the aisle (driven in forwards, as most people do)
      const fx = vx * face, fz = vz * face;
      row.push(ok ? { x: c.x, z: c.z, heading: Math.atan2(fx, fz), ux, uz, lineA: true, lineB: true, lot } : null);
    }
    for (let i = 0; i < n; i++) {
      const s = row[i];
      if (!s) continue;
      s.lineB = !row[i + 1]; // (the next stall paints the line between them as its own -u side)
      stalls.push(s);
    }
  }
  return stalls;
}

/**
 * The cars standing in a lot's stalls: about half of them taken (fewer in a lot no one named, more in front of the
 * big stores), the rows nearest the aisle's middle fuller, each car a little crooked; the same ones every load
 */
function parkCars(stalls: readonly Stall[], { fill = 0.5 }: { fill?: number } = {}): ParkedCar[] {
  const cars: ParkedCar[] = [];
  for (const s of stalls) {
    // lots fill in clumps (near the doors, under the shade): a slow field over the lot
    const clump = 0.55 + 0.9 * hash(Math.floor(s.x / 18), Math.floor(s.z / 18), 21);
    if (hash(s.x, s.z, 22) >= fill * clump) continue;
    const crooked = s.lot.surface === 3 ? 0.22 : 0.05;
    cars.push({
      stall: s,
      heading: s.heading + (hash(s.z, s.x, 23) - 0.5) * crooked,
      shift: (hash(s.x, s.z, 24) - 0.5) * 0.5,
      model: hash(s.x, s.z, 25),
      paint: hash(s.z, s.x, 26)
    });
  }
  return cars;
}

export { STALL_W, STALL_D, AISLE, carParks, inCarPark, inMouth, layStalls, parkCars };
