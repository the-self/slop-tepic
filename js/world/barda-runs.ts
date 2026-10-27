// js/world/barda-runs.ts
// Where Tepic's big open plots are walled: the vacant lots, the canchas, the ranchos and old estates still inside the
// town (the Molino de Menchaca, El Ranchito de Pérez by the lienzo charro on Paseo de Hamburgo) are shut off from the
// street by a barda, painted block over head height, a steel portón somewhere along it. The data has no walls, so they
// are put where the satellite would show one: along a block's property line wherever the ground behind it lies open
// (no building within CLEAR m of it) PROBES deep, for a run of MIN_RUN to MAX_RUN m. Parks, the open country, the
// camellones, the blocks without a building (fields), the cotos (walled already, cotos.ts) and the car parks (open to
// the street) are left as they are. Plain data in, plain data out (no three.js), so node --test reads it directly: bardas.ts builds them.

import { hash } from './hash.ts';
import { insidePoly } from './rings.ts';
import type { PointXZ } from './city-config.ts';

const STEP = 2; // m between the samples along the property line
const CLEAR = 10; // m round each probe no building may stand (a house's front yard is less)
const PROBES = [1.5, 12, 25]; // m in from the line: a big plot is open this deep (not a backyard behind a fence)
const MIN_RUN = 30; // m: a shorter open stretch is a vacant lot or two, a garden, the gap between two houses
const MAX_RUN = 500; // m: a longer one is a field, fenced with wire if at all
const GATE_RUN = 30; // m: a run this long has a portón in it
const GATE_W = 4; // m

/** What barda-runs reads of a block */
export interface WalledBlock {
  id: number;
  poly: PointXZ[];
  area: number;
  park: number;
  rural: boolean;
  median: boolean;
}

/** A barda: its line along the property line (m, the samples in order), the way into the plot (unit, per point), the
 *  portón's place along it (index of the point it is centred on, -1 none) and its paint (0xrrggbb) */
export interface BardaRun {
  pts: PointXZ[];
  inward: PointXZ[];
  gate: number;
  paint: number;
}

/** The paints of Tepic's bardas: brick red, white, cream, ochre, bare grey block, terracotta, a faded green */
const PAINTS = [0xa8382b, 0xf1eee6, 0xe9dcc0, 0xd9a441, 0x9c9a92, 0xc46a4c, 0x7d9a6a];

/**
 * The bardas of the blocks. `wallAt(x, z, reach)`: the distance (m) to the nearest building's wall within reach
 * (lot-greenery.ts indexHouses), 0 inside one; `keepOpen(x, z)`: ground that stays open to the street (the car parks
 * and their driveways); `skip`: blocks walled otherwise or not at all (the cotos, the blocks without a building);
 * `sidewalk`: the property line in from the curb (m)
 */
function bardaRuns(blocks: readonly WalledBlock[], wallAt: (x: number, z: number, reach: number) => number,
  { keepOpen = null, skip = null, sidewalk = 2.2 }:
  { keepOpen?: ((x: number, z: number) => boolean) | null; skip?: Set<number> | null; sidewalk?: number } = {}): BardaRun[] {
  const runs: BardaRun[] = [];
  for (const b of blocks) {
    if (b.median || b.rural || b.park > 0.6 || b.area < 1500 || skip?.has(b.id)) continue;
    const poly = b.poly, n = poly.length;
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    const s = area > 0 ? 1 : -1; // (positive: the inside lies left of each edge, along (-dz, dx))
    // the samples round the property line: where, which way is in, and whether it is open
    const samples: { p: PointXZ; in: PointXZ; open: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], c = poly[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      if (len < 0.5) continue;
      const ux = (c.x - a.x) / len, uz = (c.z - a.z) / len, nx = -uz * s, nz = ux * s;
      // (not within the sidewalk's width of the corners: there the line runs on into the cross street's sidewalk)
      for (let d = sidewalk + STEP / 2; d < len - sidewalk; d += STEP) {
        const x = a.x + ux * d + nx * sidewalk, z = a.z + uz * d + nz * sidewalk;
        const ix = x + nx * PROBES[0], iz = z + nz * PROBES[0];
        const open = !(keepOpen && (keepOpen(x, z) || keepOpen(ix + nx * 3, iz + nz * 3))) &&
          PROBES.every((d) => insidePoly(poly, x + nx * d, z + nz * d) && wallAt(x + nx * d, z + nz * d, CLEAR) >= CLEAR);
        samples.push({ p: { x, z }, in: { x: nx, z: nz }, open });
      }
    }
    if (!samples.some((q) => !q.open)) {
      // (open all round: a whole block of field, walled round; start anywhere)
      if (samples.length) samples.push({ ...samples[0] });
    } else {
      // start just after a closed sample, so a run never wraps round the ring's end
      const k = samples.findIndex((q) => !q.open);
      samples.push(...samples.splice(0, k + 1));
    }
    let run: typeof samples = [];
    const flush = () => {
      let len = 0;
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].p.x - run[i - 1].p.x, run[i].p.z - run[i - 1].p.z);
      if (len >= MIN_RUN && len <= MAX_RUN) {
        const r = runs.length;
        runs.push({
          pts: run.map((q) => q.p), inward: run.map((q) => q.in),
          gate: len >= GATE_RUN ? Math.floor(run.length / 2) : -1,
          paint: PAINTS[Math.floor(hash(b.id, r, 41) * PAINTS.length)]
        });
      }
      run = [];
    };
    for (const q of samples) {
      if (q.open) run.push(q);
      else flush();
    }
    flush();
  }
  return runs;
}

export { bardaRuns, GATE_W, MIN_RUN, MAX_RUN };
