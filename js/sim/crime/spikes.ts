// js/sim/crime/spikes.ts
// The police's spike strips (sim/crime.ts): from two stars, a player driving away finds one laid across the road some
// way ahead now and then. Whatever drives over it, the player's car or the traffic's, has the tyres on it burst
// (player/controllers/car-crashes.ts popTyresOn, traffic/gunfire.ts spikeTraffic); it is taken up after a while, or
// once left far behind.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARKED_Y, rand } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

/** A spike strip: where its middle lies (m), its heading along it (rad), s it has lain, whether it is down */
export interface SpikeStrip {
  mesh: THREE.Mesh;
  active: boolean;
  x: number;
  z: number;
  heading: number;
  t: number;
}

const STRIPS = 2;
const HALF_LEN = 4; // m: half its length (two lanes)
const HALF_W = 0.3; // m: half its width
const LIFE = 60; // s it lies there
const FAR = 300; // m behind the player: taken up
const AHEAD: [number, number] = [70, 110]; // m ahead of the player it is laid
const EVERY: [number, number] = [25, 45]; // s between them, while wanted from two stars and driving
const MIN_SPEED = 8; // m/s the player is going at for one to be laid ahead of it

// The strips, parked out of sight: a dark band of linked plates, a row of steel spikes along it
export function buildSpikes(crime: CrimeSystem): void {
  const plates = new THREE.BoxGeometry(HALF_LEN * 2, 0.04, HALF_W * 2).translate(0, 0.02, 0).toNonIndexed();
  const spikes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 28; i++) {
    for (const side of [-1, 1]) {
      spikes.push(new THREE.ConeGeometry(0.035, 0.09, 4).translate(-HALF_LEN + 0.15 + i * ((HALF_LEN * 2 - 0.3) / 27), 0.085, side * HALF_W * 0.5).toNonIndexed());
    }
  }
  const plateGeo = mergeGeometries([plates]);
  plateGeo.clearGroups();
  const spikeGeo = mergeGeometries(spikes);
  const geo = mergeGeometries([plateGeo, spikeGeo], true);
  const materials = [
    new THREE.MeshStandardNodeMaterial({ color: 0x1b1b1d, roughness: 0.8 }),
    new THREE.MeshStandardNodeMaterial({ color: 0xc9cccf, roughness: 0.3, metalness: 0.9 })
  ];
  for (let i = 0; i < STRIPS; i++) {
    const mesh = new THREE.Mesh(geo, materials);
    mesh.name = 'SpikeStrip';
    mesh.receiveShadow = true;
    mesh.position.y = PARKED_Y; // (out of sight until laid: its pipelines compile with the rest)
    crime.scene.add(mesh);
    crime.spikes.push({ mesh, active: false, x: 0, z: 0, heading: 0, t: 0 });
  }
}

// One laid across the road the player is driving along, some way ahead of it (a lane of a road running its way)
function lay(crime: CrimeSystem): boolean {
  const s = crime.spikes.find((k) => !k.active);
  if (!s || crime.pspeed < MIN_SPEED) return false;
  const ux = crime.pvx / crime.pspeed, uz = crime.pvz / crime.pspeed;
  const ahead = rand(...AHEAD);
  for (let tries = 0; tries < 6; tries++) {
    const spot = crime.traffic.roadSpot(crime.px + ux * ahead, crime.pz + uz * ahead, 0, 18);
    if (!spot || Math.abs(Math.sin(spot.heading) * ux + Math.cos(spot.heading) * uz) < 0.8) continue;
    Object.assign(s, { active: true, x: spot.x, z: spot.z, heading: spot.heading + Math.PI / 2, t: 0 });
    s.mesh.position.set(s.x, crime.groundAt(s.x, s.z), s.z);
    s.mesh.rotation.y = s.heading - Math.PI / 2; // (its length along its local x)
    return true;
  }
  return false;
}

// The frame: one laid now and then while wanted from two stars and driving; the tyres on each burst; old ones taken up
export function updateSpikes(crime: CrimeSystem, dt: number): void {
  const t = crime.timers;
  t.spikes -= dt;
  if (t.spikes <= 0) {
    t.spikes = rand(...EVERY);
    if (crime.state === 'play' && crime.wanted.stars >= 2 && crime.mode === 'car') lay(crime);
  }
  for (const s of crime.spikes) {
    if (!s.active) continue;
    s.t += dt;
    if (s.t > LIFE || Math.hypot(s.x - crime.px, s.z - crime.pz) > FAR) {
      s.active = false;
      s.mesh.position.y = PARKED_Y;
      continue;
    }
    if (crime.mode === 'car' && Math.hypot(s.x - crime.px, s.z - crime.pz) < HALF_LEN + 4) {
      const popped = crime.controllers.popTyresOn?.(s.x, s.z, s.heading, HALF_LEN, HALF_W) ?? 0;
      if (popped) crime.audio?.gunfire?.('pistol', crime.px, crime.player.position.y + 0.3, crime.pz); // (the bang of a tyre)
    }
    crime.traffic.spikeTraffic(s.x, s.z, s.heading, HALF_LEN, HALF_W);
  }
}
