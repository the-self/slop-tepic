// js/world/tile-worker.js
// The worker that lays the streamed tiles on the slopes (world/streaming.js runs a couple of them): it keeps every
// flat layer it is sent, bucketed by tile (tiles.js), and answers a tile's request with each layer's part of it cut
// out and laid on the town's floor, the arrays handed back without a copy. The main thread only puts them in meshes.
//
// in:  { type: 'init', lattice, cells, ground }                ground: GEO.ground (null in the flat city)
//      { type: 'layer', id, arrays, sizes, index, normalAt, undersides }
//      { type: 'tile', key, layers: [id, ...] }
// out: { type: 'layer', id, keys }                             the tiles it has anything in
//      { type: 'tile', key, parts: [{ id, arrays, bounds } | null, ...] }   bounds: [minX, minY, minZ, maxX, maxY, maxZ]
import { createTileGrid, bucketTriangles, drapeTile } from './tiles.js';
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
    const { id, arrays, sizes, index, normalAt, undersides } = msg;
    const buckets = bucketTriangles(arrays[0], index, grid, { undersides });
    layers.set(id, { arrays, sizes, index, normalAt, buckets });
    self.postMessage({ type: 'layer', id, keys: [...buckets.keys()] });
  } else if (msg.type === 'tile') {
    const transfer = [];
    const parts = msg.layers.map((id) => {
      const layer = layers.get(id);
      const arrays = layer && drapeTile(layer, layer.buckets.get(msg.key), msg.key, grid, lattice, height);
      if (!arrays) return null;
      transfer.push(...arrays.map((a) => a.buffer));
      return { id, arrays, bounds: bounds(arrays[0]) };
    });
    self.postMessage({ type: 'tile', key: msg.key, parts }, transfer);
  }
};
