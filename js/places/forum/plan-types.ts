// js/places/plan-types.ts
// The shapes of Forum Tepic's plan (plan.ts lays them out): frames, buildings, fronts, entrances, boxes, panes,
// escalators, walks, and the plan itself. Positions in world metres, heights over the mall's floor.
import type { OrientedBox } from '../kit/mesh-list.ts';
import type { DeckSegment } from '../../world/ground.ts';

export type Vec2 = [number, number];

/** A frame on the ground: its origin (m), its u axis (unit), its v axis (-u.z, u.x) */
export interface Frame {
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
}

/** A building of the complex: its outline (world m, OpenStreetMap's or Overture's) and its height (m over the floor) */
export interface ForumBuilding {
  name: string;
  ring: Vec2[];
  height: number;
}

/** A straight run of wall between two points (world m) facing (nx, nz) (towards the walkway), from y0 to y1 over the
 *  floor; what it shows: a row of shops (`names`, one per locale, in order from a to b), an anchor's front (one name,
 *  its glass across), a food stall counter, or blank wall */
export interface Frontage {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  y0: number;
  y1: number;
  kind: 'shops' | 'anchor' | 'stalls' | 'blank';
  names: string[];
  /** each locale's room behind its front (shops & anchors): how deep it runs in (m; 0: none, its front glass all
   *  across), and how wide its doorway is (m, in the middle of its front) */
  rooms: { depth: number; door: number }[];
}

/** A glass entrance: its doorway on the facade (world m, a to b) and the outward normal; how far it stands out (m) */
export interface ForumEntrance {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  out: number;
  /** the glass box's height (m over the floor) */
  height: number;
}

/** A box in the world: its centre (m), its half sizes along its u & v (m), its turn as cos / sin (the collider's obb),
 *  y0..y1 over the floor */
export type ForumBox = OrientedBox;

/** A pane of glass a car drives through (life/glass.ts breaks it): along a → b (world m) facing (nx, nz), from the floor up
 *  to y1 (m), a shop's or an entrance's; `wall`: its collider's index among the plan's walls */
export interface Pane {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  y1: number;
  kind: 'shop' | 'entrance';
  wall: number;
}

/** An escalator: its foot and head (world m, its centreline), its width (m), whether it runs up from the foot */
export interface Escalator {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  up: boolean;
}

/** A walked loop for the shoppers: its points (world m), on the floor (0) or the upper floor (1) */
export interface ShopperPath {
  pts: Vec2[];
  level: 0 | 1;
}

export interface ForumPlan {
  A: Frame;
  B: Frame;
  buildings: ForumBuilding[];
  /** the rotunda's centre (m) and radius (m), the radius of the void under its dome */
  rotunda: { x: number; z: number; r: number; void: number };
  /** the ground floor's open places beyond the main outline (food court) and the voids under the lanterns (rings) */
  floors: Vec2[][];
  voids: Vec2[][];
  /** the glass strips along the lanterns' tops (rings, world m) */
  skylights: Vec2[][];
  /** the upper floor's slabs (rings, world m) and the balustrades along their open edges */
  slabs: { ring: Vec2[]; hole?: Vec2[] }[];
  rails: { ax: number; az: number; bx: number; bz: number }[];
  frontages: Frontage[];
  entrances: ForumEntrance[];
  /** the square columns: centre (m), turn as cos / sin */
  columns: { x: number; z: number; cs: number; sn: number }[];
  escalators: Escalator[];
  /** the food court's tables (centres, m: upstairs) */
  tables: Vec2[];
  /** the kiosks in the corridors: centre, along-direction turn (cos, sin), name */
  kiosks: { x: number; z: number; cs: number; sn: number; name: string }[];
  /** the planters & benches (centres, m) */
  planters: Vec2[];
  /** the walls that stop the player (beyond the frontages': the outer walls, the entrances' sides) */
  walls: ForumBox[];
  /** the glass a car breaks through: the shops' downstairs and the entrances' */
  panes: Pane[];
  /** the upper floor & the escalators, as decks to walk on (ground.ts addFootDecks: lifts over the ground) */
  decks: DeckSegment[];
  paths: ShopperPath[];
  /** Liverpool's front upstairs (the mural over it): its run on the court's east side */
  liverpool: Frontage;
  /** the roofs over the complex as turned boxes (y1: the roof over the floor), the rain kept out from under them */
  roofs: ForumBox[];
  /** the Washingtonia palms along the sidewalk round the mall (street-details.ts plants them: species 4) */
  palms: { x: number; z: number; scale: number; species: number }[];
}
