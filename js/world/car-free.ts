// js/world/car-free.ts
// The roads the traffic doesn't drive: the road up the Cerro de la Cruz is the walkers' and the cyclists' way up to the
// cross; the cars come as far as the foot of the hill and park there. road-network.ts leaves these out of the traffic's
// graph (their paint stays: the road is there, for the player to drive up if they will), and car-parks.ts draws the
// cars parked at the curb where each way up begins (cerroParking).
// No three.js here, so node --test imports it directly.
import { GEO } from './city-geodata.js';
import { landHeight, terrainHeight } from './ground.ts';
import { hash } from './hash.ts';
import { CERRO, onCerro } from './cerro.ts';
const FOOT = 4; // m the hill rises over the town's floor where the road up it is closed to cars
const PARKED = 2; // cars parked at the foot of each way up
const FIRST = 4; // m short of where the climb begins the first one stands (its middle), at the nearest
const FLAT = 0.12; // m a parked car's one side may stand over its other: it stands level on the street (levelled at
// the Cerro's foot, hill-paths.ts)
const LOOK_BACK = 120; // m back along the street it looks for level ground
const HALF_L = 2.6, HALF_W = 1.1; // m: half a car's length and width (with a little room)
const GAP = 6.5; // m between their middles: a car's length and room to pull out
const CURB = 1.15; // m in from the road's edge their middles stand
const PAVED = 2.75; // m: half the width of the levelled cobbles a street at the Cerro's foot is paved with (hill paths)

/** A car parked at the curb: where its middle stands (m), its heading (rad: atan2 of its nose's x over its z, the
 *  traffic's convention), and a draw in [0, 1) for its looks */
export interface CurbCar {
  x: number;
  z: number;
  heading: number;
  seed: number;
}

/** Pure: whether the road from (ax, az) to (bx, bz) (m) is closed to the traffic */
function carFree(ax: number, az: number, bx: number, bz: number): boolean {
  if (!onCerro(ax, az) && !onCerro(bx, bz)) return false;
  return Math.max(terrainHeight(ax, az), terrainHeight(bx, bz)) >= FOOT;
}

/**
 * The cars parked at the foot of the Cerro de la Cruz: at the end of each street where its way up is closed to them
 * (a link's points going from open to closed, within the link or where it meets a closed one at a node), PARKED of them
 * nose to tail at the curb on their right, facing up the hill
 */
function cerroParking(): CurbCar[] {
  const RG = GEO.roadGraph;
  if (!CERRO) return [];
  const N = RG.nodes;
  // each link's points (m), and whether each of its segments is closed
  const links = RG.links.map((l) => {
    const pts: [number, number][] = [[N[l[0] * 2], N[l[0] * 2 + 1]]];
    for (let k = 0; k < l[6].length; k += 2) pts.push([l[6][k], l[6][k + 1]]);
    pts.push([N[l[1] * 2], N[l[1] * 2 + 1]]);
    const closed = pts.slice(1).map((b, i) => carFree(pts[i][0], pts[i][1], b[0], b[1]));
    return { a: l[0], b: l[1], width: l[3], pts, closed };
  });
  const closedAt = new Set<number>(); // nodes a closed segment starts or ends at
  for (const l of links) {
    if (l.closed[0]) closedAt.add(l.a);
    if (l.closed.at(-1)) closedAt.add(l.b);
  }
  const cars: CurbCar[] = [];
  // whether a car at (x, z) facing (dx, dz) stands level across, front, middle and back (and clear of the hill's foot)
  const level = (x: number, z: number, dx: number, dz: number) => {
    for (const a of [-HALF_L, 0, HALF_L]) {
      const px = x + dx * a, pz = z + dz * a;
      if (terrainHeight(px, pz) > 0.3) return false;
      if (Math.abs(landHeight(px - dz * HALF_W, pz + dx * HALF_W) - landHeight(px + dz * HALF_W, pz - dx * HALF_W)) > FLAT) return false;
    }
    return true;
  };
  // from the foot pts[i] (the climb ahead of it, away from `way`), back along the street the way `way` (+1 / -1) runs,
  // the first where the ground under them is level
  const park = (pts: [number, number][], i: number, way: 1 | -1, width: number) => {
    let s = 0, k = i, n = 0;
    let want = FIRST;
    while (n < PARKED && want < LOOK_BACK) {
      const j = k + way;
      if (j < 0 || j >= pts.length) return;
      const [ax, az] = pts[k], [bx, bz] = pts[j];
      const L = Math.hypot(bx - ax, bz - az);
      if (s + L < want) {
        s += L;
        k = j;
        continue;
      }
      const t = (want - s) / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      // facing the foot (the way up), on the right of that way: right normal (-dz, dx)
      const dx = (ax - bx) / L, dz = (az - bz) / L, off = Math.min(width / 2, PAVED) - CURB;
      const cx = x - dz * off, cz = z + dx * off;
      // (level, and clear of the cars another way up's foot has parked)
      if (!level(cx, cz, dx, dz) || cars.some((o) => Math.hypot(o.x - cx, o.z - cz) < GAP - 0.5)) {
        want += 1;
        continue;
      }
      cars.push({ x: cx, z: cz, heading: Math.atan2(dx, dz), seed: hash(x, z, 27) });
      n++;
      want += GAP;
    }
  };
  for (const l of links) {
    const { pts, closed, width } = l;
    if (closed.every(Boolean)) continue;
    for (let i = 0; i < closed.length; i++) {
      if (closed[i]) continue;
      // the climb ahead of segment i's end (in the link or past its node), or behind its start
      if (i + 1 < closed.length ? closed[i + 1] : closedAt.has(l.b)) park(pts, i + 1, -1, width);
      if (i > 0 ? closed[i - 1] : closedAt.has(l.a)) park(pts, i, 1, width);
    }
  }
  return cars;
}

export { carFree, cerroParking };
