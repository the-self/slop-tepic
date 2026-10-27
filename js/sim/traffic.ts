// js/sim/traffic.ts
// Manhattan traffic and pedestrians on the road graph road-network.ts derives from the city as built:
// - 200 cars (the car models of js/models/cars: taxis, police cruisers, combis and ~50 real makes drawn by rarity),
//   16 buses, 28 cyclists and 26 motorcyclists keep to their lanes and follow the vehicle ahead (Intelligent Driver
//   Model), change lanes to overtake or to reach a turn lane, turn into other streets,
//   stop for the signals street-details.ts shows, give way to oncoming traffic when turning left, to the avenue at
//   unsignalized corners and to pedestrians on crosswalks, and never enter an intersection they can't clear.
// - The buses (camiones) and the combis among the vans run Tepic's real routes (transit.ts), in their route's livery
//   and with its name on the glass or the roof.
// - 340 pedestrians follow connected sidewalks, meet to talk, and cross signalized crosswalks on WALK.
// - Fixed-size local populations replenish distant roads and sidewalks in every direction, protecting the near view.
// - The player's vehicle or character pushes and is pushed by the traffic (SAT contact, impulses, sparks), and a crash
//   bends what it hits (vehicle-damage.ts): crushed in where it was hit, smoking, and once its engine is dead stopped
//   for good, its driver out and away.
// This is the traffic's entry: createTrafficSystem makes its state (traffic/state.ts) and hands out what the rest of the
// game calls; the parts live in traffic/ (driving: idm, routing, right-of-way, junctions, driving, motion, occupancy;
// the people: sidewalks, walking, peds, bodies, carjacking; contact: collisions, overlap, crashes, two-wheelers,
// gunfire, sparks; drawing: render, meshes; the population: near, spawning, population, update), and the shore
// highways' lighter traffic in traffic/highway.ts.
import type * as THREE from 'three/webgpu';
import type { Footprint } from '../world/road-network.ts';
import type { Ragdolls } from './ragdolls.ts';
import type { CarPhysics } from '../player/car-physics.ts';
import { createTrafficState } from './traffic/state.ts';
import type {
  Vehicle, Car, Bus, TwoWheeler, Bike, Moto, Hijackable, VehicleBase, VehicleKind, DrivenVehicle, Ped, Bail, Conversation, BikeWreck,
  TrafficNode, TrafficEdge, TrafficMove, TrafficNetwork, LaneEntry, DriverModel, TrafficPlayerEntity, ParkedVehicle, SirenSource, BumpBody,
  CrashBody, CarCrash, CrashedCar,
  TrafficCollision, MayhemListener, KnockListener, SmokeEmitter, TrafficRayHit, RayAccept, BodyBox, RoadSpot, TakenVehicle,
  VehicleLook, RouteLook, LookKit, LookWheel, SolidQuery, HillQuery, SurfaceQuery
} from './traffic/types.ts';
import { setCollisionListener, setMayhemListener, setKnockListener, setRagdolls, setSolidQuery, setWallQuery, setParked, setSirens, setRoadWater } from './traffic/hooks.ts';
import { setHillQuery, setSurfaceQuery } from './traffic/surface.ts';
import { setHour } from './traffic/near.ts';
import { setPhysics, setSmokeEmitter } from './traffic/crashes.ts';
import { rayHit, shootPed, shootVehicle, shootTyre, spikeTraffic, blast, panic, knockBox } from './traffic/gunfire.ts';
import { sparksAt } from './traffic/sparks.ts';
import { bumpBody } from './traffic/collisions.ts';
import { roadSpot, sidewalkSpot } from './traffic/spawning.ts';
import { vehicleAt, vehicleBoxAt } from './traffic/bodies.ts';
import { vehicleNear, hijack, lookKit } from './traffic/carjacking.ts';
import { withdraw } from './traffic/population.ts';
import { update } from './traffic/update.ts';
import { createHighwayTraffic } from './traffic/highway.ts';
import type { HighwayLaneSpec, HighwayLane, HighwayCar, HighwayKind } from './traffic/highway.ts';

function createTrafficSystem(scene: THREE.Scene, sidewalks: readonly Footprint[], obstacles: readonly Footprint[]) {
  const ts = createTrafficState(scene, sidewalks, obstacles);
  return {
    group: ts.group,
    update: (dt: number, elapsed: number, focusPos?: { x: number; z: number } | null, playerEntity?: TrafficPlayerEntity | null, activeMode?: string, camera?: THREE.Camera | null): void => {
      update(ts, dt, elapsed, focusPos, playerEntity, activeMode, camera);
    },
    setCollisionListener: (listener: ((e: TrafficCollision) => void) | null): void => { setCollisionListener(ts, listener); },
    setMayhemListener: (listener: MayhemListener | null): void => { setMayhemListener(ts, listener); },
    setKnockListener: (fn: KnockListener | null): void => { setKnockListener(ts, fn); },
    setPhysics: (p: CarPhysics | null): void => { setPhysics(ts, p); },
    setRagdolls: (r: Ragdolls | null): void => { setRagdolls(ts, r); },
    rayHit: (ox: number, oz: number, dx: number, dz: number, range: number, accept?: RayAccept | null): TrafficRayHit | null =>
      rayHit(ts, ox, oz, dx, dz, range, accept),
    shootPed: (p: Ped, dx: number, dz: number, power?: number): void => { shootPed(ts, p, dx, dz, power); },
    shootVehicle: (v: Vehicle, x: number, y: number, z: number, dx: number, dz: number): void => { shootVehicle(ts, v, x, y, z, dx, dz); },
    shootTyre: (v: Vehicle, x: number, y: number, z: number): boolean => shootTyre(ts, v, x, y, z),
    spikeTraffic: (cx: number, cz: number, heading: number, halfLen: number, halfW: number): void => { spikeTraffic(ts, cx, cz, heading, halfLen, halfW); },
    sparks: (x: number, y: number, z: number, nx: number, nz: number, speed: number): void => { sparksAt(ts, x, y, z, nx, nz, speed); },
    blast: (x: number, z: number, radius: number, power: number): number => blast(ts, x, z, radius, power),
    panic: (x: number, z: number, radius: number): void => { panic(ts, x, z, radius); },
    knockBox: (x: number, z: number, heading: number, hw: number, hl: number, vx: number, vz: number): number =>
      knockBox(ts, x, z, heading, hw, hl, vx, vz),
    bumpBody: (b: BumpBody, ram?: boolean): void => { bumpBody(ts, b, ram); },
    roadSpot: (x: number, z: number, rMin: number, rMax: number): RoadSpot | null => roadSpot(ts, x, z, rMin, rMax),
    sidewalkSpot: (x: number, z: number, rMin: number, rMax: number): RoadSpot | null => sidewalkSpot(ts, x, z, rMin, rMax),
    setSolidQuery: (fn: SolidQuery | null): void => { setSolidQuery(ts, fn); },
    setHillQuery: (fn: HillQuery | null): void => { setHillQuery(ts, fn); },
    setSurfaceQuery: (fn: SurfaceQuery | null): void => { setSurfaceQuery(ts, fn); },
    setParked: (list: ParkedVehicle[] | null): void => { setParked(ts, list); },
    setSirens: (list: readonly SirenSource[]): void => { setSirens(ts, list); },
    setRoadWater: (wet: number, rain: number, grip?: number): void => { setRoadWater(ts, wet, rain, grip); },
    vehicleAt: (x: number, z: number, r?: number): boolean => vehicleAt(ts, x, z, r),
    vehicleBoxAt: (x: number, z: number, r?: number): BodyBox | null => vehicleBoxAt(ts, x, z, r),
    setWallQuery: (fn: SolidQuery | null): void => { setWallQuery(ts, fn); },
    setHour: (h: number): void => { setHour(ts, h); },
    // (how many vehicles and people the hour has around the focus, and how many are out: for the HUD and tests)
    demand: () => ({ hour: ts.hour, cars: ts.carTarget, people: ts.pedTarget, out: { ...ts.active } }),
    vehicleNear: (x: number, z: number, reach: number): Hijackable | null => vehicleNear(ts, x, z, reach),
    hijack: (v: Hijackable): TakenVehicle => hijack(ts, v),
    withdraw: (v: Vehicle): void => { withdraw(v); },
    lookKit: (look: VehicleLook | null): LookKit | null => lookKit(ts, look),
    setSmokeEmitter: (emit: SmokeEmitter | null): void => { setSmokeEmitter(ts, emit); },
    cars: ts.cars,
    buses: ts.buses,
    bikes: ts.bikes,
    motos: ts.motos,
    peds: ts.peds,
    network: ts.network
  };
}

type TrafficSystem = ReturnType<typeof createTrafficSystem>;
type HighwayTraffic = ReturnType<typeof createHighwayTraffic>;

export type {
  TrafficSystem, HighwayTraffic, Vehicle, Car, Bus, TwoWheeler, Bike, Moto, Hijackable, VehicleBase, VehicleKind, DrivenVehicle, Ped, Bail, Conversation, BikeWreck,
  TrafficNode, TrafficEdge, TrafficMove, TrafficNetwork, LaneEntry, DriverModel, TrafficPlayerEntity, ParkedVehicle, SirenSource, BumpBody,
  CrashBody, CarCrash, CrashedCar,
  TrafficCollision, MayhemListener, KnockListener, SmokeEmitter, TrafficRayHit, RayAccept, BodyBox, RoadSpot, TakenVehicle,
  VehicleLook, RouteLook, LookKit, LookWheel, HighwayLaneSpec, HighwayLane, HighwayCar, HighwayKind
};
export { createTrafficSystem, createHighwayTraffic };
