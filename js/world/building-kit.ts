// js/world/building-kit.ts
// A building kit for the places built piece by piece (the UAN's campus, uan.ts; the bottling plant, embotelladora.ts):
// pieces (boxes, shapes, planes) placed in a frame of their own (a wall's stretch, a gate, a building: its origin, its
// turn), gathered per material and per CELL m of ground and merged into one mesh each, so a whole campus is a few dozen
// draws, culled by the cell; and the colliders of what stops the player. Boxes and planes carry UVs in metres (u along
// their length, v up), which the stone, the rejas, the bricks & the louvres are drawn by. A piece in a plain colour can
// take a Tint, a colour of a shared material painted on its vertices: all of that material's colours are one mesh.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { turnedBox } from './standing.ts';
import type { Collider } from './buildings.ts';

const CELL = 200; // m of ground per merged mesh

/** A frame pieces are placed in: its origin (m) and its turn (rad: local +x along (cos, -sin), +z along (sin, cos)) */
export interface Frame {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A plain colour of a shared material: the pieces given it are drawn by `base`, their vertices coloured `color`
 *  (`base` reads them: colorNode times vertexColor()). Give `base` itself to no piece */
export class Tint {
  readonly base: THREE.Material;
  readonly color: THREE.Color;
  constructor(base: THREE.Material, hex: number) {
    this.base = base;
    this.color = new THREE.Color(hex);
  }
}

/** What a piece is drawn with: a material, or a plain colour of a shared one */
export type KitMaterial = THREE.Material | Tint;

export class Kit {
  readonly colliders: Collider[] = [];
  private readonly parts = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  /** A geometry (its own, not shared) in frame f at (x, y, z), turned `ry` more */
  add(geo: THREE.BufferGeometry, kitMat: KitMaterial, f: Frame, x: number, y: number, z: number, ry = 0, cast = true): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const mat = kitMat instanceof Tint ? kitMat.base : kitMat;
    if (kitMat instanceof Tint) {
      const { r, g: gr, b } = kitMat.color, n = g.attributes.position.count, rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) rgb.set([r, gr, b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    this.m.compose(this.v.set(f.x + x * c + z * s, f.y + y, f.z - x * s + z * c), this.q.setFromAxisAngle(this.up, f.yaw + ry), this.one);
    g.applyMatrix4(this.m);
    const cell = Math.floor((f.x + x * c + z * s) / CELL) * 4096 + Math.floor((f.z - x * s + z * c) / CELL);
    const key = `${cell}:${mat.uuid}:${cast}`;
    let entry = this.parts.get(key);
    if (!entry) this.parts.set(key, (entry = { mat, cast, geos: [] }));
    entry.geos.push(g);
  }

  /** A box w (along x) x h x d, its centre at (x, y, z) of frame f; its UVs in metres from u0 along it */
  box(f: Frame, w: number, h: number, d: number, x: number, y: number, z: number, mat: KitMaterial, u0 = 0, ry = 0, cast = true): void {
    this.add(meterBox(w, h, d, u0), mat, f, x, y, z, ry, cast);
  }

  /** A plane w x h standing on local x (facing +z), its centre at (x, y, z) of frame f; its UVs in metres (from its corner) */
  plane(f: Frame, w: number, h: number, x: number, y: number, z: number, mat: KitMaterial, ry = 0, u0 = 0): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * w, uv.getY(i) * h);
    this.add(g, mat, f, x, y, z, ry, false);
  }

  /** A plane w x h like `plane`'s, its UVs the rectangle [u0, v0, u1, v1] of a texture (a name in an atlas) */
  sign(f: Frame, w: number, h: number, x: number, y: number, z: number, mat: KitMaterial, [u0, v0, u1, v1]: [number, number, number, number], ry = 0): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    this.add(g, mat, f, x, y, z, ry, false);
  }

  /** A collider over a box of frame f: centre (x, z), half sizes hx (along x) & hz, from y0 to y1 over the frame's y */
  collide(f: Frame, x: number, z: number, hx: number, hz: number, y0: number, y1: number, ry = 0): void {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    this.colliders.push(turnedBox(f.x + x * c + z * s, f.z - x * s + z * c, hx, hz, f.yaw + ry, f.y + y0, f.y + y1));
  }

  /** Everything gathered, merged per material & cell, into `group` */
  build(group: THREE.Group): number {
    let meshes = 0;
    for (const { mat, cast, geos } of this.parts.values()) {
      const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      meshes++;
    }
    this.parts.clear();
    return meshes;
  }
}

// A box w x h x d about its centre with UVs in metres: u along x (along z on its ends) from u0, v up (along z on top)
function meterBox(w: number, h: number, d: number, u0: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, u0 + x, z);
    else if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, u0 + z, y);
    else uv.setXY(i, u0 + x, y);
  }
  return g;
}
