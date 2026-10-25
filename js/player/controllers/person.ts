// js/player/controllers/person.ts
// The player on foot: its skinned walker built, walking, strafing (aiming) and jumping, and thrown as a ragdoll
// (sim/ragdolls.ts) and back on its feet
import * as THREE from 'three/webgpu';
import { PersonCrowd, PersonRig } from '../../sim/pedestrians.ts';
import { ISLAND_BOUNDS } from '../../world/city-config.ts';
import { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import { SPAWN, LABELS, AIM_WALK, GET_UP, personGround } from './constants.ts';
import type { ThrowOptions } from '../../sim/ragdolls.ts';
import type { PersonEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// =========================================================================
// 1. PERSON (SKINNED PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.ts)
// =========================================================================
export function createPersonEntity(ctl: ThirdPersonControllerManager): PersonEntity {
  const root = new THREE.Group();
  root.name = 'PlayerPerson';

  // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
  const crowd = new PersonCrowd(1, { farDistance: Infinity });
  crowd.meshes.forEach((m) => ctl.scene.add(m));
  const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });

  // Soft Under-Foot Contact Shadow (AO)
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shadowGeo.rotateX(-Math.PI * 0.5);
  const pedShadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
  pedShadow.position.y = 0.02;
  pedShadow.renderOrder = 998;
  root.add(pedShadow);

  ctl.scene.add(root);

  return {
    type: 'person',
    label: LABELS.person,
    mesh: root,
    shadow: pedShadow,
    crowd,
    rig,
    position: new THREE.Vector3(SPAWN.person.x, ISLAND_BOUNDS.sidewalkHeight, SPAWN.person.z),
    heading: SPAWN.person.heading,
    speed: 0,
    verticalVel: 0,
    cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
    chaseDistance: 4.3,
    chaseHeight: 1.95
  };
}

export function updatePerson(ctl: ThirdPersonControllerManager, dt: number): void {
  const p = ctl.entities.person;
  if (p.ragdoll) {
    ctl.followRagdoll(p);
    return;
  }
  const wading = ctl.waterAt ? Math.min(0.6, ctl.waterAt(p.position.x, p.position.z) * 1.3) : 0;
  const maxWalk = (ctl.keys.boost && ctl.canSprint ? 8.2 : 4.4) * (1 - wading);
  const turnRate = 2.6;

  let targetSpeed = 0;
  let targetStrafe = 0;
  if (ctl.aiming) {
    // aiming (player/aim.ts): the mouse turns the player, A / D step sideways, all at a walk
    const ahead = (Number(ctl.keys.forward) || 0) - (Number(ctl.keys.backward) || 0);
    const side = (Number(ctl.keys.right) || 0) - (Number(ctl.keys.left) || 0);
    const k = AIM_WALK / Math.max(1, Math.hypot(ahead, side));
    targetSpeed = ahead * k;
    targetStrafe = side * k;
  } else {
    if (ctl.keys.forward) targetSpeed = maxWalk * Number(ctl.keys.forward);
    else if (ctl.keys.backward) targetSpeed = -maxWalk * 0.65 * Number(ctl.keys.backward);

    if (ctl.keys.left) p.heading += turnRate * dt * Number(ctl.keys.left);
    if (ctl.keys.right) p.heading -= turnRate * dt * Number(ctl.keys.right);
  }

  p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);
  p.strafe = (p.strafe || 0) + (targetStrafe - (p.strafe || 0)) * Math.min(1, dt * 10);

  // (to the right is (-cos, sin) of the heading)
  p.position.x += (Math.sin(p.heading) * p.speed - Math.cos(p.heading) * p.strafe) * dt;
  p.position.z += (Math.cos(p.heading) * p.speed + Math.sin(p.heading) * p.strafe) * dt;
  ctl.resolveHorizontalCollision(p.position, 0.48);

  const groundY = ctl.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
  if (ctl.keys.up && p.position.y <= groundY + 0.02) {
    p.verticalVel = 5.2;
  }
  p.verticalVel -= 14.5 * dt;
  p.position.y += p.verticalVel * dt;
  if (p.position.y < groundY) {
    p.position.y = groundY;
    p.verticalVel = 0;
  }
}

// The player on foot at (x, z) facing `heading`, thrown as a ragdoll (sim/ragdolls.ts spawn's `thrown`): standing,
// its feet lifted to `y`; or as `rider` (a PersonRig of the same build: a moto's or bicycle's rider, astride it) sits
export function throwPlayer(ctl: ThirdPersonControllerManager, x: number, z: number, heading: number, y: number, rider: PersonRig | false, thrown: ThrowOptions): void {
  const p = ctl.entities.person;
  const ragdolls = ctl.ragdolls;
  if (!ragdolls) return; // (its callers' check)
  ctl.setMode('person');
  ctl.resetInput();
  p.heading = heading;
  p.position.set(x, ctl.getGroundHeight(x, z, 'person', y + 1), z);
  p.rig.reset(x, z, heading, personGround, ctl);
  if (rider) p.rig.pose.set(rider.pose.subarray(0, 15 * 8));
  else for (let b = 0; b < 15; b++) p.rig.pose[b * 8 + 5] += y - p.position.y;
  p.ragdoll = ragdolls.spawn(p.rig, thrown);
  p.ragdollOwner = 'controllers';
}

// On foot as a ragdoll (thrown out of the car; or down, crime.ts): the camera follows the body; one thrown out gets up
// once it has lain still a while
export function followRagdoll(ctl: ThirdPersonControllerManager, p: PersonEntity): void {
  const h = p.ragdoll;
  if (!h) return; // (only while it is one)
  p.position.set(h.px, ctl.getGroundHeight(h.px, h.pz, 'person', h.py), h.pz);
  p.speed = 0;
  if (p.ragdollOwner !== 'controllers' || h.rest < GET_UP) return;
  ctl.getUp();
  ctl.settle(p); // (on its feet where it lay)
}

// The player's body (sim/ragdolls.ts) let go of: on its feet again, wherever it is put next
export function getUp(ctl: ThirdPersonControllerManager): void {
  const p = ctl.entities.person;
  if (!p.ragdoll) return;
  ctl.ragdolls?.release(p.ragdoll);
  p.ragdoll = null;
}
