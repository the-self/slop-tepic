// js/actors/vehicles/coach.ts
// The autobús foráneo: the intercity coach that runs out of the Central de Autobuses to Guadalajara, Mazatlán, Puerto
// Vallarta and the border (an Irizar i6 / Volvo 9700 kind of thing, 13.2 m long, 2.6 m wide, 3.6 m tall). The body is
// lofted with the car body machinery, its windshield raked back; mirrors hang from the roof in front of it like a
// rabbit's ears. The material paints the tinted glass all along (the passengers sit high, over the luggage bays),
// the curb-side door and the driver's window, the luggage doors' seams, the engine's louvres, the destination sign
// over the windshield (amber at night), and each line's livery from per-instance colours: its body and two swooshes
// rising towards the rear. The line's name is lettered along both sides on panels over an atlas (coachNameTexture).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, vec2, color, attribute, abs, fract, max, clamp, mix, step, smoothstep } from 'three/tsl';
import { part } from './loft.ts';
import { buildBodyLoft } from './car-body.ts';
import { roundedBox } from './car-geometry.ts';
import { buildBusWheelGeo } from './bus-geometry.ts';
import { roundedRect } from './tsl-shapes.ts';
import { letteringAtlas, createLetteringMaterial } from './lettering.ts';
import { cityUniforms } from '../../render/tsl-materials.ts';
import type { LoftSpec } from '../../models/bodies.ts';

/** The coach's pieces (partId) */
export const COACH_PARTS = {
  BODY: 0,
  TRIM: 1
};

const ZF = 6.6;
const ZR = -6.6;

export const COACH_SPEC: LoftSpec = {
  name: 'coach',
  zFront: ZF,
  zRear: ZR,
  wheelRadius: 0.48, // (the city bus's wheels: the same 295/80 R22.5 tyres)
  wheelZ: 4.2,
  wheelX: 1.22,
  archGap: 0.1,
  archFlare: 0,
  tuck: 0.04,
  stationStep: 0.8,
  lowerRound: 2.6,
  upperRound: 5,
  upperSamples: [0.3, 0.56, 0.74, 0.88, 1],
  halfWidth: [[ZF, 1.3], [ZR, 1.3]],
  sill: [[ZF, 0.42], [ZR, 0.42]],
  shoulder: [[ZF, 1.2], [ZR, 1.2]],
  edge: [[ZF, 3.5], [ZR, 3.5]],
  crown: [[ZF, 0.06], [ZR, 0.06]],
  tumble: [[ZF, 0.1], [ZR, 0.1]],
  nose: { halfWidth: [0.34, 1.06, 2], edge: [0.55, 3.22, 2.2], crown: [0.4, 0.01, 2], sill: [0.08, 0.5, 2], shoulder: [0.2, 1.0, 2] },
  tail: { halfWidth: [0.3, 1.1, 2], edge: [0.3, 3.36, 2], crown: [0.3, 0.01, 2], sill: [0.1, 0.55, 2], shoulder: [0.2, 1.0, 2] }
};

/** The coach's size (m): length, width, height, as the parking and the colliders read it */
export const COACH_SIZE = { length: ZF - ZR, width: 2.6, height: 3.56 };

// The windshield's rake: the top of the front leans back by up to RAKE m, fading out along its first 1.2 m
const RAKE = 0.42;
function coachRake(y: number, z: number): number {
  const along = Math.min(1, Math.max(0, (z - (ZF - 1.2)) / 1.2));
  const up = Math.min(1, Math.max(0, (y - 1.2) / 2.3));
  return RAKE * along * along * Math.pow(up, 1.2);
}

/** The coach's body: the loft, its bumpers, the mirrors on their stalks and the wheel arches' liners */
export function buildCoachBodyGeometry(): THREE.BufferGeometry {
  const s = COACH_SPEC;
  const body = buildBodyLoft(s, 1);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - coachRake(pos.getY(i), pos.getZ(i)));
  body.computeVertexNormals();
  const parts = [part(body, COACH_PARTS.BODY)];
  parts.push(part(roundedBox(1.22, 0.16, 0.22, 0.08, 0.03).translate(0, 0.52, ZF - 0.08), COACH_PARTS.TRIM));
  parts.push(part(roundedBox(1.2, 0.14, 0.2, 0.07, 0.03).translate(0, 0.55, ZR + 0.06), COACH_PARTS.TRIM));
  for (const side of [-1, 1]) {
    // the rabbit-ear mirrors: a stalk forward from the roof's front corner, the head hanging ahead of the windshield
    const stalk = new THREE.BoxGeometry(0.04, 0.04, 0.62).rotateX(0.35).rotateY(side * 0.3).translate(side * 1.16, 3.22, ZF - 0.36);
    const head = roundedBox(0.09, 0.24, 0.07, 0.035, 0.012).translate(side * 1.32, 2.78, ZF - 0.02);
    parts.push(part(stalk, COACH_PARTS.TRIM), part(head, COACH_PARTS.TRIM));
    for (const z of [-s.wheelZ, s.wheelZ]) {
      const well = new THREE.CircleGeometry(s.wheelRadius + s.archGap + 0.01, 10, 0, Math.PI)
        .rotateY(side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.2), s.wheelRadius, z);
      parts.push(part(well, COACH_PARTS.TRIM));
    }
  }
  // the air conditioning's low pod on the roof, over the middle
  parts.push(part(roundedBox(0.9, 0.09, 3.2, 0.08, 0.04).translate(0, 3.56 + 0.05, -0.8), COACH_PARTS.TRIM));
  return mergeGeometries(parts);
}

/** The coach's four wheels, in its frame (the city bus's wheel: createBusWheelMaterial paints them) */
export function buildCoachWheelsGeometry(): THREE.BufferGeometry {
  const s = COACH_SPEC;
  const wheels: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-s.wheelZ, s.wheelZ]) wheels.push(buildBusWheelGeo(side).translate(side * s.wheelX, s.wheelRadius, z));
  }
  return mergeGeometries(wheels);
}

/** The line's name along both sides: a panel each, over the luggage bays (uv across the panel, the atlas's row by instance) */
export function buildCoachNameGeometry(): THREE.BufferGeometry {
  const panels: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // (each turned so its lettering reads from the front to the back on the left (+x), back to front on the right)
    const panel = new THREE.PlaneGeometry(5.2, 0.65).rotateY(side * Math.PI / 2);
    panel.translate(side * (1.3 + 0.012), 2.0 - 0.62, 0.3);
    panels.push(panel);
  }
  return mergeGeometries(panels);
}

/** The lines' names lettered for the coaches' sides: `lines` [name, ink, edge] (CSS) */
export function coachNameTexture(lines: readonly (readonly [name: string, ink: string, edge: string])[]): THREE.CanvasTexture {
  return letteringAtlas(lines, { width: 512, row: 64, size: 46, font: `italic 900 'Arial Black', Arial, sans-serif`, fit: 490, edge: 6 });
}

/** The name panels' material: the atlas's row `coachName` (per instance), cut out of the clear; with `fade`, faded by
 *  that per-instance attribute too */
export function createCoachNameMaterial(tex: THREE.Texture, rows: number, fade?: string): THREE.MeshStandardNodeMaterial {
  return createLetteringMaterial(tex, rows, 'coachName', 0.4, fade);
}

let _coachMat: THREE.MeshStandardNodeMaterial | null = null;

/**
 * The coach's TSL material. Per instance: `coachBody` (its paint, linear rgb), `coachStripe` and `coachStripe2` (the
 * swooshes'). In its frame: +z the front, +x its left (the driver's side), -x the curb's (the door)
 */
export function createCoachMaterial(): THREE.MeshStandardNodeMaterial {
  if (_coachMat) return _coachMat;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const paint = attribute('coachBody', 'vec3');
  const stripeA = attribute('coachStripe', 'vec3');
  const stripeB = attribute('coachStripe2', 'vec3');
  const isTrim = step(abs(partId.sub(COACH_PARTS.TRIM)), 0.25);
  const isBody = float(1.0).sub(isTrim);
  const ax = abs(p.x);
  const front = smoothstep(0.15, 0.4, n.z).mul(step(ZF - 1.6, p.z)).mul(isBody);
  const rear = smoothstep(0.15, 0.4, n.z.negate()).mul(step(p.z, ZR + 0.9)).mul(isBody);
  const side = smoothstep(0.5, 0.75, abs(n.x)).mul(isBody);
  const curb = step(p.x, 0.0);

  // The windshield (a centre post), the destination sign over it; the rear's black panel
  const frontGlass = roundedRect(vec2(p.x, p.y.sub(2.24)), vec2(1.16, 0.94), 0.14).mul(smoothstep(0.012, 0.026, ax)).mul(front);
  const frontSeal = roundedRect(vec2(p.x, p.y.sub(2.4)), vec2(1.22, 1.14), 0.16).mul(front);
  const destSign = roundedRect(vec2(p.x, p.y.sub(3.33)), vec2(0.78, 0.1), 0.03).mul(front);
  const rearPanel = roundedRect(vec2(p.x, p.y.sub(2.75)), vec2(1.02, 0.55), 0.12).mul(rear);

  // The side glass: the passengers' band all along, over the luggage bays; the driver's lower window; the curb's door
  const winY = 2.58, winH = 0.62;
  const band = roundedRect(vec2(p.z.sub(-0.55), p.y.sub(winY)), vec2(5.15, winH), 0.1).mul(side);
  const mullion = smoothstep(0.02, 0.035, abs(fract(p.z.mul(0.6).add(0.1)).sub(0.5).mul(1.6)));
  const driver = roundedRect(vec2(p.z.sub(ZF - 0.95), p.y.sub(2.4)), vec2(0.55, 0.8), 0.1).mul(side).mul(float(1.0).sub(curb));
  const doorFrame = roundedRect(vec2(p.z.sub(ZF - 1.05), p.y.sub(1.82)), vec2(0.52, 1.4), 0.06).mul(side).mul(curb);
  const doorGlass = roundedRect(vec2(p.z.sub(ZF - 1.05), p.y.sub(1.92)), vec2(0.44, 1.22), 0.05).mul(side).mul(curb);
  const glass = clamp(max(max(frontGlass, band.mul(mullion)), max(driver, doorGlass)), 0.0, 1.0);
  const seal = clamp(max(max(frontSeal, rearPanel), max(band, doorFrame)), 0.0, 1.0);

  // The luggage bays' doors (seams between the axles) and the engine's louvres at the back
  const bays = roundedRect(vec2(p.z.add(0.1), p.y.sub(1.08)), vec2(3.4, 0.56), 0.04).mul(side);
  const inner = roundedRect(vec2(p.z.add(0.1), p.y.sub(1.08)), vec2(3.37, 0.53), 0.03).mul(side);
  const cell = abs(fract(p.z.div(1.7).add(0.06)).sub(0.5)).mul(1.7); // (m from the middle of a door)
  const seam = max(smoothstep(0.82, 0.84, cell).mul(bays), bays.sub(inner));
  const louvres = roundedRect(vec2(p.z.sub(ZR + 0.95), p.y.sub(1.2)), vec2(0.55, 0.42), 0.04).mul(side);
  const slats = step(0.5, fract(p.y.mul(14.0))).mul(0.4).add(0.35);

  // The line's livery: its body colour, two swooshes rising towards the back, a dark skirt
  const rise = p.z.mul(-0.07);
  const swooshA = smoothstep(0.2, 0.17, abs(p.y.sub(rise.add(1.25)))).mul(max(side, rear));
  const swooshB = smoothstep(0.075, 0.055, abs(p.y.sub(rise.add(1.62)))).mul(max(side, rear));
  const skirt = smoothstep(0.5, 0.47, p.y);
  const shadeY = smoothstep(0.4, 1.4, p.y).mul(0.15).add(0.85);
  const livery = mix(mix(mix(paint, stripeA, swooshA), stripeB, swooshB), color(0x23272c), skirt).mul(shadeY);

  // Lamps: the headlamps' long pods either side of the black grille; the tail lamps' columns at the back corners
  const pod = roundedRect(vec2(ax.sub(0.9), p.y.sub(0.82)), vec2(0.24, 0.085), 0.05).mul(front);
  const headLamp = roundedRect(vec2(ax.sub(0.92), p.y.sub(0.82)), vec2(0.19, 0.05), 0.04).mul(pod);
  const grille = roundedRect(vec2(p.x, p.y.sub(0.8)), vec2(0.55, 0.16), 0.04).mul(front);
  const tail = roundedRect(vec2(ax.sub(1.0), p.y.sub(1.2)), vec2(0.09, 0.42), 0.05).mul(rear);
  const plate = roundedRect(vec2(p.x, p.y.sub(0.8)), vec2(0.16, 0.06), 0.008).mul(max(rear, front.mul(step(ax, 0.3)).mul(float(1.0).sub(grille))));

  let body = mix(livery, color(0x111418), seal);
  body = mix(body, color(0x1a1e23).mul(slats), louvres);
  body = mix(body, color(0x16191d), seam);
  body = mix(body, color(0x0d0f12), max(grille, pod));
  body = mix(body, color(0xdcefff), headLamp);
  body = mix(body, color(0x8a0c12), tail);
  body = mix(body, color(0xf2b718), plate);
  body = mix(body, color(0x090c10), destSign);
  const glassTint = mix(color(0x0a1118), color(0x1a2a38), clamp(p.y.sub(1.8).mul(0.6), 0.0, 1.0));
  body = mix(body, glassTint, glass);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(body, color(0x1b1f24), isTrim);
  mat.roughnessNode = mix(mix(float(0.28), float(0.12), max(glass, headLamp)), float(0.7), max(isTrim, max(seal.mul(float(1.0).sub(glass)), skirt)));
  mat.metalnessNode = mix(float(0.25), float(0.6), glass).mul(isBody);
  // the destination sign's amber LEDs and the headlamps' glass catch the night
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  const leds = step(0.45, fract(p.x.mul(9.0))).mul(step(0.4, fract(p.y.mul(30.0)))).mul(destSign);
  mat.emissiveNode = color(0xffa020).mul(leds.mul(1.6).mul(night));
  _coachMat = mat;
  return mat;
}
