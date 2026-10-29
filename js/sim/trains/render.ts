// js/sim/trains/render.ts
// The trains drawn: one instanced mesh per kind of rail vehicle (actors/vehicles/train.ts), filled each frame with the
// cars near enough the eye to see, each in its paint and the diesels in their livery with "Ferromex" along the hood;
// and the lead diesel's headlight, a spot light down the track ahead of the nearest train at night.
import * as THREE from 'three/webgpu';
import {
  buildRailCarGeometry, buildRailNameGeometry, createRailNameMaterial, createTrainMaterial, railNameTexture
} from '../../actors/vehicles/train.ts';
import { RAIL_CARS } from '../../models/trains.ts';
import type { RailCarKind } from '../../models/trains.ts';
import type { CarPose } from './poses.ts';

const KINDS: readonly RailCarKind[] = ['loco', 'hopper', 'boxcar', 'tank', 'gondola', 'stack', 'autorack'];
const ROOM: Record<RailCarKind, number> = { loco: 12, hopper: 170, boxcar: 120, tank: 90, gondola: 80, stack: 170, autorack: 140 };
const HEADLIGHT = 260; // m from the eye the lead diesel's headlight is lit within

/** One kind's mesh and its per-instance attributes */
interface KindMesh {
  mesh: THREE.InstancedMesh;
  paint: Float32Array;
  paint2: Float32Array;
  livery: Float32Array;
  lit: Float32Array;
  attrs: THREE.BufferAttribute[];
  count: number;
}

/** The trains' meshes into `group`; draw(poses) shows those cars this frame */
function createTrainMeshes(group: THREE.Group) {
  const material = createTrainMaterial();
  const meshes = new Map<RailCarKind, KindMesh>();
  const all: KindMesh[] = []; // (the same, iterated each frame without an iterator)
  for (const kind of KINDS) {
    const geo = buildRailCarGeometry(kind), room = ROOM[kind];
    const paint = new Float32Array(room * 3), paint2 = new Float32Array(room * 3), livery = new Float32Array(room), lit = new Float32Array(room);
    const attrs = [
      new THREE.InstancedBufferAttribute(paint, 3), new THREE.InstancedBufferAttribute(paint2, 3),
      new THREE.InstancedBufferAttribute(livery, 1), new THREE.InstancedBufferAttribute(lit, 1)
    ];
    for (const [i, name] of ['paint', 'paint2', 'livery', 'lit'].entries()) geo.setAttribute(name, attrs[i]);
    const mesh = new THREE.InstancedMesh(geo, material, room);
    mesh.name = `Trains:${kind}`;
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // (a train's cars spread over a kilometre)
    group.add(mesh);
    const k: KindMesh = { mesh, paint, paint2, livery, lit, attrs, count: 0 };
    meshes.set(kind, k);
    all.push(k);
  }
  // the name along the diesels' hoods
  const nameGeo = buildRailNameGeometry();
  const nameRow = new Float32Array(ROOM.loco);
  const nameAttr = new THREE.InstancedBufferAttribute(nameRow, 1);
  nameGeo.setAttribute('railName', nameAttr);
  const names = new THREE.InstancedMesh(nameGeo, createRailNameMaterial(railNameTexture()), ROOM.loco);
  names.name = 'Trains:names';
  names.count = 0;
  names.frustumCulled = false;
  group.add(names);
  // the headlight
  const headlight = new THREE.SpotLight(0xfff0d0, 0, 140, 0.32, 0.55, 1.6);
  headlight.name = 'Trains:headlight';
  group.add(headlight, headlight.target);

  const dummy = new THREE.Object3D(), c = new THREE.Color();
  /**
   * Shows the cars `poses` (count of them), the eye at (ex, ez); `night`: the lead diesel's headlight on, the nearest
   * train's
   */
  function draw(poses: readonly CarPose[], count: number, ex: number, ez: number, night: boolean): void {
    for (const k of all) k.count = 0;
    let lead: CarPose | null = null;
    for (let i = 0; i < count; i++) {
      const p = poses[i], car = p.car;
      if (!car) continue;
      const k = meshes.get(car.kind);
      if (!k || k.count >= ROOM[car.kind]) continue;
      const j = k.count++;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
      dummy.updateMatrix();
      k.mesh.setMatrixAt(j, dummy.matrix);
      c.setHex(car.paint);
      k.paint[j * 3] = c.r; k.paint[j * 3 + 1] = c.g; k.paint[j * 3 + 2] = c.b;
      c.setHex(car.paint2);
      k.paint2[j * 3] = c.r; k.paint2[j * 3 + 1] = c.g; k.paint2[j * 3 + 2] = c.b;
      k.livery[j] = car.livery;
      const isLead = p.index === 0;
      k.lit[j] = isLead ? 1 : 0;
      if (car.kind === 'loco') {
        names.setMatrixAt(j, dummy.matrix);
        nameRow[j] = car.livery;
        if (isLead && (!lead || p.far < lead.far)) lead = p;
      }
    }
    for (const k of all) {
      k.mesh.count = k.count;
      k.mesh.visible = k.count > 0;
      if (!k.count) continue;
      k.mesh.instanceMatrix.needsUpdate = true;
      for (const a of k.attrs) a.needsUpdate = true;
    }
    const locos = meshes.get('loco')?.count ?? 0;
    names.count = locos;
    names.visible = locos > 0;
    if (locos) {
      names.instanceMatrix.needsUpdate = true;
      nameAttr.needsUpdate = true;
    }
    // the headlight: from over the nose, down the track ahead
    const on = night && lead !== null && Math.hypot(lead.x - ex, lead.z - ez) < HEADLIGHT;
    headlight.intensity = on ? 900 : 0;
    if (on && lead) {
      const fx = Math.sin(lead.yaw), fz = Math.cos(lead.yaw), ahead = RAIL_CARS.loco.length / 2;
      headlight.position.set(lead.x + fx * ahead, lead.y + 4.4, lead.z + fz * ahead);
      headlight.target.position.set(lead.x + fx * (ahead + 60), lead.y, lead.z + fz * (ahead + 60));
      headlight.target.updateMatrixWorld();
    }
  }
  return { draw };
}

export { createTrainMeshes };
