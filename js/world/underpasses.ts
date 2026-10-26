// js/world/underpasses.ts
// The underpasses: the roads sunk under others (city-geodata.js roadGraph links whose lifts go below 0: Insurgentes
// under Av. México, the Nodo Vial de la Cruz), each down in a cut between concrete walls, open to the sky along its
// ramps and roofed where its way is a tunnel (OpenStreetMap tunnel=yes); the streets over it stay at grade.
// Like waterways.ts for the rivers, this module is their shape: the ground they carve (offset, for everyone standing or
// driving down in one), the holes they open in the road deck (holes) and their walls', beds' and roofs' quads
// (meshData, bridges.ts draws them), all heights over the ground at grade under them (drape.ts lays them on it).
// The traffic needs none of it: it drives the links' own lifts (road-network.ts edgeLift) over the ground at grade.
// No three.js here, so node --test imports it.
import type { GraphLink, RoadGraph } from './city-geodata.js';
import type { HeightFn } from './lattice.ts';

/** A cross-section along a cut: centre, unit normal (left of the way along), metres along it, half its width wall to
 *  wall (m), its bed's depth under the ground at grade (m, >= 0), and whether the piece from it to the next is roofed
 *  (a tunnel). */
export interface CutSection {
  x: number;
  z: number;
  nx: number;
  nz: number;
  along: number;
  half: number;
  depth: number;
  roof: boolean;
}
/** A cut: its cross-sections along the sunk links it carries end to end, the widest's half width (m), and whether each
 *  end runs on into another cut (a fork: no wall across it). */
export interface Cut {
  half: number;
  s: CutSection[];
  joined: [boolean, boolean];
}
/** A point [x, y, z] (m; y over the ground at grade), or a direction */
export type CutP3 = [number, number, number];
/** A quad a-b-c-d (corners in order round it) facing n */
export type QuadSink = (a: CutP3, b: CutP3, c: CutP3, d: CutP3, n: CutP3) => void;
/** A parapet along a cut's rim, as its centreline from (ax, az) to (bx, bz) (m) */
export interface RimWall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}
export interface Underpasses {
  cuts: Cut[];
  /** How far (m, <= 0) the cuts carve the ground at (x, z): under a roof only for a body coming from `fromY` down in it. */
  offset: (x: number, z: number, fromY?: number) => number;
  /** The holes in the road deck over the open cuts, as flat triangles x0, z0, x1, z1, x2, z2. */
  holes: () => number[];
  /** The cuts' quads: the walls, parapets & roofs in `concrete`, the beds in `asphalt`; the parapets' runs returned. */
  meshData: (concrete: QuadSink, asphalt: QuadSink) => RimWall[];
}

const SHOULDER = 0.6; // m from the roadway's edge to the wall
const STEP = 2; // m between a cut's cross-sections
const UNDER = 1.2; // m under the ground at grade a body must be to be under a roof (in the tunnel) rather than on it
const SLAB = 0.8; // m deep, a tunnel's roof seen from inside it
const PARAPET = 0.6; // m deep, a cut gets parapets along its rim
const PARAPET_H = 0.9;
const PARAPET_T = 0.25;
const OPEN = 0.02; // m deep, a cut is opened (shallower, the ramp is at grade)
const CELL = 10; // m, the cells of the lookup of the cuts' pieces

type Pt = [x: number, z: number];

/** A sunk link as a polyline with its depth at each point (m, >= 0) and whether it is a tunnel */
interface SunkLine {
  a: number;
  b: number;
  pts: Pt[];
  depth: number[];
  roof: boolean;
  half: number;
}

function sunkLine(link: GraphLink, nodes: number[]): SunkLine | null {
  const [a, b, , w, , , inner, lifts, kind] = link;
  if (!lifts || !lifts.some((v) => v < 0)) return null;
  const pts: Pt[] = [[nodes[a * 2], nodes[a * 2 + 1]]];
  for (let k = 0; k + 1 < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
  pts.push([nodes[b * 2], nodes[b * 2 + 1]]);
  return { a, b, pts, depth: lifts.map((v) => Math.max(0, -v / 10)), roof: kind === 2, half: w / 2 + SHOULDER };
}

// The sunk links joined end to end where two meet alone at a node (a way split, a tunnel and its ramp), so a cut's
// sections run on through the joints without a gap on the outside of a bend: each chain [line, reversed][]
function chains(lines: SunkLine[]): [SunkLine, boolean][][] {
  const at = new Map<number, SunkLine[]>();
  for (const l of lines) for (const n of [l.a, l.b]) {
    let list = at.get(n);
    if (!list) at.set(n, (list = []));
    list.push(l);
  }
  const used = new Set<SunkLine>();
  const out: [SunkLine, boolean][][] = [];
  const through = (n: number) => at.get(n)?.length === 2;
  // walk on from `line` leaving it at node n
  const walk = (chain: [SunkLine, boolean][], line: SunkLine, n: number) => {
    let cur = line, node = n;
    while (through(node)) {
      const next = at.get(node)?.find((l) => l !== cur);
      if (!next || used.has(next)) break;
      used.add(next);
      const rev = next.b === node;
      chain.push([next, rev]);
      node = rev ? next.a : next.b;
      cur = next;
    }
  };
  // from the chains' ends first, then the loops left (a ring of sunk links: never in Tepic, but cut through anywhere)
  const starts = [...lines.filter((l) => !through(l.a) || !through(l.b)), ...lines];
  for (const l of starts) {
    if (used.has(l)) continue;
    used.add(l);
    const rev = through(l.a) && !through(l.b);
    const chain: [SunkLine, boolean][] = [[l, rev]];
    walk(chain, l, rev ? l.a : l.b);
    out.push(chain);
  }
  return out;
}

// A chain's cross-sections every STEP m (or less), each carrying the depth there, and its line's width and roof
function sections(chain: [SunkLine, boolean][]): Cut {
  const pts: Pt[] = [], depth: number[] = [], roof: boolean[] = [], halves: number[] = [];
  let half = 0;
  for (const [line, rev] of chain) {
    const p = rev ? [...line.pts].reverse() : line.pts, d = rev ? [...line.depth].reverse() : line.depth;
    half = Math.max(half, line.half);
    // (the joint's section starts this line's piece: as wide and roofed as this line is)
    if (roof.length) {
      roof[roof.length - 1] = line.roof;
      halves[halves.length - 1] = line.half;
    }
    for (let i = pts.length ? 1 : 0; i < p.length; i++) {
      if (i > 0) {
        const [ax, az] = p[i - 1], [bx, bz] = p[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
        for (let k = 1; k < n; k++) {
          pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
          depth.push(d[i - 1] + ((d[i] - d[i - 1]) * k) / n);
          roof.push(line.roof);
          halves.push(line.half);
        }
      }
      pts.push(p[i]);
      depth.push(d[i]);
      roof.push(line.roof);
      halves.push(line.half);
    }
  }
  const s: CutSection[] = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
    const tl = Math.hypot(qx - px, qz - pz) || 1;
    if (i > 0) along += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    s.push({ x, z, nx: -(qz - pz) / tl, nz: (qx - px) / tl, along, half: halves[i], depth: depth[i], roof: roof[i] });
  }
  return { half, s, joined: [false, false] };
}

/** The roads sunk in the road graph `rg` (GEO.roadGraph) as cuts in the ground at grade `grade(x, z)`. */
function createUnderpasses(rg: RoadGraph | null | undefined, { grade = () => 0 }: { grade?: HeightFn } = {}): Underpasses {
  const lines: SunkLine[] = [];
  for (const link of rg?.links ?? []) {
    const l = sunkLine(link, rg?.nodes ?? []);
    if (l) lines.push(l);
  }
  const cuts = chains(lines).map(sections).filter((c) => c.s.length > 1 && c.s.some((p) => p.depth > OPEN));

  // The pieces (between two cross-sections, some way down), bucketed for offset(): [cut, cross-section]
  const pieces: number[] = [];
  const cells = new Map<number, number[]>();
  cuts.forEach((cut, c) => {
    const { s, half } = cut;
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i].depth <= OPEN && s[i + 1].depth <= OPEN) continue;
      const id = pieces.length / 2;
      pieces.push(c, i);
      const a = s[i], b = s[i + 1], r = half + 0.5;
      const i0 = Math.floor((Math.min(a.x, b.x) - r) / CELL), i1 = Math.floor((Math.max(a.x, b.x) + r) / CELL);
      const j0 = Math.floor((Math.min(a.z, b.z) - r) / CELL), j1 = Math.floor((Math.max(a.z, b.z) + r) / CELL);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const key = ii * 100003 + j;
        let l = cells.get(key);
        if (!l) cells.set(key, (l = []));
        l.push(id);
      }
    }
  });
  const along = (cut: Cut, i: number, x: number, z: number) => {
    const a = cut.s[i], b = cut.s[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    return ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9);
  };
  const inCut = (cut: Cut, i: number) => i >= 0 && i + 1 < cut.s.length;
  // half the width of piece i of a cut at t along it (its two lines' widths meet at a joint)
  const halfAt = (cut: Cut, i: number, t: number) => cut.s[i].half + (cut.s[i + 1].half - cut.s[i].half) * t;
  // Is (x, z) inside another stretch of cut than the one `at` m along `own` (two carriageways sunk side by side share
  // one wide cut, joined or not where they end: no wall between them)?
  const inOther = (x: number, z: number, own: Cut, at: number) => {
    for (const id of cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? []) {
      const cut = cuts[pieces[id * 2]], i = pieces[id * 2 + 1];
      if (cut === own && Math.abs(cut.s[i].along - at) < 3 * cut.half) continue;
      const a = cut.s[i], b = cut.s[i + 1];
      const t = Math.max(0, Math.min(1, along(cut, i, x, z)));
      if (Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t) < halfAt(cut, i, t)) return true;
    }
    return false;
  };
  // the cuts' ends still down where another cut runs on (where three sunk links meet: the Nodo Vial de la Cruz)
  for (const cut of cuts) {
    const first = cut.s[0], last = cut.s[cut.s.length - 1];
    cut.joined = [first.depth > OPEN && inOther(first.x, first.z, cut, first.along), last.depth > OPEN && inOther(last.x, last.z, cut, last.along)];
  }

  /**
   * How far (m, <= 0) the cuts carve the ground at (x, z): their beds, 0 off them. Under a roof only for a body coming
   * from `fromY` well under the ground at grade (one in the tunnel); on it, or with no `fromY`, the street over it.
   */
  function offset(x: number, z: number, fromY?: number) {
    const list = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return 0;
    let best = 0;
    for (const id of list) {
      const cut = cuts[pieces[id * 2]], i = pieces[id * 2 + 1];
      const a = cut.s[i], b = cut.s[i + 1];
      const raw = along(cut, i, x, z);
      // past a piece's end only on the outside of a bend, beyond the next piece's start too (square ends, but rounded
      // where the cut runs on into another, so the outside of a turn from one to the other is cut too)
      if (raw < 0 && !(inCut(cut, i - 1) ? along(cut, i - 1, x, z) > 1 : cut.joined[0])) continue;
      if (raw > 1 && !(inCut(cut, i + 1) ? along(cut, i + 1, x, z) < 0 : cut.joined[1])) continue;
      const t = Math.max(0, Math.min(1, raw));
      if (Math.hypot(x - a.x - (b.x - a.x) * t, z - a.z - (b.z - a.z) * t) >= halfAt(cut, i, t)) continue;
      if (a.roof && !(fromY !== undefined && fromY < grade(x, z) - UNDER)) continue;
      const depth = a.depth + (b.depth - a.depth) * t;
      if (-depth < best) best = -depth;
    }
    return best;
  }

  /** The holes the open cuts make in the road deck, as triangles (flat x0, z0, x1, z1, x2, z2): not over the roofs */
  function holes() {
    const out: number[] = [];
    for (const { s } of cuts) {
      for (let i = 0; i + 1 < s.length; i++) {
        const a = s[i], b = s[i + 1];
        if (a.roof || (a.depth <= OPEN && b.depth <= OPEN)) continue;
        const ha = a.half, hb = b.half;
        const alx = a.x + a.nx * ha, alz = a.z + a.nz * ha, arx = a.x - a.nx * ha, arz = a.z - a.nz * ha;
        const blx = b.x + b.nx * hb, blz = b.z + b.nz * hb, brx = b.x - b.nx * hb, brz = b.z - b.nz * hb;
        out.push(alx, alz, blx, blz, brx, brz, alx, alz, brx, brz, arx, arz);
      }
    }
    return out;
  }

  /**
   * The cuts' quads, heights over the ground at grade: their walls (from the bed up to the ground), the parapets along
   * an open cut's rim from PARAPET m down (and across a tunnel's mouth), the tunnels' roofs seen from inside and their
   * mouths' faces into `concrete`; the beds into `asphalt`. Returns the parapets' runs (for their colliders).
   */
  function meshData(concrete: QuadSink, asphalt: QuadSink): RimWall[] {
    const rims: RimWall[] = [];
    for (const cut of cuts) {
      const { s } = cut;
      // a point `o` m left of a cross-section (in shares of its half width with W), `y` m up
      const P = (c: CutSection, o: number, y: number): CutP3 => [c.x + c.nx * o, y, c.z + c.nz * o];
      const W = (c: CutSection, k: number, y: number, pad = 0): CutP3 => P(c, (c.half + pad) * k, y);
      for (let i = 0; i + 1 < s.length; i++) {
        const a = s[i], b = s[i + 1];
        if (a.depth <= OPEN && b.depth <= OPEN) continue;
        const ya = -a.depth, yb = -b.depth;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const ux = dx / L, uz = dz / L, lx = -uz, lz = ux; // along, and to its left
        asphalt(W(a, 1, ya), W(b, 1, yb), W(b, -1, yb), W(a, -1, ya), [0, 1, 0]);
        // the walls, facing in (the left one faces right, -l), but where another cut lies past them
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, mnx = (a.nx + b.nx) / 2, mnz = (a.nz + b.nz) / 2;
        const mh = (a.half + b.half) / 2 + 0.1;
        const open = (side: number) => inOther(mx + mnx * mh * side, mz + mnz * mh * side, cut, a.along);
        const walled = [!open(1), !open(-1)];
        if (walled[0]) concrete(W(a, 1, ya), W(a, 1, 0), W(b, 1, 0), W(b, 1, yb), [-lx, 0, -lz]);
        if (walled[1]) concrete(W(b, -1, yb), W(b, -1, 0), W(a, -1, 0), W(a, -1, ya), [lx, 0, lz]);
        if (a.roof) {
          concrete(W(a, -1, -SLAB), W(b, -1, -SLAB), W(b, 1, -SLAB), W(a, 1, -SLAB), [0, -1, 0]);
          continue;
        }
        if (Math.max(a.depth, b.depth) < PARAPET) continue;
        for (const side of [1, -1]) {
          if (!walled[side > 0 ? 0 : 1]) continue;
          const out: CutP3 = [lx * side, 0, lz * side];
          concrete(W(b, side, 0, PARAPET_T), W(b, side, PARAPET_H, PARAPET_T), W(a, side, PARAPET_H, PARAPET_T), W(a, side, 0, PARAPET_T), out);
          concrete(W(a, side, 0), W(a, side, PARAPET_H), W(b, side, PARAPET_H), W(b, side, 0), [-out[0], 0, -out[2]]);
          concrete(W(a, side, PARAPET_H), W(a, side, PARAPET_H, PARAPET_T), W(b, side, PARAPET_H, PARAPET_T), W(b, side, PARAPET_H), [0, 1, 0]);
          const [ax, , az] = W(a, side, 0, PARAPET_T / 2), [bx, , bz] = W(b, side, 0, PARAPET_T / 2);
          rims.push({ ax, az, bx, bz });
        }
      }
      // A tunnel's mouth: the roof's face from its underside up to the ground, facing the open cut, with a parapet along
      // its top; the cut's square ends where it stops still down (a wall from its bed up), but where it runs on into
      // another cut
      for (let i = 0; i < s.length; i++) {
        const c = s[i], half = c.half;
        if (c.depth <= OPEN || (i === 0 && cut.joined[0]) || (i === s.length - 1 && cut.joined[1])) continue;
        const before = i > 0 ? s[i - 1].roof : null, here = i + 1 < s.length ? c.roof : null;
        // facing: +1 the open cut lies ahead of the section (along), -1 behind it
        const [ux, uz] = [c.nz, -c.nx];
        const face = (y0: number, facing: number) => {
          const n: CutP3 = [ux * facing, 0, uz * facing];
          if (facing > 0) concrete(P(c, half, y0), P(c, half, 0), P(c, -half, 0), P(c, -half, y0), n);
          else concrete(P(c, -half, y0), P(c, -half, 0), P(c, half, 0), P(c, half, y0), n);
        };
        if (before === null || here === null) face(-c.depth, before === null ? 1 : -1);
        else if (before !== here) {
          const facing = here ? -1 : 1;
          face(-SLAB, facing);
          if (c.depth >= PARAPET) {
            const back = facing * PARAPET_T;
            const q = (o: number, w: number, y: number): CutP3 => [c.x + c.nx * o - ux * w, y, c.z + c.nz * o - uz * w];
            concrete(q(half, 0, 0), q(half, 0, PARAPET_H), q(-half, 0, PARAPET_H), q(-half, 0, 0), [ux * facing, 0, uz * facing]);
            concrete(q(-half, back, 0), q(-half, back, PARAPET_H), q(half, back, PARAPET_H), q(half, back, 0), [-ux * facing, 0, -uz * facing]);
            concrete(q(half, 0, PARAPET_H), q(half, back, PARAPET_H), q(-half, back, PARAPET_H), q(-half, 0, PARAPET_H), [0, 1, 0]);
            const mx = c.x - ux * back / 2, mz = c.z - uz * back / 2;
            rims.push({ ax: mx + c.nx * half, az: mz + c.nz * half, bx: mx - c.nx * half, bz: mz - c.nz * half });
          }
        }
      }
    }
    return rims;
  }

  return { cuts, offset, holes, meshData };
}

export { createUnderpasses };
