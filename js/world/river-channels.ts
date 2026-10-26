import * as THREE from 'three/webgpu';
import { waterways, deckHoles } from './ground.ts';
import { cutHoles } from './waterways.ts';
import { drapeGeometry } from './drape.ts';
import { createRiverBankMaterial, createRiverWaterMaterial, createCurbMaterial, createBridgeConcreteMaterial } from '../render/tsl-materials.ts';
import type { ChannelMesh } from './waterways.ts';

// js/world/river-channels.ts
// Draws the river channels of waterways.ts (the Río Mololoa, its old bed, the arroyos): their stone banks & silty bed,
// the water in them and the bridges' decks seen from below, laid on the town's slopes (drape.ts), and opens the road
// deck over them and over the open underpasses (cutDeckHoles), so the channels and the cuts are seen sunk into the
// ground instead of under the asphalt.

/** The channels drawn: their group, and the water's mesh (null without channels), which rises with a flood. */
export interface RiverChannels {
  group: THREE.Group;
  water: THREE.Mesh | null;
}

// A BufferGeometry from waterways.ts meshData() triangles (heights over the town's floor), laid on the floor
function draped(data: ChannelMesh<Float32Array>) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
  if (data.wet) geo.setAttribute('wet', new THREE.BufferAttribute(data.wet, 1));
  const out = drapeGeometry(geo);
  if (out !== geo) geo.dispose();
  out.computeVertexNormals(); // (flat: every triangle its own)
  out.computeBoundingSphere();
  return out;
}

function buildRiverChannels(scene: THREE.Object3D): RiverChannels {
  const group = new THREE.Group();
  group.name = 'Rivers';
  let waterMesh: THREE.Mesh | null = null;
  if (waterways) {
    const { banks, water, bridges, lined } = waterways.meshData();
    const add = (data: ChannelMesh<Float32Array>, material: THREE.Material, shadows: boolean) => {
      if (!data.position.length) return null;
      const mesh = new THREE.Mesh(draped(data), material);
      mesh.receiveShadow = true;
      mesh.castShadow = shadows;
      group.add(mesh);
      return mesh;
    };
    add(banks, createRiverBankMaterial(), false);
    add(lined, createBridgeConcreteMaterial(), false); // (the canals' & drenes' concrete)
    waterMesh = add(water, createRiverWaterMaterial(), false); // (it rises with a flood, floods.ts)
    const slab = createCurbMaterial();
    slab.side = THREE.DoubleSide;
    add(bridges, slab, true);
  }
  scene.add(group);
  return { group, water: waterMesh };
}

/**
 * The road deck's geometry (non-indexed or indexed, as city-grid.ts leaves it) with the channels' holes taken out, and
 * the open underpasses' (bridges.ts draws them)
 */
function cutDeckHoles(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const holes = deckHoles();
  if (!holes.length) return geometry;
  const names = Object.keys(geometry.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
  const attrs = names.map((n) => geometry.attributes[n]);
  const out = cutHoles(attrs.map((a) => a.array), attrs.map((a) => a.itemSize), geometry.index ? geometry.index.array : null, holes);
  const cut = new THREE.BufferGeometry();
  names.forEach((n, k) => cut.setAttribute(n, new THREE.BufferAttribute(out[k], attrs[k].itemSize, attrs[k].normalized)));
  cut.computeBoundingBox();
  cut.computeBoundingSphere();
  geometry.dispose();
  return cut;
}

export { buildRiverChannels, cutDeckHoles };
