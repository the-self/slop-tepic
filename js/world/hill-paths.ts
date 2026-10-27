// js/world/hill-paths.ts
// The paths up the hills (city-geodata.js terrain.paths: the cobbled road up the Cerro de la Cruz, the paved and earth
// paths & trails), level across their width as a path is built on a hillside. The hills' grid is 37.5-75 m, so a path
// laid on it leans as its hillside does (up to 1:1 across the road up the Cerro de la Cruz, which nobody walks up):
// instead each cross-section is held at the height of its highest point, the hillside's mesh under it from edge to
// edge, its downhill edge on an embankment (terrain.ts draws its retaining wall or its bank), and the walkers stand on
// that (ground.ts landHeight). Along its length it climbs as it does. Off the hills the streets are there already, but
// where `alsoAt` says (the foot of the Cerro de la Cruz, cerro.ts) a path's run along a street leaning across more than
// LEAN is levelled the same way: the town's grid (37.5 m) leans its streets there with the hill's slope.
// No three.js here, so node --test imports it directly.
import type { HillPath } from './city-geodata.js';
import type { HeightFn } from './lattice.ts';

/** A cross-section of a hill path: its middle (x, z) (m), the path's heading there (dx, dz, a unit vector), and the
 *  level (m, the land's frame) its whole width is held at */
export interface PathSection {
  x: number;
  z: number;
  dx: number;
  dz: number;
  level: number;
}
/** A hill path: its surface (0 cobbles, 1 concrete / paving, 2 earth), half its width (m), its cross-sections every
 *  PATH_STEP m, and which runs between them are levelled (on[k] for the run from section k to k + 1: on the hills, or
 *  leaning where `alsoAt` says; off them, in town, the streets are there already) */
export interface LevelPath {
  surface: 0 | 1 | 2;
  half: number;
  sections: PathSection[];
  on: Uint8Array;
}
export type HillPaths = ReturnType<typeof createHillPaths>;

const PATH_STEP = 2.5; // m between a path's cross-sections
const ON_HILL = 0.3; // m: a run whose ends' hill rises no higher than this is in town
const ACROSS = 6; // land samples across a cross-section, edge to edge (the grid's triangles are planes: a few find its top)
const CELL = 16; // m: the runs' index
const COARSE = 64; // m: the cells of the index's map of where any run is (most of the ground asked of lies in none)
const LEAN = 0.12; // rise over run across a street (~7°) past which, where `alsoAt` says, its path is levelled

/**
 * The hill paths, levelled across over `land` (the land's height, m) where `hill` (the hills' own height over the
 * valley floor, m) rises, and where `alsoAt` (x, z) says along a street leaning across. level(x, z, g): the height (m)
 * to stand at on (x, z), whose land is g: the path's level where one runs over it, else g
 */
function createHillPaths(paths: readonly HillPath[], land: HeightFn, hill: HeightFn, alsoAt: ((x: number, z: number) => boolean) | null = null) {
  const levelled: LevelPath[] = [];
  for (const [surface, width, flat] of paths) {
    const half = width / 2;
    const sections: PathSection[] = [];
    const lean: number[] = []; // rise over run across each section
    const section = (x: number, z: number, dx: number, dz: number) => {
      let level = -Infinity, low = Infinity;
      for (let k = 0; k <= ACROSS; k++) {
        const o = half * (2 * k / ACROSS - 1);
        const y = land(x - dz * o, z + dx * o);
        level = Math.max(level, y);
        low = Math.min(low, y);
      }
      sections.push({ x, z, dx, dz, level });
      lean.push((level - low) / width);
    };
    let last = -1;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const n = Math.max(1, Math.ceil(L / PATH_STEP));
      for (let k = 0; k < n; k++) section(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, (bx - ax) / L, (bz - az) / L);
      last = i;
    }
    if (last < 0) continue;
    const ax = flat[last], az = flat[last + 1], bx = flat[last + 2], bz = flat[last + 3];
    const L = Math.hypot(bx - ax, bz - az);
    section(bx, bz, (bx - ax) / L, (bz - az) / L);
    const on = new Uint8Array(Math.max(0, sections.length - 1));
    for (let k = 0; k < on.length; k++) {
      const a = sections[k], b = sections[k + 1];
      const leans = alsoAt !== null && Math.max(lean[k], lean[k + 1]) > LEAN && alsoAt(a.x, a.z);
      on[k] = leans || Math.max(hill(a.x, a.z), hill(b.x, b.z)) >= ON_HILL ? 1 : 0;
    }
    levelled.push({ surface, half, sections, on });
  }

  /**
   * A run on the hills, as a segment in the CELL m cells: its ends' middles (ax, az) & (bx, bz) (m), the levels its
   * width is held at there (m, the land's frame: heights, not lifts over the ground), half the path's width (m), and
   * whether the strip goes on past each end (a run of the path on the hills joins it there: past the strip's own ends
   * the land is left as it lies)
   */
  interface Run { ax: number; az: number; bx: number; bz: number; la: number; lb: number; half: number; onA: boolean; onB: boolean }
  const cells = new Map<number, Run[]>();
  const used: number[] = []; // the cells' (ix, iz), flat
  for (const p of levelled) {
    for (let k = 0; k < p.on.length; k++) {
      if (!p.on[k]) continue;
      const a = p.sections[k], b = p.sections[k + 1];
      const run: Run = {
        ax: a.x, az: a.z, bx: b.x, bz: b.z, la: a.level, lb: b.level, half: p.half, onA: k > 0 && p.on[k - 1] === 1, onB: p.on[k + 1] === 1
      };
      for (let ix = Math.floor((Math.min(a.x, b.x) - p.half) / CELL); ix <= Math.floor((Math.max(a.x, b.x) + p.half) / CELL); ix++) {
        for (let iz = Math.floor((Math.min(a.z, b.z) - p.half) / CELL); iz <= Math.floor((Math.max(a.z, b.z) + p.half) / CELL); iz++) {
          const key = ix * 100003 + iz;
          let list = cells.get(key);
          if (!list) {
            cells.set(key, (list = []));
            used.push(ix, iz);
          }
          list.push(run);
        }
      }
    }
  }

  // Which COARSE m cells any run reaches into, over the box they all lie in: a byte read turns away the ground asked of
  // where none runs (the town, nearly all of it, every frame: groundHeight is on the traffic's & the people's hot path)
  // before the index's hash is looked up
  const per = COARSE / CELL;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < used.length; i += 2) {
    x0 = Math.min(x0, Math.floor(used[i] / per));
    x1 = Math.max(x1, Math.floor(used[i] / per));
    z0 = Math.min(z0, Math.floor(used[i + 1] / per));
    z1 = Math.max(z1, Math.floor(used[i + 1] / per));
  }
  const cols = used.length ? x1 - x0 + 1 : 0, rows = used.length ? z1 - z0 + 1 : 0;
  const any = new Uint8Array(cols * rows);
  for (let i = 0; i < used.length; i += 2) any[(Math.floor(used[i + 1] / per) - z0) * cols + Math.floor(used[i] / per) - x0] = 1;

  /** The height (m) to stand at on (x, z), whose land is `g` (m): the highest path's level over it, else g */
  const level = (x: number, z: number, g: number): number => {
    const cx = Math.floor(x / COARSE) - x0, cz = Math.floor(z / COARSE) - z0;
    if (cx < 0 || cz < 0 || cx >= cols || cz >= rows || !any[cz * cols + cx]) return g;
    const list = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return g;
    let best = g;
    for (const r of list) {
      const ux = r.bx - r.ax, uz = r.bz - r.az;
      const L2 = ux * ux + uz * uz;
      // the nearest point of the run (its ends rounded where the strip goes on, so its bends close; not past its ends)
      const tu = L2 > 0 ? ((x - r.ax) * ux + (z - r.az) * uz) / L2 : 0;
      if ((tu < 0 && !r.onA) || (tu > 1 && !r.onB)) continue;
      const t = Math.min(1, Math.max(0, tu));
      if (Math.hypot(x - r.ax - ux * t, z - r.az - uz * t) > r.half) continue;
      const y = r.la + (r.lb - r.la) * t;
      if (y > best) best = y;
    }
    return best;
  };

  return { paths: levelled, level };
}

export { createHillPaths, PATH_STEP };
