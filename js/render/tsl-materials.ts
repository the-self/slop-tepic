import { cityUniforms, townFloorNode } from './materials/shared.ts';
import { WALL_KINDS, atlasSlotUV } from './materials/facade-cell.ts';
import { createMexicanHouseMaterial } from './materials/mexican-house.ts';
import { createCurtainWallMaterial } from './materials/curtain-wall.ts';
import { createPreWarBuildingMaterial } from './materials/pre-war.ts';
import { createFacadeBoxes, createBalconyRailMaterial } from './materials/facade-boxes.ts';
import { createTreeMaterial } from './materials/foliage.ts';
import {
  createParkPavingMaterial,
  createParkLampGlobeMaterial,
  createParkLampPoolMaterial,
  createTreeGrateMaterial,
  createParkLawnMaterial,
  createPitchMaterial
} from './materials/parks.ts';
import {
  createRoadSurfaceMaterial,
  createRoadPaintMaterial,
  createPavementMaterial,
  createAirfieldMaterial
} from './materials/roads.ts';
import { createSidewalkMaterial, createCurbMaterial, createCyclewayMaterial } from './materials/sidewalks.ts';
import {
  createWireMaterial,
  WIRE_FADE,
  createBridgeConcreteMaterial,
  createTrackBedMaterial,
  createUnderpassEarthMaterial
} from './materials/structures.ts';
import {
  createLotGroundMaterial,
  createFloodWaterMaterial,
  createRiverBankMaterial,
  createRiverWaterMaterial
} from './materials/ground.ts';
import { createCarPaintMaterial, createContactShadowMaterial, createCarFlareMaterial } from './materials/vehicles.ts';
import { createSmokeMaterial, createBloodPoolMaterial } from './materials/effects.ts';
export type { CityUniforms } from './materials/shared.ts';
export type { ChainFacade, MexicanHouseOptions } from './materials/mexican-house.ts';
export type { CurtainWallOptions } from './materials/curtain-wall.ts';
export type { PreWarOptions } from './materials/pre-war.ts';
export type { FacadeBoxSpec } from './materials/facade-boxes.ts';

// js/render/tsl-materials.ts
// Photorealistic TSL (Three.js Shading Language) procedural shaders for Three.js r186 WebGPURenderer
// Incorporating techniques from three.js webgpu_generator_city.html:
// - Mikkelsen Surface-Gradient Hardware Derivative Bump Mapping (bumpNormal)
// - Filter-Width Anti-Aliased Procedural Markings & Mortar (lineAA & gridLine via fwidth)
// - True 3D Slab Ray-Marched Room & Retail Storefront Interiors (walls, ceiling lamps, floors, rugs, doors, art, shelves, curtains)
// - Window Air-Conditioner Units with Louver Relief & Grimy Soda-Lime Window Glazing
// - Crown-Sphere Foliage Normal Relief, Radial Interior Canopy AO & Cast-Iron Tree Grate Shading
// - Occlusion-Aware Urban Canyon Global Illumination (aoNode + Warm Terracotta/Limestone Bounce)
// The materials live in js/render/materials/, by what they shade; this module is their public entry.

export {
  cityUniforms,
  townFloorNode,
  WALL_KINDS,
  atlasSlotUV,
  createMexicanHouseMaterial,
  createCurtainWallMaterial,
  createPreWarBuildingMaterial,
  createFacadeBoxes,
  createCarPaintMaterial,
  createTreeMaterial,
  createParkPavingMaterial,
  createParkLampGlobeMaterial,
  createParkLampPoolMaterial,
  createTreeGrateMaterial,
  createRoadSurfaceMaterial,
  createRoadPaintMaterial,
  createPavementMaterial,
  createAirfieldMaterial,
  createBalconyRailMaterial,
  createWireMaterial,
  WIRE_FADE,
  createBridgeConcreteMaterial,
  createTrackBedMaterial,
  createUnderpassEarthMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createParkLawnMaterial,
  createLotGroundMaterial,
  createPitchMaterial,
  createCyclewayMaterial,
  createFloodWaterMaterial,
  createRiverBankMaterial,
  createRiverWaterMaterial,
  createContactShadowMaterial,
  createSmokeMaterial,
  createBloodPoolMaterial,
  createCarFlareMaterial
};
