import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec4,
  color,
  attribute,
  varying,
  positionGeometry,
  positionWorld,
  normalWorldGeometry,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  screenSize,
  abs,
  floor,
  fract,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  cross,
  length,
  normalize,
  fwidth
} from 'three/tsl';
import { cityUniforms, noise2D, gridLine, canyonSkyAONode, _transparentEffectMRT } from './shared.ts';
import type { Node } from 'three/webgpu';

// js/render/materials/structures.ts
// The built works' materials: overhead wires, the overpasses' concrete & the earth under them, the railway's bed.

/**
 * Overhead wires (js/world/street-details.ts: the CFE's lines and the cables to the houses): ribbons whose two edges
 * share the centreline's points, `wire` = (unit tangent, signed half-width in metres). The vertex shader turns each
 * ribbon to face the camera and widens it to at least ~1.5 px, fading it to match (phone-wire AA, as the road paint),
 * so a 2 cm cable stays a steady hairline at any distance; it fades out by WIRE_FADE m (the cells beyond are hidden).
 */
export const WIRE_FADE = 420;
export function createWireMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.mrtNode = _transparentEffectMRT;
  const wire = attribute('wire', 'vec4');
  const side = normalize(cross(wire.xyz, cameraPosition.sub(positionGeometry))).mul(wire.w);
  const widen = Fn(() => {
    const viewProjection = cameraProjectionMatrix.mul(cameraViewMatrix);
    const edge = viewProjection.mul(vec4(positionGeometry.add(side), 1.0));
    const centre = viewProjection.mul(vec4(positionGeometry, 1.0));
    const halfWidthPx = length(edge.xy.div(edge.w).sub(centre.xy.div(centre.w)).mul(screenSize).mul(0.5));
    const inFront = step(0.05, min(edge.w, centre.w));
    return clamp(float(0.75).div(max(halfWidthPx, 0.001)), 1.0, 12.0).mul(inFront).max(1.0);
  })();
  mat.positionNode = positionGeometry.add(side.mul(widen));
  const far = smoothstep(float(WIRE_FADE), float(WIRE_FADE * 0.8), length(positionWorld.sub(cameraPosition)));
  mat.opacityNode = varying(float(0.95).div(widen)).mul(far);
  mat.colorNode = color(0x1d1d1f);
  return mat;
}

/**
 * Cast Concrete for the overpasses' decks, walls & piers (js/world/bridges.ts): board-formed tone that varies by the
 * pour, faint 1.2 m form-tie lines on the walls, and run-off streaks darkening down from the deck's edge, wetter in rain
 */
export function createBridgeConcreteMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.86 });
  mat.aoNode = canyonSkyAONode();
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const detail = smoothstep(220.0, 20.0, length(p.sub(cameraPosition)));
    const pour = noise2D(vec2(p.x.add(p.z).mul(0.07), p.y.mul(0.3)));
    const grain = noise2D(vec2(p.x.add(p.z).mul(3.1), p.y.mul(3.1))).sub(0.5).mul(0.07).mul(detail);
    const base = mix(color(0x8d8a83), color(0xa7a39a), pour).add(grain);
    // walls only: horizontal form joints & vertical streaks from the parapet down
    const wall = float(1.0).sub(smoothstep(0.4, 0.8, abs(normalWorldGeometry.y)));
    const joints = gridLine(p.y, 1.2, 0.03).mul(detail).mul(wall);
    const streak = smoothstep(0.55, 0.9, noise2D(vec2(p.x.add(p.z).mul(1.7), p.y.mul(0.12)))).mul(wall);
    const wetFilm = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness);
    return base.mul(float(1.0).sub(joints.mul(0.25))).mul(float(1.0).sub(streak.mul(0.22))).mul(mix(float(1.0), float(0.74), wetFilm));
  })();
  mat.roughnessNode = mix(float(0.86), float(0.55), smoothstep(0.2, 0.8, cityUniforms.uRoadWetness));
  return mat;
}

/**
 * Bare Earth under the overpasses' spans (js/world/bridges.ts): packed dry dirt with gravel, darker in patches where
 * the run-off from the deck's drains has soaked it, so the town's asphalt doesn't run on under a bridge
 */
export function createUnderpassEarthMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.97 });
  mat.aoNode = canyonSkyAONode();
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const detail = smoothstep(120.0, 10.0, length(p.sub(cameraPosition)));
    const soil = mix(color(0x8f7a5e), color(0xab9474), noise2D(p.xz.mul(0.09))); // (light: it lies in the deck's shade)
    const gravel = mix(float(0.5), noise2D(p.xz.mul(7.0)), detail).sub(0.5).mul(0.16);
    const damp = smoothstep(0.62, 0.8, noise2D(p.xz.mul(0.045)));
    return soil.add(gravel).mul(mix(float(1.0), float(0.72), damp));
  })();
  return mat;
}

/**
 * Railway Track Bed: crushed-stone ballast with concrete sleepers every 0.6 m (box-filtered over the pixel footprint so
 * they settle to a mean far off instead of shimmering). attribute `track` = (metres along the line, metres across it)
 */
export function createTrackBedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.95 });
  mat.aoNode = canyonSkyAONode();
  const track = attribute('track', 'vec2');
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const detail = smoothstep(120.0, 10.0, length(p.sub(cameraPosition)));
    const stones = mix(float(0.5), noise2D(p.xz.mul(9.0)), detail);
    const ballast = mix(color(0x4f4a43), color(0x7a736a), stones.mul(0.7).add(noise2D(p.xz.mul(0.4)).mul(0.3)));
    // sleepers: on for 0.26 m of each 0.6 m, 2.6 m long across the line (exact box filter of the on/off pattern)
    const t = track.x.div(0.6);
    const fw = max(fwidth(t), 0.0001);
    const on = (x: Node<'float'>) => floor(x).mul(0.43).add(clamp(fract(x), 0.0, 0.43));
    const sleepers = on(t.add(fw.mul(0.5))).sub(on(t.sub(fw.mul(0.5)))).div(fw);
    const across = smoothstep(1.3, 1.25, abs(track.y)).mul(step(0.0, normalWorldGeometry.y.sub(0.9)));
    const sleeper = mix(color(0x5e5a54), color(0x6f6b64), noise2D(p.xz.mul(2.0))); // weathered concrete
    return mix(ballast, sleeper, sleepers.mul(across));
  })();
  return mat;
}
