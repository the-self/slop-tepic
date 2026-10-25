// js/player/car-physics.js
// The player's vehicles as rigid bodies on sprung wheels in Jolt Physics (WASM, MIT; jolt-physics on jsDelivr): the car
// on four (or more), the moto and the bicycle on two (Jolt's MotorcycleController). Suspension travel and damping per
// wheel, anti-roll bars, a tyre model with slip curves for grip, the body's weight shifting under braking, power and
// cornering, and real contacts with the city: walls stop it and spin it, it flies off crests, lands on its springs and
// can roll over. A two-wheeler leans into its corners as far as they need (its rider balances it), lifts its front
// wheel when its drive outweighs the weight ahead of the rear axle, slides out under a locked rear wheel, and falls
// over once nobody rides it. Jolt drives nothing itself: the engine, gearbox, brakes and drag stay drivetrain.js's (its
// maker-calibrated 0-100 km/h, nitro, gears and revs; the bicycle's, its rider's legs), its force pushed through the
// tyres' contact patches, never more than each tyre's grip under the weight on it; Jolt's wheels roll free, and its
// handbrake locks the rear ones.
//
// The world a vehicle meets is the game's own, fed in around it as it moves (nothing city-wide is copied into Jolt):
// - the ground: a height field 32 m square under each vehicle, sampled from `groundAt(x, z, fromY)` at its level (so
//   the deck of a bridge it is on, or the channel under one it is down in), the kerbs included; rebuilt every 6 m (two
//   vehicles' fields overlap exactly, both on one grid: where they do, the ground is the same ground twice);
// - the walls: `collidersNear(x, z, r)`'s boxes (buildings, poles, parapets, parked cars) within 45 m of the player, as
//   static boxes, looked at again every 2 m.
// The traffic still shoves a vehicle itself (traffic.js collideWithPlayer, moving its position and velocity): the shove
// is carried over to the body on the next step (controllers.js).
// The same Jolt world holds the people thrown about as ragdolls (sim/ragdolls.js, through `world` and addSystem): they
// meet the vehicles, the walls, their ground and their own.
//
// Frame: as the game's (metres, y up), a vehicle's own +z ahead and +x its left, its origin on the ground under it at
// rest. Plain numbers and Jolt only, no three.js: node --test can run it with a local Jolt. Jolt's objects live on the
// WASM heap: the ones made here for a moment are reused (tmp*) or destroyed, never left to the garbage collector.

const LAYER_STATIC = 0; // the walls and the ground under the vehicles
const LAYER_MOVING = 1; // the vehicles
const LAYER_RAGDOLL = 2; // people's parts (sim/ragdolls.js)
const LAYER_RAGDOLL_GROUND = 3; // the ground under each of them, met by nothing else (a vehicle's wheels would find it
// too, a field on a coarser grid than their own)
const PATCH_CELL = 0.5; // m between the ground's samples
const PATCH_SAMPLES = 64; // per side: a 31.5 m square
const PATCH_RECENTRE = 6; // m a vehicle may move from its patch's centre before it is sampled again around it
const PATCH_RELEVEL = 1.2; // m up or down (a ramp onto a deck) before the patch is sampled again at its new level
const WALL_REACH = 45; // m around the player the walls are fed in from
const WALL_REFRESH = 2; // m the player moves between two looks at the walls around them
const STEP = 1 / 90; // s, Jolt's step (the frame is cut into as many)
const SPRING_HZ = 1.4; // the suspension's natural frequency (a road car's 1.2-1.8 Hz), unless the car says otherwise
const SPRING_DAMPING = 0.55;
const TRAVEL = 0.26; // m of suspension travel, unless a wheel says otherwise
const FLIP_RESCUE = 2.5; // s a car is on its roof or side, all but stopped, before it is set back on its wheels
const MAX_LEAN = 0.82; // rad a two-wheeler leans over at most (~47°: a street bike's tyres & pegs)
const LEAN_SPRING = 9; // its rider's hold on its lean, in what gravity topples it by (N·m a radian, per m·g·cg)...
const LEAN_DAMPING = 1.6; // ...and on its leaning over (per rad/s)
const YAW_HOLD = 0.4; // ...and on its swinging round on one wheel (per rad/s)
const STOPPIE = 0.2; // share of a moto's weight on its rear wheel under which its rider (its ABS) eases the brakes
const TURN_SMOOTHING = 0.1; // s over which the rider feels how hard the tyres push the moto across
const WHEELIE_FROM = 0.3; // rad of the moto's nose up where its rider starts to ease off the throttle...
const WHEELIE_TO = 0.6; // ...and where none is left (no looping it over backwards)
const WHEELIE_LEAD = 0.4; // s ahead the rider sees it coming
const WHEELIE_FAST = 16; // m/s (~60 km/h) from which the rider brings it down

/**
 * Pure: where the wheels attach and how far they hang, from their resting centres (local x, y = radius, z). A wheel's
 * `caster` (rad, a moto's fork raked back) slants its spring forwards & down; `travel` (m) is its own
 */
function wheelLayout(wheels, springHz = SPRING_HZ, gravity = 9.81) {
  const sag = gravity / (2 * Math.PI * springHz) ** 2; // static deflection under the vehicle's weight
  return wheels.map((w) => {
    const travel = w.travel ?? TRAVEL, caster = w.caster ?? 0;
    // the wheel hangs `travel` along its spring from the attachment point at full droop, and settles `sag` back up it
    // at rest, its centre then at (x, radius, z)
    const rest = travel - Math.min(sag, travel * 0.8);
    const dy = Math.cos(caster), dz = Math.sin(caster);
    return {
      x: w.x, z: w.z, radius: w.radius, front: w.front, left: w.x > 0, caster,
      attachY: w.radius + rest * dy, attachZ: w.z - rest * dz,
      dir: [0, -dy, dz], // the spring's direction, attachment to wheel
      minLength: Math.min(0.04, travel * 0.3),
      maxLength: travel
    };
  });
}

/**
 * Pure: the heading (rad, three.js's rotation.y: 0 facing +z) of a body whose own ahead is (fx, fy, fz) and up
 * (ux, uy, uz): its nose's direction on the ground or, pointing nearly straight down (up), where its roof (floor) faces.
 * Never the flip by π that reading it off its Euler angles gives as the nose passes the vertical
 */
function headingOf(fx, fy, fz, ux, uz) {
  if (Math.hypot(fx, fz) > 0.25) return Math.atan2(fx, fz);
  return fy < 0 ? Math.atan2(ux, uz) : Math.atan2(-ux, -uz);
}

/**
 * Pure: whether a force `force` (N, along the vehicle) on one moving at `forward` (m/s, along itself) drives it (on the
 * driven wheels: pulling away, speeding up, or backing) rather than slows it (on all of them: brakes, drag)
 */
function isDrive(force, forward) {
  return force !== 0 && (Math.abs(forward) < 0.3 || Math.sign(force) === Math.sign(forward));
}

/**
 * Pure: how much (0..1) of its drive a moto's rider keeps on with its nose `pitch` rad up (a wheelie) and coming up at
 * `rate` rad/s at `speed` m/s: all of it until where it will be in WHEELIE_LEAD s reaches WHEELIE_FROM, none from
 * WHEELIE_TO, so it rides the wheelie rather than looping over
 */
function wheelieThrottle(pitch, rate = 0, speed = 0) {
  // (and past WHEELIE_FAST m/s they bring it down: no wheelies at highway speed)
  const k = Math.max(0.2, Math.min(1, 1 - (speed - WHEELIE_FAST) / 8));
  const ahead = pitch + Math.max(0, rate) * WHEELIE_LEAD;
  return Math.max(0, Math.min(1, (WHEELIE_TO * k - ahead) / ((WHEELIE_TO - WHEELIE_FROM) * k)));
}

/**
 * Pure: a body's lean (rad, + over to its right, as three.js's rotation.z leans one facing +z) and pitch (rad, + nose
 * up) from its own ahead (fx, fy, fz) and up (ux, uy, uz)
 */
function leanAndPitch(fx, fy, fz, ux, uy, uz) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
  // its left, level: up × ahead with the world's up (0, 1, 0) → (fz, 0, -fx)
  const lx = fz, lz = -fx, l = Math.hypot(lx, lz) || 1;
  const left = (ux * lx + uz * lz) / l; // its up's lean towards its left
  const lean = Math.atan2(-left, uy);
  return { lean, pitch };
}

/**
 * The vehicles' physics in `Jolt` (an initialised jolt-physics module). `world`: { groundAt(x, z, fromY) → the height
 * of what a vehicle stands on there, collidersNear(x, z, r) → [{ minX, maxX, minZ, maxZ, minY?, maxY?, obb? }] }.
 */
function createCarPhysics(Jolt, world) {
  const settings = new Jolt.JoltSettings();
  const pairs = new Jolt.ObjectLayerPairFilterTable(4);
  pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING);
  pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  pairs.EnableCollision(LAYER_STATIC, LAYER_RAGDOLL);
  pairs.EnableCollision(LAYER_MOVING, LAYER_RAGDOLL);
  pairs.EnableCollision(LAYER_RAGDOLL, LAYER_RAGDOLL);
  pairs.EnableCollision(LAYER_RAGDOLL_GROUND, LAYER_RAGDOLL);
  // broad phase: what never moves, and what does
  const bp = new Jolt.BroadPhaseLayerInterfaceTable(4, 2);
  const still = new Jolt.BroadPhaseLayer(0), moving = new Jolt.BroadPhaseLayer(1);
  bp.MapObjectToBroadPhaseLayer(LAYER_STATIC, still);
  bp.MapObjectToBroadPhaseLayer(LAYER_RAGDOLL_GROUND, still);
  bp.MapObjectToBroadPhaseLayer(LAYER_MOVING, moving);
  bp.MapObjectToBroadPhaseLayer(LAYER_RAGDOLL, moving);
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bp;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, 4);
  settings.mMaxBodies = 4096;
  const jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const system = jolt.GetPhysicsSystem();
  const bodies = system.GetBodyInterface();

  // the scratch values every call below fills in (Jolt copies what it is given)
  const tmpV = new Jolt.Vec3(0, 0, 0);
  const tmpV2 = new Jolt.Vec3(0, 0, 0);
  const tmpR = new Jolt.RVec3(0, 0, 0);
  const tmpQ = new Jolt.Quat(0, 0, 0, 1);
  const vec = (x, y, z, v = tmpV) => { v.Set(x, y, z); return v; };
  const rvec = (x, y, z) => { tmpR.Set(x, y, z); return tmpR; };
  const yawQuat = (yaw) => { tmpQ.Set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)); return tmpQ; };
  system.SetGravity(vec(0, -9.81, 0));

  // What else lives in this world (sim/ragdolls.js): before(dt) each step, after(dt) once it has run
  const systems = [];
  const shared = {
    Jolt, system, bodies, groundAt: world.groundAt,
    layers: { ragdoll: LAYER_RAGDOLL, ragdollGround: LAYER_RAGDOLL_GROUND }
  };

  // ---- The ground -----------------------------------------------------------------------------------------------
  /**
   * A static body of ground `n` samples `cell` m apart a side round (cx, cz), sampled at level `fromY`, on `layer`; or
   * `body` given that shape anew. Returns the body
   */
  function groundField(body, cx, cz, fromY, n, cell, layer) {
    const s = new Jolt.HeightFieldShapeSettings();
    const x0 = Math.round(cx / cell) * cell - (n / 2) * cell;
    const z0 = Math.round(cz / cell) * cell - (n / 2) * cell;
    s.mOffset.Set(x0, 0, z0);
    s.mScale.Set(cell, 1, cell);
    s.mSampleCount = n;
    s.mBitsPerSample = 16;
    s.mHeightSamples.resize(n * n);
    const heights = new Float32Array(Jolt.HEAPF32.buffer, Jolt.getPointer(s.mHeightSamples.data()), n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = world.groundAt(x0 + i * cell, z0 + j * cell, fromY);
    }
    const result = s.Create();
    const shape = result.Get();
    Jolt.destroy(s);
    if (!body) {
      tmpQ.Set(0, 0, 0, 1);
      const bcs = new Jolt.BodyCreationSettings(shape, rvec(0, 0, 0), tmpQ, Jolt.EMotionType_Static, layer);
      bcs.mFriction = 1.0;
      body = bodies.CreateBody(bcs);
      Jolt.destroy(bcs);
      bodies.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
    } else {
      bodies.SetShape(body.GetID(), shape, false, Jolt.EActivation_DontActivate);
    }
    Jolt.destroy(result); // (the body holds the shape now)
    return body;
  }
  shared.groundField = (body, cx, cz, fromY, n, cell) => groundField(body, cx, cz, fromY, n, cell, LAYER_RAGDOLL_GROUND);
  const dropBody = (body) => {
    bodies.RemoveBody(body.GetID());
    bodies.DestroyBody(body.GetID());
  };
  shared.dropBody = dropBody;

  // The ground under vehicle `v`, sampled again once it has moved off its centre or changed level
  function keepPatch(v) {
    const o = v.out, p = v.patch;
    if (Math.hypot(o.x - p.cx, o.z - p.cz) < PATCH_RECENTRE && Math.abs(o.y - p.level) <= PATCH_RELEVEL) return;
    p.body = groundField(p.body, o.x, o.z, o.y, PATCH_SAMPLES, PATCH_CELL, LAYER_STATIC);
    p.cx = o.x;
    p.cz = o.z;
    p.level = o.y;
  }

  // ---- The walls ------------------------------------------------------------------------------------------------
  const walls = new Map(); // collider -> Body
  const fed = { x: NaN, z: NaN };
  let wallStamp = 0;
  function feedWalls(x, z, y) {
    const stamp = ++wallStamp;
    for (const c of world.collidersNear(x, z, WALL_REACH)) {
      // (a breakable prop's is its breaker's body, sim/mayhem.js)
      if (c.prop) continue;
      // (the list covers whole cells around (x, z): only what really comes within reach)
      const ox = Math.max(c.minX - x, 0, x - c.maxX), oz = Math.max(c.minZ - z, 0, z - c.maxZ);
      if (ox * ox + oz * oz > WALL_REACH * WALL_REACH) continue;
      let body = walls.get(c);
      if (!body) {
        const ground = world.groundAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, y);
        const minY = Number.isFinite(c.minY) ? c.minY : ground - 4;
        const maxY = Number.isFinite(c.maxY) ? Math.min(c.maxY, ground + 80) : ground + 60;
        if (maxY - minY < 0.05) continue;
        let hx, hz, cx, cz, yaw;
        if (c.obb) {
          ({ hx, hz, cx, cz } = c.obb);
          yaw = Math.atan2(c.obb.sn, c.obb.cs);
        } else {
          hx = (c.maxX - c.minX) / 2; hz = (c.maxZ - c.minZ) / 2;
          cx = (c.minX + c.maxX) / 2; cz = (c.minZ + c.maxZ) / 2;
          yaw = 0;
        }
        if (!(hx > 0.01 && hz > 0.01)) continue;
        const box = new Jolt.BoxShapeSettings(vec(hx, (maxY - minY) / 2, hz), Math.min(0.05, hx * 0.5, hz * 0.5));
        const result = box.Create();
        const bcs = new Jolt.BodyCreationSettings(result.Get(), rvec(cx, (minY + maxY) / 2, cz), yawQuat(yaw), Jolt.EMotionType_Static, LAYER_STATIC);
        bcs.mFriction = 0.35; // (scraping along a wall)
        bcs.mRestitution = 0.08;
        body = bodies.CreateBody(bcs);
        Jolt.destroy(bcs);
        Jolt.destroy(result);
        Jolt.destroy(box);
        bodies.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
        walls.set(c, body);
      }
      body._stamp = stamp;
    }
    for (const [c, body] of walls) {
      if (body._stamp === stamp) continue;
      dropBody(body);
      walls.delete(c);
    }
    fed.x = x;
    fed.z = z;
  }

  // ---- The vehicles ---------------------------------------------------------------------------------------------
  const vehicles = new Set();
  const byId = new Map(); // body id -> vehicle
  const drives = new Map(); // vehicle -> whether its force this step drives it (isDrive)

  // A hit on a vehicle's body itself (not on its tyres: a landing or a slide is no crash; nor someone thrown about, a
  // ragdoll's limb: knocking people down is mayhem.js's): the fastest approach into anything this step, and the normal
  // out of what it hit, kept in its `hit`
  const contacts = new Jolt.ContactListenerJS();
  contacts.OnContactValidate = () => Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
  contacts.OnContactAdded = (body1, body2, manifold) => {
    if (!byId.size) return;
    const b1 = Jolt.wrapPointer(body1, Jolt.Body), b2 = Jolt.wrapPointer(body2, Jolt.Body);
    if (b1.GetObjectLayer() === LAYER_RAGDOLL || b2.GetObjectLayer() === LAYER_RAGDOLL) return;
    const v1 = byId.get(b1.GetID().GetIndexAndSequenceNumber()), v2 = byId.get(b2.GetID().GetIndexAndSequenceNumber());
    if (!v1 && !v2) return;
    const n = Jolt.wrapPointer(manifold, Jolt.ContactManifold).mWorldSpaceNormal; // (from body 1 into body 2)
    const nx = n.GetX(), ny = n.GetY(), nz = n.GetZ();
    if (v1) noteHit(v1, v2, -nx, -ny, -nz);
    if (v2) noteHit(v2, v1, nx, ny, nz);
  };
  // Vehicle `v` touching `other` (a vehicle, or null: a wall, the ground), the normal (nx, ny, nz) out of it into `v`:
  // its approach, its own velocity into it less the other's
  function noteHit(v, other, nx, ny, nz) {
    // (a Vec3 returned by value is Jolt's scratch, the next call's: read before the other's)
    const a = v.body.GetLinearVelocity();
    let rx = a.GetX(), ry = a.GetY(), rz = a.GetZ();
    if (other) {
      const o = other.body.GetLinearVelocity();
      rx -= o.GetX(); ry -= o.GetY(); rz -= o.GetZ();
    }
    const approach = -(rx * nx + ry * ny + rz * nz);
    if (approach <= v.hit.speed) return;
    v.hit.speed = approach;
    v.hit.nx = nx; v.hit.ny = ny; v.hit.nz = nz;
    v.hit.other = other;
  }
  contacts.OnContactPersisted = () => {};
  contacts.OnContactRemoved = () => {};
  system.SetContactListener(contacts);

  /** Takes vehicle `v` out of the world */
  function remove(v) {
    if (!v || !vehicles.has(v)) return;
    system.RemoveStepListener(v.listener);
    system.RemoveConstraint(v.constraint);
    byId.delete(v.id);
    dropBody(v.body);
    if (v.patch.body) dropBody(v.patch.body);
    Jolt.destroy(v.listener);
    Jolt.destroy(v.tyres);
    for (const shape of v.shapes) shape.Release();
    vehicles.delete(v);
  }

  /** A box `half` (hx, hy, hz) centred at (x, y, z) in a compound's frame */
  function addBox(compound, x, y, z, hx, hy, hz) {
    tmpQ.Set(0, 0, 0, 1);
    // (the position in tmpV2: the box's half extents fill tmpV before AddShape is called)
    compound.AddShape(vec(x, y, z, tmpV2), tmpQ, new Jolt.BoxShapeSettings(vec(hx, hy, hz), Math.min(0.05, hx * 0.5, hy * 0.5, hz * 0.5)), 0);
  }

  /**
   * A compound shape of boxes ([x, y, z, hx, hy, hz]) held (AddRef), its centre of mass `cg` m over the floor and, given
   * `cgZ`, that far along it (a car's without: `cg` over its boxes' mid-height, as its springs were tuned)
   */
  function shapeOf(boxes, cg, cgZ = null) {
    const compound = new Jolt.StaticCompoundShapeSettings();
    let lo = Infinity, hi = -Infinity, volume = 0, my = 0, mz = 0;
    for (const b of boxes) {
      addBox(compound, ...b);
      lo = Math.min(lo, b[1] - b[4]); hi = Math.max(hi, b[1] + b[4]);
      const vol = b[3] * b[4] * b[5];
      volume += vol; my += b[1] * vol; mz += b[2] * vol;
    }
    // (Jolt puts a compound's centre of mass at its boxes' own, by volume: moved from there)
    const offset = cgZ === null ? vec(0, cg - (lo + hi) / 2, 0) : vec(0, cg - my / volume, cgZ - mz / volume);
    // (each settings object holds the one inside it: destroying the outermost frees them all)
    const massed = new Jolt.OffsetCenterOfMassShapeSettings(offset, compound);
    const result = massed.Create();
    if (result.HasError()) throw new Error(`[physics] a vehicle's body: ${result.GetError().c_str()}`);
    const shape = result.Get();
    shape.AddRef();
    Jolt.destroy(result);
    Jolt.destroy(massed);
    return shape;
  }

  /**
   * Adds a vehicle at (x, y, z) heading `yaw`, at rest. `def` = { kind: 'car' | 'two-wheeler', mass, halfW, halfL, height,
   * cg (m over the ground), wheels: [{ x, z, radius, front, caster?, travel? }], steerLock (rad), drive: 'fwd' | 'rwd'
   * | 'awd', springHz?, roll? (the anti-roll bars' stiffness, N·m/rad per kg: ~0.1 lets a road car lean ~3° a g in a
   * corner, 0.6 holds a supercar nearly flat), wheelMass? (kg) }; a car's `hood` & `cabin`; a two-wheeler's (a moto, a
   * bicycle) `rider` ([x, y, z, hx, hy, hz]: the box its rider fills, left off once they are thrown off), `cgZ` (its
   * centre of mass along it, m) & maxLean.
   * Returns the vehicle: set its `input` before a step (see step), read its `out` after one
   */
  function add(def, x, y, z, yaw) {
    const two = def.kind === 'two-wheeler';
    const springHz = def.springHz || SPRING_HZ;
    const layout = wheelLayout(def.wheels, springHz);
    const minR = Math.min(...layout.map((w) => w.radius));
    let shapes;
    if (two) {
      // the bike: from a little over its wheels' bottoms up to its seat, between its axles' ends; its rider over it
      const y0 = minR * 0.95, y1 = def.height;
      const bike = [0, (y0 + y1) / 2, 0, def.halfW, (y1 - y0) / 2, def.halfL];
      // (the bike alone: its weight lower, and further forward than its rider's)
      shapes = [shapeOf([bike, def.rider], def.cg, def.cgZ ?? 0), shapeOf([bike], def.cg * 0.7, (def.cgZ ?? 0) + 0.1)];
    } else {
      // the body: from a little over the wheels' bottoms up to the bonnet's height its whole length, the cabin over it
      // from the windscreen back (someone hit goes over the bonnet into the glass, not into a wall the car's height),
      // its centre of mass low between the axles
      const y0 = Math.max(0.18, minR * 0.85), y1 = Math.max(y0 + 0.5, def.height * 0.94);
      const yHood = y0 + (y1 - y0) * (def.hood ?? 0.45);
      const cabinFront = def.halfL * (def.cabin?.[0] ?? 0.35), cabinBack = -def.halfL * (def.cabin?.[1] ?? 0.85);
      shapes = [shapeOf([
        [0, (y0 + yHood) / 2, 0, def.halfW, (yHood - y0) / 2, def.halfL],
        [0, (yHood + y1) / 2, (cabinFront + cabinBack) / 2, def.halfW * 0.92, (y1 - yHood) / 2, (cabinFront - cabinBack) / 2]
      ], def.cg)];
    }
    const bcs = new Jolt.BodyCreationSettings(shapes[0], rvec(x, y, z), yawQuat(yaw), Jolt.EMotionType_Dynamic, LAYER_MOVING);
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = def.mass;
    bcs.mLinearDamping = 0; // (drivetrain.js's drag and rolling resistance)
    bcs.mAngularDamping = two ? 0.3 : 0.15;
    bcs.mFriction = two ? 0.35 : 0.4; // (a moto down on its side slides a long way)
    bcs.mRestitution = 0.05;
    bcs.mAllowSleeping = false;
    bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast; // (no tunnelling through a wall at 300 km/h)
    const body = bodies.CreateBody(bcs);
    Jolt.destroy(bcs);
    bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);

    const vs = new Jolt.VehicleConstraintSettings();
    vs.mMaxPitchRollAngle = Math.PI; // (it may go over)
    vs.mWheels.clear();
    // N·m a wheel: a car's ~1.6 g with all four, to hold it or lock them; a moto's rear (its "handbrake") locks
    const brake = def.mass * 9.81 * minR * (two ? 0.8 : 0.4);
    for (const w of layout) {
      const ws = new Jolt.WheelSettingsWV(); // (held by the constraint's wheels from here on)
      ws.mPosition = vec(w.x, w.attachY, w.attachZ);
      ws.mSuspensionDirection = vec(...w.dir);
      if (w.caster) ws.mSteeringAxis = vec(0, Math.cos(w.caster), -Math.sin(w.caster));
      ws.mSuspensionMinLength = w.minLength;
      ws.mSuspensionMaxLength = w.maxLength;
      ws.mSuspensionSpring.mFrequency = two && !w.front ? springHz * 1.2 : springHz;
      ws.mSuspensionSpring.mDamping = SPRING_DAMPING;
      ws.mRadius = w.radius;
      ws.mWidth = two ? 0.12 : 0.22;
      ws.mMaxSteerAngle = w.front ? def.steerLock : 0;
      ws.mMaxBrakeTorque = brake;
      ws.mMaxHandBrakeTorque = w.front ? 0 : brake * 1.6;
      ws.mInertia = 0.5 * (def.wheelMass ?? 18) * w.radius * w.radius; // (an 18 kg car wheel & tyre unless it says)
      ws.mAngularDamping = 0.2;
      vs.mWheels.push_back(ws);
    }
    // anti-roll bars between the first pair at each end (none on two wheels)
    vs.mAntiRollBars.clear();
    const pairOf = (front) => {
      const l = layout.findIndex((w) => w.front === front && w.left);
      const r = layout.findIndex((w) => w.front === front && !w.left);
      return l >= 0 && r >= 0 ? [l, r] : null;
    };
    for (const [front, k] of [[true, 1.3], [false, 0.9]]) {
      const p = pairOf(front);
      if (!p) continue;
      const bar = new Jolt.VehicleAntiRollBar();
      bar.mLeftWheel = p[0];
      bar.mRightWheel = p[1];
      bar.mStiffness = def.mass * (def.roll ?? 0.1) * k; // N·m/rad
      vs.mAntiRollBars.push_back(bar); // (copied)
      Jolt.destroy(bar);
    }
    // a controller with its engine idling in neutral, the clutch out: the wheels roll free (see the header)
    const cs = two ? new Jolt.MotorcycleControllerSettings() : new Jolt.WheeledVehicleControllerSettings(); // (held by vs)
    cs.mEngine.mMaxTorque = 1;
    cs.mTransmission.mMode = Jolt.ETransmissionMode_Manual;
    cs.mDifferentials.clear();
    // (a moto's turns are kept to what its tyres hold at its deepest lean: Jolt's steering limit)
    if (two) cs.mMaxLeanAngle = def.maxLean ?? MAX_LEAN;
    vs.mController = cs;
    const constraint = new Jolt.VehicleConstraint(body, vs);
    Jolt.destroy(vs);
    // (the wheels found by casting a cylinder down each spring; its second argument the share of half its width that is
    // rounded off: a two-wheeler's tyres wholly round, so it rolls onto their shoulders as it leans; a car's square)
    constraint.SetVehicleCollisionTester(new Jolt.VehicleCollisionTesterCastCylinder(LAYER_MOVING, two ? 1 : 0.05));
    system.AddConstraint(constraint);
    const listener = new Jolt.VehicleConstraintStepListener(constraint);
    system.AddStepListener(listener);
    const controller = Jolt.castObject(constraint.GetController(), two ? Jolt.MotorcycleController : Jolt.WheeledVehicleController);
    controller.GetTransmission().Set(0, 0);
    // (Jolt's own lean controller leans a two-wheeler towards where the ground pushes its tyres, and pushes its body sideways
    // to do it, a push no tyre makes: it turns harder than its grip and leans half as far. Its rider balances it here
    // instead: see balance)
    if (two) controller.EnableLeanController(false);

    // The tyres' grip: the slip curves' friction scaled by the class's tyres and the road (wet), the rear tyres sliding
    // under a pulled handbrake (a moto's locked rear wheel), the driven ones giving way sideways while they spin (power
    // oversteer)
    const tyres = new Jolt.WheeledVehicleControllerCallbacksJS();
    const state = { grip: 1, handbrake: false, spinning: false };
    const drivenFront = def.drive !== 'rwd', drivenRear = def.drive !== 'fwd';
    tyres.OnTireMaxImpulseCallback = (index, outResult, suspensionImpulse, longFriction, latFriction) => {
      const w = layout[index];
      let lat = latFriction * suspensionImpulse * state.grip;
      if (!w.front && state.handbrake) lat *= two ? 0.55 : 0.42;
      if (state.spinning && (w.front ? drivenFront : drivenRear)) lat *= 0.72;
      const out = Jolt.wrapPointer(outResult, Jolt.TireMaxImpulseCallbackResult);
      out.mLongitudinalImpulse = longFriction * suspensionImpulse * state.grip;
      out.mLateralImpulse = lat;
    };
    tyres.SetWheeledVehicleController(controller);

    const v = {
      kind: two ? 'two-wheeler' : 'car', body, id: body.GetID().GetIndexAndSequenceNumber(), constraint, controller, listener,
      tyres, state, layout, def, shapes, rider: two,
      driven: layout.map((w) => (w.front ? drivenFront : drivenRear)),
      wheels: layout.map((_, i) => Jolt.castObject(constraint.GetWheel(i), Jolt.WheelWV)),
      patch: { body: null, cx: NaN, cz: NaN, level: NaN },
      caster: Math.cos(layout.find((w) => w.front)?.caster || 0), // (its cosine)
      wheelbase: Math.max(...layout.map((w) => w.z)) - Math.min(...layout.map((w) => w.z)),
      upsideDown: 0, input: null, turn: 0, rearWheel: Math.max(0, layout.findIndex((w) => !w.front)),
      hit: { speed: 0, nx: 0, ny: 0, nz: 0, other: null },
      out: {
        x, y, z, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
        fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, heading: yaw, forward: 0, lean: 0, pitch: 0, contacts: 0, wheels: [], hit: null
      }
    };
    v.out.hit = v.hit;
    vehicles.add(v);
    byId.set(v.id, v);
    read(v);
    return v;
  }

  /** A two-wheeler's rider gone (thrown off): its body is the bike's alone, nobody balances it, it drives no more */
  function unseat(v) {
    if (!v.rider) return;
    v.rider = false;
    v.input = null;
    bodies.SetShape(v.body.GetID(), v.shapes[1], false, Jolt.EActivation_Activate);
  }

  // Sets vehicle `v` down at (x, y, z) heading `yaw` (y: the ground under it), at rest
  function place(v, x, y, z, yaw) {
    bodies.SetPositionAndRotation(v.body.GetID(), rvec(x, y, z), yawQuat(yaw), Jolt.EActivation_Activate);
    bodies.SetLinearAndAngularVelocity(v.body.GetID(), vec(0, 0, 0), vec(0, 0, 0, tmpV2));
    v.upsideDown = 0;
    v.patch.cx = fed.x = NaN; // (the ground & walls fed in again where it now is)
    read(v);
  }

  // The body's state into `v.out` (world position of its origin, rotation, velocity, angular velocity, its own axes)
  function read(v) {
    const out = v.out;
    const p = v.body.GetPosition(), q = v.body.GetRotation();
    const lv = v.body.GetLinearVelocity(), w = v.body.GetAngularVelocity();
    out.x = p.GetX(); out.y = p.GetY(); out.z = p.GetZ();
    out.qx = q.GetX(); out.qy = q.GetY(); out.qz = q.GetZ(); out.qw = q.GetW();
    out.vx = lv.GetX(); out.vy = lv.GetY(); out.vz = lv.GetZ();
    out.wx = w.GetX(); out.wy = w.GetY(); out.wz = w.GetZ();
    // ahead (local +z) and up (local +y) in the world
    const { qx, qy, qz, qw } = out;
    out.fx = 2 * (qx * qz + qw * qy); out.fy = 2 * (qy * qz - qw * qx); out.fz = 1 - 2 * (qx * qx + qy * qy);
    out.ux = 2 * (qx * qy - qw * qz); out.uy = 1 - 2 * (qx * qx + qz * qz); out.uz = 2 * (qy * qz + qw * qx);
    out.heading = headingOf(out.fx, out.fy, out.fz, out.ux, out.uz);
    out.forward = out.vx * out.fx + out.vy * out.fy + out.vz * out.fz;
    const lp = leanAndPitch(out.fx, out.fy, out.fz, out.ux, out.uy, out.uz);
    out.lean = lp.lean;
    out.pitch = lp.pitch;
    return out;
  }

  // How fast a body is pitching its nose up (rad/s): its spin about its own left (up × ahead), against
  function pitchRate(o) {
    const lx = o.uy * o.fz - o.uz * o.fy, ly = o.uz * o.fx - o.ux * o.fz, lz = o.ux * o.fy - o.uy * o.fx;
    return -(o.wx * lx + o.wy * ly + o.wz * lz);
  }

  const negligible = (a, b, c) => Math.abs(a) + Math.abs(b) + Math.abs(c) < 1e-6;

  /** Pushes on vehicle `v`: a velocity change (the traffic's shove), an angular one, a move (dx, dz) */
  function shove(v, dvx, dvy, dvz, dwx, dwy, dwz, dx = 0, dz = 0) {
    const id = v.body.GetID();
    if (!negligible(dvx, dvy, dvz)) bodies.AddLinearVelocity(id, vec(dvx, dvy, dvz));
    if (!negligible(dwx, dwy, dwz)) {
      const w = v.body.GetAngularVelocity();
      bodies.SetAngularVelocity(id, vec(w.GetX() + dwx, w.GetY() + dwy, w.GetZ() + dwz));
    }
    if (!negligible(dx, dz, 0)) {
      const p = v.body.GetPosition();
      bodies.SetPosition(id, rvec(p.GetX() + dx, p.GetY(), p.GetZ() + dz), Jolt.EActivation_Activate);
    }
  }

  /** Holds vehicle `v` to (x, z) with its velocity along the ground (vx, vz): a map edge it may not drive past */
  function confine(v, x, z, vx, vz) {
    const id = v.body.GetID();
    const p = v.body.GetPosition(), lv = v.body.GetLinearVelocity();
    bodies.SetPosition(id, rvec(x, p.GetY(), z), Jolt.EActivation_Activate);
    bodies.SetLinearVelocity(id, vec(vx, lv.GetY(), vz));
    read(v);
  }

  // A moto's rider balancing it: leant into its turn as far as the turn needs, tan(lean) = a / g, so that the ground's
  // push on its tyres goes through its centre of mass (it neither falls in nor stands up); upright when it stops. How
  // hard it turns, `a`: its speed times its turning rate, but no more than its tyres push it across (sliding sideways
  // on a locked rear wheel, it spins far faster than it turns: it stays up). A torque about its own length (sprung,
  // damped), nothing that pushes it about. Off the ground, they hold it as it is
  function balance(v, out, touching, h) {
    if (!touching) return;
    const g = 9.81, max = v.def.maxLean ?? MAX_LEAN;
    const rx = -out.fz, rz = out.fx, rl = Math.hypot(rx, rz) || 1; // (its right, level)
    let push = 0;
    for (const w of v.wheels) {
      if (!w.HasContact()) continue;
      const lat = w.GetContactLateral();
      push += w.GetLateralLambda() * (lat.GetX() * rx + lat.GetZ() * rz) / rl;
    }
    const tyres = Math.abs(push / (h * v.def.mass));
    v.turn += (tyres - v.turn) * (1 - Math.exp(-h / TURN_SMOOTHING));
    const turning = -out.forward * out.wy;
    const a = Math.sign(turning) * Math.min(Math.abs(turning), v.turn * 1.15 + 0.5);
    // (on one wheel, a wheelie or a stoppie: held upright and straight, its rider's weight against its swinging round)
    const one = touching < 2;
    const target = one ? 0 : Math.max(-max, Math.min(max, Math.atan(a / g)));
    const rate = out.wx * out.fx + out.wy * out.fy + out.wz * out.fz; // (how fast it leans over to its right)
    const k = v.def.mass * g * v.def.cg; // (what gravity's topple a radian over takes)
    const torque = LEAN_SPRING * k * (target - out.lean) - LEAN_DAMPING * k * rate;
    const yaw = one ? -YAW_HOLD * k * (out.wx * out.ux + out.wy * out.uy + out.wz * out.uz) : 0;
    const tx = out.fx * torque + out.ux * yaw, ty = out.fy * torque + out.uy * yaw, tz = out.fz * torque + out.uz * yaw;
    const id = v.body.GetID();
    bodies.AddTorque(id, vec(tx, ty, tz), Jolt.EActivation_Activate);
    // It leans about its tyres, not its middle (as a rider leans it): the turn the torque gives it this sub-step would
    // swing its contact patches sideways, and their tyres would fight it, so its body is pushed against that, as much
    // as keeps them on their line (weighed by the weight on each); none once it is where it should be
    const dw = v.body.GetMotionProperties().MultiplyWorldSpaceInverseInertiaByVector(v.body.GetRotation(), vec(tx * h, ty * h, tz * h));
    const dwx = dw.GetX(), dwy = dw.GetY(), dwz = dw.GetZ();
    const com = v.body.GetCenterOfMassPosition();
    const cx = com.GetX(), cy = com.GetY(), cz = com.GetZ();
    let sx = 0, sz = 0, total = 0;
    for (const w of v.wheels) {
      if (!w.HasContact()) continue;
      const lambda = Math.max(0, w.GetSuspensionLambda());
      const p = w.GetContactPosition();
      const px = p.GetX() - cx, py = p.GetY() - cy, pz = p.GetZ() - cz;
      sx += lambda * (dwy * pz - dwz * py); sz += lambda * (dwx * py - dwy * px);
      total += lambda;
    }
    // (across it on the level only: the ground takes care of up and down)
    if (total > 0) {
      const across = -v.def.mass * (sx * rx + sz * rz) / (rl * rl * total * h);
      bodies.AddForce(id, vec(rx * across, 0, rz * across), Jolt.EActivation_Activate);
    }
  }

  // Vehicle `v`'s force for this sub-step (h s), split over the tyres on the ground that take it (the driven ones
  // under power), at their contact patches along it, each no more than its grip under the weight it carried in the
  // last sub-step; or, all of them off the ground, the air's drag against its motion
  function push(v, input, drive, h) {
    const out = read(v);
    const id = v.body.GetID();
    v.controller.GetTransmission().Set(0, 0);
    let force = input.force || 0;
    // (a moto's rider eases off as its nose comes up: it rides the wheelie)
    if (v.kind === 'two-wheeler' && drive && force > 0) force *= wheelieThrottle(out.pitch, pitchRate(out), out.forward);
    let takers = 0, touching = 0;
    v.wheels.forEach((w, i) => {
      if (!w.HasContact()) return;
      touching++;
      if (!drive || v.driven[i]) takers++;
    });
    if (v.kind === 'two-wheeler' && v.rider) {
      balance(v, out, touching, h);
      // (braking hard enough to lift its rear wheel, the brakes ease off: no going over the bars)
      if (!drive && force < 0) {
        const rear = Math.max(0, v.wheels[v.rearWheel].GetSuspensionLambda());
        const front = Math.max(0, v.wheels[1 - v.rearWheel].GetSuspensionLambda());
        if (rear + front > 0) force *= Math.min(1, (rear / (rear + front)) / STOPPIE);
      }
    }
    if (takers && force) {
      // (a car's evenly; a moto's braking by the weight on each wheel, mostly the front's: an even share would lock
      // its light rear wheel and swing it round)
      const byLoad = v.kind === 'two-wheeler' && !drive;
      let total = 0;
      if (byLoad) v.wheels.forEach((w) => { if (w.HasContact()) total += Math.max(0, w.GetSuspensionLambda()); });
      v.wheels.forEach((w, i) => {
        if (!w.HasContact() || (drive && !v.driven[i])) return;
        const load = Math.max(0, w.GetSuspensionLambda()) / h; // N pressing it on the ground
        const share = byLoad ? force * (total > 0 ? Math.max(0, w.GetSuspensionLambda()) / total : 1 / takers) : force / takers;
        const f = Math.sign(share) * Math.min(Math.abs(share), v.state.grip * load * 1.1);
        const p = w.GetContactPosition(), nrm = w.GetContactNormal();
        // its heading laid on the ground's plane
        const d = out.fx * nrm.GetX() + out.fy * nrm.GetY() + out.fz * nrm.GetZ();
        vec((out.fx - nrm.GetX() * d) * f, (out.fy - nrm.GetY() * d) * f, (out.fz - nrm.GetZ() * d) * f);
        bodies.AddForce(id, tmpV, rvec(p.GetX(), p.GetY(), p.GetZ()), Jolt.EActivation_Activate);
      });
    } else if (!touching && input.airDrag) {
      const speed = Math.hypot(out.vx, out.vy, out.vz);
      if (speed > 0.1) {
        const k = -input.airDrag / speed;
        bodies.AddForce(id, vec(out.vx * k, out.vy * k, out.vz * k), Jolt.EActivation_Activate);
      }
    }
  }

  // The steering vehicle `v` is given (-1 .. 1 of its lock): a moto's no more than turns it as hard as its deepest lean
  // holds (v² tan(steer on the ground) / wheelbase = g tan(lean)); its rider steers no further
  function steerOf(v, input) {
    const steer = input?.steer || 0;
    if (v.kind !== 'two-wheeler' || !steer) return steer;
    const vv = v.out.forward * v.out.forward;
    if (vv < 1) return steer;
    // (leant over, its steering turns it more than upright: by cos(caster) / cos(lean))
    const lean = (v.def.maxLean ?? MAX_LEAN) * 0.92;
    const most = Math.atan(v.wheelbase * 9.81 * Math.tan(lean) / vv) * Math.cos(lean) / v.caster / v.def.steerLock;
    return Math.max(-most, Math.min(most, steer));
  }

  /**
   * Steps the world `dt` s. Each vehicle's `input` (null: nobody drives it, its wheels roll free): { force (N along it:
   * drivetrain.js's net drive & resistance, the drive on the driven wheels and the braking on all of them, each no more
   * than its tyre's grip under the weight on it), airDrag (N, against its motion while airborne), steer (-1 left .. 1
   * right of the full lock), handbrake, hold (brakes on to keep it standing), grip (the tyres' grip, 1 dry),
   * spinning }. `focus` ({ x, y, z }: the player) is where the walls are fed in round. Afterwards each vehicle's `out`
   * holds its state; `out.hit` the hardest knock its body itself took meanwhile (speed 0: none; `other`, the vehicle it
   * hit).
   */
  function step(dt, focus) {
    if (focus && !(Math.hypot(focus.x - fed.x, focus.z - fed.z) < WALL_REFRESH)) feedWalls(focus.x, focus.z, focus.y);
    for (const v of vehicles) {
      read(v);
      keepPatch(v);
      const input = v.input;
      v.state.grip = input?.grip ?? 1;
      v.state.handbrake = Boolean(input?.handbrake);
      v.state.spinning = Boolean(input?.spinning);
      v.controller.SetDriverInput(0, steerOf(v, input), input?.hold ? 1 : 0, input?.handbrake || input?.hold ? 1 : 0);
      v.hit.speed = 0;
      v.hit.other = null;
      drives.set(v, Boolean(input) && isDrive(input.force, v.out.forward));
    }
    for (const sys of systems) sys.before?.(dt);
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (const v of vehicles) if (v.input) push(v, v.input, drives.get(v), h);
      jolt.Step(h, 1);
    }
    drives.clear();
    for (const sys of systems) sys.after?.(dt);
    for (const v of vehicles) settle(v, dt);
  }

  // After a step: vehicle `v`'s state, its wheels, and a car left on its roof put back on its wheels
  function settle(v, dt) {
    const out = read(v);
    let onGround = 0;
    out.wheels.length = v.wheels.length;
    v.wheels.forEach((w, i) => {
      const o = (out.wheels[i] ??= {});
      o.contact = w.HasContact();
      if (o.contact) onGround++;
      o.spin = w.GetRotationAngle();
      o.steer = w.GetSteerAngle(); // (rad, + to its left)
      o.travel = w.GetSuspensionLength(); // m along its spring from where it attaches
      o.y = v.layout[i].attachY + v.layout[i].dir[1] * o.travel; // the wheel's centre over the floor
      o.z = v.layout[i].attachZ + v.layout[i].dir[2] * o.travel; // ...and along the vehicle
    });
    out.contacts = onGround;
    // a car on its roof or its side, all but stopped, for a while: back on its wheels (no rocking it back by hand); a
    // moto lies where it fell
    if (v.kind !== 'car') return;
    if (out.uy < 0.35 && Math.hypot(out.vx, out.vz) < 1.5) v.upsideDown += dt;
    else v.upsideDown = 0;
    if (v.upsideDown > FLIP_RESCUE) place(v, out.x, world.groundAt(out.x, out.z, out.y + 1) + 0.3, out.z, out.heading);
  }

  return {
    add, remove, place, step, shove, confine, read, unseat, vehicles, wallCount: () => walls.size,
    world: shared, addSystem: (sys) => systems.push(sys)
  };
}

export { createCarPhysics, wheelLayout, headingOf, isDrive, wheelieThrottle, leanAndPitch };
