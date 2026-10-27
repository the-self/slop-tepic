import { GEO } from '../world/city-geodata.js';
import {
  ROADS,
  BLOCKS,
  CITY_LANDMARKS,
  ISLAND_BOUNDS,
  getIslandBoundsAtZ,
  CITY_OUTLINE,
  getLocationLabel,
  isTypingInField
} from '../world/city-config.ts';
import type { Bounds, CityLandmark, CityRoad, PointXZ } from '../world/city-config.ts';
import type { Footprint } from '../world/buildings.ts';
import type { Blips, SightCones } from '../sim/crime.ts';
import { SIGHT } from '../sim/crime-rules.ts';
import type { Vector3 } from 'three/webgpu';

// js/ui/city-map.ts
// GTA 6-Style Live Radar Minimap + Full-Screen Interactive City Map.
// Synchronized 1:1 with the 3D world (1 unit = 1 m; x = east, z = south on the centro's street grid, GEO.frame.bearingDeg
// east of true north; both maps turn it back, true north up, so they match every other map of Tepic). They draw the very geography the city is built
// from (GEO, from OpenStreetMap & Overture Maps): the city outline, every curb island (block) with the building
// footprints standing on it, the parks, the highways, the real street centrelines (labelled along their course), the
// colonias and the points of interest.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FRAME = GEO.frame;
const MIN_ZOOM = 0.05; // full map, pixels per metre: the whole valley
const MAX_ZOOM = 3.0; // single lots
const RADAR_SCALE = 0.32; // radar pixels per metre on the ground (zooms out with altitude)
const GRID_BEARING = Number.isFinite(FRAME.bearingDeg) ? FRAME.bearingDeg : 0; // the grid's north, degrees east of true north
// Both maps are drawn true north up, as on any other map of Tepic: the world (grid north up) turned clockwise by the
// grid's bearing on screen
const MAP_ROT = (GRID_BEARING * Math.PI) / 180;

// Map palette, shared by the radar & the atlas (in step with css/style.css): graphite ground with the streets a shade
// lighter than the blocks they run between, muted parks; white landmarks & player, cyan search hits and amber
// highways. A city of one- and two-storey houses: its real buildings drawn in warm, brighter
// tones so every house reads
const MAP = {
  streets: '#363f4b', // inside the city outline: the roadway left between the blocks
  shore: '#4f5b6b',
  park: '#19301f',
  parkEdge: '#24432f',
  block: '#1c2128',
  blockEdge: '#272e37',
  buildings: ['#5a4f45', '#6b5e50', '#7c6c5b'],
  buildingEdge: '#2a241f',
  mainRoads: '#3a434f',
  water: '#2f6fae', // the rivers, arroyos & reservoirs
  waterLabel: '#8cc1ee',
  highway: '#b27a35',
  airfield: '#5d6470', // the airport's runway, taxiways & apron
  parking: '#2b323b', // the car parks: paved ground on the blocks, darker than the streets
  search: '#5fd0ff',
  halo: 'rgba(8, 11, 15, 0.9)'
};

// The dry valley floor around the city
// Radar blips for crime.ts: [colour, radius in px]
const BLIP_STYLES: Partial<Record<string, readonly [colour: string, radius: number]>> = {
  cop: ['#4d8dff', 3], cruiser: ['#4d8dff', 4.2], rojos: ['#ff4d4d', 3], verdes: ['#45d16b', 3], thief: ['#f2f2f2', 3.4],
  narcos: ['#c9a24a', 3.2], truck: ['#c9a24a', 4.4], soldier: ['#8fb35a', 3], army: ['#8fb35a', 4.4], heli: ['#4d8dff', 5.2],
  money: ['#6fe39a', 2.6], health: ['#ff6b6b', 3], armor: ['#7fb0ff', 3], pistol: ['#ffd24a', 2.6], smg: ['#ffa53a', 2.6],
  rifle: ['#d6e04a', 2.8], bazooka: ['#ff7a2a', 3.4],
  fire: ['#ff5a1f', 5], // (a fire burning, sim/fires.ts)
  firetruck: ['#ff3b30', 4.4], ambulance: ['#ffffff', 4.2],
  spikes: ['#ffd24a', 3.6], // (a police spike strip across the road, crime/spikes.ts)
  fuel: ['#2fbf71', 2.6] // (a gas station, sim/gas-stations.ts) // (the bomberos & the Cruz Roja on their way, sim/emergency.ts)
};
const MAP_BASE = '#101511';

// The city's colonias (GEO.places) at their real places (world metres)
const AREA_LABELS = GEO.places.map((p): [label: string, x: number, z: number] => [p.name.toUpperCase(), p.x, p.z]);

// ---------------------------------------------------------------------------------------------------------------------
// World-space vector layers: built once into Path2D objects (world metres) and drawn through a canvas transform
// ---------------------------------------------------------------------------------------------------------------------

/** A ring or polyline: [{x, z}, ...] or flat [x0, z0, x1, z1, ...] (m) */
type Pts = readonly PointXZ[] | readonly number[];
interface Accessor {
  n: number;
  X: (i: number) => number;
  Z: (i: number) => number;
}

const isFlat = (pts: Pts): pts is readonly number[] => typeof pts[0] === 'number';

// Point accessors for rings / polylines given as [{x, z}, ...] or flat [x0, z0, x1, z1, ...]
function accessor(pts: Pts): Accessor {
  if (isFlat(pts)) return { n: pts.length >> 1, X: (i) => pts[2 * i], Z: (i) => pts[2 * i + 1] };
  return { n: pts.length, X: (i) => pts[i].x, Z: (i) => pts[i].z };
}

function boundsOf(pts: Pts): Bounds {
  const { n, X, Z } = accessor(pts);
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = X(i);
    const z = Z(i);
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

// Appends a closed ring, always wound the same way as Path2D.rect (so overlapping rings of one path union under the
// nonzero fill rule instead of cancelling out)
function addRing(path: Path2D, pts: Pts | null | undefined): void {
  if (!pts || pts.length < 3) return;
  const { n, X, Z } = accessor(pts);
  if (n < 3) return;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += X(j) * Z(i) - X(i) * Z(j);
  if (a >= 0) {
    path.moveTo(X(0), Z(0));
    for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
  } else {
    path.moveTo(X(n - 1), Z(n - 1));
    for (let i = n - 2; i >= 0; i--) path.lineTo(X(i), Z(i));
  }
  path.closePath();
}

function addLine(path: Path2D, pts: Pts | null | undefined): void {
  if (!pts || pts.length < 2) return;
  const { n, X, Z } = accessor(pts);
  path.moveTo(X(0), Z(0));
  for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
}

/**
 * A vector layer split into square tiles of Path2D, so a view only rasterizes the tiles it overlaps. Every item goes
 * to the tile holding its centre; a tile's bounds grow to cover its items.
 */
interface LayerTile extends Bounds {
  path: Path2D;
}

class TiledLayer {
  size: number; // m, a tile's side
  tiles: Map<string, LayerTile>;

  constructor(size = 500) {
    this.size = size;
    this.tiles = new Map();
  }

  pathFor(b: Bounds): Path2D {
    const ix = Math.floor((b.minX + b.maxX) * 0.5 / this.size);
    const iz = Math.floor((b.minZ + b.maxZ) * 0.5 / this.size);
    const key = `${ix},${iz}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { path: new Path2D(), minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
      this.tiles.set(key, t);
    } else {
      t.minX = Math.min(t.minX, b.minX);
      t.maxX = Math.max(t.maxX, b.maxX);
      t.minZ = Math.min(t.minZ, b.minZ);
      t.maxZ = Math.max(t.maxZ, b.maxZ);
    }
    return t.path;
  }

  ring(pts: Pts | null | undefined): void {
    if (pts && pts.length > 2) addRing(this.pathFor(boundsOf(pts)), pts);
  }

  line(pts: Pts | null | undefined): void {
    if (pts && pts.length > 1) addLine(this.pathFor(boundsOf(pts)), pts);
  }

  rect(x0: number, z0: number, x1: number, z1: number): void {
    this.pathFor({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }).rect(x0, z0, x1 - x0, z1 - z0);
  }

  /** Calls fn(path) for every tile overlapping the view */
  each(v: Bounds, fn: (path: Path2D) => void): void {
    for (const t of this.tiles.values()) {
      if (t.maxX < v.minX || t.minX > v.maxX || t.maxZ < v.minZ || t.minZ > v.maxZ) continue;
      fn(t.path);
    }
  }
}

/** A river's name along its course: world metres, angle in radians from +x towards +z */
interface RiverName {
  name: string;
  x: number;
  z: number;
  angle: number;
  river: boolean; // (else an arroyo)
}

/** The maps' world-space layers (world metres), built once */
interface MapLayers {
  city: Path2D;
  parkLand: TiledLayer;
  water: TiledLayer;
  rivers: TiledLayer;
  streams: TiledLayer;
  drains: TiledLayer;
  riverNames: RiverName[];
  aprons: TiledLayer;
  runways: TiledLayer;
  taxiways: TiledLayer;
  blocks: TiledLayer;
  parkBlocks: TiledLayer;
  parking: TiledLayer;
  mainRoads: TiledLayer;
  highways: Path2D;
}

let LAYERS: MapLayers | null = null;
function mapLayers(): MapLayers {
  if (LAYERS) return LAYERS;
  const L: MapLayers = {
    city: new Path2D(),
    parkLand: new TiledLayer(),
    water: new TiledLayer(),
    rivers: new TiledLayer(1000),
    streams: new TiledLayer(1000),
    drains: new TiledLayer(1000),
    riverNames: [],
    aprons: new TiledLayer(1000),
    runways: new TiledLayer(1000),
    taxiways: new TiledLayer(1000),
    blocks: new TiledLayer(),
    parkBlocks: new TiledLayer(),
    parking: new TiledLayer(),
    mainRoads: new TiledLayer(1000),
    highways: new Path2D()
  };

  // The city outline (the roadway deck colour: the streets are the gaps between the blocks)
  addRing(L.city, CITY_OUTLINE);

  // Parkland, the curb islands (blocks: raised sidewalks & lots) and the park blocks, exactly as city-grid.ts /
  // buildings.ts treat them
  for (const park of GEO.parks) for (const ring of park.rings) (park.cat === 'water' ? L.water : L.parkLand).ring(ring);
  // The rivers & arroyos (GEO.waterways, above ground) by width: the Mololoa, the arroyos the blocks leave a gap for,
  // the canals & drains; and anchors for the rivers' names along their course, every ~1.2 km
  for (const [kind, , name, flags, pts] of GEO.waterways) {
    if (flags & 2) continue;
    (kind === 'river' ? L.rivers : kind === 'stream' ? L.streams : L.drains).line(pts);
    if (!name || (kind !== 'river' && kind !== 'stream')) continue;
    let along = 600;
    for (let i = 2; i + 1 < pts.length; i += 2) {
      const dx = pts[i] - pts[i - 2], dz = pts[i + 1] - pts[i - 1];
      along += Math.hypot(dx, dz);
      if (along < 1200) continue;
      along = 0;
      L.riverNames.push({ name, x: pts[i], z: pts[i + 1], angle: Math.atan2(dz, dx), river: kind === 'river' });
    }
  }
  // The airport: its apron & helipads, the runway and the taxiways (GEO.airport, drawn at their real widths)
  const airport = GEO.airport;
  for (const ring of [...airport.aprons, ...airport.helipads]) L.aprons.ring(ring);
  for (const [, , pts] of airport.runways) L.runways.line(pts);
  for (const [, , pts] of airport.taxiways) L.taxiways.line(pts);
  for (const b of BLOCKS) (b.park > 0.6 && !b.median ? L.parkBlocks : L.blocks).ring(b.poly);
  for (const [, , , ring] of GEO.parking) L.parking.ring(ring);

  // Street network at low zoom (the wide streets, once the gaps between blocks are under a pixel) and the highways
  for (const r of ROADS) {
    if (r.highway) {
      if (!/Underpass|Tunnel/.test(r.name)) addLine(L.highways, r.pts);
    } else if (r.w >= 15) L.mainRoads.line(r.pts);
  }

  LAYERS = L;
  return L;
}

/** What the maps read of a block of buildings (world/buildings.ts BlockDetail) */
export interface MapBlock {
  footprints?: readonly Footprint[];
}
/** The footprints by height, for `src` as it was when it had `n` blocks; version counts the rebuilds */
interface FootprintLayers {
  src: readonly MapBlock[];
  n: number;
  tones: [TiledLayer, TiledLayer, TiledLayer];
  version: number;
}

// Building footprints as generated by buildings.ts, by height: up to 45 m, 95 m, taller
let FOOTPRINTS: FootprintLayers | null = null;
function footprintLayers(all: readonly MapBlock[] | null | undefined): FootprintLayers | null {
  if (!all?.length) return null;
  if (FOOTPRINTS?.src === all && FOOTPRINTS.n === all.length) return FOOTPRINTS;
  const tones: FootprintLayers['tones'] = [new TiledLayer(), new TiledLayer(), new TiledLayer()];
  for (const blk of all) {
    for (const f of blk.footprints ?? []) {
      const layer = tones[f.h > 95 ? 2 : f.h > 45 ? 1 : 0];
      if (f.pts) layer.ring(f.pts); // turned to follow a non-grid street
      else layer.rect(f.x0, f.z0, f.x1, f.z1);
    }
  }
  FOOTPRINTS = { src: all, n: all.length, tones, version: FOOTPRINTS ? FOOTPRINTS.version + 1 : 1 };
  return FOOTPRINTS;
}

// Street name labels: anchors every ~260 m along each straight run of a real centreline (fixed in the world, so labels
// never slide while the map pans), with the direction of the street there (never upside down: vertical names read
// upwards)
/** A place along a street for its name: world metres; ang in radians (never upside down), len the run's metres */
interface LabelAnchor {
  x: number;
  z: number;
  ang: number;
  len: number;
}
interface RoadLabel extends Bounds {
  text: string;
  lower: string;
  raw: string;
  road: CityRoad;
  major: boolean;
  highway: boolean;
  anchors: LabelAnchor[];
}
const ROAD_LABELS: RoadLabel[] = [];
for (const r of ROADS) {
  const text = r.name;
  if (!text || text.startsWith('Unnamed')) continue;
  const anchors: LabelAnchor[] = [];
  const pts = r.pts;
  for (let i = 0; i + 1 < pts.length;) {
    // the straight run from pts[i]: consecutive segments within ~5° of its first one (the centreline has a vertex at
    // every intersection, so a long street is a chain of short blocks)
    const a = pts[i];
    const dir = Math.atan2(pts[i + 1].z - a.z, pts[i + 1].x - a.x);
    let j = i + 1;
    while (j + 1 < pts.length) {
      const d = Math.atan2(pts[j + 1].z - pts[j].z, pts[j + 1].x - pts[j].x);
      let turn = Math.abs(d - dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.09) break;
      j++;
    }
    const c = pts[j];
    i = j;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 20) continue;
    let ang = Math.atan2(c.z - a.z, c.x - a.x);
    if (ang >= Math.PI * 0.5 - 0.01) ang -= Math.PI;
    else if (ang < -Math.PI * 0.5 - 0.01) ang += Math.PI;
    const k = Math.max(1, Math.round(len / 260));
    for (let m = 0; m < k; m++) {
      const t = (m + 0.5) / k;
      anchors.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, ang, len: len / k });
    }
  }
  if (!anchors.length) continue;
  ROAD_LABELS.push({
    text,
    lower: text.toLowerCase(),
    raw: r.name.toLowerCase(),
    road: r,
    major: r.highway || r.w >= 15,
    highway: r.highway,
    anchors,
    ...boundsOf(r.pts)
  });
}
const ROAD_NAME_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;

/**
 * A map viewport: centre (cx, cz) in world metres, s pixels per metre, w x h CSS pixels on a canvas of pixel ratio dpr,
 * the world turned `rot` radians clockwise on screen (MAP_ROT: true north up). minX..maxZ bound what it can see.
 */
class MapView implements Bounds {
  cx: number;
  cz: number;
  s: number; // pixels per metre
  w: number; // CSS px
  h: number;
  dpr: number;
  cos: number;
  sin: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;

  constructor(cx: number, cz: number, s: number, w: number, h: number, dpr = 1, rot = MAP_ROT) {
    this.cx = cx;
    this.cz = cz;
    this.s = s;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    // the turned screen's bounds in the world
    const c = Math.abs(this.cos), n = Math.abs(this.sin);
    const hx = (w * c + h * n) / (2 * s), hz = (w * n + h * c) / (2 * s);
    this.minX = cx - hx;
    this.maxX = cx + hx;
    this.minZ = cz - hz;
    this.maxZ = cz + hz;
  }

  /** Canvas transform for world metres */
  world(ctx: CanvasRenderingContext2D): void {
    const { s, dpr, cos, sin } = this;
    const a = s * cos, b = s * sin;
    ctx.setTransform(a * dpr, b * dpr, -b * dpr, a * dpr,
      dpr * (this.w * 0.5 - a * this.cx + b * this.cz), dpr * (this.h * 0.5 - b * this.cx - a * this.cz));
  }

  /** Canvas transform for CSS pixels from the canvas centre (what toX / toY return) */
  screen(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5);
  }

  toX(x: number, z: number): number {
    return ((x - this.cx) * this.cos - (z - this.cz) * this.sin) * this.s;
  }

  toY(x: number, z: number): number {
    return ((x - this.cx) * this.sin + (z - this.cz) * this.cos) * this.s;
  }

  sees(b: Bounds | null | undefined): boolean {
    return !!b && b.maxX >= this.minX && b.minX <= this.maxX && b.maxZ >= this.minZ && b.minZ <= this.maxZ;
  }
}

// A direction in the world (radians from +x towards +z) as drawn on the map, turned so text never reads upside down
function uprightAngle(ang: number): number {
  let a = ang + MAP_ROT;
  while (a > Math.PI * 0.5 + 0.01) a -= Math.PI;
  while (a <= -Math.PI * 0.5 - 0.01) a += Math.PI;
  return a;
}

// Screen pixels (dx, dy) from the centre -> world metres (dx, dz) from the centre, at s pixels per metre
function screenToWorldDelta(dx: number, dy: number, s: number): { x: number; z: number } {
  const c = Math.cos(MAP_ROT), n = Math.sin(MAP_ROT);
  return { x: (dx * c + dy * n) / s, z: (-dx * n + dy * c) / s };
}

// Pixels per metre that fit the bounds b in w x h CSS pixels with the margins mx, my (as drawn: turned by MAP_ROT)
function fitScale(b: Bounds, w: number, h: number, mx: number, my: number): number {
  const c = Math.abs(Math.cos(MAP_ROT)), n = Math.abs(Math.sin(MAP_ROT));
  const bw = b.maxX - b.minX, bd = b.maxZ - b.minZ;
  return Math.min(w / ((bw * c + bd * n) * mx + 1), h / ((bw * n + bd * c) * my + 1));
}

/** What the radar's police sight cones use of the crime system (sim/crime.ts) */
interface PoliceSight {
  wanted: { stars: number };
  sight: SightCones;
}

// Lightbar colours the police blink between on the radar, each unit a half beat from the next
const SIREN = ['#ff3b3b', '#3b82ff'] as const;
const sirenPhase = () => (performance.now() % 700 < 350 ? 0 : 1);

// Where the police can see the player while it is wanted, GTA-style: a cone like a torch's beam out of each of them,
// turning with them, and a little circle round them (right beside them); the helicopter's all round (it looks down).
// The overlapping ones are filled as one. Out of all of them, the stars start to go (crime-rules.ts Wanted).
function drawPoliceSight(ctx: CanvasRenderingContext2D, v: MapView, police: PoliceSight | null | undefined): void {
  if (!police || police.wanted.stars === 0 || police.sight.length === 0) return;
  const c = police.sight;
  ctx.beginPath();
  for (let i = 0; i < c.length; i += SIGHT) {
    const x = v.toX(c[i], c[i + 1]), y = v.toY(c[i], c[i + 1]);
    const r = c[i + 2] * v.s, half = c[i + 4], near = c[i + 5] * v.s;
    if (half >= Math.PI) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      continue;
    }
    // where it looks, turned onto the screen (a point ahead of it through the map's own turn)
    const ax = c[i] + Math.sin(c[i + 3]), az = c[i + 1] + Math.cos(c[i + 3]);
    const look = Math.atan2(v.toY(ax, az) - y, v.toX(ax, az) - x);
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, look - half, look + half);
    ctx.closePath();
    if (near > 0) {
      ctx.moveTo(x + near, y);
      ctx.arc(x, y, near, 0, Math.PI * 2);
    }
  }
  const blue = sirenPhase();
  ctx.fillStyle = blue ? 'rgba(59, 130, 246, 0.32)' : 'rgba(239, 68, 68, 0.32)';
  ctx.strokeStyle = blue ? 'rgba(96, 165, 250, 0.85)' : 'rgba(248, 113, 113, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();
}

// The police, gangs, thieves, pickups, fires & gas stations (crime.ts blips: kind, x, z, ...), on either map, clamped to
// its edge; the police (on foot, their patrol cars, the helicopter) blinking red and blue like their lightbars, each a
// half beat from the last
function drawBlips(ctx: CanvasRenderingContext2D, v: MapView, blips: Blips): void {
  const siren = sirenPhase();
  for (let i = 0, n = 0; i < blips.length; i += 3) {
    const kind = blips[i];
    const style = BLIP_STYLES[kind];
    const x = blips[i + 1];
    const z = blips[i + 2];
    if (!style || typeof x !== 'number' || typeof z !== 'number') continue;
    const bx = Math.max(-v.w * 0.46, Math.min(v.w * 0.46, v.toX(x, z)));
    const by = Math.max(-v.h * 0.46, Math.min(v.h * 0.46, v.toY(x, z)));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(bx, by, style[1] + 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kind === 'cop' || kind === 'cruiser' || kind === 'heli' ? SIREN[(n++ + siren) % 2] : style[0];
    ctx.beginPath();
    ctx.arc(bx, by, style[1], 0, Math.PI * 2);
    ctx.fill();
  }
}

// Player heading arrow at the (already rotated) origin: white, on a dark halo
function drawPlayerArrow(ctx: CanvasRenderingContext2D, tipY: number, halfWidth: number, tailY: number): void {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/** A label's screen box: [x0, y0, x1, y1] CSS px */
type LabelBox = [x0: number, y0: number, x1: number, y1: number];

const overlaps = (boxes: readonly LabelBox[], b: LabelBox) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

/** What the maps use of the controller manager (player/controllers.ts) */
export interface MapControllers {
  getActiveEntity(): { position: { x: number; y: number; z: number }; heading: number };
  floorHeight(x: number, z: number): number; // m, the town's floor under (x, z)
}
/** What the radar's view cone uses of the camera rig (player/cameras.ts) */
export interface MapCamera {
  currentPos: Vector3;
  currentLookAt: Vector3;
}
/** What the radar's traffic blips use of the traffic (sim/traffic.ts) */
export interface MapTraffic {
  cars?: readonly { x: number; z: number }[];
}

export interface CityMapOptions {
  controllerManager: MapControllers;
  cameraSystem: MapCamera;
  trafficSystem?: MapTraffic | null;
  allBlocks?: readonly MapBlock[];
  onTeleport?: (x: number, z: number) => void;
  onToggle?: (open: boolean) => void;
}

/** The radar's ground layers & names, rendered twice its size around (cx, cz) at s px/m */
interface MiniCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cx: number;
  cz: number;
  s: number;
  version: number; // of the footprints it drew
}

interface RoadLabelOptions {
  fontPx?: number;
  maxLabels?: number;
  sameNameGap?: number; // px
  placed?: LabelBox[]; // boxes already taken (it adds its own)
  majorOnly?: boolean;
}

class CityMapSystem {
  controllerManager: MapControllers;
  cameraSystem: MapCamera;
  trafficSystem: MapTraffic | null | undefined;
  allBlocks: readonly MapBlock[];
  onTeleport: ((x: number, z: number) => void) | undefined;
  onToggle: ((open: boolean) => void) | undefined;
  miniCanvas: HTMLCanvasElement | null;
  miniCtx: CanvasRenderingContext2D | null;
  elMiniStreet: HTMLElement | null;
  miniStreetText: string;
  miniScale: number; // radar px per metre, easing towards the altitude's
  miniCache: MiniCache | null;
  modal: HTMLElement | null;
  fullCanvas: HTMLCanvasElement | null;
  fullCanvasWrap: HTMLElement | null;
  fullCtx: CanvasRenderingContext2D | null;
  fullDpr: number;
  fullStatic: HTMLCanvasElement | null;
  fullStaticKey: string;
  elHoverInfo: HTMLElement | null;
  elPlayerInfo: HTMLElement | null;
  elSearchInput: HTMLInputElement | null;
  isFullMapOpen: boolean;
  viewCenterX: number; // m
  viewCenterZ: number;
  viewZoom: number; // CSS px per metre
  isPanning: boolean;
  panPointerId: number | null;
  panStart: { x: number; y: number; cx: number; cz: number }; // client px, and the view's centre then (m)
  dragMoved: boolean;
  hoverWorld: PointXZ | null;
  searchHighlight: string;
  searchPath: Path2D | null;
  searchBounds?: Bounds;
  textWidths: Map<string, number>; // px, by font, spacing & text
  blipSource?: (() => Blips) | null;
  police?: PoliceSight | null; // whose sight cones to draw (setPolice)
  playerInfoText?: string;

  constructor({ controllerManager, cameraSystem, trafficSystem, allBlocks = [], onTeleport, onToggle }: CityMapOptions) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.allBlocks = allBlocks;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;

    this.miniCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.elMiniStreet = document.getElementById('minimap-street-label');
    this.miniStreetText = '';
    this.miniScale = RADAR_SCALE;
    this.miniCache = null; // { canvas, cx, cz, s, version }: the radar's ground layers, twice the radar's size
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) elCounts.textContent = `${ROAD_NAME_COUNT} streets · ${BLOCKS.length.toLocaleString('en-US')} blocks`;

    // (the map is drawn true north up, so its compass, index.html, points straight up)

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas') as HTMLCanvasElement | null;
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullStatic = null; // the full map's ground layers & labels for the current view
    this.fullStaticKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search') as HTMLInputElement | null;
    if (this.elSearchInput) this.elSearchInput.placeholder = `Search ${ROAD_NAME_COUNT} streets & landmarks…`;

    this.isFullMapOpen = false;
    // Full map viewport state (world metres; zoom in CSS pixels per metre)
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.22;
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;

    this.hoverWorld = null;
    this.searchHighlight = '';
    this.searchPath = null;
    this.textWidths = new Map();

    // Street names measured before the web font arrived would be spaced for the fallback font: measure & draw again
    if ('fonts' in document) {
      void document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullStaticKey = '';
      });
    }

    this.initEvents();
  }

  initEvents(): void {
    const closeBtn = document.getElementById('close-fullmap-btn');
    const miniCard = document.getElementById('minimap-card');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const centerPlayerBtn = document.getElementById('map-center-player');
    const fullCityBtn = document.getElementById('map-view-all');

    if (miniCard) {
      miniCard.addEventListener('click', () => { this.toggleFullMap(true); });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => { this.toggleFullMap(false); });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45);
        this.renderFullMap();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.viewZoom = Math.max(MIN_ZOOM, this.viewZoom / 1.45);
        this.renderFullMap();
      });
    }
    if (centerPlayerBtn) {
      centerPlayerBtn.addEventListener('click', () => {
        const ent = this.controllerManager.getActiveEntity();
        this.viewCenterX = ent.position.x;
        this.viewCenterZ = ent.position.z;
        this.viewZoom = 0.9; // Street-by-street detail zoom
        this.renderFullMap();
      });
    }
    if (fullCityBtn) {
      fullCityBtn.addEventListener('click', () => {
        // Fits the whole city outline
        const b = ISLAND_BOUNDS;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        this.viewZoom = Math.max(MIN_ZOOM, fitScale(b, w, h, 1.15, 1.06));
        this.renderFullMap();
      });
    }

    const searchInput = this.elSearchInput;
    if (searchInput) {
      searchInput.addEventListener('input', () => { this.search(searchInput.value); });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) {
        this.toggleFullMap(false);
      } else if (e.code === 'KeyM' && !isTypingInField(e)) {
        this.toggleFullMap(!this.isFullMapOpen);
      }
    });

    const fullCanvas = this.fullCanvas;
    if (fullCanvas) {
      fullCanvas.style.touchAction = 'none';
      fullCanvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.isFullMapOpen || this.panPointerId !== null) return;
        e.preventDefault();
        this.panPointerId = e.pointerId;
        fullCanvas.setPointerCapture(e.pointerId);
        this.isPanning = true;
        this.dragMoved = false;
        this.panStart.x = e.clientX;
        this.panStart.y = e.clientY;
        this.panStart.cx = this.viewCenterX;
        this.panStart.cz = this.viewCenterZ;
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
      });

      fullCanvas.addEventListener('pointermove', (e) => {
        if (!this.isFullMapOpen || !this.fullCanvas) return;
        if (this.isPanning ? e.pointerId !== this.panPointerId : e.pointerType !== 'mouse') return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isPanning) {
          e.preventDefault();
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
          const d = screenToWorldDelta(dx, dy, this.viewZoom);
          this.viewCenterX = this.panStart.cx - d.x;
          this.viewCenterZ = this.panStart.cz - d.z;
          this.renderFullMap();
          return;
        }

        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const wPos = this.screenToWorld(mx, my, rect.width, rect.height);
          this.hoverWorld = wPos;
          if (this.elHoverInfo) {
            this.elHoverInfo.textContent = `${getLocationLabel(wPos.x, wPos.z)} · Click to teleport here`;
          }
        }
      });

      fullCanvas.addEventListener('pointerup', (e) => {
        if (e.pointerId !== this.panPointerId) return;
        const clicked = !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.cancelPan();
        if (clicked && this.isFullMapOpen && this.fullCanvas) {
          const rect = this.fullCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
            const wPos = this.clampToCity(this.screenToWorld(mx, my, rect.width, rect.height));
            if (this.onTeleport) {
              this.onTeleport(wPos.x, wPos.z);
            }
            this.renderFullMap();
          }
        }
      });
      for (const type of ['pointercancel', 'lostpointercapture'] as const) {
        fullCanvas.addEventListener(type, (e) => {
          if (e.pointerId === this.panPointerId) this.cancelPan();
        });
      }
      window.addEventListener('blur', () => { this.cancelPan(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancelPan();
      });

      // Wheel zoom about the cursor (the place under it stays put)
      fullCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = this.screenToWorld(mx, my, rect.width, rect.height);
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * factor));
        const d = screenToWorldDelta(mx - rect.width * 0.5, my - rect.height * 0.5, this.viewZoom);
        this.viewCenterX = before.x - d.x;
        this.viewCenterZ = before.z - d.z;
        this.renderFullMap();
      }, { passive: false });
    }
  }

  /**
   * Street / landmark search: highlights every stretch of the matching streets and frames them (or flies to the
   * matching landmark)
   */
  search(text: string): void {
    const q = (text || '').trim().toLowerCase();
    this.searchHighlight = q;
    this.searchPath = null;
    if (q.length > 0) {
      const lmMatch = CITY_LANDMARKS.find((l) => l.name.toLowerCase().includes(q) || l.short.toLowerCase().includes(q));
      const roads = ROAD_LABELS.filter((l) => l.lower.includes(q) || l.raw.includes(q));
      if (roads.length) {
        this.searchPath = new Path2D();
        const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of roads) {
          addLine(this.searchPath, l.road.pts);
          b.minX = Math.min(b.minX, l.minX);
          b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ);
          b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      if (lmMatch) {
        this.viewCenterX = lmMatch.x;
        this.viewCenterZ = lmMatch.z;
        this.viewZoom = Math.max(this.viewZoom, 0.9);
      } else if (roads.length && this.searchBounds) {
        const b = this.searchBounds;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        const fit = fitScale(b, w, h, 1.3, 1.3);
        this.viewZoom = Math.max(0.05, Math.min(1.2, fit));
      }
    }
    this.renderFullMap();
  }

  cancelPan(): void {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.isPanning = false;
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
    if (id !== null && this.fullCanvas?.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open: boolean): void {
    this.isFullMapOpen = open;
    if (!this.isFullMapOpen) this.cancelPan();
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      // the HUD's popovers live in the top layer, above the map
      for (const pop of document.querySelectorAll<HTMLElement>('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas(): void {
    if (!this.fullCanvas) return;
    // Layout size (the opening animation's transforms don't change it), at most ~6 megapixels however large the screen
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  // Full map size in CSS pixels
  fullSize(): { w: number; h: number } {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  screenToWorld(sx: number, sy: number, width: number, height: number): PointXZ {
    const d = screenToWorldDelta(sx - width * 0.5, sy - height * 0.5, this.viewZoom);
    return { x: this.viewCenterX + d.x, z: this.viewCenterZ + d.z };
  }

  // Teleports land in the city: inside the outline's extent at that z
  clampToCity(p: PointXZ): PointXZ {
    const z = Math.max(ISLAND_BOUNDS.minZ + 25, Math.min(ISLAND_BOUNDS.maxZ - 25, p.z));
    const shore = getIslandBoundsAtZ(z);
    return { x: Math.max(shore.westX + 12, Math.min(shore.eastX - 12, p.x)), z };
  }

  textWidth(ctx: CanvasRenderingContext2D, text: string): number {
    const key = `${ctx.font}|${ctx.letterSpacing || ''}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.textWidths.set(key, w);
    }
    return w;
  }

  /**
   * The ground: the city outline, parkland, blocks, building footprints, the main streets at low zoom, highways and
   * the search highlight (world transform of view v)
   */
  drawWorld(ctx: CanvasRenderingContext2D, v: MapView, isMinimap: boolean): void {
    const L = mapLayers();
    const s = v.s;
    const px = (n: number) => n / s; // screen pixels -> metres (line widths)
    v.world(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1. The city outline (roadway deck colour: the streets are the gaps between the blocks)
    ctx.fillStyle = MAP.streets;
    ctx.fill(L.city);
    ctx.strokeStyle = MAP.shore;
    ctx.lineWidth = px(isMinimap ? 1.6 : 2.0);
    ctx.stroke(L.city);

    // 2. Parkland, blocks (curb islands) and park blocks
    ctx.fillStyle = MAP.park;
    L.parkLand.each(v, (p) => { ctx.fill(p); });
    ctx.fillStyle = MAP.block;
    L.blocks.each(v, (p) => { ctx.fill(p); });
    if (s >= 0.22) {
      ctx.strokeStyle = MAP.blockEdge;
      ctx.lineWidth = px(Math.min(1.2, 0.5 + s));
      L.blocks.each(v, (p) => { ctx.stroke(p); });
    }
    ctx.fillStyle = MAP.park;
    L.parkBlocks.each(v, (p) => { ctx.fill(p); });
    ctx.fillStyle = MAP.parking;
    L.parking.each(v, (p) => { ctx.fill(p); });
    if (s >= 0.1) {
      ctx.strokeStyle = MAP.parkEdge;
      ctx.lineWidth = px(1);
      L.parkBlocks.each(v, (p) => { ctx.stroke(p); });
    }

    // 2b. Water: reservoirs & ponds, then the rivers, arroyos & drains (their real widths, never under a pixel or two)
    ctx.fillStyle = MAP.water;
    L.water.each(v, (p) => { ctx.fill(p); });
    ctx.strokeStyle = MAP.water;
    for (const [layer, width, minPx] of [[L.rivers, 10, 2.6], [L.streams, 3.8, 1.3], [L.drains, 2, 0.8]] as const) {
      ctx.lineWidth = Math.max(width, px(minPx));
      layer.each(v, (p) => { ctx.stroke(p); });
    }

    // 2c. The airport
    ctx.fillStyle = ctx.strokeStyle = MAP.airfield;
    L.aprons.each(v, (p) => { ctx.fill(p); });
    ctx.lineCap = 'butt';
    for (const [layer, width] of [[L.taxiways, 18], [L.runways, 45]] as const) {
      ctx.lineWidth = Math.max(width, px(width > 20 ? 3 : 1.2));
      layer.each(v, (p) => { ctx.stroke(p); });
    }
    ctx.lineCap = 'round';

    // 3. Building footprints, lowest first
    if (s >= 0.18) {
      const fp = footprintLayers(this.allBlocks);
      if (fp) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = MAP.buildings[i];
          fp.tones[i].each(v, (p) => { ctx.fill(p); });
        }
        if (s >= 0.6) {
          ctx.strokeStyle = MAP.buildingEdge;
          ctx.lineWidth = px(0.8);
          for (let i = 0; i < 3; i++) fp.tones[i].each(v, (p) => { ctx.stroke(p); });
        }
      }
    }

    // 4. Main streets as lines at low zoom
    if (s < 0.16) {
      ctx.strokeStyle = MAP.mainRoads;
      ctx.lineWidth = px(s < 0.05 ? 0.7 : 1.1);
      L.mainRoads.each(v, (p) => { ctx.stroke(p); });
    }

    // 5. Highways
    ctx.strokeStyle = MAP.highway;
    ctx.lineWidth = Math.max(px(isMinimap ? 2.4 : 1.6), 14);
    ctx.stroke(L.highways);

    // 6. Search highlight: every stretch of the matching streets
    if (this.searchPath && !isMinimap) {
      ctx.strokeStyle = MAP.search;
      ctx.lineWidth = Math.max(px(3), 9);
      ctx.stroke(this.searchPath);
    }
  }

  /**
   * Street names along the streets (screen transform of view v): the best anchor of each street that fits its name,
   * one label per street per `sameNameGap` pixels, none overlapping another (or the boxes already in `placed`)
   */
  drawRoadLabels(ctx: CanvasRenderingContext2D, v: MapView, { fontPx = 10, maxLabels = 400, sameNameGap = 260, placed = [], majorOnly = false }: RoadLabelOptions = {}): void {
    const s = v.s;
    const q = this.searchHighlight;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    const inset = (fontPx * 2.5) / s;
    const minX = v.minX + inset;
    const maxX = v.maxX - inset;
    const minZ = v.minZ + inset;
    const maxZ = v.maxZ - inset;
    const cands: { l: RoadLabel; a: LabelAnchor; width: number; hit: boolean; score: number }[] = [];
    for (const l of ROAD_LABELS) {
      if (l.maxX < minX || l.minX > maxX || l.maxZ < minZ || l.minZ > maxZ) continue;
      const hit = q.length > 0 && (l.lower.includes(q) || l.raw.includes(q));
      if (majorOnly && !l.major && !hit) continue;
      const width = this.textWidth(ctx, l.text);
      const need = (width + 14) / s;
      for (const a of l.anchors) {
        if (a.len < need || a.x < minX || a.x > maxX || a.z < minZ || a.z > maxZ) continue;
        const d = Math.hypot(a.x - v.cx, a.z - v.cz) * s;
        cands.push({ l, a, width, hit, score: (hit ? 1e6 : 0) + (l.highway ? 3000 : 0) + (l.major ? 2000 : 0) + Math.min(a.len * s, 400) - d * 0.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    const byName = new Map<string, [x: number, y: number][]>();
    let n = 0;
    for (const c of cands) {
      if (n >= maxLabels) break;
      const X = v.toX(c.a.x, c.a.z);
      const Y = v.toY(c.a.x, c.a.z);
      const same = byName.get(c.l.text);
      if (same?.some(([x, y]) => Math.hypot(x - X, y - Y) < sameNameGap)) continue;
      const hw = c.width * 0.5 + 3;
      const hh = fontPx * 0.5 + 2;
      const ang = uprightAngle(c.a.ang);
      const ca = Math.abs(Math.cos(ang));
      const sa = Math.abs(Math.sin(ang));
      const bx = hw * ca + hh * sa;
      const by = hw * sa + hh * ca;
      const box: LabelBox = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(ang);
      ctx.fillStyle = c.hit ? MAP.search : c.l.highway ? '#e3a857' : c.l.major ? '#e8ebf0' : '#9ba5b3';
      ctx.strokeText(c.l.text, 0, 0);
      ctx.fillText(c.l.text, 0, 0);
      ctx.restore();
      n++;
    }
    ctx.textBaseline = 'alphabetic';
  }

  // Where the radar's crime blips come from (crime.ts blips())
  setBlipSource(fn: (() => Blips) | null): void {
    this.blipSource = typeof fn === 'function' ? fn : null;
  }

  // The police whose sight cones both maps draw (crime.ts sight)
  setPolice(police: PoliceSight | null): void {
    this.police = police;
  }

  update(): void {
    // The full map covers the whole screen, radar included
    if (this.isFullMapOpen) {
      this.renderFullMap();
    } else {
      this.renderMinimap();
    }
  }

  // =========================================================================
  // 1. GTA 6-STYLE LIVE RADAR MINIMAP (BOTTOM-LEFT HUD)
  // =========================================================================
  renderMinimap(): void {
    if (!this.miniCtx || !this.miniCanvas) return;
    // Nothing to draw while the radar is hidden (narrow screens, clean view)
    if (!this.miniCanvas.offsetParent || document.body.classList.contains('hud-minimized')) return;
    const ctx = this.miniCtx;
    // Radar size in CSS pixels, backed at the device pixel ratio (crisp street names on HiDPI screens)
    const w = this.miniCanvas.clientWidth;
    const h = this.miniCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.miniCanvas.width !== bw || this.miniCanvas.height !== bh) {
      this.miniCanvas.width = bw;
      this.miniCanvas.height = bh;
      this.miniCache = null;
    }

    const ent = this.controllerManager.getActiveEntity();
    const px = ent.position.x;
    const pz = ent.position.z;
    // Ground-level radar shows ~800 m of the city; it zooms out as the camera climbs (helicopter) over the town's floor
    const altitude = ent.position.y - this.controllerManager.floorHeight(px, pz);
    const target = Math.max(0.05, RADAR_SCALE / (1 + Math.max(0, altitude - 25) / 180));
    this.miniScale += (target - this.miniScale) * 0.08;
    const scale = this.miniScale;

    if (this.elMiniStreet) {
      const label = getLocationLabel(px, pz);
      if (label !== this.miniStreetText) {
        this.miniStreetText = label;
        this.elMiniStreet.textContent = label;
      }
    }

    // Ground layers & street names come from a cached render twice the radar's size, redrawn when the player nears its
    // edge or the zoom drifts (or the buildings arrive)
    const fp = footprintLayers(this.allBlocks);
    const version = fp ? fp.version : 0;
    let c = this.miniCache;
    // (the player's offset from the cache's centre as drawn: turned with the map, in metres)
    const off = (cc: MiniCache) => ({ x: (px - cc.cx) * Math.cos(MAP_ROT) - (pz - cc.cz) * Math.sin(MAP_ROT), y: (px - cc.cx) * Math.sin(MAP_ROT) + (pz - cc.cz) * Math.cos(MAP_ROT) });
    let o = c ? off(c) : null;
    if (!c || !o || c.version !== version || Math.abs(scale / c.s - 1) > 0.12 ||
      Math.abs(o.x) > w / c.s - w / (2 * scale) - 8 / scale ||
      Math.abs(o.y) > h / c.s - h / (2 * scale) - 8 / scale) {
      if (!c) {
        const canvas = document.createElement('canvas');
        canvas.width = bw * 2;
        canvas.height = bh * 2;
        const cacheCtx = canvas.getContext('2d');
        if (!cacheCtx) return;
        c = this.miniCache = { canvas, ctx: cacheCtx, cx: px, cz: pz, s: scale, version };
      }
      c.cx = px;
      c.cz = pz;
      c.s = scale;
      c.version = version;
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = MAP_BASE;
      c.ctx.fillRect(0, 0, bw * 2, bh * 2);
      const cv = new MapView(px, pz, scale, w * 2, h * 2, dpr);
      this.drawWorld(c.ctx, cv, true);
      cv.screen(c.ctx);
      this.drawRoadLabels(c.ctx, cv, { fontPx: 9.5, maxLabels: 28, sameNameGap: 180 });
      o = { x: 0, y: 0 };
    }

    const v = new MapView(px, pz, scale, w, h, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP_BASE;
    ctx.fillRect(0, 0, bw, bh);
    const k = scale / c.s;
    ctx.drawImage(c.canvas, dpr * ((-w / c.s - o.x) * scale + w * 0.5), dpr * ((-h / c.s - o.y) * scale + h * 0.5),
      dpr * w * 2 * k, dpr * h * 2 * k);

    v.screen(ctx);

    // Live moving traffic blips on radar
    const cars = this.trafficSystem?.cars;
    if (cars) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      for (let i = 0; i < cars.length; i += 2) {
        const car = cars[i];
        const cx = v.toX(car.x, car.z);
        const cy = v.toY(car.x, car.z);
        if (Math.abs(cx) < w * 0.5 && Math.abs(cy) < h * 0.5) {
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // Landmark blips
    for (const lm of CITY_LANDMARKS) {
      const lx = v.toX(lm.x, lm.z);
      const ly = v.toY(lm.x, lm.z);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawPoliceSight(ctx, v, this.police);

    // The police, gangs, thieves and pickups, clamped to the radar's edge
    if (this.blipSource) drawBlips(ctx, v, this.blipSource());

    // Camera FOV Cone & Player Arrow at center (0, 0)
    const camDir = this.cameraSystem.currentLookAt.clone().sub(this.cameraSystem.currentPos);
    const camAngle = Math.atan2(camDir.x, camDir.z);

    ctx.save();
    ctx.rotate(-camAngle + Math.PI + MAP_ROT);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.rotate(-ent.heading + Math.PI + MAP_ROT);
    drawPlayerArrow(ctx, -9, 6.5, 7);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 2. FULL INTERACTIVE CITY STREET MAP MODAL ([M])
  // =========================================================================
  renderFullMap(): void {
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);

    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are at ${getLocationLabel(ent.position.x, ent.position.z)}`;
      if (text !== this.playerInfoText) {
        this.playerInfoText = text;
        this.elPlayerInfo.textContent = text;
      }
    }

    // Ground layers, names & landmark pins: re-rendered only when the view, the search or the buildings change
    const fp = footprintLayers(this.allBlocks);
    const key = `${v.cx}|${v.cz}|${v.s}|${this.fullCanvas.width}|${this.fullCanvas.height}|${this.searchHighlight}|${fp ? fp.version : 0}`;
    this.fullStatic ??= document.createElement('canvas');
    if (key !== this.fullStaticKey) {
      this.fullStaticKey = key;
      const sc = this.fullStatic;
      if (sc.width !== this.fullCanvas.width || sc.height !== this.fullCanvas.height) {
        sc.width = this.fullCanvas.width;
        sc.height = this.fullCanvas.height;
      }
      const staticCtx = sc.getContext('2d');
      if (staticCtx) this.renderFullMapStatic(staticCtx, v);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fullStatic, 0, 0);
    v.screen(ctx);
    drawPoliceSight(ctx, v, this.police);
    if (this.blipSource) drawBlips(ctx, v, this.blipSource());

    // Live Player Blip & Heading Arrow, with a slow pulse to find it at a glance
    const px = v.toX(ent.position.x, ent.position.z);
    const py = v.toY(ent.position.x, ent.position.z);

    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.24 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-ent.heading + Math.PI + MAP_ROT);
    drawPlayerArrow(ctx, -11, 7.5, 8);
    ctx.restore();

    ctx.restore();
  }

  renderFullMapStatic(ctx: CanvasRenderingContext2D, v: MapView): void {
    const { w, h, s } = v;
    ctx.save();
    // 1. The valley floor
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP_BASE;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 2. The ground: the city outline, blocks, parks, footprints & highways
    this.drawWorld(ctx, v, false);

    v.screen(ctx);

    // 3. Iconic Landmark Pins & Collision-Free Labels (placed first: their boxes keep the other names clear)
    ctx.font = `700 11px ${FONT}`;
    const placed: LabelBox[] = [];
    const pins: { lm: CityLandmark; lx: number; ly: number; showLabel: boolean }[] = [];
    for (const lm of CITY_LANDMARKS) {
      const lx = v.toX(lm.x, lm.z);
      const ly = v.toY(lm.x, lm.z);
      if (Math.abs(lx) > w * 0.48 || Math.abs(ly) > h * 0.48) continue;
      const labelW = this.textWidth(ctx, lm.short) + 6;
      const box: LabelBox = [lx + 6, ly - 8, lx + 8 + labelW, ly + 7];
      const showLabel = !overlaps(placed, box);
      placed.push([lx - 6, ly - 6, lx + 6, ly + 6]);
      if (showLabel) placed.push(box);
      pins.push({ lm, lx, ly, showLabel });
    }

    // 4. Colonia watermark titles (wherever they fit), letter-spaced like a printed atlas
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tracking = 'letterSpacing' in ctx;
    for (const [label, x, z] of s < 0.035 || s > 1.2 ? [] : AREA_LABELS) {
      const dx = v.toX(x, z);
      const dy = v.toY(x, z);
      if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
      ctx.font = `700 10.5px ${FONT}`;
      ctx.fillStyle = 'rgba(168, 178, 192, 0.46)';
      if (tracking) ctx.letterSpacing = '1.8px';
      const half = this.textWidth(ctx, label) * 0.5 + 4;
      const box: LabelBox = [dx - half, dy - 8, dx + half, dy + 8];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      ctx.fillText(label, dx, dy);
    }
    if (tracking) ctx.letterSpacing = '0px';

    // 4b. The rivers' names along their course (the arroyos' only closer in), in italics
    const L = mapLayers();
    for (const r of s < 0.04 ? [] : L.riverNames) {
      if (!r.river && s < 0.25) continue;
      const dx = v.toX(r.x, r.z);
      const dy = v.toY(r.x, r.z);
      if (Math.abs(dx) > w * 0.46 || Math.abs(dy) > h * 0.46) continue;
      ctx.font = `italic 600 ${r.river ? 11 : 10}px ${FONT}`;
      const half = this.textWidth(ctx, r.name) * 0.5 + 3;
      // (the label's box, turned with the river: its axis-aligned bounds)
      const ang = uprightAngle(r.angle);
      const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
      const bx = half * c + 7 * sn, by = half * sn + 7 * c;
      const box: LabelBox = [dx - bx, dy - by, dx + bx, dy + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(ang); // (never upside down)
      ctx.lineWidth = 3;
      ctx.strokeStyle = MAP.halo;
      ctx.strokeText(r.name, 0, 0);
      ctx.fillStyle = MAP.waterLabel;
      ctx.fillText(r.name, 0, 0);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';

    // 5. Street names along their real course (collision-free at all zoom levels)
    const fontPx = Math.max(9, Math.min(12, Math.round(9.5 * Math.sqrt(Math.max(s, 0.4)))));
    this.drawRoadLabels(ctx, v, { fontPx, maxLabels: 420, sameNameGap: 300, placed, majorOnly: s < 0.3 });

    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    for (const { lm, lx, ly, showLabel } of pins) {
      ctx.fillStyle = MAP.halo;
      ctx.beginPath();
      ctx.arc(lx, ly, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (showLabel) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP.halo;
        ctx.strokeText(lm.short, lx + 9, ly + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lm.short, lx + 9, ly + 4);
      }
    }

    // 6. Scale bar (true metres); the true-north compass sits with the map controls (index.html)
    this.drawScaleBar(ctx, v);
    ctx.restore();
  }

  drawScaleBar(ctx: CanvasRenderingContext2D, v: MapView): void {
    const target = 120 / v.s; // metres in ~120 px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    const x0 = -v.w * 0.5 + 24;
    const y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 239, 244, 0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, x0 + len + 8, y0 + 3);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.95)';
    ctx.fillText(label, x0 + len + 8, y0 + 3);
  }
}

export { CityMapSystem };
