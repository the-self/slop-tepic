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
//
// The class is the facade: its fields are the player's state, and its methods hand it to the pieces in
// js/player/controllers/ (input, collisions, ground, placement, boarding, the car's model, looks, drive & crashes, the
// smoke, the two-wheelers, their models, the helicopter, the walker, and the frame that runs them in order).
import * as THREE from 'three/webgpu';
import { loadCarFiles, onCarFile } from '../actors/vehicles/car-files.ts';
import * as Input from './controllers/input.ts';
import * as Collisions from './controllers/collisions.ts';
import * as Ground from './controllers/ground.ts';
import * as Placement from './controllers/placement.ts';
import * as Boarding from './controllers/boarding.ts';
import * as CarModel from './controllers/car-model.ts';
import * as CarLooks from './controllers/car-looks.ts';
import * as CarDrive from './controllers/car-drive.ts';
import * as CarCrashes from './controllers/car-crashes.ts';
import * as Smoke from './controllers/smoke.ts';
import * as TwoWheelers from './controllers/two-wheelers.ts';
import * as BikeModels from './controllers/bike-models.ts';
import * as Helicopter from './controllers/helicopter.ts';
import * as Person from './controllers/person.ts';
import * as Frame from './controllers/frame.ts';
import type { SprintMode } from './stats.ts';
import type { DriveInput, DriveSpec, DriveState } from './drivetrain.ts';
import type { CarDamage } from './vehicle-damage.ts';
import type { PersonRig } from '../sim/pedestrians.ts';
import type { Ragdolls, ThrowOptions } from '../sim/ragdolls.ts';
import type { CarBodyDef, CarPhysics, PhysicsVehicle, TwoWheelerDef, VehicleOut } from './car-physics.ts';
import type {
  PlayerMode, VehicleMode, KeyValue, ControlKeys, InputAction, InputSource, PersonEntity, CarRoute, LookKit, CarEntity,
  CyclistEntity, MotoEntity, HelicopterEntity, PlayerEntity, PlayerEntities, PlayerCollider, LeftCar, ParkedVehicle,
  TakenVehicle, PlayerRoom, CollisionEvent, GroundQuery, Contact, Smoke as SmokeState
} from './controllers/types.ts';
export type {
  PlayerMode, VehicleMode, KeyValue, ControlKeys, InputAction, PersonEntity, CarWheel, CarRoute, CarLook, LookKit,
  DentedBody, CollisionSpark, CarStateUniform, CarEntity, BikeFrame, WheelSpots, CyclistEntity, MotoEntity,
  HelicopterEntity, PlayerEntity, PlayerEntities, PlayerCollider, LeftCar, ParkedVehicle, TakenVehicle, PlayerRoom,
  CollisionEvent, GroundQuery
} from './controllers/types.ts';

// (three's Mesh, with its material's own type rather than instanceof's any)
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;

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
  seated = false; // riding in a friend's car (net/multiplayer.ts): the walker stands still where it got in
  roadWet: number;
  roadGrip: number;
  waterAt: ((x: number, z: number) => number) | null;
  interior: PlayerRoom | null;
  aiming: boolean;
  viewHeading: number | null; // rad
  entities: PlayerEntities;
  // (bindKeyboard: the codes held, and each source's actions)
  declare _pressedCodes: Set<string>;
  declare _keyboardKeys: InputSource;
  declare _touchKeys: InputSource;
  declare _gamepadKeys: InputSource;
  declare smoke: SmokeState; // (createSmoke)
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
  /** deckAt for the player on foot: the footbridges' walkways & stairs too */
  walkDeckAt?: ((x: number, z: number, over: number) => number) | null;
  _physicsFocus?: { x: number; y: number; z: number };
  _bodyBounds?: { x: number; z: number };
  _wall?: { type: 'building' };
  _bloodMats?: Map<string, THREE.Material>; // the car's material for each look (setCarLook), keyed body_paint
  _modelMats?: Map<string, THREE.Material>; // a car model's 3D model's materials (showCarFile), keyed id & id_wheel
  _twoWheelers?: (CyclistEntity | MotoEntity)[];
  _bodied?: (CarEntity | CyclistEntity | MotoEntity)[];
  rain: number; // the rain falling, 0..1 (main.ts: washing the blood off the car)
  carPhysics?: CarPhysics | null;
  ragdolls?: Ragdolls | null; // (sim/ragdolls.ts, main.ts)
  // (main.ts: the driver or rider thrown out, impact in m/s (0: stepped off), at (x, z), off which vehicle; `bail`: they
  // jumped out at that speed, boarding.ts leaveVehicle)
  onEject?: (impact: number, x: number, z: number, kind: VehicleMode, bail?: boolean) => void;
  // (main.ts: the car's tank run dry)
  onFuelOut?: () => void;

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
    // Which way the camera looks (cameras.ts viewHeading, main.ts sets it every frame), GTA-style: on foot WASD walk
    // away from it, across it and towards it. Null on the cameras that sit behind the player (the action cam)
    this.viewHeading = null;

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
    // (a car model's 3D model loading after the car took its look: swapped in)
    loadCarFiles();
    onCarFile((id) => { CarLooks.refreshCarFile(this, id); });
    this.createSmoke();
    this.syncOccupants();
    this.bindKeyboard();
  }

  getActiveEntity(): PlayerEntity {
    return this.entities[this.activeMode];
  }

  // The controls (controllers/input.ts)
  bindKeyboard(): void { Input.bindKeyboard(this); }
  _blendInput(action: InputAction): void { Input._blendInput(this, action); }
  _setAnalogInput(source: InputSource, action: InputAction, value: KeyValue): void {
    Input._setAnalogInput(this, source, action, value);
  }
  setTouchInput(action: InputAction, value: KeyValue): void { Input.setTouchInput(this, action, value); }
  setGamepadInput(action: InputAction, value: KeyValue): void { Input.setGamepadInput(this, action, value); }
  clearTouchInput(): void { Input.clearTouchInput(this); }
  clearGamepadInput(): void { Input.clearGamepadInput(this); }
  resetInput(): void { Input.resetInput(this); }
  sprintingMode(): SprintMode | null { return Input.sprintingMode(this); }

  // What the player bumps into (controllers/collisions.ts)
  setCollisionListener(listener: ((event: CollisionEvent) => void) | null | undefined): void {
    Collisions.setCollisionListener(this, listener);
  }
  reportCollision(a: unknown, b: unknown, kind: string, x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number): void {
    Collisions.reportCollision(this, a, b, kind, x, y, z, nx, ny, nz, speed);
  }
  isSolidAt(x: number, z: number, height?: number, ground?: number, minSize?: number): boolean {
    return Collisions.isSolidAt(this, x, z, height, ground, minSize);
  }
  nearColliders(x: number, z: number, r: number): PlayerCollider[] { return Collisions.nearColliders(this, x, z, r); }
  keepInBounds(pos: { x: number; z: number }): boolean { return Collisions.keepInBounds(this, pos); }
  resolveHorizontalCollision(pos: THREE.Vector3, radius: number, carEntity?: CarEntity | null, entity?: PlayerEntity | null): void {
    Collisions.resolveHorizontalCollision(this, pos, radius, carEntity, entity);
  }

  // The ground under the player (controllers/ground.ts)
  isPointOnSidewalk(x: number, z: number): boolean { return Ground.isPointOnSidewalk(x, z); }
  setInterior(room: PlayerRoom | null | undefined): void { Ground.setInterior(this, room); }
  getGroundHeight(x: number, z: number, mode?: PlayerMode, fromY?: number): number {
    return Ground.getGroundHeight(this, x, z, mode, fromY);
  }
  floorHeight(x: number, z: number): number { return Ground.floorHeight(this, x, z); }
  groundTilt(x: number, z: number, heading: number, along: number, across: number, out: { pitch: number; roll: number },
    y?: number): { pitch: number; roll: number } {
    return Ground.groundTilt(this, x, z, heading, along, across, out, y);
  }
  setTerrain(ground: GroundQuery | null, floor?: ((x: number, z: number) => number) | null,
    land?: ((x: number, z: number) => number) | null, deck?: ((x: number, z: number, over: number) => number) | null,
    walkDeck?: ((x: number, z: number, over: number) => number) | null): void {
    Ground.setTerrain(this, ground, floor, land, deck, walkDeck);
  }
  keepOffHills(entity: PlayerEntity, prevX: number, prevZ: number): void {
    Ground.keepOffHills(this, entity, prevX, prevZ);
  }

  // Teleports, and an entity settled at rest (controllers/placement.ts)
  teleportActiveTo(x: number, z: number, heading?: number, savedAltitude?: number | null): { x: number; z: number } {
    return Placement.teleportActiveTo(this, x, z, heading, savedAltitude);
  }
  settle(ent: PlayerEntity): void { Placement.settle(this, ent); }
  tiltToGround(ent: CarEntity | CyclistEntity | MotoEntity, k: number): void { Placement.tiltToGround(this, ent, k); }
  findTeleportPosition(x: number, z: number, heading: number, altitude: number): { x: number; z: number } | null {
    return Placement.findTeleportPosition(this, x, z, heading, altitude);
  }

  // Getting in and out, the cars left behind (controllers/boarding.ts)
  setMode(mode: PlayerMode): void { Boarding.setMode(this, mode); }
  syncOccupants(): void { Boarding.syncOccupants(this); }
  ownVehicleNear(reach: number): { mode: VehicleMode; distance: number; left?: LeftCar } | null {
    return Boarding.ownVehicleNear(this, reach);
  }
  leaveCarBehind(): void { Boarding.leaveCarBehind(this); }
  forgetLeftCar(left: LeftCar, dispose?: boolean): void { Boarding.forgetLeftCar(this, left, dispose); }
  takeLeftCar(left: LeftCar): boolean { return Boarding.takeLeftCar(this, left); }
  enterVehicle(mode: PlayerMode, taken?: TakenVehicle | null): boolean {
    return Boarding.enterVehicle(this, mode, taken);
  }
  exitVehicle(): boolean { return Boarding.exitVehicle(this); }
  leaveVehicle(): boolean { return Boarding.leaveVehicle(this); }
  parkedVehicles(): ParkedVehicle[] { return Boarding.parkedVehicles(this); }

  // On foot, and thrown as a ragdoll (controllers/person.ts)
  createPersonEntity(): PersonEntity { return Person.createPersonEntity(this); }
  updatePerson(dt: number): void { Person.updatePerson(this, dt); }
  throwPlayer(x: number, z: number, heading: number, y: number, rider: PersonRig | false, thrown: ThrowOptions): void {
    Person.throwPlayer(this, x, z, heading, y, rider, thrown);
  }
  followRagdoll(p: PersonEntity): void { Person.followRagdoll(this, p); }
  getUp(): void { Person.getUp(this); }

  // The car as built (controllers/car-model.ts)
  createCarEntity(): CarEntity { return CarModel.createCarEntity(this); }

  // The car's looks, repairs and blood (controllers/car-looks.ts)
  setLookKits(make: ((look: { bodyType: string; route: CarRoute | null }) => LookKit | null) | null | undefined): void {
    CarLooks.setLookKits(this, make);
  }
  setCarLook(bodyType?: string, paint?: number, police?: boolean, modelId?: string | null, route?: CarRoute | null): void {
    CarLooks.setCarLook(this, bodyType, paint, police, modelId, route);
  }
  setBusLook(c: CarEntity, kit: LookKit, route: CarRoute | null): void { CarLooks.setBusLook(this, c, kit, route); }
  dropLookKit(c: CarEntity, dispose?: boolean): void { CarLooks.dropLookKit(c, dispose); }
  repairCar(c?: CarEntity): void { CarLooks.repairCar(this, c); }
  bloodyCar(x: number, z: number, speed: number): void { CarLooks.bloodyCar(this, x, z, speed); }
  showBlood(c: CarEntity): void { CarLooks.showBlood(c); }

  // The car in Jolt (controllers/car-drive.ts)
  driveCar(dt: number, driving: boolean): void { CarDrive.driveCar(this, dt, driving); }
  driveForce(d: DriveState, spec: DriveSpec, input: DriveInput, u: number, water: number, dt: number): number {
    return CarDrive.driveForce(d, spec, input, u, water, dt);
  }
  stepVehicles(dt: number): void { CarDrive.stepVehicles(this, dt); }
  followBody(ent: CarEntity | CyclistEntity | MotoEntity, v: PhysicsVehicle): VehicleOut {
    return CarDrive.followBody(this, ent, v);
  }
  carMoved(dt: number, driving: boolean): void { CarDrive.carMoved(this, dt, driving); }
  carEffects(c: CarEntity, d: DriveState, dmg: CarDamage, throttle: number, u: number, slip: number, water: number, dt: number): void {
    CarDrive.carEffects(this, c, d, dmg, throttle, u, slip, water, dt);
  }
  setCarPhysics(physics: CarPhysics | null | undefined): void { CarDrive.setCarPhysics(this, physics); }
  carBodyDef(c: CarEntity, spec: DriveSpec): CarBodyDef { return CarDrive.carBodyDef(c, spec); }
  gearKeys(ent: CarEntity | MotoEntity, d: DriveState): number { return CarDrive.gearKeys(this, ent, d); }

  // The car's crashes (controllers/car-crashes.ts)
  ejectDriver(c: CarEntity, v: { vx: number; vy: number; vz: number }, impact: number): void {
    CarCrashes.ejectDriver(this, c, v, impact);
  }
  checkImpact(c: CarEntity): void { CarCrashes.checkImpact(this, c); }
  recordVelocity(c: CarEntity): void { CarCrashes.recordVelocity(c); }
  impactCar(c: CarEntity, dvx: number, dvz: number): number { return CarCrashes.impactCar(this, c, dvx, dvz); }
  deformCar(c: CarEntity): void { CarCrashes.deformCar(c); }
  popTyre(i: number): boolean { return CarCrashes.popTyre(this, i); }
  popTyresOn(cx: number, cz: number, heading: number, halfLen: number, halfW: number): number { return CarCrashes.popTyresOn(this, cx, cz, heading, halfLen, halfW); }

  // The smoke puffs (controllers/smoke.ts)
  createSmoke(): void { Smoke.createSmoke(this); }
  emitSmoke(c: CarEntity | MotoEntity, lx: number, ly: number, lz: number, count: number, shade: number, size: number): void {
    Smoke.emitSmoke(this, c, lx, ly, lz, count, shade, size);
  }
  puffSmoke(x: number, y: number, z: number, vx: number, vz: number, count: number, shade: number, size: number): void {
    Smoke.puffSmoke(this, x, y, z, vx, vz, count, shade, size);
  }
  updateSmoke(dt: number): void { Smoke.updateSmoke(this, dt); }

  // The bicycle and the moto as built, and their looks (controllers/bike-models.ts)
  setBikeColor(hex?: number): void { BikeModels.setBikeColor(this, hex); }
  setMotoLook(modelId?: string, paint?: number): void { BikeModels.setMotoLook(this, modelId, paint); }
  createCyclistEntity(): CyclistEntity { return BikeModels.createCyclistEntity(this); }
  createMotoEntity(): MotoEntity { return BikeModels.createMotoEntity(this); }

  // The bicycle and the moto in Jolt (controllers/two-wheelers.ts)
  ejectRider(m: CyclistEntity | MotoEntity, impact: number, bail = false): void { TwoWheelers.ejectRider(this, m, impact, bail); }
  stepOff(m: CyclistEntity | MotoEntity): void { TwoWheelers.stepOff(this, m); }
  driveTwoWheeler(m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
    TwoWheelers.driveTwoWheeler(this, m, dt, riding);
  }
  twoWheelerMoved(m: CyclistEntity | MotoEntity, dt: number, riding: boolean): void {
    TwoWheelers.twoWheelerMoved(this, m, dt, riding);
  }
  parkTwoWheeler(m: CyclistEntity | MotoEntity): void { TwoWheelers.parkTwoWheeler(this, m); }
  twoWheelerDef(m: CyclistEntity | MotoEntity, spec: { mass: number }): TwoWheelerDef {
    return TwoWheelers.twoWheelerDef(m, spec);
  }

  // The helicopter (controllers/helicopter.ts)
  landHelicopter(home?: boolean): void { Helicopter.landHelicopter(this, home); }
  createHelicopterEntity(): HelicopterEntity { return Helicopter.createHelicopterEntity(this); }
  updateHelicopter(dt: number, elapsed: number): void { Helicopter.updateHelicopter(this, dt, elapsed); }

  // The frame (controllers/frame.ts)
  poseCharacters(dt: number): void { Frame.poseCharacters(this, dt); }
  update(dt: number, elapsed: number): void { Frame.update(this, dt, elapsed); }
}

export { ThirdPersonControllerManager };
