// js/sim/traffic/state.ts
// The street traffic's state (TrafficState): everything createTrafficSystem's parts share, made once by
// createTrafficState (the road graph with the traffic's own counters on it, the vehicles and the people, their instanced
// meshes, and what each frame reads and writes) and handed to every part of the traffic first, as `ts`
import * as THREE from 'three/webgpu';
import { buildRoadNetwork } from '../../world/road-network.ts';
import type { Footprint } from '../../world/road-network.ts';
import { createPedestrianRoutes } from '../pedestrian-routes.ts';
import type { PedestrianRoutes } from '../pedestrian-routes.ts';
import { blockAt } from '../../world/city-config.ts';
import type { CityBlock, SignalPhase } from '../../world/city-config.ts';
import { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import type { PersonCrowd, PersonGround } from '../pedestrians.ts';
import { createTransit } from '../transit.ts';
import type { Transit } from '../transit.ts';
import { GEO } from '../../world/city-geodata.js';
import type { Ragdolls } from '../ragdolls.ts';
import type { CarPhysics } from '../../player/car-physics.ts';
import { MASS, MISHAP_FIRST, NUM_CARS, NUM_PEDS } from './constants.ts';
import type {
  Car, Bus, Bike, Moto, Vehicle, VehicleKind, Ped, PedTrack, Spark, TwoWheelKit, TrafficNode, TrafficEdge, TrafficNetwork,
  LaneEntry, TrafficPlayer, ParkedVehicle, SirenSource, CrashedCar, TrafficCollision, MayhemListener, KnockListener, SmokeEmitter,
  SolidQuery, HillQuery, SurfaceQuery, TrafficRayHit, BodyBox, RoadSpot
} from './types.ts';
import { createCars, createBuses, createBikes, createMotos } from './fleet.ts';
import { createVehicleMeshes } from './meshes.ts';
import type { VehicleMeshes } from './meshes.ts';
import { createSparks } from './sparks.ts';
import { createTwoWheelKits } from './two-wheelers.ts';
import { createPeds, pedGround } from './peds.ts';
import { createLightPools } from './render.ts';
import { kindOf } from './population.ts';

/** Where spawnPed places someone: a track's fields, copied onto them */
interface TrackPick {
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  node: TrafficNode | null;
  side: number;
  line: number;
  route: PedTrack | null;
}

/** The street traffic's shared state (see the module comment); the instanced meshes of its vehicles come from
 *  meshes.ts (VehicleMeshes) */
interface TrafficState extends VehicleMeshes {
  /** everything the traffic draws, in the scene */
  group: THREE.Group;

  // ---- what the rest of the game plugs in (hooks.ts, surface.ts, crashes.ts) ----
  collisionListener: ((e: TrafficCollision) => void) | null;
  /** the crash passed to the collision listener (reused) */
  collisionEvent: TrafficCollision;
  /** the player's own mayhem, for health & money (player/stats.ts) */
  mayhemListener: MayhemListener | null;
  /** told when the player runs someone over */
  knockListener: KnockListener | null;
  /** smoke from a damaged engine, through the player's smoke (main.ts) */
  smokeEmitter: SmokeEmitter | null;
  /** Jolt's world, the player's car's (player/car-physics.ts), for the cars thrown about in a crash */
  physics: CarPhysics | null;
  /** the people thrown about (sim/ragdolls.ts, main.ts) */
  ragdolls: Ragdolls | null;
  /** where walls stand (main.ts hands over the player's building colliders): knocked bodies bounce off them */
  solidAt: SolidQuery | null;
  /** where a building's wall stands (main.ts: solidAt without the poles & bollards), for the people walking */
  wallAt: SolidQuery | null;
  /** height of the hills over the flat city (terrain.ts) */
  hillQuery: HillQuery | null;
  /** the surface under something at height y: the ground, or a bridge's deck it is on (ground.ts surfaceHeight) */
  surfaceQuery: SurfaceQuery | null;

  /** scratch transform for every instance written, and the matrix that hides one */
  dummy: THREE.Object3D;
  zero: THREE.Matrix4;

  // ---- the road network (road-network.ts) and the bus & combi routes (transit.ts) ----
  network: TrafficNetwork;
  nodes: TrafficNode[];
  edges: TrafficEdge[];
  connector: TrafficNetwork['connector'];
  curvePoint: TrafficNetwork['curvePoint'];
  transit: Transit;
  /** the sidewalk and crosswalk tracks (pedestrian-routes.ts) */
  pedRoutes: PedestrianRoutes<TrafficNode, TrafficEdge, CityBlock>;

  // ---- who there is (fleet.ts, peds.ts) and how they are drawn ----
  cars: Car[];
  buses: Bus[];
  bikes: Bike[];
  motos: Moto[];
  /** all of them: cars, bikes, motos, buses */
  vehicles: Vehicle[];
  /** the collision spark pool (sparks.ts), and the next spark to reuse */
  sparkInst: THREE.InstancedMesh;
  sparks: Spark[];
  sparkCursor: number;
  /** the bicycles' and motorcycles' meshes (two-wheelers.ts), their riders, and the frame a rider is posed on */
  kits: TwoWheelKit[];
  riderCrowd: PersonCrowd;
  bikeRoot: THREE.Object3D;
  pedCrowd: PersonCrowd;
  peds: Ped[];
  /** the ground a pedestrian walks on (peds.ts pedGround), as the rigs ask for it */
  pedGround: PersonGround<Ped>;
  /** the clustered headlight and police light pools (render.ts) */
  headlightPool: THREE.SpotLight[];
  policeLightPool: THREE.PointLight[];
  /** the player's own copy of a camión's wheels (carjacking.ts lookKit), made the first time */
  busWheelGeos: THREE.BufferGeometry[] | null;

  // ---- the clock, the signals, the focus and the player, each frame (update.ts) ----
  clock: number;
  avePhase: SignalPhase;
  stPhase: SignalPhase;
  aveWalk: boolean;
  stWalk: boolean;
  focusX: number;
  focusZ: number;
  /** (mode, heading, speed, knocks & jolt: set every update, before anything reads them) */
  player: TrafficPlayer;
  /** what stands in the road that isn't the traffic's (main.ts: the player's vehicles left there, the patrol cars),
   *  and the cars thrown about in a crash (crashedStep): all of it steered round, as `parked` */
  parkedOutside: ParkedVehicle[];
  /** the fire trucks & ambulances on their way (hooks.ts setSirens): the traffic pulls over for them */
  sirens: readonly SirenSource[];
  crashedObstacles: ParkedVehicle[];
  parked: ParkedVehicle[];
  /** the weather on the street (hooks.ts setRoadWater): the tyres' grip, how fast drivers go and how far back they
   *  keep, and the rain */
  roadGrip: number;
  caution: number;
  headway: number;
  rainNow: number;

  // ---- lane occupancy (occupancy.ts) ----
  /** lane lists hold pooled { v, s } entries sorted by position s along the lane, rebuilt every frame */
  pool: LaneEntry[];
  poolUsed: number;
  filled: LaneEntry[][];
  /** the nodes and edges whose counters were raised this frame (reset next frame) */
  touchedNodes: TrafficNode[];
  touchedEdges: TrafficEdge[];

  // ---- the camera's view (view.ts), for drawing and protecting nearby spawn locations ----
  frustum: THREE.Frustum;
  hasView: boolean;
  camX: number;
  camY: number;
  camZ: number;
  camFwdX: number;
  camFwdZ: number;

  // ---- around the focus (near.ts): edges and signalized intersections to place vehicles and pedestrians on ----
  nearEdges: TrafficEdge[];
  /** those on a bus or combi route */
  nearTransitEdges: TrafficEdge[];
  nearSignals: TrafficNode[];
  nearX: number;
  nearZ: number;
  /** the hour of the day (local, 0-24; main.ts setHour), and the one the near edges were last weighed for */
  hour: number;
  weighedHour: number;
  nearCarWeights: number[];
  /** ...the same, the avenues left out: where cyclists are placed (spawning.ts) */
  nearBikeWeights: number[];
  nearPedWeights: number[];
  /** how many cars and people the hour has around the focus */
  carTarget: number;
  pedTarget: number;

  /** (once: a lane that leads nowhere, junctions.ts) */
  warnedNowhere: boolean;
  /** the cars in Jolt (crashes.ts) */
  crashed: CrashedCar[];
  /** the next crash of the traffic's own (mishaps.ts): clock s it is looked for at, the driver not looking and the car
   *  it is about to run into */
  mishap: { next: number; v: Car | null; o: Car | null };

  // ---- the people (sidewalks.ts, walking.ts) ----
  /** where spawnPed places someone: a track's fields, copied onto them */
  track: TrackPick;
  /** the intersections with someone at the curbs of their crosswalks, and with someone on them */
  curbNodes: TrafficNode[];
  walkedNodes: TrafficNode[];
  /** who is where, for people to meet and talk (walking.ts meet), and when to look next */
  meetingCells: Map<string, Ped[]>;
  nextMeeting: number;

  // ---- drawing the vehicles this frame (render.ts) ----
  dirtyPaint: Set<THREE.InstancedMesh>;
  dirtyState: Set<THREE.InstancedMesh>;
  litVehicles: (Car | Bus)[];
  litVehicleCount: number;
  wheelCars: number;
  visibleCars: number;
  policeDrawn: number;
  combisDrawn: number;
  visibleBuses: number;
  /** frames updated (the first couple keep every mesh visible for the shader warm-up) */
  updates: number;

  // ---- every vehicle's footprint on the ground, for the people walking about (bodies.ts) ----
  /** cell key -> boxes overlapping it */
  bodyCells: Map<number, BodyBox[]>;
  usedCells: BodyBox[][];
  /** pooled { x, z, sn, cs, hw, hl } */
  bodyBoxes: BodyBox[];
  bodyCount: number;

  /** what a shot meets first (gunfire.ts rayHit, reused) and a spot found for someone to turn up at (spawning.ts) */
  rayResult: TrafficRayHit;
  spot: RoadSpot;

  // ---- how many of each kind of vehicle there are, are out, and the hour allows (population.ts) ----
  fleetSize: Record<VehicleKind, number>;
  active: Record<VehicleKind, number>;
  allowed: Record<VehicleKind, number>;

  // ---- the frame's spawning (update.ts): where the focus was, and whose turn it is next ----
  lastFocusX: number;
  lastFocusZ: number;
  vehicleCursor: number;
  pedCursor: number;
}

function createTrafficState(scene: THREE.Scene, sidewalks: readonly Footprint[], obstacles: readonly Footprint[]): TrafficState {
  const group = new THREE.Group();
  group.name = 'TrafficAndPedestrians';
  const collisionEvent: TrafficCollision = { a: null, b: null, kind: 'vehicle', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };

  const dummy = new THREE.Object3D();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  unitPlane.rotateX(-Math.PI * 0.5);
  const contactShadowMat = createContactShadowMaterial();

  // =========================================================================
  // 0. ROAD NETWORK
  // =========================================================================
  // (its nodes and edges get the traffic's own state just below: TrafficNode, TrafficEdge)
  const network = buildRoadNetwork(sidewalks, obstacles) as TrafficNetwork;
  const { nodes, edges, connector, curvePoint } = network;

  for (const n of nodes) {
    n.box = new Array<number>(n.groupCount).fill(0); // vehicles crossing it from each road (group: on the grid avenue 0, street 1)
    n.crossing = new Array<number>(n.sideCount).fill(0); // vehicles crossing (or about to cross) the crosswalk on each side
    n.approach = new Array<TrafficEdge | null>(n.sideCount).fill(null); // the edge arriving over each side's crosswalk
    n.road = new Array<TrafficEdge | null>(n.sideCount).fill(null); // an edge arriving or leaving over each side's crosswalk: the road it spans
    n.walkers = []; // pedestrians on its crosswalks
    n.curb = []; // pedestrians at the curbs of its crosswalks, standing or about to (who to queue behind)
  }
  // Bus & combi routes (transit.ts): the roads each route runs along (e.transit: [{ path, s }], s where the road ends
  // on it), to put its vehicles on
  const transit = createTransit(GEO.transit, GEO.roadGraph);
  {
    let onRoutes = 0;
    for (const e of edges) {
      const on = transit.pathsAlong(e.sx, e.sz, e.sx + e.dx * e.len, e.sz + e.dz * e.len);
      e.transit = on.length ? on : null;
      if (e.transit) onRoutes++;
    }
    if (transit.paths.length) console.info(`[transit] ${transit.routeNames.length} routes run along ${onRoutes} of ${edges.length} roads`);
  }

  for (const e of edges) {
    e.occ = e.lanes.map(() => []); // vehicles in each lane, sorted by position
    // e.inSide / e.outSide: the crosswalks crossed on the way into e.to / out of e.from; e.axisIndex: its group at e.to;
    // e.opposite: the oncoming edge of its road there (road-network.ts)
    e.to.approach[e.inSide] = e;
    e.to.road[e.inSide] = e.from.road[e.outSide] = e;
    e.through = 0; // vehicles from e crossing e.to straight on or to the right
    e.lefts = 0; // and to the left
  }

  // =========================================================================
  // 1-2. THE VEHICLES (fleet.ts: cars, camiones, cyclists and motorcyclists, drawn from the models in that order) AND
  // THEIR INSTANCED MESHES (meshes.ts, sparks.ts, two-wheelers.ts), added to the group in the order they always were
  // =========================================================================
  const { cars, policeCount, combiCount } = createCars();
  const buses = createBuses();
  const bikes = createBikes();
  const motos = createMotos();
  const vehicles = [...cars, ...bikes, ...motos, ...buses];
  const { sparkInst, sparks } = createSparks();
  const meshes = createVehicleMeshes(group, transit, policeCount, combiCount, unitPlane, contactShadowMat, sparkInst);
  const { kits, riderCrowd, bikeRoot } = createTwoWheelKits(group, bikes, motos);
  group.add(meshes.busBodyInst, meshes.busHeaderInst, meshes.busWheelLeftInst, meshes.busWheelRightInst);

  // =========================================================================
  // 3. SKINNED, PROCEDURALLY ANIMATED SIDEWALK PEDESTRIANS (340 PEDESTRIANS, see pedestrians.ts; peds.ts)
  // =========================================================================
  for (const m of riderCrowd.meshes) group.add(m);
  const { pedCrowd, peds } = createPeds();
  group.add(...pedCrowd.meshes);

  // Add vehicle contact shadows last + pre-allocated Clustered SpotLight / PointLight pools
  group.add(meshes.carShadowInst, meshes.busShadowInst);
  const { headlightPool, policeLightPool } = createLightPools(group);

  // Nothing shows until it has been placed
  const { bodyMeshes, carWheelLeftInst, carWheelRightInst, policeLightbarInst, combiSignInst, carShadowInst } = meshes;
  const { busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst } = meshes;
  const carInstances = [...bodyMeshes, carWheelLeftInst, carWheelRightInst, policeLightbarInst, combiSignInst, carShadowInst];
  const busInstances = [busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst];
  for (const inst of [...carInstances, ...busInstances, sparkInst]) {
    inst.frustumCulled = false;
    for (let i = 0; i < inst.count; i++) inst.setMatrixAt(i, zero);
  }

  scene.add(group);

  // (and over the footbridges, from the intersections near their feet)
  const pedRoutes = createPedestrianRoutes<TrafficNode, TrafficEdge, CityBlock>(network, blockAt, {
    nodes: network.nodes,
    bridges: GEO.footbridges.map(([flat, lifts]) => ({
      pts: Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[i * 2], z: flat[i * 2 + 1] })),
      lifts: lifts.map((v) => v / 10)
    }))
  });
  // How many of each kind of vehicle there are (population.ts allowance)
  const fleetSize: Record<VehicleKind, number> = { car: 0, bike: 0, moto: 0, bus: 0 };
  for (const v of vehicles) fleetSize[kindOf(v)]++;

  const ts: TrafficState = {
    ...meshes,
    group,
    collisionListener: null,
    collisionEvent,
    mayhemListener: null,
    knockListener: null,
    smokeEmitter: null,
    physics: null,
    ragdolls: null,
    solidAt: null,
    wallAt: null,
    hillQuery: null,
    surfaceQuery: null,
    dummy,
    zero,
    network,
    nodes,
    edges,
    connector,
    curvePoint,
    transit,
    pedRoutes,
    cars,
    buses,
    bikes,
    motos,
    vehicles,
    sparkInst,
    sparks,
    sparkCursor: 0,
    kits,
    riderCrowd,
    bikeRoot,
    pedCrowd,
    peds,
    pedGround: (p, x, z) => pedGround(ts, p, x, z),
    headlightPool,
    policeLightPool,
    busWheelGeos: null,
    clock: 0,
    avePhase: 'green',
    stPhase: 'red',
    aveWalk: true,
    stWalk: false,
    focusX: 0,
    focusZ: 140,
    player: {
      active: false, entity: null, x: 0, z: 0, vx: 0, vz: 0, halfW: 0.86, halfL: 2.18, mass: MASS.sedan,
      mode: 'car', heading: 0, speed: 0, knocks: false, jolt: false
    },
    parkedOutside: [],
    sirens: [],
    crashedObstacles: [],
    parked: [],
    roadGrip: 1,
    caution: 1,
    headway: 1,
    rainNow: 0,
    pool: [],
    poolUsed: 0,
    filled: [],
    touchedNodes: [],
    touchedEdges: [],
    frustum: new THREE.Frustum(),
    hasView: false,
    camX: 0,
    camY: 10,
    camZ: 140,
    camFwdX: 0,
    camFwdZ: 1,
    nearEdges: [],
    nearTransitEdges: [],
    nearSignals: [],
    nearX: Infinity,
    nearZ: Infinity,
    hour: 14,
    weighedHour: NaN,
    nearCarWeights: [],
    nearBikeWeights: [],
    nearPedWeights: [],
    carTarget: NUM_CARS,
    pedTarget: NUM_PEDS,
    warnedNowhere: false,
    crashed: [],
    mishap: { next: MISHAP_FIRST, v: null, o: null },
    track: { ax: 0, az: 0, ux: 0, uz: 1, len: 1, node: null, side: 0, line: 0, route: null },
    curbNodes: [],
    walkedNodes: [],
    meetingCells: new Map<string, Ped[]>(),
    nextMeeting: 0,
    dirtyPaint: new Set<THREE.InstancedMesh>(),
    dirtyState: new Set<THREE.InstancedMesh>(),
    litVehicles: [],
    litVehicleCount: 0,
    wheelCars: 0,
    visibleCars: 0,
    policeDrawn: 0,
    combisDrawn: 0,
    visibleBuses: 0,
    updates: 0,
    bodyCells: new Map<number, BodyBox[]>(),
    usedCells: [],
    bodyBoxes: [],
    bodyCount: 0,
    rayResult: { kind: '', target: null, t: 0 },
    spot: { x: 0, z: 0, heading: 0 },
    fleetSize,
    active: { car: 0, bike: 0, moto: 0, bus: 0 },
    allowed: { car: 0, bike: 0, moto: 0, bus: 0 },
    lastFocusX: Infinity,
    lastFocusZ: Infinity,
    vehicleCursor: 0,
    pedCursor: 0
  };
  return ts;
}

export type { TrafficState, TrackPick };
export { createTrafficState };
