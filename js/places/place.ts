// js/places/place.ts
// What every place built on its own has in common (a folder here each: uan/, central/, forum/). A place is its plan
// (plan.ts and its plan-*.ts: where everything stands, plain data, no three.js, so node --test reads it; and what it
// claims of the town's ground, world/place-claims.ts), its building (build/: into the scene once, with the shared
// pieces of kit/) and, when something lives or moves in it, its life (life.ts: stepped by app/frame-loop.ts). Its
// index.ts hands app/city.ts a PlaceSpec: the claims, read before the town is built round it, and `build`.
// The layer sits over sim/ (tests/layers.test.cjs): a place's life uses the bystanders, the ragdolls, the mayhem.
import type * as THREE from 'three/webgpu';
import type { Collider, Footprint } from '../world/buildings.ts';
import type { PlaceClaims } from '../world/place-claims.ts';
import type { TileStreamer } from '../world/streaming.ts';

export type { PlaceClaims };

/** Where a place is built: the scene, and the streamer its flat ground layers go to (null: laid at once, ?stream=0) */
export interface PlaceContext {
  scene: THREE.Object3D;
  streamer: Pick<TileStreamer, 'addLayer'> | null;
}

/** What a place hands the city once built (its own parts besides: the Central's coaches, Forum Tepic's roofs...) */
export interface Place {
  /** what stops the player */
  colliders: Collider[];
  /** its buildings' footprints for the maps (ui/city-map.ts MapBlock), when the blocks' data doesn't have them */
  map?: { footprints: Footprint[] };
}

/** A place as its folder's index.ts exports it */
export interface PlaceSpec<P extends Place> {
  /** what it claims of the town's ground, before the town is built round it */
  claims: PlaceClaims;
  /** builds it into the scene */
  build(ctx: PlaceContext): P;
}
