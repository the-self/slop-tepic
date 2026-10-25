// js/world/buildings/facades.ts
// The facade materials the buildings are drawn in (tsl-materials.ts): the New York game's masonry & curtain walls
// and Tepic's Mexican houses, with each one's storey height (buildings are massed in whole storeys).
import {
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createMexicanHouseMaterial
} from '../../render/tsl-materials.ts';
import { STOREFRONTS } from '../storefronts/index.ts';
import type { FacadeSpec } from './types.ts';

export const facades: FacadeSpec[] = [
  // 0: Pre-War Limestone & Buff Brick (5th Ave / Madison Ave / Upper East Side style)
  [createPreWarBuildingMaterial, {
    stoneColor: 0xd8cdb8,
    trimColor: 0x9e937f,
    windowGlassColor: 0x1a2836,
    windowWidth: 2.6,
    floorHeight: 3.7,
    litProbability: 0.54,
    warmth: 0.80,
    seed: 12.4
  }],
  // 1: Historic Warm Red/Terracotta Brick (Garment District / Chelsea / SoHo / Upper West Side)
  [createPreWarBuildingMaterial, {
    stoneColor: 0xa45a45,
    trimColor: 0xcab9a0,
    windowGlassColor: 0x16222e,
    windowWidth: 2.4,
    floorHeight: 3.5,
    litProbability: 0.56,
    warmth: 0.86,
    seed: 27.8
  }],
  // 2: Classic NYC Brownstone & Dark Masonry (Cross-street rowhouses, Village & Harlem)
  [createPreWarBuildingMaterial, {
    stoneColor: 0x765443,
    trimColor: 0x503a2e,
    windowGlassColor: 0x151e26,
    windowWidth: 2.2,
    floorHeight: 3.4,
    litProbability: 0.60,
    warmth: 0.90,
    seed: 41.2
  }],
  // 3: Blue-Teal Curtain-Wall Glass (Park Ave / 6th Ave / Financial District modernism)
  [createCurtainWallMaterial, {
    glassTint: 0x1a3a52,
    frameTint: 0x3b4c5b,
    windowWidth: 2.7,
    floorHeight: 3.9,
    litProbability: 0.60,
    warmth: 0.52,
    reflectivity: 0.92,
    seed: 63.5
  }],
  // 4: Dark Bronze / Charcoal Miesian Glass (Avenue of the Americas / Midtown West)
  [createCurtainWallMaterial, {
    glassTint: 0x242220,
    frameTint: 0x3c3631,
    windowWidth: 2.5,
    floorHeight: 3.8,
    litProbability: 0.64,
    warmth: 0.72,
    reflectivity: 0.88,
    seed: 81.9
  }],
  // 5: Silver / Ice-Blue Contemporary Supertall Glass (Billionaires' Row / Hudson Yards / WTC)
  [createCurtainWallMaterial, {
    glassTint: 0x264664,
    frameTint: 0xb0bcc8,
    windowWidth: 2.9,
    floorHeight: 4.1,
    litProbability: 0.58,
    warmth: 0.48,
    reflectivity: 0.95,
    seed: 94.3
  }],
  // 6: Mexican houses & shops (Tepic): painted walls in each house's own colour, barred windows, gates, shutters,
  //    the chain stores' fronts (js/world/storefronts)
  [createMexicanHouseMaterial, { floorHeight: 3.0, chains: STOREFRONTS.map((sf) => sf.facade) }]
];
/** One material per facade spec, in its order (the facade boxes' bucket index) */
export const createFacadeMaterials = () => facades.map(([create, opts]) => create({ ...opts, boxLocal: true }));
export const MEX = 6; // the Mexican house facade
// Storey height of each facade: buildings are massed in whole storeys so every window row lines up across tiers
export const storeys = facades.map(([, opts]) => opts.floorHeight);
