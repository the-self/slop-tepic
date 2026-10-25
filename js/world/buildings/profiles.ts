// js/world/buildings/profiles.ts
// The neighbourhood profiles: what each block layout reads for a block by its district (Tepic's centro, colonias &
// industrial zones; the New York game's neighbourhoods), and the corner types by the avenue a block end faces.
import { ALL_AVENUES, CENTRAL_PARK_BOUNDS, streetZ, avenueX } from '../city-config.ts';
import { chance } from './dice.ts';
import type { GridAvenue } from '../city-config.ts';
import type {
  BlockDetail,
  BlockProfile,
  EndTable,
  LoftProfile,
  LowriseProfile,
  OfficeBase,
  OfficeProfile,
  ProjectsProfile,
  ResProfile,
  RiverProfile,
  Weighted
} from './types.ts';

// ============================================================================
// NEIGHBOURHOOD PROFILES
// ============================================================================
const RES_BASE: ResProfile = {
  kind: 'res',
  walkup: [5, 6],
  prewar: [10, 15],
  grand: [13, 18],
  tower: [18, 32],
  walkupMats: [[1, 6], [2, 2], [0, 2]],
  prewarMats: [[0, 6], [1, 4]],
  grandMats: [[0, 8], [1, 2]],
  towerMats: [[0, 6], [1, 3]],
  through: 0.22,
  rows: [['brownstone', 5], ['tenement', 2.5], ['midApt', 2], ['postwarApt', 1]],
  ends: { w: [['prewar', 1]], e: [['prewar', 1]] }
};
const res = (o: Partial<ResProfile>): ResProfile => ({ ...RES_BASE, ...o });
const bothEnds = (table: Weighted<string>) => ({ w: table, e: table });

// What each avenue's corners tend to be (by the avenue a block end faces)
const AVE_ENDS: EndTable = {
  riverside: [['grand', 5], ['prewar', 3], ['tower', 1]],
  wea: [['prewar', 6], ['grand', 2], ['tower', 1]],
  broadway: [['grand', 3], ['prewar', 3], ['tower', 2], ['walkups', 2]],
  amsterdam: [['walkups', 5], ['prewar', 2], ['tower', 2]],
  columbus: [['walkups', 4], ['prewar', 2], ['tower', 3]],
  cpw: [['grand', 4], ['twin', 2], ['prewar', 2]],
  seventh: [['prewar', 3], ['walkups', 3], ['tower', 1]],
  lenox: [['prewar', 3], ['walkups', 3], ['tower', 1]],
  fifth: [['grand', 6], ['tower', 1]],
  madison: [['prewar', 4], ['walkups', 3], ['grand', 1]],
  park: [['grand', 5], ['prewar', 3]],
  lex: [['walkups', 4], ['prewar', 3], ['tower', 2]],
  third: [['tower', 6], ['prewar', 1], ['walkups', 1]],
  second: [['walkups', 4], ['tower', 3], ['prewar', 1]],
  first: [['walkups', 4], ['tower', 3], ['prewar', 1]],
  york: [['tower', 4], ['prewar', 2], ['walkups', 2]],
  water: [['tower', 3], ['prewar', 2], ['walkups', 1]]
};
// Corner type of each real avenue line (city-config.ts ALL_AVENUES ids), by where along it a block stands
function avenueKind(ave: GridAvenue, z: number) {
  const uptown = z < streetZ(59);
  const harlem = z < streetZ(110);
  switch (ave.id) {
    case 'riverside': return 'riverside';
    case '11': return uptown ? 'wea' : 'amsterdam';
    case '10': return 'amsterdam';
    case '9':
    case 'manhattan': return 'columbus';
    case '8': return uptown && !harlem ? 'cpw' : 'seventh';
    case '7': return 'seventh';
    case '6': return 'lenox';
    case '5': return 'fifth';
    case 'madison':
    case 'vanderbilt':
    case 'university': return 'madison';
    case 'park': return 'park';
    case 'lex':
    case 'irving': return 'lex';
    case '3': return 'third';
    case '2': return 'second';
    case '1': return 'first';
    default: return 'york'; // York / East End Aves, Aves A-D
  }
}

// Avenue faced by the block edge at x (`dir` -1: the avenue to its west, +1: to its east): the nearest avenue line
// running past that z, ~10-25 m beyond the property line (its roadway & sidewalk)
function avenueName(x: number, dir: number, cz: number) {
  let best: GridAvenue | null = null;
  for (const ave of ALL_AVENUES) {
    if (ave.isHighway || cz < ave.minZ - 20 || cz > ave.maxZ + 20) continue;
    const d = (ave.x - x) * dir;
    if (d > 0 && d < 45 && (!best || d < (best.x - x) * dir)) best = ave;
  }
  if (!best) return 'water';
  return avenueKind(best, cz);
}
const avenueEnds = (blk: BlockDetail, table = AVE_ENDS) => ({
  w: table[avenueName(blk.minX, -1, blk.cz)] ?? table.water,
  e: table[avenueName(blk.maxX, 1, blk.cz)] ?? table.water
});
// Corner apartment houses keep shops on the avenue, except where doormen line it: Fifth & Park Avenues, Central Park
// West, West End Avenue, Riverside Drive and the waterfront drives
const QUIET_AVENUES = new Set(['fifth', 'park', 'cpw', 'wea', 'riverside', 'water']);
const shopsOnAvenue = (blk: BlockDetail, side: 'w' | 'e') => !QUIET_AVENUES.has(side === 'w' ? avenueName(blk.minX, -1, blk.cz) : avenueName(blk.maxX, 1, blk.cz));

const RES_HELLS_KITCHEN = res({
  ends: bothEnds([['walkups', 5], ['tower', 2], ['glass', 1], ['prewar', 1]]),
  prewar: [7, 12],
  tower: [16, 34],
  rows: [['tenement', 7], ['brownstone', 1.5], ['midApt', 1], ['low', 0.6]],
  through: 0.1
});
const RES_EAST_MIDTOWN = res({
  ends: bothEnds([['tower', 4], ['prewar', 3], ['walkups', 2], ['glass', 1]]),
  tower: [20, 36],
  rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1.5]],
  through: 0.25
});
const RES_MURRAY_HILL = res({
  ends: bothEnds([['prewar', 4], ['tower', 3], ['walkups', 2], ['grand', 1]]),
  prewar: [10, 17],
  tower: [18, 34],
  rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1]],
  through: 0.3
});
const RES_UES_SOUTH = res({
  ends: { w: [['grand', 3], ['tower', 3], ['glass', 1]], e: [['tower', 3], ['prewar', 2], ['glass', 1]] },
  prewar: [12, 18],
  grand: [14, 20],
  tower: [22, 38],
  rows: [['townhouse', 3], ['brownstone', 2], ['midApt', 3], ['postwarApt', 2]],
  through: 0.3
});
const RES_GRAMERCY = res({
  ends: bothEnds([['prewar', 4], ['tower', 2], ['walkups', 2]]),
  prewar: [9, 16],
  tower: [16, 28],
  rows: [['brownstone', 4], ['midApt', 3], ['postwarApt', 2], ['tenement', 1]],
  through: 0.3
});
const RES_CHELSEA = res({
  ends: bothEnds([['walkups', 4], ['prewar', 2], ['tower', 1.5], ['loft', 1]]),
  prewar: [8, 14],
  tower: [14, 26],
  rows: [['brownstone', 3], ['tenement', 3], ['rowhouse', 2], ['midApt', 1], ['loft', 1]],
  through: 0.15
});
const RES_WEST_VILLAGE = res({
  ends: bothEnds([['none', 3], ['walkups', 4], ['prewar', 1.5], ['loft', 1]]),
  walkup: [4, 6],
  prewar: [7, 14],
  rows: [['rowhouse', 5], ['tenement', 3], ['brownstone', 2], ['midApt', 1], ['loft', 0.8]],
  kf: { midApt: [6, 12] },
  through: 0.12
});
const RES_VILLAGE_CORE = res({
  ends: bothEnds([['prewar', 4], ['grand', 1], ['tower', 1], ['walkups', 2]]),
  prewar: [9, 16],
  grand: [12, 18],
  tower: [14, 24],
  rows: [['brownstone', 3], ['rowhouse', 2], ['midApt', 3], ['postwarApt', 1], ['tenement', 1]],
  through: 0.3
});
const RES_EAST_VILLAGE = res({
  ends: bothEnds([['walkups', 6], ['prewar', 1], ['tower', 0.5], ['none', 1]]),
  prewar: [7, 12],
  tower: [12, 20],
  rows: [['tenement', 8], ['rowhouse', 0.6], ['midApt', 0.8], ['garden', 0.5], ['low', 0.4]],
  through: 0.06
});
const RES_LES = res({
  ends: bothEnds([['walkups', 6], ['tower', 1], ['none', 1]]),
  tower: [14, 22],
  rows: [['tenement', 9], ['low', 0.6], ['garden', 0.4], ['midApt', 0.5]],
  through: 0.05
});
const RES_UPTOWN = res({ prewar: [10, 15], grand: [13, 18], tower: [18, 32], through: 0.25 });
const RES_HARLEM = res({
  walkup: [4, 6],
  prewar: [6, 9],
  grand: [7, 10],
  tower: [12, 20],
  rows: [['brownstone', 7], ['tenement', 2.5], ['midApt', 1], ['garden', 0.4]],
  kf: { brownstone: [3, 4], midApt: [5, 7] },
  ends: bothEnds([['walkups', 4], ['prewar', 3], ['tower', 0.4]]),
  through: 0.1
});
const RES_EAST_HARLEM = res({
  walkup: [4, 6],
  prewar: [6, 8],
  tower: [14, 22],
  rows: [['tenement', 7], ['brownstone', 1], ['garden', 0.5], ['low', 0.6]],
  ends: bothEnds([['walkups', 6], ['tower', 1], ['low', 1]]),
  through: 0.04
});

const LOFT_BASE: LoftProfile = { kind: 'loft', lotW: [8, 20], throughP: 0.35, floors: [6, 10], mats: [[1, 5], [0, 4], [2, 1]], setbackAt: 99, wtP: 0.65 };
const LOFT_SOHO: LoftProfile = { ...LOFT_BASE, floors: [5, 7], lotW: [7.5, 16], mats: [[0, 4], [1, 5], [2, 1]] };
const LOFT_NOHO: LoftProfile = { ...LOFT_BASE, floors: [6, 12], lotW: [9, 20], throughP: 0.45, setbackAt: 11 };
const LOFT_TRIBECA: LoftProfile = { ...LOFT_BASE, floors: [6, 11], lotW: [9, 22], throughP: 0.45 };
const LOFT_CHELSEA: LoftProfile = { ...LOFT_BASE, floors: [5, 12], lotW: [10, 24], throughP: 0.5, setbackAt: 12 };
const LOFT_CHELSEA_WEST: LoftProfile = { ...LOFT_BASE, floors: [2, 8], lotW: [14, 30], throughP: 0.7, wtP: 0.4 };
const LOFT_FLATIRON: LoftProfile = { ...LOFT_BASE, floors: [8, 14], lotW: [10, 22], throughP: 0.5, setbackAt: 12 };
const LOFT_NOMAD: LoftProfile = { ...LOFT_BASE, floors: [10, 20], lotW: [10, 24], throughP: 0.55, setbackAt: 13, wtP: 0.6 };
const LOFT_GARMENT: LoftProfile = { ...LOFT_BASE, floors: [12, 24], lotW: [12, 26], throughP: 0.6, setbackAt: 14, wtP: 0.55, mats: [[0, 5], [1, 5]] };
const LOFT_GARMENT_SOUTH: LoftProfile = { ...LOFT_GARMENT, floors: [9, 18], setbackAt: 12 };

const OFFICE_MIDTOWN: OfficeBase = {
  kind: 'office',
  plans: [['pair', 4], ['major', 4], ['full', 1.5], ['plaza', 1.5]],
  styles: [['glass', 5], ['deco', 3], ['slab', 1.2]],
  towerFloors: [24, 44],
  glassMats: [[3, 4], [4, 3], [5, 2]],
  decoMats: [[0, 6], [1, 3]],
  fillMats: [[0, 5], [1, 4], [3, 1], [4, 1]],
  fillFloors: [6, 20],
  shaftShapes: [['rect', 3], ['notched', 3], ['stepped', 2], ['L', 1]]
};
const OFFICE_FIDI: OfficeProfile = {
  ...OFFICE_MIDTOWN,
  plans: [['pair', 4], ['major', 4], ['full', 2], ['plaza', 1]],
  styles: [['deco', 4], ['glass', 4], ['slab', 2]],
  towerFloors: [22, 46],
  fillFloors: [8, 24]
};
const OFFICE_HUDSON_YARDS: OfficeProfile = {
  ...OFFICE_MIDTOWN,
  plans: [['full', 3], ['major', 2], ['pair', 2]],
  styles: [['glass', 1]],
  towerFloors: [34, 54],
  glassMats: [[5, 5], [3, 3]],
  fillMats: [[3, 1], [5, 1], [1, 1]],
  fillFloors: [8, 18]
};
const OFFICE_BILLIONAIRES: OfficeProfile = { ...OFFICE_MIDTOWN, plans: [['slender', 1]], fillMats: [[0, 5], [1, 3], [3, 1]], fillFloors: [10, 22] };
const OFFICE_BATTERY_PARK_CITY: OfficeProfile = {
  ...OFFICE_MIDTOWN,
  plans: [['pair', 3], ['major', 2], ['plaza', 2]],
  styles: [['glass', 3], ['resTower', 2]],
  towerFloors: [18, 38],
  tower: [16, 34],
  towerMats: [[1, 3], [0, 2]],
  fillMats: [[1, 3], [0, 2], [3, 1]],
  fillFloors: [8, 16]
};

const PROJECTS: ProjectsProfile = { kind: 'projects', floors: [12, 20], mats: [[1, 8], [0, 2]] };
const PROJECTS_STUY_TOWN: ProjectsProfile = { ...PROJECTS, floors: [12, 14], mats: [[1, 1]] };
const LOWRISE: LowriseProfile = { kind: 'lowrise', floors: [2, 7] };
const RIVERFRONT: RiverProfile = { kind: 'river' };
// Tepic: one- and two-storey houses with flat roofs on the colonias, two to four storeys of shops, hotels and offices
// around the plaza; no water towers, no fire escapes
const TEPIC_COLONIA: LowriseProfile = { kind: 'lowrise', floors: [1, 2], tepic: true, lotW: [7, 14] };
const TEPIC_CENTRO: LowriseProfile = { kind: 'lowrise', floors: [2, 4], tepic: true, lotW: [8, 18] };
const TEPIC_INDUSTRIAL: LowriseProfile = { kind: 'lowrise', floors: [1, 2], tepic: true, lotW: [18, 40] };

const CPB = CENTRAL_PARK_BOUNDS;
function uptownProfile(blk: BlockDetail): ResProfile {
  const { cx, cz } = blk;
  // (no Central Park in Tepic: CPB is null)
  const nearPark = !!CPB && ((cx > avenueX('9') + 20 && cx < CPB.minX) || (cx > CPB.maxX && cx < avenueX('lex') + 20));
  const rows: Weighted<string> = nearPark
    ? [['brownstone', 6], ['townhouse', cx > 0 ? 3 : 1], ['midApt', 2], ['tenement', 0.6]]
    : cx > avenueX('3')
      ? [['tenement', 6], ['brownstone', 1.5], ['midApt', 1.5], ['postwarApt', 1.5]] // Yorkville
      : [['brownstone', 5], ['tenement', 2.5], ['midApt', 2], ['postwarApt', 1]];
  if (cz > streetZ(66) && cx > 0) return { ...RES_UES_SOUTH, ends: avenueEnds(blk) }; // 59th-66th St, east side
  return { ...RES_UPTOWN, rows, ends: avenueEnds(blk) };
}

function harlemProfile(blk: BlockDetail) {
  // Morningside & Hamilton Heights (west of Manhattan Ave), Central Harlem, East Harlem
  return res({
    prewar: [8, 13],
    grand: [10, 14],
    tower: [14, 24],
    rows: [['brownstone', 3], ['midApt', 3], ['tenement', 2.5]],
    ends: avenueEnds(blk),
    through: 0.25
  });
}

// Profile of a block by its real neighbourhood (city-config.ts districtAt)
function blockProfile(blk: BlockDetail, district: string): BlockProfile {
  switch (district) {
    case 'centro': return TEPIC_CENTRO;
    case 'colonia': return chance(0.08) ? TEPIC_CENTRO : TEPIC_COLONIA;
    case 'industrial': return TEPIC_INDUSTRIAL;
    case 'riverfront': return RIVERFRONT;
    case 'hudson_yards': return OFFICE_HUDSON_YARDS;
    case 'billionaires_row': return chance(0.6) ? OFFICE_BILLIONAIRES : OFFICE_MIDTOWN;
    case 'midtown': return OFFICE_MIDTOWN;
    case 'garment': return blk.cz > streetZ(36) ? LOFT_GARMENT_SOUTH : LOFT_GARMENT;
    case 'murray_hill': return RES_MURRAY_HILL;
    case 'turtle_bay': return RES_EAST_MIDTOWN;
    case 'hells_kitchen': return RES_HELLS_KITCHEN;
    case 'west_chelsea': return LOFT_CHELSEA_WEST;
    case 'chelsea': return chance(0.55) ? RES_CHELSEA : LOFT_CHELSEA;
    case 'flatiron': return LOFT_FLATIRON;
    case 'nomad': return LOFT_NOMAD;
    case 'gramercy': return RES_GRAMERCY;
    case 'stuy_town': return PROJECTS_STUY_TOWN;
    case 'uws':
    case 'ues': return uptownProfile(blk);
    case 'morningside': return harlemProfile(blk);
    case 'harlem': return chance(0.15) ? PROJECTS : RES_HARLEM;
    case 'east_harlem': return chance(0.35) ? PROJECTS : RES_EAST_HARLEM;
    case 'village': return chance(0.4) ? LOFT_NOHO : RES_VILLAGE_CORE;
    case 'west_village': return blk.cx < avenueX('11') ? (chance(0.5) ? LOFT_CHELSEA_WEST : RES_WEST_VILLAGE) : RES_WEST_VILLAGE;
    case 'east_village': return blk.cx > avenueX('eastend') + 150 ? PROJECTS : RES_EAST_VILLAGE;
    case 'soho': return LOFT_SOHO;
    case 'little_italy': return chance(0.5) ? LOFT_SOHO : RES_LES;
    case 'hudson_square':
    case 'tribeca': return LOFT_TRIBECA;
    case 'chinatown': return RES_LES;
    case 'lower_east_side': return chance(0.3) ? PROJECTS : RES_LES;
    case 'civic_center':
    case 'fidi': return OFFICE_FIDI;
    case 'battery_park_city': return OFFICE_BATTERY_PARK_CITY;
    default: return OFFICE_MIDTOWN;
  }
}

export { LOWRISE, LOFT_CHELSEA, shopsOnAvenue, blockProfile };
