// js/world/crossings.ts
// The pedestrian crossings of OpenStreetMap (city-geodata.js `crossings`: highway=crossing on the streets) placed on
// the road network's edges (road-network.ts): which edge each crosses and how far along it from its stop line. The
// paint draws a zebra at the marked ones (road-paint.ts), people cross the street there and the traffic stops for
// them (sim/traffic). One mapped at a junction's approach is taken on that junction's own crosswalk (road-paint.ts
// paints every one), just outside the edge's stop line. No three.js here, so node --test imports it.

/** What placing reads of an edge: its stop line (sx, sz), unit direction & right, length between the stop lines and
 *  half its width (m), and its lift (on a bridge or ramp: no crossing there) */
export interface CrossingEdge {
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
/** A crossing's kind: 0 unmarked, 1 marked (a zebra), 2 with lights */
export type CrossingKind = 0 | 1 | 2;
/** A crossing on edge `edge`: where it is mapped, its kind, and m along the edge from its start stop line, where it is
 *  taken (`s`: where mapped, or within CLEAR m of a stop line on the junction's crosswalk, AT_JUNCTION m outside it)
 *  and where it is mapped (`raw`) */
export interface PlacedCrossing<E> {
  x: number;
  z: number;
  kind: CrossingKind;
  edge: E;
  s: number;
  raw: number;
}

const REACH = 6; // m past an edge's stop lines a crossing is still taken onto it (in its junction's crosswalk)
const CLEAR = 2.5; // m inside a stop line a mapped crossing is still the junction's
const AT_JUNCTION = 1.25; // m outside the stop line, the middle of a junction's crosswalk (road-network.ts CROSSWALK)
const ASIDE = 1; // m off the curb a crossing's point may be mapped
const CELL = 48; // m, the cells of the lookup of the edges

const asKind = (k: number): CrossingKind => (k === 2 ? 2 : k === 1 ? 1 : 0);

/**
 * The crossings `flat` (GEO.crossings: x, z, kind each) on the edges `edges` they cross: each on the edge whose
 * roadway it stands in, nearest its centre line (of a two-way road, one of its two edges). Those on no edge (on a
 * bridge, an edge too short to stop short of it) are left out.
 */
function placeCrossings<E extends CrossingEdge>(flat: readonly number[], edges: readonly E[]): PlacedCrossing<E>[] {
  const cells = new Map<number, E[]>();
  for (const e of edges) {
    if (e.lift || e.len < 2 * CLEAR + 1) continue;
    const ax = e.sx - e.dx * REACH, az = e.sz - e.dz * REACH, bx = e.sx + e.dx * (e.len + REACH), bz = e.sz + e.dz * (e.len + REACH);
    const r = e.half + ASIDE;
    for (let i = Math.floor((Math.min(ax, bx) - r) / CELL); i <= Math.floor((Math.max(ax, bx) + r) / CELL); i++) {
      for (let j = Math.floor((Math.min(az, bz) - r) / CELL); j <= Math.floor((Math.max(az, bz) + r) / CELL); j++) {
        const key = i * 100003 + j;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(e);
      }
    }
  }
  const out: PlacedCrossing<E>[] = [];
  for (let k = 0; k + 2 < flat.length; k += 3) {
    const x = flat[k], z = flat[k + 1];
    let best: E | null = null, bestAside = Infinity, bestRaw = 0;
    for (const e of cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? []) {
      const raw = (x - e.sx) * e.dx + (z - e.sz) * e.dz;
      const aside = Math.abs((x - e.sx) * e.rx + (z - e.sz) * e.rz);
      if (raw < -REACH || raw > e.len + REACH || aside > e.half + ASIDE) continue;
      // (nearest its centre line; of two about as near, the one it lies inside the stop lines of)
      const outside = Math.max(0, -raw, raw - e.len);
      if (aside + outside * 0.5 < bestAside) { bestAside = aside + outside * 0.5; best = e; bestRaw = raw; }
    }
    if (!best) continue;
    const s = bestRaw < CLEAR ? -AT_JUNCTION : bestRaw > best.len - CLEAR ? best.len + AT_JUNCTION : bestRaw;
    out.push({ x, z, kind: asKind(flat[k + 2]), edge: best, s, raw: bestRaw });
  }
  return out;
}

export { CLEAR as CROSSING_CLEAR, AT_JUNCTION as CROSSING_AT_JUNCTION, placeCrossings };
