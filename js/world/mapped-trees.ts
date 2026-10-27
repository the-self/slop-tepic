// js/world/mapped-trees.ts
// The trees OpenStreetMap maps (city-geodata.js `trees`: natural=tree, and the rows of natural=tree_row) as sites for
// trees.ts: each where it is, its species and size by the ground it stands on (Tepic's say no species): a park's mix in
// a park, the woods' in open country, a sidewalk's or yard's in a block. The trees the game plants itself (street-
// details.ts) keep clear of them. No three.js here, so node --test imports it.
import type { TreeSite } from './trees.ts';

/** What the sites read of the curb island under a tree (city-config.ts blockAt) */
export interface TreeGround {
  park: number;
  rural?: boolean;
  median?: boolean;
}

const SIDEWALK_Y = 0.22 + 0.012; // the yards' open ground and the sidewalks' top over the road (city-grid.ts)
const PARK_Y = 0.26; // a park's walks (a tree in its lawn stands a little into it)
const FIELD_Y = 0.03; // the open country's meadow
const CLEAR = 4; // m round a mapped tree the game's own trees keep clear of

// species: 0 laurel, 1 jacaranda, 2 mango, 3 tabachín, 4 palm (trees.ts SPECIES), picked by r (0..1) from a mix
const pick = (mix: readonly number[], r: number) => {
  for (let k = 0; k < mix.length; k++) if ((r -= mix[k]) < 0) return k;
  return 0;
};
const PARK_MIX = [0.42, 0.16, 0.12, 0.18, 0.12];
const FIELD_MIX = [0.3, 0.1, 0.35, 0.25, 0];
const STREET_MIX = [0.5, 0.15, 0.15, 0.2, 0];

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The sites of the trees `flat` (GEO.trees: x, z, kind each) on the curb islands `blockAt` finds under them, raised by
 * the ground `liftAt`; the ones standing in a roadway (no island under them: mapped a little off the curb) left out
 */
function mappedTreeSites(flat: readonly number[], blockAt: (x: number, z: number) => TreeGround | null, liftAt: (x: number, z: number) => number): TreeSite[] {
  const out: TreeSite[] = [];
  for (let k = 0; k + 2 < flat.length; k += 3) {
    const x = flat[k], z = flat[k + 1], row = flat[k + 2] === 1;
    const b = blockAt(x, z);
    if (!b) continue;
    const r = hash(x, 4.4, z);
    const park = b.park > 0.6 && !b.median;
    const mix = b.rural ? FIELD_MIX : park ? PARK_MIX : STREET_MIX;
    // (a row keeps one species along it, as it was planted)
    const species = pick(mix, row ? hash(Math.round(x / 60), 2.2, Math.round(z / 60)) : r);
    const scale = (park || b.rural ? 0.9 : 0.7) + hash(z, 5.5, x) * 0.35;
    const y = (b.rural ? FIELD_Y : park ? PARK_Y : SIDEWALK_Y) + liftAt(x, z);
    out.push({ x, y, z, scale, species, tier: park || b.rural ? 0 : 2 });
  }
  return out;
}

/** The sites of `sites` clear of the trees `mapped` (CLEAR m round each), in 8 m cells */
function clearOfMapped<T extends TreeSite>(sites: readonly T[], mapped: readonly TreeSite[]): T[] {
  if (!mapped.length) return sites.slice();
  const C = 8;
  const key = (i: number, j: number) => i * 100003 + j;
  const near = new Map<number, TreeSite[]>();
  for (const m of mapped) {
    const k = key(Math.floor(m.x / C), Math.floor(m.z / C));
    let list = near.get(k);
    if (!list) near.set(k, (list = []));
    list.push(m);
  }
  return sites.filter((s) => {
    const i = Math.floor(s.x / C), j = Math.floor(s.z / C);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const m of near.get(key(i + a, j + b)) ?? []) if (Math.hypot(m.x - s.x, m.z - s.z) < CLEAR) return false;
      }
    }
    return true;
  });
}

export { mappedTreeSites, clearOfMapped };
