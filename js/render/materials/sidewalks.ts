import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  color,
  positionWorld,
  normalWorldGeometry,
  cameraPosition,
  uv,
  abs,
  floor,
  fract,
  mod,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  normalize,
  pow,
  sign,
  fwidth
} from 'three/tsl';
import { cityUniforms, hash2D, noise2D, bumpNormal, lineAA, gridLine, canyonSkyAONode } from './shared.ts';
import { roadWetMasks } from './roads.ts';

// js/render/materials/sidewalks.ts
// The walks' materials: sidewalk flags, curbs and cycleways.

/**
 * Concrete Sidewalk Flagstones with Filter-Width Anti-Aliased 1.5m Scored Expansion Joints,
 * -12mm `bumpNormal` Groove Relief, Per-Flag Tone Variation & Post-Rain Damp Patches
 * that follow cityUniforms.uRoadWetness like the roadway (better drained: fewer, smaller pools)
 * (Ported from SidewalkGenerator.js)
 */
export function createSidewalkMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.0,
    roughness: 0.88
  });

  const cConcreteA = color(0x8e8d85);
  const cConcreteB = color(0x73726b);

  // Damp patches & pools on the flags, shared by every channel below (own field; drains better than the roadway)
  const swField = noise2D(vec2(positionWorld.x.mul(0.14).add(7.4), positionWorld.z.mul(0.14).sub(13.1))).mul(0.65)
    .add(noise2D(vec2(positionWorld.x.mul(0.38), positionWorld.z.mul(0.38))).mul(0.35));
  const swWet = roadWetMasks(swField, 0.06);
  const swPuddle = swWet.y.mul(smoothstep(0.5, 0.9, normalWorldGeometry.y));
  const swFresnel = pow(float(1.0).sub(clamp(normalize(cameraPosition.sub(positionWorld)).y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  const pixelSize = length(fwidth(positionWorld.xz));

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(190.0, 16.0, camDist);

    const panel = 1.5; // 1.5 m concrete sidewalk flags
    const panelHash = hash2D(floor(vec2(wx.div(panel), wz.div(panel))));
    const tone = noise2D(vec2(wx.mul(0.48), wz.mul(0.48)));
    const grit = noise2D(vec2(wx.mul(14.0), wz.mul(14.0))).sub(0.5).mul(0.08).mul(detail).mul(smoothstep(0.07, 0.02, pixelSize));

    // Filter-width anti-aliased 1.5m scored joints
    const joints = max(gridLine(wx, panel, 0.042), gridLine(wz, panel, 0.042)).mul(detail);

    // Post-rain damp patches, pools & the overall wet film darken the flags
    const baseConcrete = mix(cConcreteB, cConcreteA, tone)
      .mul(panelHash.sub(0.5).mul(0.16).add(1.0))
      .add(grit)
      .mul(mix(float(1.0), float(0.72), max(swWet.x, swPuddle)))
      .mul(mix(float(1.0), float(0.8), swWet.z));

    // the centro's sidewalks (within ~620 m of the Plaza Principal): terracotta brick pavers in running bond,
    // 30 x 15 cm, their colour varying brick by brick, darker in the wet like the flags
    const centro = smoothstep(700.0, 580.0, length(positionWorld.xz));
    const course = floor(wz.div(0.15));
    const shift = mod(course, 2.0).mul(0.15);
    const brickTone = hash2D(vec2(floor(wx.add(shift).div(0.3)), course));
    const mortar = max(gridLine(wz, 0.15, 0.008), gridLine(wx.add(shift), 0.3, 0.008)).mul(detail);
    const brick = mix(color(0x8a4636), color(0xa9604a), brickTone).add(grit)
      .mul(mix(float(1.0), float(0.72), max(swWet.x, swPuddle)))
      .mul(mix(float(1.0), float(0.8), swWet.z))
      .mul(float(1.0).sub(mortar.mul(0.35)));
    return mix(baseConcrete.mul(float(1.0).sub(joints.mul(0.45))), brick, centro);
  })();

  mat.roughnessNode = Fn(() => {
    const panelHash = hash2D(floor(vec2(positionWorld.x.div(1.5), positionWorld.z.div(1.5))));
    const wetRough = mix(float(0.90).sub(panelHash.mul(0.06)), float(0.55), max(swWet.z, swWet.x.mul(0.7)));
    return mix(wetRough, float(0.2), swPuddle);
  })();

  // Water's Fresnel (F0 = 0.02) on pools & the wet film, as for the roadway
  mat.metalnessNode = clamp(swFresnel.mul(1.6), 0.0, 0.85).mul(max(swPuddle, swWet.z.mul(0.3)));

  // Physical -12mm scored expansion joints + +3mm concrete aggregate grain via bumpNormal
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(140.0, 14.0, camDist);

    const joints = max(gridLine(wx, 1.5, 0.042), gridLine(wz, 1.5, 0.042));
    const grain = noise2D(vec2(wx.mul(4.5), wz.mul(4.5))).sub(0.5).mul(0.003);
    const height = grain.sub(joints.mul(0.012)).mul(detail).mul(float(1.0).sub(swPuddle));
    return bumpNormal(height);
  })();

  return mat;
}

/**
 * Dressed Granite Curbstone TSL Material (ported from SidewalkGenerator.js `createCurbMaterial`)
 * Dense cool grey flamed granite with 1.5m segment joints, grimier road-facing vertical face,
 * and `bumpNormal` granite grain.
 */
export function createCurbMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.06,
    roughness: 0.72
  });

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(180.0, 16.0, camDist);

    const tone = noise2D(vec2(wx.mul(0.6), wz.mul(0.6)));
    const speckle = noise2D(vec2(wx.mul(18.0), wz.mul(18.0))).sub(0.5).mul(0.06).mul(detail);
    const stone = mix(color(0x4c4c45), color(0x63635a), tone).add(speckle);

    const joints = max(gridLine(wx, 1.5, 0.038), gridLine(wz, 1.5, 0.038)).mul(detail);
    const topFace = smoothstep(0.5, 0.85, normalWorldGeometry.y);
    const wetFilm = smoothstep(0.2, 0.8, cityUniforms.uRoadWetness); // rain-darkened granite, like the roadway's film
    // the centro's curbs are painted traffic yellow (within ~620 m of the Plaza Principal), worn through in patches
    const centro = smoothstep(700.0, 580.0, length(positionWorld.xz));
    const paintLeft = smoothstep(0.28, 0.4, noise2D(vec2(wx.mul(0.9), wz.mul(0.9)).add(3.7)));
    const yellow = mix(stone, mix(color(0xd9a92a), color(0xe8c04a), tone), paintLeft.mul(centro));
    // and the glorieta of the Hermana Agua's island (world/hermana-agua.ts, its middle at 128.6, 1117.4: ~13 m to its
    // curb, the nearest across the street ~23 m) in pink, fresh
    const glorieta = smoothstep(17.0, 16.0, length(positionWorld.xz.sub(vec2(128.6, 1117.4))));
    const painted = mix(yellow, mix(color(0xb9548f), color(0xd677ab), tone), glorieta);
    return mix(painted.mul(0.68), painted, topFace).mul(float(1.0).sub(joints.mul(0.42))).mul(mix(float(1.0), float(0.78), wetFilm));
  })();

  mat.roughnessNode = mix(float(0.72), float(0.5), smoothstep(0.2, 0.8, cityUniforms.uRoadWetness));

  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(120.0, 12.0, camDist);
    const grain = noise2D(vec2(wx.mul(5.5), wz.mul(5.5))).sub(0.5).mul(0.0022);
    return bumpNormal(grain.mul(detail));
  })();

  return mat;
}

/**
 * The Libramiento's ciclovía (city-grid.ts, medians.ts): a two-way bike path 3.2 m wide in red-ochre concrete, its
 * edges lined white, a dashed white line down the middle and a bicycle painted in each lane every 40 m. uv: u 0..1
 * across, v metres along.
 */
export function createCyclewayMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.8 });
  mat.colorNode = Fn(() => {
    const a = uv().x.sub(0.5).mul(3.2); // m from the centre line
    const s = uv().y; // m along
    const grain = noise2D(positionWorld.xz.mul(2.7));
    // concrete poured in 3 m slabs, the joints a little darker
    const joint = lineAA(fract(s.div(3.0)).sub(0.5), 0.012);
    let c = mix(color(0x8c3d2e), color(0x9e4a37), grain).mul(float(1.0).sub(joint.mul(0.25)));
    c = mix(c, color(0x6f6a61), smoothstep(1.48, 1.56, abs(a))); // the concrete border
    const edge = lineAA(abs(a).sub(1.32), 0.05);
    const centre = lineAA(a, 0.05).mul(step(0.5, fract(s.div(4.0))));
    // a bicycle every 40 m in each lane, facing its way: two wheels, the frame between them
    const lane = sign(a); // -1 one way, +1 the other
    const bs = fract(s.div(40.0)).sub(0.5).mul(40.0).mul(lane); // m from the bicycle's centre, along its lane's way
    const bx = abs(a).sub(0.72); // m across from the lane's middle
    const wheel = (off: number) => lineAA(length(vec2(bs.sub(off), bx)).sub(0.26), 0.035);
    const frame = lineAA(bx, 0.035).mul(step(abs(bs), 0.3)).max(lineAA(bx.sub(bs.add(0.3).mul(0.6)), 0.03).mul(step(-0.3, bs)).mul(step(bs, 0.1)));
    const bike = max(max(wheel(-0.42), wheel(0.42)), frame).mul(step(abs(bs), 1.0));
    return mix(c, color(0xf0eee6), max(max(edge, centre), bike).mul(0.9));
  })();
  return mat;
}
