// js/world/zebras.ts
// The crosswalks the paint lays (road-paint.ts), one per crossing however the street is mapped. Each roadway gets its
// own zebra at its stop lines, so where OpenStreetMap draws an avenue as its two one-way carriageways (Allende, Juan
// Escutia, Insurgentes) each would paint half a crossing, apart and askew, and a slip lane's or a short link's would
// land across another's. Here the halves of one crossing (side by side across the street, within MERGE_TURN of each
// other's heading) become one zebra curb to curb, on the line of the half furthest out from the junction; one left
// crossing another (at an angle, their middles running through each other) gives way to the longer, and one left in
// the middle of another street (a short link's between a divided road's carriageways, inside their junction) is not
// painted. No three.js here, so node --test imports it.

/** A crosswalk: its middle (m), the unit direction across the street, half its length across it and its depth along
 *  the street (m), the unit direction along the street away from its junction (0, 0 for one along a street, away from
 *  any), and what it belongs to (the paint's edge, for its lift) */
export interface Zebra<E> {
  x: number;
  z: number;
  ux: number;
  uz: number;
  half: number;
  w: number;
  ox: number;
  oz: number;
  e: E;
}
/** A roadway a zebra may stand in: its centreline from (x0, z0) along the unit (dx, dz) for `span` m, `half` m either
 *  side of it */
export interface ZebraRoad {
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  span: number;
  half: number;
}
/** The zebras as painted, and for each one given the index of the one it is painted as (-1: left out) */
export interface MergedZebras<E> {
  painted: Zebra<E>[];
  of: number[];
}

const MERGE_TURN = 0.8; // cos of the widest angle (~37°) between the halves of one crossing
const MERGE_GAP = 2.5; // m: halves of one crossing this far apart across the street (a carriageway's curb to the next)
const MERGE_SHIFT = 16; // m: and no further apart along it (their junctions' nodes: a divided road's, up to 14 m apart)
const SAME_SHIFT = 2.5; // m: two zebras over the same stretch across the street this near along it are one
const OVERLAP_END = 1; // m: two zebras crossing within this of an end of either only touch (a corner, an island's tip)
const ACROSS = 0.7; // cos of the widest angle (~45°) between a zebra and a street it stands in the middle of
const INSIDE = 1.5; // m inside that street's curbs its middle must be
const CELL = 16; // m, the cells of their lookup

/**
 * The zebras `list` as painted: the halves of one crossing merged, those crossing a longer one or standing in the
 * middle of one of `roads` running across them left out
 */
function mergeZebras<E>(list: readonly Zebra<E>[], roads: readonly ZebraRoad[] = []): MergedZebras<E> {
  // the roads in cells, for inRoad
  const roadCells = new Map<number, ZebraRoad[]>();
  for (const r of roads) {
    const x1 = r.x0 + r.dx * r.span, z1 = r.z0 + r.dz * r.span;
    for (let a = Math.floor((Math.min(r.x0, x1) - r.half) / CELL); a <= Math.floor((Math.max(r.x0, x1) + r.half) / CELL); a++) {
      for (let b = Math.floor((Math.min(r.z0, z1) - r.half) / CELL); b <= Math.floor((Math.max(r.z0, z1) + r.half) / CELL); b++) {
        const k = a * 100003 + b;
        let at = roadCells.get(k);
        if (!at) roadCells.set(k, (at = []));
        at.push(r);
      }
    }
  }
  // does a zebra's middle stand well inside a roadway running across it (between that road's nodes: its junctions too)?
  // (a junction's own zebras stand just clear of the roads crossing it, their middles a zebra's depth from the curb)
  const inRoad = (zb: Zebra<E>) => (roadCells.get(Math.floor(zb.x / CELL) * 100003 + Math.floor(zb.z / CELL)) ?? []).some((r) => {
    if (Math.abs(r.dx * zb.ux + r.dz * zb.uz) < ACROSS) return false; // (its own street, or one along it)
    const t = (zb.x - r.x0) * r.dx + (zb.z - r.z0) * r.dz;
    return t > 0 && t < r.span && Math.abs((zb.x - r.x0) * -r.dz + (zb.z - r.z0) * r.dx) < r.half - INSIDE;
  });
  // 1. The halves of each crossing, grouped (union-find over the pairs near enough)
  const parent = list.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const cells = new Map<number, number[]>();
  list.forEach((zb, i) => {
    const k = Math.floor(zb.x / CELL) * 100003 + Math.floor(zb.z / CELL);
    let at = cells.get(k);
    if (!at) cells.set(k, (at = []));
    at.push(i);
  });
  list.forEach((A, i) => {
    const r = Math.ceil((A.half + MERGE_GAP + MERGE_SHIFT + 30) / CELL);
    const cx = Math.floor(A.x / CELL), cz = Math.floor(A.z / CELL);
    for (let a = cx - r; a <= cx + r; a++) for (let b = cz - r; b <= cz + r; b++) for (const j of cells.get(a * 100003 + b) ?? []) {
      if (j <= i) continue;
      const B = list[j];
      const cos = A.ux * B.ux + A.uz * B.uz;
      if (Math.abs(cos) < MERGE_TURN) continue;
      // B's middle along A's street (square to A's across) and its extent across, on A's line
      const dx = B.x - A.x, dz = B.z - A.z;
      const shift = Math.abs(dx * -A.uz + dz * A.ux);
      const mid = dx * A.ux + dz * A.uz, reach = B.half * Math.abs(cos);
      const lo = Math.max(-A.half, mid - reach), hi = Math.min(A.half, mid + reach);
      if (hi - lo < -MERGE_GAP) continue; // (apart across the street)
      // side by side across it (the halves, overlapping by under a third), or over the same stretch of it: one only
      // when as near along it as a zebra is deep (both sides of a junction overlap across it, a street apart)
      const share = (hi - lo) / (2 * Math.min(A.half, reach));
      if (shift > (share < 0.66 ? MERGE_SHIFT : SAME_SHIFT)) continue;
      // (and the halves of a crossing face away from the same junction)
      if (share < 0.66 && A.ox * B.ox + A.oz * B.oz < 0) continue;
      parent[root(j)] = root(i);
    }
  });
  const groups = new Map<number, number[]>();
  list.forEach((_, i) => {
    const r = root(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  // each group as one zebra: across the way its longest half runs (the others turned to agree with it), from the
  // furthest end on one side to the furthest on the other, on the line of the one furthest out from their junction
  const merged: Zebra<E>[] = [];
  const groupOf = new Array<number>(list.length).fill(-1);
  for (const g of groups.values()) {
    for (const i of g) groupOf[i] = merged.length;
    if (g.length === 1) {
      merged.push(list[g[0]]);
      continue;
    }
    const lead = g.map((i) => list[i]).reduce((p, q) => (q.half > p.half ? q : p));
    let ux = 0, uz = 0, ox = 0, oz = 0;
    for (const i of g) {
      const zb = list[i];
      const s = zb.ux * lead.ux + zb.uz * lead.uz < 0 ? -zb.half : zb.half;
      ux += zb.ux * s;
      uz += zb.uz * s;
      ox += zb.ox;
      oz += zb.oz;
    }
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    // (along: square to across, turned to point out of the junction where the halves say which way that is)
    const out = ox * -uz + oz * ux;
    const ax = out < 0 ? uz : -uz, az = out < 0 ? -ux : ux;
    let lo = Infinity, hi = -Infinity, along = -Infinity, mean = 0, weight = 0, w = 0;
    for (const i of g) {
      const zb = list[i];
      for (const k of [-1, 1]) {
        const t = (zb.x + zb.ux * zb.half * k - lead.x) * ux + (zb.z + zb.uz * zb.half * k - lead.z) * uz;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      const a = (zb.x - lead.x) * ax + (zb.z - lead.z) * az;
      along = Math.max(along, a);
      mean += a * zb.half;
      weight += zb.half;
      w = Math.max(w, zb.w);
    }
    if (Math.abs(out) < 0.5) along = mean / weight; // (one along a street: between them)
    const c = (lo + hi) / 2;
    const ol = Math.hypot(ox, oz) || 1;
    merged.push({ x: lead.x + ux * c + ax * along, z: lead.z + uz * c + az * along, ux, uz, half: (hi - lo) / 2, w, ox: ox / ol, oz: oz / ol, e: lead.e });
  }

  // 2. A zebra whose middle runs through a longer one's (at an angle: the merged ones are apart) is left out
  // (the ones painted so far by CELL cell of their middles, looked through as far as the longest reaches)
  const kept = new Array<number>(merged.length).fill(-1);
  const painted: Zebra<E>[] = [];
  const paintedCells = new Map<number, Zebra<E>[]>();
  const longest = merged.map((_, i) => i).sort((p, q) => merged[q].half - merged[p].half);
  const reach = merged.length ? merged[longest[0]].half : 0;
  const crossing = (A: Zebra<E>, B: Zebra<E>) => {
    if (Math.hypot(A.x - B.x, A.z - B.z) > A.half + B.half) return false;
    // where their middles' lines meet: t along A, u along B (from their middles)
    const den = A.ux * B.uz - A.uz * B.ux;
    if (Math.abs(den) < 1e-6) return false;
    const dx = B.x - A.x, dz = B.z - A.z;
    const t = (dx * B.uz - dz * B.ux) / den, u = (dx * A.uz - dz * A.ux) / den;
    return Math.abs(t) < A.half - OVERLAP_END && Math.abs(u) < B.half - OVERLAP_END;
  };
  const crossesPainted = (A: Zebra<E>) => {
    const r = Math.ceil((A.half + reach) / CELL), cx = Math.floor(A.x / CELL), cz = Math.floor(A.z / CELL);
    for (let a = cx - r; a <= cx + r; a++) for (let b = cz - r; b <= cz + r; b++) {
      for (const B of paintedCells.get(a * 100003 + b) ?? []) if (crossing(A, B)) return true;
    }
    return false;
  };
  for (const k of longest) {
    const A = merged[k];
    if (crossesPainted(A) || inRoad(A)) continue;
    kept[k] = painted.length;
    painted.push(A);
    const key = Math.floor(A.x / CELL) * 100003 + Math.floor(A.z / CELL);
    const at = paintedCells.get(key);
    if (at) at.push(A);
    else paintedCells.set(key, [A]);
  }
  return { painted, of: groupOf.map((g) => kept[g]) };
}

export { mergeZebras };
