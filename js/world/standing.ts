// js/world/standing.ts
// What stands on the town's slopes: a vehicle's tilt over the ground under it (the coaches in the Central's bays, the
// tráilers at the docks, the bottling plant's fleet, the cars parked in the lots), and the turned box that stops the
// player over anything set at a heading (a vehicle, a wall's piece, a building of a turned frame). No three.js.
import { liftAt } from './ground.ts';
import type { Collider } from './buildings.ts';

/** A tilt over the ground (rad): the nose up the slope ahead (pitch, about its local x) and its right side up (roll) */
export interface SlopeTilt {
  pitch: number;
  roll: number;
}

/**
 * The tilt of something facing `heading` (rad, atan2 of its nose's x over its z) at (x, z): the ground's rise from
 * `reach` m behind to `reach` m ahead, and from `side` m on its left to `side` m on its right (m)
 */
export function slopeTilt(x: number, z: number, heading: number, reach: number, side = 1): SlopeTilt {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const ahead = (liftAt(x + fx * reach, z + fz * reach) - liftAt(x - fx * reach, z - fz * reach)) / (2 * reach);
  const right = (liftAt(x + fz * side, z - fx * side) - liftAt(x - fz * side, z + fx * side)) / (2 * side);
  return { pitch: -Math.atan(ahead), roll: Math.atan(right) };
}

/**
 * What stops the player over a box turned `yaw` (rad, as three's rotation.y: its local x along (cos, -sin)) about its
 * middle (cx, cz): half sizes hx along its local x and hz along its local z (m), from y0 to y1 (m, world)
 */
export function turnedBox(cx: number, cz: number, hx: number, hz: number, yaw: number, y0: number, y1: number): Collider {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: y0, maxY: y1, obb: { cx, cz, hx, hz, cs, sn } };
}
