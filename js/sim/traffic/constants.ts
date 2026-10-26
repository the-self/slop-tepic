// js/sim/traffic/constants.ts
// The street traffic's numbers (fleet sizes, masses, driver models, the ranges it keeps alive round the focus), the
// camiones' liveries, and the small helpers every part of it uses
import type { DrivenVehicle, DriverModel, OnEdge, TwoWheeler, Vehicle, VehicleKind } from './types.ts';

const NUM_CARS = 200;
const NUM_BUSES = 16;
const NUM_PEDS = 340;
const NUM_BIKES = 28; // cyclists riding with the traffic (the player can knock them off)
const NUM_MOTOS = 26; // motorcyclists, likewise
const KNOCK_SPEED = 2.2; // m/s: the player's car or bicycle knocks people over above it (and riders off, driven into
// them that fast, see riderKnocked)
// Masses (kg) for the momentum traded in collisions: a person, a bicycle or a motorcycle with its rider, the cars by
// body, a bus. A bus barely notices a car; a car hardly slows for a bicycle, a little more for a motorcycle
const MASS = {
  person: 75, bike: 95, moto: 260, hatch: 1100, sedan: 1300, taxi: 1300, suv: 2100, pickup: 2200, van: 2300, bus: 12000
};
// (by body: none for the shapes not listed)
const MASS_OF_BODY: Partial<Record<string, number>> = MASS;
const massOf = (v: Vehicle): number => (v.bus ? MASS.bus : v.mass || MASS_OF_BODY[v.bodyType] || MASS.sedan);
const DOWN_TIME = 9; // s a knocked-over person lies still before getting up (out of sight, see spawnPed)
// A car of the traffic crashing within CRASH_RANGE m of the player (into the player, a car already thrown about, or
// another car knocked into it) faster than CRASH_SPEED m/s becomes a body in Jolt (player/car-physics.ts) until it has
// come to rest; at most MAX_CRASHED at once, the stillest back in the traffic first
const CRASH_RANGE = 60;
const CRASH_SPEED = 2;
const MAX_CRASHED = 10;
const CRASH_LOOKAHEAD = 0.06; // s ahead a crash is seen coming (the car is a body before it lands)
const CRASH_STILL = 1.8; // s a crashed car lies still before it drives on or is left
const CRASH_BRAKE = 6; // m/s² its driver brakes at (none left in it: it rolls)
// Now and then a driver near the player looks at their phone and runs into the car ahead (mishaps.ts): the first
// after MISHAP_FIRST s, then one every MISHAP_EVERY s (each looked for till a car is placed for it)
const MISHAP_FIRST = 150;
const MISHAP_EVERY: [number, number] = [180, 360];

// Intelligent Driver Model: max acceleration, comfortable braking, time headway, standstill gap; and the sideways
// acceleration drivers accept in bends, which sets how fast they take each turn or lane shift
const CAR_DRIVER: DriverModel = { a: 2.0, b: 3.0, T: 1.2, s0: 2.0, aLat: 3.5 };
const BUS_DRIVER: DriverModel = { a: 1.1, b: 2.5, T: 1.5, s0: 2.5, aLat: 2.0 };
const BIKE_DRIVER: DriverModel = { a: 1.0, b: 2.6, T: 1.0, s0: 1.5, aLat: 2.5 };
// ...and a motorcyclist's (its frame: two-wheelers.ts)
const MOTO_DRIVER: DriverModel = { a: 2.8, b: 3.6, T: 1.0, s0: 1.8, aLat: 4.0 };

const LOOKAHEAD = 70; // metres a driver looks ahead for vehicles, stop lines and signals

// Retire distant actors even when looking their way: keeping them indefinitely starves upcoming streets.
// Replacements may enter the far view, but nearby visible roads and sidewalks are protected from pop-in.
const VEHICLE_RADIUS = 380;
const PED_RADIUS = 320;
const NEAR_RADIUS = 350;
const VEHICLE_SPAWN_DISTANCE = 250;
const ROUTE_HEADWAY = 320; // m: the nearest two units of one route (one way along it) are ever placed to each other
const PED_SPAWN_DISTANCE = 150;

// Liveries of Tepic's camiones ([body, trim]), the first three as photographed: Progreso 2 in green, Progreso 4 white
// with a gold pinstripe, Mololoa white over blue. Other routes take one by their name (liveryOf: an index)
const LIVERIES: [body: number, trim: number][] = [
  [0x1f9a3c, 0x1f9a3c], [0xf1f2ee, 0xc9a133], [0xf1f2ee, 0x1d3480], [0xf1f2ee, 0x1f9a3c], [0xf2c21a, 0x1d3480],
  [0xf1f2ee, 0xb3221c], [0x1d4fa8, 0xf1f2ee], [0xe36a1a, 0xf1f2ee], [0xf1f2ee, 0x6a2a8a]
];
const ROUTE_LIVERIES: [RegExp, number][] = [[/^Progreso 2/, 0], [/^Progreso 4/, 1], [/^Mololoa/, 2]];
function liveryOf(name: string): number {
  const known = ROUTE_LIVERIES.find(([re]) => re.test(name));
  if (known) return known[1];
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % LIVERIES.length;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const VEHICLE_KINDS: readonly VehicleKind[] = ['car', 'bike', 'moto', 'bus'];
const onRoad = (v: Vehicle): v is DrivenVehicle => v.edge !== null && v.move !== null;
const onEdge = (v: Vehicle): v is OnEdge => v.edge !== null;
// (a two-wheeler is given its kit as soon as it is made)
const ridden = (v: Vehicle): v is TwoWheeler => v.kit !== undefined;

export {
  NUM_CARS, NUM_BUSES, NUM_PEDS, NUM_BIKES, NUM_MOTOS, KNOCK_SPEED, MASS, MASS_OF_BODY, massOf, DOWN_TIME,
  CRASH_RANGE, CRASH_SPEED, MAX_CRASHED, CRASH_LOOKAHEAD, CRASH_STILL, CRASH_BRAKE, MISHAP_FIRST, MISHAP_EVERY, CAR_DRIVER, BUS_DRIVER,
  BIKE_DRIVER, MOTO_DRIVER, LOOKAHEAD, VEHICLE_RADIUS, PED_RADIUS, NEAR_RADIUS, VEHICLE_SPAWN_DISTANCE,
  ROUTE_HEADWAY, PED_SPAWN_DISTANCE, LIVERIES, liveryOf, clamp, VEHICLE_KINDS, onRoad, onEdge, ridden
};
