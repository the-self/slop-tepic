// js/world/buildings/types.ts
// The shapes the city's buildings are generated in (js/world/buildings.ts): colliders, facade boxes, the blocks'
// roof gear, awnings & footprints as the maps and the streaming read them, the lots' rects & parts, the neighbourhood
// profiles the block layouts read, and the state the lots of one build share.
import type * as THREE from 'three/webgpu';
import type { PointXZ } from '../city-config.ts';
import type { StoreHall } from '../store-interiors.ts';
import type { Storefront } from '../storefronts/index.ts';
import type { Quadtree } from './quadtree.ts';

/** A collider's oriented box: centre (m), half-sizes along its own axes (m), and its turn as cos / sin */
export interface ColliderObb {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  cs: number;
  sn: number;
}

/**
 * What stops the player: a world AABB in metres (y: from its foot to its top), with the oriented box inside it for a
 * building turned off the grid
 */
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  obb?: ColliderObb;
}

export type Side = 'n' | 's' | 'w' | 'e';
/** [a0, a1]: a span (m), or a [min, max] range */
export type Span = [number, number];
/** [value, weight] rows for pickW */
export type Weighted<T> = [T, number][];

/** An axis-aligned rect of the lots' frame (m): x west → east, z north → south */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** One part of a building: a rect extruded from y0 up to y1 (m) */
export interface Part extends Rect {
  y0: number;
  y1: number;
}

/** A building on its lot: its facade material (index), its parts, and which of the lot's sides face a street */
export interface Building {
  mat: number;
  lot: Rect;
  parts: Part[];
  street: Record<Side, boolean>;
}

/**
 * A facade box (createFacadeBoxes): its centre & size (m), the wall kind of each face (w, e, n, s: WALL_KINDS), its
 * tone (0..1, the palette's pick), its turn (rad), a known paint (0xrrggbb) and whether it is one of the centro's
 * colonial houses
 */
export interface FacadeBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  faces: number[];
  tone: number;
  ry?: number;
  paint?: number | null;
  colonial?: boolean;
}

/** A box on a roof or under a roof line: its centre x, z, its y (a cornice's top, a unit's foot), its size (m) */
export interface RoofBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ry?: number;
}

/** A water tower's foot (m) */
export interface RoofSpot {
  x: number;
  y: number;
  z: number;
  ry?: number;
}

/** A tinaco on a flat roof: its foot (m) and scale */
export interface Tinaco {
  x: number;
  y: number;
  z: number;
  s: number;
}

/**
 * A page of the shop sign atlas: its canvas (ATLAS_COLS x rows slots) and texture, the instanced sign boxes that read
 * it (their slot per instance in `slots`) and how many of them this streaming pass placed.
 */
export interface AtlasPage {
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  inst: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
  slots: THREE.InstancedBufferAttribute;
  count: number;
}

/**
 * A storefront's awning (m) and its sign: y the awning's height, g the street front's ground, w × d its size, sideDir
 * the way it faces (±1 along its local x), colorIdx its canvas colour; sign the atlas slot of the shop's own sign
 * (signY, signW, signH: its centre's height & size; signPX, signPZ: its place on the wall), noAwning for a fascia
 * alone
 */
export interface Awning {
  x: number;
  y: number;
  g: number;
  z: number;
  w: number;
  d: number;
  sideDir: number;
  colorIdx: number;
  ry?: number;
  noAwning?: boolean;
  sign?: number;
  signY?: number;
  signW?: number;
  signH?: number;
  signPX?: number;
  signPZ?: number;
}

/** A sidewalk scaffolding shed (m) */
export interface Shed {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  ry?: number;
}

/** A building part's footprint for the maps: its world bounds (m), height over the ground (m), tone, corners if turned */
export interface Footprint extends Rect {
  h: number;
  tone: number;
  pts?: PointXZ[];
}

/** A rear yard, court or lawn (m), turned ry about its centre */
export interface Yard extends Rect {
  ry?: number;
}

/**
 * A block's buildings as the maps & the streaming of roof details see them: centre & bounds (m), its roof gear,
 * awnings & sheds, footprints (lowest first), yards, tallest top (m) and ground-floor frontage along each avenue
 * ([z0, z1]); ry & pts (world corners) when its lots were laid in a turned frame
 */
export interface BlockDetail {
  id: string;
  cx: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  district: string;
  cornices: RoofBox[];
  waterTowers: RoofSpot[];
  hvacUnits: RoofBox[];
  awnings: Awning[];
  scaffoldSheds: Shed[];
  footprints: Footprint[];
  yards: Yard[];
  tinacos?: Tinaco[];
  maxH: number;
  avenueFronts: { w: Span[]; e: Span[] };
  ry?: number;
  pts?: PointXZ[];
}

/** A block being filled with made-up lots: its facade boxes & the lots left empty under bridge approaches, until built */
export interface LotBlock extends BlockDetail {
  facadeBoxes: FacadeBox[];
  voidLots: Rect[];
}

/** A block of the real buildings (A2), with the tinacos on their roofs */
export interface HouseBlock extends BlockDetail {
  tinacos: Tinaco[];
}

/**
 * What commit emits for a building: stone cornices (and their height), the rooftop gear ('mech' a big penthouse,
 * 'prewar' / 'walkup' a water tower with probability wtP, 'none'), the units' height (m), awnings, which street
 * fronts get storefronts ('all', 'avenue', 'none' or the probability of 'all'), whether it fronts every way, one wall
 * kind for every face (WALL_KINDS)
 */
export interface CommitOpts {
  cornice?: boolean;
  corniceH?: number;
  roof?: 'mech' | 'prewar' | 'walkup' | 'none';
  wtP?: number;
  hvacH?: number;
  awnings?: boolean;
  shops?: 'all' | 'avenue' | 'none' | number;
  freestanding?: boolean;
  walls?: number;
}

/** A row lot's building: its facade, storeys and depth (m) */
export interface RowLot {
  mat: number;
  floors: number;
  depth: number;
}

/** A mid-block lot kind: lot width (m), run, storeys, depth (share of the half block), facade weights, its builder */
export interface RowKind {
  w: Span;
  run: Span;
  floors: Span;
  depth: Span;
  mats: Weighted<number>;
  build: ((city: CityBuild, blk: LotBlock, lot: Rect, side: Side, k: RowLot) => void) | null;
}

// The neighbourhood profiles (storeys as [min, max], facades as weights): what each block layout reads
export interface ResProfile {
  kind: 'res';
  walkup: Span;
  prewar: Span;
  grand: Span;
  tower: Span;
  walkupMats: Weighted<number>;
  prewarMats: Weighted<number>;
  grandMats: Weighted<number>;
  towerMats: Weighted<number>;
  /** probability of a through-block apartment house */
  through: number;
  rows: Weighted<string>;
  ends: { w: Weighted<string>; e: Weighted<string> };
  /** storeys by row kind, over the kind's own */
  kf?: Record<string, Span>;
  loft?: LoftProfile;
}
export interface LoftProfile {
  kind: 'loft';
  lotW: Span;
  throughP: number;
  floors: Span;
  mats: Weighted<number>;
  /** storeys from which the 1916 setbacks start */
  setbackAt: number;
  wtP: number;
}
export interface OfficeBase {
  kind: 'office';
  plans: Weighted<string>;
  styles: Weighted<string>;
  towerFloors: Span;
  glassMats: Weighted<number>;
  decoMats: Weighted<number>;
  fillMats: Weighted<number>;
  fillFloors: Span;
  shaftShapes: Weighted<string>;
}
/** What a post-war residential tower reads of its profile */
export interface TowerCfg {
  tower: Span;
  towerMats: Weighted<number>;
}
export type OfficeProfile = OfficeBase | (OfficeBase & TowerCfg);
export interface ProjectsProfile {
  kind: 'projects';
  floors: Span;
  mats: Weighted<number>;
}
export interface LowriseProfile {
  kind: 'lowrise';
  floors: Span;
  tepic?: boolean;
  lotW?: Span;
}
export interface RiverProfile {
  kind: 'river';
}
export interface ProfileMap {
  res: ResProfile;
  loft: LoftProfile;
  office: OfficeProfile;
  projects: ProjectsProfile;
  lowrise: LowriseProfile;
  river: RiverProfile;
}
export type BlockProfile = ProfileMap[keyof ProfileMap];
export type LayoutMap = { [K in keyof ProfileMap]: (city: CityBuild, blk: LotBlock, cfg: ProfileMap[K], x0: number, x1: number) => void };
/** Corner types by the avenue a block end faces ('water' past the last one) */
export type EndTable = Record<string, Weighted<string> | undefined> & { water: Weighted<string> };

/** A facade material's builder (tsl-materials.ts) and its options: the storey height (m) and the look's own */
export interface FacadeOptions {
  floorHeight: number;
  boxLocal?: boolean;
  stoneColor?: number;
  trimColor?: number;
  windowGlassColor?: number;
  glassTint?: number;
  frameTint?: number;
  windowWidth?: number;
  litProbability?: number;
  warmth?: number;
  reflectivity?: number;
  seed?: number;
  chains?: Storefront['facade'][];
}
export type FacadeSpec = [create: (opts: FacadeOptions) => THREE.Material, opts: FacadeOptions];

/** A chain store's pole sign: the front's foot (m), ground, turn (rad), front's length, atlas slot, the house's frame */
export interface Pylon {
  front: Span;
  y: number;
  ry: number;
  along: number;
  slot: number;
  ou: number;
  ov: number;
  cs: number;
  sn: number;
  pylon: NonNullable<Storefront['pylon']>;
}

/** A colonial house's iron balcony: the slab's top (m), facing out along yaw (rad) */
export interface Balcony {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** The frame of the lots being populated: its turn θ (rad, and its cos / sin) about the point p (m) */
export interface LotFrame {
  th: number;
  cs: number;
  sn: number;
  px: number;
  pz: number;
}

/**
 * What the lots and houses of one build share: the frame the current lots are laid in (null: the grid's), the
 * smallest lot side built on (m), and what they emit: colliders, walk-in stores, balconies, the facade boxes by
 * material, the blocks (in the quadtree and in order) and the chain stores' pole signs
 */
export interface CityBuild {
  xf: LotFrame | null;
  minLot: number;
  colliders: Collider[];
  stores: StoreHall[];
  balconies: Balcony[];
  buckets: FacadeBox[][];
  quadtree: Quadtree<BlockDetail>;
  allBlocks: BlockDetail[];
  pylons: Pylon[];
}
