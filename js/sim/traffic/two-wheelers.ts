// js/sim/traffic/two-wheelers.ts
// Cyclists and motorcyclists: their frames and meshes, the player against them, riders thrown off, and the bike down on
// the road
import * as THREE from 'three/webgpu';
import { PersonCrowd } from '../pedestrians.ts';
import type { RideFrame } from '../pedestrians.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { riderKnocked, slide } from '../mayhem.ts';
import { bleedOf, throwVelocity } from '../ragdolls.ts';
import { DOWN_TIME, KNOCK_SPEED, MASS, NUM_BIKES, NUM_MOTOS, clamp, massOf } from './constants.ts';
import type { Bike, DrivenVehicle, Moto, TwoWheelKit, TwoWheeler } from './types.ts';
import type { TrafficState } from './state.ts';
import { reportCollision } from './hooks.ts';
import { surfaceAt } from './surface.ts';
import { visible } from './view.ts';
import { shove } from './motion.ts';
import { overlapWithPlayer } from './overlap.ts';
import { spawnCollisionSparks } from './sparks.ts';
import { bikePalette, motoPalette } from './fleet.ts';

// Bicycle frame (see controllers.ts createCyclistEntity): the rider's seat, bars & pedals
const BIKE_FRAME: RideFrame = {
  seat: new THREE.Vector3(0, 0.98, -0.28),
  bars: new THREE.Vector3(0, 0.98, 0.4),
  gripHalf: 0.22,
  bracket: new THREE.Vector3(0, 0.34, -0.145),
  crankLength: 0.17
};
// Motorcycle (motoBodyGeo / motoPartsGeo): the rider's seat & bars, feet still on the pegs
const MOTO_FRAME: RideFrame = {
  seat: new THREE.Vector3(0, 0.94, -0.2),
  bars: new THREE.Vector3(0, 1.04, 0.44),
  gripHalf: 0.3,
  bracket: new THREE.Vector3(0, 0.36, -0.04),
  crankLength: 0,
  footHalf: 0.2
};

// The instanced meshes of each kind of two-wheeler (its kit, given to every bike of the kind), the riders' crowd and
// the frame a rider is posed on; added to the group
function createTwoWheelKits(group: THREE.Group, bikes: Bike[], motos: Moto[]) {
  const bikeFrameGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.022, 0.022, 0.72, 6).rotateX(Math.PI * 0.46).translate(0, 0.78, 0.04),
    new THREE.CylinderGeometry(0.026, 0.026, 0.78, 6).rotateX(Math.PI * 0.28).translate(0, 0.58, 0.16),
    new THREE.CylinderGeometry(0.022, 0.022, 0.64, 6).rotateX(-0.22).translate(0, 0.66, -0.22),
    new THREE.CylinderGeometry(0.02, 0.016, 0.68, 6).rotateX(-0.24).translate(0, 0.68, 0.48),
    new THREE.CylinderGeometry(0.018, 0.018, 0.48, 6).rotateZ(Math.PI * 0.5).translate(0, 0.98, 0.40),
    new THREE.BoxGeometry(0.1, 0.05, 0.25).translate(0, 0.96, -0.28)
  ]);
  const bikeWheelGeo = mergeGeometries([
    new THREE.TorusGeometry(0.35, 0.038, 6, 20).rotateY(Math.PI * 0.5).translate(0, 0.38, 0.58),
    new THREE.TorusGeometry(0.35, 0.038, 6, 20).rotateY(Math.PI * 0.5).translate(0, 0.38, -0.58)
  ]);
  // A small street motorcycle (125-150 cc): painted tank, side covers, fenders & tail; the rest black or bare metal
  const motoBodyGeo = mergeGeometries([
    new THREE.BoxGeometry(0.3, 0.17, 0.46).translate(0, 0.86, 0.2), // tank
    new THREE.BoxGeometry(0.26, 0.2, 0.3).translate(0, 0.7, -0.22), // side covers
    new THREE.BoxGeometry(0.18, 0.08, 0.5).rotateX(-0.12).translate(0, 0.86, -0.62), // tail
    new THREE.BoxGeometry(0.12, 0.03, 0.42).rotateX(0.35).translate(0, 0.62, 0.7), // front fender
    new THREE.CylinderGeometry(0.1, 0.11, 0.1, 10).rotateX(Math.PI * 0.5).translate(0, 0.95, 0.6) // headlight shell
  ]);
  const motoPartsGeo = mergeGeometries([
    new THREE.TorusGeometry(0.27, 0.06, 6, 18).rotateY(Math.PI * 0.5).translate(0, 0.31, 0.68),
    new THREE.TorusGeometry(0.27, 0.06, 6, 18).rotateY(Math.PI * 0.5).translate(0, 0.31, -0.66),
    new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8).rotateZ(Math.PI * 0.5).translate(0, 0.31, 0.68), // hubs
    new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8).rotateZ(Math.PI * 0.5).translate(0, 0.31, -0.66),
    new THREE.BoxGeometry(0.24, 0.3, 0.4).translate(0, 0.44, 0.02), // engine
    new THREE.BoxGeometry(0.27, 0.08, 0.6).translate(0, 0.97, -0.22), // seat
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6).rotateX(-0.42).translate(0.09, 0.64, 0.55), // fork
    new THREE.CylinderGeometry(0.025, 0.025, 0.72, 6).rotateX(-0.42).translate(-0.09, 0.64, 0.55),
    new THREE.CylinderGeometry(0.018, 0.018, 0.66, 6).rotateZ(Math.PI * 0.5).translate(0, 1.04, 0.44), // bars
    new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6).rotateX(0.5).translate(0.08, 0.5, -0.38), // swingarm
    new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6).rotateX(0.5).translate(-0.08, 0.5, -0.38),
    new THREE.CylinderGeometry(0.045, 0.035, 0.62, 8).rotateX(Math.PI * 0.5 - 0.12).translate(0.17, 0.42, -0.36), // exhaust
    new THREE.BoxGeometry(0.42, 0.025, 0.05).translate(0, 0.34, -0.06) // pegs
  ]);
  const twoWheelMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.castShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    return m;
  };
  // The instanced meshes of each kind of two-wheeler, the frame its rider sits on, and how many are drawn this frame
  const bikeKit: TwoWheelKit = {
    frame: twoWheelMesh(bikeFrameGeo, new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.4 }), NUM_BIKES),
    wheels: twoWheelMesh(bikeWheelGeo, new THREE.MeshStandardNodeMaterial({ color: 0x181a1e, roughness: 0.6 }), NUM_BIKES),
    seat: BIKE_FRAME, drawn: 0
  };
  const motoKit: TwoWheelKit = {
    frame: twoWheelMesh(motoBodyGeo, new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.25 }), NUM_MOTOS),
    wheels: twoWheelMesh(motoPartsGeo, new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0.45 }), NUM_MOTOS),
    seat: MOTO_FRAME, drawn: 0
  };
  const kits = [bikeKit, motoKit];
  for (const v of bikes) v.kit = bikeKit;
  for (const v of motos) v.kit = motoKit;
  for (let i = 0; i < NUM_BIKES; i++) bikeKit.frame.setColorAt(i, bikePalette[0]);
  for (let i = 0; i < NUM_MOTOS; i++) motoKit.frame.setColorAt(i, motoPalette[0]);
  const riderCrowd = new PersonCrowd(NUM_BIKES + NUM_MOTOS);
  const bikeRoot = new THREE.Object3D();
  for (const kit of kits) group.add(kit.frame, kit.wheels);
  return { kits, riderCrowd, bikeRoot };
}

// The player against a cyclist or motorcyclist, over the whole of the bike: hit hard enough (the speed between them),
// a car or bicycle knocks its rider off (true); slower, the two are just eased apart. A bike is never shunted like a
// car (collideWithPlayer), which threw it about with sparks and crash sounds instead of knocking its rider down
function contactRider(ts: TrafficState, v: DrivenVehicle & TwoWheeler): boolean {
  const pe = ts.player.entity;
  if (!pe) return false;
  const relX = pe.position.x - v.x;
  const relZ = pe.position.z - v.z;
  if (Math.abs(relX) > v.half + ts.player.halfL + 1 || Math.abs(relZ) > v.half + ts.player.halfL + 1) return false;
  const rotY = v.yaw + v.yawOffset;
  const hit = overlapWithPlayer(relX, relZ, rotY, v.halfWidth, v.half, ts.player.heading, ts.player.halfW, ts.player.halfL);
  if (!hit) return false;
  const bvx = v.tx * v.speed + v.vx;
  const bvz = v.tz * v.speed + v.vz;
  if (riderKnocked(ts.player.mode, ts.player.vx - bvx, ts.player.vz - bvz, -hit.nx, -hit.nz, KNOCK_SPEED)) {
    knockRider(ts, v, -hit.nx, -hit.nz, bvx, bvz);
    return true;
  }
  // (shared by their masses: a bike gives way to a car, a pedestrian to a motorcycle)
  const give = ts.player.mass / (ts.player.mass + massOf(v));
  pe.position.x += hit.nx * hit.pen * (1 - give);
  pe.position.z += hit.nz * hit.pen * (1 - give);
  if (pe.mesh) pe.mesh.position.copy(pe.position);
  shove(ts, v, -hit.nx * hit.pen * give, -hit.nz * hit.pen * give);
  // up against the player ahead, it can go no faster than they do
  if (hit.nx * v.tx + hit.nz * v.tz > 0.5) v.speed = Math.min(v.speed, Math.max(0, ts.player.vx * v.tx + ts.player.vz * v.tz));
  return false;
}

// Rider v comes off, thrown away from the player along (nx, nz): with the player's momentum, or its own if it was the
// faster (a bike running into the back of a car), its bike sliding on and falling on its side
// Rider v comes off, thrown away from the player along (nx, nz): with the player's momentum, or its own if it was the
// faster (a bike running into the back of a car), its bike sliding on and falling on its side
function knockRider(ts: TrafficState, v: TwoWheeler, nx: number, nz: number, bvx: number, bvz: number): void {
  const own = Math.hypot(bvx, bvz) > ts.player.speed;
  throwRider(ts, v, nx, nz, own ? bvx : ts.player.vx, own ? bvz : ts.player.vz, own ? Infinity : ts.player.mass);
  reportCollision(ts, ts.player.entity, v, v.x, 0.9, v.z, -nx, -nz, Math.hypot(ts.player.vx - bvx, ts.player.vz - bvz), v.hy);
  if (ts.knockListener) ts.knockListener('bike', v.x, v.z, ts.player.speed);
  if (ts.player.entity && typeof ts.player.entity.speed === 'number') ts.player.entity.speed *= ts.player.mass / (ts.player.mass + massOf(v));
}

// Throws rider v off at velocity (tvx, tvz) along (nx, nz), its bike taking the share of it that a hitter of `mass`
// gives (Infinity: all of it, its own speed). Also what shots and blasts do (crime.ts)
function throwRider(ts: TrafficState, v: TwoWheeler, nx: number, nz: number, tvx: number, tvz: number, mass: number): void {
  poseRider(ts, v); // (a bike out of sight hasn't posed its rider lately)
  const g = v.hy; // (on its road: the ground, or a bridge's deck)
  const throwSpeed = Math.hypot(tvx, tvz);
  if (!ts.ragdolls) return;
  const f = ts.ragdolls.spawn(v.rider, { ...throwVelocity(tvx, tvz, nx, nz), spin: 2 + throwSpeed * 0.3, bleed: bleedOf(throwSpeed) });
  // the bike, a fraction of the hitter's weight, is flung too: up & along, cartwheeling, then skids on its side (a
  // motorcycle, heavier, not so high nor so wildly)
  const share = mass === Infinity ? 1 : mass / (mass + massOf(v)); // of the throw's velocity it takes
  const speed = Math.hypot(tvx, tvz) * share;
  v.wreck = {
    rider: f,
    px: v.x, pz: v.z, py: 0, yaw: v.yaw + v.yawOffset,
    vx: tvx * 0.8 * share + nx * 1.5, vz: tvz * 0.8 * share + nz * 1.5,
    vy: Math.min(v.moto ? 3 : 7, 0.8 + speed * (v.moto ? 0.08 : 0.2)),
    roll: 0, rollVel: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.min(v.moto ? 6 : 14, speed * 0.35)),
    yawVel: (Math.random() - 0.5) * Math.min(12, 1 + speed * 0.3),
    rest: 0,
    scrape: v.moto ? 4.5 : 7 // m/s² its slide loses on the ground: a motorcycle skids further
  };
  v.edge = null; // off the road graph (lanes & junctions rebuild their occupancy every frame)
  v.speed = 0;
  v.vx = v.vz = 0;
  if (v.moto) spawnCollisionSparks(ts, v.x, 0.3, v.z, nx, nz, Math.hypot(tvx, tvz), g); // (0.3 m over its road)
}

function renderBike(ts: TrafficState, v: TwoWheeler, dt: number): void {
  const kit = v.kit;
  if (!kit) return;
  const slot = kit.drawn++;
  const rotY = v.yaw + v.yawOffset;
  ts.dummy.position.set(v.x, v.hy || 0, v.z);
  ts.dummy.rotation.set(v.gp || 0, rotY, -clamp(v.yawRate * v.speed * 0.05, -0.3, 0.3), 'YXZ');
  ts.dummy.scale.set(1, 1, 1);
  ts.dummy.updateMatrix();
  kit.frame.setMatrixAt(slot, ts.dummy.matrix);
  kit.wheels.setMatrixAt(slot, ts.dummy.matrix);
  kit.frame.setColorAt(slot, v.color);
  if (v.bike) v.pedal = (v.pedal + (v.speed * dt) / 0.6) % (Math.PI * 2);
  poseRider(ts, v);
  ts.riderCrowd.add(v.rider, Math.hypot(v.x - ts.focusX, v.z - ts.focusZ));
}

// The rider on the saddle of bike v as it stands now, hands on the bars and feet on the pedals (or pegs)
function poseRider(ts: TrafficState, v: TwoWheeler): void {
  const rotY = v.yaw + v.yawOffset;
  ts.bikeRoot.position.set(v.x, v.hy || 0, v.z);
  ts.bikeRoot.rotation.set(v.gp || 0, rotY, -clamp(v.yawRate * v.speed * 0.05, -0.3, 0.3), 'YXZ');
  ts.bikeRoot.updateMatrixWorld(true);
  v.rider.yaw = rotY;
  if (v.kit) v.rider.ride(ts.bikeRoot, v.pedal, v.kit.seat);
  v.rider.placed = false; // riding poses aren't walking ones: a walk would start afresh
}

// The fallen rider and the bike on its side; both cleared once they've lain still a while
function renderWreck(ts: TrafficState, v: TwoWheeler, dt: number): void {
  const w = v.wreck;
  if (!w) return;
  // (each on the surface under it: the deck of a bridge it was knocked over on, the ground once off its edge)
  const r = w.rider;
  const restR = r.rest;
  if (restR > 0.5 && !r.down) {
    r.down = true;
    if (ts.mayhemListener) ts.mayhemListener('down', r.px, r.py - 0.15, r.pz, 0, MASS.person);
  }
  // the bicycle in the air (py over the surface under it) turns over freely; down, it skids and lies on one side
  const gy = surfaceAt(ts, w.px, w.pz, (w.gy ?? v.hy ?? 0) + w.py);
  w.py += (w.gy ?? gy) - gy; // (its height kept as the surface under it changes)
  w.gy = gy;
  w.vy -= 9.8 * dt;
  w.py += w.vy * dt;
  slide(w, w.vx * dt, w.vz * dt, ts.solidAt);
  w.yaw += w.yawVel * dt;
  w.roll += w.rollVel * dt;
  if (w.py <= 0 && w.vy <= 0) { // (down on the ground, not just thrown up from it)
    w.py = 0;
    w.vy = w.vy < -2 ? -w.vy * 0.3 : 0;
    const v0 = Math.hypot(w.vx, w.vz);
    if (v0 > 0) {
      const k = (Math.max(0, v0 - w.scrape * dt) * Math.exp(-1.5 * dt)) / v0; // metal scraping over the asphalt
      w.vx *= k;
      w.vz *= k;
    }
    w.yawVel *= Math.exp(-4 * dt);
    w.rollVel *= Math.exp(-6 * dt);
    // onto the side it's nearest to
    const side = Math.round((w.roll - 1.45) / (Math.PI * 2)) * Math.PI * 2;
    const target = Math.abs(w.roll - (side + 1.45)) < Math.abs(w.roll - (side - 1.45)) ? side + 1.45 : side - 1.45;
    w.roll += (target - w.roll) * Math.min(1, 6 * dt);
    if (Math.hypot(w.vx, w.vz) < 0.2) w.rest += dt;
  }
  if (restR > DOWN_TIME && w.rest > DOWN_TIME) {
    ts.ragdolls?.release(r);
    v.wreck = null;
    return;
  }
  // the rider, thrown far ahead of the bike, is drawn wherever the camera may see it, the bike likewise (its pose
  // the ragdoll's)
  if (!ts.hasView || visible(ts, r.px, r.pz, 4, r.py)) ts.riderCrowd.add(v.rider, Math.hypot(r.px - ts.focusX, r.pz - ts.focusZ));
  if (ts.hasView && !visible(ts, w.px, w.pz, 4)) return;
  const kit = v.kit;
  if (!kit) return;
  const slot = kit.drawn++;
  ts.dummy.position.set(w.px, 0.04 + w.py + w.gy, w.pz);
  ts.dummy.rotation.set(0, w.yaw, w.roll, 'YXZ');
  ts.dummy.scale.set(1, 1, 1);
  ts.dummy.updateMatrix();
  kit.frame.setMatrixAt(slot, ts.dummy.matrix);
  kit.wheels.setMatrixAt(slot, ts.dummy.matrix);
  kit.frame.setColorAt(slot, v.color);
}

export { createTwoWheelKits, contactRider, throwRider, renderBike, renderWreck };
