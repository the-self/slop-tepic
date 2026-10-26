// js/sim/crime/types.ts
// The types of the street's crime (sim/crime.ts): the player's state, the people on foot, the patrol cars and the
// cartel's trucks, rockets, pickups, what a shot meets, and what crime reads of the controllers, the traffic, the audio
// and the aim.
import type * as THREE from 'three/webgpu';
import type { PersonRig } from '../pedestrians.ts';
import type { RagdollHandle } from '../ragdolls.ts';
import type { StreetGun } from '../crime-rules.ts';
import type { Rocket } from '../gunfire-fx.ts';
import type { AimControl } from '../../player/aim.ts';
import type { CollisionImpact } from '../../audio/audio-sources.ts';
import type { PlayerMode, PersonEntity } from '../../player/controllers.ts';
import type { TrafficSystem, Ped, Vehicle } from '../traffic.ts';

// What the player is going through: playing, or on the WASTED (killed) / BUSTED (arrested) screen
type CrimeState = 'play' | 'wasted' | 'busted';
type DownKind = Exclude<CrimeState, 'play'>;
// Who is on foot: police, gang members (the cartel's among them), thieves
type AgentKind = 'cop' | 'gang' | 'thief';
// approach (a thief closing in), flee (with the money), idle (a gang on its corner), chase, leave
type AgentState = 'approach' | 'flee' | 'idle' | 'chase' | 'leave';
// A patrol car's side: the police, the cartel's black trucks, or the army's olive ones (four stars on)
// (the bomberos' trucks & the Cruz Roja's ambulances share the patrol cars' driving: sim/emergency.ts sends them)
type Faction = 'police' | 'narco' | 'army' | 'fire' | 'ambulance';
type CruiserState = 'chase' | 'leave';
// What lies about to be picked up: money, health, armour, or a gun
type PickupKind = 'money' | 'health' | 'armor' | StreetGun | 'bazooka';
// What a shot meets first (trace)
type TraceKind = 'none' | 'wall' | 'ground' | 'agent' | 'cruiser' | 'ped' | 'vehicle' | 'heli' | 'remote' | 'prop';
// The radar's blips, flat: kind ('cop' | 'soldier' | 'thief' | 'rojos' | 'verdes' | 'narcos' | 'cruiser' | 'truck' |
// 'army' | 'heli' | a PickupKind, or fires.ts's 'fire'), x, z, kind, x, z, ...
type Blips = (string | number)[];

interface XZ {
  x: number;
  z: number;
}
// An NPC's gun: rate (shots/s, a burst's start for an SMG or a rifle), damage (hit points off the player's 100),
// range (m), burst (rounds a pull)
interface NpcGun {
  rate: number;
  damage: number;
  range: number;
  burst: number;
}
// One instanced draw of a kind of gun in NPCs' hands, and how many are drawn this frame
interface NpcGunMesh {
  mesh: THREE.InstancedMesh;
  count: number;
}

// The player's vehicle or person as crime reads it (player/controllers.ts entities): speed (m/s) along heading (rad),
// vx, vz (m/s) besides; a car's half width & length (m); the spins a blast or a ram gives a car
interface CrimePlayer {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  vx?: number;
  vz?: number;
  halfW?: number;
  halfL?: number;
  rollVel?: number;
  heaveVel?: number;
  angularVel?: number;
}
// What crime uses of player/controllers.ts's ThirdPersonControllerManager
interface CrimeControllers {
  activeMode: PlayerMode;
  entities: { person: PersonEntity };
  keys: { fire?: boolean | number };
  getActiveEntity(): CrimePlayer;
  getGroundHeight(x: number, z: number, mode?: PlayerMode, fromY?: number): number;
  isSolidAt(x: number, z: number, height?: number, ground?: number): boolean;
  groundTilt(x: number, z: number, heading: number, along: number, across: number, out: { pitch: number; roll: number }): unknown;
  resetInput(): void;
  // someone the player's car struck at (x, z), `speed` m/s: their blood on it (player/car-blood.ts)
  bloodyCar?(x: number, z: number, speed: number): void;
  // the car's tyre i burst (shot), or those over a spike strip (its middle, heading, half length & width, m): how many
  popTyre?(i: number): boolean;
  popTyresOn?(cx: number, cz: number, heading: number, halfLen: number, halfW: number): number;
}
// What crime uses of sim/traffic.ts's traffic: the road graph, its people & vehicles, and what shots, blasts and
// patrol cars do to them (walking round its vehicles only where it can tell where they are)
type CrimeTraffic = Pick<TrafficSystem, 'network' | 'peds' | 'cars' | 'buses' | 'setKnockListener' | 'panic' | 'rayHit' | 'shootPed'
  | 'shootVehicle' | 'shootTyre' | 'spikeTraffic' | 'blast' | 'roadSpot' | 'sidewalkSpot' | 'sparks' | 'bumpBody' | 'knockBox' | 'withdraw'>
  & Partial<Pick<TrafficSystem, 'vehicleBoxAt' | 'vehicleAt'>>;
// The sounds crime plays (audio/audio-system.ts CityAudioSystem)
interface CrimeAudio {
  gunfire?(kind: string, x: number, y: number, z: number): void;
  crash?(impact: CollisionImpact): void;
}
type CrimeAim = Pick<AimControl, 'active' | 'fire' | 'onTarget' | 'pitch'>;
interface CrimeOptions {
  scene: THREE.Object3D;
  controllers: CrimeControllers;
  traffic: CrimeTraffic;
  groundHeight: (x: number, z: number) => number;
  solidAt: (x: number, z: number) => boolean;
  canvas?: HTMLElement | null;
  audio?: CrimeAudio | null;
  aim?: CrimeAim | null;
  onRespawn?: ((kind: DownKind) => void) | null;
}

// Someone on foot: police (army: a soldier, in fatigues with a rifle, 150 hp), a gang member (gang: GANGS index, else
// -1) or a thief. hp of 100 (80: not police); fallen:
// their ragdoll while down; t: s in this state; cooldown & burst: their gun's; home: a gang's corner; money: what a
// thief took; arrest: s an officer has had hold of the player; los: a clear line to the player (checked every losT
// s); stepT: s of a flinch; foe: the other side's one they are shooting at (rechecked every foeT s)
interface Agent extends XZ {
  kind: AgentKind;
  gang: number;
  army: boolean;
  rig: PersonRig;
  heading: number;
  speed: number;
  hp: number;
  fallen: RagdollHandle | null;
  dead: boolean;
  state: AgentState;
  t: number;
  weapon: StreetGun | null;
  cooldown: number;
  burst: number;
  homeX: number;
  homeZ: number;
  money: number;
  arrest: number;
  idleYaw: number;
  wanderT: number;
  los: boolean;
  losT: number;
  stepT: number;
  foe: Agent | null;
  foeT: number;
}
// A patrol car, a cartel truck or an army truck, or a fire truck or ambulance (m, rad, m/s; police: on the law's side, faction says which): its meshes, its chase (path: the intersections of its route, pathI
// the next; replan s to a new one; goal where the player was then), being stuck (checked every 2 s against check;
// reverseT s backing out), wreck: s left burning; the hw, hl copies of its half sizes for boxOverlap
interface Cruiser extends XZ {
  active: boolean;
  mesh: THREE.Group;
  tiltPivot: THREE.Group;
  bodyMesh: THREE.Mesh;
  lightbar: THREE.Mesh;
  paint: THREE.Material;
  faction: Faction;
  y: number;
  heading: number;
  speed: number;
  vx: number;
  vz: number;
  halfW: number;
  halfL: number;
  hw: number;
  hl: number;
  mass: number; // kg
  type: 'car';
  police: boolean;
  hp: number;
  wreck: number;
  state: CruiserState;
  path: XZ[] | null;
  pathI: number;
  replan: number;
  stuckT: number;
  stuckCount: number;
  checkX: number;
  checkZ: number;
  reverseT: number;
  slowT: number;
  startX: number;
  startZ: number;
  goalX: number;
  goalZ: number;
  passSide: number;
  deployed: boolean;
  life: number;
  pitch: number;
  roll: number;
  lift: number; // m a blast threw it up
  vy: number;
  /** its siren wailing (the audio's; unset: as its faction has it): a fire truck or ambulance going back has it off */
  siren?: boolean;
  position: THREE.Vector3;
}
// A rocket in flight: where (m), its heading (dx, dz) and climb (dh along, dy up per m), t s since it was fired
interface RocketFlight {
  r: Rocket;
  remote?: boolean; // another player's (net/multiplayer.ts): seen and heard here, its harm judged by its shooter
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  dh?: number;
  dy?: number;
  t: number;
}
// amount: dollars, or health / armour points; life: s left lying there
interface Pickup extends XZ {
  kind: PickupKind;
  y: number;
  amount: number;
  life: number;
}
// The police helicopter (four stars on, crime/helicopter.ts), m, rad, m/s: chase (circling the player, its gunner
// firing), leave, down (shot down: falling, spinning at `spin` rad/s); orbit: rad round the player; life: s since it
// came; cooldown & burst: the gunner's; the rotor, tail rotor and beacons to animate
interface Helicopter extends XZ {
  type: 'helicopter';
  active: boolean;
  state: 'chase' | 'leave' | 'down';
  mesh: THREE.Group;
  tiltPivot: THREE.Group;
  rotor: THREE.Group;
  tail: THREE.Group;
  red: THREE.Mesh;
  blue: THREE.Mesh;
  y: number;
  heading: number;
  speed: number;
  vx: number;
  vy: number;
  vz: number;
  hp: number;
  orbit: number;
  life: number;
  pitch: number;
  roll: number;
  spin: number;
  cooldown: number;
  burst: number;
  wreck?: number; // (never: for the audio's pursuers, which skips wrecks)
  position: THREE.Vector3; // (for the audio: its rotor)
}
// What the player locks on to: one of crime's people or patrol cars, the helicopter, or a passer-by
interface LockTarget extends XZ {
  y?: number;
  mesh?: unknown;
}
/**
 * Another player, in multiplayer (net/multiplayer.ts), as shots, blows and blasts find it: its id, where it is (m) and
 * faces (rad), and its body: on foot a person's (BODY_R, PERSON_H), else its vehicle's half width & length and height
 * (m). What the player does to it goes out through CrimeSystem.onRemoteHit: its own game takes the damage.
 */
interface RemoteTarget extends XZ {
  id: number;
  y: number;
  heading: number;
  person: boolean;
  halfW: number;
  halfL: number;
  height: number;
}
/**
 * Something of the world's that shots strike (crime.props: a gas station's pumps, sim/gas-stations.ts): a post `r` m
 * round at (x, z), from the ground y up to `top` m over it; `shot` is told of each round (its damage, the player's)
 */
interface ShotProp extends XZ {
  r: number;
  y: number;
  top: number;
  shot(damage: number, byPlayer: boolean): void;
}
type TraceTarget = Agent | Cruiser | Helicopter | Ped | Vehicle | RemoteTarget | ShotProp;
// What a shot met (trace, reused): t m along it
interface TraceHit {
  t: number;
  kind: TraceKind;
  target: TraceTarget | null;
}

export type {
  CrimeState, DownKind, AgentKind, AgentState, Faction, CruiserState, PickupKind, TraceKind, Blips, XZ, NpcGun, NpcGunMesh, CrimePlayer, CrimeControllers, CrimeTraffic, CrimeAudio, CrimeAim, CrimeOptions, Agent, Cruiser, Helicopter, RocketFlight, Pickup, LockTarget, RemoteTarget, ShotProp, TraceTarget, TraceHit
};
