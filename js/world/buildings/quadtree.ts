// js/world/buildings/quadtree.ts
// The spatial index the blocks of buildings are streamed from (js/world/buildings.ts): a 2D quadtree over their
// centres, queried for the blocks within a radius of the camera.

/**
 * Spatial 2D quadtree for range queries around the active player/camera position.
 */
class Quadtree<T extends { cx: number; cz: number }> {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  capacity: number;
  maxDepth: number;
  depth: number;
  items: T[];
  divided: boolean;
  nw: Quadtree<T> | null;
  ne: Quadtree<T> | null;
  sw: Quadtree<T> | null;
  se: Quadtree<T> | null;

  constructor(bounds: Quadtree<T>['bounds'], capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x: number, z: number) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx: number, cz: number, radius: number) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new Quadtree<T>({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new Quadtree<T>({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new Quadtree<T>({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new Quadtree<T>({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item: T): boolean {
    if (this.nw?.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne?.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw?.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se?.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item: T): boolean {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx: number, cz: number, radius: number, found: T[] = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (const item of this.items) {
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw?.queryRange(cx, cz, radius, found);
    this.ne?.queryRange(cx, cz, radius, found);
    this.sw?.queryRange(cx, cz, radius, found);
    this.se?.queryRange(cx, cz, radius, found);
    return found;
  }
}

export { Quadtree };
