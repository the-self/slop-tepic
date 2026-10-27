// js/player/controllers/helicopter.ts
// The sightseeing helicopter: as built, its flight, and landed clear of the buildings
import * as THREE from 'three/webgpu';
import {
  buildHelicopterBodyGeometry, buildHelicopterMainRotorGeometry, buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} from '../../actors/actor-models.ts';
import { START, SPAWN, LABELS, groundCollider } from './constants.ts';
import type { HelicopterEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// The helicopter waits on the ground, clear of the buildings, for the player to walk up and get in (back at its
// spot near the start with `home`, so it is always found there when the game starts)
export function landHelicopter(ctl: ThirdPersonControllerManager, home = false): void {
  const h = ctl.entities.helicopter;
  if (home) {
    h.position.x = SPAWN.helicopter.x;
    h.position.z = SPAWN.helicopter.z;
    h.heading = START.heading + 0.62;
  }
  const mode = ctl.activeMode;
  ctl.activeMode = 'helicopter';
  const altitude = ctl.getGroundHeight(h.position.x, h.position.z, 'helicopter') + 0.25;
  const spot = ctl.findTeleportPosition(h.position.x, h.position.z, h.heading, altitude);
  ctl.activeMode = mode;
  if (spot) {
    h.position.x = spot.x;
    h.position.z = spot.z;
  }
  h.position.y = ctl.getGroundHeight(h.position.x, h.position.z, 'helicopter') + 0.25;
  ctl.settle(h);
}

// =========================================================================
// 4. HELICOPTER (3D LOFTED SIGHTSEEING TWIN-TURBINE CHOPPER)
// =========================================================================
export function createHelicopterEntity(ctl: ThirdPersonControllerManager): HelicopterEntity {
  const root = new THREE.Group();
  root.name = 'PlayerHelicopter';

  const tiltPivot = new THREE.Group();
  root.add(tiltPivot);

  const heliLoftMat = createLoftedHelicopterMaterial();
  const blurDiscMat = new THREE.MeshBasicNodeMaterial({
    color: 0xc8d8e8,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
  const heliBodyGeo = buildHelicopterBodyGeometry();
  const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
  heliBodyMesh.castShadow = true;
  heliBodyMesh.receiveShadow = true;
  tiltPivot.add(heliBodyMesh);

  // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
  const mainRotorPivot = new THREE.Group();
  mainRotorPivot.position.set(0, 2.66, -0.35);
  const mainRotorGeo = buildHelicopterMainRotorGeometry();
  const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
  mainRotorMesh.castShadow = true;
  mainRotorPivot.add(mainRotorMesh);

  const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
  mainRotorPivot.add(blurDisc);
  tiltPivot.add(mainRotorPivot);

  // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
  const tailRotorPivot = new THREE.Group();
  tailRotorPivot.position.set(0.18, 2.02, -5.62);
  const tailRotorGeo = buildHelicopterTailRotorGeometry();
  const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
  tailRotorPivot.add(tailRotorMesh);
  tiltPivot.add(tailRotorPivot);

  // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 8, 8),
    new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
  );
  navRed.position.set(-1.09, 1.54, -4.35);
  const navGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.036, 8, 8),
    new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
  );
  navGreen.position.set(1.09, 1.54, -4.35);
  const navTail = new THREE.Mesh(
    new THREE.SphereGeometry(0.042, 8, 8),
    new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
  );
  navTail.position.set(0, 2.84, -6.04);
  tiltPivot.add(navRed, navGreen, navTail);

  ctl.scene.add(root);

  return {
    type: 'helicopter',
    label: LABELS.helicopter,
    mesh: root,
    tiltPivot,
    mainRotorPivot,
    tailRotorPivot,
    position: new THREE.Vector3(SPAWN.helicopter.x, 96, SPAWN.helicopter.z),
    heading: START.heading + 0.62,
    speed: 0,
    verticalSpeed: 0,
    pitchAngle: 0,
    rollAngle: 0,
    cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
    chaseDistance: 11.4,
    chaseHeight: 3.3
  };
}

export function updateHelicopter(ctl: ThirdPersonControllerManager, dt: number, elapsed: number): void {
  const h = ctl.entities.helicopter;
  const maxHorizSpeed = ctl.keys.boost ? 52.0 : 32.0;
  const maxVertSpeed = 16.0;

  let fwdInput = 0;
  if (ctl.keys.forward) fwdInput = Number(ctl.keys.forward);
  else if (ctl.keys.backward) fwdInput = -Number(ctl.keys.backward);

  let yawInput = 0;
  if (ctl.keys.left) yawInput = Number(ctl.keys.left);
  if (ctl.keys.right) yawInput = -Number(ctl.keys.right);

  let vertInput = 0;
  if (ctl.keys.up) vertInput = Number(ctl.keys.up);
  else if (ctl.keys.down) vertInput = -Number(ctl.keys.down);

  if (fwdInput !== 0) {
    h.speed += fwdInput * 24.0 * dt;
    h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
  } else {
    h.speed *= Math.max(0, 1 - dt * 1.8);
  }

  if (vertInput !== 0) {
    h.verticalSpeed += vertInput * 22.0 * dt;
    h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
  } else {
    h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
  }

  h.heading += yawInput * 1.45 * dt;

  h.position.x += Math.sin(h.heading) * h.speed * dt;
  h.position.z += Math.cos(h.heading) * h.speed * dt;
  h.position.y += h.verticalSpeed * dt;

  // from the town's floor up to 380 m over it (the hills are kept below it by keepOffHills)
  const floor = ctl.floorHeight(h.position.x, h.position.z);
  if (h.position.y < floor + 0.25) {
    ctl.reportCollision(h, groundCollider, 'ground', h.position.x, floor + 0.25, h.position.z, 0, 1, 0, -h.verticalSpeed);
    // (landed: the descent stops there, or holding it down kept building speed and hurting it as it sat on the ground)
    h.verticalSpeed = Math.max(0, h.verticalSpeed);
  }
  h.position.y = Math.max(floor + 0.25, Math.min(floor + 380, h.position.y));
  ctl.resolveHorizontalCollision(h.position, 4.5, null, h);

  const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
  const targetRoll = -yawInput * 0.28;
  h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
  h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

  h.tiltPivot.rotation.x = h.pitchAngle;
  h.tiltPivot.rotation.z = h.rollAngle;
  h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
}
