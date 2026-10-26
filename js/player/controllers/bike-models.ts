// js/player/controllers/bike-models.ts
// The bicycle and the moto as built, with their skinned riders, and their looks (a frame colour, a moto model & paint)
import * as THREE from 'three/webgpu';
import { PersonCrowd, PersonRig } from '../../sim/pedestrians.ts';
import { createCarPaintMaterial, createContactShadowMaterial } from '../../render/tsl-materials.ts';
import { buildSpec } from '../drivetrain.ts';
import { paintsOf } from '../../models/cars/index.ts';
import { PLAYER_MOTO, MOTO_MODEL_BY_ID } from '../../models/motos/index.ts';
import { SPAWN, LABELS, PLAYER_PERSON } from './constants.ts';
import type { CyclistEntity, MotoEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// ...and the player's bicycle the frame colour of the one it was taken from
export function setBikeColor(ctl: ThirdPersonControllerManager, hex = 0x0078e8): void {
  const b = ctl.entities.cyclist;
  const mat = createCarPaintMaterial(hex);
  for (const m of b.frameMeshes) m.material = mat;
  b.look = { color: hex };
}

// The moto becomes model `modelId` (js/models/motos: its engine, gearbox & weight; the Italika's shape) in `paint`
export function setMotoLook(ctl: ThirdPersonControllerManager, modelId = PLAYER_MOTO.id, paint = paintsOf(PLAYER_MOTO)[0]): void {
  const m = ctl.entities.moto;
  const model = MOTO_MODEL_BY_ID[modelId] ?? PLAYER_MOTO;
  if (m.vehicle) ctl.parkTwoWheeler(m); // (its body is made again for its own weight)
  m.model = model;
  m.spec = buildSpec(model);
  m.drive = null;
  m.label = model.name;
  const mat = createCarPaintMaterial(paint);
  for (const mesh of m.paintMeshes) mesh.material = mat;
  m.look = { model: model.id, paint };
}

// =========================================================================
// 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
// =========================================================================
export function createCyclistEntity(ctl: ThirdPersonControllerManager): CyclistEntity {
  const root = new THREE.Group();
  root.name = 'PlayerCyclist';

  const leanPivot = new THREE.Group();
  root.add(leanPivot);

  const frameMat = createCarPaintMaterial(0x0078e8);
  const tireMat = new THREE.MeshStandardNodeMaterial({
    color: 0x181a1e,
    roughness: 0.60
  });
  const chromeMat = new THREE.MeshStandardNodeMaterial({
    color: 0xe0e8f0,
    roughness: 0.16,
    metalness: 0.78
  });
  const shortsMat = new THREE.MeshStandardNodeMaterial({
    color: 0x1c2028,
    roughness: 0.55
  });
  const helmetMat = new THREE.MeshStandardNodeMaterial({
    color: 0xf4f7fb,
    emissive: 0x181c22,
    roughness: 0.22,
    metalness: 0.25
  });

  const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
  wheelTorusGeo.rotateY(Math.PI * 0.5);
  const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
  rimTorusGeo.rotateY(Math.PI * 0.5);

  // the front wheel, fork & handlebar turn about the head tube
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0, 0.5);
  leanPivot.add(steerPivot);
  const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
  frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
  frontWheel.position.set(0, 0.38, 0.08);
  steerPivot.add(frontWheel);

  const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
  rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
  rearWheel.position.set(0, 0.38, -0.58);
  leanPivot.add(rearWheel);

  // Rear red LED safety strobe on seatpost
  const tailLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 8, 8),
    new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
  );
  tailLed.position.set(0, 0.86, -0.32);
  leanPivot.add(tailLed);

  const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
  topTube.rotation.x = Math.PI * 0.46;
  topTube.position.set(0, 0.78, 0.04);
  leanPivot.add(topTube);

  const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
  downTube.rotation.x = Math.PI * 0.28;
  downTube.position.set(0, 0.58, 0.16);
  leanPivot.add(downTube);

  const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
  seatTube.rotation.x = -0.22;
  seatTube.position.set(0, 0.66, -0.22);
  leanPivot.add(seatTube);

  const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
  saddle.rotation.x = Math.PI * 0.5;
  saddle.scale.set(1.15, 1.0, 0.55);
  saddle.position.set(0, 0.96, -0.28);
  leanPivot.add(saddle);

  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
  fork.rotation.x = -0.24;
  fork.position.set(0, 0.68, -0.02);
  steerPivot.add(fork);

  const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
  handlebar.rotation.z = Math.PI * 0.5;
  handlebar.position.set(0, 0.98, -0.1);
  steerPivot.add(handlebar);

  // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
  const bikeFrame = {
    seat: new THREE.Vector3(0, 0.98, -0.28),
    bars: new THREE.Vector3(0, 0.98, 0.4),
    gripHalf: 0.22,
    bracket: new THREE.Vector3(0, 0.34, -0.145),
    crankLength: 0.17
  };
  const crankPivot = new THREE.Group();
  crankPivot.position.copy(bikeFrame.bracket);
  const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
  const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
  const pedals: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    const arm = new THREE.Group();
    arm.rotation.x = side > 0 ? 0 : Math.PI;
    const crank = new THREE.Mesh(crankGeo, chromeMat);
    crank.position.x = side * 0.065;
    const pedal = new THREE.Mesh(pedalGeo, tireMat);
    pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
    arm.add(crank, pedal);
    crankPivot.add(arm);
    pedals.push(pedal);
  }
  leanPivot.add(crankPivot);

  // Skinned rider (see pedestrians.ts), posed every frame with its hands on the grips and feet on the pedals; the
  // helmet rides on its head
  const riderCrowd = new PersonCrowd(1, { farDistance: Infinity, model: PLAYER_PERSON });
  riderCrowd.meshes.forEach((m) => ctl.scene.add(m));
  const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
  helmet.scale.set(0.95, 0.68, 1.28);
  ctl.scene.add(helmet);

  const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
  bikeShadowGeo.rotateX(-Math.PI * 0.5);
  const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
  bikeShadow.position.set(0, 0.02, 0.0);
  bikeShadow.renderOrder = 998;
  root.add(bikeShadow);

  const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
  headLight.position.set(0, 1.32, 0.62);
  headLight.target.position.set(0, 0.0, 7.6);
  leanPivot.add(headLight, headLight.target);

  ctl.scene.add(root);

  return {
    type: 'cyclist',
    label: LABELS.cyclist,
    mesh: root,
    leanPivot,
    frameMeshes: [topTube, downTube, seatTube],
    look: { color: 0x0078e8 },
    steerPivot,
    frontWheel,
    rearWheel,
    shadow: bikeShadow,
    crankPivot,
    pedals,
    bikeFrame,
    riderCrowd,
    riderRig,
    helmet,
    headLight,
    position: new THREE.Vector3(SPAWN.cyclist.x, 0.0, SPAWN.cyclist.z),
    heading: SPAWN.cyclist.heading,
    speed: 0,
    vx: 0,
    vz: 0,
    leanAngle: 0,
    pedalPhase: 0,
    // its wheels (m: radius, the rear's & front's centres along it, the fork's rake, its travel)
    wheelSpots: { radius: 0.38, rear: -0.58, front: 0.58, caster: 0.3, travel: 0.1 }, // (its travel: the tyres' give)
    standLean: 0.12, // rad it leans on its kickstand
    steerInput: 0,
    shoved: 0,
    vehicle: null, // its body in Jolt while it is ridden, or sliding along after its rider was thrown off (`loose`)
    loose: false,
    fallen: false, // lying on its side where it came to rest (its pose in bodyOut)
    restTime: 0,
    cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
    chaseDistance: 4.8,
    chaseHeight: 2.05
  };
}

// =========================================================================
// 5. MOTO (ITALIKA FT150, js/models/motos, WITH ITS RIDER)
// =========================================================================
export function createMotoEntity(ctl: ThirdPersonControllerManager): MotoEntity {
  const model = PLAYER_MOTO;
  const root = new THREE.Group();
  root.name = 'PlayerMoto';
  // everything leans with the rider about the tyres' contact line
  const leanPivot = new THREE.Group();
  root.add(leanPivot);

  const paintMat = createCarPaintMaterial(model.paints?.[0]);
  const blackMat = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.7 });
  const engineMat = new THREE.MeshStandardNodeMaterial({ color: 0x5a5f66, roughness: 0.45, metalness: 0.6 });
  const chromeMat = new THREE.MeshStandardNodeMaterial({ color: 0xdfe6ee, roughness: 0.14, metalness: 0.85 });
  const tyreMat = new THREE.MeshStandardNodeMaterial({ color: 0x17191c, roughness: 0.62 });
  const helmetMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1c20, roughness: 0.25, metalness: 0.3 });

  // 17 in wheels (0.29 m tyre radius) 1.32 m apart, spoked rims
  const tyreGeo = new THREE.TorusGeometry(0.255, 0.05, 12, 28).rotateY(Math.PI * 0.5);
  const rimGeo = new THREE.TorusGeometry(0.2, 0.014, 6, 24).rotateY(Math.PI * 0.5);
  const spokeGeo = new THREE.BoxGeometry(0.012, 0.4, 0.012);
  const wheel = (z: number) => {
    const w = new THREE.Mesh(tyreGeo, tyreMat);
    w.add(new THREE.Mesh(rimGeo, chromeMat));
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(spokeGeo, chromeMat);
      spoke.rotation.x = (i * Math.PI) / 3;
      w.add(spoke);
    }
    w.position.set(0, 0.29, z);
    return w;
  };
  const rearWheel = wheel(-0.66);
  leanPivot.add(rearWheel);
  // the front wheel & fork turn about the steering head
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0, 0.5);
  leanPivot.add(steerPivot);
  const frontWheel = wheel(0.16);
  steerPivot.add(frontWheel);
  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 8), chromeMat);
    fork.rotation.x = -0.42;
    fork.position.set(side * 0.085, 0.62, 0.02);
    steerPivot.add(fork);
  }
  const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.68, 8).rotateZ(Math.PI * 0.5), blackMat);
  bars.position.set(0, 1.04, -0.1);
  steerPivot.add(bars);
  const headlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.1, 14).rotateX(Math.PI * 0.5),
    new THREE.MeshBasicNodeMaterial({ color: 0xf6f3e6 }));
  headlamp.position.set(0, 0.93, 0.12);
  steerPivot.add(headlamp);

  // engine, tank, seat, tail, exhaust, frame
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.4), engineMat);
  engine.position.set(0, 0.42, 0.02);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.24, 6, 12).rotateX(Math.PI * 0.5), paintMat);
  tank.scale.set(1.0, 0.72, 1);
  tank.position.set(0, 0.9, 0.24);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.62), blackMat);
  seat.position.set(0, 0.86, -0.32);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.34), paintMat);
  tail.position.set(0, 0.8, -0.72);
  tail.rotation.x = -0.18;
  const sideCover = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), paintMat);
  sideCover.position.set(0, 0.66, -0.3);
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8), blackMat);
  frame.rotation.x = Math.PI * 0.5 + 0.55;
  frame.position.set(0, 0.68, 0.2);
  const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.62), blackMat);
  swingarm.position.set(0.12, 0.32, -0.36);
  swingarm.rotation.x = 0.1;
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.62, 10).rotateX(Math.PI * 0.5 - 0.12), chromeMat);
  exhaust.position.set(-0.16, 0.36, -0.46);
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 }));
  tailLight.position.set(0, 0.86, -0.9);
  const pegs = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6).rotateZ(Math.PI * 0.5), chromeMat);
  pegs.position.set(0, 0.36, -0.05);
  leanPivot.add(engine, tank, seat, tail, sideCover, frame, swingarm, exhaust, tailLight, pegs);

  // where the rider's hands, seat & feet go (pedestrians.ts PersonRig.ride: a crank of no length is a footpeg)
  const bikeFrame = {
    seat: new THREE.Vector3(0, 0.84, -0.3),
    bars: new THREE.Vector3(0, 1.04, 0.38),
    gripHalf: 0.31,
    bracket: new THREE.Vector3(0, 0.36, -0.07),
    crankLength: 0.001
  };
  const riderCrowd = new PersonCrowd(1, { farDistance: Infinity, model: PLAYER_PERSON });
  riderCrowd.meshes.forEach((m) => ctl.scene.add(m));
  const riderRig = new PersonRig({ seed: 21.4, scale: 1.0, girth: 1.02, hair: 0.1 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), helmetMat);
  helmet.scale.set(0.95, 0.95, 1.1);
  ctl.scene.add(helmet);

  const shadowGeo = new THREE.PlaneGeometry(0.8, 2.2);
  shadowGeo.rotateX(-Math.PI * 0.5);
  const shadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
  shadow.position.y = 0.02;
  shadow.renderOrder = 998;
  root.add(shadow);

  const headLight = new THREE.SpotLight(0xf2f7ff, 0, 34, 0.36, 0.7, 1.25);
  headLight.position.set(0, 0.93, 0.68);
  headLight.target.position.set(0, 0.0, 9);
  leanPivot.add(headLight, headLight.target);

  ctl.scene.add(root);
  return {
    type: 'moto',
    label: model.name,
    model,
    look: { model: model.id, paint: paintsOf(model)[0] },
    paintMeshes: [tank, tail, sideCover],
    shadow,
    spec: buildSpec(model),
    drive: null,
    mesh: root,
    leanPivot,
    steerPivot,
    frontWheel,
    rearWheel,
    bikeFrame,
    riderCrowd,
    riderRig,
    helmet,
    headLight,
    position: new THREE.Vector3(SPAWN.moto.x, 0.0, SPAWN.moto.z),
    heading: SPAWN.moto.heading,
    speed: 0,
    vx: 0,
    vz: 0,
    leanAngle: 0,
    wheelSpots: { radius: 0.29, rear: -0.66, front: 0.66, caster: 0.44, travel: 0.15 },
    standLean: 0.16, // rad it leans on its side stand
    steerInput: 0,
    shoved: 0,
    vehicle: null, // its body in Jolt while it is ridden, or sliding along after its rider was thrown off (`loose`)
    loose: false,
    fallen: false, // lying on its side where it came to rest (its pose in bodyOut)
    restTime: 0,
    halfW: 0.4,
    halfL: 1.0,
    cameraTargetOffset: new THREE.Vector3(0, 1.3, 0),
    chaseDistance: 5.0,
    chaseHeight: 2.05
  };
}
