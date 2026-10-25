// js/world/buildings/static-meshes.ts
// What of the buildings is drawn once for the whole city: the facade boxes (one instanced mesh per facade
// material), the colonial houses' balconies, and the rear yards, courts & lawns.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn,
  float,
  color,
  positionWorld,
  fwidth,
  max,
  min,
  mix,
  length,
  smoothstep,
  mx_noise_float,
  mx_worley_noise_float
} from 'three/tsl';
import { createFacadeBoxes, createBalconyRailMaterial } from '../../render/tsl-materials.ts';
import { liftAt } from '../ground.ts';
import type { CityBuild, Yard } from './types.ts';

// ============================================================================
// C. STATIC ISLAND-WIDE ARCHITECTURAL MASSING (6 TSL Facade Materials)
// ============================================================================
function addStaticMeshes(city: CityBuild, group: THREE.Group, materials: THREE.Material[], unitBox: THREE.BoxGeometry, dummy: THREE.Object3D) {
  city.buckets.forEach((items, matIdx) => {
    if (items.length === 0) return;
    const inst = createFacadeBoxes(materials[matIdx], items);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  });

  // The colonial balconies: a cantera slab 1.5 m wide standing 60 cm out, its iron railing round the front & sides
  if (city.balconies.length) {
    const slabGeo = new THREE.BoxGeometry(1.5, 0.12, 0.6).translate(0, -0.06, 0.3);
    const railGeo = mergeGeometries([
      new THREE.PlaneGeometry(1.5, 0.95).translate(0, 0.475, 0.58),
      new THREE.PlaneGeometry(0.58, 0.95).rotateY(Math.PI / 2).translate(-0.74, 0.475, 0.29),
      new THREE.PlaneGeometry(0.58, 0.95).rotateY(Math.PI / 2).translate(0.74, 0.475, 0.29)
    ]);
    const slabs = new THREE.InstancedMesh(slabGeo, new THREE.MeshStandardNodeMaterial({ color: 0xc2ad8a, roughness: 0.85 }), city.balconies.length);
    const rails = new THREE.InstancedMesh(railGeo, createBalconyRailMaterial(), city.balconies.length);
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    city.balconies.forEach((b, i) => {
      m.compose(at.set(b.x, b.y, b.z), q.setFromAxisAngle(up, b.yaw), one);
      slabs.setMatrixAt(i, m);
      rails.setMatrixAt(i, m);
    });
    slabs.castShadow = true; // (the railing's bars are cut in its colour pass: its shadow would be a solid sheet)
    slabs.receiveShadow = true;
    slabs.name = 'Balconies';
    rails.name = 'BalconyRails';
    group.add(slabs, rails);
  }

  // Rear yards, light courts & project lawns: one thin slab per patch just above the sidewalk (buildings standing on
  // it hide the rest). Lawn, paving and tree canopies come from world-space noise; detail finer than a pixel fades
  // to its average so the gardens don't shimmer from the air
  const yardMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0.0 });
  yardMat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const px = length(fwidth(p)); // metres per pixel
    const fine = smoothstep(0.9, 0.12, px);
    const crownLOD = smoothstep(8.0, 3.0, px); // crowns a few pixels wide or more are drawn, smaller ones averaged
    const grain = mx_noise_float(p.mul(1.9)).mul(fine).mul(0.5).add(0.5);
    const clump = mx_noise_float(p.mul(0.7).add(5.3)).mul(smoothstep(2.0, 0.4, px)).mul(0.5).add(0.5);

    // Lawns with grey / beige patios & light-court paving
    const patch = mx_noise_float(p.mul(0.21)).mul(smoothstep(12.0, 4.0, px));
    const lawn = mix(color(0x5d7a3a), color(0x7a944c), grain);
    const paving = mix(color(0x8c8679), color(0xa59e90), grain);
    const ground = mix(lawn, paving, smoothstep(0.15, 0.45, patch));

    // Street-tree-sized (~12 m) & small (~6 m) crowns, domed: sunlit crowns, softer & darker towards their rims
    const w1 = mx_worley_noise_float(p.mul(0.085));
    const w2 = mx_worley_noise_float(p.mul(0.16).add(17.0));
    const crowns = max(smoothstep(0.55, 0.3, w1), smoothstep(0.45, 0.25, w2).mul(0.85));
    const rim = smoothstep(0.0, 1.0, min(w1.div(0.55), w2.div(0.45)));
    const leaves = mix(color(0x3f5e2a), color(0x5e7f3b), clump.mul(0.6).add(grain.mul(0.4))).mul(mix(float(1.08), float(0.78), rim));
    const leavesMean = mix(color(0x3f5e2a), color(0x5e7f3b), 0.5).mul(0.93);
    return mix(ground, mix(leavesMean, leaves, crownLOD), mix(float(0.5), crowns, crownLOD));
  })();
  const yardRects: Yard[] = [];
  for (const blk of city.allBlocks) yardRects.push(...blk.yards);
  if (yardRects.length) {
    const yardInst = new THREE.InstancedMesh(unitBox, yardMat, yardRects.length);
    yardRects.forEach((r, i) => {
      dummy.position.set((r.x0 + r.x1) * 0.5, 0.225 + liftAt((r.x0 + r.x1) * 0.5, (r.z0 + r.z1) * 0.5), (r.z0 + r.z1) * 0.5);
      dummy.rotation.set(0, r.ry || 0, 0);
      dummy.scale.set(r.x1 - r.x0, 0.05, r.z1 - r.z0);
      dummy.updateMatrix();
      yardInst.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    yardInst.receiveShadow = true;
    group.add(yardInst);
  }
}

export { addStaticMeshes };
