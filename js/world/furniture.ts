import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { liftAt } from './ground.ts';
import { surfaceY } from './footways.ts';
import type { Collider } from './buildings.ts';

// js/world/furniture.ts
// The street furniture & the gas stations OpenStreetMap maps (city-geodata.js `benches`, `fuel`): the parks' and
// plazas' benches (steel legs, wooden slats and back) where they stand, along the street nearest them; and each gas
// station's canopy over its forecourt, on its columns, with the pump islands under it. The canopies' columns, the
// pumps and the benches stop the player. (The bins OpenStreetMap maps join street-details.ts' own, which knock over.)

const CANOPY_H = 5.6; // m to the canopy's underside
const ISLAND_EVERY = 7; // m of canopy length per pump island

// a box w x h x d centred at (x, y, z)
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Draws the benches and the gas stations into `scene`: their colliders */
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

  // Gas stations: each canopy its own size (scaled boxes), its columns & pump islands per instance
  const canopies: THREE.Matrix4[] = [], fascias: THREE.Matrix4[] = [], columns: THREE.Matrix4[] = [], islands: THREE.Matrix4[] = [], pumps: THREE.Matrix4[] = [];
  const s = new THREE.Vector3(), at = new THREE.Vector3();
  for (const [cx, cz, turn, len10, wid10] of GEO.fuel) {
    const th = turn / 1000, L = len10 / 10, W = wid10 / 10;
    const ux = Math.cos(th), uz = -Math.sin(th); // (along the canopy's length)
    const vx = Math.sin(th), vz = Math.cos(th); // (across it)
    const y = liftAt(cx, cz) + surfaceY(cx, cz);
    q.setFromAxisAngle(up, th);
    canopies.push(new THREE.Matrix4().compose(at.set(cx, y + CANOPY_H + 0.3, cz), q, s.set(L, 0.6, W)));
    // (its coloured band round the edge: just under the roof's top, which hides it from above)
    fascias.push(new THREE.Matrix4().compose(at.set(cx, y + CANOPY_H + 0.27, cz), q, s.set(L + 0.12, 0.5, W + 0.12)));
    const n = Math.max(1, Math.floor(L / ISLAND_EVERY));
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * (L / n);
      const ix = cx + ux * u, iz = cz + uz * u;
      // the island across the canopy, a column at its middle, a pump either side of it
      islands.push(new THREE.Matrix4().compose(at.set(ix, y + 0.1, iz), q, s.set(1.2, 0.2, Math.min(W - 2, 6))));
      columns.push(new THREE.Matrix4().compose(at.set(ix, y + CANOPY_H / 2, iz), q, s.set(0.45, CANOPY_H, 0.45)));
      collide(ix, iz, 0.6, Math.min(W - 2, 6) / 2, th, y, CANOPY_H);
      for (const side of [-1, 1]) {
        const off = side * Math.min(W / 2 - 1.5, 2);
        pumps.push(new THREE.Matrix4().compose(at.set(ix + vx * off, y + 1.1, iz + vz * off), q, s.set(0.7, 1.8, 0.5)));
      }
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  instanced(unit, new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.6 }), canopies);
  instanced(unit.clone(), new THREE.MeshStandardNodeMaterial({ color: 0x1f7a3c, roughness: 0.45 }), fascias);
  instanced(unit.clone(), new THREE.MeshStandardNodeMaterial({ color: 0xd8d8d2, roughness: 0.7 }), columns);
  instanced(unit.clone(), new THREE.MeshStandardNodeMaterial({ color: 0xb9b5aa, roughness: 0.85 }), islands);
  instanced(unit.clone(), new THREE.MeshStandardNodeMaterial({ color: 0xc8202a, roughness: 0.4, metalness: 0.2 }), pumps);
  scene.add(group);
  console.info(`[furniture] ${benchAt.length} benches, ${GEO.fuel.length} gas stations (${pumps.length} pumps)`);
  return { colliders };
}

export { buildFurniture };
