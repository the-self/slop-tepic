// js/sim/gang-turf.ts
// The gangs' turf (sim/crime.ts): Tepic's colonias, OpenStreetMap's neighbourhood labels (GEO.places), each the ground
// nearer its label than any other's, and a few of them a gang's. A gang holds a colonia at a corner or two of its back
// streets, where its crew hangs about (crime/dispatch.ts): not every street of it, and most colonias are nobody's.
// Which colonias is a hash of their names, as made up as the gangs themselves: no map of real crime.
// No three.js, so node --test imports it directly (tests/gang-turf.test.mjs).
import { GEO } from '../world/city-geodata.js';
import type { RoadGraph } from '../world/city-geodata.js';
import { NARCO } from './crime-rules.ts';

const CELL_REACH = 900; // m: further than this from every label is out of town, nobody's colonia
const CENTRE = 650; // m from the plaza (the origin) within which no gang holds a colonia
const EDGE = 2600; // m from the plaza beyond which the cartel can hold a colonia
// Shares of the colonias each holds (by the hash of the name): Los Rojos, Los Verdes, and the cartel's out on the edges
const ROJOS = 0.08, VERDES = 0.08, CARTEL = 0.07;
const CORNER_REACH = 420; // m from its label a colonia's corners can be
const CORNER_GAP = 160; // m at least between two corners of one colonia
const CORNERS = 2; // a colonia's corners at most
const BACK_STREET = 12; // m: a link wider than this is an avenue, nobody's corner (most streets are ~7.4 m)
// (a one-way link of two lanes or more is one carriageway of a divided avenue, Insurgentes' or the Libramiento's,
// each narrower than BACK_STREET: an avenue too; a one-way back street has the one lane)
const CARRIAGEWAY_LANES = 2;
const KERB = 2.4; // m past the roadway's edge a crew stands
const CORNER_CELL = 200; // m: the corners bucketed in squares this big for cornersNear
// (not housing, or behind a gate: nobody's)
const NOBODYS = /residencial|coto |country|biosfera|se[ñn]or[ií]o|ciudad de|ageuan|universi/i;

/** A street corner a gang's crew hangs about on (m), in the colonia `colonia` (an index into Turf.colonias). */
export interface TurfCorner {
  id: number; // its index in Turf.corners
  x: number;
  z: number;
  colonia: number;
}

/** A colonia: its label (m), the gang that holds it (a GANGS index, -1 nobody) and the corners its crew stands on. */
export interface Colonia {
  name: string;
  x: number;
  z: number;
  gang: number;
  corners: TurfCorner[];
}

// FNV-1a over a name, to [0, 1), mixed at the end (murmur3's fmix32) so names a letter apart land far apart
function hashName(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash2(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The gang that holds a colonia named `name` with its label at (x, z), or -1
function holder(name: string, x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < CENTRE || NOBODYS.test(name)) return -1;
  const h = hashName(name);
  return h < ROJOS ? 0 : h < ROJOS + VERDES ? 1 : h < ROJOS + VERDES + CARTEL && r > EDGE ? NARCO : -1;
}

// An arm of a junction: the way it leaves (rad, atan2(dz, dx)) and its roadway's width (m)
interface Arm {
  angle: number;
  width: number;
}

// The road graph's junctions (three arms or more, none of them an avenue or its carriageway, a bridge or an
// underpass), each with a spot on the sidewalk at one of its corners: [node, x, z]
function backStreetCorners(graph: RoadGraph): [node: number, x: number, z: number][] {
  const N = graph.nodes;
  const arms = new Map<number, Arm[] | null>(); // (null: an avenue's junction)
  for (const [a, b, , width, lanes, dir, inner, lifts, way] of graph.links) {
    const avenue = width > BACK_STREET || (dir !== 0 && lanes >= CARRIAGEWAY_LANES);
    for (const [n, other, first] of [[a, b, 0], [b, a, inner.length - 2]] as const) {
      // (an avenue's junction, or one up on a deck or down in a cut, is nobody's corner: mark it so)
      if (avenue || way || lifts) {
        arms.set(n, null);
        continue;
      }
      let list = arms.get(n);
      if (list === null) continue;
      if (!list) arms.set(n, (list = []));
      // (towards the first point the link leaves by: its first interior point, else the far node)
      const tx = inner.length ? inner[first] : N[other * 2], tz = inner.length ? inner[first + 1] : N[other * 2 + 1];
      list.push({ angle: Math.atan2(tz - N[n * 2 + 1], tx - N[n * 2]), width });
    }
  }
  const out: [number, number, number][] = [];
  arms.forEach((list, n) => {
    if (!list || list.length < 3) return;
    list.sort((p, q) => p.angle - q.angle);
    // one of its corners, the same every time: between two arms next to each other
    const k = Math.floor(hash2(n, 7) * list.length);
    const p = list[k], q = list[(k + 1) % list.length];
    const gap = (q.angle - p.angle + Math.PI * 2) % (Math.PI * 2);
    if (gap < 0.6 || gap > Math.PI * 1.3) return; // (too sharp a corner, or none: a bend)
    const kerb = Math.max(p.width, q.width) / 2 + KERB;
    const d = Math.min(kerb / Math.sin(gap / 2), kerb * 2.5);
    const bis = p.angle + gap / 2;
    out.push([n, N[n * 2] + Math.cos(bis) * d, N[n * 2 + 1] + Math.sin(bis) * d]);
  });
  return out;
}

export class Turf {
  readonly colonias: Colonia[];
  readonly corners: TurfCorner[] = [];
  private readonly cells = new Map<number, TurfCorner[]>();

  constructor(places: readonly { name: string; x: number; z: number }[], graph: RoadGraph) {
    this.colonias = places.map((p) => ({ name: p.name, x: p.x, z: p.z, gang: holder(p.name, p.x, p.z), corners: [] }));
    // each held colonia's candidate corners, near its label and in its own ground (out of the centre: a colonia's
    // ground can reach in past CENTRE though its label stands outside), by a hash the same every time
    const candidates = new Map<number, [rank: number, x: number, z: number][]>();
    for (const [n, x, z] of backStreetCorners(graph)) {
      if (Math.hypot(x, z) < CENTRE) continue;
      const c = this.coloniaAt(x, z);
      if (c < 0) continue;
      const col = this.colonias[c];
      if (col.gang < 0 || Math.hypot(x - col.x, z - col.z) > CORNER_REACH) continue;
      let list = candidates.get(c);
      if (!list) candidates.set(c, (list = []));
      list.push([hash2(n, c), x, z]);
    }
    this.colonias.forEach((col, c) => {
      const list = candidates.get(c);
      if (!list) {
        col.gang = -1; // (no back-street corner to hold it at: nobody's)
        return;
      }
      list.sort((p, q) => p[0] - q[0]);
      for (const [, x, z] of list) {
        if (col.corners.length >= CORNERS) break;
        if (col.corners.some((k) => Math.hypot(k.x - x, k.z - z) < CORNER_GAP)) continue;
        const k: TurfCorner = { id: this.corners.length, x, z, colonia: c };
        col.corners.push(k);
        this.corners.push(k);
        const key = this.cellKey(Math.floor(x / CORNER_CELL), Math.floor(z / CORNER_CELL));
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        cell.push(k);
      }
    });
  }

  private cellKey(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** The colonia (x, z) is in: an index into `colonias`, or -1 out of town. */
  coloniaAt(x: number, z: number): number {
    let best = -1, bd = CELL_REACH * CELL_REACH;
    const cols = this.colonias;
    for (let i = 0; i < cols.length; i++) {
      const dx = cols[i].x - x, dz = cols[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** The gang whose colonia (x, z) is in (a GANGS index), or -1. */
  gangAt(x: number, z: number): number {
    const c = this.coloniaAt(x, z);
    return c < 0 ? -1 : this.colonias[c].gang;
  }

  /** The corners within `r` m of (x, z), into `out` (emptied first). */
  cornersNear(x: number, z: number, r: number, out: TurfCorner[]): TurfCorner[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / CORNER_CELL), x1 = Math.floor((x + r) / CORNER_CELL);
    const z0 = Math.floor((z - r) / CORNER_CELL), z1 = Math.floor((z + r) / CORNER_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(this.cellKey(ix, iz));
        if (cell) for (const k of cell) if (Math.hypot(k.x - x, k.z - z) <= r) out.push(k);
      }
    }
    return out;
  }
}

let town: Turf | null = null;
/** Tepic's turf, from its colonias and road graph (built the first time it is asked for). */
function townTurf(): Turf {
  town ??= new Turf(GEO.places, GEO.roadGraph);
  return town;
}

export { townTurf, CENTRE, EDGE };
