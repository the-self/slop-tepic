import * as THREE from 'three/webgpu';
import { cityUniforms } from '../../render/tsl-materials.ts';
import {
  float,
  vec2,
  vec3,
  color,
  attribute,
  sin,
  abs,
  fract,
  floor,
  min,
  max,
  mod,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  fwidth,
  uniform,
  texture,
  positionLocal
} from 'three/tsl';
import { CAR_PARTS } from './car-specs.ts';
import { carLayout } from './car-body.ts';
import { taxiSignPlacement } from './car-geometry.ts';
import { roundedRect, polygonDistance, polygonPlanes, coverage } from './tsl-shapes.ts';
import { bloodStains } from './car-blood-stains.ts';
import type { BodySpec } from '../../models/bodies.ts';
import type { Node } from 'three/webgpu';

// js/actors/vehicles/car-material.ts
// The cars' TSL material: glass, lamps, grilles, plates, alloys, liveries and signals painted from object-space
// position & normal, with the traffic's crumple damage and the player's car's blood (one material per body type).

const _carMaterialCache = new Map<string, THREE.MeshStandardNodeMaterial>();
let _carPlateTexture: THREE.CanvasTexture | undefined;

// One small generated atlas serves every rear plate, with mipmaps for distant traffic.
function carPlateTexture() {
  if (_carPlateTexture) return _carPlateTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the plates');
  ctx.fillStyle = '#f2b718';
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#17212c';
  ctx.font = 'bold 25px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['4KM 728', '7TR 319', '2BJ 506', '6XL 842'].forEach((label, row) => { ctx.fillText(label, 64, row * 64 + 33); });
  _carPlateTexture = new THREE.CanvasTexture(canvas);
  _carPlateTexture.colorSpace = THREE.SRGBColorSpace;
  return _carPlateTexture;
}

/**
 * The material of a car made as a 3D model (models/cars `glb`, modelled white: assets/models/CLAUDE.md): its texture,
 * with the instance's `paintColor` on its body, and its red lamps at the back (-z) lit by `carState`'s brake, as the
 * drawn cars' are. Where the body is comes from the model's paint mask (`paintMap`: its metallic-roughness texture, R
 * the mask and G the roughness, tools/models/prepare.mjs); without one, from where the texture is white. The paint
 * follows the texture's brightness, so its baked shading shows through.
 */
export function createModelCarMaterial(map: THREE.Texture, paintMap: THREE.Texture | null = null): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0 });
  const rgb = texture(map).rgb;
  const lum = rgb.dot(vec3(0.299, 0.587, 0.114));
  let body: Node<'float'>;
  if (paintMap) {
    const mask = texture(paintMap);
    body = mask.r;
    mat.roughnessNode = mask.g;
  } else {
    const sat = max(rgb.r, max(rgb.g, rgb.b)).sub(min(rgb.r, min(rgb.g, rgb.b)));
    body = smoothstep(0.5, 0.78, lum).mul(float(1).sub(smoothstep(0.06, 0.16, sat)));
    mat.roughnessNode = mix(float(0.7), float(0.32), body);
  }
  mat.colorNode = mix(rgb, attribute('paintColor', 'vec3').mul(lum).mul(1.12), body);
  const lamp = smoothstep(0.2, 0.4, rgb.r.sub(max(rgb.g, rgb.b))).mul(step(positionLocal.z, 0.0));
  mat.emissiveNode = color(0xff2a1a).mul(lamp).mul(attribute('carState', 'vec4').x.mul(2.2));
  return mat;
}

/**
 * Creates the TSL material for lofted vehicles.
 * Instanced traffic reads the per-instance `paintColor` (vec3) and `carState` (vec4: brake, left (+x) & right (-x)
 * turn signal, livery: 1 = NYPD) attributes; with a fixed `fixedColorHex` (the player's taxi, wheels) the state is the
 * `material.userData.carState` uniform instead. With `crumple` (the city's traffic) carState's w also carries how crushed
 * the car is (traffic.ts renderCar: livery + 2 × (front + 16 rear + 256 left (+x) + 4096 right (-x)), each in 15ths:
 * one more vertex buffer would be past WebGPU's 8), and the body is pushed in there and dulled. With `blood` (the
 * player's car: a new material each time, its stains its own) the stains of player/car-blood.ts on its nose, bonnet &
 * windscreen, from `material.userData.blood` ({ front, top }: arrays of vec4 uniforms, car-blood.ts's slots).
 * Every mask is built once and shared by the colour, roughness, metalness & emissive graphs (TSL turns nodes used
 * more than once into temporaries), so the fragment shader evaluates each SDF a single time.
 */
export function createLoftedCarMaterial(spec: BodySpec, fixedColorHex: number | null = null, { crumple = false, blood = false } = {}): THREE.MeshStandardNodeMaterial {
  const cacheKey = `${spec.name}_${fixedColorHex ?? 'instanced'}${crumple ? '_crumple' : ''}`;
  // (a car with blood has a material of its own: its stains are its own uniforms)
  const cached = blood ? undefined : _carMaterialCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const L = carLayout(spec);
  const cab = spec.cabin;
  const fixed = fixedColorHex !== null;
  const stateUniform = fixed ? uniform(new THREE.Vector4(0, 0, 0, 0)) : null;
  const state = stateUniform ?? attribute('carState', 'vec4');
  const livery = crumple ? mod(state.w, 2.0) : state.w;
  const paint = fixedColorHex !== null ? color(fixedColorHex) : attribute('paintColor', 'vec3');

  const axleZ = float(spec.wheelZ);
  const wheelR = float(spec.wheelRadius);
  const archR = L.archR;

  // Glass outlines from the glasshouse layout: side windows in side view (z, y), windshield & backlight from above
  // (|x|, z). Each edge is pulled in by its pillar / frame width; the seal outline sits a little further out.
  const bc = L.belt.cowl;
  const bd = L.belt.deck;
  const rf = L.rail.front;
  const rm = L.rail.mid;
  const rr = L.rail.rear;
  const sidePoly: [z: number, y: number][] = [[cab.cowl, bc.y], [cab.roofFront, rf.y], [L.rail.roofMid, rm.y], [cab.roofRear, rr.y], [cab.deck, bd.y]];
  const sideGlassPlanes = polygonPlanes(sidePoly, [0.05, 0.03, 0.03, 0.065, 0.02]);
  const sideSealPlanes = polygonPlanes(sidePoly, [0.034, 0.016, 0.016, 0.05, 0.004]);
  const frontPoly: [x: number, z: number][] = [[-1, cab.cowl], [-1, cab.roofFront], [rf.x, cab.roofFront], [bc.x, cab.cowl]];
  const frontGlassPlanes = polygonPlanes(frontPoly, [0, 0.045, 0.06, 0.05]);
  const frontSealPlanes = polygonPlanes(frontPoly, [0, 0.03, 0.045, 0.035]);
  const rearPoly: [x: number, z: number][] = [[-1, cab.roofRear], [-1, cab.deck], [bd.x, cab.deck], [rr.x, cab.roofRear]];
  const rearGlassPlanes = polygonPlanes(rearPoly, [0, 0.045, 0.065, 0.05]);
  const rearSealPlanes = polygonPlanes(rearPoly, [0, 0.03, 0.05, 0.035]);
  const [hlX, hlY, hlW, hlH] = spec.headlight;
  const [tlX, tlY, tlW, tlH] = spec.taillight;
  const [grY, grW, grH] = spec.grille;
  const [inY, inW, inH] = spec.intake;
  const [plateF, plateR] = spec.plates;
  const frontZone = spec.zFront - 0.55;
  const rearZone = spec.zRear + 0.55;
  const sillY = spec.sill[1][1];
  const rearSill = spec.tail.sill[1];
  const signY = taxiSignPlacement(spec).y + 0.105;
  const one = float(1.0);

  const p = attribute('position', 'vec3');
  const n = attribute('normal', 'vec3');
  const partId = attribute('partId', 'float');
  const isPart = (id: number) => step(abs(partId.sub(id)), 0.25);
  const isBody = isPart(CAR_PARTS.BODY);
  const isWindow = isPart(CAR_PARTS.WINDOW);
  const isTyre = isPart(CAR_PARTS.TYRE);
  const isAlloy = isPart(CAR_PARTS.ALLOY);
  const isTrim = isPart(CAR_PARTS.TRIM);
  const isMirror = isPart(CAR_PARTS.MIRROR);
  const isSign = isPart(CAR_PARTS.SIGN);
  const ax = abs(p.x);
  const isSide = smoothstep(0.45, 0.7, abs(n.x));
  const front = smoothstep(0.12, 0.38, n.z).mul(step(frontZone, p.z)).mul(isBody);
  const rear = smoothstep(0.12, 0.38, n.z.negate()).mul(step(p.z, rearZone)).mul(isBody);
  const under = smoothstep(-0.25, -0.55, n.y).mul(isBody);
  const belt = mix(float(bd.y), float(bc.y), clamp(p.z.sub(cab.deck).div(cab.cowl - cab.deck), 0.0, 1.0));

  // Glasshouse: side windows (minus the B / C pillars), windshield & backlight, their black seals, chrome sill strip
  let sideG = polygonDistance(p.z, p.y, sideGlassPlanes, 0.07);
  for (const zp of cab.pillars) sideG = max(sideG, float(0.036).sub(abs(p.z.sub(zp))));
  let backG = polygonDistance(ax, p.z, rearGlassPlanes, 0.09);
  if (cab.glassEnd !== undefined) {
    // no glass behind glassEnd: a painted cover over the rest of the glasshouse
    sideG = max(sideG, float(cab.glassEnd + 0.04).sub(p.z));
    backG = max(backG, float(cab.glassEnd).sub(p.z));
  }
  const backlight = coverage(backG).mul(isWindow);
  const glass = max(max(coverage(sideG), coverage(polygonDistance(ax, p.z, frontGlassPlanes, 0.09))), backlight.div(max(isWindow, 1e-4)))
    .mul(isWindow);
  const seal = max(
    coverage(polygonDistance(p.z, p.y, sideSealPlanes, 0.07)),
    max(coverage(polygonDistance(ax, p.z, frontSealPlanes, 0.09)), coverage(polygonDistance(ax, p.z, rearSealPlanes, 0.09)))
  ).mul(isWindow);
  const chromeBelt = spec.chrome
    ? smoothstep(0.003, 0.006, p.y.sub(belt))
      .mul(smoothstep(0.016, 0.012, p.y.sub(belt)))
      .mul(smoothstep(0.5, 0.7, abs(n.x)))
      .mul(step(cab.deck + 0.05, p.z))
      .mul(step(p.z, cab.cowl - 0.08))
      .mul(isWindow)
    : float(0.0);
  const chmsl = roundedRect(vec2(p.x, p.z.sub(cab.roofRear - 0.075)), vec2(0.14, 0.012), 0.005).mul(backlight).mul(step(n.z, -0.1));
  const rearWiper = spec.rearWiper
    ? roundedRect(vec2(p.x.add(0.15), p.z.sub(cab.deck + 0.075)), vec2(0.22, 0.006), 0.003).mul(backlight)
    : float(0.0);

  // Wheel arches: distance from the nearest axle in side view (or from the hub of a centred, spinning wheel)
  const isCenteredWheel = step(abs(p.z), wheelR.add(0.05)).mul(max(isTyre, isAlloy));
  const wheelVec = mix(vec2(abs(p.z).sub(axleZ), p.y.sub(wheelR)), vec2(p.z, p.y), isCenteredWheel);
  const wheelDist = length(wheelVec);

  // Lamps, grilles & plates on the nose and tail (projected along z, so the lamps wrap around the corners)
  const hlUV = vec2(ax.sub(hlX), p.y.sub(hlY));
  const headlight = roundedRect(hlUV, vec2(hlW, hlH), 0.01).mul(smoothstep(0.02, 0.25, n.z)).mul(step(frontZone, p.z)).mul(isBody);
  const turnFront = smoothstep(hlX + hlW * 0.65, hlX + hlW * 0.72, ax).mul(headlight);
  const divider = smoothstep(max(fwidth(ax), 0.007), 0.002, abs(hlUV.x.add(hlW * 0.1)));
  const headlightLens = roundedRect(hlUV, vec2(hlW - 0.012, hlH - 0.012), 0.006)
    .mul(headlight).mul(one.sub(max(divider, turnFront)));
  const drlDist = abs(hlUV.y.add(hlH * 0.6));
  const drlEdge = max(fwidth(drlDist), 0.006);
  const drl = smoothstep(drlEdge, 0.0, drlDist).mul(headlight).mul(one.sub(turnFront));
  const grille = roundedRect(vec2(p.x, p.y.sub(grY)), vec2(grW, grH), 0.015).mul(front);
  const intake = roundedRect(vec2(p.x, p.y.sub(inY)), vec2(inW, inH), 0.04).mul(front);
  const plateFront = roundedRect(vec2(p.x, p.y.sub(plateF)), vec2(0.155, 0.055), 0.008).mul(front);
  const tlUV = vec2(ax.sub(tlX), p.y.sub(tlY));
  const taillight = roundedRect(tlUV, vec2(tlW, tlH), 0.022)
    .mul(smoothstep(0.02, 0.25, n.z.negate()))
    .mul(step(p.z, rearZone))
    .mul(isBody);
  // Sedans use horizontal lenses; taller SUV lamps stack their three sections vertically.
  const tailAxis = tlH > tlW ? tlUV.y.div(tlH) : tlUV.x.div(tlW);
  const tailDivider = coverage(min(abs(tailAxis.sub(0.52)), abs(tailAxis.add(0.55))).sub(0.025));
  const tailLens = roundedRect(tlUV, vec2(tlW - 0.006, tlH - 0.006), 0.017)
    .mul(taillight).mul(one.sub(tailDivider));
  const turnRearSection = smoothstep(0.50, 0.54, tailAxis);
  const reverseRearSection = smoothstep(-0.53, -0.57, tailAxis);
  const turnRear = turnRearSection.mul(tailLens);
  const redLens = tailLens.mul(one.sub(max(turnRearSection, reverseRearSection)));
  const plateRear = roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(0.155, 0.06), 0.008).mul(rear);
  const platePocket = roundedRect(vec2(p.x, p.y.sub(plateR + 0.01)), vec2(0.235, 0.105), 0.03).mul(rear);
  const trunkHandle = roundedRect(vec2(p.x, p.y.sub(plateR + 0.125)), vec2(0.18, 0.012), 0.008).mul(rear);
  const plateRecess = max(
    roundedRect(vec2(p.x, p.y.sub(plateF)), vec2(0.175, 0.072), 0.012).mul(front),
    roundedRect(vec2(p.x, p.y.sub(plateR)), vec2(0.185, 0.082), 0.02).mul(rear)
  );
  const rearValance = smoothstep(rearSill + 0.07, rearSill + 0.015, p.y).mul(rear);
  const reflector = roundedRect(vec2(ax.sub(0.64), p.y.sub(spec.bumpers[1][0] + 0.065)), vec2(0.065, 0.012), 0.006).mul(rear);
  const trunkWidth = mix(float(tlX - tlW - 0.025), float(tlX), smoothstep(tlY - tlH, spec.tail.edge[1], p.y));
  const trunkEdge = max(ax.sub(trunkWidth), float(spec.bumperLine[1]).sub(p.y));
  const panelSeam = max(
    smoothstep(0.006, 0.0025, abs(p.y.sub(spec.bumperLine[0]))).mul(step(ax, hlX - hlW * 0.6)).mul(front),
    coverage(abs(trunkEdge).sub(0.003)).mul(rear)
  );
  const cowlPanel = smoothstep(cab.cowl + 0.085, cab.cowl + 0.07, p.z)
    .mul(smoothstep(cab.cowl - 0.04, cab.cowl - 0.02, p.z))
    .mul(step(0.6, n.y))
    .mul(isBody);
  const signFace = smoothstep(0.55, 0.75, abs(n.z)).mul(isSign);
  const signGlyph = step(0.42, sin(p.x.mul(90.0))).mul(step(ax, 0.17)).mul(smoothstep(0.045, 0.04, abs(p.y.sub(signY))));
  const mirrorGlass = isMirror.mul(step(0.55, n.z.negate()));
  const lamp = max(headlight, taillight);
  const plates = max(plateFront, plateRear);
  const cladding =
    spec.cladding > 0
      ? max(smoothstep(spec.cladding + 0.01, spec.cladding - 0.01, p.y), smoothstep(archR + 0.075, archR + 0.06, wheelDist))
        .mul(isBody)
        .mul(one.sub(lamp))
        .mul(one.sub(plates))
      : float(0.0);

  // 5-spoke alloys (branchless 5-ray star SDF) with rim ring & hub, lug ribs on the tyre tread
  const wDir = wheelVec.div(max(wheelDist, 0.0001));
  let spokes: Node<'float'> = float(0.0);
  for (let k = 0; k < 5; k++) {
    const ang = (k * Math.PI * 2) / 5;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const alongSpoke = wDir.x.mul(cs).add(wDir.y.mul(sn));
    const perp = abs(wDir.x.mul(sn).sub(wDir.y.mul(cs))).mul(wheelDist);
    spokes = max(spokes, smoothstep(0.034, 0.018, perp).mul(step(0.0, alongSpoke)));
  }
  const rimRing = smoothstep(wheelR.mul(0.56), wheelR.mul(0.6), wheelDist);
  const centerHub = smoothstep(0.068, 0.042, wheelDist);
  const centerCap = smoothstep(0.03, 0.018, wheelDist);
  const valveDot = smoothstep(0.028, 0.014, length(wheelVec.sub(vec2(0.0, wheelR.mul(-0.48)))));
  const alloyMetal = clamp(max(max(spokes, valveDot), max(rimRing, centerHub)).sub(centerCap.mul(0.85)), 0.0, 1.0);

  // Black plastic & rubber (grilles, seals, trims, tyres, cladding) is matte; lamps, glass & chrome are glossy
  const matte = max(
    max(max(isTyre, isTrim), max(intake, grille)),
    max(max(rearValance, under), max(max(cowlPanel, cladding), max(rearWiper, seal.mul(one.sub(max(glass, chromeBelt))))))
  );

  // ---- Colour ---------------------------------------------------------------------------------------------------
  // Liveries: NYPD (white with blue & light-blue side stripes, lettering on the front doors); the taxi's door badges
  // and medallion number
  const isPolice = step(0.5, livery).mul(isSide).mul(isBody);
  const doorMid = (spec.doors[0] + spec.doors[1]) / 2;
  const along = smoothstep(spec.zRear + 0.22, spec.zRear + 0.3, p.z).mul(smoothstep(spec.zFront - 0.28, spec.zFront - 0.36, p.z));
  const band = smoothstep(0.495, 0.5, p.y).mul(smoothstep(0.645, 0.64, p.y)).mul(along);
  const pin = smoothstep(0.663, 0.667, p.y).mul(smoothstep(0.687, 0.683, p.y)).mul(along);
  const lettering = step(0.45, sin(p.z.mul(70.0)))
    .mul(smoothstep(0.725, 0.73, p.y))
    .mul(smoothstep(0.81, 0.805, p.y))
    .mul(step(abs(p.z.sub(doorMid)), 0.22));
  let painted = mix(mix(paint, color(0x1d3f8f), max(band, lettering).mul(isPolice)), color(0x6fa8dc), pin.mul(isPolice));
  if (spec.sign) {
    const badge = roundedRect(vec2(p.z.sub(doorMid), p.y.sub(0.66)), vec2(0.21, 0.052), 0.012).mul(isSide).mul(isBody);
    const emblem = smoothstep(0.042, 0.036, length(vec2(abs(p.z.sub(doorMid)).sub(0.15), p.y.sub(0.66))));
    const letters = step(0.35, sin(p.z.mul(95.0)))
      .mul(step(abs(p.z.sub(doorMid)), 0.1))
      .mul(smoothstep(0.03, 0.026, abs(p.y.sub(0.66))));
    const medallion = step(0.3, sin(p.z.mul(150.0)))
      .mul(step(abs(p.z.sub(spec.zRear + 0.6)), 0.075))
      .mul(smoothstep(0.016, 0.013, abs(p.y.sub(0.8))))
      .mul(isSide)
      .mul(isBody);
    painted = mix(mix(painted, color(0x121417), badge), color(0xffbe14), max(emblem, letters).mul(badge));
    painted = mix(painted, color(0x121417), medallion);
  }

  // Panel shading: soft occlusion low down & under the arch lips; unpainted cladding (SUVs); door shut lines &
  // handles; trunk / hood shut lines; black cowl panel under the windshield
  const archLip = smoothstep(archR + 0.05, archR - 0.005, wheelDist).mul(smoothstep(0.6, 0.9, ax));
  const ao = smoothstep(0.2, 0.62, p.y).mul(0.22).add(0.78).mul(one.sub(archLip.mul(0.55)));
  const onDoors = isSide.mul(smoothstep(sillY + 0.04, sillY + 0.07, p.y)).mul(smoothstep(0.0, -0.015, p.y.sub(belt)));
  let seams: Node<'float'> = float(0.0);
  for (const zd of spec.doors) seams = max(seams, smoothstep(0.009, 0.003, abs(p.z.sub(zd))));
  for (const zh of spec.handles) {
    seams = max(seams, roundedRect(vec2(p.z.sub(zh), p.y.sub(belt.sub(0.095))), vec2(0.06, 0.011), 0.008));
  }
  let body = mix(painted.mul(ao), color(0x1e2124), cladding);
  body = body.mul(one.sub(seams.mul(onDoors).mul(0.55))).mul(one.sub(panelSeam.mul(0.5)));
  body = mix(body, color(0x15181b), cowlPanel);

  // Nose: slatted grilles and broad divided reflectors inside squared lamp housings, with outer amber indicators.
  const slats = step(0.5, fract(p.y.mul(42.0))).mul(0.4).add(0.6);
  body = mix(body, color(0x111417).mul(slats), max(intake, grille));
  const lensShade = smoothstep(0.0, hlH, abs(hlUV.y)).mul(0.35).add(0.65);
  const lampColor = mix(mix(color(0x30383e), color(0xc2ccd2).mul(lensShade), headlightLens), color(0xe4e9eb), drl);
  body = mix(body, mix(lampColor, color(0xc5802b), turnFront), headlight);
  // Tail: thin rubber seals around divided red, amber and clear lenses.
  const tailShade = smoothstep(0.0, tlH, abs(tlUV.y)).mul(-0.3).add(1.0);
  const tailColor = mix(mix(color(0xae1821).mul(tailShade), color(0xc56b18), turnRearSection), color(0xbac4c9), reverseRearSection);
  body = mix(body, color(0x15181b), rearValance);
  body = mix(body, color(0x7a0a10), reflector);
  body = mix(body, color(0x222326), taillight);
  body = mix(body, tailColor, tailLens);
  // Shaded recess and handle sit in the painted trunk / hatch, above the bumper.
  const pocketShade = smoothstep(plateR - 0.09, plateR + 0.115, p.y).mul(-0.25).add(0.9);
  body = mix(body, body.mul(pocketShade), platePocket);
  body = mix(body, color(0x303438), trunkHandle);
  body = mix(body, color(0x24292d), plateRecess);
  body = mix(body, color(0xf2b718), plates);
  const plateVariant = floor(fract(paint.r.mul(7).add(paint.g.mul(13)).add(paint.b.mul(17))).mul(4));
  const plateUV = vec2(p.x.div(-0.31).add(0.5), p.y.sub(plateR).div(0.12).add(0.5));
  const plateColor = texture(carPlateTexture(), vec2(plateUV.x, plateUV.y.add(plateVariant).div(4))).rgb;
  body = mix(body, plateColor, plateRear);
  body = mix(body, color(0x0e1013), under);

  // Glasshouse: tinted glass, black seals & B / C pillars, painted roof & A pillars, chrome sill strip, CHMSL
  const glassCol = mix(color(0x0a1016), color(0x1a2632), smoothstep(0.2, 0.9, n.y));
  let windowCol = mix(mix(mix(mix(paint, color(0x111315), seal), glassCol, glass), color(0xc9ced3), chromeBelt), color(0x6a0a0e), chmsl);
  windowCol = mix(windowCol, color(0x15181b), rearWiper);

  // Mirror caps (paint, glass facing back), taxi roof light, trims, alloys & tyres
  const mirrorCol = mix(paint, color(0x7c8a94), mirrorGlass);
  const signCol = mix(color(0xf3efe2), mix(color(0xfff1b8), color(0x15181b), signGlyph), signFace);
  const alloyCol = mix(color(0x0b0e12), color(0xd8e0e8), alloyMetal);
  const treadZone = smoothstep(wheelR.mul(0.74), wheelR.mul(0.83), wheelDist);
  const tyreBase = smoothstep(wheelR.mul(0.85), wheelR.mul(0.94), wheelDist).mul(0.22).add(0.78);
  const tyreCol = color(0x16181b).mul(tyreBase.add(spokes.mul(treadZone).mul(0.24)));

  // a crushed car's paint dulled and dirtied (scraped, dusty, oil-smoked) with its worst damage
  const crushed = crumple ? state.w.mul(0.5).floor() : null;
  const crush = (c: Node<'float'>, k: number) => mod(c.div(k).floor(), 16.0).div(15.0);
  const damage = crushed ? { x: crush(crushed, 1), y: crush(crushed, 16), z: crush(crushed, 256), w: crush(crushed, 4096) } : null;
  const worst = damage ? max(max(damage.x, damage.y), max(damage.z, damage.w)) : null;
  let col = worst ? mix(body, body.mul(0.42).add(color(0x26221e).mul(0.2)), worst.mul(0.7)) : body;
  col = mix(col, windowCol, isWindow);
  col = mix(col, mirrorCol, isMirror);
  col = mix(col, signCol, isSign);
  col = mix(col, color(0x1b1e21), isTrim);
  col = mix(col, alloyCol, isAlloy);
  col = mix(col, tyreCol, isTyre);
  const gore = blood ? bloodStains(p, n, spec, one.sub(isTyre).sub(isAlloy)) : null;
  if (gore) col = mix(col, mix(color(0x5c0709), color(0x2a0405), gore.dried), gore.cover.mul(0.94));

  // ---- Roughness & metalness ---------------------------------------------------------------------------------------
  const alloySpokes = max(spokes, rimRing).mul(isAlloy);
  const glossy = max(max(max(glass, chromeBelt), mirrorGlass), lamp);
  let rough = mix(float(0.26), float(0.15), glossy);
  rough = mix(rough, float(0.4), plates);
  rough = mix(rough, float(0.35), isSign);
  rough = mix(rough, float(0.82), max(matte, isAlloy.sub(alloySpokes)));

  let metal = mix(float(0.34), float(0.14), glass);
  metal = mix(metal, float(0.6), max(lamp, mirrorGlass));
  metal = mix(metal, float(0.95), chromeBelt);
  metal = mix(metal, float(0.86), alloySpokes);
  metal = mix(metal, float(0.08), plates);
  metal = mix(metal, float(0.04), max(matte, isSign));
  if (gore) {
    rough = mix(rough, float(0.2), gore.cover); // (wet, glossy)
    metal = mix(metal, float(0.0), gore.cover);
  }

  // ---- Emissive: running lights, tail / brake lights & CHMSL, turn signals, taxi roof light -----------------------
  const brake = state.x;
  const blink = max(state.y.mul(step(0.0, p.x)), state.z.mul(step(p.x, 0.0)));
  const nightHeadlamp = smoothstep(0.60, 1.15, cityUniforms.uInteriorGlow);
  const headlamps = color(0xfff8ec)
    .mul(headlightLens.mul(2.2).add(drl.mul(0.65)))
    .mul(nightHeadlamp)
    .mul(one.sub(turnFront.mul(blink)));
  const tail = color(0xff0a12).mul(redLens.mul(tailShade).mul(brake.mul(2.1).add(nightHeadlamp.mul(0.4))));
  const stop = color(0xff0a12).mul(chmsl.mul(brake).mul(2.1));
  const turn = color(0xff9a14).mul(max(turnFront, turnRear).mul(blink).mul(2.2));
  const sign = color(0xffe28a).mul(signFace.mul(one.sub(signGlyph.mul(0.9))).mul(1.65));

  const mat = new THREE.MeshStandardNodeMaterial();
  if (fixed) mat.userData.carState = stateUniform;
  if (gore) mat.userData.blood = gore.uniforms;
  if (damage) {
    // The crush: the end or side that was hit pushed in, most at its bumper or door skin and nothing ~0.9 m in, the
    // bonnet or boot folding down with it, wrinkled so it reads as bent sheet metal rather than a shorter car. The
    // wheels stay where they are (they are not part of the body)
    const hw = Math.max(...spec.halfWidth.map((h) => h[1]));
    const zf = float(spec.zFront), zr = float(spec.zRear), w = float(hw);
    const wrinkle = sin(p.y.mul(17.0).add(p.x.mul(9.0)).add(p.z.mul(5.0))).mul(0.3).add(0.85);
    const shell = one.sub(isTyre).sub(isAlloy);
    // (as the square root of the damage: the first hard knock already shows, the next ones crush it further)
    const inF = damage.x.sqrt().mul(smoothstep(zf.sub(1.0), zf, p.z)).mul(0.55);
    const inR = damage.y.sqrt().mul(smoothstep(zr.add(1.0), zr, p.z)).mul(0.48);
    const inL = damage.z.sqrt().mul(smoothstep(w.sub(0.55), w, p.x)).mul(0.3);
    const inRt = damage.w.sqrt().mul(smoothstep(w.negate().add(0.55), w.negate(), p.x)).mul(0.3);
    const fold = inF.add(inR).mul(smoothstep(0.55, 1.1, p.y)).mul(0.45);
    const crushedPosition = p.add(vec3(inRt.sub(inL), fold.negate(), inR.sub(inF)).mul(wrinkle).mul(shell));
    // Applied before the instance matrix, in the car's own frame. (Not as positionNode: three.js assigns that after
    // instancing, so a positionNode built from the bare vertex drew every car's body at the origin, leaving the
    // separately instanced wheels driving round on their own.)
    const setupPosition = mat.setupPosition.bind(mat);
    mat.setupPosition = (builder) => {
      positionLocal.assign(crushedPosition);
      return setupPosition(builder);
    };
  }
  mat.colorNode = col;
  mat.roughnessNode = rough;
  mat.metalnessNode = metal;
  mat.emissiveNode = headlamps.add(tail).add(stop).add(turn).add(sign);

  if (!blood) _carMaterialCache.set(cacheKey, mat);
  return mat;
}
