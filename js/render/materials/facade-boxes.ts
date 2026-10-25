import * as THREE from 'three/webgpu';
import {
  Fn,
  color,
  positionGeometry,
  sin,
  abs,
  fract,
  max,
  step,
  If,
  Discard
} from 'three/tsl';

// js/render/materials/facade-boxes.ts
// The instanced facade boxes the box-local facade materials draw on, and the colonial balconies' iron railing.

/**
 * Instanced unit boxes for the facade materials' `boxLocal` mode, one per { x, y, z, w, h, d, faces?, tone?, ry? }
 * (y = centre; ry: turn about +y, for blocks laid out along a non-grid street), with the per-instance `box` attribute
 * (size + a spread seed carrying the building's tone in its fraction) that lays each wall out in whole window bays,
 * and `faces`: the WALL_KINDS of the box's -x, +x, -z & +z walls (storefront fronts all round when omitted).
 */
// The iron of a colonial balcony's railing (buildings.ts): black-green bars every 11 cm between a top & bottom rail,
// a scroll band under the handrail; the rest open (alpha-tested)
export function createBalconyRailMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
  const p = positionGeometry; // (not positionLocal: on an instanced mesh that is already moved by the instance)
  const along = p.x.add(p.z); // metres along each rail (the front one runs along x, the side ones along z)
  const y = p.y;
  const bar = step(0.75, fract(along.div(0.11).add(0.5)));
  const rails = max(step(0.88, y), step(y, 0.06)).add(step(0.66, y).mul(step(y, 0.72))).min(1.0);
  const scroll = step(0.72, y).mul(step(y, 0.88)).mul(step(0.55, abs(sin(along.mul(28.0).add(y.mul(18.0))))));
  const iron = max(max(bar, rails), scroll);
  mat.colorNode = Fn(() => {
    If(iron.lessThan(0.5), () => {
      Discard();
    });
    return color(0x1d2620);
  })();
  return mat;
}

/**
 * A facade box (buildings.ts): its centre (m), size (w along x, h, d along z), turn about +y (rad), the WALL_KINDS of
 * its -x, +x, -z & +z walls, the building's tone (0..1), its own paint (null: the palette's) and a colonial house
 */
export interface FacadeBoxSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ry?: number;
  faces?: readonly number[];
  tone?: number;
  paint?: THREE.ColorRepresentation | null;
  colonial?: boolean;
}

export function createFacadeBoxes(material: THREE.Material, boxes: readonly FacadeBoxSpec[]): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const box = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4);
  const faces = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4);
  // a building's own paint, where it is known (the centro's overrides, js/world/building-overrides.ts): rgb, and in w 1
  // (0: the palette's, by tone), plus 2 for a colonial house of the centro (buildings.ts: cantera, balconies...)
  const paint = new THREE.InstancedBufferAttribute(new Float32Array(boxes.length * 4), 4);
  geometry.setAttribute('box', box);
  geometry.setAttribute('faces', faces);
  geometry.setAttribute('paint', paint);
  const colour = new THREE.Color();

  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length);
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  boxes.forEach((b, i) => {
    if (b.ry) mesh.setMatrixAt(i, matrix.compose(pos.set(b.x, b.y, b.z), quat.setFromAxisAngle(up, b.ry), scale.set(b.w, b.h, b.d)));
    else mesh.setMatrixAt(i, matrix.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z));
    // the seed from where the building stands, not its place in the list: a house added or taken away elsewhere
    // leaves this one's door, gate & back walls as they were
    const h = Math.sin(b.x * 12.9898 + b.z * 78.233) * 43758.5453;
    box.setXYZW(i, b.w, b.h, b.d, Math.floor((h - Math.floor(h)) * 1000) + 0.1 + 0.8 * (b.tone ?? 0.5));
    if (b.faces) faces.setXYZW(i, b.faces[0], b.faces[1], b.faces[2], b.faces[3]);
    if (b.paint !== undefined && b.paint !== null) {
      colour.set(b.paint);
      paint.setXYZW(i, colour.r, colour.g, colour.b, 1 + (b.colonial ? 2 : 0));
    } else if (b.colonial) paint.setW(i, 2);
  });
  return mesh;
}
