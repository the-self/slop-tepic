// js/world/lakes.ts
// The lakes, presas, ponds & reservoirs sunk into the ground (city-geodata.js `lakes`, OpenStreetMap natural=water):
// La Presa, Lago de Mora, Presa El Salto, the colonias' ponds, the Humedal Colosio. The builder leaves each a gap
// between the blocks and levels the town's floor under it; here each becomes a basin: its banks sloping down from its
// shore to a flat bed, and the water standing flat in it a little under the lowest point of its shore, so it never
// floods the bank on its low side. This module is the basins' shape: the ground they carve (offset, for everyone
// standing or driving in one), the holes they cut in the road deck (holes), their meshes' vertices (meshData,
// river-channels.ts draws them), and the outlines laid on the hillside instead (fillRing, terrain.ts). No three.js
// here, so node --test imports it.
import type { Lake, LakeKind } from './city-geodata.js';
import type { HeightFn, Numbers } from './lattice.ts';

/** A basin's shape by kind: the water `freeboard` m under its shore's lowest point, the bed `depth` m under the water,
 *  the banks falling `slope` m per metre in from the shore. */
export interface LakeSpec {
  freeboard: number;
  depth: number;
  slope: number;
}
/** A lake sunk into the ground: its shore (flat ring), its water's height (m, absolute: over the datum, as the floor),
 *  and the carving it makes on a grid of `step` m from (x0, z0), cols x rows nodes (m under the floor, <= 0). */
export interface Basin {
  kind: LakeKind;
  name: string;
  ring: number[];
  level: number;
  x0: number;
  z0: number;
  step: number;
  cols: number;
  rows: number;
  carve: Float32Array;
  /** The shore's triangles in plan (flat x0, z0, x1, z1, x2, z2). */
  ears: number[];
}
/** A mesh's vertices as plain triangle lists: positions x y z, uv (metres east & south), `wet` (0 at the shore's top,
 *  1 at the water's edge and under it). */
export interface LakeMesh {
  position: Float32Array;
  uv: Float32Array;
  wet: Float32Array;
}
export interface LakeMeshes {
  /** The banks & the bed, heights over the town's floor (drape.ts lays them on it) */
  shore: LakeMesh;
  /** The water, at its own height (absolute: flat, so not draped) */
  water: { position: Float32Array; uv: Float32Array };
  /** The bed under the water, flat `depth` m under it (absolute), where the banks' fine mesh is left out */
  bed: LakeMesh;
}
export interface Lakes {
  basins: Basin[];
  /** The lakes laid on the hillside instead (beyond the box, up the hills): their outlines. */
  hillside: Lake[];
  /** How far (m, <= 0) the basins carve the ground at (x, z) under the town's floor. */
  offset: (x: number, z: number) => number;
  /** The holes in the road deck, as flat triangles x0, z0, x1, z1, x2, z2. */
  holes: () => number[];
  meshData: () => LakeMeshes;
}

// The kinds' basins. A lake or a presa is a few metres deep with gentle earth banks; a pond (a bordo, a fish pond, a
// park's) a metre or two; the wetland (the Humedal Colosio) a sheet of shallow water among reeds, nearly level with
// its edge. An intermittent one holds less: INTERMITTENT of its depth under its usual level.
const LAKES: Record<LakeKind, LakeSpec> = {
  lake: { freeboard: 0.6, depth: 3.5, slope: 0.3 },
  reservoir: { freeboard: 0.9, depth: 4.5, slope: 0.4 },
  pond: { freeboard: 0.4, depth: 1.6, slope: 0.45 },
  wetland: { freeboard: 0.12, depth: 0.4, slope: 0.12 }
};
const INTERMITTENT = 0.5;
const HILL = 0.1; // m of hill over the town's floor at a shore that leaves the lake on the hillside (as the channels)
const SHORE_STEP = 2; // m between the shore's samples for its lowest point
const BEYOND = 2; // flags: beyond the box
const UP_HILL = 4; // flags: up the hills, the ground not levelled under it
const CELL = 32; // m, the cells of the lookup of the basins
const SUBMERGED = 0.6; // m under the water a bank's triangle is left out of the mesh (the flat bed shows instead)

type Pt = [x: number, z: number];

/**
 * The triangles (flat x0, z0, x1, z1, x2, z2, each facing up: clockwise in x & z) filling the outline `ring` (flat x,
 * z) by the nonzero rule: cut in bands at every vertex and crossing of its edges, each band's spans of nonzero winding
 * as trapezoids. An outline folded on itself (a shore run out round an islet and back, the loops a shore set a metre
 * out makes in a narrow inlet) is filled as it encloses: the islet left out, the loops filled once.
 */
function triangulate(ring: Numbers): number[] {
  const n = ring.length / 2;
  const out: number[] = [];
  if (n < 3) return out;
  interface Edge { ax: number; az: number; bx: number; bz: number; up: number }
  const edges: Edge[] = [];
  const zs: number[] = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
    zs.push(az);
    if (az !== bz) edges.push(az < bz ? { ax, az, bx, bz, up: 1 } : { ax: bx, az: bz, bx: ax, bz: az, up: -1 });
  }
  // (where two edges cross, a band boundary too: within a band the edges keep their order across it)
  for (let a = 0; a < edges.length; a++) {
    const e = edges[a];
    for (let b = a + 1; b < edges.length; b++) {
      const f = edges[b];
      if (f.az >= e.bz || f.bz <= e.az) continue;
      const dx = e.bx - e.ax, dz = e.bz - e.az, gx = f.bx - f.ax, gz = f.bz - f.az;
      const den = dx * gz - dz * gx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((f.ax - e.ax) * gz - (f.az - e.az) * gx) / den, u = ((f.ax - e.ax) * dz - (f.az - e.az) * dx) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) zs.push(e.az + dz * t);
    }
  }
  zs.sort((p, q) => p - q);
  const xAt = (e: Edge, z: number) => e.ax + ((e.bx - e.ax) * (z - e.az)) / (e.bz - e.az);
  const cross: { x: number; xa: number; xb: number; up: number }[] = [];
  for (let k = 0; k + 1 < zs.length; k++) {
    const za = zs[k], zb = zs[k + 1];
    if (zb - za < 1e-6) continue;
    const zm = (za + zb) / 2;
    cross.length = 0;
    for (const e of edges) if (e.az <= zm && e.bz > zm) cross.push({ x: xAt(e, zm), xa: xAt(e, za), xb: xAt(e, zb), up: e.up });
    cross.sort((p, q) => p.x - q.x);
    let wind = 0;
    for (let c = 0; c + 1 < cross.length; c++) {
      wind += cross[c].up;
      if (!wind) continue;
      const l = cross[c], r = cross[c + 1];
      // the trapezoid between them, wound clockwise in x & z (three.js's counter-clockwise seen from above)
      if (r.xa - l.xa > 1e-9) out.push(l.xa, za, l.xb, zb, r.xa, za);
      if (r.xb - l.xb > 1e-9) out.push(r.xa, za, l.xb, zb, r.xb, zb);
    }
  }
  return out;
}

/** Whether (x, z) lies inside the outline `ring` (flat x, z) by the nonzero rule, as triangulate fills it */
function insideShore(ring: Numbers, x: number, z: number): boolean {
  const n = ring.length / 2;
  let wind = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
    if ((az <= z) === (bz <= z)) continue;
    const xc = ax + ((bx - ax) * (z - az)) / (bz - az);
    if (xc > x) wind += bz > az ? 1 : -1;
  }
  return wind !== 0;
}

// The convex polygon `poly` cut to the left of the line a -> b (flat x, z pairs in and out)
function clipLeft(poly: Pt[], ax: number, az: number, bx: number, bz: number): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/**
 * The polygon whose triangles are `ears` (flat x0, z0, x1, z1, x2, z2, from triangulate) cut on a grid of `step` m
 * lines (x = k·step, z = k·step): its triangles in plan (facing up, as triangulate's), small enough to follow a
 * ground under them. (The hillside's lakes laid on the hills, the basins' banks.)
 */
function fillRing(ears: Numbers, step: number): number[] {
  const out: number[] = [];
  for (let e = 0; e + 5 < ears.length; e += 6) {
    let ax = ears[e], az = ears[e + 1], bx = ears[e + 2], bz = ears[e + 3];
    const cx = ears[e + 4], cz = ears[e + 5];
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0) [ax, az, bx, bz] = [bx, bz, ax, az]; // (counter-clockwise)
    const i0 = Math.floor(Math.min(ax, bx, cx) / step), i1 = Math.floor(Math.max(ax, bx, cx) / step);
    const j0 = Math.floor(Math.min(az, bz, cz) / step), j1 = Math.floor(Math.max(az, bz, cz) / step);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x0 = i * step, z0 = j * step, x1 = x0 + step, z1 = z0 + step;
        let poly = clipLeft([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], ax, az, bx, bz);
        if (poly.length >= 3) poly = clipLeft(poly, bx, bz, cx, cz);
        if (poly.length >= 3) poly = clipLeft(poly, cx, cz, ax, az);
        for (let k = 1; k + 1 < poly.length; k++) {
          out.push(poly[0][0], poly[0][1], poly[k][0], poly[k][1], poly[k + 1][0], poly[k + 1][1]);
        }
      }
    }
  }
  return out;
}

// metres from (x, z) to the nearest edge of the ring (flat x, z)
function shoreDistance(ring: Numbers, x: number, z: number) {
  let best = Infinity;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2], az = ring[j * 2 + 1], dx = ring[i * 2] - ax, dz = ring[i * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * The lakes of `list` (GEO.lakes: [kind, name, flags, flat shore]) sunk into the town's floor `floor(x, z)`, where
 * the hills `hills(x, z)` (their height over it) leave their shores bare; the rest laid on the hillside.
 */
function createLakes(list: readonly Lake[] | null | undefined,
  { floor = () => 0, hills = () => 0 }: { floor?: HeightFn; hills?: HeightFn } = {}): Lakes {
  const basins: Basin[] = [];
  const hillside: Lake[] = [];
  for (const lake of list ?? []) {
    const [kind, name, flags, ring] = lake;
    if (ring.length < 6) continue;
    let up = (flags & (BEYOND | UP_HILL)) !== 0;
    // the shore's lowest point, every SHORE_STEP m round it
    let low = Infinity;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n && !up; j = i++) {
      const ax = ring[j * 2], az = ring[j * 2 + 1], bx = ring[i * 2], bz = ring[i * 2 + 1];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SHORE_STEP));
      for (let s = 0; s < k; s++) {
        const x = ax + ((bx - ax) * s) / k, z = az + ((bz - az) * s) / k;
        if (hills(x, z) > HILL) { up = true; break; }
        low = Math.min(low, floor(x, z));
      }
    }
    if (up) { hillside.push(lake); continue; }
    const spec = LAKES[kind];
    const level = low - spec.freeboard - (flags & 1 ? spec.depth * INTERMITTENT : 0);
    // the carving on a grid over the basin: the bank falling from the shore down to the bed, the bed `depth` m under
    // the water (finer for a pond than for Lago de Mora)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) {
      x0 = Math.min(x0, ring[k]); x1 = Math.max(x1, ring[k]);
      z0 = Math.min(z0, ring[k + 1]); z1 = Math.max(z1, ring[k + 1]);
    }
    const step = Math.min(5, Math.max(2, Math.sqrt((x1 - x0) * (z1 - z0)) / 60));
    x0 -= step; z0 -= step;
    const cols = Math.ceil((x1 + step - x0) / step) + 1, rows = Math.ceil((z1 + step - z0) / step) + 1;
    const carve = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        if (!insideShore(ring, x, z)) continue;
        const drop = Math.max(0, floor(x, z) - level + spec.depth);
        carve[j * cols + i] = -Math.min(spec.slope * shoreDistance(ring, x, z), drop);
      }
    }
    basins.push({ kind, name, ring: Array.from(ring), level, x0, z0, step, cols, rows, carve, ears: triangulate(ring) });
  }

  const cells = new Map<number, Basin[]>();
  for (const b of basins) {
    const bx1 = b.x0 + (b.cols - 1) * b.step, bz1 = b.z0 + (b.rows - 1) * b.step;
    for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(bz1 / CELL); j++) {
      for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(bx1 / CELL); i++) {
        const key = i * 100003 + j;
        let l = cells.get(key);
        if (!l) cells.set(key, (l = []));
        l.push(b);
      }
    }
  }
  // a basin's carving at (x, z), bilinear between its grid's nodes (0 off it)
  const carveAt = (b: Basin, x: number, z: number) => {
    const fx = (x - b.x0) / b.step, fz = (z - b.z0) / b.step;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= b.cols - 1 || j >= b.rows - 1) return 0;
    const tx = fx - i, tz = fz - j, k = j * b.cols + i, c = b.carve;
    return (c[k] * (1 - tx) + c[k + 1] * tx) * (1 - tz) + (c[k + b.cols] * (1 - tx) + c[k + b.cols + 1] * tx) * tz;
  };

  /** How far (m, <= 0) the basins carve the ground at (x, z) under the town's floor: their banks & beds, 0 off them */
  function offset(x: number, z: number) {
    const list = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return 0;
    let best = 0;
    for (const b of list) best = Math.min(best, carveAt(b, x, z));
    return best;
  }

  /** The holes the basins open in the road deck: their shores' triangles */
  function holes() {
    const out: number[] = [];
    for (const b of basins) for (const v of b.ears) out.push(v);
    return out;
  }

  /**
   * The basins' meshes as plain triangle lists: the shore (banks & bed, heights over the town's floor, `wet` 0 at the
   * top to 1 at the water's edge; but where it lies well under the water), the water (flat at its level, absolute
   * heights) and a flat bed under it. uv are metres east & south.
   */
  function meshData(): LakeMeshes {
    const position: number[] = [], uv: number[] = [], wet: number[] = [];
    const wPos: number[] = [], wUV: number[] = [], bPos: number[] = [];
    for (const b of basins) {
      const tris = fillRing(b.ears, b.step);
      const ys = [0, 0, 0], tops = [0, 0, 0];
      for (let k = 0; k + 5 < tris.length; k += 6) {
        // (a triangle well under the water is never seen through it: the flat bed stands for it)
        let under = true;
        for (let c = 0; c < 3; c++) {
          const x = tris[k + c * 2], z = tris[k + c * 2 + 1];
          ys[c] = carveAt(b, x, z);
          tops[c] = floor(x, z);
          if (tops[c] + ys[c] > b.level - SUBMERGED) under = false;
        }
        if (under) continue;
        for (let c = 0; c < 3; c++) {
          const x = tris[k + c * 2], z = tris[k + c * 2 + 1];
          position.push(x, ys[c], z);
          uv.push(x, z);
          // (the bank above the water dries off towards the shore's top)
          wet.push(Math.min(1, Math.max(0, -ys[c] / Math.max(0.05, tops[c] - b.level))));
        }
      }
      const bottom = b.level - LAKES[b.kind].depth;
      for (let k = 0; k + 1 < b.ears.length; k += 2) {
        wPos.push(b.ears[k], b.level, b.ears[k + 1]);
        wUV.push(b.ears[k], b.ears[k + 1]);
        bPos.push(b.ears[k], bottom, b.ears[k + 1]);
      }
    }
    return {
      shore: { position: Float32Array.from(position), uv: Float32Array.from(uv), wet: Float32Array.from(wet) },
      water: { position: Float32Array.from(wPos), uv: Float32Array.from(wUV) },
      bed: { position: Float32Array.from(bPos), uv: Float32Array.from(wUV), wet: new Float32Array(bPos.length / 3).fill(1) }
    };
  }

  return { basins, hillside, offset, holes, meshData };
}

export { LAKES, createLakes, triangulate, fillRing, insideShore };
