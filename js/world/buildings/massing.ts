// js/world/buildings/massing.ts
// The building massing toolkit the block layouts build with: the lots' frame (toWorld), a building's parts massed in
// whole storeys, its walls' facade treatment, and commit, which emits it: facade boxes, map footprints, colliders,
// cornices, rooftop gear and storefront awnings.
import { WALL_KINDS } from '../../render/tsl-materials.ts';
import { SLOPES, groundHeight, liftAt } from '../ground.ts';
import { chance, irange, pick, rand, range } from './dice.ts';
import { storeys } from './facades.ts';
import { EPS, cornerHoles, rect, rectD, rectW } from './footprints.ts';
import type { BlockDetail, Building, CityBuild, CommitOpts, FacadeBox, LotBlock, Part, Rect, Side, Span } from './types.ts';

// Frame of the lots being populated (city.xf). Irregular blocks come with frontage frames (city-config.ts BLOCKS: lots
// laid out along the streets they front, in a frame turned by θ about p); the generator works in the frame as on a
// grid block, and everything it emits is turned into place (placeInFrame), so buildings line up with their street.
// (city.minLot: the smallest lot side built on; frontage frames come in lots of 12 m and up, see geo-blocks.mjs)
function toWorld(city: CityBuild, x: number, z: number): Span {
  const xf = city.xf;
  return (xf
    ? [xf.px + (x - xf.px) * xf.cs + (z - xf.pz) * xf.sn, xf.pz - (x - xf.px) * xf.sn + (z - xf.pz) * xf.cs]
    : [x, z]);
}
// Player collider over the rect [x0, x1] x [z0, z1] (of the current frame): an oriented box inside its world AABB
function pushCollider(city: CityBuild, x0: number, x1: number, z0: number, z1: number, minY: number, maxY: number) {
  const xf = city.xf;
  if (!xf) {
    city.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY, maxY });
    return;
  }
  const [cx, cz] = toWorld(city, (x0 + x1) * 0.5, (z0 + z1) * 0.5);
  const hx = (x1 - x0) * 0.5;
  const hz = (z1 - z0) * 0.5;
  const ex = Math.abs(xf.cs) * hx + Math.abs(xf.sn) * hz;
  const ez = Math.abs(xf.sn) * hx + Math.abs(xf.cs) * hz;
  city.colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs: xf.cs, sn: xf.sn } });
}

// ============================================================================
// BUILDING MASSING TOOLKIT
// A building is a list of non-overlapping parts { x0, x1, z0, z1, y0, y1 } on one lot: footprints carved into
// plans, extruded storey by storey, tiers stacked on whole storeys
// ============================================================================
function building(blk: BlockDetail, mat: number, lot: Rect): Building {
  return {
    mat,
    lot,
    parts: [],
    // Lot sides facing a street; the others are party walls / rear lot lines shared with neighbours
    street: {
      n: lot.z0 - blk.minZ < EPS,
      s: blk.maxZ - lot.z1 < EPS,
      w: lot.x0 - blk.minX < EPS,
      e: blk.maxX - lot.x1 < EPS
    }
  };
}

// Extrude footprint `rects` from storey f0 up to storey f1
function mass(b: Building, rects: Rect[], f0: number, f1: number) {
  if (f1 <= f0) return;
  const s = storeys[b.mat];
  for (const r of rects) {
    if (r.x1 - r.x0 < 0.5 || r.z1 - r.z0 < 0.5) continue;
    b.parts.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: f0 * s, y1: f1 * s });
  }
}

// `r` pulled back `d` from the lot's street sides (and `party` from its party walls): zoning setbacks
function streetInset(b: Building, r: Rect, d: number, party = 0) {
  const s = b.street;
  return rect(r.x0 + (s.w ? d : party), r.x1 - (s.e ? d : party), r.z0 + (s.n ? d : party), r.z1 - (s.s ? d : party));
}

// Storeys `f` capped so a tower rises at most ~7x as tall as its lot is narrow (no needles on the small lots of
// Lower Manhattan's irregular blocks)
const slender = (f: number, lot: Rect, mat: number) => Math.min(f, Math.max(6, Math.floor((Math.min(rectW(lot), rectD(lot)) * 7) / storeys[mat])));

// How far part p's cornice reaches past its `side` wall: `oh` out into open air, flush against parts of the same
// building rising past it, tucked just inside party walls (a neighbour's own ledge may run at the same height)
function corniceReach(b: Building, p: Part, side: Side, oh: number) {
  const alongX = side === 'n' || side === 's';
  const c = side === 'n' ? p.z0 : side === 's' ? p.z1 : side === 'w' ? p.x0 : p.x1;
  const edge = side === 'n' ? b.lot.z0 : side === 's' ? b.lot.z1 : side === 'w' ? b.lot.x0 : b.lot.x1;
  if (Math.abs(c - edge) < EPS && !b.street[side]) return -0.03;
  for (const q of b.parts) {
    if (q === p || q.y1 < p.y1 - EPS || q.y0 > p.y1 - EPS) continue;
    const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
    if (Math.abs(qc - c) > EPS) continue;
    if (alongX ? (q.x0 < p.x1 - EPS && q.x1 > p.x0 + EPS) : (q.z0 < p.z1 - EPS && q.z1 > p.z0 + EPS)) return 0;
  }
  return oh;
}

// The spans of [a0, a1] left after removing the `cuts` ([c0, c1] pairs)
function spanMinus(a0: number, a1: number, cuts: Span[]) {
  let spans: Span[] = [[a0, a1]];
  for (const [c0, c1] of cuts) {
    const next: Span[] = [];
    for (const [s0, s1] of spans) {
      if (c1 <= s0 + EPS || c0 >= s1 - EPS) {
        next.push([s0, s1]);
        continue;
      }
      if (c0 > s0 + EPS) next.push([s0, c0]);
      if (c1 < s1 - EPS) next.push([c1, s1]);
    }
    spans = next;
  }
  return spans;
}
const spanLen = (spans: Span[]) => spans.reduce((t, [s0, s1]) => t + s1 - s0, 0);

// What part p's `side` wall looks out on: the spans of it not hidden by parts of the same building built flush
// against it, and how much of those the building's own wings screen across a court or light well
function wallView(b: Building, p: Part, side: Side) {
  const alongX = side === 'n' || side === 's';
  const c = side === 'n' ? p.z0 : side === 's' ? p.z1 : side === 'w' ? p.x0 : p.x1;
  const flush: Span[] = [];
  const across: Span[] = [];
  for (const q of b.parts) {
    if (q === p || q.y1 < p.y0 + EPS || q.y0 > p.y1 - EPS) continue;
    const qc = side === 'n' ? q.z1 : side === 's' ? q.z0 : side === 'w' ? q.x1 : q.x0;
    const gap = side === 'n' || side === 'w' ? c - qc : qc - c;
    if (gap < -EPS) continue; // beside or behind the wall
    (gap < EPS ? flush : across).push(alongX ? [q.x0, q.x1] : [q.z0, q.z1]);
  }
  const visible = spanMinus(alongX ? p.x0 : p.z0, alongX ? p.x1 : p.z1, flush);
  const open = visible.flatMap(([s0, s1]) => spanMinus(s0, s1, across));
  return { visible, screened: spanLen(visible) - spanLen(open) };
}

// Facade treatment of each wall of part p, in createFacadeBoxes `faces` order (w, e, n, s). Street fronts (the lot
// fronts a street there and the building's own wings don't screen most of the wall) get storefronts (`shops[side]`)
// or a residential entrance, and so do the side walls of courts open to the street; walls on the lot lines shared
// with neighbours stay windowless; the rest are rear yard, court & air-shaft walls. A `freestanding` building
// (towers in the park) fronts every way; `o.walls` forces one WALL_KINDS everywhere.
function wallKinds(b: Building, p: Part, shops: Record<Side, boolean>, o: CommitOpts): number[] {
  if (o.walls !== undefined) return [o.walls, o.walls, o.walls, o.walls];
  const front = (side: Side) => (shops[side] ? WALL_KINDS.shop : WALL_KINDS.entry);
  return (['w', 'e', 'n', 's'] satisfies Side[]).map((side) => {
    if (o.freestanding) return front(side);
    const { visible, screened } = wallView(b, p, side);
    if (b.street[side] && screened < spanLen(visible) * 0.5) return front(side);
    const c = side === 'w' ? p.x0 : side === 'e' ? p.x1 : side === 'n' ? p.z0 : p.z1;
    const edge = side === 'w' ? b.lot.x0 : side === 'e' ? b.lot.x1 : side === 'n' ? b.lot.z0 : b.lot.z1;
    if (!b.street[side] && Math.abs(c - edge) < EPS) return WALL_KINDS.lotLine; // (see openOntoVoidLots)
    // A court wall reaching the street line belongs to a court open to the street
    const alongX = side === 'n' || side === 's';
    const [e0, e1, s0, s1]: [number, number, boolean, boolean] = alongX ? [b.lot.x0, b.lot.x1, b.street.w, b.street.e] : [b.lot.z0, b.lot.z1, b.street.n, b.street.s];
    const onStreet = visible.some(([a, z]) => (s0 && a - e0 < EPS) || (s1 && e1 - z < EPS));
    return screened > EPS && onStreet ? WALL_KINDS.entry : WALL_KINDS.rear;
  });
}

// Lots left empty under a bridge approach (see commit): the lot-line walls of the buildings next to them look out
// over the gap, so they get windows like a rear wall
function openOntoVoidLots(blk: LotBlock) {
  if (!blk.voidLots.length) return;
  for (const e of blk.facadeBoxes) {
    const x0 = e.x - e.w * 0.5;
    const x1 = e.x + e.w * 0.5;
    const z0 = e.z - e.d * 0.5;
    const z1 = e.z + e.d * 0.5;
    // The 2 m strip beyond each wall: w, e, n, s
    const strips = [[x0 - 2, x0, z0, z1], [x1, x1 + 2, z0, z1], [x0, x1, z0 - 2, z0], [x0, x1, z1, z1 + 2]];
    strips.forEach(([a0, a1, b0, b1], k) => {
      if (e.faces[k] !== WALL_KINDS.lotLine) return;
      const open = blk.voidLots.some((v) => v.x0 < a1 - EPS && v.x1 > a0 + EPS && v.z0 < b1 - EPS && v.z1 > b0 + EPS);
      if (open) e.faces[k] = WALL_KINDS.rear;
    });
  }
}

// Ground-floor frontage on an avenue: storefront awnings (if it has shops), remembered for scaffolding sheds
function avenueFront(city: CityBuild, blk: BlockDetail, side: 'w' | 'e', z0: number, z1: number, shops = true) {
  blk.avenueFronts[side].push([z0, z1]);
  const len = z1 - z0;
  const n = Math.max(1, Math.round(len / 12));
  const seg = len / n;
  if (seg < 4.5) return;
  for (let k = 0; k < n; k++) {
    if (!chance(0.62)) continue;
    const colorIdx = irange(0, 4);
    if (!shops) continue;
    const x = side === 'w' ? blk.minX - 0.9 : blk.maxX + 0.9, z = z0 + seg * (k + 0.5);
    const g = liftAt(...toWorld(city, x, z)); // the street front's ground
    blk.awnings.push({
      x,
      y: 3.8 + g,
      g,
      z,
      w: 1.8,
      d: Math.min(8.5, seg - 1.6),
      sideDir: side === 'w' ? -1 : 1,
      colorIdx
    });
  }
}

/**
 * Emits building `b`: facade boxes, map footprints, colliders matching each part, stone cornices
 * under every masonry roof line, rooftop bulkhead & water tower and avenue storefront awnings.
 * o: { cornice, corniceH, roof: 'mech' | 'prewar' | 'walkup' | 'none', wtP, hvacH,
 *      awnings, shops: 'all' | 'avenue' | 'none' | probability of 'all' (street fronts with storefronts on the
 *      ground floor, the others get a residential entrance), freestanding, walls (see wallKinds) }
 */
function commit(city: CityBuild, blk: LotBlock, b: Building, o: CommitOpts = {}) {
  const parts = b.parts;
  if (!parts.length) return;
  // On the town's slopes the building stands like the real houses (A2): its floor at the lot's lowest
  // corner, a little into the ground, everything above it a full height over the highest, the downhill side's
  // foundation showing
  const onGround = new Set(parts.filter((p) => p.y0 <= EPS));
  let lift = 0;
  if (SLOPES) {
    let g0 = Infinity;
    lift = -Infinity;
    const { x0, x1, z0, z1 } = b.lot;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const g = groundHeight(...toWorld(city, x, z));
      g0 = Math.min(g0, g);
      lift = Math.max(lift, g);
    }
    for (const p of parts) {
      p.y0 = onGround.has(p) ? g0 - 0.15 : p.y0 + lift;
      p.y1 += lift;
    }
  }
  const mat = b.mat;
  const tone = rand();
  let shopsOn = o.shops ?? 'all';
  if (typeof shopsOn === 'number') shopsOn = tone < shopsOn ? 'all' : 'none';
  const shops: Record<Side, boolean> = { w: shopsOn !== 'none', e: shopsOn !== 'none', n: shopsOn === 'all', s: shopsOn === 'all' };
  let top = parts[0];
  for (const p of parts) {
    const w = p.x1 - p.x0;
    const d = p.z1 - p.z0;
    const h = p.y1 - p.y0;
    const box: FacadeBox = { x: p.x0 + w * 0.5, y: p.y0 + h * 0.5, z: p.z0 + d * 0.5, w, h, d, faces: wallKinds(b, p, shops, o), tone };
    city.buckets[mat].push(box);
    blk.facadeBoxes.push(box);
    blk.footprints.push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, h: p.y1 - lift, tone }); // h: over the ground
    if (p.y1 > blk.maxH) blk.maxH = p.y1;
    pushCollider(city, p.x0, p.x1, p.z0, p.z1, p.y0, p.y1);
    if (p.y1 > top.y1 + EPS || (p.y1 > top.y1 - EPS && w * d > rectW(top) * rectD(top))) top = p;
  }

  // 1. Stone cornices & setback ledges
  if (o.cornice ?? mat <= 2) {
    const ch = o.corniceH ?? (mat === 2 ? 0.75 : 0.9);
    for (const p of parts) {
      const x0 = p.x0 - corniceReach(b, p, 'w', 0.6);
      const x1 = p.x1 + corniceReach(b, p, 'e', 0.6);
      const z0 = p.z0 - corniceReach(b, p, 'n', 0.6);
      const z1 = p.z1 + corniceReach(b, p, 's', 0.6);
      blk.cornices.push({ x: (x0 + x1) * 0.5, y: p.y1, z: (z0 + z1) * 0.5, w: x1 - x0, h: ch, d: z1 - z0 });
    }
  }

  // 2. Rooftop gear on the highest roof: water tower on one half, bulkhead / mechanical penthouse on the other
  const roof = o.roof ?? 'mech';
  if (roof !== 'none') {
    const tw = rectW(top);
    const td = rectD(top);
    const halves = tw >= td
      ? [rect(top.x0, top.x0 + tw * 0.5, top.z0, top.z1), rect(top.x0 + tw * 0.5, top.x1, top.z0, top.z1)]
      : [rect(top.x0, top.x1, top.z0, top.z0 + td * 0.5), rect(top.x0, top.x1, top.z0 + td * 0.5, top.z1)];
    if (chance(0.5)) halves.reverse();
    let bulkheadArea: Rect | null = top;
    if (roof !== 'mech' && chance(o.wtP ?? 0.7)) {
      const fits = (r: Rect) => rectW(r) >= 4.6 && rectD(r) >= 4.6;
      const spot = fits(halves[0]) ? halves[0] : fits(top) ? top : null;
      if (spot) {
        const jx = rectW(spot) * 0.5 - 2.3;
        const jz = rectD(spot) * 0.5 - 2.3;
        blk.waterTowers.push({
          x: (spot.x0 + spot.x1) * 0.5 + range(-jx, jx),
          y: top.y1,
          z: (spot.z0 + spot.z1) * 0.5 + range(-jz, jz)
        });
        bulkheadArea = spot === top ? null : halves[1];
      }
    }
    if (bulkheadArea) {
      const aw = rectW(bulkheadArea);
      const ad = rectD(bulkheadArea);
      const big = roof === 'mech';
      const hw = Math.min(aw - 1.2, big ? Math.max(3, aw * range(0.4, 0.65)) : range(2.4, 4.2));
      const hd = Math.min(ad - 1.2, big ? Math.max(3, ad * range(0.4, 0.65)) : range(2.4, 4.2));
      if (hw >= 1.8 && hd >= 1.8) {
        const jx = (aw - hw) * 0.5 - 0.6;
        const jz = (ad - hd) * 0.5 - 0.6;
        blk.hvacUnits.push({
          x: (bulkheadArea.x0 + bulkheadArea.x1) * 0.5 + range(-jx, jx),
          y: top.y1,
          z: (bulkheadArea.z0 + bulkheadArea.z1) * 0.5 + range(-jz, jz),
          w: hw,
          h: o.hvacH ?? (big ? range(3.4, 5.8) : range(2.4, 3.2)),
          d: hd
        });
      }
    }
  }

  // 3. Wrought-iron fire escapes on walk-up street fronts (and over the rear yards)

  // 4. Storefront awnings along the avenue frontage (the dice are rolled either way, so the block stays the same)
  if (o.awnings !== false) {
    for (const p of parts) {
      if (!onGround.has(p)) continue;
      if (p.x0 - blk.minX < EPS) avenueFront(city, blk, 'w', p.z0, p.z1, shops.w);
      if (blk.maxX - p.x1 < EPS) avenueFront(city, blk, 'e', p.z0, p.z1, shops.e);
    }
  }
}

// Corner treatments for tower shafts: notched (re-entrant corners), stepped (double notches), plus (cruciform),
// L (one corner cut away) or a plain rect
function shapeHoles(r: Rect, shape: string): Rect[] {
  const w = rectW(r);
  const d = rectD(r);
  const m = Math.min(w, d);
  if (shape === 'notched') {
    const n = Math.min(range(2, 4), m * 0.22);
    return n >= 1.2 ? cornerHoles(r, n, n) : [];
  }
  if (shape === 'stepped') {
    const a = Math.min(range(3, 4.5), m * 0.26);
    return a >= 2 ? [...cornerHoles(r, a, a * 0.5), ...cornerHoles(r, a * 0.5, a)] : [];
  }
  if (shape === 'plus') return cornerHoles(r, w * range(0.24, 0.3), d * range(0.24, 0.3));
  if (shape === 'L') return cornerHoles(r, w * range(0.35, 0.5), d * range(0.35, 0.5), [pick(['nw', 'ne', 'sw', 'se'])]);
  return [];
}

export {
  toWorld,
  pushCollider,
  building,
  mass,
  streetInset,
  slender,
  wallKinds,
  openOntoVoidLots,
  avenueFront,
  commit,
  shapeHoles
};
