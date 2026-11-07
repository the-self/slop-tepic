// js/sim/gas-stations/customers.ts
// The customers' cars at the gas stations round the player: they turn in off the street by the way in, take the
// nearest free pump down their lane (world/gas-station-plan.ts: two lanes a row of islands, a pump or two in each, the
// places to queue behind), or wait in line behind the cars there; stand at the pump while it fills them up, and drive
// out by the way out onto the street, the line moving up behind them. They keep their distance from the car in front
// and stop short of the player standing or driving in their way (and queue behind the player's car at a pump), but
// don't collide: they are drawn, not in the physics. Drawn as the parked cars are (world/car-parks.ts): the traffic's
// body shapes stretched to real models, the full model near, the stand-in further.
import * as THREE from 'three/webgpu';
import { BODY_SPECS, bodyDims, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial } from '../../actors/actor-models.ts';
import { paintsOf, pickBody, pickModel } from '../../models/cars/index.ts';
import type { StationLane } from '../../world/gas-station-plan.ts';
import type { Station, StationsWorld } from '../gas-stations.ts';

const RADIUS = 240; // m from the player a station has customers
const MAX_CARS = 80; // at all the stations round the player
const NEAR_MODEL = 70; // m: the full model nearer, the ~250-triangle stand-in further
const GAP = 1.3; // m between the bumpers of cars in line
const CRAWL = 3.2; // m/s on the forecourt
const STREET = 7; // m/s on the street, coming in & going
const STREET_RUN = 12; // m of a lane's path on the street at either end (gas-station-plan.ts: from 16 m up it)
const ACCEL = 2.2; // m/s²
const BRAKE = 3.5; // m/s²
const PUMPING: [min: number, max: number] = [25, 70]; // s at the pump: filling, paying, the windscreen
const ARRIVALS: [min: number, max: number] = [10, 34]; // s between cars turning in, at a station of two lanes (more, more often)
const ENTRY = 14; // m along the lanes' paths (the same for all of a station's, up the street and in) a car keeps clear to turn in
const QUEUED = 0.6; // the chance each place in line is taken when the player comes near

interface Customer {
  run: LaneRun;
  /** m along the lane's path, m/s */
  s: number;
  v: number;
  /** the place it's going to in its lane (index into its spots), -1 none */
  spot: number;
  /** s still at the pump */
  pumping: number;
  served: boolean;
  leaving: boolean;
  body: string;
  /** its body shape stretched to its model: x, y, z */
  sx: number;
  sy: number;
  sz: number;
  halfL: number;
  paint: THREE.Color;
  x: number;
  y: number;
  z: number;
  heading: number;
  brake: number;
}
/** A lane of a station with customers: its path's length at each vertex (m), its cars front first */
interface LaneRun {
  station: Station;
  lane: StationLane;
  cum: Float64Array;
  cars: Customer[];
}
/** A station with customers: its lanes, and s to the next car turning in */
interface Visit {
  runs: LaneRun[];
  next: number;
}
/** One body shape's instanced meshes, room for MAX_CARS */
interface BodyMeshes {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const _pose = { x: 0, z: 0, heading: 0 };
const ATTRS = [['paintColor', 3], ['carState', 4]] as const; // (the per-instance attributes, and their sizes)
const dummy = new THREE.Object3D();

class Customers {
  world: StationsWorld;
  stations: readonly Station[];
  runs = new Map<Station, Visit>(); // the stations round the player, their lanes
  count = 0;
  meshes = new Map<string, BodyMeshes>();
  group = new THREE.Group();
  // the player this frame, for the places its car takes (update)
  px = 0;
  pz = 0;
  inCar = false;

  constructor(world: StationsWorld, stations: readonly Station[]) {
    this.world = world;
    this.stations = stations;
    this.group.name = 'GasStationCustomers';
    world.scene.add(this.group);
  }

  // Where a lane's path is s m along it: (x, z) and the heading (rad, 0 along +z) of its piece there, into _pose
  pose(run: LaneRun, s: number): typeof _pose {
    const { cum } = run, path = run.lane.path;
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const ax = path[k * 2 - 2], az = path[k * 2 - 1], bx = path[k * 2], bz = path[k * 2 + 1];
    const t = Math.max(0, Math.min(1, (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1)));
    _pose.x = ax + (bx - ax) * t;
    _pose.z = az + (bz - az) * t;
    _pose.heading = Math.atan2(bx - ax, bz - az);
    return _pose;
  }

  // A new customer's car in `run`, s m along its path
  add(run: LaneRun, s: number, v: number): Customer | null {
    if (this.count >= MAX_CARS) return null;
    const model = pickModel(pickBody(Math.random()), Math.random());
    if (!model) return null;
    const dims = bodyDims(BODY_SPECS[model.body]);
    const paints = paintsOf(model);
    const p = this.pose(run, s);
    const car: Customer = {
      run, s, v, spot: -1, pumping: 0, served: false, leaving: false, body: model.body,
      sx: model.size[1] / dims.width, sy: model.size[2] / dims.height, sz: model.size[0] / dims.length, halfL: model.size[0] / 2,
      paint: new THREE.Color(paints[Math.floor(Math.random() * paints.length)]),
      x: p.x, y: this.world.groundAt(p.x, p.z), z: p.z, heading: p.heading, brake: 0
    };
    this.count++;
    return car;
  }

  // The station's lanes with customers, a few already at the pumps and in line (the player has just come near)
  open(s: Station): Visit {
    const runs = s.plan.lanes.map((lane) => {
      const cum = new Float64Array(lane.path.length / 2);
      for (let k = 1; k < cum.length; k++) cum[k] = cum[k - 1] + Math.hypot(lane.path[k * 2] - lane.path[k * 2 - 2], lane.path[k * 2 + 1] - lane.path[k * 2 - 1]);
      const run: LaneRun = { station: s, lane, cum, cars: [] };
      let queue = true;
      lane.spots.forEach((spot, k) => {
        // (the pumps mostly busy; the line behind them as long as it happens to be)
        if (spot.pump ? Math.random() > 0.8 : !(queue &&= Math.random() < QUEUED)) return;
        const car = this.add(run, spot.s, 0);
        if (!car) return;
        car.spot = k;
        if (spot.pump) {
          car.served = true;
          car.pumping = rand(0, PUMPING[1]);
        }
        run.cars.push(car);
      });
      return run;
    });
    return { runs, next: rand(0, ARRIVALS[1]) };
  }

  /** The station's customers gone (it blew up; the player went away) */
  clear(s: Station): void {
    const visit = this.runs.get(s);
    if (!visit) return;
    for (const r of visit.runs) this.count -= r.cars.length;
    this.runs.delete(s);
  }

  /** The frame: the stations round the player opened & closed, every car there moved along, all drawn */
  update(dt: number): void {
    const me = this.world.active(), px = me.position.x, pz = me.position.z;
    this.px = px;
    this.pz = pz;
    for (const s of this.stations) {
      const near = !s.burnt && Math.abs(s.x - px) < RADIUS && Math.abs(s.z - pz) < RADIUS && Math.hypot(s.x - px, s.z - pz) < RADIUS;
      if (near && !this.runs.has(s)) this.runs.set(s, this.open(s));
      else if (!near && this.runs.has(s)) this.clear(s);
    }
    // the player as something to stop short of: where, its heading, half its length (a person's a step)
    const inCar = (this.inCar = me.halfL !== undefined);
    const playerHalf = me.halfL ?? 0.4;
    for (const visit of this.runs.values()) {
      this.arrive(visit, dt);
      for (const run of visit.runs) this.step(run, visit, dt, px, pz, me.heading, playerHalf, inCar);
    }
    this.draw(px, pz);
  }

  // Whether the player's car stands at place `k` of `lane` (no customer's then)
  playerAt(lane: StationLane, k: number): boolean {
    return this.inCar && Math.hypot(lane.spots[k].x - this.px, lane.spots[k].z - this.pz) < 2.6;
  }

  // A car turning in at the station, in time: into the lane with the most places free (the player's car takes one),
  // once the way in is clear
  arrive(visit: Visit, dt: number): void {
    visit.next -= dt;
    if (visit.next > 0) return;
    let pick: LaneRun | null = null, free = 0;
    for (const run of visit.runs) {
      let n = run.lane.spots.length;
      for (let k = 0; k < run.lane.spots.length; k++) if (this.playerAt(run.lane, k)) n--;
      for (const c of run.cars) {
        if (!c.leaving) n--;
        if (c.s < ENTRY) return; // (one turning in already: wait)
      }
      if (n > free || (n === free && n > 0 && Math.random() < 0.5)) { pick = run; free = n; }
    }
    visit.next = rand(ARRIVALS[0], ARRIVALS[1]) * 2 / Math.max(2, visit.runs.length);
    if (!pick) return;
    const car = this.add(pick, 0, STREET * 0.7);
    if (car) pick.cars.push(car);
  }

  // How far `car` may go before it meets `other` of another lane, its paths crossing or running together (the way in
  // & out they share): Infinity if `other` is not ahead of it. Of two each ahead of the other, the further on goes first
  roomBehind(car: Customer, other: Customer): number {
    // (ahead of it, within its width and the other's reach across its way: a car side on to it reaches further)
    const turn = Math.abs(Math.sin(other.heading - car.heading)), reach = 1 + turn * other.halfL + (1 - turn) * 0.9;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const dx = other.x - car.x, dz = other.z - car.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > 14 || Math.abs(dz * fx - dx * fz) > reach) return Infinity;
    const ox = Math.sin(other.heading), oz = Math.cos(other.heading);
    const back = -dx * ox - dz * oz;
    const mutual = back > 0 && Math.abs(-dz * ox + dx * oz) <= 1 + turn * car.halfL + (1 - turn) * 0.9;
    if (mutual && car.s / car.run.lane.length > other.s / other.run.lane.length) return Infinity;
    return along - car.halfL - (turn * 0.9 + (1 - turn) * other.halfL) - GAP;
  }

  // A lane's cars moved on, each to its pump or place in line, or out
  step(run: LaneRun, visit: Visit, dt: number, px: number, pz: number, pHeading: number, pHalf: number, inCar: boolean): void {
    const { lane, cars } = run;
    const spots = lane.spots;
    let claim = 0;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i], ahead = i ? cars[i - 1] : null;
      let target: number;
      if (car.leaving) target = lane.length + 1;
      else if (car.served) {
        target = car.s;
        claim = car.spot + 1;
        car.pumping -= dt;
        if (car.pumping <= 0) {
          car.served = false;
          car.leaving = true;
          car.spot = -1;
        }
      } else {
        // (the places the player's car stands at are no one's; one left without a place, the player having taken
        // it, gives up and drives through and out)
        while (claim < spots.length && this.playerAt(lane, claim)) claim++;
        car.spot = claim < spots.length ? claim++ : -1;
        if (car.spot < 0) car.leaving = true;
        target = car.spot >= 0 ? Math.max(car.s, spots[car.spot].s) : lane.length + 1;
      }
      // how far it may go: to its place, short of the car in front, short of the player in its way
      let room = target - car.s;
      if (ahead) room = Math.min(room, ahead.s - ahead.halfL - car.halfL - GAP - car.s);
      for (const other of visit.runs) if (other !== run) for (const o of other.cars) room = Math.min(room, this.roomBehind(car, o));
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const dx = px - car.x, dz = pz - car.z, along = dx * fx + dz * fz, across = Math.abs(dz * fx - dx * fz);
      // (the player's car side on to it reaches across further than one nose to tail)
      const reach = inCar ? 1.2 + Math.abs(Math.sin(pHeading - car.heading)) * (pHalf - 0.9) : 0.5;
      if (along > 0 && across < 1.1 + reach) room = Math.min(room, along - car.halfL - pHalf * Math.abs(Math.cos(pHeading - car.heading)) - reach - 0.8);
      const out = car.s < STREET_RUN || car.s > lane.length - STREET_RUN;
      const want = Math.min(out ? STREET : CRAWL, Math.sqrt(2 * BRAKE * Math.max(0, room - 0.05)));
      car.v = room <= 0.02 ? 0 : car.v + Math.max(-BRAKE * 2 * dt, Math.min(ACCEL * dt, want - car.v));
      car.s += Math.min(Math.max(0, car.v) * dt, Math.max(0, room));
      car.brake = car.served ? 0 : car.v < 0.05 || want < car.v - 0.1 ? 1 : 0;
      // at its pump: it stands while it fills up
      if (!car.served && !car.leaving && car.spot >= 0 && spots[car.spot].pump && spots[car.spot].s - car.s < 0.25 && car.v < 0.2) {
        car.served = true;
        car.v = 0;
        car.pumping = rand(PUMPING[0], PUMPING[1]);
      }
      if (car.v > 0) {
        const p = this.pose(run, car.s);
        car.x = p.x;
        car.z = p.z;
        // (round the bends in a curve, not piece by piece)
        let d = p.heading - car.heading;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        car.heading += d * Math.min(1, dt * 6);
        car.y = this.world.groundAt(car.x, car.z);
      }
    }
    // gone up the street
    while (cars.length && cars[0].s >= lane.length) {
      cars.shift();
      this.count--;
    }
  }

  // The cars into their body shapes' meshes (made as the first of a shape comes)
  draw(px: number, pz: number): void {
    for (const m of this.meshes.values()) m.near.count = m.far.count = 0;
    for (const visit of this.runs.values()) {
      for (const run of visit.runs) {
        for (const car of run.cars) {
          let m = this.meshes.get(car.body);
          if (!m) this.meshes.set(car.body, (m = this.makeMeshes(car.body)));
          const inst = Math.hypot(car.x - px, car.z - pz) < NEAR_MODEL ? m.near : m.far;
          const slot = inst.count++;
          dummy.position.set(car.x, car.y, car.z);
          dummy.rotation.set(0, car.heading, 0);
          dummy.scale.set(car.sx, car.sy, car.sz);
          dummy.updateMatrix();
          inst.setMatrixAt(slot, dummy.matrix);
          inst.geometry.getAttribute('paintColor').setXYZ(slot, car.paint.r, car.paint.g, car.paint.b);
          // (its brake lights while it stands in line or slows; no turn signals, no livery, not crushed)
          inst.geometry.getAttribute('carState').setXYZW(slot, car.brake, 0, 0, 0);
        }
      }
    }
    for (const m of this.meshes.values()) {
      this.upload(m.near);
      this.upload(m.far);
    }
  }

  // A mesh's instances this frame sent to the GPU, as far as they go (hidden with none)
  upload(inst: THREE.InstancedMesh): void {
    inst.visible = inst.count > 0;
    if (!inst.count) return;
    inst.instanceMatrix.clearUpdateRanges();
    inst.instanceMatrix.addUpdateRange(0, inst.count * 16);
    inst.instanceMatrix.needsUpdate = true;
    for (const [name, size] of ATTRS) {
      const attr = inst.geometry.getAttribute(name);
      if (!(attr instanceof THREE.BufferAttribute)) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, inst.count * size);
      attr.needsUpdate = true;
    }
  }

  // A body shape's two meshes, the traffic's material (the same pipelines as the parked cars')
  makeMeshes(body: string): BodyMeshes {
    const spec = BODY_SPECS[body];
    const material = createLoftedCarMaterial(spec, null, { crumple: true });
    const make = (g: THREE.BufferGeometry, name: string) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3));
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 4), 4));
      const m = new THREE.InstancedMesh(g, material, MAX_CARS);
      m.count = 0;
      m.frustumCulled = false; // (only round the player)
      m.castShadow = m.receiveShadow = true;
      m.name = name;
      this.group.add(m);
      return m;
    };
    return { near: make(buildCarGeometry(spec, true), `GasCustomers:${body}`), far: make(buildCarProxyGeometry(spec), `GasCustomers:${body}:far`) };
  }
}

export { Customers };
