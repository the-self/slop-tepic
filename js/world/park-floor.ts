// js/world/park-floor.ts
// The parks' raised floor (city-grid.ts section 7 draws it, player/controllers/ground.ts stands the walker on it): a
// park block's curb island paved like a park walk, with a granite-coped lawn bed inset from it, both over the town's
// floor. Kept in one place so what is drawn and what is walked on can't drift apart (they had: the player walked at
// street level through every park, sunk to the shins in its walks). No three.js here, so node --test imports it.
import { insidePoly } from './rings.ts';
import type { CityBlock, PointXZ } from './city-config.ts';

/** m over the town's floor: the hex-paver walks (the sidewalks' tops are at 0.22) */
export const PARK_WALK_Y = 0.26;
/** m over the town's floor: the lawn's top inside the granite bed copings */
export const PARK_BED_Y = 0.41;

/** A park block drawn raised (city-grid.ts section 7): parkland, neither a camellón nor the open country, over 250 m² */
export function isRaisedPark(b: CityBlock): boolean {
  return b.park > 0.6 && !b.median && !b.rural && b.area > 250;
}

/**
 * A simple polygon ([{x, z}], either winding, convex or not) offset inward by d with mitred corners (miters clamped
 * to 3d); null if it collapses
 */
export function offsetPolygonInward(pts: readonly PointXZ[], d: number): PointXZ[] | null {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? 1 : -1; // positive area: the inside lies left of each edge, i.e. along (-dz, dx)
  const out: PointXZ[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z;
    let bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9;
    const lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s; // inward normals of the two edges
    const n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * d, z: q.z + n1z * d }); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z; // miter length = d / cos(half angle)
    const len = Math.min(3 * d, d / Math.max(1e-3, cos));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a2 += out[j].x * out[i].z - out[i].x * out[j].z;
  return a2 * area > 0 && Math.abs(a2) < Math.abs(area) ? out : null;
}

const beds = new WeakMap<CityBlock, PointXZ[] | null>();

/** A raised park's lawn bed: its outline inset by a fifth of its narrower side, at most 5 m (null: too small for one) */
export function parkBed(b: CityBlock): PointXZ[] | null {
  let bed = beds.get(b);
  if (bed === undefined) {
    bed = offsetPolygonInward(b.poly, Math.min(5, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * 0.2));
    beds.set(b, bed);
  }
  return bed;
}

/** m over the town's floor where a walker stands at (x, z) in the raised park b: its lawn bed, or its walk */
export function parkFloorAt(b: CityBlock, x: number, z: number): number {
  const bed = parkBed(b);
  return bed && insidePoly(bed, x, z) ? PARK_BED_Y : PARK_WALK_Y;
}
