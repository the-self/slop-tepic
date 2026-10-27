// js/world/street-surfaces.ts
// Every street surface that isn't asphalt: the streets' (pavement-data.ts: OpenStreetMap's surface tags and the
// colonias known to be cobbled) and the minor ways' the traffic drives too (city-geodata.js `minorSurfaces`: the
// town's earth tracks, the concrete alleys). pavements.ts lays them, road-paint.ts paints no lines on the empedrado or
// the earth. No three.js here, so node --test imports it.
import { PAVEMENTS } from './pavement-data.ts';
import { GEO } from './city-geodata.js';
import type { Pavement } from './pavement-data.ts';

const asKind = (k: number): Pavement[0] => (k === 0 ? 0 : k === 1 ? 1 : k === 2 ? 2 : 3);

/** The streets' surfaces and the minor ways': [kind (0 empedrado, 1 adoquín, 2 tierra, 3 concreto), width (m), flat
 *  centreline] */
const SURFACES: Pavement[] = [...PAVEMENTS, ...GEO.minorSurfaces.map(([kind, width, pts]): Pavement => [asKind(kind), width, pts])];

export { SURFACES };
