// js/world/topes.ts
// The topes: the speed bumps across Tepic's streets, only those OpenStreetMap maps (city-geodata.js `topes`), where
// they are: none is made up. Its rumble strips are boyas instead of a hump of concrete: rows of yellow metal studs
// across the street, which rattle a car rather than throw it. The paint draws them (road-paint.ts), the traffic slows
// down for each (sim/traffic) and the player's car rides over their humps (topeBumps: the ground it stands on, a jolt
// at speed). All plan them here, from the same edges, so they agree. No three.js here, so node --test imports it.
import { placeOnEdges } from './edge-places.ts';
import type { PaintEdge } from './road-network.ts';

/** A tope across a street: its middle (m), the street's direction & right there, half its width (m), and
 *  whether it is a row of boyas (studs) rather than a hump */
export interface Tope {
  x: number;
  z: number;
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  half: number;
  boyas: boolean;
}

/** A tope's hump: its length along the street and its height (m), a cosine's crest, as Tepic's poured-concrete ones */
const TOPE_LEN = 0.9;
const TOPE_H = 0.12;
/** Boyas: domes BOYA_R m across the base and BOYA_H high, in rows BOYA_ROWS m along the street from its middle,
 *  BOYA_GAP m apart across it */
const BOYA_H = 0.05;
const BOYA_R = 0.09;
const BOYA_ROWS = [-0.2, 0.2];
const BOYA_GAP = 0.45;
const BOYA_SPAN = 0.7; // m along the street the rows rattle a car over
const RUMBLE = 3; // GEO.topes' kind of a rumble strip (OpenStreetMap traffic_calming=rumble_strip)
const BUMP_CELL = 8; // m, the cells topeBumps finds them by
const MAPPED_REACH = 3; // m past an edge's stop lines a mapped tope is still taken onto it

// the topes planned on each list of edges (the paint, the traffic and the player's ground all ask for the network's)
const planned = new WeakMap<readonly PaintEdge[], { mapped: readonly number[]; topes: Tope[] }>();

/**
 * The topes on the road network's paint edges `edges` (road-network.ts paintEdges: every physical road, each way):
 * those of `mapped` (GEO.topes: x, z, kind each) on the edge whose roadway they lie in. Planned once for the same
 * edges and map, the same list after (don't change it)
 */
function planTopes(edges: readonly PaintEdge[], mapped: readonly number[]): Tope[] {
  const known = planned.get(edges);
  if (known?.mapped === mapped) return known.topes;
  const out: Tope[] = [];
  // (one mapped at a bend of the street lies a metre or two past its edges' ends: taken just inside the nearest)
  for (const { i, edge: e, raw } of placeOnEdges(mapped, 3, edges, { reach: MAPPED_REACH, aside: 0.5, minLen: 4 })) {
    const s = Math.min(e.len - 1, Math.max(1, raw));
    out.push({ x: e.sx + e.dx * s, z: e.sz + e.dz * s, dx: e.dx, dz: e.dz, rx: e.rx, rz: e.rz, half: e.half, boyas: mapped[i * 3 + 2] === RUMBLE });
  }
  planned.set(edges, { mapped, topes: out });
  return out;
}

/** The boyas of tope `t` (a row of them), each's middle on the street (x, z), into `out` */
function boyaSites(t: Tope, out: number[] = []): number[] {
  const n = Math.max(1, Math.floor((2 * t.half - 0.6) / BOYA_GAP));
  for (const u of BOYA_ROWS) {
    for (let k = 0; k <= n; k++) {
      const o = -t.half + 0.3 + ((2 * t.half - 0.6) * k) / n;
      out.push(t.x + t.dx * u + t.rx * o, t.z + t.dz * u + t.rz * o);
    }
  }
  return out;
}

/** The height (m) of the topes' humps `topes` over the street at (x, z) (a row of boyas: their rattle), 0 off them */
function topeBumps(topes: readonly Tope[]): (x: number, z: number) => number {
  const cells = new Map<number, Tope[]>();
  for (const t of topes) {
    const r = t.half + TOPE_LEN;
    for (let a = Math.floor((t.x - r) / BUMP_CELL); a <= Math.floor((t.x + r) / BUMP_CELL); a++) {
      for (let b = Math.floor((t.z - r) / BUMP_CELL); b <= Math.floor((t.z + r) / BUMP_CELL); b++) {
        const k = a * 100003 + b;
        let at = cells.get(k);
        if (!at) cells.set(k, (at = []));
        at.push(t);
      }
    }
  }
  return (x, z) => {
    const list = cells.get(Math.floor(x / BUMP_CELL) * 100003 + Math.floor(z / BUMP_CELL));
    if (!list) return 0;
    for (const t of list) {
      const u = (x - t.x) * t.dx + (z - t.z) * t.dz, len = t.boyas ? BOYA_SPAN : TOPE_LEN;
      if (Math.abs(u) >= len / 2 || Math.abs((x - t.x) * t.rx + (z - t.z) * t.rz) > t.half) continue;
      return (t.boyas ? BOYA_H : TOPE_H) * 0.5 * (1 + Math.cos((Math.PI * 2 * u) / len));
    }
    return 0;
  };
}

export { TOPE_LEN, TOPE_H, BOYA_H, BOYA_R, planTopes, topeBumps, boyaSites };
