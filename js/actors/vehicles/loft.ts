import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// js/actors/vehicles/loft.ts
// The loft every vehicle body is skinned with (LoftGeometry), the `partId` tag their materials paint by, and tube
// sections along a polyline (the helicopter's skids).

const _vector = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

// ============================================================================
// 1. LOFT GEOMETRY (Ported from three/addons/geometries/LoftGeometry.js)
// ============================================================================
export class LoftGeometry extends THREE.BufferGeometry {
  override readonly type = 'LoftGeometry';

  constructor(sections: THREE.Vector3[][] = [], options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}) {
    super();

    const { closed = true, capStart = false, capEnd = false } = options;
    const rows = sections.length;
    if (rows < 2) return;
    const columns = sections[0].length;
    for (let i = 1; i < rows; i++) {
      if (sections[i].length !== columns) return;
    }

    const pointsPerRow = closed ? columns + 1 : columns;
    const indices: number[] = [];
    const vertices: number[] = [];
    const uvs: number[] = [];

    const rowU = [0];
    for (let i = 1; i < rows; i++) {
      let distance = 0;
      for (let j = 0; j < columns; j++) {
        distance += sections[i][j].distanceTo(sections[i - 1][j]);
      }
      rowU.push(rowU[i - 1] + distance / columns);
    }
    const totalU = rowU[rows - 1];

    for (let i = 0; i < rows; i++) {
      const section = sections[i];
      const colV = [0];
      for (let j = 1; j < pointsPerRow; j++) {
        colV.push(colV[j - 1] + section[j % columns].distanceTo(section[(j - 1) % columns]));
      }
      const totalV = colV[pointsPerRow - 1];

      for (let j = 0; j < pointsPerRow; j++) {
        const point = section[j % columns];
        vertices.push(point.x, point.y, point.z);
        uvs.push(
          totalU > 0 ? rowU[i] / totalU : i / (rows - 1),
          totalV > 0 ? colV[j] / totalV : j / (pointsPerRow - 1)
        );
      }
    }

    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < pointsPerRow - 1; j++) {
        const a = i * pointsPerRow + j;
        const b = i * pointsPerRow + j + 1;
        const c = (i + 1) * pointsPerRow + j + 1;
        const d = (i + 1) * pointsPerRow + j;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    function generateCap(sectionIndex: number) {
      const section = sections[sectionIndex];
      const centroid = new THREE.Vector3();
      const normal = new THREE.Vector3();

      for (let i = 0; i < columns; i++) {
        const p = section[i];
        const q = section[(i + 1) % columns];
        centroid.add(p);
        normal.x += (p.y - q.y) * (p.z + q.z);
        normal.y += (p.z - q.z) * (p.x + q.x);
        normal.z += (p.x - q.x) * (p.y + q.y);
      }
      centroid.divideScalar(columns);
      normal.normalize();

      const neighbor = sections[sectionIndex === 0 ? 1 : rows - 2];
      _vector.set(0, 0, 0);
      for (let i = 0; i < columns; i++) _vector.add(neighbor[i]);
      _vector.divideScalar(columns).sub(centroid);
      if (normal.dot(_vector) > 0) normal.negate();

      const tangent = new THREE.Vector3(1, 0, 0);
      if (Math.abs(normal.x) > 0.9) tangent.set(0, 1, 0);
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      tangent.crossVectors(bitangent, normal);

      const contour: THREE.Vector2[] = [];
      const points = section.slice();
      for (let i = 0; i < columns; i++) {
        _vector.subVectors(points[i], centroid);
        contour.push(new THREE.Vector2(_vector.dot(tangent), _vector.dot(bitangent)));
      }

      if (THREE.ShapeUtils.isClockWise(contour)) {
        contour.reverse();
        points.reverse();
      }

      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const minV = new THREE.Vector2(Infinity, Infinity);
      const maxV = new THREE.Vector2(-Infinity, -Infinity);
      for (let i = 0; i < columns; i++) {
        minV.min(contour[i]);
        maxV.max(contour[i]);
      }
      const width = Math.max(maxV.x - minV.x, Number.EPSILON);
      const height = Math.max(maxV.y - minV.y, Number.EPSILON);

      const indexOffset = vertices.length / 3;
      for (let i = 0; i < columns; i++) {
        const point = points[i];
        vertices.push(point.x, point.y, point.z);
        uvs.push((contour[i].x - minV.x) / width, (contour[i].y - minV.y) / height);
      }
      for (const face of faces) {
        indices.push(indexOffset + face[0], indexOffset + face[1], indexOffset + face[2]);
      }
    }

    if (capStart) generateCap(0);
    if (capEnd) generateCap(rows - 1);

    this.setIndex(indices);
    this.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.computeVertexNormals();

    if (closed) {
      const normals = this.getAttribute('normal');
      for (let i = 0; i < rows; i++) {
        const a = i * pointsPerRow;
        const b = i * pointsPerRow + (pointsPerRow - 1);
        _vector.set(
          normals.getX(a) + normals.getX(b),
          normals.getY(a) + normals.getY(b),
          normals.getZ(a) + normals.getZ(b)
        ).normalize();
        normals.setXYZ(a, _vector.x, _vector.y, _vector.z);
        normals.setXYZ(b, _vector.x, _vector.y, _vector.z);
      }
    }
  }
}

export function part(geometry: THREE.BufferGeometry, id: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry : mergeVertices(geometry);
  if (!('uv' in g.attributes)) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

// ============================================================================
// 3. TUBE SECTIONS ALONG A POLYLINE (the helicopter's skids; the people are built in pedestrians.ts)
// ============================================================================
function ring(center: THREE.Vector3, rx: number, rz: number, segments = 6, phase = 0) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2 + phase;
    return new THREE.Vector3(center.x + Math.cos(a) * rx, center.y, center.z + Math.sin(a) * rz);
  });
}

/** Joints: [centre, radius across x, radius across z] (m) */
export function limbSections(joints: [center: THREE.Vector3, rx: number, rz: number][], segments = 6, phase = 0) {
  const rotation = new THREE.Quaternion();
  return joints.map(([center, rx, rz], i) => {
    const before = joints[Math.max(0, i - 1)][0];
    const after = joints[Math.min(joints.length - 1, i + 1)][0];
    rotation.setFromUnitVectors(_down, after.clone().sub(before).normalize());
    return ring(new THREE.Vector3(), rx, rz, segments, phase).map((p) =>
      p.applyQuaternion(rotation).add(center)
    );
  });
}
