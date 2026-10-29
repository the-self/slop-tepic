// js/world/buildings/houses.ts
// The real buildings (city-geodata.js `houses`, Overture Maps footprints) as Mexican houses & shops, halls, strip
// plazas and gated communities' houses: their facade boxes, colliders, walk-in stores, balconies, roof gear,
// awnings and signs, grouped per block for the maps & the streaming of roof details.
import { WALL_KINDS } from '../../render/tsl-materials.ts';
import { blockAt } from '../city-config.ts';
import { GEO } from '../city-geodata.js';
import { STOREFRONTS } from '../storefronts/index.ts';
import { signKind, VENUE_KINDS } from '../venues.ts';
import { LANDMARK_RESERVES } from '../tepic-landmarks.ts';
import { LA_LOMA_RESERVES } from '../la-loma-plan.ts';
import { FORUM_RESERVE } from '../forum-plan.ts';
import { isEnterableStore, storeReserve } from '../store-interiors.ts';
import { SLOPES, groundHeight, liftAt } from '../ground.ts';
import { chance, irange, pickW, rand, range, seedDice } from './dice.ts';
import { MEX, storeys } from './facades.ts';
import type { CityBlock } from '../city-config.ts';
import type { LotReserve } from '../landmark-models.ts';
import type { CityBuild, HouseBlock, Span } from './types.ts';

// the lots the landmarks, La Loma's buildings & Forum Tepic stand on (tepic-landmarks.ts, la-loma-plan.ts, forum-plan.ts)
const TEPIC_RESERVES = [...LANDMARK_RESERVES, ...LA_LOMA_RESERVES, FORUM_RESERVE];

// Blocks the real buildings stand on (city-geodata.js `houses`, Overture Maps): built house by house (A2) instead
const HOUSES = GEO.houses;
const HS = GEO.houseStride || 7; // integers per house
const SIGNS = GEO.signs; // shop sign faces (chains under parody names, local businesses, trades)
// the car dealers' showrooms (GEO.dealers): house index -> how far out from the front their lot of cars on show runs
// (m), where their pole sign stands on the sidewalk past it
const DEALER_LOTS = new Map<number, number>();
for (let k = 0; k + 3 < GEO.dealers.length; k += 4) DEALER_LOTS.set(GEO.dealers[k], GEO.dealers[k + 3]);

/** The block each house stands on (A2 groups them by it), and the blocks any house stands on */
function indexHouseBlocks() {
  const houseBlocks = new Set<CityBlock>();
  const houseBlock = new Array<CityBlock | null>(HOUSES.length / HS); // the block each house stands on (A2 groups them by it)
  for (let i = 0; i < HOUSES.length; i += HS) {
    const b = blockAt(HOUSES[i] / 10, HOUSES[i + 1] / 10);
    houseBlock[i / HS] = b;
    if (b) houseBlocks.add(b);
  }
  return { houseBlocks, houseBlock };
}

// A2. THE REAL BUILDINGS (Overture Maps footprints as oriented boxes, see tools/build-tepic-geodata.mjs), as Mexican
//     houses: a long street front is split into houses 6-10 m wide, each its own colour & height; the front towards
//     the street with a door & gate, a shop's shutter & sign, or a chain store's front (js/world/storefronts); flat roofs
//     with a black water tank (tinaco) on most. Big boxes (supermarkets, department stores, malls, warehouses) are one
//     hall in metal cladding with a glazed front and units on the roof; strip plazas a row of locales 5-7 m wide under
//     one roof, in one colour. Grouped per block for the maps & the streaming of roof details
function buildHouses(city: CityBuild, houseBlock: (CityBlock | null)[]) {
  const byBlock = new Map<number, HouseBlock>();
  const blockOf = (b: CityBlock | null, cx: number, cz: number) => {
    const key = b ? b.id : -1;
    let blk = byBlock.get(key);
    if (!blk) {
      blk = {
        id: `house_${key}`, cx: b ? b.cx : cx, cz: b ? b.cz : cz, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
        district: b ? b.district : 'colonia', cornices: [], waterTowers: [], hvacUnits: [], awnings: [],
        scaffoldSheds: [], footprints: [], yards: [], tinacos: [], maxH: 0, avenueFronts: { w: [], e: [] }
      };
      byBlock.set(key, blk);
    }
    return blk;
  };
  // the halls of the stores you walk into (store-interiors.ts), first: no other footprint overlapping one is built
  // (Overture's footprints overlap here and there; inside a store they would stand among the shelves)
  const storeHalls = new Set<number>();
  const storeLots: LotReserve[] = [];
  for (let i = 0; i < HOUSES.length; i += HS) {
    const signNo = HS > 7 ? HOUSES[i + 7] : 0;
    const sign = signNo ? SIGNS[signNo - 1] : null;
    const chain = sign?.chain && sign.store !== undefined ? STOREFRONTS[sign.store] : null;
    const w = HOUSES[i + 2] / 10, d = HOUSES[i + 3] / 10;
    if (!(HOUSES[i + 6] & 8) || !isEnterableStore(chain, w, d)) continue;
    storeHalls.add(i);
    storeLots.push(storeReserve({ cx: HOUSES[i] / 10, cz: HOUSES[i + 1] / 10, w, d, th: HOUSES[i + 4] / 1000 }));
  }
  // the buildings known as they are (js/world/building-overrides.ts): house index -> [storeys (0: as guessed), paint]
  const known = new Map(GEO.overrides.map(([n, storeys, paint]): [number, { storeys: number; paint: number | null }] => [n, { storeys, paint: paint >= 0 ? paint : null }]));
  for (let i = 0; i < HOUSES.length; i += HS) {
    const cx0 = HOUSES[i] / 10, cz0 = HOUSES[i + 1] / 10;
    const own = known.get(i / HS);
    if (TEPIC_RESERVES.some((r) => r.contains(cx0, cz0))) continue; // a landmark stands there (tepic-landmarks.ts)
    if (!storeHalls.has(i) && storeLots.some((r) => r.contains(cx0, cz0))) continue; // inside a store's hall
    const w0 = HOUSES[i + 2] / 10, d0 = HOUSES[i + 3] / 10;
    const th = HOUSES[i + 4] / 1000;
    const floors0 = HOUSES[i + 5];
    const kind = HOUSES[i + 6]; // front side + KIND bits (tools/build-tepic-geodata.mjs)
    const front = kind & 3;
    const shop0 = (kind & 4) !== 0;
    const big = (kind & 8) !== 0; // a hall
    const strip = !big && (kind & 16) !== 0; // a row of locales
    const coto = (kind & 32) !== 0 ? kind >> 6 : 0; // a gated community's house: its number + 1
    const signNo = HS > 7 ? HOUSES[i + 7] : 0; // 1-based into SIGNS
    const sign = signNo ? SIGNS[signNo - 1] : null;
    const chain = sign?.chain && sign.store !== undefined ? STOREFRONTS[sign.store] : null;
    const blk = blockOf(houseBlock[i / HS], cx0, cz0);
    seedDice((Math.imul(Math.round(cx0 * 4), 73856093) ^ Math.imul(Math.round(cz0 * 4), 19349663) ^ 4421) >>> 0);
    const cs = Math.cos(th), sn = Math.sin(th);
    const ou = front === 0 ? -1 : front === 1 ? 1 : 0;
    const ov = front === 2 ? -1 : front === 3 ? 1 : 0;
    // the street front runs along local z (fronts w / e) or local x (fronts n / s)
    const alongZ = ou !== 0;
    const along0 = alongZ ? d0 : w0;
    // split long fronts into houses, a strip plaza into its locales (never a chain store or a hall)
    const parts: Span[] = [];
    if (!chain && !big && !own && along0 > (strip ? 9 : 13)) {
      const n = Math.max(2, Math.round(along0 / (strip ? range(5, 7) : range(6.5, 9.5))));
      const cuts = [0];
      for (let k = 1; k < n; k++) cuts.push((k / n + (rand() - 0.5) * 0.25 / n) * along0);
      cuts.push(along0);
      for (let k = 0; k < n; k++) parts.push([cuts[k], cuts[k + 1]]);
    } else parts.push([0, along0]);
    const signPart = Math.floor(parts.length / 2);
    // a strip plaza's one colour; a coto's houses all in the developer's
    const plazaTone = coto ? 0.1 + 0.8 * (((Math.imul(coto, 2654435761) >>> 0) % 1000) / 1000) : rand();
    const plazaAwning = irange(0, 4);
    const plazaFloors = Math.min(2, floors0);
    parts.forEach(([t0, t1], k) => {
      const len = t1 - t0;
      const mid = (t0 + t1) * 0.5 - along0 * 0.5; // along the front, from the footprint's centre
      const u = alongZ ? 0 : mid, v = alongZ ? mid : 0;
      const cx = cx0 + u * cs + v * sn, cz = cz0 - u * sn + v * cs;
      const w = alongZ ? w0 : len, d = alongZ ? len : d0;
      const floors = own?.storeys ? own.storeys : chain || big || coto ? floors0 : strip ? plazaFloors
        : Math.max(1, Math.min(4, floors0 + (parts.length > 1 ? pickW([[0, 5], [1, 2], [-1, 1.5]]) : 0)));
      const hasSign = k === signPart && !!sign;
      const shop = strip || (shop0 && k === signPart) || (shop0 && chance(0.3));
      const h = floors * storeys[MEX] + (chain || big || strip ? 0.6 : range(0, 0.35));
      const tone = strip || coto ? plazaTone : rand();
      const side = big || strip ? WALL_KINDS.bigSide : WALL_KINDS.rear;
      const faces = [side, side, side, side];
      // (a taquería's, a bar's front: WALL_KINDS.shop + 0.25, its shutter up at night, tsl-materials.ts)
      const venue = hasSign && !chain ? signKind(sign, SIGNS) : null;
      const nightShop = venue && VENUE_KINDS[venue].night ? 0.25 : 0;
      faces[front] = chain && sign?.store !== undefined ? WALL_KINDS.chainStore + sign.store : big || strip ? WALL_KINDS.bigFront : shop ? WALL_KINDS.shop + nightShop : WALL_KINDS.entry;
      const hx = w * 0.5, hz = d * 0.5;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
      const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => ({ x: cx + a * cs + b * sn, z: cz - a * sn + b * cs }));
      // a house reaching into a landmark's lot more than a metre or so gives way to it (Overture's long footprints run
      // on behind the Catedral's neighbours: their other houses stay)
      const intoLandmark = ([[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] satisfies [number, number][]).some(([a, b]) => {
        const pa = a * Math.max(0, hx - 1.2), pb = b * Math.max(0, hz - 1.2);
        return TEPIC_RESERVES.some((r) => r.contains(cx + pa * cs + pb * sn, cz - pa * sn + pb * cs));
      });
      if (intoLandmark) return;
      // on a hillside (terrain.ts), and anywhere on the town's slopes (ground.ts), the house stands on
      // the slope: its floor at its lowest corner (a little into the ground), its roof a full height over its
      // highest, the downhill side's foundation showing
      // (the flat city's ground is 0 but on the hills; the town's slopes may be anywhere, even under the datum)
      let g0 = Infinity, g1 = SLOPES ? -Infinity : 0;
      for (const p of pts) {
        const g = groundHeight(p.x, p.z);
        g0 = Math.min(g0, g);
        g1 = Math.max(g1, g);
      }
      const onSlope = SLOPES || g1 > 0;
      const base = SLOPES ? g0 - 0.15 : onSlope ? Math.max(0, g0 - 0.15) : 0;
      const top = g1 + h;
      // a chain's front on a slope: how far its ground stands over the box's foot, where its glazing starts (the wall
      // kind's fraction, 1/25 per metre, up to 12 m: mexican-house.ts)
      if (chain) {
        const r = alongZ ? hx : hz;
        const sink = groundHeight(cx + (ou * r) * cs + (ov * r) * sn, cz - (ou * r) * sn + (ov * r) * cs) - base;
        faces[front] += Math.min(0.48, Math.max(0, sink) / 25);
      }
      // the centro's colonial houses (within ~620 m of the Plaza Principal; not the chains, halls, plazas or cotos): their
      // look is the house material's (cantera, guardapolvo, cornice, balcony doors); here their balconies, one at
      // each upper-floor window of the front (the material's window cells: one per ~3.4 m)
      const colonial = !chain && !big && !strip && !coto && Math.hypot(cx, cz) < 620;
      if (colonial && floors > 1 && !hasSign) { // (a shop's sign board runs across its upper floor)
        const L = alongZ ? d : w;
        const cells = Math.max(1, Math.floor(L / 3.4)), sp = L / cells;
        const nx = ou * cs + ov * sn, nz = -ou * sn + ov * cs; // the front's outward normal
        const yaw = Math.atan2(nx, nz);
        for (let fl = 1; fl < floors; fl++) {
          for (let k = 0; k < cells; k++) {
            const t = (k + 0.5) * sp - L / 2;
            const lu = alongZ ? ou * hx : t, lv = alongZ ? t : ov * hz;
            city.balconies.push({ x: cx + lu * cs + lv * sn, y: base + fl * storeys[MEX] + 0.35, z: cz - lu * sn + lv * cs, yaw });
          }
        }
      }
      city.buckets[MEX].push({ x: cx, y: (base + top) * 0.5, z: cz, w, h: top - base, d, faces, tone, ry: th, paint: own ? own.paint : null, colonial });
      // a big chain's store is walked into (store-interiors.ts: its walls, door & shelves collide instead)
      if (storeHalls.has(i) && chain) {
        city.stores.push({ cx, cz, w, d, th, front, base, top, name: chain.name, band: chain.facade.band });
      } else city.colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: base, maxY: top, obb: { cx, cz, hx, hz, cs, sn } });
      blk.footprints.push({ x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, h: top - liftAt(cx, cz), tone, pts }); // h: over the ground
      blk.minX = Math.min(blk.minX, cx - ex);
      blk.maxX = Math.max(blk.maxX, cx + ex);
      blk.minZ = Math.min(blk.minZ, cz - ez);
      blk.maxZ = Math.max(blk.maxZ, cz + ez);
      if (top > blk.maxH) blk.maxH = top;
      // a hall's air handlers on the roof, one per ~600 m2
      if (big) {
        const n = Math.max(2, Math.min(8, Math.floor((w * d) / 600)));
        for (let m = 0; m < n; m++) {
          const tu = range(-0.35, 0.35) * w, tv = range(-0.35, 0.35) * d;
          blk.hvacUnits.push({ x: cx + tu * cs + tv * sn, y: top, z: cz - tu * sn + tv * cs, w: range(2.4, 4.2), h: range(1.4, 2.2), d: range(2.4, 4.2) });
        }
      }
      // a black water tank on most roofs, back from the street
      if (!chain && !big && !strip && chance(0.72) && w > 3.2 && d > 3.2) {
        const tu = (alongZ ? -ou : 0) * range(0.1, 0.35) * w + (alongZ ? 0 : range(-0.3, 0.3) * w);
        const tv = (alongZ ? range(-0.3, 0.3) * d : -ov * range(0.1, 0.35) * d);
        blk.tinacos.push({ x: cx + tu * cs + tv * sn, y: top, z: cz - tu * sn + tv * cs, s: range(0.85, 1.15) });
      }
      // The street front: a chain's (or a named hall's) fascia, or a shop's awning with its sign above it
      if (!shop && !chain) return;
      const fascia = chain ?? (big && hasSign);
      const wide = chain ? chain.big : big;
      if (big && !fascia) return; // (no awning on a hall)
      const toFront = (out: number): Span => {
        const r = (ou ? hx : hz) + out;
        return [cx + (ou * r) * cs + (ov * r) * sn, cz - (ou * r) * sn + (ov * r) * cs];
      };
      // awnings are laid out along local z facing ±x: a front on a local n / s side turns a quarter more
      const ry = th + (ov ? (ov > 0 ? -Math.PI / 2 : Math.PI / 2) : 0);
      const gf = onSlope ? groundHeight(...toFront(0.9)) : 0; // the ground at the street front
      if (fascia) {
        // the logo box over the middle of the front (a supermarket's runs further along it, a car dealer's halfway)
        const [sx, sz] = toFront(0.25);
        const boxH = wide ? 1.8 : chain?.dealer ? 1.6 : 1.3;
        blk.awnings.push({ x: sx, y: 0, g: Math.max(gf, base), z: sz, w: 0, d: Math.min(len - 1.0, wide ? (chain ? 26 : 16) : chain?.dealer ? 12 : 5.2), sideDir: ou || 1, colorIdx: 0, ry,
          noAwning: true, sign: signNo - 1, signY: top - boxH * 0.5 + 0.35, signH: boxH, signW: 0.5 });
        const pole = (DEALER_LOTS.get(i / HS) ?? 0) + 1.4; // (out past a dealer's lot)
        if (chain?.pylon) city.pylons.push({ front: toFront(pole), y: onSlope ? groundHeight(...toFront(pole)) : 0, ry, along: len, slot: signNo - 1, ou, ov, cs, sn, pylon: chain.pylon });
      } else if (hasSign || chance(0.55)) {
        const [ax, az] = toFront(0.9);
        const [sx, sz] = toFront(0.16); // the sign flat on the wall above the awning
        // (a one-storey shop's awning just over 1.9 m up and its sign standing on the parapet, a board over the roof
        // line: tucked under it, the sign hid behind the awning's 1.5 m of canvas from the sidewalk. 0.35 m over the
        // awning's top, it clears its front edge for an eye 1.6 m up from about 8 m out)
        const awningY = floors < 2 ? 2.3 : Math.min(2.7, storeys[MEX] * 0.9) - 0.15;
        const signY = Math.max(gf, base) + (floors < 2 ? Math.max(h - 0.33, awningY + 0.375 + 0.35 + 0.31) : storeys[MEX] + 0.6);
        const sg = hasSign ? signNo - 1 : undefined;
        // (no business on record: an awning with no sign, never a made-up name)
        blk.awnings.push({ x: ax, y: Math.max(gf, base) + awningY, g: Math.max(gf, base), z: az, w: 1.5, d: Math.min(7, len - 1.2), sideDir: ou || 1,
          colorIdx: strip ? plazaAwning : irange(0, 4), ry, sign: sg, signY, signPX: sx, signPZ: sz, signW: 0.12, signH: 0.62 });
      }
    });
  }
  for (const blk of byBlock.values()) {
    blk.footprints.sort((a, b) => a.h - b.h);
    city.quadtree.insert(blk);
    city.allBlocks.push(blk);
  }
}

export { indexHouseBlocks, buildHouses };
