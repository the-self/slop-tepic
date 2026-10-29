// js/actors/vehicles/route-truck.ts
// The bottler's route truck (the camión repartidor that takes the refrescos round the tienditas): a red cab-over cab
// (an Isuzu Elf / International kind of thing) and its red side-loader body, the roll-up doors of its bays down both
// sides, a white wave along its foot and the brand's name over the bays (a panel each side, lettered). 8.2 m bumper
// to bumper, 2.45 m wide, 3.15 m tall. Built of boxes and cylinders, one mesh painted by part (partId).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, color, attribute, abs, fract, max, mix, step, smoothstep } from 'three/tsl';
import { part, standingBox } from './loft.ts';
import { letteringAtlas } from './lettering.ts';

/** The truck's pieces (partId) */
export const ROUTE_TRUCK_PARTS = {
  CAB: 0,
  BODY: 1,
  WHITE: 2,
  DARK: 3,
  GLASS: 4,
  LAMP: 5,
  TYRE: 6,
  RIM: 7
};

/** The truck's size (m): length, width, height */
export const ROUTE_TRUCK_SIZE = { length: 8.2, width: 2.45, height: 3.15 };

// A box w × h × d (m) standing on y, centred on (x, z), as a part
const box = (id: number, w: number, h: number, d: number, x: number, y: number, z: number) => part(standingBox(w, h, d, x, y, z), id);
// A cylinder along x (a tyre or a rim: radius r, width w) centred on (x, y, z)
const wheel = (id: number, r: number, w: number, x: number, y: number, z: number) =>
  part(new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, y, z), id);

// Its body, from the cab's back to the rear doors (m along z); its bays' dividers
const BODY_FRONT = 1.95, BODY_REAR = -3.95;
const DIVIDERS = [1.85, -0.1, -2.05, -3.85];

/** The truck in one geometry, its parts by partId; +z its front, y = 0 the ground, its middle the origin */
export function buildRouteTruckGeometry(): THREE.BufferGeometry {
  const P = ROUTE_TRUCK_PARTS;
  const g: THREE.BufferGeometry[] = [];
  // the frame rails, the cab over the front axle, its bumper, grille & lamps
  g.push(box(P.DARK, 1.0, 0.3, 7.6, 0, 0.5, -0.1));
  g.push(box(P.CAB, 2.3, 2.1, 2.0, 0, 0.78, 3.05));
  g.push(box(P.CAB, 2.1, 0.32, 1.7, 0, 2.88, 3.0)); // (the roof's deflector)
  g.push(box(P.DARK, 2.36, 0.34, 0.24, 0, 0.36, 4.1));
  g.push(box(P.DARK, 1.5, 0.42, 0.04, 0, 0.95, 4.06));
  for (const s of [-1, 1]) {
    g.push(box(P.LAMP, 0.34, 0.16, 0.04, s * 0.86, 1.08, 4.06));
    g.push(box(P.GLASS, 0.05, 0.62, 0.95, s * 1.16, 1.95, 3.35)); // the doors' windows
    g.push(box(P.DARK, 0.06, 0.42, 0.14, s * 1.3, 1.85, 3.95)); // the mirrors
    g.push(box(P.DARK, 0.3, 0.06, 0.06, s * 1.2, 2.25, 3.95));
  }
  g.push(part(new THREE.BoxGeometry(2.1, 0.86, 0.05).rotateX(-0.06).translate(0, 2.32, 4.06), P.GLASS));
  // the body: its box on the rails, the dividers between its bays and the white wave down both sides, the rear's
  // doors & bumper
  const bl = BODY_FRONT - BODY_REAR, bz = (BODY_FRONT + BODY_REAR) / 2;
  g.push(box(P.BODY, 2.45, 2.2, bl, 0, 0.95, bz));
  for (const s of [-1, 1]) {
    for (const z of DIVIDERS) g.push(box(P.DARK, 0.03, 2.0, 0.07, s * 1.235, 1.05, z));
    g.push(box(P.WHITE, 0.02, 0.2, bl - 0.1, s * 1.236, 1.18, bz));
    g.push(box(P.DARK, 0.5, 0.06, 1.3, s * 0.95, 0.95, -2.5)); // (the mudguards over the duals)
  }
  g.push(box(P.DARK, 0.04, 2.0, 0.04, 0, 1.05, BODY_REAR - 0.02));
  g.push(box(P.DARK, 2.3, 0.2, 0.16, 0, 0.42, BODY_REAR - 0.1));
  for (const s of [-1, 1]) g.push(box(P.LAMP, 0.1, 0.24, 0.04, s * 1.05, 0.66, BODY_REAR - 0.18));
  // the wheels: singles under the cab, duals at the back
  const R = 0.46;
  for (const s of [-1, 1]) {
    g.push(wheel(P.TYRE, R, 0.3, s * 1.0, R, 3.0), wheel(P.RIM, 0.26, 0.32, s * 1.0, R, 3.0));
    g.push(wheel(P.TYRE, R, 0.58, s * 0.9, R, -2.5), wheel(P.RIM, 0.26, 0.6, s * 0.9, R, -2.5));
  }
  return mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)));
}

/** The brand's name over the bays, both sides: a panel each (uv across it) */
export function buildRouteTruckNameGeometry(): THREE.BufferGeometry {
  const panels: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const panel = new THREE.PlaneGeometry(5.0, 1.25).rotateY(side * Math.PI / 2);
    panel.translate(side * 1.24, 2.35, (BODY_FRONT + BODY_REAR) / 2);
    panels.push(panel);
  }
  return mergeGeometries(panels);
}

/** The brand's name for the panels: `name` in white, edged in the body's red, in the CSS font `font` (its weight
 *  first: `700 cursive`) */
export function routeTruckNameTexture(name: string, font: string): THREE.CanvasTexture {
  return letteringAtlas([[name, '#ffffff', '#c20e1a']], { width: 1024, row: 256, size: 200, font, fit: 960, edge: 3 });
}

/** The name panels' material: the name cut out of the clear */
export function createRouteTruckNameMaterial(tex: THREE.Texture): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.45, metalness: 0, alphaTest: 0.5 });
}

let _routeTruckMat: THREE.MeshStandardNodeMaterial | null = null;

/** The truck's material: each part's colour, the bays' roll-up doors ribbed on the body's sides */
export function createRouteTruckMaterial(): THREE.MeshStandardNodeMaterial {
  if (_routeTruckMat) return _routeTruckMat;
  const P = ROUTE_TRUCK_PARTS;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const id = attribute('partId', 'float');
  const is = (k: number) => step(abs(id.sub(k)), 0.25);
  // the roll-up doors' slats, every 0.11 m up the body's sides
  const side = smoothstep(0.5, 0.8, abs(n.x));
  const slat = smoothstep(0.38, 0.5, abs(fract(p.y.div(0.11)).sub(0.5))).mul(side).mul(0.22);
  let col = mix(color(0x18191b), color(0xd0101c), is(P.CAB));
  col = mix(col, color(0xc20e1a).mul(float(1.0).sub(slat)), is(P.BODY));
  col = mix(col, color(0xf4f4f2), is(P.WHITE));
  col = mix(col, color(0x16222c), is(P.GLASS));
  col = mix(col, color(0xf2efe4), is(P.LAMP));
  col = mix(col, color(0x151515), is(P.TYRE));
  col = mix(col, color(0xbcc2c8), is(P.RIM));
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  const shiny = max(is(P.GLASS), is(P.RIM));
  mat.roughnessNode = mix(mix(float(0.42), float(0.15), shiny), float(0.9), is(P.TYRE));
  mat.metalnessNode = mix(float(0.1), float(0.8), is(P.RIM));
  _routeTruckMat = mat;
  return mat;
}
