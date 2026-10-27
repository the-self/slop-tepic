// js/world/edge-places.ts
// Things OpenStreetMap maps as points along the streets (a crossing, a bus stop, a speed bump) placed on the road
// network's edges (road-network.ts): which edge each stands by and how far along it from its stop line, and how far
// to its right (m). No three.js here, so node --test imports it.

/** What placing reads of an edge: its stop line (sx, sz), unit direction & right, length between the stop lines and
 *  half its width (m), and its lift (on a bridge or ramp: nothing placed there) */
export interface PlaceEdge {
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  len: number;
  half: number;
  lift?: unknown;
}
/** A point placed on edge `edge`: which of the points it is, m along the edge from its start stop line (< 0 or past
 *  `len`: in the junction there) and m to its right of the centre line (< 0 left) */
export interface EdgePlace<E> {
  i: number;
  edge: E;
  raw: number;
  right: number;
}
/** Where a point may stand of an edge: m past its stop lines (`reach`), m off its curb (`aside`, out on the sidewalk),
 *  and whether only on its right (a bus stop: the curb the traffic pulls in to) */
export interface PlaceOptions {
  reach: number;
  aside: number;
  rightOnly?: boolean;
  /** Edges shorter than this (m) take nothing */
  minLen?: number;
}

const CELL = 48; // m, the cells of the lookup of the edges

/**
 * The points `flat` (x, z, then `stride` - 2 more numbers each) on the edges `edges` they stand by: each on the edge
 * nearest it (of a two-way road, one of its two edges; on the right of it, `rightOnly`), within `aside` m of its curb
 * and `reach` m past its stop lines. Those by no edge are left out.
 */
function placeOnEdges<E extends PlaceEdge>(flat: readonly number[], stride: number, edges: readonly E[], options: PlaceOptions): EdgePlace<E>[] {
  const { reach, aside, rightOnly = false, minLen = 0 } = options;
  const cells = new Map<number, E[]>();
  for (const e of edges) {
    if (e.lift || e.len < minLen) continue;
    const ax = e.sx - e.dx * reach, az = e.sz - e.dz * reach, bx = e.sx + e.dx * (e.len + reach), bz = e.sz + e.dz * (e.len + reach);
    const r = e.half + aside;
    for (let i = Math.floor((Math.min(ax, bx) - r) / CELL); i <= Math.floor((Math.max(ax, bx) + r) / CELL); i++) {
      for (let j = Math.floor((Math.min(az, bz) - r) / CELL); j <= Math.floor((Math.max(az, bz) + r) / CELL); j++) {
        const key = i * 100003 + j;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(e);
      }
    }
  }
  const out: EdgePlace<E>[] = [];
  for (let k = 0, i = 0; k + 1 < flat.length; k += stride, i++) {
    const x = flat[k], z = flat[k + 1];
    let best: E | null = null, bestScore = Infinity, bestRaw = 0, bestRight = 0;
    for (const e of cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? []) {
      const raw = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
      const right = (x - e.sx) * e.rx + (z - e.sz) * e.rz;
      if (raw < -reach || raw > e.len + reach || Math.abs(right) > e.half + aside || (rightOnly && right < 0)) continue;
      // (nearest its centre line; of two about as near, the one it lies inside the stop lines of)
      const score = Math.abs(right) + Math.max(0, -raw, raw - e.len) * 0.5;
      if (score < bestScore) { bestScore = score; best = e; bestRaw = raw; bestRight = right; }
    }
    if (best) out.push({ i, edge: best, raw: bestRaw, right: bestRight });
  }
  return out;
}

export { placeOnEdges };
