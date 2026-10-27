// js/sim/traffic/types.ts
// The street traffic's types: the road graph as the traffic sees it, its vehicles and people, the player as it reads
// them, and what it hands the rest of the game (collisions, shots, the vehicle the player takes)
import type * as THREE from 'three/webgpu';
import type { LaneCurve, RoadEdge, RoadMove, RoadNetwork, RoadNode } from '../../world/road-network.ts';
import type { WalkCrossing, WalkLeg, WalkTrack } from '../pedestrian-routes.ts';
import type { CrossingKind } from '../../world/crossings.ts';
import type { BusStop } from '../../world/bus-stops.ts';
import type { CityBlock } from '../../world/city-config.ts';
import type { PersonRig } from '../pedestrians.ts';
import type { RideFrame } from '../pedestrians.ts';
import type { PathAlong, TransitPath } from '../transit.ts';
import type { slide } from '../mayhem.ts';
import type { RagdollHandle } from '../ragdolls.ts';
import type { CarModel } from '../../models/cars/index.ts';
import type { CarDamage } from '../../player/vehicle-damage.ts';
import type { CarStepInput, PhysicsVehicle } from '../../player/car-physics.ts';
import type { RoadClass } from '../traffic-demand.ts';

// ============================================================================
// TYPES
// ============================================================================
/** A driver's Intelligent Driver Model: max acceleration & comfortable braking (m/s²), time headway (s), standstill gap
 *  (m), and the sideways acceleration they accept in bends (m/s²) */
interface DriverModel {
  a: number;
  b: number;
  T: number;
  s0: number;
  aLat: number;
}

/** A vehicle's place in a lane list: the vehicle and its position along the lane (m), pooled and rebuilt every frame */
interface LaneEntry {
  v: DrivenVehicle;
  s: number;
}

/** An intersection of the road graph (road-network.ts) with the traffic's own state on it */
interface TrafficNode extends RoadNode {
  in: TrafficEdge[];
  out: TrafficEdge[];
  /** vehicles crossing it from each road (by right-of-way group: on the grid avenue 0, street 1) */
  box: number[];
  /** vehicles crossing (or about to cross) the crosswalk on each side */
  crossing: number[];
  /** the edge arriving over each side's crosswalk */
  approach: (TrafficEdge | null)[];
  /** an edge arriving or leaving over each side's crosswalk: the road it spans */
  road: (TrafficEdge | null)[];
  /** pedestrians on its crosswalks */
  walkers: Ped[];
  /** pedestrians at the curbs of its crosswalks, standing or about to (who to queue behind) */
  curb: Ped[];
  /** its counters raised this frame (reset next frame) */
  touched?: boolean;
}

/** A move from a TrafficEdge onto the next */
interface TrafficMove extends RoadMove {
  to: TrafficEdge;
}

/** A directed edge of the road graph (road-network.ts) with the traffic's own state on it */
interface TrafficEdge extends RoadEdge {
  from: TrafficNode;
  to: TrafficNode;
  moves: TrafficMove[];
  opposite: TrafficEdge | null;
  /** vehicles in each lane, sorted by position */
  occ: LaneEntry[][];
  /** the bus & combi routes it runs along (transit.ts: s where the road ends on each), or null */
  transit: PathAlong[] | null;
  /** vehicles from it crossing e.to straight on or to the right, and to the left */
  through: number;
  lefts: number;
  touched?: boolean;
  /** its class (traffic-demand.ts), worked out the first time it is needed */
  roadClass?: RoadClass;
  /** the street crossings along it (crossings.ts), by s: m from its start stop line */
  crossings: { c: StreetCrossing; s: number }[];
  /** the bus stops by its right curb (world/bus-stops.ts), by s */
  stops: BusStop<TrafficEdge>[];
  /** the topes across it (topes.ts): m from its start stop line, in order */
  topes: number[];
}

/** A street crossing along a road (crossings.ts): where it is taken, its kind, the edges it crosses (pedestrian-
 *  routes.ts WalkCrossing), whether it goes with a signal's lights and which right-of-way group those stop, the road's
 *  width curb to curb (m), and who is out on the road on it this frame */
interface StreetCrossing extends WalkCrossing<TrafficEdge> {
  x: number;
  z: number;
  kind: CrossingKind;
  signal: boolean;
  group: number;
  len: number;
  walkers: Ped[];
}

/** The road network as the traffic sees it: its nodes and edges carry the traffic's state (filled in at start-up) */
interface TrafficNetwork extends RoadNetwork {
  nodes: TrafficNode[];
  edges: TrafficEdge[];
}


/** A sidewalk or crosswalk track, and a leg of a walk along them (pedestrian-routes.ts) */
type PedTrack = WalkTrack<TrafficNode, TrafficEdge, CityBlock, StreetCrossing>;
type PedLeg = WalkLeg<TrafficNode, TrafficEdge, CityBlock, StreetCrossing>;

/** Two people stopped to talk, for `remaining` s more */
interface Conversation {
  a: Ped;
  b: Ped;
  remaining: number;
}

/** A point on a sidewalk track to walk back to: the track, how far along it (m), and where */
interface SidewalkPoint {
  route: PedTrack;
  t: number;
  x: number;
  z: number;
}

/** A driver put out on the street (a carjacking, a wreck) or someone running from gunfire: s since, heading (rad),
 *  running off (for runFor s) or walking back to a sidewalk (`goal`, searched for again at nextSearch; the nearest
 *  it has come to it, since when), and what it runs from */
interface Bail {
  time: number;
  heading: number;
  flee: boolean;
  runFor: number;
  goal: SidewalkPoint | null;
  nextSearch: number;
  best: number;
  since: number;
  fromX?: number;
  fromZ?: number;
}

/** A pedestrian on the sidewalks: their track (start, unit direction, length, m) and where along it (t, walking dir),
 *  the crosswalk they are on (node, side, coord along it, line off its centre), speeds (m/s), timers (clock s) */
interface Ped {
  placed: boolean;
  crossesStreets: boolean;
  x: number;
  z: number;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  /** the track's lift over the ground at its start and end (m): up a footbridge (pedestrian-routes.ts) */
  la: number;
  lb: number;
  t: number;
  dir: number;
  node: TrafficNode | null;
  /** the street crossing (along a road) it is on, or null */
  cross: StreetCrossing | null;
  /** on a footway (pedestrian-routes.ts): on the ground of whatever it crosses, not up on a sidewalk */
  foot: boolean;
  side: number;
  coord: number;
  line: number;
  waiting: boolean;
  /** preferred walking speed, and the current one easing up to it and down to stops */
  speed: number;
  v: number;
  pause: number;
  route: PedTrack | null;
  nextRoute: PedLeg[] | null;
  nextLeg: number;
  goalX: number;
  goalZ: number;
  goalTime: number;
  restTime: number;
  socialTime: number;
  conversation: Conversation | null;
  rig: PersonRig;
  /** knocked over: their ragdoll; and whether for good (peds.ts throwPed: their body lies there), else they get up */
  fallen?: RagdollHandle | null;
  dead?: boolean;
  bail?: Bail | null;
  /** s to the next look for a wall ahead, and how long they've stood blocked */
  wallT?: number;
  blocked?: number;
  /** 0..1, drawn on each spawn: which camiones, combis and taxis they would hail (pickups.ts) */
  wish: number;
  /** getting on or off one at the curb, or null */
  ride: Ride | null;
}

/** Someone getting on or off a camión, combi or taxi at the curb (pickups.ts): the vehicle, and whether they are
 *  waiting for it to stop, stepping to its door, or stepping off it onto the sidewalk; (x, z) where they head (m) */
interface Ride {
  /** (taken off the streets, retired or carjacked, while they wait for it: no edge) */
  v: Vehicle;
  phase: 'wait' | 'board' | 'off';
  x: number;
  z: number;
}

/** A camión, combi or taxi pulling in to the curb (pickups.ts): on which edge and where along it it stops (its centre,
 *  m), its door (m ahead of its centre), who is getting on (null once aboard, or none), how many are still to get
 *  off, whether it has stopped, s since, s it stands at least, s into it the next one gets off */
interface CurbStop {
  edge: TrafficEdge;
  s: number;
  door: number;
  ped: Ped | null;
  boarded: boolean;
  off: number;
  stopped: boolean;
  t: number;
  dwell: number;
  next: number;
}

/** A bicycle or motorcycle and its rider down: the rider's ragdoll, the bike's pose (m over the surface `gy` under
 *  it, rad), velocity (m/s, rad/s), s lain still, and the deceleration (m/s²) its slide loses to the ground */
interface BikeWreck {
  rider: RagdollHandle;
  px: number;
  pz: number;
  py: number;
  yaw: number;
  vx: number;
  vz: number;
  vy: number;
  roll: number;
  rollVel: number;
  yawVel: number;
  rest: number;
  scrape: number;
  gy?: number;
}

/** The instanced meshes of one kind of two-wheeler, the frame its rider sits on, and how many are drawn this frame */
interface TwoWheelKit {
  frame: THREE.InstancedMesh;
  wheels: THREE.InstancedMesh;
  seat: RideFrame;
  drawn: number;
}

/** What every vehicle of the traffic has (createVehicle): its size (m) and driver, where it is on the road graph
 *  (edge, lane, s along it; or conn, cs along the curve through an intersection), how it drives (m, m/s, m/s²), its
 *  pose, the player relative to it, its route, and its crash state */
interface VehicleBase {
  bus: boolean;
  half: number;
  halfWidth: number;
  axle: number;
  driver: DriverModel;
  /** desired speed (m/s) */
  v0: number;
  edge: TrafficEdge | null;
  lane: number;
  s: number;
  speed: number;
  acc: number;
  gap: number;
  leaderSpeed: number;
  move: TrafficMove | null;
  out: number;
  conn: LaneCurve | null;
  cs: number;
  /** the curve it came out of an intersection along (its rear axle still on it) */
  trail: LaneCurve | null;
  /** the node it is committed to crossing */
  commit: TrafficNode | null;
  claimed: boolean;
  yielding: boolean;
  yieldAt: number;
  wait: number;
  laneTimer: number;
  /** m off the lane centre (right +), and how fast it eases back */
  dl: number;
  dlv: number;
  /** turn signal: -1 left, 1 right, 0 off */
  blink: number;
  blinkPhase: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  tx: number;
  tz: number;
  nose: number;
  yaw: number;
  yawRate: number;
  steer: number;
  fleet: 'bus' | 'combi' | null;
  path: TransitPath | null;
  pathS: number;
  nextPathS: number;
  lost: number;
  sign: number;
  pitch: number;
  roll: number;
  pitchVel: number;
  rollVel: number;
  vx: number;
  vz: number;
  yawOffset: number;
  yawVel: number;
  /** the player (or what it left standing) relative to it: m ahead and to the right, its speed v's way and to the
   *  right (m/s; negative ahead: coming at v), its half width & length (m), and whether it is something left standing */
  pAhead: number;
  pRight: number;
  pSpeed: number;
  pSide: number;
  pHalfW: number;
  pHalfL: number;
  pParked: boolean;
  /** s the player has been in its way (to 3, wearing off once out of it), and the driver's reaction time (s): it
   *  brakes and swerves for the player only once it has seen them that long */
  pSeen: number;
  react: number;
  /** s its driver has been looking at their phone (mishaps.ts): no eye on the road ahead, it doesn't brake */
  distracted: number;
  /** a siren close behind (sim/emergency.ts): it pulls over to the right and crawls till it has gone by */
  sirenNear: boolean;
  /** m off the lane centre (right +) it is steering to, out of the way of the player coming at it */
  swerve: number;
  /** a camión, combi or taxi (pickups.ts): the curb it is pulling in to, or null; m to the right it pulls over to;
   *  clock s it next looks along the curb; a taxi's fare: clock s its passenger gets out (0: free) */
  stop: CurbStop | null;
  pullOver: number;
  nextStop: number;
  fare: number;
  wheelSpin: number;
  damage: CarDamage | null;
  wrecked: boolean;
  smokeCarry: number;
  /** a car thrown about in a crash near the player: its body in Jolt (crash), or null */
  crash: CarCrash | null;
  /** the road surface's height under it (the ground, or a bridge's deck, m) and the ground's pitch (rad), each frame */
  hy?: number;
  gp?: number;
  /** headlights this frame: distance to the camera (squared), how near it counts, its heading, its brake lights */
  _camDistSq: number;
  _effDist: number;
  _sinY: number;
  _cosY: number;
  _braking: number;
}

/** A car of the traffic (taxis, police cruisers, combis and the car models), drawn as its model's body shape stretched
 *  to its size (sx, sy, sz; sw the wheels'), its paint as float32 rgb */
interface Car extends VehicleBase {
  bus: false;
  isTaxi: boolean;
  isPolice: boolean;
  heavy: boolean;
  mass: number;
  bodyType: string;
  model: CarModel | null;
  paint: number[];
  sx: number;
  sy: number;
  sz: number;
  sw: number;
  fleet: 'combi' | null;
  bike?: undefined;
  moto?: undefined;
  kit?: undefined;
  wreck?: undefined;
  livery?: undefined;
}

/** A camión on Tepic's routes, in its route's livery (an index into LIVERIES) */
interface Bus extends VehicleBase {
  bus: true;
  fleet: 'bus';
  livery: number;
  crash: null;
  isPolice?: undefined;
  isTaxi?: undefined;
  bodyType?: undefined;
  mass?: undefined;
  bike?: undefined;
  moto?: undefined;
  kit?: undefined;
  wreck?: undefined;
}

/** A cyclist or motorcyclist: the bike's colour, the pedals' crank angle, the rider, the bike down on the road, and
 *  the meshes it is drawn with (its kind's, from just after it is made) */
interface TwoWheelerBase extends VehicleBase {
  bus: false;
  color: THREE.Color;
  pedal: number;
  wreck: BikeWreck | null;
  rider: PersonRig;
  crash: null;
  kit?: TwoWheelKit;
  isPolice?: undefined;
  isTaxi?: undefined;
  mass?: undefined;
  livery?: undefined;
}
interface Bike extends TwoWheelerBase {
  bike: true;
  moto?: undefined;
  bodyType: 'bike';
  model?: undefined;
}
/** A motorcyclist, on one of the moto models (models/motos: drawn again on each spawn, by rarity) */
interface Moto extends TwoWheelerBase {
  moto: true;
  bike?: undefined;
  bodyType: 'moto';
  model: CarModel;
}
type TwoWheeler = Bike | Moto;

type Vehicle = Car | Bus | TwoWheeler;
/** What the player on foot can take (vehicleNear): any of the traffic's vehicles, motorcycles too */
type Hijackable = Vehicle;
type VehicleKind = 'car' | 'bike' | 'moto' | 'bus';
/** On the road: the edge it drives along and the move it makes at its end (place() and leave() give it both) */
interface OnRoad {
  edge: TrafficEdge;
  move: TrafficMove;
}
type DrivenVehicle = Vehicle & OnRoad;
/** Just put on an edge (place()), its move not chosen yet */
type OnEdge = Vehicle & { edge: TrafficEdge };
/** A crashed car's body in Jolt (car-physics.ts add), and whose it is: the traffic's car (crash; read back off what
 *  another body struck, its out.hit.other) */
type CrashBody = PhysicsVehicle & { owner?: unknown };
/** A car thrown about in a crash (crash): its body, s it has lain still, its speed (m/s), whether it was left in the
 *  road (its driver out), the box the traffic steers round (crashedObstacles), and its driver's inputs */
interface CarCrash {
  body: CrashBody;
  still: number;
  speed: number;
  left: boolean;
  box: ParkedVehicle & { heading: number };
  input: CarStepInput;
}
type CrashedCar = Car & { crash: CarCrash };

/** A collision spark (m, m/s, s), bouncing on the road surface `floor` under where it was struck */
interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  floor?: number;
}

/** The player as the traffic sees it each frame: on the street (`active`), its entity, position & velocity (m, m/s),
 *  half sizes (m), mass (kg), mode, heading (rad), speed, and whether it is going fast enough to knock people over */
interface TrafficPlayer {
  active: boolean;
  entity: TrafficPlayerEntity | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  halfW: number;
  halfL: number;
  mass: number;
  mode: string;
  heading: number;
  speed: number;
  knocks: boolean;
  /** a body in Jolt itself (a vehicle, with the physics set): what it crashes into goes into Jolt too (crash) */
  jolt: boolean;
}

/** What the traffic reads of (and pushes on) the player's entity (player/controllers.ts) */
interface TrafficPlayerEntity {
  position: THREE.Vector3;
  heading?: number;
  speed?: number;
  vx?: number;
  vz?: number;
  type?: string;
  mesh?: THREE.Object3D | null;
  halfW?: number;
  halfL?: number;
  spec?: { mass?: number } | null;
  /** a car's body shape, or a bicycle's colour */
  look?: { bodyType?: string; color?: number; model?: string; paint?: number } | null;
  angularVel?: number;
  pitchVel?: number;
  rollVel?: number;
  heaveVel?: number;
  lastCollisionSpark?: { x: number; y: number; z: number; nx: number; nz: number; speed: number } | null;
  /** its body in Jolt (car-physics.ts), while it has one */
  vehicle?: object | null;
}

/** A vehicle of the player's left standing (main.ts setParked): drivers stop behind it */
interface ParkedVehicle {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
  heading?: number;
}

/** A fire truck or ambulance with its siren on (sim/emergency.ts): where (m), its heading (rad); the traffic ahead of
 *  it going its way pulls over and lets it by */
interface SirenSource {
  x: number;
  z: number;
  heading: number;
}

/** A vehicle outside the traffic (a police car chasing the player) that shoves the traffic and is shoved back: its
 *  centre, heading, half sizes (m), speed along its heading and knock velocity (m/s), mass (kg) */
interface BumpBody {
  x: number;
  z: number;
  heading: number;
  halfW: number;
  halfL: number;
  speed: number;
  vx: number;
  vz: number;
  mass: number;
}

/** A crash in the traffic, passed to the collision listener (reused: copy what you keep). Normal from b towards a */
interface TrafficCollision {
  a: unknown;
  b: unknown;
  kind: 'vehicle';
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  speed: number;
}

/** The player's mayhem for health & money: 'struck' by a vehicle of `mass` kg at `speed` m/s, or someone they
 *  knocked over 'down' at (x, y, z) */
type MayhemListener = (kind: 'struck' | 'down', x: number, y: number, z: number, speed: number, mass: number) => void;
/** Someone the player ran over: 'ped' or 'bike', where, how fast */
type KnockListener = (kind: 'ped' | 'bike', x: number, z: number, speed: number) => void;
/** Smoke from a damaged engine: where, the wind it drifts on (m/s), how many puffs, how pale (0 black), how big */
type SmokeEmitter = (x: number, y: number, z: number, vx: number, vz: number, count: number, shade: number, size: number) => void;
/** Is there a wall at (x, z)? */
type SolidQuery = NonNullable<Parameters<typeof slide>[3]>;
/** The ground's height (m) at (x, z), or the surface's under something at height y */
type HillQuery = (x: number, z: number) => number;
type SurfaceQuery = (x: number, z: number, y: number) => number;

/** What a shot meets first (rayHit, reused): a pedestrian or a vehicle, and how far along the ray (m) */
interface TrafficRayHit {
  kind: '' | 'ped' | 'vehicle';
  target: Ped | Vehicle | null;
  t: number;
}
/** Passes over the targets a shot turns down (rayHit) */
type RayAccept = (kind: 'ped' | 'vehicle', target: Ped | Vehicle, t: number) => boolean;

/** A vehicle's footprint for the people walking about: centre, the sine & cosine of its heading, half sizes (m) */
interface BodyBox {
  x: number;
  z: number;
  sn: number;
  cs: number;
  hw: number;
  hl: number;
}

/** A spot found for someone to turn up at (m, rad; reused) */
interface RoadSpot {
  x: number;
  z: number;
  heading: number;
}

/** A camión's or combi's route as the player's copy of it carries it: its sign row and livery */
interface RouteLook {
  sign: number;
  livery: number;
}
/** What the player took (hijack): its kind, where (y: the road's surface under it, m), heading (rad), speed (m/s),
 *  its looks */
type TakenVehicle = { y?: number } & (
  | { kind: 'cyclist'; x: number; z: number; heading: number; speed: number; color: number }
  | { kind: 'moto'; x: number; z: number; heading: number; speed: number; model: string; paint: number }
  | {
    kind: 'car'; bus?: boolean; x: number; z: number; heading: number; speed: number; bodyType: string; police: boolean;
    model: string | undefined; paint: number; route: RouteLook | null;
  });
/** The look of a vehicle the player drives (controllers.ts setCarLook), as lookKit reads it */
interface VehicleLook {
  bodyType?: string;
  route?: RouteLook | null;
}
/** A camión wheel of the player's copy: its steering pivot and tyre, front or rear, its side (-1 right, 1 left) */
interface LookWheel {
  steerPivot: THREE.Group;
  tire: THREE.Mesh;
  isFront: boolean;
  side: number;
}
/** The player's own copy of a camión or a combi: meshes on the chassis, a camión's wheels, its lamps, its label */
interface LookKit {
  chassis: THREE.InstancedMesh[];
  wheels: LookWheel[] | null;
  lamps: THREE.InstancedBufferAttribute | null;
  label: string;
}

export type {
  DriverModel, LaneEntry, TrafficNode, TrafficMove, TrafficEdge, StreetCrossing, TrafficNetwork, PedTrack, Conversation,
  SidewalkPoint, Bail, Ped, Ride, CurbStop, BikeWreck, TwoWheelKit, VehicleBase, Car, Bus, Bike, Moto, TwoWheeler, Vehicle,
  Hijackable, VehicleKind, DrivenVehicle, OnEdge, CrashBody, CarCrash, CrashedCar, Spark, TrafficPlayer,
  TrafficPlayerEntity, ParkedVehicle, SirenSource, BumpBody, TrafficCollision, MayhemListener, KnockListener, SmokeEmitter,
  SolidQuery, HillQuery, SurfaceQuery, TrafficRayHit, RayAccept, BodyBox, RoadSpot, RouteLook, TakenVehicle,
  VehicleLook, LookWheel, LookKit
};
