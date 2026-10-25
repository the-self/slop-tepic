import {
  Fn,
  float,
  vec2,
  abs,
  min,
  max,
  smoothstep,
  length,
  fwidth
} from 'three/tsl';
import type { Node } from 'three/webgpu';

// js/actors/vehicles/tsl-shapes.ts
// Anti-aliased 2D shapes for the vehicles' TSL materials: rounded rectangles, convex polygons as smoothed half-planes,
// and their coverage.

// Filter-width anti-aliased 2D rounded rectangle SDF (ported from CarGenerator.js)
export const roundedRect = Fn(([point, halfSize, radiusNode]: [Node<'vec2'>, Node<'vec2'>, Node<'float'>]) => {
  const pt = vec2(point).toVar();
  const hs = vec2(halfSize).toVar();
  const rad = float(radiusNode).toVar();
  const q = abs(pt).sub(hs).add(rad).toVar();
  const dist = length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(rad).toVar();
  const edge = max(fwidth(dist), 0.001).toVar();
  return smoothstep(edge, edge.negate(), dist);
});

// IQ polynomial smooth maximum: rounds the corners of max()-combined half-plane distances
const smax = (a: Node<'float'>, b: Node<'float'>, k: number) => {
  const h = max(float(k).sub(abs(a.sub(b))), 0.0).div(k);
  return max(a, b).add(h.mul(h).mul(k * 0.25));
};

// Signed distance (approximate outside, exact inside) to a convex polygon given as outward half-planes [nx, ny, c]
export const polygonDistance = (px: Node<'float'>, py: Node<'float'>, planes: Plane[], k: number): Node<'float'> => {
  let d: Node<'float'> | null = null;
  for (const [nx, ny, c] of planes) {
    const e = px.mul(nx).add(py.mul(ny)).sub(c);
    d = d === null ? e : smax(d, e, k);
  }
  if (!d) throw new Error('polygonDistance: no half-planes');
  return d;
};

/** An outward half-plane: its unit normal (nx, ny) and offset c (nx x + ny y = c on its edge) */
type Plane = [nx: number, ny: number, c: number];

// Outward half-planes of a counter-clockwise polygon, each edge moved in by its margin
export function polygonPlanes(points: [x: number, y: number][], margins: number[]): Plane[] {
  const planes: Plane[] = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    planes.push([nx, ny, ax * nx + ay * ny - margins[i]]);
  }
  return planes;
}

export const coverage = (d: Node<'float'>) => {
  const w = max(fwidth(d), 0.0008);
  return smoothstep(w, w.negate(), d);
};
