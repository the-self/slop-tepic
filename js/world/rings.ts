// js/world/rings.ts
// Is a point inside a polygon: the even-odd crossing test the city's builders ask hundreds of thousands of times at
// start-up (which block is under a lamppost, a tree, a house; is a park's tree inside its outline), over outlines of up
// to thousands of vertices (the open country's fields, the woods round the town). A big outline's edges are bucketed
// once by 16 m horizontal bands, so a test only crosses the edges of the band its point is in; the answer is the very
// one the plain loop gives (the same edges, the same crossing rule). No three.js here, so node --test imports it.

const BAND = 16; // m: the bands' height
const MIN_EDGES = 24; // fewer than this, the plain loop is quicker than any index
/** An outline's edges bucketed by band: band k holds the edges (by their start vertex) that span z0 + k·BAND. */
interface Bands {
  /** the outline's vertex count when it was indexed */
  n: number;
  /** m: the lowest z of the outline, where band 0 starts */
  z0: number;
  bands: Int32Array[];
}
interface XZ {
  x: number;
  z: number;
}
type Ring = readonly number[] | Float32Array | Float64Array;

const indexes = new WeakMap<object, Bands>(); // outline -> its bands (an outline is not to change once tested: its length is checked)

// The bands of an outline of n vertices whose z the accessor z(i) gives (the bands only sort edges by z)
function buildBands(n: number, z: (i: number) => number): Bands {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    z0 = Math.min(z0, z(i));
    z1 = Math.max(z1, z(i));
  }
  const bands = Array.from({ length: Math.floor((z1 - z0) / BAND) + 1 }, (): number[] => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = Math.min(z(i), z(j)), hi = Math.max(z(i), z(j));
    for (let k = Math.floor((lo - z0) / BAND); k <= Math.floor((hi - z0) / BAND); k++) bands[k]?.push(i);
  }
  return { n, z0, bands: bands.map((b) => Int32Array.from(b)) };
}

/** (x, z) inside the polygon `pts` ([{ x, z }, ...], either winding; even-odd) */
function insidePoly(pts: readonly XZ[], x: number, z: number): boolean {
  const n = pts.length;
  if (n < MIN_EDGES) {
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  let index = indexes.get(pts);
  if (index?.n !== n) indexes.set(pts, (index = buildBands(n, (i) => pts[i].z)));
  const band = index.bands[Math.floor((z - index.z0) / BAND)] as Int32Array | undefined;
  if (!band) return false;
  let inside = false;
  for (const i of band) {
    const a = pts[i], b = pts[i === 0 ? n - 1 : i - 1];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** (x, z) inside the ring `r` (flat [x0, z0, x1, z1, ...], either winding; even-odd) */
function insideRing(r: Ring, x: number, z: number): boolean {
  const n = r.length >> 1;
  if (n < MIN_EDGES) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
    return inside;
  }
  let index = indexes.get(r);
  if (index?.n !== n) indexes.set(r, (index = buildBands(n, (i) => r[i * 2 + 1])));
  const band = index.bands[Math.floor((z - index.z0) / BAND)] as Int32Array | undefined;
  if (!band) return false;
  let inside = false;
  for (const start of band) {
    const i = start * 2, j = i === 0 ? r.length - 2 : i - 2;
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
}

/** An axis-aligned box (m) */
interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// The polygon's spans [x0, x1, x2, x3, ...] (inside from x0 to x1, x2 to x3...) along the line z (even-odd)
function spansAt(pts: readonly XZ[], z: number): number[] {
  const xs: number[] = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z));
  }
  return xs.sort((p, q) => p - q);
}

/**
 * The polygon `pts` as boxes `band` m deep that stay inside it: each band's spans where both its edges are inside (a
 * diagonal strip's bounding box takes in the roads either side of it; these keep to the strip, short of its outline by
 * up to a band's run along a slanting edge). Parts narrower than a band's slant across it are left out.
 */
function polyCover(pts: readonly XZ[], band: number): Box[] {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of pts) {
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  const out: Box[] = [];
  const rows = Math.max(1, Math.round((z1 - z0) / band));
  const h = (z1 - z0) / rows;
  for (let k = 0; k < rows; k++) {
    const za = z0 + k * h, zb = za + h;
    // (a micron inside the band: a vertex on its edge counts once, and the outline's top and bottom lines have spans)
    const top = spansAt(pts, za + 1e-6), bottom = spansAt(pts, zb - 1e-6);
    for (let i = 0; i + 1 < top.length; i += 2) {
      for (let j = 0; j + 1 < bottom.length; j += 2) {
        const x0 = Math.max(top[i], bottom[j]), x1 = Math.min(top[i + 1], bottom[j + 1]);
        if (x1 > x0) out.push({ minX: x0, maxX: x1, minZ: za, maxZ: zb });
      }
    }
  }
  return out;
}

export { insidePoly, insideRing, polyCover };
export type { Box };
