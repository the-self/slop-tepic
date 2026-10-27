// js/world/furniture.ts
// The street furniture OpenStreetMap maps (city-geodata.js `benches`): the parks' and plazas' benches (steel legs,
// wooden slats and back) where they stand, along the street nearest them; they stop the player. (The bins it maps join
// street-details.ts' own, which knock over; its gas stations join Overture's in sim/gas-stations.ts.)
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { liftAt } from './ground.ts';
import { surfaceY } from './footways.ts';
import type { Collider } from './buildings.ts';

// a box w x h x d centred at (x, y, z)
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Draws the benches into `scene`: their colliders */
function buildFurniture(scene: THREE.Object3D): { colliders: Collider[] } {
  const group = new THREE.Group();
  group.name = 'Furniture';
  const colliders: Collider[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  // a box collider for something hx x hz (half sizes, m) at (x, z) turned θ, from y up h m
  const collide = (x: number, z: number, hx: number, hz: number, th: number, y: number, h: number) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y, maxY: y + h, obb: { cx: x, cz: z, hx, hz, cs, sn } });
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => { mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // Benches: 1.8 m of slats on two steel frames, the back on the side away from the street (local z +)
  const benchAt: THREE.Matrix4[] = [];
  for (let k = 0; k + 2 < GEO.benches.length; k += 3) {
    const x = GEO.benches[k], z = GEO.benches[k + 1], th = GEO.benches[k + 2] / 1000;
    const y = liftAt(x, z) + surfaceY(x, z);
    q.setFromAxisAngle(up, th);
    benchAt.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, one));
    collide(x, z, 0.95, 0.35, th, y, 0.85);
  }
  const wood = mergeGeometries([box(1.8, 0.05, 0.42, 0, 0.45, 0), box(1.8, 0.32, 0.04, 0, 0.72, 0.22)]);
  const frame = mergeGeometries([-0.8, 0.8].flatMap((x) => [box(0.06, 0.45, 0.42, x, 0.225, 0), box(0.06, 0.4, 0.05, x, 0.68, 0.22)]));
  instanced(wood, new THREE.MeshStandardNodeMaterial({ color: 0x8a5a33, roughness: 0.8 }), benchAt);
  instanced(frame, new THREE.MeshStandardNodeMaterial({ color: 0x2b2e31, roughness: 0.5, metalness: 0.6 }), benchAt);

  scene.add(group);
  console.info(`[furniture] ${benchAt.length} benches`);
  return { colliders };
}

export { buildFurniture };
