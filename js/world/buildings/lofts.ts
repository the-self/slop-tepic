// js/world/buildings/lofts.ts
// The New York game's loft buildings (light wells, 1916 setbacks) and the loft blocks filled with them.
import { chance, irange, pick, pickW, range } from './dice.ts';
import { EPS, carve, courtHole, rect, rectD, rectW, sideRect } from './footprints.ts';
import { building, commit, mass, streetInset } from './massing.ts';
import type { CityBuild, LoftProfile, LotBlock, Rect, Side } from './types.ts';

// Loft building filling its lot: light well / rear yard, 1916 setbacks on the tall ones
function loftBuilding(city: CityBuild, blk: LotBlock, lot: Rect, cfg: LoftProfile) {
  const b = building(blk, pickW(cfg.mats), lot);
  const W = rectW(lot);
  const D = rectD(lot);
  const through = b.street.n && b.street.s;
  const f = irange(cfg.floors[0], cfg.floors[1]);
  const holes: Rect[] = [];
  if (!through) {
    const rear = b.street.n ? 's' : 'n';
    if (chance(0.45)) holes.push(sideRect(lot, rear, -1, W + 1, -1, D * range(0.1, 0.28)));
    else if (W > 12 && chance(0.4)) holes.push(courtHole(lot, rear, W * range(0.3, 0.45), D * range(0.25, 0.4)));
  } else if (D > 18 && W > 10 && chance(0.45)) {
    const walls = (['w', 'e'] satisfies Side[]).filter((s) => !b.street[s]);
    if (walls.length) {
      const lw = range(3, 5.5);
      holes.push(sideRect(lot, pick(walls), D * 0.5 - lw * 0.5, D * 0.5 + lw * 0.5, -1, Math.min(W * 0.32, range(2.4, 4))));
    }
  }
  const axis = through ? 'x' : 'z';
  const cuts = [f];
  if (f >= cfg.setbackAt && chance(0.75)) {
    cuts.unshift(f - irange(2, Math.min(5, f - 8)));
    if (f >= cfg.setbackAt + 6 && chance(0.6)) cuts.unshift(cuts[0] - irange(3, 6));
  }
  let fl = 0;
  let foot = lot;
  cuts.forEach((c, i) => {
    if (i > 0) foot = streetInset(b, foot, range(2.4, 3.8));
    mass(b, carve(foot, holes, axis), fl, c);
    fl = c;
  });
  commit(city, blk, b, { roof: 'walkup', wtP: cfg.wtP });
}

// Loft block (SoHo, Tribeca, NoHo, Garment District, Chelsea, Flatiron): full lot coverage, corner lofts through to
// both streets, stretches of independent half-depth lofts back to back between them
function loftBlock(city: CityBuild, blk: LotBlock, cfg: LoftProfile, x0: number, x1: number) {
  const { minZ, maxZ } = blk;
  const halfD = (maxZ - minZ) * 0.5;
  const minW = cfg.lotW[0] * 0.7;
  blk.yards.push(rect(x0 + 2, x1 - 2, minZ + 3, maxZ - 3));
  let x = x0;
  while (x1 - x > 0.5) {
    if (x - blk.minX < EPS || chance(cfg.throughP)) {
      let w = range(cfg.lotW[0], cfg.lotW[1]);
      if (x1 - x - w < minW) w = x1 - x;
      loftBuilding(city, blk, rect(x, x + w, minZ, maxZ), cfg);
      x += w;
      continue;
    }
    let len = range(18, 40);
    if (x1 - x - len < minW) len = x1 - x;
    for (const side of ['n', 's']) {
      let xx = x;
      while (x + len - xx > 0.5) {
        let w = range(cfg.lotW[0], cfg.lotW[1]);
        if (x + len - xx - w < minW) w = x + len - xx;
        loftBuilding(city, blk, side === 'n' ? rect(xx, xx + w, minZ, minZ + halfD) : rect(xx, xx + w, maxZ - halfD, maxZ), cfg);
        xx += w;
      }
    }
    x += len;
  }
}

export { loftBuilding, loftBlock };
