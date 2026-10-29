// js/world/embotelladora/fences.ts
// The bottling plant's walls & fences along its streets (embotelladora-plan.ts FENCES): the red bar fence on
// Insurgentes, between red posts; the precast concrete wall on Otranto, its slabs stacked between posts; the brick
// wall on Hamburgo in its concrete frame (pilasters, a band at its foot, one at mid-height, the beam along its top),
// chain-link and barbed wire over it; the chain-link by the depot. Laid in pieces, each on the ground under it (the
// block slopes), each stopping the player, a post at every corner and end; across the staff's car park's driveways a
// sliding gate of the same red bars, closed.
import { GEO } from '../city-geodata.js';
import { carParks, segmentDistance } from '../parking.ts';
import { FENCES, FENCE_H, inPlant, plantAt } from '../embotelladora-plan.ts';
import { frameAt, groundAt } from './site.ts';
import type { Kit } from '../building-kit.ts';
import type { PlantMaterials } from './materials.ts';
import type { FenceKind } from '../embotelladora-plan.ts';
import type { PointXZ } from '../city-config.ts';

/** How long a piece of each kind is (m: its posts' or pilasters' spacing) */
const PIECE: Record<FenceKind, number> = { bars: 2.5, precast: 2.5, brick: 3.4, chain: 3 };
const CHAIN_OVER = 1.4; // m of chain-link over the brick wall

/** The walls & fences into the kit; how many metres of each kind */
export function buildPlantFences(kit: Kit, mats: PlantMaterials): Record<FenceKind, number> {
  // the staff's car park's driveways through the fence (parking.ts finds them)
  const ways = carParks(GEO.parking).filter((l) => inPlant((l.minX + l.maxX) / 2, (l.minZ + l.maxZ) / 2)).flatMap((l) => l.entrances);
  const inDriveway = (p: PointXZ) => ways.some((e) => e.path.some((a, i) =>
    i + 1 < e.path.length && segmentDistance(p.x, p.z, a.x, a.z, e.path[i + 1].x, e.path[i + 1].z) < e.width / 2 + 0.6));
  const metres: Record<FenceKind, number> = { bars: 0, precast: 0, brick: 0, chain: 0 };
  for (const { kind, pts } of FENCES) {
    const h = FENCE_H[kind];
    let along = 0; // (m from the run's start: the bars & the bricks carry on from one piece into the next)
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
      const len = Math.hypot(ub - ua, vb - va), turn = Math.atan2(vb - va, ub - ua);
      const n = Math.max(1, Math.round(len / PIECE[kind])), step = len / n;
      for (let k = 0; k < n; k++, along += step) {
        const s = k / n, u = ua + (ub - ua) * s, v = va + (vb - va) * s;
        const mu = u + ((ub - ua) / n) / 2, mv = v + ((vb - va) / n) / 2;
        const f = frameAt(u, v, groundAt(mu, mv), turn), x = step / 2;
        metres[kind] += step;
        // (the run's last piece: a post at its far end too, closing the corner or the run's end)
        const ends = k === n - 1 ? [0, step] : [0];
        if (kind === 'bars') {
          kit.plane(f, step, h, x, h / 2, 0, mats.bars, 0, along);
          for (const e of ends) kit.box(f, 0.09, h + 0.4, 0.09, e, (h + 0.4) / 2 - 0.3, 0, mats.red);
          if (inDriveway(plantAt(mu, mv))) {
            // (a leaf of the sliding gate: its red frame, a rail across its middle, on its wheels' track)
            for (const y of [0.08, h / 2, h - 0.08]) kit.box(f, step, 0.1, 0.07, x, y, 0.06, mats.red);
            for (const e of [0.05, step - 0.05]) kit.box(f, 0.08, h, 0.07, e, h / 2, 0.06, mats.red);
          }
        } else if (kind === 'precast') {
          kit.box(f, step, h + 0.5, 0.12, x, (h - 0.5) / 2, 0, mats.precast, along);
          for (const e of ends) kit.box(f, 0.26, h + 0.6, 0.26, e, (h + 0.1) / 2 - 0.25, 0, mats.concrete);
        } else if (kind === 'brick') {
          kit.box(f, step, h + 0.5, 0.2, x, (h - 0.5) / 2, 0, mats.brick, along);
          for (const e of ends) kit.box(f, 0.32, h + 0.5, 0.3, e, (h - 0.5) / 2, 0, mats.concrete);
          for (const [y0, y1] of [[-0.5, 0.3], [1.95, 2.15], [h - 0.25, h]]) kit.box(f, step, y1 - y0, 0.26, x, (y0 + y1) / 2, 0, mats.concrete);
          // the chain-link over it on its posts, two strands of barbed wire along their tops
          kit.plane(f, step, CHAIN_OVER, x, h + CHAIN_OVER / 2, 0.05, mats.chain, 0, along);
          for (const e of ends) kit.box(f, 0.05, CHAIN_OVER + 0.3, 0.05, e, h + (CHAIN_OVER + 0.3) / 2, 0.05, mats.dark);
          for (const y of [h + CHAIN_OVER + 0.1, h + CHAIN_OVER + 0.25]) kit.box(f, step, 0.02, 0.02, x, y, 0.05, mats.dark, 0, 0, false);
        } else {
          kit.plane(f, step, h, x, h / 2, 0, mats.chain, 0, along);
          for (const e of ends) kit.box(f, 0.06, h + 0.1, 0.06, e, (h + 0.1) / 2 - 0.05, 0, mats.dark);
          kit.box(f, step, 0.05, 0.05, x, h, 0, mats.dark);
        }
        kit.collide(f, x, 0, step / 2, 0.15, -0.5, kind === 'brick' ? h + CHAIN_OVER : h);
      }
    }
  }
  return metres;
}
