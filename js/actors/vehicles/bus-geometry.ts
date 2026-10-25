import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { part } from './loft.ts';
import { CAR_PARTS } from './car-specs.ts';
import { buildBodyLoft, carBodyHalfWidthAt } from './car-body.ts';
import { roundedBox } from './car-geometry.ts';
import type { LoftSpec } from '../../models/bodies.ts';

// js/actors/vehicles/bus-geometry.ts
// The bus (Tepic's camiones) and the combi's pieces of geometry: the lofted bus body and its spec, the route signs on
// the glass and on the combi's roof, and the bus wheel.

// ============================================================================
// 4. LOFTED MTA BUS GEOMETRY & TSL MATERIAL
// ============================================================================
// A 40-ft low-floor MTA bus lofted with the car body machinery: rounded plan-view corners, a raked windshield, a
// tight roof radius and arches over the wheels; bumpers, the folded front bike rack, stalk mirrors and the roof AC &
// battery pods are separate pieces of the same mesh (partId). Windows, doors, livery & lamps are painted by
// createLoftedBusMaterial(); the route's name on the glass is textured panels (buildBusSignGeometry).
export const BUS_PARTS = {
  BODY: 0,
  TRIM: 1,
  POD: 2
};

/** The bus's loft, plus its windows and doors (m) */
export interface BusSpec extends LoftSpec {
  headlight: [x: number, y: number];
  rake: number; // how far the top of the windshield leans back
  window: [y0: number, y1: number]; // side window band
  frontDoor: [z0: number, z1: number]; // curb-side (-x) doors
  rearDoor: [z0: number, z1: number];
}

export const BUS_SPEC: BusSpec = {
  name: 'bus',
  headlight: [0.79, 0.8], // midpoint of each pair of white lamps; excludes the outer amber indicator
  zFront: 5.78,
  zRear: -5.78,
  wheelRadius: 0.48,
  wheelZ: 3.6,
  wheelX: 1.24,
  archGap: 0.09,
  archFlare: 0,
  tuck: 0.05,
  stationStep: 0.62,
  lowerRound: 2.6,
  upperRound: 6,
  upperSamples: [0.3, 0.56, 0.74, 0.88, 1],
  halfWidth: [[5.78, 1.3], [-5.78, 1.3]],
  sill: [[5.78, 0.36], [-5.78, 0.36]],
  shoulder: [[5.78, 1.05], [-5.78, 1.05]],
  edge: [[5.78, 2.96], [-5.78, 2.96]],
  crown: [[5.78, 0.045], [-5.78, 0.045]],
  tumble: [[5.78, 0.17], [-5.78, 0.17]],
  nose: { halfWidth: [0.28, 1.02, 2], edge: [0.24, 2.68, 2], crown: [0.24, 0.005, 2], sill: [0.07, 0.44, 2], shoulder: [0.2, 0.95, 2] },
  tail: { halfWidth: [0.24, 1.06, 2], edge: [0.2, 2.72, 2], crown: [0.2, 0.005, 2], sill: [0.09, 0.46, 2], shoulder: [0.2, 0.95, 2] },
  rake: 0.15, // how far the top of the windshield leans back
  window: [1.24, 2.44], // side window band (y)
  frontDoor: [4.36, 5.36], // curb-side (-x) doors (z ranges)
  rearDoor: [-1.52, -0.5]
};

// The windshield rake: the upper front leans back by up to BUS_SPEC.rake, fading out along the first metre
function busRake(y: number, z: number) {
  const s = BUS_SPEC;
  const along = Math.min(1, Math.max(0, (z - (s.zFront - 1.0)) / 1.0));
  const up = Math.min(1, Math.max(0, (y - 1.0) / 1.75));
  return s.rake * along * along * Math.pow(up, 1.3);
}

export function buildLoftedBusBodyGeometry() {
  const s = BUS_SPEC;
  const body = buildBodyLoft(s, 1);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - busRake(pos.getY(i), pos.getZ(i)));
  body.computeVertexNormals();
  const parts = [part(body, BUS_PARTS.BODY)];

  // Bumpers, front bike rack (folded), stalk mirrors
  parts.push(part(roundedBox(1.24, 0.12, 0.24, 0.07, 0.03).translate(0, 0.5, s.zFront - 0.05), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(1.24, 0.11, 0.22, 0.06, 0.03).translate(0, 0.48, s.zRear + 0.05), BUS_PARTS.TRIM));
  const rackZ = s.zFront + 0.13;
  parts.push(part(roundedBox(0.5, 0.024, 0.05, 0.02, 0.008).translate(0, 1.0, rackZ + 0.05), BUS_PARTS.TRIM));
  parts.push(part(roundedBox(0.46, 0.02, 0.05, 0.018, 0.008).translate(0, 0.74, rackZ), BUS_PARTS.TRIM));
  for (const side of [-1, 1]) {
    parts.push(part(new THREE.BoxGeometry(0.035, 0.36, 0.035).rotateX(-0.14).translate(side * 0.47, 0.83, rackZ + 0.02), BUS_PARTS.TRIM));
    // Mirror stalk from the roof corner, curving forward & out to a tall mirror head ahead of the windshield corner
    const stalk = new THREE.BoxGeometry(0.035, 0.035, 0.5)
      .rotateX(0.55)
      .rotateY(side * 0.35)
      .translate(side * 1.2, 2.58, s.zFront - 0.12);
    const head = roundedBox(0.075, 0.2, 0.06, 0.03, 0.012).translate(side * 1.36, 2.24, s.zFront + 0.12);
    parts.push(part(stalk, BUS_PARTS.TRIM), part(head, BUS_PARTS.TRIM));
  }

  // Roof equipment: air-conditioning pod at the rear, hybrid battery pod ahead of it
  const roofY = s.edge[0][1] + s.crown[0][1];
  parts.push(part(roundedBox(0.98, 0.15, 2.5, 0.12, 0.05).translate(0, roofY + 0.1, -3.55), BUS_PARTS.POD));
  parts.push(part(roundedBox(0.82, 0.1, 3.0, 0.08, 0.04).translate(0, roofY + 0.06, 1.1), BUS_PARTS.POD));

  // Arch liners
  for (const side of [-1, 1]) {
    for (const z of [-s.wheelZ, s.wheelZ]) {
      const well = new THREE.CircleGeometry(s.wheelRadius + s.archGap + 0.01, 10, 0, Math.PI)
        .rotateY(side * Math.PI * 0.5)
        .translate(side * (s.wheelX - 0.2), s.wheelRadius, z);
      parts.push(part(well, BUS_PARTS.TRIM));
    }
  }
  return mergeGeometries(parts);
}

/**
 * The route's name lettered on the glass, as Tepic's camiones carry it (PROGRESO 4, MOLOLOA CENTRO): across the foot of
 * the windshield, on the first side window either side and across the rear window. Panels take a whole row of the
 * route sign atlas (routeSignTexture); same object space as the bus body.
 */
export function buildBusSignGeometry() {
  const s = BUS_SPEC;
  const panels = [];
  const yF = 1.56;
  const front = new THREE.PlaneGeometry(1.86, 0.34);
  front.rotateX(-Math.atan2(busRake(yF + 0.17, s.zFront) - busRake(yF - 0.17, s.zFront), 0.34));
  front.translate(0, yF, s.zFront - busRake(yF, s.zFront) + 0.014);
  panels.push(front);
  for (const side of [-1, 1]) {
    const panel = new THREE.PlaneGeometry(1.5, 0.27).rotateY(side * Math.PI / 2);
    panel.translate(side * (carBodyHalfWidthAt(s, 2.9, 1.95) + 0.008), 1.95, 2.9);
    panels.push(panel);
  }
  const rear = new THREE.PlaneGeometry(1.5, 0.27);
  rear.rotateY(Math.PI).translate(0, 1.96, s.zRear - 0.014);
  panels.push(rear);
  return mergeGeometries(panels);
}

// A combi's roof sign: a white box across the front of the van's roof (BODY_SPECS.van), its name on both faces. The
// box's own sides sample the atlas's blank left margin
export function buildCombiSignGeometry() {
  const roof = 2.03;
  const w = 1.36, h = 0.3, d = 0.13, z = 1.05;
  const box = new THREE.BoxGeometry(w, h, d);
  const buv = box.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, 0.008, 0.5);
  box.translate(0, roof + 0.04 + h / 2, z);
  const faces = [];
  for (const dir of [1, -1]) {
    const face = new THREE.PlaneGeometry(w - 0.04, h - 0.04);
    if (dir < 0) face.rotateY(Math.PI);
    face.translate(0, roof + 0.04 + h / 2, z + dir * (d / 2 + 0.003));
    faces.push(face);
  }
  const feet = [-0.5, 0.5].map((x) => {
    const foot = new THREE.BoxGeometry(0.06, 0.06, 0.08);
    const fuv = foot.attributes.uv;
    for (let i = 0; i < fuv.count; i++) fuv.setXY(i, 0.008, 0.5);
    return foot.translate(x, roof + 0.02, z);
  });
  return mergeGeometries([box, ...faces, ...feet]);
}

// Bus wheel: tall tyre with a deep steel disc, 10 lug nuts and a hub cap on both outer and inner faces (spins about x, centred on the origin)
export function buildBusWheelGeo(side: number): THREE.BufferGeometry {
  const r = BUS_SPEC.wheelRadius;
  const w = 0.3;
  const tyre = new THREE.LatheGeometry(
    [
      new THREE.Vector2(r * 0.72, -w * 0.5),
      new THREE.Vector2(r * 0.97, -w * 0.38),
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r * 0.97, w * 0.38),
      new THREE.Vector2(r * 0.72, w * 0.5)
    ],
    20
  );
  const disc = new THREE.LatheGeometry(
    [new THREE.Vector2(r * 0.72, w * 0.5), new THREE.Vector2(r * 0.66, w * 0.4), new THREE.Vector2(r * 0.56, w * 0.18), new THREE.Vector2(0.15, w * 0.16)],
    20
  );
  const backDisc = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, -w * 0.16),
      new THREE.Vector2(0.15, -w * 0.16),
      new THREE.Vector2(r * 0.56, -w * 0.18),
      new THREE.Vector2(r * 0.66, -w * 0.4),
      new THREE.Vector2(r * 0.72, -w * 0.5)
    ],
    20
  );
  const cap = new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14).translate(0, w * 0.2, 0);
  const backCap = new THREE.CylinderGeometry(0.13, 0.1, 0.12, 14).translate(0, -w * 0.2, 0);
  const parts = [
    part(tyre, CAR_PARTS.TYRE),
    part(disc, CAR_PARTS.ALLOY),
    part(backDisc, CAR_PARTS.ALLOY),
    part(cap, CAR_PARTS.ALLOY),
    part(backCap, CAR_PARTS.ALLOY)
  ];
  for (const g of parts) g.rotateZ(-side * Math.PI * 0.5);
  return mergeGeometries(parts);
}
