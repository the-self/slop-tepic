// js/world/ground.ts
// The ground everything stands on, as heights over the world's y = 0. Two grids from tools/build-tepic-geodata.mjs:
// - GEO.terrain, the hills around the valley over its flat floor (zero under the town);
// - GEO.ground, the town's own slopes (its blurred elevation over the datum, the town's lowest point), which ?slopes=0
//   leaves out (the flat city, as it was built before).
// The rivers & arroyos (GEO.waterways, waterways.ts) are cut into it: their channels carve the ground everyone stands
// on, but not the floor the city's layers are laid on (the road deck opens over them instead, river-channels.ts). The
// underpasses (the road links sunk under others, underpasses.ts) are cut into it alike, the deck opened over them
// where they run open to the sky (bridges.ts draws their walls).
// Everything the city builds at y = 0 is raised by the ground under it (liftAt), its flat layers laid on it (drape.ts).
// No three.js here, so node --test imports it directly.
import { GEO } from './city-geodata.js';
import { createWaterways } from './waterways.ts';
import { createUnderpasses } from './underpasses.ts';
import { decodeHeights, gridSampler, clipToLattice } from './lattice.ts';
import type { Footbridge, Ground, HeightGrid, Road, RoadGraph, Waterway } from './city-geodata.js';
import type { HeightFn, Lattice } from './lattice.ts';

/** What createGround reads of the city data (GEO, or a test's grids). */
export interface GroundSource {
  terrain?: HeightGrid | null;
  ground?: Ground | null;
  waterways?: Waterway[] | null;
  roads?: Road[] | null;
  roadGraph?: RoadGraph | null;
}
/** The town's grid with slopes, its heights decoded (m over the datum), for the shaders. */
export type TownGrid = Omit<Ground, 'data'> & { data: undefined; heights: Float32Array };
/** Height (m) of the ground at (x, z), under a bridge for a body coming from `fromY` down in a channel. */
export type GroundHeightFn = (x: number, z: number, fromY?: number) => number;
export type GroundModel = ReturnType<typeof createGround>;

/** A piece of bridge deck: from (ax, az) lifted la m over the ground to (bx, bz) lifted lb, half its width (m). */
export interface DeckSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  la: number;
  lb: number;
  half: number;
}
/** A raised junction: a disc of deck of radius r (m), lift m over the ground. */
export interface DeckJunction {
  x: number;
  z: number;
  r: number;
  lift: number;
}
export interface Decks {
  segments: DeckSegment[];
  junctions: DeckJunction[];
  deckLift: (x: number, z: number, over?: number, step?: number) => number;
}

const SINK = 0.08; // the flat parts of the hills' mesh sit just under the streets & meadows

function createGround(geo: GroundSource, { slopes = false }: { slopes?: boolean } = {}) {
  const hillHeights = geo.terrain ? decodeHeights(geo.terrain) : null;
  /** Height (m) of the hills over the valley floor at (x, z): 0 in town and beyond the data */
  const terrainHeight: HeightFn = hillHeights && geo.terrain ? gridSampler(geo.terrain, hillHeights, 0) : () => 0;
  /** The hills' ground for anything standing on them (0 in town) */
  const hillGround = (x: number, z: number) => {
    const h = terrainHeight(x, z);
    return h > SINK ? h - SINK : 0;
  };

  const townGround = slopes && geo.ground ? geo.ground : null;
  const townHeights = townGround ? decodeHeights(townGround) : null;
  const town = townHeights && townGround ? gridSampler(townGround, townHeights, townGround.floor) : null;
  /** Height (m) of the town's floor at (x, z): its slopes, or 0 in the flat city (?slopes=0) */
  const townHeight: HeightFn = town ?? (() => 0);
  /** Height (m) of the land at (x, z): the town's floor and the hills over it, the channels left out */
  const landHeight: HeightFn = town ? (x: number, z: number) => town(x, z) + hillGround(x, z) : hillGround;
  // the channels, sunk into the town's floor where the hills leave it bare, and bridged by the streets
  const waterways = geo.waterways?.length
    ? createWaterways(geo.waterways, { floor: townHeight, hills: terrainHeight, roads: (geo.roads ?? []).map((r) => ({ w: r[1], pts: r[5] })) })
    : null;
  /**
   * Height (m) of the ground at grade at (x, z): the land and the channels cut into it (under a bridge for a body
   * coming from `fromY` down in the channel, else on it), the underpasses left out: what the road links' lifts are
   * reckoned from (the traffic's ground)
   */
  const gradeHeight: GroundHeightFn = waterways
    ? (x: number, z: number, fromY?: number) => landHeight(x, z) + waterways.offset(x, z, fromY) : landHeight;
  // the underpasses, sunk into the ground at grade and roofed by the streets over them
  const cuts = createUnderpasses(geo.roadGraph, { grade: (x, z) => gradeHeight(x, z) });
  const underpasses = cuts.cuts.length ? cuts : null;
  /**
   * Height (m) of the ground at (x, z): the ground at grade and the underpasses cut into it (under a roof for a body
   * coming from `fromY` down in the tunnel, else on it)
   */
  const groundHeight: GroundHeightFn = underpasses
    ? (x: number, z: number, fromY?: number) => gradeHeight(x, z, fromY) + underpasses.offset(x, z, fromY) : gradeHeight;
  /**
   * The ground's gradient at (x, z) into out: [rise per metre east (+x), rise per metre south (+z)], central differences
   * over a metre (the grids' triangles are 25-75 m, so this is their plane's tilt but for a metre at their edges)
   */
  const groundSlope = (x: number, z: number, out: number[] = [0, 0]) => {
    out[0] = (groundHeight(x + 0.5, z) - groundHeight(x - 0.5, z));
    out[1] = (groundHeight(x, z + 0.5) - groundHeight(x, z - 0.5));
    return out;
  };

  return {
    slopes: Boolean(town),
    datum: geo.ground ? geo.ground.datum : null,
    // the town's grid { x0, z0, cell, w, h, floor, heights } with slopes (for the shaders), else null
    townGrid: townHeights && townGround ? { ...townGround, data: undefined, heights: townHeights } : null,
    hillHeights,
    terrainHeight,
    hillGround,
    townHeight,
    landHeight,
    waterways,
    underpasses,
    gradeHeight,
    groundHeight,
    groundSlope
  };
}

// The town on its slopes, unless ?slopes=0 asks for the flat city
const SLOPES = typeof location === 'undefined' || new URLSearchParams(location.search).get('slopes') !== '0';
const ground = createGround(GEO, { slopes: SLOPES });
const { townGrid, hillHeights, terrainHeight, hillGround, townHeight, landHeight, waterways, underpasses, gradeHeight, groundHeight, groundSlope } = ground;
/** The holes the river channels and the open underpasses make in the road deck (flat triangles x0, z0, x1, z1, x2, z2) */
const deckHoles = (): number[] => [...(waterways?.holes() ?? []), ...(underpasses?.holes() ?? [])];
// The lattice of both grids' triangles: the town's, whose cells halve the hills' 75 m ones on their own lines (see the
// geodata builder), so its triangles lie each in one of theirs
const LATTICE: Lattice | null = GEO.ground ? { x0: GEO.ground.x0, z0: GEO.ground.z0, cell: GEO.ground.cell }
  : GEO.terrain ? { x0: GEO.terrain.x0, z0: GEO.terrain.z0, cell: GEO.terrain.cell } : null;
/**
 * How far up to set something the city builds at y = 0 (a lamppost, a tree, a house's floor) standing at (x, z): the
 * ground, or 0 in the flat city (?slopes=0)
 */
const liftAt: GroundHeightFn = SLOPES ? groundHeight : () => 0;

/**
 * The decks of the bridges & their ramps (geodata roadGraph links' `lifts`: m over the ground at each vertex, piecewise
 * linear between them), as segments { ax, az, bx, bz, la, lb, half } (in 32 m cells, deckIndex)
 */
function createDecks(geo: { roadGraph?: RoadGraph | null }): Decks {
  const RG = geo.roadGraph;
  const segments: DeckSegment[] = [];
  const junctions: DeckJunction[] = []; // raised junctions: { x, z, r, lift } discs of deck joining the links that meet there
  if (RG) {
    const N = RG.nodes;
    const ends = new Map<number, [number, number, number]>(); // node -> [links meeting there, their lift there, the widest half width]
    for (const link of RG.links) {
      for (const [n, k] of [[link[0], 0], [link[1], -1]]) {
        const e = ends.get(n) ?? [0, 0, 0];
        e[0]++;
        if (link[7]) e[1] = Math.max(e[1], (link[7].at(k) ?? 0) / 10);
        e[2] = Math.max(e[2], link[3] / 2 + 0.4);
        ends.set(n, e);
      }
    }
    for (const [n, [count, lift, half]] of ends) {
      if (count > 2 && lift > 0) junctions.push({ x: N[n * 2], z: N[n * 2 + 1], r: half + 1.5, lift });
    }
    for (const link of RG.links) {
      const lifts = link[7];
      if (!lifts) continue;
      const pts: [number, number][] = [[N[link[0] * 2], N[link[0] * 2 + 1]]];
      for (let k = 0; k < link[6].length; k += 2) pts.push([link[6][k], link[6][k + 1]]);
      pts.push([N[link[1] * 2], N[link[1] * 2 + 1]]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const la = lifts[i] / 10, lb = lifts[i + 1] / 10;
        if (la <= 0 && lb <= 0) continue;
        segments.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], la, lb, half: link[3] / 2 + 0.4 });
      }
    }
  }
  // (a junction's disc as a segment of no length: every point within its radius)
  for (const j of junctions) segments.push({ ax: j.x, az: j.z, bx: j.x, bz: j.z, la: j.lift, lb: j.lift, half: j.r });
  return { segments, junctions, deckLift: deckIndex(segments) };
}

/**
 * The footbridges' walkways & stairs (geodata footbridges: their lifts as the roads'), for those on foot only: a car
 * doesn't climb their stairs
 */
function createFootDecks(geo: { footbridges?: Footbridge[] | null }): Decks {
  const segments: DeckSegment[] = [];
  for (const [flat, lifts, width] of geo.footbridges ?? []) {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      segments.push({ ax: flat[i], az: flat[i + 1], bx: flat[i + 2], bz: flat[i + 3], la: lifts[i / 2] / 10, lb: lifts[i / 2 + 1] / 10, half: width / 20 });
    }
  }
  return { segments, junctions: [], deckLift: deckIndex(segments) };
}

// The segments in 32 m cells, and the lift a body reaches at (x, z) on them (Decks.deckLift)
function deckIndex(segments: readonly DeckSegment[]): Decks['deckLift'] {
  const CELL = 32;
  const cells = new Map<number, DeckSegment[]>();
  for (const sg of segments) {
    const r = sg.half;
    for (let ix = Math.floor((Math.min(sg.ax, sg.bx) - r) / CELL); ix <= Math.floor((Math.max(sg.ax, sg.bx) + r) / CELL); ix++) {
      for (let iz = Math.floor((Math.min(sg.az, sg.bz) - r) / CELL); iz <= Math.floor((Math.max(sg.az, sg.bz) + r) / CELL); iz++) {
        const k = ix * 100003 + iz;
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(sg);
      }
    }
  }
  /**
   * The lift (m over the ground) of the highest deck at (x, z) that a body `over` m over the ground there can step or
   * drive onto (up to `step` m above it: up a ramp, never up onto a span overhead), or 0
   */
  const deckLift = (x: number, z: number, over = Infinity, step = 1.2) => {
    const list = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!list) return 0;
    let best = 0, past = 0;
    for (const sg of list) {
      const ux = sg.bx - sg.ax, uz = sg.bz - sg.az;
      const L2 = ux * ux + uz * uz;
      let tc = 0, beyond = false;
      if (L2 === 0) {
        if (Math.hypot(x - sg.ax, z - sg.az) > sg.half) continue; // a junction's disc
      } else {
        // along the segment (a little past its ends, so a deck's joints hold), and across it within its half width
        const t = ((x - sg.ax) * ux + (z - sg.az) * uz) / L2;
        const L = Math.sqrt(L2);
        if (t < -sg.half / L || t > 1 + sg.half / L) continue;
        tc = Math.min(1, Math.max(0, t));
        beyond = tc !== t;
        if (Math.abs((x - sg.ax) * uz - (z - sg.az) * ux) / L > sg.half) continue;
      }
      const lift = sg.la + (sg.lb - sg.la) * tc;
      if (lift > (beyond ? past : best) && lift <= over + step) {
        if (beyond) past = lift;
        else best = lift;
      }
    }
    // A segment's run past its end (its end's lift held) only fills the outside of a bend, where no segment's own
    // span reaches: on a ramp it would hold the next vertex's lift half a deck's width early, a step at every vertex
    return best || past;
  };
  return deckLift;
}

const decks = createDecks(GEO);
const { deckLift } = decks;
const footDecks = createFootDecks(GEO);
/** deckLift for someone on foot: the roads' decks and the footbridges' */
const walkDeckLift = (x: number, z: number, over = Infinity, step = 1.2) =>
  Math.max(deckLift(x, z, over, step), footDecks.deckLift(x, z, over, step));
/**
 * The surface under a body at (x, z) whose feet (or wheels) are at height y: the ground, or a bridge's deck it is on or
 * reaches up a ramp; with y left out the ground alone
 */
const surfaceHeight = (x: number, z: number, y?: number): number => {
  const g = groundHeight(x, z, y); // (down in a river channel under a street, for a body already down there)
  return y === undefined ? g : g + deckLift(x, z, y - g);
};

export {
  SINK, SLOPES, LATTICE, createGround, clipToLattice, liftAt, townGrid,
  hillHeights, terrainHeight, hillGround, townHeight, landHeight, waterways, underpasses, deckHoles, gradeHeight, groundHeight, groundSlope,
  createDecks, createFootDecks, decks, footDecks, deckLift, walkDeckLift, surfaceHeight
};
