// js/world/bus-stops.ts
// Tepic's bus stops (city-geodata.js `busStops`: OpenStreetMap's highway=bus_stop & public_transport=platform) placed
// on the road network (edge-places.ts): each by the curb on the right of the edge whose traffic pulls in to it, where
// along it a camión or combi stops with its door at the stop (sim/traffic/pickups.ts), and where its parabús stands on
// the sidewalk (bus-shelters.ts draws it). No three.js here, so node --test imports it.
import { placeOnEdges } from './edge-places.ts';
import type { PlaceEdge } from './edge-places.ts';

/** A stop on edge `edge`: where its shelter (or bench, or sign) stands on the sidewalk (m), whether it has a shelter
 *  and a bench, m along the edge from its start stop line where it is (kept STOP_CLEAR inside the stop lines), and the
 *  street's direction there (the edge's: x along it, the shelter's back to the right of it) */
export interface BusStop<E> {
  x: number;
  z: number;
  shelter: boolean;
  bench: boolean;
  edge: E;
  s: number;
  dx: number;
  dz: number;
}

const REACH = 10; // m past an edge's stop lines a stop mapped by the corner is still taken onto it
const ASIDE = 8; // m off the curb a stop may be mapped (on the sidewalk, or by the property line)
const STOP_CLEAR = 8; // m inside the stop lines a vehicle pulls in to a stop (not in the junction, nor across its crosswalk)
const SHELTER_IN = 1.35; // m in from the curb to the middle of a shelter (its back near the sidewalk's inner edge)

/**
 * The stops `flat` (GEO.busStops: x, z, flags each; flags 1 a shelter, 2 a bench) on the edges `edges`: each on the
 * edge nearest it that has it on its right. Those by no edge (on no street, by a bridge, an edge too short to pull in
 * on) are left out.
 */
function placeBusStops<E extends PlaceEdge>(flat: readonly number[], edges: readonly E[]): BusStop<E>[] {
  return placeOnEdges(flat, 3, edges, { reach: REACH, aside: ASIDE, rightOnly: true, minLen: 2 * STOP_CLEAR + 4 }).map(({ i, edge: e, raw }) => {
    const s = Math.min(e.len - STOP_CLEAR, Math.max(STOP_CLEAR, raw));
    const off = e.half + SHELTER_IN;
    const flags = flat[i * 3 + 2];
    return {
      x: e.sx + e.dx * s + e.rx * off, z: e.sz + e.dz * s + e.rz * off,
      shelter: (flags & 1) !== 0, bench: (flags & 2) !== 0, edge: e, s, dx: e.dx, dz: e.dz
    };
  });
}

export { STOP_CLEAR, placeBusStops };
