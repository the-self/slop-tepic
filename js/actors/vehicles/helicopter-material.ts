import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  color,
  attribute,
  abs,
  fract,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  fwidth
} from 'three/tsl';
import { HELI_PARTS } from './helicopter-geometry.ts';
import { roundedRect } from './tsl-shapes.ts';

// js/actors/vehicles/helicopter-material.ts
// The sightseeing helicopter's TSL material: its glass, livery, cowling intakes, fins, rotors and skids.

let _heliLoftedMat: THREE.MeshStandardNodeMaterial | null = null;

/**
 * Creates the TSL procedural material for the 3D Lofted Sightseeing Helicopter:
 * - Renders wrap-around panoramic windscreen, chin bubble windows, sightseeing cabin side windows,
 *   and overhead skylight glass using anti-aliased `roundedRect` SDFs with rubber seals & frame pillars.
 * - Renders a sleek flush executive NYC Sightseeing livery (Pearl Aviation White upper cabin,
 *   Deep Midnight Navy belly/tailboom, and a sweeping Metallic Gold & Crimson accent stripe).
 * - Renders slatted turbine air intakes on the engine cowling and high-visibility yellow tips on rotor blades.
 */
export function createLoftedHelicopterMaterial(): THREE.MeshStandardNodeMaterial {
  if (_heliLoftedMat) return _heliLoftedMat;

  const mat = new THREE.MeshStandardNodeMaterial();

  const evaluateHeliSurface = Fn(() => {
    const partId = attribute('partId', 'float');
    const isCowling = step(abs(partId.sub(HELI_PARTS.COWLING)), 0.25);
    const isFin = step(abs(partId.sub(HELI_PARTS.FIN)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);

    const p = attribute('position', 'vec3').toVar();
    const n = attribute('normal', 'vec3').toVar();

    // 1. Panoramic Wrap-Around Cockpit Windscreen & Sightseeing Side Cabin Windows (on Fuselage)
    // Front windscreen: z in [0.95, 2.52], y in [0.98, 1.88], split by narrow center post at x = 0
    const frontGlassOuter = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14)
      .mul(step(0.65, p.z));
    const centerPost = smoothstep(0.022, 0.036, abs(p.x));
    const aPillar = smoothstep(0.028, 0.044, abs(p.z.sub(1.06)));
    const bPillar = smoothstep(0.026, 0.042, abs(p.z.sub(0.08)));

    // Lower nose chin bubble windows (for pilot downward visibility)
    const chinWindow = roundedRect(vec2(abs(p.x).sub(0.28), p.y.sub(0.84)), vec2(0.19, 0.11), 0.04)
      .mul(smoothstep(1.95, 2.15, p.z))
      .mul(smoothstep(2.68, 2.52, p.z));

    // Wide panoramic passenger sightseeing side windows: z in [-0.78, 1.02], y in [1.02, 1.74]
    const sideWindow = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10)
      .mul(step(0.45, abs(n.x)));

    // Overhead cockpit eyebrow skylight windows
    const skylight = roundedRect(vec2(abs(p.x).sub(0.32), p.z.sub(1.25)), vec2(0.20, 0.38), 0.06)
      .mul(step(1.72, p.y));

    const rawWindowMask = max(
      max(frontGlassOuter.mul(centerPost), sideWindow),
      max(chinWindow, skylight)
    )
      .mul(aPillar)
      .mul(bPillar)
      .mul(isFuselage)
      .toVar();

    // Rubber window weatherstripping seal around glass panes
    const rawSealMask = max(
      roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.80, 0.46), 0.15).mul(step(0.60, p.z)),
      roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.92, 0.38), 0.12).mul(step(0.40, abs(n.x)))
    )
      .mul(isFuselage)
      .toVar();

    // 2. Flush Executive NYC Sightseeing Livery (Aviation White + Midnight Navy + Sweeping Gold Ribbon)
    const navyCurveY = float(1.00).add(p.z.mul(-0.085));
    const edgeW = max(fwidth(p.y), 0.008);
    const isLowerNavy = smoothstep(navyCurveY.add(edgeW), navyCurveY.sub(edgeW), p.y);
    const goldStripeDist = abs(p.y.sub(navyCurveY.add(0.065)));
    const isGoldStripe = smoothstep(0.055, 0.038, goldStripeDist);
    const redPinDist = abs(p.y.sub(navyCurveY.add(0.145)));
    const isRedPin = smoothstep(0.022, 0.012, redPinDist);

    // Cabin door panel seams & handles
    const doorSeam1 = smoothstep(0.012, 0.004, abs(p.z.sub(1.06)));
    const doorSeam2 = smoothstep(0.012, 0.004, abs(p.z.sub(0.08)));
    const doorSeam3 = smoothstep(0.012, 0.004, abs(p.z.sub(-0.82)));
    const doorHandle = roundedRect(vec2(p.z.sub(0.24), p.y.sub(0.94)), vec2(0.065, 0.014), 0.006);
    const panelLines = max(max(doorSeam1, max(doorSeam2, doorSeam3)), doorHandle)
      .mul(step(0.55, abs(n.x)))
      .mul(smoothstep(0.55, 0.62, p.y))
      .mul(smoothstep(1.75, 1.65, p.y));

    const whitePaint = color(0xf4f7fb);
    const navyPaint = color(0x132c58);
    const goldPaint = color(0xffbe28);
    const redPaint = color(0xd8222b);

    const baseLivery = mix(
      mix(mix(whitePaint, navyPaint, isLowerNavy), goldPaint, isGoldStripe),
      redPaint,
      isRedPin
    ).mul(float(1.0).sub(panelLines.mul(0.45)));

    const glassCol = mix(color(0x102234), color(0x1e3c58), clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0));
    const fuselageCol = mix(mix(baseLivery, color(0x14181e), rawSealMask), glassCol, rawWindowMask);

    // 3. Engine Cowling: Aviation White with Dark Slatted Turbine Intake Grille
    const intakeGrille = roundedRect(vec2(p.z.sub(-0.45), p.y.sub(2.18)), vec2(0.52, 0.13), 0.04)
      .mul(step(0.35, abs(n.x)));
    const louverSlats = step(0.45, fract(p.y.mul(55.0))).mul(0.4).add(0.35);
    const cowlingCol = mix(
      mix(whitePaint, goldPaint, smoothstep(2.02, 1.97, p.y)),
      color(0x181c22).mul(louverSlats),
      intakeGrille
    );

    // 4. Swept Tail Fin & Stabilizer: Deep Navy with Gold Tip Accent
    const finGoldBand = smoothstep(2.42, 2.45, p.y).mul(smoothstep(2.62, 2.59, p.y));
    const finCol = mix(navyPaint, goldPaint, finGoldBand);

    // 5. Rotor Blades: Matte Anthracite Carbon with High-Visibility Yellow Safety Tips
    const radialDist = length(vec2(p.x, p.z));
    const isBladeTip = smoothstep(4.35, 4.42, radialDist).add(
      smoothstep(0.65, 0.68, abs(p.y)).mul(step(radialDist, 0.35))
    );
    const rotorCol = mix(color(0x1e232a), goldPaint, clamp(isBladeTip, 0.0, 1.0));

    const skidCol = color(0x22272e);
    const exhaustBore = step(0.65, n.z.negate());
    const exhaustCol = mix(color(0x484f58), color(0x101318), exhaustBore);

    return mix(
      mix(
        mix(
          mix(
            mix(fuselageCol, cowlingCol, isCowling),
            finCol,
            isFin
          ),
          skidCol,
          isSkid
        ),
        rotorCol,
        isRotor
      ),
      exhaustCol,
      isExhaust
    );
  });

  mat.colorNode = evaluateHeliSurface();

  mat.roughnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isSkid = step(abs(partId.sub(HELI_PARTS.SKID)), 0.25);
    const isRotor = step(abs(partId.sub(HELI_PARTS.ROTOR)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.20), float(0.05), isGlass), float(0.55), max(isSkid, isRotor));
  })();

  mat.metalnessNode = Fn(() => {
    const partId = attribute('partId', 'float');
    const isFuselage = step(abs(partId.sub(HELI_PARTS.FUSELAGE)), 0.25);
    const isExhaust = step(abs(partId.sub(HELI_PARTS.EXHAUST)), 0.25);
    const p = attribute('position', 'vec3');
    const n = attribute('normal', 'vec3');
    const frontGlass = roundedRect(vec2(p.z.sub(1.74), p.y.sub(1.42)), vec2(0.76, 0.42), 0.14).mul(step(0.65, p.z));
    const sideGlass = roundedRect(vec2(p.z.sub(0.12), p.y.sub(1.38)), vec2(0.88, 0.34), 0.10).mul(step(0.45, abs(n.x)));
    const isGlass = max(frontGlass, sideGlass).mul(isFuselage);
    return mix(mix(float(0.35), float(0.88), isGlass), float(0.82), isExhaust);
  })();

  _heliLoftedMat = mat;
  return mat;
}
