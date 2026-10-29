// js/places/forum/build/exterior.ts
// Forum Tepic from outside: its buildings' walls in cream render on their outlines (a grey foot, a parapet), the
// ochre panels on Liverpool and beside the doors, the flat roofs with the long lanterns of glass over the voids and
// the white dome over the rotunda, the glass entrances under their white canopies with FORUM over them, the big signs
// (LIVERPUL, SEARS, CINEMEX, SUBURBIOS, PLAYCITY CASINO) and the Fiesta Inn's tower over its podium.
import type * as THREE from 'three/webgpu';
import { DOOR_H, FLOOR, FORUM, LANTERN, ROOF, at, outerRuns } from '../plan.ts';
import { MeshList, addMesh } from '../../kit/mesh-list.ts';
import type { ForumBuilding, ForumPlan } from '../plan.ts';
import type { ForumMaterials } from './materials.ts';
import type { SignAtlas } from './signs.ts';

type Vec2 = [number, number];

const PARAPET = 1.0; // m over the roof
const PIECE = 15; // m: the longest piece of wall set on the floor under its middle

/** The walls' outward normal of building b's edge a → b */
function outward(b: ForumBuilding, ax: number, az: number, bx: number, bz: number): Vec2 {
  const L = Math.hypot(bx - ax, bz - az) || 1;
  let nx = (bz - az) / L, nz = -(bx - ax) / L;
  // (pointing away from the inside)
  const mx = (ax + bx) / 2 + nx * 0.3, mz = (az + bz) / 2 + nz * 0.3;
  let inside = false;
  for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
    const [xi, zi] = b.ring[i], [xj, zj] = b.ring[j];
    if (zi > mz !== zj > mz && mx < ((xj - xi) * (mz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (inside) { nx = -nx; nz = -nz; }
  return [nx, nz];
}

/** A sign of the atlas: a lit panel `w` x `h` m on a wall along (dx, dz) at (x, z), facing (nx, nz), its middle y */
function sign(g: MeshList, atlas: SignAtlas, name: string, x: number, z: number, nx: number, nz: number, w: number, h: number, y: number): void {
  const dx = -nz, dz = nx; // (along the wall, to the right as we face it)
  const [u0, v0, u1, v1] = atlas.slot(name);
  g.face(x - dx * w / 2 + nx * 0.12, z - dz * w / 2 + nz * 0.12, x + dx * w / 2 + nx * 0.12, z + dz * w / 2 + nz * 0.12, y - h / 2, y + h / 2, nx, nz, [u0, v0, u1, v1]);
}

export function buildExterior(group: THREE.Group, mats: ForumMaterials, atlas: SignAtlas, base: (x: number, z: number) => number): void {
  const P: ForumPlan = FORUM;
  const render = new MeshList(), foot = new MeshList(), ochre = new MeshList(), roof = new MeshList(), glass = new MeshList();
  const lantern = new MeshList(), canopy = new MeshList(), signs = new MeshList(), hotel = new MeshList(), apron = new MeshList();
  const dome = new MeshList();

  // THE WALLS: every outer run, in pieces stood on the floor under them, from below the floor up to the parapet (where
  // a lower building of the complex stands against it, from its roof up)
  const longest = new Map<ForumBuilding, { x: number; z: number; nx: number; nz: number; L: number; score: number }>();
  for (const b of P.buildings) {
    for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
      for (const [ax, az, bx, bz, low] of outerRuns(b, j, i, P.buildings, P.entrances)) {
        const L = Math.hypot(bx - ax, bz - az), [nx, nz] = outward(b, ax, az, bx, bz);
        const n = Math.max(1, Math.ceil(L / PIECE));
        for (let k = 0; k < n; k++) {
          const px = ax + ((bx - ax) * k) / n, pz = az + ((bz - az) * k) / n, qx = ax + ((bx - ax) * (k + 1)) / n, qz = az + ((bz - az) * (k + 1)) / n;
          const y = base((px + qx) / 2, (pz + qz) / 2);
          render.face(px, pz, qx, qz, y + (low ? low : -1.2), y + b.height + PARAPET, nx, nz);
          if (!low) foot.face(px + nx * 0.03, pz + nz * 0.03, qx + nx * 0.03, qz + nz * 0.03, y - 1.2, y + 0.6, nx, nz);
          // (the coping's grey edge along the parapet's top)
          foot.face(px + nx * 0.04, pz + nz * 0.04, qx + nx * 0.04, qz + nz * 0.04, y + b.height + PARAPET - 0.35, y + b.height + PARAPET, nx, nz);
          // the sidewalk round it: 4 m of concrete out to the car park
          if (!low) apron.polygon([[px, pz], [qx, qz], [qx + nx * 4, qz + nz * 4], [px + nx * 4, pz + nz * 4]], [], () => FLOOR + 0.015);
          // (the parapet's coping, its inner face)
          roof.face(px - nx * 0.25, pz - nz * 0.25, qx - nx * 0.25, qz - nz * 0.25, y + b.height, y + b.height + PARAPET, -nx, -nz);
        }
        // Liverpool's long walls with an ochre panel in the middle, below the parapet
        if (b.name === 'Liverpool' && !low && L > 24) {
          const t0 = 0.22, t1 = 0.78, y = base((ax + bx) / 2, (az + bz) / 2);
          ochre.face(ax + (bx - ax) * t0 + nx * 0.15, az + (bz - az) * t0 + nz * 0.15, ax + (bx - ax) * t1 + nx * 0.15, az + (bz - az) * t1 + nz * 0.15, y + 2.2, y + b.height - 0.4, nx, nz);
        }
        // the face each anchor's sign goes on: its longest wall looking out, the one towards the boulevard first (-z)
        if (!low) {
          const score = L * (1.2 - nz);
          const best = longest.get(b);
          if (!best || score > best.score) longest.set(b, { x: (ax + bx) / 2, z: (az + bz) / 2, nx, nz, L, score });
        }
      }
    }
  }

  // THE ROOFS: each building's outline at its height, the mall's open over its voids and the rotunda's dome
  const R = P.rotunda;
  const circle = (r: number, n = 32): Vec2[] => Array.from({ length: n }, (_, k): Vec2 => [R.x + Math.cos((k / n) * 2 * Math.PI) * r, R.z + Math.sin((k / n) * 2 * Math.PI) * r]);
  for (const b of P.buildings) {
    const holes = b.name === 'Forum' ? [...P.voids, circle(R.r)] : [];
    roof.polygon(b.ring, holes, (x, z) => base(x, z) + b.height);
  }
  // the lanterns: a band of glass round each void from the roof up, a white top over it with its strip of skylight
  for (const v of P.voids) {
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const [ax, az] = v[j], [bx, bz] = v[i], L = Math.hypot(bx - ax, bz - az) || 1;
      // (facing out of the void: the ring's own winding decides which side)
      let nx = (bz - az) / L, nz = -(bx - ax) / L;
      const mx = (ax + bx) / 2 + nx * 0.3, mz = (az + bz) / 2 + nz * 0.3;
      let inside = false;
      for (let p = 0, q = v.length - 1; p < v.length; q = p++) {
        const [xi, zi] = v[p], [xj, zj] = v[q];
        if (zi > mz !== zj > mz && mx < ((xj - xi) * (mz - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) { nx = -nx; nz = -nz; }
      const y = base((ax + bx) / 2, (az + bz) / 2);
      lantern.face(ax, az, bx, bz, y + ROOF, y + LANTERN - 0.35, nx, nz);
      render.face(ax, az, bx, bz, y + LANTERN - 0.35, y + LANTERN + 0.25, nx, nz);
      canopy.face(ax, az, bx, bz, y + LANTERN - 0.35, y + LANTERN, -nx, -nz);
    }
    const strips = P.skylights.filter((s) => s.every(([x, z]) => {
      let c = false;
      for (let p = 0, q = v.length - 1; p < v.length; q = p++) {
        const [xi, zi] = v[p], [xj, zj] = v[q];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    }));
    roof.polygon(v, strips, (x, z) => base(x, z) + LANTERN);
    for (const s of strips) lantern.polygon(s, [], (x, z) => base(x, z) + LANTERN - 0.05);
  }
  // the rotunda: a drum of glass on the roof, a shallow white dome over it (its inside the ceiling's white)
  {
    const y = base(R.x, R.z), n = 32;
    const ring = circle(R.r, n);
    for (let k = 0; k < n; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n], a = ((k + 0.5) / n) * 2 * Math.PI;
      lantern.face(ax, az, bx, bz, y + ROOF, y + ROOF + 2.4, Math.cos(a), Math.sin(a));
      render.face(ax, az, bx, bz, y + ROOF + 2.4, y + ROOF + 2.9, Math.cos(a), Math.sin(a));
      canopy.face(ax, az, bx, bz, y + ROOF + 2.4, y + ROOF + 2.9, -Math.cos(a), -Math.sin(a));
    }
    // (a cap of a sphere, 5 m high over the drum, its normals outward: the roof's top outside, its ceiling within)
    const rise = 5, sphere = (R.r * R.r + rise * rise) / (2 * rise), rings = 8;
    const i0 = dome.count;
    for (let r = 0; r <= rings; r++) {
      const t = r / rings, rr = R.r * (1 - t), yy = Math.sqrt(Math.max(0, sphere * sphere - rr * rr)) - (sphere - rise);
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * 2 * Math.PI, x = R.x + Math.cos(a) * rr, z = R.z + Math.sin(a) * rr;
        dome.pos.push(x, y + ROOF + 2.9 + yy, z);
        const ny = (yy + sphere - rise) / sphere;
        dome.nor.push((Math.cos(a) * rr) / sphere, ny, (Math.sin(a) * rr) / sphere);
        dome.uvs.push(x, z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < n; k++) {
        const a = i0 + r * (n + 1) + k, b = a + n + 1;
        dome.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // THE ENTRANCES: a box of glass standing out of the facade, a white canopy over it, ochre pylons either side, FORUM
  for (const e of P.entrances) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L;
    const y = base((e.ax + e.bx) / 2, (e.az + e.bz) / 2), H = e.height;
    const fa: Vec2 = [e.ax + e.nx * e.out, e.az + e.nz * e.out], fb: Vec2 = [e.bx + e.nx * e.out, e.bz + e.nz * e.out];
    // the front's glass and its sides' over the doors' transom (under it the panes a car breaks: index.ts)
    glass.face(fa[0], fa[1], fb[0], fb[1], y + DOOR_H, y + H, e.nx, e.nz);
    glass.face(e.ax, e.az, fa[0], fa[1], y + DOOR_H, y + H, -dx, -dz);
    glass.face(e.bx, e.bz, fb[0], fb[1], y + DOOR_H, y + H, dx, dz);
    // the canopy: a white slab over it, reaching out 2 m past its front
    canopy.box({ cx: (e.ax + e.bx) / 2 + e.nx * (e.out + 2) / 2, cz: (e.az + e.bz) / 2 + e.nz * (e.out + 2) / 2, hu: L / 2 + 1, hv: (e.out + 2) / 2,
      cs: dx, sn: -dz, y0: H, y1: H + 0.6 }, y);
    // the pylons
    for (const s of [-1, 1]) {
      const px = (s < 0 ? e.ax : e.bx) + s * dx * 1.4, pz = (s < 0 ? e.az : e.bz) + s * dz * 1.4;
      ochre.box({ cx: px + e.nx * 0.6, cz: pz + e.nz * 0.6, hu: 1.4, hv: 0.6, cs: dx, sn: -dz, y0: -1, y1: H + 1.5 }, y);
    }
    sign(signs, atlas, 'FORUM', (fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2, e.nx, e.nz, Math.min(10, L - 3), 1.9, y + H - 2.2);
  }

  // THE SIGNS on the anchors' walls
  const named: [string, string, number][] = [['Liverpool', 'LIVERPUL', 3.6], ['Sears', 'SEARS', 3], ['Food court', 'PLAYCITY CASINO', 2.6]];
  for (const [b, name, h] of named) {
    const at0 = longest.get(P.buildings.find((x) => x.name === b) ?? P.buildings[0]);
    if (!at0) continue;
    const bb = P.buildings.find((x) => x.name === b);
    const y = base(at0.x, at0.z) + (bb ? bb.height : ROOF) - h / 2 - 1.2;
    sign(signs, atlas, name, at0.x, at0.z, at0.nx, at0.nz, Math.min(at0.L * 0.5, h * 5.3), h, y);
  }
  // the Cinemex & Suburbia on the south wing's end (frame B: the Cinemex's west & south faces, Suburbia's south)
  {
    const B = P.B, south = (u: number): [number, number, number] => {
      // the south facade's v at u: along the outline's south edge (nodes 16 → 17 of the mall's)
      const ring = P.buildings[0].ring, [px, pz] = ring[16], [qx, qz] = ring[17];
      const [x, z] = at(B, u, 150);
      const t = ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / ((qx - px) ** 2 + (qz - pz) ** 2);
      return [px + (qx - px) * t, pz + (qz - pz) * t, base(x, z)];
    };
    const [cx, cz, cy] = south(22), [sx, sz, sy] = south(74);
    sign(signs, atlas, 'CINEMEX', cx, cz, B.vx, B.vz, 14, 2.8, cy + ROOF - 2.6);
    sign(signs, atlas, 'SUBURBIOS', sx, sz, B.vx, B.vz, 12, 2.4, sy + ROOF - 2.6);
    const [wx, wz] = at(B, 0, 138);
    sign(signs, atlas, 'CINEMEX', wx, wz, -B.ux, -B.uz, 14, 2.8, base(wx, wz) + ROOF - 2.6);
  }

  // THE FIESTA INN: a tower of nine floors over its podium, along the podium's north side, its name on top
  {
    const b = P.buildings.find((x) => x.name === 'Fiesta Inn');
    if (b) {
      const A = P.A;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity;
      for (const [x, z] of b.ring) {
        const dx = x - A.ox, dz = z - A.oz, u = dx * A.ux + dz * A.uz, v = dx * A.vx + dz * A.vz;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v);
      }
      const [cx, cz] = at(A, (u0 + u1) / 2, v0 + 9), th = Math.atan2(-A.uz, A.ux);
      const y = base(cx, cz), H = 31, hu = (u1 - u0) / 2 - 2;
      hotel.box({ cx, cz, hu, hv: 7.5, cs: Math.cos(th), sn: Math.sin(th), y0: b.height, y1: H }, y, 0b001111);
      roof.box({ cx, cz, hu, hv: 7.5, cs: Math.cos(th), sn: Math.sin(th), y0: H, y1: H + 0.8 }, y);
      roof.box({ cx, cz, hu: 4, hv: 3, cs: Math.cos(th), sn: Math.sin(th), y0: H + 0.8, y1: H + 3.2 }, y);
      for (const s of [-1, 1]) {
        const [px, pz] = at(A, (u0 + u1) / 2, v0 + 9 + s * 7.6);
        sign(signs, atlas, 'FIESTA INN', px, pz, A.vx * s, A.vz * s, 13, 2.2, y + H - 1.6);
      }
    }
  }

  addMesh(group, render, mats.render, 'ForumWalls');
  addMesh(group, foot, mats.base, 'ForumWallFoot');
  addMesh(group, ochre, mats.ochre, 'ForumOchre');
  addMesh(group, roof, mats.roof, 'ForumRoofs');
  addMesh(group, dome, mats.dome, 'ForumDome');
  addMesh(group, glass, mats.glass, 'ForumEntrances', { shadows: false });
  addMesh(group, lantern, mats.lantern, 'ForumLanterns', { shadows: false });
  addMesh(group, canopy, mats.canopy, 'ForumCanopies');
  addMesh(group, signs, mats.sign, 'ForumSigns', { shadows: false });
  addMesh(group, hotel, mats.hotel, 'ForumFiestaInn');
  addMesh(group, apron, mats.apron, 'ForumSidewalk', { drape: true, shadows: false });
}
