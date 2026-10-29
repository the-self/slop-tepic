// js/world/central/terminal.ts
// The Central's terminal (central-plan.ts lays it out) as the photos show it from the car park: glazed all along its
// front between dark brown pillars, over the glass a tall band of dark ribbed cladding with its name in white letters
// and lime-green boxes standing out of it, the KFC at its east end on the corner of Av. Preparatoria; its long red tile
// roof (the satellite's) behind the band; at its back, white concrete umbrellas on a column each over the andén, and a
// clerestory of yellow panels in orange frames over the doors. It is walked into through sliding doors that open as
// you come (bollards keep the cars out), across the lobby, past the lines' taquillas and between the waiting room's
// rows of chairs to the doors onto the andén; the hall's floor, the walk in front and the andén are decks for those on foot
// (ground.ts addFootDecks), a step or so over the car park, the andén's edge a wall to those down on the patio.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, color, abs, fract, floor, float, max, mix, smoothstep, step } from 'three/tsl';
import { addFootDecks, groundHeight } from '../ground.ts';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { standingBox as box } from '../../actors/actor-models.ts';
import {
  TERMINAL, PORTAL, CANOPY, PLATFORM, ANNEX, BAYS, FRONT_DOORS, DOOR_W, DOOR_H, BACK_DOORS, CEILING, SEATS_PER, SEAT_H, centralAt,
  centralFrame,
  hallFurniture
} from '../central-plan.ts';
import { LINES, canvasTexture } from './site.ts';
import type { CentralSite } from './site.ts';
import type { DeckSegment } from '../ground.ts';
import type { Footprint } from '../buildings.ts';

const WALL_H = 5.4; // m: the hall's walls
const RIDGE = 8.6; // m: the roof's ridge, along the hall's middle
const PITCH = 0.227; // the roof's fall (m per m) from the ridge to the eaves over the front and back walls
const BAND: [number, number] = [3.75, 8.9]; // m: the dark band over the front's glass, from its foot to its top
const PLINTH = 2.2; // m the slab under the floor, the walk and the andén goes down (the patio lies ~1.4 m under it)
/** The green boxes standing out of the band (u0, u1; m): the photos' four, the last on the KFC's corner */
const GREENS: [number, number][] = [[-0.8, 4.2], [22, 27], [68, 73], [90.6, 95.6]];
const UMBRELLA = 9.3; // m: an umbrella's width along the andén
const UMBRELLA_V = 29.1; // m: their columns' line, on the andén near its edge
const BENCH_H = 0.9; // m: a bench's back

/** The signs: the name on the band in white capitals (two rows), the KFC's (its parody: "Kentoky Fraid Chiken") and
 *  its striped box, and the taquillas' boards, a row each: the line's name in its ink on its body's colour */
function signTextures() {
  const name = canvasTexture(2048, 320, (ctx) => {
    ctx.fillStyle = '#f6f6f2';
    ctx.font = `700 150px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
    ctx.fillText('C E N T R A L   D E   A U T O B U S E S', 1024, 82, 2000);
    ctx.fillText('T E P I C', 1024, 245, 900);
  });
  const kfc = canvasTexture(1024, 128, (ctx) => {
    ctx.fillStyle = '#e5202e';
    ctx.font = `700 92px Georgia, 'Times New Roman', serif`;
    ctx.fillText('Kentoky Fraid Chiken', 512, 68, 1000);
  });
  const logo = canvasTexture(256, 300, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 300);
    ctx.fillStyle = '#d6202c';
    for (let k = 0; k < 3; k++) ctx.fillRect(28 + k * 76, 0, 48, 120);
    ctx.fillRect(0, 120, 256, 180);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 92px 'Arial Black', Arial, sans-serif`;
    ctx.fillText('KFCh', 128, 212, 236);
  });
  const ROW = 96;
  const boards = canvasTexture(512, ROW * LINES.length, (ctx) => {
    LINES.forEach(([text, body, stripe, , ink, edge], row) => {
      const y = row * ROW;
      ctx.fillStyle = `#${body.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, y, 512, ROW);
      ctx.fillStyle = `#${stripe.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, y + ROW - 14, 512, 10);
      ctx.font = `italic 900 52px 'Arial Black', Arial, sans-serif`;
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = edge;
      ctx.strokeText(text, 256, y + ROW / 2 - 4, 480);
      ctx.fillStyle = ink;
      ctx.fillText(text, 256, y + ROW / 2 - 4, 480);
    });
  });
  return { name, kfc, logo, boards };
}

/** The terminal's materials (their patterns in the frame's metres: the geometry is laid in it) */
function terminalMaterials() {
  const p = attribute('position', 'vec3');
  const std = (hex: number, roughness: number, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });
  // white walls over a grey zócalo (the photos' patio side), down the plinth too
  const wall = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  wall.colorNode = mix(color(0xefede7), color(0x8b939a), step(p.y, 0.9));
  // the band: dark sheet ribbed every 18 cm (round the corners too: along u + v)
  const band = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.35 });
  const rib = abs(fract(p.x.add(p.z).div(0.18)).sub(0.5)).mul(2.0);
  band.colorNode = color(0x2f3134).mul(float(0.72).add(smoothstep(0.2, 0.8, rib).mul(0.28)));
  // the roof's tiles: rows along the ridge 0.33 m apart down the slope, the channels 0.22 m apart, each a little off
  const roof = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const row = fract(abs(p.z.sub((TERMINAL[2] + TERMINAL[3]) / 2)).div(0.33));
  const channel = abs(fract(p.x.div(0.22)).sub(0.5)).mul(2.0);
  const tone = fract(p.x.div(0.22).floor().mul(0.37).add(abs(p.z).div(0.33).floor().mul(0.71)));
  roof.colorNode = color(0xa4482a).mul(float(0.82).add(tone.mul(0.12)))
    .mul(float(1.0).sub(smoothstep(0.85, 1.0, row).mul(0.35))).mul(float(0.88).add(channel.mul(0.12)));
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.55, depthWrite: false });
  glass.colorNode = color(0x1b2a36);
  glass.emissiveNode = color(0xffd9a0).mul(smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow).mul(0.3));
  // the floor: polished tiles 60 cm square, two creams in a chequer, grouted; lit a little by the ceiling's panels
  const floorMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0 });
  const cu = fract(p.x.div(0.6)), cv = fract(p.z.div(0.6));
  const chequer = fract(floor(p.x.div(0.6)).add(floor(p.z.div(0.6))).mul(0.5)).mul(2.0);
  const grout = max(step(0.97, cu), step(0.97, cv));
  const tile = mix(mix(color(0xcdbb9c), color(0xb9a585), chequer), color(0x7d6f5e), grout);
  floorMat.colorNode = tile;
  floorMat.emissiveNode = tile.mul(0.1);
  // the ceiling: white, a light panel in every 3.1 × 2.6 m
  const ceiling = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const panel = step(abs(fract(p.x.div(3.1)).sub(0.5)), 0.2).mul(step(abs(fract(p.z.div(2.6)).sub(0.5)), 0.12));
  ceiling.colorNode = mix(color(0xf2f1ec), color(0xffffff), panel);
  ceiling.emissiveNode = color(0xfff3e0).mul(panel.mul(1.1).add(0.06));
  // the clerestory over the andén's doors: yellow panels in orange frames, glowing a little after dark
  const clerestory = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const mullion = max(step(0.94, fract(p.x.div(1.55))), step(abs(fract(p.y.div(0.95)).sub(0.5)), 0.04));
  clerestory.colorNode = mix(color(0xe6cf86), color(0xd0602a), mullion);
  clerestory.emissiveNode = color(0xffe6a0).mul(float(1.0).sub(mullion)).mul(float(0.12).add(smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow).mul(0.5)));
  // the letters and the boards: cut out of the clear
  const tex = signTextures();
  const cut = (map: THREE.Texture, glow: number) => {
    const m = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.5, metalness: 0, transparent: true, alphaTest: 0.4 });
    m.emissiveNode = color(0xffffff).mul(smoothstep(0.5, 1.1, cityUniforms.uInteriorGlow).mul(glow));
    return m;
  };
  return {
    wall, band, roof, glass, floor: floorMat, ceiling, clerestory,
    green: std(0x5fbf34, 0.65), pillar: std(0x5c3d2e, 0.7), trim: std(0xf1efe9, 0.6, 0.05), dark: std(0x232629, 0.5, 0.4),
    concrete: std(0xb5afa4, 0.92), curb: std(0xe0a81f, 0.7), umbrella: std(0xf0eee8, 0.8), stone: std(0x6d5547, 0.75),
    counter: std(0x6b4a33, 0.55), steel: std(0x8e959c, 0.4, 0.6), chair: std(0x1f5aa6, 0.45, 0.1),
    name: cut(tex.name, 0.6), kfc: cut(tex.kfc, 0.8), logo: cut(tex.logo, 0.5), boards: cut(tex.boards, 0.6)
  };
}
type TerminalMaterials = ReturnType<typeof terminalMaterials>;
type Piece = keyof TerminalMaterials;

/** A plane w × h (m) standing at (u, y, v) facing -v (out of the front), its uv's rows `row` of `rows` */
function facingPlane(w: number, h: number, u: number, y: number, v: number, row = 0, rows = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(u, y, v);
  const uvs = g.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) uvs.setY(i, (rows - 1 - row + uvs.getY(i)) / rows);
  return g;
}

/** Triangles & quads of the frame (u, y, v), their normals by their winding (their materials draw both sides) */
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

/**
 * The terminal into `site.hall`: its shell, its front, its KFC, the umbrellas over the andén, its inside; its walls,
 * columns & furniture stop the player, its floors are walked on. Returns its footprints for the maps and `update(dt,
 * x, z)`, which slides the front doors open for someone at (x, z) (m) coming to them
 */
function buildTerminal(site: CentralSite) {
  const { collide } = site;
  const mats = terminalMaterials();
  const parts = new Map<Piece, THREE.BufferGeometry[]>();
  const add = (piece: Piece, ...g: THREE.BufferGeometry[]) => {
    let list = parts.get(piece);
    if (!list) parts.set(piece, (list = []));
    list.push(...g);
  };
  const [u0, u1, v0, v1] = TERMINAL;
  const L = u1 - u0, D = v1 - v0, mu = (u0 + u1) / 2, mid = (v0 + v1) / 2;
  const [a0, a1, b0, b1] = ANNEX;

  // The slab under the hall's floor, the walk in front (on to the KFC's corner) and the andén behind, down into the
  // ground; the andén's yellow edge
  add('wall', box(L, PLINTH, D, mu, -PLINTH, mid));
  add('concrete', box(a1 + 0.4 - u0, PLINTH, PORTAL, (u0 + a1 + 0.4) / 2, -PLINTH, v0 - PORTAL / 2));
  const [, , pv0, pv1] = PLATFORM;
  add('concrete', box(L, PLINTH, pv1 - pv0 - 0.25, mu, -PLINTH, (pv0 + pv1 - 0.25) / 2));
  add('curb', box(L, PLINTH + 0.02, 0.25, mu, -PLINTH, pv1 - 0.125));
  // (a wall to those down on the patio, short of the floor: who walks on it, a hair under it or over, passes; its ends
  // are a step they climb)
  collide(u0 + 6, u1 - 6, pv0 + 0.2, pv1, -3, -0.3);

  // The roof: two slopes from the ridge to the eaves over the front and back walls, the gables closing the end walls
  // up to it; the fascia on the back eave, the ridge's cap
  const yAt = (v: number) => RIDGE - PITCH * Math.abs(v - mid);
  const eave = yAt(v0);
  for (const u of [u0, u1]) {
    add('wall', tris([[[u, WALL_H, v0], [u, eave, v0], [u, RIDGE, mid], [u, WALL_H, mid]],
      [[u, WALL_H, mid], [u, RIDGE, mid], [u, eave, v1], [u, WALL_H, v1]]]));
  }
  add('roof', tris([
    [[u0 - 0.6, RIDGE, mid], [u1 + 0.6, RIDGE, mid], [u1 + 0.6, eave, v0 - 0.3], [u0 - 0.6, eave, v0 - 0.3]],
    [[u0 - 0.6, RIDGE, mid], [u0 - 0.6, eave, v1 + 0.5], [u1 + 0.6, eave, v1 + 0.5], [u1 + 0.6, RIDGE, mid]]
  ]), box(L + 1.2, 0.14, 0.4, mu, RIDGE - 0.05, mid));
  add('trim', box(L + 1.2, 0.3, 0.12, mu, eave - 0.36, v1 + 0.5));

  // The end walls (white over the zócalo), up to the roof's eaves
  for (const u of [u0, u1]) {
    add('wall', box(0.3, WALL_H, D, u, 0, mid));
    collide(u - 0.15, u + 0.15, v0, v1, -1, WALL_H);
  }

  // The front: the glass between the dark brown pillars, the doors' openings in it, a white strip over it (inside,
  // the wall up to the ceiling); the dark band over it all, its lip, the green boxes over their white slabs, the name
  const bay = L / BAYS;
  for (let k = 0; k <= BAYS; k++) add('pillar', box(0.6, BAND[0], 0.55, u0 + k * bay, 0, v0 - 0.1));
  let wallFrom = u0; // (the front wall's colliders: from one door to the next)
  for (let k = 0; k < BAYS; k++) {
    const a = u0 + k * bay + 0.3, b = u0 + (k + 1) * bay - 0.3;
    const door = FRONT_DOORS.find((d) => d > a && d < b);
    if (door === undefined) {
      add('glass', box(b - a, 3.45, 0.1, (a + b) / 2, 0.1, v0 - 0.02));
      continue;
    }
    const l = door - DOOR_W / 2, r = door + DOOR_W / 2;
    add('glass', box(l - a, 3.45, 0.1, (a + l) / 2, 0.1, v0 - 0.02), box(b - r, 3.45, 0.1, (r + b) / 2, 0.1, v0 - 0.02),
      box(DOOR_W, 3.55 - DOOR_H, 0.1, door, DOOR_H, v0 - 0.02));
    add('dark', box(0.1, DOOR_H, 0.16, l, 0, v0 - 0.02), box(0.1, DOOR_H, 0.16, r, 0, v0 - 0.02), box(DOOR_W, 0.12, 0.16, door, DOOR_H - 0.06, v0 - 0.02));
    collide(wallFrom, l, v0 - 0.2, v0 + 0.2, -1, WALL_H);
    wallFrom = r;
  }
  collide(wallFrom, u1, v0 - 0.2, v0 + 0.2, -1, WALL_H);
  add('trim', box(L, BAND[0] - 3.55, 0.3, mu, 3.55, v0 - 0.05), box(L, CEILING + 0.1 - 3.55, 0.2, mu, 3.55, v0 + 0.12));
  const bandU0 = u0 - 0.8, bandU1 = a1 + 0.4;
  add('band', box(bandU1 - bandU0, BAND[1] - BAND[0], 0.4, (bandU0 + bandU1) / 2, BAND[0], v0 - 0.45));
  add('trim', box(bandU1 - bandU0, 0.12, 1.0, (bandU0 + bandU1) / 2, BAND[0] - 0.12, v0 - 0.6));
  for (const [a, b] of GREENS) {
    add('green', box(b - a, 5.1, 0.95, (a + b) / 2, 3.2, v0 - 0.95));
    add('trim', box(b - a + 0.6, 0.15, 1.9, (a + b) / 2, 3.05, v0 - 1.15));
  }
  add('name', facingPlane(31, 4.85, mu, 6.35, v0 - 0.67));
  // the white space-frame canopy over the middle doors, on two columns at the walk's edge
  const [dm0, dm1] = [FRONT_DOORS[1], FRONT_DOORS[2]];
  add('trim', box(dm1 - dm0 + 7, 0.35, PORTAL + 1.2, (dm0 + dm1) / 2, 3.35, v0 - (PORTAL + 1.2) / 2 - 0.3));
  for (const u of [dm0 - 2.5, dm1 + 2.5]) {
    add('trim', box(0.3, 3.35 + PLINTH, 0.3, u, -PLINTH, v0 - PORTAL - 0.3));
    collide(u - 0.15, u + 0.15, v0 - PORTAL - 0.45, v0 - PORTAL - 0.15, -1, 3.35);
  }
  // bollards across the walk's edge in front of each door: a walker gets between them, a car doesn't
  for (const d of FRONT_DOORS) {
    for (const du of [-1.6, -0.53, 0.53, 1.6]) {
      const u = d + du, v = v0 - PORTAL - 0.3, g = site.ground(u, v);
      add('curb', box(0.2, 0.9, 0.2, u, g, v));
      collide(u - 0.1, u + 0.1, v - 0.1, v + 0.1, g, g + 0.9);
    }
  }

  // The KFC on the corner: its white flank on Preparatoria, the band on over its front, its stone-faced front with
  // two windows and its door, its name in red on the band and its striped box
  add('wall', box(a1 - a0, 8.4 + 1, b1 - b0 - 0.2, (a0 + a1) / 2, -1, (b0 + b1) / 2 + 0.1));
  add('stone', box(a1 - 95.6, BAND[0], 0.3, (95.6 + a1) / 2, 0, b0 - 0.05));
  add('glass', box(2.4, 2.1, 0.1, 98.4, 0.9, b0 - 0.25), box(2.2, 2.1, 0.1, 101.5, 0.9, b0 - 0.25));
  add('dark', box(1.6, 2.5, 0.1, 96.5, 0, b0 - 0.25));
  add('kfc', facingPlane(5.4, 0.68, 100.2, 6.1, v0 - 0.67));
  add('logo', facingPlane(1.4, 1.65, 96.6, 6.1, v0 - 0.67));
  collide(a0, a1, b0 - 0.2, b1, -1, 8.4);

  // The back: the doors onto the andén, the wall between and over them, the clerestory over that
  let backFrom = u0;
  for (const [a, b] of BACK_DOORS) {
    add('wall', box(a - backFrom, DOOR_H, 0.3, (a + backFrom) / 2, 0, v1));
    add('dark', box(0.1, DOOR_H, 0.34, a, 0, v1), box(0.1, DOOR_H, 0.34, b, 0, v1));
    collide(backFrom, a, v1 - 0.15, v1 + 0.15, -1, WALL_H);
    backFrom = b;
  }
  add('wall', box(u1 - backFrom, DOOR_H, 0.3, (u1 + backFrom) / 2, 0, v1));
  collide(backFrom, u1, v1 - 0.15, v1 + 0.15, -1, WALL_H);
  add('wall', box(L, 3.45 - DOOR_H, 0.3, mu, DOOR_H, v1), box(L, WALL_H - 5.25, 0.3, mu, 5.25, v1));
  add('clerestory', box(L, 5.25 - 3.45, 0.12, mu, 3.45, v1));

  // The umbrellas over the andén: a column each, its shell an upturned pyramid from the column's head to its four
  // corners, edge to edge along the andén
  for (let k = 0; k * UMBRELLA < L - 0.1; k++) {
    const u = u0 + (k + 0.5) * UMBRELLA, a = u - UMBRELLA / 2, b = u + UMBRELLA / 2, c0 = v1 + 0.15, c1 = v1 + CANOPY;
    const head = 4.1, edge = 5.35, vc = UMBRELLA_V;
    add('umbrella', tris([
      [[u, head, vc], [a, edge, c0], [b, edge, c0]], [[u, head, vc], [b, edge, c0], [b, edge, c1]],
      [[u, head, vc], [b, edge, c1], [a, edge, c1]], [[u, head, vc], [a, edge, c1], [a, edge, c0]]
    ]), box(0.45, head, 0.45, u, 0, vc), box(UMBRELLA, 0.18, 0.1, u, edge - 0.09, c1));
    collide(u - 0.23, u + 0.23, vc - 0.23, vc + 0.23, -1, head);
  }

  // Inside: the floor, the ceiling over it
  add('floor', new THREE.PlaneGeometry(L - 0.3, D - 0.3).rotateX(-Math.PI / 2).translate(mu, 0.012, mid));
  add('ceiling', new THREE.PlaneGeometry(L - 0.3, D - 0.3).rotateX(Math.PI / 2).translate(mu, CEILING, mid));
  const inside = hallFurniture(LINES.length);
  // the taquillas: a counter each with its glass, the wall behind them with each line's board over its counter
  const [cv0, cv1] = inside.counterV;
  for (const t of inside.taquillas) {
    const um = (t.u0 + t.u1) / 2, w = t.u1 - t.u0;
    add('counter', box(w - 0.12, 1.05, cv1 - cv0, um, 0, (cv0 + cv1) / 2));
    add('trim', box(w - 0.08, 0.05, cv1 - cv0 + 0.1, um, 1.05, (cv0 + cv1) / 2));
    add('glass', box(w - 0.3, 0.95, 0.04, um, 1.1, cv0 + 0.3));
    add('wall', box(w, 3.3, 0.3, um, 0, cv1 + 1.15));
    add('boards', facingPlane(w - 0.5, (w - 0.5) * (96 / 512), um, 2.75, cv1 + 0.98, t.line, LINES.length));
  }
  for (const run of [inside.taquillas.filter((t) => t.u0 < 46), inside.taquillas.filter((t) => t.u0 >= 46)]) {
    if (run.length) collide(run[0].u0, run[run.length - 1].u1, cv0, cv1 + 1.3, 0, 3.3);
  }
  // the waiting room's rows of chairs, facing the andén's doors: on a steel beam on two legs, each chair a moulded
  // seat and back, an armrest between each two
  for (const [a, b, v] of inside.benches) {
    add('steel', box(b - a, 0.06, 0.08, (a + b) / 2, SEAT_H - 0.16, v + 0.3));
    for (const u of [a + 0.25, b - 0.25]) add('steel', box(0.06, SEAT_H - 0.16, 0.42, u, 0, v + 0.3));
    for (let k = 0; k <= SEATS_PER; k++) add('steel', box(0.05, 0.22, 0.42, a + (k * (b - a)) / SEATS_PER, SEAT_H, v + 0.32));
    collide(a, b, v, v + 0.55, 0, BENCH_H);
  }
  for (const [u, v] of inside.seats) {
    const w = (inside.benches[0][1] - inside.benches[0][0]) / SEATS_PER - 0.08;
    add('chair', box(w, 0.06, 0.46, u, SEAT_H - 0.06, v + 0.02), box(w, BENCH_H - SEAT_H + 0.02, 0.06, u, SEAT_H - 0.02, v - 0.24));
  }
  for (const [u, v] of inside.columns) {
    add('trim', box(0.6, CEILING, 0.6, u, 0, v));
    collide(u - 0.3, u + 0.3, v - 0.3, v + 0.3, 0, CEILING);
  }
  // the kiosks in the lobby: a counter under an awning on four posts (the awnings' own colours: a mesh each)
  const awnings: THREE.Mesh[] = [];
  for (const [a, b, c, d, hex] of inside.kiosks) {
    add('counter', box(b - a, 1.1, d - c, (a + b) / 2, 0, (c + d) / 2));
    for (const [pu, pv] of [[a, c], [b, c], [a, d], [b, d]]) add('steel', box(0.08, 2.4, 0.08, pu, 0, pv));
    collide(a, b, c, d, 0, 2.5);
    const awning = new THREE.Mesh(box(b - a + 0.4, 0.3, d - c + 0.4, (a + b) / 2, 2.4, (c + d) / 2),
      new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.6 }));
    awning.castShadow = true;
    awnings.push(awning);
  }

  const SIGNS: Piece[] = ['name', 'kfc', 'logo', 'boards'];
  for (const [piece, list] of parts) {
    // (the signs keep their uv; the rest is patterned by its position, its uv dropped for the boxes and triangles to merge)
    const merged = mergeGeometries(list.map((g) => {
      const flat = g.index ? g.toNonIndexed() : g;
      if (!SIGNS.includes(piece)) flat.deleteAttribute('uv');
      return flat;
    }));
    const mesh = new THREE.Mesh(merged, mats[piece]);
    mesh.name = `CentralTerminal:${piece}`;
    mesh.castShadow = !['glass', 'floor', 'ceiling', 'name', 'kfc', 'logo', 'boards', 'concrete', 'curb'].includes(piece);
    mesh.receiveShadow = true;
    site.hall.add(mesh);
  }
  for (const a of awnings) site.hall.add(a);

  // The front doors' leaves: two to a door, sliding apart behind the glass as someone comes
  const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(DOOR_W / 2, DOOR_H - 0.12, 0.05), mats.glass, FRONT_DOORS.length * 2);
  leaves.name = 'CentralDoors';
  site.hall.add(leaves);
  const open = new Float32Array(FRONT_DOORS.length).fill(-1);
  const m = new THREE.Matrix4();
  const setLeaves = (i: number, f: number) => {
    const d = FRONT_DOORS[i], slide = (DOOR_W / 2 - 0.1) * f;
    for (const side of [-1, 1]) {
      m.makeTranslation(d + side * (DOOR_W / 4 + slide), (DOOR_H - 0.12) / 2, v0 + 0.14);
      leaves.setMatrixAt(i * 2 + (side + 1) / 2, m);
    }
    leaves.instanceMatrix.needsUpdate = true;
  };
  FRONT_DOORS.forEach((_, i) => { setLeaves(i, 0); open[i] = 0; });
  leaves.computeBoundingSphere();

  // The floors walked on: the hall's, the walk's and the andén's, in strips along the hall 4 m a piece, their lifts
  // over the ground at their ends (each strip's run on past its ends fills the last 1.5 m to the end walls)
  const decks: DeckSegment[] = [];
  const v00 = v0 - PORTAL, strips = 11, half = (pv1 - v00) / strips / 2;
  for (let s = 0; s < strips; s++) {
    const v = v00 + half * (2 * s + 1), uEnd = v < v0 ? a1 - 1.5 : u1 - 1.5;
    for (let a = u0 + 1.5; a < uEnd - 0.01; a += 4) {
      const b = Math.min(uEnd, a + 4), p = centralAt(a, v), q = centralAt(b, v);
      const lift = (x: number, z: number) => Math.max(0.02, site.floorY - groundHeight(x, z));
      decks.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, la: lift(p.x, p.z), lb: lift(q.x, q.z), half });
    }
  }
  addFootDecks(decks);

  const doorAt = FRONT_DOORS.map((d) => centralAt(d, v0));
  /**
   * Slides the doors open for the player at (x, z) (m) within a few metres of them, or for anyone else coming through
   * (`someoneAt(x, z, r)`: the travellers, sim/central.ts), shut again once they've gone
   */
  function update(dt: number, x: number, z: number, someoneAt: (x: number, z: number, r: number) => boolean): void {
    const [pu, pv] = centralFrame(x, z);
    for (let i = 0; i < FRONT_DOORS.length; i++) {
      const want = (Math.abs(pu - FRONT_DOORS[i]) < 3.2 && pv > v0 - 5 && pv < v0 + 4) || someoneAt(doorAt[i].x, doorAt[i].z, 3.2) ? 1 : 0;
      if (open[i] === want) continue;
      open[i] = want > open[i] ? Math.min(1, open[i] + dt * 1.8) : Math.max(0, open[i] - dt * 1.2);
      setLeaves(i, open[i]);
    }
  }

  // the footprints for the maps: the hall with its walk & umbrellas, the KFC
  const outline = (corners: [number, number][], h: number): Footprint => {
    const pts = corners.map(([u, v]) => centralAt(u, v));
    return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)),
      z1: Math.max(...pts.map((p) => p.z)), h, tone: 0.3, pts };
  };
  const footprints = [
    outline([[u0, v0 - PORTAL], [u1, v0 - PORTAL], [u1, v1 + CANOPY], [u0, v1 + CANOPY]], RIDGE),
    outline([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], 8.4)
  ];
  return { update, footprints };
}

export { buildTerminal };
