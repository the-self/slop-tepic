// js/sim/crime/constants.ts
// The street crime's numbers (sim/crime.ts): how many people, patrol cars and pickups at once, people's and vehicles'
// sizes, speeds, times, sight, the NPCs' guns and aim, the pickups' colours; and the small helpers and scratch objects
// its pieces share.
import * as THREE from 'three/webgpu';
import type { StreetGun } from '../crime-rules.ts';
import type { PickupKind, NpcGun, Faction } from './types.ts';

const MAX_AGENTS = 30; // people on foot: police, soldiers, gang members, thieves
const MAX_CRUISERS = 5;
const MAX_TRUCKS = 2; // the cartel's
const MAX_ARMY = 2; // the army's trucks
const MAX_PICKUPS = 24;
// What a pickup lying on the sidewalk gives (of 100): a first-aid kit half a life back, a vest a whole armour
const HEALTH_PICKUP = 50;
const ARMOR_PICKUP = 100;
const PARKED_Y = -1000; // where unused meshes wait (still in the scene, so their pipelines compile at load)
const BODY_R = 0.34; // m: a person's radius, to shots and to each other
// m over the ground a shot aimed up or down still hits: a person, a car (or patrol car), a bus or combi
const PERSON_H = 1.85;
const CAR_H = 1.6;
const BUS_H = 3.1;
const inBody = (y: number, top: number): boolean => y >= -0.05 && y <= top;
const RUN = 5.4; // m/s: officers and gang members running
const THIEF_RUN = 6.3; // a thief runs faster than the player walks (4.4) and slower than it sprints (8.2)
const WALK = 1.4;
const DOWN_TIME = 3.5; // s someone knocked down but alive lies before getting up
const DEAD_TIME = 30; // s a body stays
const DESPAWN = 200; // m from the player: gone
const CORNER_QUIET = 300; // s a gang's corner stays empty once its whole crew is dead
const GRIP_REACH = 0.045; // m from the rig's wrist on to the middle of the grip in its hand
const DRAW_TIME = 0.32; // s to put one weapon away and bring the next up (the arsenal's own 0.25 s holds its fire)
const RESPAWN_TIME = 4.2; // s on the WASTED / BUSTED screen
const COP_SIGHT = 45; // m an officer sees the player from (a patrol car: 70)
const CRUISER_SIGHT = 70;
// rad either side of where they look that an officer (on foot or in a patrol car) sees across: a cone ahead of
// them, not all round (the helicopter, looking down, sees all round)
const COP_FOV = 0.75;
const CRUISER_FOV = 0.6;
// The army's eyes, sharper than the police's: m a soldier sees the player from, and rad either side (its trucks: ARMY_TRUCK_SIGHT)
const ARMY_SIGHT = 65;
const ARMY_FOV = 0.95;
const ARMY_TRUCK_SIGHT = 90;
// m all round in which anyone of them notices the player whichever way they look: right beside them, heard, bumped into
const NEAR_SIGHT = 8;
const CRUISER = { halfW: 0.92, halfL: 2.3, mass: 1600, accel: 7.5, brake: 14, turn: 1.9 };
const CRUISER_HP: Readonly<Record<Faction, number>> = { police: 100, narco: 140, army: 180, fire: 400, ambulance: 140 };
// The police helicopter (four stars on): it circles HELI_ORBIT m round the player HELI_ALT m over the ground, sees it
// from HELI_SIGHT m (from above: no wall hides the player), and its gunner fires bursts from the door
const HELI_ALT = 34;
const HELI_ORBIT = 30;
const HELI_SPEED = 42; // m/s, ~150 km/h
const HELI_SIGHT = 150;
const HELI_HP = 220; // a rocket brings it down, ~30 pistol rounds
const HELI_R = 2.4; // m: its body's radius to shots
const HELI_GUN: NpcGun = { rate: 0.55, damage: 5, range: 95, burst: 5 };
const HELI_RESPAWN = 50; // s before another comes after one is shot down
const NPC_GUN: Readonly<Record<StreetGun, NpcGun>> = {
  pistol: { rate: 1.1, damage: 4, range: 45, burst: 1 },
  smg: { rate: 0.8, damage: 3, range: 38, burst: 4 },
  rifle: { rate: 0.7, damage: 4, range: 60, burst: 3 }
};
const FOE_DAMAGE = 3; // police and cartel shoot each other this many times harder than at the player: fights end
const FOE_RANGE = 45; // m the police and the cartel take each other on from
const SKILL = { cop: 0.5, army: 0.58, gang: 0.35, narco: 0.45, heli: 0.4 };
const PICKUP_COLORS: Readonly<Record<PickupKind, readonly [number, number, number]>> = {
  money: [0.25, 3.2, 0.6], health: [3.2, 0.35, 0.35], armor: [0.4, 1.4, 3.4],
  pistol: [3, 2.4, 0.6], smg: [3, 1.4, 0.3], rifle: [2.6, 3, 0.4], bazooka: [3.2, 0.7, 0.2]
};

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const dummy = new THREE.Object3D();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
const tint = new THREE.Color();

export {
  MAX_AGENTS, MAX_CRUISERS, MAX_TRUCKS, MAX_ARMY, MAX_PICKUPS, HEALTH_PICKUP, ARMOR_PICKUP, PARKED_Y, BODY_R, PERSON_H, CAR_H, BUS_H, inBody, RUN, THIEF_RUN, WALK, DOWN_TIME, DEAD_TIME, DESPAWN, CORNER_QUIET, GRIP_REACH, DRAW_TIME, RESPAWN_TIME, COP_SIGHT, CRUISER_SIGHT, COP_FOV, CRUISER_FOV, ARMY_SIGHT, ARMY_FOV, ARMY_TRUCK_SIGHT, NEAR_SIGHT, CRUISER, CRUISER_HP, HELI_ALT, HELI_ORBIT, HELI_SPEED, HELI_SIGHT, HELI_HP, HELI_R, HELI_GUN, HELI_RESPAWN, NPC_GUN, FOE_DAMAGE, FOE_RANGE, SKILL, PICKUP_COLORS, clamp, rand, dummy, zero, tint
};
