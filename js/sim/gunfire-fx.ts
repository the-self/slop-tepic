import * as THREE from 'three/webgpu';

// js/sim/gunfire-fx.ts
// What gunfire and explosions look like (crime.ts fires them): tracers, muzzle flashes, blood and dust puffs off what a
// shot hits, rockets with their smoke trails, fireballs, smoke and flames. Two instanced particle pools, one drawn
// unlit and bright enough for the bloom (tracers, flashes, fire), one lit (smoke, dust, blood, debris), plus a couple
// of point lights for the blasts. Nothing is allocated per shot: every pool is made up front.

const GLOW_MAX = 192;
const PUFF_MAX = 420;
const ROCKET_MAX = 6;
const BLAST_LIGHTS = 2;
const PARKED_Y = -1000; // where unused meshes wait (still in the scene, so their pipelines compile with the rest)

const dummy = new THREE.Object3D();
const tint = new THREE.Color();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

// What a shot throws up where it hits: blood off people, sparks off metal, dust off anything else
type ImpactKind = 'blood' | 'metal' | 'dust';
// A rocket in flight (launchRocket's handle)
interface Rocket {
  mesh: THREE.Group;
  live: boolean;
}
// A blast's flash: t s since it went off, power its peak intensity
interface BlastLight {
  light: THREE.PointLight;
  t: number;
  power: number;
}

// A pool of particles drawn as one instanced mesh. Each particle grows from size0 to size1 over its life (or keeps a
// fixed length along its direction: tracers), drifts with its velocity, falls with `gravity` and fades its colour.
class ParticlePool {
  max: number;
  mesh: THREE.InstancedMesh;
  // per particle: position (m), velocity (m/s), age & life (s), sizes (m), streak length (m, 0 for a puff) & its
  // direction (rad), colour (linear, over 1 glows), gravity (m/s²; negative rises), drag (1/s), spin (rad)
  x: Float32Array; y: Float32Array; z: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  age: Float32Array; life: Float32Array; size0: Float32Array; size1: Float32Array;
  len: Float32Array; yaw: Float32Array; pitch: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  gravity: Float32Array; drag: Float32Array; spin: Float32Array;
  alive: Uint8Array;
  cursor: number;
  used: number;

  constructor(scene: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, max: number, name: string) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, tint.setRGB(1, 1, 1));
    }
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 1; // one (degenerate) particle until the first, so the pipeline compiles up front
    scene.add(this.mesh);
    const f = () => new Float32Array(max);
    this.x = f(); this.y = f(); this.z = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.size0 = f(); this.size1 = f();
    this.len = f(); this.yaw = f(); this.pitch = f(); this.r = f(); this.g = f(); this.b = f();
    this.gravity = f(); this.drag = f(); this.spin = f();
    this.alive = new Uint8Array(max);
    this.cursor = 0;
    this.used = 0;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number,
    r: number, g: number, b: number, gravity = 0, drag = 0): number {
    // the next free slot, or the oldest one round the ring
    let i = this.cursor;
    for (let k = 0; k < this.max; k++) {
      const j = (this.cursor + k) % this.max;
      if (!this.alive[j]) {
        i = j;
        break;
      }
    }
    this.cursor = (i + 1) % this.max;
    this.alive[i] = 1;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    this.len[i] = 0;
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
    this.gravity[i] = gravity; this.drag[i] = drag;
    this.spin[i] = Math.random() * Math.PI * 2;
    return i;
  }

  update(dt: number): void {
    let n = 0;
    const mesh = this.mesh;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      const age = (this.age[i] += dt);
      const life = this.life[i];
      if (age >= life) {
        this.alive[i] = 0;
        continue;
      }
      const t = age / life;
      if (this.drag[i]) {
        const k = Math.exp(-this.drag[i] * dt);
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] -= this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      dummy.position.set(this.x[i], this.y[i], this.z[i]);
      if (this.len[i] > 0) {
        // a streak along its direction, thinning out
        const w = this.size0[i] * (1 - t);
        dummy.rotation.set(this.pitch[i], this.yaw[i], 0, 'YXZ');
        dummy.scale.set(w, w, this.len[i]);
      } else {
        // grows, and in its last fifth shrinks away
        const s = (this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t)) * Math.min(1, (1 - t) * 5);
        dummy.rotation.set(this.spin[i], this.spin[i] * 1.7, 0);
        dummy.scale.setScalar(s);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      const fade = this.len[i] > 0 ? 1 - t : 1 - t * 0.5;
      mesh.setColorAt(n, tint.setRGB(this.r[i] * fade, this.g[i] * fade, this.b[i] * fade));
      n++;
    }
    this.used = n;
    mesh.count = Math.max(1, n);
    if (n === 0) mesh.setMatrixAt(0, zero);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    const colors = mesh.instanceColor;
    if (colors) {
      colors.clearUpdateRanges();
      colors.addUpdateRange(0, Math.max(1, n) * 3);
      colors.needsUpdate = true;
    }
  }
}

class GunfireFX {
  scene: THREE.Object3D;
  glow: ParticlePool; // unlit: tracers, flashes, fire, sparks
  puff: ParticlePool; // lit: smoke, dust, blood, debris
  rockets: Rocket[];
  lights: BlastLight[];

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
    // unlit: colours over 1 glow through the bloom
    const glowMat = new THREE.MeshBasicNodeMaterial({ toneMapped: true });
    this.glow = new ParticlePool(scene, new THREE.BoxGeometry(1, 1, 1), glowMat, GLOW_MAX, 'GunfireGlow');
    const puffMat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    // (rounder than a plain icosahedron: a fire's smoke column is made of puffs metres across)
    this.puff = new ParticlePool(scene, new THREE.IcosahedronGeometry(0.5, 1), puffMat, PUFF_MAX, 'GunfireSmoke');
    this.puff.mesh.castShadow = false;
    this.puff.mesh.receiveShadow = true;

    // Rockets: a grey tube with a warhead and fins, flying nose first
    const body = new THREE.CylinderGeometry(0.055, 0.055, 0.7, 10).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.055, 0.18, 10).rotateX(Math.PI / 2).translate(0, 0, 0.44);
    const fins = new THREE.BoxGeometry(0.24, 0.24, 0.12).translate(0, 0, -0.3);
    const rocketMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a5040, roughness: 0.55, metalness: 0.4 });
    const noseMat = new THREE.MeshStandardNodeMaterial({ color: 0x8a2a1a, roughness: 0.5, metalness: 0.3 });
    this.rockets = [];
    for (let i = 0; i < ROCKET_MAX; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, rocketMat), new THREE.Mesh(nose, noseMat), new THREE.Mesh(fins, rocketMat));
      g.position.y = PARKED_Y;
      g.name = 'Rocket';
      scene.add(g);
      this.rockets.push({ mesh: g, live: false });
    }

    // Blast flashes: point lights kept in the scene at zero (adding lights later would recompile every material)
    this.lights = [];
    for (let i = 0; i < BLAST_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffa040, 0, 45, 2);
      light.position.y = PARKED_Y;
      scene.add(light);
      this.lights.push({ light, t: 1, power: 0 });
    }
  }

  // A tracer streak from (x0, y0, z0) to (x1, y1, z1)
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.3) return;
    // a short bright streak flying down the line of fire (~450 m/s, slowed so it shows)
    const len = Math.min(d, 2.4 + d * 0.15);
    const speed = 180;
    const i = this.glow.spawn(x0 + dx / d * len * 0.5, y0 + dy / d * len * 0.5, z0 + dz / d * len * 0.5,
      dx / d * speed, dy / d * speed, dz / d * speed, Math.max(0.02, (d - len) / speed), 0.035, 0.035, 9, 7, 3.5);
    this.glow.len[i] = len;
    this.glow.yaw[i] = Math.atan2(dx, dz);
    this.glow.pitch[i] = -Math.asin(dy / d);
  }

  // A muzzle flash at (x, y, z) firing towards `yaw`: bigger for the bazooka's back-blast
  muzzle(x: number, y: number, z: number, yaw: number, big = false): void {
    const s = big ? 0.5 : 0.2;
    for (let k = 0; k < (big ? 4 : 2); k++) {
      this.glow.spawn(x, y, z, Math.sin(yaw) * (2 + k * 2), 0, Math.cos(yaw) * (2 + k * 2), 0.05 + k * 0.01, s, s * 0.4, 14, 9, 3);
    }
    if (big) {
      for (let k = 0; k < 6; k++) {
        this.puff.spawn(x - Math.sin(yaw) * 0.6, y, z - Math.cos(yaw) * 0.6, -Math.sin(yaw) * 4 + rnd(1.5), rnd(1), -Math.cos(yaw) * 4 + rnd(1.5),
          1.2 + Math.random(), 0.3, 1.4, 0.75, 0.74, 0.72, -0.4, 1.8);
      }
    }
  }

  // Someone hit by a vehicle at `speed` m/s (traffic.ts knockListener, crime.ts): blood thrown from where they were
  // struck, more of it and further the harder the hit, along the way they were sent (nx, nz) and falling back
  splatter(x: number, y: number, z: number, speed: number, nx = 0, nz = 0): void {
    const n = Math.min(36, 6 + Math.round(speed * 1.1));
    for (let k = 0; k < n; k++) {
      const throwSpeed = speed * (0.15 + Math.random() * 0.45);
      this.puff.spawn(x, y + rnd(0.5), z, nx * throwSpeed + rnd(2.4), 0.6 + Math.random() * (1.5 + speed * 0.12), nz * throwSpeed + rnd(2.4),
        0.5 + Math.random() * 0.5, 0.07 + Math.random() * 0.06, 0.03, 0.3, 0.015, 0.02, 9.8, 0.4);
    }
  }

  // What a shot hitting something at (x, y, z) throws up: 'blood' off people, 'dust' off walls, sparks off metal
  impact(x: number, y: number, z: number, kind: ImpactKind, nx = 0, nz = 0): void {
    if (kind === 'blood') {
      for (let k = 0; k < 6; k++) {
        this.puff.spawn(x, y, z, nx * 2 + rnd(1.6), 0.5 + Math.random() * 1.5, nz * 2 + rnd(1.6), 0.4 + Math.random() * 0.3, 0.08, 0.04, 0.32, 0.02, 0.02, 9, 0.5);
      }
    } else if (kind === 'metal') {
      for (let k = 0; k < 5; k++) {
        this.glow.spawn(x, y, z, nx * 4 + rnd(4), 1 + Math.random() * 3, nz * 4 + rnd(4), 0.18 + Math.random() * 0.12, 0.045, 0.02, 10, 6, 2, 9, 0.5);
      }
    } else {
      for (let k = 0; k < 4; k++) {
        this.puff.spawn(x, y, z, nx * 1.5 + rnd(1), 0.4 + Math.random(), nz * 1.5 + rnd(1), 0.5 + Math.random() * 0.4, 0.1, 0.35, 0.55, 0.5, 0.44, 1.5, 2);
      }
      this.glow.spawn(x, y, z, 0, 0, 0, 0.04, 0.08, 0.03, 8, 6, 3);
    }
  }

  // A puff of grey smoke at (x, y, z), `size` m across when it has spread: rocket trails, burning wrecks
  smoke(x: number, y: number, z: number, size = 1, dark = 0.5): void {
    const c = 0.62 - dark * 0.5;
    this.puff.spawn(x + rnd(0.2), y, z + rnd(0.2), rnd(0.4), 0.9 + Math.random() * 0.8, rnd(0.4), 1.6 + Math.random() * 1.2,
      size * 0.25, size, c, c, c * 0.98, -0.3, 0.6);
  }

  // A lick of flame at (x, y, z)
  flame(x: number, y: number, z: number, size = 1): void {
    this.glow.spawn(x + rnd(0.4 * size), y, z + rnd(0.4 * size), rnd(0.3), 1.4 + Math.random() * 1.4, rnd(0.3), 0.35 + Math.random() * 0.3,
      size * 0.45, size * 0.12, 12, 4.2 + Math.random() * 2, 0.6, -1.5, 1.2);
  }

  // A fireball at (x, y, z) `size` m across, its smoke and debris, and a flash lighting up the street around
  explosion(x: number, y: number, z: number, size = 7): void {
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const v = size * (0.8 + Math.random() * 0.8);
      this.glow.spawn(x, y + 0.3, z, Math.cos(a) * v * (1 - up * 0.5), v * up * 0.9 + 1, Math.sin(a) * v * (1 - up * 0.5),
        0.45 + Math.random() * 0.35, size * 0.18, size * 0.32, 14, 5.5 + Math.random() * 3, 1.2, -1, 4.5);
    }
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = size * (0.3 + Math.random() * 0.5);
      const c = 0.12 + Math.random() * 0.2;
      this.puff.spawn(x, y + 0.5, z, Math.cos(a) * v, 1.5 + Math.random() * 3, Math.sin(a) * v, 2.4 + Math.random() * 2.2,
        size * 0.15, size * (0.45 + Math.random() * 0.3), c, c, c, -0.35, 1.6);
    }
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 6 + Math.random() * 10;
      this.puff.spawn(x, y + 0.4, z, Math.cos(a) * v, 4 + Math.random() * 8, Math.sin(a) * v, 1 + Math.random(),
        0.12 + Math.random() * 0.12, 0.08, 0.08, 0.07, 0.06, 18, 0.2);
    }
    // the dimmer of the two lights goes to the new blast
    const slot = this.lights[0].power <= this.lights[1].power ? this.lights[0] : this.lights[1];
    slot.light.position.set(x, y + 2, z);
    slot.t = 0;
    slot.power = 2600 * (size / 7);
  }

  // A rocket flying from (x, y, z) towards `yaw`, `pitch`: returns its handle (move it with placeRocket) or null
  launchRocket(x: number, y: number, z: number, yaw: number, pitch: number): Rocket | null {
    const r = this.rockets.find((q) => !q.live);
    if (!r) return null;
    r.live = true;
    this.placeRocket(r, x, y, z, yaw, pitch);
    return r;
  }

  placeRocket(r: Rocket, x: number, y: number, z: number, yaw: number, pitch: number): void {
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.set(pitch, yaw, 0, 'YXZ');
    // its exhaust
    this.glow.spawn(x - Math.sin(yaw) * 0.45, y, z - Math.cos(yaw) * 0.45, 0, 0, 0, 0.05, 0.22, 0.1, 14, 8, 3);
    this.smoke(x - Math.sin(yaw) * 0.5, y, z - Math.cos(yaw) * 0.5, 0.9, 0.1);
  }

  dropRocket(r: Rocket): void {
    r.live = false;
    r.mesh.position.y = PARKED_Y;
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.puff.update(dt);
    for (const slot of this.lights) {
      slot.t += dt;
      const k = Math.max(0, 1 - slot.t / 0.45);
      slot.light.intensity = slot.power * k * k;
      if (k <= 0) {
        slot.power = 0;
        slot.light.position.y = PARKED_Y;
      }
    }
  }
}

const rnd = (s: number): number => (Math.random() - 0.5) * 2 * s;

export type { ImpactKind, Rocket, BlastLight, ParticlePool };
export { GunfireFX };
