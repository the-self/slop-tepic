import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  color,
  attribute,
  positionLocal,
  positionWorld,
  cameraPosition,
  uv,
  sin,
  cos,
  abs,
  floor,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  length,
  pow,
  fwidth,
  specularColor,
  specularColorBlended,
  specularF90
} from 'three/tsl';
import {
  cityUniforms,
  hash2D,
  noise2D,
  bumpNormal,
  lineAA,
  gridLine,
  canyonSkyAONode,
  _transparentEffectMRT
} from './shared.ts';
import type { Node } from 'three/webgpu';

// js/render/materials/parks.ts
// The parks' & plazas' materials: paving, lamp globes & their pools of light, tree grates, lawns and pitches.

// Pointy-top hexagon cell of p (in hex units): x = distance to the cell edge (0 at the joint .. 0.5 at the centre),
// yz = cell id
const hexCell = Fn(([p]: [Node<'vec2'>]) => {
  const pv = vec2(p).toVar();
  const r = vec2(1.0, 1.7320508);
  const h = vec2(0.5, 0.8660254);
  const a = mod(pv, r).sub(h).toVar();
  const b = mod(pv.sub(h), r).sub(h).toVar();
  const gv = mix(b, a, step(dot(a, a), dot(b, b))).toVar();
  const q = abs(gv);
  const edge = float(0.5).sub(max(dot(q, vec2(0.5, 0.8660254)), q.x));
  return vec3(edge, pv.sub(gv));
});

// Joint mask (1 in the joints) of the park / plaza paving style at world xz
const pavingJoints = Fn(([style, wx, wz]: [Node<'float'>, Node<'float'>, Node<'float'>]) => {
  const hex = hexCell(vec2(wx, wz).div(0.21));
  const hexAA = fwidth(hex.x).max(0.0001);
  const hexJoint = smoothstep(hexAA.add(0.035), float(0.035).sub(hexAA), hex.x);
  const offG = mod(floor(wz.div(0.45)), 2.0).mul(0.45);
  const granJoint = max(gridLine(wx.add(offG), 0.9, 0.01), gridLine(wz, 0.45, 0.01));
  const blueJoint = max(gridLine(wx, 0.6, 0.012), gridLine(wz, 0.6, 0.012));
  const isGranite = step(0.5, style).mul(float(1.0).sub(step(1.5, style)));
  return mix(mix(hexJoint, granJoint, isGranite), blueJoint, step(1.5, style));
});

/**
 * Park Paths & Pedestrian Plaza Paving TSL Material: one shared material (one batched draw call) whose
 * paving style is picked per mesh through its uv.x:
 * - 0: Hexagonal asphalt paver blocks (charcoal 8-inch hexes with sanded joints)
 * - 1: Light-grey granite plaza pavers in running bond with scattered dark pavers
 * - 2: Bluestone & granite square slabs (fountain & monument plazas)
 */
export function createParkPavingMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.86
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const style = uv().x;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(170.0, 12.0, camDist);
    const grime = noise2D(vec2(wx.mul(0.35), wz.mul(0.35)));
    const grit = noise2D(vec2(wx.mul(13.0), wz.mul(13.0))).sub(0.5).mul(0.06).mul(detail);
    const joints = pavingJoints(style, wx, wz).mul(detail);

    // 0: charcoal hex asphalt pavers with per-block tone
    const hexTone = hash2D(hexCell(vec2(wx, wz).div(0.21)).yz);
    const hexCol = mix(color(0x41413e), color(0x5c5b57), hexTone);

    // 1: granite running bond, 15% darker pavers
    const rowG = floor(wz.div(0.45));
    const idG = vec2(floor(wx.add(mod(rowG, 2.0).mul(0.45)).div(0.9)), rowG);
    const granCol = mix(
      mix(color(0x9d9c95), color(0xbab9b1), hash2D(idG)),
      color(0x6a6964),
      step(0.85, hash2D(idG.add(vec2(17.3, 5.1))))
    );

    // 2: bluestone squares
    const blueCol = mix(color(0x62686d), color(0x878b8c), hash2D(floor(vec2(wx, wz).div(0.6))));

    const isGranite = step(0.5, style).mul(float(1.0).sub(step(1.5, style)));
    const base = mix(mix(hexCol, granCol, isGranite), blueCol, step(1.5, style));
    return base.mul(grime.mul(0.18).add(0.91)).add(grit).mul(float(1.0).sub(joints.mul(0.42)));
  })();

  mat.roughnessNode = Fn(() => {
    const style = uv().x;
    return mix(mix(float(0.9), float(0.72), step(0.5, style)), float(0.78), step(1.5, style));
  })();

  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(110.0, 10.0, camDist);
    const grain = noise2D(vec2(wx.mul(5.0), wz.mul(5.0))).sub(0.5).mul(0.0025);
    return bumpNormal(grain.sub(pavingJoints(uv().x, wx, wz).mul(0.006)).mul(detail));
  })();

  return mat;
}

/**
 * Park Lamppost Glass Globe: milky white by day, warm glow (bloom) at dusk & night.
 */
export function createParkLampGlobeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: 0xece8dc,
    roughness: 0.35,
    metalness: 0.0
  });
  mat.emissiveNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    return color(0xffd6a0).mul(night.mul(2.6).add(0.05));
  })();
  return mat;
}

/**
 * Warm pool of lamplight on the paving under a park lamppost: additive, depth-tested flat decal (uv radial falloff),
 * fading in with the dusk/night interior-glow uniform and fully off by day.
 */
export function createParkLampPoolMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.colorNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    const r = length(uv().sub(0.5)).mul(2.0);
    const falloff = pow(clamp(float(1.0).sub(r), 0.0, 1.0), 2.2);
    return color(0xffc890).mul(falloff.mul(night).mul(0.32));
  })();
  mat.opacityNode = float(1.0);
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the walks & lawns underneath
  return mat;
}

/**
 * Concentric Cast-Iron Sidewalk Tree Pit Grate TSL Material (ported from StreetTreeGenerator.js)
 */
export function createTreeGrateMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.45,
    roughness: 0.68
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const r = length(positionLocal.xz);
    const concentricSlots = smoothstep(0.35, 0.52, fract(r.mul(11.0)));
    const radialRibs = smoothstep(0.25, 0.45, abs(sin(positionLocal.x.mul(14.0)).mul(cos(positionLocal.z.mul(14.0)))));
    return mix(color(0x141312), color(0x3b3936), max(concentricSlots, radialRibs));
  })();

  return mat;
}

/**
 * Park Lush Multi-Octave Turf, Clover & Mowing Stripes TSL Material
 */
export function createParkLawnMaterial(isMeadow = false) {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.86
  });

  const cGrassDeep = color(isMeadow ? 0x2e5226 : 0x224c20);
  const cGrassMid = color(isMeadow ? 0x41692f : 0x36682c);
  const cGrassSun = color(isMeadow ? 0x587d36 : 0x6b9c3e);

  mat.colorNode = Fn(() => {
    const wp = positionWorld.xz;
    const macroPatch = noise2D(wp.mul(0.06));
    const midClover = noise2D(wp.mul(0.35));
    const microBlade = noise2D(wp.mul(3.8));
    const mowStripe = sin(wp.x.mul(0.55).add(wp.y.mul(0.25))).mul(0.5).add(0.5);

    const baseLawn = mix(
      cGrassDeep,
      cGrassMid,
      macroPatch.mul(0.45).add(midClover.mul(0.35)).add(mowStripe.mul(0.20))
    );
    const lawn = mix(baseLawn, cGrassSun, microBlade.mul(0.38));
    // the dry season browns the open country's grass; the parks are watered, so only a little
    const dry = cityUniforms.uDryness.mul(isMeadow ? 0.85 : 0.3).mul(macroPatch.mul(0.6).add(0.55)).min(1.0);
    return mix(lawn, mix(color(0x9a8a52), color(0xb9a468), microBlade), dry);
  })();

  mat.normalNode = Fn(() => {
    const wp = positionWorld.xz;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(85.0, 10.0, camDist);
    const turf = noise2D(wp.mul(7.5)).sub(0.5).mul(0.008);
    return bumpNormal(turf.mul(detail));
  })();

  // Grass is a canopy of blades that shadow each other, not a flat dielectric: at grazing angles a plain F0 = 0.04 /
  // F90 = 1 Fresnel mirrors the sky and turns lawns teal, so weaken the specular and cap its grazing rise
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };

  return mat;
}

/**
 * A sports pitch of OpenStreetMap (city-grid.ts): a football field's mown grass in stripes along its length with its
 * white lines, or (`court` > 0.5) a concrete court painted green & red with a basketball court's lines. uv run 0..1
 * along & across; the `dims` attribute is its length & width (m) and whether it is a court. The lines scale with the
 * field (a fútbol rápido pitch is a third of a stadium's), the goal mouths & centre spot are worn to the earth.
 */
export function createPitchMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.85 });
  const dims = attribute('dims', 'vec3'); // length, width, court
  mat.colorNode = Fn(() => {
    const L = dims.x, W = dims.y, court = step(0.5, dims.z);
    const u = uv().x.sub(0.5).mul(L), v = uv().y.sub(0.5).mul(W); // metres from the centre spot, along & across
    const k = min(L.div(105.0), W.div(68.0)).max(0.25); // the field's scale against a stadium's
    const au = abs(u), av = abs(v);
    const lw = max(k.mul(0.06), 0.05); // half a line's width
    const hl = L.mul(0.5).sub(0.4), hw = W.mul(0.5).sub(0.4); // the touch & goal lines, just in from the edge
    // football: touch & goal lines, halfway line & circle, penalty & goal areas, the spots
    const boxD = k.mul(16.5), boxW = k.mul(20.15), goalD = k.mul(5.5), goalW = k.mul(9.16), r = k.mul(9.15);
    const outline = max(lineAA(au.sub(hl), lw).mul(step(av, hw.add(lw))), lineAA(av.sub(hw), lw).mul(step(au, hl.add(lw))));
    const halfway = lineAA(u, lw).mul(step(av, hw));
    const circle = lineAA(length(vec2(u, v)).sub(r), lw);
    const box = (d: Node<'float'>, w: Node<'float'>) => max(lineAA(au.sub(hl.sub(d)), lw).mul(step(av, w)), lineAA(av.sub(w), lw).mul(step(hl.sub(d), au)).mul(step(au, hl)));
    const spots = smoothstep(lw.mul(2.5), lw.mul(1.5), length(vec2(au.sub(hl.sub(k.mul(11.0))), v))).max(smoothstep(lw.mul(2.5), lw.mul(1.5), length(vec2(u, v))));
    const football = max(max(max(outline, halfway), max(circle, box(boxD, boxW))), max(box(goalD, goalW), spots));
    // basketball: outline, centre line & circle, the keys & three-point arcs at each end
    const key = max(lineAA(au.sub(hl.sub(5.8)), lw).mul(step(av, 2.45)), lineAA(av.sub(2.45), lw).mul(step(hl.sub(5.8), au)).mul(step(au, hl)));
    const arc = lineAA(length(vec2(au.sub(hl.sub(1.6)), v)).sub(min(6.75, hw.sub(0.3))), lw).mul(step(au, hl.sub(1.6)));
    const basket = max(max(outline, halfway), max(max(lineAA(length(vec2(u, v)).sub(1.8), lw), key), arc));

    const p = positionWorld.xz;
    const grain = noise2D(p.mul(3.0));
    const stripes = step(0.5, fract(u.div(k.mul(5.5).max(2.0)))); // mown in bands across the length
    let turf = mix(mix(color(0x4f7a2c), color(0x5f8c34), stripes), color(0x6e9a3e), grain.mul(0.35));
    turf = mix(turf, mix(color(0xa3925a), color(0xb6a36a), grain), cityUniforms.uDryness.mul(0.8));
    // the goal mouths & the centre circle worn to the earth
    const worn = max(smoothstep(k.mul(7.0), k.mul(2.0), length(vec2(au.sub(hl.sub(k.mul(3.0))), v))), smoothstep(k.mul(6.0), 0.0, length(vec2(u, v))).mul(0.7))
      .mul(noise2D(p.mul(0.5)).mul(0.6).add(0.5)).min(1.0);
    turf = mix(turf, mix(color(0x86684b), color(0x9b7b59), grain), worn);
    const slab = mix(mix(color(0x3f6e55), color(0x47785c), grain), color(0x9a4436), step(hw.sub(2.0), av).max(step(hl.sub(1.2), au)));
    const surface = mix(turf, slab, court);
    return mix(surface, color(0xf2f1ea), mix(football, basket, court).mul(0.92));
  })();
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.03));
    specularColorBlended.assign(vec3(0.03));
    specularF90.assign(0.35);
  };
  return mat;
}
