// js/sim/traffic/population.ts
// How many of each kind of vehicle the hour has out, and taking vehicles and people off the streets
import { carDemand } from '../traffic-demand.ts';
import { NUM_CARS, VEHICLE_KINDS } from './constants.ts';
import type { Ped, Vehicle, VehicleKind } from './types.ts';
import type { TrafficState } from './state.ts';
import { endConversation } from './walking.ts';

// How many of each kind of vehicle the hour has out (weighNear's carTarget of the NUM_CARS): the bicycles and
// motorcycles in the same share as the cars, the buses on their routes by the hour alone (none in the small hours)
const kindOf = (v: Vehicle): VehicleKind => (v.bus ? 'bus' : v.bike ? 'bike' : v.moto ? 'moto' : 'car');
function allowance(ts: TrafficState): void {
  for (const k of VEHICLE_KINDS) ts.active[k] = 0;
  for (const v of ts.vehicles) if (v.edge && !v.wreck) ts.active[kindOf(v)]++;
  const share = ts.carTarget / NUM_CARS;
  ts.allowed.car = ts.carTarget;
  ts.allowed.bike = Math.round(ts.fleetSize.bike * share);
  ts.allowed.moto = Math.round(ts.fleetSize.moto * share);
  ts.allowed.bus = Math.round(ts.fleetSize.bus * Math.max(0, Math.min(1, carDemand(ts.hour) * 1.25 - 0.1)));
}
// A traffic patrol car turned to chase the player (crime.ts takes it over as one of its own): off the streets
function withdraw(v: Vehicle): void {
  retireVehicle(v);
  v.vx = v.vz = 0;
}
// Off the streets until wanted again (like a hijacked vehicle, without its driver getting out)
function retireVehicle(v: Vehicle): void {
  v.edge = null;
  v.conn = null;
  v.trail = null;
  v.commit = null;
  v.speed = 0;
}
function retirePed(ts: TrafficState, p: Ped): void {
  if (p.conversation) endConversation(ts, p.conversation);
  p.placed = false;
  ts.ragdolls?.release(p.fallen); // (its body out of the world: its rig is the next walker's)
  p.fallen = null;
  p.bail = null;
  p.nextRoute = null;
}

export { kindOf, allowance, retireVehicle, retirePed, withdraw };
