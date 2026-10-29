import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  color,
  attribute,
  abs,
  fract,
  mix,
  step,
  time,
  instanceIndex
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { part } from './loft.ts';
import { CAR_PARTS, BODY_SPECS } from './car-specs.ts';
import { lerp, carLayout } from './car-body.ts';
import { roundedBox } from './car-geometry.ts';
import type { BodySpec } from '../../models/bodies.ts';

// js/actors/vehicles/lightbar.ts
// The police cars' roof light bar: its geometry for a body's roof and its flashing red & blue material.

// NYPD roof light bar (red on the -x half, blue on the +x half) for a body spec's roof, lit by createLightbarMaterial
export function buildLightbarGeometry(spec: BodySpec = BODY_SPECS.sedan): THREE.BufferGeometry {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, 0.32);
  const c = L.cabin(z);
  const y = c.railY + c.h;
  const bar = roundedBox(0.13, 0.045, 1.12, 0.04, 0.02).rotateY(Math.PI / 2).translate(0, y + 0.075, z);
  const parts = [part(bar, CAR_PARTS.SIGN)];
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.16).translate(side * 0.42, y + 0.02, z), CAR_PARTS.TRIM));
  }
  return mergeGeometries(parts);
}

const _lightbarMats = new Map<boolean, THREE.MeshStandardNodeMaterial>();

// Light bar lenses: red & blue halves flashing in alternation (double strobes), each car on its own phase; `lit` false:
// switched off, the lenses dark (a patrol car going about its round, no call on)
export function createLightbarMaterial(lit = true): THREE.MeshStandardNodeMaterial {
  const made = _lightbarMats.get(lit);
  if (made) return made;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.1 });
  const lightbar = () => {
    const p = attribute('position', 'vec3');
    const partId = attribute('partId', 'float');
    const isLens = step(abs(partId.sub(CAR_PARTS.SIGN)), 0.25);
    const phase = fract(float(instanceIndex).mul(0.61803)).toVar();
    const t = fract(time.mul(1.6).add(phase)).toVar();
    const strobe = step(0.5, fract(t.mul(6.0)));
    const redOn = step(t, 0.5).mul(strobe);
    const blueOn = step(0.5, t).mul(strobe);
    const isRed = step(p.x, -0.035);
    const isBlue = step(0.035, p.x);
    return { isLens, redOn, blueOn, isRed, isBlue };
  };
  mat.colorNode = Fn(() => {
    const s = lightbar();
    const lens = mix(mix(color(0xd8dde2), color(0x8a0d12), s.isRed), color(0x0f3c9a), s.isBlue);
    return mix(color(0x15181b), lens, s.isLens);
  })();
  if (lit) {
    mat.emissiveNode = Fn(() => {
      const s = lightbar();
      return color(0xff1a22).mul(s.isRed.mul(s.redOn).mul(6.0)).add(color(0x2a6cff).mul(s.isBlue.mul(s.blueOn).mul(7.0))).mul(s.isLens);
    })();
  }
  _lightbarMats.set(lit, mat);
  return mat;
}
