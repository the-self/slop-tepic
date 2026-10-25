import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec4,
  uniform,
  varying,
  positionWorld,
  positionView,
  normalView,
  sin,
  abs,
  floor,
  fract,
  min,
  max,
  clamp,
  mix,
  smoothstep,
  dot,
  fwidth,
  texture,
  mrt,
  select
} from 'three/tsl';
import { townGrid } from '../../world/ground.ts';
import type { Node } from 'three/webgpu';

// js/render/materials/shared.ts
// The shared pieces of the city's TSL materials: the live uniforms the lighting and the time of day drive
// (cityUniforms), the hash & value noise, the bump-mapping and anti-aliased line helpers, the town floor's height,
// the street canyon's sky occlusion, and the MRT that keeps the G-buffer under transparent decals & effects.

// Shared live uniforms controlled by lighting / time-of-day presets
export const cityUniforms = {
  uSunColor: uniform(new THREE.Color(0xffca92)),
  uSkyTopColor: uniform(new THREE.Color(0x2c568c)),
  uSkyHorizonColor: uniform(new THREE.Color(0xebd1b5)),
  uSkySunDir: uniform(new THREE.Vector3(-0.66, 0.34, -0.67).normalize()),
  uInteriorGlow: uniform(0.78),
  uRoadWetness: uniform(0.38),
  uCanyonBounce: uniform(0.52),
  // How dry the grass is, 0 green (the rains, June-October) .. 1 straw (April-May): lot-greenery.ts grassDryness of
  // the month shown, set by main.ts
  uDryness: uniform(0.1),
  // The town's hour (0-24) and a running clock (s), set by main.ts: who is home with the light on, which shops have
  // their shutters up, the people moving about in the rooms (createMexicanHouseMaterial)
  uHour: uniform(14),
  uClock: uniform(0)
};
export type CityUniforms = typeof cityUniforms;

// Fast deterministic 2D -> 1D hash in TSL
export const hash2D = Fn(([p]: [Node<'vec2'>]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Smooth 2D value noise in TSL
export const noise2D = Fn(([p]: [Node<'vec2'>]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i);
  const b = hash2D(i.add(vec2(1.0, 0.0)));
  const c = hash2D(i.add(vec2(0.0, 1.0)));
  const d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Mikkelsen's Surface-Gradient Hardware Derivative Bump Mapping (ported from CityGeneratorUtils.js)
 * Wrapped in Fn() so `height` is evaluated once into a scalar parameter before dFdx/dFdy!
 */
export const bumpNormal = Fn(([height]: [Node<'float'>]) => {
  const h = float(height).toVar();
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
  return det.abs().mul(normalView).sub(grad).normalize();
});

/**
 * Filter-Width Anti-Aliased Filled Band (ported from CityGenerator.js)
 * Wrapped in Fn() so NodeBuilder emits a single WGSL function instead of inlining fwidth trees.
 */
export const lineAA = Fn(([coord, halfWidth]: [Node<'float'>, Node<'float'>]) => {
  const c = float(coord).toVar();
  const hw = float(halfWidth).toVar();
  const aa = fwidth(c).max(0.0001).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), abs(c));
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Filter-Width Anti-Aliased Repeating Grid Line (ported from CityGenerator.js & SidewalkGenerator.js)
 */
export const gridLine = Fn(([coord, period, halfWidth]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const p = float(period).toVar();
  const g = float(coord).div(p).toVar();
  const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
  const aa = fwidth(g).max(0.0001).toVar();
  const hw = float(halfWidth).div(p).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Box-Filtered Periodic Pulse: fraction of a footprint `w` wide around `x` where fract() lies in [a, b].
 * Exact anti-aliasing that settles to the mean coverage (b - a) once a period shrinks below a pixel, so facade grids
 * don't shimmer or moiré at distance & grazing angles. Pass the in-cell coordinate (fract) for precision.
 */
export const filteredPulse = Fn(([x, a, b, w]: [Node<'float'>, Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t: Node<'float'>) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

/**
 * The height of the town's floor under a world (x, z), for shading by the height over the ground: ground.ts's grid as a
 * half-float texture (to ~0.2 m), its four nodes around (x, z) read as they are and blended on the same triangles the
 * ground is (each cell split from its +x corner to its +z corner), the floor beyond it; 0 in the flat city (?slopes=0)
 */
export const townFloorNode: (xz: Node<'vec2'>) => Node<'float'> = (() => {
  if (!townGrid) return () => float(0.0);
  const { x0, z0, cell, w, h, heights } = townGrid;
  const half = new Uint16Array(w * h);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const tex = new THREE.DataTexture(half, w, h, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const size = vec2(w, h);
  return (xz: Node<'vec2'>) => {
    const f = xz.sub(vec2(x0, z0)).div(cell); // in cells from the grid's first node
    const ij = floor(f);
    const t = f.sub(ij);
    const node = (di: number, dj: number) => texture(tex, ij.add(vec2(di + 0.5, dj + 0.5)).div(size)).r;
    const h00 = node(0, 0), h10 = node(1, 0), h01 = node(0, 1), h11 = node(1, 1);
    const near = h00.add(h10.sub(h00).mul(t.x)).add(h01.sub(h00).mul(t.y));
    const far = h11.add(h01.sub(h11).mul(float(1.0).sub(t.x))).add(h10.sub(h11).mul(float(1.0).sub(t.y)));
    return select(t.x.add(t.y).lessThanEqual(1.0), near, far);
  };
})();

/**
 * Occlusion-Aware Street Canyon Sky Visibility (aoNode)
 * Models how street canyons occlude overhead sky irradiance near the street floor (0..65 m over the ground), opening
 * up on upper floors.
 */
export const canyonSkyAONode = Fn(() => {
  const wp = positionWorld;
  // over the ground (the town's slopes): its floor found once a vertex, linear across the ground's triangles
  const y = townGrid ? wp.y.sub(varying(townFloorNode(wp.xz))) : wp.y;
  const heightOpenness = smoothstep(0.0, 68.0, y);
  const streetCrevice = smoothstep(0.0, 7.5, y).mul(0.22).add(0.78);
  return mix(float(0.44), float(1.0), heightOpenness).mul(streetCrevice);
});

// Transparent decal/effect planes & sprites preserve the underlying road/scene G-buffer in MRT (zero RGB & zero alpha on normal & metalRough)
export const _transparentEffectMRT = mrt({
  normal: vec4(0.0, 0.0, 0.0, 0.0),
  metalRough: vec4(0.0, 0.0, 0.0, 0.0)
});
