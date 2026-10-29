// js/places/uan/build/gates.ts
// The campus's gates (plan.ts says where), from street photographs:
// - 'arch': the stone gateway on Revolución over the Av. Universidad: rubble stone like the walls by it, a broad
//   segmental arch over each carriageway (cantera archivolts & imposts), a small arch for those on foot where there is
//   room, a curved gable rising over the middle with the university's medallion, "UAN" in gold letters, iron gates
//   swung open against its inner face.
// - 'motto': the white beam "POR LO NUESTRO A LO UNIVERSAL" in blue letters over the drive on two tall blue piers, white
//   towers at its ends with blue faces, a gate for those on foot and the guard booth (white, a blue roof) beside it.
// - 'name': the thick white portal "UNIVERSIDAD AUTÓNOMA DE NAYARIT", its towers faced with blue pilasters, over the
//   way in & the way out, the guard booth on the island between them, its curb painted yellow.
// - 'plain': two broad blue piers with "UAN" either side of each drive (in the blue walls), or stone piers (in the
//   stone), the rejas swung open.
// Each stands in its own frame: x along its line, z out to the street, on the ground at its middle.
import * as THREE from 'three/webgpu';
import { liftAt } from '../../../world/ground.ts';
import { letteringMaterial, REJA_H } from './materials.ts';
import { LOT_Y } from './walls.ts';
import type { CampusGate, GateOpening } from '../plan.ts';
import type { Frame, Kit } from '../../kit/pieces.ts';
import type { UanMaterials } from './materials.ts';

const SINK = 1.0; // m the gates' feet go into the ground (they span the slope of a street)
const TEXT_BLUE = '#1546b4';
const SERIF = '"Times New Roman", Georgia, serif';

/** A gate's frame and extent: x along its line from s0 to s1 (m), z out, its drives' openings sorted along it */
interface GateFrame {
  f: Frame;
  s0: number;
  s1: number;
  openings: GateOpening[];
}

// The gate's frame, turned so its local +z is the way out (x runs the other way along its line when it must)
function gateFrame(g: CampusGate): GateFrame {
  let { along, s0, s1, openings } = g;
  if (-along.z * g.out.x + along.x * g.out.z < 0) {
    along = { x: -along.x, z: -along.z };
    [s0, s1] = [-s1, -s0];
    openings = openings.map((o) => ({ t: -o.t, w: o.w }));
  }
  return { f: { x: g.c.x, y: liftAt(g.c.x, g.c.z), z: g.c.z, yaw: Math.atan2(-along.z, along.x) }, s0, s1, openings: [...openings].sort((a, b) => a.t - b.t) };
}

// A rejas' leaf w wide, two panels high (3 m), standing on local x from x0 (its hinge) at z, swung open by `swing`
// (rad, towards -z: into the campus)
function leaf(kit: Kit, f: Frame, mats: UanMaterials, x0: number, z: number, w: number, dir: 1 | -1, swing = 1.45): void {
  const a = dir * swing, cx = x0 + (dir * w / 2) * Math.cos(swing), cz = z - (w / 2) * Math.sin(swing);
  for (const y of [REJA_H / 2, REJA_H * 1.5]) kit.plane(f, w, REJA_H, cx, y, cz, mats.reja, a);
  kit.add(new THREE.CylinderGeometry(0.04, 0.04, REJA_H * 2, 6), mats.steel, f, x0 + dir * 0.04, REJA_H, z);
}

// A run of the blue fence along local x from x0 to x1 (z = 0): the low wall, a reja, a pier at x1
function blueFence(kit: Kit, f: Frame, mats: UanMaterials, x0: number, x1: number): void {
  const len = x1 - x0;
  if (len < 0.5) return;
  const n = Math.max(1, Math.round(len / 3.6)), step = len / n;
  for (let k = 0; k < n; k++) {
    const a = x0 + k * step, m = a + step / 2;
    kit.box(f, step, 0.75 + LOT_Y + 0.35, 0.3, m, (0.75 + LOT_Y - 0.35) / 2, 0, mats.blue);
    kit.plane(f, step - 0.8, REJA_H, m, LOT_Y + 0.8 + REJA_H / 2, 0, mats.reja);
    if (k > 0) kit.box(f, 0.8, 2.72 + 0.35, 0.55, a, (2.72 - 0.35) / 2, 0, mats.blue);
  }
  kit.collide(f, (x0 + x1) / 2, 0, len / 2, 0.2, 0, 2.6);
}

// A booth for the guard at (x, z): white, a blue roof slab overhanging, a blue foot, windows all round, a door
function booth(kit: Kit, f: Frame, mats: UanMaterials, x: number, z: number, w: number, d: number, y = 0): void {
  const h = 2.6;
  kit.box(f, w, h + 0.3, d, x, y + (h - 0.3) / 2, z, mats.white);
  kit.box(f, w + 0.06, 0.35, d + 0.06, x, y + 0.17, z, mats.blue);
  kit.box(f, w + 0.7, 0.28, d + 0.7, x, y + h + 0.14, z, mats.blue);
  for (const s of [-1, 1]) {
    kit.box(f, w * 0.7, 1.0, 0.04, x, y + 1.7, z + s * (d / 2 + 0.01), mats.glass);
    kit.box(f, 0.04, 1.0, d * 0.55, x + s * (w / 2 + 0.01), y + 1.7, z - d * 0.12, mats.glass);
  }
  kit.box(f, 0.04, 2.1, 0.8, x + w / 2 + 0.01, y + 1.05, z + d * 0.28, mats.door);
  kit.collide(f, x, z, w / 2 + 0.1, d / 2 + 0.1, 0, h + 0.3);
}

// THE STONE ARCH on Revolución
function stoneArch(kit: Kit, gf: GateFrame, mats: UanMaterials, uanGold: THREE.Material): void {
  const { f, openings, s0, s1 } = gf; // (s0..s1 leave each arch & its pier room: plan.ts PIER)
  const D = 1.4, yT = 7.0, yP = 9.8, SPRING = 3.4, RISE = 2.4;
  // the arches over the drives (a little wider than each), and one for those on foot each side where there is room
  const arches = openings.map((o) => ({ c: o.t, w: o.w + 0.8, spring: SPRING, rise: RISE }));
  const left = arches[0].c - arches[0].w / 2 - s0, right = s1 - (arches[arches.length - 1].c + arches[arches.length - 1].w / 2);
  if (left > 3.4) arches.unshift({ c: s0 + left / 2, w: 1.9, spring: 2.1, rise: 0.95 });
  if (right > 3.4) arches.push({ c: s1 - right / 2, w: 1.9, spring: 2.1, rise: 0.95 });
  // the gable over the middle of the drives: a bell-shaped rise from the top line to the peak
  const cx = (openings[0].t + openings[openings.length - 1].t) / 2;
  const gw = Math.min((s1 - s0) * 0.3, Math.max(5, openings.length > 1 ? openings[openings.length - 1].t - openings[0].t + 2 : 6));
  const top = (x: number) => (Math.abs(x - cx) < gw ? yT + (yP - yT) * Math.pow(Math.cos((Math.PI * (x - cx)) / gw) / 2 + 0.5, 0.75) : yT);
  const shape = new THREE.Shape();
  shape.moveTo(s0, -SINK);
  for (const a of arches) {
    const x0 = a.c - a.w / 2, x1 = a.c + a.w / 2;
    shape.lineTo(x0, -SINK);
    shape.lineTo(x0, a.spring);
    for (let k = 1; k <= 16; k++) {
      const t = Math.PI - (k / 16) * Math.PI;
      shape.lineTo(a.c + (a.w / 2) * Math.cos(t), a.spring + a.rise * Math.sin(t));
    }
    shape.lineTo(x1, -SINK);
  }
  shape.lineTo(s1, -SINK);
  // (the ends step down a metre)
  shape.lineTo(s1, yT - 1.0);
  shape.lineTo(s1 - 1.2, yT - 1.0);
  for (let k = 0; k <= 40; k++) {
    const x = s1 - 1.2 - ((s1 - s0 - 2.4) * k) / 40;
    shape.lineTo(x, top(x));
  }
  shape.lineTo(s0 + 1.2, yT - 1.0);
  shape.lineTo(s0, yT - 1.0);
  shape.closePath();
  kit.add(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -D / 2), mats.stone, f, 0, 0, 0);
  // cantera: the archivolts round the arches & their imposts, the coping along the top line & the steps, the cornice
  for (const a of arches) {
    const ring = new THREE.Shape(), r0 = a.w / 2, band = a.w > 3 ? 0.4 : 0.25;
    for (let k = 0; k <= 16; k++) {
      const t = Math.PI - (k / 16) * Math.PI;
      const p = [a.c + (r0 + band) * Math.cos(t), a.spring + (a.rise + band) * Math.sin(t)];
      if (k === 0) ring.moveTo(p[0], p[1]);
      else ring.lineTo(p[0], p[1]);
    }
    for (let k = 16; k >= 0; k--) {
      const t = Math.PI - (k / 16) * Math.PI;
      ring.lineTo(a.c + r0 * Math.cos(t), a.spring + a.rise * Math.sin(t));
    }
    kit.add(new THREE.ExtrudeGeometry(ring, { depth: D + 0.12, bevelEnabled: false }).translate(0, 0, -(D + 0.12) / 2), mats.cantera, f, 0, 0, 0);
    for (const s of [-1, 1]) kit.box(f, band + 0.25, 0.3, D + 0.16, a.c + s * (r0 + band / 2), a.spring - 0.15, 0, mats.cantera);
  }
  const strip = new THREE.Shape();
  const x0 = s0 + 1.2, x1 = s1 - 1.2;
  strip.moveTo(x0, top(x0) - 0.05);
  for (let k = 0; k <= 40; k++) strip.lineTo(x0 + ((x1 - x0) * k) / 40, top(x0 + ((x1 - x0) * k) / 40) - 0.05);
  for (let k = 40; k >= 0; k--) strip.lineTo(x0 + ((x1 - x0) * k) / 40, top(x0 + ((x1 - x0) * k) / 40) + 0.28);
  kit.add(new THREE.ExtrudeGeometry(strip, { depth: D + 0.24, bevelEnabled: false }).translate(0, 0, -(D + 0.24) / 2), mats.cantera, f, 0, 0, 0);
  for (const [x, w] of [[s0 + 0.6, 1.4], [s1 - 0.6, 1.4]]) kit.box(f, w, 0.25, D + 0.24, x, yT - 0.9, 0, mats.cantera);
  kit.box(f, x1 - x0, 0.22, D + 0.3, (x0 + x1) / 2, SPRING + RISE + 0.75, 0, mats.cantera);
  // the medallion in the gable, "UAN" over the middle pier, both faces
  for (const s of [-1, 1]) {
    const z = s * (D / 2 + 0.06);
    kit.add(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 28).rotateX(Math.PI / 2), mats.cantera, f, cx, yT + (yP - yT) * 0.5, z);
    kit.add(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 28).rotateX(Math.PI / 2), mats.stone, f, cx, yT + (yP - yT) * 0.5, z);
    kit.add(new THREE.TorusGeometry(0.62, 0.05, 6, 32), mats.gold, f, cx, yT + (yP - yT) * 0.5, z + s * 0.07);
    kit.plane(f, 4.2, 1.6, cx, SPRING + RISE - 0.05, s * (D / 2 + 0.03), uanGold, s > 0 ? 0 : Math.PI);
  }
  // the iron gates, swung open against the inner face; the colliders over the piers between the arches
  let x = s0;
  for (const a of arches) {
    const half = a.w / 2 - 0.05;
    leaf(kit, f, mats, a.c - a.w / 2 + 0.05, -D / 2 - 0.08, half, 1, Math.PI / 2 - 0.05);
    leaf(kit, f, mats, a.c + a.w / 2 - 0.05, -D / 2 - 0.08, half, -1, Math.PI / 2 - 0.05);
    const e = a.c - a.w / 2;
    if (e - x > 0.1) kit.collide(f, (x + e) / 2, 0, (e - x) / 2, D / 2, 0, yT);
    x = a.c + a.w / 2;
  }
  if (s1 - x > 0.1) kit.collide(f, (x + s1) / 2, 0, (s1 - x) / 2, D / 2, 0, yT);
}

// THE WHITE BEAM with the motto on blue piers
function mottoPortal(kit: Kit, gf: GateFrame, mats: UanMaterials): void {
  const { f, openings } = gf;
  const o = openings[0], pier = 1.2, beamY = 5.6, beamH = 1.7;
  const lp = o.t - o.w / 2 - 0.1 - pier / 2, rp = o.t + o.w / 2 + 0.1 + pier / 2;
  // the pedestrian gate & the booth on the left, the fence on the right
  const { s0, s1 } = gf; // (wide enough for the wing, the gate on foot & the booth: plan.ts MIN_SPAN)
  for (const x of [lp, rp]) {
    kit.box(f, pier, beamY + SINK, pier, x, (beamY - SINK) / 2, 0, mats.blue);
    kit.collide(f, x, 0, pier / 2, pier / 2, 0, beamY);
  }
  // the end towers, white with a blue face out
  for (const x of [s0 + 0.6, s1 - 0.6]) {
    kit.box(f, 1.2, beamY + beamH + SINK, 1.2, x, (beamY + beamH - SINK) / 2, 0, mats.white);
    kit.box(f, 0.8, beamY + SINK, 0.2, x, (beamY - SINK) / 2, 0.68, mats.blue);
    kit.collide(f, x, 0, 0.6, 0.6, 0, beamY + beamH);
  }
  const L = s1 - s0, mid = (s0 + s1) / 2;
  kit.box(f, L, beamH, 0.9, mid, beamY + beamH / 2, 0, mats.white);
  kit.box(f, L + 0.1, 0.12, 1.0, mid, beamY + beamH + 0.06, 0, mats.white);
  const text = letteringMaterial('POR LO NUESTRO A LO UNIVERSAL', L - 1.6, beamH * 0.8, TEXT_BLUE, { fill: 0.7, weight: 700, font: SERIF });
  kit.plane(f, L - 1.6, beamH * 0.8, mid, beamY + beamH / 2, 0.46, text);
  kit.plane(f, L - 1.6, beamH * 0.8, mid, beamY + beamH / 2, -0.46, text, Math.PI);
  // left: a white wing with the university's shield, the gate for those on foot between small blue piers, the booth
  const wx0 = s0 + 1.2, wx1 = lp - pier / 2;
  kit.box(f, 1.6, 2.8 + SINK, 0.35, wx0 + 0.8, (2.8 - SINK) / 2, 0, mats.white);
  kit.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24).rotateX(Math.PI / 2), mats.blue, f, wx0 + 0.8, 1.9, 0.2);
  kit.add(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 24).rotateX(Math.PI / 2), mats.white, f, wx0 + 0.8, 1.9, 0.21);
  kit.collide(f, wx0 + 0.8, 0, 0.8, 0.2, 0, 2.8);
  const px0 = wx0 + 1.6 + 0.3, px1 = wx1 - 0.3;
  for (const x of [px0, px1]) kit.box(f, 0.6, 2.9 + SINK, 0.6, x, (2.9 - SINK) / 2, 0, mats.blue);
  leaf(kit, f, mats, px0 + 0.3, -0.1, Math.max(0.6, px1 - px0 - 0.6), 1, 1.3);
  booth(kit, f, mats, (wx0 + wx1) / 2, -3.2, 2.2, 2.2);
  // right: the blue fence on to the end tower, the sliding reja parked behind it
  blueFence(kit, f, mats, rp + pier / 2, s1 - 1.2);
  kit.plane(f, o.w, REJA_H, rp + pier / 2 + o.w / 2, LOT_Y + 0.8 + REJA_H / 2, -0.35, mats.reja);
}

// THE WHITE PORTAL with the university's name, the booth between the way in & out
function namePortal(kit: Kit, gf: GateFrame, mats: UanMaterials): void {
  const { f, openings } = gf;
  const first = openings[0], last = openings[openings.length - 1], tw = 1.8, td = 1.6, H = 8.6, beamY = 6.3;
  const lt = first.t - first.w / 2 - 0.1 - tw / 2, rt = last.t + last.w / 2 + 0.1 + tw / 2;
  for (const x of [lt, rt]) {
    kit.box(f, tw, H + SINK, td, x, (H - SINK) / 2, 0, mats.white);
    for (const s of [-1, 1]) {
      kit.box(f, 0.8, beamY + SINK, 0.25, x, (beamY - SINK) / 2, s * (td / 2 + 0.12), mats.blue);
      kit.box(f, tw + 0.1, 0.4, td + 0.1, x, 0.2, 0, mats.blue);
    }
    kit.collide(f, x, 0, tw / 2, td / 2, 0, H);
  }
  const L = rt - lt + tw, mid = (lt + rt) / 2;
  kit.box(f, L, H - beamY, td, mid, (H + beamY) / 2, 0, mats.white);
  // (the text between the towers' middles: the shield on the left one)
  const tl = rt - lt - 1.2, text = letteringMaterial('UNIVERSIDAD AUTÓNOMA DE NAYARIT', tl, (H - beamY) * 0.7, TEXT_BLUE, { fill: 0.6, weight: 700, font: SERIF });
  kit.plane(f, tl, (H - beamY) * 0.7, mid, (H + beamY) / 2, td / 2 + 0.01, text);
  kit.plane(f, tl, (H - beamY) * 0.7, mid, (H + beamY) / 2, -td / 2 - 0.01, text, Math.PI);
  // the shield on the left tower
  kit.add(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 24).rotateX(Math.PI / 2), mats.blue, f, lt - 0.2, (H + beamY) / 2, td / 2 + 0.05);
  // the island between the drives and its booth (a single drive: the booth beside it, inside)
  if (openings.length > 1) {
    const a = first.t + first.w / 2, b = last.t - last.w / 2, w = Math.max(1.6, b - a);
    kit.box(f, w, 0.4, 7, (a + b) / 2, -0.03, -2.2, mats.concrete);
    for (const s of [-1, 1]) kit.box(f, 0.06, 0.18, 7, (a + b) / 2 + s * (w / 2 + 0.02), 0.08, -2.2, mats.yellow);
    booth(kit, f, mats, (a + b) / 2, -1.6, Math.min(1.7, w - 0.3), 2.4, 0.17);
  } else booth(kit, f, mats, lt - 2.2, -2.6, 2.0, 2.2);
  // the sliding rejas parked behind the towers
  for (const o of openings) kit.plane(f, o.w, REJA_H, o.t, LOT_Y + 0.8 + REJA_H / 2, -td / 2 - 0.3, mats.reja);
  // (the fence on to the walls' ends)
  blueFence(kit, f, mats, gf.s0, lt - tw / 2);
  blueFence(kit, f, mats, rt + tw / 2, gf.s1);
}

// A PLAIN GATE: two piers either side of each drive (blue with "UAN", or stone), the rejas swung open
function plainGate(kit: Kit, gf: GateFrame, mats: UanMaterials, rubble: THREE.Material | null, uan: THREE.Material): void {
  const stone = !!rubble;
  const { f, openings, s0, s1 } = gf;
  const pw = stone ? 1.0 : 1.4, pd = stone ? 1.0 : 0.8, ph = stone ? 2.6 : 3.2;
  const piers: number[] = [];
  openings.forEach((o, i) => {
    const l = o.t - o.w / 2 - pw / 2, r = o.t + o.w / 2 + pw / 2;
    if (i === 0 || l - piers[piers.length - 1] > pw * 1.2) piers.push(l);
    else piers[piers.length - 1] = (piers[piers.length - 1] + l) / 2;
    piers.push(r);
    leaf(kit, f, mats, o.t - o.w / 2, -pd / 2 - 0.05, o.w / 2, 1);
    leaf(kit, f, mats, o.t + o.w / 2, -pd / 2 - 0.05, o.w / 2, -1);
  });
  for (const x of piers) {
    if (stone) {
      kit.box(f, pw, ph + SINK, pd, x, (ph - SINK) / 2, 0, rubble, x);
      kit.box(f, pw + 0.15, 0.15, pd + 0.15, x, ph + 0.07, 0, mats.coping);
    } else {
      kit.box(f, pw, ph + SINK, pd, x, (ph - SINK) / 2, 0, mats.blue);
      kit.plane(f, 1.1, 0.7, x, ph - 0.8, pd / 2 + 0.01, uan);
      kit.plane(f, 1.1, 0.7, x, ph - 0.8, -pd / 2 - 0.01, uan, Math.PI);
    }
    kit.collide(f, x, 0, pw / 2, pd / 2, 0, ph);
  }
  // (on to the walls' ends: the blue fence, or the stone wall & its chain-link)
  const ends: [number, number][] = [[s0, piers[0] - pw / 2], [piers[piers.length - 1] + pw / 2, s1]];
  for (const [a, b] of ends) {
    if (b - a < 0.3) continue;
    if (!stone) blueFence(kit, f, mats, a, b);
    else {
      kit.box(f, b - a, LOT_Y + 1.3 + 0.35, 0.45, (a + b) / 2, (LOT_Y + 1.3 - 0.35) / 2, 0, rubble, a);
      kit.box(f, b - a, 0.1, 0.53, (a + b) / 2, LOT_Y + 1.35, 0, mats.coping);
      kit.collide(f, (a + b) / 2, 0, (b - a) / 2, 0.25, 0, LOT_Y + 1.4);
    }
  }
}

function buildGates(kit: Kit, gates: readonly CampusGate[], mats: UanMaterials): number {
  const uanGold = letteringMaterial('UAN', 4.2, 1.6, '#e3bf5c', { fill: 0.95, weight: 700, font: SERIF });
  const uanPier = letteringMaterial('UAN', 1.1, 0.7, '#dfe3e8', { fill: 0.8, weight: 700 });
  for (const g of gates) {
    const gf = gateFrame(g);
    if (!gf.openings.length) continue;
    if (g.kind === 'arch') stoneArch(kit, gf, mats, uanGold);
    else if (g.kind === 'motto') mottoPortal(kit, gf, mats);
    else if (g.kind === 'name') namePortal(kit, gf, mats);
    else plainGate(kit, gf, mats, g.style === 'blue' ? null : g.style === 'cal' ? mats.cal : mats.stone, uanPier);
  }
  return gates.length;
}

export { buildGates };
