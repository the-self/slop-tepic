// js/world/buildings/detail-streaming.ts
// The quadtree streaming of the blocks' high-detail elements around the camera: every 18 m it moved, the pools
// (detail-pools.ts) are refilled from the nearest blocks first, the shop signs placed in their atlas pages (the
// names that came near drawn in), and the nearest awnings handed to the store lights.
import type * as THREE from 'three/webgpu';
import { GEO } from '../city-geodata.js';
import { MAX_CORNICES, MAX_WATER_TOWERS, MAX_HVAC, MAX_AWNINGS, MAX_SHEDS, MAX_TINACOS } from './detail-pools.ts';
import { NAME_RADIUS, drawSign } from './sign-atlas.ts';
import type { SignSlots } from '../sign-slots.ts';
import type { DetailPools } from './detail-pools.ts';
import type { Quadtree } from './quadtree.ts';
import type { ActiveAwning } from './store-lights.ts';
import type { AtlasPage, BlockDetail } from './types.ts';

const SIGNS = GEO.signs; // shop sign faces (chains under parody names, local businesses, trades)

/**
 * What the streaming reads and refills: the blocks' quadtree, the scratch object the instance matrices are composed
 * with, the pools, the sign atlas & its name slots, the awnings near the camera (for the store lights, with their
 * tints), and where it last streamed (m)
 */
export interface DetailStream {
  quadtree: Quadtree<BlockDetail>;
  dummy: THREE.Object3D;
  pools: DetailPools;
  shedInst: THREE.InstancedMesh;
  atlasPages: AtlasPage[];
  signSlots: SignSlots;
  activeAwnings: ActiveAwning[];
  storeThemeColors: THREE.Color[];
  lastStreamX: number;
  lastStreamZ: number;
}

// ============================================================================
// E. DYNAMIC QUADTREE STREAMING UPDATE AROUND PLAYER / CAMERA
// ============================================================================
const STREAM_RADIUS = 560; // High-detail architectural radius around player in meters

// Streaming rewrites only the active prefix; unused pool capacity need not cross the GPU queue.
function flagRange(attribute: THREE.BufferAttribute, count: number) {
  if (count === 0) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** Refills the pools around (focusX, focusZ) once it moved 18 m from the last time (or when forced) */
function streamDetails(st: DetailStream, focusX: number, focusZ: number, force = false) {
  const dx = focusX - st.lastStreamX;
  const dz = focusZ - st.lastStreamZ;
  if (!force && (dx * dx + dz * dz) < 324) {
    // Player moved less than 18m since last Quadtree stream update
    return;
  }
  st.lastStreamX = focusX;
  st.lastStreamZ = focusZ;
  const { quadtree, dummy, shedInst, atlasPages, signSlots, activeAwnings, storeThemeColors } = st;
  const { corniceInst, legsInst, barrelInst, coneInst, hvacInst, tinacoInst, awningInst, awningPalette } = st.pools;

  const nearbyBlocks = quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
  // Sort closest blocks first so if any pool hits capacity, closest blocks around the player always win
  nearbyBlocks.sort((a, b) => {
    const da = (a.cx - focusX) * (a.cx - focusX) + (a.cz - focusZ) * (a.cz - focusZ);
    const db = (b.cx - focusX) * (b.cx - focusX) + (b.cz - focusZ) * (b.cz - focusZ);
    return da - db;
  });
  activeAwnings.length = 0;

  let corniceCount = 0;
  let wtCount = 0;
  let hvacCount = 0;
  let tinacoCount = 0;
  let awningCount = 0;
  let shedCount = 0;
  for (const page of atlasPages) page.count = 0;
  signSlots.begin();

  for (let bIdx = 0; bIdx < nearbyBlocks.length; bIdx++) {
    const blk = nearbyBlocks[bIdx];
    // every piece of a block turned into a frontage frame shares its turn (see placeInFrame)
    dummy.rotation.set(0, blk.ry || 0, 0);
    const collectNearLights = bIdx < 20;

    // 1. Stone cornices & setback ledges, hung just below their roof line (top 0.1h under it, so no two ledges or
    //    roofs share a plane) so roofs & terraces keep their own roofing instead of a stone lid
    for (let i = 0; i < blk.cornices.length && corniceCount < MAX_CORNICES; i++) {
      const c = blk.cornices[i];
      dummy.rotation.set(0, c.ry ?? blk.ry ?? 0, 0); // (the real buildings turn one by one)
      dummy.position.set(c.x, c.y - c.h * 0.6, c.z);
      dummy.scale.set(c.w, c.h, c.d);
      dummy.updateMatrix();
      corniceInst.setMatrixAt(corniceCount++, dummy.matrix);
    }

    // 2. Rooftop cedar water towers
    for (let i = 0; i < blk.waterTowers.length && wtCount < MAX_WATER_TOWERS; i++) {
      const wt = blk.waterTowers[i];
      dummy.scale.set(1, 1, 1);

      dummy.position.set(wt.x, wt.y + 1.3, wt.z);
      dummy.updateMatrix();
      legsInst.setMatrixAt(wtCount, dummy.matrix);

      dummy.position.set(wt.x, wt.y + 4.2, wt.z);
      dummy.updateMatrix();
      barrelInst.setMatrixAt(wtCount, dummy.matrix);

      dummy.position.set(wt.x, wt.y + 6.7, wt.z);
      dummy.updateMatrix();
      coneInst.setMatrixAt(wtCount, dummy.matrix);
      wtCount++;
    }

    // 3. Rooftop HVAC & mechanical bulkheads
    for (let i = 0; blk.tinacos && i < blk.tinacos.length && tinacoCount < MAX_TINACOS; i++) {
      const t = blk.tinacos[i];
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(t.x, t.y, t.z);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      tinacoInst.setMatrixAt(tinacoCount++, dummy.matrix);
    }
    dummy.rotation.set(0, blk.ry || 0, 0);
    for (let i = 0; i < blk.hvacUnits.length && hvacCount < MAX_HVAC; i++) {
      const u = blk.hvacUnits[i];
      dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
      dummy.scale.set(u.w, u.h, u.d);
      dummy.updateMatrix();
      hvacInst.setMatrixAt(hvacCount++, dummy.matrix);
    }

    // 5. Retail awnings & illuminated storefront fascia signs
    for (let i = 0; i < blk.awnings.length && awningCount < MAX_AWNINGS; i++) {
      const a = blk.awnings[i];
      dummy.rotation.set(0, a.ry ?? blk.ry ?? 0, 0);
      dummy.position.set(a.x, a.y, a.z);
      dummy.scale.set(a.noAwning ? 0 : a.w, a.noAwning ? 0 : 0.75, a.noAwning ? 0 : a.d);
      dummy.updateMatrix();
      awningInst.setMatrixAt(awningCount, dummy.matrix);
      awningInst.setColorAt(awningCount, awningPalette[a.colorIdx % awningPalette.length]);

      const themeIdx = (a.sign ?? awningCount) % storeThemeColors.length; // (its shop light's tint)
      if (a.sign !== undefined && atlasPages.length) {
        // the shop's own sign (atlas slot), flat on its facade above the awning (or the chain's fascia band): a
        // business's name near the camera from the name pages, else its trade's (or the chain's) from page 0
        let page = atlasPages[0], slot = a.sign;
        const trade = SIGNS[a.sign].trade;
        if (trade) {
          const ex = a.x - focusX, ez = a.z - focusZ;
          const s = ex * ex + ez * ez < NAME_RADIUS * NAME_RADIUS ? signSlots.acquire(a.sign) : -1;
          if (s >= 0) {
            page = atlasPages[1 + Math.floor(s / signSlots.perPage)];
            slot = s % signSlots.perPage;
          } else slot = trade - 1;
        }
        dummy.position.set(a.signPX ?? a.x, a.signY ?? 4.68 + (a.g || 0), a.signPZ ?? a.z);
        dummy.scale.set(a.signW ?? 0.28, a.signH ?? 0.86, a.d * 0.92);
        dummy.updateMatrix();
        page.inst.setMatrixAt(page.count, dummy.matrix);
        page.slots.setX(page.count++, slot);
      }
      if (collectNearLights) {
        activeAwnings.push({ a, themeIdx, ry: a.ry ?? blk.ry ?? 0 });
      }
      awningCount++;
    }

    // 6. Sidewalk construction sheds
    for (let i = 0; i < blk.scaffoldSheds.length && shedCount < MAX_SHEDS; i++) {
      const s = blk.scaffoldSheds[i];
      dummy.position.set(s.x, s.y + 3.6, s.z);
      dummy.scale.set(s.w, 0.85, s.d);
      dummy.updateMatrix();
      shedInst.setMatrixAt(shedCount++, dummy.matrix);
    }
  }
  dummy.rotation.set(0, 0, 0);

  corniceInst.count = corniceCount;
  flagRange(corniceInst.instanceMatrix, corniceCount);

  legsInst.count = wtCount;
  barrelInst.count = wtCount;
  coneInst.count = wtCount;
  flagRange(legsInst.instanceMatrix, wtCount);
  flagRange(barrelInst.instanceMatrix, wtCount);
  flagRange(coneInst.instanceMatrix, wtCount);

  hvacInst.count = hvacCount;
  flagRange(hvacInst.instanceMatrix, hvacCount);
  tinacoInst.count = tinacoCount;
  flagRange(tinacoInst.instanceMatrix, tinacoCount);

  awningInst.count = awningCount;
  flagRange(awningInst.instanceMatrix, awningCount);
  if (awningInst.instanceColor) flagRange(awningInst.instanceColor, awningCount);

  // the names that came near: drawn into their slots, and only their pages uploaded again
  for (let k = 0; k < signSlots.drawn.length; k += 2) {
    const s = signSlots.drawn[k];
    drawSign(atlasPages[1 + Math.floor(s / signSlots.perPage)].ctx, SIGNS[signSlots.drawn[k + 1]], s % signSlots.perPage);
  }
  for (const p of signSlots.dirty) atlasPages[1 + p].tex.needsUpdate = true;
  for (const page of atlasPages) {
    page.inst.count = page.count;
    flagRange(page.inst.instanceMatrix, page.count);
    flagRange(page.slots, page.count);
  }

  shedInst.count = shedCount;
  flagRange(shedInst.instanceMatrix, shedCount);
}

export { streamDetails };
