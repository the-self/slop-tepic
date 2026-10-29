// js/world/buildings.ts
// Generates the city's buildings: Tepic's real building footprints (Overture Maps) as Mexican houses & shops, halls
// (supermarkets, malls, warehouses), strip plazas and gated communities' houses (a city without the footprints has its
// blocks' lots filled for their district: centro, colonia, industrial), indexed by a spatial 2D quadtree
// that streams the high-detail architectural elements (cornices, rooftop gear, awnings, storefront signs) around the
// player.
//
// Footprints are rectilinear plans built as unions of non-overlapping boxes. The block layout library still carries
// the New York game's profiles (apartment houses, brownstones, lofts, towers, fire escapes...); Tepic's districts only
// use its low-rise layout.
//
// This module assembles the pieces in js/world/buildings/: the lots and houses are generated into one CityBuild
// (types.ts), then drawn (static-meshes.ts, sign-atlas.ts) and streamed (detail-pools.ts, detail-streaming.ts,
// store-lights.ts).
import * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS } from './city-config.ts';
import { seedDice } from './buildings/dice.ts';
import { createFacadeMaterials } from './buildings/facades.ts';
import { Quadtree } from './buildings/quadtree.ts';
import { fillMadeUpBlocks } from './buildings/lots.ts';
import { indexHouseBlocks, buildHouses } from './buildings/houses.ts';
import { plantSittingAreas } from './buildings/sitting-areas.ts';
import { addStaticMeshes } from './buildings/static-meshes.ts';
import { createDetailPools, createShedPool } from './buildings/detail-pools.ts';
import { createSignAtlas } from './buildings/sign-atlas.ts';
import { createStoreLights, updateStoreLights } from './buildings/store-lights.ts';
import { streamDetails } from './buildings/detail-streaming.ts';
import { claimedLots } from './place-claims.ts';
import type { PlaceClaims } from './place-claims.ts';
import type { BlockDetail, CityBuild } from './buildings/types.ts';
import type { DetailStream } from './buildings/detail-streaming.ts';

export type { ColliderObb, Collider, FacadeBox, AtlasPage, Awning, Footprint, BlockDetail } from './buildings/types.ts';

/** `places`: what the places (js/places/) claim of the ground: their lots, no generic house built there */
function buildCityBlocks(scene: THREE.Object3D, places: readonly PlaceClaims[]) {
  const group = new THREE.Group();
  group.name = 'CityBlocks';
  // (one dice stream per build, re-seeded from each block's position: see populateBlock)
  seedDice(10019);
  const materials = createFacadeMaterials();
  const city: CityBuild = {
    xf: null,
    minLot: 15,
    colliders: [],
    stores: [], // the big chain stores you can walk into (store-interiors.ts)
    balconies: [], // the colonial houses' iron balconies: { x, y, z, yaw } (the slab's top, facing out)
    buckets: materials.map(() => []),
    // Full-island Spatial Quadtree covering Harlem (~129th St) down to the Battery
    quadtree: new Quadtree<BlockDetail>({
      minX: ISLAND_BOUNDS.minX - 50,
      maxX: ISLAND_BOUNDS.maxX + 50,
      minZ: ISLAND_BOUNDS.minZ - 50,
      maxZ: ISLAND_BOUNDS.maxZ + 50
    }, 6, 9),
    allBlocks: [],
    pylons: [] // chain stores' pole signs (5C)
  };

  // A. The made-up lots of the blocks no real building stands on, A2. the real buildings, B6. the sitting areas
  const { houseBlocks, houseBlock } = indexHouseBlocks();
  fillMadeUpBlocks(city, houseBlocks);
  buildHouses(city, houseBlock, claimedLots(places, 'houses'));
  plantSittingAreas(city.allBlocks);

  // C. The static island-wide massing; D. the streamed pools, the sign atlas & the store lights
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  addStaticMeshes(city, group, materials, unitBox, dummy);
  const pools = createDetailPools(group, unitBox);
  const { atlasPages, signSlots } = createSignAtlas(group, unitBox, dummy, city.pylons, city.colliders);
  const shedInst = createShedPool(group, unitBox);
  const lights = createStoreLights(scene);

  // E. The streaming around the player / camera
  const stream: DetailStream = {
    quadtree: city.quadtree,
    dummy,
    pools,
    shedInst,
    atlasPages,
    signSlots,
    activeAwnings: lights.activeAwnings,
    storeThemeColors: lights.storeThemeColors,
    lastStreamX: Infinity,
    lastStreamZ: Infinity
  };
  const update = (focusX: number, focusZ: number, force = false) => {
    streamDetails(stream, focusX, focusZ, force);
  };
  const updateLights = (camera?: THREE.Camera | null) => {
    updateStoreLights(lights, camera);
  };

  // Initial Quadtree stream centered at Midtown 5th Ave & 42nd St
  update(0, 62, true);

  scene.add(group);
  return {
    group,
    colliders: city.colliders,
    stores: city.stores,
    quadtree: city.quadtree,
    allBlocks: city.allBlocks,
    update,
    updateLights
  };
}

export { Quadtree, buildCityBlocks };
