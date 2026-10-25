// js/world/buildings/lots.ts
// The made-up lots of a city without the real footprints: every block of city-config.ts BLOCKS cut into lots inside
// its property line, filled for its neighbourhood (populateBlock), turned into place when laid in a frontage frame,
// and registered for the maps & the streaming of roof details.
import { BLOCKS } from '../city-config.ts';
import { GEO } from '../city-geodata.js';
import { liftAt } from '../ground.ts';
import { chance, seedDice } from './dice.ts';
import { layOut } from './layouts.ts';
import { openOntoVoidLots, toWorld } from './massing.ts';
import { LOWRISE, blockProfile } from './profiles.ts';
import type { CityBlock, PointXZ } from '../city-config.ts';
import type { BlockFrame, LotRect } from '../city-geodata.js';
import type { BlockDetail, CityBuild, LotBlock, Rect } from './types.ts';

/**
 * Populates a single Manhattan block with lots and buildings for its neighbourhood and registers its high-detail
 * architectural features (stone cornices, water towers, rooftop bulkheads, fire escapes, awnings, storefront
 * fascia signs, and scaffolding sheds) into the Quadtree.
 */
function populateBlock(city: CityBuild, minX: number, maxX: number, minZ: number, maxZ: number, _colIndex: number, _rowIndex: number, _isOuter = false, lowRiseEsplanade = false, district = 'midtown') {
  const bw = maxX - minX;
  const bd = maxZ - minZ;
  if (bw < (district === 'riverfront' ? 9 : city.minLot) || bd < city.minLot) return;
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const blockDetail: LotBlock = {
    id: `${district}_${Math.round(cx)}_${Math.round(cz)}`,
    cx,
    cz,
    minX,
    maxX,
    minZ,
    maxZ,
    district,
    cornices: [],
    waterTowers: [],
    hvacUnits: [],
    awnings: [],
    scaffoldSheds: [],
    footprints: [], // { x0, x1, z0, z1, h, tone } per building part, lowest first (maps; + pts: its world corners when turned)
    yards: [], // rear yards, courts & lawns { x0, x1, z0, z1 } (+ ry: turned about their centre)
    maxH: 0,
    avenueFronts: { w: [], e: [] }, // ground-floor frontage [z0, z1] along each avenue
    facadeBoxes: [], // this block's facade boxes & the lots left empty under bridge approaches (until it's built)
    voidLots: []
  };
  const bucketMarks = city.buckets.map((items) => items.length);
  seedDice((Math.imul(Math.round(minX * 4), 73856093) ^ Math.imul(Math.round(minZ * 4), 19349663) ^ 10019) >>> 0);

  const x0 = minX;
  const x1 = maxX;
  if (x1 - x0 > 0.5) {
    const profile = lowRiseEsplanade ? LOWRISE : blockProfile(blockDetail, district);
    layOut(city, profile.kind, blockDetail, profile, x0, x1);
  }
  openOntoVoidLots(blockDetail);
  const built: BlockDetail & Partial<Pick<LotBlock, 'facadeBoxes' | 'voidLots'>> = blockDetail;
  delete built.facadeBoxes;
  delete built.voidLots;

  // Sidewalk scaffolding shed along a stretch of the west avenue frontage
  const fronts = blockDetail.avenueFronts.w;
  if (fronts.length && chance(0.2)) {
    const [z0, z1] = fronts.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    if (z1 - z0 > 8) blockDetail.scaffoldSheds.push({ x: minX - 2.2, y: 0.22 + liftAt(...toWorld(city, minX - 2.2, (z0 + z1) * 0.5)), z: (z0 + z1) * 0.5, w: 3.8, d: (z1 - z0) * 0.85 });
  }

  blockDetail.footprints.sort((a, b) => a.h - b.h);
  if (city.xf) placeInFrame(city, blockDetail, bucketMarks);
  city.quadtree.insert(blockDetail);
  city.allBlocks.push(blockDetail);
}

// Turns everything a lot of the current frame emitted into place: facade boxes, roof gear, cornices, fire escapes,
// awnings & sheds get the frame's turn (ry) about their own centre, map footprints their world corners, the block
// its world centre (streaming) & bounds
function placeInFrame(city: CityBuild, blk: BlockDetail, marks: number[]) {
  const xf = city.xf;
  if (!xf) return;
  const th = xf.th;
  city.buckets.forEach((items, m) => {
    for (let i = marks[m]; i < items.length; i++) {
      const b = items[i];
      [b.x, b.z] = toWorld(city, b.x, b.z);
      b.ry = th;
    }
  });
  for (const list of [blk.cornices, blk.waterTowers, blk.hvacUnits, blk.awnings, blk.scaffoldSheds]) {
    for (const o of list) {
      [o.x, o.z] = toWorld(city, o.x, o.z);
      o.ry = th;
    }
  }
  const corners = (x0: number, x1: number, z0: number, z1: number): PointXZ[] => [toWorld(city, x0, z0), toWorld(city, x1, z0), toWorld(city, x1, z1), toWorld(city, x0, z1)].map(([x, z]) => ({ x, z }));
  const bounds = (o: Partial<Rect>, pts: PointXZ[]) => {
    o.x0 = Math.min(...pts.map((p) => p.x));
    o.x1 = Math.max(...pts.map((p) => p.x));
    o.z0 = Math.min(...pts.map((p) => p.z));
    o.z1 = Math.max(...pts.map((p) => p.z));
  };
  for (const f of blk.footprints) {
    f.pts = corners(f.x0, f.x1, f.z0, f.z1);
    bounds(f, f.pts);
  }
  for (const y of blk.yards) {
    const [cx, cz] = toWorld(city, (y.x0 + y.x1) * 0.5, (y.z0 + y.z1) * 0.5);
    const hw = (y.x1 - y.x0) * 0.5;
    const hd = (y.z1 - y.z0) * 0.5;
    Object.assign(y, { x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd, ry: th });
  }
  const pts = corners(blk.minX, blk.maxX, blk.minZ, blk.maxZ);
  [blk.cx, blk.cz] = toWorld(city, blk.cx, blk.cz);
  const b: Partial<Rect> = {};
  bounds(b, pts);
  Object.assign(blk, { minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1, ry: th, pts });
}

// ============================================================================
// A. EVERY REAL BLOCK OF THE CITY (city-config.ts BLOCKS): each curb island's lots inside its property line,
//    filled for its neighbourhood. A grid block is one lot rect spanning avenue to avenue (61 m deep between the
//    streets); Broadway's trapezoids and Lower Manhattan's irregular blocks come with frontage frames: lot rects laid
//    out along each street they front, filled in the frame and turned into place.
// ============================================================================
// Superblocks (Battery Park City, the campuses & housing projects uptown, Stuy Town...) are cut into strips about a
// street block deep with a ~9 m passage between them, so no lot (and no building) runs 100+ m deep
const DEEP_LOT = 95;
function splitDeep(r: LotRect): LotRect[] {
  const [x0, x1, z0, z1] = r;
  const d = z1 - z0;
  if (d <= DEEP_LOT) return [r];
  const gap = 9;
  const n = Math.max(2, Math.round((d + gap) / (64 + gap)));
  const s = (d - gap * (n - 1)) / n;
  const out: LotRect[] = [];
  for (let k = 0; k < n; k++) out.push([x0, x1, z0 + k * (s + gap), z0 + k * (s + gap) + s]);
  return out;
}

/** Fills every block none of the real buildings stands on (`houseBlocks`) with made-up lots, in a city without them */
function fillMadeUpBlocks(city: CityBuild, houseBlocks: Set<CityBlock>) {
  // With the real footprints loaded, a block none stands on is really empty (a vacant lot, a parking lot, a traffic
  // island): only a city without them is filled with made-up lots
  const madeUp = !GEO.houses.length;
  for (const b of BLOCKS) {
    if (!madeUp || b.park > 0.6 || b.median || houseBlocks.has(b)) continue;
    city.minLot = b.frames ? 12 : 15;
    for (const [th, px, pz, rects] of b.frames ?? ([[0, 0, 0, b.rects]] satisfies BlockFrame[])) {
      city.xf = th ? { th, cs: Math.cos(th), sn: Math.sin(th), px, pz } : null;
      for (const r of rects) {
        for (const [x0, x1, z0, z1] of splitDeep(r)) {
          if (x1 - x0 < city.minLot || z1 - z0 < city.minLot) continue;
          populateBlock(city, x0, x1, z0, z1, 0, 0, false, false, b.district);
        }
      }
      city.xf = null;
    }
  }
  city.minLot = 15;
}

export { fillMadeUpBlocks };
