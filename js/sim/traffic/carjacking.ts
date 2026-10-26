// js/sim/traffic/carjacking.ts
// CARJACKING: the player on foot takes a car or a bicycle (F, main.ts), and its driver is left in the street, to run off
// or walk back to a sidewalk
import * as THREE from 'three/webgpu';
import { BUS_MODEL } from '../../models/cars/index.ts';
import { roundBox } from '../weapons.ts';
import { BUS_SPEC, buildBusWheelGeo } from '../../actors/actor-models.ts';
import { clamp } from './constants.ts';
import type {
  Hijackable, LookKit, LookWheel, Ped, SidewalkPoint, TakenVehicle, TwoWheeler, VehicleLook
} from './types.ts';
import type { TrafficState } from './state.ts';
import { visible } from './view.ts';
import { stepBlocked, vehicleAt, vehicleBoxAt } from './bodies.ts';
import { endConversation } from './walking.ts';

const BAIL_STUN = 0.9; // s the driver stands there, facing whoever took the car
const FLEE_SPEED = 4.6; // m/s running away
const BAIL_TURN = 7; // rad/s

// The car, camión, bicycle or moto the player on foot could take: the nearest whose body is within `reach` metres of
// (x, z), going slowly enough to be stopped, its engine not dead
function vehicleNear(ts: TrafficState, x: number, z: number, reach: number): Hijackable | null {
  let best: Hijackable | null = null;
  let bestDistance = reach;
  for (const v of ts.vehicles) {
    if (v.wreck || v.wrecked || !v.edge || v.speed > 7) continue;
    const dx = x - v.x;
    const dz = z - v.z;
    if (Math.abs(dx) > 10 || Math.abs(dz) > 10) continue;
    const yaw = v.yaw + v.yawOffset;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const along = Math.max(0, Math.abs(dx * fx + dz * fz) - v.half);
    const across = Math.max(0, Math.abs(dz * fx - dx * fz) - v.halfWidth);
    const distance = Math.hypot(along, across);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = v;
    }
  }
  return best;
}

// Take v out of the traffic (it comes back elsewhere, out of sight, like any vehicle left behind) and put its
// driver out on the street: what the player's own car, bicycle or moto needs to take its place
function hijack(ts: TrafficState, v: Hijackable): TakenVehicle {
  const yaw = v.yaw + v.yawOffset;
  // (a camión or a combi keeps its route: its name on the glass or the roof, the camión its livery)
  const route = v.bus || (v.fleet === 'combi' && v.sign >= 0) ? { sign: Math.max(0, v.sign), livery: v.bus ? v.livery : 0 } : null;
  const taken: TakenVehicle = v.bike
    ? { kind: 'cyclist', x: v.x, z: v.z, heading: yaw, speed: v.speed, color: v.color.getHex() }
    : v.moto
      ? { kind: 'moto', x: v.x, z: v.z, heading: yaw, speed: v.speed, model: v.model.id, paint: v.color.getHex() }
      : v.bus
      ? { kind: 'car', bus: true, x: v.x, z: v.z, heading: yaw, speed: v.speed, bodyType: 'bus', police: false, model: BUS_MODEL.id, paint: 0xffffff, route }
      : {
          kind: 'car', x: v.x, z: v.z, heading: yaw, speed: v.speed, bodyType: v.bodyType, police: v.isPolice, model: v.model?.id,
          paint: new THREE.Color().setRGB(v.paint[0], v.paint[1], v.paint[2]).getHex(), route
        };
  taken.y = v.hy; // (the player's takes its place on the deck it drove, not on the ground under the bridge)
  // out of the driver's door (on the left: heading 0 faces +z, left is +x; a camión's driver sits at its nose), or
  // off the bicycle or the moto
  const two = v.bike || v.moto;
  const side = v.halfWidth + (two ? 0.4 : 0.55);
  const ahead = two ? 0 : v.bus ? 4.6 : 0.35;
  bail(ts, v.x + Math.cos(yaw) * side + Math.sin(yaw) * ahead, v.z - Math.sin(yaw) * side + Math.cos(yaw) * ahead, yaw, two ? v : null);
  v.edge = null;
  v.conn = null;
  v.trail = null;
  v.commit = null;
  v.speed = 0;
  return taken;
}

// The player's own copy of a camión or a combi it took (controllers.ts setCarLook, from its look: bodyType 'bus' or a
// route on a van), in the traffic's materials: one-instance meshes with their own route row and lamp state.
// { chassis: [meshes on the chassis], wheels: [{ steerPivot, tire, isFront, side }] (a camión's), lamps (its
// busState: brake, left & right signals, livery), label } or null
function lookKit(ts: TrafficState, look: VehicleLook | null): LookKit | null {
  const route = look?.route;
  const row = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array([Math.max(0, Math.min(ts.signNames.length - 1, n | 0))]), 1);
  const one = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  };
  const name = route ? ts.signNames[Math.max(0, route.sign | 0)] : null;
  if (look?.bodyType === 'bus') {
    const bodyGeo = ts.busBodyGeo.clone();
    const lamps = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 0, route ? route.livery : 2]), 4);
    bodyGeo.setAttribute('busState', lamps);
    const headerGeo = ts.busHeaderGeo.clone();
    headerGeo.setAttribute('signRow', row(route ? route.sign : 0));
    ts.busWheelGeos ??= [buildBusWheelGeo(-1), buildBusWheelGeo(1)];
    const wheels: LookWheel[] = [];
    for (const [side, isFront] of [[-1, true], [1, true], [-1, false], [1, false]] as const) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(side * BUS_SPEC.wheelX, BUS_SPEC.wheelRadius, isFront ? BUS_SPEC.wheelZ : -BUS_SPEC.wheelZ);
      const tire = new THREE.Mesh(ts.busWheelGeos[side < 0 ? 0 : 1], ts.busWheelMat);
      tire.castShadow = tire.receiveShadow = true;
      steerPivot.add(tire);
      wheels.push({ steerPivot, tire, isFront, side });
    }
    return { chassis: [one(bodyGeo, ts.busBodyMat), one(headerGeo, ts.busDestMat)], wheels, lamps, label: name ? `Camión ${name}` : 'Camión' };
  }
  if (route && look.bodyType === 'van') {
    const signGeo = ts.combiSignGeo.clone();
    signGeo.setAttribute('signRow', row(route.sign));
    return { chassis: [one(signGeo, ts.combiSignInst.material)], wheels: null, lamps: null, label: name ? `Combi ${name}` : 'Combi' };
  }
  return null;
}

// A pedestrian out of sight (or not yet placed) becomes the driver, standing at (x, z); a cyclist keeps its own
// looks (its rig swaps places with the pedestrian's, who rides the bicycle when it comes back)
function bail(ts: TrafficState, x: number, z: number, heading: number, bike: TwoWheeler | null): void {
  let p: Ped | null = null;
  let far = -1;
  for (const q of ts.peds) {
    if (q.fallen || q.bail) continue;
    if (q.placed && ts.hasView && visible(ts, q.x, q.z, 3)) continue;
    const d = q.placed ? Math.hypot(q.x - ts.focusX, q.z - ts.focusZ) : Infinity;
    if (d > far) {
      far = d;
      p = q;
    }
  }
  if (!p) return;
  if (p.conversation) endConversation(ts, p.conversation);
  if (bike) {
    const rig = p.rig;
    p.rig = bike.rider;
    bike.rider = rig;
    rig.placed = false;
  }
  Object.assign(p, { placed: true, x, z, node: null, route: null, nextRoute: null, nextLeg: 0, waiting: false, v: 0, pause: 0 });
  p.rig.placed = false;
  // stranded a moment, then either runs off or walks back to the sidewalk and carries on along it
  p.bail = { time: 0, heading, flee: Math.random() < 0.6, runFor: 5 + Math.random() * 4, goal: null, nextSearch: 0, best: Infinity, since: 0 };
}

// Can someone walk straight from (x0, z0) to (x1, z1) without going through a wall?
function clearPath(ts: TrafficState, x0: number, z0: number, x1: number, z1: number): boolean {
  if (!ts.solidAt) return true;
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
  for (let i = 1; i <= steps; i++) {
    if (ts.solidAt(x0 + (x1 - x0) * i / steps, z0 + (z1 - z0) * i / steps)) return false;
  }
  return true;
}

// The nearest point on a sidewalk track to (x, z) that can be walked to straight, among the roads around the focus
function nearestSidewalk(ts: TrafficState, x: number, z: number): SidewalkPoint | null {
  let best: SidewalkPoint | null = null;
  let bestDistance = 45;
  for (const e of ts.nearEdges) {
    const s = clamp((x - e.sx) * e.dx + (z - e.sz) * e.dz, 0, e.len);
    if (Math.hypot(e.sx + e.dx * s - x, e.sz + e.dz * s - z) > bestDistance + 15) continue;
    for (const route of ts.pedRoutes.along(e)) {
      const t = clamp((x - route.ax) * route.ux + (z - route.az) * route.uz, 0, route.len);
      const px = route.ax + route.ux * t;
      const pz = route.az + route.uz * t;
      const distance = Math.hypot(px - x, pz - z);
      if (distance < bestDistance && clearPath(ts, x, z, px, pz)) {
        bestDistance = distance;
        best = { route, t, x: px, z: pz };
      }
    }
  }
  return best;
}

function bailWalk(ts: TrafficState, p: Ped, dt: number): void {
  const b = p.bail;
  if (!b) return;
  b.time += dt;
  let target = b.heading;
  let speed = 0;
  // (what they run from: the player, or the shot or blast that scared them, see panic)
  const fromX = b.fromX ?? ts.player.x;
  const fromZ = b.fromZ ?? ts.player.z;
  if (b.time < BAIL_STUN) {
    target = Math.atan2(fromX - p.x, fromZ - p.z); // what just happened?
  } else if (b.flee && b.time < BAIL_STUN + b.runFor) {
    target = Math.atan2(p.x - fromX, p.z - fromZ);
    speed = FLEE_SPEED;
  } else {
    if (!b.goal && b.time >= b.nextSearch) {
      b.goal = nearestSidewalk(ts, p.x, p.z);
      b.nextSearch = b.time + 1.5;
      b.best = Infinity;
      b.since = b.time;
    }
    if (!b.goal) {
      // no sidewalk within reach: wander on, and once out of sight turn up somewhere else like anyone left behind
      speed = p.speed;
      if (ts.hasView && !visible(ts, p.x, p.z, 4)) {
        p.bail = null;
        p.placed = false;
        return;
      }
    } else {
      const dx = b.goal.x - p.x;
      const dz = b.goal.z - p.z;
      const distance = Math.hypot(dx, dz);
      // no closer for a while (something in the way): look for another way back
      if (distance < b.best - 0.3) {
        b.best = distance;
        b.since = b.time;
      } else if (b.time - b.since > 2.5) {
        b.goal = null;
        return;
      }
      if (distance < 0.25) {
        // on the sidewalk: walk on along it the way it was going, like everyone else
        const { route, t } = b.goal;
        Object.assign(p, route, { route });
        p.t = t;
        p.dir = Math.sin(b.heading) * route.ux + Math.cos(b.heading) * route.uz >= 0 ? 1 : -1;
        p.v = p.speed * 0.8;
        p.goalTime = 0;
        p.restTime = ts.clock + 25 + Math.random() * 45;
        p.socialTime = ts.clock + 20 + Math.random() * 30;
        p.bail = null;
        return;
      }
      target = Math.atan2(dx, dz);
      speed = Math.min(p.speed, distance / Math.max(dt, 1e-3));
    }
  }
  // a car standing in the way: round it, by its nearer end
  if (speed > 0) {
    const sn = Math.sin(target), cs = Math.cos(target);
    const box = vehicleBoxAt(ts, p.x + sn * 0.3, p.z + cs * 0.3, 0.3) ?? vehicleBoxAt(ts, p.x + sn * 0.7, p.z + cs * 0.7, 0.3);
    if (box && !vehicleAt(ts, p.x, p.z, 0.3)) target = roundBox(p.x, p.z, p.x + Math.sin(target) * 20, p.z + Math.cos(target) * 20, box, 0.7);
  }
  let turn = Math.atan2(Math.sin(target - b.heading), Math.cos(target - b.heading));
  turn = clamp(turn, -BAIL_TURN * dt, BAIL_TURN * dt);
  b.heading += turn;
  if (speed <= 0) return;
  // around walls: the first heading either side of the wanted one that is clear
  const step = speed * dt;
  for (const veer of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
    const h = b.heading + veer;
    const nx = p.x + Math.sin(h) * step;
    const nz = p.z + Math.cos(h) * step;
    if (ts.solidAt?.(nx + Math.sin(h) * 0.4, nz + Math.cos(h) * 0.4)) continue;
    if (stepBlocked(ts, p.x, p.z, nx + Math.sin(h) * 0.25, nz + Math.cos(h) * 0.25)) continue; // (round the cars too)
    p.x = nx;
    p.z = nz;
    if (veer) b.heading += veer * Math.min(1, dt * 4);
    return;
  }
}

function renderBailed(ts: TrafficState, p: Ped, dt: number): void {
  const draw = !ts.hasView || visible(ts, p.x, p.z, 7);
  p.rig.update(dt, p.x, p.z, p.bail ? p.bail.heading : Math.atan2(p.ux * p.dir, p.uz * p.dir), ts.pedGround, p, 0, draw);
  if (!draw) return;
  ts.pedCrowd.add(p.rig, Math.hypot(p.x - ts.focusX, p.z - ts.focusZ));
}

export { BAIL_STUN, vehicleNear, hijack, lookKit, bail, bailWalk, renderBailed };
