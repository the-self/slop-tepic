import * as THREE from 'three/webgpu';
import { createBloodPoolMaterial } from '../render/tsl-materials.ts';

// js/sim/blood.ts
// Pools of blood under the people hit hard or killed (main.ts, as their ragdolls settle, sim/ragdolls.ts), and the
// smears a body run down leaves on the ground from where it was struck to where it came to rest: one instanced mesh of
// flat quads lying on the ground's slope, a pool spreading over a few seconds (fast at first, as blood does, then
// slowing) to a size set by how bad the hit was, a smear at once, each outline its own (bloodSeed). The oldest pool is
// taken for a new one once all POOLS are down, the oldest smear piece once all SMEARS are (each from its own share of
// the instances). Nothing is allocated per pool.

const POOLS = 64;
const SMEARS = 72; // smear pieces (a dozen trails)
const QUADS = POOLS + SMEARS;
const SPREAD = 5; // s a pool takes to reach full size
const SMEAR = 0.4; // s a smear takes
const SMEAR_GAP = 0.9; // m between a smear's pieces along it
const SMEAR_PIECES = 6; // ...and at most this many (a trail ~5 m long; past that, where it slid, it leaves none)
const LIFT = 0.025; // m over the ground (with the material's polygon offset: over the road's paint too)

const dummy = new THREE.Object3D();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

// The height of the ground (or the deck or walk) a body lies on at (x, z), under fromY (m)
type GroundAt = (x: number, z: number, fromY: number) => number;
// A pool or a smear piece: where it lies (m) and how (rad: tilted to the slope, turned yaw), its full size across and
// along yaw (m), the time it takes to reach it and its age (s)
interface BloodPool {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  yaw: number;
  width: number;
  length: number;
  spread: number;
  age: number;
  live: boolean;
}

class BloodPools {
  groundAt: GroundAt;
  mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>;
  pools: BloodPool[];
  cursor: number;
  smearCursor: number;

  /** `groundAt(x, z, fromY)`: the height of the ground (or the deck or walk) a body lies on there */
  constructor(scene: THREE.Object3D, groundAt: GroundAt) {
    this.groundAt = groundAt;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('bloodSeed', new THREE.InstancedBufferAttribute(new Float32Array(QUADS), 1));
    this.mesh = new THREE.InstancedMesh(geo, createBloodPoolMaterial(), QUADS);
    this.mesh.name = 'BloodPools';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 3; // (over the road's paint)
    for (let i = 0; i < QUADS; i++) this.mesh.setMatrixAt(i, hidden);
    this.mesh.count = QUADS;
    scene.add(this.mesh);
    this.pools = Array.from({ length: QUADS }, () => ({
      x: 0, y: 0, z: 0, pitch: 0, roll: 0, yaw: 0, width: 0, length: 0, spread: SPREAD, age: SPREAD, live: false
    }));
    this.cursor = 0; // (the next pool, 0 .. POOLS - 1)
    this.smearCursor = 0; // (the next smear piece, after them)
  }

  /** A pool spreading at (x, z) on the ground under `fromY`, up to `size` m across (~1-2.5 for one body) */
  add(x: number, z: number, fromY: number, size: number): void {
    const i = this.cursor;
    this.cursor = (i + 1) % POOLS;
    this.lay(i, x, z, fromY, size, size, Math.random() * Math.PI * 2, SPREAD);
  }

  /**
   * A body's smear from (x0, z0), where it came down, to (x1, z1), where it lies, on the ground under `fromY`: a few
   * long pieces along the way, broader the worse it bleeds (`bleed` 0..1); none for one that hardly moved
   */
  trail(x0: number, z0: number, x1: number, z1: number, fromY: number, bleed: number): void {
    const dx = x1 - x0, dz = z1 - z0;
    const run = Math.hypot(dx, dz);
    if (!(run > 1.2)) return;
    const pieces = Math.min(SMEAR_PIECES, Math.ceil(run / SMEAR_GAP));
    const yaw = Math.atan2(dx, dz);
    for (let k = 0; k < pieces; k++) {
      // (the last stretch, nearest where it lies, the broadest: it slid there more slowly)
      const t = (k + 0.5) / pieces;
      const wide = (0.22 + 0.3 * bleed) * (0.6 + 0.4 * t) * (0.85 + Math.random() * 0.3);
      const i = POOLS + this.smearCursor;
      this.smearCursor = (this.smearCursor + 1) % SMEARS;
      this.lay(i, x0 + dx * t, z0 + dz * t, fromY, wide, (run / pieces) * 1.25, yaw + (Math.random() - 0.5) * 0.25, SMEAR);
    }
  }

  // Quad i at (x, z) on the slope under it, `width` across and `length` along `yaw`, reaching its size in `spread` s
  lay(i: number, x: number, z: number, fromY: number, width: number, length: number, yaw: number, spread: number): void {
    const p = this.pools[i];
    const g = (px: number, pz: number) => this.groundAt(px, pz, fromY);
    p.y = g(x, z);
    p.pitch = -Math.atan2(g(x, z + 0.6) - g(x, z - 0.6), 1.2);
    p.roll = Math.atan2(g(x + 0.6, z) - g(x - 0.6, z), 1.2);
    Object.assign(p, { x, z, yaw, width, length, spread, age: 0, live: true });
    this.mesh.geometry.attributes.bloodSeed.array[i] = Math.random();
    this.mesh.geometry.attributes.bloodSeed.needsUpdate = true;
    this.place(i);
  }

  place(i: number): void {
    const p = this.pools[i];
    const t = Math.min(1, p.age / p.spread);
    const s = 0.15 + 0.85 * (1 - (1 - t) * (1 - t) * (1 - t)); // (quick at first, slowing)
    dummy.position.set(p.x, p.y + LIFT, p.z);
    dummy.rotation.set(p.pitch, 0, p.roll, 'XYZ');
    dummy.rotateY(p.yaw);
    dummy.scale.set(p.width * s, 1, p.length * s);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  // Per frame: the pools & smears still spreading grow
  update(dt: number): void {
    for (let i = 0; i < QUADS; i++) {
      const p = this.pools[i];
      if (!p.live || p.age >= p.spread) continue;
      p.age += dt;
      this.place(i);
    }
  }
}

export type { GroundAt, BloodPool };
export { BloodPools };
