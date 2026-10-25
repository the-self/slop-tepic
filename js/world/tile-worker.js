// js/world/tile-worker.js
// The worker that lays the streamed tiles on the slopes (world/streaming.js runs a couple of them): it keeps its share
// of every flat layer (the triangles of the tiles it answers for, bucketed by the main thread), and answers a tile's
// request with each layer's part of it cut out and laid on the town's floor, the arrays handed back without a copy.
// The main thread only puts them in meshes.
//
// in:  { type: 'init', lattice, cells, ground }                ground: GEO.ground (null in the flat city)
//      { type: 'layer', id, arrays, sizes, normalAt, buckets }  arrays non-indexed; buckets [[tile key, triangles]]
//      { type: 'tile', key, layers: [id, ...] }
// out: { type: 'tile', key, parts: [{ id, arrays, bounds } | null, ...] }   bounds: [minX, minY, minZ, maxX, maxY, maxZ]
//      { type: 'tile', key, parts: [], error }                  it could not be laid
import { createTileGrid, drapeTile } from './tiles.js';
import { decodeHeights, gridSampler } from './lattice.js';

let grid = null;
let lattice = null;
let height = null;
const layers = new Map();

function bounds(pos) {
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
    grid = createTileGrid(lattice, msg.cells);
    // (the town's floor as ground.js reckons it: the grid's heights, its floor beyond it)
    height = msg.ground ? gridSampler(msg.ground, decodeHeights(msg.ground), msg.ground.floor) : () => 0;
  } else if (msg.type === 'layer') {
    const { id, arrays, sizes, normalAt, buckets } = msg;
    layers.set(id, { arrays, sizes, index: null, normalAt, buckets: new Map(buckets) });
  } else if (msg.type === 'tile') {
    try {
      const transfer = [];
      const parts = msg.layers.map((id) => {
        const layer = layers.get(id);
        const arrays = layer && drapeTile(layer, layer.buckets.get(msg.key), msg.key, grid, lattice, height);
        if (!arrays) return null;
        transfer.push(...arrays.map((a) => a.buffer));
        return { id, arrays, bounds: bounds(arrays[0]) };
      });
      self.postMessage({ type: 'tile', key: msg.key, parts }, transfer);
    } catch (e) {
      // (the tile goes without its layers rather than hold the start-up or its worker for ever)
      self.postMessage({ type: 'tile', key: msg.key, parts: [], error: String(e && e.stack || e) });
    }
  }
};
