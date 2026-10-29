// js/places/forum/index.ts
// Forum Tepic, the mall on the Boulevard Colosio (plan.ts says where everything stands): its buildings from outside
// (build/exterior.ts) and inside (build/interior.ts), walked into through its glass doors, its upper floor climbed by
// the escalators (decks for those on foot: ground.ts addFootDecks), the roofs no rain falls under. What lives in it
// (its shoppers, the glass a car breaks, the escalators' steps carrying you) is life.ts's.
// The generic houses & the town's trees keep off its lots (FORUM_CLAIMS, world/place-claims.ts); its car park is the
// city data's (tools/build-tepic-geodata.mjs KNOWN_PARKING). The inside is hidden while the camera is far.
import * as THREE from 'three/webgpu';
import { FLOOR, FORUM, FORUM_CLAIMS } from './plan.ts';
import { turnedBox } from '../../world/standing.ts';
import { addFootDecks, townHeight } from '../../world/ground.ts';
import { createForumMaterials } from './build/materials.ts';
import { createMuralTexture, createSignAtlas } from './build/signs.ts';
import { buildExterior } from './build/exterior.ts';
import { buildInterior } from './build/interior.ts';
import type { Collider } from '../../world/buildings.ts';
import type { RainRoof } from '../../render/rain.ts';
import type { PlaceContext, PlaceSpec } from '../place.ts';

export type { ForumMaterials } from './build/materials.ts';

const INSIDE_NEAR = 420; // m from the rotunda: the inside is drawn nearer than this

/** The mall's floor under (x, z) (m): the town's floor and the step up of a block's sidewalk */
export const forumFloor = (x: number, z: number): number => townHeight(x, z) + FLOOR;
const base = forumFloor;

/** A wall of the mall among the player's colliders: `broken` while its pane of glass is (life/glass.ts) */
export type ForumCollider = Collider & { broken?: boolean };

export type Forum = ReturnType<typeof buildForum>;

export function buildForum({ scene }: PlaceContext) {
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
  const colliders: ForumCollider[] = P.walls.map((w) => {
    const y = base(w.cx, w.cz);
    return turnedBox(w.cx, w.cz, w.hu, w.hv, Math.atan2(w.sn, w.cs), y + w.y0, y + w.y1);
  });
  // the upper floor and the escalators, walked on
  addFootDecks(P.decks);

  // the roofs no rain falls under (render/rain.ts), on the floor under each's middle
  const roofs: RainRoof[] = P.roofs.map((r) => ({ cx: r.cx, cz: r.cz, hu: r.hu, hv: r.hv, cs: r.cs, sn: r.sn, top: base(r.cx, r.cz) + r.y1 + 1 }));
  console.info(`[forum] ${P.frontages.reduce((n, f) => n + f.names.length, 0)} locales, ${P.escalators.length} escalators, ${colliders.length} colliders`);
  return {
    colliders,
    roofs,
    /** its materials and the group seen from outside (life/glass.ts draws its breakable panes there) */
    mats,
    outside,
    /** Is (x, y, z) under the mall's roofs (indoors: the rain only heard on the roof) */
    covers(x: number, y: number, z: number) {
      return roofs.some((r) => {
        const dx = x - r.cx, dz = z - r.cz;
        return y < r.top && Math.abs(dx * r.cs - dz * r.sn) < r.hu && Math.abs(dx * r.sn + dz * r.cs) < r.hv;
      });
    },
    /** The inside drawn near the camera; whether it is */
    showInside(camera: THREE.Camera): boolean {
      inside.visible = Math.hypot(camera.position.x - P.rotunda.x, camera.position.z - P.rotunda.z) < INSIDE_NEAR;
      return inside.visible;
    }
  };
}

/** Forum Tepic as app/city.ts builds it */
export const FORUM_PLACE: PlaceSpec<Forum> = { claims: FORUM_CLAIMS, build: buildForum };
