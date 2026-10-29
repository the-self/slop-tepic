// js/world/place-claims.ts
// What a place built on its own (js/places/: the UAN's campus, Forum Tepic, the Central de Autobuses...) claims of the
// ground before the town is built round it: where the generic houses, the town's trees, the bardas and the street's
// lamps & furniture keep off. Each place says it in its plan (three-free) and app/city.ts hands the list down to the
// builders here, which don't import the places (they stand higher in the layers: tests/layers.test.cjs).
import type { LotReserve } from './landmark-models.ts';
import type { TreeSite } from './lot-greenery.ts';

export interface PlaceClaims {
  /** its lots, where no generic house stands (buildings/houses.ts) */
  houses?: LotReserve;
  /** where the town plants no tree, in the yards or on the sidewalks (street-details.ts) */
  trees?: LotReserve;
  /** ground no barda of ours closes off, OpenStreetMap's walls still standing (bardas.ts keepOpen) */
  open?: (x: number, z: number) => boolean;
  /** ground it walls itself: neither OpenStreetMap's walls nor ours stand on it (bardas.ts claimed) */
  walled?: (x: number, z: number) => boolean;
  /** within `pad` m of one of its buildings: no lamp, goal, curb furniture, pole or tree (city-grid.ts, street-details.ts) */
  nearBuilding?: (x: number, z: number, pad: number) => boolean;
  /** its grounds planted by itself: the town's yard trees there give way to its `trees()` (street-details.ts) */
  garden?: { grounds: (x: number, z: number) => boolean; trees: () => TreeSite[] };
  /** trees standing on its own floor as they are, past the town's clearances (street-details.ts: Forum's palms) */
  palms?: readonly { x: number; z: number; scale: number; species: number }[];
}

/** Does any of `claims` hold (x, z) by `key`'s test */
export function claimed(claims: readonly PlaceClaims[], key: 'open' | 'walled', x: number, z: number): boolean {
  return claims.some((c) => c[key]?.(x, z) ?? false);
}

/** Is (x, z) within `pad` m of a place's building */
export function nearPlaceBuilding(claims: readonly PlaceClaims[], x: number, z: number, pad: number): boolean {
  return claims.some((c) => c.nearBuilding?.(x, z, pad) ?? false);
}

/** The lots `key` names, each place's that has one */
export function claimedLots(claims: readonly PlaceClaims[], key: 'houses' | 'trees'): LotReserve[] {
  return claims.flatMap((c) => c[key] ?? []);
}
