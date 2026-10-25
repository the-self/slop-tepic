// js/world/buildings/layouts.ts
// The block layouts: each fills a block's lots for its profile's kind (residential, loft, office, projects,
// low-rise, riverfront).
import { WALL_KINDS } from '../../render/tsl-materials.ts';
import { avenueEnd, throughApartment } from './apartments.ts';
import { chance, irange, pick, pickW, range } from './dice.ts';
import { MEX, storeys } from './facades.ts';
import { EPS, carve, cornerHoles, courtHole, rect } from './footprints.ts';
import { loftBlock } from './lofts.ts';
import { building, commit, mass } from './massing.ts';
import { officeBlock } from './offices.ts';
import { fillFrontage } from './rows.ts';
import type {
  CityBuild,
  LayoutMap,
  LotBlock,
  LowriseProfile,
  ProfileMap,
  ProjectsProfile,
  Rect,
  ResProfile,
  RiverProfile,
  Span
} from './types.ts';

// ============================================================================
// BLOCK LAYOUTS: each fills the block's x range [x0, x1] (the full block unless a billboard wall took an end)
// ============================================================================
const END_WIDTH: Record<string, Span> = {
  walkups: [10, 15],
  prewar: [15, 22],
  grand: [17, 25],
  twin: [24, 30],
  tower: [17, 26],
  glass: [16, 24],
  loft: [14, 22],
  low: [8, 14]
};

// Residential block: apartment houses on the avenue corners, rows of brownstones / tenements / walk-ups along
// both side streets, their rear yards forming the block's green "donut hole"
function residentialBlock(city: CityBuild, blk: LotBlock, cfg: ResProfile, x0: number, x1: number) {
  const span = x1 - x0;
  const tW = x0 - blk.minX < EPS ? pickW(cfg.ends.w) : 'none';
  const tE = blk.maxX - x1 < EPS ? pickW(cfg.ends.e) : 'none';
  let wW = tW === 'none' ? 0 : range(END_WIDTH[tW][0], END_WIDTH[tW][1]);
  let wE = tE === 'none' ? 0 : range(END_WIDTH[tE][0], END_WIDTH[tE][1]);
  blk.yards.push(rect(x0 + 2, x1 - 2, blk.minZ + 2.5, blk.maxZ - 2.5));

  if (span - wW - wE < 7 && (wW > 0 || wE > 0)) {
    if (span < 24 || wW === 0 || wE === 0) {
      // No room for a mid-block: one apartment house takes the whole lot
      const side = wW > 0 ? 'w' : 'e';
      avenueEnd(city, blk, side, side === 'w' ? tW : tE, rect(x0, x1, blk.minZ, blk.maxZ), cfg);
      return;
    }
    wW = span * (wW / (wW + wE));
    wE = span - wW;
  }
  if (wW > 0) avenueEnd(city, blk, 'w', tW, rect(x0, x0 + wW, blk.minZ, blk.maxZ), cfg);
  if (wE > 0) avenueEnd(city, blk, 'e', tE, rect(x1 - wE, x1, blk.minZ, blk.maxZ), cfg);

  // Mid-block: maybe one through-block apartment house, rows of lots on both side streets around it
  const mx0 = x0 + wW;
  const mx1 = x1 - wE;
  if (mx1 - mx0 < 0.5) return;
  const mid = mx1 - mx0;
  let segs = [[mx0, mx1]];
  if (mid >= 24 && chance(cfg.through)) {
    let tw = range(16, 28);
    if (mid - tw < 7) tw = mid;
    const free = mid - tw;
    const left = free < 14 ? (chance(0.5) ? 0 : free) : pick([0, free, range(7, free - 7)]);
    throughApartment(city, blk, rect(mx0 + left, mx0 + left + tw, blk.minZ, blk.maxZ), cfg);
    segs = [[mx0, mx0 + left], [mx0 + left + tw, mx1]];
  }
  for (const [a, b] of segs) {
    if (b - a < 0.5) continue;
    fillFrontage(city, blk, a, b, 'n', cfg);
    fillFrontage(city, blk, a, b, 's', cfg);
  }
}

// NYCHA "towers in the park": cruciform, H or T red-brick towers on lawns, set back from every street
function projectsBlock(city: CityBuild, blk: LotBlock, cfg: ProjectsProfile, x0: number, x1: number) {
  const { minZ, maxZ, cz } = blk;
  const D = maxZ - minZ;
  const n = Math.max(1, Math.min(3, Math.round((x1 - x0) / 34)));
  const slot = (x1 - x0) / n;
  blk.yards.push(rect(x0 + 1.5, x1 - 1.5, minZ + 1.5, maxZ - 1.5));
  for (let k = 0; k < n; k++) {
    const tw = Math.min(slot - 7, range(18, 24));
    const td = Math.min(D - 5, range(16.5, 20));
    if (tw < 12 || td < 12) continue;
    const cx = x0 + slot * (k + 0.5) + range(-1.5, 1.5);
    const zc = cz + range(-0.8, 0.8);
    const r = rect(cx - tw * 0.5, cx + tw * 0.5, zc - td * 0.5, zc + td * 0.5);
    const b = building(blk, pickW(cfg.mats), r);
    const shape = pickW([['plus', 4], ['H', 2], ['T', 1.5]]);
    let holes: Rect[];
    if (shape === 'plus') {
      holes = cornerHoles(r, tw * range(0.27, 0.31), td * range(0.26, 0.3));
    } else if (shape === 'H') {
      const cd = td * range(0.28, 0.36);
      holes = [courtHole(r, 'n', tw * range(0.3, 0.4), cd), courtHole(r, 's', tw * range(0.3, 0.4), cd)];
    } else {
      holes = cornerHoles(r, tw * 0.32, td * range(0.4, 0.5), pick([['sw', 'se'], ['nw', 'ne']]));
    }
    mass(b, carve(r, holes, 'x'), 0, irange(cfg.floors[0], cfg.floors[1]));
    commit(city, blk, b, { cornice: false, roof: 'mech', hvacH: 3, awnings: false, shops: 'none', freestanding: true });
  }
}

// Low-rise waterfront blocks: warehouses, garages and small walk-ups (keeps the East River skyline view open)
function lowriseBlock(city: CityBuild, blk: LotBlock, cfg: LowriseProfile, x0: number, x1: number) {
  const { minZ, maxZ } = blk;
  const halfD = (maxZ - minZ) * 0.5;
  const [w0, w1] = cfg.lotW ?? [10, 26];
  let x = x0;
  while (x1 - x > 0.5) {
    let w = range(w0, w1);
    if (x1 - x - w < 8) w = x1 - x;
    const lots = chance(0.6)
      ? [rect(x, x + w, minZ, maxZ)]
      : [rect(x, x + w, minZ, minZ + halfD), rect(x, x + w, maxZ - halfD, maxZ)];
    for (const lot of lots) {
      const mat = cfg.tepic ? MEX : pickW([[1, 4], [0, 3], [3, 1]]);
      const f = irange(cfg.floors[0], cfg.floors[1]);
      const b = building(blk, mat, lot);
      mass(b, [lot], 0, f);
      if (cfg.tepic) commit(city, blk, b, { cornice: chance(0.25), corniceH: 0.4, roof: 'none', wtP: 0, shops: cfg.floors[1] >= 3 ? 'all' : 0.3 });
      else commit(city, blk, b, { cornice: mat <= 2 && chance(0.6), corniceH: 0.6, roof: f >= 5 ? 'walkup' : 'none', wtP: 0.3 });
    }
    x += w;
  }
}

// East River lots between 1st Ave and the FDR Drive (23rd–58th St), too narrow for regular lots: a 2-4 storey podium
// with a slab rising from it, as tall as the lot is wide allows (Kips Bay & NYU Langone hospital slabs, glass towers
// on the old Con Ed site at 35th–41st St, Beekman & Sutton Place apartment towers). On the 42nd–45th St superblock
// stands the United Nations Secretariat (1952): a blue-green curtain-wall slab between marble end walls, with the
// low General Assembly hall and the North Lawn Building on the lots north of it.
function riverfrontBlock(city: CityBuild, blk: LotBlock, _cfg: RiverProfile, x0: number, x1: number) {
  const { minZ, maxZ, cz } = blk;
  const lot = rect(x0, x1, minZ, maxZ);
  if (cz > -85 && cz < -10 && maxZ - minZ > 45) {
    const f = 36;
    const glass = building(blk, 3, lot);
    mass(glass, [rect(x0, x1, minZ + 2.4, maxZ - 2.4)], 0, f);
    commit(city, blk, glass, { cornice: false, roof: 'none' });
    const top = Math.round((f * storeys[3]) / storeys[0]);
    for (const [z0, z1] of [[minZ + 1, minZ + 2.4], [maxZ - 2.4, maxZ - 1]]) {
      const end = building(blk, 0, rect(x0 - 0.3, x1 + 0.3, z0, z1));
      mass(end, [rect(x0 - 0.3, x1 + 0.3, z0, z1)], 0, top);
      commit(city, blk, end, { cornice: false, roof: 'none', walls: WALL_KINDS.blankStone }); // windowless marble
    }
    return;
  }
  if (cz > -180 && cz < -90) {
    const hall = building(blk, 0, lot);
    mass(hall, [lot], 0, cz > -130 ? 7 : 4);
    commit(city, blk, hall, { cornice: false, roof: 'mech', hvacH: 2.6 });
    return;
  }
  const mat = cz > 180
    ? pickW([[0, 3], [3, 2], [1, 1]])
    : cz > 0 ? pickW([[5, 2], [3, 2], [4, 1], [1, 1]]) : pickW([[0, 4], [1, 2], [3, 1]]);
  const b = building(blk, mat, lot);
  const pf = irange(2, 4);
  mass(b, [lot], 0, pf);
  const sx = Math.max(0, Math.min(1.8, (x1 - x0 - 9) * 0.5));
  const slab = rect(x0 + sx, x1 - sx, minZ + range(1, 3), maxZ - range(1, 3));
  const f = cz > 180 ? irange(12, 24) : cz > 0 ? irange(26, 42) : irange(18, 34);
  mass(b, [slab], pf, Math.max(pf + 6, Math.min(f, Math.floor(((x1 - x0) * 8) / storeys[mat]))));
  commit(city, blk, b, mat <= 2 ? { roof: 'prewar', wtP: 0.35, corniceH: 0.6 } : { cornice: false, roof: 'mech' });
}

const LAYOUTS: LayoutMap = {
  res: residentialBlock,
  loft: loftBlock,
  office: officeBlock,
  projects: projectsBlock,
  lowrise: lowriseBlock,
  river: riverfrontBlock
};
// (each profile to its own kind's layout)
const layOut = <K extends keyof ProfileMap>(city: CityBuild, kind: K, blk: LotBlock, cfg: ProfileMap[K], x0: number, x1: number) => {
  LAYOUTS[kind](city, blk, cfg, x0, x1);
};

export { layOut };
