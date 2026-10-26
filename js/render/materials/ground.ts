import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  color,
  attribute,
  positionWorld,
  cameraPosition,
  uv,
  time,
  abs,
  floor,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  normalize,
  pow,
  fwidth,
  specularColor,
  specularColorBlended,
  specularF90
} from 'three/tsl';
import { cityUniforms, hash2D, noise2D, bumpNormal, gridLine } from './shared.ts';

// js/render/materials/ground.ts
// The open ground's & the water's materials: lots, flood water, and the river channels' banks & water.

/**
 * The open ground inside the house blocks (city-grid.ts, lot-greenery.ts): what the satellite shows between Tepic's
 * houses. The `open` attribute is the block's share of open ground (lot-greenery.ts openness): an empty block is a
 * vacant lot or a field, rough grass & weeds in clumps worn to the red-brown earth along paths and in bare patches; a
 * built-up one's yards are patios, concrete & tile with grass and potted green between. The grass greens in the rains
 * and goes straw-yellow in the dry season (cityUniforms.uDryness). Detail finer than a pixel fades to its average,
 * so the lots don't shimmer from the air.
 */
export function createLotGroundMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.92 });
  const open = attribute('open', 'float');
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const px = length(fwidth(p)); // metres per pixel
    const fine = smoothstep(0.9, 0.12, px);
    const mid = smoothstep(6.0, 1.5, px);
    const grain = noise2D(p.mul(3.1)).sub(0.5).mul(fine).add(0.5);
    const clump = noise2D(p.mul(0.45).add(3.7)).sub(0.5).mul(mid).add(0.5);
    const patch = noise2D(p.mul(0.09).add(11.3)); // tens of metres: worn ground, wetter & drier hollows
    const path = abs(noise2D(p.mul(0.035).add(41.0)).sub(0.5)); // foot-worn paths across a lot, a few across

    // grass: deep green clumps of weeds in a lighter sward, browning with the season
    const dryness = cityUniforms.uDryness.mul(patch.mul(0.7).add(0.5)).min(1.0);
    const sward = mix(color(0x3d5624), color(0x4b652b), grain);
    const weeds = mix(color(0x2d421b), color(0x374f20), grain);
    let grass = mix(sward, weeds, smoothstep(0.45, 0.7, clump));
    grass = mix(grass, mix(color(0xa08e55), color(0xbca66c), grain), dryness);

    // bare earth: Tepic's red-brown soil, in patches where the grass is thin and along the paths
    const earth = mix(color(0x7d6045), color(0x987656), grain);
    const bare = max(smoothstep(0.62, 0.8, patch.add(clump.mul(0.25))), smoothstep(0.035, 0.012, path).mul(smoothstep(0.3, 0.6, open)))
      .mul(mix(float(0.55), float(1.0), cityUniforms.uDryness));
    const ground = mix(grass, earth, bare.min(1.0));

    // patios: concrete & tile, more of them the more built-up the block; grass & plants between
    const tile = mix(color(0x8f8a80), color(0xa8a196), grain).mul(mix(float(0.92), float(1.06), noise2D(p.mul(0.6))));
    const terracotta = mix(color(0x9e5a3f), color(0xb26a4a), grain);
    const paving = mix(tile, terracotta, step(0.72, noise2D(p.mul(0.12).add(7.0))));
    const paved = smoothstep(0.7, 0.2, open).mul(smoothstep(0.35, 0.6, noise2D(p.mul(0.16).add(23.0)).add(0.15)));
    return mix(ground, paving, paved.min(0.9));
  })();
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(70.0, 8.0, camDist);
    return bumpNormal(noise2D(positionWorld.xz.mul(5.5)).sub(0.5).mul(0.012).mul(detail));
  })();
  // a canopy of blades, not a flat dielectric (see createParkLawnMaterial)
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(0.3);
  };
  return mat;
}

/**
 * A flood's water over the streets (floods.ts): brown with the mud it carries, darker where it is deep, a mirror
 * between the rain's ripples; its shallow edge only darkens & wets the ground under it. The `depth` attribute is the
 * water's depth (m).
 */
export function createFloodWaterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.04, roughness: 0.16 });
  const depth = attribute('depth', 'float');
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const silt = noise2D(p.mul(0.08).add(cityUniforms.uClock.mul(0.02))).mul(0.25).add(0.85);
    const deep = smoothstep(0.03, 0.5, depth);
    return mix(color(0x2a241d), mix(color(0x8a6b42), color(0x5e4729), deep), smoothstep(0.0, 0.08, depth)).mul(silt);
  })();
  // the rain's rings & the current's ripples, more in a storm (the roads' wetness follows the rain)
  mat.normalNode = Fn(() => {
    const p = positionWorld.xz;
    const t = cityUniforms.uClock;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(120.0, 10.0, camDist);
    const ripple = noise2D(p.mul(1.7).add(vec2(t.mul(0.6), t.mul(-0.4)))).add(noise2D(p.mul(4.3).sub(vec2(t.mul(1.1), 0.0))).mul(0.5));
    return bumpNormal(ripple.mul(0.01).mul(detail).mul(cityUniforms.uRoadWetness.add(0.3)));
  })();
  mat.roughnessNode = mix(float(0.5), float(0.16), smoothstep(0.0, 0.06, depth));
  // (muddy water reflects less than clear: a weaker, duller specular)
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.02));
    specularColorBlended.assign(vec3(0.02));
    specularF90.assign(0.55);
  };
  return mat;
}

/**
 * The banks & bed of the river channels (js/world/river-channels.ts): coursed stone walls, darker & mossy towards the
 * water, down to a bed of silt. The `wet` attribute runs 0 at the banks' tops to 1 on the bed; uv are metres along the
 * channel & across it.
 */
export function createRiverBankMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0.0, side: THREE.DoubleSide });
  const wet = attribute('wet', 'float');
  const cStone = color(0x8f887a);
  const cStoneDark = color(0x6c665b);
  const cMoss = color(0x46502f);
  const cSilt = color(0x4b4434);
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const camDist = length(wp.sub(cameraPosition));
    const detail = smoothstep(160.0, 20.0, camDist);
    // stone courses ~0.45 m high, the stones 0.6-1 m long, joints of dark mortar
    const course = floor(wp.y.div(0.45));
    const joints = max(gridLine(wp.y, 0.45, 0.025), gridLine(uv().x.add(hash2D(vec2(course, 3.1)).mul(0.8)), 0.8, 0.03)).mul(detail);
    const stone = mix(cStone, cStoneDark, noise2D(vec2(uv().x.mul(1.25), course.mul(1.7))).mul(0.7).add(noise2D(wp.xz.mul(4.0)).mul(0.3)));
    const walled = mix(stone, cStoneDark.mul(0.55), joints.mul(0.8));
    // damp & mossy low on the walls, silt on the bed
    const damp = smoothstep(0.35, 0.85, wet);
    const banked = mix(walled, mix(walled.mul(0.62), cMoss, noise2D(wp.xz.mul(0.9)).mul(0.6)), damp);
    return mix(banked, cSilt.mul(noise2D(wp.xz.mul(1.6)).mul(0.3).add(0.85)), smoothstep(0.96, 1.0, wet));
  })();
  mat.roughnessNode = mix(float(0.93), float(0.7), smoothstep(0.5, 1.0, wet));
  return mat;
}

/**
 * The water in the river channels: murky green-brown and nearly still on top, its ripples drifting downstream (uv.x:
 * metres along the flow), mirroring the banks & sky at grazing angles through the water's Fresnel (on metalness, as for
 * the road's puddles, so SSR reflects it).
 */
export function createRiverWaterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  const cDeep = color(0x22301f);
  const cSilty = color(0x4a4a32);
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  mat.colorNode = Fn(() => {
    // siltier along the edges (uv.y: -1 at the left bank, 1 at the right), in slow drifting patches
    const edge = smoothstep(0.55, 1.0, abs(uv().y));
    const patch = noise2D(vec2(uv().x.mul(0.05).sub(time.mul(0.04)), uv().y.mul(0.8)));
    return mix(cDeep, cSilty, edge.mul(0.6).add(patch.mul(0.3)));
  })();
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.85);
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(220.0, 15.0, camDist);
    const flow = uv().x.sub(time.mul(0.9));
    const ripples = noise2D(vec2(flow.mul(0.9), uv().y.mul(3.0))).mul(0.06)
      .add(noise2D(vec2(flow.mul(2.6).add(7.3), uv().y.mul(8.0).sub(time.mul(0.3)))).mul(0.025));
    return bumpNormal(ripples.mul(detail));
  })();
  return mat;
}

/**
 * The banks & bed of the lakes and presas (js/world/lakes.ts, drawn by river-channels.ts): Tepic's red-brown earth
 * under a fringe of grass at the shore's top, going to dark wet mud & a line of algae at the water's edge, and silt
 * under it. The `wet` attribute runs 0 at the shore's top to 1 at the water's edge and under it. The grass browns
 * with the dry season (cityUniforms.uDryness), the bank's upper half sun-baked & cracked then.
 */
export function createLakeShoreMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0.0 });
  const wet = attribute('wet', 'float');
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const px = length(fwidth(p));
    const fine = smoothstep(0.9, 0.12, px);
    const grain = noise2D(p.mul(2.7)).sub(0.5).mul(fine).add(0.5);
    const patch = noise2D(p.mul(0.11).add(5.3));
    const grass = mix(mix(color(0x3f5a26), color(0x51692d), grain), mix(color(0x9c8a52), color(0xb39f66), grain), cityUniforms.uDryness);
    const earth = mix(color(0x7a5a40), color(0x93714f), grain);
    const mud = mix(color(0x3e3226), color(0x4b3c2c), grain);
    const algae = color(0x3c4a26);
    const silt = mix(color(0x4b4434), color(0x5a5140), patch);
    // grass down the bank's first metres where the season and the patch allow, then earth, mud at the water
    const grassy = smoothstep(0.35, 0.05, wet.add(patch.sub(0.5).mul(0.25))).mul(mix(float(1.0), float(0.55), cityUniforms.uDryness));
    let c = mix(earth, grass, grassy);
    c = mix(c, mud, smoothstep(0.55, 0.95, wet));
    c = mix(c, algae, smoothstep(0.92, 0.99, wet).mul(smoothstep(0.999, 0.99, wet)).mul(0.7));
    return mix(c, silt, step(0.999, wet));
  })();
  mat.roughnessNode = mix(float(0.94), float(0.55), smoothstep(0.7, 1.0, wet));
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(60.0, 6.0, camDist);
    return bumpNormal(noise2D(positionWorld.xz.mul(4.5)).sub(0.5).mul(0.02).mul(detail));
  })();
  return mat;
}

/**
 * The still water of the lakes, presas & ponds (js/world/lakes.ts; laid on the hillside by terrain.ts): green-brown
 * and murky, a little clearer & bluer away from the shore, the wind's ripples drifting across it, mirroring the banks
 * & sky at grazing angles through the water's Fresnel (on metalness, as the river's, so SSR reflects it). uv are metres
 * east & south (the ripples' frame).
 */
export function createLakeWaterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0.0 });
  const cDeep = color(0x1f3326);
  const cSilty = color(0x4a4a30);
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);
  mat.colorNode = Fn(() => {
    const p = uv();
    const patch = noise2D(p.mul(0.03).add(vec2(time.mul(0.01), 0.0)));
    return mix(cDeep, cSilty, patch.mul(0.45).add(0.1));
  })();
  mat.metalnessNode = clamp(fresnel.mul(1.6), 0.0, 0.85);
  mat.normalNode = Fn(() => {
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(260.0, 15.0, camDist);
    const p = uv();
    const ripples = noise2D(p.mul(0.7).add(vec2(time.mul(0.35), time.mul(0.12)))).mul(0.045)
      .add(noise2D(p.mul(2.3).sub(vec2(time.mul(0.6), time.mul(-0.2)))).mul(0.02));
    return bumpNormal(ripples.mul(detail));
  })();
  return mat;
}
