// js/sim/emergency/stations.ts
// Where the bomberos and the ambulances set out from (sim/emergency.ts): the real stations of Tepic, as Overture Maps'
// places (ODbL) have them, put in the world frame the geodata is in. No three.js: node --test imports it.
import { GEO } from '../../world/city-geodata.js';

/** A station: its name, and where it stands (m, the world frame) */
export interface Station {
  name: string;
  x: number;
  z: number;
}

// The WGS84 ellipsoid, for the local east-north metres round the frame's origin (as tools/build-tepic-geodata.mjs)
const A = 6378137.0;
const E2 = 6.69437999014e-3;

/**
 * Pure: (lat, lon) in degrees to the world frame (m: x east along the centro's grid, z south), as the geodata builder
 * projects OpenStreetMap's points: east & north metres round the Plaza Principal, turned by the grid's bearing
 */
export function geoToWorld(lat: number, lon: number, frame: { lat0: number; lon0: number; bearingDeg: number } = GEO.frame): { x: number; z: number } {
  const phi = (frame.lat0 * Math.PI) / 180, s = Math.sin(phi);
  const kx = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * s * s)) * Math.cos(phi);
  const ky = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5));
  const e = (lon - frame.lon0) * kx, n = (lat - frame.lat0) * ky;
  const t = (frame.bearingDeg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  return { x: e * c - n * sn, z: -(e * sn + n * c) };
}

const station = (name: string, lat: number, lon: number): Station => ({ name, ...geoToWorld(lat, lon) });

// The bomberos: the state's Protección Ciudadana y Bomberos on Av. Insurgentes Ote., the Heroico Cuerpo de Bomberos'
// station that answers Tepic's & Xalisco's fires (the only fire station in the data)
const FIRE_STATIONS: readonly Station[] = [station('Bomberos, Av. Insurgentes', 21.486448, -104.877433)];

// The ambulances: the Cruz Roja's Tepic delegation, next door to the bomberos on Insurgentes, and the two big
// hospitals' emergency departments (the IMSS's Hospital General de Zona 1 and the Hospital Civil, Aquiles Calles)
const AMBULANCE_BASES: readonly Station[] = [
  station('Cruz Roja Tepic', 21.48612, -104.877357),
  station('IMSS HGZ 1', 21.514081, -104.910455),
  station('Hospital Civil', 21.501228, -104.897574)
];

/** Pure: the station of `list` nearest (x, z), as the crow flies, or null for none */
export function nearestStation(list: readonly Station[], x: number, z: number): Station | null {
  let best: Station | null = null, bestD = Infinity;
  for (const s of list) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export { FIRE_STATIONS, AMBULANCE_BASES };
