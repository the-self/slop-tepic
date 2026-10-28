// js/player/controllers/smoke.ts
// The smoke puffs: the engine's, the tyres' and the wet road's spray, one instanced mesh of soft spheres
import * as THREE from 'three/webgpu';
import { createSmokeMaterial } from '../../render/tsl-materials.ts';
import { SMOKE_PUFFS } from './constants.ts';
import type { CarEntity, MotoEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// Smoke puffs: engine smoke from under the bonnet, tyre smoke off the road; one instanced mesh of soft spheres that
// swell, rise and drift, then shrink away (no per-puff opacity: the shrinking fades them)
export function createSmoke(ctl: ThirdPersonControllerManager): void {
  const geo = new THREE.IcosahedronGeometry(0.5, 2);
  const mesh = new THREE.InstancedMesh(geo, createSmokeMaterial(), SMOKE_PUFFS);
  mesh.name = 'PlayerCarSmoke';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  const color = new THREE.Color(1, 1, 1);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    mesh.setMatrixAt(i, hidden);
    mesh.setColorAt(i, color);
  }
  ctl.scene.add(mesh);
  ctl.smoke = {
    mesh, color, matrix: new THREE.Matrix4(), cursor: 0, carry: 0,
    puffs: Array.from({ length: SMOKE_PUFFS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 }))
  };
}

// `count` (fractional: carried over to the next frame) puffs of grey `shade` and `size` from the car's local point
export function emitSmoke(ctl: ThirdPersonControllerManager, c: CarEntity | MotoEntity, lx: number, ly: number, lz: number, count: number, shade: number, size: number): void {
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
  ctl.puffSmoke(c.position.x + cs * lx + sn * lz, c.position.y + ly, c.position.z - sn * lx + cs * lz,
    sn * c.speed + c.vx, cs * c.speed + c.vz, count, shade, size);
}

// `count` puffs at (x, y, z) from something moving at (vx, vz): the player's car, or a damaged one in the traffic
// (traffic.ts setSmokeEmitter, app/install/player.ts)
export function puffSmoke(ctl: ThirdPersonControllerManager, x: number, y: number, z: number, vx: number, vz: number, count: number, shade: number, size: number): void {
  const sm = ctl.smoke;
  sm.carry += count;
  while (sm.carry >= 1) {
    sm.carry -= 1;
    const p = sm.puffs[sm.cursor];
    const i = sm.cursor;
    sm.cursor = (sm.cursor + 1) % SMOKE_PUFFS;
    p.x = x + (Math.random() - 0.5) * 0.3;
    p.y = y;
    p.z = z + (Math.random() - 0.5) * 0.3;
    // left behind by the car (a little of its speed), rising and spreading
    p.vx = vx * 0.15 + (Math.random() - 0.5) * 1.2;
    p.vy = 0.7 + Math.random() * 0.9;
    p.vz = vz * 0.15 + (Math.random() - 0.5) * 1.2;
    p.max = p.life = 1.1 + Math.random() * 0.9;
    p.size = size * (0.8 + Math.random() * 0.4);
    const g = shade * (0.9 + Math.random() * 0.2);
    sm.color.setRGB(g, g, g);
    sm.mesh.setColorAt(i, sm.color);
    if (sm.mesh.instanceColor) sm.mesh.instanceColor.needsUpdate = true; // (setColorAt made it)
  }
}

export function updateSmoke(ctl: ThirdPersonControllerManager, dt: number): void {
  const sm = ctl.smoke;
  let live = false;
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const p = sm.puffs[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    live = true;
    const t = 1 - Math.max(0, p.life) / p.max;
    const drag = Math.exp(-dt * 1.6);
    p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-dt * 0.6);
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const s = p.life > 0 ? p.size * (0.35 + 1.5 * t) * (t < 0.7 ? 1 : (1 - t) / 0.3) : 0;
    sm.matrix.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
    sm.mesh.setMatrixAt(i, sm.matrix);
  }
  if (live || sm.wasLive) sm.mesh.instanceMatrix.needsUpdate = true;
  sm.wasLive = live;
}
