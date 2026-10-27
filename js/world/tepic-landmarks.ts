import * as THREE from 'three/webgpu';
import { color, mix, positionWorld, fract, step, smoothstep, sin, time } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.ts';
import { cityUniforms } from '../render/tsl-materials.ts';
import { liftAt, landHeight } from './ground.ts';
import { MODEL_RESERVES } from './landmark-models.ts';
import type { LotReserve } from './landmark-models.ts';
import type { Collider } from './buildings.ts';

// js/world/tepic-landmarks.ts
// Tepic's landmarks on their real footprints (city-geodata.js `landmarks`, from OpenStreetMap): the Catedral on the
// Plaza Principal, its facade towards the plaza between two neo-Gothic towers (a tall shaft, two belfries with open
// arches, an octagonal spire with a cross). LANDMARK_RESERVES are their lots, kept clear of the generic houses.
// And the monuments the town finds its way by, at their OpenStreetMap points (city-geodata.js `pois`): the Columna de
// la Pacificación and the Monumento a los Constituyentes on the Plaza Principal, the golden Ángel de la Independencia,
// the Rey Nayar over his fountain, the bronze statues on their pedestals (Amado Nervo, Esteban Baca Calderón,
// Francisco Villa...), the fountains (Los 3 Delfines, the Molcajete), the big TEPIC & NAYARIT letters, the cross on the
// Cerro de la Cruz and the antennas of the Cerro Microondas, their red lights blinking at night.

type Vec2 = [number, number];

/** A turned rectangle: its centre (m), its axes a & b (unit vectors) and its sizes along them (m) */
interface OrientedBox {
  cx: number;
  cz: number;
  ax: Vec2;
  bx: Vec2;
  a: number;
  b: number;
}

/** A rectangle in the Catedral's frame (m): [x0, x1, z0, z1] */
type Rect = [number, number, number, number];
/** An axis-aligned wall of a Rect: [x, z (its start or plane), runs along x?, the sign of its outward normal] */
type Face = [number, number, boolean, number];

/**
 * The Catedral's frame: the middle of its facade (m), the facade's normal f (towards the plaza), its width (m), the
 * yaw (rad) of f; OpenStreetMap's outline (`ring`, flat [x, z, ...]); the curb island it stands on in its own frame
 * (`curb`, [x, z] with +x to the south and +z towards the plaza) and how far it stands back from the facade's line (m)
 */
export interface CatedralFrame {
  x: number;
  z: number;
  f: Vec2;
  width: number;
  yaw: number;
  ring: ArrayLike<number>;
  curb: Vec2[] | null;
  setback: number;
}

/** The building line along the plaza: its start in the church's frame (m), the turn (rad) of a frame whose +x runs along it and +z faces the street, its length (m) */
interface FrontRun {
  ox: number;
  oz: number;
  th: number;
  len: number;
}

/** One piece of a monument and what it's made of */
type MonumentPart = [THREE.BufferGeometry, THREE.Material];

// Oriented box around a flat [x, z, ...] ring: the turned rectangle of least area
function orientedBox(flat: ArrayLike<number>): OrientedBox | null {
  const pts: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  let best: { area: number; ux: number; uz: number; u0: number; u1: number; v0: number; v1: number } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uz, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ax: [ux, uz], bx: [-uz, ux], a: u1 - u0, b: v1 - v0 };
}

// The Catedral's frame. OpenStreetMap's outline (`ring`) takes in the church and the casona north of it: the facade is
// the outline's edge furthest towards the plaza (the casona's front stands 9 m back), `x, z` its middle, f its normal
// (towards the plaza), `width` its length. The facade's south corner reaches past the curb of Av. México as its
// OpenStreetMap line is drawn, so the whole church stands back as far as it takes (`setback`, ~2 m). `curb` is the
// outline of the curb island it stands on (city-config.js), in the church's frame.
const CATEDRAL = ((): CatedralFrame | null => {
  const site = GEO.landmarks.Catedral; // (a Record: the city may not have it)
  if (!site) return null;
  const box = orientedBox(site.ring);
  if (!box) return null;
  const toPlaza = [-box.cx, -box.cz];
  const r = site.ring, n = Math.hypot(toPlaza[0], toPlaza[1]) || 1, ux = toPlaza[0] / n, uz = toPlaza[1] / n;
  let facade: { x: number; z: number; f: Vec2; width: number; reach: number } | null = null;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], len = Math.hypot(dx, dz);
    if (len < 8) continue;
    let fx = -dz / len, fz = dx / len;
    if (fx * ux + fz * uz < 0) [fx, fz] = [-fx, -fz];
    if (fx * ux + fz * uz < 0.7) continue; // (a side, not a front)
    const x = (r[i] + r[j]) / 2, z = (r[i + 1] + r[j + 1]) / 2, reach = x * ux + z * uz;
    if (!facade || reach > facade.reach) facade = { x, z, f: [fx, fz], width: len, reach };
  }
  if (!facade) return null;
  const F = facade, [fx, fz] = F.f;
  const local = (x: number, z: number): Vec2 => [(x - F.x) * fz - (z - F.z) * fx, (x - F.x) * fx + (z - F.z) * fz];
  const block = blockAt(F.x - fx * 15, F.z - fz * 15);
  let curb = block ? block.poly.map((q) => local(q.x, q.z)) : null;
  let setback = 0;
  if (curb) {
    for (const x of [-F.width / 2 - 0.6, 0, F.width / 2 + 0.6]) setback = Math.max(setback, 0.6 - curbFront(curb, x));
    curb = curb.map(([x, z]): Vec2 => [x, z + setback]);
  }
  return { x: F.x - fx * setback, z: F.z - fz * setback, f: F.f, width: F.width, yaw: Math.atan2(fx, fz), ring: r, curb, setback };
})();

// The church & its neighbours in the church's frame (metres; the facade's middle at the origin, the church towards -z,
// +x to the south), measured on OpenStreetMap's outline and from street photographs: the nave behind the towers; the
// crossing under the dome, its arm reaching north (the outline's 27 m across); the apse; north, the red casona (two
// storeys, its front on the plaza 9 m behind the church's) and the atrium before it, fenced along Av. México and
// Amado Nervo; south, as far as Lerdo de Tejada, the pink building and the portales on the plaza. [x0, x1, z0, z1]
const PLAN: { nave: Rect; cross: Rect; apse: Rect; dome: Vec2; casona: Rect; atrium: Vec2; pink: Vec2; portales: Vec2 } = {
  nave: [-8.7, 8.7, -49, -9],
  cross: [-16.5, 10.4, -67.5, -49],
  apse: [-9.5, 3.7, -72.8, -67.5],
  dome: [0, -58.2], // x, z over the crossing
  casona: [-35.8, -8.9, -49, -9], // (its side 2.2 m in from Amado Nervo's curb)
  atrium: [-35.6, -0.4], // the balustrade's corner: x along Amado Nervo, z along Av. México
  pink: [8.9, 17.5], // x0, x1 along the plaza: their fronts follow the curb (frontRuns)
  portales: [17.5, 49.4]
};

// How far towards the plaza the curb reaches at x (the church's frame): the front-most edge of the curb island there
function curbFront(curb: readonly Vec2[], x: number): number {
  let z = -Infinity;
  for (let i = 0; i < curb.length; i++) {
    const [ax, az] = curb[i], [bx, bz] = curb[(i + 1) % curb.length];
    if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
    z = Math.max(z, az + ((x - ax) * (bz - az)) / (bx - ax));
  }
  return z;
}

// The building line along the plaza from x0 to x1 (the church's frame), `sidewalk` m in from the curb: a run per edge of
// the curb island there, each { ox, oz, th, len } (its start, the turn of a frame whose +x runs along it and +z faces
// the street, its length)
function frontRuns(x0: number, x1: number, sidewalk = GEO.frame.sidewalk || 2.2): FrontRun[] {
  const curb = CATEDRAL ? CATEDRAL.curb : null, runs: FrontRun[] = [];
  if (!curb) return [{ ox: x0, oz: 0, th: 0, len: x1 - x0 }];
  let area = 0;
  for (let i = 0; i < curb.length; i++) {
    const [ax, az] = curb[i], [bx, bz] = curb[(i + 1) % curb.length];
    area += ax * bz - bx * az;
  }
  for (let i = 0; i < curb.length; i++) {
    const [ax, az] = curb[i], [bx, bz] = curb[(i + 1) % curb.length];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const s = area > 0 ? 1 : -1, nx = (s * dz) / len, nz = (-s * dx) / len; // (outward)
    if (nz < 0.7) continue; // (not the plaza's side)
    const lo = Math.max(x0, Math.min(ax, bx)), hi = Math.min(x1, Math.max(ax, bx));
    if (hi - lo < 1) continue;
    const zAt = (x: number) => az + ((x - ax) * dz) / dx;
    runs.push({ ox: lo - nx * sidewalk, oz: zAt(lo) - nz * sidewalk, th: Math.atan2(nx, nz), len: (hi - lo) / nz });
  }
  return runs.sort((a, b) => a.ox - b.ox);
}

// A rectangle of PLAN in the world: { contains(x, z) }, `margin` metres wider all round
function churchRect(C: CatedralFrame, [x0, x1, z0, z1]: Rect, margin = 0): LotReserve {
  const rx = C.f[1], rz = -C.f[0]; // (the frame's +x)
  return {
    contains(px: number, pz: number) {
      const dx = px - C.x, dz = pz - C.z, x = dx * rx + dz * rz, z = dx * C.f[0] + dz * C.f[1];
      return x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin;
    }
  };
}

// Lots the generic houses keep off: { contains(x, z) } (and those of the landmarks made as 3D models)
const LANDMARK_RESERVES: LotReserve[] = [...MODEL_RESERVES];
if (CATEDRAL) {
  const C = CATEDRAL;
  // OpenStreetMap's outline (the houses behind the casona stay: its oriented box took them in too), the atrium, and the
  // pink building's & the portales' lot, outside the outline
  const r = C.ring;
  LANDMARK_RESERVES.push({
    contains(px, pz) {
      let inside = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        if ((r[i + 1] > pz) !== (r[j + 1] > pz) && px < ((r[j] - r[i]) * (pz - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
      }
      return inside;
    }
  });
  LANDMARK_RESERVES.push(churchRect(C, [PLAN.atrium[0], PLAN.casona[1], PLAN.casona[3], PLAN.atrium[1]], 2));
  // (the pink building's & the portales' runs along the curb, as built)
  for (const run of frontRuns(PLAN.pink[0], PLAN.portales[1])) {
    const c = Math.cos(run.th), s = Math.sin(run.th);
    LANDMARK_RESERVES.push({
      contains(px, pz) {
        const dx = px - C.x, dz = pz - C.z, x = dx * C.f[1] - dz * C.f[0] - run.ox, z = dx * C.f[0] + dz * C.f[1] - run.oz;
        const u = x * c - z * s, v = x * s + z * c;
        return u > -0.5 && u < run.len + 0.5 && v > -12.5 && v < 2.5;
      }
    });
  }
}

function stoneMaterial(tint: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0.0 });
  // ashlar courses: a darker joint every 0.55 m
  const joint = step(0.93, fract(positionWorld.y.div(0.55)));
  mat.colorNode = mix(color(tint), color(tint).mul(0.78), joint.mul(0.6));
  return mat;
}

// A pointed (Gothic) arch, w wide and h tall, as a flat shape standing on y = 0
function pointedArch(w: number, h: number) {
  const shape = new THREE.Shape();
  const spring = h - w * 0.75; // where the arch springs from its jambs
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, spring);
  shape.quadraticCurveTo(w / 2, h - w * 0.15, 0, h);
  shape.quadraticCurveTo(-w / 2, h - w * 0.15, -w / 2, spring);
  shape.closePath();
  return shape;
}

// The front & towers as a 3D model (assets/models/README.md): Meshy's image-to-3D over Nheyob's photograph of the
// facade (Wikimedia Commons, CC BY-SA 4.0), the neighbours cropped off and cut 9.5 m behind the facade (what Meshy
// guessed beyond the towers), scaled to the towers' 40 m to the crosses. In metres, its origin at the foot of the
// facade's centre, the facade on z = 0 and the church towards -z; `width` across the towers' cornices, which the drawn
// front takes too
const CATEDRAL_MODEL: { file: string; width: number } | null = { file: 'assets/models/catedral.glb', width: 17.6 };

// The Catedral de Tepic (from photographs): a tall front of brownish-grey cantera with a pointed-arch portal, two lancet
// windows and a round medallion; two towers rising from its corners in three tiers that step in (each with pointed
// openings on every face under a flaring cornice), crowned by a small dome, a lantern and a cross; the clock gable
// between them; the church behind (PLAN), and its neighbours. The front is drawn until CATEDRAL_MODEL has loaded (and
// stays if it can't).
function buildCatedral(group: THREE.Group, colliders: Collider[]) {
  const C = CATEDRAL;
  if (!C) return;
  const root = new THREE.Group();
  root.name = 'Catedral';
  const W = CATEDRAL_MODEL ? CATEDRAL_MODEL.width : C.width;
  const cs = Math.cos(C.yaw), sn = Math.sin(C.yaw);
  const toWorld = (x: number, z: number): Vec2 => [C.x + x * cs + z * sn, C.z - x * sn + z * cs];
  // (`frame`, while it is set: a run along the plaza, see frontRuns, that positions are given in)
  let frame: FrontRun | null = null;
  const here = (x: number, z: number): Vec2 => (frame
    ? [frame.ox + x * Math.cos(frame.th) + z * Math.sin(frame.th), frame.oz - x * Math.sin(frame.th) + z * Math.cos(frame.th)]
    : [x, z]);
  // on the ground at the lowest corner of the church, a little into it (the town's slopes); each neighbour at its own
  // lowest corner (`rise`, from the church's), every wall reaching 1.5 m into the ground
  const lowest = ([x0, x1, z0, z1]: Rect) => Math.min(...([[x0, z0], [x1, z0], [x1, z1], [x0, z1]] satisfies Vec2[]).map(([x, z]) => liftAt(...toWorld(...here(x, z)))));
  let base = Math.min(lowest([-W / 2, W / 2, -9.5, 0]), lowest(PLAN.nave), lowest(PLAN.cross), lowest(PLAN.apse));
  base = base > 0 ? base - 0.15 : 0;
  const rise = (rect: Rect) => Math.max(-3, lowest(rect) - 0.15 - base);
  root.position.set(C.x, base, C.z);
  root.rotation.y = C.yaw; // local +z: the facade's normal, towards the plaza
  const stone = stoneMaterial(0x8f8272);
  const light = stoneMaterial(0xa89a86);
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1b1916, roughness: 0.9 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x3a4a5e, roughness: 0.3 });
  glass.emissiveNode = color(0xffc77a).mul(cityUniforms.uInteriorGlow).mul(0.5);
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2efe6, roughness: 0.5 });
  const plaster = (hex: number) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.92 });
  const roofRed = plaster(0x9a5442); // (Mexican roofs are sealed red)
  const domeStone = stoneMaterial(0xcdc5b4);
  const grey = stoneMaterial(0x6a655b); // the darker cantera of the casona's plinth, frames & the balustrade
  const red = plaster(0xa8483a), pink = plaster(0xe3ae9c), lime = plaster(0xeee8dc), salmon = plaster(0xe8b089);
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0xb27a3c, roughness: 0.7 });
  const iron = new THREE.MeshStandardNodeMaterial({ color: 0x1c1b1a, roughness: 0.6, metalness: 0.4 });
  const bronze = new THREE.MeshStandardNodeMaterial({ color: 0x6d5228, roughness: 0.45, metalness: 0.7 });
  const canvas = plaster(0x6b2b2c);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    const [px, pz] = here(x, z);
    m.position.set(px, y, pz);
    m.rotation.y = ry + (frame ? frame.th : 0);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = stone) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const arch = (w: number, h: number, x: number, y: number, z: number, ry: number, mat: THREE.Material = dark) => add(new THREE.ShapeGeometry(pointedArch(w, h)), mat, x, y, z, ry);
  const FRONT_H = 20, WALL_H = 17.5;
  const fz = 0; // the facade's plane
  // a collider over a rectangle (of the current frame), y0..y0 + h over the church's base
  const collide = ([x0, x1, z0, z1]: Rect, y0: number, h: number) => {
    const th = frame ? frame.th : 0, c = Math.cos(C.yaw + th), s = Math.sin(C.yaw + th);
    const [ox, oz] = toWorld(...here((x0 + x1) / 2, (z0 + z1) / 2)), hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    colliders.push({ minX: ox - ex, maxX: ox + ex, minZ: oz - ez, maxZ: oz + ez, minY: base + y0, maxY: base + y0 + h, obb: { cx: ox, cz: oz, hx, hz, cs: c, sn: s } });
  };
  // a box on an axis-aligned face: `face` = [x, z, along x?, normal sign]; u along it, `out` from it, w wide, d deep
  const fbox = ([fx, fzz, alongX, n]: Face, u: number, y: number, w: number, h: number, d: number, mat: THREE.Material, out = 0) => (alongX
    ? box(w, h, d, fx + u, y, fzz + n * (out + d / 2), mat)
    : box(d, h, w, fx + n * (out + d / 2), y, fzz + u, mat));
  // a vault's roof (span wide, `up` high) from (x, y, z) `len` along +z (turned by ry)
  const vault = (span: number, up: number, len: number, x: number, y: number, z: number, ry = 0) => {
    const s = new THREE.Shape();
    s.moveTo(span / 2, 0);
    s.absellipse(0, 0, span / 2, up, 0, Math.PI, false);
    s.closePath();
    return add(new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 14 }), roofRed, x, y, z, ry);
  };

  // THE CHURCH BEHIND THE FRONT: cantera walls with a plinth, a string course & a cornice, buttresses between bays, a
  // lancet window high in each (over the casona's roof), the vaults' red roofs, and the dome over the crossing
  const hall = ([x0, x1, z0, z1]: Rect, h: number) => {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, h + 1.5, d, cx, (h - 1.5) / 2, cz);
    box(w + 0.5, 1.3, d + 0.5, cx, 0.2, cz, light);
    box(w + 0.35, 0.4, d + 0.35, cx, 9.4, cz, light);
    box(w + 0.7, 0.6, d + 0.7, cx, h, cz, light);
  };
  // buttresses & windows along a wall: face [x, z, along x?, normal], from u0 to u1
  const bays = (face: Face, u0: number, u1: number, h: number, every = 5.5) => {
    const n = Math.max(1, Math.round((u1 - u0) / every)), step = (u1 - u0) / n;
    const ry = face[2] ? (face[3] > 0 ? 0 : Math.PI) : (face[3] > 0 ? Math.PI / 2 : -Math.PI / 2);
    for (let k = 0; k <= n; k++) fbox(face, u0 + k * step, (h - 1.5) / 2, 1.0, h + 1.5, 0.7, stone);
    for (let k = 0; k < n; k++) {
      const u = u0 + (k + 0.5) * step;
      const [x, z]: Vec2 = face[2] ? [face[0] + u, face[1] + face[3] * 0.03] : [face[0] + face[3] * 0.03, face[1] + u];
      arch(1.7, 4.6, x, 11.0, z, ry, glass);
    }
  };
  {
    const [nx0, nx1, nz0, nz1] = PLAN.nave, [cx0, cx1, cz0, cz1] = PLAN.cross, [ax0, ax1, az0, az1] = PLAN.apse;
    hall(PLAN.nave, WALL_H);
    hall(PLAN.cross, WALL_H);
    hall(PLAN.apse, 14);
    bays([nx1, 0, false, 1], nz0, nz1, WALL_H);
    bays([nx0, 0, false, -1], nz0, nz1, WALL_H);
    bays([cx0, 0, false, -1], cz0, cz1, WALL_H, 6);
    bays([cx1, 0, false, 1], cz0, cz1, WALL_H, 6);
    bays([0, cz0, true, -1], cx0, ax0, WALL_H, 6);
    bays([0, cz0, true, -1], ax1, cx1, WALL_H, 6);
    bays([0, cz1, true, 1], cx0, nx0, WALL_H, 6);
    vault(nx1 - nx0 + 0.4, 3.0, nz1 - nz0, (nx0 + nx1) / 2, WALL_H + 0.3, nz0);
    vault(cz1 - cz0 + 0.4, 3.0, cx1 - cx0, cx0, WALL_H + 0.3, (cz0 + cz1) / 2, Math.PI / 2);
    vault(az1 - az0 + 0.2, 1.6, ax1 - ax0, ax0, 14.3, (az0 + az1) / 2, Math.PI / 2);
    // the dome: an octagonal drum with a lancet in each face, a cornice, the cupola, a lantern & a cross
    const [dx, dz] = PLAN.dome, R = 6.4, drumTop = WALL_H + 8;
    add(new THREE.CylinderGeometry(R, R, 9.5, 8), stone, dx, WALL_H + 3.25, dz);
    const apothem = R * Math.cos(Math.PI / 8) + 0.03;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      arch(1.4, 3.6, dx + apothem * Math.sin(a), WALL_H + 3.4, dz + apothem * Math.cos(a), a, glass);
    }
    add(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 0.55, 8), light, dx, drumTop, dz);
    const cupola = add(new THREE.SphereGeometry(R - 0.2, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeStone, dx, drumTop + 0.25, dz);
    cupola.scale.y = 1.2;
    const lantern = drumTop + 0.25 + (R - 0.2) * 1.2 - 0.4;
    add(new THREE.CylinderGeometry(1.2, 1.3, 3.0, 8), light, dx, lantern + 1.5, dz);
    const cap = add(new THREE.SphereGeometry(1.35, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeStone, dx, lantern + 3.0, dz);
    cap.scale.y = 1.1;
    box(0.22, 2.2, 0.22, dx, lantern + 5.4, dz, dark);
    box(1.1, 0.2, 0.2, dx, lantern + 5.8, dz, dark);
  }

  // A run of the cantera balustrade from (x0, z0) along x or z for `len` m: posts with finials every 2.4 m on a plinth,
  // panels pierced with two quatrefoils, an iron railing on top
  const quatrefoil = (cx: number, cy: number, r: number) => {
    const path = new THREE.Path();
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2, rr = r * (0.7 + 0.3 * Math.abs(Math.cos(2 * a)));
      if (k === 0) path.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      else path.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    return path;
  };
  const panelGeo = (() => {
    const w = 1.95, s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, 0.9);
    s.lineTo(-w / 2, 0.9);
    s.closePath();
    s.holes.push(quatrefoil(-0.47, 0.45, 0.34), quatrefoil(0.47, 0.45, 0.34));
    return new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.11);
  })();
  const balustrade = (x0: number, z0: number, alongX: boolean, len: number, y0: number) => {
    const face: Face = [x0, z0, alongX, 1];
    const n = Math.max(1, Math.round(len / 2.4)), step = len / n;
    fbox(face, len / 2, y0 + 0.1, len, 0.5, 0.42, grey, -0.21);
    for (let k = 0; k <= n; k++) {
      fbox(face, k * step, y0 + 0.75, 0.45, 1.3, 0.45, grey, -0.225);
      const [x, z]: Vec2 = alongX ? [x0 + k * step, z0] : [x0, z0 + k * step];
      add(new THREE.SphereGeometry(0.17, 8, 6), grey, x, y0 + 1.55, z);
    }
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * step;
      const [x, z]: Vec2 = alongX ? [x0 + u, z0] : [x0, z0 + u];
      const panel = add(panelGeo, grey, x, y0 + 0.35, z, alongX ? 0 : Math.PI / 2);
      panel.scale.x = (step - 0.45) / 1.95;
    }
    fbox(face, len / 2, y0 + 1.3, len, 0.12, 0.3, grey, -0.15);
    fbox(face, len / 2, y0 + 1.95, len, 0.05, 0.05, iron, -0.025);
    for (let u = 0.15; u < len; u += 0.22) fbox(face, u, y0 + 1.65, 0.025, 0.6, 0.025, iron, -0.0125);
  };

  // THE CASONA: two storeys of red plaster over a cantera plinth, its windows in cantera frames (wooden shutters) and
  // the upper floor's French windows on iron balconies, along the plaza & Amado Nervo; a cornice; the bell gable
  // (espadaña) on its front by the church
  {
    const [x0, x1, z0, z1] = PLAN.casona, y0 = rise(PLAN.casona), H = 10.6;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, H + 1.5, d, cx, y0 + (H - 1.5) / 2, cz, red);
    box(w + 0.12, 1.9, d + 0.12, cx, y0 + 0.2, cz, grey);
    box(w + 0.2, 0.22, d + 0.2, cx, y0 + 5.2, cz, grey);
    box(w + 0.6, 0.5, d + 0.6, cx, y0 + H - 0.1, cz, grey);
    box(w + 0.2, 0.12, d + 0.2, cx, y0 + H + 0.2, cz, roofRed); // (the flat roof, sealed red)
    const front: Face = [cx, z1, true, 1], side: Face = [x0, cz, false, -1];
    for (const [face, len, n, doorAt] of [[front, w, 5, 2], [side, d, 7, 1]] satisfies [Face, number, number, number][]) {
      for (let k = 0; k < n; k++) {
        const u = -len / 2 + len * (0.08 + (0.84 * k) / (n - 1));
        const door = k === doorAt;
        // the ground floor: a door or a window
        fbox(face, u, y0 + (door ? 2.0 : 2.75), door ? 2.5 : 1.9, door ? 4.0 : 2.9, 0.12, grey, 0);
        fbox(face, u, y0 + (door ? 1.75 : 2.75), door ? 1.7 : 1.3, door ? 3.5 : 2.3, 0.1, wood, 0.08);
        if (!door) fbox(face, u, y0 + 1.25, 2.1, 0.14, 0.3, grey, 0);
        // the upper floor: a French window on its balcony, a cornice over it
        fbox(face, u, y0 + 7.55, 1.9, 3.1, 0.12, grey, 0);
        fbox(face, u, y0 + 7.4, 1.3, 2.6, 0.1, wood, 0.08);
        fbox(face, u, y0 + 9.25, 2.4, 0.28, 0.32, grey, 0);
        fbox(face, u, y0 + 6.05, 2.3, 0.18, 0.8, grey, 0);
        fbox(face, u, y0 + 7.15, 2.3, 0.05, 0.05, iron, 0.75);
        for (let b = -1.05; b <= 1.06; b += 0.21) fbox(face, u + b, y0 + 6.65, 0.025, 1.0, 0.025, iron, 0.75);
      }
    }
    // the espadaña: two piers & a round arch over a bell, on the front by the church
    const ex = x1 - 2.6, ez = z1 - 0.35, ey = y0 + H + 0.15;
    box(2.8, 0.45, 0.75, ex, ey, ez, grey);
    for (const s of [-1, 1]) box(0.5, 2.3, 0.6, ex + s * 0.95, ey + 1.35, ez, red);
    add(new THREE.TorusGeometry(0.95, 0.28, 6, 12, Math.PI), red, ex, ey + 2.5, ez);
    box(0.5, 0.5, 0.6, ex, ey + 3.6, ez, grey);
    box(0.1, 0.8, 0.1, ex, ey + 4.25, ez, iron);
    box(0.45, 0.1, 0.1, ex, ey + 4.4, ez, iron);
    add(new THREE.CylinderGeometry(0.22, 0.42, 0.62, 10), bronze, ex, ey + 1.6, ez);
  }
  // THE ATRIUM before the casona: its paving, the balustrade along Av. México (a gate before the casona's door) and
  // Amado Nervo
  {
    const [xa, za] = PLAN.atrium, [, x1, , z1] = PLAN.casona, y0 = rise([xa, x1, z1, za]);
    box(x1 - xa, 0.4, za - z1, (xa + x1) / 2, y0 - 0.1, (z1 + za) / 2, grey);
    const gate = (PLAN.casona[0] + x1) / 2;
    balustrade(xa, za, true, gate - 1.6 - xa, y0 + 0.1);
    balustrade(gate + 1.6, za, true, x1 - gate - 1.6, y0 + 0.1);
    balustrade(xa, z1, false, za - z1, y0 + 0.1);
    for (const s of [-1, 1]) box(0.6, 2.4, 0.6, gate + s * 1.6, y0 + 1.1, za, grey);
  }

  // SOUTH, ON THE PLAZA: an arcade of n round arches along the front of each, over the walkway (3.5 m deep), h high;
  // returns the height its arches spring from
  const arcade = ([x0, x1, , z1]: Rect, n: number, y0: number, h: number, mat: THREE.Material, columns: boolean) => {
    const step = (x1 - x0) / n, hw = step / 2, r = hw - 0.35, spring = h - 0.45 - r;
    for (let k = 0; k <= n; k++) {
      const x = x0 + k * step;
      if (columns) add(new THREE.CylinderGeometry(0.26, 0.3, spring, 12), mat, x, y0 + spring / 2, z1 - 0.35);
      else box(0.6, spring, 0.6, x, y0 + spring / 2, z1 - 0.35, mat);
    }
    // the spandrels: the band over the columns, an arch cut from below
    const s = new THREE.Shape();
    s.moveTo(-hw, h);
    s.lineTo(-hw, spring);
    s.lineTo(-r, spring);
    s.absarc(0, spring, r, Math.PI, 0, true);
    s.lineTo(hw, spring);
    s.lineTo(hw, h);
    s.closePath();
    const band = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false, curveSegments: 10 });
    for (let k = 0; k < n; k++) add(band, mat, x0 + (k + 0.5) * step, y0, z1 - 0.65);
    return spring;
  };
  // the pink building: three storeys over three arches, windows in white frames, iron balconies on the first floor
  const pinkBuilding = (rect: Rect) => {
    const [x0, x1, z0, z1] = rect, y0 = rise(rect), H = 12.2, G = 4.6;
    const w = x1 - x0, cx = (x0 + x1) / 2;
    box(w, G + 1.5, z1 - 3.5 - z0, cx, y0 + (G - 1.5) / 2, (z0 + z1 - 3.5) / 2, salmon);
    box(w, H - G, z1 - z0, cx, y0 + (G + H) / 2, (z0 + z1) / 2, pink);
    box(w + 0.4, 0.4, z1 - z0 + 0.3, cx, y0 + H, (z0 + z1) / 2, lime);
    arcade(rect, Math.max(1, Math.round((x1 - x0) / 2.9)), y0, G, lime, false);
    const front: Face = [cx, z1, true, 1];
    for (const y of [G + 1.9, G + 5.1]) {
      for (const u of [-w / 3, 0, w / 3]) {
        fbox(front, u, y0 + y, 1.6, 2.2, 0.1, lime, 0);
        fbox(front, u, y0 + y, 1.2, 1.9, 0.08, glass, 0.06);
        if (y < G + 3) {
          fbox(front, u, y0 + y - 1.15, 1.9, 0.12, 0.6, lime, 0);
          fbox(front, u, y0 + y - 0.15, 1.9, 0.05, 0.05, iron, 0.55);
        }
      }
    }
    collide([x0, x1, z0, z1 - 3.5], y0, 13);
  };
  // the portales: an arcade of round arches on white columns, the shops behind; above, the restaurant's terrace under
  // maroon awnings in an upper arcade, a balustraded parapet
  const portales = (rect: Rect) => {
    const [x0, x1, z0, z1] = rect, y0 = rise(rect), G = 4.6, H = 9.4, n = Math.max(1, Math.round((x1 - x0) / 4.1));
    const w = x1 - x0, cx = (x0 + x1) / 2, step = w / n;
    box(w, G + 1.5, z1 - 3.6 - z0, cx, y0 + (G - 1.5) / 2, (z0 + z1 - 3.6) / 2, salmon);
    for (let k = 0; k < n; k++) box(step * 0.55, 3.0, 0.1, x0 + (k + 0.5) * step, y0 + 1.5, z1 - 3.6, dark);
    box(w, 0.45, z1 - z0, cx, y0 + G + 0.2, (z0 + z1) / 2, lime);
    box(w, H - G, z1 - 4.2 - z0, cx, y0 + (G + H) / 2, (z0 + z1 - 4.2) / 2, lime);
    arcade(rect, n, y0, G, lime, true);
    const spring = arcade(rect, n, y0 + G + 0.4, H - G - 0.4, lime, false);
    // (a quarter sphere of canvas in each upper arch, bulging out over the street)
    for (let k = 0; k < n; k++) {
      const awning = add(new THREE.SphereGeometry(step / 2 - 0.35, 14, 6, 0, Math.PI, 0, Math.PI / 2), canvas, x0 + (k + 0.5) * step, y0 + G + 0.4 + spring, z1 - 0.05);
      awning.scale.y = 0.8;
    }
    const front: Face = [cx, z1, true, 1];
    fbox(front, 0, y0 + G + 1.05, w, 0.14, 0.35, lime, -0.1);
    for (let u = -w / 2 + 0.2; u < w / 2; u += 0.32) fbox(front, u, y0 + G + 0.7, 0.09, 0.62, 0.09, lime, 0.02);
    box(w + 0.4, 0.5, z1 - z0 + 0.3, cx, y0 + H + 0.2, (z0 + z1) / 2, lime);
    collide([x0, x1, z0, z1 - 3.6], y0, 10);
  };
  // along the curb, a run per edge of it (each a little longer, so the corners where the street turns close)
  for (const [x0, x1, build] of [[PLAN.pink[0], PLAN.pink[1], pinkBuilding], [PLAN.portales[0], PLAN.portales[1], portales]] satisfies [number, number, (rect: Rect) => void][]) {
    for (const run of frontRuns(x0, x1)) {
      frame = run;
      build([-0.3, run.len + 0.3, -12, 0]);
    }
  }
  frame = null;
  const STAYS = root.children.length; // (everything after them is the front, which the model replaces)

  // the front block, its plinth & string courses
  box(W, FRONT_H, 9.5, 0, FRONT_H / 2, fz - 4.75);
  box(W + 0.6, 1.2, 10.1, 0, 0.6, fz - 4.75, light);
  for (const y of [7.5, 13.5]) box(W + 0.3, 0.45, 9.8, 0, y, fz - 4.75, light);
  box(W + 0.9, 0.7, 10.4, 0, FRONT_H, fz - 4.75, light);
  // portal, side doors under the towers, lancet windows, medallion
  const s = Math.min(8.5, W * 0.32); // tower width
  arch(4.6, 8.5, 0, 0, fz + 0.03, 0);
  for (const side of [-1, 1]) {
    arch(3.0, 6.0, side * (W / 2 - s / 2), 0, fz + 0.03, 0);
    arch(1.9, 4.4, side * 1.7, 9.0, fz + 0.03, 0, glass);
    arch(1.5, 3.4, side * (W / 2 - s / 2), 14.5, fz + 0.03, 0, dark);
  }
  const medallion = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), light);
  medallion.position.set(0, 16.2, fz + 0.04);
  root.add(medallion);
  // the clock gable between the towers
  box(5.2, 5, 2.2, 0, FRONT_H + 2.5, fz - 1.4);
  box(5.8, 0.4, 2.6, 0, FRONT_H + 5.1, fz - 1.4, light);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.25, 28), white);
  clock.position.set(0, FRONT_H + 2.6, fz - 0.28);
  root.add(clock);
  for (const [hx, hy, hr] of [[0, 0.55, 0], [0.4, 0.15, -1.2]] satisfies [number, number, number][]) {
    const hand = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.0), dark);
    hand.position.set(hx * 0.5, FRONT_H + 2.6 + hy * 0.5, fz - 0.26);
    hand.rotation.z = hr;
    root.add(hand);
  }
  const finial = (x: number, y: number, z: number, r = 0.35) => {
    add(new THREE.CylinderGeometry(r * 0.5, r * 0.6, 1.0, 8), light, x, y + 0.5, z);
    add(new THREE.SphereGeometry(r, 10, 8), light, x, y + 1.2, z);
  };
  finial(-2.4, FRONT_H + 5.3, fz - 1.4);
  finial(2.4, FRONT_H + 5.3, fz - 1.4);
  // the towers, from the front's corners: three tiers stepping in, pointed openings on all four faces, flaring cornices
  const tiers: Vec2[] = [[s, 9.0], [s * 0.8, 7.5], [s * 0.6, 6.0]];
  for (const side of [-1, 1]) {
    const tx = side * (W / 2 - s / 2), tz = fz - s / 2;
    let y = FRONT_H + 0.35;
    for (const [w, h] of tiers) {
      box(w, h, w, tx, y + h / 2, tz);
      // corner pilasters
      for (const [px, pz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(w * 0.14, h, w * 0.14, tx + px * w * 0.46, y + h / 2, tz + pz * w * 0.46, light);
      // the openings (two per face on the lowest tier)
      const n = w > 7 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const off = n === 1 ? 0 : (k - 0.5) * w * 0.42;
        const aw = w * (n === 1 ? 0.42 : 0.3), ah = h * 0.72;
        arch(aw, ah, tx + off, y + h * 0.1, tz + w / 2 + 0.02, 0);
        arch(aw, ah, tx - off, y + h * 0.1, tz - w / 2 - 0.02, Math.PI);
        arch(aw, ah, tx + w / 2 + 0.02, y + h * 0.1, tz - off, Math.PI / 2);
        arch(aw, ah, tx - w / 2 - 0.02, y + h * 0.1, tz + off, -Math.PI / 2);
      }
      y += h;
      // the flaring cornice & finials on its corners
      box(w + 1.3, 0.35, w + 1.3, tx, y + 0.15, tz, light);
      box(w + 0.8, 0.35, w + 0.8, tx, y - 0.15, tz, light);
      for (const [px, pz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) finial(tx + px * (w / 2 + 0.3), y + 0.3, tz + pz * (w / 2 + 0.3), 0.28);
      y += 0.35;
    }
    // small dome, lantern, cross
    const top = tiers[2][0];
    const dome = add(new THREE.SphereGeometry(top * 0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), stone, tx, y, tz);
    dome.scale.y = 0.9;
    box(top * 0.32, 2.4, top * 0.32, tx, y + top * 0.38 + 1.2, tz, light);
    add(new THREE.ConeGeometry(top * 0.24, 1.6, 8), stone, tx, y + top * 0.38 + 3.2, tz);
    box(0.22, 2.4, 0.22, tx, y + top * 0.38 + 5.2, tz, dark);
    box(1.2, 0.22, 0.22, tx, y + top * 0.38 + 5.6, tz, dark);
  }
  // Merged into one mesh per material (and shadow casting), in the church's frame: drawn part by part, its ~140 pieces
  // cost ~270 draws a frame in the shadow cascades alone from the plaza. The rest and the front apart, so the model can
  // take the front's place
  const stays = new THREE.Group(), front = new THREE.Group();
  const parts = new Map<string, { part: THREE.Group; mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  root.children.forEach((m, i) => {
    if (!isSingleMesh(m)) return; // (all of them: the parts above)
    m.updateMatrix();
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix); // (some are shared)
    const part = i < STAYS ? stays : front;
    const key = `${part.id}:${m.material.uuid}:${m.castShadow}`;
    let entry = parts.get(key);
    if (!entry) parts.set(key, (entry = { part, mat: m.material, cast: m.castShadow, geos: [] }));
    entry.geos.push(geo);
  });
  root.clear();
  for (const { part, mat, cast, geos } of parts.values()) {
    const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    part.add(mesh);
  }
  root.add(stays, front);
  group.add(root);
  // the model in the background (a 3.7 MB file, not preloaded), standing on the drawn front's plane
  if (CATEDRAL_MODEL) {
    const file = CATEDRAL_MODEL.file;
    const loading = import('three/addons/loaders/GLTFLoader.js');
    void loading.then(({ GLTFLoader }) => {
      new GLTFLoader().load(file, (gltf) => {
        const model = gltf.scene;
        model.position.z = fz;
        model.traverse((o) => {
          if ('isMesh' in o && o.isMesh) o.castShadow = o.receiveShadow = true;
        });
        root.add(model);
        // (the landmarks' world matrices are frozen once the city is built, scene-culling.js: work this one out now)
        model.updateMatrixWorld(true);
        front.visible = false;
      }, undefined, (err) => {
        console.warn(`[landmarks] the Catedral's model: could not load ${file}`, err);
      });
    });
  }
  // colliders over the church, its neighbours (the arcades' walkways open) and the balustrade
  collide([-W / 2, W / 2, -9.5, 0], 0, 45);
  collide(PLAN.nave, 0, WALL_H + 3);
  collide(PLAN.cross, 0, 40);
  collide(PLAN.apse, 0, 16);
  collide(PLAN.casona, rise(PLAN.casona), 15);
  const [xa, za] = PLAN.atrium, [cx0, cx1, , cz1] = PLAN.casona, gate = (cx0 + cx1) / 2, ya = rise([xa, cx1, cz1, za]);
  collide([xa, gate - 1.3, za - 0.25, za + 0.25], ya, 2);
  collide([gate + 1.3, cx1, za - 0.25, za + 0.25], ya, 2);
  collide([xa - 0.25, xa + 0.25, cz1, za], ya, 2);
}

// A mesh with one material
function isSingleMesh(o: THREE.Object3D): o is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  return o instanceof THREE.Mesh && !Array.isArray(o.material);
}

// =====================================================================================================================
// THE MONUMENTS: a kit of parts (each a geometry in the monument's frame, base on y = 0, front towards +z), merged per
// material for each monument
// =====================================================================================================================
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();
const cyl = (r0: number, r1: number, h: number, x = 0, y = 0, z = 0, n = 16) => new THREE.CylinderGeometry(r1, r0, h, n).translate(x, y + h / 2, z).toNonIndexed();

// A standing figure s metres tall: legs under a coat or robe, torso, head, one arm raised when `raised` (a flag, a
// greeting) and the other down
function figure(s = 2.4, raised = false) {
  const k = s / 1.8;
  const parts = [
    // robe / coat to the knees, legs below
    new THREE.LatheGeometry([[0.0, 0.0], [0.23, 0.0], [0.26, 0.5], [0.28, 0.95], [0.24, 1.3], [0.2, 1.42], [0.0, 1.45]].map(([x, y]) => new THREE.Vector2(x * k, y * k)), 14),
    new THREE.SphereGeometry(0.12 * k, 12, 10).translate(0, 1.58 * k, 0),
    new THREE.CylinderGeometry(0.05 * k, 0.06 * k, 0.12 * k, 8).translate(0, 1.47 * k, 0),
    // the arm down at the side
    new THREE.CylinderGeometry(0.05 * k, 0.06 * k, 0.62 * k, 8).translate(0.3 * k, 1.05 * k, 0)
  ];
  // the other arm: raised high or held across the chest
  const arm = new THREE.CylinderGeometry(0.05 * k, 0.06 * k, 0.62 * k, 8);
  if (raised) parts.push(arm.rotateZ(2.6).translate(-0.38 * k, 1.62 * k, 0));
  else parts.push(arm.rotateX(1.2).translate(-0.18 * k, 1.2 * k, 0.18 * k));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// A winged Victory (the Ángel): a figure with two swept wings, a wreath held up
function angel(s = 3.6) {
  const k = s / 1.8;
  const wing = new THREE.Shape();
  wing.moveTo(0, 0);
  wing.quadraticCurveTo(0.5, 0.9, 1.0, 1.25);
  wing.quadraticCurveTo(0.7, 0.55, 0.62, 0.05);
  wing.closePath();
  const w = new THREE.ExtrudeGeometry(wing, { depth: 0.04, bevelEnabled: false }).scale(k, k, k);
  return mergeGeometries([
    figure(s, true),
    w.clone().rotateY(-0.5).translate(0.08 * k, 1.05 * k, -0.12 * k),
    w.clone().scale(-1, 1, 1).rotateY(0.5).translate(-0.08 * k, 1.05 * k, -0.12 * k),
    new THREE.TorusGeometry(0.16 * k, 0.025 * k, 6, 16).translate(-0.5 * k, 2.0 * k, 0).toNonIndexed()
  ]);
}

// A stepped stone pedestal h tall, w across
function pedestal(w: number, h: number) {
  return mergeGeometries([
    box(w + 1.2, 0.3, w + 1.2),
    box(w + 0.6, 0.3, w + 0.6, 0, 0.3),
    box(w, h - 0.9, w, 0, 0.6),
    box(w + 0.3, 0.3, w + 0.3, 0, h - 0.3)
  ]);
}

// A round fountain: a stone basin r across with its water, a bowl on a stem in the middle
function fountain(r: number) {
  const rim = new THREE.LatheGeometry([[r - 0.35, 0], [r, 0], [r, 0.6], [r - 0.35, 0.6], [r - 0.35, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 40).toNonIndexed();
  return {
    stone: mergeGeometries([rim, cyl(0.35, 0.25, 1.6), new THREE.LatheGeometry([[0, 1.5], [1.1, 1.6], [1.2, 1.85], [1.0, 1.8], [0, 1.7]].map(([x, y]) => new THREE.Vector2(x, y)), 24).toNonIndexed()]),
    water: new THREE.CircleGeometry(r - 0.36, 40).rotateX(-Math.PI / 2).translate(0, 0.45, 0).toNonIndexed(),
    jet: cyl(0.06, 0.03, 1.4, 0, 1.75, 0, 8)
  };
}

// The block letters of a word, h tall, standing on y = 0, centred on x: each letter a set of boxes on a 3 x 5 grid
const GLYPHS: Record<string, string[]> = {
  T: ['111', '010', '010', '010', '010'], E: ['111', '100', '111', '100', '111'], P: ['111', '101', '111', '100', '100'],
  I: ['111', '010', '010', '010', '111'], C: ['111', '100', '100', '100', '111'], N: ['101', '111', '111', '111', '101'],
  A: ['111', '101', '111', '101', '101'], Y: ['101', '101', '010', '010', '010'], R: ['111', '101', '110', '101', '101']
};
function letters(word: string, h: number) {
  const u = h / 5;
  const out: THREE.BufferGeometry[] = [];
  Array.from(word).forEach((ch, i) => {
    const g = GLYPHS[ch];
    const x0 = (i - (word.length - 1) / 2) * u * 4;
    const parts: THREE.BufferGeometry[] = [];
    g.forEach((row, r) => {
      Array.from(row).forEach((on, c) => {
        if (on === '1') parts.push(box(u, u, u * 0.8, x0 + (c - 1) * u, (4 - r) * u, 0));
      });
    });
    out.push(mergeGeometries(parts));
  });
  return out;
}

// A lattice telecom tower h tall (four legs braced every 4 m, narrowing up), dishes & a beacon on top
function tower(h: number) {
  const legs: THREE.BufferGeometry[] = [];
  const base = h * 0.09;
  for (let y = 0; y < h; y += 4) {
    const a = base * (1 - (y / h) * 0.75), b = base * (1 - ((y + 4) / h) * 0.75);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.CylinderGeometry(0.07, 0.07, 4.05, 4);
      const dx = (b - a) * sx, dz = (b - a) * sz;
      leg.rotateZ(-Math.atan2(dx, 4) * 0.98).rotateX(Math.atan2(dz, 4) * 0.98).translate(a * sx + dx / 2, y + 2, a * sz + dz / 2);
      legs.push(leg.toNonIndexed());
    }
    // a ring of struts and a diagonal on each face
    for (const [sx, sz, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
      legs.push(new THREE.BoxGeometry(2 * a, 0.06, 0.06).rotateY(rot).translate(sx * a, y + 0.05, sz * a).toNonIndexed());
      legs.push(new THREE.BoxGeometry(Math.hypot(2 * a, 4), 0.05, 0.05).rotateZ(Math.atan2(4, 2 * a)).rotateY(rot).translate(sx * a, y + 2, sz * a).toNonIndexed());
    }
  }
  const top = base * 0.25;
  const dishes = [0, 2.1, 4.2].map((r, i) => new THREE.CylinderGeometry(0.8, 0.8, 0.25, 16).rotateX(Math.PI / 2).translate(0, h - 4 - i * 3, top + 0.3).rotateY(r).toNonIndexed());
  return { steel: mergeGeometries(legs), dishes: mergeGeometries(dishes), beacon: new THREE.SphereGeometry(0.35, 10, 8).translate(0, h + 0.4, 0).toNonIndexed() };
}

function buildMonuments(group: THREE.Group, colliders: Collider[]) {
  const pois = new Map(GEO.pois.map((p) => [p.name, p]));
  const stone = stoneMaterial(0xb3a893);
  const darkStone = stoneMaterial(0x6d655b);
  const bronze = new THREE.MeshStandardNodeMaterial({ color: 0x4f3d2a, roughness: 0.42, metalness: 0.75 });
  const gold = new THREE.MeshStandardNodeMaterial({ color: 0xd8b04a, roughness: 0.28, metalness: 1.0 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf1eee6, roughness: 0.6 });
  const water = new THREE.MeshStandardNodeMaterial({ color: 0x2f5f6e, roughness: 0.08, metalness: 0.2 });
  const jetMat = new THREE.MeshStandardNodeMaterial({ color: 0xe6f2f5, roughness: 0.2, transparent: true, opacity: 0.7 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xc9c9c4, roughness: 0.5, metalness: 0.6 });
  const towerRed = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.3 });
  // aviation red & white bands every 6 m
  towerRed.colorNode = mix(color(0xd9d6cf), color(0xc4321f), step(0.5, fract(positionWorld.y.div(12.0))));
  // the beacons: dull by day, a slow red blink after dusk
  const beacon = new THREE.MeshBasicNodeMaterial();
  beacon.colorNode = mix(color(0x6a1d16), color(0xff2a14).mul(3.0), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow).mul(step(0.0, sin(time.mul(3.2)))));
  const LETTER_COLS = [0xe4007c, 0x00a3e0, 0xffc20e, 0x43b02a, 0xff6a13, 0x8a2be2, 0xe4002b];
  const letterMats = LETTER_COLS.map((c) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.45 }));
  let built = 0;

  // A monument at POI `name` (or at x, z): parts [geometry, material], yaw, footprint half-size for its collider
  const place = (name: string, parts: MonumentPart[], { yaw = 0, half = 1.5, height = 6, at = null }: { yaw?: number; half?: number; height?: number; at?: { x: number; z: number } | null } = {}) => {
    const p = at ?? pois.get(name);
    if (!p) return;
    const root = new THREE.Group();
    root.name = name;
    root.position.set(p.x, landHeight(p.x, p.z) - 0.05, p.z);
    root.rotation.y = yaw;
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const [geo, mat] of parts) {
      let geos = byMat.get(mat);
      if (!geos) byMat.set(mat, (geos = []));
      geos.push(geo);
    }
    for (const [mat, geos] of byMat) {
      const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
      mesh.castShadow = mesh.receiveShadow = !mat.transparent && !(mat instanceof THREE.MeshBasicNodeMaterial);
      root.add(mesh);
    }
    group.add(root);
    if (half > 0) colliders.push({ minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half, minY: root.position.y, maxY: root.position.y + height });
    built++;
  };

  // Columns: the Columna de la Pacificación, with its figure, and the Ángel de la Independencia, golden on top
  const column = (h: number, top: THREE.BufferGeometry, topMat: THREE.Material): MonumentPart[] => [
    [pedestal(3.2, 4), stone],
    [cyl(0.85, 0.7, h, 0, 4), stone],
    [cyl(0.95, 1.05, 1.0, 0, 4 + h), stone],
    [top.translate(0, 5 + h, 0), topMat]
  ];
  place('Columna de la Pacificación', column(14, figure(3.0, true), bronze), { half: 2.2, height: 22 });
  place('Ángel de la Independencia', column(22, angel(4.2), gold), { half: 2.2, height: 32 });
  // The Monumento a los Constituyentes: a wide pedestal carrying a group of figures
  place('Monumento a los Constituyentes', [
    [pedestal(4.5, 3.2), stone],
    ...[-1.1, 0, 1.1].map((x): MonumentPart => [figure(2.5, x === 0).translate(x, 3.2, 0), bronze])
  ], { half: 3, height: 7 });
  // Statues on pedestals
  for (const [name, raised] of [['Amado Nervo', false], ['Monumento al Gral. Esteban Baca Calderón', true], ['Monumento al Gral. Francisco Villa', true],
    ['Monumento a Juan Espinoza Bávara', false], ['Monumento a Marcelino Cedano Mora', false], ['Monumento a Esteban Baca Calderón', true], ['Rotonda del Titulado', true]] satisfies [string, boolean][]) {
    place(name, [[pedestal(1.6, 2.6), stone], [figure(2.6, raised).translate(0, 2.6, 0), bronze]], { half: 1.4, height: 5.5 });
  }
  // The Monumento of the Alameda: an obelisk
  place('Monumento alameda', [[pedestal(2.4, 1.6), stone], [cyl(0.9, 0.5, 11, 0, 1.6, 0, 4), stone], [new THREE.ConeGeometry(0.5, 1.2, 4).translate(0, 13.2, 0).toNonIndexed(), stone]], { half: 1.8, height: 14 });
  // Fountains: Los 3 Delfines; the Rey Nayar, the king standing over his; the Molcajete, a stone mortar on three legs
  {
    const f = fountain(5);
    place('Fuente Los 3 Delfines', [[f.stone, stone], [f.water, water], [f.jet, jetMat]], { half: 0 });
  }
  {
    const f = fountain(7);
    place('Rey Nayar', [[f.stone, stone], [f.water, water], [pedestal(2.0, 4.5), darkStone], [figure(3.6, true).translate(0, 4.5, 0), bronze]], { half: 2.2, height: 9 });
  }
  {
    const bowl = new THREE.LatheGeometry([[0, 1.0], [2.6, 1.2], [3.2, 2.6], [3.0, 2.7], [2.4, 1.6], [0, 1.4]].map(([x, y]) => new THREE.Vector2(x, y)), 32).toNonIndexed();
    const legs = [0, 2.09, 4.19].map((a) => cyl(0.5, 0.35, 1.2, Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6, 8));
    const f = fountain(7);
    place('Fuente Molcajete', [[f.stone, stone], [f.water, water], [mergeGeometries([bowl, ...legs]), darkStone], [new THREE.CircleGeometry(2.7, 32).rotateX(-Math.PI / 2).translate(0, 2.45, 0).toNonIndexed(), water]], { half: 3.2, height: 3 });
  }
  // The big letters: TEPIC & NAYARIT, each letter its own colour
  for (const [name, word] of [['Tepic', 'TEPIC'], ['Nayarit', 'NAYARIT']]) {
    const glyphs = letters(word, 2.6);
    place(name, glyphs.map((g, i): MonumentPart => [g, letterMats[i % letterMats.length]]), { half: word.length * 1.1, height: 2.6 });
  }
  // The cross on the Cerro de la Cruz (white, 14 m) and the antennas of the Cerro Microondas
  place('Cerro de la Cruz', [[box(0.9, 14, 0.9), white], [box(6.5, 0.9, 0.9, 0, 9.2), white], [box(2.4, 0.8, 2.4), white]], { half: 1.2, height: 14 });
  {
    const p = pois.get('Cerro Microondas');
    if (p) {
      [[0, 0, 42], [26, 14, 30], [-18, 22, 24]].forEach(([dx, dz, h], i) => {
        const t = tower(h);
        place(`Antena ${i + 1}`, [[t.steel, towerRed], [t.dishes, steel], [t.beacon, beacon]], { at: { x: p.x + dx, z: p.z + dz }, yaw: i * 0.7, half: h * 0.09, height: h });
      });
    }
  }
  return built;
}

function buildTepicLandmarks(scene: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = 'TepicLandmarks';
  const colliders: Collider[] = [];
  if (CATEDRAL) buildCatedral(group, colliders);
  const monuments = buildMonuments(group, colliders);
  console.info(`[landmarks] the Catedral and ${monuments} monuments`);
  scene.add(group);
  return { group, colliders };
}

export { buildTepicLandmarks, LANDMARK_RESERVES, CATEDRAL, PLAN, curbFront, frontRuns, figure };
