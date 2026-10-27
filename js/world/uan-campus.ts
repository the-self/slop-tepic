// js/world/uan-campus.ts
// The Universidad Autónoma de Nayarit's campus, the Ciudad de la Cultura Amado Nervo, as plain data (no three.js, so
// node --test reads it): its grounds (OpenStreetMap's outlines of the university and of its Preparatoria No. 1), where
// its walls stand and in which style, where its gates are, and what its buildings are. uan.ts builds them.
//
// From street photographs: its outer edge is walled, inside it is open. Along the Boulevard Tepic-Xalisco, Av. de la
// Cultura and 12 de Octubre round the university's gate the campus is shut by the UAN's blue (a low blue wall, square
// blue piers, a steel reja between them); along Calle Revolución Social and the Prepa's side of 12 de Octubre by an
// older wall of rubble stone (mampostería) under a concrete coping, a chain-link fence on top; along José María
// Mercado, beyond its canal, by the same whitewashed. Its gates: the stone arches with "UAN" over the Av. Universidad
// on Revolución, the white portal "POR LO NUESTRO A LO UNIVERSAL" on the boulevard and the one with "UNIVERSIDAD
// AUTÓNOMA DE NAYARIT" on 12 de Octubre where Doctor Joaquín Cánovas comes in (both on blue piers, a guard booth by
// them), plain ones on Av. de la Cultura and wherever a campus drive crosses the walls.

import { BLOCKS, ROADS, blockAt, nearestRoads, onRoadway } from './city-config.ts';
import { GEO } from './city-geodata.js';
import { geoToWorld } from './geo.ts';
import { insidePoly, insideRing } from './rings.ts';
import { hash } from './hash.ts';
import type { CityBlock, CityRoad, PointXZ } from './city-config.ts';
import type { TreeSite } from './lot-greenery.ts';

/** A wall's style: the UAN's blue piers & rejas, the rubble-stone wall under its chain-link, or the same whitewashed */
export type WallStyle = 'blue' | 'stone' | 'cal';
/** A gate's kind: the stone arches with "UAN", the white portals with the motto or the name on blue piers, two stone piers */
export type GateKind = 'arch' | 'motto' | 'name' | 'plain';
/** What a campus building is: a row of classrooms on its corridor, an academic building, a domed gym or hall, stands */
export type BuildingKind = 'aulas' | 'edificio' | 'domo' | 'gradas';

/** A run of wall: its style, its samples in order (m), the way out to the street (unit, per sample) and how far out
 *  from it the roadway's edge is (m: the sidewalk along it; 0, none: a stretch closing a gap across a block, a canal's) */
export interface CampusWall {
  style: WallStyle;
  pts: PointXZ[];
  out: PointXZ[];
  curb: number;
}

/** A drive through a gate: where its middle crosses the gate's line (m along it from the gate's centre) and its width (m) */
export interface GateOpening {
  t: number;
  w: number;
}

/**
 * A gate across the wall line: its kind, its centre (m), the line it stands on (unit, `along`), the way out to the
 * street (unit), how far it reaches along its line either side of the centre (m, s0 < 0 < s1) and the drives through it
 */
export interface CampusGate {
  kind: GateKind;
  /** the style of the walls it stands in (a plain gate is built in it) */
  style: WallStyle;
  c: PointXZ;
  along: PointXZ;
  out: PointXZ;
  s0: number;
  s1: number;
  openings: GateOpening[];
}

/** A campus building: its centre (m), its sizes along its local x & z (m), its turn (rad, world = c + R_y(θ)·local),
 *  its storeys, what it is and a number of its own (0..1) for the choices made for it */
export interface CampusBuilding {
  cx: number;
  cz: number;
  w: number;
  d: number;
  th: number;
  storeys: number;
  kind: BuildingKind;
  seed: number;
  /** what Overture Maps' places call it ('UNIDAD ACADÉMICA DE ENFERMERÍA'), null when no place names it */
  name: string | null;
}

/** The walls and the gates in them, as built, and the railings along Mercado's canal (polylines, m) */
export interface CampusPlan {
  walls: CampusWall[];
  gates: CampusGate[];
  rails: PointXZ[][];
}

// The grounds: OpenStreetMap's way 383144748 (the university) and way 383144744 (the Preparatoria No. 1, across Calle
// Doctor Joaquín Cánovas), simplified to 3 m, in degrees [lat, lon]; the university's taking in the green corner by the
// boulevard & 12 de Octubre (its first two points), walled with the rest from the boulevard's gate to 12 de Octubre's;
// the Prepa's reaching north to José María Mercado's canal (its 6th to 8th points: the walls stand along it)
const GROUNDS_DEG: [number, number][][] = [
  [[21.493434, -104.895921], [21.493696, -104.895195], [21.493842, -104.894281],
    [21.494017, -104.894070], [21.495266, -104.890084], [21.495307, -104.890090], [21.495352, -104.889766], [21.495160, -104.889737],
    [21.495080, -104.889567], [21.492449, -104.889295], [21.490401, -104.889185], [21.490351, -104.889241], [21.490279, -104.889243],
    [21.490048, -104.889184], [21.487521, -104.889072], [21.488236, -104.891046], [21.488303, -104.891047], [21.488303, -104.891126],
    [21.488262, -104.891128], [21.488985, -104.893128], [21.489028, -104.893096], [21.489235, -104.893158], [21.489286, -104.893342],
    [21.489184, -104.893731], [21.489059, -104.893793], [21.488865, -104.894469], [21.489537, -104.894691], [21.489534, -104.894725],
    [21.490115, -104.894903], [21.490151, -104.894857], [21.492800, -104.895741], [21.493282, -104.895868]],
  [[21.494431, -104.893649], [21.494504, -104.893549], [21.494677, -104.893021], [21.494650, -104.892963], [21.495240, -104.891043],
    [21.495965, -104.890008], [21.496939, -104.892802], [21.496980, -104.893058], [21.496407, -104.893229], [21.495333, -104.893947]]
];
const GROUNDS: PointXZ[][] = GROUNDS_DEG.map((ring) => ring.map(([lat, lon]) => {
  const [x, z] = geoToWorld(lat, lon);
  return { x, z };
}));

// The streets the campus is walled along, and in which style (from street photographs): its outer edge only, inside
// it is open (Doctor Joaquín Cánovas, between the Prepa and the university, has none). The outline runs down their
// middles, near enough; the boulevard's side runs along its lateral, the property line ~25 m from its centre (REACH)
const WALL_STREETS: Partial<Record<string, WallStyle>> = {
  'Calle Revolución Social': 'stone',
  'Avenida 12 de Octubre': 'stone',
  'Calle 12 de Octubre': 'blue', // (its stretch by the boulevard)
  'Boulevard Tepic - Xalisco': 'blue',
  'Avenida de la Cultura': 'blue'
};
// The walls along the grounds' own outline, where the town's data has no street to stand them by: the Prepa's side on
// the Escuela Normal Superior's grounds: [ring, from point, to point (past the last: round to the first), style]. Where
// a street's wall stands already, none
const OUTLINE_WALLS: [number, number, number, WallStyle][] = [[1, 9, 10, 'stone']];

// José María Mercado's canal (OpenStreetMap's drain, open beside the street, tools/build-tepic-geodata.mjs
// OPEN_BESIDE): the box of its stretch along the campus [x0, z0, x1, z1] (m). The campus is walled along its far bank
// (whitewashed stone, a gap where a footbridge crosses to a gate), a pipe railing along its edge by the street
const CANAL_BOX = [690, 1500, 1095, 1595]; // (from where it crosses 12 de Octubre to Revolución)
const CANAL_STREET = 'Calle José María Mercado';
const OUTLINE_IN = 0.6; // m in from the outline

// The walled grounds beside the campus, walled with it along their streets (their buildings are the town's): the
// Escuela Normal Superior's on the corner of 12 de Octubre and Doctor Joaquín Cánovas (OpenStreetMap's way 383144740),
// whitewashed
const NEIGHBOURS: { ring: PointXZ[]; style: WallStyle; streets: string[] }[] = [{
  ring: ([[21.495333, -104.893947], [21.494407, -104.894577], [21.494201, -104.894426], [21.494431, -104.893649]] satisfies [number, number][])
    .map(([lat, lon]) => {
      const [x, z] = geoToWorld(lat, lon);
      return { x, z };
    }),
  style: 'cal',
  streets: ['Avenida 12 de Octubre', 'Continuación Doctor Joaquín Cánovas', 'Calle Doctor Joaquín Cánovas']
}];

// A street walled in one style along one grounds and another along the other: [the university's, the Prepa's]
// (12 de Octubre: blue round the university's gate, the old stone along the Prepa)
const BY_GROUNDS: Partial<Record<string, [WallStyle, WallStyle]>> = { 'Avenida 12 de Octubre': ['blue', 'stone'] };

const REACH: Partial<Record<string, number>> = { 'Boulevard Tepic - Xalisco': 40 };

// The gates: OpenStreetMap's barrier=gate nodes on the drives into the campus (one per carriageway), in degrees
const GATES_DEG: [GateKind, [number, number][]][] = [
  // Revolución & the Av. Universidad, by the baseball stadium (nodes 3888629712, 3888629720)
  ['arch', [[21.4901807, -104.8892463], [21.4902899, -104.8892614]]],
  // the boulevard's corner with 12 de Octubre, where the campus's lateral starts (node 3863570395)
  ['motto', [[21.4932980, -104.8958105]]],
  // Doctor Joaquín Cánovas, where it comes into the campus from 12 de Octubre: across its two carriageways, the booth on
  // the median between them (from street photographs: OpenStreetMap maps no gate there)
  ['name', [[21.4939963, -104.8942808], [21.4941200, -104.8943688]]],
  // 12 de Octubre, the drive into the car park by the corner (nodes 3888629854, 3888629856)
  ['plain', [[21.4935880, -104.8950993], [21.4936191, -104.8950130]]],
  // Av. de la Cultura: off the glorieta, and on (nodes 3888629659, 3888629661; 3888629653, 3888629656; 8237221519,
  // 8237221520)
  ['plain', [[21.4892030, -104.8936743], [21.4892254, -104.8936120]]],
  ['plain', [[21.4890747, -104.8931399], [21.4891631, -104.8931641]]],
  ['plain', [[21.4881938, -104.8909271], [21.4882172, -104.8909955]]]
];
// m of gate beyond a drive's edge: its pier (the arch's archivolt & pier, the name's tower, a plain gate's broad pier)
const PIER: Record<GateKind, number> = { arch: 1.4, motto: 1.4, name: 2.0, plain: 1.4 };
const GAP = 14; // m: a gate reaches the walls' ends this near its own
// m: the portals are wider than their drives (the motto's has its booth and a gate for those on foot beside the drive)
const MIN_SPAN: Partial<Record<GateKind, number>> = { motto: 17.6, name: 14, arch: 18 };
const JOIN = 5; // m: two runs of a style this near end to end are one (the gaps of the strips' short edges)
const REJOIN = 45; // m: a gate's end is walled on to a wall's end this near
const CLOSE = 30; // m: a gap between two walls' ends this wide is closed (one ahead of the other's end)
const SHORT = 18; // m: one this short, whichever way
const STRAY = 10; // m: a run this short with neither end met is a stray (across the canal, a block's sliver): none
const CLAIM = 3; // m round the campus's walls & gates no barda of the town's stands
const CELL = 16; // m: the cells the walls are found by

const STEP = 2; // m between the samples along the property line
const INNER = 12; // m in from the property line the campus must be (a block across the street is not)
const PARALLEL = 0.9; // the property line runs along the street: |cos| of the angle between them at least this
const SHARP = 0.6; // rad: a block's corner turning more is a street corner (a gentler one, the street's curve)

// The grounds' bounds (m)
const BOUNDS = GROUNDS.flat().reduce((r, p) => ({ x0: Math.min(r.x0, p.x), x1: Math.max(r.x1, p.x), z0: Math.min(r.z0, p.z), z1: Math.max(r.z1, p.z) }),
  { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
// Within m metres of the grounds' bounds
const nearBounds = (minX: number, maxX: number, minZ: number, maxZ: number, m: number) =>
  maxX > BOUNDS.x0 - m && minX < BOUNDS.x1 + m && maxZ > BOUNDS.z0 - m && minZ < BOUNDS.z1 + m;

// Inside the campus's grounds (m)
function inCampus(x: number, z: number): boolean {
  return nearBounds(x, x, z, z, 0) && GROUNDS.some((ring) => insidePoly(ring, x, z));
}

// Where (x, z) projects on the segment a-b: its share t along it (0..1), the point there and the distance to it (m)
function toSegment(x: number, z: number, a: PointXZ, b: PointXZ): { t: number; px: number; pz: number; d: number } {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
  const px = a.x + dx * t, pz = a.z + dz * t;
  return { t, px, pz, d: Math.hypot(px - x, pz - z) };
}

// A footbridge's line passes within r m of (x, z) (the puentes over the canal, the roads)
function footbridgeAt(x: number, z: number, r: number): boolean {
  return GEO.footbridges.some(([f]) => f.length >= 4 && toSegment(x, z, { x: f[0], z: f[1] }, { x: f[f.length - 2], z: f[f.length - 1] }).d < r);
}

// The walls along Mercado's canal, on its far bank from the street, and the railing along its edge by the street; both
// broken where a road or a footbridge crosses
function canalWalls(): { walls: CampusWall[]; rails: PointXZ[][] } {
  const walls: CampusWall[] = [], rails: PointXZ[][] = [];
  const [x0, z0, x1, z1] = CANAL_BOX;
  const street = ROADS.filter((r) => r.name === CANAL_STREET);
  const toStreet = (x: number, z: number) => Math.min(Infinity, ...street.flatMap((r) => r.pts.slice(1).map((b, i) => toSegment(x, z, r.pts[i], b).d)));
  const crossed = (x: number, z: number) => nearestRoads(x, z, 15).some((n) => n.road.name !== CANAL_STREET && n.dist < n.road.w / 2 + 1.5) ||
    footbridgeAt(x, z, 1.6);
  for (const [kind, half, , , flat] of GEO.waterways) {
    if (kind !== 'drain' || half <= 0) continue;
    let wall: PointXZ[] = [], wallOut: PointXZ[] = [], rail: PointXZ[] = [];
    const flush = () => {
      if (wall.length > 1) walls.push({ style: 'cal', pts: wall, out: wallOut, curb: 0 });
      if (rail.length > 1) rails.push(rail);
      wall = []; wallOut = []; rail = [];
    };
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const a = { x: flat[i], z: flat[i + 1] }, b = { x: flat[i + 2], z: flat[i + 3] }, L = Math.hypot(b.x - a.x, b.z - a.z);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (L < 0.1 || mx < x0 || mx > x1 || mz < z0 || mz > z1) { flush(); continue; }
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      // (the wall's side: the one off the street)
      let nx = -uz, nz = ux;
      if (toStreet(mx + nx * 5, mz + nz * 5) < toStreet(mx - nx * 5, mz - nz * 5)) { nx = -nx; nz = -nz; }
      for (let d = 0; d < L; d += STEP) {
        const x = a.x + ux * d, z = a.z + uz * d;
        const w = { x: x + nx * (half + 0.4), z: z + nz * (half + 0.4) }, r = { x: x - nx * (half + 0.15), z: z - nz * (half + 0.15) };
        if (crossed(w.x, w.z) || crossed(r.x, r.z)) { flush(); continue; }
        wall.push(w); wallOut.push({ x: -nx, z: -nz }); rail.push(r);
      }
    }
    flush();
  }
  return { walls, rails };
}

// The walls & gates as built, once, and their lines' samples by CELL m cell (campusClaims)
let PLAN: CampusPlan | null = null;
let LINES: Map<number, PointXZ[]> | null = null;
function campusPlan(): CampusPlan {
  if (PLAN) return PLAN;
  const canal = canalWalls();
  const walls = [...campusWalls(), ...canal.walls], gates = campusGates(walls);
  const lines = new Map<number, PointXZ[]>();
  const put = (p: PointXZ) => {
    const k = Math.floor(p.x / CELL) * 4096 + Math.floor(p.z / CELL);
    let list = lines.get(k);
    if (!list) lines.set(k, (list = []));
    list.push(p);
  };
  for (const w of walls) w.pts.forEach(put);
  for (const g of gates) for (let t = g.s0; t <= g.s1; t += 1) put({ x: g.c.x + g.along.x * t, z: g.c.z + g.along.z * t });
  LINES = lines;
  return (PLAN = { walls, gates, rails: canal.rails });
}

/** Ground the campus claims (m): its grounds, and CLAIM m round its walls & gates (on the property line, which may
 *  stand out of the grounds' outline: the boulevard's sidewalk). No barda of the town's stands there; the blocks
 *  across the streets keep theirs */
function campusClaims(x: number, z: number): boolean {
  if (!nearBounds(x, x, z, z, 40)) return false;
  if (inCampus(x, z)) return true;
  campusPlan();
  for (let ix = Math.floor((x - CLAIM) / CELL); ix <= Math.floor((x + CLAIM) / CELL); ix++) {
    for (let iz = Math.floor((z - CLAIM) / CELL); iz <= Math.floor((z + CLAIM) / CELL); iz++) {
      if (LINES?.get(ix * 4096 + iz)?.some((p) => Math.hypot(p.x - x, p.z - z) < CLAIM)) return true;
    }
  }
  return false;
}

// The nearest walled street to (x, z) whose line runs along (ux, uz) on the side `out` points to, with no other block
// between (the boulevard's lateral has its strip of camellón between it and the boulevard: the wall stands along the
// boulevard's sidewalk, not the lateral's): its style and distance
function wallStreet(x: number, z: number, ux: number, uz: number, ox: number, oz: number, streets: readonly CityRoad[], sidewalk: number,
  styleOf: (street: string) => WallStyle | undefined): { style: WallStyle; dist: number; half: number; name: string } | null {
  let best: { style: WallStyle; dist: number; half: number; name: string } | null = null;
  for (const r of streets) {
    const style = styleOf(r.name);
    if (!style) continue;
    const reach = REACH[r.name] ?? r.w / 2 + sidewalk + 5;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.5) continue;
      const { px, pz, d: dist } = toSegment(x, z, a, b);
      if (dist > reach || (best && dist >= best.dist)) continue;
      if (Math.abs(((b.x - a.x) * ux + (b.z - a.z) * uz) / L) < PARALLEL || (px - x) * ox + (pz - z) * oz <= 0) continue;
      best = { style, dist, half: r.w / 2, name: r.name };
    }
  }
  if (!best) return null;
  // (off the sidewalk, across the roadway to the street's near edge: nothing but roadway)
  const across = best.dist - best.half - sidewalk - 1;
  for (let d = 1; d < across; d += 2) {
    if (blockAt(x + ox * (sidewalk + d), z + oz * (sidewalk + d))) return null;
  }
  return best;
}

/**
 * The campus's walls: along each block's property line (`sidewalk` m in from its curb) wherever the block is the
 * campus's (INNER m in from the line lies in its grounds) and a walled street runs along it outside, in that street's
 * style. A run ends at a block's corners (the drives into the campus pass between) and wherever the style changes.
 */
function campusWalls(blocks: readonly CityBlock[] = BLOCKS, roads: readonly CityRoad[] = ROADS, sidewalk = GEO.frame.sidewalk || 2.2): CampusWall[] {
  const named = new Set([...Object.keys(WALL_STREETS), ...NEIGHBOURS.flatMap((n) => n.streets)]);
  const streets = roads.filter((r) => named.has(r.name) && r.pts.some((p) => nearBounds(p.x, p.x, p.z, p.z, 60)));
  const campusStyle = (name: string) => WALL_STREETS[name];
  const walls: CampusWall[] = [];
  for (const b of blocks) {
    if (b.median || !nearBounds(b.minX, b.maxX, b.minZ, b.maxZ, 10)) continue;
    const poly = b.poly, n = poly.length;
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    const s = area > 0 ? 1 : -1; // (positive: the inside lies left of each edge, along (-dz, dx))
    const samples: { p: PointXZ; out: PointXZ; style: WallStyle | null; curb: number }[] = [];
    // the turn at each corner (rad): the line is kept off the sharp ones
    const turn = (i: number) => {
      const a = poly[(i + n - 1) % n], c = poly[i], d = poly[(i + 1) % n];
      const t = Math.atan2(d.z - c.z, d.x - c.x) - Math.atan2(c.z - a.z, c.x - a.x);
      return Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
    };
    let carry = 0; // (the samples run on round a gentle bend, STEP apart)
    for (let i = 0; i < n; i++) {
      const a = poly[i], c = poly[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 0.05) continue;
      const ux = (c.x - a.x) / len, uz = (c.z - a.z) / len, nx = -uz * s, nz = ux * s;
      // (not within the sidewalk's width of a corner: there the line runs on into the cross street's sidewalk)
      const sharp0 = turn(i) > SHARP, sharp1 = turn((i + 1) % n) > SHARP;
      const d0 = sharp0 ? sidewalk + STEP / 2 : carry, d1 = sharp1 ? len - sidewalk : len;
      let d = d0;
      for (; d < d1; d += STEP) {
        const x = a.x + ux * d + nx * sidewalk, z = a.z + uz * d + nz * sidewalk;
        // (the campus's, or a walled neighbour's: whose grounds lie INNER m in)
        const qx = x + nx * INNER, qz = z + nz * INNER, inBlock = insidePoly(poly, qx, qz);
        const neighbour = inBlock && !inCampus(qx, qz) ? NEIGHBOURS.find((n) => insidePoly(n.ring, qx, qz)) : undefined;
        const styleOf = neighbour ? (name: string) => (neighbour.streets.includes(name) ? neighbour.style : undefined) : campusStyle;
        const street = inBlock && (neighbour || inCampus(qx, qz)) ? wallStreet(x, z, ux, uz, -nx, -nz, streets, sidewalk, styleOf) : null;
        const grounds = street && !neighbour ? BY_GROUNDS[street.name] : undefined;
        const style = grounds ? grounds[insidePoly(GROUNDS[0], qx, qz) ? 0 : 1] : street?.style ?? null;
        samples.push({ p: { x, z }, out: { x: -nx, z: -nz }, style, curb: street ? street.dist - street.half : 0 });
      }
      carry = sharp1 ? 0 : d - len;
    }
    // (start just after a sample not walled, so a run never wraps round the ring's end)
    const k = samples.findIndex((q) => !q.style);
    if (k < 0) {
      if (samples.length) samples.push({ ...samples[0] });
    } else samples.push(...samples.splice(0, k + 1));
    let run: typeof samples = [];
    const flush = () => {
      const first = run.at(0);
      // (the sidewalk out to the roadway's edge: the street's own, which may run past the block's curb)
      const curbs = run.map((q) => q.curb).sort((a, b) => a - b);
      if (run.length > 1 && first?.style) walls.push({ style: first.style, pts: run.map((q) => q.p), out: run.map((q) => q.out), curb: curbs[curbs.length >> 1] });
      run = [];
    };
    for (const q of samples) {
      const last = run.length ? run[run.length - 1] : null;
      if (last && (q.style !== last.style || Math.hypot(q.p.x - last.p.x, q.p.z - last.p.z) > STEP * 2.5)) flush();
      if (q.style) run.push(q);
    }
    flush();
  }
  for (const [r, i0, i1, style] of OUTLINE_WALLS) {
    const ring = GROUNDS[r], pts: PointXZ[] = [], out: PointXZ[] = [];
    for (let i = i0; i < i1; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.1) continue;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      // (out: the side off the grounds)
      const n = inCampus((a.x + b.x) / 2 - uz * 2, (a.z + b.z) / 2 + ux * 2) ? { x: uz, z: -ux } : { x: -uz, z: ux };
      for (let d = 0; d < L; d += STEP) { pts.push({ x: a.x + ux * d - n.x * OUTLINE_IN, z: a.z + uz * d - n.z * OUTLINE_IN }); out.push(n); }
    }
    const end = ring[i1 % ring.length], last = out[out.length - 1];
    pts.push({ x: end.x - last.x * OUTLINE_IN, z: end.z - last.z * OUTLINE_IN });
    out.push(last);
    const taken = (p: PointXZ) => walls.some((w) => w.curb && w.pts.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3));
    let run: number[] = [];
    pts.forEach((p, k) => {
      if (!taken(p)) run.push(k);
      if ((taken(p) || k === pts.length - 1) && run.length > 1) walls.push({ style, pts: run.map((i) => pts[i]), out: run.map((i) => out[i]), curb: 0 });
      if (taken(p)) run = [];
    });
  }
  // (runs of a style end to end, from blocks side by side, joined)
  for (let joined = true; joined;) {
    joined = false;
    for (const a of walls) {
      const end = a.pts[a.pts.length - 1];
      const b = walls.find((w) => w !== a && w.style === a.style && Math.hypot(w.pts[0].x - end.x, w.pts[0].z - end.z) < JOIN);
      if (!b) continue;
      a.pts.push(...b.pts);
      a.out.push(...b.out);
      walls.splice(walls.indexOf(b), 1);
      joined = true;
      break;
    }
  }
  return walls;
}

// The drive nearest p within 40 m (none of the walled streets): its direction there (unit) and width (m)
function nearestDrive(p: PointXZ): { ux: number; uz: number; w: number } | null {
  const road = nearestRoads(p.x, p.z, 40).find((n) => !WALL_STREETS[n.road.name])?.road;
  if (!road) return null;
  let best: { ux: number; uz: number; w: number } | null = null, bestD = Infinity;
  for (let i = 0; i + 1 < road.pts.length; i++) {
    const a = road.pts[i], b = road.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), { d } = toSegment(p.x, p.z, a, b);
    if (L > 0.1 && d < bestD) { bestD = d; best = { ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, w: road.w }; }
  }
  return best;
}

/**
 * The gates, cut into the walls (which they change). Each stands on the line through its drives' gate nodes (a single
 * node's: across its drive), an opening over each drive as wide as the drive and PIER m more either side for its
 * piers (the portals are built within s0..s1); where the walls end within GAP m of it, it reaches them, closing the gap. The walls along its line are cut
 * where it stands.
 */
function campusGates(walls: CampusWall[]): CampusGate[] {
  const gates: CampusGate[] = [];
  for (const [kind, nodes] of GATES_DEG) {
    const pts = nodes.map(([lat, lon]) => {
      const [x, z] = geoToWorld(lat, lon);
      return { x, z };
    });
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
    // the walls' samples near it: the line (a single node's) and the way out
    const near: { w: CampusWall; k: number; d: number }[] = [];
    for (const w of walls) {
      w.pts.forEach((p, k) => {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < GAP + 10) near.push({ w, k, d });
      });
    }
    near.sort((a, b) => a.d - b.d);
    let along: PointXZ;
    if (pts.length > 1) {
      const dx = pts[pts.length - 1].x - pts[0].x, dz = pts[pts.length - 1].z - pts[0].z, L = Math.hypot(dx, dz);
      along = { x: dx / L, z: dz / L };
    } else {
      // (a single node: across the drive it is on)
      const seg = nearestDrive(pts[0]);
      if (!seg) continue;
      along = { x: -seg.uz, z: seg.ux };
    }
    // the way out: off the campus (where that can't tell, the walls' near it)
    let out = { x: -along.z, z: along.x };
    const ahead = inCampus(c.x + out.x * 12, c.z + out.z * 12), behind = inCampus(c.x - out.x * 12, c.z - out.z * 12);
    const o = near.length ? near[0].w.out[near[0].k] : null;
    if (ahead !== behind ? ahead : o && o.x * out.x + o.z * out.z < 0) out = { x: -out.x, z: -out.z };
    // the drives: each node's opening as wide as the road under it
    const openings = pts.map((p) => ({ t: (p.x - c.x) * along.x + (p.z - c.z) * along.z, w: Math.min(nearestDrive(p)?.w ?? 4.5, 8) }));
    let s0 = Math.min(...openings.map((q) => q.t - q.w / 2)) - PIER[kind], s1 = Math.max(...openings.map((q) => q.t + q.w / 2)) + PIER[kind];
    const wide = (MIN_SPAN[kind] ?? 0) - (s1 - s0);
    if (wide > 0) { s0 -= wide / 2; s1 += wide / 2; }
    // reaching the walls' ends on its line
    for (const { w, k } of near) {
      if (k !== 0 && k !== w.pts.length - 1) continue;
      const p = w.pts[k], t = (p.x - c.x) * along.x + (p.z - c.z) * along.z, off = (p.x - c.x) * out.x + (p.z - c.z) * out.z;
      if (Math.abs(off) > 4) continue;
      if (t < s0 && t > s0 - GAP) s0 = t;
      if (t > s1 && t < s1 + GAP) s1 = t;
    }
    // cut the walls where it stands
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      const cut = w.pts.map((p) => {
        const t = (p.x - c.x) * along.x + (p.z - c.z) * along.z, off = (p.x - c.x) * out.x + (p.z - c.z) * out.z;
        return t > s0 - 0.3 && t < s1 + 0.3 && Math.abs(off) < 4;
      });
      if (!cut.some(Boolean)) continue;
      walls.splice(i, 1);
      let k0 = 0;
      for (let k = 0; k <= w.pts.length; k++) {
        if (k < w.pts.length && !cut[k]) continue;
        if (k - k0 > 1) walls.push({ style: w.style, pts: w.pts.slice(k0, k), out: w.out.slice(k0, k), curb: w.curb });
        k0 = k + 1;
      }
    }
    gates.push({ kind, style: near.length ? near[0].w.style : 'blue', c, along, out, s0, s1, openings });
  }
  // the walls on from the gates' ends (to a wall's end, or another gate's)
  interface End { g: CampusGate; p: PointXZ; side: number; done: boolean }
  const ends = gates.flatMap((g) => [g.s0, g.s1].map((s): End => ({ g, p: { x: g.c.x + g.along.x * s, z: g.c.z + g.along.z * s }, side: Math.sign(s), done: false })));
  for (const e of ends) {
    if (e.done) continue;
    const targets: { p: PointXZ; style: WallStyle; end: End | null }[] = [
      ...walls.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]].map((p) => ({ p, style: w.style, end: null }))),
      ...ends.filter((f) => f.g !== e.g && !f.done).map((f) => ({ p: f.p, style: e.g.style, end: f }))
    ];
    const to = joinGate(walls, e.g, e.p, e.side, targets);
    if (to) to.done = true;
  }
  closeGaps(walls, gates);
  // (the strays dropped)
  const loose = walls.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]).concat(gates.flatMap((g) => [g.s0, g.s1].map((s) => ({ x: g.c.x + g.along.x * s, z: g.c.z + g.along.z * s }))));
  const met = (p: PointXZ) => loose.some((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 3);
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i], a = w.pts[0], b = w.pts[w.pts.length - 1];
    if (Math.hypot(b.x - a.x, b.z - a.z) < STRAY && !met(a) && !met(b)) walls.splice(i, 1);
  }
  return gates;
}

// The wall on from a gate's end e (on its `side` of it, -1 or 1) to the nearest of `targets` within REJOIN m (a wall's
// end, another gate's), straight, where it keeps to the blocks (no roadway between): the portals stand in a wall, not
// on their own. Returns the gate's end it reached, if one
function joinGate<T>(walls: CampusWall[], g: CampusGate, e: PointXZ, side: number, targets: { p: PointXZ; style: WallStyle; end: T | null }[]): T | null {
  let best: { p: PointXZ; style: WallStyle; end: T | null; d: number } | null = null;
  for (const q of targets) {
    const p = q.p, d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d < 1 || d > REJOIN || (best && d >= best.d)) continue;
    if (((p.x - g.c.x) * g.along.x + (p.z - g.c.z) * g.along.z) * side <= 0) continue; // (back past the gate)
    let onBlocks = true;
    for (let t = 1.5; t < d - 1.5 && onBlocks; t += 1) onBlocks = !!blockAt(e.x + ((p.x - e.x) * t) / d, e.z + ((p.z - e.z) * t) / d);
    if (onBlocks) best = { ...q, d };
  }
  if (!best) return null;
  const { p, d } = best, ux = (p.x - e.x) / d, uz = (p.z - e.z) / d;
  // (out: the side the gate's out is on)
  const out = -uz * g.out.x + ux * g.out.z >= 0 ? { x: -uz, z: ux } : { x: uz, z: -ux };
  const n = Math.max(1, Math.round(d / STEP)), pts: PointXZ[] = [];
  for (let k = 0; k <= n; k++) pts.push({ x: e.x + ux * (d * k) / n, z: e.z + uz * (d * k) / n });
  walls.push({ style: best.style, pts, out: pts.map(() => out), curb: 0 });
  return best.end;
}

// a-b keeps off the roadways (but within a metre of its ends): on the blocks, or off them but on no street (a corner's
// sliver between two blocks)
function onBlocks(a: PointXZ, b: PointXZ): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  for (let t = 1; t < d - 1; t += 1) {
    const x = a.x + ((b.x - a.x) * t) / d, z = a.z + ((b.z - a.z) * t) / d;
    if (!blockAt(x, z) && nearestRoads(x, z, 12).some((n) => n.dist < n.road.w / 2 + 0.5)) return false;
  }
  return true;
}

// Where the lines from a along u and from b along v meet, ahead of both (null: parallel, or behind)
function meet(a: PointXZ, u: PointXZ, b: PointXZ, v: PointXZ): PointXZ | null {
  const den = u.x * v.z - u.z * v.x;
  if (Math.abs(den) < 0.2) return null;
  const t = ((b.x - a.x) * v.z - (b.z - a.z) * v.x) / den, s = ((b.x - a.x) * u.z - (b.z - a.z) * u.x) / den;
  return t > 0 && s > 0 ? { x: a.x + u.x * t, z: a.z + u.z * t } : null;
}

/**
 * The gaps left between the walls' ends closed (a block's corner on a footpath, the strips' breaks along the boulevard,
 * a street's corner where its style changes): each end walled on straight to the nearest end ahead of it within CLOSE
 * m where that keeps to the blocks; where a campus drive crosses the gap instead (OpenStreetMap's unnamed ways), a
 * plain gate across it, open. A public street's mouth stays open. Ends at a gate are its (joinGate's).
 */
function closeGaps(walls: CampusWall[], gates: CampusGate[]): void {
  const atGate = (p: PointXZ) => gates.some((g) => {
    const t = (p.x - g.c.x) * g.along.x + (p.z - g.c.z) * g.along.z;
    return t > g.s0 - 3 && t < g.s1 + 3 && Math.abs((p.x - g.c.x) * g.out.x + (p.z - g.c.z) * g.out.z) < 5;
  });
  interface End { w: CampusWall; p: PointXZ; ahead: PointXZ; out: PointXZ; done: boolean }
  const ends: End[] = [];
  for (const w of walls) {
    const n = w.pts.length;
    if (n < 2) continue;
    for (const [k, k1] of [[0, 1], [n - 1, n - 2]]) {
      const p = w.pts[k], q = w.pts[k1], L = Math.hypot(p.x - q.x, p.z - q.z) || 1;
      if (!atGate(p)) ends.push({ w, p, ahead: { x: (p.x - q.x) / L, z: (p.z - q.z) / L }, out: w.out[k], done: false });
    }
  }
  for (const e of ends) {
    if (e.done) continue;
    let best: { f: End; d: number } | null = null;
    for (const f of ends) {
      if (f === e || f.done || f.w === e.w) continue;
      const dx = f.p.x - e.p.x, dz = f.p.z - e.p.z, d = Math.hypot(dx, dz);
      // (a short gap closes whichever way: round a corner)
      if (d < 0.5 || d > CLOSE || (best && d >= best.d) || (d > SHORT && dx * e.ahead.x + dz * e.ahead.z < 0.3 * d)) continue;
      best = { f, d };
    }
    if (!best) continue;
    const { f, d } = best, ux = (f.p.x - e.p.x) / d, uz = (f.p.z - e.p.z) / d;
    // (a footbridge's landing: the way in on foot stays open)
    if (footbridgeAt((e.p.x + f.p.x) / 2, (e.p.z + f.p.z) / 2, d / 2 + 1)) continue;
    const out = -uz * e.out.x + ux * e.out.z >= 0 ? { x: -uz, z: ux } : { x: uz, z: -ux };
    // straight across, or (a street corner cut off the block) on round the corner: where the two walls' lines meet, or
    // in from the street a few metres
    let path: PointXZ[] | null = onBlocks(e.p, f.p) ? [e.p, f.p] : null;
    if (!path && d <= SHORT) {
      const ox = e.out.x + f.out.x, oz = e.out.z + f.out.z, oL = Math.hypot(ox, oz) || 1;
      const corners = [meet(e.p, e.ahead, f.p, f.ahead)];
      for (let k = 1; k <= 8; k++) corners.push({ x: (e.p.x + f.p.x) / 2 - (ox / oL) * k, z: (e.p.z + f.p.z) / 2 - (oz / oL) * k });
      const corner = corners.find((c) => c && Math.hypot(c.x - e.p.x, c.z - e.p.z) < SHORT && onBlocks(e.p, c) && onBlocks(c, f.p));
      if (corner) path = [e.p, corner, f.p];
    }
    if (path) {
      const pts: PointXZ[] = [path[0]], outs: PointXZ[] = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(L / STEP));
        for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
      for (let i = 0; i < pts.length; i++) {
        // (each sample's way out: off the line there, on the side e's is)
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const vx = (b.x - a.x) / L, vz = (b.z - a.z) / L;
        outs.push(-vz * out.x + vx * out.z >= 0 ? { x: -vz, z: vx } : { x: vz, z: -vx });
      }
      // (along a street, between two of its walls, the sidewalk on too)
      walls.push({ style: e.w.style, pts, out: outs, curb: path.length === 2 && e.w.curb && f.w.curb ? (e.w.curb + f.w.curb) / 2 : 0 });
    } else {
      // (a drive across: a gate, if it is the campus's own and there is room for its piers)
      const c = { x: (e.p.x + f.p.x) / 2, z: (e.p.z + f.p.z) / 2 };
      const road = nearestRoads(c.x, c.z, 10).at(0)?.road;
      const w = Math.min(road?.w ?? 0, d - 2 * PIER.plain);
      if (!road || road.name || w < 3) continue;
      gates.push({ kind: 'plain', style: e.w.style, c, along: { x: ux, z: uz }, out, s0: -d / 2, s1: d / 2, openings: [{ t: 0, w }] });
    }
    e.done = f.done = true;
  }
}

/**
 * The campus's buildings (Overture Maps' footprints in its grounds, city-geodata.js `houses`), and what each is: stands
 * (a sliver ten times as long as it is deep), a domo (a one-storey hall over 900 m² and 22 m across: the gyms and
 * auditoriums under their white vaults), a row of aulas (long and narrow, its classrooms opening on a corridor) or an
 * academic building; and its name where Overture's places give one (the faculties', the library's, the auditoriums').
 */
function campusBuildings(): CampusBuilding[] {
  const H = GEO.houses, S = GEO.houseStride || 8, out: CampusBuilding[] = [];
  for (let i = 0; i + 6 < H.length; i += S) {
    const cx = H[i] / 10, cz = H[i + 1] / 10;
    if (!inCampus(cx, cz)) continue;
    const w = H[i + 2] / 10, d = H[i + 3] / 10, storeys = Math.max(1, Math.min(4, H[i + 5]));
    const long = Math.max(w, d), short = Math.min(w, d);
    const kind: BuildingKind = long > short * 9 && short < 11 ? 'gradas'
      : storeys === 1 && w * d > 900 && short > 22 ? 'domo'
        : short < 13.5 && long > short * 2.6 ? 'aulas' : 'edificio';
    const seed = (((Math.imul(Math.round(cx * 4), 73856093) ^ Math.imul(Math.round(cz * 4), 19349663)) >>> 0) % 10007) / 10007;
    // (a place's own name carries its trade's sign; the trades' generic signs, a guess, are not put up)
    const sign = S > 7 && H[i + 7] ? GEO.signs[H[i + 7] - 1] : null;
    out.push({ cx, cz, w, d, th: H[i + 4] / 1000, storeys, kind, seed, name: sign?.trade ? sign.text : null });
  }
  return out;
}

// The campus's buildings by 32 m cell, built on first use (inCampusBuilding)
let BUILDING_CELLS: Map<number, CampusBuilding[]> | null = null;
/** Under one of the campus's buildings, or within `pad` m of its walls (no pole, lamp or tree of the town's stands there) */
function inCampusBuilding(x: number, z: number, pad = 0): boolean {
  if (!nearBounds(x, x, z, z, 20)) return false;
  if (!BUILDING_CELLS) {
    BUILDING_CELLS = new Map();
    for (const b of campusBuildings()) {
      const r = Math.hypot(b.w, b.d) / 2 + 4;
      for (let ix = Math.floor((b.cx - r) / 32); ix <= Math.floor((b.cx + r) / 32); ix++) {
        for (let iz = Math.floor((b.cz - r) / 32); iz <= Math.floor((b.cz + r) / 32); iz++) {
          const k = ix * 4096 + iz;
          let list = BUILDING_CELLS.get(k);
          if (!list) BUILDING_CELLS.set(k, (list = []));
          list.push(b);
        }
      }
    }
  }
  return (BUILDING_CELLS.get(Math.floor(x / 32) * 4096 + Math.floor(z / 32)) ?? []).some((b) => {
    const dx = x - b.cx, dz = z - b.cz, c = Math.cos(b.th), s = Math.sin(b.th);
    return Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad;
  });
}

// The campus's trees, as the satellite shows them: big laureles de la India, mangos, tabachines, jacarandas and palms
// in rows along the inside of its walls, along both sides of its drives and beside its walks, and in groves between
// its buildings and round its fields (the fields themselves stay open: street-details.ts keeps every tree of the
// game's own off the mapped pitches). [m, the share of the places a tree may stand that get one]
const TREE = {
  wallIn: 4, wallEvery: 8, wallP: 0.85,
  driveOff: 2.6, driveEvery: 9, driveP: 0.85,
  walkOff: 1.8, walkEvery: 8, walkP: 0.55,
  grove: 10, groveCell: 45,
  apart: 5.5, // m between two trees at least
  building: 3.5, road: 1.6, walk: 0.9, wall: 2.5 // m clear of each
};

/**
 * The campus's tree sites (m; scale over the species' usual, species: 0 laurel, 1 jacaranda, 2 mango, 3 tabachín,
 * 4 palm; tier 1 the rows', 2 the groves'): clear of its buildings, drives, walks, car parks & walls, TREE.apart from
 * each other. Plain data (no three.js): street-details.ts plants them
 */
function campusTrees(): TreeSite[] {
  const { walls } = campusPlan();
  const buildings = campusBuildings();
  const sites: TreeSite[] = [];
  const taken = new Map<number, PointXZ[]>();
  const cellOf = (x: number, z: number) => Math.floor(x / 8) * 4096 + Math.floor(z / 8);
  // the walls' samples by cell, for their clearance
  const wallCells = new Map<number, PointXZ[]>();
  for (const w of walls) for (const p of w.pts) {
    const k = cellOf(p.x, p.z);
    let list = wallCells.get(k);
    if (!list) wallCells.set(k, (list = []));
    list.push(p);
  }
  const near = (cells: Map<number, PointXZ[]>, x: number, z: number, r: number) => {
    for (let ix = Math.floor((x - r) / 8); ix <= Math.floor((x + r) / 8); ix++) {
      for (let iz = Math.floor((z - r) / 8); iz <= Math.floor((z + r) / 8); iz++) {
        if (cells.get(ix * 4096 + iz)?.some((p) => Math.hypot(p.x - x, p.z - z) < r)) return true;
      }
    }
    return false;
  };
  const walks = GEO.footways.filter(([, , f]) => f.length >= 4 && nearBounds(f[0], f[0], f[1], f[1], 100));
  const parks = GEO.parking.filter(([, , , r]) => r.length >= 6 && nearBounds(r[0], r[0], r[1], r[1], 200)).map(([, , , r]) => r);
  const clear = (x: number, z: number) => {
    if (!inCampus(x, z) || near(taken, x, z, TREE.apart) || near(wallCells, x, z, TREE.wall)) return false;
    for (const b of buildings) {
      const dx = x - b.cx, dz = z - b.cz;
      if (Math.abs(dx) > 120 || Math.abs(dz) > 120) continue;
      const c = Math.cos(b.th), s = Math.sin(b.th), lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w / 2 + TREE.building && Math.abs(lz) < b.d / 2 + TREE.building) return false;
    }
    if (onRoadway(x, z, TREE.road)) return false;
    for (const [, w, f] of walks) {
      for (let i = 0; i + 3 < f.length; i += 2) {
        if (Math.abs(f[i] - x) > 40 || Math.abs(f[i + 1] - z) > 40) continue;
        if (toSegment(x, z, { x: f[i], z: f[i + 1] }, { x: f[i + 2], z: f[i + 3] }).d < w / 2 + TREE.walk) return false;
      }
    }
    return !parks.some((r) => insideRing(r, x, z));
  };
  const plant = (x: number, z: number, tier: number, palms: number) => {
    if (!clear(x, z)) return;
    const r = hash(x, z, 51);
    const species = r < palms ? 4 : r < palms + (1 - palms) * 0.48 ? 0 : r < palms + (1 - palms) * 0.74 ? 2 : r < palms + (1 - palms) * 0.88 ? 3 : 1;
    sites.push({ x, z, scale: (species === 4 ? 0.85 : 1.0) + hash(z, x, 52) * 0.45, species, tier });
    const k = cellOf(x, z);
    let list = taken.get(k);
    if (!list) taken.set(k, (list = []));
    list.push({ x, z });
  };
  // along a line a-b, `off` m to the side `side` (+1 left of a→b, -1 right), every `every` m with chance p
  const row = (a: PointXZ, b: PointXZ, off: number, side: number, every: number, p: number, palms: number) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.5) return;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz * side, nz = ux * side;
    for (let d = every / 2; d < L; d += every) {
      const x = a.x + ux * d + nx * off, z = a.z + uz * d + nz * off;
      if (hash(x, z, 53) < p) plant(x, z, 1, palms);
    }
  };
  // 1. along the inside of the walls
  for (const w of walls) {
    for (let i = 0; i < w.pts.length; i++) {
      if (i % Math.round(TREE.wallEvery / STEP)) continue;
      const p = w.pts[i], o = w.out[i];
      if (hash(p.x, p.z, 54) < TREE.wallP) plant(p.x - o.x * TREE.wallIn, p.z - o.z * TREE.wallIn, 1, 0.12);
    }
  }
  // 2. both sides of the drives through it, every one the traffic drives (laureles, a palm here and there)
  const g = GEO.roadGraph, N = g.nodes;
  for (const [a, b, , w, , , inner] of g.links) {
    const flat = [N[2 * a], N[2 * a + 1], ...inner, N[2 * b], N[2 * b + 1]];
    if (!nearBounds(flat[0], flat[0], flat[1], flat[1], 400)) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const p = { x: flat[i], z: flat[i + 1] }, q = { x: flat[i + 2], z: flat[i + 3] };
      if (!inCampus(p.x, p.z) && !inCampus(q.x, q.z)) continue;
      for (const side of [1, -1]) row(p, q, w / 2 + TREE.driveOff, side, TREE.driveEvery, TREE.driveP, 0.2);
    }
  }
  // 3. beside its walks
  for (const [, w, f] of walks) {
    for (let i = 0; i + 3 < f.length; i += 2) {
      const side = hash(f[i], f[i + 1], 55) < 0.5 ? 1 : -1;
      row({ x: f[i], z: f[i + 1] }, { x: f[i + 2], z: f[i + 3] }, w / 2 + TREE.walkOff, side, TREE.walkEvery, TREE.walkP, 0.1);
    }
  }
  // 4. the groves: thick in some places, thin in others
  for (let gx = BOUNDS.x0; gx < BOUNDS.x1; gx += TREE.grove) {
    for (let gz = BOUNDS.z0; gz < BOUNDS.z1; gz += TREE.grove) {
      const x = gx + (hash(gx, gz, 56) - 0.5) * TREE.grove * 0.8, z = gz + (hash(gz, gx, 57) - 0.5) * TREE.grove * 0.8;
      const clump = hash(Math.floor(x / TREE.groveCell), Math.floor(z / TREE.groveCell), 58);
      if (hash(x, z, 59) < 0.12 + clump * 0.6) plant(x, z, 2, 0.08);
    }
  }
  return sites;
}

export { GROUNDS, inCampus, inCampusBuilding, campusClaims, campusPlan, campusWalls, campusGates, campusBuildings, campusTrees };
