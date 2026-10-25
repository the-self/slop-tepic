// js/player/controllers/collisions.ts
// What the player bumps into: the buildings' and props' colliders bucketed into cells, a body's footprint against
// them (a circle, or the car's turned rectangle), pushed out of them, kept inside the map, and the collisions heard
import type * as THREE from 'three/webgpu';
import { ISLAND_BOUNDS, getIslandBoundsAtZ } from '../../world/city-config.ts';
import type {
  PlayerMode, CarEntity, PlayerEntity, PlayerCollider, CollisionEvent, Contact, CollisionShape
} from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// (size: the car's { halfW, halfL }, the model it is; a 4.5 m sedan's by default)
export function collisionBody(mode: PlayerMode, radius: number, heading: number, margin = 0,
  size: { halfW?: number; halfL?: number } | null = null): CollisionShape {
  const car = mode === 'car';
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const hx = (size?.halfW || 0.86) + margin, hz = (size?.halfL || 2.18) + margin;
  return {
    car, sin, cos, hx, hz, radius: radius + margin,
    extX: car ? Math.abs(cos) * hx + Math.abs(sin) * hz : radius + margin,
    extZ: car ? Math.abs(sin) * hx + Math.abs(cos) * hz : radius + margin,
    bottom: mode === 'helicopter' ? -0.25 : 0,
    top: mode === 'helicopter' ? 3.2 : car ? 1.8 : 1.9
  };
}

// Shared by movement and teleport clearance. World bounds reject distant boxes cheaply; the narrow phase
// uses a circle for walking/cycling/flying and all four separating axes for an oriented car rectangle.
export function buildingContact(c: PlayerCollider, x: number, y: number, z: number, body: CollisionShape, contact?: Contact): boolean {
  if (y + body.bottom >= (c.maxY ?? Infinity) || y + body.top <= (c.minY ?? 0)) return false;
  if (x + body.extX <= c.minX || x - body.extX >= c.maxX || z + body.extZ <= c.minZ || z - body.extZ >= c.maxZ) return false;
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const dx = x - (o ? o.cx : (c.minX + c.maxX) * 0.5);
  const dz = z - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  let nx = 0, nz = 0, depth = Infinity;
  if (body.car) {
    const ls = body.sin * cs - body.cos * sn, lc = body.sin * sn + body.cos * cs;
    for (let axis = 0; axis < 4; axis++) {
      const ax = axis === 0 ? 1 : axis === 1 ? 0 : axis === 2 ? lc : ls;
      const az = axis === 0 ? 0 : axis === 1 ? 1 : axis === 2 ? -ls : lc;
      const distance = lx * ax + lz * az;
      const overlap = hx * Math.abs(ax) + hz * Math.abs(az)
        + body.hx * Math.abs(ax * lc - az * ls) + body.hz * Math.abs(ax * ls + az * lc) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < depth) {
        depth = overlap;
        const sign = distance <= 0 ? -1 : 1;
        nx = ax * sign; nz = az * sign;
      }
    }
  } else {
    const qx = lx - Math.max(-hx, Math.min(hx, lx));
    const qz = lz - Math.max(-hz, Math.min(hz, lz));
    const distance = Math.hypot(qx, qz);
    if (distance >= body.radius) return false;
    if (distance > 0) {
      nx = qx / distance; nz = qz / distance;
      depth = body.radius - distance;
    } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) {
      nx = lx <= 0 ? -1 : 1;
      depth = hx - Math.abs(lx) + body.radius;
    } else {
      nz = lz <= 0 ? -1 : 1;
      depth = hz - Math.abs(lz) + body.radius;
    }
  }
  if (contact) {
    contact.nx = nx * cs + nz * sn;
    contact.nz = -nx * sn + nz * cs;
    contact.depth = depth;
  }
  return true;
}


export function setCollisionListener(ctl: ThirdPersonControllerManager, listener: ((event: CollisionEvent) => void) | null | undefined): void {
  ctl._collisionListener = typeof listener === 'function' ? listener : null;
  ctl._collisionEvent ??= { a: null, b: null, kind: '', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
}

// Reuse one synchronous event; consumers must copy retained fields. Normal points from b toward a.
export function reportCollision(ctl: ThirdPersonControllerManager, a: unknown, b: unknown, kind: string, x: number, y: number, z: number, nx: number, ny: number, nz: number, speed: number): void {
  const event = ctl._collisionEvent;
  if (!ctl._collisionListener || !event || speed <= 0.5) return;
  event.a = a; event.b = b; event.kind = kind;
  event.x = x; event.y = y; event.z = z;
  event.nx = nx; event.ny = ny; event.nz = nz; event.speed = speed;
  ctl._collisionListener(event);
}

// The colliders whose bounds come within `r` of (x, z), in their original order. They never move, so they are
// bucketed once into 48 m cells (tens of thousands of buildings: testing them all every frame cost ~0.5 ms)
// Is ground point (x, z) inside a building below `height`? (Things thrown about by knock-downs, mayhem.ts)
// (`minSize` m: leave out what is narrower than that both ways, the poles and bollards a walker steps round)
export function isSolidAt(ctl: ThirdPersonControllerManager, x: number, z: number, height = 1.5, ground = 0, minSize = 0): boolean {
  for (const c of ctl.nearColliders(x, z, 0)) {
    // (only what stands between the ground there, a hill's or the street's, and `height` over it)
    if ((c.minY ?? 0) > ground + height || (c.maxY ?? Infinity) <= ground || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (minSize > 0 && (c.obb ? Math.max(c.obb.hx, c.obb.hz) * 2 : Math.max(c.maxX - c.minX, c.maxZ - c.minZ)) < minSize) continue;
    if (!c.obb) return true;
    // the box's own frame: world = c + R_y(θ)·local, so local = R_y(−θ)·(p − c)
    const { cx, cz, hx, hz, cs, sn } = c.obb;
    const dx = x - cx, dz = z - cz;
    if (Math.abs(dx * cs - dz * sn) <= hx && Math.abs(dx * sn + dz * cs) <= hz) return true;
  }
  return false;
}

export function nearColliders(ctl: ThirdPersonControllerManager, x: number, z: number, r: number): PlayerCollider[] {
  const CELL = 48;
  const key = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);
  if (!ctl._colliderCells) {
    const cells = new Map<number, PlayerCollider[]>();
    ctl._colliderCells = cells;
    ctl.colliders.forEach((c, i) => {
      c._order = i;
      for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
        for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
          const k = key(ix, iz);
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(c);
        }
      }
    });
    ctl._nearList = [];
    ctl._nearStamp = 0;
  }
  const out = ctl._nearList;
  out.length = 0;
  const stamp = ++ctl._nearStamp;
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      const list = ctl._colliderCells.get(key(ix, iz));
      if (!list) continue;
      for (const c of list) {
        if (c._seen === stamp || c.broken) continue; // (a sign post knocked down, sim/mayhem.ts)
        c._seen = stamp;
        out.push(c);
      }
    }
  }
  for (const left of ctl.leftCars) {
    const k = left.collider;
    if (k.maxX >= x - r && k.minX <= x + r && k.maxZ >= z - r && k.minZ <= z + r) out.push(k);
  }
  // (an interior's walls & furniture: after the city's, which never come near it)
  if (ctl.interior) {
    for (const k of ctl.interior.colliders) {
      if (k.maxX >= x - r && k.minX <= x + r && k.maxZ >= z - r && k.minZ <= z + r) {
        k._order ??= 1e9;
        out.push(k);
      }
    }
  }
  if (out.length > 1) out.sort((a, b) => (a._order ?? 0) - (b._order ?? 0)); // (every one has its order by now)
  return out;
}

// The detailed city's edges and its shore (the helicopter may roam out beyond them): `pos` pulled back inside them.
// Whether it was outside
export function keepInBounds(ctl: ThirdPersonControllerManager, pos: { x: number; z: number }): boolean {
  const x = pos.x, z = pos.z;
  const heli = ctl.activeMode === 'helicopter';
  const m = heli ? 6000 : 0;
  pos.x = Math.max(ISLAND_BOUNDS.minX - m, Math.min(ISLAND_BOUNDS.maxX + m, pos.x));
  pos.z = Math.max(ISLAND_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(ISLAND_BOUNDS.maxZ + m, pos.z));
  if (!heli) {
    const shore = getIslandBoundsAtZ(pos.z);
    pos.x = Math.max(shore.westX + 8.0, Math.min(shore.eastX - 8.0, pos.x));
  }
  return pos.x !== x || pos.z !== z;
}

// Pushes `pos` out of the buildings around it: a body of `radius`, or with `carEntity` the car's footprint turned to
// its heading (the teleports' clearance; the car itself collides in Jolt, car-physics.ts); `entity`'s hits reported
export function resolveHorizontalCollision(ctl: ThirdPersonControllerManager, pos: THREE.Vector3, radius: number, carEntity: CarEntity | null = null, entity: PlayerEntity | null = carEntity): void {
  const heli = ctl.activeMode === 'helicopter';
  ctl.keepInBounds(pos);

  const body = collisionBody(ctl.activeMode, radius, carEntity ? carEntity.heading : 0, 0, carEntity);
  const { sin: sinH, cos: cosH, extX, extZ } = body;
  const contact = ctl._buildingContact ??= { nx: 0, nz: 0, depth: 0 };

  const reach = Math.max(extX, extZ) + 6;
  let gx = pos.x;
  let gz = pos.z;
  let near = ctl.nearColliders(gx, gz, reach);
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (buildingContact(c, pos.x, pos.y, pos.z, body, contact)) {
      const { nx, nz, depth } = contact;
      pos.x += nx * depth;
      pos.z += nz * depth;

      if (ctl._collisionListener && entity && entity.type !== 'person') {
        const sin = carEntity ? sinH : Math.sin(entity.heading);
        const cos = carEntity ? cosH : Math.cos(entity.heading);
        const approachSpeed = -((sin * entity.speed + (entity.vx || 0)) * nx + (cos * entity.speed + (entity.vz || 0)) * nz);
        const support = carEntity ? Math.abs(nx * cos - nz * sin) * body.hx + Math.abs(nx * sin + nz * cos) * body.hz : radius;
        ctl.reportCollision(entity, c, 'building', pos.x - nx * support, pos.y + (heli ? 1.1 : 0.56), pos.z - nz * support,
          nx, 0, nz, approachSpeed);
      }

      // A push that carried it far from where the candidates were gathered (dropped inside a building): gather
      // them again around where it is now, carrying on in the same order
      if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
        gx = pos.x;
        gz = pos.z;
        const order = c._order;
        near = ctl.nearColliders(gx, gz, reach);
        i = -1;
        while (i + 1 < near.length && (near[i + 1]._order ?? 0) <= (order ?? 0)) i++;
      }
    }
  }
}
