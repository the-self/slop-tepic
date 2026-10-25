// js/world/buildings/sitting-areas.ts
// The narrow leftover slabs between the blocks no building fits on, planted as sitting areas (their trees join
// city-grid.ts's parkTreeSites).
import { liftAt } from '../ground.ts';
import { pavedPlazaRects, parkTreeSites, sidewalkBlocks } from '../city-grid.ts';
import type { Bounds } from '../city-config.ts';
import type { BlockDetail } from './types.ts';

// B6. Narrow leftover slabs no building fits on (8-26 m wide: clipped short by the shore highways or cut by Broadway)
//     become sitting areas: a row or two of honey locusts & planes in tree pits (planted by street-details.ts)
function plantSittingAreas(allBlocks: BlockDetail[]) {
  const plazas = pavedPlazaRects ?? [];
  const sites = parkTreeSites;
  const hit = (r: Bounds, x0: number, x1: number, z0: number, z1: number) => r.minX < x1 && r.maxX > x0 && r.minZ < z1 && r.maxZ > z0;
  for (const s of (sites && sidewalkBlocks) ?? []) {
    const x0 = s.cx - s.w / 2;
    const x1 = s.cx + s.w / 2;
    const z0 = s.cz - s.d / 2;
    const z1 = s.cz + s.d / 2;
    if (s.cover || s.block.median || s.block.park > 0.6) continue;
    const narrow = Math.min(s.w, s.d);
    if (narrow < 8 || narrow > 26 || Math.max(s.w, s.d) < 20) continue;
    if (allBlocks.some((b) => hit(b, x0 + 2, x1 - 2, z0 + 2, z1 - 2)) || plazas.some((r) => hit(r, x0, x1, z0, z1))) continue;
    const alongX = s.w > s.d;
    const len = alongX ? s.w : s.d;
    const n = Math.max(1, Math.floor((len - 6) / 8));
    const lanes = narrow >= 15 ? [-narrow / 4, narrow / 4] : [0];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      for (const [j, o] of lanes.entries()) {
        const u = (len - 6) * t + (j % 2) * 2;
        const x = alongX ? s.cx + u : s.cx + o;
        const z = alongX ? s.cz + o : s.cz + u;
        const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        sites?.push({ x, y: 0.22 + liftAt(x, z), z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });
      }
    }
  }
}

export { plantSittingAreas };
