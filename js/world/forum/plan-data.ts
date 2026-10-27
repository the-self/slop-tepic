// js/world/forum/plan-data.ts
// Forum Tepic's data as the plan (forum-plan.ts) reads it: the buildings' outlines in degrees (OpenStreetMap's ways,
// Overture's footprint of the food court & casino) and the tenants (OpenStreetMap's shops at their places, the chains
// under their parody names, the trades the other locales are dealt). No three.js here.
import { STOREFRONTS } from '../storefronts/index.ts';
import type { Vec2 } from './plan-types.ts';

// ---------------------------------------------------------------------------------------------------------------------
// The outlines (degrees): OpenStreetMap's ways, and Overture's footprint of the food court & casino OSM leaves out
// ---------------------------------------------------------------------------------------------------------------------
/** OSM way 385595701, Forum Tepic */
export const FORUM_OUTLINE: Vec2[] = [[21.4920805, -104.8659543], [21.4920754, -104.8658114], [21.4917718, -104.8658234],
  [21.4917676, -104.8657005], [21.4912415, -104.8657211], [21.4912483, -104.8659065], [21.4914476, -104.8658981],
  [21.4914607, -104.8662788], [21.4914629, -104.8663447], [21.491468, -104.8664918], [21.4914911, -104.8670153],
  [21.4911568, -104.8672003], [21.4911158, -104.8671157], [21.4911055, -104.8670938], [21.4906998, -104.8673148],
  [21.490618, -104.8671398], [21.4901561, -104.867389], [21.4905319, -104.8681936], [21.4909939, -104.8679443],
  [21.4910047, -104.8679681], [21.491812, -104.8675349], [21.4918989, -104.8675323], [21.4918707, -104.8667803],
  [21.4918584, -104.8664435], [21.4920251, -104.8664365], [21.4920167, -104.8663116], [21.4918666, -104.8663129],
  [21.4918657, -104.8662058], [21.4918522, -104.8662059], [21.4918515, -104.8661061], [21.4919275, -104.8661055],
  [21.4919267, -104.8659949], [21.4920143, -104.8659941], [21.492014, -104.8659549]];
/** OSM way 385595704, Liverpool */
export const LIVERPOOL_OUTLINE: Vec2[] = [[21.4920754, -104.8658114], [21.4917718, -104.8658234], [21.4917676, -104.8657005],
  [21.4912415, -104.8657211], [21.4912164, -104.8657221], [21.4911909, -104.8649708], [21.4920733, -104.8649361],
  [21.4920987, -104.8656832], [21.492071, -104.8656843]];
/** OSM way 385595700, the Fiesta Inn */
export const FIESTA_OUTLINE: Vec2[] = [[21.4920974, -104.8664335], [21.492237, -104.8664272], [21.4922201, -104.8659486],
  [21.4920805, -104.8659543], [21.492014, -104.8659549], [21.4920143, -104.8659941], [21.4919267, -104.8659949],
  [21.4919275, -104.8661055], [21.4918515, -104.8661061], [21.4918522, -104.8662059], [21.4918657, -104.8662058],
  [21.4918666, -104.8663129], [21.4920167, -104.8663116], [21.4920251, -104.8664365]];
/** OSM ways 385595720 (a store's block between Sears & the hotel) and 385595721, Sears */
export const NORTH_OUTLINE: Vec2[] = [[21.4920974, -104.8664335], [21.4920251, -104.8664365], [21.4918584, -104.8664435],
  [21.4918707, -104.8667803], [21.4921146, -104.866764]];
export const SEARS_OUTLINE: Vec2[] = [[21.4918989, -104.8675323], [21.4926312, -104.8675005], [21.492603, -104.8667489],
  [21.4921146, -104.866764], [21.4918707, -104.8667803]];
/** Overture's footprint of the food court & the PlayCity casino (as the car park's builder leaves it clear) */
export const FOOD_OUTLINE: Vec2[] = [[21.4916724, -104.8669222], [21.4914694, -104.8664909], [21.4909608, -104.8667641],
  [21.4911638, -104.8671955]];

// ---------------------------------------------------------------------------------------------------------------------
// The tenants: OpenStreetMap's shops in the mall (their places in frame A or B), the rest of the locales' trades
// ---------------------------------------------------------------------------------------------------------------------
// A real business's sign: its chain's parody name where storefronts/ has one (Coppel, Burger King, Subway, Suburbia...)
export function signName(name: string): string {
  const chain = STOREFRONTS.find((s) => s.match.test(name));
  if (!chain) return name.toUpperCase();
  // (a chain's other business keeps its own word: Coppel Canadá, the shoes)
  return name.toUpperCase().replace(chain.match, chain.name);
}
/** The trades the locales OSM doesn't name are filled with (a sign of its trade, as the town's own) */
const TRADES = ['ZAPATERÍA', 'JOYERÍA', 'PERFUMERÍA', 'CELULARES', 'JUGUETERÍA', 'BOUTIQUE', 'DEPORTES', 'ÓPTICA',
  'RELOJERÍA', 'ESTÉTICA', 'MODA', 'LENCERÍA', 'ACCESORIOS', 'TENIS', 'DULCERÍA', 'VIDEOJUEGOS', 'BOLSOS', 'PAPELERÍA',
  'NIEVES', 'CAFETERÍA', 'MODA INFANTIL', 'ARTÍCULOS DE PIEL', 'TELCEL', 'REGALOS', 'LIBRERÍA', 'MUEBLES', 'CREPAS'];
/** OSM's shops along each run, by where they stand along it (m from its start, frame A's u or B's v) */
export type Placed = [number, string];
export const NORTH_A: Placed[] = [[57, 'Shasa'], [79, 'MacStore'], [97, 'Vans'], [117, 'Flexi'], [132, 'Ópticas Lux'], [147, 'Starbucks'], [156, 'Calzzapato']];
export const SOUTH_A: Placed[] = [[99, 'Coppel'], [108, 'Quarry'], [117, 'Marsel'], [131, 'Banjército'], [147, 'Aldo Conti'], [165, 'Coppel Canadá']];
export const WEST_B: Placed[] = [[38, 'C&A'], [80, 'Burger King'], [100, "Chili's"]];
export const EAST_B: Placed[] = [[68, 'DPStreet'], [90, 'Miniso']];
export const ROTUNDA_SHOPS = ['LOB', 'CRISTAL JOYAS', 'DEVLYN'];
/** the food court's stalls along its west side (OSM's, north to south) */
export const STALLS = ['KFC', 'Subway', 'Battitos', 'Los Arieles', 'Pizzeta', 'Gorditas Doña Tota', 'Lonchería Tortugitas', 'Bamboo'];

// a number from a seed, 0..1
export const hash01 = (k: number) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// The trades in a shuffled round, dealt one after another (no trade twice in a few neighbouring locales)
const DEAL = TRADES.map((t, i) => ({ t, k: hash01(i + 17) })).sort((a, b) => a.k - b.k).map(({ t }) => t);
let dealt = 0;
export const trade = () => DEAL[dealt++ % DEAL.length];
