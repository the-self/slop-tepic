// js/world/buildings/store-lights.ts
// The storefronts' clustered spot lights: a small pool of SpotLights handed each frame to the awnings near the camera
// and ahead of it (the streaming's nearest blocks), tinted per shop.
import * as THREE from 'three/webgpu';
import type { Awning } from './types.ts';

/** An awning of the nearest streamed blocks, with its shop light's tint and its turn (rad) */
export interface ActiveAwning {
  a: Awning;
  themeIdx: number;
  ry: number;
}

/** The light pool, its tints, the awnings near the camera (filled by the streaming) and the frame's candidates */
export interface StoreLights {
  storeSpotPool: THREE.SpotLight[];
  storeThemeColors: THREE.Color[];
  activeAwnings: ActiveAwning[];
  spotCandidates: { item: ActiveAwning; effDist: number }[];
}

const STORE_SPOT_POOL = 28;

/** The pool of spot lights, in their own group added to `scene` */
function createStoreLights(scene: THREE.Object3D): StoreLights {
  // 7. Ground-floor storefront clustered SpotLights (awnings/fascia signs)
  const storeLightGroup = new THREE.Group();
  storeLightGroup.name = 'StoreClusteredLights';
  scene.add(storeLightGroup);

  const storeThemeColors = [
    new THREE.Color(0xffd896), // Bistro warm gold
    new THREE.Color(0xd8eeff), // Pharmacy crisp cool white
    new THREE.Color(0xffe4ad), // Bookstore warm amber
    new THREE.Color(0xffbe88), // 24hr Deli warm orange-gold
    new THREE.Color(0xfff2d6)  // Watch boutique warm ivory
  ];

  const storeSpotPool: THREE.SpotLight[] = [];
  for (let i = 0; i < STORE_SPOT_POOL; i++) {
    const spot = new THREE.SpotLight(0xffd896, 0, 12.0, 0.84, 0.80, 1.30);
    spot.castShadow = false;
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    storeLightGroup.add(spot);
    storeLightGroup.add(spot.target);
    storeSpotPool.push(spot);
  }

  const activeAwnings: ActiveAwning[] = [];
  const spotCandidates: StoreLights['spotCandidates'] = [];
  return { storeSpotPool, storeThemeColors, activeAwnings, spotCandidates };
}

function smoothFade(d: number, start: number, end: number) {
  const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
  return t * t * (3 - 2 * t);
}

/** Hands the pool to the awnings nearest the camera and ahead of it (all dark without a camera) */
function updateStoreLights(st: StoreLights, camera?: THREE.Camera | null) {
  const { storeSpotPool, storeThemeColors, activeAwnings, spotCandidates } = st;
  const glow = 0.85;
  const glowFactor = Math.max(0, (glow - 0.15) / 0.90);
  if (!camera || glowFactor <= 0.001) {
    for (let i = 0; i < STORE_SPOT_POOL; i++) {
      storeSpotPool[i].intensity = 0;
      storeSpotPool[i].position.set(0, -1000, 0);
    }
    return;
  }

  const camX = camera.position.x;
  const camY = camera.position.y;
  const camZ = camera.position.z;
  const e = camera.matrixWorld.elements;
  const fwdLen = Math.hypot(e[8], e[10]) || 1;
  const fwdX = -e[8] / fwdLen;
  const fwdZ = -e[10] / fwdLen;
  const STORE_MAX_DIST = 115;

  spotCandidates.length = 0;
  for (const item of activeAwnings) {
    const a = item.a;
    const dx = a.x - camX;
    const dy = (a.g || 0) - camY; // from the street front's ground (the town's slopes put it well over y = 0)
    const dz = a.z - camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > STORE_MAX_DIST * STORE_MAX_DIST) continue;
    const d = Math.sqrt(d2);
    const forwardDot = dx * fwdX + dz * fwdZ;
    const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
    if (effDist >= STORE_MAX_DIST) continue;
    spotCandidates.push({ item, effDist });
  }
  spotCandidates.sort((a, b) => a.effDist - b.effDist);

  const storeCutoff = spotCandidates.length > STORE_SPOT_POOL
    ? Math.min(STORE_MAX_DIST, spotCandidates[STORE_SPOT_POOL].effDist)
    : STORE_MAX_DIST;
  const activeSpots = Math.min(STORE_SPOT_POOL, spotCandidates.length);
  const spotIntensity = 46 * glowFactor;
  for (let i = 0; i < STORE_SPOT_POOL; i++) {
    const spot = storeSpotPool[i];
    if (i < activeSpots) {
      const cand = spotCandidates[i];
      const { a, themeIdx, ry } = cand.item;
      const fade = smoothFade(cand.effDist, storeCutoff * 0.62, storeCutoff);
      const sideDir = a.sideDir || 1;
      const outX = Math.cos(ry) * sideDir;
      const outZ = -Math.sin(ry) * sideDir;
      spot.position.set(a.x + outX * 0.45, 4.35 + (a.g || 0), a.z + outZ * 0.45);
      spot.target.position.set(a.x + outX * 1.85, a.g || 0, a.z + outZ * 1.85);
      spot.target.updateMatrixWorld();
      spot.color.copy(storeThemeColors[themeIdx % storeThemeColors.length]);
      spot.intensity = spotIntensity * fade;
    } else {
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }
  }
}

export { createStoreLights, updateStoreLights };
