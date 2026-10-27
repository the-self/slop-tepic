// js/world/uan.ts
// The Universidad Autónoma de Nayarit's campus, the Ciudad de la Cultura Amado Nervo: its walls along the streets (the
// UAN's blue piers & rejas on the boulevard and Av. de la Cultura, the old rubble stone under its chain-link on
// Revolución and 12 de Octubre), its gates (the stone arches with "UAN", the white portals with the motto and with the
// university's name, the plain ones), its buildings in white & blue (the rows of aulas on their corridors, the academic
// buildings, the domos, the stands) and the baseball stadium's floodlights. Where they stand is uan-campus.ts's (no
// three.js); the pieces are in uan/. The generic houses keep off its grounds (UAN_RESERVE), and so do the town's bardas
// (campusClaims, bardas.ts).
import * as THREE from 'three/webgpu';
import { campusBuildings, campusPlan, inCampus } from './uan-campus.ts';
import { Kit } from './uan/kit.ts';
import { createUanMaterials } from './uan/materials.ts';
import { buildRails, buildWalls } from './uan/walls.ts';
import { buildGates } from './uan/gates.ts';
import { buildBuildings } from './uan/buildings.ts';
import type { Collider } from './buildings.ts';
import type { LotReserve } from './landmark-models.ts';
import type { MapBlock } from '../ui/city-map.ts';

/** The campus's grounds, kept clear of the generic houses (its buildings are drawn here) */
const UAN_RESERVE: LotReserve = { contains: inCampus };

/** The campus into the scene: its group, what stops the player, and its buildings' footprints as the maps read them */
function buildUan(scene: THREE.Object3D): { group: THREE.Group; colliders: Collider[]; map: MapBlock } {
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

export { buildUan, UAN_RESERVE };
