// js/world/embotelladora/site.ts
// Where the bottling plant's pieces stand: the frame's turn, the lot's surface under a point of the plant's frame
// (the town's slopes: the block falls ~6 m from Hamburgo to Insurgentes), a building's floor, and the building kit's
// frames (building-kit.ts) at a point of the plant, turned along a wall's run.
import { liftAt } from '../ground.ts';
import { pavedHeight } from '../car-parks.ts';
import { plantAt } from '../embotelladora-plan.ts';
import type { Frame } from '../building-kit.ts';
import type { PlantRect } from '../embotelladora-plan.ts';

// The frame's turn (rad, as three's rotation.y: its u along (cos, -sin))
const o = plantAt(0, 0), e = plantAt(1, 0);
export const PLANT_YAW = Math.atan2(-(e.z - o.z), e.x - o.x);

/** The lot's surface at (u, v) of the plant (m, world y) */
export function groundAt(u: number, v: number): number {
  const p = plantAt(u, v);
  return liftAt(p.x, p.z) + pavedHeight(p.x, p.z);
}

/** A building's floor over its rectangle: the ground's mean under its corners & middle (m, world y; its walls run on
 *  down into the ground where it is lower) */
export function floorOf([u0, u1, v0, v1]: PlantRect): number {
  const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [(u0 + u1) / 2, (v0 + v1) / 2]];
  return pts.reduce((s, [u, v]) => s + groundAt(u, v), 0) / pts.length;
}

/** A kit frame at (u, v) of the plant, at height y (world), its x turned `turn` rad from u towards v */
export function frameAt(u: number, v: number, y: number, turn = 0): Frame {
  const p = plantAt(u, v);
  return { x: p.x, y, z: p.z, yaw: PLANT_YAW - turn };
}
