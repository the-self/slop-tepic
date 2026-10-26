// js/player/controllers/car-model.ts
// The player's car as built: the taxi's lofted body, door decals and plates, its wheels, contact shadow and headlamps
import * as THREE from 'three/webgpu';
import { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import {
  BODY_SPECS, buildCarGeometry, buildCarSidePatch, buildSteerableWheelGeo, createLoftedCarMaterial
} from '../../actors/actor-models.ts';
import { createVehicleHeadlight, placeVehicleHeadlight } from '../../actors/vehicle-lights.ts';
import { buildSpec } from '../drivetrain.ts';
import { TAXI_MODEL } from '../../models/cars/index.ts';
import { createDamage } from '../vehicle-damage.ts';
import { createStains } from '../car-blood.ts';
import { SPAWN, LABELS, FUEL_TANK } from './constants.ts';
import type { CarWheel, CarStateUniform, CarEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

function createTaxiDoorDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[controllers] no 2D canvas for the taxi\'s door decal');
  ctx.fillStyle = '#ffbe14';
  ctx.fillRect(0, 0, 256, 128);
  // Black taxi-rank emblem
  ctx.fillStyle = '#111317';
  ctx.beginPath();
  ctx.arc(58, 64, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffbe14';
  ctx.font = '900 32px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('T', 58, 66);
  // TAXI TEPIC typography, rank & unit number
  ctx.fillStyle = '#111317';
  ctx.textAlign = 'left';
  ctx.font = '900 26px Inter, Arial, sans-serif';
  ctx.fillText('TAXI TEPIC', 112, 42);
  ctx.font = '700 15px JetBrains Mono, monospace';
  ctx.fillText('SITIO 7 · ECO 48', 112, 68);
  ctx.font = '600 13px Inter, Arial, sans-serif';
  ctx.fillText('SERVICIO PÚBLICO', 112, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Nayarit public-service plate: white, the state's name across the top, MÉXICO along the bottom
function createLicensePlateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[controllers] no 2D canvas for the licence plate');
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0f6b3a';
  ctx.fillRect(6, 6, 244, 24);
  ctx.fillStyle = '#f4f4f0';
  ctx.font = '800 15px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NAYARIT', 128, 23);
  ctx.fillStyle = '#16181c';
  ctx.font = '900 48px JetBrains Mono, monospace';
  ctx.fillText('A-748-T', 128, 82);
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.fillText('MÉXICO', 128, 114);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// =========================================================================
// 2. CAR (3D LOFTED SCULPTED YELLOW TAXI SEDAN)
// =========================================================================
export function createCarEntity(ctl: ThirdPersonControllerManager): CarEntity {
  const root = new THREE.Group();
  root.name = 'PlayerTaxiCar';

  const chassisPivot = new THREE.Group();
  root.add(chassisPivot);

  const spec = BODY_SPECS.taxi;
  const taxiLoftMat = createLoftedCarMaterial(spec, 0xffbe14);

  // 1. 3D Lofted Taxi Body + Curved Windscreens + Crowned Roof + Side Mirrors + Roof Sign
  const carBodyGeo = buildCarGeometry(spec, false);
  const carBodyMesh = new THREE.Mesh(carBodyGeo, taxiLoftMat);
  carBodyMesh.castShadow = true;
  carBodyMesh.receiveShadow = true;
  chassisPivot.add(carBodyMesh);

  // 2. Taxi side door emblem & unit number decals, hugging the curved front doors
  const doorDecalTex = createTaxiDoorDecalTexture();
  const doorDecalMat = new THREE.MeshStandardNodeMaterial({
    map: doorDecalTex,
    roughness: 0.24,
    metalness: 0.34,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const doorMid = (spec.doors[0] + spec.doors[1]) / 2;
  const taxiDecals: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const decal = new THREE.Mesh(buildCarSidePatch(spec, side, doorMid - 0.36, doorMid + 0.36, 0.53, 0.81, 0.003), doorDecalMat);
    chassisPivot.add(decal);
    taxiDecals.push(decal);
  }

  // 3. License plates on the bumpers
  const plateTex = createLicensePlateTexture();
  const plateMat = new THREE.MeshStandardNodeMaterial({ map: plateTex, roughness: 0.28 });
  const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), plateMat);
  rearPlate.position.set(0, spec.plates[1], spec.zRear - 0.006);
  chassisPivot.add(rearPlate);

  const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), plateMat);
  frontPlate.position.set(0, spec.plates[0], spec.zFront + 0.006);
  chassisPivot.add(frontPlate);

  // 3b. Brake lights, CHMSL & turn signals are lit by the taxi material from its carState uniform (see carEffects)
  const carState = (taxiLoftMat.userData.carState as CarStateUniform | undefined) ?? null;

  // 4. Steerable & Spinning 3D LatheGeometry Tyres + Recessed 5-Spoke Alloy Wheels
  const leftWheelGeo = buildSteerableWheelGeo(spec, -1);
  const rightWheelGeo = buildSteerableWheelGeo(spec, 1);
  ctl._carGeos = { taxi: { body: carBodyGeo, wheels: [leftWheelGeo, rightWheelGeo] } }; // (see setCarLook)

  const wheels: CarWheel[] = [];
  const wheelCoords = [
    { side: -1, z: spec.wheelZ, isFront: true },
    { side: 1, z: spec.wheelZ, isFront: true },
    { side: -1, z: -spec.wheelZ, isFront: false },
    { side: 1, z: -spec.wheelZ, isFront: false }
  ];
  for (const wc of wheelCoords) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wc.side * spec.wheelX, spec.wheelRadius, wc.z);
    const tire = new THREE.Mesh(wc.side < 0 ? leftWheelGeo : rightWheelGeo, taxiLoftMat);
    tire.castShadow = true;
    tire.receiveShadow = true;
    steerPivot.add(tire);
    root.add(steerPivot);
    wheels.push({ steerPivot, tire, isFront: wc.isFront, side: wc.side });
  }

  // 5. Soft Under-Car Contact Shadow (AO) + Clustered Dual LED Headlight SpotLights & Rear Brake PointLight
  const carShadowGeo = new THREE.PlaneGeometry(2.22, 5.05);
  carShadowGeo.rotateX(-Math.PI * 0.5);
  const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
  carShadow.position.set(0, 0.02, 0.0);
  carShadow.renderOrder = 998;
  root.add(carShadow);

  const headLights: THREE.SpotLight[] = [];
  for (const side of [-1, 1]) {
    const spot = createVehicleHeadlight();
    placeVehicleHeadlight(spot, spec, side);
    chassisPivot.add(spot, spot.target);
    headLights.push(spot);
  }

  ctl.scene.add(root);

  return {
    type: 'car',
    label: LABELS.car,
    mesh: root,
    chassisPivot,
    bodyMesh: carBodyMesh,
    taxiDecals,
    plates: [frontPlate, rearPlate],
    look: { bodyType: 'taxi', paint: 0xffbe14, police: false },
    carState,
    headLights,
    wheels,
    carWheels: wheels, // (its own: a camión taken has the bus's, setBusLook)
    stains: createStains(),
    kit: null, // a camión's or combi's parts from the traffic (setCarLook)
    shadow: carShadow,
    position: new THREE.Vector3(SPAWN.car.x, 0.0, SPAWN.car.z),
    heading: SPAWN.car.heading,
    speed: 0,
    vx: 0, // its sideways velocity (m/s, world x & z: its slide)
    vz: 0,
    // the traffic's shove since the last step (traffic.ts collideWithPlayer): spin, pitch, roll & heave (rad/s, m/s)
    angularVel: 0,
    pitchVel: 0,
    rollVel: 0,
    heaveVel: 0,
    vy: 0, // vertical speed (m/s)
    flying: false, // no wheel on the ground
    lastCollisionSpark: null,
    steerAngle: 0,
    zFront: spec.zFront,
    spec: buildSpec(TAXI_MODEL),
    halfW: 0.86, // m, the model's footprint (setCarLook)
    halfL: 2.18,
    drive: null, // drivetrain.ts state: gear, revs, nitro (made on the first drive)
    damage: createDamage(),
    fuel: FUEL_TANK,
    dented: null, // its own copy of the body mesh once it has dents
    drifting: false,
    impactArmed: false,
    lastVx: 0,
    lastVz: 0,
    cameraTargetOffset: new THREE.Vector3(0, 0.96, 0),
    chaseDistance: 6.9,
    chaseHeight: 2.12
  };
}
