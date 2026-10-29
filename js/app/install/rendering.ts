// js/app/install/rendering.ts
// Once the city and the systems that add to it are in the scene: its static geometry chunked, culled and frozen, the
// small instanced meshes' matrices moved to storage buffers, and the render pipeline over it all.
import * as THREE from 'three/webgpu';
import { setupSceneCulling, freezeStaticMatrices } from '../../render/scene-culling.ts';
import { createRenderPipeline } from '../render-pipeline.ts';
import type { Boot } from './boot.ts';
import type { PlayerParts } from './player.ts';

export type RenderingParts = ReturnType<typeof installRendering>;

export function installRendering({ scene, renderer, lighting, quality, loading, cameras }: Boot & PlayerParts) {
  // City-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (render/scene-culling.ts)
  const named = (names: readonly string[]) => names.map((name) => scene.getObjectByName(name)).filter((o) => o !== undefined);
  // (the high-voltage towers too: 884 of them, 960 triangles each, were drawn whole in the view and both cascades)
  const cullingRoots = named(['CityGrid', 'CityBlocks', 'StreetDetails', 'Hills', 'Rivers', 'Bridges', 'Bardas', 'PowerLines']);
  // (the hills', rivers' & bridges' pieces merged by material: render/scene-culling.ts mergeSiblings)
  setupSceneCulling(scene, cullingRoots, lighting.sunLight.shadow, quality.propDistance, named(['Hills', 'Rivers', 'Bridges']));
  // ...whose world matrices never change again: rendering stops walking them (the loop updates the rest of the scene)
  const staticRoots = [...cullingRoots, ...named(['TepicLandmarks', 'Cotos', 'CarParks', 'Embotelladora', 'Airport', 'RoadMarkings', 'Pavements', 'Footways', 'Topes', 'StreamedTiles', 'BusStops', 'PowerLines', 'Pools', 'Furniture'])
    .filter((o) => o.parent === scene)];
  freezeStaticMatrices(scene, staticRoots);
  loading.mark('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend instanceof THREE.WebGPUBackend) {
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // The render pipeline: the scene pass, half-res screen-space reflections, bloom & the colour grade
  const render = createRenderPipeline(renderer, scene, cameras.camera, quality.ssr);
  return { render };
}
