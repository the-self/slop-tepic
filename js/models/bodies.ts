// js/models/bodies.js
// The body shapes the car models (cars/) are drawn with, besides actor-models.js's own sedan, taxi, SUV, pickup, van &
// hatchback: each is the lofted generator's spec (see BODY_SPECS there for what every curve means) as changes to
// `base`. A model is one of these stretched to its real length, width & height, so one shape (one material, one
// instanced mesh in the traffic) serves many cars. Plain data, no three.js.
//
// Frame: metres, +z ahead (zFront > 0 > zRear), y up from the ground, curves as [z, value] points.

export const BODY_SHAPES = {

  // Low sports coupé / fastback (Mustang, Camaro, Supra, M4, 911): long bonnet, two doors
  coupe: {
    base: 'sedan',
    zFront: 2.3, zRear: -2.3, wheelRadius: 0.34, wheelZ: 1.42, wheelX: 0.85, archGap: 0.06, archFlare: 0.05,
    halfWidth: [[2.3, 0.9], [1.42, 0.95], [0, 0.93], [-1.42, 0.96], [-2.3, 0.92]],
    sill: [[2.3, 0.22], [1.2, 0.2], [-1.2, 0.2], [-2.3, 0.25]],
    shoulder: [[2.3, 0.52], [0, 0.58], [-2.3, 0.62]],
    edge: [[2.15, 0.66], [1.5, 0.72], [0.7, 0.78], [0.4, 0.8], [-1.0, 0.84], [-1.7, 0.86], [-2.15, 0.84]],
    crown: [[2.1, 0.04], [0.7, 0.03], [0.45, 0.004], [-2.3, 0.004]],
    tumble: [[2.3, 0.1], [0.7, 0.1], [-2.3, 0.08]],
    nose: { halfWidth: [0.32, 0.7, 3], edge: [0.18, 0.62, 3], crown: [0.15, 0.01, 2], sill: [0.14, 0.26, 2], shoulder: [0.22, 0.48, 2.4] },
    tail: { halfWidth: [0.26, 0.78, 2.6], edge: [0.08, 0.84, 3], crown: [0.08, 0.0, 2], sill: [0.14, 0.3, 2], shoulder: [0.18, 0.6, 2.4] },
    cabin: {
      cowl: 0.7, roofFront: -0.3, roofRear: -0.75, deck: -1.75,
      roofY: [[-0.3, 1.3], [-0.5, 1.31], [-0.75, 1.29]], rail: [0.6, 0.57],
      inset: 0.035, bulge: 0.012, roofEdge: 0.05, roofCrown: 0.03, roofRound: 4, pillars: [-0.95]
    },
    doors: [0.66, -0.75], handles: [-0.6],
    headlight: [0.6, 0.6, 0.22, 0.035], taillight: [0.58, 0.74, 0.24, 0.045],
    grille: [0.42, 0.38, 0.08], intake: [0.28, 0.5, 0.04], plates: [0.4, 0.62],
    bumperLine: [0.6, 0.5], bumpers: [[0.32, 0.025], [0.38, 0.03]],
    chrome: false
  },

  // Smooth electric fastback sedan (Tesla Model 3): short nose with no grille, long glass roof
  fastback: {
    base: 'sedan',
    zFront: 2.35, zRear: -2.35, wheelRadius: 0.34, wheelZ: 1.44, wheelX: 0.84,
    halfWidth: [[2.35, 0.88], [1.44, 0.92], [0, 0.925], [-1.44, 0.925], [-2.35, 0.9]],
    sill: [[2.35, 0.27], [1.2, 0.25], [-1.2, 0.25], [-2.35, 0.3]],
    shoulder: [[2.35, 0.56], [0, 0.66], [-2.35, 0.74]],
    edge: [[2.2, 0.7], [1.5, 0.79], [1.0, 0.88], [0.0, 0.96], [-1.6, 0.98], [-2.2, 0.95]],
    crown: [[2.2, 0.05], [1.05, 0.035], [0.95, 0.004], [-2.35, 0.004]],
    tumble: [[2.35, 0.1], [0.9, 0.1], [-2.35, 0.09]],
    nose: { halfWidth: [0.34, 0.66, 3], edge: [0.22, 0.62, 3], crown: [0.2, 0.01, 2], sill: [0.15, 0.3, 2], shoulder: [0.25, 0.5, 2.4] },
    tail: { halfWidth: [0.26, 0.76, 2.6], edge: [0.08, 0.94, 3], crown: [0.08, 0.0, 2], sill: [0.14, 0.34, 2], shoulder: [0.18, 0.66, 2.4] },
    cabin: {
      cowl: 1.0, roofFront: 0.15, roofRear: -0.9, deck: -1.85,
      roofY: [[0.15, 1.42], [-0.35, 1.44], [-0.9, 1.41]], rail: [0.66, 0.62],
      inset: 0.035, bulge: 0.012, roofEdge: 0.05, roofCrown: 0.035, roofRound: 4, pillars: [-0.3]
    },
    doors: [0.95, -0.3, -1.15], handles: [-0.15, -0.95],
    headlight: [0.62, 0.66, 0.2, 0.035], taillight: [0.6, 0.86, 0.25, 0.045],
    grille: [0.5, 0.001, 0.001], intake: [0.32, 0.45, 0.04], plates: [0.42, 0.68],
    bumperLine: [0.66, 0.6], bumpers: [[0.36, 0.02], [0.45, 0.02]],
    chrome: false
  },

  // The Cybertruck's stainless wedge: flat panels, sharp edges, a light bar across each end, the roof peaking over the
  // front seats and the vault cover sloping straight down to the tail (glass only over the cabin)
  wedge: {
    base: 'suv',
    zFront: 2.85, zRear: -2.85, wheelRadius: 0.44, wheelZ: 1.85, wheelX: 0.88, archGap: 0.06, archFlare: 0, tuck: 0.02,
    lowerRound: 8, upperRound: 10,
    halfWidth: [[2.85, 0.98], [1.85, 1.0], [0, 1.0], [-1.85, 1.0], [-2.85, 0.99]],
    sill: [[2.85, 0.62], [1.6, 0.5], [-1.6, 0.5], [-2.85, 0.62]],
    shoulder: [[2.85, 0.9], [0, 0.98], [-2.85, 0.98]],
    edge: [[2.75, 1.0], [2.0, 1.1], [1.3, 1.2], [0, 1.22], [-2.75, 1.2]],
    crown: [[2.8, 0.01], [-2.8, 0.01]],
    tumble: [[2.85, 0.06], [-2.85, 0.06]],
    nose: { halfWidth: [0.08, 0.94, 6], edge: [0.06, 0.98, 6], crown: [0.05, 0.005, 2], sill: [0.08, 0.62, 2], shoulder: [0.06, 0.9, 2] },
    tail: { halfWidth: [0.06, 0.96, 6], edge: [0.05, 1.18, 6], crown: [0.05, 0, 2], sill: [0.06, 0.62, 2], shoulder: [0.05, 0.96, 2] },
    cabin: {
      cowl: 1.3, roofFront: -0.15, roofRear: -0.3, deck: -2.8,
      roofY: [[-0.15, 1.79], [-0.22, 1.8], [-0.3, 1.79]], rail: [0.8, 0.8],
      inset: 0.02, bulge: 0, roofEdge: 0.02, roofCrown: 0.01, roofRound: 12, pillars: [-0.75],
      glassEnd: -1.1 // side windows & backlight stop here; the vault cover behind is painted
    },
    doors: [1.2, -0.15, -1.3], handles: [],
    headlight: [0.5, 1.0, 0.5, 0.012], taillight: [0.5, 1.16, 0.5, 0.018],
    grille: [0.8, 0.001, 0.001], intake: [0.66, 0.6, 0.03], plates: [0.75, 0.85],
    bumperLine: [0.9, 0.75], bumpers: [[0.7, 0.01], [0.7, 0.01]],
    cladding: 0, chrome: false, rails: false, rearWiper: false
  },

  // Electric crossover (Tesla Model Y): the Model 3's smooth, grille-less nose raised on an SUV's height, the windshield
  // starting far forward, the roof peaking over the front seats and falling in one long slope of glass to a short
  // tail with its lip spoiler; slim lamps, painted sills
  crossover: {
    base: 'suv',
    zFront: 2.3, zRear: -2.3, wheelRadius: 0.37, wheelZ: 1.44, wheelX: 0.86, archGap: 0.07, archFlare: 0.025, tuck: 0.06,
    halfWidth: [[2.3, 0.92], [1.44, 0.955], [0, 0.96], [-1.44, 0.962], [-2.3, 0.93]],
    sill: [[2.3, 0.38], [1.2, 0.34], [-1.2, 0.34], [-2.3, 0.42]],
    shoulder: [[2.3, 0.74], [0, 0.86], [-2.3, 0.94]],
    edge: [[2.2, 0.86], [1.6, 0.95], [1.1, 1.02], [0.4, 1.06], [-1.2, 1.1], [-2.0, 1.12], [-2.25, 1.1]],
    crown: [[2.2, 0.05], [1.2, 0.035], [1.1, 0.004], [-2.3, 0.004]],
    tumble: [[2.3, 0.1], [1.0, 0.11], [-2.3, 0.1]],
    nose: { halfWidth: [0.34, 0.68, 3], edge: [0.24, 0.76, 3], crown: [0.2, 0.01, 2], sill: [0.14, 0.4, 2], shoulder: [0.26, 0.64, 2.4] },
    tail: { halfWidth: [0.24, 0.8, 2.6], edge: [0.08, 1.08, 3], crown: [0.08, 0, 2], sill: [0.14, 0.46, 2], shoulder: [0.18, 0.88, 2.4] },
    cabin: {
      cowl: 1.1, roofFront: 0.3, roofRear: -0.7, deck: -2.1,
      roofY: [[0.3, 1.6], [-0.2, 1.62], [-0.7, 1.59]], rail: [0.68, 0.6],
      inset: 0.035, bulge: 0.014, roofEdge: 0.05, roofCrown: 0.04, roofRound: 4, pillars: [-0.32, -1.32]
    },
    doors: [1.06, -0.32, -1.3], handles: [-0.18, -1.12],
    headlight: [0.64, 0.83, 0.21, 0.032], taillight: [0.62, 1.03, 0.28, 0.035],
    grille: [0.6, 0.001, 0.001], intake: [0.4, 0.5, 0.045], plates: [0.5, 0.86],
    bumperLine: [0.8, 0.76], bumpers: [[0.44, 0.02], [0.54, 0.02]],
    chrome: false, cladding: 0, rails: false, rearWiper: false
  },

  // Mid-engined supercar (Lamborghini Huracán, Ferrari F8, Corvette C8): a low, short nose, the cabin pushed forward
  // with its windshield almost flat, a short roof, and the engine cover behind it sloping to a high, wide tail over
  // the rear haunches (no glass behind the seats but a small window)
  supercar: {
    base: 'sedan',
    zFront: 2.25, zRear: -2.25, wheelRadius: 0.34, wheelZ: 1.32, wheelX: 0.86, archGap: 0.05, archFlare: 0.06, tuck: 0.08,
    halfWidth: [[2.25, 0.84], [1.32, 0.92], [0, 0.91], [-1.32, 0.98], [-2.25, 0.94]],
    sill: [[2.25, 0.15], [1.2, 0.15], [-1.2, 0.16], [-2.25, 0.26]],
    shoulder: [[2.25, 0.4], [0, 0.54], [-2.25, 0.66]],
    edge: [[2.1, 0.5], [1.5, 0.62], [1.0, 0.71], [0.6, 0.75], [-0.6, 0.8], [-1.6, 0.85], [-2.1, 0.84]],
    crown: [[2.1, 0.04], [1.05, 0.03], [0.95, 0.004], [-2.25, 0.004]],
    tumble: [[2.25, 0.14], [0.8, 0.17], [-2.25, 0.12]],
    nose: { halfWidth: [0.42, 0.6, 3], edge: [0.3, 0.42, 2.6], crown: [0.2, 0.01, 2], sill: [0.12, 0.17, 2], shoulder: [0.3, 0.34, 2.4] },
    tail: { halfWidth: [0.18, 0.86, 3], edge: [0.06, 0.83, 3], crown: [0.06, 0, 2], sill: [0.12, 0.3, 2], shoulder: [0.14, 0.62, 2.4] },
    cabin: {
      cowl: 1.0, roofFront: 0.05, roofRear: -0.45, deck: -1.9,
      roofY: [[0.05, 1.14], [-0.2, 1.16], [-0.45, 1.14]], rail: [0.58, 0.52],
      inset: 0.03, bulge: 0.016, roofEdge: 0.04, roofCrown: 0.03, roofRound: 4, pillars: [],
      glassEnd: -0.8 // the engine cover behind is painted
    },
    doors: [0.92, -0.78], handles: [],
    headlight: [0.64, 0.5, 0.22, 0.028], taillight: [0.6, 0.74, 0.3, 0.028],
    grille: [0.4, 0.001, 0.001], intake: [0.26, 0.6, 0.065], plates: [0.32, 0.52],
    bumperLine: [0.47, 0.46], bumpers: [[0.22, 0.02], [0.3, 0.02]],
    chrome: false
  },

  // Square-rigged 4×4 (Jeep Wrangler, Ford Bronco): a flat upright nose and grille, a flat bonnet, an almost upright
  // windshield, a flat roof over the whole cabin and a flat tail; big wheels under black fender flares, black bumpers
  offroad: {
    base: 'suv',
    zFront: 2.35, zRear: -2.35, wheelRadius: 0.46, wheelZ: 1.5, wheelX: 0.86, archGap: 0.08, archFlare: 0.07, tuck: 0.04,
    lowerRound: 6, upperRound: 8,
    halfWidth: [[2.35, 0.9], [1.5, 0.92], [0, 0.92], [-1.5, 0.92], [-2.35, 0.91]],
    sill: [[2.35, 0.56], [1.3, 0.52], [-1.3, 0.52], [-2.35, 0.58]],
    shoulder: [[2.35, 0.86], [0, 0.88], [-2.35, 0.9]],
    edge: [[2.3, 1.14], [1.6, 1.16], [1.0, 1.18], [-2.3, 1.2]],
    crown: [[2.3, 0.012], [1.0, 0.01], [0.95, 0.004], [-2.35, 0.004]],
    tumble: [[2.35, 0.03], [-2.35, 0.03]],
    nose: { halfWidth: [0.08, 0.84, 6], edge: [0.05, 1.1, 6], crown: [0.05, 0.005, 2], sill: [0.08, 0.52, 2], shoulder: [0.06, 0.84, 2] },
    tail: { halfWidth: [0.06, 0.86, 6], edge: [0.04, 1.16, 6], crown: [0.04, 0, 2], sill: [0.06, 0.54, 2], shoulder: [0.05, 0.88, 2] },
    cabin: {
      cowl: 0.98, roofFront: 0.76, roofRear: -2.2, deck: -2.3,
      roofY: [[0.76, 1.85], [-0.7, 1.86], [-2.2, 1.85]], rail: [0.82, 0.82],
      inset: 0.02, bulge: 0, roofEdge: 0.03, roofCrown: 0.01, roofRound: 10, pillars: [-0.2, -1.22]
    },
    doors: [0.94, -0.2, -1.24], handles: [0.0, -1.04],
    headlight: [0.62, 0.98, 0.11, 0.1], taillight: [0.84, 0.9, 0.06, 0.14],
    grille: [0.96, 0.42, 0.12], intake: [0.62, 0.44, 0.035], plates: [0.66, 0.8],
    bumperLine: [1.1, 0.72], bumpers: [[0.6, 0.08], [0.62, 0.08]],
    chrome: false, cladding: 0.62, rails: false, rearWiper: true
  }
};
