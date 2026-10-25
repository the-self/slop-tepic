// js/world/tile-worker.ts
// The worker that lays the streamed tiles on the slopes (world/streaming.ts runs a couple of them): it keeps its share
// of every flat layer (the triangles of the tiles it answers for, bucketed by the main thread), and answers a tile's
// request with each layer's part of it cut out and laid on the town's floor, the arrays handed back without a copy.
// The main thread only puts them in meshes.
//
// in:  { type: 'init', lattice, cells, ground, holes }         ground: GEO.ground (null in the flat city); holes: the
//                                                              river channels' in the deck (waterways.ts), or null
//      { type: 'layer', id, arrays, sizes, normalAt, cutHoles, buckets }   arrays non-indexed; buckets [[key, tris]]
//      { type: 'tile', key, layers: [id, ...] }
// out: { type: 'tile', key, parts: [{ id, arrays, bounds } | null, ...] }   bounds: [minX, minY, minZ, maxX, maxY, maxZ]
//      { type: 'tile', key, parts: [], error }                  it could not be laid
// (The types of these messages are exported below for streaming.ts.)
import { createTileGrid, bucketTriangles, drapeTile } from './tiles.ts';
import { decodeHeights, gridSampler, clipToLattice } from './lattice.ts';
import { cutHoles } from './waterways.ts';
import type { Ground } from './city-geodata.js';
import type { FloatArray, HeightFn, Lattice } from './lattice.ts';
import type { FlatLayer, TileGrid } from './tiles.ts';

/** Sets the worker up: the ground's lattice (null in the flat city), lattice cells a tile side, the town's ground
 *  (GEO.ground, null in the flat city) and the channels' holes in the deck (flat triangles x0 z0 x1 z1 x2 z2, or null). */
export interface TileInitMessage {
  type: 'init';
  lattice: Lattice | null;
  cells: number;
  ground: Ground | null;
  holes: Float32Array | null;
}
/** A flat layer's share: its non-indexed attribute arrays, their item sizes, the normals' place among them (-1 none),
 *  whether a tile of it is opened over the channels, and the triangles of each tile [key, triangle numbers]. */
export interface TileLayerMessage {
  type: 'layer';
  id: number;
  arrays: Float32Array[];
  sizes: number[];
  normalAt: number;
  cutHoles: boolean;
  buckets: [key: number, tris: Uint32Array][];
}
/** A tile asked for, with the layers (ids) that have something in it. */
export interface TileRequestMessage {
  type: 'tile';
  key: number;
  layers: number[];
}
export type TileWorkerIn = TileInitMessage | TileLayerMessage | TileRequestMessage;

/** [minX, minY, minZ, maxX, maxY, maxZ] (m) */
export type Bounds6 = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];
/** A layer's part of a tile, laid: its attribute arrays in the layer's order, and their bounds. */
export interface TilePart {
  id: number;
  arrays: FloatArray[];
  bounds: Bounds6;
}
/** A tile laid (a part per layer asked for, null where it has nothing), or with `error` when it could not be. */
export interface TileWorkerOut {
  type: 'tile';
  key: number;
  parts: (TilePart | null)[];
  error?: string;
}

// What the worker uses of its global scope (a DedicatedWorkerGlobalScope: the client's lib is the DOM's, whose `self`
// is a Window)
interface WorkerScope {
  onmessage: ((ev: MessageEvent<TileWorkerIn>) => void) | null;
  postMessage(message: TileWorkerOut, transfer?: Transferable[]): void;
}
declare const self: WorkerScope;

interface WorkerLayer extends FlatLayer {
  cuts: boolean;
  buckets: Map<number, Uint32Array>;
}

let grid: TileGrid | null = null;
let lattice: Lattice | null = null;
let height: HeightFn | null = null;
let tileHoles = new Map<number, Float32Array>(); // tile key -> the holes (flat triangles) reaching into it
let cells: Lattice | null = null; // the flat city's cells the deck is cut in before its holes (a tile's lattice cells, as if it had one)
const layers = new Map<number, WorkerLayer>();

function bounds(pos: FloatArray): Bounds6 {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, y0, z0, x1, y1, z1];
}

self.onmessage = ({ data: msg }) => {
  if (msg.type === 'init') {
    lattice = msg.lattice;
    const g = (grid = createTileGrid(lattice, msg.cells));
    cells = { x0: grid.x0, z0: grid.z0, cell: grid.size / msg.cells };
    // (the town's floor as ground.ts reckons it: the grid's heights, its floor beyond it)
    height = msg.ground ? gridSampler(msg.ground, decodeHeights(msg.ground), msg.ground.floor) : () => 0;
    if (msg.holes) {
      // (as triangles at y = 0, bucketed by the tiles they reach like a layer's)
      const h = msg.holes, n = h.length / 6;
      const flat = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) for (let v = 0; v < 3; v++) {
        flat[t * 9 + v * 3] = h[t * 6 + v * 2];
        flat[t * 9 + v * 3 + 2] = h[t * 6 + v * 2 + 1];
      }
      tileHoles = new Map([...bucketTriangles(flat, null, g)].map(([key, tris]): [number, Float32Array] => {
        const out = new Float32Array(tris.length * 6);
        tris.forEach((t, k) => { out.set(h.subarray(t * 6, t * 6 + 6), k * 6); });
        return [key, out];
      }));
    }
  } else if (msg.type === 'layer') {
    const { id, arrays, sizes, normalAt, cutHoles: cuts, buckets } = msg;
    layers.set(id, { arrays, sizes, index: null, normalAt, cuts, buckets: new Map(buckets) });
  } else {
    // ('tile')
    try {
      const tileGrid = grid, tileCells = cells, tileHeight = height;
      if (!tileGrid || !tileCells || !tileHeight) throw new Error('a tile asked for before init');
      const transfer: Transferable[] = [];
      const parts = msg.layers.map((id): TilePart | null => {
        const layer = layers.get(id);
        let arrays = layer && drapeTile(layer, layer.buckets.get(msg.key), msg.key, tileGrid, lattice, tileHeight);
        if (!layer || !arrays) return null;
        // (opened over the channels after it is laid, as drape.ts & city-grid.ts do the whole deck; in the flat city,
        // cut in the lattice's cells first: holes cut out of a tile's two triangles would split them without end)
        const holes = layer.cuts ? tileHoles.get(msg.key) : undefined;
        if (holes) {
          if (!lattice) arrays = clipToLattice(arrays, layer.sizes, null, tileCells);
          arrays = cutHoles(arrays, layer.sizes, null, holes);
        }
        if (!arrays[0].length) return null;
        transfer.push(...arrays.map((a) => a.buffer));
        return { id, arrays, bounds: bounds(arrays[0]) };
      });
      self.postMessage({ type: 'tile', key: msg.key, parts }, transfer);
    } catch (e) {
      // (the tile goes without its layers rather than hold the start-up or its worker for ever)
      self.postMessage({ type: 'tile', key: msg.key, parts: [], error: String((e instanceof Error && e.stack) || e) });
    }
  }
};
