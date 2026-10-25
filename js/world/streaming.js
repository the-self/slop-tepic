import * as THREE from 'three/webgpu';
import { TILE_CELLS, createTileGrid, bucketTriangles, tilesAround } from './tiles.js';

// js/world/streaming.js
// Streams the city's heaviest layers tile by tile around the camera, the way GTA streams its map: the flat ground
// layers (the road deck, sidewalks & curbs, lots, paint, empedrado: built at y = 0 in world space) are handed over
// once with addLayer(); from then on only the tiles within DETAIL_RADIUS of the camera, and of where it is heading
// LOOKAHEAD seconds on, are laid on the slopes and drawn, and those left behind are dropped. Laying a tile (cutting it
// out and onto the ground's lattice) is the costly part: Web Workers do it (tile-worker.js), each for its share of the
// tiles, and the main thread only puts what they send back in the scene, a few milliseconds' worth a frame. Where the
// tiles of a layer that covers the ground (the road deck) are not drawn, the hills' mesh draws a plain floor
// (terrain.js, through `mask`), so nothing is ever a hole.

const DETAIL_RADIUS = 1100; // m around the camera at street level...
const ALTITUDE_RADIUS = 1.0; // ...and this much more per metre it is over the ground (to DETAIL_RADIUS * 2)
const DROP_MARGIN = 350; // m further out a tile is dropped (none loads and drops again at the edge)
const LOOKAHEAD = 4; // s along the camera's velocity the tiles ahead are asked for
const MAX_SPEED = 120; // m/s of velocity taken for the lookahead (faster is a teleport, not a trip)
const MAX_IN_FLIGHT = 2; // tiles a worker is laying at once
const SHOW_BUDGET = 3; // ms a frame of putting arrived tiles in the scene
const PLAN_EVERY = 0.2; // s between the plans of what to load & drop

/**
 * The tiles' state for the hills' floor (terrain.js): a texel per tile, 1 where a layer covering the ground is drawn.
 * Covers the tiles of the rectangle { x0, x1, z0, z1 } (the detailed city's box), `origin` & `span` placing it in the
 * world.
 */
function createTileMask(grid, box) {
  const i0 = Math.floor((box.x0 - grid.x0) / grid.size), i1 = Math.floor((box.x1 - grid.x0) / grid.size);
  const j0 = Math.floor((box.z0 - grid.z0) / grid.size), j1 = Math.floor((box.z1 - grid.z0) / grid.size);
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const data = new Uint8Array(w * h * 4);
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    texture,
    // world (x, z) to the texture's uv: (x - origin) / span
    origin: new THREE.Vector2(grid.x0 + i0 * grid.size, grid.z0 + j0 * grid.size),
    span: new THREE.Vector2(w * grid.size, h * grid.size),
    set(key, on) {
      const i = grid.i(key) - i0, j = grid.j(key) - j0;
      if (i < 0 || j < 0 || i >= w || j >= h) return;
      data[(j * w + i) * 4] = on ? 255 : 0;
      texture.needsUpdate = true;
    }
  };
}

class TileStreamer {
  /**
   * `lattice`: the ground's (ground.js LATTICE, null in the flat city); `ground`: GEO.ground on the slopes (else null);
   * `box`: the rectangle the hills' floor is masked over.
   */
  constructor({ scene, lattice, ground, box = null, workers = 2 }) {
    this.grid = createTileGrid(lattice, TILE_CELLS);
    this.root = new THREE.Group();
    this.root.name = 'StreamedTiles';
    this.root.matrixAutoUpdate = false; // (the tiles are in world space)
    scene.add(this.root);
    this.mask = box ? createTileMask(this.grid, box) : null;
    this.layers = [];
    this.candidates = new Set(); // tiles any layer has something in
    // key -> { key, state: 'loading' | 'arrived' | 'shown' | 'failed', group, parts, d, covered }
    this.tiles = new Map();
    this.arrived = []; // tiles back from the workers, waiting their turn to be shown
    this.focus = { x: 0, z: 0, vx: 0, vz: 0, dt: 0, radius: DETAIL_RADIUS, primed: false };
    this.sincePlan = Infinity;
    this.workers = [];
    for (let n = 0; n < workers; n++) {
      const worker = new Worker(new URL('./tile-worker.js', import.meta.url), { type: 'module' });
      const slot = { worker, busy: 0 };
      worker.onmessage = ({ data }) => this.receive(slot, data);
      worker.onerror = (e) => console.error('[streaming] tile worker', e.message || e);
      worker.postMessage({ type: 'init', lattice, cells: TILE_CELLS, ground });
      this.workers.push(slot);
    }
  }

  /**
   * Hands a flat layer to the workers: `geometry` in world space (indexed or not; it is disposed), drawn with
   * `material` in every tile it reaches. Its triangles are bucketed by tile here, and each worker is sent only those
   * of the tiles it answers for (a tile's key, modulo the workers), so the layer is held once however many there are.
   * Options: name, castShadow, receiveShadow, renderOrder; undersides (false leaves out the triangles facing down);
   * covers (it covers all the ground of the tiles it reaches, like the road deck: where its tiles are drawn, the hills'
   * floor under them is not).
   */
  addLayer(geometry, material, { name = '', castShadow = false, receiveShadow = true, undersides = true, renderOrder = 0, covers = false } = {}) {
    const names = Object.keys(geometry.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
    const attrs = names.map((n) => geometry.attributes[n]);
    const arrays = attrs.map((a) => (a.isInterleavedBufferAttribute
      ? Float32Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize))
      : a.array));
    const sizes = attrs.map((a) => a.itemSize);
    const index = geometry.index ? geometry.index.array : null;
    const buckets = bucketTriangles(arrays[0], index, this.grid, { undersides });
    const id = this.layers.length;
    this.layers.push({
      id, name, material, castShadow, receiveShadow, renderOrder, covers, names, sizes,
      normalized: attrs.map((a) => a.normalized), keys: new Set(buckets.keys())
    });
    for (const key of buckets.keys()) this.candidates.add(key);
    const N = this.workers.length;
    this.workers.forEach((slot, n) => {
      // this worker's tiles' triangles, each once, renumbered in the order they are copied out
      const local = new Map();
      const share = [];
      for (const [key, tris] of buckets) {
        if (key % N !== n) continue;
        share.push([key, Uint32Array.from(tris, (t) => {
          let k = local.get(t);
          if (k === undefined) local.set(t, (k = local.size));
          return k;
        })]);
      }
      const out = sizes.map((size) => new Float32Array(local.size * 3 * size));
      for (const [t, k] of local) {
        for (let c = 0; c < 3; c++) {
          const v = index ? index[t * 3 + c] : t * 3 + c;
          for (let a = 0; a < arrays.length; a++) {
            const size = sizes[a];
            out[a].set(arrays[a].subarray(v * size, v * size + size), (k * 3 + c) * size);
          }
        }
      }
      slot.worker.postMessage({ type: 'layer', id, arrays: out, sizes, normalAt: names.indexOf('normal'), buckets: share },
        [...out.map((a) => a.buffer), ...share.map(([, tris]) => tris.buffer)]);
    });
    geometry.dispose();
    // (tiles in hand were asked for without it: they come again with it)
    for (const tile of [...this.tiles.values()]) this.drop(tile);
    return id;
  }

  /**
   * Loads and shows every tile within the radius of (x, z) before the game starts (the first frame must not open on
   * holes): a promise, resolved once none is still being laid
   */
  async preload(x, z) {
    this.place(x, z, 0, true);
    this.plan();
    while ([...this.tiles.values()].some((t) => t.state === 'loading' || t.state === 'arrived')) {
      await new Promise((resolve) => setTimeout(resolve, 16));
      this.plan();
      this.showArrived(Infinity);
    }
  }

  // Where the camera is, its velocity (smoothed, for the lookahead) and the radius its height over the ground asks for
  place(x, z, altitude, reset = false) {
    const f = this.focus;
    if (reset || !f.primed) {
      Object.assign(f, { x, z, vx: 0, vz: 0, primed: true });
    } else if (f.dt > 0) {
      let vx = (x - f.x) / f.dt, vz = (z - f.z) / f.dt;
      if (Math.hypot(vx, vz) > MAX_SPEED) vx = vz = 0; // (a teleport)
      const k = Math.min(1, f.dt * 2);
      f.vx += (vx - f.vx) * k;
      f.vz += (vz - f.vz) * k;
      f.x = x;
      f.z = z;
    }
    f.radius = DETAIL_RADIUS + Math.min(DETAIL_RADIUS, Math.max(0, altitude) * ALTITUDE_RADIUS);
  }

  /**
   * Per frame: `position` where the tiles should be laid round (the camera's, or the street outside a room the player
   * is in), `altitude` its height over the ground there, `dt` the frame's seconds. Plans what to load and drop now and
   * then, and shows what the workers sent back within the frame's budget.
   */
  update(position, altitude, dt) {
    this.focus.dt = dt;
    this.place(position.x, position.z, altitude);
    this.sincePlan += dt;
    if (this.sincePlan >= PLAN_EVERY) {
      this.sincePlan = 0;
      this.plan();
    }
    if (this.arrived.length) this.showArrived(SHOW_BUDGET);
  }

  // Ask the workers for the wanted tiles not in hand, nearest first; drop the ones left behind
  plan() {
    const { x, z, vx, vz, radius } = this.focus;
    const ax = x + vx * LOOKAHEAD, az = z + vz * LOOKAHEAD;
    const wanted = tilesAround(this.grid, this.candidates, radius, x, z, ax, az);
    const keep = new Set(tilesAround(this.grid, this.candidates, radius + DROP_MARGIN, x, z, ax, az).map((t) => t.key));
    for (const tile of [...this.tiles.values()]) if (!keep.has(tile.key)) this.drop(tile);
    for (const { key, d } of wanted) {
      const tile = this.tiles.get(key);
      if (tile) {
        tile.d = d;
        continue;
      }
      const slot = this.workers[key % this.workers.length]; // (the one holding its triangles)
      if (slot.busy >= MAX_IN_FLIGHT) continue;
      slot.busy++;
      this.tiles.set(key, { key, state: 'loading', group: null, parts: null, d, covered: false });
      slot.worker.postMessage({ type: 'tile', key, layers: this.layers.filter((l) => l.keys.has(key)).map((l) => l.id) });
    }
  }

  receive(slot, msg) {
    if (msg.type !== 'tile') return;
    slot.busy--;
    const tile = this.tiles.get(msg.key);
    if (!tile || tile.state !== 'loading') return; // (dropped meanwhile)
    if (msg.error) {
      // (not asked again while it stays in range: it would fail again)
      console.error(`[streaming] tile ${this.grid.i(msg.key)},${this.grid.j(msg.key)} could not be laid:`, msg.error);
      tile.state = 'failed';
      return;
    }
    tile.state = 'arrived';
    tile.parts = msg.parts;
    this.arrived.push(tile);
  }

  // Puts the arrived tiles in the scene, nearest first, for up to `budget` ms
  showArrived(budget) {
    const start = performance.now();
    this.arrived.sort((a, b) => a.d - b.d);
    while (this.arrived.length && performance.now() - start < budget) {
      const tile = this.arrived.shift();
      if (this.tiles.get(tile.key) !== tile) continue;
      const group = new THREE.Group();
      group.name = `Tile ${this.grid.i(tile.key)},${this.grid.j(tile.key)}`;
      group.matrixAutoUpdate = false;
      for (const part of tile.parts) {
        if (!part) continue;
        const layer = this.layers[part.id];
        group.add(this.layerMesh(layer, part.arrays, part.bounds));
        tile.covered ||= layer.covers;
      }
      tile.parts = null;
      tile.group = group;
      this.root.add(group);
      tile.state = 'shown';
      if (tile.covered) this.mask?.set(tile.key, true);
    }
  }

  // A layer's mesh over arrays (its attributes in the layer's order) whose bounds are known
  layerMesh(layer, arrays, [x0, y0, z0, x1, y1, z1]) {
    const geometry = new THREE.BufferGeometry();
    layer.names.forEach((n, k) => geometry.setAttribute(n, new THREE.BufferAttribute(arrays[k], layer.sizes[k], layer.normalized[k])));
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.userData.keepArrays = true; // (dropped with its tile: scene-culling.js leaves it alone)
    const mesh = new THREE.Mesh(geometry, layer.material);
    mesh.name = layer.name;
    mesh.castShadow = layer.castShadow;
    mesh.receiveShadow = layer.receiveShadow;
    mesh.renderOrder = layer.renderOrder;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /**
   * A mesh per layer for the start-up's shader warm-up (main.js), so no layer's pipelines are first built in play when
   * its first tile comes in: one triangle of no size each, under the city, every attribute in place
   */
  warmupMeshes() {
    return this.layers.map((layer) => {
      const arrays = layer.sizes.map((size) => new Float32Array(3 * size));
      for (let v = 0; v < 3; v++) arrays[0][v * 3 + 1] = -1000;
      const mesh = this.layerMesh(layer, arrays, [0, -1000, 0, 0, -1000, 0]);
      mesh.frustumCulled = false;
      return mesh;
    });
  }

  drop(tile) {
    this.tiles.delete(tile.key);
    if (tile.group) {
      this.root.remove(tile.group);
      this.disposeGroup(tile.group);
      if (tile.covered) this.mask?.set(tile.key, false);
    }
    tile.state = 'dropped';
  }

  disposeGroup(group) {
    for (const mesh of group.children) mesh.geometry.dispose();
  }

  /** How many tiles are loading, waiting and drawn */
  get stats() {
    let loading = 0, shown = 0;
    for (const t of this.tiles.values()) {
      if (t.state === 'shown') shown++;
      else if (t.state !== 'failed') loading++;
    }
    return { loading, shown, layers: this.layers.length };
  }
}

export { TileStreamer, createTileMask, DETAIL_RADIUS };
