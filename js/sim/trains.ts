// js/sim/trains.ts
// Ferromex's freight trains through Tepic, now and then (trains/schedule.ts: in fleets one way and then the other,
// the same for everyone off the wall clock): along the main line (world/railway.ts) from the south-east edge of the
// map to the north, two or three diesels and up to fifty-odd cars at 32-40 km/h. Each frame: the runs on the line, the
// level crossings they close (the traffic waits, world/rail-crossings.ts flashes & lowers its gates), where each car
// stands (trains/poses.ts), drawn (trains/render.ts), against what is in its way (trains/contact.ts), and what they
// sound like: the diesels' rumble, the wheels, the horn's long, long, short, long at each crossing, the crossing bells.
// This is the trains' entry; ?train=1 sends one past the player half a minute after the start.
import * as THREE from 'three/webgpu';
import { mainLine, levelCrossings, nearestOnLine } from '../world/railway.ts';
import type { LevelCrossing, RailLine } from '../world/railway.ts';
import { RAIL_CARS } from '../models/trains.ts';
import { aheadOf, closes, headAt, hornOn, onLine, runsAt, summonRun } from './trains/schedule.ts';
import type { TrainRun } from './trains/schedule.ts';
import { poseCar } from './trains/poses.ts';
import type { CarPose } from './trains/poses.ts';
import { createTrainMeshes } from './trains/render.ts';
import { createTrainContact } from './trains/contact.ts';
import type { TrainPlayer, TrainStrike, TrainTraffic } from './trains/contact.ts';
import type { CarPhysics } from '../player/car-physics.ts';

/** The sounds a train makes (audio/audio-ambience.ts synthesises them) */
export type TrainSoundKind = 'locomotive' | 'wheels' | 'horn' | 'bell';
/** One of them this frame, where it is (m), its level 0..1 and how far it carries (m); the same `id` keeps its voice */
export interface TrainSound {
  kind: TrainSoundKind;
  id: object;
  x: number;
  y: number;
  z: number;
  gain: number;
  range: number;
  seed: number;
}

const DRAW = 1600; // m from the eye the cars are drawn within
const HORN_FROM = 16; // s before a crossing the engineer reaches for the horn (its first blast at 15)
const LOCO_RANGE = 650; // m the diesels are heard over
const HORN_RANGE = 1100;
const WHEEL_RANGE = 280;
const BELL_RANGE = 170;
const CATCH_UP = 0.2; // of the gap to the wall clock the trains' clock closes a second (a slow frame, the weapon wheel's slow motion)
const RESYNC = 30; // s behind or ahead of the wall clock past which it jumps back to it (a tab left in the background)

export interface TrainOptions {
  scene: THREE.Object3D;
  physics: CarPhysics | null;
  traffic: TrainTraffic;
  /** the town's floor at (x, z) (m: world/ground.ts liftAt) */
  ground: (x: number, z: number) => number;
  /** s on the wall clock now (Date.now() / 1000 by default) */
  wall?: () => number;
}

export type { TrainPlayer, TrainTraffic };

// Whether (x, y, z) is within `range` m of the listener (lx, ly, lz)
function near(x: number, y: number, z: number, lx: number, ly: number, lz: number, range: number): boolean {
  return (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2 < range * range;
}

export class TrainSystem {
  readonly line: RailLine | null;
  readonly crossings: readonly LevelCrossing[];
  /** closed[i]: level crossing i closed by a train now (its index world/railway.ts levelCrossings') */
  readonly closed: boolean[];
  /** s: the trains' clock: the player's steps (as the physics' bodies of the cars are driven), held to the wall's, so
   *  everyone sees the same train at the same time */
  time: number;
  /** the runs on the line now */
  readonly runs: TrainRun[] = [];
  /** the player struck by a car at `speed` (m/s), of `mass` (kg), on foot or in their vehicle */
  onStruck: TrainStrike | null = null;
  readonly group = new THREE.Group();
  private readonly ground: (x: number, z: number) => number;
  private readonly wall: () => number;
  private readonly cache = new Map<number, TrainRun>();
  private readonly heads: number[] = [];
  private extra: TrainRun | null = null;
  private readonly poses: CarPose[] = [];
  private count = 0;
  private readonly sources: TrainSound[] = [];
  private readonly pool: TrainSound[] = [];
  private readonly ids = new WeakMap<TrainRun, { loco: object; wheels: object; horn: object }>();
  private readonly crossingIds: object[];
  private readonly meshes: ReturnType<typeof createTrainMeshes>;
  private readonly contact: ReturnType<typeof createTrainContact>;
  private readonly struck: TrainStrike = (x, z, speed, mass, onFoot) => { this.onStruck?.(x, z, speed, mass, onFoot); };

  constructor({ scene, physics, traffic, ground, wall = () => Date.now() / 1000 }: TrainOptions) {
    this.line = mainLine();
    this.crossings = levelCrossings();
    this.closed = this.crossings.map(() => false);
    this.crossingIds = this.crossings.map(() => ({}));
    this.wall = wall;
    this.time = wall();
    this.ground = ground;
    this.group.name = 'Trains';
    scene.add(this.group);
    this.meshes = createTrainMeshes(this.group);
    this.contact = createTrainContact(physics, traffic, (key, ahead, out) => this.poseAhead(key, ahead, out));
  }

  /** Sends a train past the line's point nearest (x, z), its head there `lead` s from now */
  summon(x: number, z: number, lead = 35): void {
    if (!this.line) return;
    const { s } = nearestOnLine(this.line, x, z);
    this.extra = summonRun(-1, Math.floor(this.time) % 1000, s, this.time, this.line.length, lead);
  }

  // car (key: its run's number × 128 + its index) `ahead` s from now into `out` (contact.ts drives its body there)
  private poseAhead(key: number, ahead: number, out: CarPose): boolean {
    const line = this.line;
    if (!line) return false;
    const id = Math.floor(key / 128), index = key - id * 128;
    let r: TrainRun | null = null;
    for (const run of this.runs) if (run.id === id) r = run;
    if (!r || index >= r.cars.length) return false;
    return poseCar(line, r, index, headAt(r, this.time + ahead, line.length), this.ground, out);
  }

  /**
   * One step `dt` (s: the player's, the physics' that drives the cars' bodies): the runs on the line, the crossings they close, their cars drawn round the eye (x, z),
   * against the player (`player`) and the traffic; `night`: the lead's headlight on; the sounds, for the listener at
   * (lx, ly, lz)
   */
  update(dt: number, ex: number, ez: number, player: TrainPlayer, night: boolean, lx: number, ly: number, lz: number): void {
    const line = this.line;
    if (!line) return;
    const behind = this.wall() - this.time - dt;
    this.time += Math.abs(behind) > RESYNC ? dt + behind : dt + behind * Math.min(1, CATCH_UP * dt);
    const L = line.length, time = this.time;
    runsAt(time, L, this.cache, this.runs);
    if (this.extra) {
      if (onLine(this.extra, time, L)) this.runs.push(this.extra);
      else if ((time - this.extra.t0) * this.extra.speed > L + this.extra.length) this.extra = null; // (gone by)
    }
    const heads = this.heads;
    heads.length = 0;
    for (const r of this.runs) heads.push(headAt(r, time, L));
    // the crossings they close
    for (let i = 0; i < this.crossings.length; i++) {
      let shut = false;
      for (let k = 0; k < this.runs.length && !shut; k++) shut = closes(this.runs[k], heads[k], this.crossings[i].s);
      this.closed[i] = shut;
    }
    // where their cars stand, those round the eye
    this.count = 0;
    for (let k = 0; k < this.runs.length; k++) {
      const r = this.runs[k];
      for (let i = 0; i < r.cars.length; i++) {
        const p = this.poses[this.count] ?? (this.poses[this.count] = {
          x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, run: null, car: null, index: 0, far: 0
        });
        if (!poseCar(line, r, i, heads[k], this.ground, p)) continue;
        p.far = Math.hypot(p.x - ex, p.z - ez);
        if (p.far < DRAW) this.count++;
      }
    }
    this.meshes.draw(this.poses, this.count, ex, ez, night);
    this.contact.update(dt, this.poses, this.count, player, ex, ez, this.struck);
    this.listen(lx, ly, lz);
  }

  // The sounds this frame, for a listener at (lx, ly, lz)
  private listen(lx: number, ly: number, lz: number): void {
    this.sources.length = 0;
    // each train: its diesels at the head, its horn coming up to a crossing, its wheels nearest the listener
    let wheels: CarPose | null = null;
    for (let i = 0; i < this.count; i++) {
      const p = this.poses[i], r = p.run;
      if (!r) continue;
      let ids = this.ids.get(r);
      if (!ids) this.ids.set(r, (ids = { loco: {}, wheels: {}, horn: {} }));
      if (p.index === 0 && near(p.x, p.y, p.z, lx, ly, lz, HORN_RANGE)) {
        if (near(p.x, p.y, p.z, lx, ly, lz, LOCO_RANGE)) this.sound('locomotive', ids.loco, p.x, p.y + 3, p.z, 1, LOCO_RANGE);
        const head = headAt(r, this.time, this.line?.length ?? 0);
        let tau = Infinity;
        for (const c of this.crossings) {
          const d = aheadOf(r, head, c.s);
          if (d > 0) tau = Math.min(tau, d / r.speed);
        }
        if (tau < HORN_FROM && hornOn(tau)) this.sound('horn', ids.horn, p.x, p.y + 4.6, p.z, 1, HORN_RANGE);
      }
      const d2 = (p.x - lx) ** 2 + (p.z - lz) ** 2;
      if (!wheels || d2 < (wheels.x - lx) ** 2 + (wheels.z - lz) ** 2) wheels = p;
    }
    if (wheels?.run && near(wheels.x, wheels.y, wheels.z, lx, ly, lz, WHEEL_RANGE)) {
      const ids = this.ids.get(wheels.run);
      if (ids) this.sound('wheels', ids.wheels, wheels.x, wheels.y + 0.6, wheels.z, Math.min(1, wheels.run.speed / 10), WHEEL_RANGE);
    }
    // the bells of the closed crossings
    for (let i = 0; i < this.crossings.length; i++) {
      const c = this.crossings[i];
      if (!this.closed[i] || !near(c.x, ly, c.z, lx, ly, lz, BELL_RANGE)) continue;
      this.sound('bell', this.crossingIds[i], c.x, this.ground(c.x, c.z) + 4.2, c.z, 1, BELL_RANGE);
    }
  }

  // A sound into this frame's (the pool's next, reused)
  private sound(kind: TrainSoundKind, id: object, x: number, y: number, z: number, gain: number, range: number): void {
    const n = this.sources.length;
    const s = this.pool[n] ?? (this.pool[n] = { kind, id, x, y, z, gain, range, seed: n + 1 });
    s.kind = kind; s.id = id; s.x = x; s.y = y; s.z = z; s.gain = gain; s.range = range; s.seed = n + 1;
    this.sources.push(s);
  }

  /** What the trains sound like this frame (update's) */
  sounds(): readonly TrainSound[] {
    return this.sources;
  }

  /** Cars drawn this frame, and bodies in Jolt (for ?debug) */
  stats(): { runs: number; cars: number; bodies: number; closed: number; mass: number } {
    let mass = 0;
    for (let i = 0; i < this.count; i++) {
      const car = this.poses[i].car;
      if (car) mass += RAIL_CARS[car.kind].mass;
    }
    return { runs: this.runs.length, cars: this.count, bodies: this.contact.bodies(), closed: this.closed.filter(Boolean).length, mass };
  }
}
