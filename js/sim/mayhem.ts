import * as THREE from 'three/webgpu';
import type Jolt from 'jolt-physics';
import type { Collider } from '../world/buildings.ts';

// js/sim/mayhem.ts
// Knock-downs for the player's vehicles: who is hit (pedestrians, cyclists, motorcyclists; thrown as ragdolls,
// sim/ragdolls.ts), and the street furniture (lamp posts, sign posts, hydrants, bins; and, to a car only, the CFE's
// concrete poles and the trees and palms not too thick to give) knocked loose as bodies in Jolt
// (player/car-physics.ts's world). Pure helpers (tested in tests/mayhem.test.cjs) plus the props' breaker, which hides
// a prop's static instances and lets a stand-in fall, roll and come to rest in its place.

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
type PropKind = 'cobra' | 'post' | 'sign' | 'hydrant' | 'bin' | 'cfe' | 'tree';
// A kind as a body (PROP_BODIES): mass (kg), its cylinder [radius, height] (m) and boxes [x, y, z, hx, hy, hz] (m, in
// its own frame), the closing speed (m/s) it breaks loose at, and how far round it a vehicle's box reaches for it (m);
// `heavy`: only a car breaks it (a bicycle or a moto just stops against it), and it topples on over the way it was
// struck
interface PropBody {
  mass: number;
  cyl: [number, number];
  boxes: [number, number, number, number, number, number][];
  breakAt: number;
  reach: number;
  heavy?: boolean;
}
// A static InstancedMesh (or one of the chunks scene-culling.ts split it into, recorded in userData.chunked: `where`
// gives each instance's chunk and slot, -1 for none)
interface HideableMesh {
  instanceMatrix: {
    array: { fill(value: number, start?: number, end?: number): unknown; set(values: ArrayLike<number>, offset?: number): void };
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
// A prop's collider among the player's (a corner's sign post, a CFE pole, a tree: street-details.ts): broken (no
// longer stopping walkers) once it is down; `prop` and `held` tell car-physics.ts it is a wall in Jolt (for the people
// and the cars thrown about) save while the breaker holds it, its own body standing for it near the player's vehicle
interface PropCollider extends Collider {
  broken?: boolean;
  prop?: BreakableProp;
  held?: boolean;
}
// A part of a kind's stand-in, in the prop's own frame (base at the origin, +x towards the street)
interface PropLook {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix?: THREE.Matrix4;
}
type PropLooks = Partial<Record<PropKind, PropLook[]>>;
// A prop vehicles can knock over: where it stands (m; yaw rad), `ground` the height its stand-in stands at, `base` the
// ground's height under it; `light` (a street lamp's) goes out with it, `collider` breaks with it, `look` is its own
// stand-in (over its kind's) or `standIn` builds it, `def` its own body (over its kind's: a tree's, by its size),
// `hard` how hard it is to hit (player/stats.ts hardness: a heavy prop's crash hurts the car's driver), `onBreak` is
// told the first time it comes loose
interface BreakableProp {
  kind: PropKind;
  x: number;
  z: number;
  yaw: number;
  ground: number;
  base: number;
  parts: PropPart[];
  light?: { broken: boolean } | null;
  collider?: PropCollider;
  look?: PropLook[];
  standIn?: () => THREE.Object3D;
  def?: PropBody;
  hard?: number;
  onBreak?: () => void;
}
// 'up' (its instance drawn) | 'loose' (flying, rolling: dynamic in Jolt) | 'down' (lying still)
type PropState = 'up' | 'loose' | 'down';
// A prop as the breaker keeps it (addProps): its state; its body while in Jolt (near the player), its stand-in once
// knocked (root), the ground patch under it while loose (floor, sampled at gx, gy, gz m); s it has lain still (still)
// and been loose (age), and its speed (m/s; NaN till its first step loose)
interface Prop extends BreakableProp {
  state: PropState;
  body: Jolt.Body | null;
  root: THREE.Group | null;
  floor: Jolt.Body | null;
  gx: number;
  gy: number;
  gz: number;
  still: number;
  age: number;
  speed: number;
  /** the car that snapped it (snap), which it lies through till it is clear of it (unghost), parked or driven */
  snappedBy?: KnockingEntity | null;
}
// The collision told to the listener (main.ts: the audio and the crash damage); one object, reused. A heavy prop's is
// between the vehicle that struck it (a) and the prop (b), so it hurts whoever drives it
interface PropImpact {
  a: BreakableProp | KnockingEntity | null;
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
// The player's car, bicycle or moto, as the breaker reads it (speed m/s along heading, rad; vx, vz m/s besides; the
// car's half width & length, m; its body in Jolt, which a heavy prop it snaps slows)
interface KnockingEntity {
  vehicle?: { body: Jolt.Body } | null;
  position: { x: number; y: number; z: number };
  heading?: number;
  speed: number;
  vx?: number;
  vz?: number;
  halfW?: number;
  halfL?: number;
}
// The Jolt world player/car-physics.ts shares, as the breaker uses it
interface PropPhysics {
  world: {
    Jolt: typeof Jolt;
    bodies: Jolt.BodyInterface;
    layers: { ragdoll: number; debris: number };
    // the user data that makes a body on the ragdolls' layer a wall to a car's contact (a heavy prop standing firm)
    firm: number;
    // a static body of ground n samples cell m apart a side round (cx, cz), sampled from fromY; or `body` reshaped
    groundField(body: Jolt.Body | null, cx: number, cz: number, fromY: number, n: number, cell: number): Jolt.Body;
    dropBody: (body: Jolt.Body) => void;
    // collider c's wall out of the world (the prop's own body stands for it)
    dropWall: (c: PropCollider) => void;
  };
  addSystem(sys: {
    before?(dt: number): void;
    after?(dt: number): void;
    foci?(out: THREE.Vector3[], focus: { x: number; z: number }, far: number): void;
  }): void;
}
// What the breaker keeps of Jolt once it has its world (setPhysics): scratch vectors, one shape a body (a kind's, or a
// tree size's)
interface PropJolt {
  world: PropPhysics['world'];
  tmpV: Jolt.Vec3;
  tmpR: Jolt.RVec3;
  tmpQ: Jolt.Quat;
  shapes: Map<PropBody, Jolt.Shape>;
}
// A broken hydrant's jet of water and its age (s)
interface Jet {
  mesh: THREE.Mesh;
  age: number;
}

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

// Each breakable kind as a body (its own frame: base at the origin, +x towards the street): its mass (kg), a cylinder
// up from its base [radius, height] and boxes [x, y, z, hx, hy, hz] on it, the speed (m/s) a vehicle must hit it at to
// break it loose (slower, it stands: anchored in the pavement, it stops what pushes it), and how far round it a
// vehicle's box reaches for it. A cobra lamp: a steel mast & its arm; a farol; a corner's sign post & its plate; a
// hydrant, bolted to its main; a bin, standing loose; a CFE pole, 11 m of spun concrete (~1.5 t; lighter here, or a
// car would stop dead on it) under its crossarm, snapping at its foot at ~45 km/h; a tree, a young jacaranda's (each
// tree has its own by its size: street-details.ts)
const PROP_BODIES: Record<PropKind, PropBody> = {
  cobra: { mass: 140, cyl: [0.12, 8.4], boxes: [[1.15, 8.1, 0, 1.15, 0.05, 0.05]], breakAt: 4, reach: 0.15 },
  post: { mass: 55, cyl: [0.09, 3.9], boxes: [], breakAt: 3, reach: 0.15 },
  sign: { mass: 16, cyl: [0.04, 2.8], boxes: [[0.48, 2.62, 0, 0.46, 0.11, 0.015]], breakAt: 2.5, reach: 0.1 },
  hydrant: { mass: 90, cyl: [0.24, 0.85], boxes: [], breakAt: 3, reach: 0.25 },
  bin: { mass: 11, cyl: [0.24, 0.92], boxes: [], breakAt: 0.8, reach: 0.25 },
  cfe: { mass: 900, cyl: [0.14, 11], boxes: [[0.3, 10.55, 0, 1.15, 0.05, 0.05]], breakAt: 12.5, reach: 0.2, heavy: true },
  tree: { mass: 400, cyl: [0.14, 4], boxes: [[0, 6, 0, 2.5, 2, 2.5]], breakAt: 7, reach: 0.14, heavy: true }
};
// A heavy prop snapped (snap): Jolt's contact low on a tall free body would kick its foot away and drop its top back
// onto the car, where a pole or a trunk, held at its foot, goes over ahead of it. So it falls through the car (the
// debris layer) till it lies still, turning over its foot (rad/s per m/s it was struck at, over its height in m), its
// foot carried on a little, and the car loses the momentum it gave it, as two bodies stuck together would
const TOPPLE = 0.9;
const SNAP_CARRY = 0.25; // of the speed it was struck at, its foot's
const UNGHOST_MARGIN = 0.6; // m round the vehicle's box a snapped prop must lie clear of before it meets vehicles again
const _up = new THREE.Vector3();
const MAX_LOOSE = 20; // props flying & rolling at once: past that the stillest one lies where it is, out of Jolt
const SETTLE_SPEED = 0.15; // m/s (and 0.3 rad/s) a loose prop lies still under...
const SETTLE_TIME = 1.2; // ...this long before it freezes
const MAX_LOOSE_TIME = 20; // s after which one still rocking freezes anyway
const STAND_REACH = 6; // m round a vehicle's box the props near it stand in Jolt (a slow push meets them)...
const STAND_DROP = 12; // ...and past which they leave it again
const LOOKAHEAD = 0.06; // s of a vehicle's motion its box is stretched by: a prop it is about to strike comes loose first
const HEAVY_IMPACT = 30; // m/s: a heavy prop's crash is told at its full speed (up to this), a light one's at 12 at most
const PROP_GROUND = 16; // samples of the ground under a loose prop, 1 m apart, sampled again once it is 5 m off

/** Pure: the speed (m/s) a vehicle moving at (vx, vz) closes on a prop that lies along (nx, nz) from it */
function closingSpeed(vx: number, vz: number, nx: number, nz: number): number {
  return Math.max(0, vx * nx + vz * nz);
}

/** A prop's body: its own, or its kind's */
function bodyOf(p: BreakableProp): PropBody {
  return p.def ?? PROP_BODIES[p.kind];
}

// Whether snapped prop p, lying down, lies through vehicle `v` (half width hw & length hl, m) anywhere along its length,
// foot to top
function lyingThrough(p: Prop, v: KnockingEntity, hw: number, hl: number): boolean {
  if (!p.root) return false;
  const def = bodyOf(p), h = def.cyl[1], at = p.root.position, heading = v.heading || 0;
  const up = _up.set(0, 1, 0).applyQuaternion(p.root.quaternion);
  for (let k = 0; k <= 4; k++) {
    if (boxHit(v.position.x, v.position.z, heading, hw + UNGHOST_MARGIN, hl + UNGHOST_MARGIN, at.x + up.x * h * k / 4, at.z + up.z * h * k / 4, def.reach)) return true;
  }
  return false;
}

/**
 * Pure: the spin (rad/s, about the world's axes) that tips a heavy prop `height` m tall over away from a vehicle that
 * struck it at `speed` m/s along (nx, nz) (from the vehicle to it): about the level axis square to the blow, its top
 * going the way of the blow
 */
function toppleSpin(nx: number, nz: number, speed: number, height: number): [number, number, number] {
  const w = TOPPLE * speed / Math.max(1, height);
  return [nz * w, 0, -nx * w];
}

/**
 * The street furniture vehicles knock over, as bodies in Jolt (`physics`: player/car-physics.ts's world, through
 * setPhysics). `props`: [{ kind ('cobra' | 'post' | 'sign' | 'hydrant' | 'bin'), x, z, yaw, ground (the height its
 * stand-in stands at), base (the ground's height under it), parts: [{ mesh, index }], light?, look?, collider? }], the
 * parts being the prop's instances in the static InstancedMeshes (see street-details.ts; scene-culling.ts may have
 * split them into chunks, recorded in mesh.userData.chunked). `looks` gives each kind's stand-in: { [kind]: [{
 * geometry, material, matrix? }] } in the prop's own frame; a prop's own `look` overrides its kind's. Near the
 * player's vehicle a prop stands in Jolt as a static body; struck harder than its kind breaks at, it comes loose (a
 * dynamic body: Jolt trades the momentum, the vehicle slowed as much as the prop's weight takes) and its stand-in
 * follows it until it lies still, where it stays: static again, in the way of what drives into it slowly, knocked on
 * by what hits it hard.
 */
class PropBreaker {
  props: Prop[];
  looks: PropLooks;
  cells: Map<number, Prop[]>;
  anchored: Set<Prop>;
  /** Heavy props snapped (snap), still in the debris layer: through the car till they lie clear of it (unghost) */
  snapped: Set<Prop>;
  loose: Set<Prop>;
  listener: ((e: PropImpact) => void) | null;
  physics: PropPhysics | null;
  jolt: PropJolt | null;
  groundAt?: ((x: number, z: number) => number) | null;
  event: PropImpact;
  group: THREE.Group;
  jetGeo: THREE.CylinderGeometry;
  jetMat: THREE.MeshStandardNodeMaterial;
  jets: Jet[];

  constructor(scene: THREE.Object3D, props: BreakableProp[], looks: PropLooks) {
    this.props = [];
    this.looks = looks;
    this.cells = new Map();
    this.anchored = new Set(); // props in Jolt as static bodies: standing, or lying where they came to rest
    this.loose = new Set(); // ...and flying, rolling (dynamic)
    this.snapped = new Set();
    this.listener = null;
    this.physics = null;
    this.jolt = null;
    this.event = { a: null, b: null, kind: 'prop', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
    this.group = new THREE.Group();
    this.group.name = 'KnockedProps';
    scene.add(this.group);
    this.addProps(props);
    const jetMat = new THREE.MeshStandardNodeMaterial({ color: 0xcfe8ff, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.55 });
    this.jetGeo = new THREE.CylinderGeometry(0.05, 0.35, 1, 10, 1, true).translate(0, 0.5, 0);
    this.jetMat = jetMat;
    this.jets = [];
  }

  key(ix: number, iz: number): number {
    return ix * 100003 + iz;
  }

  /** More breakable props (the corners' sign posts, built once the road network exists) */
  addProps(props: BreakableProp[]): void {
    for (const b of props) {
      // 'up' (its instance drawn) | 'loose' | 'down' (lying still); in Jolt (`body`) while near
      const p: Prop = Object.assign(b, {
        state: 'up' as const, body: null, root: null, floor: null, gx: NaN, gy: NaN, gz: NaN, still: 0, age: 0, speed: NaN
      });
      this.props.push(p);
      const k = this.key(Math.floor(p.x / 16), Math.floor(p.z / 16));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(p);
    }
  }

  setCollisionListener(fn: ((e: PropImpact) => void) | null): void {
    this.listener = typeof fn === 'function' ? fn : null;
  }

  // The ground's height at (x, z) (ground.ts), for the player's height over it
  setGroundQuery(fn: ((x: number, z: number) => number) | null): void {
    this.groundAt = typeof fn === 'function' ? fn : null;
  }

  /** Jolt's world (player/car-physics.ts createCarPhysics), where the props stand & fall */
  setPhysics(physics: PropPhysics): void {
    this.physics = physics;
    const { Jolt } = physics.world;
    this.jolt = {
      world: physics.world,
      tmpV: new Jolt.Vec3(0, 0, 0),
      tmpR: new Jolt.RVec3(0, 0, 0),
      tmpQ: new Jolt.Quat(0, 0, 0, 1),
      shapes: new Map() // (one shape a body, shared by the props of that kind or size)
    };
    physics.addSystem(this);
  }

  // Jolt, once setPhysics has handed it over (the props only enter it from then on)
  j(): PropJolt {
    if (!this.jolt) throw new Error('[mayhem] no Jolt world yet (setPhysics)');
    return this.jolt;
  }

  /**
   * Per frame, after the vehicles moved (controllers.ts): the props near the player's vehicle stand in Jolt, and those
   * it is about to strike hard enough come loose; then the jets of water
   */
  update(dt: number, entity: KnockingEntity | null | undefined, mode: string): void {
    if (this.physics && entity) {
      // (those in Jolt the player has left behind leave it)
      for (const p of this.anchored) {
        const at = p.root ? p.root.position : p;
        if (Math.hypot(at.x - entity.position.x, at.z - entity.position.z) > STAND_DROP) this.sit(p);
      }
      if (mode === 'car' || mode === 'cyclist' || mode === 'moto') this.near(entity, mode);
      this.unghost(entity, mode);
    }
    this.spray(dt);
  }

  near(entity: KnockingEntity, mode: string): void {
    const over = entity.position.y - (this.groundAt ? this.groundAt(entity.position.x, entity.position.z) : 0);
    const heading = entity.heading || 0;
    const sn = Math.sin(heading), cs = Math.cos(heading);
    const vx = sn * (entity.speed || 0) + (entity.vx || 0);
    const vz = cs * (entity.speed || 0) + (entity.vz || 0);
    const hw = mode === 'car' ? entity.halfW || 0.9 : 0.35;
    const hl = mode === 'car' ? entity.halfL || 2.25 : 1.0;
    const x = entity.position.x, z = entity.position.z;
    // (its box stretched ahead by where it will be in a moment)
    const ahead = Math.hypot(vx, vz) * LOOKAHEAD;
    const ix = Math.floor(x / 16), iz = Math.floor(z / 16);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = this.cells.get(this.key(ix + a, iz + b));
        if (!list) continue;
        for (const p of list) {
          if (p.state === 'loose' || this.snapped.has(p)) continue; // (one snapped lies through the car: unghost)
          // (one lying down, where it came to rest)
          const at = p.root ? p.root.position : p;
          const body = bodyOf(p);
          if (!boxHit(x, z, heading, hw + STAND_REACH, hl + STAND_REACH, at.x, at.z, body.reach)) continue;
          if (!p.body) this.stand(p);
          // about to be struck: hard enough, it breaks loose (and Jolt's contact then trades the momentum). One lying
          // down is struck anywhere along its length: its foot, its middle, its top
          if (over > 1.5) continue;
          const cx = x + vx * LOOKAHEAD / 2, cz = z + vz * LOOKAHEAD / 2, l = hl + ahead / 2;
          let hit = boxHit(cx, cz, heading, hw, l, at.x, at.z, body.reach);
          if (!hit && p.root) {
            const up = _up.set(0, 1, 0).applyQuaternion(p.root.quaternion), h = body.cyl[1];
            for (let k = 1; k <= 2 && !hit; k++) hit = boxHit(cx, cz, heading, hw, l, at.x + up.x * h * k / 2, at.z + up.z * h * k / 2, body.reach);
          }
          // (a heavy one gives to a car only: against it a bicycle or a moto just stops)
          if (hit && closingSpeed(vx, vz, hit.nx, hit.nz) > body.breakAt && (!body.heavy || mode === 'car')) this.knock(p, vx, vz, hit, entity);
        }
      }
    }
  }

  // A body's shape: its cylinder from its base and its boxes (held for good)
  shapeOf(def: PropBody): Jolt.Shape {
    const jolt = this.j();
    const held = jolt.shapes.get(def);
    if (held) return held;
    const { Jolt } = jolt.world;
    const compound = new Jolt.StaticCompoundShapeSettings();
    jolt.tmpQ.Set(0, 0, 0, 1);
    const [r, h] = def.cyl;
    compound.AddShape(this.vec(0, h / 2, 0), jolt.tmpQ, new Jolt.CylinderShapeSettings(h / 2, r, Math.min(0.05, r * 0.5)), 0);
    for (const [bx, by, bz, hx, hy, hz] of def.boxes) {
      const half = new Jolt.Vec3(hx, hy, hz);
      compound.AddShape(this.vec(bx, by, bz), jolt.tmpQ, new Jolt.BoxShapeSettings(half, Math.min(0.02, hx, hy, hz)), 0);
      Jolt.destroy(half);
    }
    const result = compound.Create();
    const shape = result.Get();
    shape.AddRef();
    Jolt.destroy(result);
    Jolt.destroy(compound);
    jolt.shapes.set(def, shape);
    return shape;
  }

  vec(x: number, y: number, z: number): Jolt.Vec3 {
    const { tmpV } = this.j();
    tmpV.Set(x, y, z);
    return tmpV;
  }

  // Prop p into Jolt, static (anchored) where it stands or lies, ready to come loose (its wall out of it meanwhile)
  stand(p: Prop): void {
    const { world: { Jolt, bodies, layers, firm, dropWall }, tmpR, tmpQ } = this.j();
    if (p.collider && !p.collider.broken) {
      p.collider.held = true;
      dropWall(p.collider);
    }
    if (p.root) {
      const { position: at, quaternion: q } = p.root;
      tmpR.Set(at.x, at.y, at.z);
      tmpQ.Set(q.x, q.y, q.z, q.w);
    } else {
      const yaw = p.yaw || 0;
      tmpR.Set(p.x, p.ground, p.z); // (its stand-in's origin: on its plinth, if it has one)
      tmpQ.Set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    }
    const def = bodyOf(p);
    const bcs = new Jolt.BodyCreationSettings(this.shapeOf(def), tmpR, tmpQ, Jolt.EMotionType_Static, layers.ragdoll);
    bcs.mAllowDynamicOrKinematic = true;
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = def.mass;
    bcs.mFriction = 0.6;
    bcs.mRestitution = 0.2;
    bcs.mLinearDamping = 0.1;
    bcs.mAngularDamping = 0.2;
    p.body = bodies.CreateBody(bcs);
    Jolt.destroy(bcs);
    // (a heavy one is a wall to a car till it snaps: the crash is the car physics', knock()'s once it gives)
    if (def.heavy) p.body.SetUserData(firm);
    bodies.AddBody(p.body.GetID(), Jolt.EActivation_DontActivate);
    this.anchored.add(p);
  }

  // ...and out of it again, standing or lying where it is (the player has driven on): a wall again, if it stands
  sit(p: Prop): void {
    if (p.body) this.j().world.dropBody(p.body);
    p.body = null;
    if (p.collider) p.collider.held = false;
    this.anchored.delete(p);
    this.snapped.delete(p);
  }

  // Prop p about to be struck by `entity`, moving at (vx, vz), along `hit` (from the vehicle to it): loose in Jolt, its
  // instance hidden and its stand-in following it the first time (a hydrant's main gushes, a lamp goes out); a heavy
  // one standing tips over ahead of the vehicle
  knock(p: Prop, vx: number, vz: number, hit: BoxContact, entity: KnockingEntity): void {
    const { Jolt, bodies } = this.j().world;
    const pb = p.body;
    if (!pb) return; // (near() stood it in Jolt first)
    this.anchored.delete(p);
    const first = p.state === 'up';
    const def = bodyOf(p);
    const speed = closingSpeed(vx, vz, hit.nx, hit.nz);
    p.state = 'loose';
    p.still = 0;
    p.age = 0;
    bodies.SetMotionType(pb.GetID(), Jolt.EMotionType_Dynamic, Jolt.EActivation_Activate);
    pb.SetUserData(0); // (loose: knock() tells this crash, the car's contacts no more)
    if (def.heavy && first) this.snap(p, pb, def, hit, speed, entity);
    this.loose.add(p);
    // too many flying about: the stillest lies where it is
    if (this.loose.size > MAX_LOOSE) {
      let stillest: Prop | null = null;
      for (const q of this.loose) if (q !== p && (!stillest || q.speed < stillest.speed)) stillest = q;
      if (stillest) this.freeze(stillest);
    }
    if (this.listener) {
      const e = this.event;
      e.a = def.heavy ? entity : p;
      e.b = def.heavy ? p : p.parts.at(0)?.mesh ?? p;
      const at = p.root ? p.root.position : p;
      e.x = at.x; e.y = 1.0 + (p.base || 0); e.z = at.z;
      e.nx = -hit.nx; e.nz = -hit.nz;
      e.speed = Math.min(speed, def.heavy ? HEAVY_IMPACT : p.kind === 'hydrant' ? 6 : 12);
      this.listener(e);
    }
    if (!first) return;
    if (p.light) p.light.broken = true;
    if (p.collider) p.collider.broken = true;
    for (const part of p.parts) hideInstance(part.mesh, part.index);
    p.onBreak?.();
    // the stand-in, in the prop's own frame
    const root = new THREE.Group();
    if (p.standIn) root.add(p.standIn());
    else {
      for (const { geometry, material, matrix } of p.look ?? this.looks[p.kind] ?? []) {
        const m = new THREE.Mesh(geometry, material);
        if (matrix) m.applyMatrix4(matrix);
        m.castShadow = true;
        root.add(m);
      }
    }
    this.group.add(root);
    p.root = root;
    this.follow(p);
    if (p.kind === 'hydrant') {
      const jet = new THREE.Mesh(this.jetGeo, this.jetMat);
      jet.position.set(p.x, (p.ground || 0) + 0.2, p.z);
      jet.scale.set(1, 7, 1);
      this.group.add(jet);
      this.jets.push({ mesh: jet, age: 0 });
    }
  }

  // Heavy prop body `pb` snapped by `entity`, struck at `speed` along `hit`: it falls ahead of the car, through it,
  // turning over its foot, and the car is slowed by what it gave it (TOPPLE)
  snap(p: Prop, pb: Jolt.Body, def: PropBody, hit: BoxContact, speed: number, entity: KnockingEntity): void {
    const { bodies, layers } = this.j().world;
    const id = pb.GetID();
    bodies.SetObjectLayer(id, layers.debris);
    this.snapped.add(p);
    p.snappedBy = entity;
    const [wx, wy, wz] = toppleSpin(hit.nx, hit.nz, speed, def.cyl[1]);
    // (its centre of mass swung forward about its foot, the foot itself carried on a little)
    const com = pb.GetCenterOfMassPosition().GetY() - pb.GetPosition().GetY();
    const ahead = speed * SNAP_CARRY + Math.hypot(wx, wz) * com;
    bodies.SetLinearVelocity(id, this.vec(hit.nx * ahead, 0, hit.nz * ahead));
    bodies.SetAngularVelocity(id, this.vec(wx, wy, wz));
    const car = entity.vehicle?.body;
    if (!car) return;
    const inverse = car.GetMotionProperties().GetInverseMass();
    if (!(inverse > 0)) return;
    const loss = speed * def.mass / (def.mass + 1 / inverse);
    const v = car.GetLinearVelocity();
    const vx = v.GetX() - hit.nx * loss, vy = v.GetY(), vz = v.GetZ() - hit.nz * loss;
    bodies.SetLinearVelocity(car.GetID(), this.vec(vx, vy, vz));
  }

  // The snapped props lying still and clear of the player's vehicle back in the way of what drives into them (out of
  // the debris layer): one still across the car would be inside a body that meets it, and Jolt would throw the car out
  unghost(entity: KnockingEntity, mode: string): void {
    if (!this.snapped.size) return;
    const { bodies, layers } = this.j().world;
    const vehicle = mode === 'car' || mode === 'cyclist' || mode === 'moto';
    for (const p of this.snapped) {
      if (!p.body) {
        this.snapped.delete(p);
        continue;
      }
      if (p.state !== 'down' || !p.root) continue;
      // (still through the car that snapped it, even parked with the player out of it on foot, or through what the
      // player rides now)
      const by = p.snappedBy;
      if (by && lyingThrough(p, by, by.halfW || 0.9, by.halfL || 2.25)) continue;
      if (vehicle && entity !== by && lyingThrough(p, entity, mode === 'car' ? entity.halfW || 0.9 : 0.35, mode === 'car' ? entity.halfL || 2.25 : 1.0)) continue;
      bodies.SetObjectLayer(p.body.GetID(), layers.ragdoll);
      this.snapped.delete(p);
      p.snappedBy = null;
    }
  }

  // Its stand-in where its body is
  follow(p: Prop): void {
    if (!p.body || !p.root) return;
    const pos = p.body.GetPosition(), q = p.body.GetRotation();
    p.root.position.set(pos.GetX(), pos.GetY(), pos.GetZ());
    p.root.quaternion.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
  }

  // A loose prop come to rest (or one too many): static where it lies (still in the way of what drives into it, till
  // the player has left it behind: sit), its stand-in lying there
  freeze(p: Prop): void {
    const { Jolt, bodies, dropBody } = this.j().world;
    if (p.floor) dropBody(p.floor);
    p.floor = null;
    if (p.body) bodies.SetMotionType(p.body.GetID(), Jolt.EMotionType_Static, Jolt.EActivation_DontActivate);
    p.state = 'down';
    this.loose.delete(p);
    this.anchored.add(p);
  }

  // The props flying about out past `far` m from `focus` (the player), for the walls fed round them (car-physics.ts)
  foci(out: THREE.Vector3[], focus: { x: number; z: number }, far: number): void {
    for (const p of this.loose) {
      if (p.root && Math.hypot(p.root.position.x - focus.x, p.root.position.z - focus.z) > far) out.push(p.root.position);
    }
  }

  // Jolt's systems (car-physics.ts addSystem): before each step, the ground under each loose prop (its `floor`)
  before(): void {
    for (const p of this.loose) {
      if (!p.body) continue;
      const pos = p.body.GetPosition();
      const x = pos.GetX(), y = pos.GetY(), z = pos.GetZ();
      if (p.floor && Math.hypot(x - p.gx, z - p.gz) < 5 && Math.abs(y - p.gy) < 3) continue;
      p.floor = this.j().world.groundField(p.floor, x, z, y + 1, PROP_GROUND, 1);
      p.gx = x; p.gz = z; p.gy = y;
    }
  }

  // ...after it: the stand-ins follow, and those lying still (or for too long) freeze
  after(dt: number): void {
    for (const p of this.loose) {
      if (!p.body) continue;
      this.follow(p);
      const v = p.body.GetLinearVelocity();
      p.speed = Math.hypot(v.GetX(), v.GetY(), v.GetZ());
      const w = p.body.GetAngularVelocity();
      const spin = Math.hypot(w.GetX(), w.GetY(), w.GetZ());
      p.still = p.speed < SETTLE_SPEED && spin < 0.3 ? p.still + dt : 0;
      p.age += dt;
      if (p.still > SETTLE_TIME || p.age > MAX_LOOSE_TIME) this.freeze(p);
    }
  }

  // A broken hydrant's jet: flickering, then running dry after ~40 s
  spray(dt: number): void {
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.age += dt;
      const flick = 1 + Math.sin(j.age * 31) * 0.06 + Math.sin(j.age * 17.3) * 0.05;
      const fade = Math.max(0, Math.min(1, (40 - j.age) / 6));
      j.mesh.scale.set(flick * fade + 0.001, (7 + Math.sin(j.age * 9) * 0.6) * fade + 0.001, flick * fade + 0.001);
      if (fade > 0) continue;
      this.group.remove(j.mesh);
      this.jets.splice(i, 1);
    }
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

// Shows instance `index` of a static InstancedMesh again at `matrix` (its own, hideInstance's undone), wherever
// scene-culling.ts moved it
function showInstance(mesh: HideableMesh, index: number, matrix: { elements: ArrayLike<number> }): void {
  let target: HideableMesh | undefined = mesh;
  let j = index;
  const ch = mesh.userData?.chunked;
  if (ch) {
    target = ch.chunks[ch.where[index * 2]];
    j = ch.where[index * 2 + 1];
  }
  if (!target || j < 0) return;
  const attr = target.instanceMatrix;
  attr.array.set(matrix.elements, j * 16);
  if (attr.addUpdateRange) attr.addUpdateRange(j * 16, 16);
  attr.needsUpdate = true;
}

export type {
  BoxContact, Sliding, SolidQuery, PropKind, PropBody, HideableMesh, PropPart, PropCollider, BreakableProp, PropState, Prop,
  PropLook, PropLooks, PropImpact, KnockingEntity, PropPhysics, PropJolt, Jet
};
export { boxHit, riderKnocked, slide, closingSpeed, toppleSpin, bodyOf, hideInstance, showInstance, PropBreaker, PROP_BODIES };
