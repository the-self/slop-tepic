import * as THREE from 'three/webgpu';
import { createBloodPoolMaterial } from '../render/tsl-materials.js';

// js/sim/blood.js
// Pools of blood under the people hit hard or killed (main.js, as their ragdolls settle, sim/ragdolls.js): one instanced
// mesh of flat quads lying on the ground's slope, each spreading over a few seconds (fast at first, as blood does, then
// slowing) to a size set by how bad the hit was, its outline its own (bloodSeed). The oldest is taken for a new one once
// all POOLS are down. Nothing is allocated per pool.

const POOLS = 64;
const SPREAD = 5; // s to reach full size
const LIFT = 0.025; // m over the ground (with the material's polygon offset: over the road's paint too)

const dummy = new THREE.Object3D();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

class BloodPools {
  /** `groundAt(x, z, fromY)`: the height of the ground (or the deck or walk) a body lies on there */
  constructor(scene, groundAt) {
    this.groundAt = groundAt;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('bloodSeed', new THREE.InstancedBufferAttribute(new Float32Array(POOLS), 1));
    this.mesh = new THREE.InstancedMesh(geo, createBloodPoolMaterial(), POOLS);
    this.mesh.name = 'BloodPools';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 3; // (over the road's paint)
    for (let i = 0; i < POOLS; i++) this.mesh.setMatrixAt(i, hidden);
    this.mesh.count = POOLS;
    scene.add(this.mesh);
    this.pools = Array.from({ length: POOLS }, () => ({ x: 0, y: 0, z: 0, pitch: 0, roll: 0, yaw: 0, size: 0, age: SPREAD, live: false }));
    this.cursor = 0;
    this.growing = 0;
  }

  /** A pool spreading at (x, z) on the ground under `fromY`, up to `size` m across (~1-2.5 for one body) */
  add(x, z, fromY, size) {
    const i = this.cursor;
    this.cursor = (i + 1) % POOLS;
    const p = this.pools[i];
    const g = (px, pz) => this.groundAt(px, pz, fromY);
    // on the slope under it
    p.y = g(x, z);
    p.pitch = -Math.atan2(g(x, z + 0.6) - g(x, z - 0.6), 1.2);
    p.roll = Math.atan2(g(x + 0.6, z) - g(x - 0.6, z), 1.2);
    Object.assign(p, { x, z, yaw: Math.random() * Math.PI * 2, size, age: 0, live: true });
    this.mesh.geometry.attributes.bloodSeed.array[i] = Math.random();
    this.mesh.geometry.attributes.bloodSeed.needsUpdate = true;
    this.place(i);
  }

  place(i) {
    const p = this.pools[i];
    const t = Math.min(1, p.age / SPREAD);
    const s = p.size * (0.15 + 0.85 * (1 - (1 - t) * (1 - t) * (1 - t))); // (quick at first, slowing)
    dummy.position.set(p.x, p.y + LIFT, p.z);
    dummy.rotation.set(p.pitch, 0, p.roll, 'XYZ');
    dummy.rotateY(p.yaw);
    dummy.scale.set(s, 1, s);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Per frame: the pools still spreading grow
  update(dt) {
    for (let i = 0; i < POOLS; i++) {
      const p = this.pools[i];
      if (!p.live || p.age >= SPREAD) continue;
      p.age += dt;
      this.place(i);
    }
  }
}

export { BloodPools };
