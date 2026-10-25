// js/player/controllers/ground.ts
// The ground under the player: the terrain, the town's floor, a bridge's deck, an interior's floor, the curbs a
// walker stands on, the tilt under a vehicle, and the hills too steep to walk up
import { ISLAND_BOUNDS, blockAt } from '../../world/city-config.ts';
import type { PlayerMode, PlayerEntity, PlayerRoom, GroundQuery } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// On a raised curb island (city-config.ts BLOCKS: the real blocks, malls & plazas), not in a park
export function isPointOnSidewalk(x: number, z: number): boolean {
  const b = blockAt(x, z);
  return !!b && !(b.park > 0.6 && !b.median);
}

// Into (a room: { minX, maxX, minZ, maxZ, floorAt(x, z, fromY), colliders }) or out of (null) an interior
export function setInterior(ctl: ThirdPersonControllerManager, room: PlayerRoom | null | undefined): void {
  ctl.interior = room ?? null;
}

export function getGroundHeight(ctl: ThirdPersonControllerManager, x: number, z: number, mode: PlayerMode = 'person', fromY?: number): number {
  const room = ctl.interior;
  if (room && x >= room.minX && x <= room.maxX && z >= room.minZ && z <= room.maxZ) return room.floorAt(x, z, fromY);
  // the ground (ground.ts): the town's floor, the hills over it & the river channels cut into it (under a bridge
  // for a body coming from `fromY` down in the channel); everyone stands on it, a walker on the curbs over the
  // town's floor (unless a hill rises above them, or it is down in a channel). With `fromY`, a road bridge's deck
  // the body is on or reaches up a ramp, never one overhead (ground.ts deckLift; Infinity: the topmost)
  const ground = ctl.terrainAt ? ctl.terrainAt(x, z, fromY) : 0;
  const deck = ctl.deckAt && fromY !== undefined ? ctl.deckAt(x, z, fromY - ground) : 0;
  if (deck > 0) return ground + deck;
  if (mode === 'person') {
    const town = ctl.floorHeight(x, z);
    if (ground < town - 0.01) return ground;
    return town + Math.max(ctl.isPointOnSidewalk(x, z) ? ISLAND_BOUNDS.sidewalkHeight : 0.0, ground - town);
  }
  return ground;
}

// The town's floor under (x, z) (ground.ts townHeight: its slopes, 0 in the flat city), the helicopter's
// altitudes are reckoned from
export function floorHeight(ctl: ThirdPersonControllerManager, x: number, z: number): number {
  return ctl.floorAt ? ctl.floorAt(x, z) : 0;
}

// The tilt of the ground under a body reaching `along` m ahead & behind and `across` m to either side of (x, z) facing
// `heading`, into out: { pitch, roll } for its root (Euler order YXZ: the nose up is a negative pitch, three's sense)
export function groundTilt(ctl: ThirdPersonControllerManager, x: number, z: number, heading: number, along: number, across: number,
  out: { pitch: number; roll: number }, y?: number): { pitch: number; roll: number } {
  out.pitch = out.roll = 0;
  if (!ctl.terrainAt) return out;
  const g = (px: number, pz: number) => ctl.getGroundHeight(px, pz, 'car', y); // (with y, a deck it is on)
  const fx = Math.sin(heading), fz = Math.cos(heading); // ahead; left is (fz, -fx)
  out.pitch = -Math.atan2(g(x + fx * along, z + fz * along) - g(x - fx * along, z - fz * along), 2 * along);
  out.roll = Math.atan2(g(x + fz * across, z - fx * across) - g(x - fz * across, z + fx * across), 2 * across);
  return out;
}

// The ground at (x, z) (ground.ts groundHeight: the hills over the town's floor, the river channels cut into it), for
// where everyone stands, the town's floor alone (townHeight), and the land without the channels (landHeight) for the
// slopes the player can't climb (a channel's banks are climbed out of, whatever their pitch). The vehicles left
// standing are set on it (they were built at y = 0)
// `deck(x, z, over)`: the lift of a bridge's deck at (x, z) a body `over` m over the ground reaches (ground.ts deckLift)
export function setTerrain(ctl: ThirdPersonControllerManager, ground: GroundQuery | null, floor: ((x: number, z: number) => number) | null = null,
  land: ((x: number, z: number) => number) | null = null, deck: ((x: number, z: number, over: number) => number) | null = null): void {
  ctl.terrainAt = typeof ground === 'function' ? ground : null;
  ctl.floorAt = typeof floor === 'function' ? floor : null;
  ctl.landAt = typeof land === 'function' ? land : null;
  ctl.deckAt = typeof deck === 'function' ? deck : null;
  for (const mode of ['person', 'car', 'cyclist', 'moto'] as const) {
    const e = ctl.entities[mode];
    e.position.y = ctl.getGroundHeight(e.position.x, e.position.z, mode);
    ctl.settle(e);
  }
}

// The hills: on foot the player scrambles up them as steep as 1:1 (rise over run; a step up anything steeper is
// undone); the helicopter can't sink into one. (The vehicles climb what their tyres can, in Jolt)
export function keepOffHills(ctl: ThirdPersonControllerManager, entity: PlayerEntity, prevX: number, prevZ: number): void {
  if (!ctl.terrainAt) return;
  if (ctl.activeMode === 'helicopter' && entity.type === 'helicopter') {
    const h = ctl.terrainAt(entity.position.x, entity.position.z);
    if (entity.position.y < h + 1.5) {
      entity.position.y = h + 1.5;
      if (entity.verticalSpeed < 0) entity.verticalSpeed = 0;
    }
    return;
  }
  const hill = ctl.landAt ?? ctl.terrainAt;
  const run = Math.hypot(entity.position.x - prevX, entity.position.z - prevZ);
  const rise = hill(entity.position.x, entity.position.z) - hill(prevX, prevZ);
  if (run > 1e-4 && rise > run) {
    // back where it was, and down on the ground there again (unless it is in the air, a jump), its speed bouncing back
    const onGround = entity.position.y <= ctl.getGroundHeight(entity.position.x, entity.position.z, ctl.activeMode, entity.position.y) + 0.02;
    entity.position.x = prevX;
    entity.position.z = prevZ;
    if (onGround) entity.position.y = ctl.getGroundHeight(prevX, prevZ, ctl.activeMode, entity.position.y);
    entity.speed *= -0.25;
  }
}
