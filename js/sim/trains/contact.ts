// js/sim/trains/contact.ts
// A train against what is in its way. The cars near the player are kinematic boxes in the vehicles' Jolt world
// (player/car-physics.ts): driven along the rails, unstoppable, they shove the player's car, a moto, a crashed wreck
// and whoever is thrown against them, and a car struck by one feels the train's speed (its crash, its damage). The
// traffic's vehicles left on the rails are rammed (sim/traffic.ts bumpBody) and people on them knocked flying
// (knockBox). The player on foot is pushed out of a car's way, and struck by one meeting them at speed; the player's own
// vehicle caught on the rails is thrown off them, spinning, and whoever is in it hurt.
import type Jolt from 'jolt-physics';
import { RAIL_CARS } from '../../models/trains.ts';
import type { CarPhysics, PhysicsVehicle } from '../../player/car-physics.ts';
import type { BumpBody } from '../traffic.ts';
import type { CarPose } from './poses.ts';

const JOLT_REACH = 60; // m from the player a car is a body in Jolt within
const TRAFFIC_REACH = 160; // m from the eye the traffic is rammed within
const PERSON_R = 0.35; // m: the player on foot, round
const STRUCK_EVERY = 0.8; // s between two blows to the player on foot (a train pushing them along keeps striking)
const MOVING = 2; // m/s a train strikes whoever it meets at (slower, it only pushes them aside)
const RIDE = 0.3; // m over the rails' top the bodies start (the trucks under them hit nothing)
const CAUGHT = 1.3; // m round a car's box the middle of the player's vehicle is caught by it within
const THROW = 0.55; // of the train's speed a vehicle struck is thrown off sideways at...
const CARRY = 0.6; // ...and along the train's way
const LIFT = 2.5; // m/s up
const SPIN = 2.2; // rad/s

/** What the contact reads of the traffic */
export interface TrainTraffic {
  bumpBody(b: BumpBody, ram?: boolean, inJolt?: boolean): void;
  knockBox(x: number, z: number, heading: number, hw: number, hl: number, vx: number, vz: number): number;
}

/** What the contact reads and moves of the player: their position (m), whether on foot, their vehicle's body in Jolt */
export interface TrainPlayer {
  position: { x: number; y: number; z: number };
  onFoot: boolean;
  vehicle: PhysicsVehicle | null;
}

/** The player struck by a car of a train: where from (m, the train's side of them), how fast it was going into them
 *  (m/s), its mass (kg), on foot or not */
export type TrainStrike = (x: number, z: number, speed: number, mass: number, onFoot: boolean) => void;

/** A car's body in Jolt: the car it is (its run's number & its index in it) and the body */
interface Bound {
  key: number;
  body: Jolt.Body;
  seen: boolean;
}

/** The poses the next physics steps drive the bodies to: `pose(key, ahead, out)` the car's at `ahead` s from now */
type PoseAhead = (key: number, ahead: number, out: CarPose) => boolean;

const keyOf = (p: CarPose) => (p.run ? p.run.id * 128 + p.index : -1);

function createTrainContact(physics: CarPhysics | null, traffic: TrainTraffic, poseAhead: PoseAhead) {
  const bound = new Map<number, Bound>();
  const shapes = new Map<string, Jolt.Shape>();
  const scratch: BumpBody = { x: 0, z: 0, heading: 0, halfW: 0, halfL: 0, speed: 0, vx: 0, vz: 0, mass: 0 };
  const target: CarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, run: null, car: null, index: 0, far: 0 };
  let ahead = 0; // s the physics has stepped since the train's last update
  let struckAt = -Infinity;
  let clock = 0;

  const J = physics?.world;
  const tmpR = J ? new J.Jolt.RVec3(0, 0, 0) : null;
  const tmpQ = J ? new J.Jolt.Quat(0, 0, 0, 1) : null;
  const tmpV = J ? new J.Jolt.Vec3(0, 0, 0) : null;

  // The pose p's body centre & turn into tmpR / tmpQ
  function place(p: CarPose, h: number): void {
    if (!tmpR || !tmpQ) return;
    tmpR.Set(p.x, p.y + RIDE + h / 2, p.z);
    // (yaw about y, then pitch about the car's x: 'YXZ' as three's)
    const cy = Math.cos(p.yaw / 2), sy = Math.sin(p.yaw / 2), cp = Math.cos(p.pitch / 2), sp = Math.sin(p.pitch / 2);
    tmpQ.Set(cy * sp, sy * cp, -sy * sp, cy * cp);
  }

  function shapeOf(kind: string, hw: number, hh: number, hl: number): Jolt.Shape | null {
    if (!J || !tmpV) return null;
    let shape = shapes.get(kind);
    if (!shape) {
      tmpV.Set(hw, hh, hl);
      const settings = new J.Jolt.BoxShapeSettings(tmpV, 0.05);
      const result = settings.Create();
      shape = result.Get();
      shape.AddRef();
      J.Jolt.destroy(result);
      J.Jolt.destroy(settings);
      shapes.set(kind, shape);
    }
    return shape;
  }

  // Before each Jolt step: every bound body driven to where its car will be once the step is through
  physics?.addSystem({
    before(dt: number) {
      if (!J || !tmpR || !tmpQ) return;
      ahead += dt;
      for (const b of bound.values()) {
        const car = b.seen && poseAhead(b.key, ahead, target) ? target.car : null;
        if (!car) continue;
        place(target, RAIL_CARS[car.kind].height - RIDE);
        J.bodies.MoveKinematic(b.body.GetID(), tmpR, tmpQ, dt);
      }
    }
  });

  /**
   * The cars `poses` (count of them) this frame against the player at `player`, the traffic round the eye (ex, ez);
   * `struck` when one strikes the player. `dt` the world's step (s)
   */
  function update(dt: number, poses: readonly CarPose[], count: number, player: TrainPlayer, ex: number, ez: number, struck: TrainStrike): void {
    clock += dt;
    ahead = 0;
    for (const b of bound.values()) b.seen = false;
    const px = player.position.x, pz = player.position.z;
    for (let i = 0; i < count; i++) {
      const p = poses[i], car = p.car;
      if (!car) continue;
      const spec = RAIL_CARS[car.kind], hw = spec.width / 2, hl = spec.length / 2 - 0.3;
      const speed = Math.hypot(p.vx, p.vz);
      const nearPlayer = Math.abs(p.x - px) < JOLT_REACH && Math.abs(p.z - pz) < JOLT_REACH;
      // in Jolt near the player
      if (nearPlayer && J && tmpR && tmpQ) {
        const key = keyOf(p);
        let b = bound.get(key);
        if (!b) {
          const shape = shapeOf(car.kind, hw, (spec.height - RIDE) / 2, hl);
          if (shape) {
            place(p, spec.height - RIDE);
            const bcs = new J.Jolt.BodyCreationSettings(shape, tmpR, tmpQ, J.Jolt.EMotionType_Kinematic, J.layers.moving);
            bcs.mFriction = 0.6;
            const body = J.bodies.CreateBody(bcs);
            J.Jolt.destroy(bcs);
            J.bodies.AddBody(body.GetID(), J.Jolt.EActivation_Activate);
            bound.set(key, (b = { key, body, seen: true }));
          }
        }
        if (b) b.seen = true;
      }
      // the traffic left on the rails rammed, people on them knocked down
      if (Math.abs(p.x - ex) < TRAFFIC_REACH && Math.abs(p.z - ez) < TRAFFIC_REACH) {
        scratch.x = p.x; scratch.z = p.z; scratch.heading = p.yaw; scratch.halfW = hw; scratch.halfL = hl;
        scratch.speed = 0; scratch.vx = p.vx; scratch.vz = p.vz; scratch.mass = spec.mass;
        traffic.bumpBody(scratch, true, nearPlayer && J !== undefined);
        traffic.knockBox(p.x, p.z, p.yaw, hw, hl, p.vx, p.vz);
      }
      if (!nearPlayer || player.position.y > p.y + spec.height) continue;
      const sn = Math.sin(p.yaw), cs = Math.cos(p.yaw);
      const rx = px - p.x, rz = pz - p.z;
      const lx = rx * cs - rz * sn, lz = rx * sn + rz * cs; // (across it, along it)
      // the player's vehicle caught on the rails: thrown off them, its side the way it is thrown, spinning
      const v = player.vehicle;
      if (!player.onFoot && v && physics && Math.abs(lx) < hw + CAUGHT && Math.abs(lz) < hl + CAUGHT && clock - struckAt > STRUCK_EVERY) {
        struckAt = clock;
        const side = lx < 0 ? -1 : 1, ax = side * cs, az = -side * sn; // (out across the track, the side it is on)
        physics.shove(v, ax * speed * THROW + p.vx * CARRY, LIFT, az * speed * THROW + p.vz * CARRY, 0, side * SPIN, 0);
        struck(px - ax * 2, pz - az * 2, speed, spec.mass, false);
      }
      // the player on foot: out of its way, and struck by it moving into them
      if (player.onFoot) {
        const ox = hw + PERSON_R - Math.abs(lx), oz = hl + PERSON_R - Math.abs(lz);
        if (ox > 0 && oz > 0) {
          // out the nearer way: its side, or its end
          let nx: number, nz: number, pen: number;
          if (ox < oz) {
            const s = lx < 0 ? -1 : 1;
            nx = s * cs; nz = -s * sn; pen = ox;
          } else {
            const s = lz < 0 ? -1 : 1;
            nx = s * sn; nz = s * cs; pen = oz;
          }
          player.position.x += nx * pen;
          player.position.z += nz * pen;
          // (met at speed, its nose or its side: a car clipping someone at the edge of the track strikes them as well,
          // thrown off it from the train's side)
          if (speed > MOVING && clock - struckAt > STRUCK_EVERY) {
            struckAt = clock;
            struck(px - nx * 2, pz - nz * 2, speed, spec.mass, true);
          }
        }
      }
    }
    // the bodies of cars gone past
    for (const [key, b] of bound) {
      if (b.seen) continue;
      J?.dropBody(b.body);
      bound.delete(key);
    }
  }

  return { update, bodies: () => bound.size };
}

export { createTrainContact, keyOf };
