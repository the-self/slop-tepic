// server/aoi.ts
// Area of interest: a uniform grid over the world's x/z plane so each player is only sent the others near them.
// A query walks rings of cells outward from the player's own and stops as soon as the cells further out can hold no
// one nearer than the `max` found: in a crowd that is a ring or two, however many players the room holds. (It used to
// gather every cell of the view's square and sort them all: 2000 players in 3 km made each query sort ~500, and the
// tick took twice its 100 ms.)

/** A point on the x/z plane, in the same units as the grid's cellSize */
export interface PlanePoint {
  x: number;
  z: number;
}

// A cell's key: its column and row each biased into 16 bits, one integer (no strings made a query)
const BIAS = 32768;
const cellKey = (cx: number, cz: number) => (cx + BIAS) * 65536 + (cz + BIAS);

// A candidate's sort key: its squared distance (in whole squared units of the grid's metre, `unit`) above its id's
// 16 bits, so one numeric sort orders them nearest first. Grown as needed, never shrunk
let scratch = new Float64Array(1024);

class SpatialGrid {
  cellSize: number;
  cells: Map<number, Set<number>>;
  where: Map<number, number>;
  /** the units in a metre of the positions (100: centimetres), for the sort keys' squared metres */
  unit: number;
  // the query under way: who asks, from where, how far (squared), and how many candidates it has in `scratch`
  private readonly query = { self: 0, x: 0, z: 0, r2: 0, n: 0 };

  constructor(cellSize = 250, unit = 1) {
    this.cellSize = cellSize;
    this.unit = unit;
    this.cells = new Map(); // cell key → ids
    this.where = new Map(); // id → its cell key
  }

  keyAt(x: number, z: number): number {
    return cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
  }

  update(id: number, x: number, z: number): void {
    const key = this.keyAt(x, z);
    const old = this.where.get(id);
    if (old === key) return;
    if (old !== undefined) this.removeFromCell(id, old);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = new Set()));
    cell.add(id);
    this.where.set(id, key);
  }

  remove(id: number): void {
    const old = this.where.get(id);
    if (old === undefined) return;
    this.removeFromCell(id, old);
    this.where.delete(id);
  }

  removeFromCell(id: number, key: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }

  /**
   * The (at most) `max` others nearest to `self` within `radius`, nearest first, into `out` (emptied first; returned).
   * `positions`: id → { x, z }, those the grid holds.
   */
  nearest(self: number, positions: ReadonlyMap<number, PlanePoint>, radius: number, max: number, out: number[]): number[] {
    out.length = 0;
    const me = positions.get(self);
    if (!me || max <= 0) return out;
    const c = this.cellSize;
    const cx0 = Math.floor(me.x / c), cz0 = Math.floor(me.z / c);
    // (how far the player is from its own cell's nearest side: every cell of ring k + 1 is at least k·c + edge off)
    const edge = Math.min(me.x - cx0 * c, (cx0 + 1) * c - me.x, me.z - cz0 * c, (cz0 + 1) * c - me.z);
    const rings = Math.ceil(radius / c);
    const q = this.query;
    q.self = self;
    q.x = me.x;
    q.z = me.z;
    q.r2 = radius * radius;
    q.n = 0;
    for (let k = 0; k <= rings; k++) {
      if (k === 0) this.take(cx0, cz0, positions);
      else {
        for (let i = -k; i <= k; i++) {
          this.take(cx0 + i, cz0 - k, positions);
          this.take(cx0 + i, cz0 + k, positions);
        }
        for (let j = -k + 1; j <= k - 1; j++) {
          this.take(cx0 - k, cz0 + j, positions);
          this.take(cx0 + k, cz0 + j, positions);
        }
      }
      // enough found nearer than anything in the rings still out there: done
      if (q.n >= max) {
        const bound = k * c + edge;
        const b2 = Math.floor((bound * bound) / (this.unit * this.unit)) * 65536;
        let near = 0;
        for (let i = 0; i < q.n; i++) if (scratch[i] < b2) near++;
        if (near >= max) break;
      }
    }
    const found = scratch.subarray(0, q.n).sort();
    const m = Math.min(max, q.n);
    for (let i = 0; i < m; i++) out.push(found[i] % 65536);
    return out;
  }

  // The query's candidates in cell (cx, cz), keyed into `scratch`
  private take(cx: number, cz: number, positions: ReadonlyMap<number, PlanePoint>): void {
    const cell = this.cells.get(cellKey(cx, cz));
    if (!cell) return;
    const q = this.query, unit2 = this.unit * this.unit;
    for (const id of cell) {
      if (id === q.self) continue;
      const p = positions.get(id);
      if (!p) continue;
      const d2 = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      if (d2 > q.r2) continue;
      if (q.n === scratch.length) {
        const bigger = new Float64Array(q.n * 2);
        bigger.set(scratch);
        scratch = bigger;
      }
      scratch[q.n++] = Math.floor(d2 / unit2) * 65536 + id;
    }
  }
}

export { SpatialGrid };
