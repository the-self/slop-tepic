import * as THREE from 'three/webgpu';
import { PersonCrowd } from './pedestrians.ts';
import type { RagdollHandle, Ragdolls, Point3 } from './ragdolls.ts';
import type { Weapon, WeaponId, GroundBox } from './weapons.ts';
import type { CrimeKind, StreetGun } from './crime-rules.ts';
import type { PlayerMode } from '../player/controllers.ts';
import type { Ped } from './traffic.ts';
import { WEAPONS, Arsenal } from './weapons.ts';
import { Wanted, GANGS } from './crime-rules.ts';
import { GunfireFX } from './gunfire-fx.ts';
import type {
  CrimeState, DownKind, AgentKind, Faction, PickupKind, Blips, XZ, NpcGun, NpcGunMesh, CrimePlayer, CrimeControllers,
  CrimeTraffic, CrimeAudio, CrimeAim, CrimeOptions, Agent, Cruiser, RocketFlight, Pickup, LockTarget, TraceHit, RemoteTarget
} from './crime/types.ts';
import type { Shot } from '../../shared/protocol.ts';
import { MAX_AGENTS, MAX_PICKUPS, COP_SIGHT, CRUISER_SIGHT, rand, zero } from './crime/constants.ts';
import { buildGuns, buildCruisers } from './crime/models.ts';
import { buildRoadGraph, nearestNode, route, clearLine } from './crime/road-graph.ts';
import {
  bindInput, updatePlayer, placePlayerGun, findTarget, muzzle, playerFire, punch, hurt, down, updateDown, playerSize
} from './crime/player.ts';
import { aimAlong, trace, hitScan, updateRockets, explode, showShot, blastSeen } from './crime/gunfire.ts';
import {
  spawnAgent, angerGang, removeAgent, damageAgent, knockAgent, kill, updateAgent, walkAgent, findFoe, npcShoot
} from './crime/agents.ts';
import {
  spawnCruiser, removeCruiser, damageCruiser, updateCruiser, pursue, blockerAhead, deployOfficers, moveCruiser, collideCruisers
} from './crime/cruisers.ts';
import { dispatch } from './crime/dispatch.ts';
import { buildPickups, drop, updatePickups, collect } from './crime/pickups.ts';

// js/sim/crime.ts
// The street's crime, GTA-style, played out over the traffic and the crowds (traffic.ts):
// - The player's guns (weapons.ts: fists, pistol, SMG, bazooka): lock-on aim, hit-scan shots, rockets that explode,
//   and what they do to people, cars and walls (gunfire-fx.ts draws it).
// - The wanted level (crime-rules.ts): running people over, shooting, blowing things up or attacking the police bring
//   one to five stars, lost by staying out of the police's sight. The police come on foot (to arrest, from two stars
//   to shoot) and in patrol cars that chase the player along the road graph, ram its car and drop officers off.
// - Two gangs on their turf, who shoot back (Los Rojos at anyone who comes close), and thieves who snatch the player's
//   money and run.
// - The player's health, armour and money, pickups, and being WASTED (killed) or BUSTED (arrested): back at the
//   nearest teleport spot (main.ts onRespawn).
// - Out on the town's edges a (made-up) cartel with rifles: shooting on sight, at war with the police wherever they
//   meet, sending black trucks of reinforcements after whoever takes them on.
// The people it adds are PersonRigs drawn in one crowd, dressed in their outfits (pedestrians.ts OUTFIT).
// The pieces, in crime/: types.ts (the types, all exported from here too), constants.ts (the numbers & scratch),
// models.ts (guns & patrol cars), road-graph.ts (the patrol cars' map & lines of sight), player.ts (input, firing,
// getting hurt, WASTED & BUSTED), gunfire.ts (shots, rockets & blasts), agents.ts (the people on foot), cruisers.ts
// (patrol cars & the cartel's trucks), dispatch.ts (who turns up), pickups.ts. Their functions take the CrimeSystem;
// its methods below hand on to them.

class CrimeSystem {
  scene: THREE.Object3D;
  aim: CrimeAim | null;
  controllers: CrimeControllers;
  traffic: CrimeTraffic;
  groundAt: (x: number, z: number) => number;
  solidAt: (x: number, z: number) => boolean;
  audio: CrimeAudio | null;
  onRespawn: ((kind: DownKind) => void) | null;
  // multiplayer (net/multiplayer.ts): the other players near (as targets), each shot the player fires (for the others to
  // see), a hit on one of them (its damage in hit points), and no firing while riding in someone else's car
  remotes: RemoteTarget[] = [];
  onPlayerShot: ((shot: Shot) => void) | null = null;
  onRemoteHit: ((id: number, damage: number) => void) | null = null;
  fireBlocked = false;
  personGround: (owner: unknown, x: number, z: number) => number;
  // (a burning wreck where a blast went off: fires.ts, from main.ts)
  onExplosion?: (x: number, y: number, z: number, radius: number) => void;
  ragdolls: Ragdolls | null;
  playerFall: RagdollHandle | null = null; // the player's body, killed on foot

  wanted: Wanted;
  arsenal: Arsenal;
  health: number; // 0..100
  armor: number; // 0..100
  money: number; // $
  state: CrimeState;
  stateTime: number; // s in the state
  shake: number;
  hurtFlash: number;
  toasts: string[];
  gangAnger: number[];
  lastHit: XZ;
  mouseFire: boolean;
  aimHold: number;
  drawn: WeaponId;
  drawT: number;
  lockTarget: LockTarget | null;
  punchT: number;
  aimPoint: Point3;
  _camDir: THREE.Vector3;
  _trace: TraceHit;
  _muzzle?: Point3;
  _aim?: XZ;
  _size?: [number, number];
  _playerBox?: GroundBox;
  _blips?: Blips;

  fx: GunfireFX;
  crowd: PersonCrowd;
  agents: Agent[];
  cruisers: Cruiser[];
  rockets: RocketFlight[];
  pickups: Pickup[];
  candidates: LockTarget[];
  timers: { dispatch: number; gangs: number; thief: number; health: number; bazooka: number; trucks: number }; // s to the next
  lastTurf?: number;

  // the models (buildGuns, buildCruisers, buildPickups)
  playerGuns: Record<string, THREE.Group> = {};
  npcGuns: Partial<Record<StreetGun, NpcGunMesh>> = {};
  burnt = new THREE.MeshStandardNodeMaterial({ color: 0x1d1b1a, roughness: 0.95, metalness: 0.1 });
  pickupMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshBasicNodeMaterial(), MAX_PICKUPS);
  // the road graph (buildRoadGraph): its intersections, each one's links [node, m], and the nodes in 80 m cells
  nodes: XZ[] = [];
  links: [number, number][][] = [];
  nodeCells = new Map<string, number[]>();

  // the frame's (update): the camera, the player's entity & mode, where it is (m) and how fast it goes (m/s)
  camera: THREE.Camera | null = null;
  player: CrimePlayer;
  mode: PlayerMode;
  px = 0;
  pz = 0;
  pvx = 0;
  pvz = 0;
  pspeed = 0;
  onStreet = false;

  /**
   * @param {object} o - scene, controllers (player/controllers.ts), traffic (traffic.ts), groundHeight(x, z),
   *   solidAt(x, z), canvas (the right mouse button fires from a vehicle), audio (CityAudioSystem, optional),
   *   aim (player/aim.ts, optional: free aim on foot along the camera's crosshair),
   *   onRespawn(kind 'wasted' | 'busted') puts the player back somewhere safe
   */
  constructor({ scene, controllers, traffic, groundHeight, solidAt, canvas = null, audio = null, aim = null, onRespawn = null }: CrimeOptions) {
    this.scene = scene;
    this.aim = aim;
    this.controllers = controllers;
    this.traffic = traffic;
    this.groundAt = groundHeight;
    this.solidAt = solidAt;
    this.audio = audio;
    this.onRespawn = onRespawn;
    this.personGround = (_owner, x, z) => controllers.getGroundHeight(x, z, 'person');
    this.player = controllers.getActiveEntity(); // (the frame's, from update())
    this.mode = controllers.activeMode;

    this.wanted = new Wanted();
    this.arsenal = new Arsenal();
    this.health = 100;
    this.armor = 0;
    this.money = 250;
    this.state = 'play'; // 'play' | 'wasted' | 'busted'
    this.stateTime = 0;
    this.shake = 0;
    this.hurtFlash = 0; // 0..1, for the HUD's red edges
    this.toasts = []; // messages for the HUD (crime-hud.ts takes them)
    this.gangAnger = GANGS.map(() => 0); // s a gang stays after the player
    this.lastHit = { x: 0, z: 0 };
    this.mouseFire = false;
    this.aimHold = 0; // s the player keeps the gun up after a shot
    this.drawn = this.arsenal.current; // the weapon in hand, and the time left bringing it up after a change
    this.drawT = 0;
    this.lockTarget = null;
    this.punchT = 0;
    this.aimPoint = { x: 0, y: 0, z: 0 }; // where the crosshair's ray meets something (free aim)
    this._camDir = new THREE.Vector3();
    this._trace = { t: 0, kind: 'none', target: null };

    this.fx = new GunfireFX(scene);
    this.crowd = new PersonCrowd(MAX_AGENTS, { farDistance: 40 });
    for (const m of this.crowd.meshes) scene.add(m);
    this.agents = [];
    this.cruisers = [];
    this.rockets = [];
    this.pickups = [];
    this.candidates = []; // lock-on targets, rebuilt per shot
    this.timers = { dispatch: 0, gangs: 2, thief: rand(40, 70), health: 30, bazooka: 45, trucks: 0 };

    this.buildGuns();
    this.buildCruisers();
    this.buildPickups();
    this.buildRoadGraph();
    this.bindInput(canvas);

    traffic.setKnockListener((_kind, x, z, speed) => {
      this.report('runOver');
      traffic.panic(x, z, 25);
      this.fx.splatter(x, this.groundAt(x, z) + 0.9, z, speed);
      controllers.bloodyCar?.(x, z, speed); // (on the player's car, if it was the car)
    });
    this.ragdolls = null; // (sim/ragdolls.ts, from main.ts: who falls, falls as a body)
  }

  // =========================================================================
  // 1. MODELS: guns, patrol cars, pickups (crime/models.ts, crime/pickups.ts), the road graph (crime/road-graph.ts)
  // =========================================================================
  buildGuns(): void {
    buildGuns(this);
  }

  buildCruisers(): void {
    buildCruisers(this);
  }

  buildPickups(): void {
    buildPickups(this);
  }

  buildRoadGraph(): void {
    buildRoadGraph(this);
  }

  nearestNode(x: number, z: number): number {
    return nearestNode(this, x, z);
  }

  route(x0: number, z0: number, x1: number, z1: number): XZ[] | null {
    return route(this, x0, z0, x1, z1);
  }

  // =========================================================================
  // 2. INPUT: fire, weapons 1-4, R to cycle (crime/player.ts), Tab for the wheel (ui/weapon-wheel.ts)
  // =========================================================================
  bindInput(canvas: HTMLElement | null): void {
    bindInput(this, canvas);
  }

  selectWeapon(id: WeaponId): boolean {
    if (this.arsenal.select(id)) return true;
    this.toast(`No ${WEAPONS[id].label.toLowerCase()} rounds`);
    return false;
  }

  cycleWeapon(dir = 1): void {
    this.arsenal.cycle(dir);
  }

  toast(text: string): void {
    this.toasts.push(text);
    if (this.toasts.length > 4) this.toasts.shift();
  }

  // =========================================================================
  // 3. THE FRAME
  // =========================================================================
  update(dt: number, elapsed: number, camera: THREE.Camera): void {
    const c = this.controllers;
    const mode = c.activeMode;
    const pe = c.getActiveEntity();
    this.camera = camera;
    this.player = pe;
    this.mode = mode;
    this.px = pe.position.x;
    this.pz = pe.position.z;
    const heading = pe.heading || 0;
    const speed = pe.speed || 0;
    this.pvx = Math.sin(heading) * speed + (pe.vx || 0);
    this.pvz = Math.cos(heading) * speed + (pe.vz || 0);
    this.pspeed = Math.hypot(this.pvx, this.pvz);
    // (on the street: not flying, nor up on a roof)
    this.onStreet = mode !== 'helicopter' && pe.position.y - this.groundAt(this.px, this.pz) < 2.6;

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    for (let g = 0; g < this.gangAnger.length; g++) this.gangAnger[g] = Math.max(0, this.gangAnger[g] - dt);

    if (this.state !== 'play') this.updateDown(dt);
    else this.updatePlayer(dt, elapsed);

    this.updateRockets(dt);
    this.crowd.begin();
    for (const guns of Object.values(this.npcGuns)) guns.count = 0;
    for (let i = this.agents.length - 1; i >= 0; i--) this.updateAgent(this.agents[i], dt);
    this.crowd.end();
    for (const { mesh, count } of Object.values(this.npcGuns)) {
      mesh.count = Math.max(1, count);
      if (!count) mesh.setMatrixAt(0, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const cr of this.cruisers) if (cr.active) this.updateCruiser(cr, dt);
    this.collideCruisers();
    this.updatePickups(dt, elapsed);

    // the police see the player: the stars stay
    let seen = false;
    for (const a of this.agents) {
      if (a.kind === 'cop' && !a.fallen && a.state !== 'leave' && Math.hypot(a.x - this.px, a.z - this.pz) < COP_SIGHT) seen = true;
    }
    for (const cr of this.cruisers) {
      if (cr.active && !cr.wreck && cr.police && Math.hypot(cr.x - this.px, cr.z - this.pz) < CRUISER_SIGHT) seen = true;
    }
    if (this.state === 'play') this.wanted.update(dt, seen);
    this.dispatch(dt);
    this.fx.update(dt);
  }

  // The camera shaken by nearby blasts (after the camera system has placed it)
  shakeCamera(camera: THREE.Camera): void {
    if (this.shake <= 0.001) return;
    const s = this.shake * this.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  // The player's vehicles and the patrol cars, for the traffic to stop behind (traffic.ts setParked)
  addObstacles<T>(list: (T | Cruiser)[]): (T | Cruiser)[] {
    for (const cr of this.cruisers) if (cr.active) list.push(cr);
    return list;
  }

  // Patrol cars for the audio's sirens (audio-sources.ts)
  sirenSources(): Cruiser[] {
    return this.cruisers;
  }

  // =========================================================================
  // 4. THE PLAYER: firing, aiming, getting hurt (crime/player.ts, crime/gunfire.ts)
  // =========================================================================
  updatePlayer(dt: number, _elapsed: number): void {
    updatePlayer(this, dt, _elapsed);
  }

  placePlayerGun(w: Weapon): void {
    placePlayerGun(this, w);
  }

  findTarget(x: number, z: number, heading: number, range: number, cone: number): LockTarget | null {
    return findTarget(this, x, z, heading, range, cone);
  }

  muzzle(out: Point3): Point3 {
    return muzzle(this, out);
  }

  playerFire(w: Weapon): void {
    playerFire(this, w);
  }

  aimAlong(camera: THREE.Camera | null, w: Weapon): TraceHit {
    return aimAlong(this, camera, w);
  }

  trace(ox: number, oy: number, oz: number, yaw: number, range: number, slope?: number | null, from?: number): TraceHit {
    return trace(this, ox, oy, oz, yaw, range, slope, from);
  }

  hitScan(ox: number, oy: number, oz: number, yaw: number, ty: number, w: Weapon, byPlayer: boolean, slope?: number | null): void {
    hitScan(this, ox, oy, oz, yaw, ty, w, byPlayer, slope);
  }

  punch(): void {
    punch(this);
  }

  // ((fromX, fromZ) left out: the player's own place)
  hurt(amount: number, fromX?: number, fromZ?: number): void {
    hurt(this, amount, fromX, fromZ);
  }

  report(kind: CrimeKind, witnessed = true): void {
    if (this.state !== 'play') return;
    const gained = this.wanted.report(kind, witnessed);
    if (gained > 0 && this.wanted.stars === 1) this.toast('The police are after you');
  }

  // One of crime's own people (not a passer-by of the traffic's)
  isAgent(o: Agent | Ped): o is Agent {
    return (this.agents as readonly object[]).includes(o);
  }

  copNear(x: number, z: number, r: number): boolean {
    for (const a of this.agents) {
      if (a.kind === 'cop' && !a.fallen && Math.hypot(a.x - x, a.z - z) < r) return true;
    }
    for (const cr of this.cruisers) {
      if (cr.active && !cr.wreck && cr.police && Math.hypot(cr.x - x, cr.z - z) < r) return true;
    }
    return false;
  }

  // =========================================================================
  // 5. WASTED & BUSTED (crime/player.ts)
  // =========================================================================
  down(kind: DownKind): void {
    down(this, kind);
  }

  updateDown(dt: number): void {
    updateDown(this, dt);
  }

  // =========================================================================
  // 6. ROCKETS & EXPLOSIONS (crime/gunfire.ts)
  // =========================================================================
  updateRockets(dt: number): void {
    updateRockets(this, dt);
  }

  showShot(s: Shot): void {
    showShot(this, s);
  }

  blastSeen(x: number, y: number, z: number, radius: number): void {
    blastSeen(this, x, y, z, radius);
  }

  explode(x: number, y: number, z: number, radius: number, damage: number, byPlayer: boolean): void {
    explode(this, x, y, z, radius, damage, byPlayer);
  }

  // =========================================================================
  // 7. PEOPLE: police on foot, gangs, thieves (crime/agents.ts)
  // =========================================================================
  spawnAgent(kind: AgentKind, x: number, z: number, opts?: { gang?: number; weapon?: StreetGun | null }): Agent | null {
    return spawnAgent(this, kind, x, z, opts);
  }

  angerGang(g: number): void {
    angerGang(this, g);
  }

  removeAgent(a: Agent): void {
    removeAgent(this, a);
  }

  damageAgent(a: Agent, damage: number, nx: number, nz: number, byPlayer: boolean, throwSpeed?: number): void {
    damageAgent(this, a, damage, nx, nz, byPlayer, throwSpeed);
  }

  knockAgent(a: Agent, vx: number, vz: number, nx: number, nz: number, byCar?: boolean, bleed?: number): void {
    knockAgent(this, a, vx, vz, nx, nz, byCar, bleed);
  }

  kill(a: Agent): void {
    kill(this, a);
  }

  updateAgent(a: Agent, dt: number): void {
    updateAgent(this, a, dt);
  }

  walkAgent(a: Agent, goalYaw: number, speed: number, dt: number): void {
    walkAgent(this, a, goalYaw, speed, dt);
  }

  clearLine(x0: number, z0: number, x1: number, z1: number): boolean {
    return clearLine(this, x0, z0, x1, z1);
  }

  findFoe(a: Agent): Agent | null {
    return findFoe(this, a);
  }

  npcShoot(a: Agent, gun: NpcGun, skill: number, dist: number, _dt: number, foe?: Agent | null): void {
    npcShoot(this, a, gun, skill, dist, _dt, foe);
  }

  // =========================================================================
  // 8. PATROL CARS (crime/cruisers.ts)
  // =========================================================================
  spawnCruiser(faction?: Faction): Cruiser | null {
    return spawnCruiser(this, faction);
  }

  removeCruiser(cr: Cruiser): void {
    removeCruiser(cr);
  }

  damageCruiser(cr: Cruiser, damage: number, byPlayer: boolean): void {
    damageCruiser(this, cr, damage, byPlayer);
  }

  updateCruiser(cr: Cruiser, dt: number): void {
    updateCruiser(this, cr, dt);
  }

  pursue(cr: Cruiser, look: number): boolean {
    return pursue(this, cr, look);
  }

  blockerAhead(cr: Cruiser): number {
    return blockerAhead(this, cr);
  }

  deployOfficers(cr: Cruiser): void {
    deployOfficers(this, cr);
  }

  // ((tx, tz) left out: where it is)
  moveCruiser(cr: Cruiser, dt: number, want: number, tx?: number, tz?: number): void {
    moveCruiser(this, cr, dt, want, tx, tz);
  }

  playerSize(): [number, number] | null {
    return playerSize(this);
  }

  collideCruisers(): void {
    collideCruisers(this);
  }

  // =========================================================================
  // 9. WHO TURNS UP: the police for the stars, gangs on their turf, thieves, pickups (crime/dispatch.ts)
  // =========================================================================
  dispatch(dt: number): void {
    dispatch(this, dt);
  }

  // =========================================================================
  // 10. PICKUPS (crime/pickups.ts)
  // =========================================================================
  drop(kind: PickupKind, x: number, z: number, amount?: number, life?: number): void {
    drop(this, kind, x, z, amount, life);
  }

  updatePickups(dt: number, elapsed: number): void {
    updatePickups(this, dt, elapsed);
  }

  collect(p: Pickup): void {
    collect(this, p);
  }

  // Positions on the minimap: { kind: 'cop' | 'cruiser' | 'gang' | 'thief' | <pickup kind>, x, z } (reused)
  blips(out: Blips = (this._blips ??= [])): Blips {
    out.length = 0;
    for (const a of this.agents) if (!a.dead) out.push(a.kind === 'gang' ? ['rojos', 'verdes', 'narcos'][a.gang] : a.kind, a.x, a.z);
    for (const cr of this.cruisers) if (cr.active && !cr.wreck) out.push(cr.police ? 'cruiser' : 'truck', cr.x, cr.z);
    for (const p of this.pickups) out.push(p.kind, p.x, p.z);
    return out;
  }
}

export type {
  CrimeState, DownKind, AgentKind, AgentState, Faction, CruiserState, PickupKind, TraceKind, Blips, NpcGun, CrimePlayer,
  CrimeControllers, CrimeTraffic, CrimeAudio, CrimeAim, CrimeOptions, Agent, Cruiser,
  RocketFlight, Pickup, LockTarget, RemoteTarget, TraceHit
} from './crime/types.ts';
export { CrimeSystem };
