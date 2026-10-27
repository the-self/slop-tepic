// js/world/tiles.ts
// The city cut in square tiles, so its heaviest layers are built only around the player (world/streaming.ts), the way
// open-world games stream their maps. A tile's edges lie on the ground's lattice (ground.ts: 37.5 m cells in Tepic), 12 cells a side
// (450 m), so the pieces a layer is cut into to lie on the slopes never straddle two tiles.
// A flat layer (the road deck, the sidewalks & curbs, the paint, the empedrado: built at y = 0 in world space) is
// bucketed here once by the tiles its triangles overlap; each tile's part is cut out of it on the tile's edges and laid
// on the town's floor when the tile is wanted (drapeTile), on the main thread or in tile-worker.ts.
// No three.js here: the worker and node --test import it directly.
import { clipToRect, visibleTriangles, layOnFloor } from './lattice.ts';
import type { FloatArray, HeightFn, Lattice, Numbers, Rect } from './lattice.ts';

/** The tile grid: tile (i, j) spans x0 + i·size ... x0 + (i + 1)·size east and z0 + j·size ... south (m). */
export interface TileGrid {
  x0: number;
  z0: number;
  /** m a side */
  size: number;
  /** The key of tile (i, j): one integer. */
  key: (i: number, j: number) => number;
  i: (k: number) => number;
  j: (k: number) => number;
  /** The key of the tile at (x, z) */
  keyAt: (x: number, z: number) => number;
  /** Tile `k`'s rectangle */
  rect: (k: number) => Rect;
}

/** A flat layer as clipToLattice takes it: its vertex attributes ([0] the positions), their item sizes, the
 *  triangles (or null: consecutive vertices), and the normals' place among the attributes (-1 none). */
export interface FlatLayer {
  arrays: Numbers[];
  sizes: number[];
  index: Numbers | null;
  normalAt: number;
}

/** A tile wanted, at distance d (m) from the focus. */
export interface TileWant {
  key: number;
  d: number;
}

const TILE_CELLS = 12; // lattice cells a tile side
const FLAT_TILE = 450; // m a side in the flat city (?slopes=0), where there is no lattice
const KEY_BIAS = 32768; // tile indices from -32768 to 32767 each way in a key

/**
 * The tile grid over a lattice { x0, z0, cell } (or, without one, FLAT_TILE squares from the origin). Tile (i, j)
 * spans x0 + i·size ... x0 + (i + 1)·size east and z0 + j·size ... south; its key is one integer.
 */
function createTileGrid(lattice: Lattice | null = null, cells = TILE_CELLS): TileGrid {
  const x0 = lattice ? lattice.x0 : 0, z0 = lattice ? lattice.z0 : 0;
  const size = lattice ? lattice.cell * cells : FLAT_TILE;
  const key = (i: number, j: number) => (i + KEY_BIAS) * 65536 + (j + KEY_BIAS);
  return {
    x0, z0, size,
    key,
    i: (k) => Math.floor(k / 65536) - KEY_BIAS,
    j: (k) => (k % 65536) - KEY_BIAS,
    /** The key of the tile at (x, z) */
    keyAt: (x, z) => key(Math.floor((x - x0) / size), Math.floor((z - z0) / size)),
    /** Tile `k`'s rectangle { x0, x1, z0, z1 } */
    rect(k) {
      const i = Math.floor(k / 65536) - KEY_BIAS, j = (k % 65536) - KEY_BIAS;
      return { x0: x0 + i * size, x1: x0 + (i + 1) * size, z0: z0 + j * size, z1: z0 + (j + 1) * size };
    }
  };
}

/**
 * A flat layer's triangles bucketed by the tiles their bounds overlap: Map(tile key -> Uint32Array of triangle
 * numbers). `position` holds x y z per vertex (world space), `index` the triangles or null. Triangles facing down
 * are left out with `undersides: false` (a slab's bottom on the ground is never seen).
 */
function bucketTriangles(position: Numbers, index: Numbers | null, grid: TileGrid,
  { undersides = true }: { undersides?: boolean } = {}): Map<number, Uint32Array> {
  const tris = undersides ? null : visibleTriangles(position, index);
  const count = tris ? tris.length : (index ? index.length : position.length / 3) / 3;
  const lists = new Map<number, number[]>();
  const { x0, z0, size } = grid;
  for (let n = 0; n < count; n++) {
    const t = tris ? tris[n] : n;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let c = 0; c < 3; c++) {
      const v = index ? index[t * 3 + c] : t * 3 + c;
      const x = position[v * 3], z = position[v * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // (a triangle just touching a tile's edge leaves nothing inside it: the open ends)
    const i0 = Math.floor((minX - x0) / size), i1 = Math.ceil((maxX - x0) / size) - 1;
    const j0 = Math.floor((minZ - z0) / size), j1 = Math.ceil((maxZ - z0) / size) - 1;
    for (let i = i0; i <= Math.max(i0, i1); i++) {
      for (let j = j0; j <= Math.max(j0, j1); j++) {
        const k = grid.key(i, j);
        let list = lists.get(k);
        if (!list) lists.set(k, (list = []));
        list.push(t);
      }
    }
  }
  const out = new Map<number, Uint32Array>();
  for (const [k, list] of lists) out.set(k, Uint32Array.from(list));
  return out;
}

/**
 * Tile `key`'s part of a flat layer, laid on the floor: `layer` is { arrays, sizes, index, normalAt } (the layer's
 * vertex attributes as clipToLattice takes them, the normals' place among them or -1) and `tris` its triangles in the
 * tile (bucketTriangles). With a lattice the pieces are cut along it and raised by `height(x, z)`; without one (the flat
 * city) they are only cut on the tile's edges. Returns the new arrays (non-indexed), or null if nothing is left.
 */
function drapeTile(layer: FlatLayer, tris: Numbers | null | undefined, key: number, grid: TileGrid, lattice: Lattice | null,
  height: HeightFn): FloatArray[] | null {
  if (!tris?.length) return null;
  const inTile = clipToRect(layer.arrays, layer.sizes, layer.index, grid.rect(key), tris, lattice ? Float64Array : Float32Array);
  if (!inTile[0].length) return null;
  return lattice ? layOnFloor(inTile, layer.sizes, lattice, height, layer.normalAt) : inTile;
}

// Distance (m, in x & z) from (x, z) to a rectangle: 0 inside it
function rectDistance(r: Rect, x: number, z: number): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
  return Math.hypot(dx, dz);
}

/**
 * The tiles a focus wants, nearest first: those of `candidates` (tile keys: the tiles with anything in them) within
 * `radius` of where the player is (x, z) or of where they are heading (ax, az: a few seconds ahead), each with its
 * distance, the nearer of the two: [{ key, d }].
 */
function tilesAround(grid: TileGrid, candidates: { has(key: number): boolean }, radius: number, x: number, z: number,
  ax = x, az = z): TileWant[] {
  const out: TileWant[] = [];
  const seen = new Set<number>();
  for (const [px, pz] of [[x, z], [ax, az]]) {
    const i0 = Math.floor((px - radius - grid.x0) / grid.size), i1 = Math.floor((px + radius - grid.x0) / grid.size);
    const j0 = Math.floor((pz - radius - grid.z0) / grid.size), j1 = Math.floor((pz + radius - grid.z0) / grid.size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = grid.key(i, j);
        if (seen.has(key) || !candidates.has(key)) continue;
        seen.add(key);
        const r = grid.rect(key);
        const d = Math.min(rectDistance(r, x, z), rectDistance(r, ax, az));
        if (d <= radius) out.push({ key, d });
      }
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

export { TILE_CELLS, createTileGrid, bucketTriangles, drapeTile, rectDistance, tilesAround };
