// js/sim/traffic/update.ts
// The traffic's frame: the signals, the focus and the player, then the cars & buses (placed, driven, drawn), the
// pedestrians, and the sparks
import type * as THREE from 'three/webgpu';
import { signalPhase, walkSignal } from '../../world/city-config.ts';
import {
  KNOCK_SPEED, MASS, MASS_OF_BODY, NEAR_RADIUS, NUM_PEDS, PED_RADIUS, VEHICLE_RADIUS, onRoad, ridden
} from './constants.ts';
import type { TrafficPlayerEntity } from './types.ts';
import type { TrafficState } from './state.ts';
import { hillAt, roadLift, surfaceAt } from './surface.ts';
import { updateView, visible } from './view.ts';
import { refreshNear } from './near.ts';
import { buildOccupancy } from './occupancy.ts';
import { relateToPlayer } from './idm.ts';
import { drive } from './driving.ts';
import { groundPitch, knock, locate, pose } from './motion.ts';
import { collideWithPlayer, knockOn } from './collisions.ts';
import { crash, crashedStep, crashes, smokeFrom } from './crashes.ts';
import { mishaps } from './mishaps.ts';
import { spawnCollisionSparks, updateSparks } from './sparks.ts';
import { flagAttribute, flagRange, renderBus, renderCar, updateTrafficLights } from './render.ts';
import { knockPed, playerHitsPed, renderPed, tumblePed } from './peds.ts';
import { gatherBodies } from './bodies.ts';
import { contactRider, renderBike, renderWreck } from './two-wheelers.ts';
import { bailWalk, renderBailed } from './carjacking.ts';
import { spawnPed, spawnVehicle } from './spawning.ts';
import { gatherCurbs } from './sidewalks.ts';
import { meet, walk } from './walking.ts';
import { rideStep } from './pickups.ts';
import { allowance, kindOf, retirePed, retireVehicle } from './population.ts';

function update(ts: TrafficState, dt: number, elapsed: number, focusPos: { x: number; z: number } | null = null, playerEntity: TrafficPlayerEntity | null = null, activeMode = 'car', camera: THREE.Camera | null = null): void {
  ts.clock = elapsed;
  ts.avePhase = signalPhase(elapsed, true);
  ts.stPhase = signalPhase(elapsed, false);
  ts.aveWalk = walkSignal(elapsed, true);
  ts.stWalk = walkSignal(elapsed, false);
  ts.focusX = focusPos ? focusPos.x : 0;
  ts.focusZ = focusPos ? focusPos.z : 140;
  // a jump of the camera (teleport, first frame): everything far away can be placed anywhere around it
  const jump = Math.hypot(ts.focusX - ts.lastFocusX, ts.focusZ - ts.lastFocusZ) > 140;
  ts.lastFocusX = ts.focusX;
  ts.lastFocusZ = ts.focusZ;
  refreshNear(ts);
  updateView(ts, camera);

  // (on the street: not up on a roof, nor flying; measured from the ground, which the town's slopes raise)
  ts.player.active = Boolean(playerEntity && activeMode !== 'helicopter' &&
    playerEntity.position.y - surfaceAt(ts, playerEntity.position.x, playerEntity.position.z, playerEntity.position.y) < 2.6);
  if (playerEntity) {
    const heading = playerEntity.heading || 0;
    const speed = playerEntity.speed || 0;
    ts.player.entity = playerEntity;
    ts.player.x = playerEntity.position.x;
    ts.player.z = playerEntity.position.z;
    ts.player.vx = Math.sin(heading) * speed + (playerEntity.vx || 0);
    ts.player.vz = Math.cos(heading) * speed + (playerEntity.vz || 0);
  }
  // (the player's car: the size and weight of the model it is, controllers.ts setCarLook)
  ts.player.halfW = activeMode === 'cyclist' ? 0.35 : activeMode === 'person' ? 0.32 : playerEntity?.halfW || 0.86;
  ts.player.halfL = activeMode === 'cyclist' ? 0.85 : activeMode === 'person' ? 0.32 : playerEntity?.halfL || 2.18;
  ts.player.mass = activeMode === 'cyclist' ? MASS.bike : activeMode === 'person' ? MASS.person
    : playerEntity?.spec?.mass || MASS_OF_BODY[playerEntity?.look?.bodyType ?? ''] || MASS.sedan;
  ts.player.mode = activeMode;
  ts.player.heading = playerEntity ? playerEntity.heading || 0 : 0;
  ts.player.speed = Math.hypot(ts.player.vx, ts.player.vz);
  ts.player.knocks = ts.player.active && (activeMode === 'car' || activeMode === 'cyclist' || activeMode === 'moto') && ts.player.speed > KNOCK_SPEED;
  // (a body in Jolt itself: what it crashes into goes into Jolt too, crash)
  ts.player.jolt = Boolean(ts.physics && ts.player.active && playerEntity?.vehicle && activeMode !== 'person');

  // the cars thrown about in a crash where Jolt left them, then everything the traffic steers round
  crashedStep(ts, dt);
  ts.parked.length = 0;
  for (const o of ts.parkedOutside) ts.parked.push(o);
  for (const o of ts.crashedObstacles) ts.parked.push(o);

  // 1. Cars & buses
  // Limit attempted placements, not just successes, and rotate through the pool so an awkward location
  // cannot monopolize a frame. Previous-frame lane lists protect spawn spacing; rebuild before driving.
  // Only as many on the streets as the hour and the place have (weighNear): those over it leave once out of sight
  // and away from the player, and come back as it grows
  allowance(ts);
  let budget = jump ? ts.vehicles.length : 4;
  let retire = jump ? Infinity : 2;
  for (let scanned = 0; scanned < ts.vehicles.length && budget > 0; scanned++) {
    const v = ts.vehicles[ts.vehicleCursor];
    ts.vehicleCursor = (ts.vehicleCursor + 1) % ts.vehicles.length;
    if (v.wreck || v.crash) continue; // a knocked-over cyclist stays where it fell for now, a crashed car in Jolt
    const k = kindOf(v);
    const d = v.edge ? Math.hypot(v.x - ts.focusX, v.z - ts.focusZ) : Infinity;
    if (d <= (jump ? NEAR_RADIUS : VEHICLE_RADIUS)) {
      if (ts.active[k] > ts.allowed[k] && retire > 0 && d > 120 && !(ts.hasView && visible(ts, v.x, v.z, v.half + 2, (v.hy || 0) + 1))) {
        retireVehicle(v);
        ts.active[k]--;
        retire--;
      }
      continue;
    }
    if (ts.active[k] - (v.edge ? 1 : 0) >= ts.allowed[k]) {
      if (v.edge) {
        retireVehicle(v);
        ts.active[k]--;
      }
      continue;
    }
    budget--;
    const had = !!v.edge;
    if (spawnVehicle(ts, v, jump ? 0 : 100, NEAR_RADIUS, !jump) && !had) ts.active[k]++;
  }
  buildOccupancy(ts);
  for (const m of ts.bodyMeshes) m.count = 0;
  ts.litVehicleCount = 0;
  ts.wheelCars = 0;
  ts.visibleCars = 0;
  ts.policeDrawn = 0;
  ts.combisDrawn = 0;
  ts.visibleBuses = 0;
  ts.riderCrowd.begin();
  for (const kit of ts.kits) kit.drawn = 0;
  for (const v of ts.vehicles) {
    if (v.wreck) {
      renderWreck(ts, v, dt);
      continue;
    }
    if (v.crash) {
      renderCar(ts, v);
      continue;
    }
    if (!onRoad(v)) continue;

    v.prevX = v.x;
    v.prevZ = v.z;
    relateToPlayer(ts, v);
    drive(ts, v, dt);
    locate(ts, v);
    knock(ts, v, dt);
    pose(v, dt);
    v.hy = hillAt(ts, v.x, v.z) + roadLift(v, v.x, v.z); // (over a bridge or up a ramp, its deck)
    v.gp = groundPitch(ts, v);
    if (ridden(v)) {
      if (ts.player.active && contactRider(ts, v)) {
        renderWreck(ts, v, 0);
        continue;
      }
    } else if (!v.bus && (ts.player.jolt || ts.crashed.length) && crashes(ts, v) && crash(ts, v)) {
      // (in Jolt from here: the crash itself is its contact with what it ran into)
      renderCar(ts, v);
      continue;
    } else if (ts.player.active) collideWithPlayer(ts, v, v.yaw + v.yawOffset, v.bus ? 1.30 : v.halfWidth, v.bus ? 5.72 : v.half - 0.07);
    if (v.vx * v.vx + v.vz * v.vz > 0.36) knockOn(ts, v);
    if (v.damage) smokeFrom(ts, v, dt);

    if (ridden(v)) {
      if (!ts.hasView || visible(ts, v.x, v.z, 3, (v.hy || 0) + 1)) renderBike(ts, v, dt);
    } else if (v.bus) renderBus(ts, v);
    else renderCar(ts, v);
  }
  mishaps(ts, dt);
  ts.riderCrowd.end();
  for (const kit of ts.kits) {
    kit.frame.count = kit.wheels.count = kit.drawn;
    if (!kit.drawn) continue;
    flagRange(kit.frame.instanceMatrix, kit.drawn);
    flagRange(kit.wheels.instanceMatrix, kit.drawn);
    if (kit.frame.instanceColor) flagRange(kit.frame.instanceColor, kit.drawn);
  }
  const hideEmpty = ++ts.updates > 2;
  for (const m of ts.bodyMeshes) {
    const n = m.count;
    m.visible = n > 0 || !hideEmpty;
    if (n === 0) {
      if (!hideEmpty) {
        m.setMatrixAt(0, ts.zero);
        m.count = 1;
        flagRange(m.instanceMatrix, 1);
      }
      continue;
    }
    flagRange(m.instanceMatrix, n);
    if (ts.dirtyPaint.has(m)) flagAttribute(m.geometry, 'paintColor', n);
    if (ts.dirtyState.has(m)) flagAttribute(m.geometry, 'carState', n);
  }
  ts.dirtyPaint.clear();
  ts.dirtyState.clear();
  const syncInst = (inst: THREE.InstancedMesh, n: number) => {
    inst.visible = n > 0 || !hideEmpty;
    if (n === 0) {
      if (!hideEmpty) {
        inst.setMatrixAt(0, ts.zero);
        inst.count = 1;
        flagRange(inst.instanceMatrix, 1);
      } else {
        inst.count = 0;
      }
      return;
    }
    inst.count = n;
    flagRange(inst.instanceMatrix, n);
  };
  syncInst(ts.carWheelLeftInst, ts.wheelCars * 2);
  syncInst(ts.carWheelRightInst, ts.wheelCars * 2);
  syncInst(ts.policeLightbarInst, ts.policeDrawn);
  syncInst(ts.combiSignInst, ts.combisDrawn);
  if (ts.combisDrawn > 0) flagRange(ts.combiSignRows, ts.combisDrawn);
  syncInst(ts.carShadowInst, ts.visibleCars);
  syncInst(ts.busBodyInst, ts.visibleBuses);
  syncInst(ts.busHeaderInst, ts.visibleBuses);
  syncInst(ts.busWheelLeftInst, ts.visibleBuses * 2);
  syncInst(ts.busWheelRightInst, ts.visibleBuses * 2);
  syncInst(ts.busShadowInst, ts.visibleBuses);
  if (ts.visibleBuses > 0) {
    flagRange(ts.busStates, ts.visibleBuses);
    flagRange(ts.busSignRows, ts.visibleBuses);
  }
  updateTrafficLights(ts);

  // 2. Pedestrians (who keep out of the vehicles where they now stand)
  gatherBodies(ts);
  for (const n of ts.walkedNodes) n.walkers.length = 0;
  ts.walkedNodes.length = 0;
  let pedBudget = jump ? NUM_PEDS : 6;
  let pedRetire = jump ? Infinity : 3;
  let out = 0;
  for (const p of ts.peds) if (p.placed) out++;
  for (let scanned = 0; scanned < NUM_PEDS && pedBudget > 0; scanned++) {
    const p = ts.peds[ts.pedCursor];
    ts.pedCursor = (ts.pedCursor + 1) % NUM_PEDS;
    const d = p.placed ? Math.hypot(p.x - ts.focusX, p.z - ts.focusZ) : Infinity;
    if (d <= (jump ? NEAR_RADIUS : PED_RADIUS)) {
      // more out than the hour has: one out of sight goes home
      if (out > ts.pedTarget && pedRetire > 0 && d > 50 && !p.bail && !p.fallen && !(ts.hasView && visible(ts, p.x, p.z, 2))) {
        retirePed(ts, p);
        out--;
        pedRetire--;
      }
      continue;
    }
    if (out - (p.placed ? 1 : 0) >= ts.pedTarget) {
      if (p.placed) {
        retirePed(ts, p);
        out--;
      }
      continue;
    }
    if (!p.placed) out++;
    pedBudget--;
    ts.ragdolls?.release(p.fallen);
    p.fallen = null; // (a knocked-over pedestrian left far behind gets up elsewhere)
    p.bail = null; // (and so does a driver left behind)
    spawnPed(ts, p, jump ? 0 : 60, jump ? NEAR_RADIUS : 280, !jump);
  }
  meet(ts, dt);
  gatherCurbs(ts);
  ts.pedCrowd.begin();
  for (let i = 0; i < NUM_PEDS; i++) {
    const p = ts.peds[i];
    if (!p.placed) continue;
    if (p.fallen) {
      tumblePed(ts, p, dt);
      continue;
    }
    if (p.bail) bailWalk(ts, p, dt);
    else if (p.ride) {
      if (!rideStep(ts, p, dt)) continue; // (got on)
    } else walk(ts, p, dt);
    const hit = playerHitsPed(ts, p);
    if (hit) {
      knockPed(ts, p, hit);
      tumblePed(ts, p, 0);
      continue;
    }
    if (p.bail) renderBailed(ts, p, dt);
    else renderPed(ts, p, dt);
  }
  ts.pedCrowd.end();

  // 3. Collision sparks, including the player's own impacts against buildings
  if (playerEntity?.lastCollisionSpark) {
    const bs = playerEntity.lastCollisionSpark;
    spawnCollisionSparks(ts, bs.x, bs.y, bs.z, bs.nx, bs.nz, bs.speed, playerEntity.position.y); // (over its road)
    playerEntity.lastCollisionSpark = null;
  }
  updateSparks(ts, dt);
}

export { update };
