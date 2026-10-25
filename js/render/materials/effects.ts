import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  color,
  attribute,
  normalView,
  uv,
  sin,
  atan,
  clamp,
  mix,
  smoothstep,
  length
} from 'three/tsl';
import { _transparentEffectMRT } from './shared.ts';

// js/render/materials/effects.ts
// The effects' materials: pools of blood and smoke puffs.

/**
 * A pool of blood on the ground (sim/blood.ts; an instanced flat quad grown to its size): dark wet red spreading from
 * the quad's middle to an uneven rim (three ripples round it, phased by the instance's `bloodSeed`), darkest and
 * glossiest where it is deep, thinning out at the rim; over the road or the walk like the paint, their G-buffer kept
 */
export function createBloodPoolMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    transparent: true, depthWrite: false, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 // (over the road's own decals)
  });
  mat.mrtNode = _transparentEffectMRT;
  const seed = attribute('bloodSeed', 'float');
  const p = uv().sub(0.5).mul(2.0);
  const r = length(p);
  const a = atan(p.y, p.x);
  const rim = float(0.7)
    .add(sin(a.mul(3.0).add(seed.mul(6.283))).mul(0.1))
    .add(sin(a.mul(7.0).add(seed.mul(17.0))).mul(0.06))
    .add(sin(a.mul(13.0).add(seed.mul(29.0))).mul(0.035));
  const deep = smoothstep(rim, rim.mul(0.35), r);
  mat.colorNode = mix(color(0x6a0c0a), color(0x360305), deep);
  mat.opacityNode = smoothstep(rim, rim.sub(0.05), r).mul(0.93);
  // (wet, but not a mirror: a glossier pool only shows the sky's reflection, near black under a dark one)
  mat.roughnessNode = mix(float(0.42), float(0.2), deep);
  return mat;
}

// Smoke puffs (the player's car, controllers.ts): soft balls, thick where they face the camera and fading to nothing
// at their rims, so a sphere reads as a cloud; their grey comes from the instance colour
export function createSmokeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  mat.opacityNode = Fn(() => {
    const facing = clamp(normalView.z, 0.0, 1.0);
    return facing.mul(facing).mul(facing).mul(0.5);
  })();
  return mat;
}
