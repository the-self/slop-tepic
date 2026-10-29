import * as THREE from 'three/webgpu';
import { cityUniforms } from '../../render/tsl-materials.ts';
import {
  float,
  vec2,
  color,
  attribute,
  abs,
  fract,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  texture,
  uv
} from 'three/tsl';
import { CAR_PARTS } from './car-specs.ts';
import { BUS_PARTS, BUS_SPEC } from './bus-geometry.ts';
import { roundedRect } from './tsl-shapes.ts';
import { letteringAtlas, createLetteringMaterial } from './lettering.ts';
import type { Node } from 'three/webgpu';

// js/actors/vehicles/bus-materials.ts
// The bus and the route signs' textures & TSL materials: the liveries' palette, the route names' atlas, the sign,
// wheel and lofted bus body materials.

// The bus liveries as a palette for createLoftedBusMaterial: a column per livery, [body, trim] (hex), linear colour
export function busLiveryTexture(liveries: [body: number, trim: number][]): THREE.DataTexture {
  const data = new Float32Array(liveries.length * 2 * 4);
  const c = new THREE.Color();
  liveries.forEach((pair, i) => { pair.forEach((hex, row) => {
    c.setHex(hex);
    data.set([c.r, c.g, c.b, 1], (row * liveries.length + i) * 4);
  }); });
  const tex = new THREE.DataTexture(data, liveries.length, 2, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// One row per route of white lettering edged in black on clear (the buses' glass)
export function routeSignTexture(names: string[]): THREE.CanvasTexture {
  return letteringAtlas(names.map((name) => [name.toUpperCase(), '#ffffff', '#000000'] as const),
    { width: 512, row: 64, size: 44, font: `900 Georgia, 'Times New Roman', serif`, fit: 470, edge: 7 });
}

/**
 * Route sign material over routeSignTexture's atlas, reading the per-instance `signRow` (the route's row):
 * - 'glass': the lettering itself, cut out of the clear (a bus's windows)
 * - 'box': a combi's roof sign, white with the lettering in navy, lit from inside at night
 */
export function createRouteSignMaterial(tex: THREE.Texture, rows: number, kind: 'glass' | 'box'): THREE.MeshStandardNodeMaterial {
  if (kind === 'glass') return createLetteringMaterial(tex, rows, 'signRow');
  const row = attribute('signRow', 'float');
  const t = texture(tex, vec2(uv().x, uv().y.add(float(rows - 1).sub(row)).div(rows)));
  const mat = new THREE.MeshStandardNodeMaterial();
  const ink = clamp(t.a.mul(1.4), 0.0, 1.0);
  const face = mix(color(0xf4f6f8), color(0x1b3a8c), ink);
  mat.colorNode = face;
  mat.roughnessNode = float(0.45);
  mat.metalnessNode = float(0.0);
  mat.emissiveNode = face.mul(smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow).mul(0.55));
  return mat;
}

let _busWheelMat: THREE.MeshStandardNodeMaterial | null = null;

export function createBusWheelMaterial(): THREE.MeshStandardNodeMaterial {
  if (_busWheelMat) return _busWheelMat;
  const p = attribute('position', 'vec3');
  const partId = attribute('partId', 'float');
  const isTyre = step(abs(partId.sub(CAR_PARTS.TYRE)), 0.25);
  const radial = length(vec2(p.z, p.y));
  const angle = vec2(p.z, p.y).div(max(radial, 0.0001));
  let lugs: Node<'float'> = float(0.0);
  for (let k = 0; k < 10; k++) {
    const a = (k * Math.PI * 2) / 10;
    lugs = max(lugs, smoothstep(0.024, 0.014, length(vec2(p.z, p.y).sub(vec2(Math.cos(a) * 0.205, Math.sin(a) * 0.205)))));
  }
  const groove = smoothstep(0.006, 0.0, abs(radial.sub(0.29)));
  const steel = color(0xb9c0c6).mul(float(1.0).sub(groove.mul(0.5)));
  const hub = mix(steel, color(0x6b7176), smoothstep(0.13, 0.1, radial));
  const disc = mix(hub, color(0x2a2e33), lugs.mul(0.8));
  const sidewall = smoothstep(0.37, 0.43, radial).mul(0.25).add(0.75);
  const tread = step(0.5, fract(angle.y.mul(9.0).add(angle.x.mul(9.0)))).mul(0.08);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = mix(disc, color(0x17191c).mul(sidewall.add(tread)), isTyre);
  mat.roughnessNode = mix(float(0.35), float(0.88), isTyre);
  mat.metalnessNode = mix(float(0.75), float(0.0), isTyre);
  _busWheelMat = mat;
  return mat;
}

// One material per palette (the traffic's camiones share theirs): a material is built around its `liveries` texture,
// so another palette must not get the first one's back
const _busLoftedMats = new Map<THREE.DataTexture | null, THREE.MeshStandardNodeMaterial>();

/**
 * Creates the TSL procedural material for Tepic's camiones (the lofted bus body):
 * - Wraparound split windshield with gasket & centre post, destination sign band above it; rear window & engine
 *   louvres on the rear face
 * - Continuous side window band with mullions, the driver's window, glazed curb-side front & rear doors
 * - Each route's livery, row `busState.w` of `liveries` (busLiveryTexture): the body colour, and the trim below the
 *   windows and in a pinstripe above them; a dark skirt
 * - Headlamps, turn signals (per-instance `busState`: brake, left (+x), right (-x)), tail / brake light columns,
 *   NY plates; black trims & light-grey roof pods
 */
export function createLoftedBusMaterial(liveries: THREE.DataTexture | null = null): THREE.MeshStandardNodeMaterial {
  const cached = _busLoftedMats.get(liveries);
  if (cached) return cached;
  const s = BUS_SPEC;
  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const state = attribute('busState', 'vec4');
  // (each livery's colours from its column of the palette: the body in the bottom row, the trim in the top; a new
  // instanced attribute would take the body past WebGPU's 8 vertex buffers)
  const liveryAt = (v: number) => (liveries ? texture(liveries, vec2(state.w.add(0.5).div(liveries.image.width), v)).rgb : color(0xf0f4f8));
  const paint = liveryAt(0.25);
  const trim = liveryAt(0.75);
  const isBody = step(abs(partId.sub(BUS_PARTS.BODY)), 0.25);
  const isTrim = step(abs(partId.sub(BUS_PARTS.TRIM)), 0.25);
  const isPod = step(abs(partId.sub(BUS_PARTS.POD)), 0.25);
  const ax = abs(p.x);
  const one = float(1.0);

  const front = smoothstep(0.1, 0.35, n.z).mul(step(s.zFront - 0.9, p.z)).mul(isBody);
  const rear = smoothstep(0.1, 0.35, n.z.negate()).mul(step(p.z, s.zRear + 0.9)).mul(isBody);
  const side = smoothstep(0.5, 0.75, abs(n.x)).mul(isBody);
  const curb = step(p.x, 0.0);

  // Windshield (wrapping round the corners), sign band, gasket; rear window & engine louvres
  const frontGlass = roundedRect(vec2(p.x, p.y.sub(1.82)), vec2(1.2, 0.58), 0.14).mul(smoothstep(0.012, 0.024, ax)).mul(front);
  const frontSeal = roundedRect(vec2(p.x, p.y.sub(1.82)), vec2(1.24, 0.62), 0.16).mul(front);
  const signBand = roundedRect(vec2(p.x, p.y.sub(2.55)), vec2(1.02, 0.16), 0.04).mul(front);
  const rearGlass = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.92, 0.36), 0.08).mul(rear);
  const rearSeal = roundedRect(vec2(p.x, p.y.sub(2.06)), vec2(0.96, 0.4), 0.1).mul(rear);
  const louvres = roundedRect(vec2(p.x, p.y.sub(0.98)), vec2(0.78, 0.34), 0.05).mul(rear);
  const slats = step(0.5, fract(p.y.mul(16.0))).mul(0.45).add(0.4);

  // Side window band with mullions; driver's window; curb-side doors (glazed leaves, frames)
  const [wy0, wy1] = s.window;
  const winMid = (wy0 + wy1) / 2;
  const winHalf = (wy1 - wy0) / 2;
  const sideBand = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.82, winHalf), 0.08).mul(side);
  const mullion = smoothstep(0.03, 0.045, abs(fract(p.z.mul(0.8).add(0.35)).sub(0.5).mul(1.25)));
  const sideSeal = roundedRect(vec2(p.z.add(0.5), p.y.sub(winMid)), vec2(4.86, winHalf + 0.04), 0.1).mul(side);
  const driverWin = roundedRect(vec2(p.z.sub(4.86), p.y.sub(winMid + 0.04)), vec2(0.5, winHalf + 0.04), 0.1).mul(side).mul(one.sub(curb));
  const door = (z0: number, z1: number) => {
    const zc = (z0 + z1) / 2;
    const hw = (z1 - z0) / 2;
    const frame = roundedRect(vec2(p.z.sub(zc), p.y.sub(1.44)), vec2(hw, 1.0), 0.05);
    const leaves = roundedRect(vec2(abs(p.z.sub(zc)).sub(hw * 0.5), p.y.sub(1.5)), vec2(hw * 0.4, 0.84), 0.035);
    return { frame: frame.mul(side).mul(curb), glass: leaves.mul(side).mul(curb) };
  };
  const d0 = door(s.frontDoor[0], s.frontDoor[1]);
  const d1 = door(s.rearDoor[0], s.rearDoor[1]);
  const doorFrame = max(d0.frame, d1.frame);
  const glass = clamp(max(max(frontGlass, rearGlass), max(max(sideBand.mul(mullion), driverWin), max(d0.glass, d1.glass))), 0.0, 1.0);
  const seal = clamp(max(max(frontSeal, rearSeal), max(max(sideSeal, signBand), doorFrame)), 0.0, 1.0);

  // The route's livery: its colour, the trim colour below the windows and in a pinstripe above them
  const shadeY = smoothstep(0.34, 1.2, p.y).mul(0.2).add(0.8);
  const lowerBody = smoothstep(1.2, 1.17, p.y);
  const pinstripe = smoothstep(2.47, 2.49, p.y).mul(smoothstep(2.55, 2.53, p.y)).mul(side);
  const skirt = smoothstep(0.53, 0.5, p.y);
  const livery = mix(mix(paint, trim, max(lowerBody, pinstripe)), color(0x1c2026), skirt).mul(shadeY);

  // Lamps: twin round headlamps & amber turn signals in black pods; red tail / brake light columns, amber turn &
  // white reverse lamps at the rear corners; plates
  const pod = roundedRect(vec2(ax.sub(0.86), p.y.sub(0.8)), vec2(0.27, 0.085), 0.06).mul(front);
  const headLamp = max(
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.72), p.y.sub(0.8)))),
    smoothstep(0.05, 0.04, length(vec2(ax.sub(0.86), p.y.sub(0.8))))
  ).mul(pod);
  const turnFront = smoothstep(0.045, 0.035, length(vec2(ax.sub(1.02), p.y.sub(0.8)))).mul(pod);
  const tailCol = roundedRect(vec2(ax.sub(1.04), p.y.sub(0.92)), vec2(0.075, 0.27), 0.05).mul(rear);
  const tailLamp = tailCol.mul(smoothstep(0.93, 0.95, p.y));
  const turnRear = tailCol.mul(smoothstep(0.92, 0.9, p.y)).mul(smoothstep(0.76, 0.78, p.y));
  const reverse = tailCol.mul(smoothstep(0.75, 0.73, p.y));
  const plate = roundedRect(vec2(p.x, p.y.sub(0.77)), vec2(0.16, 0.06), 0.008).mul(max(front.mul(step(ax, 0.3)), rear));

  let body = mix(livery, color(0x15191e), seal);
  body = mix(body, color(0x1a1e23).mul(slats), louvres);
  body = mix(body, color(0x111418), pod);
  body = mix(body, mix(color(0xdcefff), color(0xffa21a), turnFront), max(headLamp, turnFront));
  body = mix(body, color(0x9a0d14), tailLamp);
  body = mix(body, color(0xc8641a), turnRear);
  body = mix(body, color(0xe8eef2), reverse);
  body = mix(body, color(0xf2b718), plate);
  const glassTint = mix(color(0x0e1a26), color(0x1b3046), clamp(p.y.sub(1.3).mul(0.8), 0.0, 1.0));
  body = mix(body, glassTint, glass);

  const col = mix(mix(body, color(0x1b1f24), isTrim), color(0xc9ced3), isPod);

  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = col;
  mat.roughnessNode = mix(mix(mix(float(0.3), float(0.16), max(glass, max(headLamp, tailCol))), float(0.7), max(isTrim, seal.mul(one.sub(glass)))), float(0.45), isPod);
  mat.metalnessNode = mix(mix(float(0.22), float(0.7), glass), float(0.05), max(isTrim, isPod));

  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xd9efff)
    .mul(pod.mul(0.45).add(headLamp.mul(1.35)))
    .mul(nightHeadlamp)
    .add(color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.0)))
    .add(color(0xff0a12).mul(tailLamp.mul(brake.mul(1.5).add(0.75))));

  _busLoftedMats.set(liveries, mat);
  return mat;
}
