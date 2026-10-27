import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// js/world/hermana-agua.ts: the glorieta's fountain fits its island, and the curb paint (sidewalks.ts) rings it
const { blockAt } = await import('../js/world/city-config.ts');
const { geoToWorld } = await import('../js/world/geo.ts');
const source = readFileSync(new URL('../js/world/hermana-agua.ts', import.meta.url), 'utf8');
const curbs = readFileSync(new URL('../js/render/materials/sidewalks.ts', import.meta.url), 'utf8');
const num = (name) => Number(new RegExp(`\\b${name} = ([\\d.]+)`).exec(source)?.[1]);

// distance from (x, z) to a polygon's nearest edge
function edgeDistance(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

test('the Hermana Agua: the fountain stands on the roundabout\'s island with lawn & beds round it', () => {
  const [x, z] = geoToWorld(21.502578, -104.896108);
  const island = blockAt(x, z);
  assert.ok(island, 'the island');
  assert.ok(island.area > 300 && island.area < 900, `a roundabout's island, not a block of houses: ${island.area} m²`);
  const R = num('OUTER_R');
  assert.ok(R > 5, `the outer wall's radius: ${R}`);
  const clear = edgeDistance(island.poly, island.cx, island.cz);
  assert.ok(clear > R + 2.5, `${(clear - R).toFixed(1)} m of lawn, beds and cobbles between the wall and the curb`);
  // the pink paint: centred on the island, reaching its curb and not the next one across the street
  const m = /glorieta = smoothstep\(([\d.]+), ([\d.]+), length\(positionWorld\.xz\.sub\(vec2\(([\d.]+), ([\d.]+)\)\)\)\)/.exec(curbs);
  assert.ok(m, 'the curb material paints the glorieta');
  const [, outer, , px, pz] = m.map(Number);
  assert.ok(Math.hypot(px - island.cx, pz - island.cz) < 1, 'the paint is centred on the island');
  for (const p of island.poly) assert.ok(Math.hypot(p.x - px, p.z - pz) < outer - 1, 'the whole curb ring is painted');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    // the next curb out from the island along this way, across the road
    for (let d = 1; d < 40; d += 0.5) {
      const b = blockAt(px + dx * d, pz + dz * d);
      if (b && b !== island) {
        assert.ok(d > outer, `the curb across the street at ${d} m stays its own colour`);
        break;
      }
    }
  }
});
