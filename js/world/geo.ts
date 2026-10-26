// js/world/geo.ts
// From latitude & longitude to the world frame: the geodata builder's projection (tools/build-tepic-geodata.mjs), for
// what is placed by its real coordinates at run time (landmark models, the emergency services' stations). No three.js:
// node --test imports it.
import { GEO } from './city-geodata.js';
import type { GeoFrame } from './city-geodata.js';

/** What the projection reads of GEO.frame: its origin (°) and the street grid's turn (° clockwise from true north) */
export type ProjectionFrame = Pick<GeoFrame, 'lat0' | 'lon0' | 'bearingDeg'>;

// The builder's projection: metres east & north of the plaza on the WGS84 ellipsoid, turned to the street grid
const A = 6378137.0, E2 = 6.69437999014e-3;
/** Pure: (lat, lon) in degrees to [x, z] in the world frame (m: x east along the centro's grid, z south) */
export function geoToWorld(lat: number, lon: number, frame: ProjectionFrame = GEO.frame): [number, number] {
  const phi = (frame.lat0 * Math.PI) / 180, s = Math.sin(phi);
  const kx = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * s * s)) * Math.cos(phi);
  const ky = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5));
  const e = (lon - frame.lon0) * kx, n = (lat - frame.lat0) * ky;
  const th = ((frame.bearingDeg || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
  return [e * c - n * sn, -(e * sn + n * c)];
}
