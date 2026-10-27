// js/world/la-loma.ts
// The Parque La Loma's edge and the buildings round it, drawn from street photographs (where they stand:
// la-loma-plan.ts): the curb along the park, the white concrete benches with their slanted backs, the Huichol mural
// by Insurgentes, the white building with the scalloped parapet on Paseo de la Loma, and across the street the ISSSTE's
// Hospital General. The laureles go with the other trees (street-details.ts), the andador with the footways
// (footways.ts). Each building's parts are merged per material.
import * as THREE from 'three/webgpu';
import { color, fract, mix, positionWorld, step } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCurbMaterial, cityUniforms } from '../render/tsl-materials.ts';
import { addFootDecks, liftAt } from './ground.ts';
import type { DeckSegment } from './ground.ts';
import { offsetPolygonInward } from './park-floor.ts';
import { LA_LOMA, ISSSTE_LOT, PAVILION_LOT } from './la-loma-plan.ts';
import type { LomaFrame } from './la-loma-plan.ts';
import type { PointXZ } from './city-config.ts';
import type { Collider } from './buildings.ts';

/** [x0, x1, z0, z1] in a building's frame (m) */
type Rect = [number, number, number, number];

const plain = (hex: number, roughness = 0.9) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness: 0 });

// plaster or concrete cladding in panels: a darker joint every `every` m up and across
function panelled(hex: number, every: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const joint = step(0.96, fract(positionWorld.y.div(every))).max(step(0.97, fract(positionWorld.x.add(positionWorld.z).div(every * 1.6))));
  mat.colorNode = mix(color(hex), color(hex).mul(0.8), joint.mul(0.5));
  return mat;
}

// glass that glows warm from inside at night
function glazing(hex: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.25, metalness: 0.1 });
  mat.emissiveNode = color(0xffd9a0).mul(cityUniforms.uInteriorGlow).mul(0.45);
  return mat;
}

// A canvas painted by `paint`, as a texture
function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) paint(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// The parts of one building in its frame, merged per material when done
class Kit {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly frame = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  readonly colliders: Collider[] = [];
  readonly F: LomaFrame;
  readonly base: number;
  /** m over the base what is added now is raised by (a part standing on higher ground than the building's foot) */
  lift = 0;
  constructor(F: LomaFrame, base: number) {
    this.F = F;
    this.base = base;
    this.frame.makeRotationY(F.yaw).setPosition(F.x, base, F.z);
  }
  /** `geo` at (x, y, z) of the frame (y over its base), turned ry */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
    // (a copy: a shared geometry would be moved once per piece)
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(this.m.makeRotationY(ry).setPosition(x, y + this.lift, z).premultiply(this.frame));
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }
  /** a box w x h x d centred at (x, y, z) */
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }
  /** a box over a rectangle of the frame, from y0 up h */
  slab([x0, x1, z0, z1]: Rect, y0: number, h: number, mat: THREE.Material) {
    this.box(x1 - x0, h, z1 - z0, (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2, mat);
  }
  /** the ground's height at (x, z) of the frame, over the base (m) */
  ground(x: number, z: number) {
    const { F } = this, c = Math.cos(F.yaw), s = Math.sin(F.yaw);
    return liftAt(F.x + x * c + z * s, F.z - x * s + z * c) - this.base;
  }
  /** a collider over a rectangle of the frame, y0..y0 + h over the base */
  collide([x0, x1, z0, z1]: Rect, y0: number, h: number) {
    const { F } = this, c = Math.cos(F.yaw), s = Math.sin(F.yaw);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ox = F.x + mx * c + mz * s, oz = F.z - mx * s + mz * c;
    const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const y = this.base + this.lift + y0;
    this.colliders.push({ minX: ox - ex, maxX: ox + ex, minZ: oz - ez, maxZ: oz + ez, minY: y, maxY: y + h, obb: { cx: ox, cz: oz, hx, hz, cs: c, sn: s } });
  }
  /** a deck to walk on (ground.ts addFootDecks) across the frame at z, from x0 to x1 and `half` m before & behind
   *  that line (a deck holds its end's height that far past it too: x0 & x1 are drawn in by as much), its surface h
   *  over the base (and the lift) */
  deck(x0: number, x1: number, z: number, half: number, h: number): DeckSegment {
    const { F } = this, c = Math.cos(F.yaw), s = Math.sin(F.yaw);
    const ax = F.x + (x0 + half) * c + z * s, az = F.z - (x0 + half) * s + z * c, bx = F.x + (x1 - half) * c + z * s, bz = F.z - (x1 - half) * s + z * c;
    // (its lifts over the ground at its ends, as the decks keep them)
    const y = this.base + this.lift + h;
    return { ax, az, bx, bz, la: y - liftAt(ax, az), lb: y - liftAt(bx, bz), half };
  }
  /** a textured plane w x h facing the street (+z), centred at (x, y, z) */
  decal(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, group: THREE.Object3D) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardNodeMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.6 }));
    mesh.position.set(x, y, z).applyMatrix4(this.frame);
    mesh.rotation.y = this.F.yaw;
    group.add(mesh);
  }
  /** the merged meshes, into `group` */
  into(group: THREE.Object3D, name: string) {
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

// on the ground at the lowest corner of a rectangle of the frame, a little into it (the town's slopes)
function baseOf(F: LomaFrame, [x0, x1, z0, z1]: Rect) {
  const c = Math.cos(F.yaw), s = Math.sin(F.yaw);
  let low = Infinity;
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, z1]]) low = Math.min(low, liftAt(F.x + x * c + z * s, F.z - x * s + z * c));
  return low - 0.15;
}

// THE ISSSTE (Hospital General "B" Dr. Aquiles Calles Ramírez): on the left a block of four storeys in charcoal plaster,
// its glazed ground floor under a band lettered ISSSTE, its floors in bands of windows framed white; the stair tower
// rising over it with the ISSSTE's emblem; on the right the lower wing in pale stone panels on a plinth of dark rubble
// stone with a lawn on top, and between them, in a recess off the sidewalk, the steps up to the doors, a stone pedestal
// in their middle
function buildIssste(F: LomaFrame, group: THREE.Group): Collider[] {
  const hw = F.w / 2, D = F.d, kit = new Kit(F, baseOf(F, ISSSTE_LOT(F)));
  const charcoal = panelled(0x4a4c4f, 1.2), tower = panelled(0x56585b, 1.4), wingMat = panelled(0x9e9b94, 0.9);
  const band = plain(0x3e4042), white = plain(0xeeeeea, 0.6), glass = glazing(0x41505a), dark = glazing(0x2b3236);
  const rubble = panelled(0x4a4743, 0.45), lawn = plain(0x4f7a35), concrete = plain(0x9c9a94), steel = plain(0xc9ccd0, 0.4);
  const H = 16.2, TX0 = -15, TX1 = -5.5, TH = 25.5, WX = -3, WZ = -7, PLINTH = 1.6, WH = 12.4;

  // the block: its body (1.5 m into the ground), the ground floor's glass between piers, the lettered band
  kit.slab([-hw, WX, -D, 0], -1.5, H + 1.5, charcoal);
  kit.slab([-hw + 0.8, WX - 0.6, 0, 0.12], 0.3, 3.3, glass);
  for (let x = -hw + 0.8; x <= WX - 0.5; x += 2.05) kit.box(0.14, 3.4, 0.2, x, 1.95, 0.1, band);
  kit.slab([-hw - 0.1, WX, -0.05, 0.25], 3.65, 0.85, band);
  kit.box(0.3, 0.6, D + 0.3, -hw - 0.1, H - 0.2, -D / 2, band); // (the parapet's cap round the end)
  kit.slab([-hw - 0.15, WX, -0.15, 0.15], H - 0.5, 0.6, band);
  // the floors' bands of windows: glass in white frames, a mullion every 1.55 m, a transom across their middle
  const windows = (x0: number, x1: number) => {
    for (let k = 0; k < 3; k++) {
      const y = 4.5 + k * 3.7 + 0.75;
      kit.slab([x0, x1, 0, 0.08], y, 2.0, glass);
      kit.slab([x0 - 0.1, x1 + 0.1, 0, 0.16], y - 0.12, 0.12, white);
      kit.slab([x0 - 0.1, x1 + 0.1, 0, 0.16], y + 2.0, 0.12, white);
      kit.slab([x0, x1, 0.04, 0.12], y + 1.15, 0.07, white);
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.round((x1 - x0) / 1.55)) kit.box(0.09, 2.0, 0.12, x, y + 1.0, 0.07, white);
    }
  };
  windows(-hw + 1.6, TX0 - 1.2);
  // (and down the block's end, towards the street's corner)
  for (let k = 0; k < 3; k++) {
    const y = 4.5 + k * 3.7 + 0.75;
    kit.box(0.08, 2.0, D - 4, -hw - 0.02, y + 1.0, -D / 2, glass);
    for (let z = -D + 2; z <= -2; z += 1.55) kit.box(0.12, 2.0, 0.09, -hw - 0.05, y + 1.0, z, white);
  }
  kit.collide([-hw, WX, -D, 0], 0, H);

  // the tower, standing a little out of the block, the emblem near its top
  kit.slab([TX0, TX1, -9, 0.4], -1.5, TH + 1.5, tower);
  kit.slab([TX0 - 0.15, TX1 + 0.15, -9.15, 0.55], TH - 0.4, 0.5, band);
  kit.collide([TX0, TX1, -9, 0.4], 0, TH);
  const emblem = canvasTexture(512, 256, (g) => {
    g.strokeStyle = g.fillStyle = '#f2f2ee';
    g.lineWidth = 9;
    g.beginPath();
    g.roundRect(14, 40, 170, 170, 18);
    g.stroke();
    // the emblem's two hands round a cup, drawn simply
    g.beginPath();
    g.arc(99, 128, 52, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
    g.fillRect(84, 74, 30, 46);
    g.beginPath();
    g.arc(99, 70, 16, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 92px Arial, Helvetica, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('ISSSTE', 205, 130);
  });
  kit.decal(emblem, 8.6, 4.3, (TX0 + TX1) / 2, TH - 4.6, 0.43, group);
  const lettering = canvasTexture(512, 96, (g) => {
    g.fillStyle = '#e9e9e4';
    g.font = 'bold 70px Arial, Helvetica, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('ISSSTE', 12, 52);
  });
  kit.decal(lettering, 4.6, 0.86, -hw + 3.6, 4.07, 0.27, group);

  // the wing: on its plinth of rubble stone (a lawn on top) to the right of the steps, its floors over them; it and the
  // steps stand on the sidewalk at the steps' foot (the street climbs ~2 m along the hospital's front), the plinth
  // reaching down to the ground where it falls away
  const wy = kit.ground(4, -0.2) - 0.05;
  kit.lift = wy;
  kit.slab([WX, hw, -D, WZ], -wy - 1.5, WH + wy + 1.5, wingMat);
  kit.slab([WX - 0.1, hw + 0.1, -D - 0.1, WZ + 0.1], WH - 0.1, 0.5, plain(0x8f8c86));
  kit.slab([9, hw, WZ, 0], -wy - 1.5, PLINTH + wy + 1.5, rubble);
  kit.slab([9.2, hw - 0.2, WZ, -0.2], PLINTH, 0.08, lawn);
  kit.collide([WX, hw, -D, WZ], 0, WH);
  kit.collide([9, hw, WZ, 0], 0, PLINTH);
  // its doors at the top of the steps, its two floors' windows (their frames grey), their sills
  kit.slab([0.5, 7.5, WZ, WZ + 0.08], PLINTH, 3.0, glass);
  for (const x of [0.5, 2.25, 4, 5.75, 7.5]) kit.box(0.1, 3.0, 0.14, x, PLINTH + 1.5, WZ + 0.06, steel);
  kit.slab([0, 8, WZ, WZ + 1.6], PLINTH + 3.1, 0.25, white); // (the canopy over them)
  for (let k = 0; k < 2; k++) {
    const y = PLINTH + 3.6 * (k + 1) + 0.9;
    kit.slab([WX + 0.8, hw - 1, WZ, WZ + 0.08], y, 1.8, dark);
    kit.slab([WX + 0.6, hw - 0.8, WZ, WZ + 0.22], y - 0.15, 0.15, plain(0xd8d6d0));
    for (let x = WX + 0.8; x <= hw - 0.9; x += 2.4) kit.box(0.12, 1.8, 0.12, x, y + 0.9, WZ + 0.06, plain(0x77797c));
  }
  // the steps: nine of 0.18 m from the sidewalk up to a landing before the doors, the stone pedestal in their middle, a
  // steel rail down each side; the recess's floor in concrete
  const steps = 9, rise = PLINTH / steps, tread = 0.5, foot = -0.2, run = steps * tread, top = foot - run;
  kit.slab([WX, 9, WZ, foot], -wy - 1, wy + 1.05, concrete);
  for (let k = 0; k < steps; k++) kit.slab([-1, 9, WZ, foot - k * tread], -wy - 1, wy + 1 + (k + 1) * rise, concrete);
  kit.slab([3.4, 5.1, top + 1.4, top + 2.6], 0, 1.7, rubble);
  kit.slab([3.3, 5.2, top + 1.3, top + 2.7], 1.7, 0.12, concrete);
  const slope = Math.atan2(PLINTH, run), rail = new THREE.CylinderGeometry(0.03, 0.03, Math.hypot(run, PLINTH), 6).rotateX(slope - Math.PI / 2); // (rising towards the doors, -z)
  for (const x of [-0.8, 8.8]) {
    kit.add(rail, steel, x, PLINTH / 2 + 0.9, foot - run / 2);
    for (const t of [0.1, 0.5, 0.9]) kit.box(0.05, 0.9, 0.05, x, PLINTH * t + 0.45, foot - run * t, steel);
  }
  kit.collide([-1.05, -0.75, top, foot], 0, PLINTH + 0.9);
  kit.collide([8.75, 9.05, top, foot], 0, PLINTH + 0.9);
  kit.collide([3.3, 5.2, top + 1.3, top + 2.7], 0, 1.82);
  // walked up: each tread a deck between the rails (no lower than the sidewalk's 0.22 m where the street climbs past
  // the steps' foot), then the landing up to the doors
  const decks: DeckSegment[] = [];
  for (let k = 0; k < steps; k++) {
    const d = kit.deck(-0.75, 8.75, foot - (k + 0.5) * tread, tread / 2, (k + 1) * rise);
    d.la = Math.max(d.la, 0.22);
    d.lb = Math.max(d.lb, 0.22);
    decks.push(d);
  }
  decks.push(kit.deck(-0.75, 8.75, (top + WZ) / 2, (top - WZ) / 2, PLINTH));
  addFootDecks(decks);
  kit.lift = 0;
  kit.into(group, 'ISSSTE');
  return kit.colliders;
}

// A parapet of round humps (the scallops) along x from 0 to len, `h` high under them, humps r across every `every` m
function scallopShape(len: number, h: number, r: number, every: number, drop = 0) {
  const n = Math.max(1, Math.round(len / every)), step = len / n, top: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const x0 = k * step, cx = x0 + step / 2;
    top.push([x0, h]);
    for (let a = 0; a <= 12; a++) {
      const t = Math.PI - (a / 12) * Math.PI;
      top.push([cx + r * Math.cos(t), h + r * Math.sin(t)]);
    }
  }
  top.push([len, h]);
  const s = new THREE.Shape();
  if (drop) {
    // (a band `drop` deep along the top line only: the coping)
    s.moveTo(top[0][0], top[0][1]);
    for (const [x, y] of top.slice(1)) s.lineTo(x, y);
    for (let i = top.length - 1; i >= 0; i--) s.lineTo(top[i][0], top[i][1] - drop);
  } else {
    s.moveTo(0, 0);
    for (const [x, y] of top) s.lineTo(x, y);
    s.lineTo(len, 0);
  }
  s.closePath();
  return s;
}

// THE WHITE BUILDING on Paseo de la Loma: two storeys of white plaster, the ground floor a portico of round arches, a
// parapet of scallops coped in terracotta round its top; beside it a portal of rubble stone with the door, and a low
// modern annex in beige under a thin roof slab, glazed all along its front; white planters before them
function buildPavilion(F: LomaFrame, group: THREE.Group): Collider[] {
  const hw = F.w / 2, D = F.d, kit = new Kit(F, baseOf(F, PAVILION_LOT(F)));
  const white = plain(0xf2efe7, 0.85), terracotta = plain(0xc4653f, 0.8), dark = glazing(0x2c3134), glass = glazing(0x3c4a52);
  const stone = panelled(0x8d8576, 0.4), beige = plain(0xdcd2c1), slabMat = plain(0xe9e4da), green = plain(0x467a30);
  const pavers = plain(0xb88f7e), planter = plain(0xe7e3d9), mullion = plain(0x30302f, 0.5);
  const AX1 = 4, H = 7.4, G = 3.8, P = 2.8; // (the arcade's end, its height, the portico's height & depth)

  // the arcaded wing
  kit.slab([-hw, AX1, -D, -P], -1.5, H + 1.5, white);
  kit.slab([-hw, AX1, -P, 0], G, H - G, white);
  const n = Math.round((AX1 + hw) / 3), bay = (AX1 + hw) / n, r = bay / 2 - 0.35, spring = G - 0.4 - r;
  const archBand = (() => {
    const s = new THREE.Shape();
    s.moveTo(-bay / 2, G);
    s.lineTo(-bay / 2, 0);
    s.lineTo(-r, 0);
    s.lineTo(-r, spring);
    s.absarc(0, spring, r, Math.PI, 0, true);
    s.lineTo(r, 0);
    s.lineTo(bay / 2, 0);
    s.lineTo(bay / 2, G);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false, curveSegments: 10 });
  })();
  for (let k = 0; k < n; k++) kit.add(archBand, white, -hw + (k + 0.5) * bay, 0, -0.5);
  kit.add(archBand, white, -hw + 0.25, 0, -P / 2, -Math.PI / 2); // (the portico's end, open to the side)
  for (let k = 0; k < n; k++) kit.box(1.1, 2.3, 0.1, -hw + (k + 0.5) * bay, 1.15, -P + 0.05, dark); // (doors at its back)
  for (let k = 0; k < n; k++) kit.box(0.8, 0.8, 0.08, -hw + (k + 0.5) * bay, 5.6, 0.04, dark); // (the upper floor's windows)
  kit.slab([-hw - 0.05, AX1, -0.05, 0.1], G + 0.05, 0.12, white);
  // the scalloped parapet & its terracotta coping, along the front and down the side
  const len = AX1 + hw, wall = scallopShape(len, 0.55, 0.5, 2.6), cope = scallopShape(len, 0.55, 0.5, 2.6, 0.16);
  const side = scallopShape(D, 0.55, 0.5, 2.6), sideCope = scallopShape(D, 0.55, 0.5, 2.6, 0.16);
  const ex = (s: THREE.Shape, d: number) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 1 });
  kit.add(ex(wall, 0.3), white, -hw, H, -0.3);
  kit.add(ex(cope, 0.4), terracotta, -hw, H + 0.01, -0.35);
  kit.add(ex(side, 0.3), white, -hw, H, 0, Math.PI / 2);
  kit.add(ex(sideCope, 0.4), terracotta, -hw - 0.05, H + 0.01, 0, Math.PI / 2);
  kit.collide([-hw, AX1, -D, -P], 0, H);
  for (let k = 0; k <= n; k++) kit.collide([-hw + k * bay - 0.35, -hw + k * bay + 0.35, -0.5, 0], 0, G);

  // the stone portal, its door and the round green sign
  kit.slab([AX1, AX1 + 4, -10, -0.6], -1.5, 6.5, stone);
  kit.box(2.0, 3.0, 0.1, AX1 + 2, 1.5, -0.57, glass);
  kit.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20).rotateX(Math.PI / 2), plain(0x2f9a4a, 0.5), AX1 + 2, 4.0, -0.55);
  kit.collide([AX1, AX1 + 4, -10, -0.6], 0, 5);
  // the annex: beige walls, the roof slab, its front glazed between dark mullions
  const A0 = AX1 + 4, A1 = hw;
  kit.slab([A0, A1, -10, -1.2], -1.5, 5.5, beige);
  kit.slab([A0 - 0.4, A1 + 0.4, -10.3, -0.5], 4.0, 0.32, slabMat);
  kit.slab([A0 + 0.8, A1 - 0.6, -1.2, -1.12], 0.25, 3.45, glass);
  for (let x = A0 + 0.8; x <= A1 - 0.55; x += (A1 - A0 - 1.4) / 5) kit.box(0.09, 3.45, 0.1, x, 1.97, -1.12, mullion);
  kit.collide([A0, A1, -10, -1.2], 0, 4.3);
  // the paving before them, the planters with their shrubs
  kit.slab([-hw, hw, 0, 3], -0.2, 0.25, pavers);
  for (const [x0, x1, z0, z1] of [[-hw + 1, -8, 0.6, 1.8], [-5, AX1 - 0.5, 0.6, 1.8], [A0 + 0.5, A1 - 0.5, 0.1, 1.2]] satisfies Rect[]) {
    kit.slab([x0, x1, z0, z1], 0, 0.6, planter);
    kit.slab([x0 + 0.15, x1 - 0.15, z0 + 0.15, z1 - 0.15], 0.6, 0.5, green);
    kit.collide([x0, x1, z0, z1], 0, 0.6);
  }
  kit.into(group, 'LaLomaPavilion');
  return kit.colliders;
}

// The curb along the park (rural ground has none of its own, city-grid.ts): 0.3 m of granite 0.18 m over the road,
// following the town's slopes; the curb material paints it yellow (sidewalks.ts)
function buildCurb(poly: readonly PointXZ[], group: THREE.Group) {
  const outer: PointXZ[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
    for (let k = 0; k < n; k++) outer.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const inner = offsetPolygonInward(outer, 0.3);
  if (!inner) return;
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); };
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length, o0 = outer[i], o1 = outer[j], n0 = inner[i], n1 = inner[j];
    const top = (p: PointXZ) => [p.x, liftAt(p.x, p.z) + 0.18, p.z], foot = (p: PointXZ) => [p.x, liftAt(p.x, p.z) - 0.12, p.z];
    quad(top(o0), top(o1), top(n1), top(n0));
    quad(foot(o0), foot(o1), top(o1), top(o0));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mat = createCurbMaterial();
  mat.side = THREE.DoubleSide; // (the ring's winding is the island's, either way round)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'LaLomaCurb';
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** Draws La Loma's curb, benches, mural & buildings into `scene`: what stops the player */
function buildLaLoma(scene: THREE.Object3D): { colliders: Collider[] } {
  const P = LA_LOMA, colliders: Collider[] = [];
  if (!P) return { colliders };
  const group = new THREE.Group();
  group.name = 'LaLoma';
  buildCurb(P.park.poly, group);
  if (P.issste) colliders.push(...buildIssste(P.issste, group));
  if (P.pavilion) colliders.push(...buildPavilion(P.pavilion, group));

  // the benches: a white concrete seat on a block, behind it a slanted back of pale concrete, wider at its foot
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const at = P.benches.map((b) => {
    const y = liftAt(b.x, b.z) + 0.03;
    const cs = Math.cos(b.th), sn = Math.sin(b.th), hx = 1.35, hz = 0.55;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez, minY: y, maxY: y + 1.0, obb: { cx: b.x, cz: b.z, hx, hz, cs, sn } });
    return new THREE.Matrix4().compose(new THREE.Vector3(b.x, y, b.z), q.setFromAxisAngle(up, b.th), one);
  });
  if (at.length) {
    const backShape = new THREE.Shape([new THREE.Vector2(-1.35, 0), new THREE.Vector2(1.35, 0), new THREE.Vector2(0.95, 0.95), new THREE.Vector2(-0.95, 0.95)]);
    const seat = mergeGeometries([
      new THREE.BoxGeometry(2.1, 0.1, 0.5).translate(0, 0.45, 0).toNonIndexed(),
      new THREE.BoxGeometry(1.6, 0.42, 0.34).translate(0, 0.2, 0).toNonIndexed()
    ]);
    const back = new THREE.ExtrudeGeometry(backShape, { depth: 0.3, bevelEnabled: false }).translate(0, 0, 0.32);
    for (const [geo, hex] of [[seat, 0xf1f0ec], [back, 0xd9d2c3]] satisfies [THREE.BufferGeometry, number][]) {
      const mesh = new THREE.InstancedMesh(geo, plain(hex, 0.8), at.length);
      at.forEach((m, i) => { mesh.setMatrixAt(i, m); });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = 'LaLomaBenches';
      group.add(mesh);
    }
  }

  // the mural: a wall of pale concrete, painted on its street side in the Huichol way (a great flower in blues & teal,
  // rays and zigzags round it, two dark slots), a CFE cabinet before its end
  if (P.mural) {
    const M = P.mural, F: LomaFrame = { x: M.x, z: M.z, yaw: M.th, w: M.len, d: 0.3 };
    const kit = new Kit(F, liftAt(M.x, M.z));
    const L = M.len, Hm = 2.6;
    kit.slab([-L / 2, L / 2, -0.3, 0], -0.5, Hm + 0.5, plain(0xd6d0c2));
    kit.slab([-L / 2 - 0.05, L / 2 + 0.05, -0.35, 0.05], Hm, 0.12, plain(0xc8c1b1));
    kit.box(0.8, 1.5, 0.5, -L / 2 - 6, 0.75, 1.2, plain(0xbab8b2, 0.6));
    kit.collide([-L / 2, L / 2, -0.3, 0], 0, Hm);
    kit.collide([-L / 2 - 6.4, -L / 2 - 5.6, 0.95, 1.45], 0, 1.5);
    const art = canvasTexture(1024, 224, (g) => {
      g.fillStyle = '#9fd3e3';
      g.fillRect(0, 0, 1024, 224);
      // zigzags across the field
      for (let row = 0; row < 7; row++) {
        g.strokeStyle = row % 2 ? '#ffffff' : '#3d8fc4';
        g.lineWidth = 7;
        g.beginPath();
        for (let x = 0; x <= 1024; x += 32) g.lineTo(x, row * 34 + 10 + (x / 32) % 2 * 16);
        g.stroke();
      }
      // the great flower: rings of petals round a yellow eye
      const flower = (cx: number, cy: number, R: number) => {
        for (const [r, n, fill] of [[R, 16, '#1d5da8'], [R * 0.78, 12, '#26b3c0'], [R * 0.56, 10, '#ffffff'], [R * 0.36, 8, '#e0473d']] satisfies [number, number, string][]) {
          g.fillStyle = fill;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            g.beginPath();
            g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.2, a, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.fillStyle = '#f4c534';
        g.beginPath();
        g.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
        g.fill();
      };
      flower(170, 112, 150);
      flower(640, 112, 80);
      // the two dark slots, framed red
      for (const x of [800, 900]) {
        g.fillStyle = '#c0392b';
        g.fillRect(x - 6, 40, 40, 150);
        g.fillStyle = '#2a2a2a';
        g.fillRect(x, 46, 28, 138);
      }
    });
    kit.decal(art, L - 0.1, Hm - 0.1, 0, Hm / 2, 0.02, group);
    kit.into(group, 'LaLomaMural');
    colliders.push(...kit.colliders);
  }
  scene.add(group);
  console.info(`[la-loma] the ISSSTE, the white building, ${P.benches.length} benches, ${P.walks.length} runs of andador, ${P.trees.length} laureles & palms`);
  return { colliders };
}

export { buildLaLoma };
