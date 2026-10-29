// js/world/embotelladora.ts
// Builds the Coca-Cola bottling plant on Av. Insurgentes, by Ley Álica (embotelladora-plan.ts lays it out, the game
// letters the brand as it does the chains: materials.ts BRAND): its yard's concrete, its buildings (embotelladora/
// buildings.ts: the shed and its front, the gate under its canopy, the offices & their glass tower, the depot, the
// tanks, the ficus on the sidewalk), its walls & fences (embotelladora/fences.ts), and its fleet: the red route trucks
// standing in rows in the yard (actors/vehicles/route-truck.ts) and the tráilers backed up to the shed's doors, the
// brand along their sides, instanced, drawn while the camera is within SHOW m. All of it stops the player.
import * as THREE from 'three/webgpu';
import { liftAt } from './ground.ts';
import { drapeGeometry } from './drape.ts';
import { FlatLayer, fillLot, pavedHeight } from './car-parks.ts';
import {
  YARD, FENCE_H, EMBOTELLADORA_RESERVE, TRUCK_L, TRUCK_W, plantAt, truckBays, parkTrucks, trailers
} from './embotelladora-plan.ts';
import { Kit } from './building-kit.ts';
import { BRAND, BRAND_FONT, BRAND_RED, brandTexture, createBrandMaterial, createPlantMaterials } from './embotelladora/materials.ts';
import { buildGateSignal, buildPlantBuildings } from './embotelladora/buildings.ts';
import { createTrafficSignalLensMaterial } from './street-details.ts';
import { buildPlantFences } from './embotelladora/fences.ts';
import { createPavementMaterial } from '../render/tsl-materials.ts';
import {
  ROUTE_TRUCK_SIZE, buildRouteTruckGeometry, buildRouteTruckNameGeometry, routeTruckNameTexture, createRouteTruckMaterial,
  createRouteTruckNameMaterial,
  TRUCK_SIZE, buildTractorTrailerGeometry, buildTrailerNameGeometry, createTractorTrailerMaterial, createTrailerNameMaterial,
  trailerNameTexture
} from '../actors/actor-models.ts';
import type { TileStreamer } from './streaming.ts';
import type { LotReserve } from './landmark-models.ts';
import type { Collider, Footprint } from './buildings.ts';

const SHOW = 600; // m from the camera within which the fleet is drawn

/** A vehicle standing on the yard: where (m, its middle on the ground), its turn & tilt (rad) */
interface Standing {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

// A vehicle `length` m long standing at (x, z) facing `heading`, on the ground's slope under it
function stand(x: number, z: number, heading: number, length: number): Standing {
  const fx = Math.sin(heading), fz = Math.cos(heading), half = length / 2;
  const ahead = (liftAt(x + fx * half, z + fz * half) - liftAt(x - fx * half, z - fz * half)) / length;
  const right = (liftAt(x + fz, z - fx) - liftAt(x - fz, z + fx)) / 2;
  return { x, y: liftAt(x, z) + pavedHeight(x, z), z, yaw: heading, pitch: -Math.atan(ahead), roll: Math.atan(right) };
}

// What stops the player over a vehicle (its turned box, from its foot to its top)
function vehicleCollider(s: Standing, width: number, length: number, height: number): Collider {
  const hx = width / 2, hz = length / 2, cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return { minX: s.x - ex, maxX: s.x + ex, minZ: s.z - ez, maxZ: s.z + ez, minY: s.y, maxY: s.y + height, obb: { cx: s.x, cz: s.z, hx, hz, cs, sn } };
}

// Instanced meshes of `geos` (each with its material) at the vehicles' places
function instances(group: THREE.Group, at: readonly Standing[], parts: [THREE.BufferGeometry, THREE.Material, boolean][], name: string): THREE.InstancedMesh[] {
  const dummy = new THREE.Object3D();
  return parts.map(([geo, mat, cast]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, at.length));
    at.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(s.pitch, s.yaw, s.roll, 'YXZ');
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = at.length;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh);
    return mesh;
  });
}

/**
 * The plant into the scene (its yard's concrete to `streamer` when there is one, laid tile by tile round the camera).
 * Returns its colliders, its block (kept clear of the houses, the yards' trees and the bardas), its buildings'
 * footprints for the maps, and `update(x, z)`, which shows the fleet while the camera is near
 */
function buildEmbotelladora(scene: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'> | null = null) {
  const group = new THREE.Group();
  group.name = 'Embotelladora';
  scene.add(group);

  // The yard's concrete (createPavementMaterial's kind 3), the car park's asphalt left to car-parks.ts
  const mid = plantAt(128, 100);
  const paved = new FlatLayer();
  fillLot(paved, { pts: YARD.map(([u, v]) => plantAt(u, v)) }, pavedHeight(mid.x, mid.z), { pave: [3] });
  const yardGeo = paved.geometry();
  if (yardGeo && streamer) streamer.addLayer(yardGeo, createPavementMaterial(), { name: 'EmbotelladoraYard' });
  else if (yardGeo) {
    const mesh = new THREE.Mesh(drapeGeometry(yardGeo), createPavementMaterial());
    mesh.name = 'EmbotelladoraYard';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // The buildings, walls & fences
  const kit = new Kit(), mats = createPlantMaterials(FENCE_H.bars);
  const signs = { white: createBrandMaterial(brandTexture('#ffffff')), red: createBrandMaterial(brandTexture(BRAND_RED)) };
  const footprints: Footprint[] = buildPlantBuildings(kit, mats, signs);
  const metres = buildPlantFences(kit, mats);
  const meshes = kit.build(group);
  const colliders: Collider[] = kit.colliders;

  // The fleet: the route trucks in their bays, the tráilers at the shed's doors
  const trucks = parkTrucks(truckBays()).map((b) => stand(b.x, b.z, b.heading, TRUCK_L));
  const rigs = trailers().map((t) => stand(t.x, t.z, t.heading, TRUCK_SIZE.length));
  for (const s of trucks) colliders.push(vehicleCollider(s, TRUCK_W, TRUCK_L, ROUTE_TRUCK_SIZE.height));
  for (const s of rigs) colliders.push(vehicleCollider(s, TRUCK_SIZE.width, TRUCK_SIZE.length, TRUCK_SIZE.height));
  const truckName = createRouteTruckNameMaterial(routeTruckNameTexture(BRAND, `700 ${BRAND_FONT}`));
  const fleet = instances(group, trucks, [
    [buildRouteTruckGeometry(), createRouteTruckMaterial(), true],
    [buildRouteTruckNameGeometry(), truckName, false]
  ], 'EmbotelladoraTrucks');
  const rigGeo = buildTractorTrailerGeometry(), rigNames = buildTrailerNameGeometry();
  // (the tractors red, the cajas white with the brand's red band; the name's atlas has one row)
  const paint = (k: number, hex: number) => {
    const c = new THREE.Color(hex), a = new Float32Array(Math.max(1, rigs.length) * 3);
    for (let i = 0; i < rigs.length; i++) a.set([c.r, c.g, c.b], i * 3);
    rigGeo.setAttribute(['cabPaint', 'trailerInk', 'trailerInk2'][k], new THREE.InstancedBufferAttribute(a, 3));
  };
  paint(0, 0xc8101c);
  paint(1, 0xd0101c);
  paint(2, 0x8a0a12);
  rigNames.setAttribute('trailerName', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, rigs.length)), 1));
  fleet.push(...instances(group, rigs, [
    [rigGeo, createTractorTrailerMaterial(), true],
    [rigNames, createTrailerNameMaterial(trailerNameTexture([[BRAND.toUpperCase(), BRAND_RED, '#ffffff']]), 1), false]
  ], 'EmbotelladoraTrailers'));

  /** Hangs the signal on the gate's post, its lights on the town's signal clock (street-details.ts: `clock`, s): green
   *  for the trucks going out while Insurgentes has red at the crossing by the gate */
  function lightGate(clock: Parameters<typeof createTrafficSignalLensMaterial>[1]): void {
    buildGateSignal(group, mats, createTrafficSignalLensMaterial(false, clock));
  }

  /** Shows the fleet while (x, z) is within SHOW m of the plant */
  function update(x: number, z: number): void {
    const near = Math.hypot(x - mid.x, z - mid.z) < SHOW;
    for (const m of fleet) m.visible = near;
  }

  // (what the maps read of a block: ui/city-map.ts MapBlock)
  const map: { footprints: Footprint[] } = { footprints };
  const reserve: LotReserve = EMBOTELLADORA_RESERVE;
  console.info(`[embotelladora] ${trucks.length} route trucks, ${rigs.length} tráilers, ${Math.round(metres.bars)} m of fence, ` +
    `${Math.round(metres.precast + metres.brick)} m of wall (${meshes} meshes)`);
  return { group, colliders, reserve, map, update, lightGate };
}

type EmbotelladoraBuild = ReturnType<typeof buildEmbotelladora>;

export type { EmbotelladoraBuild };
export { buildEmbotelladora };
