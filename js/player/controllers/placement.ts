// js/player/controllers/placement.ts
// Putting the player somewhere: a teleport to a clear arrival (its whole footprint and chase view searched for
// room), and an entity settled at rest where it stands, laid on the slope
import { ISLAND_BOUNDS, getIslandBoundsAtZ } from '../../world/city-config.ts';
import { personGround } from './constants.ts';
import { collisionBody, buildingContact } from './collisions.ts';
import type { CarEntity, CyclistEntity, MotoEntity, PlayerEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

export function teleportActiveTo(ctl: ThirdPersonControllerManager, x: number, z: number, heading = Math.PI, savedAltitude: number | null = null): { x: number; z: number } {
  ctl.getUp(); // (a body lying somewhere stays there: the player arrives on its feet)
  const ent = ctl.getActiveEntity();
  ctl.resetInput();
  if (!Number.isFinite(heading)) heading = ent.heading;
  const heli = ctl.activeMode === 'helicopter';
  const floor = heli ? ctl.floorHeight(x, z) : 0; // (the helicopter flies up to 380 m over the town's floor)
  const altitude = heli ? Math.max(floor + 0.25, Math.min(floor + 380, savedAltitude ?? Math.max(floor + 92, ent.position.y))) : 0;
  const destination = ctl.findTeleportPosition(x, z, heading, altitude);
  if (destination) {
    ent.position.x = destination.x;
    ent.position.z = destination.z;
    ent.heading = heading;
    // (on top of a bridge's deck where one passes over: the street up there rather than the ground under it)
    ent.position.y = heli ? altitude : ctl.getGroundHeight(destination.x, destination.z, ctl.activeMode, Infinity);
  }
  ctl.settle(ent);
  return { x: ent.position.x, z: ent.position.z };
}

// At rest where it stands, with no motion or pose left over (teleports, getting in & out, parking)
export function settle(ctl: ThirdPersonControllerManager, ent: PlayerEntity): void {
  ent.speed = 0;
  if (ent.type === 'person') {
    ent.verticalVel = 0;
    ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, ctl);
    ent.crowd.begin();
    ent.crowd.add(ent.rig, 0);
    ent.crowd.end();
  } else if (ent.type === 'car') {
    ctl.tiltToGround(ent, 1);
    ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
    ent.impactArmed = false; // (a stop or jump in its velocity now is no crash, see checkImpact)
    ent.physicsPlaced = false; // (Jolt's body is set down here, at rest, see driveCar)
    if (ent.drive) ent.drive.shift = 0;
    ent.pitchVel = ent.rollVel = ent.heaveVel = 0; // (the traffic's last shove, see driveCar)
    ent.vy = 0;
    ent.flying = false;
    ent.lastCollisionSpark = null;
    for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
    if (ent.carState) ent.carState.value.x = 1;
  } else if (ent.type === 'cyclist' || ent.type === 'moto') {
    ctl.tiltToGround(ent, 1);
    ent.leanAngle = ent.leanPivot.rotation.z = 0;
    ent.vx = ent.vz = ent.steerInput = 0;
    ent.peak = undefined;
    ent.physicsPlaced = false; // (Jolt's body, ridden, is set down here at rest: driveTwoWheeler)
    if (ent.type === 'moto' && ent.drive) ent.drive.shift = 0;
    const { radius, rear, front } = ent.wheelSpots;
    ent.rearWheel.position.set(0, radius, rear);
    ent.frontWheel.position.set(0, radius, front - ent.steerPivot.position.z);
    ent.steerPivot.rotation.y = ent.shadow.rotation.z = 0;
  } else {
    ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
    ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
    ent.tiltPivot.position.y = 0;
  }
  ent.mesh.position.copy(ent.position);
  ent.mesh.rotation.y = ent.heading;
}

// Lays a vehicle left standing on the slope under its wheels (the tilt eased by k of the way, 1: at once): its whole
// body with the wheels & contact shadow; a bicycle or a moto only pitches (it leans on its stand)
export function tiltToGround(ctl: ThirdPersonControllerManager, ent: CarEntity | CyclistEntity | MotoEntity, k: number): void {
  const car = ent.type === 'car';
  const t = ctl.groundTilt(ent.position.x, ent.position.z, ent.heading, car ? 1.35 : 0.55, car ? 0.8 : 0.3, (ctl._tilt ??= { pitch: 0, roll: 0 }), ent.position.y);
  ent.groundPitch = (ent.groundPitch || 0) + (t.pitch - (ent.groundPitch || 0)) * k;
  ent.groundRoll = car ? (ent.groundRoll || 0) + (t.roll - (ent.groundRoll || 0)) * k : 0;
  ent.mesh.rotation.order = 'YXZ';
  ent.mesh.rotation.x = ent.groundPitch;
  ent.mesh.rotation.z = ent.groundRoll;
}

// Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
// between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
export function findTeleportPosition(ctl: ThirdPersonControllerManager, x: number, z: number, heading: number, altitude: number): { x: number; z: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const heli = ctl.activeMode === 'helicopter';
  const radius = heli ? 4.5 : ctl.activeMode === 'person' ? 0.48 : 0.65;
  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  const shape = collisionBody(ctl.activeMode, radius, heading, 0.1, ctl.entities.car);
  const reach = Math.max(shape.extX, shape.extZ);
  const margin = heli ? 6000 : 0;
  const entity = ctl.getActiveEntity();
  // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
  const carReach = Math.max(2.4, (ctl.entities.car.halfL || 2.18) + 0.25);
  const body = { person: [0.48, 1.9], car: [carReach, 1.9], cyclist: [1.0, 1.9], moto: [1.1, 1.9], helicopter: [6.2, 3.2] };
  const others = Object.values(ctl.entities).filter(e => e !== entity).map(e => ({
    x: e.position.x, z: e.position.z, radius: body[e.type][0],
    bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + body[e.type][1]
  }));
  const cameraBack = Math.cos(0.09) * entity.chaseDistance;
  const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
  const clampPoint = (px: number, pz: number) => {
    pz = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + margin, pz));
    px = Math.max(ISLAND_BOUNDS.minX - margin, Math.min(ISLAND_BOUNDS.maxX + margin, px));
    if (!heli) {
      const shore = getIslandBoundsAtZ(pz);
      const west = shore.westX + 8, east = shore.eastX - 8;
      if (west > east) return null;
      px = Math.max(west, Math.min(east, px));
    }
    return { x: px, z: pz };
  };
  const clear = (p: { x: number; z: number } | null) => {
    if (!p) return false;
    const baseY = heli ? altitude : ctl.getGroundHeight(p.x, p.z, ctl.activeMode);
    // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
    // parked car between camera and character from hiding the character even when the camera itself is outside it.
    const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
    for (const other of others) {
      if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
      const dx = other.x - p.x, dz = other.z - p.z;
      const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
      if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
    }
    for (const c of ctl.nearColliders(p.x, p.z, reach)) {
      if (buildingContact(c, p.x, baseY, p.z, shape)) return false;
    }
    return true;
  };
  const origin = clampPoint(x, z);
  if (clear(origin)) return origin;
  // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
  const cx = origin ? origin.x : Math.max(ISLAND_BOUNDS.minX, Math.min(ISLAND_BOUNDS.maxX, x));
  const cz = origin ? origin.z : Math.max(ISLAND_BOUNDS.minZ + 30, Math.min(ISLAND_BOUNDS.maxZ, z));
  for (let distance = 4; distance <= 256; distance += 4) {
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
      if (clear(p)) return p;
    }
  }
  return null;
}
