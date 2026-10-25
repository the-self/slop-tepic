import * as THREE from 'three/webgpu';

// js/sim/mayhem.ts
// Knock-downs for the player's car and bicycle: who is hit (pedestrians, cyclists, motorcyclists; thrown as ragdolls,
// sim/ragdolls.ts), and street furniture (lamp posts, hydrants) tipping over. Pure helpers (tested in
// tests/mayhem.test.cjs) plus the props' breaker, which hides a prop's static instances and animates a stand-in falling
// in its place.

// boxHit()'s contact: its direction away from the player's centre (unit), and where it is in the player's box (m along
// its length and across it)
interface BoxContact {
  nx: number;
  nz: number;
  along: number;
  across: number;
}
// What slide() moves: a position (m) and horizontal velocity (m/s)
interface Sliding {
  px: number;
  pz: number;
  vx: number;
  vz: number;
}
// Whether a wall stands at (x, z)
type SolidQuery = (x: number, z: number) => boolean;
// A pole falling (angle rad: 0 upright .. ~π/2 lying; angVel rad/s; rest: s lying still)
interface Topple {
  angle: number;
  angVel: number;
  rest: number;
  bounced: boolean;
}
type PropKind = 'cobra' | 'post' | 'hydrant';
// A static InstancedMesh (or one of the chunks scene-culling.ts split it into, recorded in userData.chunked: `where`
// gives each instance's chunk and slot, -1 for none)
interface HideableMesh {
  instanceMatrix: {
    array: { fill(value: number, start?: number, end?: number): unknown };
    addUpdateRange?(start: number, count: number): void;
    needsUpdate: boolean;
  };
  userData?: { chunked?: { chunks: readonly (HideableMesh | undefined)[]; where: ArrayLike<number> } };
}
// One of a prop's instances in the static InstancedMeshes (street-details.ts)
interface PropPart {
  mesh: THREE.InstancedMesh;
  index: number;
}
// A prop the player can knock over: where it stands (m; yaw rad), `ground` the height its stand-in stands at, `base` the
// ground's height under it; `light` (a street lamp's) goes out with it
interface BreakableProp {
  kind: PropKind;
  x: number;
  z: number;
  yaw: number;
  ground: number;
  base: number;
  parts: PropPart[];
  light?: { broken: boolean } | null;
  broken?: boolean;
}
// A part of a kind's stand-in, in the prop's own frame (base at the origin, +x towards the street)
interface PropLook {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix?: THREE.Matrix4;
}
type PropLooks = Partial<Record<PropKind, PropLook[]>>;
// The collision told to the listener (main.ts: the audio and the crash damage); one object, reused
interface PropImpact {
  a: BreakableProp | null;
  b: THREE.InstancedMesh | BreakableProp | null;
  kind: 'prop';
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  speed: number;
}
// The player's car, bicycle or moto, as the breaker reads it (speed m/s along heading, rad; vx, vz m/s besides)
interface KnockingEntity {
  position: { x: number; y: number; z: number };
  heading?: number;
  speed: number;
  vx?: number;
  vz?: number;
}
// A knocked prop's stand-in: falling over (fall), or a hydrant thrown (fly: y m over the ground, base where it stood)
interface Debris {
  root: THREE.Group;
  tilt: THREE.Group;
  kind: PropKind;
  age: number;
  fall: Topple;
  tall: number;
  fly: (Sliding & { vy: number; y: number; base: number }) | null;
  jet: THREE.Mesh | null;
  done?: boolean;
}

const GRAVITY = 9.8;

/**
 * Does a body of radius `r` at (x, z) touch the player's box (centre px, pz, facing `heading`, half width hw, half
 * length hl)? Returns the contact's direction away from the player's centre, or null.
 */
function boxHit(px: number, pz: number, heading: number, hw: number, hl: number, x: number, z: number, r: number): BoxContact | null {
  const dx = x - px;
  const dz = z - pz;
  const sn = Math.sin(heading);
  const cs = Math.cos(heading);
  const along = dx * sn + dz * cs;
  const across = dx * cs - dz * sn;
  if (Math.abs(along) > hl + r || Math.abs(across) > hw + r) return null;
  const d = Math.hypot(dx, dz) || 1;
  return { nx: dx / d, nz: dz / d, along, across };
}

/**
 * Does the player, in `mode`, knock a cyclist or motorcyclist they touch off their bike? Only from a car or a bicycle,
 * when (rvx, rvz), the player's velocity less the rider's (whichever of them was moving), drives them together across
 * the contact (nx, nz: from the player towards the rider) faster than `minSpeed`, or slides one along the other well
 * faster than that: brushing past a rider at about their own speed only eases them apart.
 */
function riderKnocked(mode: string, rvx: number, rvz: number, nx: number, nz: number, minSpeed: number): boolean {
  if (mode !== 'car' && mode !== 'cyclist') return false;
  const closing = rvx * nx + rvz * nz;
  const slide = Math.hypot(rvx - closing * nx, rvz - closing * nz);
  return closing > minSpeed || slide > minSpeed * 2.5;
}

// Moves o.px, o.pz by (dx, dz) unless that enters a wall, in which case its horizontal velocity bounces back softly
function slide(o: Sliding, dx: number, dz: number, solidAt: SolidQuery | null | undefined): boolean {
  if (solidAt && (dx || dz) && solidAt(o.px + dx, o.pz + dz)) {
    o.vx *= -0.25;
    o.vz *= -0.25;
    return false;
  }
  o.px += dx;
  o.pz += dz;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------------------------------------------------

/** Pole falling over about its base: angle 0 upright .. ~π/2 lying, pushed by an impact of speed v */
function startTopple(speed: number, rand: () => number = Math.random): Topple {
  return { angle: 0, angVel: 0.6 + Math.min(4.5, speed * 0.22) * (0.85 + rand() * 0.3), rest: 0, bounced: false };
}

function stepTopple(f: Topple, dt: number, lying = Math.PI / 2 - 0.04, tall = 6): number {
  // gravity's torque on a rod pivoting at its foot: θ'' = (3g / 2L) sin θ
  f.angVel += ((3 * GRAVITY) / (2 * tall)) * Math.sin(Math.max(0.02, f.angle)) * dt;
  f.angle += f.angVel * dt;
  if (f.angle >= lying) {
    f.angle = lying;
    if (!f.bounced && f.angVel > 1.2) {
      f.angVel = -f.angVel * 0.18;
      f.bounced = true;
    } else {
      f.angVel = 0;
      f.rest += dt;
    }
  }
  return f.rest;
}

/**
 * The street furniture the player can knock over. `props`: [{ kind: 'cobra' | 'post' | 'hydrant', x, z, yaw, ground (the
 * height its stand-in stands at), base (the ground's height under it), parts:
 * [{ mesh, index }], light? }], the parts being the prop's instances in the static InstancedMeshes (see street-details.ts;
 * scene-culling.ts may have split them into chunks, recorded in mesh.userData.chunked). `looks` gives each kind's
 * stand-in: { [kind]: [{ geometry, material }] } in the prop's own frame (base at the origin, +x towards the street).
 */
class PropBreaker {
  props: BreakableProp[];
  looks: PropLooks;
  cells: Map<number, BreakableProp[]>;
  debris: Debris[];
  listener: ((e: PropImpact) => void) | null;
  solidAt: SolidQuery | null;
  groundAt?: ((x: number, z: number) => number) | null;
  event: PropImpact;
  group: THREE.Group;
  jetGeo: THREE.CylinderGeometry;
  jetMat: THREE.MeshStandardNodeMaterial;

  constructor(scene: THREE.Object3D, props: BreakableProp[], looks: PropLooks) {
    this.props = props;
    this.looks = looks;
    this.cells = new Map();
    this.debris = []; // falling stand-ins; once lying still they stay put (the prop's instance stays hidden)
    this.listener = null;
    this.solidAt = null;
    this.event = { a: null, b: null, kind: 'prop', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
    this.group = new THREE.Group();
    this.group.name = 'KnockedProps';
    scene.add(this.group);
    for (const p of props) {
      const k = this.key(Math.floor(p.x / 16), Math.floor(p.z / 16));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(p);
    }
    const jetMat = new THREE.MeshStandardNodeMaterial({ color: 0xcfe8ff, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.55 });
    this.jetGeo = new THREE.CylinderGeometry(0.05, 0.35, 1, 10, 1, true).translate(0, 0.5, 0);
    this.jetMat = jetMat;
  }

  key(ix: number, iz: number): number {
    return ix * 100003 + iz;
  }

  setCollisionListener(fn: ((e: PropImpact) => void) | null): void {
    this.listener = typeof fn === 'function' ? fn : null;
  }

  // Where walls stand, for props knocked flying: (x, z) => boolean
  setSolidQuery(fn: SolidQuery | null): void {
    this.solidAt = typeof fn === 'function' ? fn : null;
  }

  // The ground's height at (x, z) (ground.ts), for the player's height over it and the props thrown across it
  setGroundQuery(fn: ((x: number, z: number) => number) | null): void {
    this.groundAt = typeof fn === 'function' ? fn : null;
  }

  /** Knocks over whatever the player's car or bicycle runs into this frame */
  update(dt: number, entity: KnockingEntity | null | undefined, mode: string): void {
    const over = entity ? entity.position.y - (this.groundAt ? this.groundAt(entity.position.x, entity.position.z) : 0) : 0;
    if (entity && (mode === 'car' || mode === 'cyclist' || mode === 'moto') && over < 1.5) {
      const heading = entity.heading || 0;
      const vx = Math.sin(heading) * (entity.speed || 0) + (entity.vx || 0);
      const vz = Math.cos(heading) * (entity.speed || 0) + (entity.vz || 0);
      const speed = Math.hypot(vx, vz);
      if (speed > 1.5) {
        const hw = mode === 'car' ? 0.9 : 0.35;
        const hl = mode === 'car' ? 2.25 : 0.9;
        const x = entity.position.x, z = entity.position.z;
        const ix = Math.floor(x / 16), iz = Math.floor(z / 16);
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            const list = this.cells.get(this.key(ix + a, iz + b));
            if (!list) continue;
            for (const p of list) {
              if (p.broken) continue;
              const hit = boxHit(x, z, heading, hw, hl, p.x, p.z, p.kind === 'hydrant' ? 0.3 : 0.2);
              if (!hit) continue;
              this.knock(p, vx, vz, speed, hit);
              entity.speed *= p.kind === 'hydrant' ? 0.88 : mode === 'car' ? 0.8 : 0.45;
            }
          }
        }
      }
    }
    this.animate(dt);
  }

  knock(p: BreakableProp, vx: number, vz: number, speed: number, hit: BoxContact): void {
    p.broken = true;
    if (p.light) p.light.broken = true;
    for (const part of p.parts) hideInstance(part.mesh, part.index);
    // the stand-in falls the way the player was going
    const dir = Math.atan2(vx, vz);
    const look = this.looks[p.kind] ?? [];
    const root = new THREE.Group();
    root.position.set(p.x, p.ground || 0, p.z);
    const tilt = new THREE.Group();
    root.add(tilt);
    const body = new THREE.Group();
    body.rotation.y = (p.yaw || 0) - dir; // the prop's own frame inside the fall frame (falls towards +z)
    tilt.add(body);
    root.rotation.y = dir;
    for (const { geometry, material, matrix } of look) {
      const m = new THREE.Mesh(geometry, material);
      if (matrix) m.applyMatrix4(matrix);
      m.castShadow = true;
      body.add(m);
    }
    const d: Debris = {
      root, tilt, kind: p.kind, age: 0,
      fall: startTopple(speed),
      tall: p.kind === 'cobra' ? 8.4 : p.kind === 'post' ? 3.9 : 0.9,
      // hydrants are knocked off their base and thrown
      // (y over the ground under it, `base` where it stood)
      fly: p.kind === 'hydrant' ? { px: p.x, pz: p.z, vx: vx * 0.6 + hit.nx * 1.5, vy: 3 + speed * 0.12, vz: vz * 0.6 + hit.nz * 1.5, y: 0, base: p.base || 0 } : null,
      jet: null
    };
    if (p.kind === 'hydrant') {
      const jet = new THREE.Mesh(this.jetGeo, this.jetMat);
      jet.position.set(p.x, (p.ground || 0) + 0.2, p.z);
      jet.scale.set(1, 7, 1);
      this.group.add(jet);
      d.jet = jet;
    }
    this.group.add(root);
    this.debris.push(d);
    if (this.listener) {
      const e = this.event;
      e.a = p;
      e.b = p.parts.at(0)?.mesh ?? p;
      e.x = p.x; e.y = 1.0 + (p.base || 0); e.z = p.z;
      e.nx = -hit.nx; e.nz = -hit.nz;
      e.speed = Math.min(speed, p.kind === 'hydrant' ? 6 : 12);
      this.listener(e);
    }
  }

  animate(dt: number): void {
    let settled = 0;
    for (const d of this.debris) {
      d.age += dt;
      if (d.done) {
        settled++;
        continue;
      }
      if (d.fly) {
        const f = d.fly;
        f.vy -= GRAVITY * dt;
        f.y = Math.max(0, f.y + f.vy * dt);
        if (f.y === 0) { f.vy = f.vy < -2 ? -f.vy * 0.3 : 0; f.vx *= Math.exp(-4 * dt); f.vz *= Math.exp(-4 * dt); }
        slide(f, f.vx * dt, f.vz * dt, this.solidAt);
        d.root.position.x = f.px;
        d.root.position.z = f.pz;
        d.root.position.y = f.y + (this.groundAt ? this.groundAt(f.px, f.pz) : f.base);
        d.tilt.rotation.x = Math.min(Math.PI / 2, d.tilt.rotation.x + dt * 6);
      } else if (d.fall.rest < 1) {
        stepTopple(d.fall, dt, Math.PI / 2 - 0.04, d.tall);
        d.tilt.rotation.x = d.fall.angle;
      }
      if (d.jet) {
        const flick = 1 + Math.sin(d.age * 31) * 0.06 + Math.sin(d.age * 17.3) * 0.05;
        const fade = Math.max(0, Math.min(1, (40 - d.age) / 6));
        d.jet.scale.set(flick * fade + 0.001, (7 + Math.sin(d.age * 9) * 0.6) * fade + 0.001, flick * fade + 0.001);
        d.jet.visible = fade > 0;
        if (!d.jet.visible) {
          this.group.remove(d.jet);
          d.jet = null;
        }
      }
      // lying still with no water left: nothing more to animate
      const still = d.fly ? d.fly.y === 0 && d.fly.vy === 0 && Math.hypot(d.fly.vx, d.fly.vz) < 0.05 : d.fall.rest >= 1;
      if (still && !d.jet) d.done = true;
    }
    // keep the list to the props still moving
    if (settled > 64) this.debris = this.debris.filter((d) => !d.done);
  }
}

// Hides instance `index` of a static InstancedMesh, wherever scene-culling.ts moved it (mesh.userData.chunked)
function hideInstance(mesh: HideableMesh, index: number): void {
  let target: HideableMesh | undefined = mesh;
  let j = index;
  const ch = mesh.userData?.chunked;
  if (ch) {
    target = ch.chunks[ch.where[index * 2]];
    j = ch.where[index * 2 + 1];
  }
  if (!target || j < 0) return;
  const attr = target.instanceMatrix;
  attr.array.fill(0, j * 16, j * 16 + 16);
  if (attr.addUpdateRange) attr.addUpdateRange(j * 16, 16);
  attr.needsUpdate = true;
}

export type { BoxContact, Sliding, SolidQuery, Topple, PropKind, HideableMesh, PropPart, BreakableProp, PropLook, PropLooks, PropImpact, KnockingEntity, Debris };
export { boxHit, riderKnocked, slide, startTopple, stepTopple, hideInstance, PropBreaker };
