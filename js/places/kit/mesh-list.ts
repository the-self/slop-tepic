// js/places/kit/mesh-list.ts
// A place's geometry as it is gathered vertex by vertex: turned boxes (OrientedBox: local x along u, local z along v),
// quads, upright faces, flat polygons (with holes) and upright cylinders, straight into one vertex list per material,
// in world space (uv in metres along each face, so the materials' patterns keep their size), each vertex tagged with
// the `aTag` its material reads (Forum Tepic's: the shop's colour & seed). Its other half, pieces.ts, places whole
// geometries in a frame and merges them per material & cell.
import * as THREE from 'three/webgpu';
import { drapeGeometry } from '../../world/drape.ts';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

/** An upright box turned in the plan: centre (cx, cz), half sizes hu (along (cs, -sn)) & hv (along (sn, cs)), and its
 *  foot & top y0..y1 over the floor it stands on (m) */
export interface OrientedBox {
  cx: number;
  cz: number;
  hu: number;
  hv: number;
  cs: number;
  sn: number;
  y0: number;
  y1: number;
}

export class MeshList {
  pos: number[] = [];
  nor: number[] = [];
  uvs: number[] = [];
  tags: number[] = [];
  idx: number[] = [];
  /** the aTag attribute every vertex gets from here on (null: none) */
  tag: [number, number, number, number] | null = null;

  get count(): number {
    return this.pos.length / 3;
  }

  // a quad p0 p1 p2 p3 (counter-clockwise seen from its front), its normal, its corners' uv
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: Vec3, uv: [Vec2, Vec2, Vec2, Vec2]): void {
    const i = this.count;
    for (const [k, p] of [p0, p1, p2, p3].entries()) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uvs.push(uv[k][0], uv[k][1]);
      if (this.tag) this.tags.push(...this.tag);
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** A box of the plan's (its y0..y1 over `y`), its faces' uv in metres */
  box(b: OrientedBox, y: number, faces = 0b111111): void {
    const { cx, cz, hu, hv, cs, sn } = b;
    const y0 = y + b.y0, y1 = y + b.y1;
    // local x along (cs, -sn), local z along (sn, cs)
    const P = (a: number, c: number, h: number): Vec3 => [cx + a * cs + c * sn, h, cz - a * sn + c * cs];
    const ux: Vec3 = [cs, 0, -sn], vz: Vec3 = [sn, 0, cs];
    const H = y1 - y0;
    // +v, -v, +u, -u, top, bottom
    if (faces & 1) this.quad(P(-hu, hv, y0), P(hu, hv, y0), P(hu, hv, y1), P(-hu, hv, y1), vz, [[0, 0], [2 * hu, 0], [2 * hu, H], [0, H]]);
    if (faces & 2) this.quad(P(hu, -hv, y0), P(-hu, -hv, y0), P(-hu, -hv, y1), P(hu, -hv, y1), [-vz[0], 0, -vz[2]], [[0, 0], [2 * hu, 0], [2 * hu, H], [0, H]]);
    if (faces & 4) this.quad(P(hu, hv, y0), P(hu, -hv, y0), P(hu, -hv, y1), P(hu, hv, y1), ux, [[0, 0], [2 * hv, 0], [2 * hv, H], [0, H]]);
    if (faces & 8) this.quad(P(-hu, -hv, y0), P(-hu, hv, y0), P(-hu, hv, y1), P(-hu, -hv, y1), [-ux[0], 0, -ux[2]], [[0, 0], [2 * hv, 0], [2 * hv, H], [0, H]]);
    if (faces & 16) this.quad(P(-hu, hv, y1), P(hu, hv, y1), P(hu, -hv, y1), P(-hu, -hv, y1), [0, 1, 0], [[0, 0], [2 * hu, 0], [2 * hu, 2 * hv], [0, 2 * hv]]);
    if (faces & 32) this.quad(P(-hu, -hv, y0), P(hu, -hv, y0), P(hu, hv, y0), P(-hu, hv, y0), [0, -1, 0], [[0, 0], [2 * hu, 0], [2 * hu, 2 * hv], [0, 2 * hv]]);
  }

  /** An upright face along a → b (world), from y0 to y1, facing (nx, nz); uv across it in metres, or the given rect */
  face(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, uv?: [number, number, number, number]): void {
    const L = Math.hypot(bx - ax, bz - az);
    // (counter-clockwise from the front: a on the left as we face it, where the right is (nz, -nx))
    const flip = (bx - ax) * nz - (bz - az) * nx < 0;
    const [px, pz, qx, qz] = flip ? [bx, bz, ax, az] : [ax, az, bx, bz];
    const r = uv ?? [0, 0, L, y1 - y0];
    this.quad([px, y0, pz], [qx, y0, qz], [qx, y1, qz], [px, y1, pz], [nx, 0, nz], [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
  }

  /** An upright cylinder of radius r at (x, z) from y0 to y1, `n` sides */
  cylinder(x: number, z: number, r: number, y0: number, y1: number, n = 12): void {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 2 * Math.PI, a1 = ((k + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
      this.quad([x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r],
        [x + Math.cos(a0) * r, y1, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y1, z + Math.sin(a1) * r],
        [Math.cos(am), 0, Math.sin(am)], [[a1 * r, 0], [a0 * r, 0], [a0 * r, y1 - y0], [a1 * r, y1 - y0]]);
    }
    const i = this.count;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      this.pos.push(x + Math.cos(a) * r, y1, z + Math.sin(a) * r);
      this.nor.push(0, 1, 0);
      this.uvs.push(Math.cos(a) * r, Math.sin(a) * r);
      if (this.tag) this.tags.push(...this.tag);
    }
    for (let k = 1; k + 1 < n; k++) this.idx.push(i, i + k + 1, i + k);
  }

  /** A flat polygon (world rings, holes inside it) at height y(x, z), facing up (or down) */
  polygon(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[], y: (x: number, z: number) => number, down = false): void {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    // (the shape utilities want the contour one way round and the holes the other)
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    for (const h of hs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = [contour, ...hs].flat();
    const i = this.count;
    for (const p of all) {
      this.pos.push(p.x, y(p.x, p.y), p.y);
      this.nor.push(0, down ? -1 : 1, 0);
      this.uvs.push(p.x, p.y);
      if (this.tag) this.tags.push(...this.tag);
    }
    // (x right, z down the screen: a counter-clockwise contour in (x, z) faces down, so its triangles turn round)
    for (const [a, b, c] of tris) this.idx.push(i + a, down ? i + b : i + c, down ? i + c : i + b);
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.tags.length) geo.setAttribute('aTag', new THREE.Float32BufferAttribute(this.tags, 4));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** A mesh of each gathered list (`drape`: laid on the town's floor, for the floors walked on), into `group` */
export function addMesh(group: THREE.Object3D, geo: MeshList, material: THREE.Material, name: string,
  { drape = false, shadows = true }: { drape?: boolean; shadows?: boolean } = {}): THREE.Mesh | null {
  if (!geo.count) return null;
  const mesh = new THREE.Mesh(drape ? drapeGeometry(geo.geometry()) : geo.geometry(), material);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
