// js/world/loading-docks.ts
// Where the supermarkets get their goods: the andenes de carga at the back of the big Walmarts, Sorianas, Leys and
// Bodega Aurreras (city-geodata.js `houses`: a hall, kind bit 8, with the chain's sign), where the tráilers back up
// in the small hours, when the streets are empty, unload for an hour or two and are gone by the morning's rush
// (most stores receive between midnight and 6 am: the trucks have the avenues to themselves, and the store is
// restocked before it opens). Each store gets one to three docks by its size, on its back wall (the side opposite its
// front), or on a side wall when the back has no room: a truck needs some 24 m of open yard out from the wall, clear
// of the other buildings, the streets and the car parks. Each dock's truck arrives at its hour and leaves at its own.
// Plain data in, plain data out (no three.js), so node --test reads it directly: delivery-trucks.ts draws them.

import { GEO } from './city-geodata.js';
import { STOREFRONTS } from './storefronts/index.ts';
import { onRoadway } from './city-config.ts';
import { indexHouses } from './lot-greenery.ts';
import { hash } from './hash.ts';

/** The chains whose stores get the trucks (STOREFRONTS' ids), in the order of their colours in delivery-trucks.ts */
const DOCK_CHAINS = ['gualmart', 'sorianda', 'casa-rey', 'bodega-ahorrera'];

const TRUCK_L = 23.55; // m bumper to doors (actors/vehicles/tractor-trailer.ts TRUCK_SIZE)
const GAP = 0.4; // m between the doors and the wall
const PITCH = 4.4; // m between two docks' doors: each dock's width of the apron (side by side they make one)
const APRON_OUT = 3; // m of apron past a truck's nose
// m out from the wall the yard must be open: the truck and the apron it stands on, all the way to the apron's end...
const PROBE = [1.6, 4, 8, 12, 16, 20, 24, GAP + TRUCK_L + APRON_OUT];
const ACROSS = [-PITCH / 2, 0, PITCH / 2]; // ...and either side of the truck's middle line, to the apron's sides

/** A dock: where its truck stands (its middle, m) and faces (heading, rad: nose out from the wall), the chain (an
 *  index into DOCK_CHAINS), and the hours its truck is there: from `arrive` to `leave` (local hours, 0-24) */
export interface Dock {
  x: number;
  z: number;
  heading: number;
  chain: number;
  arrive: number;
  leave: number;
  /** the store's middle (m): the docks of one store are counted together */
  storeX: number;
  storeZ: number;
}

/** Whether a truck is at its dock at `hour` (local, 0-24) */
function atDock(d: Dock, hour: number): boolean {
  const h = hour >= 0 && hour < 24 ? hour : ((hour % 24) + 24) % 24; // (as it is when it can be: the wrap rounds)
  return h >= d.arrive && h < d.leave;
}

/**
 * The docks of the big stores. `blocked(x, z)`: ground no truck may stand on besides the buildings and the streets
 * (the car parks and their driveways)
 */
function loadingDocks(blocked: (x: number, z: number) => boolean = () => false): Dock[] {
  const H = GEO.houses, S = GEO.houseStride || 8;
  const walls = indexHouses(H, S);
  const docks: Dock[] = [];
  for (let i = 0; i + 7 < H.length; i += S) {
    if (!(H[i + 6] & 8) || !H[i + 7]) continue; // (a hall with a sign)
    const sign = GEO.signs[H[i + 7] - 1];
    const store = sign.store !== undefined ? STOREFRONTS[sign.store] : undefined;
    const chain = store ? DOCK_CHAINS.indexOf(store.id) : -1;
    if (chain < 0 || !sign.chain) continue;
    const cx = H[i] / 10, cz = H[i + 1] / 10, w = H[i + 2] / 10, d = H[i + 3] / 10, th = H[i + 4] / 1000;
    const area = w * d;
    if (area < 1200) continue; // (a Bodega Aurrera Express, a corner Ley: a van brings theirs)
    const want = area > 6000 ? 3 : area > 2500 ? 2 : 1;
    const cs = Math.cos(th), sn = Math.sin(th);
    // a point of the store's frame (a along its local x, b along its local z) in the world
    const at = (a: number, b: number) => ({ x: cx + a * cs + b * sn, z: cz - a * sn + b * cs });
    const front = H[i + 6] & 3; // 0 -x, 1 +x, 2 -z, 3 +z
    const back = front ^ 1; // (0 <-> 1, 2 <-> 3)
    const sides = [back, ...[0, 1, 2, 3].filter((s) => s !== front && s !== back)];
    for (const s of sides) {
      // the wall's outward normal and its run along it, in the store's frame
      const na = s === 0 ? -1 : s === 1 ? 1 : 0, nb = s === 2 ? -1 : s === 3 ? 1 : 0;
      const half = na ? d / 2 : w / 2, off = na ? w / 2 : d / 2;
      const found: Dock[] = [];
      // from one end of the wall (the store's own pick) towards the other, the first runs of open yard
      const dir = hash(cx, cz, 70) < 0.5 ? 1 : -1;
      for (let t = -half + 7; t <= half - 7 && found.length < want; t += PITCH) {
        const tt = t * dir;
        const open = PROBE.every((o) => ACROSS.every((c) => {
          const a = na * (off + o) + (na ? 0 : tt + c), b = nb * (off + o) + (nb ? 0 : tt + c);
          const p = at(a, b);
          return walls.wallDistance(p.x, p.z, 1) > 0.5 && !onRoadway(p.x, p.z, 0.5) && !blocked(p.x, p.z);
        }));
        if (!open) {
          if (found.length) break; // (the docks of a store stand side by side)
          continue;
        }
        const mid = off + GAP + TRUCK_L / 2;
        const p = at(na * mid + (na ? 0 : tt), nb * mid + (nb ? 0 : tt));
        const nx = na * cs + nb * sn, nz = -na * sn + nb * cs;
        const arrive = 0.5 + 4 * hash(p.x, p.z, 71);
        found.push({ x: p.x, z: p.z, heading: Math.atan2(nx, nz), chain, arrive, leave: arrive + 1.2 + 1.3 * hash(p.z, p.x, 72), storeX: cx, storeZ: cz });
      }
      if (found.length) {
        docks.push(...found);
        break;
      }
    }
  }
  return docks;
}

/** Whether (x, z) lies where a dock's truck stands (its yard, kept clear of trees) */
function inDockYard(docks: readonly Dock[], x: number, z: number): boolean {
  for (const d of docks) {
    const dx = x - d.x, dz = z - d.z;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    if (Math.abs(dx * fx + dz * fz) < TRUCK_L / 2 + 0.6 && Math.abs(dz * fx - dx * fz) < 2.2) return true;
  }
  return false;
}

export { DOCK_CHAINS, PITCH as APRON_W, APRON_OUT, atDock, loadingDocks, inDockYard };
