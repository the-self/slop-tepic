import * as THREE from 'three/webgpu';

// js/sim/mayhem.js
// Knock-downs for the player's vehicles: who is hit (pedestrians, cyclists, motorcyclists; thrown as ragdolls,
// sim/ragdolls.js), and the street furniture (lamp posts, sign posts, hydrants, bins) knocked loose as bodies in Jolt
// (player/car-physics.js's world). Pure helpers (tested in tests/mayhem.test.cjs) plus the props' breaker, which hides
// a prop's static instances and lets a stand-in fall, roll and come to rest in its place.

/**
 * Does a body of radius `r` at (x, z) touch the player's box (centre px, pz, facing `heading`, half width hw, half
 * length hl)? Returns the contact's direction away from the player's centre, or null.
 */
function boxHit(px, pz, heading, hw, hl, x, z, r) {
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
function riderKnocked(mode, rvx, rvz, nx, nz, minSpeed) {
  if (mode !== 'car' && mode !== 'cyclist') return false;
  const closing = rvx * nx + rvz * nz;
  const slide = Math.hypot(rvx - closing * nx, rvz - closing * nz);
  return closing > minSpeed || slide > minSpeed * 2.5;
}

// Moves o.px, o.pz by (dx, dz) unless that enters a wall, in which case its horizontal velocity bounces back softly
function slide(o, dx, dz, solidAt) {
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
// hydrant, bolted to its main; a bin, standing loose
const PROP_BODIES = {
  cobra: { mass: 140, cyl: [0.12, 8.4], boxes: [[1.15, 8.1, 0, 1.15, 0.05, 0.05]], breakAt: 4, reach: 0.15 },
  post: { mass: 55, cyl: [0.09, 3.9], boxes: [], breakAt: 3, reach: 0.15 },
  sign: { mass: 16, cyl: [0.04, 2.8], boxes: [[0.48, 2.62, 0, 0.46, 0.11, 0.015]], breakAt: 2.5, reach: 0.1 },
  hydrant: { mass: 90, cyl: [0.24, 0.85], boxes: [], breakAt: 3, reach: 0.25 },
  bin: { mass: 11, cyl: [0.24, 0.92], boxes: [], breakAt: 0.8, reach: 0.25 }
};
const _up = new THREE.Vector3();
const MAX_LOOSE = 20; // props flying & rolling at once: past that the stillest one lies where it is, out of Jolt
const SETTLE_SPEED = 0.15; // m/s (and 0.3 rad/s) a loose prop lies still under...
const SETTLE_TIME = 1.2; // ...this long before it freezes
const MAX_LOOSE_TIME = 20; // s after which one still rocking freezes anyway
const STAND_REACH = 6; // m round a vehicle's box the props near it stand in Jolt (a slow push meets them)...
const STAND_DROP = 12; // ...and past which they leave it again
const LOOKAHEAD = 0.06; // s of a vehicle's motion its box is stretched by: a prop it is about to strike comes loose first
const PROP_GROUND = 16; // samples of the ground under a loose prop, 1 m apart, sampled again once it is 5 m off

/** Pure: the speed (m/s) a vehicle moving at (vx, vz) closes on a prop that lies along (nx, nz) from it */
function closingSpeed(vx, vz, nx, nz) {
  return Math.max(0, vx * nx + vz * nz);
}

/**
 * The street furniture vehicles knock over, as bodies in Jolt (`physics`: player/car-physics.js's world, through
 * setPhysics). `props`: [{ kind ('cobra' | 'post' | 'sign' | 'hydrant' | 'bin'), x, z, yaw, ground (the height its
 * stand-in stands at), base (the ground's height under it), parts: [{ mesh, index }], light?, look?, collider? }], the
 * parts being the prop's instances in the static InstancedMeshes (see street-details.js; scene-culling.js may have
 * split them into chunks, recorded in mesh.userData.chunked). `looks` gives each kind's stand-in: { [kind]: [{
 * geometry, material, matrix? }] } in the prop's own frame; a prop's own `look` overrides its kind's. Near the
 * player's vehicle a prop stands in Jolt as a static body; struck harder than its kind breaks at, it comes loose (a
 * dynamic body: Jolt trades the momentum, the vehicle slowed as much as the prop's weight takes) and its stand-in
 * follows it until it lies still, where it stays: static again, in the way of what drives into it slowly, knocked on
 * by what hits it hard.
 */
class PropBreaker {
  constructor(scene, props, looks) {
    this.props = [];
    this.looks = looks;
    this.cells = new Map();
    this.anchored = new Set(); // props in Jolt as static bodies: standing, or lying where they came to rest
    this.loose = new Set(); // ...and flying, rolling (dynamic)
    this.listener = null;
    this.physics = null;
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

  key(ix, iz) {
    return ix * 100003 + iz;
  }

  /** More breakable props (the corners' sign posts, built once the road network exists) */
  addProps(props) {
    for (const p of props) {
      p.state = 'up'; // 'up' (its instance drawn) | 'loose' | 'down' (lying still); in Jolt (`body`) while near
      this.props.push(p);
      const k = this.key(Math.floor(p.x / 16), Math.floor(p.z / 16));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(p);
    }
  }

  setCollisionListener(fn) {
    this.listener = typeof fn === 'function' ? fn : null;
  }

  // The ground's height at (x, z) (ground.js), for the player's height over it
  setGroundQuery(fn) {
    this.groundAt = typeof fn === 'function' ? fn : null;
  }

  /** Jolt's world (player/car-physics.js createCarPhysics), where the props stand & fall */
  setPhysics(physics) {
    this.physics = physics;
    const { Jolt } = physics.world;
    this.tmpV = new Jolt.Vec3(0, 0, 0);
    this.tmpR = new Jolt.RVec3(0, 0, 0);
    this.tmpQ = new Jolt.Quat(0, 0, 0, 1);
    this.shapes = {}; // (one shape a kind, shared by its bodies)
    physics.addSystem(this);
  }

  /**
   * Per frame, after the vehicles moved (controllers.js): the props near the player's vehicle stand in Jolt, and those
   * it is about to strike hard enough come loose; then the jets of water
   */
  update(dt, entity, mode) {
    if (this.physics && entity) {
      // (those in Jolt the player has left behind leave it)
      for (const p of this.anchored) {
        const at = p.root ? p.root.position : p;
        if (Math.hypot(at.x - entity.position.x, at.z - entity.position.z) > STAND_DROP) this.sit(p);
      }
      if (mode === 'car' || mode === 'cyclist' || mode === 'moto') this.near(entity, mode);
    }
    this.spray(dt);
  }

  near(entity, mode) {
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
          if (p.state === 'loose') continue;
          // (one lying down, where it came to rest)
          const at = p.root ? p.root.position : p;
          const body = PROP_BODIES[p.kind];
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
          if (hit && closingSpeed(vx, vz, hit.nx, hit.nz) > body.breakAt) this.knock(p, vx, vz, hit);
        }
      }
    }
  }

  // The kind's body shape: its cylinder from its base and its boxes (held for good)
  shapeOf(kind) {
    if (this.shapes[kind]) return this.shapes[kind];
    const { Jolt } = this.physics.world;
    const def = PROP_BODIES[kind];
    const compound = new Jolt.StaticCompoundShapeSettings();
    this.tmpQ.Set(0, 0, 0, 1);
    const [r, h] = def.cyl;
    compound.AddShape(this.vec(0, h / 2, 0), this.tmpQ, new Jolt.CylinderShapeSettings(h / 2, r, Math.min(0.05, r * 0.5)), 0);
    for (const [bx, by, bz, hx, hy, hz] of def.boxes) {
      const half = new Jolt.Vec3(hx, hy, hz);
      compound.AddShape(this.vec(bx, by, bz), this.tmpQ, new Jolt.BoxShapeSettings(half, Math.min(0.02, hx, hy, hz)), 0);
      Jolt.destroy(half);
    }
    const result = compound.Create();
    const shape = result.Get();
    shape.AddRef();
    Jolt.destroy(result);
    Jolt.destroy(compound);
    return (this.shapes[kind] = shape);
  }

  vec(x, y, z) {
    this.tmpV.Set(x, y, z);
    return this.tmpV;
  }

  // Prop p into Jolt, static (anchored) where it stands or lies, ready to come loose
  stand(p) {
    const { Jolt, bodies, layers } = this.physics.world;
    if (p.root) {
      const { position: at, quaternion: q } = p.root;
      this.tmpR.Set(at.x, at.y, at.z);
      this.tmpQ.Set(q.x, q.y, q.z, q.w);
    } else {
      const yaw = p.yaw || 0;
      this.tmpR.Set(p.x, p.ground ?? p.base ?? 0, p.z); // (its stand-in's origin: on its plinth, if it has one)
      this.tmpQ.Set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    }
    const bcs = new Jolt.BodyCreationSettings(this.shapeOf(p.kind), this.tmpR, this.tmpQ, Jolt.EMotionType_Static, layers.ragdoll);
    bcs.mAllowDynamicOrKinematic = true;
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = PROP_BODIES[p.kind].mass;
    bcs.mFriction = 0.6;
    bcs.mRestitution = 0.2;
    bcs.mLinearDamping = 0.1;
    bcs.mAngularDamping = 0.2;
    p.body = bodies.CreateBody(bcs);
    Jolt.destroy(bcs);
    bodies.AddBody(p.body.GetID(), Jolt.EActivation_DontActivate);
    this.anchored.add(p);
  }

  // ...and out of it again, standing or lying where it is (the player has driven on)
  sit(p) {
    this.physics.world.dropBody(p.body);
    p.body = null;
    this.anchored.delete(p);
  }

  // Prop p about to be struck by a vehicle moving at (vx, vz), along `hit` (from the vehicle to it): loose in Jolt, its
  // instance hidden and its stand-in following it the first time (a hydrant's main gushes, a lamp goes out)
  knock(p, vx, vz, hit) {
    const { Jolt, bodies } = this.physics.world;
    this.anchored.delete(p);
    const first = p.state === 'up';
    p.state = 'loose';
    p.still = 0;
    p.age = 0;
    bodies.SetMotionType(p.body.GetID(), Jolt.EMotionType_Dynamic, Jolt.EActivation_Activate);
    this.loose.add(p);
    // too many flying about: the stillest lies where it is
    if (this.loose.size > MAX_LOOSE) {
      let stillest = null;
      for (const q of this.loose) if (q !== p && (!stillest || q.speed < stillest.speed)) stillest = q;
      if (stillest) this.freeze(stillest);
    }
    if (this.listener) {
      const e = this.event;
      e.a = p;
      e.b = p.parts[0]?.mesh || p;
      const at = p.root ? p.root.position : p;
      e.x = at.x; e.y = 1.0 + (p.base || 0); e.z = at.z;
      e.nx = -hit.nx; e.nz = -hit.nz;
      e.speed = Math.min(closingSpeed(vx, vz, hit.nx, hit.nz), p.kind === 'hydrant' ? 6 : 12);
      this.listener(e);
    }
    if (!first) return;
    if (p.light) p.light.broken = true;
    if (p.collider) p.collider.broken = true;
    for (const part of p.parts) hideInstance(part.mesh, part.index);
    p.onBreak?.();
    // the stand-in, in the prop's own frame
    const root = new THREE.Group();
    for (const { geometry, material, matrix } of p.look || this.looks[p.kind] || []) {
      const m = new THREE.Mesh(geometry, material);
      if (matrix) m.applyMatrix4(matrix);
      m.castShadow = true;
      root.add(m);
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

  // Its stand-in where its body is
  follow(p) {
    const pos = p.body.GetPosition(), q = p.body.GetRotation();
    p.root.position.set(pos.GetX(), pos.GetY(), pos.GetZ());
    p.root.quaternion.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
  }

  // A loose prop come to rest (or one too many): static where it lies (still in the way of what drives into it, till
  // the player has left it behind: sit), its stand-in lying there
  freeze(p) {
    const { Jolt, bodies, dropBody } = this.physics.world;
    if (p.floor) dropBody(p.floor);
    p.floor = null;
    bodies.SetMotionType(p.body.GetID(), Jolt.EMotionType_Static, Jolt.EActivation_DontActivate);
    p.state = 'down';
    this.loose.delete(p);
    this.anchored.add(p);
  }

  // The props flying about out past `far` m from `focus` (the player), for the walls fed round them (car-physics.js)
  foci(out, focus, far) {
    for (const p of this.loose) {
      if (Math.hypot(p.root.position.x - focus.x, p.root.position.z - focus.z) > far) out.push(p.root.position);
    }
  }

  // Jolt's systems (car-physics.js addSystem): before each step, the ground under each loose prop (its `floor`)
  before() {
    for (const p of this.loose) {
      const pos = p.body.GetPosition();
      const x = pos.GetX(), y = pos.GetY(), z = pos.GetZ();
      if (p.floor && Math.hypot(x - p.gx, z - p.gz) < 5 && Math.abs(y - p.gy) < 3) continue;
      p.floor = this.physics.world.groundField(p.floor, x, z, y + 1, PROP_GROUND, 1);
      p.gx = x; p.gz = z; p.gy = y;
    }
  }

  // ...after it: the stand-ins follow, and those lying still (or for too long) freeze
  after(dt) {
    for (const p of this.loose) {
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
  spray(dt) {
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

// Hides instance `index` of a static InstancedMesh, wherever scene-culling.js moved it (mesh.userData.chunked)
function hideInstance(mesh, index) {
  let target = mesh;
  let j = index;
  const ch = mesh.userData && mesh.userData.chunked;
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

export { boxHit, riderKnocked, slide, closingSpeed, hideInstance, PropBreaker, PROP_BODIES };
