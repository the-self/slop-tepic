// js/places/forum/life/glass.ts
// Forum Tepic's breakable glass: the shops' windows downstairs and the entrances' (plan.ts panes), each its own
// quad in one mesh per kind. A car or a moto driven into one fast enough goes through it: its quad folds away, its
// wall leaves the player's colliders and the car's world (car-physics.ts dropWall), and its glass falls in shards
// that bounce on the floor and lie there a while. All of it is whole again once the camera is far from the mall.
import * as THREE from 'three/webgpu';
import { FORUM } from '../plan.ts';
import { MeshList, addMesh } from '../../kit/mesh-list.ts';
import type { Collider } from '../../../world/buildings.ts';
import type { Hitter } from './shoppers.ts';
import type { ForumMaterials } from '../index.ts';

const BREAK_SPEED = 4; // m/s: slower, a vehicle just stops against the glass
const SHARDS = 300; // the most shards falling or lying at once
const SHARD_LIFE = 20; // s a shard lies on the floor
const MEND_FAR = 450; // m from the rotunda: farther, the broken glass is whole again

/** A pane's wall among the player's colliders: `broken` while the pane is (collisions.ts passes it by) */
type PaneCollider = Collider & { broken?: boolean };

/** A pane as drawn: its mesh's position array and where its 4 corners start in it, as built (to mend it) */
interface DrawnPane {
  positions: THREE.BufferAttribute;
  start: number;
  whole: Float32Array;
  broken: boolean;
}

/** A shard: where it is (m) and goes (m/s), its spin (rad, rad/s), how long it has been about (s) */
interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  spin: number;
  age: number;
}

/** What hearing glass break needs: a crash's sound (audio/audio-system.ts crash) */
export interface GlassSound {
  crash(impact: { a: unknown; b: unknown; x: number; y: number; z: number; speed: number }): unknown;
}
/** What breaking a pane's wall needs of the car's physics (car-physics.ts PhysicsWorld) */
export interface GlassPhysics {
  world: { dropWall(c: Collider): void };
}

export class ForumGlass {
  panes: DrawnPane[] = [];
  colliders: PaneCollider[];
  shards: Shard[] = [];
  shardMesh: THREE.InstancedMesh;
  base: (x: number, z: number) => number;
  physics: GlassPhysics | null = null;
  sound: GlassSound | null = null;
  anyBroken = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(group: THREE.Group, mats: ForumMaterials, colliders: PaneCollider[], base: (x: number, z: number) => number) {
    this.colliders = colliders;
    this.base = base;
    const shop = new MeshList(), entrance = new MeshList();
    const at: { geo: MeshList; start: number }[] = [];
    for (const p of FORUM.panes) {
      const geo = p.kind === 'shop' ? shop : entrance;
      at.push({ geo, start: geo.count });
      const y = base((p.ax + p.bx) / 2, (p.az + p.bz) / 2);
      geo.face(p.ax, p.az, p.bx, p.bz, y, y + p.y1, p.nx, p.nz);
    }
    const meshes = new Map<MeshList, THREE.Mesh | null>([
      [shop, addMesh(group, shop, mats.shopGlass, 'ForumShopPanes', { shadows: false })],
      [entrance, addMesh(group, entrance, mats.glass, 'ForumEntrancePanes', { shadows: false })]
    ]);
    // (one record a pane, in the plan's order: a pane with no mesh to show it is kept as broken, never struck)
    for (const { geo, start } of at) {
      const positions = meshes.get(geo)?.geometry.getAttribute('position');
      if (positions instanceof THREE.BufferAttribute) {
        this.panes.push({ positions, start, whole: Float32Array.from(positions.array.slice(start * 3, start * 3 + 12)), broken: false });
      } else this.panes.push({ positions: new THREE.BufferAttribute(new Float32Array(12), 3), start: 0, whole: new Float32Array(12), broken: true });
    }
    // the shards: small slivers of glass, instanced, hidden till thrown
    const shard = new THREE.PlaneGeometry(0.16, 0.1);
    this.shardMesh = new THREE.InstancedMesh(shard, mats.railGlass, SHARDS);
    this.shardMesh.name = 'ForumGlassShards';
    this.shardMesh.frustumCulled = false;
    this.shardMesh.count = 0;
    group.add(this.shardMesh);
  }

  /** Breaks what `hit` drives into, moves the shards, mends it all when the camera is far */
  update(dt: number, hit: Hitter | null, entity: unknown, camera: THREE.Camera): void {
    if (hit && hit.speed > BREAK_SPEED) this.drive(hit, entity, dt);
    if (this.shards.length) this.fall(dt);
    if (this.anyBroken && Math.hypot(camera.position.x - FORUM.rotunda.x, camera.position.z - FORUM.rotunda.z) > MEND_FAR) this.mend();
  }

  // the panes the vehicle's leading end reaches this frame (its nose, or its tail backing up; a little ahead, so it goes
  // through before its body meets them)
  private drive(hit: Hitter, entity: unknown, dt: number): void {
    const sign = hit.back ? -1 : 1, fx = Math.sin(hit.heading) * sign, fz = Math.cos(hit.heading) * sign, rx = fz, rz = -fx;
    const reach = hit.halfL + 0.5 + hit.speed * dt * 3;
    const panes = FORUM.panes;
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      if (this.panes[i].broken) continue;
      const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
      if (Math.hypot(mx - hit.x, mz - hit.z) > Math.hypot(p.bx - p.ax, p.bz - p.az) / 2 + reach + 1) continue;
      // (its middle and either corner)
      for (let k = -1; k <= 1; k++) {
        const x = hit.x + fx * reach + rx * hit.halfW * 0.8 * k, z = hit.z + fz * reach + rz * hit.halfW * 0.8 * k;
        const ux = p.bx - p.ax, uz = p.bz - p.az, L2 = ux * ux + uz * uz || 1;
        const t = Math.max(0, Math.min(1, ((x - p.ax) * ux + (z - p.az) * uz) / L2));
        if (Math.hypot(p.ax + ux * t - x, p.az + uz * t - z) > 0.6) continue;
        this.shatter(i, hit, entity);
        break;
      }
    }
  }

  private shatter(i: number, hit: Hitter, entity: unknown): void {
    const p = FORUM.panes[i], d = this.panes[i];
    d.broken = true;
    this.anyBroken = true;
    // its quad folded to a point, its wall gone
    const arr = d.positions.array;
    for (let k = 0; k < 4; k++) arr.set(d.whole.subarray(0, 3), d.start * 3 + k * 3);
    d.positions.needsUpdate = true;
    const c = this.colliders[p.wall];
    c.broken = true;
    this.physics?.world.dropWall(c);
    // its glass thrown on along the vehicle's way, falling over the pane's face
    const L = Math.hypot(p.bx - p.ax, p.bz - p.az), y0 = this.base((p.ax + p.bx) / 2, (p.az + p.bz) / 2);
    const v = hit.back ? -hit.speed : hit.speed, vx = Math.sin(hit.heading) * v, vz = Math.cos(hit.heading) * v;
    const n = Math.min(SHARDS - this.shards.length, Math.round(L * 10));
    for (let k = 0; k < n; k++) {
      const t = Math.random();
      this.shards.push({
        x: p.ax + (p.bx - p.ax) * t, y: y0 + Math.random() * p.y1, z: p.az + (p.bz - p.az) * t,
        vx: vx * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: vz * (0.3 + Math.random() * 0.5) + (Math.random() - 0.5) * 2,
        rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 20, age: 0
      });
    }
    this.sound?.crash({ a: entity, b: p, x: (p.ax + p.bx) / 2, y: y0 + 1, z: (p.az + p.bz) / 2, speed: hit.speed });
  }

  // the shards falling, bouncing on the floor, lying there till they go
  private fall(dt: number): void {
    let n = 0;
    for (const s of this.shards) {
      s.age += dt;
      if (s.age > SHARD_LIFE) continue;
      const floor = this.base(s.x, s.z) + 0.01;
      if (s.y > floor || s.vy > 0) {
        s.vy -= 9.81 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.rot += s.spin * dt;
        if (s.y < floor) {
          s.y = floor;
          s.vy = Math.abs(s.vy) > 1.5 ? -s.vy * 0.25 : 0;
          s.vx *= 0.4;
          s.vz *= 0.4;
          s.spin *= 0.3;
        }
      }
      const lying = s.y <= floor + 0.001 && s.vy === 0;
      this.e.set(lying ? -Math.PI / 2 : s.rot, s.rot * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.shardMesh.setMatrixAt(n, this.m.compose(this.p.set(s.x, s.y, s.z), this.q, this.s));
      this.shards[n++] = s;
    }
    this.shards.length = n;
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  // every pane whole again, its wall back
  private mend(): void {
    FORUM.panes.forEach((p, i) => {
      const d = this.panes[i];
      if (!d.broken) return;
      d.broken = false;
      d.positions.array.set(d.whole, d.start * 3);
      d.positions.needsUpdate = true;
      this.colliders[p.wall].broken = false;
    });
    this.anyBroken = false;
    this.shards.length = 0;
    this.shardMesh.count = 0;
  }
}
