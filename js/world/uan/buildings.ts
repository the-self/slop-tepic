// js/world/uan/buildings.ts
// The campus's buildings on their real footprints (uan-campus.ts says what each is), in the university's white and
// blue, from street & aerial photographs:
// - 'aulas' (Enfermería's, Ingenierías', the Prepa's): a row of classrooms on a raised floor, its corridor along one
//   long side under the floor above: a white frame of columns & slabs, blue sills and a blue panel by each white door,
//   windows in white aluminium; upstairs a white railing on the slab's blue edge; the roof slab overhanging all round,
//   its edge blue; the back the same windows over blue sills between the blue panels.
// - 'edificio': the academic buildings in the same dress, windows all round, the entrance glazed under a blue canopy.
// - 'domo': a hall under a white barrel vault of sheet metal (the gyms, the auditoriums), white walls, louvres high up.
// - 'gradas': concrete stands stepping up from the field, under a roof on blue columns.
// Their names (Overture's places: the faculties, the library, the auditoriums) on white boards in blue letters, and the
// floodlights round the baseball stadium: steel masts 32 m high, a frame of lamps on each aimed at the field.
import * as THREE from 'three/webgpu';
import { groundHeight } from '../ground.ts';
import { GEO } from '../city-geodata.js';
import { inCampus } from '../uan-campus.ts';
import { blockAt } from '../city-config.ts';
import type { CampusBuilding } from '../uan-campus.ts';
import type { Frame, Kit } from '../building-kit.ts';
import { RAIL_H, nameBoards } from './materials.ts';
import type { Footprint } from '../buildings/types.ts';
import type { UanMaterials } from './materials.ts';

const FLOOR = 3.5; // m a storey (a school's are taller than a house's)
const BOARD_H = 0.7; // m: the name boards' height

/** Where a building's name goes: the face (its plane z = 0, out +z), the board's middle's height over the frame's y,
 *  the width it may take (m); and the building's height over its ground (m) */
interface Built {
  face: Frame;
  y: number;
  room: number;
  h: number;
}

// The frame of a footprint (its centre on its lowest corner's ground, a little into it) with its long side along local
// x: L along x, D along z
function footFrame(b: CampusBuilding): { f: Frame; L: number; D: number } {
  const c = Math.cos(b.th), s = Math.sin(b.th);
  let g0 = Infinity;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = (u * b.w) / 2, z = (v * b.d) / 2;
    g0 = Math.min(g0, groundHeight(b.cx + x * c + z * s, b.cz - x * s + z * c));
  }
  const turn = b.w >= b.d ? 0 : Math.PI / 2;
  return { f: { x: b.cx, y: g0 - 0.1, z: b.cz, yaw: b.th + turn }, L: Math.max(b.w, b.d), D: Math.min(b.w, b.d) };
}

// A frame within frame f: at its (x, z), turned ry more
function sub(f: Frame, x: number, z: number, ry: number): Frame {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return { x: f.x + x * c + z * s, y: f.y, z: f.z - x * s + z * c, yaw: f.yaw + ry };
}

// The louvres along a face: [x0, x1] at z (its outward sign `s`), a strip per floor (the domos')
function windowStrips(kit: Kit, f: Frame, mats: UanMaterials, x0: number, x1: number, z: number, s: number, floors: number, y0 = 0.95, h = 1.6): void {
  const len = x1 - x0;
  if (len < 1.5) return;
  for (let k = 0; k < floors; k++) kit.box(f, len, h, 0.06, (x0 + x1) / 2, k * FLOOR + y0 + h / 2, z + s * 0.01, mats.louvres, x0);
}

// A face in the UAN's dress, in its own frame (along x, centred, its plane z = 0, out +z), `len` long, from y0: per
// floor a blue sill, bays ~3.6 m wide between white pilasters, each a window in white aluminium or, every `solid`th, a
// blue panel
function facade(kit: Kit, f: Frame, mats: UanMaterials, len: number, floors: number, y0: number, solid = 3): void {
  if (len < 2) return;
  const n = Math.max(1, Math.round(len / 3.6)), bw = len / n, sill = 1.0, top = 2.65;
  for (let fl = 0; fl < floors; fl++) {
    const y = y0 + fl * FLOOR;
    kit.box(f, len, sill, 0.08, 0, y + sill / 2, 0.04, mats.blue);
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + (k + 0.5) * bw;
      if (n > 1 && k % solid === solid - 1) kit.box(f, bw - 0.3, top - sill, 0.08, x, y + (sill + top) / 2, 0.04, mats.blue);
      else kit.box(f, bw - 0.3, top - sill, 0.06, x, y + (sill + top) / 2, 0.03, mats.windows, x);
    }
    for (let k = 0; k <= n; k++) kit.box(f, 0.3, FLOOR, 0.16, -len / 2 + k * bw, y + FLOOR / 2, 0.08, mats.trim);
  }
}

// The roof slab overhanging `eave` m all round at y (its top), white, its edge blue, the slab sealed red or left grey
function roof(kit: Kit, f: Frame, mats: UanMaterials, L: number, D: number, y: number, eave: number, red: boolean): void {
  const l = L + 2 * eave, d = D + 2 * eave;
  kit.box(f, l, 0.24, d, 0, y - 0.12, 0, mats.trim);
  for (const s of [-1, 1]) {
    kit.box(f, l + 0.06, 0.26, 0.05, 0, y - 0.12, s * (d / 2 + 0.02), mats.blue);
    kit.box(f, 0.05, 0.26, d + 0.06, s * (l / 2 + 0.02), y - 0.12, 0, mats.blue);
  }
  kit.box(f, l - 0.1, 0.03, d - 0.1, 0, y + 0.015, 0, red ? mats.roofRed : mats.roofGrey);
}

// An academic building: L x D, `floors` storeys
function edificio(kit: Kit, b: CampusBuilding, mats: UanMaterials): Built {
  const { f, L, D } = footFrame(b);
  const floors = b.storeys, y0 = 0.3, H = y0 + floors * FLOOR + 0.3;
  kit.box(f, L, H, D, 0, H / 2 - 0.5, 0, mats.white);
  kit.box(f, L + 0.4, 0.8, D + 0.4, 0, y0 - 0.4, 0, mats.blue);
  for (let k = 1; k < floors; k++) kit.box(f, L + 0.36, 0.18, D + 0.36, 0, y0 + k * FLOOR, 0, mats.blue);
  roof(kit, f, mats, L, D, H + 0.24, 0.7, b.seed < 0.55);
  facade(kit, sub(f, 0, D / 2, 0), mats, L - 0.6, floors, y0);
  facade(kit, sub(f, 0, -D / 2, Math.PI), mats, L - 0.6, floors, y0);
  facade(kit, sub(f, L / 2, 0, Math.PI / 2), mats, D - 0.6, floors, y0, 2);
  facade(kit, sub(f, -L / 2, 0, -Math.PI / 2), mats, D - 0.6, floors, y0, 2);
  // the entrance on the front (a long side), its canopy
  const ex = (b.seed - 0.5) * L * 0.4, s = b.seed < 0.5 ? 1 : -1;
  kit.box(f, 2.6, 2.6, 0.2, ex, y0 + 1.3, s * (D / 2 + 0.1), mats.glass);
  kit.box(f, 3.6, 0.22, 1.6, ex, y0 + 3.0, s * (D / 2 + 0.8), mats.blue);
  kit.collide(f, 0, 0, L / 2, D / 2, 0, H);
  return { face: sub(f, 0, s * (D / 2 + 0.17), s > 0 ? 0 : Math.PI), y: y0 + floors * FLOOR - 0.1, room: L - 2, h: H + 0.24 };
}

// A row of aulas: L x D, the corridor 2.4 m deep along one long side
function aulas(kit: Kit, b: CampusBuilding, mats: UanMaterials): Built {
  const { f, L, D } = footFrame(b);
  const floors = b.storeys, y0 = 0.3, H = y0 + floors * FLOOR, C = Math.min(2.4, D * 0.3);
  const s = b.seed < 0.5 ? 1 : -1; // (the corridor's side)
  const bz = -s * C / 2, bd = D - C; // the classrooms' block
  // the raised floor, blue round its foot; the classrooms' block
  kit.box(f, L + 0.3, 0.8, D + 0.3, 0, y0 - 0.4, 0, mats.blue);
  kit.box(f, L + 0.2, 0.04, D + 0.2, 0, y0 + 0.01, 0, mats.concrete);
  kit.box(f, L, H, bd, 0, H / 2, bz, mats.white);
  // the corridor's columns, every ~4 m; over it the slabs of the floors above, their blue edges, the white railings
  const n = Math.max(1, Math.round(L / 4));
  for (let k = 0; k <= n; k++) kit.box(f, 0.35, H - y0, 0.35, -L / 2 + 0.2 + (k * (L - 0.4)) / n, (H + y0) / 2, s * (D / 2 - 0.2), mats.trim);
  for (let k = 1; k < floors; k++) {
    const y = y0 + k * FLOOR;
    kit.box(f, L, 0.3, C, 0, y - 0.15, s * (D / 2 - C / 2), mats.trim);
    kit.box(f, L + 0.04, 0.24, 0.06, 0, y - 0.15, s * (D / 2 + 0.02), mats.blue);
    kit.plane(sub(f, 0, s * (D / 2 - 0.05), s > 0 ? 0 : Math.PI), L - 0.3, RAIL_H, 0, y + RAIL_H / 2, 0, mats.railing);
    kit.box(f, L - 0.2, 0.06, 0.08, 0, y + RAIL_H, s * (D / 2 - 0.05), mats.trim);
  }
  roof(kit, f, mats, L, D, H + 0.3, 0.8, b.seed < 0.8);
  // the classrooms' fronts on the corridor, a room each ~8 m: its white door in a grey frame, a blue panel by it, then
  // windows over a blue sill
  const rooms = Math.max(1, Math.round(L / 8)), rw = L / rooms;
  const front = sub(f, 0, bz + s * bd / 2, s > 0 ? 0 : Math.PI);
  for (let fl = 0; fl < floors; fl++) {
    const y = y0 + fl * FLOOR;
    for (let r = 0; r < rooms; r++) {
      const x0 = -L / 2 + r * rw, door = x0 + 0.9, panel = x0 + 2.2, wx0 = x0 + 3.0, wx1 = x0 + rw - 0.3;
      kit.box(front, 1.14, 2.3, 0.04, door, y + 1.15, 0.02, mats.coping);
      kit.box(front, 1.0, 2.2, 0.08, door, y + 1.1, 0.04, mats.doorSteel);
      kit.box(front, 0.5, 0.14, 0.03, door, y + 2.45, 0.05, mats.plaque); // (the room's number)
      kit.box(front, 1.3, 2.6, 0.08, panel, y + 1.3, 0.04, mats.blue);
      if (wx1 - wx0 < 1) continue;
      kit.box(front, wx1 - wx0, 1.0, 0.08, (wx0 + wx1) / 2, y + 0.5, 0.04, mats.blue);
      kit.box(front, wx1 - wx0, 1.6, 0.06, (wx0 + wx1) / 2, y + 1.85, 0.03, mats.windows, wx0);
    }
  }
  facade(kit, sub(f, 0, bz - s * bd / 2, s > 0 ? Math.PI : 0), mats, L - 0.4, floors, y0);
  // the ends: blue
  for (const e of [-1, 1]) {
    for (let fl = 0; fl < floors; fl++) kit.box(sub(f, e * L / 2, bz, e * Math.PI / 2), bd - 0.6, FLOOR - 0.5, 0.06, 0, y0 + fl * FLOOR + (FLOOR - 0.5) / 2, 0.03, mats.blue);
  }
  kit.collide(f, 0, bz, L / 2, bd / 2, 0, H);
  // (the name along the back, in the white band under the eave)
  return { face: sub(f, 0, bz - s * (bd / 2 + 0.17), s > 0 ? Math.PI : 0), y: H - 0.42, room: L - 2, h: H + 0.3 };
}

// A domo: a hall L x D under a white barrel vault along its length
function domo(kit: Kit, b: CampusBuilding, mats: UanMaterials): Built {
  const { f, L, D } = footFrame(b);
  const H = 6.0, R = D / 2 + 0.4, rise = D * 0.2;
  kit.box(f, L, H + 1, D, 0, (H - 1) / 2, 0, mats.white);
  kit.box(f, L + 0.1, 0.6, D + 0.1, 0, 0.3, 0, mats.blue);
  kit.box(f, L + 0.3, 0.5, D + 0.3, 0, H - 0.25, 0, mats.blue);
  windowStrips(kit, f, mats, -L / 2 + 1, L / 2 - 1, D / 2, 1, 1, 3.6, 1.6);
  windowStrips(kit, f, mats, -L / 2 + 1, L / 2 - 1, -D / 2, -1, 1, 3.6, 1.6);
  // (a half cylinder along x, flattened to its rise; its ends closed)
  const vault = new THREE.CylinderGeometry(R, R, L + 0.6, 32, 1, false, 0, Math.PI);
  const uv = vault.attributes.uv, pos = vault.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.atan2(pos.getX(i), pos.getZ(i)) * R, pos.getY(i));
  vault.rotateZ(Math.PI / 2).scale(1, rise / R, 1);
  kit.add(vault, mats.vault, f, 0, H, 0);
  // the gable ends: the doors in the middle of each
  for (const s of [-1, 1]) kit.box(f, 0.08, 3.2, 4.0, s * (L / 2 + 0.03), 1.6, 0, mats.door);
  kit.collide(f, 0, 0, L / 2, D / 2, 0, H + rise);
  return { face: sub(f, 0, D / 2 + 0.02, 0), y: 2.8, room: L - 4, h: H + rise };
}

// Stands: concrete rows stepping up from the field (on its side of the footprint towards the nearest pitch), a roof
// on blue columns
function gradas(kit: Kit, b: CampusBuilding, mats: UanMaterials): Built {
  const { f, L, D } = footFrame(b);
  // which long side faces the field: towards the nearest pitch's middle
  let best = Infinity, toward = 1;
  for (const p of GEO.parks) {
    const r = p.rings.at(0);
    if (p.cat !== 'pitch' || !r?.length) continue;
    let x = 0, z = 0;
    for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
    x /= r.length / 2;
    z /= r.length / 2;
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < best) {
      best = d;
      toward = (x - f.x) * Math.sin(f.yaw) + (z - f.z) * Math.cos(f.yaw) > 0 ? 1 : -1;
    }
  }
  const rows = Math.max(3, Math.floor(D / 0.85)), rd = D / rows;
  for (let k = 0; k < rows; k++) {
    const h = 0.6 + k * 0.45;
    kit.box(f, L, h, rd + 0.01, 0, h / 2, toward * (D / 2 - (k + 0.5) * rd), mats.concrete);
  }
  const back = 0.6 + rows * 0.45, roofY = back + 3.0, n = Math.max(2, Math.round(L / 6));
  for (let k = 0; k <= n; k++) kit.box(f, 0.3, roofY, 0.3, -L / 2 + 0.2 + (k * (L - 0.4)) / n, roofY / 2, -toward * (D / 2 - 0.2), mats.blue);
  kit.box(f, L + 0.4, 0.25, D + 1.6, 0, roofY + 0.12, toward * 0.8, mats.roofGrey);
  kit.box(f, L + 0.45, 0.4, 0.12, 0, roofY + 0.1, toward * (D / 2 + 1.6), mats.blue);
  kit.collide(f, 0, 0, L / 2, D / 2, 0, back);
  // (the name on the roof's fascia, towards the field)
  return { face: sub(f, 0, toward * (D / 2 + 1.67), toward > 0 ? 0 : Math.PI), y: roofY + 0.1, room: L - 2, h: roofY + 0.25 };
}

const MAST_IN = 3; // m in from the stadium's outline at least
const MAST_CLEAR = 6; // m a mast stands off the campus's walls

// On the campus's ground (in its grounds and on a block), MAST_CLEAR m in from its edge every way
function clearGround(x: number, z: number): boolean {
  return ([[0, 0], [MAST_CLEAR, 0], [-MAST_CLEAR, 0], [0, MAST_CLEAR], [0, -MAST_CLEAR]] satisfies [number, number][])
    .every(([dx, dz]) => inCampus(x + dx, z + dz) && !!blockAt(x + dx, z + dz));
}

// The floodlights round the baseball stadium (OpenStreetMap's leisure=stadium outline): a mast by the outline's points
// furthest out in six directions, inside the campus's walls, its lamps aimed at the middle
function floodlights(kit: Kit, mats: UanMaterials): number {
  const stadium = GEO.parks.find((p) => p.cat === 'stadium' && p.name.includes('UAN'));
  const r = stadium?.rings[0];
  if (!r?.length) return 0;
  let cx = 0, cz = 0;
  for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; }
  cx /= r.length / 2;
  cz /= r.length / 2;
  // (the ring's points furthest out in six directions round its middle)
  const sites: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    let far = 0, at: [number, number] = [cx, cz];
    for (let i = 0; i < r.length; i += 2) {
      const d = (r[i] - cx) * Math.cos(a) + (r[i + 1] - cz) * Math.sin(a);
      if (d > far) { far = d; at = [r[i], r[i + 1]]; }
    }
    // (drawn in towards the field until it stands on the campus's ground, clear of its walls & the street: the outline
    // runs out to the streets' middles)
    const L = Math.hypot(at[0] - cx, at[1] - cz) || 1, ux = (cx - at[0]) / L, uz = (cz - at[1]) / L;
    let d = MAST_IN;
    while (d < L * 0.6 && !clearGround(at[0] + ux * d, at[1] + uz * d)) d += 1;
    if (d >= L * 0.6) continue;
    const p: [number, number] = [at[0] + ux * d, at[1] + uz * d];
    if (!sites.some(([x, z]) => Math.hypot(x - p[0], z - p[1]) < 25)) sites.push(p);
  }
  const H = 32;
  for (const [x, z] of sites) {
    const yaw = Math.atan2(cx - x, cz - z) + Math.PI; // (the frame's -z towards the field: the lamps on that side)
    const f: Frame = { x, y: groundHeight(x, z) - 0.2, z, yaw };
    kit.add(new THREE.CylinderGeometry(0.22, 0.45, H, 10), mats.steel, f, 0, H / 2, 0);
    kit.box(f, 4.6, 0.12, 1.2, 0, H - 2.2, -0.4, mats.steel);
    kit.box(f, 4.4, 3.2, 0.2, 0, H + 0.2, -0.3, mats.steel);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) kit.box(f, 0.8, 0.8, 0.3, -1.5 + i, H - 0.75 + j, -0.55, mats.lamp, 0, 0, false);
    }
    kit.collide(f, 0, 0, 0.45, 0.45, 0, H);
  }
  return sites.length;
}

/**
 * The campus's buildings and floodlights into the kit; on each building Overture names, its name in blue letters on a
 * white board. Returns their footprints for the maps (they are not among the generic houses')
 */
function buildBuildings(kit: Kit, buildings: readonly CampusBuilding[], mats: UanMaterials): { footprints: Footprint[]; floodlights: number } {
  const footprints: Footprint[] = [], named: { b: CampusBuilding; at: Built; w: number }[] = [];
  for (const b of buildings) {
    const at = b.kind === 'aulas' ? aulas(kit, b, mats) : b.kind === 'domo' ? domo(kit, b, mats)
      : b.kind === 'gradas' ? gradas(kit, b, mats) : edificio(kit, b, mats);
    const c = Math.cos(b.th), s = Math.sin(b.th);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: b.cx + (u * b.w / 2) * c + (v * b.d / 2) * s, z: b.cz - (u * b.w / 2) * s + (v * b.d / 2) * c }));
    footprints.push({
      x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)),
      h: at.h, tone: b.seed, pts
    });
    // (about 0.3 m a letter at the board's height, and a margin)
    const w = b.name ? Math.min(at.room, b.name.length * 0.3 + 1) : 0;
    if (b.name && w > 2.5) named.push({ b, at, w });
  }
  const boards = nameBoards(named.map(({ b, w }): [string, number, number] => [b.name ?? '', w, BOARD_H]));
  if (boards) {
    named.forEach(({ at, w }, i) => {
      kit.box(at.face, w + 0.3, BOARD_H + 0.16, 0.06, 0, at.y, 0.03, mats.white);
      kit.sign(at.face, w, BOARD_H, 0, at.y, 0.065, boards.mat, boards.rects[i]);
    });
  }
  return { footprints, floodlights: floodlights(kit, mats) };
}

export { buildBuildings };
