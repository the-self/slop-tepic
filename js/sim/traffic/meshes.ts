// js/sim/traffic/meshes.ts
// The instanced meshes the cars and camiones are drawn with: a body per shape and level of detail, wheels, route signs,
// police light bars, contact shadows
import * as THREE from 'three/webgpu';
import { BODY_SHARE } from '../../models/cars/index.ts';
import {
  BODY_SPECS, buildBusSignGeometry, buildBusWheelGeo, buildCarGeometry, buildCarProxyGeometry,
  buildCombiSignGeometry, buildLightbarGeometry, buildLoftedBusBodyGeometry, buildSteerableWheelGeo,
  busLiveryTexture, createBusWheelMaterial, createLightbarMaterial, createLoftedBusMaterial, createLoftedCarMaterial,
  createRouteSignMaterial, routeSignTexture
} from '../../actors/actor-models.ts';
import type { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import type { Transit } from '../transit.ts';
import { LIVERIES, NUM_BUSES, NUM_CARS } from './constants.ts';

// (the group gets them in the order the traffic always added them: the cars' bodies and wheels, the spark pool made just
// before, the light bars and the combis' signs; the camiones' meshes are added later, after the two-wheelers')
function createVehicleMeshes(group: THREE.Group, transit: Transit, policeCount: number, combiCount: number, unitPlane: THREE.PlaneGeometry,
  contactShadowMat: ReturnType<typeof createContactShadowMaterial>, sparkInst: THREE.InstancedMesh) {
  const carWheelLeftGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, -1);
  const carWheelRightGeo = buildSteerableWheelGeo(BODY_SPECS.sedan, 1);
  const carWheelMat = createLoftedCarMaterial(BODY_SPECS.sedan, 0xffbe14);
  const CAR_BODIES = ['taxi', ...Object.keys(BODY_SHARE)];

  // Per body shape: the full model (with separately instanced spinning wheels near the camera) and, beyond
  // CAR_PROXY_DISTANCE, the ~250-triangle stand-in. Instance slots are handed out every frame to the cars the camera
  // can see (or whose shadow it may see), see renderCar(); any car may come back as any body shape, so each has room
  // for all of them. Per-instance paint & lamp / livery state the car material reads: brake lights, left (+x) & right
  // (-x) turn signals, livery (1 = police).
  const bodies: Record<string, { near: THREE.InstancedMesh; far: THREE.InstancedMesh }> = {};
  for (const kind of CAR_BODIES) {
    const spec = BODY_SPECS[kind];
    const mat = createLoftedCarMaterial(spec, null, { crumple: true });
    const lodMesh = (g: THREE.BufferGeometry) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(NUM_CARS * 3), 3));
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(NUM_CARS * 4), 4));
      return new THREE.InstancedMesh(g, mat, NUM_CARS);
    };
    bodies[kind] = { near: lodMesh(buildCarGeometry(spec, false)), far: lodMesh(buildCarProxyGeometry(spec)) };
  }
  const bodyMeshes = Object.values(bodies).flatMap((b) => [b.near, b.far]);

  const carWheelLeftInst = new THREE.InstancedMesh(carWheelLeftGeo, carWheelMat, NUM_CARS * 2);
  const carWheelRightInst = new THREE.InstancedMesh(carWheelRightGeo, carWheelMat, NUM_CARS * 2);

  // The routes' names, one atlas row each, for the buses' glass and the combis' roof signs
  const signNames = transit.routeNames.length ? transit.routeNames : ['Tepic'];
  const signTexture = routeSignTexture(signNames);
  const combiSignGeo = buildCombiSignGeometry();
  const combiSignRows = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, combiCount)), 1);
  combiSignGeo.setAttribute('signRow', combiSignRows);
  const combiSignInst = new THREE.InstancedMesh(combiSignGeo, createRouteSignMaterial(signTexture, signNames.length, 'box'), Math.max(1, combiCount));
  combiSignInst.castShadow = true;

  // NYPD roof light bars (the blue & white livery is painted by the sedan material from the instance's carState)
  const policeLightbarInst = new THREE.InstancedMesh(buildLightbarGeometry(BODY_SPECS.sedan), createLightbarMaterial(), Math.max(1, policeCount));
  const carShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_CARS);
  carShadowInst.renderOrder = 998;

  for (const m of bodyMeshes) m.castShadow = m.receiveShadow = true;
  policeLightbarInst.castShadow = true;
  carWheelLeftInst.castShadow = carWheelLeftInst.receiveShadow = true;
  carWheelRightInst.castShadow = carWheelRightInst.receiveShadow = true;

  group.add(
    ...bodyMeshes,
    carWheelLeftInst,
    carWheelRightInst,
    sparkInst,
    policeLightbarInst,
    combiSignInst
  );

  // =========================================================================
  // 2. LOFTED CAMIONES ON TEPIC'S ROUTES (16 BUSES)
  // =========================================================================
  const busBodyGeo = buildLoftedBusBodyGeometry();
  // Per-instance lamp state the bus material reads: brake lights, left (+x) & right (-x) turn signals (renderBus),
  // and its route's livery (an index into LIVERIES)
  const busStates = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES * 4), 4);
  busBodyGeo.setAttribute('busState', busStates);
  // The route's name across the windshield, the first side windows & the rear window
  const busHeaderGeo = buildBusSignGeometry();
  const busSignRows = new THREE.InstancedBufferAttribute(new Float32Array(NUM_BUSES), 1);
  busHeaderGeo.setAttribute('signRow', busSignRows);

  const busBodyMat = createLoftedBusMaterial(busLiveryTexture(LIVERIES));
  const busDestMat = createRouteSignMaterial(signTexture, signNames.length, 'glass');

  const busWheelMat = createBusWheelMaterial();
  const busBodyInst = new THREE.InstancedMesh(busBodyGeo, busBodyMat, NUM_BUSES);
  const busHeaderInst = new THREE.InstancedMesh(busHeaderGeo, busDestMat, NUM_BUSES);
  const busWheelLeftInst = new THREE.InstancedMesh(buildBusWheelGeo(-1), busWheelMat, NUM_BUSES * 2);
  const busWheelRightInst = new THREE.InstancedMesh(buildBusWheelGeo(1), busWheelMat, NUM_BUSES * 2);
  const busShadowInst = new THREE.InstancedMesh(unitPlane, contactShadowMat, NUM_BUSES);
  busShadowInst.renderOrder = 998;

  busBodyInst.castShadow = busBodyInst.receiveShadow = true;
  busWheelLeftInst.castShadow = busWheelLeftInst.receiveShadow = true;
  busWheelRightInst.castShadow = busWheelRightInst.receiveShadow = true;
  return {
    bodies, bodyMeshes, carWheelLeftInst, carWheelRightInst,
    signNames, combiSignGeo, combiSignRows, combiSignInst, policeLightbarInst, carShadowInst,
    busBodyGeo, busStates, busHeaderGeo, busSignRows, busBodyMat, busDestMat, busWheelMat,
    busBodyInst, busHeaderInst, busWheelLeftInst, busWheelRightInst, busShadowInst
  };
}

/** The instanced meshes of the cars and camiones (createVehicleMeshes), part of the traffic's state */
type VehicleMeshes = ReturnType<typeof createVehicleMeshes>;

export type { VehicleMeshes };
export { createVehicleMeshes };
