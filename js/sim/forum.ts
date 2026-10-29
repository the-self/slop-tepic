// js/sim/forum.ts
// What lives in Forum Tepic (world/forum.ts builds it): its shoppers walking both floors (forum/shoppers.ts, thrown
// down by the player's vehicle as on the street), the glass a car or a moto breaks through (forum/glass.ts), and the
// escalators' steps carrying whoever stands on them. Stepped every frame with the city's life (app/frame-loop.ts).
import { ESCALATOR_SPEED, FORUM, LEVEL } from '../world/forum-plan.ts';
import { forumFloor } from '../world/forum.ts';
import { Shoppers } from './forum/shoppers.ts';
import { ForumGlass } from './forum/glass.ts';
import type * as THREE from 'three/webgpu';
import type { Forum } from '../world/forum.ts';
import type { Hitter } from './forum/shoppers.ts';
import type { PlayerEntity, PlayerMode } from '../player/controllers/types.ts';

const KNOCK_SPEED = 2.2; // m/s: the player's vehicle knocks people over above it (as sim/traffic's)

// Someone on foot standing on an escalator's steps is carried along it, up from its foot or down to it
function ride(at: { x: number; y: number; z: number }, dt: number): void {
  for (const e of FORUM.escalators) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L;
    const s = (at.x - e.ax) * dx + (at.z - e.az) * dz, across = (at.x - e.ax) * -dz + (at.z - e.az) * dx;
    if (s < 0.3 || s > L - 0.3 || Math.abs(across) > e.width / 2 - 0.1) continue;
    // (on its steps: at their height there, not under them)
    const h = s <= 1.2 ? 0 : s >= L - 1.2 ? LEVEL : (LEVEL * (s - 1.2)) / (L - 2.4);
    if (Math.abs(at.y - forumFloor(at.x, at.z) - h) > 0.5) continue;
    const v = ESCALATOR_SPEED * dt * (e.up ? 1 : -1);
    at.x += dx * v;
    at.z += dz * v;
    return;
  }
}

export class ForumLife {
  forum: Forum;
  shoppers: Shoppers;
  glass: ForumGlass;
  /** the player's vehicle as it may run into people & glass: one object, refilled each frame */
  private readonly hit: Hitter = { x: 0, z: 0, heading: 0, halfW: 0, halfL: 0, speed: 0, back: false, knocks: false };

  constructor(scene: THREE.Object3D, forum: Forum) {
    this.forum = forum;
    this.shoppers = new Shoppers(scene, forumFloor);
    this.glass = new ForumGlass(forum.outside, forum.mats, forum.colliders, forumFloor);
  }

  /** The inside shown near the camera, the shoppers walking; the player's vehicle knocking them down & breaking the
   *  glass, the player on foot carried by an escalator */
  update(dt: number, camera: THREE.Camera, player: PlayerEntity, mode: PlayerMode): void {
    const near = this.forum.showInside(camera), hit = this.hit, at = player.position;
    const driving = near && (mode === 'car' || mode === 'moto' || mode === 'cyclist');
    if (driving) {
      hit.speed = Math.hypot(Math.sin(player.heading) * player.speed + (player.vx ?? 0), Math.cos(player.heading) * player.speed + (player.vz ?? 0));
      hit.x = at.x;
      hit.z = at.z;
      hit.heading = player.heading;
      hit.halfW = 'halfW' in player ? player.halfW : 0.35;
      hit.halfL = 'halfL' in player ? player.halfL : 0.85;
      hit.back = player.speed < 0;
      hit.knocks = hit.speed > KNOCK_SPEED && at.y - forumFloor(at.x, at.z) < 2.6;
    }
    this.shoppers.update(dt, camera, driving ? hit : null);
    this.glass.update(dt, driving && mode !== 'cyclist' ? hit : null, player, camera);
    if (near && mode === 'person') ride(at, dt);
  }
}
