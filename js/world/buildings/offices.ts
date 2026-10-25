// js/world/buildings/offices.ts
// The New York game's office blocks: curtain-wall, Art Deco, slab and supertall towers, the older mid-rises filling
// in around them, and the block plans that place them.
import { postwarTower } from './apartments.ts';
import { chance, irange, pick, pickW, range } from './dice.ts';
import { storeys } from './facades.ts';
import { EPS, carve, insetAll, rect, rectD, rectW, sideRect } from './footprints.ts';
import { building, commit, mass, shapeHoles, slender, streetInset } from './massing.ts';
import type { CityBuild, LotBlock, OfficeProfile, Rect, Side } from './types.ts';

// Curtain-wall tower: full-lot podium, shaft set back from the streets and the party walls (further on big lots) with
// rect / notched / stepped / L corners, often a slimmer crown
function glassTower(city: CityBuild, blk: LotBlock, lot: Rect, cfg: OfficeProfile) {
  const b = building(blk, pickW(cfg.glassMats), lot);
  let f = irange(cfg.towerFloors[0], cfg.towerFloors[1]);
  if (chance(0.12)) f += irange(3, 6);
  f = slender(f, lot, b.mat);
  const pf = Math.min(f - 6, irange(2, 8));
  mass(b, [lot], 0, pf);
  // Clear of the party walls, the shaft is glazed all round above its neighbours
  let shaft = streetInset(b, lot, range(1.5, 3.5), rectW(lot) > 44 ? range(2, 6) : 1.5);
  if (rectW(shaft) < 12 || rectD(shaft) < 12) shaft = streetInset(b, lot, 1);
  const holes = shapeHoles(shaft, pickW(cfg.shaftShapes));
  const crown = insetAll(shaft, range(2, 3.5));
  const f1 = chance(0.45) && rectW(crown) >= 8 && rectD(crown) >= 8 ? Math.max(pf + 4, Math.round(f * range(0.68, 0.82))) : f;
  mass(b, carve(shaft, holes, 'x'), pf, f1);
  if (f1 < f) mass(b, carve(crown, shapeHoles(crown, chance(0.5) ? 'notched' : 'rect'), 'x'), f1, f);
  commit(city, blk, b, { cornice: false, roof: 'mech' });
}

// 1916-zoning "wedding cake": a full-lot base, setback tiers pulled back from the streets, then a tower at least
// ~half the lot wide; a stone cornice on every tier
function decoTower(city: CityBuild, blk: LotBlock, lot: Rect, cfg: OfficeProfile) {
  const b = building(blk, pickW(cfg.decoMats), lot);
  const W = rectW(lot);
  const D = rectD(lot);
  const f = slender(irange(cfg.towerFloors[0], cfg.towerFloors[1]), lot, b.mat);
  const tiers = [lot];
  while (tiers.length < 4) {
    const cur = tiers[tiers.length - 1];
    const d = range(2, 3.4);
    const next = tiers.length === 1 ? streetInset(b, cur, d) : insetAll(cur, d);
    if (rectW(next) < Math.max(10, W * 0.45) || rectD(next) < Math.max(9, D * 0.45)) break;
    tiers.push(next);
  }
  let fl = 0;
  tiers.forEach((t, i) => {
    const last = i === tiers.length - 1;
    const left = f - fl;
    const tf = last ? left : Math.max(2, Math.round(left * (i === 0 ? range(0.38, 0.55) : range(0.35, 0.55))));
    mass(b, last && i > 0 && chance(0.45) ? carve(t, shapeHoles(t, 'notched'), 'x') : [t], fl, fl + tf);
    fl += tf;
  });
  commit(city, blk, b, { roof: 'prewar', wtP: 0.15 });
}

// International Style slab behind an open avenue plaza (Seagram / Sixth Avenue style), sometimes a low rear wing
function slabTower(city: CityBuild, blk: LotBlock, lot: Rect, cfg: OfficeProfile) {
  const b = building(blk, pickW(cfg.glassMats), lot);
  const W = rectW(lot);
  const f = slender(irange(cfg.towerFloors[0], cfg.towerFloors[1]), lot, b.mat);
  const ps = b.street.w && b.street.e ? pick(['w', 'e']) : b.street.w ? 'w' : b.street.e ? 'e' : null;
  const plaza = ps ? Math.min(range(8, 14), W * 0.35) : 0;
  const zIn = range(1.5, 3);
  // Clear of the party wall as well: glazed on all four sides
  const slab = rect(
    lot.x0 + (ps === 'w' ? plaza : b.street.w ? 0 : 2),
    lot.x1 - (ps === 'e' ? plaza : b.street.e ? 0 : 2),
    lot.z0 + (b.street.n ? zIn : 0),
    lot.z1 - (b.street.s ? zIn : 0)
  );
  if (rectW(slab) > 26 && chance(0.4)) {
    const wing = rectW(slab) * range(0.3, 0.42);
    const behindW = ps !== 'e';
    mass(b, [behindW ? rect(slab.x0, slab.x1 - wing, slab.z0, slab.z1) : rect(slab.x0 + wing, slab.x1, slab.z0, slab.z1)], 0, f);
    mass(b, [behindW ? rect(slab.x1 - wing, slab.x1, lot.z0, lot.z1) : rect(slab.x0, slab.x0 + wing, lot.z0, lot.z1)], 0, irange(3, 6));
  } else {
    mass(b, [slab], 0, f);
  }
  commit(city, blk, b, { cornice: false, roof: 'mech' });
}

// Billionaires' Row: one slender supertall on a podium (kept under ~235m so the landmarks still lead the skyline)
function slenderTower(city: CityBuild, blk: LotBlock, lot: Rect) {
  const mat = pickW([[5, 3], [3, 2], [0, 1]]);
  const b = building(blk, mat, lot);
  const s = storeys[mat];
  const f = irange(Math.floor(185 / s), Math.floor(235 / s));
  const pf = irange(3, 6);
  mass(b, [lot], 0, pf);
  const shaft = streetInset(b, lot, range(1, 2), 1.5); // clear of the party walls: glazed all round
  const f1 = f - irange(3, 6);
  mass(b, carve(shaft, shapeHoles(shaft, pickW([['notched', 2], ['rect', 2], ['stepped', 1]])), 'x'), pf, f1);
  mass(b, [insetAll(shaft, range(1.8, 2.6))], f1, f);
  commit(city, blk, b, { cornice: mat <= 2, roof: 'mech' });
}

function officeTower(city: CityBuild, blk: LotBlock, lot: Rect, cfg: OfficeProfile, style: string) {
  if (style === 'deco') decoTower(city, blk, lot, cfg);
  else if (style === 'slab') slabTower(city, blk, lot, cfg);
  else if (style === 'resTower') {
    if ('towerMats' in cfg) postwarTower(city, blk, lot.x0 - blk.minX < EPS ? 'w' : 'e', lot, cfg, false); // (the profiles with residential towers)
  } else glassTower(city, blk, lot, cfg);
}

// Office-block filler: older loft / office buildings (light wells on deep lots, 1916 setbacks when tall), modern
// glass mid-rises, the odd low holdout
function midrise(city: CityBuild, blk: LotBlock, lot: Rect, cfg: OfficeProfile) {
  const mat = pickW(cfg.fillMats);
  const glass = mat >= 3;
  const b = building(blk, mat, lot);
  const W = rectW(lot);
  const D = rectD(lot);
  const f = chance(0.15) ? irange(2, 5) : irange(cfg.fillFloors[0], cfg.fillFloors[1]);
  const holes: Rect[] = [];
  if (!glass && D > 18 && W > 11 && chance(0.5)) {
    const walls = (['w', 'e'] satisfies Side[]).filter((s) => !b.street[s]);
    if (walls.length) {
      const lw = range(3, 5);
      holes.push(sideRect(lot, pick(walls), D * 0.5 - lw * 0.5, D * 0.5 + lw * 0.5, -1, Math.min(W * 0.3, range(2.4, 4))));
    }
  }
  const f1 = !glass && f >= 12 && chance(0.7) ? f - irange(2, 4) : f;
  mass(b, carve(lot, holes, 'x'), 0, f1);
  if (f1 < f) mass(b, carve(streetInset(b, lot, range(2.4, 3.8)), holes, 'x'), f1, f);
  commit(city, blk, b, glass ? { cornice: false, roof: 'mech' } : { roof: 'prewar', wtP: 0.55 });
}

function officeFill(city: CityBuild, blk: LotBlock, a: number, b: number, cfg: OfficeProfile) {
  const { minZ, maxZ } = blk;
  const halfD = (maxZ - minZ) * 0.5;
  let x = a;
  while (b - x > 0.5) {
    let w = range(9, 22);
    if (b - x - w < 7) w = b - x;
    if (w > 18 || chance(0.6)) {
      midrise(city, blk, rect(x, x + w, minZ, maxZ), cfg);
    } else {
      midrise(city, blk, rect(x, x + w, minZ, minZ + halfD), cfg);
      midrise(city, blk, rect(x, x + w, maxZ - halfD, maxZ), cfg);
    }
    x += w;
  }
}

// Office block (Midtown, FiDi, Hudson Yards): a pair of towers on the avenue corners, one big tower (or a slab
// behind a plaza) with older neighbours, or a single full-block tower. Floor plates stay real-sized (towers up to
// ~62 m, slabs ~72 m along the street) however long the block is: the rest of it fills with older buildings
function officeBlock(city: CityBuild, blk: LotBlock, cfg: OfficeProfile, x0: number, x1: number) {
  const { minZ, maxZ } = blk;
  const span = x1 - x0;
  const full = (a: number, b: number) => rect(a, b, minZ, maxZ);
  // Floor-plate caps from a position hash (no dice rolled, so blocks under the caps come out as before)
  const cap = (k: number, lo: number, hi: number) => lo + (hi - lo) * (Math.abs(Math.sin(x0 * 12.9898 + minZ * 78.233 + k * 37.719) * 43758.5453) % 1);
  const plan = span < 34 ? 'full' : pickW(cfg.plans);
  if (plan === 'full') {
    officeTower(city, blk, full(x0, x1), cfg, pickW(cfg.styles));
  } else if (plan === 'slender') {
    const w = Math.min(range(18, 24), span * 0.5);
    let left = range(0, span - w);
    if (left < 8) left = 0;
    else if (span - w - left < 8) left = span - w;
    slenderTower(city, blk, full(x0 + left, x0 + left + w));
    officeFill(city, blk, x0, x0 + left, cfg);
    officeFill(city, blk, x0 + left + w, x1, cfg);
  } else if (plan === 'pair') {
    let wa = Math.min(cap(1, 44, 62), Math.max(18, span * range(0.3, 0.42)));
    let wb = Math.min(cap(2, 44, 62), Math.max(18, span * range(0.3, 0.42)));
    if (span - wa - wb < 9) {
      wa += (span - wa - wb) * 0.5;
      wb = span - wa;
    }
    officeTower(city, blk, full(x0, x0 + wa), cfg, pickW(cfg.styles));
    officeTower(city, blk, full(x1 - wb, x1), cfg, pickW(cfg.styles));
    officeFill(city, blk, x0 + wa, x1 - wb, cfg);
  } else {
    let wm = Math.min(plan === 'plaza' ? cap(3, 58, 72) : cap(3, 46, 62), span * (plan === 'plaza' ? range(0.55, 0.75) : range(0.5, 0.68)));
    if (span - wm < 9) wm = span;
    const atW = chance(0.5);
    officeTower(city, blk, atW ? full(x0, x0 + wm) : full(x1 - wm, x1), cfg, plan === 'plaza' ? 'slab' : pickW(cfg.styles));
    if (atW) officeFill(city, blk, x0 + wm, x1, cfg);
    else officeFill(city, blk, x0, x1 - wm, cfg);
  }
}

export { officeBlock };
