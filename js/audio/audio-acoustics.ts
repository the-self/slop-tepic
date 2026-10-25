// js/audio/audio-acoustics.ts
// Cheap outdoor obstruction using the same static building bounds as movement. Nearby bounds are cached;
// only audible voices trace them, a few times per second. This deliberately avoids mesh raycasts or audio-rate DSP.

/** A point in the world, m */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A building's collision bounds as the audio reads them (world/buildings.ts `Collider`): its AABB in m, from its foot
 * (0 when it has none) to its top, and the oriented box inside it for one turned off the grid (centre, half-sizes, cos / sin)
 */
export interface AcousticCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY: number;
  obb?: { cx: number; cz: number; hx: number; hz: number; cs: number; sn: number } | null;
}

/** What the acoustics needs of the player's controllers: the colliders within `r` m of (x, z) */
export interface ColliderQuery {
  nearColliders(x: number, z: number, r: number): Iterable<AcousticCollider>;
}

// (the length, m, of the segment a → b inside the box)
function thickness(c: AcousticCollider, ax: number, ay: number, az: number, bx: number, by: number, bz: number, allowEndInside = false) {
  let minX = c.minX, maxX = c.maxX, minZ = c.minZ, maxZ = c.maxZ;
  if (c.obb) {
    const o = c.obb;
    const x0 = ax - o.cx, z0 = az - o.cz, x1 = bx - o.cx, z1 = bz - o.cz;
    ax = x0 * o.cs - z0 * o.sn; az = x0 * o.sn + z0 * o.cs;
    bx = x1 * o.cs - z1 * o.sn; bz = x1 * o.sn + z1 * o.cs;
    minX = -o.hx; maxX = o.hx; minZ = -o.hz; maxZ = o.hz;
  }
  const minY = c.minY ?? 0, maxY = c.maxY;
  // A chase camera can briefly enter a conservative collision box. Do not silence the entire city in that case.
  if (ax > minX && ax < maxX && az > minZ && az < maxZ && ay > minY && ay < maxY) return 0;
  if (!allowEndInside && bx > minX && bx < maxX && bz > minZ && bz < maxZ && by > minY && by < maxY) return 0;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let enter = 0, exit = 1;
  if (Math.abs(dx) < 1e-7) {
    if (ax <= minX || ax >= maxX) return 0;
  } else {
    const a = (minX - ax) / dx, b = (maxX - ax) / dx;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (Math.abs(dz) < 1e-7) {
    if (az <= minZ || az >= maxZ) return 0;
  } else {
    const a = (minZ - az) / dz, b = (maxZ - az) / dz;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (Math.abs(dy) < 1e-7) {
    if (ay <= minY || ay >= maxY) return 0;
  } else {
    const a = (minY - ay) / dy, b = (maxY - ay) / dy;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return Math.max(0, exit - enter) * Math.hypot(dx, dy, dz);
}

class CityAcoustics {
  controllers: ColliderQuery;
  /** The tall buildings within 200 m of the listener, refreshed every 0.5 s or 20 m */
  buildings: AcousticCollider[];
  nextRefresh: number;
  /** How walled-in the listener is, 0 (open) .. 1 */
  enclosure: number;
  x: number;
  y: number;
  z: number;

  constructor(controllerManager: ColliderQuery) {
    this.controllers = controllerManager;
    this.buildings = [];
    this.nextRefresh = 0;
    this.enclosure = 0;
    this.x = Infinity;
    this.y = Infinity;
    this.z = Infinity;
  }

  update(listener: Point3, now: number) {
    if (now < this.nextRefresh && Math.hypot(listener.x - this.x, listener.y - this.y, listener.z - this.z) < 20) return;
    this.x = listener.x; this.y = listener.y; this.z = listener.z;
    this.nextRefresh = now + 0.5;
    this.buildings.length = 0;
    // Obstructions near the listener dominate street-level sound; distant geometry need not join this cache.
    for (const c of this.controllers.nearColliders(this.x, this.z, 200)) {
      // (over 3 m tall: from its base, which the town's slopes raise)
      if (c.maxY - (c.minY ?? 0) > 3 && c.maxX - c.minX > 2 && c.maxZ - c.minZ > 2) this.buildings.push(c);
    }

    // Eight rising probes estimate nearby reflective walls, including their height. Reuse the bounds cache
    // at 2 Hz: narrow streets are enclosed, while parks, waterfronts and positions above roofs are open.
    let covered = 0;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const x = this.x + Math.cos(angle) * 80, z = this.z + Math.sin(angle) * 80;
      let depth = 0;
      for (const c of this.buildings) {
        depth = Math.max(depth, thickness(c, this.x, this.y, this.z, x, this.y + 40, z, true));
        if (depth > 40) break;
      }
      covered += 1 - Math.exp(-depth * 0.1);
    }
    this.enclosure = covered / 8;
  }

  // How much of the direct path from `source` (raised `height` m) to the listener the buildings block, 0..1
  obstruction(source: Point3, listener: Point3, height = 0) {
    const dx = source.x - listener.x, dz = source.z - listener.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 3) return 0;
    const sideX = -dz / distance * 0.9, sideZ = dx / distance * 0.9;
    let blocked = 0;
    // A small aperture smooths corners: one centre path and two neighbouring paths approximate partial cover.
    for (let ray = -1; ray <= 1; ray++) {
      const ox = sideX * ray, oz = sideZ * ray;
      let depth = 0;
      for (const c of this.buildings) {
        depth = Math.max(depth, thickness(c, listener.x + ox, listener.y, listener.z + oz,
          source.x + ox, source.y + height, source.z + oz));
        if (depth > 10) break;
      }
      blocked += 1 - Math.exp(-depth * 0.45);
    }
    return blocked / 3;
  }
}

export { CityAcoustics };
