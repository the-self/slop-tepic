// js/world/buildings/rows.ts
// The mid-block row buildings of the New York game's residential blocks (brownstones, tenements, apartment houses,
// lofts, taxpayers), on lots fronting one side street, and the runs of them a frontage is filled with.
import { chance, irange, pick, pickW, range } from './dice.ts';
import { carve, rect, sideDepth, sideLen, sideRect } from './footprints.ts';
import { building, commit, mass } from './massing.ts';
import type { CityBuild, LotBlock, Rect, ResProfile, RowKind, RowLot, Side } from './types.ts';

// ============================================================================
// MID-BLOCK ROW BUILDINGS (lots fronting one side street, `side` = that street; half the block deep)
// ============================================================================

// Brownstones, rowhouses & townhouses: front block plus an optional lower rear extension into the yard
function rowhouse(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  const L = sideLen(lot, side);
  const D = sideDepth(lot, side);
  const dep = Math.min(D - 0.8, k.depth);
  mass(b, [sideRect(lot, side, 0, L, 0, dep)], 0, k.floors);
  const ext = Math.min(range(2.2, 4), D - dep - 0.6);
  if (ext > 1.5 && chance(0.45)) {
    const ew = L * range(0.45, 0.65);
    const ea = chance(0.5) ? 0 : L - ew;
    mass(b, [sideRect(lot, side, ea, ea + ew, dep, dep + ext)], 0, Math.max(1, k.floors - irange(1, 2)));
  }
  commit(city, blk, b, { corniceH: 0.7, roof: 'none', shops: 'none' });
}

// Tenements: deep walk-ups with fire escapes. Old-law "dumbbells" pinch in at air shafts on both party walls,
// wider new-law ones open a light court onto the rear yard
function tenement(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  const L = sideLen(lot, side);
  const D = sideDepth(lot, side);
  const dep = Math.min(D - 0.5, k.depth);
  const holes: Rect[] = [];
  if (L < 13.5 && chance(0.55)) {
    const sw = range(0.9, 1.4);
    const sd = range(2.4, 4);
    const sb = dep * range(0.38, 0.5);
    holes.push(sideRect(lot, side, -1, sw, sb, sb + sd), sideRect(lot, side, L - sw, L + 1, sb, sb + sd));
  } else if (L >= 13.5 && chance(0.6)) {
    const cw = L * range(0.24, 0.36);
    const cd = dep * range(0.3, 0.45);
    holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, dep - cd, dep + 1));
  }
  mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
  commit(city, blk, b, { roof: 'walkup', wtP: k.floors >= 6 ? 0.3 : 0.08, shops: 0.3 });
}

// Pre-war elevator apartment house mid-block: light court onto the yard (or the street) or shafts on the party
// walls, sometimes setback penthouse floors behind a terrace
function midApartment(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  const L = sideLen(lot, side);
  const D = sideDepth(lot, side);
  const dep = Math.min(D, k.depth);
  const plan = L >= 14
    ? pickW([['rearCourt', 4], ['frontCourt', 1.2], ['shafts', 1.5], ['rect', 1]])
    : pickW([['shafts', 1], ['rect', 1]]);
  const holes: Rect[] = [];
  let solid = dep; // depth of the street-front bar left whole
  if (plan === 'rearCourt') {
    const cw = L * range(0.28, 0.4);
    const cd = dep * range(0.35, 0.55);
    holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, dep - cd, dep + 1));
    solid = dep - cd;
  } else if (plan === 'frontCourt') {
    const cw = L * range(0.3, 0.4);
    const cd = dep * range(0.25, 0.38);
    holes.push(sideRect(lot, side, (L - cw) * 0.5, (L + cw) * 0.5, -1, cd));
    solid = 0;
  } else if (plan === 'shafts') {
    const sw = range(1.4, 2.4);
    const sd = range(3, 5);
    const sb = dep * range(0.35, 0.5);
    holes.push(sideRect(lot, side, -1, sw, sb, sb + sd), sideRect(lot, side, L - sw, L + 1, sb, sb + sd));
    solid = sb;
  }
  mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
  const terrace = range(2.4, 3.4);
  if (solid - terrace >= 3.5 && chance(0.35)) {
    mass(b, [sideRect(lot, side, 0, L, terrace, solid)], k.floors, k.floors + irange(1, 2));
  }
  commit(city, blk, b, { roof: 'prewar', wtP: 0.75, shops: 'none' });
}

// Post-war brick apartment slab, often behind a planted strip, with a rear wing; plain parapet, big bulkhead
function postwarApartment(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  const L = sideLen(lot, side);
  const D = sideDepth(lot, side);
  const front = chance(0.55) ? range(1.5, 3.5) : 0;
  const dep = Math.min(D, k.depth);
  const holes: Rect[] = [];
  if (L > 18 && chance(0.5)) {
    const cw = L * range(0.3, 0.45);
    const cd = (dep - front) * range(0.3, 0.45);
    holes.push(chance(0.5)
      ? sideRect(lot, side, -1, cw, dep - cd, dep + 1)
      : sideRect(lot, side, L - cw, L + 1, dep - cd, dep + 1));
  }
  mass(b, carve(sideRect(lot, side, 0, L, front, dep), holes, 'z'), 0, k.floors);
  commit(city, blk, b, { cornice: false, roof: 'mech', shops: 'none' });
}

// Mid-block loft on a half lot (Village / Chelsea side streets)
function loftRow(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  const L = sideLen(lot, side);
  const dep = Math.min(sideDepth(lot, side), k.depth);
  const holes = L > 12 && chance(0.4) ? [sideRect(lot, side, L * 0.3, L * 0.7, dep * range(0.6, 0.75), dep + 1)] : [];
  mass(b, carve(sideRect(lot, side, 0, L, 0, dep), holes, 'z'), 0, k.floors);
  commit(city, blk, b, { roof: 'walkup', wtP: 0.6, shops: 0.75 });
}

// One- and two-storey "taxpayers", garages & old stables
function lowRow(city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) {
  const b = building(blk, k.mat, lot);
  mass(b, [sideRect(lot, side, 0, sideLen(lot, side), 0, Math.min(sideDepth(lot, side), k.depth))], 0, k.floors);
  commit(city, blk, b, { corniceH: 0.5, roof: 'none' });
}

// Mid-block lot kinds: lot width (m), run (identical neighbours built together), storeys, depth (share of the half
// block), facade weights
const ROW_KINDS: Record<string, RowKind> = {
  brownstone: { w: [5.8, 7.4], run: [3, 8], floors: [4, 5], depth: [0.6, 0.78], mats: [[2, 6], [1, 2], [0, 1]], build: rowhouse },
  rowhouse: { w: [5.4, 7.6], run: [2, 6], floors: [3, 4], depth: [0.55, 0.75], mats: [[1, 6], [2, 2], [0, 1]], build: rowhouse },
  townhouse: { w: [7, 11], run: [1, 3], floors: [4, 6], depth: [0.7, 0.86], mats: [[0, 5], [2, 2], [1, 1]], build: rowhouse },
  tenement: { w: [7.6, 12.5], run: [2, 6], floors: [5, 6], depth: [0.8, 0.94], mats: [[1, 6], [0, 2], [2, 2]], build: tenement },
  midApt: { w: [14, 24], run: [1, 1], floors: [8, 13], depth: [0.9, 1.0], mats: [[0, 5], [1, 4]], build: midApartment },
  postwarApt: { w: [16, 28], run: [1, 1], floors: [9, 16], depth: [0.8, 1.0], mats: [[0, 6], [1, 3]], build: postwarApartment },
  loft: { w: [8, 16], run: [1, 3], floors: [6, 10], depth: [0.9, 1.0], mats: [[1, 5], [0, 4]], build: loftRow },
  low: { w: [7, 14], run: [1, 1], floors: [1, 2], depth: [0.85, 1.0], mats: [[1, 1], [0, 1]], build: lowRow },
  garden: { w: [6, 11], run: [1, 1], floors: [0, 0], depth: [0, 0], mats: [[1, 1]], build: null } // vacant lot
};

// Fill the frontage [a, b] of one side street with runs of row buildings
function fillFrontage(city: CityBuild, blk: LotBlock, a: number, b: number, side: Side, cfg: ResProfile) {
  const halfD = (blk.maxZ - blk.minZ) * 0.5;
  let x = a;
  while (b - x > 0.5) {
    const kindName = pickW(cfg.rows);
    const kind = ROW_KINDS[kindName];
    const fl = cfg.kf?.[kindName] ?? kind.floors;
    const run = irange(kind.run[0], kind.run[1]);
    const lotW = range(kind.w[0], kind.w[1]);
    const mat = pickW(kind.mats);
    const floorsRun = irange(fl[0], fl[1]);
    const depthRun = halfD * range(kind.depth[0], kind.depth[1]);
    for (let i = 0; i < run && b - x > 0.5; i++) {
      let w = lotW * range(0.96, 1.04);
      if (b - x - w < kind.w[0] * 0.6) w = b - x;
      const lot = side === 'n' ? rect(x, x + w, blk.minZ, blk.minZ + halfD) : rect(x, x + w, blk.maxZ - halfD, blk.maxZ);
      if (kind.build) {
        kind.build(city, blk, lot, side, {
          mat,
          floors: Math.max(1, floorsRun + (chance(0.2) ? pick([-1, 1]) : 0)),
          depth: Math.min(halfD, depthRun * range(0.95, 1.05))
        });
      }
      x += w;
    }
  }
}

export { fillFrontage };
