// js/world/buildings/apartments.ts
// The New York game's apartment houses: pre-war courts & crowns, twin towers and post-war towers on the corner lots
// along an avenue, through-block ones mid-block, and the corner buildings a block end gets by its avenue's type.
import { chance, irange, pick, pickW, range } from './dice.ts';
import { OPPOSITE, carve, courtHole, insetAll, rect, rectD, rectW, sideRect } from './footprints.ts';
import { loftBuilding } from './lofts.ts';
import { building, commit, mass, shapeHoles } from './massing.ts';
import { LOFT_CHELSEA, shopsOnAvenue } from './profiles.ts';
import type { CityBuild, LotBlock, Rect, ResProfile, Side, TowerCfg } from './types.ts';

// ============================================================================
// APARTMENT HOUSES (corner lots along an avenue, through-block lots mid-block)
// ============================================================================

// Pre-war apartment house on its corner lot (`side` = the avenue): light courts in U, E, H, ring or L plans, and
// setback crown floors over the solid avenue bar on the grander ones
function prewarHouse(city: CityBuild, blk: LotBlock, side: 'w' | 'e', lot: Rect, cfg: ResProfile, grand: boolean) {
  const inner = OPPOSITE[side];
  const L = rectD(lot); // avenue frontage
  const W = rectW(lot); // depth into the block
  const b = building(blk, pickW(grand ? cfg.grandMats : cfg.prewarMats), lot);
  const f = grand ? irange(cfg.grand[0], cfg.grand[1]) : irange(cfg.prewar[0], cfg.prewar[1]);
  const plan = pickW([
    ['U', 4],
    ['E', L >= 24 ? 1.5 : 0],
    ['ring', W >= 17 && L >= 20 ? 2 : 0],
    ['H', W >= 15 ? 1.5 : 0],
    ['L', 1.5],
    ['rect', 1.2]
  ]);
  let holes: Rect[] = [];
  let core: Rect | null = lot; // solid part a crown may rise from
  if (plan === 'U') {
    const cw = Math.min(L - 10, L * range(0.3, 0.42));
    const cd = W * range(0.35, 0.55);
    holes = [courtHole(lot, inner, cw, cd)];
    core = sideRect(lot, side, 0, L, 0, W - cd);
  } else if (plan === 'E') {
    const cw = L * range(0.13, 0.18);
    const cd = W * range(0.35, 0.5);
    holes = [courtHole(lot, inner, cw, cd, -L * 0.22), courtHole(lot, inner, cw, cd, L * 0.22)];
    core = sideRect(lot, side, 0, L, 0, W - cd);
  } else if (plan === 'ring') {
    holes = [insetAll(lot, range(5.8, 7.2))];
    core = null;
  } else if (plan === 'H') {
    const cw = W * range(0.32, 0.42);
    const cd = L * range(0.18, 0.26);
    holes = [courtHole(lot, 'n', cw, cd), courtHole(lot, 's', cw, cd)];
    core = rect(lot.x0, lot.x1, lot.z0 + cd, lot.z1 - cd);
  } else if (plan === 'L') {
    const cw = L * range(0.35, 0.5);
    const cd = W * range(0.4, 0.6);
    holes = [chance(0.5) ? sideRect(lot, inner, -1, cw, -1, cd) : sideRect(lot, inner, L - cw, L + 1, -1, cd)];
    core = sideRect(lot, side, 0, L, 0, W - cd);
  }
  mass(b, carve(lot, holes, 'x'), 0, f);
  const tiers = !core ? 0 : grand ? (chance(0.75) ? irange(1, 2) : 0) : (chance(0.3) ? 1 : 0);
  let cur = core;
  let fl = f;
  for (let t = 0; t < tiers && cur; t++) { // (no tiers without a core)
    const next = insetAll(cur, range(2.2, 3.4));
    if (rectW(next) < 6 || rectD(next) < 6) break;
    const tf = irange(1, 3);
    mass(b, [next], fl, fl + tf);
    cur = next;
    fl += tf;
  }
  commit(city, blk, b, { roof: 'prewar', wtP: grand ? 0.5 : 0.75, shops: !grand && shopsOnAvenue(blk, side) ? 'avenue' : 'none' });
}

// Central Park West twin-towered apartment house (San Remo, Eldorado, Century, Majestic)
function twinTower(city: CityBuild, blk: LotBlock, side: 'w' | 'e', lot: Rect) {
  const inner = OPPOSITE[side];
  const L = rectD(lot);
  const W = rectW(lot);
  const b = building(blk, 0, lot);
  const f = irange(14, 17);
  const cd = W * range(0.38, 0.5);
  mass(b, carve(lot, [courtHole(lot, inner, L * range(0.24, 0.32), cd)], 'x'), 0, f);
  const tw = Math.min(W - cd - 2, range(9, 12));
  const td = Math.min(L * 0.36, range(8, 10.5));
  const t1 = irange(6, 9);
  const t2 = irange(2, 3);
  for (const a0 of [1.6, L - 1.6 - td]) {
    const tower = sideRect(lot, side, a0, a0 + td, 1.6, 1.6 + tw);
    mass(b, [tower], f, f + t1);
    mass(b, [insetAll(tower, 1.6)], f + t1, f + t1 + t2);
  }
  commit(city, blk, b, { roof: 'prewar', wtP: 0, shops: 'none' });
}

// Post-war tower on a podium (white / red brick, or glass for the newer condos): shaft pulled back from the
// streets with notched, stepped or cruciform corners; plain parapet & big mechanical penthouse
function postwarTower(city: CityBuild, blk: LotBlock, side: 'w' | 'e', lot: Rect, cfg: TowerCfg, glass: boolean) {
  const L = rectD(lot);
  const W = rectW(lot);
  const mat = glass ? pickW([[3, 3], [5, 3], [4, 1]]) : pickW(cfg.towerMats);
  const b = building(blk, mat, lot);
  const pf = mat >= 3 ? irange(2, 5) : irange(1, 2);
  const f = pf + irange(cfg.tower[0], cfg.tower[1]);
  const plaza = chance(0.3) ? range(3, 6) : 0;
  const podium = sideRect(lot, side, 0, L, plaza, W);
  mass(b, [podium], 0, pf);
  const st = range(1.5, 3.2);
  let shaft = sideRect(lot, side, st, L - st, plaza + range(0, 2.5), W - range(0, 2));
  if (rectW(shaft) < 9 || rectD(shaft) < 9) shaft = podium;
  mass(b, carve(shaft, shapeHoles(shaft, pickW([['notched', 3], ['rect', 2], ['stepped', 1.5], ['plus', 0.8]])), 'x'), pf, f);
  commit(city, blk, b, { cornice: false, roof: 'mech', shops: shopsOnAvenue(blk, side) ? 'avenue' : 'none' });
}

// Through-block pre-war apartment house mid-block: H (front courts on both streets), ring, U or dumbbell plans
function throughApartment(city: CityBuild, blk: LotBlock, lot: Rect, cfg: ResProfile) {
  const b = building(blk, pickW(cfg.prewarMats), lot);
  const W = rectW(lot);
  const D = rectD(lot);
  const f = irange(cfg.prewar[0], cfg.prewar[1]);
  const plan = pickW([['H', 3], ['ring', W >= 18 ? 2 : 0], ['U', 2], ['dumbbell', 2], ['rect', 1]]);
  let holes: Rect[] = [];
  let core: Rect | null = null;
  if (plan === 'H') {
    const cd = D * range(0.2, 0.3);
    holes = [courtHole(lot, 'n', W * range(0.3, 0.42), cd), courtHole(lot, 's', W * range(0.3, 0.42), cd)];
    core = rect(lot.x0, lot.x1, lot.z0 + cd, lot.z1 - cd);
  } else if (plan === 'ring') {
    holes = [insetAll(lot, range(5.5, 7))];
  } else if (plan === 'U') {
    const s = pick<Side>(['n', 's']);
    const cd = D * range(0.3, 0.45);
    holes = [courtHole(lot, s, W * range(0.3, 0.42), cd)];
    core = sideRect(lot, OPPOSITE[s], 0, W, 0, D - cd);
  } else if (plan === 'dumbbell') {
    holes = [courtHole(lot, 'w', D * range(0.25, 0.35), W * range(0.15, 0.22)), courtHole(lot, 'e', D * range(0.25, 0.35), W * range(0.15, 0.22))];
  } else {
    core = lot;
  }
  mass(b, carve(lot, holes, plan === 'dumbbell' ? 'z' : 'x'), 0, f);
  if (core && chance(0.35)) {
    const crown = insetAll(core, range(2.4, 3.4));
    if (rectW(crown) >= 6 && rectD(crown) >= 6) mass(b, [crown], f, f + irange(1, 2));
  }
  commit(city, blk, b, { roof: 'prewar', wtP: 0.75, shops: 'none' });
}

// Corner building(s) along an avenue: `side` is the avenue edge of `lot`, which spans the block's full depth
function avenueEnd(city: CityBuild, blk: LotBlock, side: 'w' | 'e', type: string, lot: Rect, cfg: ResProfile) {
  const inner = OPPOSITE[side];
  if (type === 'walkups') {
    // Two or three walk-ups side by side along the avenue, each its own height, shops below
    const L = rectD(lot);
    const W = rectW(lot);
    const n = L > 24 && chance(0.4) ? 3 : 2;
    const cuts = n === 2
      ? [lot.z0, lot.z0 + L * range(0.42, 0.58), lot.z1]
      : [lot.z0, lot.z0 + L * range(0.3, 0.37), lot.z1 - L * range(0.3, 0.37), lot.z1];
    for (let i = 0; i < n; i++) {
      const sub = rect(lot.x0, lot.x1, cuts[i], cuts[i + 1]);
      const subL = cuts[i + 1] - cuts[i];
      const b = building(blk, pickW(cfg.walkupMats), sub);
      const holes: Rect[] = [];
      if (W > 11 && chance(0.4)) {
        // Light well on the inner corner shared with the next walk-up
        const cw = range(2.4, 3.6);
        const cd = range(2.2, 3.4);
        holes.push(i === 0 ? sideRect(sub, inner, subL - cw, subL + 1, -1, cd) : sideRect(sub, inner, -1, cw, -1, cd));
      }
      const f = irange(cfg.walkup[0], cfg.walkup[1]);
      mass(b, carve(sub, holes, 'x'), 0, f);
      commit(city, blk, b, { roof: 'walkup', wtP: f >= 6 ? 0.45 : 0.12, shops: shopsOnAvenue(blk, side) ? 'all' : 'none' });
    }
  } else if (type === 'low') {
    const b = building(blk, pickW(cfg.walkupMats), lot);
    mass(b, [lot], 0, irange(1, 2));
    commit(city, blk, b, { corniceH: 0.5, roof: 'none' });
  } else if (type === 'loft') {
    loftBuilding(city, blk, lot, cfg.loft ?? LOFT_CHELSEA);
  } else if (type === 'tower' || type === 'glass') {
    postwarTower(city, blk, side, lot, cfg, type === 'glass');
  } else if (type === 'twin') {
    twinTower(city, blk, side, lot);
  } else {
    prewarHouse(city, blk, side, lot, cfg, type === 'grand');
  }
}

export { prewarHouse, twinTower, postwarTower, throughApartment, avenueEnd };
