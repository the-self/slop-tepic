// js/world/forum/plan-geometry.ts
// The geometry Forum Tepic's plan (forum-plan.ts) is laid out with: degrees to the world, the frames' (u, v), rings,
// boxes along segments, and which runs of the buildings' edges show outside. No three.js here.
import { geoToWorld } from '../geo.ts';
import type { ForumBox, ForumBuilding, ForumEntrance, Frame, Vec2 } from './plan-types.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------------
export const toWorld = (ring: Vec2[]): Vec2[] => ring.map(([lat, lon]) => geoToWorld(lat, lon));

/** (u, v) in frame f → world (x, z) */
export function at(f: Frame, u: number, v: number): Vec2 {
  return [f.ox + f.ux * u + f.vx * v, f.oz + f.uz * u + f.vz * v];
}
export function frameFrom(o: Vec2, dir: Vec2): Frame {
  const L = Math.hypot(dir[0], dir[1]);
  const ux = dir[0] / L, uz = dir[1] / L;
  return { ox: o[0], oz: o[1], ux, uz, vx: -uz, vz: ux };
}
/** A frame's turn as three's yaw: its u axis is the box's local x */
export const frameYaw = (f: Pick<Frame, 'ux' | 'uz'>): number => Math.atan2(-f.uz, f.ux);

// point in a ring (even-odd)
export function inRing(ring: readonly Vec2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// distance from a point to a ring's outline
export function ringDistance(ring: readonly Vec2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// A rect in frame f as a ring: [u0, u1] x [v0, v1]
export const rectRing = (f: Frame, u0: number, u1: number, v0: number, v1: number): Vec2[] =>
  [at(f, u0, v0), at(f, u1, v0), at(f, u1, v1), at(f, u0, v1)];
// A thin box along the segment a → b (world), `thick` m across it, y0..y1
export function segmentBox(ax: number, az: number, bx: number, bz: number, thick: number, y0: number, y1: number): ForumBox {
  const L = Math.hypot(bx - ax, bz - az) || 1, th = Math.atan2(-(bz - az) / L, (bx - ax) / L);
  return { cx: (ax + bx) / 2, cz: (az + bz) / 2, hu: L / 2, hv: thick / 2, cs: Math.cos(th), sn: Math.sin(th), y0, y1 };
}

/**
 * The runs of building b's edge i0 → i1 that show outside: [ax, az, bx, bz, low] (world m), its wall seen from `low` m
 * (over the floor) up: 0 where nothing stands against it (but across an entrance's doorway), the height of another of
 * the complex's buildings against it where b stands taller (a wall between two is inside the mall)
 */
export function outerRuns(b: ForumBuilding, i0: number, i1: number, all: readonly ForumBuilding[], entrances: readonly ForumEntrance[]): [number, number, number, number, number][] {
  const [ax, az] = b.ring[i0], [bx, bz] = b.ring[i1];
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.05) return [];
  const dx = (bx - ax) / L, dz = (bz - az) / L;
  // (outward: the side away from the building's inside)
  let nx = dz, nz = -dx;
  if (inRing(b.ring, (ax + bx) / 2 + nx * 0.3, (az + bz) / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
  const runs: [number, number, number, number, number][] = [];
  const STEP = 0.5;
  let start = -1, low = 0;
  const n = Math.max(1, Math.ceil(L / STEP));
  for (let k = 0; k <= n; k++) {
    const t = Math.min(L, k * STEP + STEP / 2), x = ax + dx * t, z = az + dz * t;
    const ox = x + nx * 0.6, oz = z + nz * 0.6;
    const against = all.reduce((h, o) => (o !== b && inRing(o.ring, ox, oz) ? Math.max(h, o.height) : h), 0);
    const door = against === 0 && entrances.some((e) => {
      const ex = e.bx - e.ax, ez = e.bz - e.az, EL = Math.hypot(ex, ez), s = ((x - e.ax) * ex + (z - e.az) * ez) / EL;
      return s > 0 && s < EL && Math.abs(((x - e.ax) * ez - (z - e.az) * ex) / EL) < 1.2;
    });
    const wall = k < n && against < b.height - 0.3 && !door;
    // (a run ends where it stops showing or what stands against it changes)
    if ((!wall || k === n || against !== low) && start >= 0) {
      const end = Math.min(L, k * STEP);
      if (end - start > 0.3) runs.push([ax + dx * start, az + dz * start, ax + dx * end, az + dz * end, low]);
      start = -1;
    }
    if (wall && start < 0) { start = k * STEP; low = against; }
  }
  return runs;
}
