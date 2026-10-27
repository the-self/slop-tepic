import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.ts';
import { liftAt } from './ground.ts';
import { triangulate, insetOutline } from './lakes.ts';
import { createPoolWaterMaterial } from '../render/tsl-materials.ts';

// js/world/pools.ts
// The swimming pools OpenStreetMap maps (city-geodata.js `pools`: the balnearios', the sports centres', a few houses'):
// a concrete coping round the outline and the water inside it, a hand's breadth in, flat on the ground of the lot
// it lies in (the yards', a park's, the open country's).

const COPING = 0.45; // m of concrete round the water
const YARD_Y = 0.22 + 0.012; // the yards' open ground over the road (city-grid.ts)
const PARK_Y = 0.26;
const FIELD_Y = 0.03;

/** Draws the pools into `scene`; returns how many */
function buildPools(scene: THREE.Object3D): number {
  const coping: number[] = [], water: number[] = [], waterUV: number[] = [];
  for (const ring of GEO.pools) {
    const n = ring.length / 2;
    if (n < 3) continue;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += ring[k * 2]; cz += ring[k * 2 + 1]; }
    cx /= n; cz /= n;
    const b = blockAt(cx, cz);
    // (flat at the ground of its middle: water lies level)
    const y = liftAt(cx, cz) + (!b ? 0 : b.rural ? FIELD_Y : b.park > 0.6 && !b.median ? PARK_Y : YARD_Y);
    const tris = triangulate(ring);
    for (let k = 0; k + 1 < tris.length; k += 2) coping.push(tris[k], y + 0.06, tris[k + 1]);
    const inner = insetOutline(ring, COPING);
    const wt = triangulate(inner);
    for (let k = 0; k + 1 < wt.length; k += 2) {
      water.push(wt[k], y + 0.075, wt[k + 1]);
      waterUV.push(wt[k], wt[k + 1]);
    }
  }
  if (!coping.length) return 0;
  const group = new THREE.Group();
  group.name = 'Pools';
  const copingGeo = new THREE.BufferGeometry();
  copingGeo.setAttribute('position', new THREE.Float32BufferAttribute(coping, 3));
  copingGeo.computeVertexNormals();
  const copingMesh = new THREE.Mesh(copingGeo, new THREE.MeshStandardNodeMaterial({ color: 0xd8d2c4, roughness: 0.85 }));
  copingMesh.receiveShadow = true;
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(waterUV, 2));
  waterGeo.computeVertexNormals();
  const waterMesh = new THREE.Mesh(waterGeo, createPoolWaterMaterial());
  waterMesh.receiveShadow = true;
  group.add(copingMesh, waterMesh);
  scene.add(group);
  return GEO.pools.length;
}

export { buildPools };
