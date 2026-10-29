// js/places/uan/index.ts
// The Universidad Autónoma de Nayarit's campus, the Ciudad de la Cultura Amado Nervo: its walls along the streets (the
// UAN's blue piers & rejas on the boulevard and Av. de la Cultura, the old rubble stone under its chain-link on
// Revolución and 12 de Octubre), its gates (the stone arches with "UAN", the white portals with the motto and with the
// university's name, the plain ones), its buildings in white & blue (the rows of aulas on their corridors, the academic
// buildings, the domos, the stands) and the baseball stadium's floodlights. Where they stand is plan.ts's (no
// three.js); the pieces are in build/. The generic houses keep off its grounds, and so do the town's bardas, the
// lamps & the trees off its buildings (UAN_CLAIMS, world/place-claims.ts).
import * as THREE from 'three/webgpu';
import { UAN_CLAIMS, campusBuildings, campusPlan } from './plan.ts';
import { Kit } from '../kit/pieces.ts';
import { createUanMaterials } from './build/materials.ts';
import { buildRails, buildWalls } from './build/walls.ts';
import { buildGates } from './build/gates.ts';
import { buildBuildings } from './build/buildings.ts';
import type { Collider, Footprint } from '../../world/buildings.ts';
import type { Place, PlaceContext, PlaceSpec } from '../place.ts';

/** The campus as built: its group, what stops the player, and its buildings' footprints as the maps read them */
interface UanBuild extends Place {
  group: THREE.Group;
  colliders: Collider[];
  map: { footprints: Footprint[] };
}

/** The campus into the scene */
function buildUan({ scene }: PlaceContext): UanBuild {
  const group = new THREE.Group();
  group.name = 'UAN';
  const kit = new Kit(), mats = createUanMaterials();
  const { walls, gates, rails } = campusPlan();
  const metres = buildWalls(kit, walls, mats);
  buildRails(kit, rails, mats);
  buildGates(kit, gates, mats);
  const { footprints, floodlights } = buildBuildings(kit, campusBuildings(), mats);
  const meshes = kit.build(group);
  scene.add(group);
  console.info(`[uan] ${Math.round(metres.blue)} m of blue wall, ${Math.round(metres.stone)} m of stone, ${gates.length} gates, ` +
    `${footprints.length} buildings, ${floodlights} floodlights (${meshes} meshes)`);
  return { group, colliders: kit.colliders, map: { footprints } };
}

/** The UAN's campus as app/city.ts builds it */
const UAN_PLACE: PlaceSpec<UanBuild> = { claims: UAN_CLAIMS, build: buildUan };

export type { UanBuild };
export { UAN_PLACE, buildUan };
