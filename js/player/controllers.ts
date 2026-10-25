import * as THREE from 'three/webgpu';
import {
  CITY,
  ISLAND_BOUNDS,
  getIslandBoundsAtZ,
  isTypingInField,
  blockAt
} from '../world/city-config.ts';
import { cityUniforms, createCarPaintMaterial, createContactShadowMaterial, createSmokeMaterial } from '../render/tsl-materials.ts';
import {
  BODY_SPECS,
  BUS_SPEC,
  bodyDims,
  buildCarGeometry,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  createLoftedCarMaterial,
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} from '../actors/actor-models.ts';
import { PersonCrowd, PersonRig } from '../sim/pedestrians.ts';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from '../actors/vehicle-lights.ts';
import { buildSpec, createDriveState, stepDrive, pedalForce, PEDALS } from './drivetrain.ts';
import { CAR_MODEL_BY_ID, TAXI_MODEL, POLICE_MODEL, BUS_MODEL, paintsOf, pickModel } from '../models/cars/index.ts';
import { PLAYER_MOTO, MOTO_MODEL_BY_ID } from '../models/motos/index.ts';
import { MIN_IMPACT, createDamage, applyImpact, enginePower, deformBody } from './vehicle-damage.ts';
import { createStains, bloodFrame, addHit, wash, clean } from './car-blood.ts';
import { suspensionOf } from './car-physics.ts';
import { bleedOf } from '../sim/ragdolls.ts';
import type { SprintMode } from './stats.ts';
import type { CarModel } from '../models/cars/index.ts';
import type { BodySpec } from '../models/bodies.ts';
import type { DriveInput, DriveSpec, DriveState } from './drivetrain.ts';
import type { CarDamage } from './vehicle-damage.ts';
import type { ColliderObb } from '../world/buildings.ts';
import type { RagdollHandle, Ragdolls, ThrowOptions } from '../sim/ragdolls.ts';
import type { CarBodyDef, CarPhysics, PhysicsVehicle, TwoWheelerDef, VehicleOut } from './car-physics.ts';
import type { PropCollider } from '../sim/mayhem.ts';
import type { BloodFrame, Stains } from './car-blood.ts';
import type { BloodUniforms } from '../actors/actor-models.ts';

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
type InputSource = Partial<Record<InputAction, KeyValue>>;

/** What every player entity has: where it is (m), its heading (rad, 0 facing +z), speed (m/s along it), its chase camera */
interface EntityBase {
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
interface GroundTilt {
  groundPitch?: number;
  groundRoll?: number;
}
/** The manual gearbox's keys as they were last frame (gearKeys: their presses, not their holding) */
interface HeldGearKeys {
  shiftUp: boolean;
  shiftDown: boolean;
  gearbox: boolean;
}

export interface PersonEntity extends EntityBase {
  type: 'person';
  shadow: THREE.Mesh;
  crowd: PersonCrowd;
  rig: PersonRig;
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
interface BodyPose {
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
interface TwoWheelerBase extends EntityBase, GroundTilt {
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
interface Contact {
  nx: number;
  nz: number;
  depth: number;
}
// (a body's footprint for the building contacts, collisionBody)
interface CollisionShape {
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
interface SmokePuff {
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
interface Smoke {
  mesh: THREE.InstancedMesh;
  color: THREE.Color;
  matrix: THREE.Matrix4;
  cursor: number;
  carry: number;
  puffs: SmokePuff[];
  wasLive?: boolean;
}

// js/player/controllers.ts
// Sculpted, non-blocky GTA 6-style 3D models, animations, and physics controllers
// for Third-Person Navigation:
// 1. Person (Skinned Pedestrian: planted-footstep IK walk/run/jump, see pedestrians.ts)
// 2. Car (Aerodynamic Sculpted Yellow Taxi with Sloped Windshield & Clearcoat, or whatever car was taken): engine,
//    gearbox & nitro from drivetrain.ts, tyre grip & drifts here, crash damage & dents from vehicle-damage.ts
// 3. Cyclist (Sculpted Road Cyclist with Drop-Bar Frame & Aero Helmet)
// 4. Helicopter (Sightseeing Twin-Turbine Chopper)
// 5. Moto (an Italika FT150, or one taken, with its rider: a two-wheeled body in Jolt Physics, car-physics.ts,
//    leaning into its corners; engine & gearbox from drivetrain.ts)

// Spawn at the city's start (city-geodata.js frame.start: Tepic's Plaza Principal)
const START = CITY.start;
// A point `ahead` metres along the start heading and `right` metres to its right (heading 0 faces +z, right is -x)
function spawnAt(ahead: number, right: number): { x: number; z: number; heading: number } {
  const sx = Math.sin(START.heading), cx = Math.cos(START.heading);
  return { x: START.x + sx * ahead - cx * right, z: START.z + cx * ahead + sx * right, heading: START.heading };
}
const SPAWN = {
  person: spawnAt(2, 3.4),
  car: spawnAt(0, 0),
  cyclist: spawnAt(-9, 0.6),
  moto: spawnAt(-12, 0.8),
  helicopter: spawnAt(-60, -110)
};
const LEFT_CARS = 4; // cars the player left for another kept where they stood (leaveCarBehind), the oldest going first
// HUD names of the player's characters & vehicles, in the city's language (the moto's: its model's)
const LABELS: Record<Exclude<PlayerMode, 'moto'>, string> = { person: 'Peatón', car: 'Taxi de Tepic', cyclist: 'Ciclista', helicopter: 'Helicóptero turístico' };
const groundCollider = { type: 'ground' };
// (a saved look may name a model there no longer is)
const MODEL_BY_ID: Partial<Record<string, CarModel>> = CAR_MODEL_BY_ID;
// (...and a body shape by a name it may not have)
const SPEC_BY_NAME: Partial<Record<string, BodySpec>> = BODY_SPECS;
// The car model (js/models/cars) a saved or taken car's look is: by id, else the police car, the taxi, or a common
// model of its body shape (looks saved before there were models)
function modelFor(look: { bodyType?: string; police?: boolean; model?: string | null } | null | undefined): CarModel {
  const known = look?.model == null ? undefined : MODEL_BY_ID[look.model];
  if (known) return known;
  if (look?.police) return POLICE_MODEL;
  if (!look || look.bodyType === 'taxi' || !look.bodyType) return TAXI_MODEL;
  return pickModel(look.bodyType, 0) ?? TAXI_MODEL;
}

const AIM_WALK = 2.4; // m/s: walking (and strafing) with the gun up (player/aim.ts)
// A head-on crash this hard (m/s into what it hit, ~70 km/h) throws the driver out through the windscreen, as a
// ragdoll (sim/ragdolls.ts), the car going on without them; they get up once they have lain still GET_UP s
const EJECT_SPEED = 19;
const GET_UP = 2.5;
// A moto's or bicycle's rider goes over the bars hitting something head on at ~30 km/h (or from any side at 1.5 times
// that), or sliding along at that once it is down on its side (leant over past DOWN_LEAN rad, off its tyres)
const THROW_SPEED = 8.3;
const DOWN_LEAN = 1.05;
const BRAKE_LIMIT = 9; // m/s² no two-wheeler's brakes slow it by: its speed lost faster, it ran into something
const SMOKE_PUFFS = 128; // (exhaust, tyre smoke and, on a wet road, the spray off the tyres)
// The bicycle's body: a 13 kg city bike & its rider, its tyres' grip, and its drag in the air (drivetrain.ts PEDALS)
const BICYCLE_BODY = { mass: 95, grip: 0.95, dragArea: PEDALS.dragArea };

// Walking surface for the player's pedestrian (its rig samples it around its feet)
// (on a bridge the walker's own height keeps its feet on the deck rather than the ground under it)
const personGround = (controllers: ThirdPersonControllerManager, x: number, z: number) => controllers.getGroundHeight(x, z, 'person', controllers.entities.person.position.y);

// (size: the car's { halfW, halfL }, the model it is; a 4.5 m sedan's by default)
function collisionBody(mode: PlayerMode, radius: number, heading: number, margin = 0,
  size: { halfW?: number; halfL?: number } | null = null): CollisionShape {
  const car = mode === 'car';
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const hx = (size?.halfW || 0.86) + margin, hz = (size?.halfL || 2.18) + margin;
  return {
    car, sin, cos, hx, hz, radius: radius + margin,
    extX: car ? Math.abs(cos) * hx + Math.abs(sin) * hz : radius + margin,
    extZ: car ? Math.abs(sin) * hx + Math.abs(cos) * hz : radius + margin,
    bottom: mode === 'helicopter' ? -0.25 : 0,
    top: mode === 'helicopter' ? 3.2 : car ? 1.8 : 1.9
  };
}

// Shared by movement and teleport clearance. World bounds reject distant boxes cheaply; the narrow phase
// uses a circle for walking/cycling/flying and all four separating axes for an oriented car rectangle.
function buildingContact(c: PlayerCollider, x: number, y: number, z: number, body: CollisionShape, contact?: Contact): boolean {
  if (y + body.bottom >= (c.maxY ?? Infinity) || y + body.top <= (c.minY ?? 0)) return false;
  if (x + body.extX <= c.minX || x - body.extX >= c.maxX || z + body.extZ <= c.minZ || z - body.extZ >= c.maxZ) return false;
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const dx = x - (o ? o.cx : (c.minX + c.maxX) * 0.5);
  const dz = z - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  let nx = 0, nz = 0, depth = Infinity;
  if (body.car) {
    const ls = body.sin * cs - body.cos * sn, lc = body.sin * sn + body.cos * cs;
    for (let axis = 0; axis < 4; axis++) {
      const ax = axis === 0 ? 1 : axis === 1 ? 0 : axis === 2 ? lc : ls;
      const az = axis === 0 ? 0 : axis === 1 ? 1 : axis === 2 ? -ls : lc;
      const distance = lx * ax + lz * az;
      const overlap = hx * Math.abs(ax) + hz * Math.abs(az)
        + body.hx * Math.abs(ax * lc - az * ls) + body.hz * Math.abs(ax * ls + az * lc) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < depth) {
        depth = overlap;
        const sign = distance <= 0 ? -1 : 1;
        nx = ax * sign; nz = az * sign;
      }
    }
  } else {
    const qx = lx - Math.max(-hx, Math.min(hx, lx));
    const qz = lz - Math.max(-hz, Math.min(hz, lz));
    const distance = Math.hypot(qx, qz);
    if (distance >= body.radius) return false;
    if (distance > 0) {
      nx = qx / distance; nz = qz / distance;
      depth = body.radius - distance;
    } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) {
      nx = lx <= 0 ? -1 : 1;
      depth = hx - Math.abs(lx) + body.radius;
    } else {
      nz = lz <= 0 ? -1 : 1;
      depth = hz - Math.abs(lz) + body.radius;
    }
  }
  if (contact) {
    contact.nx = nx * cs + nz * sn;
    contact.nz = -nx * sn + nz * cs;
    contact.depth = depth;
  }
  return true;
}

// (three's Mesh, with its material's own type rather than instanceof's any)
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;

function createTaxiDoorDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[controllers] no 2D canvas for the taxi\'s door decal');
  ctx.fillStyle = '#ffbe14';
  ctx.fillRect(0, 0, 256, 128);
  // Black taxi-rank emblem
  ctx.fillStyle = '#111317';
  ctx.beginPath();
  ctx.arc(58, 64, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffbe14';
  ctx.font = '900 32px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', 58, 66);
  // TAXI TEPIC typography, rank & unit number
  ctx.fillStyle = '#111317';
  ctx.textAlign = 'left';
  ctx.font = '900 26px Inter, Arial, sans-serif';
  ctx.fillText('TAXI TEPIC', 112, 42);
  ctx.font = '700 15px JetBrains Mono, monospace';
  ctx.fillText('SITIO 7 · ECO 48', 112, 68);
  ctx.font = '600 13px Inter, Arial, sans-serif';
  ctx.fillText('SERVICIO PÚBLICO', 112, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Nayarit public-service plate: white, the state's name across the top, MÉXICO along the bottom
function createLicensePlateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[controllers] no 2D canvas for the licence plate');
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0f6b3a';
  ctx.fillRect(6, 6, 244, 24);
  ctx.fillStyle = '#f4f4f0';
  ctx.font = '800 15px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NAYARIT', 128, 23);
  ctx.fillStyle = '#16181c';
  ctx.font = '900 48px JetBrains Mono, monospace';
  ctx.fillText('A-748-T', 128, 82);
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.fillText('MÉXICO', 128, 114);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class ThirdPersonControllerManager {
  scene: THREE.Scene;
  colliders: PlayerCollider[];
  _colliderCells: Map<number, PlayerCollider[]> | null;
  declare _nearList: PlayerCollider[]; // (made with the cells)
  declare _nearStamp: number;
  leftCars: LeftCar[];
  activeMode: PlayerMode;
  rotorSpin: number;
  keys: ControlKeys;
  canSprint: boolean;
  roadWet: number;
  roadGrip: number;
  waterAt: ((x: number, z: number) => number) | null;
  interior: PlayerRoom | null;
  aiming: boolean;
  entities: PlayerEntities;
  // (bindKeyboard: the codes held, and each source's actions)
  declare _pressedCodes: Set<string>;
  declare _keyboardKeys: InputSource;
  declare _touchKeys: InputSource;
  declare _gamepadKeys: InputSource;
  declare smoke: Smoke; // (createSmoke)
  _collisionListener?: ((event: CollisionEvent) => void) | null;
  _collisionEvent?: CollisionEvent;
  lookKits?: ((look: { bodyType: string; route: CarRoute | null }) => LookKit | null) | null;
  _carGeos?: Partial<Record<string, { body: THREE.BufferGeometry; wheels: THREE.BufferGeometry[] }>>;
  _parkedSlots?: Record<'car' | 'cyclist' | 'moto', ParkedVehicle>;
  _parked?: ParkedVehicle[];
  _tilt?: { pitch: number; roll: number };
  _buildingContact?: Contact;
  terrainAt?: GroundQuery | null;
  floorAt?: ((x: number, z: number) => number) | null;
  landAt?: ((x: number, z: number) => number) | null;
  deckAt?: ((x: number, z: number, over: number) => number) | null;
  _physicsFocus?: { x: number; y: number; z: number };
  _bodyBounds?: { x: number; z: number };
  _wall?: { type: 'building' };
  _bloodMats?: Map<string, THREE.Material>; // the car's material for each look (setCarLook), keyed body_paint
  _twoWheelers?: (CyclistEntity | MotoEntity)[];
  _bodied?: (CarEntity | CyclistEntity | MotoEntity)[];
  rain: number; // the rain falling, 0..1 (main.ts: washing the blood off the car)
  carPhysics?: CarPhysics | null;
  ragdolls?: Ragdolls | null; // (sim/ragdolls.ts, main.ts)
  // (main.ts: the driver or rider thrown out, impact in m/s (0: stepped off), at (x, z), off which vehicle)
  onEject?: (impact: number, x: number, z: number, kind: VehicleMode) => void;

  constructor(scene: THREE.Scene, colliders: PlayerCollider[] = []) {
    this.scene = scene;
    this.colliders = colliders;
    this._colliderCells = null; // built on first use, see nearColliders()
    this.leftCars = []; // the player's cars left behind for another one (leaveCarBehind)
    this.activeMode = 'person'; // 'person' | 'car' | 'cyclist' | 'helicopter' | 'moto': on foot until getting into something (F)
    this.rotorSpin = 0; // rad/s of the helicopter's main rotor: winds up with the pilot aboard, down once parked

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      boost: false,
      handbrake: false,
      shiftUp: false,
      shiftDown: false,
      gearbox: false,
      fire: false // (crime.ts: the right mouse button fires too)
    };
    // Out of breath (player/stats.ts), shift no longer sprints on foot nor on the bicycle; the motors don't tire
    this.canSprint = true;
    // The road under the tyres (main.ts, from weather.ts RoadWater): the water on it 0..1 and what that leaves of
    // the tyres' dry grip (wetGrip)
    this.roadWet = 0;
    this.roadGrip = 1;
    // The rain falling 0..1 (main.ts), washing the blood off the car
    this.rain = 0;
    // A flood's water (m deep) at (x, z) (floods.ts, main.ts): wading slows the walk, a car pushes the water aside,
    // and deep enough it drowns the engine
    this.waterAt = null;
    // Inside a restaurant, bar or antro (interiors.ts setInterior): its room's own floor & walls
    this.interior = null;
    // Taking aim on foot (player/aim.ts sets it every frame): the player walks and strafes instead of turning
    this.aiming = false;

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity(),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity(),
      moto: this.createMotoEntity()
    };

    Object.values(this.entities).forEach((ent) => {
      ent.mesh.traverse((child) => {
        // (a mesh's one material: a list of them has none of these flags)
        const material = isMesh(child) && !Array.isArray(child.material) ? child.material : undefined;
        if (
          isMesh(child) &&
          !(material instanceof THREE.MeshBasicNodeMaterial) &&
          material?.type !== 'MeshBasicNodeMaterial' &&
          !material?.transparent
        ) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    });

    this.setCarLook(); // (the taxi, at its model's size)
    this.createSmoke();
    this.syncOccupants();
    this.bindKeyboard();
  }

  setCollisionListener(listener: ((event: CollisionEvent) => void) | null | undefined): void {
    this._collisionListener = typeof listener === 'function' ? listener : null;
    this._collisionEvent ??= { a: null, b: null, kind: '', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
  }

  // Reuse one synchronous event; consumers must copy retained fields. Normal points from b toward a.
  reportCollision(a: unknown, b: unknown, kind: string, x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number): void {
    const event = this._collisionEvent;
    if (!this._collisionListener || !event || speed <= 0.5) return;
    event.a = a; event.b = b; event.kind = kind;
    event.x = x; event.y = y; event.z = z;
    event.nx = nx; event.ny = ny; event.nz = nz; event.speed = speed;
    this._collisionListener(event);
  }

  bindKeyboard(): void {
    const bindings: Record<InputAction, string[]> = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space', 'KeyE'],
      down: ['KeyQ', 'KeyC'],
      boost: ['ShiftLeft', 'ShiftRight'],
      // the car's handbrake & gearbox share keys with jumping and the helicopter's collective
      handbrake: ['Space'],
      shiftUp: ['KeyE'],
      shiftDown: ['KeyQ'],
      gearbox: ['KeyT'],
      fire: ['KeyX']
    };
    const actionsByCode = new Map<string, InputAction[]>();
    // (bindings' keys are the actions)
    for (const [action, codes] of Object.entries(bindings) as [InputAction, string[]][]) {
      for (const code of codes) actionsByCode.set(code, [...(actionsByCode.get(code) ?? []), action]);
    }
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};

    const onKey = (e: KeyboardEvent, isDown: boolean) => {
      const actions = actionsByCode.get(e.code);
      if (!actions || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      for (const action of actions) {
        // Releasing one binding must not cancel another key held for the same action.
        this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
        this._blendInput(action);
      }
    };

    window.addEventListener('keydown', (e) => { onKey(e, true); });
    window.addEventListener('keyup', (e) => { onKey(e, false); });
    window.addEventListener('blur', () => { this.resetInput(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  _blendInput(action: InputAction): void {
    const keyboard = this._keyboardKeys[action] || false;
    const touch = this._touchKeys[action] || false;
    const gamepad = this._gamepadKeys[action] || false;
    const strength = Math.max(Number(keyboard), Number(touch), Number(gamepad));
    // Preserve digital button values while allowing either analog source to be strongest.
    this.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
  }

  _setAnalogInput(source: InputSource, action: InputAction, value: KeyValue): void {
    if (!Object.hasOwn(this.keys, action)) return;
    const strength = Number(value);
    source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this._blendInput(action);
  }

  setTouchInput(action: InputAction, value: KeyValue): void {
    this._setAnalogInput(this._touchKeys, action, value);
  }

  setGamepadInput(action: InputAction, value: KeyValue): void {
    this._setAnalogInput(this._gamepadKeys, action, value);
  }

  clearTouchInput(): void {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys) as InputAction[]) this._blendInput(action);
  }

  clearGamepadInput(): void {
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys) as InputAction[]) this._blendInput(action);
  }

  resetInput(): void {
    this._pressedCodes.clear();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys) as InputAction[]) this.keys[action] = false;
  }

  // The mode the player is sprinting in now ('person' | 'cyclist', shift held going forward at speed), or null: what
  // runs the stamina down (player/stats.ts)
  sprintingMode(): SprintMode | null {
    const mode = this.activeMode;
    if (!this.keys.boost || !this.keys.forward || !this.canSprint || (mode !== 'person' && mode !== 'cyclist')) return null;
    return this.entities[mode].speed > (mode === 'person' ? 4.6 : 3) ? mode : null;
  }

  setMode(mode: PlayerMode): void {
    this.activeMode = mode;
    this.syncOccupants();
  }

  // On foot the pedestrian walks and the vehicles stand empty where they were left; in a vehicle the pedestrian rides
  // along out of sight, and only a bicycle being ridden has its rider (and helmet) on it
  syncOccupants(): void {
    const onFoot = this.activeMode === 'person';
    const p = this.entities.person;
    p.mesh.visible = onFoot;
    for (const m of p.crowd.meshes) m.visible = onFoot;
    const b = this.entities.cyclist;
    const riding = this.activeMode === 'cyclist';
    for (const m of b.riderCrowd.meshes) m.visible = riding;
    b.helmet.visible = riding;
    const moto = this.entities.moto;
    const onMoto = this.activeMode === 'moto';
    for (const m of moto.riderCrowd.meshes) m.visible = onMoto;
    moto.helmet.visible = onMoto;
  }

  // GTA-style boarding (F, main.ts): the player's own vehicle the pedestrian could get into, the nearest whose body
  // is within `reach` metres; { mode, distance } (and `left`: one of the cars left behind, leaveCarBehind) or null
  ownVehicleNear(reach: number): { mode: VehicleMode; distance: number; left?: LeftCar } | null {
    const p = this.entities.person.position;
    let best: { mode: VehicleMode; distance: number; left?: LeftCar } | null = null;
    // [mode, half width, half length, centre ahead of the origin]: the helicopter runs from its nose (+2.5 m) back to
    // the tail rotor (-6 m)
    const car = this.entities.car;
    for (const [mode, halfW, halfL, mid] of [['car', car.halfW || 0.86, car.halfL || 2.18, 0], ['cyclist', 0.32, 0.95, 0], ['moto', 0.4, 1.0, 0], ['helicopter', 1.3, 4.3, -1.8]] as const) {
      const e = this.entities[mode];
      if (Math.abs(e.position.y - p.y) > 2.5) continue; // (a helicopter up in the air)
      const dx = p.x - e.position.x, dz = p.z - e.position.z;
      const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
      const distance = Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz - mid) - halfL), Math.max(0, Math.abs(dz * fx - dx * fz) - halfW));
      if (distance <= reach && (!best || distance < best.distance)) best = { mode, distance };
    }
    for (const left of this.leftCars) {
      if (Math.abs(left.y - p.y) > 2.5) continue;
      const dx = p.x - left.x, dz = p.z - left.z;
      const fx = Math.sin(left.heading), fz = Math.cos(left.heading);
      const distance = Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz) - left.halfL), Math.max(0, Math.abs(dz * fx - dx * fz) - left.halfW));
      if (distance <= reach && (!best || distance < best.distance)) best = { mode: 'car', distance, left };
    }
    return best;
  }

  // The player takes another car (main.ts board) and leaves theirs where it stands: a still copy of it as it is (its
  // model, paint, dents, a camión's parts), which the traffic stops behind, the player bumps into and can get back into
  // (takeLeftCar). The copy keeps the car's dented body and camión parts: the car is given new ones with its next look
  leaveCarBehind(): void {
    const c = this.entities.car;
    const mesh = c.mesh.clone(true); // (sharing the geometries & materials)
    const lights: THREE.Object3D[] = [];
    mesh.traverse((o) => { if (o instanceof THREE.Light) lights.push(o); });
    for (const light of lights) light.removeFromParent();
    mesh.name = 'LeftCar';
    this.scene.add(mesh);
    const { x, y, z } = c.position;
    // its box for the collisions, the length along its heading (as bridges.ts builds its walls' boxes)
    const yaw = Math.atan2(-Math.cos(c.heading), Math.sin(c.heading));
    const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = c.halfL, hz = c.halfW;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    // (its stains and the material showing them its own from here on: the next car of its look gets another)
    if (this._bloodMats?.get(`${c.look.bodyType}_${c.look.paint}`) === c.bodyMesh.material) {
      this._bloodMats.delete(`${c.look.bodyType}_${c.look.paint}`);
    }
    this.leftCars.push({
      mesh, x, y, z, heading: c.heading, halfW: c.halfW, halfL: c.halfL, look: { ...c.look }, damage: c.damage,
      dented: c.dented, kit: c.kit, stains: c.stains, material: c.bodyMesh.material,
      collider: { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y - 0.3, maxY: y + (c.kit?.wheels ? 3.0 : 1.5), obb: { cx: x, cz: z, hx, hz, cs, sn }, _order: 1e15 }
    });
    c.dented = null;
    c.damage = createDamage();
    c.stains = createStains();
    this.dropLookKit(c, false);
    if (this.leftCars.length > LEFT_CARS) this.forgetLeftCar(this.leftCars[0]);
  }

  forgetLeftCar(left: LeftCar, dispose = true): void {
    const i = this.leftCars.indexOf(left);
    if (i >= 0) this.leftCars.splice(i, 1);
    left.mesh.removeFromParent();
    if (left.kit) for (const m of left.kit.chassis) m.geometry.dispose();
    if (dispose && left.dented) left.dented.geometry.dispose();
    if (dispose && left.material.userData.blood) left.material.dispose();
  }

  // Back into a car left behind: the one the player had is left where it is in its place, and the car becomes this
  // one again, dents and all
  takeLeftCar(left: LeftCar): boolean {
    if (this.activeMode !== 'person') return false;
    const c = this.entities.car;
    this.leaveCarBehind();
    this.forgetLeftCar(left, false);
    const { look } = left;
    // (its material back for its look, its stains on it)
    if (left.material.userData.blood) this._bloodMats?.set(`${look.bodyType}_${look.paint}`, left.material);
    this.setCarLook(look.bodyType, look.paint, look.police, look.model, look.route);
    c.stains = left.stains;
    c.bloody = true;
    this.showBlood(c);
    c.position.set(left.x, left.y, left.z);
    c.heading = left.heading;
    c.damage = left.damage;
    if (left.dented) {
      c.dented = left.dented;
      c.bodyMesh.geometry = left.dented.geometry;
    }
    for (const wheel of c.wheels) wheel.steerPivot.rotation.z = c.kit ? 0 : c.damage.camber[(wheel.isFront ? 0 : 2) + (wheel.side > 0 ? 0 : 1)];
    this.settle(c);
    return this.enterVehicle('car');
  }

  // Get in: one of the player's own vehicles where it stands, or `taken`, a car or bicycle taken from the traffic
  // (traffic.ts hijack): the player's vehicle of that kind takes its place, looks and (slowed) speed
  enterVehicle(mode: PlayerMode, taken: TakenVehicle | null = null): boolean {
    if (this.activeMode !== 'person' || mode === 'person' || this.entities.person.ragdoll) return false;
    const ent = this.entities[mode];
    if (taken) {
      if (mode === 'car') this.setCarLook(taken.bodyType, taken.paint, taken.police, taken.model, taken.route);
      else if (mode === 'cyclist') this.setBikeColor(taken.color);
      else if (mode === 'moto') this.setMotoLook(taken.model, taken.paint);
      ent.position.set(taken.x, this.getGroundHeight(taken.x, taken.z, mode), taken.z); // just where it was
      ent.heading = taken.heading;
      this.settle(ent);
      ent.speed = Math.max(0, taken.speed) * 0.4;
    }
    this.setMode(mode);
    return true;
  }

  // Get out: the pedestrian steps out on the driver's side (left), the vehicle stays where it stopped. A helicopter
  // has to be (almost) on the ground first
  exitVehicle(): boolean {
    const mode = this.activeMode;
    if (mode === 'person') return false;
    const v = this.entities[mode];
    const ground = this.getGroundHeight(v.position.x, v.position.z, mode, v.position.y);
    if (mode === 'helicopter' && v.position.y - ground > 3) return false;
    if (mode === 'helicopter') v.position.y = ground + 0.25;
    this.settle(v);
    if (v.type === 'car' && v.carState) v.carState.value.x = 0; // (no brake lights on a parked car)
    // (beside a car or camión by its own size)
    const side = v.type === 'car' ? (v.halfW || 0.86) + 0.64 : mode === 'cyclist' ? 0.75 : mode === 'moto' ? 0.85 : 2.4;
    const end = v.type === 'car' ? (v.halfL || 2.18) + 0.82 : mode === 'cyclist' ? 1.6 : mode === 'moto' ? 1.7 : 6.6;
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading); // left (heading 0 faces +z, left is +x)
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const spots = [[lx * side, lz * side], [-lx * side, -lz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
    const shape = collisionBody('person', 0.48, 0, 0.05);
    const fits = (x: number, z: number) => {
      const y = this.getGroundHeight(x, z, 'person', v.position.y);
      return !this.nearColliders(x, z, 1).some((c) => buildingContact(c, x, y, z, shape));
    };
    const [ox, oz] = spots.find(([sx, sz]) => fits(v.position.x + sx, v.position.z + sz)) ?? spots[0];
    const p = this.entities.person;
    const x = v.position.x + ox, z = v.position.z + oz;
    this.setMode('person');
    this.resetInput();
    p.position.set(x, this.getGroundHeight(x, z, 'person', v.position.y), z);
    p.heading = v.heading;
    this.settle(p);
    return true;
  }

  // The traffic's parts for a camión or a combi the player takes (traffic.ts lookKit: the camión's body & wheels, the
  // combi's roof sign, each with its route), given the look { bodyType, route }
  setLookKits(make: ((look: { bodyType: string; route: CarRoute | null }) => LookKit | null) | null | undefined): void {
    this.lookKits = typeof make === 'function' ? make : null;
  }

  // The player's car becomes the one it was taken from: its model (js/models/cars) with its body shape stretched to
  // the model's size, its paint, its police livery, and the model's own engine & gearbox (drivetrain.ts). A camión
  // or a combi keeps its route ({ sign, livery }: its name on the glass or the roof, the camión's livery)
  setCarLook(bodyType = 'taxi', paint = 0xffbe14, police = false, modelId: string | null = null, route: CarRoute | null = null): void {
    const c = this.entities.car;
    this.dropLookKit(c);
    const kit = (route || bodyType === 'bus') && this.lookKits ? this.lookKits({ bodyType, route }) : null;
    if (bodyType === 'bus') {
      if (kit) {
        this.setBusLook(c, kit, route);
        return;
      }
      bodyType = 'taxi'; // (no traffic to build a camión from: the taxi)
      modelId = null;
    }
    const model = modelFor({ bodyType, police, model: modelId });
    const spec = SPEC_BY_NAME[bodyType] ?? SPEC_BY_NAME[model.body] ?? BODY_SPECS.taxi;
    // (its own material, for its stains: one for each look, one more for each car of it left behind, leaveCarBehind)
    const looks = (this._bloodMats ??= new Map<string, THREE.Material>());
    const mat = looks.get(`${spec.name}_${paint}`) ?? createLoftedCarMaterial(spec, paint, { blood: true });
    looks.set(`${spec.name}_${paint}`, mat);
    const geos = (this._carGeos ??= {});
    const g = (geos[spec.name] ??= {
      body: buildCarGeometry(spec, false),
      wheels: [buildSteerableWheelGeo(spec, -1), buildSteerableWheelGeo(spec, 1)]
    });
    // the body shape's scale to the model's real length, width & height (chassis children: body, decals, plates, lamps)
    const dims = bodyDims(spec);
    const sx = model.size[1] / dims.width, sy = model.size[2] / dims.height, sz = model.size[0] / dims.length;
    const sw = Math.min(sy, sz);
    c.chassisPivot.scale.set(sx, sy, sz);
    c.scale = { x: sx, y: sy, z: sz };
    c.bodyHalf = { w: dims.halfW, l: dims.halfL }; // (the body shape's own, for the dents)
    c.halfW = dims.halfW * sx * 0.92;
    c.halfL = dims.halfL * sz;
    c.bodyMesh.geometry = g.body;
    c.bodyMesh.material = mat;
    for (const wheel of c.wheels) {
      wheel.tire.geometry = g.wheels[wheel.side < 0 ? 0 : 1];
      wheel.tire.material = mat;
      wheel.tire.scale.setScalar(sw);
      wheel.steerPivot.position.set(wheel.side * spec.wheelX * sx, spec.wheelRadius * sw, (wheel.isFront ? spec.wheelZ : -spec.wheelZ) * sz);
      wheel.restY = spec.wheelRadius * sw;
    }
    for (const decal of c.taxiDecals) decal.visible = spec.name === 'taxi';
    c.plates[0].position.set(0, spec.plates[0], spec.zFront + 0.006);
    c.plates[1].position.set(0, spec.plates[1], spec.zRear - 0.006);
    c.headLights.forEach((spot, i) => { placeVehicleHeadlight(spot, spec, i === 0 ? -1 : 1); });
    c.carState = (mat.userData.carState as CarStateUniform | undefined) ?? null; // (the fixed-colour material's uniform)
    if (c.carState) c.carState.value.set(0, 0, 0, police ? 1 : 0); // (livery: 1 = police)
    c.blood = (mat.userData.blood as BloodUniforms | undefined) ?? null;
    c.bloodFrame = bloodFrame(spec, dims.halfW);
    c.label = spec.name === 'taxi' ? LABELS.car : police ? 'Patrulla' : model.name;
    c.look = { bodyType: spec.name, paint, police, model: model.id, route: kit ? route : null };
    if (kit) {
      // a combi's route sign on its roof (in the body shape's frame, stretched with it)
      for (const m of kit.chassis) c.chassisPivot.add(m);
      c.kit = kit;
      c.label = kit.label;
    }
    c.zFront = spec.zFront * sz;
    c.bodyHeight = model.size[2];
    c.spec = buildSpec(model);
    c.drive = createDriveState(c.spec);
    this.repairCar(c);
  }

  // ...or the camión itself: the traffic's bus body, route sign & wheels instead of the car's, its size, its lamps,
  // the bus's engine & gearbox (BUS_MODEL), and the chase camera further back and up
  setBusLook(c: CarEntity, kit: LookKit, route: CarRoute | null): void {
    c.bodyMesh.visible = false;
    for (const decal of c.taxiDecals) decal.visible = false;
    for (const plate of c.plates) plate.visible = false;
    for (const wheel of c.carWheels) wheel.steerPivot.visible = false;
    c.chassisPivot.scale.set(1, 1, 1);
    c.scale = { x: 1, y: 1, z: 1 };
    for (const m of kit.chassis) c.chassisPivot.add(m);
    const wheels = kit.wheels ?? []; // (a camión's kit has its wheels)
    for (const wheel of wheels) c.mesh.add(wheel.steerPivot);
    c.wheels = wheels;
    c.kit = kit;
    c.bodyHalf = { w: BUS_SPEC.halfWidth[0][1], l: BUS_SPEC.zFront };
    c.halfW = BUS_SPEC.halfWidth[0][1];
    c.halfL = BUS_SPEC.zFront;
    c.bodyHeight = BUS_MODEL.size[2];
    c.headLights.forEach((spot, i) => { placeVehicleHeadlight(spot, BUS_SPEC, i === 0 ? -1 : 1); });
    c.carState = null;
    c.blood = null; // (the camión's body is the traffic's: no stains drawn on it)
    c.label = kit.label;
    c.look = { bodyType: 'bus', paint: 0xffffff, police: false, model: BUS_MODEL.id, route };
    c.zFront = BUS_SPEC.zFront;
    c.spec = buildSpec(BUS_MODEL);
    c.drive = createDriveState(c.spec);
    c.shadow.scale.set(2.92 / 2.22, 1, 12.1 / 5.05);
    c.chaseDistance = 12.5;
    c.chaseHeight = 4.1;
    c.cameraTargetOffset.y = 1.9;
    this.repairCar(c);
  }

  // Takes the last camión's or combi's parts off the player's car, and gives it back its own
  dropLookKit(c: CarEntity, dispose = true): void {
    const kit = c.kit;
    if (!kit) return;
    for (const m of kit.chassis) {
      m.removeFromParent();
      if (dispose) m.geometry.dispose(); // (unless a car left behind still shows it)
    }
    if (kit.wheels) for (const wheel of kit.wheels) wheel.steerPivot.removeFromParent();
    c.kit = null;
    c.wheels = c.carWheels;
    c.bodyMesh.visible = true;
    for (const plate of c.plates) plate.visible = true;
    for (const wheel of c.carWheels) wheel.steerPivot.visible = true;
    c.shadow.scale.set(1, 1, 1);
    c.chaseDistance = 6.9;
    c.chaseHeight = 2.12;
    c.cameraTargetOffset.y = 0.96;
  }

  // The car like new: no damage, the shared undented body mesh back, the wheels true
  repairCar(c: CarEntity = this.entities.car): void {
    c.damage = createDamage();
    clean(c.stains);
    c.bloody = false;
    this.showBlood(c);
    if (c.dented) {
      c.dented.geometry.dispose();
      c.dented = null;
    }
    const geo = this._carGeos?.[c.look.bodyType];
    if (geo) c.bodyMesh.geometry = geo.body;
    for (const wheel of c.wheels) wheel.steerPivot.rotation.z = 0;
  }

  // Someone struck by the car's nose at (x, z), `speed` m/s: their blood on it, and up its bonnet and windscreen as
  // hard as it hit them (player/car-blood.ts); only the player's car, driven forwards
  bloodyCar(x: number, z: number, speed: number): void {
    const c = this.entities.car;
    const bleed = bleedOf(Math.abs(speed));
    if (this.activeMode !== 'car' || !c.blood || !c.bloodFrame || !(bleed > 0) || c.speed <= 0) return;
    // struck by its nose, not by its flank or its tail (backing over someone), and where across it, in its body
    // shape's frame (its left: (cos h, -sin h))
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    if ((x - c.position.x) * sn + (z - c.position.z) * cs < c.halfL * 0.4) return;
    const across = ((x - c.position.x) * cs - (z - c.position.z) * sn) / (c.scale?.x || 1);
    addHit(c.stains, c.bloodFrame, across, Math.abs(speed), bleed);
    c.bloody = true;
    this.showBlood(c);
  }

  // The car's stains into its material's uniforms
  showBlood(c: CarEntity): void {
    if (!c.blood) return;
    const { front, top } = c.stains;
    for (let i = 0; i < c.blood.front.length; i++) c.blood.front[i].value.fromArray(front, i * 4);
    for (let i = 0; i < c.blood.top.length; i++) c.blood.top[i].value.fromArray(top, i * 4);
  }

  // ...and the player's bicycle the frame colour of the one it was taken from
  setBikeColor(hex = 0x0078e8): void {
    const b = this.entities.cyclist;
    const mat = createCarPaintMaterial(hex);
    for (const m of b.frameMeshes) m.material = mat;
    b.look = { color: hex };
  }

  // The moto becomes model `modelId` (js/models/motos: its engine, gearbox & weight; the Italika's shape) in `paint`
  setMotoLook(modelId = PLAYER_MOTO.id, paint = paintsOf(PLAYER_MOTO)[0]): void {
    const m = this.entities.moto;
    const model = MOTO_MODEL_BY_ID[modelId] ?? PLAYER_MOTO;
    if (m.vehicle) this.parkTwoWheeler(m); // (its body is made again for its own weight)
    m.model = model;
    m.spec = buildSpec(model);
    m.drive = null;
    m.label = model.name;
    const mat = createCarPaintMaterial(paint);
    for (const mesh of m.paintMeshes) mesh.material = mat;
    m.look = { model: model.id, paint };
  }

  // The player's car & bicycle left standing, for the traffic to stop behind (traffic.ts setParked)
  parkedVehicles(): ParkedVehicle[] {
    const slots = (this._parkedSlots ??= {
      car: { x: 0, z: 0, heading: 0, halfW: 0.86, halfL: 2.18 }, cyclist: { x: 0, z: 0, heading: 0, halfW: 0.32, halfL: 0.95 },
      moto: { x: 0, z: 0, heading: 0, halfW: 0.4, halfL: 1.0 }
    });
    slots.car.halfW = this.entities.car.halfW || 0.86;
    slots.car.halfL = this.entities.car.halfL || 2.18;
    const out = (this._parked ??= []);
    out.length = 0;
    for (const mode of ['car', 'cyclist', 'moto'] as const) {
      if (mode === this.activeMode) continue;
      const e = this.entities[mode];
      slots[mode].x = e.position.x;
      slots[mode].z = e.position.z;
      slots[mode].heading = e.heading || 0;
      out.push(slots[mode]);
    }
    for (const left of this.leftCars) out.push(left);
    return out;
  }

  // The helicopter waits on the ground, clear of the buildings, for the player to walk up and get in (back at its
  // spot near the start with `home`, so it is always found there when the game starts)
  landHelicopter(home = false): void {
    const h = this.entities.helicopter;
    if (home) {
      h.position.x = SPAWN.helicopter.x;
      h.position.z = SPAWN.helicopter.z;
      h.heading = START.heading + 0.62;
    }
    const mode = this.activeMode;
    this.activeMode = 'helicopter';
    const altitude = this.getGroundHeight(h.position.x, h.position.z, 'helicopter') + 0.25;
    const spot = this.findTeleportPosition(h.position.x, h.position.z, h.heading, altitude);
    this.activeMode = mode;
    if (spot) {
      h.position.x = spot.x;
      h.position.z = spot.z;
    }
    h.position.y = this.getGroundHeight(h.position.x, h.position.z, 'helicopter') + 0.25;
    this.settle(h);
  }

  getActiveEntity(): PlayerEntity {
    return this.entities[this.activeMode];
  }

  teleportActiveTo(x: number, z: number, heading = Math.PI, savedAltitude: number | null = null): { x: number; z: number } {
    this.getUp(); // (a body lying somewhere stays there: the player arrives on its feet)
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    const heli = this.activeMode === 'helicopter';
    const floor = heli ? this.floorHeight(x, z) : 0; // (the helicopter flies up to 380 m over the town's floor)
    const altitude = heli ? Math.max(floor + 0.25, Math.min(floor + 380, savedAltitude ?? Math.max(floor + 92, ent.position.y))) : 0;
    const destination = this.findTeleportPosition(x, z, heading, altitude);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      // (on top of a bridge's deck where one passes over: the street up there rather than the ground under it)
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode, Infinity);
    }
    this.settle(ent);
    return { x: ent.position.x, z: ent.position.z };
  }

  // At rest where it stands, with no motion or pose left over (teleports, getting in & out, parking)
  settle(ent: PlayerEntity): void {
    ent.speed = 0;
    if (ent.type === 'person') {
      ent.verticalVel = 0;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (ent.type === 'car') {
      this.tiltToGround(ent, 1);
      ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
      ent.impactArmed = false; // (a stop or jump in its velocity now is no crash, see checkImpact)
      ent.physicsPlaced = false; // (Jolt's body is set down here, at rest, see driveCar)
      if (ent.drive) ent.drive.shift = 0;
      ent.pitchVel = ent.rollVel = ent.heaveVel = 0; // (the traffic's last shove, see driveCar)
      ent.vy = 0;
      ent.flying = false;
      ent.lastCollisionSpark = null;
      for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
      if (ent.carState) ent.carState.value.x = 1;
    } else if (ent.type === 'cyclist' || ent.type === 'moto') {
      this.tiltToGround(ent, 1);
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
      ent.vx = ent.vz = ent.steerInput = 0;
      ent.peak = undefined;
      ent.physicsPlaced = false; // (Jolt's body, ridden, is set down here at rest: driveTwoWheeler)
      if (ent.type === 'moto' && ent.drive) ent.drive.shift = 0;
      const { radius, rear, front } = ent.wheelSpots;
      ent.rearWheel.position.set(0, radius, rear);
      ent.frontWheel.position.set(0, radius, front - ent.steerPivot.position.z);
      ent.steerPivot.rotation.y = ent.shadow.rotation.z = 0;
    } else {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
  }

  // Lays a vehicle left standing on the slope under its wheels (the tilt eased by k of the way, 1: at once): its whole
  // body with the wheels & contact shadow; a bicycle or a moto only pitches (it leans on its stand)
  tiltToGround(ent: CarEntity | CyclistEntity | MotoEntity, k: number): void {
    const car = ent.type === 'car';
    const t = this.groundTilt(ent.position.x, ent.position.z, ent.heading, car ? 1.35 : 0.55, car ? 0.8 : 0.3, (this._tilt ??= { pitch: 0, roll: 0 }), ent.position.y);
    ent.groundPitch = (ent.groundPitch || 0) + (t.pitch - (ent.groundPitch || 0)) * k;
    ent.groundRoll = car ? (ent.groundRoll || 0) + (t.roll - (ent.groundRoll || 0)) * k : 0;
    ent.mesh.rotation.order = 'YXZ';
    ent.mesh.rotation.x = ent.groundPitch;
    ent.mesh.rotation.z = ent.groundRoll;
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
  findTeleportPosition(x: number, z: number, heading: number, altitude: number): { x: number; z: number } | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = this.activeMode === 'helicopter';
    const radius = heli ? 4.5 : this.activeMode === 'person' ? 0.48 : 0.65;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const shape = collisionBody(this.activeMode, radius, heading, 0.1, this.entities.car);
    const reach = Math.max(shape.extX, shape.extZ);
    const margin = heli ? 6000 : 0;
    const entity = this.getActiveEntity();
    // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
    const carReach = Math.max(2.4, (this.entities.car.halfL || 2.18) + 0.25);
    const body = { person: [0.48, 1.9], car: [carReach, 1.9], cyclist: [1.0, 1.9], moto: [1.1, 1.9], helicopter: [6.2, 3.2] };
    const others = Object.values(this.entities).filter(e => e !== entity).map(e => ({
      x: e.position.x, z: e.position.z, radius: body[e.type][0],
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + body[e.type][1]
    }));
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px: number, pz: number) => {
      pz = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + margin, pz));
      px = Math.max(ISLAND_BOUNDS.minX - margin, Math.min(ISLAND_BOUNDS.maxX + margin, px));
      if (!heli) {
        const shore = getIslandBoundsAtZ(pz);
        const west = shore.westX + 8, east = shore.eastX - 8;
        if (west > east) return null;
        px = Math.max(west, Math.min(east, px));
      }
      return { x: px, z: pz };
    };
    const clear = (p: { x: number; z: number } | null) => {
      if (!p) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, this.activeMode);
      // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
      // parked car between camera and character from hiding the character even when the camera itself is outside it.
      const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
      }
      for (const c of this.nearColliders(p.x, p.z, reach)) {
        if (buildingContact(c, p.x, baseY, p.z, shape)) return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    const cx = origin ? origin.x : Math.max(ISLAND_BOUNDS.minX, Math.min(ISLAND_BOUNDS.maxX, x));
    const cz = origin ? origin.z : Math.max(ISLAND_BOUNDS.minZ + 30, Math.min(ISLAND_BOUNDS.maxZ, z));
    for (let distance = 4; distance <= 256; distance += 4) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // =========================================================================
  // 1. PERSON (SKINNED PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.ts)
  // =========================================================================
  createPersonEntity(): PersonEntity {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';

    // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });

    // Soft Under-Foot Contact Shadow (AO)
    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const pedShadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    pedShadow.position.y = 0.02;
    pedShadow.renderOrder = 998;
    root.add(pedShadow);

    this.scene.add(root);

    return {
      type: 'person',
      label: LABELS.person,
      mesh: root,
      shadow: pedShadow,
      crowd,
      rig,
      position: new THREE.Vector3(SPAWN.person.x, ISLAND_BOUNDS.sidewalkHeight, SPAWN.person.z),
      heading: SPAWN.person.heading,
      speed: 0,
      verticalVel: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 4.3,
      chaseHeight: 1.95
    };
  }

  // =========================================================================
  // 2. CAR (3D LOFTED SCULPTED YELLOW TAXI SEDAN)
  // =========================================================================
  createCarEntity(): CarEntity {
    const root = new THREE.Group();
    root.name = 'PlayerTaxiCar';

    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);

    const spec = BODY_SPECS.taxi;
    const taxiLoftMat = createLoftedCarMaterial(spec, 0xffbe14);

    // 1. 3D Lofted Taxi Body + Curved Windscreens + Crowned Roof + Side Mirrors + Roof Sign
    const carBodyGeo = buildCarGeometry(spec, false);
    const carBodyMesh = new THREE.Mesh(carBodyGeo, taxiLoftMat);
    carBodyMesh.castShadow = true;
    carBodyMesh.receiveShadow = true;
    chassisPivot.add(carBodyMesh);

    // 2. Taxi side door emblem & unit number decals, hugging the curved front doors
    const doorDecalTex = createTaxiDoorDecalTexture();
    const doorDecalMat = new THREE.MeshStandardNodeMaterial({
      map: doorDecalTex,
      roughness: 0.24,
      metalness: 0.34,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const doorMid = (spec.doors[0] + spec.doors[1]) / 2;
    const taxiDecals: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(buildCarSidePatch(spec, side, doorMid - 0.36, doorMid + 0.36, 0.53, 0.81, 0.003), doorDecalMat);
      chassisPivot.add(decal);
      taxiDecals.push(decal);
    }

    // 3. License plates on the bumpers
    const plateTex = createLicensePlateTexture();
    const plateMat = new THREE.MeshStandardNodeMaterial({ map: plateTex, roughness: 0.28 });
    const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), plateMat);
    rearPlate.position.set(0, spec.plates[1], spec.zRear - 0.006);
    chassisPivot.add(rearPlate);

    const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), plateMat);
    frontPlate.position.set(0, spec.plates[0], spec.zFront + 0.006);
    chassisPivot.add(frontPlate);

    // 3b. Brake lights, CHMSL & turn signals are lit by the taxi material from its carState uniform (see carEffects)
    const carState = (taxiLoftMat.userData.carState as CarStateUniform | undefined) ?? null;

    // 4. Steerable & Spinning 3D LatheGeometry Tyres + Recessed 5-Spoke Alloy Wheels
    const leftWheelGeo = buildSteerableWheelGeo(spec, -1);
    const rightWheelGeo = buildSteerableWheelGeo(spec, 1);
    this._carGeos = { taxi: { body: carBodyGeo, wheels: [leftWheelGeo, rightWheelGeo] } }; // (see setCarLook)

    const wheels: CarWheel[] = [];
    const wheelCoords = [
      { side: -1, z: spec.wheelZ, isFront: true },
      { side: 1, z: spec.wheelZ, isFront: true },
      { side: -1, z: -spec.wheelZ, isFront: false },
      { side: 1, z: -spec.wheelZ, isFront: false }
    ];
    for (const wc of wheelCoords) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wc.side * spec.wheelX, spec.wheelRadius, wc.z);
      const tire = new THREE.Mesh(wc.side < 0 ? leftWheelGeo : rightWheelGeo, taxiLoftMat);
      tire.castShadow = true;
      tire.receiveShadow = true;
      steerPivot.add(tire);
      root.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: wc.isFront, side: wc.side });
    }

    // 5. Soft Under-Car Contact Shadow (AO) + Clustered Dual LED Headlight SpotLights & Rear Brake PointLight
    const carShadowGeo = new THREE.PlaneGeometry(2.22, 5.05);
    carShadowGeo.rotateX(-Math.PI * 0.5);
    const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
    carShadow.position.set(0, 0.02, 0.0);
    carShadow.renderOrder = 998;
    root.add(carShadow);

    const headLights: THREE.SpotLight[] = [];
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }

    this.scene.add(root);

    return {
      type: 'car',
      label: LABELS.car,
      mesh: root,
      chassisPivot,
      bodyMesh: carBodyMesh,
      taxiDecals,
      plates: [frontPlate, rearPlate],
      look: { bodyType: 'taxi', paint: 0xffbe14, police: false },
      carState,
      headLights,
      wheels,
      carWheels: wheels, // (its own: a camión taken has the bus's, setBusLook)
      stains: createStains(),
      kit: null, // a camión's or combi's parts from the traffic (setCarLook)
      shadow: carShadow,
      position: new THREE.Vector3(SPAWN.car.x, 0.0, SPAWN.car.z),
      heading: SPAWN.car.heading,
      speed: 0,
      vx: 0, // its sideways velocity (m/s, world x & z: its slide)
      vz: 0,
      // the traffic's shove since the last step (traffic.ts collideWithPlayer): spin, pitch, roll & heave (rad/s, m/s)
      angularVel: 0,
      pitchVel: 0,
      rollVel: 0,
      heaveVel: 0,
      vy: 0, // vertical speed (m/s)
      flying: false, // no wheel on the ground
      lastCollisionSpark: null,
      steerAngle: 0,
      zFront: spec.zFront,
      spec: buildSpec(TAXI_MODEL),
      halfW: 0.86, // m, the model's footprint (setCarLook)
      halfL: 2.18,
      drive: null, // drivetrain.ts state: gear, revs, nitro (made on the first drive)
      damage: createDamage(),
      dented: null, // its own copy of the body mesh once it has dents
      drifting: false,
      impactArmed: false,
      lastVx: 0,
      lastVz: 0,
      cameraTargetOffset: new THREE.Vector3(0, 0.96, 0),
      chaseDistance: 6.9,
      chaseHeight: 2.12
    };
  }

  // =========================================================================
  // 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
  // =========================================================================
  createCyclistEntity(): CyclistEntity {
    const root = new THREE.Group();
    root.name = 'PlayerCyclist';

    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const frameMat = createCarPaintMaterial(0x0078e8);
    const tireMat = new THREE.MeshStandardNodeMaterial({
      color: 0x181a1e,
      roughness: 0.60
    });
    const chromeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xe0e8f0,
      roughness: 0.16,
      metalness: 0.78
    });
    const shortsMat = new THREE.MeshStandardNodeMaterial({
      color: 0x1c2028,
      roughness: 0.55
    });
    const helmetMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf4f7fb,
      emissive: 0x181c22,
      roughness: 0.22,
      metalness: 0.25
    });

    const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
    wheelTorusGeo.rotateY(Math.PI * 0.5);
    const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
    rimTorusGeo.rotateY(Math.PI * 0.5);

    // the front wheel, fork & handlebar turn about the head tube
    const steerPivot = new THREE.Group();
    steerPivot.position.set(0, 0, 0.5);
    leanPivot.add(steerPivot);
    const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    frontWheel.position.set(0, 0.38, 0.08);
    steerPivot.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    rearWheel.position.set(0, 0.38, -0.58);
    leanPivot.add(rearWheel);

    // Rear red LED safety strobe on seatpost
    const tailLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
    );
    tailLed.position.set(0, 0.86, -0.32);
    leanPivot.add(tailLed);

    const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
    topTube.rotation.x = Math.PI * 0.46;
    topTube.position.set(0, 0.78, 0.04);
    leanPivot.add(topTube);

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
    downTube.rotation.x = Math.PI * 0.28;
    downTube.position.set(0, 0.58, 0.16);
    leanPivot.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
    seatTube.rotation.x = -0.22;
    seatTube.position.set(0, 0.66, -0.22);
    leanPivot.add(seatTube);

    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
    saddle.rotation.x = Math.PI * 0.5;
    saddle.scale.set(1.15, 1.0, 0.55);
    saddle.position.set(0, 0.96, -0.28);
    leanPivot.add(saddle);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
    fork.rotation.x = -0.24;
    fork.position.set(0, 0.68, -0.02);
    steerPivot.add(fork);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
    handlebar.rotation.z = Math.PI * 0.5;
    handlebar.position.set(0, 0.98, -0.1);
    steerPivot.add(handlebar);

    // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.98, -0.28),
      bars: new THREE.Vector3(0, 0.98, 0.4),
      gripHalf: 0.22,
      bracket: new THREE.Vector3(0, 0.34, -0.145),
      crankLength: 0.17
    };
    const crankPivot = new THREE.Group();
    crankPivot.position.copy(bikeFrame.bracket);
    const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
    const pedals: THREE.Mesh[] = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.x = side > 0 ? 0 : Math.PI;
      const crank = new THREE.Mesh(crankGeo, chromeMat);
      crank.position.x = side * 0.065;
      const pedal = new THREE.Mesh(pedalGeo, tireMat);
      pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
      arm.add(crank, pedal);
      crankPivot.add(arm);
      pedals.push(pedal);
    }
    leanPivot.add(crankPivot);

    // Skinned rider (see pedestrians.ts), posed every frame with its hands on the grips and feet on the pedals; the
    // helmet rides on its head
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
    helmet.scale.set(0.95, 0.68, 1.28);
    this.scene.add(helmet);

    const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
    bikeShadowGeo.rotateX(-Math.PI * 0.5);
    const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
    bikeShadow.position.set(0, 0.02, 0.0);
    bikeShadow.renderOrder = 998;
    root.add(bikeShadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
    headLight.position.set(0, 1.32, 0.62);
    headLight.target.position.set(0, 0.0, 7.6);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);

    return {
      type: 'cyclist',
      label: LABELS.cyclist,
      mesh: root,
      leanPivot,
      frameMeshes: [topTube, downTube, seatTube],
      look: { color: 0x0078e8 },
      steerPivot,
      frontWheel,
      rearWheel,
      shadow: bikeShadow,
      crankPivot,
      pedals,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      headLight,
      position: new THREE.Vector3(SPAWN.cyclist.x, 0.0, SPAWN.cyclist.z),
      heading: SPAWN.cyclist.heading,
      speed: 0,
      vx: 0,
      vz: 0,
      leanAngle: 0,
      pedalPhase: 0,
      // its wheels (m: radius, the rear's & front's centres along it, the fork's rake, its travel)
      wheelSpots: { radius: 0.38, rear: -0.58, front: 0.58, caster: 0.3, travel: 0.1 }, // (its travel: the tyres' give)
      standLean: 0.12, // rad it leans on its kickstand
      steerInput: 0,
      shoved: 0,
      vehicle: null, // its body in Jolt while it is ridden, or sliding along after its rider was thrown off (`loose`)
      loose: false,
      fallen: false, // lying on its side where it came to rest (its pose in bodyOut)
      restTime: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
      chaseDistance: 4.8,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 5. MOTO (ITALIKA FT150, js/models/motos, WITH ITS RIDER)
  // =========================================================================
  createMotoEntity(): MotoEntity {
    const model = PLAYER_MOTO;
    const root = new THREE.Group();
    root.name = 'PlayerMoto';
    // everything leans with the rider about the tyres' contact line
    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const paintMat = createCarPaintMaterial(model.paints?.[0]);
    const blackMat = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.7 });
    const engineMat = new THREE.MeshStandardNodeMaterial({ color: 0x5a5f66, roughness: 0.45, metalness: 0.6 });
    const chromeMat = new THREE.MeshStandardNodeMaterial({ color: 0xdfe6ee, roughness: 0.14, metalness: 0.85 });
    const tyreMat = new THREE.MeshStandardNodeMaterial({ color: 0x17191c, roughness: 0.62 });
    const helmetMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1c20, roughness: 0.25, metalness: 0.3 });

    // 17 in wheels (0.29 m tyre radius) 1.32 m apart, spoked rims
    const tyreGeo = new THREE.TorusGeometry(0.255, 0.05, 12, 28).rotateY(Math.PI * 0.5);
    const rimGeo = new THREE.TorusGeometry(0.2, 0.014, 6, 24).rotateY(Math.PI * 0.5);
    const spokeGeo = new THREE.BoxGeometry(0.012, 0.4, 0.012);
    const wheel = (z: number) => {
      const w = new THREE.Mesh(tyreGeo, tyreMat);
      w.add(new THREE.Mesh(rimGeo, chromeMat));
      for (let i = 0; i < 3; i++) {
        const spoke = new THREE.Mesh(spokeGeo, chromeMat);
        spoke.rotation.x = (i * Math.PI) / 3;
        w.add(spoke);
      }
      w.position.set(0, 0.29, z);
      return w;
    };
    const rearWheel = wheel(-0.66);
    leanPivot.add(rearWheel);
    // the front wheel & fork turn about the steering head
    const steerPivot = new THREE.Group();
    steerPivot.position.set(0, 0, 0.5);
    leanPivot.add(steerPivot);
    const frontWheel = wheel(0.16);
    steerPivot.add(frontWheel);
    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), chromeMat);
      fork.rotation.x = -0.42;
      fork.position.set(side * 0.085, 0.62, 0.02);
      steerPivot.add(fork);
    }
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.68, 8).rotateZ(Math.PI * 0.5), blackMat);
    bars.position.set(0, 1.04, -0.1);
    steerPivot.add(bars);
    const headlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.1, 14).rotateX(Math.PI * 0.5),
      new THREE.MeshBasicNodeMaterial({ color: 0xf6f3e6 }));
    headlamp.position.set(0, 0.93, 0.12);
    steerPivot.add(headlamp);

    // engine, tank, seat, tail, exhaust, frame
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.4), engineMat);
    engine.position.set(0, 0.42, 0.02);
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.24, 6, 12).rotateX(Math.PI * 0.5), paintMat);
    tank.scale.set(1.0, 0.72, 1);
    tank.position.set(0, 0.9, 0.24);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.62), blackMat);
    seat.position.set(0, 0.86, -0.32);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.34), paintMat);
    tail.position.set(0, 0.8, -0.72);
    tail.rotation.x = -0.18;
    const sideCover = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), paintMat);
    sideCover.position.set(0, 0.66, -0.3);
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8), blackMat);
    frame.rotation.x = Math.PI * 0.5 + 0.55;
    frame.position.set(0, 0.68, 0.2);
    const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.62), blackMat);
    swingarm.position.set(0.12, 0.32, -0.36);
    swingarm.rotation.x = 0.1;
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.62, 10).rotateX(Math.PI * 0.5 - 0.12), chromeMat);
    exhaust.position.set(-0.16, 0.36, -0.46);
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 }));
    tailLight.position.set(0, 0.86, -0.9);
    const pegs = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6).rotateZ(Math.PI * 0.5), chromeMat);
    pegs.position.set(0, 0.36, -0.05);
    leanPivot.add(engine, tank, seat, tail, sideCover, frame, swingarm, exhaust, tailLight, pegs);

    // where the rider's hands, seat & feet go (pedestrians.ts PersonRig.ride: a crank of no length is a footpeg)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.84, -0.3),
      bars: new THREE.Vector3(0, 1.04, 0.38),
      gripHalf: 0.31,
      bracket: new THREE.Vector3(0, 0.36, -0.07),
      crankLength: 0.001
    };
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 21.4, scale: 1.0, girth: 1.02, hair: 0.1 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), helmetMat);
    helmet.scale.set(0.95, 0.95, 1.1);
    this.scene.add(helmet);

    const shadowGeo = new THREE.PlaneGeometry(0.8, 2.2);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    shadow.position.y = 0.02;
    shadow.renderOrder = 998;
    root.add(shadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 34, 0.36, 0.7, 1.25);
    headLight.position.set(0, 0.93, 0.68);
    headLight.target.position.set(0, 0.0, 9);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);
    return {
      type: 'moto',
      label: model.name,
      model,
      look: { model: model.id, paint: paintsOf(model)[0] },
      paintMeshes: [tank, tail, sideCover],
      shadow,
      spec: buildSpec(model),
      drive: null,
      mesh: root,
      leanPivot,
      steerPivot,
      frontWheel,
      rearWheel,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      headLight,
      position: new THREE.Vector3(SPAWN.moto.x, 0.0, SPAWN.moto.z),
      heading: SPAWN.moto.heading,
      speed: 0,
      vx: 0,
      vz: 0,
      leanAngle: 0,
      wheelSpots: { radius: 0.29, rear: -0.66, front: 0.66, caster: 0.44, travel: 0.15 },
      standLean: 0.16, // rad it leans on its side stand
      steerInput: 0,
      shoved: 0,
      vehicle: null, // its body in Jolt while it is ridden, or sliding along after its rider was thrown off (`loose`)
      loose: false,
      fallen: false, // lying on its side where it came to rest (its pose in bodyOut)
      restTime: 0,
      halfW: 0.4,
      halfL: 1.0,
      cameraTargetOffset: new THREE.Vector3(0, 1.3, 0),
      chaseDistance: 5.0,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 4. HELICOPTER (3D LOFTED SIGHTSEEING TWIN-TURBINE CHOPPER)
  // =========================================================================
  createHelicopterEntity(): HelicopterEntity {
    const root = new THREE.Group();
    root.name = 'PlayerHelicopter';

    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const heliLoftMat = createLoftedHelicopterMaterial();
    const blurDiscMat = new THREE.MeshBasicNodeMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
    const heliBodyGeo = buildHelicopterBodyGeometry();
    const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
    heliBodyMesh.castShadow = true;
    heliBodyMesh.receiveShadow = true;
    tiltPivot.add(heliBodyMesh);

    // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
    const mainRotorPivot = new THREE.Group();
    mainRotorPivot.position.set(0, 2.66, -0.35);
    const mainRotorGeo = buildHelicopterMainRotorGeometry();
    const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
    mainRotorMesh.castShadow = true;
    mainRotorPivot.add(mainRotorMesh);

    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
    mainRotorPivot.add(blurDisc);
    tiltPivot.add(mainRotorPivot);

    // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
    const tailRotorPivot = new THREE.Group();
    tailRotorPivot.position.set(0.18, 2.02, -5.62);
    const tailRotorGeo = buildHelicopterTailRotorGeometry();
    const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
    tailRotorPivot.add(tailRotorMesh);
    tiltPivot.add(tailRotorPivot);

    // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
    );
    navRed.position.set(-1.09, 1.54, -4.35);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
    );
    navGreen.position.set(1.09, 1.54, -4.35);
    const navTail = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
    );
    navTail.position.set(0, 2.84, -6.04);
    tiltPivot.add(navRed, navGreen, navTail);

    this.scene.add(root);

    return {
      type: 'helicopter',
      label: LABELS.helicopter,
      mesh: root,
      tiltPivot,
      mainRotorPivot,
      tailRotorPivot,
      position: new THREE.Vector3(SPAWN.helicopter.x, 96, SPAWN.helicopter.z),
      heading: START.heading + 0.62,
      speed: 0,
      verticalSpeed: 0,
      pitchAngle: 0,
      rollAngle: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 11.4,
      chaseHeight: 3.3
    };
  }

  // On a raised curb island (city-config.ts BLOCKS: the real blocks, malls & plazas), not in a park
  isPointOnSidewalk(x: number, z: number): boolean {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6 && !b.median);
  }

  // Into (a room: { minX, maxX, minZ, maxZ, floorAt(x, z, fromY), colliders }) or out of (null) an interior
  setInterior(room: PlayerRoom | null | undefined): void {
    this.interior = room ?? null;
  }

  getGroundHeight(x: number, z: number, mode: PlayerMode = 'person', fromY?: number): number {
    const room = this.interior;
    if (room && x >= room.minX && x <= room.maxX && z >= room.minZ && z <= room.maxZ) return room.floorAt(x, z, fromY);
    // the ground (ground.ts): the town's floor, the hills over it & the river channels cut into it (under a bridge
    // for a body coming from `fromY` down in the channel); everyone stands on it, a walker on the curbs over the
    // town's floor (unless a hill rises above them, or it is down in a channel). With `fromY`, a road bridge's deck
    // the body is on or reaches up a ramp, never one overhead (ground.ts deckLift; Infinity: the topmost)
    const ground = this.terrainAt ? this.terrainAt(x, z, fromY) : 0;
    const deck = this.deckAt && fromY !== undefined ? this.deckAt(x, z, fromY - ground) : 0;
    if (deck > 0) return ground + deck;
    if (mode === 'person') {
      const town = this.floorHeight(x, z);
      if (ground < town - 0.01) return ground;
      return town + Math.max(this.isPointOnSidewalk(x, z) ? ISLAND_BOUNDS.sidewalkHeight : 0.0, ground - town);
    }
    return ground;
  }

  // The town's floor under (x, z) (ground.ts townHeight: its slopes, 0 in the flat city), the helicopter's
  // altitudes are reckoned from
  floorHeight(x: number, z: number): number {
    return this.floorAt ? this.floorAt(x, z) : 0;
  }

  // The tilt of the ground under a body reaching `along` m ahead & behind and `across` m to either side of (x, z) facing
  // `heading`, into out: { pitch, roll } for its root (Euler order YXZ: the nose up is a negative pitch, three's sense)
  groundTilt(x: number, z: number, heading: number, along: number, across: number, out: { pitch: number; roll: number },
    y?: number): { pitch: number; roll: number } {
    out.pitch = out.roll = 0;
    if (!this.terrainAt) return out;
    const g = (px: number, pz: number) => this.getGroundHeight(px, pz, 'car', y); // (with y, a deck it is on)
    const fx = Math.sin(heading), fz = Math.cos(heading); // ahead; left is (fz, -fx)
    out.pitch = -Math.atan2(g(x + fx * along, z + fz * along) - g(x - fx * along, z - fz * along), 2 * along);
    out.roll = Math.atan2(g(x + fz * across, z - fx * across) - g(x - fz * across, z + fx * across), 2 * across);
    return out;
  }

  // The colliders whose bounds come within `r` of (x, z), in their original order. They never move, so they are
  // bucketed once into 48 m cells (tens of thousands of buildings: testing them all every frame cost ~0.5 ms)
  // Is ground point (x, z) inside a building below `height`? (Things thrown about by knock-downs, mayhem.ts)
  // (`minSize` m: leave out what is narrower than that both ways, the poles and bollards a walker steps round)
  isSolidAt(x: number, z: number, height = 1.5, ground = 0, minSize = 0): boolean {
    for (const c of this.nearColliders(x, z, 0)) {
      // (only what stands between the ground there, a hill's or the street's, and `height` over it)
      if ((c.minY ?? 0) > ground + height || (c.maxY ?? Infinity) <= ground || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (minSize > 0 && (c.obb ? Math.max(c.obb.hx, c.obb.hz) * 2 : Math.max(c.maxX - c.minX, c.maxZ - c.minZ)) < minSize) continue;
      if (!c.obb) return true;
      // the box's own frame: world = c + R_y(θ)·local, so local = R_y(−θ)·(p − c)
      const { cx, cz, hx, hz, cs, sn } = c.obb;
      const dx = x - cx, dz = z - cz;
      if (Math.abs(dx * cs - dz * sn) <= hx && Math.abs(dx * sn + dz * cs) <= hz) return true;
    }
    return false;
  }

  nearColliders(x: number, z: number, r: number): PlayerCollider[] {
    const CELL = 48;
    const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);
    if (!this._colliderCells) {
      const cells = new Map<number, PlayerCollider[]>();
      this._colliderCells = cells;
      this.colliders.forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = cells.get(k);
            if (!list) cells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp || c.broken) continue; // (a sign post knocked down, sim/mayhem.ts)
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    for (const left of this.leftCars) {
      const k = left.collider;
      if (k.maxX >= x - r && k.minX <= x + r && k.maxZ >= z - r && k.minZ <= z + r) out.push(k);
    }
    // (an interior's walls & furniture: after the city's, which never come near it)
    if (this.interior) {
      for (const k of this.interior.colliders) {
        if (k.maxX >= x - r && k.minX <= x + r && k.maxZ >= z - r && k.minZ <= z + r) {
          k._order ??= 1e9;
          out.push(k);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => (a._order ?? 0) - (b._order ?? 0)); // (every one has its order by now)
    return out;
  }

  // The detailed city's edges and its shore (the helicopter may roam out beyond them): `pos` pulled back inside them.
  // Whether it was outside
  keepInBounds(pos: { x: number; z: number }): boolean {
    const x = pos.x, z = pos.z;
    const heli = this.activeMode === 'helicopter';
    const m = heli ? 6000 : 0;
    pos.x = Math.max(ISLAND_BOUNDS.minX - m, Math.min(ISLAND_BOUNDS.maxX + m, pos.x));
    pos.z = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + m, pos.z));
    if (!heli) {
      const shore = getIslandBoundsAtZ(pos.z);
      pos.x = Math.max(shore.westX + 8.0, Math.min(shore.eastX - 8.0, pos.x));
    }
    return pos.x !== x || pos.z !== z;
  }

  // Pushes `pos` out of the buildings around it: a body of `radius`, or with `carEntity` the car's footprint turned to
  // its heading (the teleports' clearance; the car itself collides in Jolt, car-physics.ts); `entity`'s hits reported
  resolveHorizontalCollision(pos: THREE.Vector3, radius: number, carEntity: CarEntity | null = null, entity: PlayerEntity | null = carEntity): void {
    const heli = this.activeMode === 'helicopter';
    this.keepInBounds(pos);

    const body = collisionBody(this.activeMode, radius, carEntity ? carEntity.heading : 0, 0, carEntity);
    const { sin: sinH, cos: cosH, extX, extZ } = body;
    const contact = this._buildingContact ??= { nx: 0, nz: 0, depth: 0 };

    const reach = Math.max(extX, extZ) + 6;
    let gx = pos.x;
    let gz = pos.z;
    let near = this.nearColliders(gx, gz, reach);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (buildingContact(c, pos.x, pos.y, pos.z, body, contact)) {
        const { nx, nz, depth } = contact;
        pos.x += nx * depth;
        pos.z += nz * depth;

        if (this._collisionListener && entity && entity.type !== 'person') {
          const sin = carEntity ? sinH : Math.sin(entity.heading);
          const cos = carEntity ? cosH : Math.cos(entity.heading);
          const approachSpeed = -((sin * entity.speed + (entity.vx || 0)) * nx + (cos * entity.speed + (entity.vz || 0)) * nz);
          const support = carEntity ? Math.abs(nx * cos - nz * sin) * body.hx + Math.abs(nx * sin + nz * cos) * body.hz : radius;
          this.reportCollision(entity, c, 'building', pos.x - nx * support, pos.y + (heli ? 1.1 : 0.56), pos.z - nz * support,
            nx, 0, nz, approachSpeed);
        }

        // A push that carried it far from where the candidates were gathered (dropped inside a building): gather
        // them again around where it is now, carrying on in the same order
        if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
          gx = pos.x;
          gz = pos.z;
          const order = c._order;
          near = this.nearColliders(gx, gz, reach);
          i = -1;
          while (i + 1 < near.length && (near[i + 1]._order ?? 0) <= (order ?? 0)) i++;
        }
      }
    }
  }

  // Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
  // where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
  // pedals, helmet on its head
  poseCharacters(dt: number): void {
    const p = this.entities.person;
    if (this.activeMode === 'person') {
      const air = p.position.y - this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
      // (a ragdoll's pose is its own, sim/ragdolls.ts)
      if (!p.ragdoll) p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0);
      p.crowd.begin();
      p.crowd.add(p.rig, 0);
      p.crowd.end();
    }

    const m = this.entities.moto;
    if (this.activeMode === 'moto') {
      // the moto's rider: feet on the pegs (a crank of no length), hands on the bars
      m.riderRig.ride(m.leanPivot, 0, m.bikeFrame);
      m.riderCrowd.begin();
      m.riderCrowd.add(m.riderRig, 0);
      m.riderCrowd.end();
      const { headQuaternion, headPosition } = m.riderRig; // (ride() has just set them)
      if (headQuaternion && headPosition) {
        m.helmet.quaternion.copy(headQuaternion);
        m.helmet.position.set(0, 0.16, 0).applyQuaternion(m.helmet.quaternion).add(headPosition);
      }
    }

    const b = this.entities.cyclist;
    if (this.activeMode !== 'cyclist') return;
    b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
    b.riderCrowd.begin();
    b.riderCrowd.add(b.riderRig, 0);
    b.riderCrowd.end();
    const { headQuaternion, headPosition } = b.riderRig;
    if (!headQuaternion || !headPosition) return;
    b.helmet.quaternion.copy(headQuaternion);
    b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(headPosition);
  }

  // The ground at (x, z) (ground.ts groundHeight: the hills over the town's floor, the river channels cut into it), for
  // where everyone stands, the town's floor alone (townHeight), and the land without the channels (landHeight) for the
  // slopes the player can't climb (a channel's banks are climbed out of, whatever their pitch). The vehicles left
  // standing are set on it (they were built at y = 0)
  // `deck(x, z, over)`: the lift of a bridge's deck at (x, z) a body `over` m over the ground reaches (ground.ts deckLift)
  setTerrain(ground: GroundQuery | null, floor: ((x: number, z: number) => number) | null = null,
    land: ((x: number, z: number) => number) | null = null, deck: ((x: number, z: number, over: number) => number) | null = null): void {
    this.terrainAt = typeof ground === 'function' ? ground : null;
    this.floorAt = typeof floor === 'function' ? floor : null;
    this.landAt = typeof land === 'function' ? land : null;
    this.deckAt = typeof deck === 'function' ? deck : null;
    for (const mode of ['person', 'car', 'cyclist', 'moto'] as const) {
      const e = this.entities[mode];
      e.position.y = this.getGroundHeight(e.position.x, e.position.z, mode);
      this.settle(e);
    }
  }

  // The hills: on foot the player scrambles up them as steep as 1:1 (rise over run; a step up anything steeper is
  // undone); the helicopter can't sink into one. (The vehicles climb what their tyres can, in Jolt)
  keepOffHills(entity: PlayerEntity, prevX: number, prevZ: number): void {
    if (!this.terrainAt) return;
    if (this.activeMode === 'helicopter' && entity.type === 'helicopter') {
      const h = this.terrainAt(entity.position.x, entity.position.z);
      if (entity.position.y < h + 1.5) {
        entity.position.y = h + 1.5;
        if (entity.verticalSpeed < 0) entity.verticalSpeed = 0;
      }
      return;
    }
    const hill = this.landAt ?? this.terrainAt;
    const run = Math.hypot(entity.position.x - prevX, entity.position.z - prevZ);
    const rise = hill(entity.position.x, entity.position.z) - hill(prevX, prevZ);
    if (run > 1e-4 && rise > run) {
      // back where it was, and down on the ground there again (unless it is in the air, a jump), its speed bouncing back
      const onGround = entity.position.y <= this.getGroundHeight(entity.position.x, entity.position.z, this.activeMode, entity.position.y) + 0.02;
      entity.position.x = prevX;
      entity.position.z = prevZ;
      if (onGround) entity.position.y = this.getGroundHeight(prevX, prevZ, this.activeMode, entity.position.y);
      entity.speed *= -0.25;
    }
  }

  update(dt: number, elapsed: number): void {
    const heli = this.entities.helicopter;
    // the rotor winds up in a few seconds with the pilot aboard and runs down once parked
    const flying = this.activeMode === 'helicopter';
    this.rotorSpin += ((flying ? 24 : 0) - this.rotorSpin) * Math.min(1, dt * (flying ? 1.6 : 0.5));
    heli.mainRotorPivot.rotation.y += dt * this.rotorSpin;
    heli.tailRotorPivot.rotation.x += dt * this.rotorSpin * 1.33;
    const active = this.getActiveEntity();
    const prevX = active.position.x;
    const prevZ = active.position.z;

    if (this.activeMode === 'person') {
      this.updatePerson(dt);
    } else {
      // The pedestrian rides along (out of sight) in the vehicle it got into
      const p = this.entities.person;
      p.position.copy(active.position);
      p.heading = active.heading;
      p.speed = 0;
    }
    // A bicycle left standing leans on its kickstand
    const bike = this.entities.cyclist;
    // ...and a moto on its side stand (one fallen over, or still sliding along on its side, lies as it is)
    const moto = this.entities.moto;
    for (const two of (this._twoWheelers ??= [bike, moto])) {
      if (this.activeMode !== two.type && !two.vehicle && !two.fallen) two.leanPivot.rotation.z = two.leanAngle = two.standLean;
    }

    // (the mode this frame began in: a driver thrown out mid-frame is not stepped again on foot)
    const mode = this.activeMode;
    if (mode === 'helicopter') this.updateHelicopter(dt, elapsed);
    // The car, the moto and the bicycle are bodies in Jolt (car-physics.ts): their drives set, the world steps once
    // (the people thrown about with them), and where it left them is read back. The car stands (or rolls on, its driver
    // thrown out) with nobody in it
    this.driveCar(dt, mode === 'car');
    this.driveTwoWheeler(moto, dt, mode === 'moto');
    this.driveTwoWheeler(bike, dt, mode === 'cyclist');
    this.stepVehicles(dt);
    this.carMoved(dt, mode === 'car');
    this.twoWheelerMoved(moto, dt, mode === 'moto');
    this.twoWheelerMoved(bike, dt, mode === 'cyclist');
    // (the vehicles meet the hills in Jolt: a slope their tyres can't climb, they can't)
    if (mode === 'person' || mode === 'helicopter') this.keepOffHills(active, prevX, prevZ);
    if (this.activeMode === 'car' && active.type === 'car') this.recordVelocity(active);
    this.updateSmoke(dt);

    for (const e of Object.values(this.entities)) {
      e.mesh.position.copy(e.position);
      e.mesh.rotation.y = e.heading;
    }
    // the vehicles as their bodies lie, pitched, rolled, leant over, on a roof or a side (carMoved, twoWheelerMoved),
    // driven or not; a moto or bicycle once it has come to rest on its side
    for (const e of (this._bodied ??= [this.entities.car, moto, bike])) {
      const q = e.type === 'car' || e.vehicle || e.fallen ? e.bodyOut : null;
      if (!q) continue;
      e.mesh.rotation.order = 'YXZ'; // (so its Euler y is its heading, as for the other entities)
      e.mesh.quaternion.set(q.qx, q.qy, q.qz, q.qw);
    }
    // the walker's contact shadow lies on the slope under it
    if (this.activeMode === 'person') {
      const p = this.entities.person;
      const t = this.groundTilt(p.position.x, p.position.z, p.heading, 0.45, 0.45, (this._tilt ??= { pitch: 0, roll: 0 }), p.position.y);
      p.shadow.rotation.set(t.pitch, 0, t.roll, 'YXZ');
    }

    // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
    const glow = cityUniforms.uInteriorGlow.value;
    const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
    const car = this.entities.car;
    for (const spot of car.headLights) {
      // Accelerating does not change the headlamp output or range.
      spot.intensity = HEADLIGHTS.intensity * beamScale;
    }
    const bikeActive = this.activeMode === 'cyclist';
    bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
    moto.headLight.intensity = this.activeMode === 'moto' ? 260 * beamScale : 0;

    this.poseCharacters(dt);
  }

  updatePerson(dt: number): void {
    const p = this.entities.person;
    if (p.ragdoll) {
      this.followRagdoll(p);
      return;
    }
    const wading = this.waterAt ? Math.min(0.6, this.waterAt(p.position.x, p.position.z) * 1.3) : 0;
    const maxWalk = (this.keys.boost && this.canSprint ? 8.2 : 4.4) * (1 - wading);
    const turnRate = 2.6;

    let targetSpeed = 0;
    let targetStrafe = 0;
    if (this.aiming) {
      // aiming (player/aim.ts): the mouse turns the player, A / D step sideways, all at a walk
      const ahead = (Number(this.keys.forward) || 0) - (Number(this.keys.backward) || 0);
      const side = (Number(this.keys.right) || 0) - (Number(this.keys.left) || 0);
      const k = AIM_WALK / Math.max(1, Math.hypot(ahead, side));
      targetSpeed = ahead * k;
      targetStrafe = side * k;
    } else {
      if (this.keys.forward) targetSpeed = maxWalk * Number(this.keys.forward);
      else if (this.keys.backward) targetSpeed = -maxWalk * 0.65 * Number(this.keys.backward);

      if (this.keys.left) p.heading += turnRate * dt * Number(this.keys.left);
      if (this.keys.right) p.heading -= turnRate * dt * Number(this.keys.right);
    }

    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);
    p.strafe = (p.strafe || 0) + (targetStrafe - (p.strafe || 0)) * Math.min(1, dt * 10);

    // (to the right is (-cos, sin) of the heading)
    p.position.x += (Math.sin(p.heading) * p.speed - Math.cos(p.heading) * p.strafe) * dt;
    p.position.z += (Math.cos(p.heading) * p.speed + Math.sin(p.heading) * p.strafe) * dt;
    this.resolveHorizontalCollision(p.position, 0.48);

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    if (this.keys.up && p.position.y <= groundY + 0.02) {
      p.verticalVel = 5.2;
    }
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < groundY) {
      p.position.y = groundY;
      p.verticalVel = 0;
    }
  }

  // The car: a rigid body on its sprung wheels in Jolt Physics (car-physics.ts, set up by main.ts before the first
  // frame). Before the world's step (stepVehicles): what the traffic did to it since the last one carried over, and
  // drivetrain.ts's drive for its tyres. Not `driving`, it stands (or rolls on, its driver thrown out) on its own
  driveCar(dt: number, driving: boolean): void {
    const c = this.entities.car;
    const P = this.carPhysics;
    if (!P) return;
    const spec = c.spec;
    const d = (c.drive ??= createDriveState(spec));
    const dmg = c.damage;
    // what hit it since the last frame (the traffic and the street furniture push it about after it has moved); with
    // nobody in it, nothing to compare with when someone gets back in
    if (driving) this.checkImpact(c);
    else c.impactArmed = false;

    const throttle = driving ? Number(this.keys.forward) || 0 : 0;
    const brake = driving ? Number(this.keys.backward) || 0 : 0;
    const handbrake = driving && Boolean(this.keys.handbrake);
    const shift = driving ? this.gearKeys(c, d) : 0;

    const sn0 = Math.sin(c.heading), cs0 = Math.cos(c.heading);
    if (!c.vehicle || c.physicsLook !== c.look) {
      if (c.vehicle) P.remove(c.vehicle);
      c.vehicle = P.add(this.carBodyDef(c, spec), c.position.x, c.position.y, c.position.z, c.heading);
      c.physicsLook = c.look;
      c.physicsPlaced = false;
    }
    const v = c.vehicle;
    const out = (c.bodyOut ??= { x: 0, z: 0, vx: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
    if (!c.physicsPlaced) {
      // set down where it stands (on the kerb if it is on one: the ground Jolt is given), moving as it was
      const y = this.getGroundHeight(c.position.x, c.position.z, 'person', c.position.y + 0.5);
      P.place(v, c.position.x, y, c.position.z, c.heading);
      P.shove(v, sn0 * c.speed + c.vx, 0, cs0 * c.speed + c.vz, 0, 0, 0);
      c.physicsPlaced = true;
    } else if (driving) {
      // the traffic's shove (traffic.ts collideWithPlayer moves the car and changes its velocity, spin & sway)
      const dvx = sn0 * c.speed + c.vx - out.vx, dvz = cs0 * c.speed + c.vz - out.vz;
      const pitch = (c.pitchVel || 0) * 0.35, roll = (c.rollVel || 0) * 0.35;
      // (the sway about the car's own axes: its left (cos h, 0, -sin h) and its nose (sin h, 0, cos h))
      P.shove(v, dvx, Math.min(1.5, (c.heaveVel || 0) * 0.3), dvz,
        cs0 * pitch + sn0 * roll, c.angularVel || 0, -sn0 * pitch + cs0 * roll,
        c.position.x - out.x, c.position.z - out.z);
    }
    c.angularVel = c.pitchVel = c.rollVel = c.heaveVel = 0;

    const u = P.read(v).forward;
    const input: DriveInput = (c.driveInput ??= {});
    input.throttle = throttle;
    input.brake = brake;
    input.handbrake = false; // (Jolt's own: it locks the rear wheels)
    input.nitro = driving && Boolean(this.keys.boost);
    input.shift = shift;
    input.slope = 0; // (gravity is Jolt's)
    // in a flood: over ~0.55 m the water is in the air intake and the engine dies until it is out of it
    const water = this.waterAt && !c.flying ? this.waterAt(c.position.x, c.position.z) : 0;
    c.drowned = water > 0.55;
    input.power = c.drowned ? 0 : enginePower(dmg);
    input.grip = this.roadGrip * (water > 0.15 ? 0.75 : 1);
    const force = this.driveForce(d, spec, input, u, water, dt);

    let steerInput = 0;
    if (driving && this.keys.left) steerInput = Number(this.keys.left);
    if (driving && this.keys.right) steerInput = -Number(this.keys.right);
    // speed-sensitive steering: the wheels turn less the faster it goes; a bent front corner pulls it to one side
    const lock = spec.steerLock / (1 + Math.abs(u) / 16);
    c.steerAngle += (steerInput * lock - c.steerAngle) * Math.min(1, dt * 10);
    const steer = c.steerAngle + dmg.pull * Math.min(1, Math.abs(u) / 5);

    const body = v.out;
    const before = (c.before ??= { vx: 0, vy: 0, vz: 0 });
    before.vx = body.vx; before.vy = body.vy; before.vz = body.vz;
    const speed = Math.hypot(body.vx, body.vy, body.vz);
    const go = (v.input ??= { force: 0 });
    go.force = force;
    go.airDrag = 0.5 * 1.2 * spec.dragArea * speed * speed;
    go.steer = Math.max(-1, Math.min(1, -steer / spec.steerLock)); // (Jolt's: +1 full right)
    go.handbrake = handbrake;
    go.hold = !throttle && !brake && Math.abs(u) < 0.5;
    go.grip = spec.grip * input.grip;
    go.spinning = d.wheelspin;
    const frame = (c.frame ??= { throttle: 0, steer: 0, water: 0 });
    frame.throttle = throttle;
    frame.steer = steer;
    frame.water = water;
  }

  // drivetrain.ts's step for a vehicle moving at `u` m/s along itself, as the force (N) that makes it: its drive and
  // what slows it, and the water's drag on it pushing through a flood (its depth & the speed squared)
  driveForce(d: DriveState, spec: DriveSpec, input: DriveInput, u: number, water: number, dt: number): number {
    let next = stepDrive(d, spec, input, u, dt);
    if (water > 0.03) next -= Math.sign(next) * Math.min(Math.abs(next), 0.09 * Math.min(water, 1) * next * next * dt + water * 2.5 * dt);
    return spec.mass * (next - u) / dt;
  }

  // One step of Jolt's world (the car, the moto, the people thrown about), the walls fed in round the player
  stepVehicles(dt: number): void {
    const P = this.carPhysics;
    if (!P) return;
    const focus = (this._physicsFocus ??= { x: 0, y: 0, z: 0 });
    const at = this.getActiveEntity().position;
    focus.x = at.x;
    focus.y = at.y;
    focus.z = at.z;
    P.step(dt, focus);
  }

  // Where Jolt's step left vehicle `ent` (the car or the moto, its body `v`): held inside the map's edges and the shore,
  // as everyone is (keepInBounds), then its position, heading and velocity in the game's terms (speed along it, slip
  // across it), and its pose for its mesh
  followBody(ent: CarEntity | CyclistEntity | MotoEntity, v: PhysicsVehicle): VehicleOut {
    const o = v.out;
    const pos = (this._bodyBounds ??= { x: 0, z: 0 });
    pos.x = o.x;
    pos.z = o.z;
    if (this.keepInBounds(pos)) this.carPhysics?.confine(v, pos.x, pos.z, o.vx * 0.4, o.vz * 0.4);
    ent.position.set(o.x, o.y, o.z);
    ent.heading = o.heading;
    const sn = Math.sin(ent.heading), cs = Math.cos(ent.heading);
    ent.speed = o.vx * sn + o.vz * cs;
    ent.vx = o.vx - sn * ent.speed;
    ent.vz = o.vz - cs * ent.speed;
    ent.vy = o.vy;
    ent.flying = o.contacts === 0;
    const out = (ent.bodyOut ??= { x: 0, z: 0, vx: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
    out.x = o.x; out.z = o.z; out.vx = o.vx; out.vz = o.vz;
    out.qx = o.qx; out.qy = o.qy; out.qz = o.qz; out.qw = o.qw;
    return o;
  }

  // After the step: the car's body's pose, speed and wheels read back; a knock the body itself took is a crash
  carMoved(dt: number, driving: boolean): void {
    const c = this.entities.car;
    const v = c.vehicle;
    // (frame, drive & before: set by driveCar with the body)
    if (!v || !c.frame || !c.drive || !c.before) return;
    const { throttle, steer, water } = c.frame;
    const o = this.followBody(c, v);
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    const slip = Math.hypot(c.vx, c.vz);
    c.drifting = slip > 2.2 && Math.abs(c.speed) > 5 && !c.flying;

    // A crash: the body itself (not its tyres) struck something, a wall, a pole, a parked car or the ground (on its
    // roof), coming at it this fast
    const hit = o.hit;
    if (hit.speed > 1.5) {
      const hx = c.position.x - hit.nx * c.halfL * 0.9, hz = c.position.z - hit.nz * c.halfL * 0.9;
      // (it hurts whoever is in it: nobody, when it rolls on alone; a car of the traffic thrown about in Jolt, traffic.ts
      // crash, as hard as a car)
      const other = hit.other?.owner;
      if (driving) this.reportCollision(c, other || (this._wall ??= { type: 'building' }), other ? 'vehicle' : 'building', hx, c.position.y + 0.56, hz, hit.nx, 0, hit.nz, hit.speed);
      this.impactCar(c, hit.nx * hit.speed, hit.nz * hit.speed);
      c.cameraKick = Math.max(c.cameraKick || 0, Math.min(1, (hit.speed - 1.5) / 14)); // (cameras.ts speedEffects)
      if (hit.speed > 2.2) c.lastCollisionSpark = { x: hx, y: 0.56, z: hz, nx: hit.nx, nz: hit.nz, speed: hit.speed };
      // head on (what it hit faces its nose) and hard: out through the windscreen
      if (driving && hit.speed > EJECT_SPEED && hit.nx * sn + hit.nz * cs < -0.7) this.ejectDriver(c, c.before, hit.speed);
    }

    // the wheels: on their springs, steered, rolling
    o.wheels.forEach((w, i) => {
      const wheel = c.wheels[i] as CarWheel | undefined; // (Jolt's may outnumber the drawn ones)
      if (!wheel) return;
      wheel.steerPivot.position.y = w.y;
      wheel.tire.rotation.x = w.spin;
      if (wheel.isFront) wheel.steerPivot.rotation.y = steer;
    });
    this.carEffects(c, c.drive, c.damage, throttle, c.speed, slip, water, dt);
    // heavy rain washing its stains off (this.rain: main.ts, the rain falling, 0..1)
    if (c.bloody && c.blood && (this.rain || 0) > 0.35) {
      c.bloody = wash(c.stains, dt, this.rain);
      this.showBlood(c);
    }
  }

  // The brake lamps, and the smoke: the engine's once it is damaged (grey, then black), the tyres' when they slide or
  // spin, the spray off a wet road; `u` the car's speed along itself, `slip` across it (m/s)
  carEffects(c: CarEntity, d: DriveState, dmg: CarDamage, throttle: number, u: number, slip: number, water: number, dt: number): void {
    const braking = d.braking || (c.speed === 0 && !throttle) ? 1 : 0;
    if (c.carState) c.carState.value.x = braking;
    const lamps = c.kit?.lamps;
    if (lamps && lamps.array[0] !== braking) {
      lamps.array[0] = braking;
      lamps.needsUpdate = true;
    }
    const e = dmg.engine;
    if (e > 0.4) this.emitSmoke(c, 0, 0.95, (c.zFront || 2.2) - 0.75, dt * (e >= 1 ? 16 : (e - 0.4) * 22), e >= 0.85 ? 0.1 : 0.5 - e * 0.4, 0.9);
    if ((c.drifting || d.wheelspin) && Math.abs(u) > 1.5) {
      const rate = dt * (d.wheelspin ? 18 : Math.min(26, slip * 4));
      for (const side of [-0.75, 0.75]) this.emitSmoke(c, side, 0.18, -1.35, rate * 0.5, 0.86, 1.25);
    }
    // On a wet road the tyres throw up a spray behind them, more the faster it goes
    if (water > 0.05 && Math.abs(u) > 2) {
      const rate = dt * Math.min(30, Math.abs(u) * 2.2) * Math.min(1, water * 3);
      for (const side of [-0.95, 0.95]) this.emitSmoke(c, side, 0.2, 1.6, rate * 0.5, 0.78, 1.1);
    }
    if ((this.roadWet || 0) > 0.25 && !c.flying && Math.abs(u) > 6) {
      const rate = dt * Math.min(14, (Math.abs(u) - 6) * 0.9) * this.roadWet;
      for (const side of [-0.8, 0.8]) this.emitSmoke(c, side, 0.12, -1.5, rate * 0.5, 0.94, 0.8);
    }
  }

  // The driver thrown out through the windscreen at the car's speed before the crash (`v`: vx, vy, vz), from over the
  // bonnet, as a ragdoll; on foot from here, the car going on without them. main.ts hears of it (onEject: the HUD, the
  // harm)
  ejectDriver(c: CarEntity, v: { vx: number; vy: number; vz: number }, impact: number): void {
    const p = this.entities.person;
    if (!this.ragdolls || p.ragdoll) return;
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    const x = c.position.x + sn * c.halfL * 0.55, z = c.position.z + cs * c.halfL * 0.55;
    // lifted onto the bonnet's height: its feet at its top
    this.throwPlayer(x, z, c.heading, c.position.y + (c.bodyHeight || 1.45) * 0.55, false,
      { vx: v.vx * 0.9, vy: v.vy + 2.5, vz: v.vz * 0.9, spin: 5, bleed: 1 });
    this.onEject?.(impact, x, z, 'car');
  }

  // A moto's or bicycle's rider thrown off it (a crash `impact` m/s hard, or a fall at speed) as a ragdoll, from the
  // seat as they sat, going on at its speed and over the bars; it slides on alone, nobody balancing it
  // (twoWheelerMoved)
  ejectRider(m: CyclistEntity | MotoEntity, impact: number): void {
    const p = this.entities.person;
    if (!this.ragdolls || p.ragdoll || !m.vehicle) return;
    const o = m.vehicle.out;
    const k = Math.min(1, impact / 20);
    this.throwPlayer(m.position.x, m.position.z, m.heading, m.position.y, m.riderRig,
      { vx: o.vx * 0.95, vy: Math.max(0, o.vy) + 1.5 + 2.5 * k, vz: o.vz * 0.95, spin: 3 + 4 * k, bleed: Math.min(1, impact / 16) });
    this.carPhysics?.unseat(m.vehicle);
    m.loose = true;
    m.restTime = 0;
    this.onEject?.(impact, m.position.x, m.position.z, m.type);
  }

  // A moto or bicycle gone over at a crawl: its rider steps off it as it falls, on their feet, and it lies down on its
  // own
  stepOff(m: CyclistEntity | MotoEntity): void {
    const p = this.entities.person;
    const side = m.leanAngle > 0 ? 1 : -1; // (off on its high side: to its left when it falls to its right)
    const x = m.position.x + Math.cos(m.heading) * 0.8 * side, z = m.position.z - Math.sin(m.heading) * 0.8 * side;
    if (m.vehicle) this.carPhysics?.unseat(m.vehicle);
    m.loose = true;
    m.restTime = 0;
    this.setMode('person');
    this.resetInput();
    p.heading = m.heading;
    p.position.set(x, this.getGroundHeight(x, z, 'person', m.position.y + 1), z);
    this.settle(p);
    this.onEject?.(0, x, z, m.type);
  }

  // The player on foot at (x, z) facing `heading`, thrown as a ragdoll (sim/ragdolls.ts spawn's `thrown`): standing,
  // its feet lifted to `y`; or as `rider` (a PersonRig of the same build: a moto's or bicycle's rider, astride it) sits
  throwPlayer(x: number, z: number, heading: number, y: number, rider: PersonRig | false, thrown: ThrowOptions): void {
    const p = this.entities.person;
    const ragdolls = this.ragdolls;
    if (!ragdolls) return; // (its callers' check)
    this.setMode('person');
    this.resetInput();
    p.heading = heading;
    p.position.set(x, this.getGroundHeight(x, z, 'person', y + 1), z);
    p.rig.reset(x, z, heading, personGround, this);
    if (rider) p.rig.pose.set(rider.pose.subarray(0, 15 * 8));
    else for (let b = 0; b < 15; b++) p.rig.pose[b * 8 + 5] += y - p.position.y;
    p.ragdoll = ragdolls.spawn(p.rig, thrown);
    p.ragdollOwner = 'controllers';
  }

  // On foot as a ragdoll (thrown out of the car; or down, crime.ts): the camera follows the body; one thrown out gets up
  // once it has lain still a while
  followRagdoll(p: PersonEntity): void {
    const h = p.ragdoll;
    if (!h) return; // (only while it is one)
    p.position.set(h.px, this.getGroundHeight(h.px, h.pz, 'person', h.py), h.pz);
    p.speed = 0;
    if (p.ragdollOwner !== 'controllers' || h.rest < GET_UP) return;
    this.getUp();
    this.settle(p); // (on its feet where it lay)
  }

  // The player's body (sim/ragdolls.ts) let go of: on its feet again, wherever it is put next
  getUp(): void {
    const p = this.entities.person;
    if (!p.ragdoll) return;
    this.ragdolls?.release(p.ragdoll);
    p.ragdoll = null;
  }

  // Jolt's vehicles (car-physics.ts), from main.ts before the game starts
  setCarPhysics(physics: CarPhysics | null | undefined): void {
    this.carPhysics = physics ?? null;
    this.entities.car.vehicle = null;
    this.entities.moto.vehicle = null;
  }

  // What the car's body is: its model's mass, its footprint & height, its wheels where they stand on the body, and
  // springs & anti-roll bars by its class (trucks & SUVs soft and leaning, sports cars & supercars flat)
  carBodyDef(c: CarEntity, spec: DriveSpec): CarBodyDef {
    const [springHz, roll] = suspensionOf(spec.cls);
    const height = c.bodyHeight || 1.45;
    return {
      kind: 'car', mass: spec.mass, halfW: c.halfW, halfL: c.halfL, height, cg: height * (c.kit?.wheels ? 0.4 : 0.36),
      steerLock: spec.steerLock, drive: spec.drive, springHz, roll,
      wheels: c.wheels.map((w) => ({
        x: w.steerPivot.position.x, z: w.steerPivot.position.z, radius: (w.restY ??= w.steerPivot.position.y), front: w.isFront
      }))
    };
  }

  // E / Q shift (and switch to the manual gearbox), T goes back and forth between automatic and manual: the shift
  // this frame (+1, -1 or 0), from the keys' presses (not their holding)
  gearKeys(ent: CarEntity | MotoEntity, d: DriveState): number {
    const held = (ent.heldKeys ??= { shiftUp: false, shiftDown: false, gearbox: false });
    const pressed = (key: keyof HeldGearKeys) => {
      const now = Boolean(this.keys[key]);
      const edge = now && !held[key];
      held[key] = now;
      return edge;
    };
    const shift = (pressed('shiftUp') ? 1 : 0) - (pressed('shiftDown') ? 1 : 0);
    if (pressed('gearbox')) d.manual = !d.manual;
    return shift;
  }

  // A crash since the last frame: the jump in the car's velocity that nothing it did itself explains
  checkImpact(c: CarEntity): void {
    const vx = Math.sin(c.heading) * c.speed + c.vx, vz = Math.cos(c.heading) * c.speed + c.vz;
    if (c.impactArmed) this.impactCar(c, vx - c.lastVx, vz - c.lastVz);
    c.impactArmed = true;
  }

  // Remember where the car's velocity ended up this frame, for checkImpact
  recordVelocity(c: CarEntity): void {
    c.lastVx = Math.sin(c.heading) * c.speed + c.vx;
    c.lastVz = Math.cos(c.heading) * c.speed + c.vz;
  }

  // The car's velocity changed by (dvx, dvz) at once: if that was hard enough, it is damaged where it was hit (the
  // side the push came from), its body dented and its wheels knocked out of true
  impactCar(c: CarEntity, dvx: number, dvz: number): number {
    const dv = Math.hypot(dvx, dvz);
    if (!(dv > MIN_IMPACT)) return 0;
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    // in the car's frame (+z ahead, +x its left), towards what hit it: against the push
    const lx = -(dvx * cs - dvz * sn), lz = -(dvx * sn + dvz * cs);
    // (the dents go in the body shape's own frame, before it is stretched to the model's size)
    const k = c.scale ?? { x: 1, z: 1 };
    const severity = applyImpact(c.damage, lx / k.x, lz / k.z, dv, c.bodyHalf?.w, c.bodyHalf?.l);
    if (severity > 0) this.deformCar(c);
    return severity;
  }

  // Presses the car's dents into its own copy of the body mesh (shared, undented, by every car of its kind until then)
  deformCar(c: CarEntity): void {
    if (!c.dented) {
      const base = c.bodyMesh.geometry;
      const geometry = base.clone();
      c.dented = {
        geometry,
        basePos: base.attributes.position.array.slice(),
        baseNrm: base.attributes.normal.array.slice()
      };
      c.bodyMesh.geometry = geometry;
    }
    const { geometry, basePos, baseNrm } = c.dented;
    deformBody(basePos, baseNrm, geometry.attributes.position.array, geometry.attributes.normal.array, c.damage.dents);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    // front-right, front-left, rear-right, rear-left wheel pivots (side -1 is the car's right) against the damage's
    // front-left, front-right, rear-left, rear-right camber
    for (const w of c.wheels) w.steerPivot.rotation.z = c.damage.camber[(w.isFront ? 0 : 2) + (w.side > 0 ? 0 : 1)];
  }

  // Smoke puffs: engine smoke from under the bonnet, tyre smoke off the road; one instanced mesh of soft spheres that
  // swell, rise and drift, then shrink away (no per-puff opacity: the shrinking fades them)
  createSmoke(): void {
    const geo = new THREE.IcosahedronGeometry(0.5, 2);
    const mesh = new THREE.InstancedMesh(geo, createSmokeMaterial(), SMOKE_PUFFS);
    mesh.name = 'PlayerCarSmoke';
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    const color = new THREE.Color(1, 1, 1);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      mesh.setMatrixAt(i, hidden);
      mesh.setColorAt(i, color);
    }
    this.scene.add(mesh);
    this.smoke = {
      mesh, color, matrix: new THREE.Matrix4(), cursor: 0, carry: 0,
      puffs: Array.from({ length: SMOKE_PUFFS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 }))
    };
  }

  // `count` (fractional: carried over to the next frame) puffs of grey `shade` and `size` from the car's local point
  emitSmoke(c: CarEntity | MotoEntity, lx: number, ly: number, lz: number, count: number, shade: number, size: number): void {
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    this.puffSmoke(c.position.x + cs * lx + sn * lz, c.position.y + ly, c.position.z - sn * lx + cs * lz,
      sn * c.speed + c.vx, cs * c.speed + c.vz, count, shade, size);
  }

  // `count` puffs at (x, y, z) from something moving at (vx, vz): the player's car, or a damaged one in the traffic
  // (traffic.ts setSmokeEmitter, main.ts)
  puffSmoke(x: number, y: number, z: number, vx: number, vz: number, count: number, shade: number, size: number): void {
    const sm = this.smoke;
    sm.carry += count;
    while (sm.carry >= 1) {
      sm.carry -= 1;
      const p = sm.puffs[sm.cursor];
      const i = sm.cursor;
      sm.cursor = (sm.cursor + 1) % SMOKE_PUFFS;
      p.x = x + (Math.random() - 0.5) * 0.3;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 0.3;
      // left behind by the car (a little of its speed), rising and spreading
      p.vx = vx * 0.15 + (Math.random() - 0.5) * 1.2;
      p.vy = 0.7 + Math.random() * 0.9;
      p.vz = vz * 0.15 + (Math.random() - 0.5) * 1.2;
      p.max = p.life = 1.1 + Math.random() * 0.9;
      p.size = size * (0.8 + Math.random() * 0.4);
      const g = shade * (0.9 + Math.random() * 0.2);
      sm.color.setRGB(g, g, g);
      sm.mesh.setColorAt(i, sm.color);
      if (sm.mesh.instanceColor) sm.mesh.instanceColor.needsUpdate = true; // (setColorAt made it)
    }
  }

  updateSmoke(dt: number): void {
    const sm = this.smoke;
    let live = false;
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const p = sm.puffs[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      live = true;
      const t = 1 - Math.max(0, p.life) / p.max;
      const drag = Math.exp(-dt * 1.6);
      p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-dt * 0.6);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const s = p.life > 0 ? p.size * (0.35 + 1.5 * t) * (t < 0.7 ? 1 : (1 - t) / 0.3) : 0;
      sm.matrix.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      sm.mesh.setMatrixAt(i, sm.matrix);
    }
    if (live || sm.wasLive) sm.mesh.instanceMatrix.needsUpdate = true;
    sm.wasLive = live;
  }

  // The moto and the bicycle: rigid bodies on two sprung wheels in Jolt (car-physics.ts). The moto's drive is its
  // model's engine & gearbox's (drivetrain.ts, like the car's), the bicycle's its rider's legs (pedalForce); either
  // way the rider leans it into its turns as far as they need, rides the wheelie a strong moto pulls, brakes mostly on
  // the front (S) or locks the rear and slides it round (Space). A body is in the world only while it is ridden, and
  // after its rider is thrown off until it lies still; parked, it stands on its stand. Before the world's step: its
  // drive, steering & brakes, the traffic's shove carried over
  driveTwoWheeler(m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
    const P = this.carPhysics;
    if (!P) return;
    if (!riding) {
      if (m.vehicle && !m.loose) this.parkTwoWheeler(m);
      return;
    }
    const moto = m.type === 'moto';
    const spec = moto ? m.spec : BICYCLE_BODY;
    // (back on it after a fall: stood up again where it lies)
    if (m.loose || m.fallen) this.parkTwoWheeler(m);
    if (!m.vehicle) {
      m.position.y = this.getGroundHeight(m.position.x, m.position.z, m.type, m.position.y + 0.5);
      m.vehicle = P.add(this.twoWheelerDef(m, spec), m.position.x, m.position.y, m.position.z, m.heading);
      m.leanPivot.rotation.z = 0; // (it leans with its body now)
      m.physicsPlaced = false;
    }
    const v = m.vehicle;
    const sn = Math.sin(m.heading), cs = Math.cos(m.heading);
    m.shoved = 0;
    if (!m.physicsPlaced) {
      P.place(v, m.position.x, m.position.y, m.position.z, m.heading);
      P.shove(v, sn * m.speed, 0, cs * m.speed, 0, 0, 0);
      m.physicsPlaced = true;
    } else if (m.bodyOut) {
      // the traffic's shove (traffic.ts collideWithPlayer moves it and takes its speed; bodyOut: followBody's)
      const o = m.bodyOut;
      const dvx = sn * m.speed + m.vx - o.vx, dvz = cs * m.speed + m.vz - o.vz;
      m.shoved = Math.hypot(dvx, dvz);
      P.shove(v, dvx, 0, dvz, 0, 0, 0, m.position.x - o.x, m.position.z - o.z);
    }

    const throttle = Number(this.keys.forward) || 0;
    const brake = Number(this.keys.backward) || 0;
    const u = P.read(v).forward;
    // (in a flood the water drags at it; over a moto's exhaust, ~0.4 m, its engine dies until it is out)
    const water = this.waterAt ? this.waterAt(m.position.x, m.position.z) : 0;
    const grip = this.roadGrip * (water > 0.15 ? 0.75 : 1);
    let force: number;
    if (moto) {
      const d = (m.drive ??= createDriveState(m.spec));
      const input: DriveInput = (m.driveInput ??= {});
      input.throttle = throttle;
      input.brake = brake;
      input.handbrake = false; // (Jolt's: the rear wheel locked)
      input.nitro = Boolean(this.keys.boost);
      input.shift = this.gearKeys(m, d);
      input.slope = 0; // (gravity is Jolt's)
      m.drowned = water > 0.4;
      input.power = m.drowned ? 0 : 1;
      input.grip = grip;
      force = this.driveForce(d, m.spec, input, u, water, dt);
    } else {
      // pedalling (walking it back on S from a standstill); rim brakes in the wet bite later; a flood's water drags
      const pedal = throttle || -brake;
      force = pedalForce(pedal, Boolean(this.keys.boost) && this.canSprint, u, spec.mass, grip);
      if (water > 0.03) force -= Math.sign(u) * spec.mass * Math.min(Math.abs(u) / dt, 4 * Math.min(0.6, water) * Math.abs(u));
      m.pedalling = pedal > 0;
    }

    // the bars turned towards the keys' side, quickly but not at once (Jolt's lean limit, car-physics.ts, keeps it
    // to what the tyres hold at speed)
    let steerInput = 0;
    if (this.keys.left) steerInput = Number(this.keys.left);
    if (this.keys.right) steerInput = -Number(this.keys.right);
    m.steerInput += (steerInput - m.steerInput) * Math.min(1, dt * 7);
    const speed = Math.hypot(v.out.vx, v.out.vy, v.out.vz);
    const go = (v.input ??= { force: 0 });
    go.force = force;
    go.airDrag = 0.5 * 1.2 * spec.dragArea * speed * speed;
    go.steer = -m.steerInput; // (Jolt's: +1 full right)
    go.handbrake = Boolean(this.keys.handbrake);
    go.hold = !throttle && !brake && Math.abs(u) < 0.5;
    go.grip = spec.grip * grip;
    go.spinning = Boolean(moto && m.drive?.wheelspin);
  }

  // After the step: a two-wheeler's body's pose, speed and wheels read back; its rider thrown off by a hard crash or a
  // fall at speed; once nobody rides it and it lies still, out of the world, lying where it fell
  twoWheelerMoved(m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
    const v = m.vehicle;
    if (!v) return;
    const o = this.followBody(m, v);
    m.leanAngle = o.lean;
    m.shadow.rotation.z = -o.lean; // (its contact shadow stays on the ground under it as it leans)
    const rear = o.wheels.at(0), front = o.wheels.at(1); // (none before its first step)
    if (rear && front) {
      m.rearWheel.position.y = rear.y;
      m.rearWheel.rotation.x = rear.spin;
      // (the front wheel slides up its fork, about the steering pivot)
      m.frontWheel.position.set(0, front.y, front.z - m.steerPivot.position.z);
      m.frontWheel.rotation.x = front.spin;
      m.steerPivot.rotation.y = front.steer;
      if (m.type === 'cyclist') {
        // the cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
        // freewheel otherwise; the rider's feet follow the pedals (poseCharacters)
        // (Jolt keeps the wheel's angle within a turn: the step across its wrap taken the short way)
        const step = rear.spin - (m.lastSpin ?? rear.spin);
        const turned = step - 2 * Math.PI * Math.round(step / (2 * Math.PI));
        m.lastSpin = rear.spin;
        if (m.pedalling && riding && turned > 0) m.pedalPhase += turned / 3.2;
        m.crankPivot.rotation.x = m.pedalPhase;
        for (const pedal of m.pedals) pedal.rotation.x = -m.pedalPhase;
      }
    }
    if (m.loose) {
      // on its own: lying still a moment, it stays where it is, out of Jolt
      const still = Math.hypot(o.vx, o.vy, o.vz) < 0.25 && Math.hypot(o.wx, o.wy, o.wz) < 0.3;
      m.restTime = still ? m.restTime + dt : 0;
      if (m.restTime > 1) {
        this.carPhysics?.remove(v);
        m.vehicle = null;
        m.loose = false;
        m.fallen = Math.abs(o.lean) > 0.6;
        if (!m.fallen) this.settle(m); // (left upright: back on its stand)
      }
      return;
    }
    if (!riding) return;
    const sn = Math.sin(m.heading), cs = Math.cos(m.heading);
    const hit = o.hit;
    let thrown = 0;
    if (hit.speed > 1.5) {
      const hx = m.position.x - hit.nx * 0.9, hz = m.position.z - hit.nz * 0.9;
      const other = hit.other?.owner;
      this.reportCollision(m, other || (this._wall ??= { type: 'building' }), other ? 'vehicle' : 'building', hx, m.position.y + 0.6, hz, hit.nx, 0, hit.nz, hit.speed);
      m.cameraKick = Math.max(m.cameraKick || 0, Math.min(1, (hit.speed - 1.5) / 10));
      if (hit.speed > 2.2) m.lastCollisionSpark = { x: hx, y: 0.5, z: hz, nx: hit.nx, nz: hit.nz, speed: hit.speed };
      // head on (what it hit faces its front wheel) at ~30 km/h, or anything that hard from any side: over the bars
      const headOn = hit.nx * sn + hit.nz * cs < -0.5;
      if (hit.speed > (headOn ? THROW_SPEED : THROW_SPEED * 1.5)) thrown = hit.speed;
    }
    // stopped short (whatever it met, however it touched it: its speed gone faster than any brakes take it), or knocked
    // off by the traffic
    m.peak = Math.max(m.speed, (m.peak ?? m.speed) - BRAKE_LIMIT * dt);
    const lost = m.peak - m.speed;
    if (lost > THROW_SPEED * 0.85) thrown = Math.max(thrown, lost);
    if (m.shoved > THROW_SPEED * 0.8) thrown = Math.max(thrown, m.shoved);
    // down on its side: at speed the rider goes sliding and tumbling after it, slower they step off as it goes over
    const along = Math.hypot(o.vx, o.vz);
    const down = Math.abs(o.lean) > DOWN_LEAN && o.contacts < 2;
    if (down && !thrown && along > THROW_SPEED) {
      this.reportCollision(m, groundCollider, 'ground', m.position.x, m.position.y + 0.3, m.position.z, 0, 1, 0, along);
      thrown = along;
    }
    // tyre smoke off a moto's locked or spinning rear wheel, or its tyres sliding across the road
    const slip = Math.hypot(m.vx, m.vz);
    if (m.type === 'moto' && rear?.contact && Math.abs(m.speed) > 2 && (this.keys.handbrake || m.drive?.wheelspin || slip > 1.5)) {
      this.emitSmoke(m, 0, 0.15, m.wheelSpots.rear, dt * Math.min(16, 4 + slip * 3 + Math.abs(m.speed) * 0.3) * 0.5, 0.86, 0.9);
    }
    if (thrown) this.ejectRider(m, thrown);
    else if (down) this.stepOff(m);
  }

  // A two-wheeler's body taken out of Jolt: standing on its stand where it is
  parkTwoWheeler(m: CyclistEntity | MotoEntity): void {
    if (m.vehicle) this.carPhysics?.remove(m.vehicle);
    m.vehicle = null;
    m.loose = m.fallen = false;
    m.restTime = 0;
    this.settle(m);
  }

  // What a two-wheeler's body is: its mass with its rider, its wheels where they stand (`wheelSpots`: the rear's on a
  // swing arm or the frame, the front's fork raked back), the bike up to its seat and its rider over it, their centre of
  // mass a little behind the middle (the rider's weight on the seat). The moto's ~0.72 m up: it leans to ~47° and lifts
  // its front wheel at ~0.75 g; the bicycle's ~1 m (a light frame, its rider sitting high). (Its body reaches over its
  // tyres' ends: what it rides into, it hits, rather than its front wheel climbing it)
  twoWheelerDef(m: CyclistEntity | MotoEntity, spec: { mass: number }): TwoWheelerDef {
    const { radius, rear, front, caster, travel } = m.wheelSpots;
    const moto = m.type === 'moto';
    return {
      kind: 'two-wheeler', mass: spec.mass, halfW: moto ? 0.17 : 0.12, halfL: Math.max(-rear, front) + radius + 0.03,
      height: moto ? 0.9 : 0.85, cg: moto ? 0.72 : 1.0, cgZ: moto ? -0.12 : -0.1,
      rider: moto ? [0, 1.18, -0.22, 0.2, 0.32, 0.22] : [0, 1.3, -0.12, 0.2, 0.38, 0.2],
      steerLock: 0.6, drive: 'rwd', springHz: moto ? 2.2 : 3.5, wheelMass: moto ? 10 : 1.8,
      wheels: [
        { x: 0, z: rear, radius, front: false, travel: travel * 0.8 },
        { x: 0, z: front, radius, front: true, caster, travel }
      ]
    };
  }

  updateHelicopter(dt: number, elapsed: number): void {
    const h = this.entities.helicopter;
    const maxHorizSpeed = this.keys.boost ? 52.0 : 32.0;
    const maxVertSpeed = 16.0;

    let fwdInput = 0;
    if (this.keys.forward) fwdInput = Number(this.keys.forward);
    else if (this.keys.backward) fwdInput = -Number(this.keys.backward);

    let yawInput = 0;
    if (this.keys.left) yawInput = Number(this.keys.left);
    if (this.keys.right) yawInput = -Number(this.keys.right);

    let vertInput = 0;
    if (this.keys.up) vertInput = Number(this.keys.up);
    else if (this.keys.down) vertInput = -Number(this.keys.down);

    if (fwdInput !== 0) {
      h.speed += fwdInput * 24.0 * dt;
      h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
    } else {
      h.speed *= Math.max(0, 1 - dt * 1.8);
    }

    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 22.0 * dt;
      h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }

    h.heading += yawInput * 1.45 * dt;

    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y += h.verticalSpeed * dt;

    // from the town's floor up to 380 m over it (the hills are kept below it by keepOffHills)
    const floor = this.floorHeight(h.position.x, h.position.z);
    if (h.position.y < floor + 0.25) {
      this.reportCollision(h, groundCollider, 'ground', h.position.x, floor + 0.25, h.position.z, 0, 1, 0, -h.verticalSpeed);
    }
    h.position.y = Math.max(floor + 0.25, Math.min(floor + 380, h.position.y));
    this.resolveHorizontalCollision(h.position, 4.5, null, h);

    const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
    const targetRoll = -yawInput * 0.28;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
  }
}

export { ThirdPersonControllerManager };
