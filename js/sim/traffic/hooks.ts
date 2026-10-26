// js/sim/traffic/hooks.ts
// What the rest of the game plugs into the traffic: its listeners (collisions, the player's mayhem, run-overs), the
// vehicles standing in the road, the weather on it, the walls knocked bodies and walkers meet, the ragdolls
import type { Ragdolls } from '../ragdolls.ts';
import type { KnockListener, MayhemListener, ParkedVehicle, SirenSource, SolidQuery, TrafficCollision } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';

function setCollisionListener(ts: TrafficState, listener: ((e: TrafficCollision) => void) | null): void {
  ts.collisionListener = typeof listener === 'function' ? listener : null;
}

// The player's own mayhem, for health & money (player/stats.ts): listener('struck', x, y, z, speed, mass) when a
// vehicle of that mass drives into the player on foot at that speed, listener('down', x, y, z) when someone the
// player knocked over has come to rest there (y: the ground under them)
function setMayhemListener(ts: TrafficState, listener: MayhemListener | null): void {
  ts.mayhemListener = typeof listener === 'function' ? listener : null;
}

// Synchronous notification: listeners must copy any fields they retain. Normal points from b toward a; y is the
// height over `base`, the road surface there (the ground, or a bridge's deck; the event carries the world's)
function reportCollision(ts: TrafficState, a: unknown, b: unknown, x: number, y: number, z: number, nx: number, nz: number, speed: number, base = hillAt(ts, x, z)): void {
  if (!ts.collisionListener || speed <= 0.5) return;
  ts.collisionEvent.a = a; ts.collisionEvent.b = b;
  ts.collisionEvent.x = x; ts.collisionEvent.y = y + base; ts.collisionEvent.z = z;
  ts.collisionEvent.nx = nx; ts.collisionEvent.nz = nz; ts.collisionEvent.speed = speed;
  ts.collisionListener(ts.collisionEvent);
}

// What stands in the road that isn't the traffic's (main.ts: the player's vehicles left there, the patrol cars),
// and the cars thrown about in a crash (crashedStep): all of it steered round, as `parked`
function setParked(ts: TrafficState, list: ParkedVehicle[] | null): void {
  ts.parkedOutside = Array.isArray(list) ? list : [];
}
// The fire trucks & ambulances on their way, sirens wailing (sim/emergency.ts): the cars ahead of them pull over
function setSirens(ts: TrafficState, list: readonly SirenSource[]): void {
  ts.sirens = list;
}
// The weather on the street (main.ts, from weather.ts RoadWater): on a wet road drivers keep further back, go a
// little slower and take the bends slower (the tyres' grip, wetGrip), and nobody brakes as hard; in the rain people
// hurry and don't stop to chat
function setRoadWater(ts: TrafficState, wet: number, rain: number, grip = 1 - 0.3 * wet): void {
  ts.roadGrip = grip;
  ts.caution = 1 - 0.12 * wet;
  ts.headway = 1 + 0.4 * wet;
  ts.rainNow = rain;
}

// Where walls stand (main.ts hands over the player's building colliders): knocked bodies bounce off them
function setSolidQuery(ts: TrafficState, fn: SolidQuery | null): void {
  ts.solidAt = typeof fn === 'function' ? fn : null;
}
// Where a building's wall stands (main.ts: solidAt without the poles & bollards), for the people walking the
// sidewalks: a turned building whose lot reaches over its sidewalk turns them round instead of letting them through
function setWallQuery(ts: TrafficState, fn: SolidQuery | null): void {
  ts.wallAt = typeof fn === 'function' ? fn : null;
}

// The people thrown about (sim/ragdolls.ts, main.ts)
function setRagdolls(ts: TrafficState, r: Ragdolls | null): void {
  ts.ragdolls = r;
}

// Told when the player runs someone over: fn(kind 'ped' | 'bike', x, z, speed)
function setKnockListener(ts: TrafficState, fn: KnockListener | null): void {
  ts.knockListener = typeof fn === 'function' ? fn : null;
}

export {
  setCollisionListener, setMayhemListener, reportCollision, setParked, setSirens, setRoadWater, setSolidQuery, setWallQuery,
  setRagdolls, setKnockListener
};
