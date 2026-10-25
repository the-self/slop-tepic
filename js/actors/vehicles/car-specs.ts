import { BODY_SHAPES } from '../../models/bodies.ts';
import type { BodySpec } from '../../models/bodies.ts';

// js/actors/vehicles/car-specs.ts
// The car bodies' design tables: the parts their material paints (CAR_PARTS) and the body specs (BODY_SPECS: the sedan,
// the taxi and the car models' other shapes from models/bodies.ts).

// ============================================================================
// 2. LOFTED VEHICLE GEOMETRY & TSL MATERIAL
// ============================================================================
// Car bodies are lofted from ~45 cross-sections generated along the car out of a few smooth side- & plan-view curves
// (monotone cubic splines) plus elliptical roundings into the nose and tail: rounded plan-view corners, a hood that
// rolls down into the fascia, a tucked-in sill, crowned hood & deck, fender flares and circular wheel arches. A second,
// open loft sits on the belt line as the glasshouse (raked windshield & backlight, tumblehome side glass, crowned roof
// with rounded rails). All the detail (glass, seals, pillars, lamps, grilles, plates, door seams, NYPD & taxi liveries,
// brake lights & turn signals) is painted by one TSL material from object-space position & normal, so each body type
// stays a single instanced draw call.
// (each vertex's `partId`: what the car material paints it as)
export const CAR_PARTS = {
  BODY: 0,
  WINDOW: 1,
  TYRE: 2,
  ALLOY: 3,
  TRIM: 4,
  MIRROR: 5,
  SIGN: 6,
  FRONT: 7,
  REAR: 8
};

// Design tables. Curves are [z, value] control points (z = +front); nose / tail entries are [length, tip value,
// superellipse exponent] roundings of the same quantities into the tips.
export const BODY_SPECS: Record<string, BodySpec> = {
  sedan: {
    name: 'sedan',
    zFront: 2.25,
    zRear: -2.25,
    wheelRadius: 0.35,
    wheelZ: 1.38,
    wheelX: 0.83,
    archGap: 0.065, // wheel arch radius = wheelRadius + archGap
    archFlare: 0.02, // extra half-width over the wheels
    tuck: 0.075, // sill tucked in from the widest point
    halfWidth: [[2.25, 0.91], [1.38, 0.922], [0, 0.928], [-1.38, 0.926], [-2.25, 0.915]],
    sill: [[2.25, 0.29], [1.2, 0.265], [-1.2, 0.265], [-2.25, 0.3]],
    shoulder: [[2.25, 0.66], [0, 0.7], [-2.25, 0.76]],
    edge: [[2.1, 0.79], [1.5, 0.85], [0.85, 0.935], [0.55, 0.955], [-1.0, 0.985], [-1.62, 0.975], [-2.1, 0.91]],
    crown: [[2.1, 0.035], [0.95, 0.03], [0.66, 0.004], [-1.56, 0.004], [-1.78, 0.016], [-2.25, 0.012]],
    tumble: [[2.25, 0.11], [0.9, 0.09], [-1.6, 0.085], [-2.25, 0.105]],
    nose: { halfWidth: [0.3, 0.7, 3], edge: [0.12, 0.77, 3], crown: [0.12, 0.01, 2], sill: [0.13, 0.33, 2], shoulder: [0.2, 0.59, 2.4] },
    tail: { halfWidth: [0.3, 0.72, 2.6], edge: [0.11, 0.905, 3], crown: [0.11, 0.008, 2], sill: [0.14, 0.35, 2], shoulder: [0.2, 0.69, 2.4] },
    cabin: {
      cowl: 0.86,
      roofFront: 0.0,
      roofRear: -1.0,
      deck: -1.68,
      roofY: [[0.0, 1.435], [-0.5, 1.455], [-1.0, 1.42]],
      rail: [0.645, 0.625], // roof rail half-width at the front & rear of the roof
      inset: 0.035, // side glass base inset from the body's top edge
      bulge: 0.012, // side glass outward curvature
      roofEdge: 0.05, // roof rail rounding height
      roofCrown: 0.035,
      roofRound: 4,
      pillars: [-0.3] // B (and C) pillar centres
    },
    doors: [0.84, -0.3, -1.02], // door shut lines
    handles: [-0.13, -0.86],
    headlight: [0.59, 0.69, 0.23, 0.055], // centre |x|, y, half-width, half-height
    taillight: [0.575, 0.795, 0.255, 0.064],
    grille: [0.68, 0.31, 0.06], // upper grille between the headlights: y, half-width, half-height
    intake: [0.37, 0.46, 0.045], // lower grille
    plates: [0.555, 0.68], // front / rear plate centre heights
    bumperLine: [0.775, 0.565], // hood / bumper and trunk / bumper shut lines on the nose & tail
    bumpers: [[0.46, 0.03], [0.49, 0.035]], // front / rear trim: centre height, half-height
    chrome: true, // chrome strip along the side windows' sills
    cladding: 0, // height of the unpainted lower body cladding (SUVs)
    sign: false,
    rails: false,
    rearWiper: false
  },
  suv: {
    name: 'suv',
    zFront: 2.3,
    zRear: -2.3,
    wheelRadius: 0.39,
    wheelZ: 1.4,
    wheelX: 0.87,
    archGap: 0.075,
    archFlare: 0.03,
    tuck: 0.07,
    halfWidth: [[2.3, 0.948], [1.4, 0.96], [0, 0.966], [-1.4, 0.964], [-2.3, 0.956]],
    sill: [[2.3, 0.39], [1.2, 0.35], [-1.2, 0.35], [-2.3, 0.41]],
    shoulder: [[2.3, 0.8], [0, 0.84], [-2.3, 0.88]],
    edge: [[2.1, 0.99], [1.5, 1.045], [0.85, 1.1], [0.6, 1.12], [-1.0, 1.145], [-2.0, 1.175], [-2.3, 1.18]],
    crown: [[2.1, 0.035], [0.9, 0.03], [0.6, 0.004], [-2.3, 0.004]],
    tumble: [[2.3, 0.1], [0.9, 0.08], [-2.3, 0.08]],
    nose: { halfWidth: [0.27, 0.76, 3], edge: [0.13, 0.96, 3], crown: [0.13, 0.01, 2], sill: [0.12, 0.42, 2], shoulder: [0.2, 0.74, 2.4] },
    tail: { halfWidth: [0.24, 0.8, 2.6], edge: [0.08, 1.13, 3], crown: [0.08, 0, 2], sill: [0.14, 0.44, 2], shoulder: [0.18, 0.84, 2.4] },
    cabin: {
      cowl: 0.8,
      roofFront: 0.08,
      roofRear: -1.96,
      deck: -2.2,
      roofY: [[0.08, 1.735], [-0.9, 1.76], [-1.96, 1.745]],
      rail: [0.71, 0.7],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.055,
      roofCrown: 0.03,
      roofRound: 4,
      pillars: [-0.3, -1.18]
    },
    doors: [0.78, -0.3, -1.18],
    handles: [-0.13, -1.0],
    headlight: [0.64, 0.86, 0.235, 0.065],
    taillight: [0.745, 0.985, 0.105, 0.13],
    grille: [0.83, 0.36, 0.095],
    intake: [0.465, 0.44, 0.04],
    plates: [0.66, 0.82],
    bumperLine: [0.965, 0.655],
    bumpers: [[0.56, 0.04], [0.56, 0.04]],
    chrome: false,
    cladding: 0.5,
    sign: false,
    rails: true,
    rearWiper: true
  },
  // Crew-cab pickup with its bed under a tonneau cover (the body runs flat behind the cab at the bed rails)
  pickup: {
    name: 'pickup',
    zFront: 2.6,
    zRear: -2.6,
    wheelRadius: 0.4,
    wheelZ: 1.58,
    wheelX: 0.88,
    archGap: 0.08,
    archFlare: 0.035,
    tuck: 0.06,
    halfWidth: [[2.6, 0.95], [1.58, 0.965], [0, 0.97], [-1.58, 0.968], [-2.6, 0.962]],
    sill: [[2.6, 0.44], [1.2, 0.42], [-1.2, 0.42], [-2.6, 0.5]],
    shoulder: [[2.6, 0.84], [0, 0.88], [-2.6, 0.9]],
    edge: [[2.4, 1.02], [1.6, 1.07], [1.0, 1.12], [0.6, 1.14], [-0.9, 1.16], [-2.4, 1.18], [-2.6, 1.18]],
    crown: [[2.4, 0.035], [1.1, 0.03], [0.85, 0.004], [-2.6, 0.004]],
    tumble: [[2.6, 0.08], [0.9, 0.07], [-2.6, 0.04]],
    nose: { halfWidth: [0.22, 0.78, 3], edge: [0.1, 0.98, 3], crown: [0.1, 0.01, 2], sill: [0.1, 0.48, 2], shoulder: [0.16, 0.8, 2.4] },
    tail: { halfWidth: [0.12, 0.88, 3], edge: [0.05, 1.15, 3], crown: [0.05, 0, 2], sill: [0.1, 0.54, 2], shoulder: [0.1, 0.88, 2.4] },
    cabin: {
      cowl: 0.95,
      roofFront: 0.25,
      roofRear: -0.62,
      deck: -0.8,
      roofY: [[0.25, 1.86], [-0.2, 1.88], [-0.62, 1.87]],
      rail: [0.72, 0.72],
      inset: 0.04,
      bulge: 0.01,
      roofEdge: 0.055,
      roofCrown: 0.03,
      roofRound: 4.5,
      pillars: [-0.12]
    },
    doors: [0.92, -0.12, -0.78],
    handles: [0.06, -0.6],
    headlight: [0.66, 0.9, 0.22, 0.075],
    taillight: [0.82, 0.92, 0.07, 0.17],
    grille: [0.82, 0.42, 0.13],
    intake: [0.52, 0.42, 0.04],
    plates: [0.64, 0.7],
    bumperLine: [0.99, 0.6],
    bumpers: [[0.58, 0.06], [0.6, 0.06]],
    chrome: false,
    cladding: 0.52,
    sign: false,
    rails: false,
    rearWiper: false
  },
  // Passenger van (the combis of Mexican public transport): a short nose, the glasshouse over its whole length
  van: {
    name: 'van',
    zFront: 2.45,
    zRear: -2.45,
    wheelRadius: 0.36,
    wheelZ: 1.5,
    wheelX: 0.85,
    archGap: 0.07,
    archFlare: 0.02,
    tuck: 0.06,
    halfWidth: [[2.45, 0.92], [1.5, 0.94], [0, 0.945], [-1.5, 0.944], [-2.45, 0.94]],
    sill: [[2.45, 0.42], [1.2, 0.38], [-1.2, 0.38], [-2.45, 0.44]],
    shoulder: [[2.45, 0.78], [0, 0.82], [-2.45, 0.84]],
    edge: [[2.4, 0.98], [2.1, 1.08], [1.9, 1.12], [0, 1.14], [-2.45, 1.15]],
    crown: [[2.45, 0.03], [2.1, 0.02], [1.95, 0.004], [-2.45, 0.004]],
    tumble: [[2.45, 0.08], [1.8, 0.06], [-2.45, 0.05]],
    nose: { halfWidth: [0.2, 0.74, 3], edge: [0.1, 0.94, 3], crown: [0.1, 0.01, 2], sill: [0.1, 0.46, 2], shoulder: [0.14, 0.74, 2.4] },
    tail: { halfWidth: [0.1, 0.86, 3], edge: [0.05, 1.12, 3], crown: [0.05, 0, 2], sill: [0.1, 0.5, 2], shoulder: [0.1, 0.82, 2.4] },
    cabin: {
      cowl: 1.98,
      roofFront: 1.4,
      roofRear: -2.22,
      deck: -2.36,
      roofY: [[1.4, 2.0], [-0.4, 2.03], [-2.22, 2.0]],
      rail: [0.82, 0.84],
      inset: 0.03,
      bulge: 0.008,
      roofEdge: 0.06,
      roofCrown: 0.03,
      roofRound: 5,
      pillars: [0.9, -0.15, -1.2]
    },
    doors: [1.95, 0.9, -0.15, -2.4],
    handles: [1.1, -0.35],
    headlight: [0.64, 0.84, 0.2, 0.07],
    taillight: [0.83, 0.92, 0.07, 0.16],
    grille: [0.74, 0.36, 0.08],
    intake: [0.48, 0.42, 0.04],
    plates: [0.6, 0.72],
    bumperLine: [0.95, 0.62],
    bumpers: [[0.52, 0.05], [0.55, 0.05]],
    chrome: false,
    cladding: 0,
    sign: false,
    rails: false,
    rearWiper: true
  },
  // Small five-door hatchback
  hatch: {
    name: 'hatch',
    zFront: 1.95,
    zRear: -1.95,
    wheelRadius: 0.32,
    wheelZ: 1.24,
    wheelX: 0.78,
    archGap: 0.06,
    archFlare: 0.02,
    tuck: 0.07,
    halfWidth: [[1.95, 0.84], [1.24, 0.86], [0, 0.865], [-1.24, 0.864], [-1.95, 0.85]],
    sill: [[1.95, 0.28], [1.0, 0.26], [-1.0, 0.26], [-1.95, 0.3]],
    shoulder: [[1.95, 0.64], [0, 0.68], [-1.95, 0.72]],
    edge: [[1.8, 0.78], [1.3, 0.83], [0.75, 0.92], [0.5, 0.94], [-1.0, 0.97], [-1.95, 0.98]],
    crown: [[1.8, 0.035], [0.85, 0.03], [0.6, 0.004], [-1.95, 0.004]],
    tumble: [[1.95, 0.1], [0.8, 0.09], [-1.95, 0.09]],
    nose: { halfWidth: [0.28, 0.66, 3], edge: [0.12, 0.74, 3], crown: [0.12, 0.01, 2], sill: [0.12, 0.32, 2], shoulder: [0.18, 0.58, 2.4] },
    tail: { halfWidth: [0.18, 0.72, 2.8], edge: [0.06, 0.95, 3], crown: [0.06, 0, 2], sill: [0.12, 0.34, 2], shoulder: [0.14, 0.7, 2.4] },
    cabin: {
      cowl: 0.78,
      roofFront: -0.02,
      roofRear: -1.36,
      deck: -1.84,
      roofY: [[-0.02, 1.47], [-0.7, 1.49], [-1.36, 1.46]],
      rail: [0.62, 0.6],
      inset: 0.035,
      bulge: 0.012,
      roofEdge: 0.05,
      roofCrown: 0.035,
      roofRound: 4,
      pillars: [-0.36]
    },
    doors: [0.76, -0.36, -1.22],
    handles: [-0.18, -1.04],
    headlight: [0.55, 0.7, 0.2, 0.055],
    taillight: [0.7, 0.86, 0.1, 0.11],
    grille: [0.68, 0.28, 0.05],
    intake: [0.36, 0.42, 0.045],
    plates: [0.52, 0.66],
    bumperLine: [0.77, 0.56],
    bumpers: [[0.44, 0.03], [0.46, 0.035]],
    chrome: false,
    cladding: 0,
    sign: false,
    rails: false,
    rearWiper: true
  }
};
BODY_SPECS.taxi = Object.assign({}, BODY_SPECS.sedan, { name: 'taxi', sign: true });
// The car models' other body shapes (js/models/bodies.ts), each a set of changes to the sedan or the SUV
for (const [name, shape] of Object.entries(BODY_SHAPES)) {
  const { base, ...changes } = shape;
  BODY_SPECS[name] = Object.assign({}, BODY_SPECS[base], changes, { name });
}
for (const spec of Object.values(BODY_SPECS)) {
  // Kept for code that places lamp flares: lamp heights (front, rear) and centres across the car
  spec.lamps = [spec.headlight[1], spec.taillight[1]];
  spec.lampX = [spec.headlight[0], spec.taillight[0]];
}
