// js/world/crossings.ts
// The pedestrian crossings of OpenStreetMap (city-geodata.js `crossings`: highway=crossing on the streets) placed on
// the road network's edges (road-network.ts): which edge each crosses and how far along it from its stop line. The
// paint draws a zebra at the marked ones (road-paint.ts), people cross the street there and the traffic stops for
// them (sim/traffic). One mapped at a junction's approach is taken on that junction's own crosswalk (road-paint.ts
// paints every one), just outside the edge's stop line. No three.js here, so node --test imports it.
import { placeOnEdges } from './edge-places.ts';
import type { PlaceEdge } from './edge-places.ts';

/** What placing reads of an edge (edge-places.ts) */
export type CrossingEdge = PlaceEdge;
/** A crossing's kind: 0 unmarked, 1 marked (a zebra), 2 with lights */
export type CrossingKind = 0 | 1 | 2;
/** A crossing on edge `edge`: where it is mapped, its kind, and m along the edge from its start stop line, where it is
 *  taken (`s`: where mapped, or within CLEAR m of a stop line on the junction's crosswalk, AT_JUNCTION m outside it)
 *  and where it is mapped (`raw`) */
export interface PlacedCrossing<E> {
  x: number;
  z: number;
  kind: CrossingKind;
  edge: E;
  s: number;
  raw: number;
}

const REACH = 6; // m past an edge's stop lines a crossing is still taken onto it (in its junction's crosswalk)
const CLEAR = 2.5; // m inside a stop line a mapped crossing is still the junction's
const AT_JUNCTION = 1.25; // m outside the stop line, the middle of a junction's crosswalk (road-network.ts CROSSWALK)
const ASIDE = 1; // m off the curb a crossing's point may be mapped

const asKind = (k: number): CrossingKind => (k === 2 ? 2 : k === 1 ? 1 : 0);

/**
 * The crossings `flat` (GEO.crossings: x, z, kind each) on the edges `edges` they cross: each on the edge whose
 * roadway it stands in, nearest its centre line (of a two-way road, one of its two edges). Those on no edge (on a
 * bridge, an edge too short to stop short of it) are left out.
 */
function placeCrossings<E extends CrossingEdge>(flat: readonly number[], edges: readonly E[]): PlacedCrossing<E>[] {
  return placeOnEdges(flat, 3, edges, { reach: REACH, aside: ASIDE, minLen: 2 * CLEAR + 1 }).map(({ i, edge, raw }) => ({
    x: flat[i * 3], z: flat[i * 3 + 1], kind: asKind(flat[i * 3 + 2]), edge, raw,
    s: raw < CLEAR ? -AT_JUNCTION : raw > edge.len - CLEAR ? edge.len + AT_JUNCTION : raw
  }));
}

export { CLEAR as CROSSING_CLEAR, AT_JUNCTION as CROSSING_AT_JUNCTION, placeCrossings };
