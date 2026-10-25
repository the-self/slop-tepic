import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoftGeometry, part, limbSections } from './loft.ts';

// js/actors/vehicles/helicopter-geometry.ts
// The sightseeing helicopter's geometry: the lofted fuselage, cowling, fins & skids, and the main & tail rotors.

// ============================================================================
// 5. 3D LOFTED MANHATTAN SIGHTSEEING HELICOPTER GEOMETRY & TSL MATERIAL
// ============================================================================
export const HELI_PARTS = {
  FUSELAGE: 0,
  COWLING: 1,
  FIN: 2,
  SKID: 3,
  ROTOR: 4,
  EXHAUST: 5
};

/**
 * Helper to create a 12-point symmetric helicopter fuselage cross-section
 * with flattened belly floor, rounded lower chines, wide panoramic cabin flanks,
 * tumblehome upper glass/shoulder, and crowned roof/tailboom.
 */
function heliFuselageSection(z: number, halfW: number, botY: number, topY: number, bellyFlat = 0.68, shoulderRatio = 0.52) {
  const h = Math.max(0.08, topY - botY);
  const chineY = botY + h * 0.16;
  const shoulderY = botY + h * shoulderRatio;
  const eaveY = botY + h * 0.86;

  const right = [
    new THREE.Vector3(halfW * bellyFlat * 0.55, botY, z),
    new THREE.Vector3(halfW * 0.92, chineY, z),
    new THREE.Vector3(halfW, shoulderY, z),
    new THREE.Vector3(halfW * 0.88, eaveY, z),
    new THREE.Vector3(halfW * 0.46, topY - h * 0.03, z),
    new THREE.Vector3(0.0, topY, z)
  ];
  const left = right
    .slice(0, 5)
    .reverse()
    .map((p) => new THREE.Vector3(-p.x, p.y, p.z));
  const bottomCenter = [new THREE.Vector3(0.0, botY, z)];
  return [...bottomCenter, ...right, ...left].reverse();
}

/**
 * Helper to create an 8-point symmetric airfoil / cowling cross-section.
 */
function heliAirfoilSection(xCenter: number, yCenter: number, zCenter: number, halfThickX: number, _halfHeightY: number, chordZ: number) {
  // Airfoil lying along Z (for vertical fin) or X (for horizontal stabilizer)
  return [
    new THREE.Vector3(xCenter, yCenter, zCenter + chordZ * 0.5),
    new THREE.Vector3(xCenter + halfThickX, yCenter, zCenter + chordZ * 0.18),
    new THREE.Vector3(xCenter + halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter, yCenter, zCenter - chordZ * 0.5),
    new THREE.Vector3(xCenter - halfThickX * 0.65, yCenter, zCenter - chordZ * 0.25),
    new THREE.Vector3(xCenter - halfThickX, yCenter, zCenter + chordZ * 0.18)
  ];
}

export function buildHelicopterBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Continuous 3D Lofted Monocoque Fuselage-to-Tailboom (15 stations from z = +2.82 nose to z = -5.85 tail)
  // [z, halfW, botY, topY, bellyFlat, shoulderRatio]
  const fuselageProfile: [z: number, halfW: number, botY: number, topY: number, bellyFlat: number, shoulderRatio: number][] = [
    [2.82, 0.16, 0.88, 1.02, 0.50, 0.50], // Aerodynamic nose tip
    [2.62, 0.54, 0.72, 1.18, 0.62, 0.48], // Lower nose chin window
    [2.20, 0.88, 0.58, 1.48, 0.72, 0.46], // Lower windshield base
    [1.55, 1.10, 0.52, 1.86, 0.78, 0.44], // Front pilot cabin & wide panoramic windscreen
    [0.75, 1.16, 0.50, 2.02, 0.80, 0.45], // Main sightseeing passenger cabin (widest section)
    [-0.15, 1.14, 0.50, 2.02, 0.80, 0.46], // Rear passenger cabin
    [-0.95, 1.02, 0.54, 1.96, 0.74, 0.50], // Cabin-to-cowling transition
    [-1.65, 0.74, 0.72, 1.84, 0.62, 0.54], // Rear baggage & tapered clamshell bay
    [-2.35, 0.42, 1.12, 1.74, 0.45, 0.55], // Forward tailboom root
    [-3.25, 0.31, 1.24, 1.72, 0.40, 0.55], // Mid tailboom
    [-4.35, 0.24, 1.32, 1.70, 0.38, 0.55], // Stabilizer station
    [-5.35, 0.18, 1.38, 1.68, 0.36, 0.55], // Rear tailboom before fin
    [-5.85, 0.12, 1.43, 1.65, 0.35, 0.55]  // Tailboom tip cap
  ];

  const fuselageSections = fuselageProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(fuselageSections, { capStart: true, capEnd: true }), HELI_PARTS.FUSELAGE));

  // 2. Sculpted Twin-Turbine Upper Engine Cowling & Mast Doghouse (lofted from z = +0.55 to -2.25)
  const cowlingProfile: [z: number, halfW: number, botY: number, topY: number, bellyFlat: number, shoulderRatio: number][] = [
    [0.55, 0.32, 1.94, 2.12, 0.85, 0.45],
    [0.10, 0.56, 1.96, 2.38, 0.85, 0.48],
    [-0.55, 0.62, 1.94, 2.44, 0.85, 0.50],
    [-1.25, 0.56, 1.88, 2.36, 0.82, 0.50],
    [-1.85, 0.38, 1.76, 2.10, 0.78, 0.50],
    [-2.28, 0.20, 1.68, 1.82, 0.70, 0.50]
  ];
  const cowlingSections = cowlingProfile.map((s) => heliFuselageSection(...s));
  parts.push(part(new LoftGeometry(cowlingSections, { capStart: true, capEnd: true }), HELI_PARTS.COWLING));

  // Twin Canted Turbine Exhaust Nozzles tucked cleanly into rear of engine cowling
  for (const side of [-1, 1]) {
    const exhaust = new THREE.CylinderGeometry(0.10, 0.125, 0.34, 14)
      .rotateX(Math.PI * 0.46)
      .rotateY(side * 0.10)
      .translate(side * 0.24, 2.08, -1.72);
    parts.push(part(exhaust, HELI_PARTS.EXHAUST));
  }

  // 3. 3D Lofted Swept Vertical Tail Fin (Airfoil cross-sections sweeping from z = -5.15 to -6.15)
  // Upper swept fin + lower ventral tail bumper fin
  const vFinProfile = [
    [-0.02, 0.88, -5.28, 0.05, 0.0, 0.44], // Ventral tail fin tip
    [0.0,   1.48, -5.25, 0.12, 0.0, 0.88], // Tailboom junction root
    [0.0,   1.95, -5.52, 0.10, 0.0, 0.76], // Mid swept vertical fin
    [0.0,   2.48, -5.82, 0.08, 0.0, 0.60], // Upper swept vertical fin
    [0.0,   2.82, -6.04, 0.05, 0.0, 0.42]  // Top anti-collision beacon tip
  ];
  const vFinSections = vFinProfile.map(([x, y, z, hx, hy, cz]) =>
    heliAirfoilSection(x, y, z, hx, hy, cz).reverse()
  );
  parts.push(part(new LoftGeometry(vFinSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // 4. 3D Lofted Horizontal Stabilizer Wing + Angled Endplate Winglets at z = -4.25
  const hStabSections = [-1.08, -0.55, 0.0, 0.55, 1.08].map((x) => {
    const taper = 1.0 - Math.abs(x) * 0.24;
    const chord = 0.46 * taper;
    const thick = 0.045 * taper;
    const y = 1.54;
    const z = -4.22 - Math.abs(x) * 0.12;
    return [
      new THREE.Vector3(x, y, z + chord * 0.5),
      new THREE.Vector3(x, y + thick, z + chord * 0.15),
      new THREE.Vector3(x, y + thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y, z - chord * 0.5),
      new THREE.Vector3(x, y - thick * 0.6, z - chord * 0.25),
      new THREE.Vector3(x, y - thick, z + chord * 0.15)
    ];
  });
  parts.push(part(new LoftGeometry(hStabSections, { capStart: true, capEnd: true }), HELI_PARTS.FIN));

  // Endplate Winglets on Horizontal Stabilizer tips
  for (const side of [-1, 1]) {
    const wx = side * 1.08;
    const wz = -4.35;
    const winglet = [
      [-0.22, 0.028, 0.30],
      [0.0,   0.036, 0.38],
      [0.26,  0.024, 0.26]
    ].map(([dy, hx, cz]) =>
      heliAirfoilSection(wx + side * Math.abs(dy) * 0.12, 1.54 + dy, wz - Math.abs(dy) * 0.15, hx, 0, cz).reverse()
    );
    parts.push(part(new LoftGeometry(winglet, { capStart: true, capEnd: true }), HELI_PARTS.FIN));
  }

  // 5. Tubular Landing Skids (LoftGeometry curved skids with upturned front runners + arched cross-tubes + steps)
  for (const side of [-1, 1]) {
    const sx = side * 1.12;
    // Skid runner tube from upturned front tip (z = +2.15, y = 0.28) along ground (y = 0.07) to rear tip (z = -1.75)
    const skidJoints: [center: THREE.Vector3, rx: number, ry: number][] = [
      [new THREE.Vector3(sx, 0.28, 2.15), 0.036, 0.036],
      [new THREE.Vector3(sx, 0.12, 1.88), 0.045, 0.045],
      [new THREE.Vector3(sx, 0.07, 1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, 0.0),  0.048, 0.048],
      [new THREE.Vector3(sx, 0.07, -1.45), 0.048, 0.048],
      [new THREE.Vector3(sx, 0.12, -1.75), 0.038, 0.038]
    ];
    const skidSections = skidJoints.map(([c, rx, ry]) =>
      Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2;
        return new THREE.Vector3(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry, c.z);
      }).reverse()
    );
    parts.push(part(new LoftGeometry(skidSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));

    // Passenger boarding step plate
    const stepBar = new THREE.BoxGeometry(0.14, 0.03, 0.88).translate(side * 1.02, 0.28, 0.42);
    parts.push(part(stepBar, HELI_PARTS.SKID));
  }

  // Front & Rear Arched Skid Cross-Tubes hugging the fuselage belly
  for (const cz of [1.05, -0.82]) {
    const crossPoints: [center: THREE.Vector3, rx: number, rz: number][] = [
      [new THREE.Vector3(-1.12, 0.09, cz), 0.042, 0.042],
      [new THREE.Vector3(-0.92, 0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(-0.62, 0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.62,  0.56, cz), 0.046, 0.046],
      [new THREE.Vector3(0.92,  0.42, cz), 0.044, 0.044],
      [new THREE.Vector3(1.12,  0.09, cz), 0.042, 0.042]
    ];
    const crossSections = limbSections(crossPoints, 8);
    parts.push(part(new LoftGeometry(crossSections, { capStart: true, capEnd: true }), HELI_PARTS.SKID));
  }

  // Wire-strike cutter & pitot tube on nose
  const pitot = new THREE.CylinderGeometry(0.015, 0.025, 0.35, 6)
    .rotateX(Math.PI * 0.5)
    .translate(0, 0.88, 2.88);
  parts.push(part(pitot, HELI_PARTS.SKID));

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Main Rotor Hub, Swashplate, and Tapered Airfoil Rotor Blades.
 */
export function buildHelicopterMainRotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Rotor mast, swashplate collar & aerodynamic hub dome
  const mast = new THREE.CylinderGeometry(0.11, 0.14, 0.52, 14).translate(0, -0.18, 0);
  const swash = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 16).translate(0, -0.12, 0);
  const hubCap = new THREE.SphereGeometry(0.28, 16, 10)
    .scale(1.0, 0.42, 1.0)
    .translate(0, 0.04, 0);
  parts.push(
    part(mast, HELI_PARTS.SKID),
    part(swash, HELI_PARTS.EXHAUST),
    part(hubCap, HELI_PARTS.ROTOR)
  );

  // 4 Tapered Airfoil Main Rotor Blades with pitch cuff grips
  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const cuff = new THREE.BoxGeometry(0.65, 0.045, 0.14)
      .translate(0.52, 0, 0)
      .rotateY(angle);
    const blade = new THREE.BoxGeometry(4.45, 0.024, 0.26)
      .rotateX(0.08) // Realistic collective blade pitch
      .translate(2.68, 0, 0)
      .rotateY(angle);
    parts.push(part(cuff, HELI_PARTS.SKID), part(blade, HELI_PARTS.ROTOR));
  }

  return mergeGeometries(parts);
}

/**
 * Builds the 4-Bladed Tail Rotor Assembly.
 */
export function buildHelicopterTailRotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12)
    .rotateZ(Math.PI * 0.5);
  parts.push(part(hub, HELI_PARTS.EXHAUST));

  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2;
    const blade = new THREE.BoxGeometry(0.022, 0.76, 0.13)
      .translate(0, 0.42, 0)
      .rotateX(angle);
    parts.push(part(blade, HELI_PARTS.ROTOR));
  }
  return mergeGeometries(parts);
}
