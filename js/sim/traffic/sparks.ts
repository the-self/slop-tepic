// js/sim/traffic/sparks.ts
// Collision sparks: the pool, struck off where vehicles hit, flying, bouncing on the road and fading
import * as THREE from 'three/webgpu';
import type { Spark } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';
import { flagRange } from './render.ts';

// 3D Collision Spark & Debris Particle Pool
const MAX_SPARKS = 120;
function createSparks() {
  const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.26);
  const sparkMat = new THREE.MeshBasicNodeMaterial({ color: 0xffc438 });
  const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
  const sparks: Spark[] = [];
  for (let s = 0; s < MAX_SPARKS; s++) {
    sparks.push({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.4 });
  }
  return { sparkInst, sparks };
}

// (y over `base`, the road surface there: the sparks bounce on it)
function spawnCollisionSparks(ts: TrafficState, x: number, y: number, z: number, nx: number, nz: number, impactSpeed: number, base = hillAt(ts, x, z)): void {
  const count = Math.min(24, Math.max(8, Math.floor(impactSpeed * 1.4)));
  const tx = -nz;
  const tz = nx;
  const ground = base;
  for (let k = 0; k < count; k++) {
    const sp = ts.sparks[ts.sparkCursor];
    ts.sparkCursor = (ts.sparkCursor + 1) % MAX_SPARKS;
    const spread = (Math.random() - 0.5) * 2.2;
    const outBoost = (0.3 + Math.random() * 0.9) * Math.min(14.0, impactSpeed * 0.65);
    const tanBoost = spread * Math.min(12.0, impactSpeed * 0.55);
    sp.x = x + (Math.random() - 0.5) * 0.35;
    sp.y = ground + y + (Math.random() - 0.5) * 0.18;
    sp.floor = ground + 0.03;
    sp.z = z + (Math.random() - 0.5) * 0.35;
    sp.vx = nx * outBoost + tx * tanBoost;
    sp.vy = 2.4 + Math.random() * 5.4;
    sp.vz = nz * outBoost + tz * tanBoost;
    sp.maxLife = 0.28 + Math.random() * 0.24;
    sp.life = sp.maxLife;
  }
}

function updateSparks(ts: TrafficState, dt: number) {
  let count = 0;
  for (let s = 0; s < MAX_SPARKS; s++) {
    const sp = ts.sparks[s];
    if (sp.life > 0) {
      sp.life -= dt;
      sp.vy -= 22.0 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.z += sp.vz * dt;
      const floor = sp.floor ?? 0.03; // (the ground where it was struck)
      if (sp.y < floor) {
        sp.y = floor;
        sp.vy = Math.abs(sp.vy) * 0.45;
        sp.vx *= 0.78;
        sp.vz *= 0.78;
      }
      const tLife = Math.max(0, sp.life / sp.maxLife);
      const spdXZ = Math.hypot(sp.vx, sp.vz) || 0.001;
      const yawSp = Math.atan2(sp.vx, sp.vz);
      const pitchSp = -Math.atan2(sp.vy, spdXZ);
      ts.dummy.position.set(sp.x, sp.y, sp.z);
      ts.dummy.rotation.set(pitchSp, yawSp, 0, 'YXZ');
      ts.dummy.scale.set(tLife, tLife, Math.max(0.4, Math.min(2.2, spdXZ * 0.16)) * tLife);
      ts.dummy.updateMatrix();
      ts.sparkInst.setMatrixAt(count++, ts.dummy.matrix);
    }
  }
  // Keep one degenerate instance for shader warm-up, then hide the empty pool and stop uploading it.
  ts.sparkInst.visible = count > 0 || ts.updates <= 2;
  if (count === 0 && ts.updates <= 2) ts.sparkInst.setMatrixAt(count++, ts.zero);
  ts.sparkInst.count = count;
  if (count > 0) flagRange(ts.sparkInst.instanceMatrix, count);
}

// Sparks where something struck metal or stone (world y)
function sparksAt(ts: TrafficState, x: number, y: number, z: number, nx: number, nz: number, speed: number): void {
  spawnCollisionSparks(ts, x, y - hillAt(ts, x, z), z, nx, nz, speed);
}

export { createSparks, spawnCollisionSparks, updateSparks, sparksAt };
