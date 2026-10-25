// js/world/lattice.js
// The arithmetic of laying the city's flat layers on its ground, on plain arrays: the height grids (decoded and
// sampled on the very triangles a mesh of them draws), triangles cut along the ground's lattice or to a rectangle,
// and the faces that looked up turned to the slope they lie on. Nothing here touches three.js or the city's data, so
// the tiles' worker (tile-worker.js) runs it off the main thread and node --test imports it directly.

// A grid's heights (dm, Int16 little-endian, base64) in metres
function decodeHeights(grid) {
  const bin = atob(grid.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dm = new Int16Array(bytes.buffer);
  const heights = new Float32Array(dm.length);
  for (let i = 0; i < dm.length; i++) heights[i] = dm[i] / 10;
  return heights;
}

// Height on a grid at (x, z), on the very triangles a mesh of it draws (each cell split from its +x corner to its +z
// corner), `outside` beyond it
function gridSampler(grid, heights, outside) {
  const { x0, z0, cell, w, h } = grid;
  return (x, z) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (!(fx >= 0 && fz >= 0 && fx < w - 1 && fz < h - 1)) return outside;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * w + i;
    const h00 = heights[k], h10 = heights[k + 1], h01 = heights[k + w], h11 = heights[k + w + 1];
    return tx + tz <= 1 ? h00 + (h10 - h00) * tx + (h01 - h00) * tz : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
}

// The vertices of the pieces being cut, all their attributes in one growing pool (a piece is a list of indices into
// it), and the cut of a convex piece by a line
function createPool(arrays, sizes) {
  const stride = sizes.reduce((t, s) => t + s, 0);
  const EPS = 1e-7;
  const pool = {
    data: new Float64Array(stride * 1024),
    used: 0,
    stride,
    grow() {
      if ((pool.used + 1) * stride <= pool.data.length) return;
      const next = new Float64Array(pool.data.length * 2);
      next.set(pool.data);
      pool.data = next;
    },
    // a vertex of the input
    vertex(i) {
      pool.grow();
      let o = pool.used * stride;
      for (let a = 0; a < arrays.length; a++) {
        const size = sizes[a], arr = arrays[a];
        for (let c = 0; c < size; c++) pool.data[o++] = arr[i * size + c];
      }
      return pool.used++;
    },
    // a vertex between two of the pool's, every attribute interpolated
    between(a, b, t) {
      pool.grow();
      const d = pool.data, o = pool.used * stride, oa = a * stride, ob = b * stride;
      for (let c = 0; c < stride; c++) d[o + c] = d[oa + c] + (d[ob + c] - d[oa + c]) * t;
      return pool.used++;
    },
    at(f, v) {
      return f(pool.data[v * stride], pool.data[v * stride + 2]);
    },
    // a convex piece cut by the line f = k: the part with f <= k and the part with f >= k (either may be empty)
    cut(poly, f, k) {
      const below = [], above = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const sa = pool.at(f, a) - k, sb = pool.at(f, b) - k;
        if (sa <= EPS) below.push(a);
        if (sa >= -EPS) above.push(a);
        if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
          const p = pool.between(a, b, sa / (sa - sb));
          below.push(p);
          above.push(p);
        }
      }
      return [below, above];
    }
  };
  return pool;
}

// The output arrays (of type `Out`): the whole input triangles `whole` (vertex indices), then fans of the (convex)
// pieces in their triangle's winding
function emitPieces(arrays, sizes, whole, polys, pool, Out = Float32Array) {
  let n = whole.length;
  for (const p of polys) n += (p.length - 2) * 3;
  const out = sizes.map((size) => new Out(n * size));
  let w = 0;
  for (const i of whole) {
    for (let a = 0; a < out.length; a++) {
      const size = sizes[a];
      for (let c = 0; c < size; c++) out[a][w * size + c] = arrays[a][i * size + c];
    }
    w++;
  }
  const emit = (v) => {
    let o = v * pool.stride;
    for (let a = 0; a < out.length; a++) {
      const size = sizes[a];
      for (let c = 0; c < size; c++) out[a][w * size + c] = pool.data[o++];
    }
    w++;
  };
  for (const p of polys) {
    for (let i = 1; i + 1 < p.length; i++) {
      emit(p[0]);
      emit(p[i]);
      emit(p[i + 1]);
    }
  }
  return out;
}

/**
 * Triangles cut along a ground lattice { x0, z0, cell }: the lines x = x0 + k·cell, z = z0 + k·cell and
 * x + z = x0 + z0 + k·cell (each cell's diagonal, from its +x corner to its +z corner), so every piece lies on one of the
 * ground's triangles and, laid on it, follows it exactly instead of cutting across its folds.
 * `arrays` are the vertex attributes ([0] the positions, x y z), `sizes` their item sizes, `index` the triangles (or
 * null: consecutive vertices). Every attribute is interpolated along the cuts. Returns new arrays, non-indexed.
 */
function clipToLattice(arrays, sizes, index, lattice) {
  const { x0, z0, cell } = lattice;
  const pos = arrays[0], ps = sizes[0];
  const tris = (index ? index.length : pos.length / ps) / 3;
  const corner = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  // the three families of lines, as a coordinate whose integer values are the lines
  const families = [
    (x, z) => (x - x0) / cell,
    (x, z) => (z - z0) / cell,
    (x, z) => (x - x0 + z - z0) / cell
  ];
  const EPS = 1e-7;
  const firstLine = (lo) => Math.floor(lo + EPS) + 1; // the first line past lo
  const pool = createPool(arrays, sizes);

  // The triangles inside one ground triangle go through as they are (most of the small ones); the rest are cut,
  // family by family, into convex pieces
  const whole = [];
  let polys = [];
  for (let t = 0; t < tris; t++) {
    const i0 = corner(t, 0), i1 = corner(t, 1), i2 = corner(t, 2);
    let inside = true;
    for (const f of families) {
      const a = f(pos[i0 * ps], pos[i0 * ps + 2]), b = f(pos[i1 * ps], pos[i1 * ps + 2]), c = f(pos[i2 * ps], pos[i2 * ps + 2]);
      if (firstLine(Math.min(a, b, c)) < Math.max(a, b, c) - EPS) { inside = false; break; }
    }
    if (inside) whole.push(i0, i1, i2);
    else polys.push([pool.vertex(i0), pool.vertex(i1), pool.vertex(i2)]);
  }
  for (const f of families) {
    const next = [];
    for (let poly of polys) {
      let lo = Infinity, hi = -Infinity;
      for (const v of poly) {
        const s = pool.at(f, v);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      for (let k = firstLine(lo); k < hi - EPS; k++) {
        const [below, above] = pool.cut(poly, f, k);
        if (below.length >= 3) next.push(below);
        poly = above;
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) next.push(poly);
    }
    polys = next;
  }
  return emitPieces(arrays, sizes, whole, polys, pool);
}

const alongX = (x) => x;
const alongZ = (x, z) => z;

/**
 * The parts of triangles inside the rectangle { x0, x1, z0, z1 } (in x & z), cut on its edges; the triangles wholly
 * inside go through as they are. `arrays`, `sizes` & `index` as clipToLattice's; `tris` (optional) the triangles to
 * take, by number (all of them by default). Returns new arrays, non-indexed, of type `Out`: Float64Array keeps the
 * vertices cut on an edge exactly on it, for a lattice cut to follow (Float32 would round them a fraction of a
 * millimetre off it, and the next cut would split slivers off along it).
 */
function clipToRect(arrays, sizes, index, rect, tris = null, Out = Float32Array) {
  const { x0, x1, z0, z1 } = rect;
  const pos = arrays[0], ps = sizes[0];
  const count = tris ? tris.length : (index ? index.length : pos.length / ps) / 3;
  const corner = (t, c) => (index ? index[t * 3 + c] : t * 3 + c);
  const pool = createPool(arrays, sizes);
  const whole = [];
  const polys = [];
  for (let n = 0; n < count; n++) {
    const t = tris ? tris[n] : n;
    const i0 = corner(t, 0), i1 = corner(t, 1), i2 = corner(t, 2);
    const ax = pos[i0 * ps], az = pos[i0 * ps + 2], bx = pos[i1 * ps], bz = pos[i1 * ps + 2], cx = pos[i2 * ps], cz = pos[i2 * ps + 2];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    if (maxX <= x0 || minX >= x1 || maxZ <= z0 || minZ >= z1) continue;
    if (minX >= x0 && maxX <= x1 && minZ >= z0 && maxZ <= z1) {
      whole.push(i0, i1, i2);
      continue;
    }
    let poly = [pool.vertex(i0), pool.vertex(i1), pool.vertex(i2)];
    // (each edge keeps the side towards the inside)
    if (minX < x0) poly = pool.cut(poly, alongX, x0)[1];
    if (poly.length >= 3 && maxX > x1) poly = pool.cut(poly, alongX, x1)[0];
    if (poly.length >= 3 && minZ < z0) poly = pool.cut(poly, alongZ, z0)[1];
    if (poly.length >= 3 && maxZ > z1) poly = pool.cut(poly, alongZ, z1)[0];
    if (poly.length >= 3) polys.push(poly);
  }
  return emitPieces(arrays, sizes, whole, polys, pool, Out);
}

// The triangles of non-indexed positions facing up or sideways (by number): the undersides of the slabs lying on the
// ground are never seen, and cut along the lattice they would cost as much as their tops
function visibleTriangles(pos, index = null) {
  const n = (index ? index.length : pos.length / 3) / 3;
  const keep = [];
  for (let t = 0; t < n; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const ny = uz * vx - ux * vz, len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (len > 0 && ny / len < -0.9) continue; // facing down
    keep.push(t);
  }
  return keep;
}

// The normals of a non-indexed geometry's up-facing triangles turned to their (draped) face normals
function tiltUpNormals(pos, normal) {
  for (let o = 0; o < pos.length; o += 9) {
    if (normal[o + 1] < 0.9 || normal[o + 4] < 0.9 || normal[o + 7] < 0.9) continue;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    const s = (ny < 0 ? -1 : 1) / len; // (up, whichever way the piece is wound)
    nx *= s; ny *= s; nz *= s;
    for (let k = 0; k < 9; k += 3) {
      normal[o + k] = nx;
      normal[o + k + 1] = ny;
      normal[o + k + 2] = nz;
    }
  }
}

/**
 * Lays triangles (`arrays`, `sizes` & `index` as clipToLattice's) on a floor: cut along `lattice`, each vertex raised by
 * `height(x, z)`, and the up-facing faces' normals (the attribute at `normalAt`, if any) tilted with the slope under
 * them. Returns new arrays, non-indexed.
 */
function layOnFloor(arrays, sizes, lattice, height, normalAt = -1, index = null) {
  const out = clipToLattice(arrays, sizes, index, lattice);
  const pos = out[0];
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] += height(pos[i], pos[i + 2]);
  if (normalAt >= 0 && sizes[normalAt] === 3) tiltUpNormals(pos, out[normalAt]);
  return out;
}

export { decodeHeights, gridSampler, clipToLattice, clipToRect, visibleTriangles, tiltUpNormals, layOnFloor };
