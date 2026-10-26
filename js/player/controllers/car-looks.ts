// js/player/controllers/car-looks.ts
// The car's looks: the model it is taken as (its body stretched to its size, its paint, livery, engine), a camión's
// or combi's parts from the traffic, repairs, and the blood on its nose
import * as THREE from 'three/webgpu';
import {
  BODY_SPECS, BUS_SPEC, bodyDims, buildCarGeometry, buildSteerableWheelGeo, createLoftedCarMaterial, createModelCarMaterial,
  createModelWheelMaterial
} from '../../actors/actor-models.ts';
import { carFile } from '../../actors/vehicles/car-files.ts';
import type { CarFile } from '../../actors/vehicles/car-files.ts';
import { placeVehicleHeadlight } from '../../actors/vehicle-lights.ts';
import { buildSpec, createDriveState } from '../drivetrain.ts';
import { BUS_MODEL } from '../../models/cars/index.ts';
import { createDamage } from '../vehicle-damage.ts';
import { bloodFrame, addHit, clean } from '../car-blood.ts';
import { bleedOf } from '../../sim/ragdolls.ts';
import { LABELS, SPEC_BY_NAME, modelFor } from './constants.ts';
import type { BloodUniforms } from '../../actors/actor-models.ts';
import type { CarRoute, LookKit, CarStateUniform, CarEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// The traffic's parts for a camión or a combi the player takes (traffic.ts lookKit: the camión's body & wheels, the
// combi's roof sign, each with its route), given the look { bodyType, route }
export function setLookKits(ctl: ThirdPersonControllerManager, make: ((look: { bodyType: string; route: CarRoute | null }) => LookKit | null) | null | undefined): void {
  ctl.lookKits = typeof make === 'function' ? make : null;
}

// The player's car becomes the one it was taken from: its model (js/models/cars) with its body shape stretched to
// the model's size, its paint, its police livery, and the model's own engine & gearbox (drivetrain.ts). A camión
// or a combi keeps its route ({ sign, livery }: its name on the glass or the roof, the camión's livery)
export function setCarLook(ctl: ThirdPersonControllerManager, bodyType = 'taxi', paint = 0xffbe14, police = false, modelId: string | null = null, route: CarRoute | null = null): void {
  const c = ctl.entities.car;
  ctl.dropLookKit(c);
  const kit = (route || bodyType === 'bus') && ctl.lookKits ? ctl.lookKits({ bodyType, route }) : null;
  if (bodyType === 'bus') {
    if (kit) {
      ctl.setBusLook(c, kit, route);
      return;
    }
    bodyType = 'taxi'; // (no traffic to build a camión from: the taxi)
    modelId = null;
  }
  const model = modelFor({ bodyType, police, model: modelId });
  const spec = SPEC_BY_NAME[bodyType] ?? SPEC_BY_NAME[model.body] ?? BODY_SPECS.taxi;
  // (its own material, for its stains: one for each look, one more for each car of it left behind, leaveCarBehind)
  const looks = (ctl._bloodMats ??= new Map<string, THREE.Material>());
  const mat = looks.get(`${spec.name}_${paint}`) ?? createLoftedCarMaterial(spec, paint, { blood: true });
  looks.set(`${spec.name}_${paint}`, mat);
  const geos = (ctl._carGeos ??= {});
  const g = (geos[spec.name] ??= {
    body: buildCarGeometry(spec, false),
    wheels: [buildSteerableWheelGeo(spec, -1), buildSteerableWheelGeo(spec, 1)]
  });
  // the body shape's scale to the model's real length, width & height (chassis children: body, decals, plates, lamps)
  const dims = bodyDims(spec);
  const sx = model.size[1] / dims.width, sy = model.size[2] / dims.height, sz = model.size[0] / dims.length;
  const sw = Math.min(sy, sz);
  c.chassisPivot.scale.set(sx, sy, sz);
  c.scale = { x: sx, y: sy, z: sz };
  c.bodyHalf = { w: dims.halfW, l: dims.halfL }; // (the body shape's own, for the dents)
  c.halfW = dims.halfW * sx * 0.92;
  c.halfL = dims.halfL * sz;
  c.bodyMesh.geometry = g.body;
  c.bodyMesh.material = mat;
  for (const wheel of c.wheels) {
    wheel.tire.geometry = g.wheels[wheel.side < 0 ? 0 : 1];
    wheel.tire.material = mat;
    wheel.tire.scale.setScalar(sw);
    wheel.steerPivot.position.set(wheel.side * spec.wheelX * sx, spec.wheelRadius * sw, (wheel.isFront ? spec.wheelZ : -spec.wheelZ) * sz);
    wheel.restY = spec.wheelRadius * sw;
  }
  for (const decal of c.taxiDecals) decal.visible = spec.name === 'taxi';
  c.plates[0].position.set(0, spec.plates[0], spec.zFront + 0.006);
  c.plates[1].position.set(0, spec.plates[1], spec.zRear - 0.006);
  c.headLights.forEach((spot, i) => { placeVehicleHeadlight(spot, spec, i === 0 ? -1 : 1); });
  c.carState = (mat.userData.carState as CarStateUniform | undefined) ?? null; // (the fixed-colour material's uniform)
  if (c.carState) c.carState.value.set(0, 0, 0, police ? 1 : 0); // (livery: 1 = police)
  c.blood = (mat.userData.blood as BloodUniforms | undefined) ?? null;
  c.bloodFrame = bloodFrame(spec, dims.halfW);
  c.label = spec.name === 'taxi' ? LABELS.car : police ? 'Patrulla' : model.name;
  c.look = { bodyType: spec.name, paint, police, model: model.id, route: kit ? route : null };
  if (kit) {
    // a combi's route sign on its roof (in the body shape's frame, stretched with it)
    for (const m of kit.chassis) c.chassisPivot.add(m);
    c.kit = kit;
    c.label = kit.label;
  }
  showCarFile(ctl, c, model.id, spec.name === 'taxi' || police || kit ? undefined : carFile(model.id), paint);
  c.zFront = spec.zFront * sz;
  c.bodyHeight = model.size[2];
  c.spec = buildSpec(model);
  c.drive = createDriveState(c.spec);
  ctl.repairCar(c);
}

// The car as its model's 3D model (actors/vehicles/car-files.ts), the one the traffic draws, when its file has
// loaded and has its wheels apart: its body in the chassis (undoing the body shape's stretch), its own wheels where
// its file puts them, its paint & brake lamps from its own material's uniforms. No dents or blood show on it yet.
// Without a file (or for a taxi, a patrol car, a combi), the body shape as before.
export function showCarFile(ctl: ThirdPersonControllerManager, c: CarEntity, id: string, file: CarFile | undefined, paint: number): void {
  const w = file?.wheels, wheel = file?.wheel;
  if (!file || !w || !wheel) {
    if (c.modelBody) c.modelBody.visible = false;
    c.bodyMesh.visible = true;
    for (const plate of c.plates) plate.visible = true;
    return;
  }
  // (one material per model, its paint a uniform: any paint, one shader; leaveCarBehind lets a car left behind keep it)
  const mats = (ctl._modelMats ??= new Map<string, THREE.Material>());
  const bodyMat = mats.get(id) ?? createModelCarMaterial(file.map, file.paintMap, paint);
  mats.set(id, bodyMat);
  (bodyMat.userData.paint as { value: THREE.Color } | undefined)?.value.setHex(paint); // (createModelCarMaterial's uniform)
  const wheelMat = mats.get(`${id}_wheel`) ?? createModelWheelMaterial(file.map, file.paintMap);
  mats.set(`${id}_wheel`, wheelMat);
  if (!c.modelBody) {
    c.modelBody = new THREE.Mesh();
    c.modelBody.castShadow = c.modelBody.receiveShadow = true;
    c.chassisPivot.add(c.modelBody);
  }
  const body = c.modelBody;
  body.geometry = file.geometry;
  body.material = bodyMat;
  const s = c.scale ?? { x: 1, y: 1, z: 1 };
  body.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
  body.visible = true;
  c.bodyMesh.visible = false;
  for (const plate of c.plates) plate.visible = false;
  for (const wh of c.wheels) {
    wh.tire.geometry = wh.side < 0 ? wheel.left : wheel.right;
    wh.tire.material = wheelMat;
    wh.tire.scale.setScalar(1);
    wh.steerPivot.position.set(wh.side * w.x, w.radius, wh.isFront ? w.front : w.rear);
    wh.restY = w.radius;
  }
  const state = bodyMat.userData.carState as CarStateUniform | undefined; // (createModelCarMaterial's uniform)
  c.carState = state ?? null;
  c.blood = null;
}

// A car model's file loaded after the car took its look: its body and wheels swapped in, the car otherwise as it is
// (not setCarLook again, which repairs it and resets its gearbox)
export function refreshCarFile(ctl: ThirdPersonControllerManager, id: string): void {
  const c = ctl.entities.car, look = c.look;
  if (look.model !== id || c.kit || look.bodyType === 'taxi' || look.police) return;
  showCarFile(ctl, c, id, carFile(id), look.paint);
}

// ...or the camión itself: the traffic's bus body, route sign & wheels instead of the car's, its size, its lamps,
// the bus's engine & gearbox (BUS_MODEL), and the chase camera further back and up
export function setBusLook(ctl: ThirdPersonControllerManager, c: CarEntity, kit: LookKit, route: CarRoute | null): void {
  c.bodyMesh.visible = false;
  if (c.modelBody) c.modelBody.visible = false;
  for (const decal of c.taxiDecals) decal.visible = false;
  for (const plate of c.plates) plate.visible = false;
  for (const wheel of c.carWheels) wheel.steerPivot.visible = false;
  c.chassisPivot.scale.set(1, 1, 1);
  c.scale = { x: 1, y: 1, z: 1 };
  for (const m of kit.chassis) c.chassisPivot.add(m);
  const wheels = kit.wheels ?? []; // (a camión's kit has its wheels)
  for (const wheel of wheels) c.mesh.add(wheel.steerPivot);
  c.wheels = wheels;
  c.kit = kit;
  c.bodyHalf = { w: BUS_SPEC.halfWidth[0][1], l: BUS_SPEC.zFront };
  c.halfW = BUS_SPEC.halfWidth[0][1];
  c.halfL = BUS_SPEC.zFront;
  c.bodyHeight = BUS_MODEL.size[2];
  c.headLights.forEach((spot, i) => { placeVehicleHeadlight(spot, BUS_SPEC, i === 0 ? -1 : 1); });
  c.carState = null;
  c.blood = null; // (the camión's body is the traffic's: no stains drawn on it)
  c.label = kit.label;
  c.look = { bodyType: 'bus', paint: 0xffffff, police: false, model: BUS_MODEL.id, route };
  c.zFront = BUS_SPEC.zFront;
  c.spec = buildSpec(BUS_MODEL);
  c.drive = createDriveState(c.spec);
  c.shadow.scale.set(2.92 / 2.22, 1, 12.1 / 5.05);
  c.chaseDistance = 12.5;
  c.chaseHeight = 4.1;
  c.cameraTargetOffset.y = 1.9;
  ctl.repairCar(c);
}

// Takes the last camión's or combi's parts off the player's car, and gives it back its own
export function dropLookKit(c: CarEntity, dispose = true): void {
  const kit = c.kit;
  if (!kit) return;
  for (const m of kit.chassis) {
    m.removeFromParent();
    if (dispose) m.geometry.dispose(); // (unless a car left behind still shows it)
  }
  if (kit.wheels) for (const wheel of kit.wheels) wheel.steerPivot.removeFromParent();
  c.kit = null;
  c.wheels = c.carWheels;
  c.bodyMesh.visible = true;
  for (const plate of c.plates) plate.visible = true;
  for (const wheel of c.carWheels) wheel.steerPivot.visible = true;
  c.shadow.scale.set(1, 1, 1);
  c.chaseDistance = 6.9;
  c.chaseHeight = 2.12;
  c.cameraTargetOffset.y = 0.96;
}

// The car like new: no damage, the shared undented body mesh back, the wheels true
export function repairCar(ctl: ThirdPersonControllerManager, c: CarEntity = ctl.entities.car): void {
  c.damage = createDamage();
  clean(c.stains);
  c.bloody = false;
  ctl.showBlood(c);
  if (c.dented) {
    c.dented.geometry.dispose();
    c.dented = null;
  }
  const geo = ctl._carGeos?.[c.look.bodyType];
  if (geo) c.bodyMesh.geometry = geo.body;
  for (const wheel of c.wheels) wheel.steerPivot.rotation.z = 0;
}

// Someone struck by the car's nose at (x, z), `speed` m/s: their blood on it, and up its bonnet and windscreen as
// hard as it hit them (player/car-blood.ts); only the player's car, driven forwards
export function bloodyCar(ctl: ThirdPersonControllerManager, x: number, z: number, speed: number): void {
  const c = ctl.entities.car;
  const bleed = bleedOf(Math.abs(speed));
  if (ctl.activeMode !== 'car' || !c.blood || !c.bloodFrame || !(bleed > 0) || c.speed <= 0) return;
  // struck by its nose, not by its flank or its tail (backing over someone), and where across it, in its body
  // shape's frame (its left: (cos h, -sin h))
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
  if ((x - c.position.x) * sn + (z - c.position.z) * cs < c.halfL * 0.4) return;
  const across = ((x - c.position.x) * cs - (z - c.position.z) * sn) / (c.scale?.x || 1);
  addHit(c.stains, c.bloodFrame, across, Math.abs(speed), bleed);
  c.bloody = true;
  ctl.showBlood(c);
}

// The car's stains into its material's uniforms
export function showBlood(c: CarEntity): void {
  if (!c.blood) return;
  const { front, top } = c.stains;
  for (let i = 0; i < c.blood.front.length; i++) c.blood.front[i].value.fromArray(front, i * 4);
  for (let i = 0; i < c.blood.top.length; i++) c.blood.top[i].value.fromArray(top, i * 4);
}
