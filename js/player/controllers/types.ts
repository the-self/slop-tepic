// js/player/controllers/types.ts
// The player's types: its modes and controls, its entities (the walker, the car, the bicycle, the moto, the
// helicopter), what it collides with, the cars it leaves behind, and the controller's own bookkeeping shapes.
// Re-exported by player/controllers.ts, which every other module imports them from
import type * as THREE from 'three/webgpu';
import type { PersonCrowd, PersonRig } from '../../sim/pedestrians.ts';
import type { PersonBody } from '../../actors/person-body.ts';
import type { CarModel } from '../../models/cars/index.ts';
import type { DriveInput, DriveSpec, DriveState } from '../drivetrain.ts';
import type { CarDamage } from '../vehicle-damage.ts';
import type { ColliderObb } from '../../world/buildings.ts';
import type { RagdollHandle } from '../../sim/ragdolls.ts';
import type { PhysicsVehicle } from '../car-physics.ts';
import type { PropCollider } from '../../sim/mayhem.ts';
import type { BloodFrame, Stains } from '../car-blood.ts';
import type { BloodUniforms } from '../../actors/actor-models.ts';

/** The player's modes: on foot, or in one of its vehicles (activeMode, each entity's `type`) */
export type PlayerMode = 'person' | 'car' | 'cyclist' | 'helicopter' | 'moto';
export type VehicleMode = Exclude<PlayerMode, 'person'>;

/** A control's state: held (true) or not, or an analog strength 0..1 (the touch stick, a pad's sticks & triggers) */
export type KeyValue = boolean | number;
/** The player's controls, from the keyboard, touch and a gamepad blended (_blendInput) */
export interface ControlKeys {
  forward: KeyValue;
  backward: KeyValue;
  left: KeyValue;
  right: KeyValue;
  up: KeyValue;
  down: KeyValue;
  boost: KeyValue;
  handbrake: KeyValue;
  shiftUp: KeyValue;
  shiftDown: KeyValue;
  gearbox: KeyValue;
  fire: KeyValue;
}
export type InputAction = keyof ControlKeys;
export type InputSource = Partial<Record<InputAction, KeyValue>>;

/** What every player entity has: where it is (m), its heading (rad, 0 facing +z), speed (m/s along it), its chase camera */
export interface EntityBase {
  type: PlayerMode;
  label: string; // the HUD's name for it
  mesh: THREE.Group;
  position: THREE.Vector3;
  heading: number;
  speed: number;
  cameraTargetOffset: THREE.Vector3;
  chaseDistance: number; // m behind it
  chaseHeight: number; // m over it
  // the vehicles that slide (the car, the moto): their velocity across their heading (m/s, world x & z)
  vx?: number;
  vz?: number;
  cameraKick?: number; // a crash's jolt to the camera, 0..1 (cameras.ts speedEffects)
}
// (the car and the bicycles laid on the slope under their wheels: rad, tiltToGround)
export interface GroundTilt {
  groundPitch?: number;
  groundRoll?: number;
}
/** The manual gearbox's keys as they were last frame (gearKeys: their presses, not their holding) */
export interface HeldGearKeys {
  shiftUp: boolean;
  shiftDown: boolean;
  gearbox: boolean;
}

export interface PersonEntity extends EntityBase {
  type: 'person';
  shadow: THREE.Mesh;
  crowd: PersonCrowd;
  rig: PersonRig;
  body: PersonBody | null; // the player's own (actors/person-body.ts), once loaded: drawn instead of the crowd's
  verticalVel: number; // m/s
  strafe?: number; // m/s to its right, aiming (player/aim.ts)
  ragdoll?: RagdollHandle | null; // down as a body (sim/ragdolls.ts)
  ragdollOwner?: string; // who put it down: 'controllers' (thrown out of the car) or crime.ts
}

/** A wheel of the car (or of a camión taken from the traffic): its steering pivot and tyre; side -1 is the car's right */
export interface CarWheel {
  steerPivot: THREE.Object3D;
  tire: THREE.Mesh;
  isFront: boolean;
  side: number;
  restY?: number; // m, its centre over the floor at rest (carBodyDef)
}
/** A camión's or combi's route (traffic.ts): its sign's row and the camión's livery */
export interface CarRoute {
  sign: number;
  livery: number;
}
/** What the car looks like: its body shape, paint (hex), police livery, model (js/models/cars) and route */
export interface CarLook {
  bodyType: string;
  paint: number;
  police: boolean;
  model?: string;
  route?: CarRoute | null;
}
/** A camión's or combi's parts from the traffic (traffic.ts lookKit): chassis meshes, a camión's wheels and lamps */
export interface LookKit {
  chassis: THREE.Mesh[];
  wheels: CarWheel[] | null;
  lamps: THREE.BufferAttribute | null; // (its brake lamps in [0])
  label: string;
}
/** The car body's own copy of its mesh once it is dented, and the undented positions & normals it is pressed from */
export interface DentedBody {
  geometry: THREE.BufferGeometry;
  basePos: ArrayLike<number>;
  baseNrm: ArrayLike<number>;
}
/** Where a crash's sparks fly from (m), the normal out of what it hit, and its speed (m/s) */
export interface CollisionSpark {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  speed: number;
}
/** The car's carState uniform (actor-models.ts): x brake lamps, w the police livery */
export interface CarStateUniform {
  value: THREE.Vector4;
}
/** The car's body as Jolt last left it: where (m), its velocity along the ground (m/s) and its rotation */
export interface BodyPose {
  x: number;
  z: number;
  vx: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface CarEntity extends EntityBase, GroundTilt {
  type: 'car';
  chassisPivot: THREE.Group;
  bodyMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  modelBody?: THREE.Mesh | null; // its model's 3D model (actors/vehicles/car-files.ts) instead of bodyMesh, once loaded
  taxiDecals: THREE.Mesh[];
  plates: THREE.Mesh[]; // front, rear
  look: CarLook;
  carState: CarStateUniform | null;
  headLights: THREE.SpotLight[];
  wheels: CarWheel[];
  carWheels: CarWheel[];
  kit: LookKit | null;
  shadow: THREE.Mesh;
  vx: number;
  vz: number;
  angularVel: number; // the traffic's shove since the last step: spin, pitch, roll (rad/s) & heave (m/s)
  pitchVel: number;
  rollVel: number;
  heaveVel: number;
  vy: number; // m/s
  flying: boolean;
  lastCollisionSpark: CollisionSpark | null;
  steerAngle: number; // rad
  zFront: number; // m, its nose ahead of its origin
  spec: DriveSpec;
  halfW: number; // m, its footprint
  halfL: number;
  drive: DriveState | null;
  damage: CarDamage;
  fuel: number; // L in its tank (FUEL_TANK full): it burns it driving, none left the engine stops (world/gas-stations.ts fills it)
  dented: DentedBody | null;
  drifting: boolean;
  impactArmed: boolean;
  lastVx: number; // m/s, its velocity at the end of the last frame (checkImpact)
  lastVz: number;
  scale?: { x: number; y: number; z: number }; // the body shape stretched to the model's size
  bodyHalf?: { w: number; l: number }; // m, the body shape's own half width & length (the dents)
  bodyHeight?: number; // m
  vehicle?: PhysicsVehicle | null; // its body in Jolt (car-physics.ts)
  physicsLook?: CarLook | null; // the look Jolt's body was built for
  physicsPlaced?: boolean;
  bodyOut?: BodyPose;
  driveInput?: DriveInput;
  before?: { vx: number; vy: number; vz: number }; // m/s, its body's velocity before the step (ejectDriver)
  frame?: { throttle: number; steer: number; water: number }; // what driveCar asked of it, for carMoved
  drowned?: boolean;
  heldKeys?: HeldGearKeys;
  // the blood on it (player/car-blood.ts): its stains, whether any is left, its material's uniforms showing them (none
  // on a camión's or the first taxi's body) and where on its body shape they go
  stains: Stains;
  bloody?: boolean;
  blood?: BloodUniforms | null;
  bloodFrame?: BloodFrame;
}

/** Where a rider's hands, seat and feet go on a bicycle or a moto (pedestrians.ts PersonRig.ride) */
export interface BikeFrame {
  seat: THREE.Vector3;
  bars: THREE.Vector3;
  gripHalf: number; // m
  bracket: THREE.Vector3;
  crankLength: number; // m (a moto's footpeg: none)
}

/**
 * Where a two-wheeler's wheels stand (m): their radius, the rear's & front's centres along it, the fork's rake (rad)
 * and the front spring's travel
 */
export interface WheelSpots {
  radius: number;
  rear: number;
  front: number;
  caster: number;
  travel: number;
}
/** What the bicycle and the moto share: a body in Jolt while ridden (driveTwoWheeler, twoWheelerMoved), a stand */
export interface TwoWheelerBase extends EntityBase, GroundTilt {
  leanPivot: THREE.Group;
  steerPivot: THREE.Group; // the front wheel, fork & bars turn about the head tube
  frontWheel: THREE.Mesh;
  rearWheel: THREE.Mesh;
  shadow: THREE.Mesh;
  riderRig: PersonRig;
  vx: number;
  vz: number;
  vy?: number; // m/s
  flying?: boolean;
  leanAngle: number; // rad
  wheelSpots: WheelSpots;
  standLean: number; // rad it leans on its stand
  steerInput: number; // -1 right .. 1 left, the bars eased towards the keys
  vehicle: PhysicsVehicle | null; // its body in Jolt while it is ridden, or sliding along after its rider was thrown off
  loose: boolean; // (thrown off: sliding along on its own)
  fallen: boolean; // lying on its side where it came to rest (its pose in bodyOut)
  restTime: number; // s it has lain still, loose
  physicsPlaced?: boolean;
  bodyOut?: BodyPose;
  shoved: number; // m/s, the traffic's shove this frame
  peak?: number; // m/s, its speed less what brakes could have taken off it since (twoWheelerMoved)
  lastCollisionSpark?: CollisionSpark | null;
  lastSpin?: number; // rad, its rear wheel's angle last frame
}

export interface CyclistEntity extends TwoWheelerBase {
  type: 'cyclist';
  frameMeshes: THREE.Mesh[];
  look: { color: number };
  crankPivot: THREE.Group;
  pedals: THREE.Mesh[];
  bikeFrame: BikeFrame;
  riderCrowd: PersonCrowd;
  helmet: THREE.Mesh;
  headLight: THREE.SpotLight;
  pedalPhase: number; // rad
  pedalling?: boolean;
}

export interface MotoEntity extends TwoWheelerBase {
  type: 'moto';
  model: CarModel;
  look: { model: string; paint: number };
  paintMeshes: THREE.Mesh[];
  spec: DriveSpec;
  drive: DriveState | null;
  driveInput?: DriveInput;
  bikeFrame: BikeFrame;
  riderCrowd: PersonCrowd;
  helmet: THREE.Mesh;
  headLight: THREE.SpotLight;
  halfW: number; // m
  halfL: number;
  drowned?: boolean;
  heldKeys?: HeldGearKeys;
}

export interface HelicopterEntity extends EntityBase {
  type: 'helicopter';
  tiltPivot: THREE.Group;
  mainRotorPivot: THREE.Group;
  tailRotorPivot: THREE.Group;
  verticalSpeed: number; // m/s
  pitchAngle: number; // rad
  rollAngle: number;
}

/** The player's entity in any mode: getActiveEntity(), narrowed by its `type` */
export type PlayerEntity = PersonEntity | CarEntity | CyclistEntity | MotoEntity | HelicopterEntity;
/** The player's entities by mode (person: PersonEntity, car: CarEntity...) */
export type PlayerEntities = { [M in PlayerMode]: Extract<PlayerEntity, { type: M }> };

/**
 * What the player collides with: buildings.ts's colliders and the like (an interior's walls & furniture, the cars left
 * behind), a world box in m (y from its foot to its top) with its oriented box inside; `_order` & `_seen` are
 * nearColliders' bookkeeping
 */
export interface PlayerCollider extends Pick<PropCollider, 'broken' | 'prop'> {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
  obb?: ColliderObb;
  _order?: number;
  _seen?: number;
}
/** A car the player left for another (leaveCarBehind): a still copy of it, which can be got back into (takeLeftCar) */
export interface LeftCar {
  mesh: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  heading: number;
  halfW: number;
  halfL: number;
  look: CarLook;
  damage: CarDamage;
  fuel: number; // L
  dented: DentedBody | null;
  kit: LookKit | null;
  stains: Stains;
  material: THREE.Material; // (its own, showing its stains: setCarLook)
  collider: PlayerCollider & { minY: number; maxY: number };
}
/** A vehicle left standing, for the traffic to stop behind (parkedVehicles) */
export interface ParkedVehicle {
  x: number;
  z: number;
  heading: number;
  halfW: number;
  halfL: number;
}
/** A vehicle taken from the traffic (traffic.ts hijack): where it was, its speed and its looks */
export interface TakenVehicle {
  kind: VehicleMode;
  x: number;
  z: number;
  /** the road's surface under it (m): on a bridge its deck, down an underpass its cut */
  y?: number;
  heading: number;
  speed: number;
  color?: number;
  bodyType?: string;
  paint?: number;
  police?: boolean;
  model?: string;
  route?: CarRoute | null;
}
/** A room the player is inside (interiors.ts): its bounds, its floor, its walls & furniture */
export interface PlayerRoom {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorAt(x: number, z: number, fromY?: number): number;
  colliders: PlayerCollider[];
}
/**
 * A collision of the player's entity `a` with `b` (a collider, a ground marker, a traffic vehicle...) of `kind`
 * ('building', 'ground', 'vehicle'), at (x, y, z) with the normal from b toward a, at `speed` m/s; one event object
 * is reused, so a listener copies what it keeps
 */
export interface CollisionEvent {
  a: unknown;
  b: unknown;
  kind: string;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  speed: number;
}
/** The ground's height at (x, z) (ground.ts), for a body coming from `fromY` (under a bridge, or on its deck) */
export type GroundQuery = (x: number, z: number, fromY?: number) => number;
// (the building contact's push out: its normal and depth, m)
export interface Contact {
  nx: number;
  nz: number;
  depth: number;
}
// (a body's footprint for the building contacts, collisionBody)
export interface CollisionShape {
  car: boolean;
  sin: number;
  cos: number;
  hx: number;
  hz: number;
  radius: number;
  extX: number;
  extZ: number;
  bottom: number;
  top: number;
}
// (a smoke puff: where (m), how fast (m/s), its life left & whole (s), its size)
export interface SmokePuff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
}
export interface Smoke {
  mesh: THREE.InstancedMesh;
  color: THREE.Color;
  matrix: THREE.Matrix4;
  cursor: number;
  carry: number;
  puffs: SmokePuff[];
  wasLive?: boolean;
}
