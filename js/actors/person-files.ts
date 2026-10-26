// js/actors/person-files.ts
// The people made as 3D models (tools/models/prepare-person.mjs: a Meshy person reposed into the crowd's bind pose and
// skinned to its 15 bones), loaded once each in the background for the crowds that draw them (sim/pedestrians.ts
// PersonCrowd `model`). Each file is its near body ('person'), its far level ('lod1') and their texture; every vertex
// carries _SKIN, the two bones it follows and the weight of the second. Until a file loads (or if it fails) the crowd
// draws its own lofted body.
import * as THREE from 'three/webgpu';

/** A loaded person model: its body near by and far off (bind pose, metres, facing +z) and its texture */
export interface PersonFile {
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry | null;
  map: THREE.Texture;
}

const files = new Map<string, Promise<PersonFile>>();

// A mesh with one material
function isSingleMesh(o: THREE.Object3D): o is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return o instanceof THREE.Mesh && !Array.isArray(o.material);
}

/** The person model at `url`, loading it the first time it is asked for */
export function loadPersonFile(url: string): Promise<PersonFile> {
  const known = files.get(url);
  if (known) return known;
  const loading = import('three/addons/loaders/GLTFLoader.js');
  const file = loading.then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url)).then((gltf) => {
    const found: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
    gltf.scene.traverse((o) => {
      if (isSingleMesh(o)) found.push(o);
    });
    const near = found.find((m) => m.name === 'person') ?? found.at(0);
    const far = found.find((m) => m !== near && m.name === 'lod1');
    if (!near || !(near.material instanceof THREE.MeshStandardMaterial) || !near.material.map) throw new Error(`${url}: no textured body`);
    if (!('_skin' in near.geometry.attributes)) throw new Error(`${url}: no skin weights (tools/models/prepare-person.mjs)`);
    return { near: near.geometry, far: far?.geometry ?? null, map: near.material.map };
  });
  files.set(url, file);
  return file;
}
