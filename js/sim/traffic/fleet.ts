// js/sim/traffic/fleet.ts
// The traffic's vehicles: 3D lofted taxis, sedans, SUVs, pickups, vans, hatchbacks & police cruisers (200), the camiones
// on Tepic's routes (16), the cyclists and motorcyclists, and the car models they are drawn as
import * as THREE from 'three/webgpu';
import { PersonRig } from '../pedestrians.ts';
import { CAR_MODEL_BY_ID, POLICE_MODEL, TAXI_MODEL, paintsOf, pickBody, pickModel } from '../../models/cars/index.ts';
import type { CarModel } from '../../models/cars/index.ts';
import { pickMoto } from '../../models/motos/index.ts';
import { BODY_SPECS, bodyDims } from '../../actors/actor-models.ts';
import {
  BIKE_DRIVER, BUS_DRIVER, CAR_DRIVER, MASS, MOTO_DRIVER, NUM_BIKES, NUM_BUSES, NUM_CARS, NUM_MOTOS
} from './constants.ts';
import type { Bike, Bus, Car, DriverModel, Moto, VehicleBase } from './types.ts';

function createVehicle<B extends boolean>(bus: B, half: number, halfWidth: number, axle: number, driver: DriverModel, v0: number): VehicleBase & { bus: B; crash: null } {
  return {
    bus, half, halfWidth, axle, driver, v0,
    edge: null, lane: 0, s: 0, speed: 0, acc: 0, gap: Infinity, leaderSpeed: 0,
    move: null, out: 0, conn: null, cs: 0, trail: null, commit: null, claimed: false, yielding: false, yieldAt: 0,
    wait: 0, laneTimer: Math.random() * 0.5,
    dl: 0, dlv: 0, blink: 0, blinkPhase: Math.random() * 0.8,
    x: 0, z: 0, prevX: 0, prevZ: 0, tx: 0, tz: 1, nose: 0, yaw: 0, yawRate: 0, steer: 0,
    // on a bus or combi route (transit.ts): its fleet, the path, metres along it to the end of this road and to the
    // end of the next, how many moves since it last found its way along it, and the route's sign row (-1 none yet)
    fleet: null, path: null, pathS: 0, nextPathS: 0, lost: 0, sign: -1,
    pitch: 0, roll: 0, pitchVel: 0, rollVel: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0,
    pAhead: Infinity, pRight: 0, pSpeed: 0, pSide: 0, pHalfW: 0.86, pHalfL: 2.18, pParked: false, wheelSpin: Math.random() * Math.PI * 2,
    // (an attentive driver's reaction: 0.35-0.75 s from seeing the player in its way to braking or steering)
    pSeen: 0, react: 0.35 + Math.random() * 0.4, swerve: 0,
    stop: null, pullOver: 0, nextStop: 0, fare: 0,
    // crash damage (vehicle-damage.ts createDamage, made on its first hit), and stopped for good once its engine is dead
    damage: null, wrecked: false, smokeCarry: 0,
    // a car thrown about in a crash, a body in Jolt (crash)
    crash: null,
    // its headlights this frame (renderCar, renderBus)
    _camDistSq: 0, _effDist: 0, _sinY: 0, _cosY: 1, _braking: 0
  };
}

// The cars are the car models of js/models/cars (real makes, sizes & colours), each drawn with its body shape stretched
// to its size. One instanced mesh per body shape (and level of detail); whenever a car comes back into the traffic
// it is drawn again by the models' rarity, so best sellers fill the streets and supercars turn up once in a while.
// Every fifth car is a taxi and a few are state police cruisers, which keep their liveries.
const HEAVY_BODIES = new Set(['suv', 'pickup', 'van', 'wedge', 'crossover', 'offroad']);

const taxiYellow = new THREE.Color(0xffbe14);
const policeWhite = new THREE.Color(0xf6f9fc);
const paintColor = new THREE.Color();

// c becomes a `model` with the `body` shape: its size (scales of the body shape), paint and footprint
function assignModel(c: Car, body: string, model: CarModel): void {
  const dims = bodyDims(BODY_SPECS[body]);
  c.bodyType = body;
  c.model = model;
  c.sx = model.size[1] / dims.width;
  c.sy = model.size[2] / dims.height;
  c.sz = model.size[0] / dims.length;
  c.sw = Math.min(c.sy, c.sz); // (wheels keep round)
  c.half = dims.halfL * c.sz;
  c.halfWidth = dims.halfW * c.sx * 0.92;
  c.axle = BODY_SPECS[body].wheelZ * c.sz;
  c.heavy = HEAVY_BODIES.has(body); // (sounds bigger, audio-sources.ts)
  c.mass = model.mass; // kg, what it trades in a crash (massOf)
  if (c.isPolice) paintColor.copy(policeWhite);
  else if (c.isTaxi) paintColor.copy(taxiYellow);
  else {
    const paints = paintsOf(model);
    paintColor.setHex(paints[Math.floor(Math.random() * paints.length)]);
  }
  c.paint[0] = Math.fround(paintColor.r);
  c.paint[1] = Math.fround(paintColor.g);
  c.paint[2] = Math.fround(paintColor.b);
}
// The combis: white high-roof Nissan Urvans & Toyota Hiaces, as on Tepic's routes
const COMBI_MODELS = ['nissan-urvan', 'toyota-hiace'].map((id) => {
  const m = CAR_MODEL_BY_ID[id];
  if (!m) throw new Error(`No car model '${id}'`);
  return m;
});
// A fresh draw from the traffic's models (taxis, police & combis stay what they are)
function drawModel(c: Car): void {
  if (c.isTaxi || c.isPolice || c.fleet === 'combi') return;
  const body = pickBody();
  const model = pickModel(body);
  if (model) assignModel(c, body, model);
}

// The 200 cars: every 40th (from the 7th) a police cruiser, every fifth of the others a taxi and every ninth of the rest
// a combi, the others drawn from the models; and how many cruisers and combis (their light bars' and signs' meshes)
function createCars() {
  const cars: Car[] = [];
  let policeCount = 0;

  const combiWhite = new THREE.Color(0xf4f5f2);
  let combiCount = 0;
  for (let i = 0; i < NUM_CARS; i++) {
    const isPolice = (i % 40) === 6;
    const isTaxi = !isPolice && (i % 5) === 0;
    const isCombi = !isPolice && !isTaxi && (i % 9) === 4; // white Urvans & Hiaces on the routes (see buses below)
    // paint as float32 values, so renderCar() can tell whether an instance slot's paint changes by comparing
    const car: Car = Object.assign(createVehicle(false, 2.25, 0.86, 1.38, CAR_DRIVER, 10 + (i % 5) * 0.9), {
      isTaxi, isPolice, heavy: false, mass: MASS.sedan, bodyType: 'sedan', model: null, paint: [0, 0, 0], sx: 1, sy: 1, sz: 1, sw: 1,
      fleet: isCombi ? 'combi' as const : null });
    if (isPolice) {
      policeCount++;
      assignModel(car, 'sedan', POLICE_MODEL);
    } else if (isTaxi) {
      assignModel(car, 'taxi', TAXI_MODEL);
    } else if (isCombi) {
      combiCount++;
      assignModel(car, 'van', COMBI_MODELS[combiCount % COMBI_MODELS.length]);
      car.paint[0] = Math.fround(combiWhite.r);
      car.paint[1] = Math.fround(combiWhite.g);
      car.paint[2] = Math.fround(combiWhite.b);
    } else {
      drawModel(car);
    }
    cars.push(car);
  }
  return { cars, policeCount, combiCount };
}

// The 16 camiones (each takes its route's livery once on one: spawning.ts joinRoute)
function createBuses() {
  const buses: Bus[] = [];
  for (let i = 0; i < NUM_BUSES; i++) {
    const bus: Bus = Object.assign(createVehicle(true, 6.0, 1.3, 3.6, BUS_DRIVER, 8 + (i % 3)), {
      fleet: 'bus' as const,
      livery: 2 // its route's, once it has one
    });
    buses.push(bus);
  }
  return buses;
}

// Cyclists: vehicles of their own kind keeping to the right-hand lane, a frame & wheels instanced, the rider a
// PersonRig posed on the pedals (pedestrians.ts ride). Motorcyclists ride the same way, in any lane at car speeds,
// feet on the pegs. Either goes down when hit hard enough (knockRider).
const riderLooks = (seed: number, i: number) => new PersonRig({
  seed: seed + i * 1.37, scale: 0.92 + (i % 7) * 0.025, female: i % 3 === 0, girth: 0.92 + (i % 4) * 0.05, hair: (i % 5) * 0.2
});
const bikePalette = [0x0078e8, 0xd8242b, 0x1b1d22, 0xf2f2f0, 0x2f9a4b, 0xf2b705].map((c) => new THREE.Color(c));
const motoPalette = [0xc8102e, 0x14161a, 0x1f4fa8, 0xf2f2f0, 0xf26b0f, 0x2e7d32].map((c) => new THREE.Color(c));
// The cyclists and the motorcyclists (their meshes: two-wheelers.ts createTwoWheelKits)
function createBikes() {
  const bikes: Bike[] = [];
  for (let i = 0; i < NUM_BIKES; i++) {
    const bike: Bike = Object.assign(createVehicle(false, 0.95, 0.32, 0.58, BIKE_DRIVER, 4.2 + (i % 5) * 0.45), {
      bike: true as const, bodyType: 'bike' as const, color: bikePalette[i % bikePalette.length], pedal: Math.random() * 6.28, wreck: null,
      rider: riderLooks(300, i)
    });
    bikes.push(bike);
  }
  return bikes;
}
function createMotos() {
  const motos: Moto[] = [];
  for (let i = 0; i < NUM_MOTOS; i++) {
    const moto: Moto = Object.assign(createVehicle(false, 1.05, 0.4, 0.68, MOTO_DRIVER, 10.5 + (i % 5) * 1.1), {
      moto: true as const, bodyType: 'moto' as const, color: motoPalette[i % motoPalette.length], pedal: 0, wreck: null, model: pickMoto(),
      rider: riderLooks(700, i)
    });
    motos.push(moto);
  }
  return motos;
}

export { drawModel, createCars, createBuses, bikePalette, motoPalette, createBikes, createMotos };
