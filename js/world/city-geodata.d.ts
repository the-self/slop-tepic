// js/world/city-geodata.d.ts — the types of the GENERATED js/world/city-geodata.js (tools/build-tepic-geodata.mjs,
// section 7 "ASSEMBLE" writes it). Hand-written: when the builder changes what it emits, change this with it.
// World frame: 1 unit = 1 m, x = east along the centro's grid, z = south, origin at the Plaza Principal.
// Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays (m, rounded to 0.1 m); most records are positional
// tuples to keep the 9 MB file small, typed here as named tuples.

/** A flat polyline or ring: [x0, z0, x1, z1, ...] in metres. */
export type FlatPoints = number[];

/** A 0 / 1 flag (the builder writes booleans as integers). */
export type Flag = 0 | 1;

/** One-way direction of an OSM way: 0 both ways, 1 forward (drawn a → b), -1 backward. */
export type LinkDir = -1 | 0 | 1;

/** The world frame and the box the city is cut to. */
export interface GeoFrame {
  city: string;
  /** false: no New York street grid (streets / avenues / broadway are empty) */
  grid: boolean;
  /** false: no waterfront (piers / islands empty) */
  waterfront: boolean;
  /** Degrees clockwise from true north the world's -z axis (the grid's "north") is turned. */
  bearingDeg: number;
  origin: string;
  units: string;
  /** The origin's latitude / longitude (degrees). */
  lat0: number;
  lon0: number;
  /** z (m) north of which nothing is built (the box's north edge less 50 m). */
  cutZ: number;
  strip: number;
  /** The property line in from the curb (m, Tepic's banquetas). */
  sidewalk: number;
  /** The detailed city's box (m). */
  box: { x0: number; x1: number; z0: number; z1: number };
  /** The player's start (the Plaza Principal teleport): heading in radians, atan2(dx, dz) of travel. */
  start: { x: number; z: number; heading: number };
}

/** A drivable OSM way for the maps & labels: [name, width (m), 'TW' two-way | 'FT' one-way forward | 'TF' backward,
 *  lanes, major road (highway) 1 | 0, flat points]. */
export type Road = [name: string, width: number, dir: 'TW' | 'FT' | 'TF', lanes: number, major: Flag, pts: FlatPoints];

/** A road-graph link between two nodes: [a, b (node indices), name (index into `names`), width (m), lanes,
 *  dir, inner (flat interior points, a → b), lifts (dm over the ground at a, inner..., b, < 0 down in an underpass's
 *  cut; 0 when all at grade), way (1: a bridge way, 2: a tunnel way, 0 neither)]. */
export type GraphLink = [
  a: number, b: number, name: number, width: number, lanes: number, dir: LinkDir,
  inner: FlatPoints, lifts: number[] | 0, way: 0 | 1 | 2
];

export interface RoadGraph {
  /** Flat node positions [x0, z0, x1, z1, ...] (m): node i at (nodes[2i], nodes[2i + 1]). */
  nodes: number[];
  links: GraphLink[];
  /** Street names, indexed by a link's `name`. */
  names: string[];
  /** Traffic signals: flat [x0, z0, ...] (m). */
  signals: number[];
}

/** A railway: [flat points, lifts (dm over the ground per point, or 0), bridge 1 | 0, main line 1 | siding / yard 0]. */
export type Rail = [pts: FlatPoints, lifts: number[] | 0, bridge: Flag, main: Flag];

/** A footbridge over the roads: [flat points from one stair's foot to the other's, lifts (dm over the ground per point:
 *  the stairs up, the deck between their tops), walkway width (dm)]. */
export type Footbridge = [pts: FlatPoints, lifts: number[], width: number];

/** An axis-aligned lot rect [x0, x1, z0, z1] (m; in a frame's local u / v for frontage frames). */
export type LotRect = [x0: number, x1: number, z0: number, z1: number];

/** An irregular island's lots laid along a street it fronts: [θ (rad, the frame's turn), pivot x, pivot z (m),
 *  rects in the frame's local axes]. */
export type BlockFrame = [theta: number, px: number, pz: number, rects: LotRect[]];

/** A city block: [outline (flat ring), lot rects, park share (0..1 of it green), park name ('' none),
 *  rectangular 1 | 0, frontage frames | 0, open country (no buildings) 1 | 0]. */
export type Block = [
  outline: FlatPoints, rects: LotRect[], park: number, parkName: string, rect: Flag,
  frames: BlockFrame[] | 0, rural: Flag
];

/** A green or water area. */
export interface Park {
  name: string;
  /** OSM leisure / landuse / natural: 'park', 'pitch', 'cemetery', 'water', 'wood'... */
  cat: string;
  acres: number;
  /** Flat rings (m). */
  rings: FlatPoints[];
}

/** The kinds of OSM waterway kept. */
export type WaterwayKind = 'river' | 'stream' | 'canal' | 'drain' | 'ditch';

/** A river, arroyo, canal or drain, drawn downstream: [kind, half-width of the gap left between the blocks (m, 0
 *  none), name ('' none), flags (1 intermittent, 2 underground: a culvert or tunnel), flat points]. */
export type Waterway = [kind: WaterwayKind, halfWidth: number, name: string, flags: number, pts: FlatPoints];
/** A river's whole course where it runs on beyond the detailed box: [name, flat points downstream]. */
export type FarRiver = [name: string, pts: FlatPoints];

/** A notable OSM building footprint, by name. */
export interface Landmark {
  /** Bounding box centre and size (m). */
  x: number;
  z: number;
  w: number;
  d: number;
  /** OSM height (m), null when unmapped. */
  h: number | null;
  /** Footprint area (m²). */
  area: number;
  ring: FlatPoints;
  /** OSM building=* ('university', 'church', 'yes'...). */
  kind: string;
}

/** A neighbourhood / quarter / suburb label. */
export interface Place {
  name: string;
  x: number;
  z: number;
}

/** A point of interest: kind is OSM tourism / historic / amenity / leisure ('monument', 'hospital', 'park'...). */
export interface Poi {
  name: string;
  kind: string;
  x: number;
  z: number;
}

/** A named spot snapped onto the street beside it, the car facing along the street. */
export interface Teleport {
  name: string;
  /** The subtitle (street · neighbourhood). */
  sub: string;
  x: number;
  z: number;
  /** Radians, atan2(dx, dz) of travel. */
  heading: number;
}

/** A gated community: [walls, gates]. walls: polylines along its property line (flat); gates: 4 numbers each,
 *  booth x, z (m), heading into the coto (mrad, atan2 of z over x), private street width (m). */
export type Coto = [walls: FlatPoints[], gates: number[]];

/** A shop sign face (one slot of the sign atlas). Chains carry parody names and their storefront's index. */
export interface SignFace {
  text: string;
  /** CSS colours. */
  bg: string;
  fg: string;
  /** CSS colour; a business's own name (one with `trade`) has none. */
  border?: string;
  stripe?: string;
  /** 1: a chain store's sign. */
  chain?: Flag;
  /** 1: a big box (the sign runs along the whole front). */
  big?: Flag;
  /** Index into STOREFRONTS (js/world/storefronts/index.ts). */
  store?: number;
  /** A business's own name (Overture Maps' places): its trade's generic sign, 1-based into `signs`, which stands in
   *  when the sign atlas has no name slot free for it (js/world/sign-slots.ts). Only the names carry it. */
  trade?: number;
}

/** A hill path: [surface (0 cobbles, 1 concrete / paving, 2 earth), width (m), flat points]. */
export type HillPath = [surface: 0 | 1 | 2, width: number, pts: FlatPoints];

/** A height grid: w x h samples `cell` m apart from (x0, z0), row by row, as base64 Int16 little-endian dm. */
export interface HeightGrid {
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  /** base64 of an Int16Array (dm, little-endian). */
  data: string;
}

/** The hills around the valley: heights over the flat city (zero under the town). */
export interface Terrain extends HeightGrid {
  /** The valley floor (m a.s.l.). */
  floor: number;
  /** The Cerro de la Cruz summit [x, z] (m), or null. */
  cross: [x: number, z: number] | null;
  paths: HillPath[];
}

/** The ground under the town: heights over `datum`. */
export interface Ground extends HeightGrid {
  /** The town's lowest point (m a.s.l.). */
  datum: number;
  /** The ground's height away from town, over the datum (m). */
  floor: number;
}

/** A bus or combi route: [name, group (index into `groups`), the map's line colour (CSS), fleet ('bus' | 'combi',
 *  '' both), loops 1 | 0, pieces: each the roadGraph links driven in turn (index + 1 from a to b, -(index + 1) back)]. */
export type TransitRoute = [name: string, group: number, colour: string, fleet: 'bus' | 'combi' | '', loops: Flag, pieces: number[][]];

export interface Transit {
  /** The zones' names. */
  groups: string[];
  routes: TransitRoute[];
}

/** A runway or taxiway: [ref ('02/20', 'A'...), width (m), flat centreline]. */
export type AirStrip = [ref: string, width: number, pts: FlatPoints];

export interface Airport {
  name: string;
  runways: AirStrip[];
  taxiways: AirStrip[];
  /** Flat rings. */
  aprons: FlatPoints[];
  helipads: FlatPoints[];
  /** Boarding bridges: [x, z at the terminal, x, z at the aircraft] (m). */
  gates: [x0: number, z0: number, x1: number, z1: number][];
}

/** A building drawn as it is: [house index, storeys (0: as guessed), paint (0xrrggbb, -1: the palette's)]. */
export type BuildingOverride = [house: number, storeys: number, paint: number];

/** A car park's surface: 0 asphalt, 1 poured concrete, 2 setts (adoquín, empedrado), 3 earth or gravel. */
export type ParkingSurface = 0 | 1 | 2 | 3;

/** Where a car park opens onto the street: [x, z on the curb (m), the way in, square to the curb (mrad, atan2 of z
 *  over x), width (m), path from the curb to the lot (flat: OSM's service road, or straight in)]. */
export type ParkingEntrance = [x: number, z: number, angle: number, width: number, path: FlatPoints];

/** A surface car park (OSM amenity=parking), cut to the property lines: [name ('' none), surface, the direction its
 *  rows of stalls run (mrad: along (cos θ, -sin θ): its mapped aisles', else its long side), outline (flat ring),
 *  its entrances]. */
export type ParkingLot = [name: string, surface: ParkingSurface, theta: number, ring: FlatPoints, entrances: ParkingEntrance[]];

/** A wall or fence as OpenStreetMap maps it (barrier=wall | fence), cut off the streets & buildings: [kind (0 a wall,
 *  1 a fence), height (m, 0 unmapped), flat points]. */
export type OsmWall = [kind: 0 | 1, height: number, pts: FlatPoints];

export interface CityGeodata {
  version: number;
  frame: GeoFrame;
  /** The city's box as a flat ring (its schema name from the New York game). */
  manhattan: FlatPoints;
  upperManhattan: FlatPoints;
  innerShore: FlatPoints;
  // Left over from New York, always empty in Tepic
  islands: Record<string, FlatPoints>;
  boroughs: Record<string, FlatPoints>;
  streets: never[];
  avenues: never[];
  broadway: FlatPoints;
  plazas: never[];
  roads: Road[];
  roadGraph: RoadGraph;
  rails: Rail[];
  footbridges: Footbridge[];
  blocks: Block[];
  parks: Park[];
  waterways: Waterway[];
  farRivers: FarRiver[];
  centralPark: null;
  piers: never[];
  bridges: Record<string, never>;
  /** By name; a city may not have a given one. */
  landmarks: Partial<Record<string, Landmark>>;
  points: Record<string, never>;
  places: Place[];
  pois: Poi[];
  teleports: Record<string, Teleport>;
  /** Integers per house in `houses` (8). */
  houseStride: number;
  /** Real buildings (Overture Maps), `houseStride` integers each: centre x, z (dm), width, depth (dm, local x / z),
   *  turn θ (mrad, world = c + R_y(θ)·local), storeys, front side (0 w, 1 e, 2 n, 3 s of the local frame) + kind bits
   *  (4 a shop, 8 a big box, 16 a strip plaza, 32 a coto's house, its number + 1 from bit 6 up), sign (1-based index
   *  into `signs`, 0 none). */
  houses: number[];
  cotos: Coto[];
  signs: SignFace[];
  /** null when the builder had no elevation tiles (then `ground` is null too). */
  terrain: Terrain | null;
  ground: Ground | null;
  transit: Transit;
  airport: Airport;
  overrides: BuildingOverride[];
  parking: ParkingLot[];
  walls: OsmWall[];
}

export declare const GEO: CityGeodata;
