// js/player/controllers/constants.ts
// The player controller's numbers and lookups that touch none of its state: where everyone spawns, the HUD's names,
// the car model a look is, the crash and fall thresholds, the bicycle's body, and the walker's ground
import { CITY } from '../../world/city-config.ts';
import { BODY_SPECS } from '../../actors/actor-models.ts';
import { PEDALS } from '../drivetrain.ts';
import { CAR_MODEL_BY_ID, TAXI_MODEL, POLICE_MODEL, pickModel } from '../../models/cars/index.ts';
import type { CarModel } from '../../models/cars/index.ts';
import type { BodySpec } from '../../models/bodies.ts';
import type { PlayerMode } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';


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
// Getting out faster than this (m/s, ~15 km/h) the player jumps out of the car, or off the moto, and tumbles along the
// road (boarding.ts leaveVehicle), GTA-style
const BAIL_SPEED = 4;
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


export {
  START, SPAWN, LEFT_CARS, LABELS, groundCollider, SPEC_BY_NAME, modelFor, AIM_WALK, EJECT_SPEED, GET_UP, BAIL_SPEED, THROW_SPEED,
  DOWN_LEAN, BRAKE_LIMIT, SMOKE_PUFFS, BICYCLE_BODY, personGround
};
