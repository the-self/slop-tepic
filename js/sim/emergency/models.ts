// js/sim/emergency/models.ts
// The bomberos' fire trucks and the Cruz Roja's ambulances (sim/emergency.ts), built once and parked out of sight
// until sent: a red pumper with its white band, roller shutters, ladder, hose reel and light bar; a white van with the
// red band, red crosses and a light bar. Each is a Cruiser (crime/types.ts), in the patrol cars' pool, so it drives,
// shoves the traffic, is shot at and wails as a patrol car does.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BODY_SPECS, buildCarGeometry, createLoftedCarMaterial, buildLightbarGeometry, createLightbarMaterial,
  standingBox as box // (a box w × h × d (m) standing on y, centred on (x, z))
} from '../../actors/actor-models.ts';
import { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import { CRUISER_HP, PARKED_Y } from '../crime/constants.ts';
import type { Cruiser } from '../crime/types.ts';

// Their sizes (half width & length, m) and weights (kg): a pumper of ~8.6 m and 14 t, a van ambulance of ~5 m
const TRUCK = { halfW: 1.25, halfL: 4.3, mass: 14000 };
const AMBULANCE = { halfW: 0.95, halfL: 2.5, mass: 3500 };

function responder(
  faction: 'fire' | 'ambulance', root: THREE.Group, tiltPivot: THREE.Group, bodyMesh: THREE.Mesh, paint: THREE.Material, lightbar: THREE.Mesh,
  size: typeof TRUCK
): Cruiser {
  root.position.y = PARKED_Y; // (out of sight until sent: its pipelines compile with the rest)
  return {
    active: false, mesh: root, tiltPivot, bodyMesh, lightbar, paint, faction,
    x: 0, y: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, halfW: size.halfW, halfL: size.halfL, hw: size.halfW, hl: size.halfL,
    mass: size.mass, type: 'car', police: false, hp: CRUISER_HP[faction], wreck: 0, state: 'chase', path: null, pathI: 0,
    replan: 0, stuckT: 0, checkX: 0, checkZ: 0, reverseT: 0, deployed: false, crew: [], aboard: 0, life: 0, pitch: 0, roll: 0,
    stuckCount: 0, slowT: 0, startX: 0, startZ: 0, goalX: 0, goalZ: 0, passSide: 0, lift: 0, vy: 0, siren: true,
    position: new THREE.Vector3() // (for the audio: crashes & sirens)
  };
}

/**
 * `n` fire trucks, added to `scene`: their front at +z. `barMat` lights their light bars (emergency.ts flashes it
 * red & white)
 */
export function buildFireTrucks(scene: THREE.Object3D, n: number, barMat: THREE.Material): Cruiser[] {
  const red = new THREE.MeshStandardNodeMaterial({ color: 0xb3121b, roughness: 0.35, metalness: 0.3 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xeeeeea, roughness: 0.4, metalness: 0.1 });
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xc9cccf, roughness: 0.25, metalness: 0.9 });
  const shutter = new THREE.MeshStandardNodeMaterial({ color: 0x9ea3a8, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x151515, roughness: 0.7 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x1c2a33, roughness: 0.1, metalness: 0.4 });
  const lamp = new THREE.MeshBasicNodeMaterial({ color: 0xfff6dc });
  // the cab (z 2.0..4.3) and the body behind it, the white band along both, its bumper & the ladder on top
  const body = mergeGeometries([box(2.5, 2.3, 2.3, 0, 0.55, 3.15), box(2.5, 2.25, 6.2, 0, 0.55, -1.1)]);
  const band = mergeGeometries([box(2.54, 0.2, 8.5, 0, 1.25, 0.0)]);
  const steel = mergeGeometries([
    box(2.6, 0.32, 0.25, 0, 0.45, 4.35), // the front bumper
    box(0.12, 0.12, 7.4, -0.55, 2.86, -0.9), box(0.12, 0.12, 7.4, 0.55, 2.86, -0.9), // the ladder's rails...
    ...Array.from({ length: 13 }, (_, i) => box(1.1, 0.06, 0.06, 0, 2.89, -4.4 + i * 0.58)), // ...and its rungs
    new THREE.CylinderGeometry(0.42, 0.42, 1.6, 16).rotateZ(Math.PI / 2).translate(0, 2.0, -4.32).toNonIndexed() // the hose reel
  ]);
  // the roller shutters of the lockers along both sides
  const lockers = mergeGeometries([box(2.53, 1.35, 4.6, 0, 0.95, -1.5)]);
  const windows = mergeGeometries([box(2.3, 0.95, 0.06, 0, 1.75, 4.3), box(2.52, 0.7, 1.1, 0, 1.9, 3.4)]);
  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [3.1, -1.0, -2.6]) for (const x of [-1.12, 1.12]) wheels.push(new THREE.CylinderGeometry(0.52, 0.52, 0.42, 16).rotateZ(Math.PI / 2).translate(x, 0.52, z).toNonIndexed());
  const tyres = mergeGeometries(wheels);
  const lamps = mergeGeometries([box(0.32, 0.18, 0.05, -0.95, 0.92, 4.31), box(0.32, 0.18, 0.05, 0.95, 0.92, 4.31)]);
  const bar = new THREE.BoxGeometry(2.0, 0.2, 0.4).translate(0, 2.98, 3.6);
  const shadowGeo = new THREE.PlaneGeometry(2.8, 9.0).rotateX(-Math.PI / 2);
  const shadowMat = createContactShadowMaterial();
  const out: Cruiser[] = [];
  for (let i = 0; i < n; i++) {
    const root = new THREE.Group();
    root.name = 'FireTruck';
    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);
    const bodyMesh = new THREE.Mesh(body, red);
    for (const m of [bodyMesh, new THREE.Mesh(band, white), new THREE.Mesh(steel, chrome), new THREE.Mesh(lockers, shutter), new THREE.Mesh(tyres, dark)]) {
      m.castShadow = true;
      tiltPivot.add(m);
    }
    tiltPivot.add(new THREE.Mesh(windows, glass), new THREE.Mesh(lamps, lamp));
    const lightbar = new THREE.Mesh(bar, barMat);
    tiltPivot.add(lightbar);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = 998;
    root.add(shadow);
    scene.add(root);
    out.push(responder('fire', root, tiltPivot, bodyMesh, red, lightbar, TRUCK));
  }
  return out;
}

/** `n` ambulances, added to `scene`: the traffic's van body in white, its red band & crosses, a flashing light bar */
export function buildAmbulances(scene: THREE.Object3D, n: number): Cruiser[] {
  const spec = BODY_SPECS.van;
  const body = buildCarGeometry(spec, true);
  // (a white of its own: the material cache shares a colour's material with the traffic's vans)
  const paint = createLoftedCarMaterial(spec, 0xf5f6f3);
  const red = new THREE.MeshStandardNodeMaterial({ color: 0xc8102e, roughness: 0.4, metalness: 0.1 });
  // the red band along both sides (just proud of the van's sides, ~0.95 m out), a cross on each side, the back & the roof
  const cross = (x: number, y: number, z: number, along: 'x' | 'z' | 'y') => {
    const a = along === 'x' ? box(0.03, 0.42, 0.13, x, y - 0.21, z) : along === 'z' ? box(0.13, 0.42, 0.03, x, y - 0.21, z) : box(0.13, 0.03, 0.42, x, y, z);
    const b = along === 'x' ? box(0.03, 0.13, 0.42, x, y - 0.065, z) : along === 'z' ? box(0.42, 0.13, 0.03, x, y - 0.065, z) : box(0.42, 0.03, 0.13, x, y, z);
    return [a, b];
  };
  const marks = mergeGeometries([
    box(0.02, 0.16, 4.3, -0.965, 0.86, -0.15), box(0.02, 0.16, 4.3, 0.965, 0.86, -0.15),
    ...cross(-0.965, 1.62, -1.15, 'x'), ...cross(0.965, 1.62, -1.15, 'x'), ...cross(0, 1.55, -2.47, 'z'), ...cross(0, 2.04, -1.0, 'y')
  ]);
  const bar = buildLightbarGeometry(spec);
  const barMat = createLightbarMaterial();
  const shadowGeo = new THREE.PlaneGeometry(2.2, 5.4).rotateX(-Math.PI / 2);
  const shadowMat = createContactShadowMaterial();
  const out: Cruiser[] = [];
  for (let i = 0; i < n; i++) {
    const root = new THREE.Group();
    root.name = 'Ambulance';
    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);
    const bodyMesh = new THREE.Mesh(body, paint);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    const lightbar = new THREE.Mesh(bar, barMat);
    tiltPivot.add(bodyMesh, new THREE.Mesh(marks, red), lightbar);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = 998;
    root.add(shadow);
    scene.add(root);
    out.push(responder('ambulance', root, tiltPivot, bodyMesh, paint, lightbar, AMBULANCE));
  }
  return out;
}

export { TRUCK, AMBULANCE };
