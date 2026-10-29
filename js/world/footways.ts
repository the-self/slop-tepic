// js/world/footways.ts
// The footways OpenStreetMap maps (city-geodata.js `footways`): the walks across the parks & plazas and the andadores
// between the houses in poured concrete, the paths in earth, the centro's pedestrian streets in setts, the steps in
// concrete; a strip per segment of each, laid on the ground it crosses (a park's lawn, a yard, the open country, the
// road deck where a pedestrian street runs between the blocks) and on the town's slopes like the pavements, each run
// on half its width past its ends so the bends close. The people walk them (sim/pedestrian-routes.ts).
import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.ts';
import { createPavementMaterial } from '../render/tsl-materials.ts';
import { drapeGeometry } from './drape.ts';
import { cutDeckHoles } from './river-channels.ts';
import { LA_LOMA } from './la-loma-plan.ts';
import type { TileStreamer } from './streaming.ts';

// over what: the road deck (a pedestrian street), the open country, a park's lawn, a yard's open ground
const ROAD_Y = 0.007, FIELD_Y = 0.036, PARK_Y = 0.416, LOT_Y = 0.24;
// the pavement material's kinds (createPavementMaterial: 0 empedrado, 1 adoquín, 2 tierra, 3 concreto) by footway kind
const PAVE = [3, 2, 1, 3];
// (and the Parque La Loma's andador along its curb, la-loma-plan.ts)
const FOOTWAYS = [...GEO.footways, ...(LA_LOMA?.walks ?? [])];

/** The height (m over the town's floor) of the ground a footway, a bench or a gas station's forecourt stands on at
 *  (x, z): a park's lawn, a yard's open ground, the open country, the road deck */
const groundY = (x: number, z: number) => {
  const b = blockAt(x, z);
  return !b ? ROAD_Y : b.rural ? FIELD_Y : b.park > 0.6 && !b.median ? PARK_Y : LOT_Y;
};

// With `streamer` (streaming.ts) the strips go to it as a layer, laid tile by tile around the camera
function buildFootways(scene: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'> | null = null): THREE.Mesh | null {
  const position: number[] = [];
  const pave: number[] = [];
  const index: number[] = [];
  for (const [kind, width, pts] of FOOTWAYS) {
    const h = width * 0.5;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const x0 = ax - ux * h, z0 = az - uz * h, x1 = bx + ux * h, z1 = bz + uz * h;
      const sx = -uz * h, sz = ux * h;
      const v = position.length / 3;
      for (const [x, z] of [[x0 - sx, z0 - sz], [x0 + sx, z0 + sz], [x1 + sx, z1 + sz], [x1 - sx, z1 - sz]]) {
        position.push(x, groundY(x, z) + kind * 0.0005, z);
        pave.push(PAVE[kind]);
      }
      // counter-clockwise seen from above
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  if (!index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(position.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('pave', new THREE.Float32BufferAttribute(pave, 1));
  geometry.setIndex(index);
  console.info(`[footways] ${FOOTWAYS.length} footways, paths, pedestrian streets & steps`);
  if (streamer) {
    streamer.addLayer(geometry, createPavementMaterial(), { name: 'Footways', cutHoles: true }); // (opened over the channels & underpasses)
    return null;
  }
  const mesh = new THREE.Mesh(cutDeckHoles(drapeGeometry(geometry)), createPavementMaterial());
  mesh.name = 'Footways';
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

export { buildFootways, groundY as surfaceY };
