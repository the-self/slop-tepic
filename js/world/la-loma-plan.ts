// js/world/la-loma-plan.ts
// Where things stand round the Parque La Loma, as street photographs show it (Av. de los Insurgentes along its north,
// Av. Paseo de la Loma round its west & south): along the curb (its yellow paint is the curb material's, sidewalks.ts)
// a strip of earth under a row of big laureles de la India, behind it a poured-concrete andador 3.5 m wide that the
// people walk, white concrete benches on its far side facing the street, a Huichol mural on a wall by Insurgentes;
// on Paseo de la Loma the white building with the scalloped parapet & its glass annex; and across the street the
// ISSSTE's Hospital General on its Overture footprint. The drawing is la-loma.ts; no three.js here, so node --test
// imports it.
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.ts';
import { insidePoly } from './rings.ts';
import { offsetPolygonInward } from './park-floor.ts';
import type { CityBlock, PointXZ } from './city-config.ts';
import type { Footway } from './city-geodata.js';
import type { LotReserve } from './landmark-models.ts';

/** A building's frame: the middle of its front (m), the turn (rad) whose +z is the front's normal (towards the street,
 *  world = origin + R_y(yaw)·local, as three turns things), its width along the front & depth behind it (m) */
export interface LomaFrame {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
}

/** A tree to plant (street-details.ts): where (m), its scale (1 a mature park tree), species (0 laurel, 4 palm) */
export interface LomaTree {
  x: number;
  z: number;
  scale: number;
  species: number;
}

/** A bench: where (m) and its turn (rad; the seat along (cos θ, -sin θ), its back on local +z, away from the street) */
export interface LomaBench {
  x: number;
  z: number;
  th: number;
}

/** The mural's wall: its middle (m), turn (rad; its painted face on local +z, towards the street), length (m) */
export interface LomaMural {
  x: number;
  z: number;
  th: number;
  len: number;
}

export interface LomaPlan {
  /** The park's curb island (city-config.ts), the curb drawn along it */
  park: CityBlock;
  /** The andador's runs, walked like OpenStreetMap's footways (kind 0, concrete) */
  walks: Footway[];
  trees: LomaTree[];
  benches: LomaBench[];
  mural: LomaMural | null;
  issste: LomaFrame | null;
  pavilion: LomaFrame | null;
}

// across the park's edge, in from the curb (m): the laureles' row, the andador's middle & width, the benches, a second
// row of laureles behind them, and how far in nothing of the park's own grid of trees grows (street-details.ts)
const ROW = 2.2, WALK = 5.75, WALK_W = 3.5, BENCH = 8.3, ROW2 = 11, CLEAR = 9.5;
// along it (m): the laureles every ROW_STEP, the second row every ROW2_STEP, a bench every BENCH_STEP
const ROW_STEP = 9, ROW2_STEP = 11, BENCH_STEP = 34;
// the white building on Paseo de la Loma (m): its front in from the curb, width & depth
const PAVILION = { d: 10, w: 40, depth: 13 };

const prand = (x: number, z: number, k: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

// distance (m) from (x, z) to a ring's nearest edge
function edgeDistance(poly: readonly PointXZ[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

// The ring without its inlets: where it comes back within 12 m of itself after a long way round (a lane running into
// the park, its two curbs), the way round is cut off, so the offsets along the edge don't fold into it
function withoutInlets(poly: readonly PointXZ[]): PointXZ[] {
  const n = poly.length, keep = poly.map(() => true);
  const along: number[] = [0];
  for (let i = 1; i <= n; i++) along.push(along[i - 1] + Math.hypot(poly[i % n].x - poly[i - 1].x, poly[i % n].z - poly[i - 1].z));
  for (let i = 0; i < n; i++) {
    for (let j = i + 3; j < n; j++) {
      const gap = Math.hypot(poly[i].x - poly[j].x, poly[i].z - poly[j].z), way = along[j] - along[i];
      if (gap > 12 || way < gap * 4 || way > along[n] / 2) continue;
      for (let k = i + 1; k < j; k++) keep[k] = false;
    }
  }
  return poly.filter((_, i) => keep[i]);
}

// The ring's edges cut into pieces at most `step` m long (an offset keeps its corners, and follows the curb closely)
function subdivide(poly: readonly PointXZ[], step: number): PointXZ[] {
  const out: PointXZ[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

// Points every `step` m along a closed ring, from `phase` m on, each with the ring's direction there
function walkRing(ring: readonly PointXZ[], step: number, phase: number): { x: number; z: number; ux: number; uz: number }[] {
  const out: { x: number; z: number; ux: number; uz: number }[] = [];
  let next = phase, at = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (; next <= at + L; next += step) out.push({ x: a.x + ux * (next - at), z: a.z + uz * (next - at), ux, uz });
    at += L;
  }
  return out;
}

// The real buildings (Overture, GEO.houses) as turned boxes: centre, half sizes, turn, and the sign's text
interface HouseBox { x: number; z: number; hw: number; hd: number; th: number; front: number; sign: string }
function houses(near: (x: number, z: number) => boolean): HouseBox[] {
  const H = GEO.houses, S = GEO.houseStride, out: HouseBox[] = [];
  for (let i = 0; i + S <= H.length; i += S) {
    const x = H[i] / 10, z = H[i + 1] / 10;
    if (!near(x, z)) continue;
    const sign = H[i + 7] ? GEO.signs[H[i + 7] - 1] : undefined;
    out.push({ x, z, hw: H[i + 2] / 20, hd: H[i + 3] / 20, th: H[i + 4] / 1000, front: H[i + 6] & 3, sign: sign ? sign.text : '' });
  }
  return out;
}
// how far (m) (x, z) stands outside a house's box (negative: inside)
function outside(h: HouseBox, x: number, z: number): number {
  const c = Math.cos(h.th), s = Math.sin(h.th), dx = x - h.x, dz = z - h.z;
  const u = dx * c - dz * s, v = dx * s + dz * c; // (the house's local x & z: world = c + R_y(θ)·local)
  return Math.max(Math.abs(u) - h.hw, Math.abs(v) - h.hd);
}

// A house's frame from its front side (0 local -x, 1 +x, 2 -z, 3 +z): the front's middle, its normal's turn
function houseFrame(h: HouseBox): LomaFrame {
  const n: [number, number] = [[-1, 0], [1, 0], [0, -1], [0, 1]][h.front] as [number, number]; // (front is 0..3)
  const c = Math.cos(h.th), s = Math.sin(h.th);
  const half = n[0] ? h.hw : h.hd, w = n[0] ? h.hd * 2 : h.hw * 2, d = half * 2;
  const fx = n[0] * c + n[1] * s, fz = -n[0] * s + n[1] * c;
  return { x: h.x + fx * half, z: h.z + fz * half, yaw: Math.atan2(fx, fz), w, d };
}

/** A frame's rectangle [x0, x1, z0, z1] (its local metres), `margin` m wider all round, as a lot the generic houses
 *  keep off */
export function frameReserve(F: LomaFrame, [x0, x1, z0, z1]: [number, number, number, number], margin = 0): LotReserve {
  const c = Math.cos(F.yaw), s = Math.sin(F.yaw);
  return {
    contains(px: number, pz: number) {
      const dx = px - F.x, dz = pz - F.z, x = dx * c - dz * s, z = dx * s + dz * c;
      return x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin;
    }
  };
}

/** The ISSSTE's lot in its frame: the footprint (its front 2.3-3.6 m behind the curb: the sidewalk's width) */
export const ISSSTE_LOT = (F: LomaFrame): [number, number, number, number] => [-F.w / 2, F.w / 2, -F.d, 0.5];
/** The white building's lot in its frame, and the planters 3 m before it */
export const PAVILION_LOT = (F: LomaFrame): [number, number, number, number] => [-F.w / 2, F.w / 2, -F.d, 3];

function planLaLoma(): LomaPlan | null {
  const site = GEO.parks.find((p) => p.name === 'Parque La Loma');
  if (!site) return null;
  const ring = site.rings[0];
  let cx = 0, cz = 0;
  for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
  cx /= ring.length / 2; cz /= ring.length / 2;
  const park = blockAt(cx, cz);
  if (park?.parkName !== 'Parque La Loma') return null;
  const poly = park.poly;
  const near = (x: number, z: number) => x > park.minX - 120 && x < park.maxX + 120 && z > park.minZ - 120 && z < park.maxZ + 120;
  const built = houses(near);
  const inPark = built.filter((h) => insidePoly(poly, h.x, h.z));

  // THE ISSSTE: the Overture footprint whose sign says so, across Paseo de la Loma
  const hospital = built.find((h) => h.sign === 'HOSPITAL ISSSTE');
  const issste = hospital ? houseFrame(hospital) : null;

  // THE WHITE BUILDING on Paseo de la Loma: by the Loma 42's footprint, its front along the curb nearest it, slid along
  // until it stands clear of every other curb (the lane into the park beside it)
  let pavilion: LomaFrame | null = null;
  const loma42 = built.find((h) => h.sign === 'LOMA 42 TEPIC');
  if (loma42) {
    // (the curbs of the avenue, not of the lane into the park beside it)
    const curbs = withoutInlets(poly);
    let best: { d: number; ax: number; az: number; ux: number; uz: number; t: number } | null = null;
    for (let i = 0, j = curbs.length - 1; i < curbs.length; j = i++) {
      const a = curbs[j], b = curbs[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < PAVILION.w) continue;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, t = (loma42.x - a.x) * ux + (loma42.z - a.z) * uz;
      const d = Math.abs((loma42.x - a.x) * uz - (loma42.z - a.z) * ux);
      if (t > 0 && t < L && (!best || d < best.d)) best = { d, ax: a.x, az: a.z, ux, uz, t };
    }
    if (best) {
      const B = best;
      // the inward normal: towards the park's middle
      let nx = -B.uz, nz = B.ux;
      if ((cx - B.ax) * nx + (cz - B.az) * nz < 0) { nx = -nx; nz = -nz; }
      for (let k = 0; k <= 30 && !pavilion; k++) {
        const t = B.t + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
        const F: LomaFrame = { x: B.ax + B.ux * t + nx * PAVILION.d, z: B.az + B.uz * t + nz * PAVILION.d, yaw: Math.atan2(-nx, -nz), w: PAVILION.w, d: PAVILION.depth };
        const c = Math.cos(F.yaw), s = Math.sin(F.yaw);
        let clear = true;
        for (const [lx, lz] of [[-F.w / 2, 0], [F.w / 2, 0], [-F.w / 2, -F.d], [F.w / 2, -F.d], [0, -F.d]]) {
          const x = F.x + lx * c + lz * s, z = F.z - lx * s + lz * c;
          if (!insidePoly(poly, x, z) || edgeDistance(poly, x, z) < (lz ? 6 : PAVILION.d - 0.5)) clear = false;
        }
        if (clear) pavilion = F;
      }
    }
  }
  const pavilionLot = pavilion ? frameReserve(pavilion, PAVILION_LOT(pavilion), 2) : null;

  // THE MURAL: on the Insurgentes side (the park's northern stretch of curb, facing north, -z), towards its east end
  let mural: LomaMural | null = null;
  {
    let area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    const s = area > 0 ? 1 : -1;
    let best: { x: number; m: LomaMural } | null = null;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 30) continue;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz * s, nz = ux * s; // (inward)
      if (nz < 0.8 || Math.max(a.z, b.z) > park.minZ + 80) continue; // (the street to the north: the park inward is +z)
      const east = ux > 0 ? 0.72 : 0.28, x = a.x + ux * L * east + nx * 3.2, z = a.z + uz * L * east + nz * 3.2;
      if (!best || x > best.x) best = { x, m: { x, z, th: Math.atan2(-nx, -nz), len: 12 } };
    }
    mural = best ? best.m : null;
  }
  const nearMural = (x: number, z: number, r: number) => !!mural && Math.hypot(x - mural.x, z - mural.z) < mural.len / 2 + r;

  // what nothing along the edge may stand in: a building (Overture's, the white one), the mural
  const blocked = (x: number, z: number, r: number) =>
    inPark.some((h) => outside(h, x, z) < r) || !!pavilionLot?.contains(x, z) || nearMural(x, z, r);
  const edge = withoutInlets(subdivide(poly, 3));
  // (the park's own edge at `d` m in, where it is that far from every curb, the inlet's too)
  const clearAt = (x: number, z: number, d: number) => insidePoly(poly, x, z) && edgeDistance(poly, x, z) > d - 0.6;

  const trees: LomaTree[] = [];
  for (const [d, step, phase, r] of [[ROW, ROW_STEP, 2, 2.5], [ROW2, ROW2_STEP, 7, 3]] satisfies [number, number, number, number][]) {
    const line = offsetPolygonInward(edge, d);
    if (!line) continue;
    for (const p of walkRing(line, step, phase)) {
      if (!clearAt(p.x, p.z, d) || blocked(p.x, p.z, r)) continue;
      trees.push({ x: p.x, z: p.z, scale: 1.15 + prand(p.x, p.z, 3) * 0.45, species: 0 });
    }
  }
  // the ISSSTE's two palms in the recess by its steps, its small laureles in the sidewalk (as the photographs show)
  if (issste) {
    const c = Math.cos(issste.yaw), s = Math.sin(issste.yaw);
    for (const [lx, lz, scale, species] of [[-2.2, -3, 0.95, 4], [-2.2, -6, 1.05, 4], [-0.42 * issste.w, 1.5, 0.7, 0], [-0.2 * issste.w, 1.5, 0.65, 0], [0.3 * issste.w, 1.5, 0.7, 0]]) {
      const x = issste.x + lx * c + lz * s, z = issste.z - lx * s + lz * c;
      trees.push({ x, z, scale, species });
    }
  }
  if (pavilion) {
    const c = Math.cos(pavilion.yaw), s = Math.sin(pavilion.yaw);
    trees.push({ x: pavilion.x - 2 * c + 5.5 * s, z: pavilion.z + 2 * s + 5.5 * c, scale: 1.5, species: 0 }); // (its big laurel)
  }

  // the andador: its middle line, in runs between what it goes round
  const walks: Footway[] = [];
  const mid = offsetPolygonInward(edge, WALK);
  if (mid) {
    const pts = subdivide(mid, 2);
    const ok = pts.map((p) => clearAt(p.x, p.z, WALK - 1) && !blocked(p.x, p.z, WALK_W / 2 + 0.5));
    // (from a point it skips, so no run is cut in two where the ring closes; all round, a closed ring)
    const start = ok.indexOf(false), runs: number[][] = [];
    let run: number[] = [];
    for (let k = 0; k <= pts.length; k++) {
      const i = (Math.max(0, start) + k) % pts.length;
      if (ok[i]) run.push(pts[i].x, pts[i].z);
      if (!ok[i] || k === pts.length) {
        if (run.length >= 8) runs.push(run); // (4 points, 6 m at least)
        run = [];
      }
    }
    for (const r of runs) walks.push([0, WALK_W, r.map((v) => Math.round(v * 10) / 10)]);
  }

  // the benches on the andador's far side, facing the street
  const benches: LomaBench[] = [];
  const back = offsetPolygonInward(edge, BENCH);
  if (back) {
    for (const p of walkRing(back, BENCH_STEP, 15)) {
      if (!clearAt(p.x, p.z, BENCH) || blocked(p.x, p.z, 3)) continue;
      // inward: the ring's left or right, whichever is inside
      let nx = -p.uz, nz = p.ux;
      if (!insidePoly(poly, p.x + nx * 3, p.z + nz * 3)) { nx = -nx; nz = -nz; }
      benches.push({ x: p.x, z: p.z, th: Math.atan2(nx, nz) });
    }
  }
  return { park, walks, trees, benches, mural, issste, pavilion };
}

/** Parque La Loma's edge, its buildings & the ISSSTE's (null if the city hasn't the park) */
export const LA_LOMA: LomaPlan | null = planLaLoma();

/** The lots the generic houses keep off (world/buildings/houses.ts): the ISSSTE's, the white building's */
export const LA_LOMA_RESERVES: LotReserve[] = [];
if (LA_LOMA?.issste) LA_LOMA_RESERVES.push(frameReserve(LA_LOMA.issste, ISSSTE_LOT(LA_LOMA.issste)));
if (LA_LOMA?.pavilion) LA_LOMA_RESERVES.push(frameReserve(LA_LOMA.pavilion, PAVILION_LOT(LA_LOMA.pavilion), 1));

/** Whether the park's own scattered trees (city-grid.ts) keep off (x, z): the strip along its curb that the laureles'
 *  rows, the andador & the benches take, and the white building's lot */
export function laLomaKeepsClear(x: number, z: number): boolean {
  const P = LA_LOMA;
  if (!P || x < P.park.minX || x > P.park.maxX || z < P.park.minZ || z > P.park.maxZ) return false;
  if (LA_LOMA_RESERVES.some((r) => r.contains(x, z))) return true;
  return insidePoly(P.park.poly, x, z) && edgeDistance(P.park.poly, x, z) < CLEAR;
}

/** One of the park's own scattered trees (city-grid.ts), as La Loma grows them: inside it three in four are big
 *  laureles de la India, the dark domes its photographs are full of; elsewhere the tree as it was */
export function laLomaWoods<T extends { x: number; z: number; scale: number; species?: number }>(s: T): T {
  const P = LA_LOMA;
  if (!P || s.x < P.park.minX || s.x > P.park.maxX || s.z < P.park.minZ || s.z > P.park.maxZ || !insidePoly(P.park.poly, s.x, s.z)) return s;
  return prand(s.x, s.z, 9) < 0.75 ? { ...s, species: 0, scale: s.scale * 1.25 } : s;
}

/** How much further in from the curb (m) a sidewalk's walking lines run past (x, z), a point on its nearer line
 *  (sim/pedestrian-routes.ts): along the park there is no sidewalk, only the verge the laureles' row stands in, so its
 *  walkers keep to the andador behind it; 0 elsewhere */
export function laLomaSetBack(x: number, z: number): number {
  const P = LA_LOMA;
  if (!P || x < P.park.minX || x > P.park.maxX || z < P.park.minZ || z > P.park.maxZ || !insidePoly(P.park.poly, x, z)) return 0;
  // (both lines on the andador: the nearer 0.55 m short of its middle, the other 0.55 m past it)
  return Math.max(0, WALK - 0.55 - edgeDistance(P.park.poly, x, z));
}
