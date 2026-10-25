import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  attribute,
  varying,
  positionGeometry,
  positionWorld,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  screenSize,
  sin,
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
  length,
  normalize,
  pow,
  fwidth,
  mx_worley_noise_vec2
} from 'three/tsl';
import {
  cityUniforms,
  hash2D,
  noise2D,
  bumpNormal,
  gridLine,
  canyonSkyAONode,
  _transparentEffectMRT
} from './shared.ts';
import type { Node } from 'three/webgpu';

// js/render/materials/roads.ts
// The roads' materials: the wet-road puddle masks (shared with the walks), potholes & patches, the airfield, the
// streets that are not asphalt, the asphalt and its paint.

// Post-rain puddle field (organic standing rainwater pools) shared by every road surface channel
function roadPuddleField(wx: Node<'float'>, wz: Node<'float'>): Node<'float'> {
  const nMacro = noise2D(vec2(wx.mul(0.095), wz.mul(0.075)));
  const nMid = noise2D(vec2(wx.mul(0.25).add(19.4), wz.mul(0.22).add(11.8)));
  const nDetail = noise2D(vec2(wx.mul(0.68).sub(7.3), wz.mul(0.68).add(29.1)));
  const spawnPool = smoothstep(4.2, 1.4, length(vec2(wx.sub(1.6), wz.sub(122.8)))).mul(0.10);
  return nMacro.mul(0.52).add(nMid.mul(0.34)).add(nDetail.mul(0.14)).add(spawnPool);
}

/**
 * Wetness masks over a puddle field, driven by cityUniforms.uRoadWetness (0 = bone dry … 1 = right after a downpour):
 * x = damp stains (darker, satin), y = standing water (mirror-smooth; none on a dry day), z = wet film over everything.
 * Water collects in the field's highest (lowest-lying) spots first, so pools appear, grow & merge as wetness rises;
 * `drainage` raises the water line for better-drained surfaces such as the crowned sidewalk flags.
 */
export function roadWetMasks(field: Node<'float'>, drainage = 0.0): Node<'vec3'> {
  const w = cityUniforms.uRoadWetness;
  const level = mix(float(0.86), float(0.56), clamp(w.sub(0.1).div(0.55), 0.0, 1.0)).add(drainage);
  const damp = smoothstep(level.sub(0.09), level.sub(0.015), field);
  const puddle = smoothstep(level, level.add(0.022), field).mul(smoothstep(0.1, 0.22, w));
  const film = smoothstep(0.2, 0.8, w);
  return vec3(damp, puddle, film);
}

/**
 * Unified Roadway Asphalt, Footprint-Filtered Aggregate `bumpNormal`, Scattered Manholes
 * & Post-Rain Wetness (upgraded with techniques from CityGenerator.js `createRoadMaterial`).
 * cityUniforms.uRoadWetness drives damp stains, a glossy wet film & standing puddles (roadWetMasks): bone dry at
 * midday, a few small pools at golden hour, slick & mirroring the lights at night. Water's Fresnel rides on metalness
 * (as for the rivers), so puddles reflect the street through SSR at grazing angles yet only darken seen from above.
 * Lane markings are separate geometry built from the road network (js/world/road-paint.ts).
 */
// A pothole at world (wx, wz): one 9 m cell in eight holds one, 0.35-0.95 m across, ragged (noise on its radius).
// Returns vec2(inside 0..1, crumbled rim 0..1)
const roadPothole = Fn(([wx, wz]: [Node<'float'>, Node<'float'>]) => {
  const p = vec2(wx, wz);
  const cell = floor(p.div(9.0));
  const centre = cell.add(vec2(hash2D(cell.add(41.3)), hash2D(cell.add(77.9))).mul(0.7).add(0.15)).mul(9.0);
  const r = hash2D(cell.add(5.1)).mul(0.6).add(0.35);
  const d = length(p.sub(centre)).add(noise2D(p.mul(3.1)).sub(0.5).mul(r).mul(0.7));
  const on = step(0.875, hash2D(cell.add(2.7)));
  const inside = smoothstep(r, r.mul(0.82), d).mul(on);
  const rim = smoothstep(r.mul(1.35), r, d).mul(float(1.0).sub(inside)).mul(on).mul(noise2D(p.mul(9.0)));
  return vec2(inside, rim);
});

// A bacheo patch at world (wx, wz): one 23 m cell in four, a rectangle 1-3.5 x 0.8-2.2 m of newer, darker asphalt
const roadPatch = Fn(([wx, wz]: [Node<'float'>, Node<'float'>]) => {
  const p = vec2(wx, wz);
  const cell = floor(p.div(23.0));
  const centre = cell.add(vec2(hash2D(cell.add(9.4)), hash2D(cell.add(18.2))).mul(0.6).add(0.2)).mul(23.0);
  const half = vec2(hash2D(cell.add(3.3)).mul(1.25).add(0.5), hash2D(cell.add(6.6)).mul(0.7).add(0.4));
  const q = abs(p.sub(centre)).sub(half);
  const aa = fwidth(p.x).max(0.002);
  return smoothstep(aa, aa.negate(), max(q.x, q.y)).mul(step(0.75, hash2D(cell.add(1.9))));
});

/**
 * The streets that are not asphalt (js/world/pavements.ts, from OpenStreetMap's surface tags): attribute `pave` picks
 * the kind, in world space so the overlapping strips of a street join seamlessly:
 * - 0 empedrado: rounded river stones (Worley cells) set in earth, a few weeds in the joints
 * - 1 adoquín: 20 x 10 cm setts in running bond
 * - 2 tierra: packed brown earth with gravel and ruts
 * - 3 concreto hidráulico: pale poured slabs, 3.5 m between the joints, hairline cracks
 * Fine detail settles to its mean colour once it shrinks under a pixel.
 */
/**
 * The airfield (airport.ts), by the per-vertex `field`: 0 the apron's concrete slabs, 1 the runway's asphalt and its
 * white markings, 2 a taxiway's asphalt and its yellow centreline, 3 a helipad's concrete. `along` is metres from the
 * strip's start, `across` metres from its centreline, `half` its half-width and `span` its length, so the runway paints
 * its markings to ICAO Annex 14: edge lines, the dashed centreline (30 m dashes, 20 m gaps), threshold piano keys,
 * touchdown-zone bars and the aiming points, both ends alike.
 */
export function createAirfieldMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.85 });
  const field = attribute('field', 'float');
  const along = attribute('along', 'float');
  const across = abs(attribute('across', 'float'));
  const half = attribute('half', 'float');
  const span = attribute('span', 'float');
  const isField = (k: number) => step(k - 0.5, field).mul(step(field, k + 0.5));
  const p = positionWorld.xz;
  const band = (v: Node<'float'>, lo: Node<'float'> | number, hi: Node<'float'> | number) => step(lo, v).mul(step(v, hi));

  // concrete: 7.5 m slabs, joints, a little staining
  const slabs = max(gridLine(p.x, 7.5, 0.02), gridLine(p.y, 7.5, 0.02));
  const concTone = noise2D(p.mul(0.25)).mul(0.6).add(noise2D(p.mul(1.9)).mul(0.4));
  const concrete = mix(color(0x9d9a92), color(0xb5b1a8), concTone).mul(float(1.0).sub(slabs.mul(0.35)));
  // asphalt, darker with tyre rubber where the wheels touch down
  const end = min(along, span.sub(along));
  const rubber = band(end, 150.0, 900.0).mul(smoothstep(9.0, 2.0, across)).mul(isField(1));
  const asphalt = mix(color(0x34363a), color(0x3e4044), noise2D(p.mul(0.4))).mul(float(1.0).sub(rubber.mul(0.35)));

  // runway markings
  const edgeLine = band(across, half.sub(1.8), half.sub(0.9));
  const centre = step(across, 0.45).mul(step(fract(along.div(50.0)), 0.6)).mul(step(180.0, end));
  const piano = band(end, 6.0, 36.0).mul(band(across, 1.8, half.sub(3.0))).mul(step(fract(across.sub(1.8).div(3.6)), 0.5));
  const touchdown = max(max(band(end, 150.0, 172.5), band(end, 300.0, 322.5)), band(end, 600.0, 622.5)).mul(band(across, 6.0, 15.0))
    .mul(step(fract(across.sub(6.0).div(3.0)), 0.6));
  const aiming = band(end, 400.0, 460.0).mul(band(across, 6.0, 16.0));
  const white = max(max(edgeLine, centre), max(max(piano, touchdown), aiming)).mul(isField(1));
  // taxiway centreline
  const yellow = step(across, 0.15).mul(isField(2));

  const base = mix(mix(concrete, asphalt, max(isField(1), isField(2))), concrete.mul(0.92), isField(3));
  mat.colorNode = mix(mix(base, color(0xe9e8e2), white), color(0xd9a925), yellow);
  // wet: the pavement darkens and goes glossy (the roads' film, lighting.ts)
  mat.roughnessNode = mix(float(0.88), float(0.62), max(white, yellow)).sub(cityUniforms.uRoadWetness.mul(0.45)).max(0.12);
  mat.aoNode = canyonSkyAONode();
  return mat;
}

export function createPavementMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.9 });
  const kind = attribute('pave', 'float');
  const isKind = (k: number) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
  const p = positionWorld.xz;
  const pixelSize = length(fwidth(p));
  const fine = smoothstep(0.06, 0.02, pixelSize);

  // empedrado: F1 / F2 of ~13 cm cells; the stone where F2 - F1 is wide, rounding down into the earth of the joints
  const wor = mx_worley_noise_vec2(p.mul(7.5));
  const edge = wor.y.sub(wor.x);
  const stone = smoothstep(0.1, 0.55, edge);
  const stoneTone = noise2D(p.mul(7.5).add(wor.x.mul(2.0))).mul(0.7).add(noise2D(p.mul(1.3)).mul(0.3));
  const stoneCol = mix(mix(color(0x5c554c), color(0x8f8576), stoneTone), color(0x7d6a55), smoothstep(0.7, 0.95, noise2D(p.mul(3.3))).mul(0.6));
  const joint = mix(color(0x282019), color(0x36441f), smoothstep(0.6, 0.85, noise2D(p.mul(1.7))));
  const empedrado = mix(mix(color(0x564e44), color(0x655c50), stoneTone.mul(0.5)), mix(joint, stoneCol, stone), fine);
  const domed = smoothstep(0.0, 0.7, edge).mul(0.045);

  // adoquín: running bond
  const row = floor(p.y.div(0.1));
  const setts = max(gridLine(p.x.add(mod(row, 2.0).mul(0.1)), 0.2, 0.008), gridLine(p.y, 0.1, 0.008));
  const settCol = mix(color(0x7d746a), color(0x948b80), hash2D(vec2(floor(p.x.add(mod(row, 2.0).mul(0.1)).div(0.2)), row)));
  const adoquin = mix(settCol, color(0x4b453e), setts.mul(fine));

  // tierra
  const dirtTone = noise2D(p.mul(0.6)).mul(0.6).add(noise2D(p.mul(4.0)).mul(0.4));
  const gravel = step(0.78, noise2D(p.mul(28.0))).mul(fine);
  const tierra = mix(mix(color(0x6f5a43), color(0x947a5a), dirtTone), color(0xa69a88), gravel.mul(0.7));

  // concreto
  const slabs = max(gridLine(p.x, 3.5, 0.012), gridLine(p.y, 3.5, 0.012));
  const crack = float(1.0).sub(smoothstep(0.0, 0.015, abs(noise2D(p.mul(0.9)).sub(0.5)))).mul(fine);
  const concTone = noise2D(p.mul(0.35)).mul(0.5).add(noise2D(p.mul(2.2)).mul(0.5));
  const concreto = mix(color(0x9b968c), color(0xb1aca1), concTone).mul(float(1.0).sub(max(slabs, crack.mul(0.8)).mul(0.35)));

  mat.colorNode = empedrado.mul(isKind(0)).add(adoquin.mul(isKind(1))).add(tierra.mul(isKind(2))).add(concreto.mul(isKind(3)));
  mat.roughnessNode = mix(float(0.86), float(0.97), isKind(2)).sub(isKind(3).mul(0.08));
  mat.normalNode = bumpNormal(domed.mul(isKind(0)).mul(fine).sub(setts.mul(isKind(1)).mul(0.004).mul(fine)));
  mat.aoNode = canyonSkyAONode().mul(mix(float(1.0), stone.mul(0.35).add(0.65), isKind(0).mul(fine)));
  return mat;
}

export function createRoadSurfaceMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.24,
    roughness: 0.48
  });

  const cAsphaltDark = color(0x2b2e33);
  const cAsphaltLight = color(0x464a51);
  const cManhole = color(0x4a433c);

  // Puddle field & wetness masks shared by every channel below (each node is generated once per fragment)
  const puddleField = roadPuddleField(positionWorld.x, positionWorld.z);
  const wet = roadWetMasks(puddleField);
  const damp = wet.x;
  const puddle = wet.y;
  const film = wet.z;
  // World size of a pixel: fine texture settles to its mean before it can alias at grazing angles or from the air
  const pixelSize = length(fwidth(positionWorld.xz));
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const waterFresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  mat.aoNode = canyonSkyAONode();

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(240.0, 22.0, camDist);

    // Two-scale aggregate grit, patchwork pours, oily wear stains & tar crack seams
    const microAggregate = mix(float(0.5), noise2D(vec2(wx.mul(16.0), wz.mul(16.0))), smoothstep(0.06, 0.02, pixelSize));
    const fineGrain = mix(float(0.5), noise2D(vec2(wx.mul(3.2), wz.mul(3.2))), smoothstep(0.4, 0.12, pixelSize));
    const patchNoise = noise2D(vec2(wx.mul(0.18), wz.mul(0.18)));
    const oilyStain = smoothstep(0.52, 0.84, noise2D(vec2(wx.mul(0.42), wz.mul(0.42)))).mul(detail);
    const tarSeam = float(1.0).sub(smoothstep(0.0, 0.04, abs(patchNoise.sub(0.52)))).mul(0.42).mul(detail);

    const baseAsphalt = mix(
      cAsphaltDark,
      cAsphaltLight,
      fineGrain.mul(0.36).add(microAggregate.mul(0.22)).add(patchNoise.mul(0.26))
    )
      .mul(float(1.0).sub(oilyStain.mul(0.32)))
      .mul(float(1.0).sub(tarSeam));

    // Circular cast-iron utility / sewer manhole covers scattered over the roadway (one 14 m cell in three)
    const mhCell = floor(vec2(wx, wz).div(14.0));
    const mhCentre = mhCell.add(vec2(hash2D(mhCell.add(13.7)), hash2D(mhCell.add(29.1))).mul(0.6).add(0.2)).mul(14.0);
    const mhDist = length(vec2(wx, wz).sub(mhCentre));
    const isManhole = float(1.0).sub(smoothstep(0.52, 0.60, mhDist)).mul(step(0.66, hash2D(mhCell))).mul(detail);
    const mhRings = sin(mhDist.mul(36.0)).mul(0.15).add(0.85);

    // Baches & bacheo: Tepic's potholes (crumbled edges, a gravelly hollow) and the darker, smoother patches poured
    // over the old ones
    const bache = roadPothole(wx, wz).mul(detail);
    const patch = roadPatch(wx, wz).mul(detail);
    const patched = mix(baseAsphalt, color(0x232529).mul(fineGrain.mul(0.2).add(0.9)), patch);
    const holed = mix(patched, mix(color(0x4d4740), color(0x38332d), microAggregate), bache.x).mul(float(1.0).add(bache.y.mul(0.35)));

    // Water filling the pores darkens the surface: damp stains & pools most, the overall wet film a little
    const wetDarkening = mix(mix(float(1.0), float(0.72), damp), float(0.6), max(puddle, bache.x.mul(damp))).mul(mix(float(1.0), float(0.8), film));
    return mix(holed, cManhole.mul(mhRings), isManhole).mul(wetDarkening);
  })();

  mat.roughnessNode = Fn(() => {
    const microRough = mix(float(0.04), noise2D(positionWorld.xz.mul(12.0)).mul(0.08), smoothstep(0.08, 0.03, pixelSize));
    const wetRough = mix(float(0.90).add(microRough), float(0.38), max(film.mul(0.9), damp.mul(0.8)));
    return mix(wetRough, float(0.1), puddle);
  })();

  // Water's Fresnel (F0 = 0.02): weights SSR & trades diffuse for reflection in pools (fully) and the wet film (partly)
  mat.metalnessNode = clamp(waterFresnel.mul(1.6), 0.0, 0.85).mul(max(puddle, film.mul(0.6)));

  // Footprint-gated 3mm + 1.6mm asphalt aggregate relief via bumpNormal (from CityGenerator.js)
  // Flattens to mirror-smooth 0.0 inside standing rainwater puddles so SSR reflections stay crisp!
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const coarseFade = smoothstep(0.08, 0.025, pixelSize);
    const fineFade = smoothstep(0.02, 0.006, pixelSize).mul(float(1.0).sub(film.mul(0.6)));

    const coarseGrit = noise2D(vec2(wx.mul(8.5), wz.mul(8.5))).sub(0.5).mul(0.0032).mul(coarseFade);
    const fineGrit = noise2D(vec2(wx.mul(36.0), wz.mul(36.0))).sub(0.5).mul(0.0016).mul(fineFade);
    // the potholes sink ~6 cm (its relief fades with the detail it sits in)
    const hollow = roadPothole(wx, wz).x.mul(-0.06).mul(smoothstep(0.12, 0.04, pixelSize));
    return bumpNormal(coarseGrit.add(fineGrit).add(hollow).mul(float(1.0).sub(puddle)));
  })();

  mat.emissiveNode = Fn(() => {
    const roadFresnel = pow(clamp(float(1.0).sub(abs(viewDir.y)), 0.0, 1.0), 2.3);

    const skyMirror = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, 0.40).mul(0.10);

    // (the New York fork reflected Times Square's neon here; Tepic's wet streets mirror only the sky)
    const reflectCol = skyMirror;

    return reflectCol.mul(max(puddle, film.mul(0.35))).mul(roadFresnel).mul(cityUniforms.uInteriorGlow).mul(0.07);
  })();

  return mat;
}

/**
 * Road markings built from the road network (js/world/road-paint.ts): vertex-coloured strips whose `paint` attribute
 * holds (metres along the strip, pattern period, duty cycle) and `side` the offset from the strip's centre line.
 * Strips thinner than ~1.5 px are widened on screen and faded to match (phone-wire AA) and dashes are box-filtered,
 * so distant markings fade out smoothly instead of breaking up and flickering. Worn, and dark & glossy in puddles.
 */
export function createRoadPaintMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    metalness: 0.0
  });
  mat.mrtNode = _transparentEffectMRT; // SSR keeps seeing the asphalt (and its puddles) underneath

  const paint = attribute('paint', 'vec3');
  const side = attribute('side', 'vec2');
  const sideOffset = vec3(side.x, 0.0, side.y);

  // How much to widen the strip so it is at least 1.5 px wide on screen (1 when it already is)
  const widen = Fn(() => {
    const viewProjection = cameraProjectionMatrix.mul(cameraViewMatrix);
    const edge = viewProjection.mul(vec4(positionGeometry, 1.0));
    const centre = viewProjection.mul(vec4(positionGeometry.sub(sideOffset), 1.0));
    const halfWidthPx = length(edge.xy.div(edge.w).sub(centre.xy.div(centre.w)).mul(screenSize).mul(0.5));
    const inFront = step(0.05, min(edge.w, centre.w));
    return clamp(float(0.75).div(max(halfWidthPx, 0.001)), 1.0, 16.0).mul(inFront).max(1.0);
  })();
  mat.positionNode = positionGeometry.add(sideOffset.mul(widen.sub(1.0)));

  // Exact box filter of the dashes (on for `duty` of each period) over the pixel footprint
  const t = paint.x.div(paint.y);
  const footprint = max(fwidth(t), 0.0001);
  const duty = paint.z;
  const onSoFar = (x: Node<'float'>) => floor(x).mul(duty).add(clamp(fract(x).sub(float(1.0).sub(duty).mul(0.5)), 0.0, duty));
  const dashes = onSoFar(t.add(footprint.mul(0.5))).sub(onSoFar(t.sub(footprint.mul(0.5)))).div(footprint);

  const xz = positionWorld.xz;
  const detail = smoothstep(70.0, 15.0, length(positionWorld.sub(cameraPosition)));
  const wear = mix(float(0.5), noise2D(xz.mul(0.8)).mul(0.6).add(noise2D(xz.mul(2.3)).mul(0.4)), detail);
  mat.opacityNode = dashes.mul(varying(float(1.0).div(widen))).mul(smoothstep(0.1, 0.6, wear).mul(0.4).add(0.55));

  const wet = roadWetMasks(roadPuddleField(positionWorld.x, positionWorld.z)); // same pools & film as the asphalt
  mat.colorNode = vec3(mix(float(1.0), float(0.72), wet.y).mul(mix(float(1.0), float(0.86), wet.z)));
  mat.roughnessNode = mix(mix(float(0.62), float(0.42), wet.z), float(0.2), wet.y);
  mat.aoNode = canyonSkyAONode();

  return mat;
}
