import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { liftAt } from './ground.ts';
import { placeBusStops } from './bus-stops.ts';
import type { PlaceEdge } from './edge-places.ts';
import type { Collider } from './buildings.ts';

// js/world/bus-shelters.ts
// Tepic's paradas on the sidewalks (bus-stops.ts): where OpenStreetMap has a shelter, a parabús of steel posts, a
// roof and a glass back with a bench under it; where only a bench, the bench; and at every stop the blue PARADA sign
// on its pole at the curb end. Their backs and benches stop the player.

const SW_TOP = 0.22; // the sidewalks' top over the road (city-grid.ts)
const SHELTER_LEN = 4.2; // m along the street
const SHELTER_H = 2.45; // m to the roof's underside

// The pieces in a stop's own frame: x along the street, z away from it (to the right of its edge), y up from the
// sidewalk; one geometry per material
function shelterGeometries() {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const half = SHELTER_LEN / 2;
  const steel = mergeGeometries([
    // three posts along the back, the roof's two side beams cantilevered out over the bench
    ...[-half + 0.1, 0, half - 0.1].map((x) => box(0.09, SHELTER_H, 0.09, x, SHELTER_H / 2, 0.6)),
    box(0.08, 0.1, 1.5, -half + 0.1, SHELTER_H - 0.05, 0.05),
    box(0.08, 0.1, 1.5, half - 0.1, SHELTER_H - 0.05, 0.05),
    // the bench's legs
    ...[-1.1, 1.1].map((x) => box(0.06, 0.44, 0.36, x, 0.22, 0.32))
  ]);
  const roof = box(SHELTER_LEN + 0.2, 0.07, 1.75, 0, SHELTER_H + 0.04, 0.05);
  const glass = box(SHELTER_LEN - 0.3, 1.8, 0.03, 0, 1.25, 0.62);
  const seat = box(2.6, 0.06, 0.42, 0, 0.47, 0.32);
  return { steel, roof, glass, seat };
}

/** The stops drawn on the network's edges `edges` (road-network.ts, after the traffic built it): their colliders */
function buildBusShelters(scene: THREE.Object3D, edges: readonly PlaceEdge[]): { colliders: Collider[] } {
  const stops = placeBusStops(GEO.busStops, edges);
  const colliders: Collider[] = [];
  const group = new THREE.Group();
  group.name = 'BusStops';
  const sheltered: THREE.Matrix4[] = [], benches: THREE.Matrix4[] = [], signs: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const st of stops) {
    const y = liftAt(st.x, st.z) + SW_TOP;
    // (rotated so its x runs along the street, its z to the right: R_y(θ) takes x to (cos θ, -sin θ))
    const theta = Math.atan2(-st.dz, st.dx);
    q.setFromAxisAngle(up, theta);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(st.x, y, st.z), q, one);
    if (st.shelter) sheltered.push(m);
    else if (st.bench) benches.push(m);
    // the sign at the end the traffic comes from, out by the curb
    const sx = st.x - st.dx * (SHELTER_LEN / 2 + 0.6) - st.dz * 0.9, sz = st.z - st.dz * (SHELTER_LEN / 2 + 0.6) + st.dx * 0.9;
    signs.push(new THREE.Matrix4().compose(new THREE.Vector3(sx, liftAt(sx, sz) + SW_TOP, sz), q, one));
    if (st.shelter || st.bench) {
      // the glass back (a shelter's) or the bench: a box 0.35 m deep along the back of the stop
      const bx = st.x - st.dz * 0.4, bz = st.z + st.dx * 0.4, hx = st.shelter ? SHELTER_LEN / 2 : 1.35, hz = 0.3;
      const ex = Math.abs(st.dx) * hx + Math.abs(st.dz) * hz, ez = Math.abs(st.dz) * hx + Math.abs(st.dx) * hz;
      colliders.push({ minX: bx - ex, maxX: bx + ex, minZ: bz - ez, maxZ: bz + ez, minY: y, maxY: y + (st.shelter ? SHELTER_H : 0.5),
        obb: { cx: bx, cz: bz, hx, hz, cs: st.dx, sn: -st.dz } });
    }
  }
  const { steel, roof, glass, seat } = shelterGeometries();
  const steelMat = new THREE.MeshStandardNodeMaterial({ color: 0x3c4146, roughness: 0.5, metalness: 0.7 });
  const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9dee2, roughness: 0.6, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardNodeMaterial({ color: 0x7f97a3, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.45 });
  const seatMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e9499, roughness: 0.45, metalness: 0.6 });
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = true) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => { mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  instanced(steel, steelMat, sheltered);
  instanced(roof, roofMat, sheltered);
  instanced(glass, glassMat, sheltered, false);
  instanced(seat, seatMat, [...sheltered, ...benches]);
  // a bench with no shelter: its legs
  instanced(mergeGeometries([-1.1, 1.1].map((x) => new THREE.BoxGeometry(0.06, 0.44, 0.36).translate(x, 0.22, 0.32))), steelMat, benches);
  // the PARADA sign: a pole and a blue plate square to the street
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6).translate(0, 1.3, 0);
  const plate = new THREE.BoxGeometry(0.03, 0.55, 0.45).translate(0, 2.35, 0.24);
  instanced(pole, steelMat, signs);
  instanced(plate, new THREE.MeshStandardNodeMaterial({ color: 0x1f5aa6, roughness: 0.4, metalness: 0.1 }), signs);
  scene.add(group);
  console.info(`[stops] ${stops.length} of ${GEO.busStops.length / 3} bus stops on the streets: ${sheltered.length} shelters, ${benches.length} benches, ${stops.length - sheltered.length - benches.length} signs only`);
  return { colliders };
}

export { buildBusShelters };
