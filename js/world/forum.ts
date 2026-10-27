// js/world/forum.ts
// Forum Tepic, the mall on the Boulevard Colosio (forum-plan.ts says where everything stands): its buildings from
// outside (forum/exterior.ts) and inside (forum/interior.ts), walked into through its glass doors, its upper floor
// climbed by the escalators (decks for those on foot: ground.ts addFootDecks; their steps carry you), the shoppers in
// it (forum/shoppers.ts: knocked down by a car), the glass a car breaks through (forum/glass.ts).
// The generic houses, yard trees & bardas keep off its lots (FORUM_RESERVE); its car park is the city data's
// (tools/build-tepic-geodata.mjs KNOWN_PARKING). The inside is hidden while the camera is far.
import * as THREE from 'three/webgpu';
import { ESCALATOR_SPEED, FLOOR, FORUM, LEVEL } from './forum-plan.ts';
import { addFootDecks, townHeight } from './ground.ts';
import { createForumMaterials } from './forum/materials.ts';
import { createMuralTexture, createSignAtlas } from './forum/signs.ts';
import { buildExterior } from './forum/exterior.ts';
import { buildInterior } from './forum/interior.ts';
import { Shoppers } from './forum/shoppers.ts';
import { ForumGlass } from './forum/glass.ts';
import type { Hitter } from './forum/shoppers.ts';
import type { PlayerEntity, PlayerMode } from '../player/controllers/types.ts';
import type { Collider } from './buildings.ts';
import type { RainRoof } from '../render/rain.ts';

const INSIDE_NEAR = 420; // m from the rotunda: the inside is drawn nearer than this
const KNOCK_SPEED = 2.2; // m/s: the player's vehicle knocks people over above it (as sim/traffic's)

// Someone on foot standing on an escalator's steps is carried along it, up from its foot or down to it
function ride(at: { x: number; y: number; z: number }, dt: number): void {
  for (const e of FORUM.escalators) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L;
    const s = (at.x - e.ax) * dx + (at.z - e.az) * dz, across = (at.x - e.ax) * -dz + (at.z - e.az) * dx;
    if (s < 0.3 || s > L - 0.3 || Math.abs(across) > e.width / 2 - 0.1) continue;
    // (on its steps: at their height there, not under them)
    const h = s <= 1.2 ? 0 : s >= L - 1.2 ? LEVEL : (LEVEL * (s - 1.2)) / (L - 2.4);
    if (Math.abs(at.y - base(at.x, at.z) - h) > 0.5) continue;
    const v = ESCALATOR_SPEED * dt * (e.up ? 1 : -1);
    at.x += dx * v;
    at.z += dz * v;
    return;
  }
}

/** The mall's floor under (x, z) (m): the town's floor and the step up of a block's sidewalk */
const base = (x: number, z: number) => townHeight(x, z) + FLOOR;

export function buildForum(scene: THREE.Object3D) {
  const P = FORUM;
  const names = new Set<string>(['FORUM', 'LIVERPUL', 'SEARS', 'CINEMEX', 'SUBURBIOS', 'PLAYCITY CASINO', 'FIESTA INN']);
  for (const f of P.frontages) for (const n of f.names) names.add(n);
  for (const k of P.kiosks) names.add(k.name);
  const atlas = createSignAtlas(names);
  const mats = createForumMaterials(atlas.texture, createMuralTexture(), P.rotunda);

  const outside = new THREE.Group();
  outside.name = 'ForumOutside';
  buildExterior(outside, mats, atlas, base);
  const inside = new THREE.Group();
  inside.name = 'ForumInside';
  buildInterior(inside, mats, atlas, base);
  scene.add(outside, inside);

  // what stops the player: the walls, fronts, balustrades, columns, kiosks & escalators' sides, on the floor under each
  const colliders: (Collider & { broken?: boolean })[] = P.walls.map((w) => {
    const y = base(w.cx, w.cz);
    const ex = Math.abs(w.cs) * w.hu + Math.abs(w.sn) * w.hv, ez = Math.abs(w.sn) * w.hu + Math.abs(w.cs) * w.hv;
    return { minX: w.cx - ex, maxX: w.cx + ex, minZ: w.cz - ez, maxZ: w.cz + ez, minY: y + w.y0, maxY: y + w.y1,
      obb: { cx: w.cx, cz: w.cz, hx: w.hu, hz: w.hv, cs: w.cs, sn: w.sn } };
  });
  // the upper floor and the escalators, walked on
  addFootDecks(P.decks);

  const shoppers = new Shoppers(scene, base);
  const glass = new ForumGlass(outside, mats, colliders, base);
  const hit: Hitter = { x: 0, z: 0, heading: 0, halfW: 0, halfL: 0, speed: 0, back: false, knocks: false };
  // the roofs no rain falls under (render/rain.ts), on the floor under each's middle
  const roofs: RainRoof[] = P.roofs.map((r) => ({ cx: r.cx, cz: r.cz, hu: r.hu, hv: r.hv, cs: r.cs, sn: r.sn, top: base(r.cx, r.cz) + r.y1 + 1 }));
  console.info(`[forum] ${P.frontages.reduce((n, f) => n + f.names.length, 0)} locales, ${P.escalators.length} escalators, ${colliders.length} colliders, ${shoppers.shoppers.length} shoppers`);
  return {
    colliders,
    roofs,
    /** Is (x, y, z) under the mall's roofs (indoors: the rain only heard on the roof) */
    covers(x: number, y: number, z: number) {
      return roofs.some((r) => {
        const dx = x - r.cx, dz = z - r.cz;
        return y < r.top && Math.abs(dx * r.cs - dz * r.sn) < r.hu && Math.abs(dx * r.sn + dz * r.cs) < r.hv;
      });
    },
    shoppers,
    glass,
    /** The inside shown near the camera, the shoppers walking; the player's vehicle knocking them down & breaking the
     *  glass, the player on foot carried by an escalator */
    update(dt: number, camera: THREE.Camera, player: PlayerEntity, mode: PlayerMode) {
      const near = Math.hypot(camera.position.x - P.rotunda.x, camera.position.z - P.rotunda.z) < INSIDE_NEAR;
      inside.visible = near;
      const at = player.position;
      // (the player's vehicle as it may run into people & glass: one object, refilled each frame)
      const driving = near && (mode === 'car' || mode === 'moto' || mode === 'cyclist');
      if (driving) {
        hit.speed = Math.hypot(Math.sin(player.heading) * player.speed + (player.vx ?? 0), Math.cos(player.heading) * player.speed + (player.vz ?? 0));
        hit.x = at.x;
        hit.z = at.z;
        hit.heading = player.heading;
        hit.halfW = 'halfW' in player ? player.halfW : 0.35;
        hit.halfL = 'halfL' in player ? player.halfL : 0.85;
        hit.back = player.speed < 0;
        hit.knocks = hit.speed > KNOCK_SPEED && at.y - base(at.x, at.z) < 2.6;
      }
      shoppers.update(dt, camera, driving ? hit : null);
      glass.update(dt, driving && mode !== 'cyclist' ? hit : null, player, camera);
      if (near && mode === 'person') ride(at, dt);
    }
  };
}
