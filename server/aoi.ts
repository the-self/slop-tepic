// server/aoi.ts
// Area of interest: a uniform grid over the world's x/z plane so each player is only sent the others near them.
// A query touches the cells overlapping a square around the point and then filters by true distance.

/** A point on the x/z plane, in the same units as the grid's cellSize */
export interface PlanePoint {
  x: number;
  z: number;
}

class SpatialGrid {
  cellSize: number;
  cells: Map<string, Set<number>>;
  where: Map<number, string>;

  constructor(cellSize = 250) {
    this.cellSize = cellSize;
    this.cells = new Map(); // "cx,cz" → Set of ids
    this.where = new Map(); // id → its cell key
  }

  keyAt(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
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

  removeFromCell(id: number, key: string): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }

  // Ids in every cell overlapping the square of half-size radius around (x, z): a superset of those within radius
  candidates(x: number, z: number, radius: number, out: number[] = []): number[] {
    const c = this.cellSize;
    const x0 = Math.floor((x - radius) / c);
    const x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c);
    const z1 = Math.floor((z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(`${cx},${cz}`);
        if (cell) for (const id of cell) out.push(id);
      }
    }
    return out;
  }
}

// The (at most) max players nearest to self within radius, nearest first. positions: id → { x, z }
function nearestInView(grid: SpatialGrid, positions: ReadonlyMap<number, PlanePoint>, selfId: number, radius: number, max: number): number[] {
  const self = positions.get(selfId);
  if (!self) return [];
  const r2 = radius * radius;
  const found: { id: number; d2: number }[] = [];
  for (const id of grid.candidates(self.x, self.z, radius)) {
    if (id === selfId) continue;
    const p = positions.get(id);
    if (!p) continue;
    const d2 = (p.x - self.x) ** 2 + (p.z - self.z) ** 2;
    if (d2 <= r2) found.push({ id, d2 });
  }
  found.sort((a, b) => a.d2 - b.d2);
  if (found.length > max) found.length = max;
  return found.map((f) => f.id);
}

export { SpatialGrid, nearestInView };
