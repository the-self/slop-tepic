// js/actors/vehicles/car-files.ts
// The car models made as 3D models (models/cars `glb`, assets/models/CLAUDE.md), loaded once in the background for
// both the traffic (sim/traffic/meshes.ts) and the player's car (player/controllers/car-looks.ts), so a car taken
// from the traffic is the same model the player saw driving. Each file is its body (its wheels pressed into dark
// wells by tools/models/prepare.mjs) and where its wheels go: the game draws and turns those itself.
import * as THREE from 'three/webgpu';
import { CAR_MODELS } from '../../models/cars/index.ts';

/** Where a car file's wheels are, in its own frame (the nose to +z, the ground at y = 0): m */
export interface CarFileWheels {
  x: number; // the tyres' middles, either side
  front: number; // the front axle's z
  rear: number; // the rear axle's z (negative)
  radius: number;
}

/** A loaded car model: its body (one mesh, world-baked), its wheel, its texture, its paint mask & where its wheels are */
export interface CarFile {
  geometry: THREE.BufferGeometry;
  // its wheel, the axle on the origin: as modelled for the +x side (its outer face to +x), and mirrored for -x
  wheel: { right: THREE.BufferGeometry; left: THREE.BufferGeometry } | null;
  map: THREE.Texture;
  paintMap: THREE.Texture | null; // R the paint mask, G the roughness (prepare.mjs paintMask)
  glowMap: THREE.Texture | null; // what glows by itself day and night (prepare-made.mjs 'drl': a light bar), none mostly
  wheels: CarFileWheels | null; // (none: a file from before the wheels were taken out, its own drawn on it)
  // its lighter levels for further off, nearest first (tools/models/add-lods.mjs: a heavy car's ~30% & ~10%); none for
  // a light one
  lods: CarFileLevel[];
}

/** A car file's lighter level of detail: its body and its wheel (as CarFile's), simplified */
export interface CarFileLevel {
  geometry: THREE.BufferGeometry;
  wheel: { right: THREE.BufferGeometry; left: THREE.BufferGeometry } | null;
}

/** A car file's levels of detail by distance from the camera (m): its own to the first, its lighter ones (CarFile
 * `lods`) to the next, as open-world games' cars change at about 15, 30, 60 & 120 m (the traffic's plain body shape takes over beyond
 * sim/traffic/render.ts CAR_PROXY_DISTANCE) */
export const MODEL_LOD_DISTANCES = [25, 50];

/** Which of a car file's `levels` (its own first, then its lods) to draw `dist` m from the camera */
export function lodFor(dist: number, levels: number): number {
  const want = dist < MODEL_LOD_DISTANCES[0] ? 0 : dist < MODEL_LOD_DISTANCES[1] ? 1 : 2;
  return Math.min(levels - 1, want);
}

const files = new Map<string, CarFile>();
const listeners: ((id: string, file: CarFile) => void)[] = [];
let started = false;

// (the mesh's extras, as prepare.mjs writes them: { wheels: { x, z: [front, rear], radius } })
export function wheelsOf(userData: Record<string, unknown>): CarFileWheels | null {
  const w = userData.wheels;
  if (typeof w !== 'object' || w === null || !('x' in w) || !('z' in w) || !('radius' in w)) return null;
  const { x, z, radius } = w;
  if (typeof x !== 'number' || typeof radius !== 'number' || !Array.isArray(z) || z.length !== 2) return null;
  const front: unknown = z[0], rear: unknown = z[1];
  if (typeof front !== 'number' || typeof rear !== 'number') return null;
  return { x, front, rear, radius };
}

// A geometry mirrored across x = 0, its triangles' winding turned so their fronts still face out
function mirrored(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = geo.clone().scale(-1, 1, 1);
  const index = out.getIndex();
  if (index) {
    const ix = index.array;
    for (let i = 0; i < ix.length; i += 3) [ix[i], ix[i + 2]] = [ix[i + 2], ix[i]];
  }
  return out;
}

// A mesh with one material
function isSingleMesh(o: THREE.Object3D): o is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return o instanceof THREE.Mesh && !Array.isArray(o.material);
}

// The file's emissive texture, sampled without mipmaps: a lamp's few texels, averaged with the black round them, dimmed
// out further off than it should
function glowMapOf(material: THREE.MeshStandardMaterial): THREE.Texture | null {
  const map = material.emissiveMap;
  if (!map) return null;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/** Starts loading every car model's file (once; the later calls do nothing). A file that fails is left out. */
export function loadCarFiles(): void {
  if (started) return;
  started = true;
  const withFile = CAR_MODELS.filter((m) => m.glb);
  if (!withFile.length) return;
  const loading = import('three/addons/loaders/GLTFLoader.js');
  void loading.then(({ GLTFLoader }) => {
    const loader = new GLTFLoader();
    for (const model of withFile) {
      const url = model.glb;
      if (!url) continue;
      loader.load(url, (gltf) => {
        const found: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
        gltf.scene.traverse((o) => {
          if (isSingleMesh(o)) found.push(o);
        });
        // (the body is the mesh that says where the wheels go; 'wheel' is the wheel; 'lod1', 'lod1_wheel'... the levels)
        const src = found.find((m) => 'wheels' in m.userData) ?? found.at(0);
        if (!src || !(src.material instanceof THREE.MeshStandardMaterial) || !src.material.map) return;
        src.updateWorldMatrix(true, false);
        const named = (name: string) => found.find((m) => m !== src && m.name === name);
        const wheel = named('wheel') ?? found.find((m) => m !== src && !m.name.startsWith('lod'));
        const lods: CarFileLevel[] = [];
        for (let n = 1; named(`lod${n}`); n++) {
          const body = named(`lod${n}`), w = named(`lod${n}_wheel`);
          if (!body) break;
          body.updateWorldMatrix(true, false);
          lods.push({ geometry: body.geometry.clone().applyMatrix4(body.matrixWorld), wheel: w ? { right: w.geometry, left: mirrored(w.geometry) } : null });
        }
        const file: CarFile = {
          geometry: src.geometry.clone().applyMatrix4(src.matrixWorld),
          wheel: wheel ? { right: wheel.geometry, left: mirrored(wheel.geometry) } : null,
          map: src.material.map,
          paintMap: src.material.roughnessMap,
          glowMap: glowMapOf(src.material),
          wheels: wheelsOf(src.userData),
          lods
        };
        files.set(model.id, file);
        for (const fn of listeners) fn(model.id, file);
      }, undefined, (err) => {
        console.warn(`[cars] ${model.name}: could not load ${url}`, err);
      });
    }
  });
}

/** A car model's file, once it has loaded */
export function carFile(id: string | null | undefined): CarFile | undefined {
  return id == null ? undefined : files.get(id);
}

/** Calls `fn` for each car file as it loads (and at once for those already loaded) */
export function onCarFile(fn: (id: string, file: CarFile) => void): void {
  listeners.push(fn);
  for (const [id, file] of files) fn(id, file);
}
