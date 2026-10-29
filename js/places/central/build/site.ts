// js/places/central/build/site.ts
// What the Central de Autobuses' pieces share (index.ts makes it): the terminal's frame turned into place on its
// hall's floor, the ground under the frame, what stops the player, and the lines that leave from it
import type * as THREE from 'three/webgpu';
import type { Collider } from '../../../world/buildings.ts';
import type { CoachRoad } from '../plan-runs.ts';

/** A line that leaves from the Central: its name as the game letters it (parodies, as the stores'), its livery: the
 *  body and the two swooshes (0xrrggbb), the name's ink & edge (CSS); the highway it takes out of town */
export type CoachLine = [name: string, body: number, stripe: number, stripe2: number, ink: string, edge: string, road: CoachRoad];

export const LINES: CoachLine[] = [
  ['ETM TURISTAR', 0x2c2b30, 0xc9a227, 0x8c6d1f, '#d8b24a', '#1a1a1d', 'guadalajara'],
  ['PRIMERA PLUZ', 0xf2f2f0, 0x4b2a85, 0x1e88d0, '#4b2a85', '#ffffff', 'guadalajara'],
  ['ESTRELLA BLANKA', 0xf4f4f2, 0xc8102e, 0x1d3f8f, '#c8102e', '#ffffff', 'guadalajara'],
  ['TAB DEL PACÍFICO', 0xf0f1ee, 0x003d7d, 0xf28c00, '#003d7d', '#ffffff', 'mazatlan'],
  ['FUTURRA', 0xeeeeec, 0x0055a5, 0xf6c400, '#0055a5', '#ffffff', 'guadalajara'],
  ['NORTE DE ZONORA', 0xf3f3f1, 0xd52b1e, 0xf39200, '#d52b1e', '#ffffff', 'mazatlan'],
  ['ÉLIT', 0xd9dbde, 0xb3121b, 0x55575b, '#b3121b', '#ffffff', 'mazatlan'],
  ['TUFEZA', 0xf2f2f0, 0x003a70, 0xe5711d, '#003a70', '#ffffff', 'mazatlan'],
  // (Tepic's own, pink: the photos' coach at the gate)
  ['NAYAAR', 0xe0435e, 0xf7f2f0, 0xf2b400, '#ffffff', '#b8243f', 'miramar']
];

/** The terminal's frame in the world and what its pieces add to it */
export interface CentralSite {
  /** the terminal's frame: x = u, z = v (plan.ts), y over the hall's floor (m) */
  hall: THREE.Group;
  /** the hall's floor (m, world) */
  floorY: number;
  /** the ground at (u, v) over the hall's floor (m: below it, < 0) */
  ground: (u: number, v: number) => number;
  /** an oriented box of the frame (u0..u1 × v0..v1, from y0 to y1 over the floor) that stops the player */
  collide: (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number) => Collider;
  colliders: Collider[];
}
