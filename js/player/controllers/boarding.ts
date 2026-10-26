// js/player/controllers/boarding.ts
// Getting in and out: who is visible in which mode, the player's own vehicle within reach, getting in (one's own or
// one taken from the traffic) and out, the cars left behind for another one, and the vehicles left standing
import * as THREE from 'three/webgpu';
import { createDamage } from '../vehicle-damage.ts';
import { createStains } from '../car-blood.ts';
import { LEFT_CARS } from './constants.ts';
import { collisionBody, buildingContact } from './collisions.ts';
import type { PlayerMode, VehicleMode, LeftCar, ParkedVehicle, TakenVehicle } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

export function setMode(ctl: ThirdPersonControllerManager, mode: PlayerMode): void {
  ctl.activeMode = mode;
  ctl.syncOccupants();
}

// On foot the pedestrian walks and the vehicles stand empty where they were left; in a vehicle the pedestrian rides
// along out of sight, and only a bicycle being ridden has its rider (and helmet) on it
export function syncOccupants(ctl: ThirdPersonControllerManager): void {
  const onFoot = ctl.activeMode === 'person';
  const p = ctl.entities.person;
  p.mesh.visible = onFoot;
  for (const m of p.crowd.meshes) m.visible = onFoot;
  const b = ctl.entities.cyclist;
  const riding = ctl.activeMode === 'cyclist';
  for (const m of b.riderCrowd.meshes) m.visible = riding;
  b.helmet.visible = riding;
  const moto = ctl.entities.moto;
  const onMoto = ctl.activeMode === 'moto';
  for (const m of moto.riderCrowd.meshes) m.visible = onMoto;
  moto.helmet.visible = onMoto;
}

// GTA-style boarding (F, main.ts): the player's own vehicle the pedestrian could get into, the nearest whose body
// is within `reach` metres; { mode, distance } (and `left`: one of the cars left behind, leaveCarBehind) or null
export function ownVehicleNear(ctl: ThirdPersonControllerManager, reach: number): { mode: VehicleMode; distance: number; left?: LeftCar } | null {
  const p = ctl.entities.person.position;
  let best: { mode: VehicleMode; distance: number; left?: LeftCar } | null = null;
  // [mode, half width, half length, centre ahead of the origin]: the helicopter runs from its nose (+2.5 m) back to
  // the tail rotor (-6 m)
  const car = ctl.entities.car;
  for (const [mode, halfW, halfL, mid] of [['car', car.halfW || 0.86, car.halfL || 2.18, 0], ['cyclist', 0.32, 0.95, 0], ['moto', 0.4, 1.0, 0], ['helicopter', 1.3, 4.3, -1.8]] as const) {
    const e = ctl.entities[mode];
    if (Math.abs(e.position.y - p.y) > 2.5) continue; // (a helicopter up in the air)
    const dx = p.x - e.position.x, dz = p.z - e.position.z;
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
    const distance = Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz - mid) - halfL), Math.max(0, Math.abs(dz * fx - dx * fz) - halfW));
    if (distance <= reach && (!best || distance < best.distance)) best = { mode, distance };
  }
  for (const left of ctl.leftCars) {
    if (Math.abs(left.y - p.y) > 2.5) continue;
    const dx = p.x - left.x, dz = p.z - left.z;
    const fx = Math.sin(left.heading), fz = Math.cos(left.heading);
    const distance = Math.hypot(Math.max(0, Math.abs(dx * fx + dz * fz) - left.halfL), Math.max(0, Math.abs(dz * fx - dx * fz) - left.halfW));
    if (distance <= reach && (!best || distance < best.distance)) best = { mode: 'car', distance, left };
  }
  return best;
}

// The player takes another car (main.ts board) and leaves theirs where it stands: a still copy of it as it is (its
// model, paint, dents, a camión's parts), which the traffic stops behind, the player bumps into and can get back into
// (takeLeftCar). The copy keeps the car's dented body and camión parts: the car is given new ones with its next look
export function leaveCarBehind(ctl: ThirdPersonControllerManager): void {
  const c = ctl.entities.car;
  const mesh = c.mesh.clone(true); // (sharing the geometries & materials)
  const lights: THREE.Object3D[] = [];
  mesh.traverse((o) => { if (o instanceof THREE.Light) lights.push(o); });
  for (const light of lights) light.removeFromParent();
  mesh.name = 'LeftCar';
  ctl.scene.add(mesh);
  const { x, y, z } = c.position;
  // its box for the collisions, the length along its heading (as bridges.ts builds its walls' boxes)
  const yaw = Math.atan2(-Math.cos(c.heading), Math.sin(c.heading));
  const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = c.halfL, hz = c.halfW;
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  // (its stains and the material showing them its own from here on: the next car of its look gets another)
  if (ctl._bloodMats?.get(`${c.look.bodyType}_${c.look.paint}`) === c.bodyMesh.material) {
    ctl._bloodMats.delete(`${c.look.bodyType}_${c.look.paint}`);
  }
  ctl.leftCars.push({
    mesh, x, y, z, heading: c.heading, halfW: c.halfW, halfL: c.halfL, look: { ...c.look }, damage: c.damage,
    dented: c.dented, kit: c.kit, stains: c.stains, material: c.bodyMesh.material,
    collider: { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y - 0.3, maxY: y + (c.kit?.wheels ? 3.0 : 1.5), obb: { cx: x, cz: z, hx, hz, cs, sn }, _order: 1e15 }
  });
  c.dented = null;
  c.damage = createDamage();
  c.stains = createStains();
  ctl.dropLookKit(c, false);
  if (ctl.leftCars.length > LEFT_CARS) ctl.forgetLeftCar(ctl.leftCars[0]);
}

export function forgetLeftCar(ctl: ThirdPersonControllerManager, left: LeftCar, dispose = true): void {
  const i = ctl.leftCars.indexOf(left);
  if (i >= 0) ctl.leftCars.splice(i, 1);
  left.mesh.removeFromParent();
  if (left.kit) for (const m of left.kit.chassis) m.geometry.dispose();
  if (dispose && left.dented) left.dented.geometry.dispose();
  if (dispose && left.material.userData.blood) left.material.dispose();
}

// Back into a car left behind: the one the player had is left where it is in its place, and the car becomes ctl
// one again, dents and all
export function takeLeftCar(ctl: ThirdPersonControllerManager, left: LeftCar): boolean {
  if (ctl.activeMode !== 'person') return false;
  const c = ctl.entities.car;
  ctl.leaveCarBehind();
  ctl.forgetLeftCar(left, false);
  const { look } = left;
  // (its material back for its look, its stains on it)
  if (left.material.userData.blood) ctl._bloodMats?.set(`${look.bodyType}_${look.paint}`, left.material);
  ctl.setCarLook(look.bodyType, look.paint, look.police, look.model, look.route);
  c.stains = left.stains;
  c.bloody = true;
  ctl.showBlood(c);
  c.position.set(left.x, left.y, left.z);
  c.heading = left.heading;
  c.damage = left.damage;
  if (left.dented) {
    c.dented = left.dented;
    c.bodyMesh.geometry = left.dented.geometry;
  }
  for (const wheel of c.wheels) wheel.steerPivot.rotation.z = c.kit ? 0 : c.damage.camber[(wheel.isFront ? 0 : 2) + (wheel.side > 0 ? 0 : 1)];
  ctl.settle(c);
  return ctl.enterVehicle('car');
}

// Get in: one of the player's own vehicles where it stands, or `taken`, a car or bicycle taken from the traffic
// (traffic.ts hijack): the player's vehicle of that kind takes its place, looks and (slowed) speed
export function enterVehicle(ctl: ThirdPersonControllerManager, mode: PlayerMode, taken: TakenVehicle | null = null): boolean {
  if (ctl.activeMode !== 'person' || mode === 'person' || ctl.entities.person.ragdoll) return false;
  const ent = ctl.entities[mode];
  if (taken) {
    if (mode === 'car') ctl.setCarLook(taken.bodyType, taken.paint, taken.police, taken.model, taken.route);
    else if (mode === 'cyclist') ctl.setBikeColor(taken.color);
    else if (mode === 'moto') ctl.setMotoLook(taken.model, taken.paint);
    // just where it was: on the bridge's deck or down in the underpass it drove (from the road under it, or the
    // player's feet beside it)
    ent.position.set(taken.x, ctl.getGroundHeight(taken.x, taken.z, mode, taken.y ?? ctl.entities.person.position.y), taken.z);
    ent.heading = taken.heading;
    ctl.settle(ent);
    ent.speed = Math.max(0, taken.speed) * 0.4;
  }
  ctl.setMode(mode);
  return true;
}

// Get out: the pedestrian steps out on the driver's side (left), the vehicle stays where it stopped. A helicopter
// has to be (almost) on the ground first
export function exitVehicle(ctl: ThirdPersonControllerManager): boolean {
  const mode = ctl.activeMode;
  if (mode === 'person') return false;
  const v = ctl.entities[mode];
  const ground = ctl.getGroundHeight(v.position.x, v.position.z, mode, v.position.y);
  if (mode === 'helicopter' && v.position.y - ground > 3) return false;
  if (mode === 'helicopter') v.position.y = ground + 0.25;
  ctl.settle(v);
  if (v.type === 'car' && v.carState) v.carState.value.x = 0; // (no brake lights on a parked car)
  // (beside a car or camión by its own size)
  const side = v.type === 'car' ? (v.halfW || 0.86) + 0.64 : mode === 'cyclist' ? 0.75 : mode === 'moto' ? 0.85 : 2.4;
  const end = v.type === 'car' ? (v.halfL || 2.18) + 0.82 : mode === 'cyclist' ? 1.6 : mode === 'moto' ? 1.7 : 6.6;
  const lx = Math.cos(v.heading), lz = -Math.sin(v.heading); // left (heading 0 faces +z, left is +x)
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const spots = [[lx * side, lz * side], [-lx * side, -lz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
  const shape = collisionBody('person', 0.48, 0, 0.05);
  const fits = (x: number, z: number) => {
    const y = ctl.getGroundHeight(x, z, 'person', v.position.y);
    return !ctl.nearColliders(x, z, 1).some((c) => buildingContact(c, x, y, z, shape));
  };
  const [ox, oz] = spots.find(([sx, sz]) => fits(v.position.x + sx, v.position.z + sz)) ?? spots[0];
  const p = ctl.entities.person;
  const x = v.position.x + ox, z = v.position.z + oz;
  ctl.setMode('person');
  ctl.resetInput();
  p.position.set(x, ctl.getGroundHeight(x, z, 'person', v.position.y), z);
  p.heading = v.heading;
  ctl.settle(p);
  return true;
}

// The player's car & bicycle left standing, for the traffic to stop behind (traffic.ts setParked)
export function parkedVehicles(ctl: ThirdPersonControllerManager): ParkedVehicle[] {
  const slots = (ctl._parkedSlots ??= {
    car: { x: 0, z: 0, heading: 0, halfW: 0.86, halfL: 2.18 }, cyclist: { x: 0, z: 0, heading: 0, halfW: 0.32, halfL: 0.95 },
    moto: { x: 0, z: 0, heading: 0, halfW: 0.4, halfL: 1.0 }
  });
  slots.car.halfW = ctl.entities.car.halfW || 0.86;
  slots.car.halfL = ctl.entities.car.halfL || 2.18;
  const out = (ctl._parked ??= []);
  out.length = 0;
  for (const mode of ['car', 'cyclist', 'moto'] as const) {
    if (mode === ctl.activeMode) continue;
    const e = ctl.entities[mode];
    slots[mode].x = e.position.x;
    slots[mode].z = e.position.z;
    slots[mode].heading = e.heading || 0;
    out.push(slots[mode]);
  }
  for (const left of ctl.leftCars) out.push(left);
  return out;
}
