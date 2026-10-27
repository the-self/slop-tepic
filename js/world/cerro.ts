// js/world/cerro.ts
// The Cerro de la Cruz, north of the centro: its summit (city-geodata.js terrain.cross) and how far round it its roads
// climb. Its road up is closed to the traffic (car-free.ts), and the streets along its foot, which lean with its slope,
// are levelled as its paths up are (hill-paths.ts, through ground.ts). No three.js here, so node --test imports it.
import { GEO } from './city-geodata.js';

const CERRO = GEO.terrain?.cross ?? null; // the summit (m)
const CERRO_R = 450; // m round it its roads climb

/** Whether (x, z) (m) is on the Cerro de la Cruz or at its foot */
const onCerro = (x: number, z: number): boolean => CERRO !== null && Math.hypot(x - CERRO[0], z - CERRO[1]) <= CERRO_R;

export { CERRO, CERRO_R, onCerro };
