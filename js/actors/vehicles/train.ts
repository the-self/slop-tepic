// js/actors/vehicles/train.ts
// Ferromex's trains: the GE diesel at the head (an ES44AC / AC4400CW: the wide cab and its short nose, the long hood
// with the radiators' wings flaring at its back end, the walkways and their handrails, two three-axle trucks and the
// fuel tank slung between them) in either of the company's paints, and the cars behind it (a covered hopper, a
// boxcar, a tank car, a gondola of scrap, a well car with two containers stacked in it, an enclosed autorack), at
// their real sizes (models/trains.ts). Built of boxes and cylinders, one mesh per kind painted by part (partId) and
// by kind (`look`), and per instance: its paints (`paint`, `paint2`: a stack's upper container), a diesel's livery
// (`livery`) and its lamps (`lit`: the lead's headlight & ditch lights). +z its front, y = 0 the rails' top.
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, color, attribute, abs, fract, max, mix, step, smoothstep, sin, vec2, length } from 'three/tsl';
import { part, standingBox } from './loft.ts';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { letteringAtlas, createLetteringMaterial } from './lettering.ts';
import { RAIL_CARS } from '../../models/trains.ts';
import type { RailCarKind } from '../../models/trains.ts';

/** The pieces of a rail vehicle (partId) */
export const TRAIN_PARTS = {
  BODY: 0,
  DARK: 1,
  STEEL: 2,
  GLASS: 3,
  LAMP: 4,
  RAIL: 5,
  CARGO: 6,
  LOAD: 7
};

/** Each kind's look in the material (the `look` attribute) */
const LOOKS: Record<RailCarKind, number> = { loco: 0, hopper: 1, boxcar: 2, tank: 3, gondola: 4, stack: 5, autorack: 6 };

const DECK = 1.7; // m: a diesel's walkway over the rails
const CAB_BACK = 5.3; // m: from its middle to the back of its cab (the long hood behind it)
const STACK_SPLIT = 3.14; // m: where a well car's lower container ends and the upper one starts

// A box w × h × d (m) standing on y, centred on (x, z), as a part
const box = (id: number, w: number, h: number, d: number, x: number, y: number, z: number) => part(standingBox(w, h, d, x, y, z), id);
// A wheel: a cylinder along x of radius r and width w centred on (x, y, z)
const wheel = (id: number, r: number, w: number, x: number, y: number, z: number) =>
  part(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, y, z), id);

// A truck (bogie) at z: its frame, its side frames and its wheels on `axles` (m from its pivot), wheels of radius r
function truck(g: THREE.BufferGeometry[], z: number, axles: readonly number[], r: number): void {
  const P = TRAIN_PARTS, span = axles[axles.length - 1] - axles[0];
  g.push(box(P.DARK, 2.2, 0.32, span * 0.5 + 0.6, 0, r + 0.05, z)); // the bolster
  for (const s of [-1, 1]) {
    g.push(box(P.DARK, 0.2, 0.5, span + 1.0, s * 1.08, r - 0.2, z)); // the side frames
    for (const a of axles) g.push(wheel(P.STEEL, r, 0.14, s * 0.75, r, z + a));
  }
  for (const a of axles) g.push(part(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 8).rotateZ(Math.PI / 2).translate(0, r, z + a), P.DARK));
}

// The couplers & their draft gear at both ends of a car `len` m long, at height y
function couplers(g: THREE.BufferGeometry[], len: number, y: number): void {
  for (const s of [-1, 1]) g.push(box(TRAIN_PARTS.DARK, 0.35, 0.3, 0.7, 0, y, s * (len / 2 - 0.35)));
}

// The GE diesel: +z its cab end
function locomotive(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.loco.length, half = L / 2, g: THREE.BufferGeometry[] = [];
  // the underframe & its sills, the pilots at both ends
  g.push(box(P.BODY, 3.1, 0.38, L - 1.2, 0, DECK - 0.38, 0));
  for (const s of [-1, 1]) {
    g.push(box(P.DARK, 2.9, 0.9, 0.5, 0, 0.45, s * (half - 0.85)));
    g.push(box(P.DARK, 2.6, 0.35, 0.3, 0, 0.12, s * (half - 0.6))); // (the plow)
  }
  couplers(g, L, 0.75);
  for (const z of [-7.95, 7.95]) truck(g, z, [-2.07, 0, 2.07], 0.53);
  // the fuel tank between the trucks, the air reservoirs over it
  g.push(box(P.DARK, 2.75, 0.9, 7.6, 0, 0.42, -0.4));
  for (const s of [-1, 1]) g.push(part(new THREE.CylinderGeometry(0.24, 0.24, 5.2, 10).rotateX(Math.PI / 2).translate(s * 1.25, 1.12, -0.4), P.DARK));
  // the nose and the cab, full width
  g.push(box(P.BODY, 2.15, 1.25, 1.75, 0, DECK, half - 1.95));
  g.push(box(P.BODY, 3.1, 3.02, 3.2, 0, DECK, CAB_BACK + 1.6));
  // the long hood, its walkways either side; the radiators' wings over its back end; the dynamic brakes' blister
  g.push(box(P.BODY, 2.3, 2.65, CAB_BACK + half - 0.75, 0, DECK, (CAB_BACK - half + 0.75) / 2));
  g.push(box(P.BODY, 3.06, 1.35, 4.4, 0, 3.37, -half + 2.95));
  g.push(box(P.BODY, 2.55, 0.32, 2.6, 0, DECK + 2.65, CAB_BACK - 1.6));
  // the radiators' fans and the exhaust on the roof
  for (const z of [-half + 1.9, -half + 3.9]) g.push(part(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 18).translate(0, 4.77, z), P.DARK));
  g.push(box(P.DARK, 0.7, 0.3, 1.1, 0, DECK + 2.65, -1.2));
  // the glass: the windscreen's two panes, the cab's side windows, the back's two
  for (const s of [-1, 1]) {
    g.push(box(P.GLASS, 1.15, 0.72, 0.06, s * 0.74, 3.62, CAB_BACK + 3.21));
    g.push(box(P.GLASS, 0.06, 0.66, 1.5, s * 1.56, 3.55, CAB_BACK + 1.85));
    g.push(box(P.GLASS, 0.75, 0.6, 0.06, s * 1.1, 3.6, CAB_BACK - 0.01));
  }
  // the lamps: the headlight over the windscreen and on the nose, the ditch lights by the pilot; the back's too
  g.push(box(P.LAMP, 0.6, 0.22, 0.06, 0, 4.42, CAB_BACK + 3.21));
  g.push(box(P.LAMP, 0.45, 0.2, 0.06, 0, DECK + 0.95, half - 1.06));
  for (const s of [-1, 1]) {
    g.push(box(P.LAMP, 0.22, 0.22, 0.06, s * 1.2, 1.05, half - 0.58));
    g.push(box(P.LAMP, 0.22, 0.22, 0.06, s * 0.8, DECK + 2.2, -half + 0.73));
  }
  // the horn on the cab's roof
  g.push(box(P.DARK, 0.6, 0.18, 0.25, 0.6, 4.72, CAB_BACK + 1.0));
  // the handrails along the walkways (posts every 1.9 m, a rail at hip height and one at the knee) and at the ends
  for (const s of [-1, 1]) {
    const x = s * 1.5, z0 = -half + 1.0, z1 = CAB_BACK - 0.1;
    for (const y of [DECK + 0.5, DECK + 1.0]) g.push(box(P.RAIL, 0.05, 0.05, z1 - z0, x, y, (z0 + z1) / 2));
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 8) g.push(box(P.RAIL, 0.05, 1.05, 0.05, x, DECK, z));
    for (const e of [-1, 1]) g.push(box(P.RAIL, 0.05, 0.05, 1.0, s * 0.95, DECK + 1.0, e * (half - 0.55)));
  }
  for (const e of [-1, 1]) g.push(box(P.RAIL, 2.0, 0.05, 0.05, 0, DECK + 1.0, e * (half - 0.08)));
  return g;
}

// A freight car's running gear: its trucks, couplers, centre sill & end platforms
function underframe(g: THREE.BufferGeometry[], kind: RailCarKind, top = 1.15): void {
  const spec = RAIL_CARS[kind], L = spec.length;
  for (const z of [-spec.trucks, spec.trucks]) truck(g, z, [-0.89, 0.89], 0.42);
  couplers(g, L, 0.72);
  g.push(box(TRAIN_PARTS.DARK, 0.6, top - 0.9, L - 1.0, 0, 0.9, 0));
  for (const s of [-1, 1]) g.push(box(TRAIN_PARTS.DARK, 3.0, 0.08, 0.8, 0, top - 0.08, s * (L / 2 - 0.6)));
}

function hopper(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.hopper.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'hopper');
  g.push(box(P.BODY, 3.25, 2.5, L - 1.0, 0, 1.95, 0)); // the body, over the trucks
  g.push(box(P.BODY, 2.95, 0.15, L - 1.2, 0, 4.45, 0)); // its roof, the hatch along it
  g.push(box(P.DARK, 0.7, 0.08, L - 4.0, 0, 4.6, 0));
  // the three hoppers under the body, between the trucks
  for (const z of [-4.2, 0, 4.2]) g.push(box(P.BODY, 2.3, 0.9, 2.6, 0, 1.05, z));
  return g;
}

function boxcar(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.boxcar.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'boxcar', 1.25);
  g.push(box(P.BODY, 3.2, 3.75, L - 0.7, 0, 1.25, 0));
  g.push(box(P.BODY, 3.0, 0.15, L - 0.8, 0, 5.0, 0)); // the roof
  for (const s of [-1, 1]) g.push(box(P.DARK, 0.06, 0.12, 3.5, s * 1.62, 4.55, 0)); // the door's track
  return g;
}

function tank(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.tank.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'tank', 1.3);
  g.push(part(new THREE.CylinderGeometry(1.45, 1.45, L - 2.2, 24).rotateX(Math.PI / 2).translate(0, 2.75, 0), P.BODY));
  for (const s of [-1, 1]) g.push(part(new THREE.SphereGeometry(1.45, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(1, 0.32, 1).rotateX(s * Math.PI / 2).translate(0, 2.75, s * (L / 2 - 1.1)), P.BODY));
  g.push(part(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 14).translate(0, 4.4, 0), P.BODY)); // the dome
  g.push(box(P.DARK, 1.6, 0.05, 1.4, 0, 4.18, 0)); // its platform
  return g;
}

function gondola(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.gondola.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'gondola', 1.1);
  g.push(box(P.BODY, 3.2, 0.2, L - 0.8, 0, 1.1, 0)); // the floor
  for (const s of [-1, 1]) {
    g.push(box(P.BODY, 0.1, 1.5, L - 0.8, s * 1.55, 1.1, 0)); // the sides
    g.push(box(P.BODY, 3.2, 1.5, 0.1, 0, 1.1, s * (L / 2 - 0.45))); // the ends
  }
  // its load of scrap, heaped
  for (let k = -3; k <= 3; k++) g.push(box(P.LOAD, 2.9, 0.75 + 0.25 * Math.cos(k * 1.7), 2.1, 0, 1.3, k * 2.15));
  return g;
}

function stack(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.stack.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'stack', 0.6);
  // the well: its side sills low between the trucks, its bulkheads over them
  for (const s of [-1, 1]) {
    g.push(box(P.BODY, 0.2, 1.0, L - 4.6, s * 1.45, 0.45, 0));
    g.push(box(P.BODY, 3.0, 1.5, 2.1, 0, 0.65, s * (L / 2 - 1.25)));
  }
  g.push(box(P.BODY, 2.7, 0.12, L - 4.6, 0, 0.42, 0)); // the well's floor
  // the containers: a 40 ft one in the well, a 40 ft high cube on it
  g.push(box(P.CARGO, 2.44, STACK_SPLIT - 0.55, 12.19, 0, 0.55, 0));
  g.push(box(P.CARGO, 2.44, 2.8, 12.19, 0, STACK_SPLIT + 0.01, 0));
  return g;
}

function autorack(): THREE.BufferGeometry[] {
  const P = TRAIN_PARTS, L = RAIL_CARS.autorack.length, g: THREE.BufferGeometry[] = [];
  underframe(g, 'autorack', 1.2);
  g.push(box(P.BODY, 3.25, 4.25, L - 0.9, 0, 1.2, 0));
  g.push(box(P.BODY, 3.05, 0.15, L - 1.0, 0, 5.45, 0)); // the roof
  for (const s of [-1, 1]) g.push(box(P.DARK, 3.1, 4.0, 0.06, 0, 1.3, s * (L / 2 - 0.42))); // the end doors
  return g;
}

const BUILDERS: Record<RailCarKind, () => THREE.BufferGeometry[]> = { loco: locomotive, hopper, boxcar, tank, gondola, stack, autorack };

/** A rail vehicle of `kind` in one geometry, its parts by partId, its kind's look on every vertex */
export function buildRailCarGeometry(kind: RailCarKind): THREE.BufferGeometry {
  const merged = mergeGeometries(BUILDERS[kind]().map((x) => (x.index ? x.toNonIndexed() : x)));
  merged.setAttribute('look', new THREE.BufferAttribute(new Float32Array(merged.attributes.position.count).fill(LOOKS[kind]), 1));
  return merged;
}

/** "Ferromex" along both sides of a diesel's long hood: a panel each (uv across it, the atlas's row by livery) */
export function buildRailNameGeometry(): THREE.BufferGeometry {
  const panels: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // (inside the 1998 paint's white panel at every height)
    const panel = new THREE.PlaneGeometry(4.8, 1.05).rotateY(side * Math.PI / 2);
    panel.translate(side * 1.162, 3.05, -0.35);
    panels.push(panel);
  }
  return mergeGeometries(panels);
}

/** The name lettered for each livery: row 0 the 1998 paint's (teal on its white panel), row 1 the 2017's (white) */
export function railNameTexture(): THREE.CanvasTexture {
  return letteringAtlas([['Ferromex', '#0e5a55', '#0e5a55'], ['Ferromex', '#f4f4f0', '#f4f4f0']],
    { width: 1024, row: 210, size: 190, font: `900 'Arial Black', Arial, sans-serif`, fit: 990, edge: 2 });
}

/** The name panels' material: the atlas's row `railName` (per instance), cut out of the clear */
export function createRailNameMaterial(tex: THREE.Texture): THREE.MeshStandardNodeMaterial {
  return createLetteringMaterial(tex, 2, 'railName', 0.5);
}

let _trainMat: THREE.MeshStandardNodeMaterial | null = null;

/**
 * The rail vehicles' material: each part's colour; the diesels in their livery; the cars in their paint (`paint`, a
 * stack's upper container `paint2`) with their ribs, door, corrugations or perforations; the lead's lamps lit
 */
export function createTrainMaterial(): THREE.MeshStandardNodeMaterial {
  if (_trainMat) return _trainMat;
  const P = TRAIN_PARTS;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const id = attribute('partId', 'float');
  const look = attribute('look', 'float');
  const paint = attribute('paint', 'vec3');
  const paint2 = attribute('paint2', 'vec3');
  const livery = attribute('livery', 'float');
  const lit = attribute('lit', 'float');
  const is = (k: number) => step(abs(id.sub(k)), 0.25);
  const isLook = (k: number) => step(abs(look.sub(k)), 0.25);
  const side = smoothstep(0.5, 0.8, abs(n.x));
  const between = (v: Node<'float'>, a: number, b: number) => step(a, v).mul(step(v, b));

  // THE DIESEL. Its frame: dark under a white stripe along the sill
  const sill = between(p.y, 1.44, 1.56);
  const frame = mix(color(0x24272a), color(0xf2f2ee), sill);
  const onFrame = step(p.y, DECK - 0.02);
  const cab = step(CAB_BACK, p.z);
  // the 2017 paint (GMXT's): the long hood charcoal under broad grey chevrons pointing forward, the cab & nose red
  // with white ones
  const hoodChevron = step(fract(p.z.add(abs(p.y.sub(3.0))).div(3.4)), 0.36);
  const hood17 = mix(color(0x353b3f), color(0x6f777b), hoodChevron.mul(side));
  const cabChevron = step(fract(p.z.add(abs(p.y.sub(3.1)).mul(1.2)).div(0.8)), 0.2).mul(step(CAB_BACK + 0.4, p.z)).mul(side);
  const cab17 = mix(color(0xc8202a), color(0xf4f4f0), cabChevron);
  const paint17 = mix(hood17, cab17, cab);
  // the 1998 paint: red, a white panel slanting across the middle of the hood (the name on it), teal over the back
  // half of the hood above the walkway's rail, a teal slash down the cab's side
  const slant = p.z.sub(p.y.sub(DECK).mul(0.9));
  const panel = step(-4.4, slant).mul(step(slant, 1.6)).mul(step(p.y, 4.35)).mul(side).mul(step(p.z, CAB_BACK - 0.05));
  const teal = step(3.2, p.y).mul(step(p.z.add(p.y.sub(3.2).mul(1.2)), -1.6)).mul(float(1).sub(panel));
  const slash = between(p.z.sub(p.y.mul(0.8)), 3.55, 4.15).mul(cab).mul(side);
  const paint98 = mix(mix(color(0xc21d25), color(0xf2f2ee), panel), color(0x0f6b66), max(teal, slash));
  const loco = mix(mix(paint98, paint17, step(0.5, livery)), frame, onFrame);

  // THE CARS: their paint, ribbed (the hopper's & boxcar's posts, the gondola's stakes), the boxcar's door darker
  const ribs = (period: number) => smoothstep(0.42, 0.48, abs(fract(p.z.div(period)).sub(0.5))).mul(side).mul(0.28);
  const door = between(abs(p.z), 0, 1.65).mul(between(p.y, 1.3, 4.6)).mul(side);
  const doorEdge = between(abs(p.z), 1.55, 1.68).mul(between(p.y, 1.3, 4.6)).mul(side);
  const holes = step(length(fract(vec2(p.z, p.y).div(0.2)).sub(0.5)), 0.24).mul(between(p.y, 1.6, 5.25)).mul(side);
  let car = paint.mul(float(1).sub(ribs(1.1).mul(isLook(1))));
  car = mix(car, paint.mul(float(1).sub(ribs(1.25))).mul(float(1).sub(door.mul(0.18)).sub(doorEdge.mul(0.5))), isLook(2));
  car = mix(car, paint.mul(float(1).sub(ribs(1.0))), isLook(4));
  car = mix(car, color(0x3a302a), isLook(5)); // (the well car itself: dark brown)
  car = mix(car, paint.mul(float(1).sub(holes.mul(0.55))), isLook(6));
  // grime: the cars' lower parts browner, darker
  const grime = smoothstep(2.4, 0.9, p.y).mul(0.35);
  car = mix(car, color(0x3b3029), grime);
  // the containers: corrugated, the lower one's paint, the upper one's paint2
  const corrugation = sin(p.z.mul(Math.PI * 2 / 0.3)).mul(0.08).mul(side);
  const cargo = mix(paint, paint2, step(STACK_SPLIT, p.y)).mul(float(0.92).add(corrugation));

  let col = mix(car, loco, isLook(0));
  col = mix(col, color(0x1b1c1e), is(P.DARK));
  col = mix(col, color(0x2f2b28), is(P.STEEL));
  col = mix(col, color(0x0c1218), is(P.GLASS));
  // the lamps: a pale lens, bright once lit (below)
  const ahead = step(0, p.z).mul(lit);
  col = mix(col, mix(color(0x8c8a80), color(0xfff6d8), ahead), is(P.LAMP));
  col = mix(col, color(0xe8e4d4), is(P.RAIL));
  col = mix(col, cargo, is(P.CARGO));
  col = mix(col, color(0x4b3a2e).mul(float(0.8).add(sin(p.x.mul(13).add(p.z.mul(7))).mul(0.2))), is(P.LOAD));
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  const shiny = max(is(P.GLASS), is(P.LAMP));
  mat.roughnessNode = mix(mix(float(0.62), float(0.2), shiny), float(0.85), max(is(P.LOAD), is(P.DARK)));
  mat.metalnessNode = mix(float(0.15), float(0.6), is(P.STEEL));
  // the lead diesel's lamps lit ahead (its headlight & ditch lights), brighter at night
  mat.emissiveNode = color(0xfff0c8).mul(is(P.LAMP).mul(ahead).mul(float(0.6).add(smoothstep(0.3, 1.0, cityUniforms.uInteriorGlow).mul(1.6))));
  _trainMat = mat;
  return mat;
}
