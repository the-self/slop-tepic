// js/player/car-physics.js
// The player's car as a rigid body on four (or more) sprung wheels, in Jolt Physics (WASM, MIT; jolt-physics on
// jsDelivr): suspension travel and damping per wheel, anti-roll bars, a tyre model with slip curves for grip, the body's
// weight shifting under braking, power and cornering, and real contacts with the city: walls stop it and spin it, it
// flies off crests, lands on its springs and can roll over. Jolt drives nothing itself: the engine, gearbox, brakes and
// drag stay drivetrain.js's (its maker-calibrated 0-100 km/h, nitro, gears and revs), its force pushed through the
// tyres' contact patches, never more than each tyre's grip under the weight on it; Jolt's wheels roll free, and its
// handbrake locks the rear ones.
//
// The world the car meets is the game's own, fed in around it as it drives (nothing city-wide is copied into Jolt):
// - the ground: a height field 32 m square under the car, sampled from `groundAt(x, z, fromY)` at the car's level (so
//   the deck of a bridge it is on, or the channel under one it is down in), the kerbs included; rebuilt every 6 m;
// - the walls: `collidersNear(x, z, r)`'s boxes (buildings, poles, parapets, parked cars) within 45 m, as static boxes,
//   looked at again every 2 m.
// The traffic still shoves the car itself (traffic.js collideWithPlayer, moving its position and velocity): the shove is
// carried over to the body on the next step.
//
// Frame: as the game's (metres, y up), the car's own +z ahead and +x its left, its origin on the ground under it at rest.
// Plain numbers and Jolt only, no three.js: node --test can run it with a local Jolt. Jolt's objects live on the WASM
// heap: the ones made here for a moment are reused (tmp*) or destroyed, never left to the garbage collector.

const LAYER_STATIC = 0;
const LAYER_MOVING = 1;
const PATCH_CELL = 0.5; // m between the ground's samples
const PATCH_SAMPLES = 64; // per side: a 31.5 m square
const PATCH_RECENTRE = 6; // m the car may move from the patch's centre before it is sampled again around it
const PATCH_RELEVEL = 1.2; // m up or down (a ramp onto a deck) before the patch is sampled again at its new level
const WALL_REACH = 45; // m around the car the walls are fed in from
const WALL_REFRESH = 2; // m the car moves between two looks at the walls around it
const STEP = 1 / 90; // s, Jolt's step (the frame is cut into as many)
const SPRING_HZ = 1.4; // the suspension's natural frequency (a road car's 1.2-1.8 Hz), unless the car says otherwise
const SPRING_DAMPING = 0.55;
const TRAVEL = 0.26; // m of suspension travel
const FLIP_RESCUE = 2.5; // s on its roof or side, all but stopped, before it is set back on its wheels

/** Pure: where the wheels attach and how far they hang, from their resting centres (local x, y = radius, z) */
function wheelLayout(wheels, springHz = SPRING_HZ, gravity = 9.81) {
  const sag = gravity / (2 * Math.PI * springHz) ** 2; // static deflection under the car's weight
  return wheels.map((w) => ({
    x: w.x, z: w.z, radius: w.radius, front: w.front, left: w.x > 0,
    // the attachment point: the wheel hangs TRAVEL below it at full droop, and settles `sag` above that at rest
    attachY: w.radius + TRAVEL - sag,
    minLength: 0.04,
    maxLength: TRAVEL
  }));
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
 * Pure: whether a force `force` (N, along the car) on a car moving at `forward` (m/s, along itself) drives it (on the
 * driven wheels: pulling away, speeding up, or backing) rather than slows it (on all of them: brakes, drag)
 */
function isDrive(force, forward) {
  return force !== 0 && (Math.abs(forward) < 0.3 || Math.sign(force) === Math.sign(forward));
}

/**
 * The car's physics in `Jolt` (an initialised jolt-physics module). `world`: { groundAt(x, z, fromY) → the height of
 * what a car stands on there, collidersNear(x, z, r) → [{ minX, maxX, minZ, maxZ, minY?, maxY?, obb? }] }.
 */
function createCarPhysics(Jolt, world) {
  const settings = new Jolt.JoltSettings();
  const pairs = new Jolt.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING);
  pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
  const bp = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bp.MapObjectToBroadPhaseLayer(LAYER_STATIC, new Jolt.BroadPhaseLayer(0));
  bp.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bp;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, 2);
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

  // ---- The ground patch -----------------------------------------------------------------------------------------
  const patch = { body: null, cx: NaN, cz: NaN, level: NaN };
  function samplePatch(cx, cz, fromY) {
    const s = new Jolt.HeightFieldShapeSettings();
    const n = PATCH_SAMPLES;
    const x0 = Math.round(cx / PATCH_CELL) * PATCH_CELL - (n / 2) * PATCH_CELL;
    const z0 = Math.round(cz / PATCH_CELL) * PATCH_CELL - (n / 2) * PATCH_CELL;
    s.mOffset.Set(x0, 0, z0);
    s.mScale.Set(PATCH_CELL, 1, PATCH_CELL);
    s.mSampleCount = n;
    s.mBitsPerSample = 16;
    s.mHeightSamples.resize(n * n);
    const heights = new Float32Array(Jolt.HEAPF32.buffer, Jolt.getPointer(s.mHeightSamples.data()), n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = world.groundAt(x0 + i * PATCH_CELL, z0 + j * PATCH_CELL, fromY);
    }
    const result = s.Create();
    const shape = result.Get();
    Jolt.destroy(s);
    if (!patch.body) {
      tmpQ.Set(0, 0, 0, 1);
      const bcs = new Jolt.BodyCreationSettings(shape, rvec(0, 0, 0), tmpQ, Jolt.EMotionType_Static, LAYER_STATIC);
      bcs.mFriction = 1.0;
      patch.body = bodies.CreateBody(bcs);
      Jolt.destroy(bcs);
      bodies.AddBody(patch.body.GetID(), Jolt.EActivation_DontActivate);
    } else {
      bodies.SetShape(patch.body.GetID(), shape, false, Jolt.EActivation_DontActivate);
    }
    Jolt.destroy(result); // (the body holds the shape now)
    patch.cx = cx;
    patch.cz = cz;
    patch.level = fromY;
  }

  // ---- The walls ------------------------------------------------------------------------------------------------
  const walls = new Map(); // collider -> Body
  const fed = { x: NaN, z: NaN };
  let wallStamp = 0;
  function feedWalls(x, z, y) {
    const stamp = ++wallStamp;
    for (const c of world.collidersNear(x, z, WALL_REACH)) {
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
      bodies.RemoveBody(body.GetID());
      bodies.DestroyBody(body.GetID());
      walls.delete(c);
    }
    fed.x = x;
    fed.z = z;
  }

  // ---- The car --------------------------------------------------------------------------------------------------
  let car = null; // { body, id, constraint, controller, listener, tyres, wheels, layout, def, ... }

  // A hit on the body itself (not on its tyres: a landing or a slide is no crash): the fastest approach into anything
  // this step, and the normal out of what it hit
  const hit = { speed: 0, nx: 0, ny: 0, nz: 0 };
  const contacts = new Jolt.ContactListenerJS();
  contacts.OnContactValidate = () => Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
  contacts.OnContactAdded = (body1, body2, manifold) => {
    if (!car) return;
    const id1 = Jolt.wrapPointer(body1, Jolt.Body).GetID().GetIndexAndSequenceNumber();
    const id2 = Jolt.wrapPointer(body2, Jolt.Body).GetID().GetIndexAndSequenceNumber();
    if (id1 !== car.id && id2 !== car.id) return;
    const n = Jolt.wrapPointer(manifold, Jolt.ContactManifold).mWorldSpaceNormal; // (from body 1 into body 2)
    const s = id1 === car.id ? -1 : 1;
    const nx = n.GetX() * s, ny = n.GetY() * s, nz = n.GetZ() * s;
    const v = car.body.GetLinearVelocity();
    const approach = -(v.GetX() * nx + v.GetY() * ny + v.GetZ() * nz);
    if (approach > hit.speed) {
      hit.speed = approach;
      hit.nx = nx; hit.ny = ny; hit.nz = nz;
    }
  };
  contacts.OnContactPersisted = () => {};
  contacts.OnContactRemoved = () => {};
  system.SetContactListener(contacts);

  function dropCar() {
    if (!car) return;
    system.RemoveStepListener(car.listener);
    system.RemoveConstraint(car.constraint);
    bodies.RemoveBody(car.body.GetID());
    bodies.DestroyBody(car.body.GetID());
    Jolt.destroy(car.listener);
    Jolt.destroy(car.tyres);
    car = null;
  }

  /**
   * (Re)builds the car: `def` = { mass, halfW, halfL, height, cg (m over the ground), wheels: [{ x, z, radius, front }],
   * steerLock (rad), drive: 'fwd' | 'rwd' | 'awd', springHz?, roll? (the anti-roll bars' stiffness, N·m/rad per kg:
   * ~0.1 lets a road car lean ~3° a g in a corner, 0.6 holds a supercar nearly flat) }
   */
  function build(def, x, y, z, yaw) {
    dropCar();
    const springHz = def.springHz || SPRING_HZ;
    const layout = wheelLayout(def.wheels, springHz);
    const minR = Math.min(...layout.map((w) => w.radius));
    // the body: from a little over the wheels' bottoms to the roof, its centre of mass low between the axles
    const y0 = Math.max(0.18, minR * 0.85), y1 = Math.max(y0 + 0.5, def.height * 0.94);
    const yc = (y0 + y1) / 2;
    // (each settings object holds the one inside it: destroying the outermost frees them all)
    tmpQ.Set(0, 0, 0, 1);
    const box = new Jolt.BoxShapeSettings(vec(def.halfW, (y1 - y0) / 2, def.halfL), 0.05);
    const placed = new Jolt.RotatedTranslatedShapeSettings(vec(0, yc, 0), tmpQ, box);
    const massed = new Jolt.OffsetCenterOfMassShapeSettings(vec(0, def.cg - yc, 0), placed);
    const result = massed.Create();
    const bcs = new Jolt.BodyCreationSettings(result.Get(), rvec(x, y, z), yawQuat(yaw), Jolt.EMotionType_Dynamic, LAYER_MOVING);
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = def.mass;
    bcs.mLinearDamping = 0; // (drivetrain.js's drag and rolling resistance)
    bcs.mAngularDamping = 0.15;
    bcs.mFriction = 0.4;
    bcs.mRestitution = 0.05;
    bcs.mAllowSleeping = false;
    bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast; // (no tunnelling through a wall at 300 km/h)
    const body = bodies.CreateBody(bcs);
    Jolt.destroy(bcs);
    Jolt.destroy(result);
    Jolt.destroy(massed);
    bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);

    const vs = new Jolt.VehicleConstraintSettings();
    vs.mMaxPitchRollAngle = Math.PI; // (it may go over)
    vs.mWheels.clear();
    const brake = def.mass * 9.81 * minR * 0.4; // N·m a wheel: ~1.6 g with all four, to hold it or lock them
    for (const w of layout) {
      const ws = new Jolt.WheelSettingsWV(); // (held by the constraint's wheels from here on)
      ws.mPosition = vec(w.x, w.attachY, w.z);
      ws.mSuspensionDirection = vec(0, -1, 0);
      ws.mSuspensionMinLength = w.minLength;
      ws.mSuspensionMaxLength = w.maxLength;
      ws.mSuspensionSpring.mFrequency = springHz;
      ws.mSuspensionSpring.mDamping = SPRING_DAMPING;
      ws.mRadius = w.radius;
      ws.mWidth = 0.22;
      ws.mMaxSteerAngle = w.front ? def.steerLock : 0;
      ws.mMaxBrakeTorque = brake;
      ws.mMaxHandBrakeTorque = w.front ? 0 : brake * 1.6;
      ws.mInertia = 0.5 * 18 * w.radius * w.radius; // (an 18 kg wheel & tyre)
      ws.mAngularDamping = 0.2;
      vs.mWheels.push_back(ws);
    }
    // anti-roll bars between the first pair at each end
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
    const cs = new Jolt.WheeledVehicleControllerSettings(); // (held by vs, freed with it)
    cs.mEngine.mMaxTorque = 1;
    cs.mTransmission.mMode = Jolt.ETransmissionMode_Manual;
    cs.mDifferentials.clear();
    vs.mController = cs;
    const constraint = new Jolt.VehicleConstraint(body, vs);
    Jolt.destroy(vs);
    constraint.SetVehicleCollisionTester(new Jolt.VehicleCollisionTesterCastCylinder(LAYER_MOVING, 0.05));
    system.AddConstraint(constraint);
    const listener = new Jolt.VehicleConstraintStepListener(constraint);
    system.AddStepListener(listener);
    const controller = Jolt.castObject(constraint.GetController(), Jolt.WheeledVehicleController);
    controller.GetTransmission().Set(0, 0);

    // The tyres' grip: the slip curves' friction scaled by the class's tyres and the road (wet), the rear tyres sliding
    // under a pulled handbrake, the driven ones giving way sideways while they spin (power oversteer)
    const tyres = new Jolt.WheeledVehicleControllerCallbacksJS();
    const state = { grip: 1, handbrake: false, spinning: false };
    const drivenFront = def.drive !== 'rwd', drivenRear = def.drive !== 'fwd';
    tyres.OnTireMaxImpulseCallback = (index, outResult, suspensionImpulse, longFriction, latFriction) => {
      const w = layout[index];
      let lat = latFriction * suspensionImpulse * state.grip;
      if (!w.front && state.handbrake) lat *= 0.42;
      if (state.spinning && (w.front ? drivenFront : drivenRear)) lat *= 0.72;
      const out = Jolt.wrapPointer(outResult, Jolt.TireMaxImpulseCallbackResult);
      out.mLongitudinalImpulse = longFriction * suspensionImpulse * state.grip;
      out.mLateralImpulse = lat;
    };
    tyres.SetWheeledVehicleController(controller);

    car = {
      body, id: body.GetID().GetIndexAndSequenceNumber(), constraint, controller, listener, tyres, state, layout, def,
      driven: layout.map((w) => (w.front ? drivenFront : drivenRear)),
      wheels: layout.map((_, i) => Jolt.castObject(constraint.GetWheel(i), Jolt.WheelWV)),
      upsideDown: 0
    };
    return car;
  }

  // Sets the car down at (x, y, z) heading `yaw` (y: the ground under it), at rest
  function place(x, y, z, yaw) {
    if (!car) return;
    bodies.SetPositionAndRotation(car.body.GetID(), rvec(x, y, z), yawQuat(yaw), Jolt.EActivation_Activate);
    bodies.SetLinearAndAngularVelocity(car.body.GetID(), vec(0, 0, 0), vec(0, 0, 0, tmpV2));
    car.upsideDown = 0;
    patch.cx = fed.x = NaN; // (the ground & walls fed in again where it now is)
  }

  const out = {
    x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, heading: 0, forward: 0, contacts: 0, wheels: [], hit
  };

  // The body's state into `out` (world position of its origin, rotation, velocity, angular velocity, its own axes)
  function read() {
    const p = car.body.GetPosition(), q = car.body.GetRotation();
    const v = car.body.GetLinearVelocity(), w = car.body.GetAngularVelocity();
    out.x = p.GetX(); out.y = p.GetY(); out.z = p.GetZ();
    out.qx = q.GetX(); out.qy = q.GetY(); out.qz = q.GetZ(); out.qw = q.GetW();
    out.vx = v.GetX(); out.vy = v.GetY(); out.vz = v.GetZ();
    out.wx = w.GetX(); out.wy = w.GetY(); out.wz = w.GetZ();
    // ahead (local +z) and up (local +y) in the world
    const { qx, qy, qz, qw } = out;
    out.fx = 2 * (qx * qz + qw * qy); out.fy = 2 * (qy * qz - qw * qx); out.fz = 1 - 2 * (qx * qx + qy * qy);
    out.ux = 2 * (qx * qy - qw * qz); out.uy = 1 - 2 * (qx * qx + qz * qz); out.uz = 2 * (qy * qz + qw * qx);
    out.heading = headingOf(out.fx, out.fy, out.fz, out.ux, out.uz);
    out.forward = out.vx * out.fx + out.vy * out.fy + out.vz * out.fz;
    return out;
  }

  const negligible = (a, b, c) => Math.abs(a) + Math.abs(b) + Math.abs(c) < 1e-6;

  /** Pushes on the body: a velocity change (the traffic's shove), an angular one, a move (dx, dz) */
  function shove(dvx, dvy, dvz, dwx, dwy, dwz, dx = 0, dz = 0) {
    if (!car) return;
    const id = car.body.GetID();
    if (!negligible(dvx, dvy, dvz)) bodies.AddLinearVelocity(id, vec(dvx, dvy, dvz));
    if (!negligible(dwx, dwy, dwz)) {
      const w = car.body.GetAngularVelocity();
      bodies.SetAngularVelocity(id, vec(w.GetX() + dwx, w.GetY() + dwy, w.GetZ() + dwz));
    }
    if (!negligible(dx, dz, 0)) {
      const p = car.body.GetPosition();
      bodies.SetPosition(id, rvec(p.GetX() + dx, p.GetY(), p.GetZ() + dz), Jolt.EActivation_Activate);
    }
  }

  /** Holds the car to (x, z) with its velocity along the ground (vx, vz): a map edge it may not drive past */
  function confine(x, z, vx, vz) {
    if (!car) return;
    const id = car.body.GetID();
    const p = car.body.GetPosition(), v = car.body.GetLinearVelocity();
    bodies.SetPosition(id, rvec(x, p.GetY(), z), Jolt.EActivation_Activate);
    bodies.SetLinearVelocity(id, vec(vx, v.GetY(), vz));
  }

  /**
   * Steps the car `dt` s. `input`: { force (N along the car: drivetrain.js's net drive & resistance, the drive on the
   * driven wheels and the braking on all of them, each no more than its tyre's grip under the weight on it), airDrag (N,
   * against its motion while airborne), steer (-1 left .. 1 right of the full lock), handbrake, hold (brakes on to keep
   * it standing), grip (the tyres' grip, 1 dry), spinning }. Returns `out` after the step; `out.hit` holds the hardest
   * knock the body itself took meanwhile (speed 0: none).
   */
  function step(input, dt) {
    if (!car) return null;
    read();
    // the ground & walls around it, fed in as it goes
    if (!(Math.hypot(out.x - patch.cx, out.z - patch.cz) < PATCH_RECENTRE) || Math.abs(out.y - patch.level) > PATCH_RELEVEL) {
      samplePatch(out.x, out.z, out.y);
    }
    if (!(Math.hypot(out.x - fed.x, out.z - fed.z) < WALL_REFRESH)) feedWalls(out.x, out.z, out.y);
    car.state.grip = input.grip ?? 1;
    car.state.handbrake = Boolean(input.handbrake);
    car.state.spinning = Boolean(input.spinning);
    car.controller.SetDriverInput(0, input.steer || 0, input.hold ? 1 : 0, input.handbrake || input.hold ? 1 : 0);
    hit.speed = 0;
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / n;
    const id = car.body.GetID();
    const drive = isDrive(input.force, out.forward);
    for (let s = 0; s < n; s++) {
      read();
      car.controller.GetTransmission().Set(0, 0);
      // the force split over the tyres on the ground that take it (the driven ones under power), at their contact
      // patches along the car, each no more than its grip under the weight it carried in the last step
      let takers = 0;
      car.wheels.forEach((w, i) => { if (w.HasContact() && (!drive || car.driven[i])) takers++; });
      if (takers && input.force) {
        const share = input.force / takers;
        car.wheels.forEach((w, i) => {
          if (!w.HasContact() || (drive && !car.driven[i])) return;
          const load = Math.max(0, w.GetSuspensionLambda()) / h; // N pressing it on the ground
          const f = Math.sign(share) * Math.min(Math.abs(share), car.state.grip * load * 1.1);
          const p = w.GetContactPosition(), nrm = w.GetContactNormal();
          // the car's heading laid on the ground's plane
          const d = out.fx * nrm.GetX() + out.fy * nrm.GetY() + out.fz * nrm.GetZ();
          vec((out.fx - nrm.GetX() * d) * f, (out.fy - nrm.GetY() * d) * f, (out.fz - nrm.GetZ() * d) * f);
          bodies.AddForce(id, tmpV, rvec(p.GetX(), p.GetY(), p.GetZ()), Jolt.EActivation_Activate);
        });
      } else if (!takers && input.airDrag && !car.wheels.some((w) => w.HasContact())) {
        const speed = Math.hypot(out.vx, out.vy, out.vz);
        if (speed > 0.1) {
          const k = -input.airDrag / speed;
          bodies.AddForce(id, vec(out.vx * k, out.vy * k, out.vz * k), Jolt.EActivation_Activate);
        }
      }
      jolt.Step(h, 1);
    }
    read();
    let onGround = 0;
    out.wheels.length = car.wheels.length;
    car.wheels.forEach((w, i) => {
      const o = (out.wheels[i] ??= {});
      o.contact = w.HasContact();
      if (o.contact) onGround++;
      o.spin = w.GetRotationAngle();
      o.y = car.layout[i].attachY - w.GetSuspensionLength(); // the wheel's centre over the car's floor
    });
    out.contacts = onGround;
    // on its roof or its side, all but stopped, for a while: back on its wheels (no rocking it back by hand)
    if (out.uy < 0.35 && Math.hypot(out.vx, out.vz) < 1.5) car.upsideDown += dt;
    else car.upsideDown = 0;
    if (car.upsideDown > FLIP_RESCUE) {
      place(out.x, world.groundAt(out.x, out.z, out.y + 1) + 0.3, out.z, out.heading);
      read();
    }
    return out;
  }

  return { build, place, step, shove, confine, read, dropCar, get car() { return car; }, wallCount: () => walls.size };
}

export { createCarPhysics, wheelLayout, headingOf, isDrive };
