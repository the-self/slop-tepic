// js/world/central.ts
// Builds the Central de Autobuses (central-plan.ts lays it out): the terminal's hall along Av. Insurgentes, cream
// walls over a brown zócalo, glazed all along its front on the car park under the portal and along its back on the
// andén, its long red tile roof running on over both; the sign over the front; the andén's raised walk and the columns
// holding up the canopy over it; the patio's concrete, the andenes' and the patio's bays painted yellow, the wall on
// Calle Dr. Martínez; and the coaches of the lines that leave from it standing in their bays (actors/vehicles/coach.ts),
// instanced, drawn while the camera is within SHOW m. The hall, the columns, the walls and the coaches stop the player.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, abs, fract, float, mix, smoothstep, step } from 'three/tsl';
import { liftAt } from './ground.ts';
import { drapeGeometry } from './drape.ts';
import { FlatLayer, fillLot, paintLine, pavedHeight } from './car-parks.ts';
import {
  TERMINAL, PORTAL, CANOPY, PLATFORM, PATIO_PTS, WALLS, COACH_L, COACH_W,
  centralAt, coachBays, parkCoaches, inCentral
} from './central-plan.ts';
import { cityUniforms, createPavementMaterial, createRoadPaintMaterial } from '../render/tsl-materials.ts';
import {
  buildCoachBodyGeometry, buildCoachWheelsGeometry, buildCoachNameGeometry, coachNameTexture, createBusWheelMaterial,
  createCoachMaterial, createCoachNameMaterial,
  standingBox as box // (a box w × h × d (m) standing on y, centred on (u, v) of the frame)
} from '../actors/actor-models.ts';
import type { Collider } from './buildings.ts';
import type { TileStreamer } from './streaming.ts';
import type { LotReserve } from './landmark-models.ts';
import type { MapBlock } from '../ui/city-map.ts';

/** The lines that leave from the Central, their names as the game letters them (parodies, as the stores'), and their
 *  liveries: the body, the two swooshes (0xrrggbb), the name's ink & edge (CSS) */
const LINES: [name: string, body: number, stripe: number, stripe2: number, ink: string, edge: string][] = [
  ['ETM TURISTAR', 0x2c2b30, 0xc9a227, 0x8c6d1f, '#d8b24a', '#1a1a1d'],
  ['PRIMERA PLUZ', 0xf2f2f0, 0x4b2a85, 0x1e88d0, '#4b2a85', '#ffffff'],
  ['ESTRELLA BLANKA', 0xf4f4f2, 0xc8102e, 0x1d3f8f, '#c8102e', '#ffffff'],
  ['TAB DEL PACÍFICO', 0xf0f1ee, 0x003d7d, 0xf28c00, '#003d7d', '#ffffff'],
  ['FUTURRA', 0xeeeeec, 0x0055a5, 0xf6c400, '#0055a5', '#ffffff'],
  ['NORTE DE ZONORA', 0xf3f3f1, 0xd52b1e, 0xf39200, '#d52b1e', '#ffffff'],
  ['ÉLIT', 0xd9dbde, 0xb3121b, 0x55575b, '#b3121b', '#ffffff'],
  ['TUFEZA', 0xf2f2f0, 0x003a70, 0xe5711d, '#003a70', '#ffffff']
];

const SHOW = 700; // m from the camera within which the coaches are drawn
const WALL_H = 5.4; // m: the hall's walls
const RIDGE = 8.6; // m: the roof's ridge, along the hall's middle
const PITCH = 0.227; // the roof's fall (m per m) from the ridge, out over the portal and the andén
const PATIO_WALL_H = 2.6; // m
const WALL_PIECE = 10; // m: the patio's walls are laid in lengths of this, each on its ground
const PLATFORM_H = 0.22; // m: the andén's curb over the patio
const YELLOW = new THREE.Color(0xe8ad22);


// Triangles & quads of the frame (u, y, v), their normals by their winding (their materials draw both sides)
function tris(points: [number, number, number][][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const [a, b, c, ...d] of points) {
    pos.push(...a, ...b, ...c);
    for (const e of d) pos.push(...a, ...c, ...e); // (a quad: its second triangle)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The terminal's sign over its front: its name, red on white */
function signTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the Central\'s sign');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#b3121b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 60px 'Arial Black', Arial, sans-serif`;
  ctx.fillText('CENTRAL DE AUTOBUSES', 512, 52);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The terminal's materials: the walls (a brown zócalo at their foot), the roof's tiles, the glass (lit inside at
 *  night), the white trim & columns, the andén's concrete & its yellow curb, the sign */
function terminalMaterials() {
  const p = attribute('position', 'vec3');
  const wall = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  wall.colorNode = mix(color(0xe8dfcb), color(0x7a5b46), step(p.y, 0.9));
  // the tiles: rows along the ridge 0.33 m apart down the slope, the channels 0.22 m apart, each tile a little off
  const roof = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const row = fract(abs(p.z.sub((TERMINAL[2] + TERMINAL[3]) / 2)).div(0.33));
  const channel = abs(fract(p.x.div(0.22)).sub(0.5)).mul(2.0);
  const tone = fract(p.x.div(0.22).floor().mul(0.37).add(abs(p.z).div(0.33).floor().mul(0.71)));
  roof.colorNode = color(0xa4482a).mul(float(0.82).add(tone.mul(0.12)))
    .mul(float(1.0).sub(smoothstep(0.85, 1.0, row).mul(0.35))).mul(float(0.88).add(channel.mul(0.12)));
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.55 });
  glass.colorNode = color(0x1b2a36);
  glass.emissiveNode = color(0xffd9a0).mul(smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow).mul(0.55));
  const trim = new THREE.MeshStandardNodeMaterial({ color: 0xf1efe9, roughness: 0.6, metalness: 0.05 });
  const concrete = new THREE.MeshStandardNodeMaterial({ color: 0xb5afa4, roughness: 0.92, metalness: 0 });
  const curb = new THREE.MeshStandardNodeMaterial({ color: 0xe0a81f, roughness: 0.7, metalness: 0 });
  const sign = new THREE.MeshStandardNodeMaterial({ map: signTexture(), roughness: 0.5, metalness: 0 });
  sign.emissiveNode = color(0xffffff).mul(smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow).mul(0.35));
  return { wall, roof, glass, trim, concrete, curb, sign };
}

/** The terminal's pieces in its frame (u, y, v; y from its floor), each a geometry for its material. `ground(u, v)`:
 *  the patio's height there over the hall's floor (m: the andén stands on it, a step over it, whatever the slope) */
function terminalGeometry(ground: (u: number, v: number) => number) {
  const [u0, u1, v0, v1] = TERMINAL;
  const L = u1 - u0, D = v1 - v0, mu = (u0 + u1) / 2, mid = (v0 + v1) / 2;
  const wall: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
  const roof: THREE.BufferGeometry[] = [], concrete: THREE.BufferGeometry[] = [], curb: THREE.BufferGeometry[] = [];
  // the hall, on a plinth down into the ground (the town's slopes under its length)
  wall.push(box(L, WALL_H + 1.5, D, mu, -1.5, mid));
  // the roof: two slopes from the ridge running on over the portal (front) and over the andén (back), and the gables
  // closing the walls up to it at either end
  const yAt = (v: number) => RIDGE - PITCH * Math.abs(v - mid);
  const front = v0 - PORTAL, back = v1 + CANOPY;
  const eaveF = yAt(front), eaveB = yAt(back);
  for (const u of [u0, u1]) {
    wall.push(tris([[[u, WALL_H, v0], [u, yAt(v0), v0], [u, RIDGE, mid], [u, WALL_H, mid]],
      [[u, WALL_H, mid], [u, RIDGE, mid], [u, yAt(v1), v1], [u, WALL_H, v1]]]));
  }
  roof.push(tris([
    [[u0 - 0.6, RIDGE, mid], [u1 + 0.6, RIDGE, mid], [u1 + 0.6, eaveF, front], [u0 - 0.6, eaveF, front]],
    [[u0 - 0.6, RIDGE, mid], [u0 - 0.6, eaveB, back], [u1 + 0.6, eaveB, back], [u1 + 0.6, RIDGE, mid]]
  ]));
  // the fascias along both eaves, the ridge's cap
  trim.push(box(L + 1.2, 0.35, 0.12, mu, eaveF - 0.42, front), box(L + 1.2, 0.35, 0.12, mu, eaveB - 0.42, back));
  roof.push(box(L + 1.2, 0.14, 0.4, mu, RIDGE - 0.05, mid));
  // the front: glazed between pillars every BAY m, the doors in the middle bays; a white band over it
  const BAY = 7.75;
  const n = Math.round(L / BAY);
  for (let k = 0; k < n; k++) {
    const a = u0 + (k * L) / n, b = u0 + ((k + 1) * L) / n;
    glass.push(box(b - a - 0.7, 3.5, 0.1, (a + b) / 2, 0.15, v0 - 0.04));
    trim.push(box(0.7, WALL_H, 0.5, a, 0, v0 - 0.2));
  }
  trim.push(box(L, 0.45, 0.3, mu, 3.65, v0 - 0.12));
  // the portal's columns at the roof's front edge, the walk under it
  for (let k = 0; k <= n; k++) trim.push(box(0.4, yAt(front + 0.4) - 0.1, 0.4, u0 + (k * L) / n, 0, front + 0.4));
  // the sign's white board, standing on the portal's roof at its edge
  trim.push(box(26.4, 2.7, 0.15, mu, eaveF - 0.1, front + 0.5));
  concrete.push(box(L + 1.2, 0.15 + 1, PORTAL, mu, -1, v0 - PORTAL / 2));
  // the back: a glass door onto the andén every 4.5 m, the clerestory band of glass over them
  for (let u = u0 + 3; u + 2.6 < u1; u += 4.5) glass.push(box(2.6, 2.7, 0.1, u + 1.3, PLATFORM_H, v1 + 0.04));
  glass.push(box(L - 2, 1.0, 0.1, mu, 3.4, v1 + 0.04));
  // the andén: its walk and its yellow curb a step over the patio, laid in lengths on its slope; the canopy's columns
  // along it, between the bays
  const [pu0, pu1, pv0, pv1] = PLATFORM;
  const STEP = 9.3;
  const columns: [u: number, v: number, foot: number][] = [];
  for (let a = pu0; a < pu1 - 0.01; a += STEP) {
    const b = Math.min(pu1, a + STEP), y = ground((a + b) / 2, pv1 + 2) + PLATFORM_H;
    concrete.push(box(b - a, y + 1.5, pv1 - pv0 - 0.25, (a + b) / 2, -1.5, (pv0 + pv1) / 2 - 0.12));
    curb.push(box(b - a, y + 1.5, 0.25, (a + b) / 2, -1.5, pv1 - 0.125));
    const u = a + 1;
    trim.push(box(0.35, yAt(pv1 - 0.6) - 0.1 - y, 0.35, u, y, pv1 - 0.6));
    columns.push([u, pv1 - 0.6, y]);
  }
  return { wall, glass, trim, roof, concrete, curb, columns, eaveF };
}

/** A coach as drawn: where (m, on the ground), its turn & tilt (rad), its line */
interface PlacedCoach {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  line: number;
}

/**
 * The Central into the scene (its patio's ground & paint to `streamer` when there is one, laid tile by tile round the
 * camera). Returns its colliders, its block (kept clear of yard trees and bardas), its hall's footprint for the maps,
 * and `update(x, z)`, which shows the coaches while the camera is near
 */
function buildCentral(scene: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'> | null = null) {
  const group = new THREE.Group();
  group.name = 'CentralDeAutobuses';
  scene.add(group);
  const colliders: Collider[] = [];

  // the frame's turn: its u along the world's (UX, UZ), v along (VX, VZ)
  const o = centralAt(0, 0), e = centralAt(1, 0);
  const yaw = Math.atan2(-(e.z - o.z), e.x - o.x);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const [u0, u1, v0, v1] = TERMINAL;
  const mid = centralAt((u0 + u1) / 2, (v0 + v1) / 2);
  const patioY = pavedHeight(mid.x, mid.z);
  // the hall's floor: over the ground at its highest corner (the site dips ~1 m under its middle: its plinth shows
  // there, and nothing of it is buried on the car park's side)
  const floorY = patioY + Math.max(...[[u0, v0], [u1, v0], [u1, v1], [u0, v1], [(u0 + u1) / 2, (v0 + v1) / 2]].map(([u, v]) => {
    const p = centralAt(u, v);
    return liftAt(p.x, p.z);
  }));
  // the patio's height at (u, v) over the hall's floor (m)
  const ground = (u: number, v: number) => {
    const p = centralAt(u, v);
    return liftAt(p.x, p.z) + patioY - floorY;
  };
  // an oriented box of the frame (u0..u1 × v0..v1, from y0 to y1 over the floor) that stops the player
  const collide = (a0: number, a1: number, b0: number, b1: number, y0: number, y1: number) => {
    const c = centralAt((a0 + a1) / 2, (b0 + b1) / 2);
    const hx = (a1 - a0) / 2, hz = (b1 - b0) / 2;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez, minY: floorY + y0, maxY: floorY + y1,
      obb: { cx: c.x, cz: c.z, hx, hz, cs, sn } });
  };

  // The patio's concrete, and the bays' yellow lines on it
  const paved = new FlatLayer(), paint = new FlatLayer();
  fillLot(paved, { pts: PATIO_PTS }, patioY, { pave: [3] });
  const bays = coachBays();
  for (const bay of bays) for (const [a, b] of bay.lines) paintLine(paint, a.x, a.z, b.x, b.z, patioY + 0.012, YELLOW);
  const layers: [FlatLayer, THREE.Material, string, number][] = [
    [paved, createPavementMaterial(), 'CentralPatio', 0],
    [paint, createRoadPaintMaterial(), 'CentralPaint', -1]
  ];
  for (const [layer, material, name, renderOrder] of layers) {
    const g = layer.geometry();
    if (!g) continue;
    if (streamer) {
      streamer.addLayer(g, material, { name, renderOrder });
      continue;
    }
    const mesh = new THREE.Mesh(drapeGeometry(g), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
  }

  // The terminal, in its frame turned into place on its floor
  const hall = new THREE.Group();
  hall.name = 'CentralTerminal';
  hall.position.set(o.x, floorY, o.z);
  hall.rotation.y = yaw;
  group.add(hall);
  const mats = terminalMaterials();
  const geo = terminalGeometry(ground);
  for (const [list, mat, shadow] of [
    [geo.wall, mats.wall, true], [geo.roof, mats.roof, true], [geo.glass, mats.glass, false], [geo.trim, mats.trim, true],
    [geo.concrete, mats.concrete, false], [geo.curb, mats.curb, false]
  ] as const) {
    const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => g.index ? g.toNonIndexed() : g).map((g) => {
      g.deleteAttribute('uv');
      return g;
    })), mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    hall.add(mesh);
  }
  // the sign over the portal, on the white band at the front of the roof (its name both ways: from the car park)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.4), mats.sign);
  sign.rotation.y = Math.PI;
  sign.position.set((u0 + u1) / 2, geo.eaveF + 1.25, v0 - PORTAL + 0.42);
  hall.add(sign);
  // the patio's walls, square to the frame, in lengths of WALL_PIECE m each on the ground under it (their foot down
  // into it: the patio slopes)
  const walls: THREE.BufferGeometry[] = [];
  for (const [a0, b0, a1, b1] of WALLS) {
    const alongU = b0 === b1, from = alongU ? Math.min(a0, a1) : Math.min(b0, b1), to = alongU ? Math.max(a0, a1) : Math.max(b0, b1);
    const n = Math.ceil((to - from) / WALL_PIECE);
    for (let k = 0; k < n; k++) {
      const s = from + ((to - from) * k) / n, t = from + ((to - from) * (k + 1)) / n, m = (s + t) / 2;
      const [cu, cv] = alongU ? [m, b0] : [a0, m];
      const y = ground(cu, cv);
      walls.push(box(alongU ? t - s + 0.2 : 0.2, PATIO_WALL_H + 1, alongU ? 0.2 : t - s + 0.2, cu, y - 1, cv));
      if (alongU) collide(s, t, b0 - 0.1, b0 + 0.1, y - 1, y + PATIO_WALL_H);
      else collide(a0 - 0.1, a0 + 0.1, s, t, y - 1, y + PATIO_WALL_H);
    }
  }
  const wallMesh = new THREE.Mesh(mergeGeometries(walls.map((g) => {
    g.deleteAttribute('uv');
    return g;
  })), mats.wall);
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  hall.add(wallMesh);
  // what stops the player: the hall, the columns of the portal & the canopy, the andén's curb is a step
  collide(u0, u1, v0, v1, -1, RIDGE);
  for (const [u, v, foot] of geo.columns) collide(u - 0.2, u + 0.2, v - 0.2, v + 0.2, foot, WALL_H);

  // The coaches standing in the bays, each on the ground under it
  const coaches: PlacedCoach[] = parkCoaches(bays, LINES.length).map(({ bay, line }) => {
    const fx = Math.sin(bay.heading), fz = Math.cos(bay.heading);
    const y = liftAt(bay.x, bay.z) + patioY;
    const ahead = (liftAt(bay.x + fx * 4, bay.z + fz * 4) - liftAt(bay.x - fx * 4, bay.z - fz * 4)) / 8;
    const right = (liftAt(bay.x + fz, bay.z - fx) - liftAt(bay.x - fz, bay.z + fx)) / 2;
    return { x: bay.x, y, z: bay.z, yaw: bay.heading, pitch: -Math.atan(ahead), roll: Math.atan(right), line };
  });
  const count = coaches.length;
  const bodyGeo = buildCoachBodyGeometry();
  const body = new THREE.InstancedMesh(bodyGeo, createCoachMaterial(), count);
  const wheels = new THREE.InstancedMesh(buildCoachWheelsGeometry(), createBusWheelMaterial(), count);
  const names = new THREE.InstancedMesh(buildCoachNameGeometry(), createCoachNameMaterial(
    coachNameTexture(LINES.map(([name, , , , ink, edge]) => [name, ink, edge] as const)), LINES.length), count);
  const paints = { coachBody: new Float32Array(count * 3), coachStripe: new Float32Array(count * 3), coachStripe2: new Float32Array(count * 3) };
  const rows = new Float32Array(count);
  const dummy = new THREE.Object3D(), c = new THREE.Color();
  coaches.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    dummy.updateMatrix();
    for (const m of [body, wheels, names]) m.setMatrixAt(i, dummy.matrix);
    const [, b, s1, s2] = LINES[p.line];
    for (const [k, hex] of [['coachBody', b], ['coachStripe', s1], ['coachStripe2', s2]] as const) {
      c.setHex(hex);
      paints[k].set([c.r, c.g, c.b], i * 3);
    }
    rows[i] = p.line;
    // (it stops the player: its turned box, short of its roof)
    const hx = COACH_W / 2, hz = COACH_L / 2, ccs = Math.cos(p.yaw), csn = Math.sin(p.yaw);
    const ex = Math.abs(ccs) * hx + Math.abs(csn) * hz, ez = Math.abs(csn) * hx + Math.abs(ccs) * hz;
    colliders.push({ minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, minY: p.y, maxY: p.y + 3.3,
      obb: { cx: p.x, cz: p.z, hx, hz, cs: ccs, sn: csn } });
  });
  for (const [k, a] of Object.entries(paints)) bodyGeo.setAttribute(k, new THREE.InstancedBufferAttribute(a, 3));
  names.geometry.setAttribute('coachName', new THREE.InstancedBufferAttribute(rows, 1));
  for (const m of [body, wheels, names]) {
    m.castShadow = m !== names;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    group.add(m);
  }
  body.name = 'CentralCoaches';

  /** Shows the coaches while (x, z) is within SHOW m of the Central */
  function update(x: number, z: number): void {
    const near = Math.hypot(x - mid.x, z - mid.z) < SHOW;
    body.visible = wheels.visible = names.visible = near;
  }

  // its hall's footprint, as the maps draw the buildings
  const corners = [[u0, v0 - PORTAL], [u1, v0 - PORTAL], [u1, v1 + CANOPY], [u0, v1 + CANOPY]].map(([u, v]) => centralAt(u, v));
  const map: MapBlock = { footprints: [{
    x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)),
    z0: Math.min(...corners.map((p) => p.z)), z1: Math.max(...corners.map((p) => p.z)), h: RIDGE, tone: 0.3, pts: corners
  }] };
  const reserve: LotReserve = { contains: inCentral };
  console.info(`[central] ${bays.length} bays, ${count} coaches`);
  return { group, colliders, reserve, map, update };
}

type CentralBuild = ReturnType<typeof buildCentral>;

export type { CentralBuild };
export { buildCentral };
