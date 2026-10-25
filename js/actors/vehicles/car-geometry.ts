import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LoftGeometry, part } from './loft.ts';
import { CAR_PARTS } from './car-specs.ts';
import { lerp, carLayout, buildCarBody, buildCarCabin, carBodyHalfWidthAt } from './car-body.ts';
import type { BodySpec, LoftSpec, BodyDims } from '../../models/bodies.ts';

// js/actors/vehicles/car-geometry.ts
// A whole car's mesh: the body & cabin with its wheels, wells, mirrors, roof rails, taxi sign and bumpers (one merged
// geometry per body type), the distant cars' proxy, and the body's overall size.

function roundedRectShape(hw: number, hh: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

// Rounded box extruded along z, centred on the origin
export function roundedBox(hw: number, hh: number, depth: number, r: number, bevel = 0.012) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(hw - bevel, hh - bevel, Math.max(0.002, r - bevel)), {
    depth: Math.max(0.001, depth - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2
  });
  return g.translate(0, 0, -(depth - 2 * bevel) / 2);
}

/**
 * Builds a single wheel assembly (LatheGeometry tyre + recessed alloy lip + dished hub)
 * centered at the origin (for steerable/spinning player wheels) or translated to (x, r, z).
 */
function buildWheelParts(spec: LoftSpec, side: number, translateToAxle = false, z = 0) {
  const r = spec.wheelRadius;
  const rim = r * 0.64;
  const width = r * 0.68;
  const wheelProfile = [
    new THREE.Vector2(rim + 0.014, -width * 0.44),
    new THREE.Vector2(r * 0.96, -width * 0.33),
    new THREE.Vector2(r, -width * 0.05),
    new THREE.Vector2(r, width * 0.05),
    new THREE.Vector2(r * 0.96, width * 0.33),
    new THREE.Vector2(rim + 0.014, width * 0.44)
  ];

  const x = translateToAxle ? side * spec.wheelX : 0;
  const y = translateToAxle ? r : 0;
  const zOff = translateToAxle ? z : 0;

  const tyre = new THREE.LatheGeometry(wheelProfile, 20)
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const lip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim + 0.014, width * 0.44), new THREE.Vector2(rim, width * 0.29)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const backLip = new THREE.LatheGeometry(
    [new THREE.Vector2(rim, -width * 0.29), new THREE.Vector2(rim + 0.014, -width * 0.44)],
    20
  )
    .rotateZ(-side * Math.PI * 0.5)
    .translate(x, y, zOff);
  const hub = new THREE.CircleGeometry(rim, 20);
  hub.attributes.position.setZ(0, -0.015);
  hub.computeVertexNormals();
  hub.rotateY(side * Math.PI * 0.5).translate(x + side * width * 0.29, y, zOff);

  const backHub = new THREE.CircleGeometry(rim, 20);
  backHub.attributes.position.setZ(0, -0.015);
  backHub.computeVertexNormals();
  backHub.rotateY(-side * Math.PI * 0.5).translate(x - side * width * 0.29, y, zOff);

  const list = [
    part(tyre, CAR_PARTS.TYRE),
    part(lip, CAR_PARTS.ALLOY),
    part(backLip, CAR_PARTS.ALLOY),
    part(hub, CAR_PARTS.ALLOY),
    part(backHub, CAR_PARTS.ALLOY)
  ];

  if (translateToAxle) list.push(buildWheelWell(spec, side, z));
  return list;
}

// Dark arch liner behind a wheel, so the arch never shows through to the other side of the car
function buildWheelWell(spec: LoftSpec, side: number, z: number) {
  const r = spec.wheelRadius;
  const width = r * 0.68;
  const wellOuter = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  const wellInner = new THREE.CircleGeometry(spec.wheelRadius + spec.archGap + 0.01, 10, 0, Math.PI)
    .rotateY(-side * Math.PI * 0.5)
    .translate(side * (spec.wheelX - (width * 0.5 + 0.02)), r, z);
  return part(mergeGeometries([wellOuter, wellInner]), CAR_PARTS.TRIM);
}

export function buildSteerableWheelGeo(spec: LoftSpec, side: number): THREE.BufferGeometry {
  return mergeGeometries(buildWheelParts(spec, side, false));
}

function buildMirrors(spec: BodySpec) {
  const L = carLayout(spec);
  const z = spec.cabin.cowl - 0.17;
  const c = L.cabin(z);
  const list: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const housing = roundedBox(0.1, 0.06, 0.085, 0.035, 0.014)
      .rotateY(side * 0.12)
      .translate(side * (c.beltX + 0.15), c.beltY + 0.085, z - 0.02);
    const arm = new THREE.BoxGeometry(0.12, 0.035, 0.06)
      .rotateZ(side * 0.35)
      .translate(side * (c.beltX + 0.04), c.beltY + 0.045, z);
    list.push(part(housing, CAR_PARTS.MIRROR), part(arm, CAR_PARTS.TRIM));
  }
  return list;
}

function buildRoofRails(spec: BodySpec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const list: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const sections = [0.04, 0.1, 0.9, 0.96].map((t, i) => {
      const z = lerp(cab.roofFront, cab.roofRear, t);
      const c = L.cabin(z);
      const x = side * c.railX * 0.8;
      const y = L.cabinTop(c, x) + (i === 0 || i === 3 ? 0.004 : 0.05);
      return [
        new THREE.Vector3(x - 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y - 0.016, z),
        new THREE.Vector3(x + 0.02, y + 0.016, z),
        new THREE.Vector3(x - 0.02, y + 0.016, z)
      ].reverse();
    });
    list.push(part(new LoftGeometry(sections, { capStart: true, capEnd: true }), CAR_PARTS.TRIM));
  }
  return list;
}

// NYC medallion roof light: a lit, gently tapered box on a black mount
export function taxiSignPlacement(spec: BodySpec) {
  const L = carLayout(spec);
  const cab = spec.cabin;
  const z = lerp(cab.roofFront, cab.roofRear, 0.45);
  const c = L.cabin(z);
  return { z, y: c.railY + c.h };
}

function buildTaxiSign(spec: BodySpec) {
  const { z, y } = taxiSignPlacement(spec);
  const shape = new THREE.Shape();
  const hw0 = 0.3;
  const hw1 = 0.27;
  const h = 0.15;
  const r = 0.035;
  shape.moveTo(-hw0, 0);
  shape.lineTo(hw0, 0);
  shape.lineTo(hw1, h - r);
  shape.quadraticCurveTo(hw1 - 0.004, h, hw1 - r, h);
  shape.lineTo(-hw1 + r, h);
  shape.quadraticCurveTo(-hw1 + 0.004, h, -hw1, h - r);
  shape.lineTo(-hw0, 0);
  const sign = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 3
  }).translate(0, y + 0.03, z - 0.06);
  const mount = new THREE.BoxGeometry(0.46, 0.04, 0.12).translate(0, y + 0.012, z);
  return [part(sign, CAR_PARTS.SIGN), part(mount, CAR_PARTS.TRIM)];
}

// Wrap the bumper strips around the nose and tail. Six rectangular sections cost just 44 triangles each;
// the inner faces sit in the body, while the outer faces stand 2.5 cm proud of the tips.
function buildBumpers(spec: BodySpec) {
  return spec.bumpers.map(([y, h], end) => {
    const direction = end === 0 ? 1 : -1;
    const tip = end === 0 ? spec.zFront : spec.zRear;
    const sections: THREE.Vector3[][] = [];
    for (const side of [-1, 1]) {
      for (const setback of side < 0 ? [0.3, 0.07, 0] : [0, 0.07, 0.3]) {
        const z = tip - direction * setback;
        const x = side * (carBodyHalfWidthAt(spec, z, y) + 0.012);
        const innerX = x - side * 0.05;
        const outerZ = z + direction * 0.025;
        const innerZ = z - direction * 0.105;
        const section = [
          new THREE.Vector3(x, y - h, outerZ),
          new THREE.Vector3(innerX, y - h, innerZ),
          new THREE.Vector3(innerX, y + h, innerZ),
          new THREE.Vector3(x, y + h, outerZ)
        ];
        sections.push(direction > 0 ? section : section.reverse());
      }
    }
    return part(new LoftGeometry(sections, { capStart: true, capEnd: true }), CAR_PARTS.TRIM);
  });
}

// A body shape's overall length, width (over the wheel arches) and height (to the roof), m: what a car model's real
// size is stretched from
export function bodyDims(spec: BodySpec): BodyDims {
  if (spec._dims) return spec._dims;
  const width = 2 * (Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare);
  const height = Math.max(...spec.cabin.roofY.map((p) => p[1])) + spec.cabin.roofCrown;
  spec._dims = { length: spec.zFront - spec.zRear, width, height, halfW: width / 2, halfL: Math.max(spec.zFront, -spec.zRear) };
  return spec._dims;
}

export function buildCarGeometry(spec: BodySpec, includeWheels = true): THREE.BufferGeometry {
  const parts = [buildCarBody(spec, 1), buildCarCabin(spec, 1), ...buildMirrors(spec), ...buildBumpers(spec)];
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      if (includeWheels) parts.push(...buildWheelParts(spec, side, true, z));
      else parts.push(buildWheelWell(spec, side, z));
    }
  }
  if (spec.rails) parts.push(...buildRoofRails(spec));
  if (spec.sign) parts.push(...buildTaxiSign(spec));
  return mergeGeometries(parts);
}

// A ~250-triangle stand-in for distant cars (a few pixels tall): the same body & glasshouse lofted from a handful of
// coarse sections, dark wheel blocks and the taxi's roof sign. Same attributes (partId, uv, normal) as the full
// model, so it renders with the same material and per-instance paint.
export function buildCarProxyGeometry(spec: BodySpec): THREE.BufferGeometry {
  const parts = [buildCarBody(spec, 0), buildCarCabin(spec, 0)];
  const r = spec.wheelRadius;
  for (const side of [-1, 1]) {
    for (const z of [-spec.wheelZ, spec.wheelZ]) {
      parts.push(part(new THREE.BoxGeometry(r * 0.6, r * 1.7, r * 1.7).translate(side * spec.wheelX, r * 0.88, z), CAR_PARTS.TYRE));
    }
  }
  if (spec.sign) {
    const { z, y } = taxiSignPlacement(spec);
    parts.push(part(new THREE.BoxGeometry(0.58, 0.16, 0.16).translate(0, y + 0.1, z), CAR_PARTS.SIGN));
  }
  return mergeGeometries(parts);
}
