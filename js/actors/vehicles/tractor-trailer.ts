// js/actors/vehicles/tractor-trailer.ts
// The tráiler that brings the supermarkets their goods in the small hours: a long-nosed tractocamión (a Kenworth
// T800 kind of thing: its hood, its chrome grille & bumper, the stacks either side of the sleeper, the fuel tanks) and
// its 53 ft caja seca, refrigerated (the thermo unit on its front), white with the chain's band along its foot and its
// name along both sides (an atlas, trailerNameTexture). 23.6 m bumper to doors, 2.6 m wide, 4.1 m tall. Built of boxes
// and cylinders, one mesh painted by part (partId) and per instance: the cab's paint (`cabPaint`) and the chain's
// colours (`trailerInk`, `trailerInk2`).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, color, attribute, abs, fract, max, mix, step, smoothstep } from 'three/tsl';
import { part, standingBox } from './loft.ts';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { letteringAtlas, createLetteringMaterial } from './lettering.ts';

/** The truck's pieces (partId) */
export const TRUCK_PARTS = {
  CAB: 0,
  CHROME: 1,
  DARK: 2,
  TRAILER: 3,
  GLASS: 4,
  LAMP: 5,
  TYRE: 6,
  RIM: 7,
  REEFER: 8
};

// Built bumper (+z) to doors in the tractor's frame (z 7.6 .. -15.95), then moved so its middle is the origin
const SHIFT = 4.175;
/** The truck's size (m): length, width, height; how far its doors are from its middle (m, along -z) */
export const TRUCK_SIZE = { length: 23.55, width: 2.6, height: 4.1, rear: 15.95 - SHIFT };
/** Where the trailer starts (m from the middle, its front; the tractor's pieces are ahead of it) */
const TRAILER_FRONT = 0.2;
const TRAILER_REAR = -15.95;

// A box w × h × d (m) standing on y, centred on (x, z), as a part
const box = (id: number, w: number, h: number, d: number, x: number, y: number, z: number) => part(standingBox(w, h, d, x, y, z), id);
// A cylinder along x (a wheel's tyre or rim: radius r, width w) centred on (x, y, z)
const wheel = (id: number, r: number, w: number, x: number, y: number, z: number) =>
  part(new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2).translate(x, y, z), id);

/** The truck in one geometry, its parts by partId; +z its front, y = 0 the ground */
export function buildTractorTrailerGeometry(): THREE.BufferGeometry {
  const P = TRUCK_PARTS;
  const g: THREE.BufferGeometry[] = [];
  // the tractor: frame rails, bumper, the long hood & its fenders, the grille, the cab & the sleeper
  g.push(box(P.DARK, 0.95, 0.32, 9.4, 0, 0.72, 2.7));
  g.push(box(P.CHROME, 2.5, 0.42, 0.32, 0, 0.38, 7.45));
  g.push(box(P.CAB, 1.42, 1.0, 2.75, 0, 1.08, 5.95));
  for (const s of [-1, 1]) {
    g.push(box(P.CAB, 0.48, 0.5, 1.9, s * 0.98, 0.95, 6.15)); // the fenders over the front wheels
    g.push(box(P.CHROME, 0.22, 0.14, 0.06, s * 0.98, 1.3, 7.12)); // the headlamps on them
    g.push(part(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 14).rotateX(Math.PI / 2).translate(s * 1.02, 0.86, 3.5), P.CHROME)); // fuel tanks
    g.push(part(new THREE.CylinderGeometry(0.085, 0.085, 2.8, 10).translate(s * 1.2, 2.5, 1.0), P.CHROME)); // the stacks
    g.push(box(P.DARK, 0.5, 0.65, 0.04, s * 0.95, 0.25, -1.95)); // the mud flaps behind the drive axles
    g.push(box(P.CHROME, 0.04, 0.32, 0.14, s * 1.2, 2.55, 4.85)); // the mirrors' arms...
    g.push(box(P.DARK, 0.1, 0.42, 0.18, s * 1.32, 2.35, 4.85)); // ...and heads
  }
  g.push(box(P.CHROME, 1.15, 1.02, 0.08, 0, 1.12, 7.32));
  g.push(box(P.CAB, 2.3, 1.75, 1.95, 0, 1.25, 3.72));
  g.push(box(P.CAB, 2.3, 2.45, 2.1, 0, 1.25, 1.8));
  // the fairing over the cab's roof, rising to the sleeper's
  const fairing = new THREE.BufferGeometry();
  const f = (x: number, y: number, z: number) => [x, y, z];
  const pts = [
    f(-1.12, 3.0, 4.65), f(1.12, 3.0, 4.65), f(1.12, 3.7, 2.75), f(-1.12, 3.7, 2.75),
    f(-1.12, 3.0, 2.75), f(1.12, 3.0, 2.75)
  ];
  const idx = [0, 1, 2, 0, 2, 3, 0, 3, 4, 1, 5, 2];
  fairing.setAttribute('position', new THREE.Float32BufferAttribute(idx.flatMap((i) => pts[i]), 3));
  fairing.computeVertexNormals();
  g.push(part(fairing, P.CAB));
  // the glass: the split windshield, the doors' windows
  g.push(part(new THREE.BoxGeometry(2.05, 0.78, 0.06).rotateX(-0.12).translate(0, 2.42, 4.71), P.GLASS));
  for (const s of [-1, 1]) g.push(box(P.GLASS, 0.06, 0.7, 1.0, s * 1.16, 2.08, 4.0));
  // the amber marker lamps along the cab's roof
  for (let k = -2; k <= 2; k++) g.push(box(P.LAMP, 0.12, 0.06, 0.06, k * 0.28, 3.0, 4.66));
  // the fifth wheel
  g.push(box(P.DARK, 1.9, 0.18, 1.3, 0, 1.04, -0.7));
  // the caja: its box, its foot's rail, the refrigeration unit on its front, its legs, the rear bumper, the doors' gear
  const tl = TRAILER_FRONT - TRAILER_REAR;
  g.push(box(P.TRAILER, 2.6, 2.85, tl, 0, 1.25, (TRAILER_FRONT + TRAILER_REAR) / 2));
  g.push(box(P.DARK, 2.62, 0.18, tl, 0, 1.12, (TRAILER_FRONT + TRAILER_REAR) / 2));
  g.push(box(P.REEFER, 2.0, 1.55, 0.42, 0, 2.35, TRAILER_FRONT + 0.21));
  for (const s of [-1, 1]) g.push(box(P.DARK, 0.12, 1.0, 0.12, s * 0.9, 0.12, -2.4));
  g.push(box(P.DARK, 2.4, 0.16, 0.16, 0, 0.5, TRAILER_REAR + 0.25));
  for (const s of [-1, 1]) {
    for (const x of [0.32, 0.95]) g.push(box(P.DARK, 0.05, 2.6, 0.05, s * x, 1.35, TRAILER_REAR - 0.03));
    g.push(box(P.LAMP, 0.08, 0.3, 0.05, s * 1.18, 1.35, TRAILER_REAR - 0.03));
  }
  // the wheels: the steer axle's singles, the duals on the drive axles and the trailer's tandem
  const R = 0.52;
  for (const s of [-1, 1]) {
    g.push(wheel(P.TYRE, R, 0.32, s * 1.04, R, 6.25), wheel(P.RIM, 0.3, 0.34, s * 1.04, R, 6.25));
    for (const z of [-0.05, -1.35, -12.75, -14.05]) {
      g.push(wheel(P.TYRE, R, 0.62, s * 0.94, R, z), wheel(P.RIM, 0.3, 0.64, s * 0.94, R, z));
    }
  }
  const merged = mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)));
  merged.translate(0, 0, SHIFT);
  return merged;
}

/** The chain's name along both sides of the caja: a panel each (uv across it, the atlas's row by instance) */
export function buildTrailerNameGeometry(): THREE.BufferGeometry {
  const panels: THREE.BufferGeometry[] = [];
  const zc = (TRAILER_FRONT + TRAILER_REAR) / 2 + SHIFT;
  for (const side of [-1, 1]) {
    const panel = new THREE.PlaneGeometry(13, 1.6).rotateY(side * Math.PI / 2);
    panel.translate(side * 1.312, 2.85, zc);
    panels.push(panel);
  }
  return mergeGeometries(panels);
}

/** The chains' names lettered for the trailers' sides: [name, ink, edge] (CSS) */
export function trailerNameTexture(names: readonly (readonly [name: string, ink: string, edge: string])[]): THREE.CanvasTexture {
  return letteringAtlas(names, { width: 1024, row: 96, size: 78, font: `900 'Arial Black', Arial, sans-serif`, fit: 980, edge: 8 });
}

/** The name panels' material: the atlas's row `trailerName` (per instance), cut out of the clear */
export function createTrailerNameMaterial(tex: THREE.Texture, rows: number): THREE.MeshStandardNodeMaterial {
  return createLetteringMaterial(tex, rows, 'trailerName', 0.45);
}

let _truckMat: THREE.MeshStandardNodeMaterial | null = null;

/** The truck's material: each part's colour; per instance the cab's paint and the chain's two colours on the caja */
export function createTractorTrailerMaterial(): THREE.MeshStandardNodeMaterial {
  if (_truckMat) return _truckMat;
  const P = TRUCK_PARTS;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const id = attribute('partId', 'float');
  const cab = attribute('cabPaint', 'vec3');
  const ink = attribute('trailerInk', 'vec3');
  const ink2 = attribute('trailerInk2', 'vec3');
  const is = (k: number) => step(abs(id.sub(k)), 0.25);
  // the caja: white aluminium, its panels' rivet lines every 1.22 m, the chain's band along its foot and a thin second
  // one over it; its doors at the back
  const side = smoothstep(0.5, 0.8, abs(n.x));
  const edge = abs(fract(p.z.div(1.22)).sub(0.5)); // (0.5 on a seam)
  const rivets = smoothstep(0.49, 0.496, edge).mul(side).mul(0.25);
  const band = smoothstep(1.95, 1.93, p.y).mul(side);
  const band2 = smoothstep(2.08, 2.06, p.y).mul(smoothstep(2.0, 2.02, p.y)).mul(side);
  const caja = mix(mix(color(0xeef0f0).mul(float(1.0).sub(rivets)), ink, band), ink2, band2);
  let col = mix(color(0x15171a), cab, is(P.CAB));
  col = mix(col, color(0xd0d4d8), is(P.CHROME));
  col = mix(col, caja, is(P.TRAILER));
  col = mix(col, color(0x111a22), is(P.GLASS));
  col = mix(col, color(0xff9a1a), is(P.LAMP));
  col = mix(col, color(0x161616), is(P.TYRE));
  col = mix(col, color(0xb8bec4), is(P.RIM));
  col = mix(col, color(0x8d9296), is(P.REEFER));
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  const shiny = max(is(P.CHROME), max(is(P.GLASS), is(P.RIM)));
  mat.roughnessNode = mix(mix(float(0.45), float(0.15), shiny), float(0.9), is(P.TYRE));
  mat.metalnessNode = mix(float(0.1), float(0.85), max(is(P.CHROME), is(P.RIM)));
  // the marker lamps lit at night (the truck idles at the dock with its lights on)
  mat.emissiveNode = color(0xff8a10).mul(is(P.LAMP).mul(smoothstep(0.5, 1.1, cityUniforms.uInteriorGlow).mul(2.0)));
  _truckMat = mat;
  return mat;
}
