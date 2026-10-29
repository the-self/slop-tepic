// js/world/delivery-trucks.ts
// The tráilers at the supermarkets' loading docks (loading-docks.ts finds the docks and their hours): in the small
// hours each dock's truck stands backed up to the store's wall, unloading, its marker lamps lit, the chain's name along
// its caja (actors/vehicles/tractor-trailer.ts); by morning they are gone. A truck comes or goes only while the camera
// is SWAP m or more from it, so none appears or vanishes in front of the player. Each one there stops the player. The
// yard it stands in is paved, there or not (the apron the trucks turn on, its concrete laid like a car park's).

import * as THREE from 'three/webgpu';
import { liftAt } from './ground.ts';
import { slopeTilt, turnedBox } from './standing.ts';
import { drapeGeometry } from './drape.ts';
import { FlatLayer, pavedHeight } from './car-parks.ts';
import { createPavementMaterial } from '../render/tsl-materials.ts';
import { APRON_OUT, APRON_W, DOCK_CHAINS, atDock, inDockYard, loadingDocks } from './loading-docks.ts';
import { STOREFRONTS } from './storefronts/index.ts';
import {
  TRUCK_SIZE, buildTractorTrailerGeometry, buildTrailerNameGeometry, createTractorTrailerMaterial, createTrailerNameMaterial,
  trailerNameTexture
} from '../actors/actor-models.ts';
import { hash } from './hash.ts';
import type { Collider } from './buildings.ts';
import type { LotReserve } from './landmark-models.ts';
import type { TileStreamer } from './streaming.ts';

const SWAP = 160; // m from the camera beyond which a truck may come or go
// The tractors' paints (0xrrggbb): red, white, the fleet's blue, black, green, yellow, silver
const CAB_PAINTS = [0xb3121b, 0xeeeeec, 0x1d4f91, 0x1a1a1c, 0x1f6b3a, 0xe0a400, 0x9ea4aa];

/** A dock's truck as drawn: where it stands (m, its middle on the ground), its turn & tilt (rad), its looks, its wall,
 *  and whether it is there now */
interface PlacedTruck {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  chain: number;
  cab: number;
  collider: Collider & { broken?: boolean };
  here: boolean;
}

/**
 * The trucks at the docks into the scene, none there until the first update. `blocked(x, z)`: ground no truck may
 * stand on (the car parks). Returns the docks' yards (kept clear of trees), the trucks' colliders, and `update(hour,
 * x, z)`: the trucks there at `hour` (local), (x, z) the camera
 */
function buildDeliveryTrucks(scene: THREE.Object3D, blocked: (x: number, z: number) => boolean,
  streamer: Pick<TileStreamer, 'addLayer'> | null = null) {
  const docks = loadingDocks(blocked);
  const group = new THREE.Group();
  group.name = 'DeliveryTrucks';
  scene.add(group);
  // the docks' aprons: from the wall out past the truck's nose, concrete (createPavementMaterial's kind 3)
  const apron = new FlatLayer();
  for (const d of docks) {
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading), sx = -fz * APRON_W / 2, sz = fx * APRON_W / 2;
    const back = TRUCK_SIZE.length / 2 + 0.4, out = TRUCK_SIZE.length / 2 + APRON_OUT;
    const y = pavedHeight(d.x, d.z);
    const corners = [[-back, -1], [-back, 1], [out, 1], [out, -1]].map(([a, s]) =>
      apron.vertex(d.x + fx * a + sx * s, y, d.z + fz * a + sz * s, { pave: [3] }));
    const [a, b, c, e] = corners;
    apron.index.push(a, b, c, a, c, e); // (counter-clockwise seen from above, as car-parks.ts's driveways)
  }
  const apronGeo = apron.geometry();
  if (apronGeo && streamer) streamer.addLayer(apronGeo, createPavementMaterial(), { name: 'LoadingDocks' });
  else if (apronGeo) {
    const mesh = new THREE.Mesh(drapeGeometry(apronGeo), createPavementMaterial());
    mesh.name = 'LoadingDocks';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const chains = DOCK_CHAINS.map((id) => STOREFRONTS.find((s) => s.id === id));
  const trucks: PlacedTruck[] = docks.map((d) => {
    const y = liftAt(d.x, d.z) + pavedHeight(d.x, d.z);
    const collider = { ...turnedBox(d.x, d.z, TRUCK_SIZE.width / 2, TRUCK_SIZE.length / 2, d.heading, y, y + TRUCK_SIZE.height), broken: true };
    return { x: d.x, y, z: d.z, yaw: d.heading, ...slopeTilt(d.x, d.z, d.heading, 9), chain: d.chain,
      cab: Math.floor(hash(d.x, d.z, 73) * CAB_PAINTS.length) % CAB_PAINTS.length, collider, here: false };
  });

  const n = Math.max(1, trucks.length);
  const bodyGeo = buildTractorTrailerGeometry();
  const nameGeo = buildTrailerNameGeometry();
  const body = new THREE.InstancedMesh(bodyGeo, createTractorTrailerMaterial(), n);
  const names = new THREE.InstancedMesh(nameGeo, createTrailerNameMaterial(trailerNameTexture(chains.map((s) =>
    [s?.name ?? '', s?.facade.band ?? '#333333', '#ffffff'] as const)), chains.length), n);
  const cabPaint = new Float32Array(n * 3), ink = new Float32Array(n * 3), ink2 = new Float32Array(n * 3), row = new Float32Array(n);
  bodyGeo.setAttribute('cabPaint', new THREE.InstancedBufferAttribute(cabPaint, 3));
  bodyGeo.setAttribute('trailerInk', new THREE.InstancedBufferAttribute(ink, 3));
  bodyGeo.setAttribute('trailerInk2', new THREE.InstancedBufferAttribute(ink2, 3));
  nameGeo.setAttribute('trailerName', new THREE.InstancedBufferAttribute(row, 1));
  for (const m of [body, names]) {
    m.count = 0;
    m.castShadow = m === body;
    m.receiveShadow = true;
    group.add(m);
  }
  body.name = 'DeliveryTrucks:body';

  const dummy = new THREE.Object3D(), c = new THREE.Color();
  // The trucks there into their instances
  function draw(): void {
    let k = 0;
    for (const t of trucks) {
      if (!t.here) continue;
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(t.pitch, t.yaw, t.roll, 'YXZ');
      dummy.updateMatrix();
      body.setMatrixAt(k, dummy.matrix);
      names.setMatrixAt(k, dummy.matrix);
      c.setHex(CAB_PAINTS[t.cab]);
      cabPaint.set([c.r, c.g, c.b], k * 3);
      const store = chains[t.chain];
      c.set(store?.facade.band ?? '#333333');
      ink.set([c.r, c.g, c.b], k * 3);
      c.set(store?.facade.stripe ?? '#999999');
      ink2.set([c.r, c.g, c.b], k * 3);
      row[k] = t.chain;
      k++;
    }
    body.count = names.count = k;
    for (const m of [body, names]) {
      m.instanceMatrix.needsUpdate = true;
      m.visible = k > 0;
      if (k) m.computeBoundingSphere();
    }
    for (const name of ['cabPaint', 'trailerInk', 'trailerInk2']) {
      const a = bodyGeo.getAttribute(name);
      if (a instanceof THREE.BufferAttribute) a.needsUpdate = true;
    }
    const r = nameGeo.getAttribute('trailerName');
    if (r instanceof THREE.BufferAttribute) r.needsUpdate = true;
  }

  let first = true;
  /**
   * The trucks at their docks at `hour` (local): each comes or goes once the camera at (x, z) is SWAP m from it, and
   * comes only when no vehicle stands where it would (`vehicleNear(x, z, r)`: one within r m of there)
   */
  function update(hour: number, x: number, z: number, vehicleNear: (x: number, z: number, r: number) => boolean): void {
    let changed = false;
    for (let i = 0; i < trucks.length; i++) {
      const t = trucks[i], want = atDock(docks[i], hour);
      if (want === t.here || (!first && Math.hypot(t.x - x, t.z - z) < SWAP)) continue;
      // (its length in three circles: its nose, its middle, its doors)
      const fx = Math.sin(t.yaw) * 8, fz = Math.cos(t.yaw) * 8;
      if (want && (vehicleNear(t.x, t.z, 4.5) || vehicleNear(t.x + fx, t.z + fz, 4.5) || vehicleNear(t.x - fx, t.z - fz, 4.5))) continue;
      t.here = want;
      t.collider.broken = !want;
      changed = true;
    }
    first = false;
    if (changed) draw();
  }

  const yards: LotReserve = { contains: (px: number, pz: number) => inDockYard(docks, px, pz) };
  console.info(`[delivery trucks] ${docks.length} docks at ${new Set(docks.map((d) => `${d.storeX},${d.storeZ}`)).size} stores`);
  return { group, colliders: trucks.map((t) => t.collider), yards, update };
}

type DeliveryTrucksBuild = ReturnType<typeof buildDeliveryTrucks>;

export type { DeliveryTrucksBuild };
export { buildDeliveryTrucks };
