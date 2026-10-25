// js/world/rings.js
// Is a point inside a polygon: the even-odd crossing test the city's builders ask hundreds of thousands of times at
// start-up (which block is under a lamppost, a tree, a house; is a park's tree inside its outline), over outlines of up
// to thousands of vertices (the open country's fields, the woods round the town). A big outline's edges are bucketed
// once by 16 m horizontal bands, so a test only crosses the edges of the band its point is in; the answer is the very
// one the plain loop gives (the same edges, the same crossing rule). No three.js here, so node --test imports it.

const BAND = 16; // m: the bands' height
const MIN_EDGES = 24; // fewer than this, the plain loop is quicker than any index
const indexes = new WeakMap(); // outline -> its bands

// The bands of an outline given by accessors x(i), z(i) over n vertices: { z0, bands: [edge starts, ...] }
function buildBands(n, x, z) {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    z0 = Math.min(z0, z(i));
    z1 = Math.max(z1, z(i));
  }
  const bands = Array.from({ length: Math.floor((z1 - z0) / BAND) + 1 }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = Math.min(z(i), z(j)), hi = Math.max(z(i), z(j));
    for (let k = Math.floor((lo - z0) / BAND); k <= Math.floor((hi - z0) / BAND); k++) bands[k].push(i);
  }
  return { z0, bands: bands.map((b) => Int32Array.from(b)) };
}

/** (x, z) inside the polygon `pts` ([{ x, z }, ...], either winding; even-odd) */
function insidePoly(pts, x, z) {
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
  if (!index) indexes.set(pts, (index = buildBands(n, (i) => pts[i].x, (i) => pts[i].z)));
  const band = index.bands[Math.floor((z - index.z0) / BAND)];
  if (!band) return false;
  let inside = false;
  for (let k = 0; k < band.length; k++) {
    const i = band[k], a = pts[i], b = pts[i === 0 ? n - 1 : i - 1];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** (x, z) inside the ring `r` (flat [x0, z0, x1, z1, ...], either winding; even-odd) */
function insideRing(r, x, z) {
  const n = r.length >> 1;
  if (n < MIN_EDGES) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
    return inside;
  }
  let index = indexes.get(r);
  if (!index) indexes.set(r, (index = buildBands(n, (i) => r[i * 2], (i) => r[i * 2 + 1])));
  const band = index.bands[Math.floor((z - index.z0) / BAND)];
  if (!band) return false;
  let inside = false;
  for (let k = 0; k < band.length; k++) {
    const i = band[k] * 2, j = i === 0 ? r.length - 2 : i - 2;
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
  }
  return inside;
}

export { insidePoly, insideRing };
