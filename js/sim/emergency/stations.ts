// js/sim/emergency/stations.ts
// Where the bomberos and the ambulances set out from (sim/emergency.ts): the real stations of Tepic, as Overture Maps'
// places (ODbL) have them, put in the world frame the geodata is in (world/geo.ts). No three.js: node --test imports it.
import { geoToWorld } from '../../world/geo.ts';

/** A station: its name, and where it stands (m, the world frame) */
export interface Station {
  name: string;
  x: number;
  z: number;
}

const station = (name: string, lat: number, lon: number): Station => {
  const [x, z] = geoToWorld(lat, lon);
  return { name, x, z };
};

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
