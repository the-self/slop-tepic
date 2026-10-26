// js/world/car-parks.ts
// Draws Tepic's surface car parks (parking.ts lays them out): the lot's asphalt (or concrete, adoquín or earth, as
// OpenStreetMap says) a hair over the block's ground, the white lines between the stalls, laid on the town's slopes like
// the road paint, and the cars standing in some of the stalls. The cars are the traffic's own body shapes stretched to
// real models (models/cars, by their rarity), drawn only round the camera: the full model near it, the ~250-triangle
// stand-in further out, nothing past CAR_RADIUS. Each one stops the player like a wall (a collider of the city's).
import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.ts';
import { liftAt } from './ground.ts';
import { drapeGeometry } from './drape.ts';
import { indexHouses } from './lot-greenery.ts';
import { hash } from './hash.ts';
import { carParks, inCarPark, layStalls, parkCars, STALL_D, STALL_W } from './parking.ts';
import { createPavementMaterial, createRoadPaintMaterial, createRoadSurfaceMaterial } from '../render/tsl-materials.ts';
import { BODY_SPECS, bodyDims, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial } from '../actors/actor-models.ts';
import { paintsOf, pickBody, pickModel } from '../models/cars/index.ts';
import type { CarPark, ParkedCar } from './parking.ts';
import type { Collider } from './buildings.ts';
import type { TileStreamer } from './streaming.ts';

// The ground's heights the city-grid lays (city-grid.ts): a block's open ground just over its sidewalks, a park's walks,
// the open country's meadow; the lot a hair over each, its paint a hair over that
const SW_TOP = 0.22;
const PARK_Y = 0.26;
const PAINT = 0.012;
const LINE_W = 0.12; // m: the stall lines
const WHITE = new THREE.Color(0xe6e2d6);
const YELLOW = new THREE.Color(0xe8ad22);

const CAR_RADIUS = 320; // m round the camera the parked cars are drawn
const NEAR_RADIUS = 60; // m: the full model within it, the stand-in beyond
const REDRAW = 20; // m the camera moves before the cars round it are handed out again
const CAR_CELL = 100; // m: the cells the parked cars are found by

/** The ground a lot lies on (m over the town's floor): its block's */
function lotHeight(lot: CarPark): number {
  const p = lot.pts[0];
  // (a point just inside the lot: its first vertex nudged towards the middle)
  const cx = (lot.minX + lot.maxX) / 2, cz = (lot.minZ + lot.maxZ) / 2;
  const b = blockAt(p.x + (cx - p.x) * 0.02, p.z + (cz - p.z) * 0.02);
  return !b || b.rural ? 0.05 : b.park > 0.6 ? PARK_Y + 0.012 : SW_TOP + 0.018;
}

/** A layer of flat ground, built at y = 0 in world space: positions, its normals (up) and any other attributes */
class FlatLayer {
  position: number[] = [];
  index: number[] = [];
  extra = new Map<string, { size: number; values: number[] }>();
  vertex(x: number, y: number, z: number, attrs: Record<string, readonly number[]> = {}): number {
    this.position.push(x, y, z);
    for (const [name, v] of Object.entries(attrs)) {
      let a = this.extra.get(name);
      if (!a) this.extra.set(name, (a = { size: v.length, values: [] }));
      a.values.push(...v);
    }
    return this.position.length / 3 - 1;
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.index.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.position.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    for (const [name, a] of this.extra) g.setAttribute(name, new THREE.Float32BufferAttribute(a.values, a.size));
    g.setIndex(this.index);
    return g;
  }
}

// A lot's outline triangulated into `layer` at height y, each triangle wound to face up (as airport.ts)
function fillLot(layer: FlatLayer, lot: CarPark, y: number, attrs: Record<string, readonly number[]> = {}): void {
  const contour = lot.pts.map((p) => new THREE.Vector2(p.x, p.z));
  if (contour.length < 3) return;
  const v = contour.map((p) => layer.vertex(p.x, y, p.y, attrs));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const A = contour[a], B = contour[b], C = contour[c];
    const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
    layer.index.push(v[a], up ? v[b] : v[c], up ? v[c] : v[b]);
  }
}

// A painted line from a to b, LINE_W wide, for the road paint's material (road-paint.ts: `side` its half width out from
// its middle, `paint` metres along it, its dash period & duty: a solid line)
function paintLine(layer: FlatLayer, ax: number, az: number, bx: number, bz: number, y: number, col: THREE.Color): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const sx = ((az - bz) / len) * LINE_W * 0.5, sz = ((bx - ax) / len) * LINE_W * 0.5;
  const rgb = [col.r, col.g, col.b];
  const i = layer.vertex(ax - sx, y, az - sz, { side: [-sx, -sz], paint: [0, 1, 1], color: rgb });
  layer.vertex(ax + sx, y, az + sz, { side: [sx, sz], paint: [0, 1, 1], color: rgb });
  layer.vertex(bx + sx, y, bz + sz, { side: [sx, sz], paint: [len, 1, 1], color: rgb });
  layer.vertex(bx - sx, y, bz - sz, { side: [-sx, -sz], paint: [len, 1, 1], color: rgb });
  layer.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

/** A parked car as drawn: where it stands (m, on the ground), its turn and tilt (rad), its body shape stretched to its
 *  model's size, its paint, and its half width & length (m) */
interface PlacedCar {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  body: string;
  sx: number;
  sy: number;
  sz: number;
  paint: THREE.Color;
  halfW: number;
  halfL: number;
  height: number;
}

/** One body shape's instanced meshes: the full model and the stand-in, room for every parked car of that shape */
interface BodyMeshes {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
}

function placeCar(car: ParkedCar, y0: number): PlacedCar | null {
  const body = pickBody(car.model);
  const model = pickModel(body, (car.model * 7.31) % 1);
  if (!model) return null;
  const spec = BODY_SPECS[body]; // (the traffic's body shapes, pickBody's)
  const dims = bodyDims(spec);
  const paints = paintsOf(model);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const x = car.stall.x + fx * car.shift, z = car.stall.z + fz * car.shift;
  // (its length within the stall: a car longer than it pokes out into the aisle, its back to the stall's end)
  const len = model.size[0];
  const back = Math.max(0, (len - STALL_D + 0.3) / 2);
  const cx = x + fx * back, cz = z + fz * back;
  // the ground's tilt under it: rise ahead and to its right (its local +x)
  const ahead = (liftAt(cx + fx * 1.5, cz + fz * 1.5) - liftAt(cx - fx * 1.5, cz - fz * 1.5)) / 3;
  const right = (liftAt(cx + fz * 0.8, cz - fx * 0.8) - liftAt(cx - fz * 0.8, cz + fx * 0.8)) / 1.6;
  return {
    x: cx, y: liftAt(cx, cz) + y0, z: cz, yaw: car.heading, pitch: -Math.atan(ahead), roll: Math.atan(right), body,
    sx: model.size[1] / dims.width, sy: model.size[2] / dims.height, sz: model.size[0] / dims.length,
    paint: new THREE.Color(paints[Math.floor(car.paint * paints.length) % paints.length]),
    halfW: model.size[1] / 2, halfL: model.size[0] / 2, height: model.size[2]
  };
}

/**
 * Builds the car parks into the scene (their ground & paint to `streamer` when there is one, laid tile by tile round
 * the camera). Returns the lots (for what must keep clear of them: the yards' trees), the parked cars' colliders, and
 * `update(x, z)`, which hands the cars round the camera their instances
 */
function buildCarParks(scene: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'> | null = null) {
  const lots = carParks(GEO.parking);
  const walls = indexHouses(GEO.houses, GEO.houseStride || 8);
  // the lots' ground by surface (0 asphalt, then the pavements' concreto, adoquín & tierra), and their paint
  const asphalt = new FlatLayer();
  const paved = new FlatLayer();
  const paint = new FlatLayer();
  const PAVE = [0, 3, 1, 2]; // (createPavementMaterial's kinds: 3 concreto, 1 adoquín, 2 tierra)
  const placed: PlacedCar[] = [];
  let stallCount = 0;
  for (const lot of lots) {
    const y = lotHeight(lot);
    if (lot.surface === 0) fillLot(asphalt, lot, y);
    else fillLot(paved, lot, y, { pave: [PAVE[lot.surface]] });
    const stalls = layStalls(lot, walls.wallDistance);
    stallCount += stalls.length;
    // lines on the asphalt & the concrete, mostly white, yellow on a few lots (nobody paints on stones or earth)
    if (lot.surface <= 1) {
      const col = hash(lot.minX, lot.minZ, 31) < 0.2 ? YELLOW : WHITE;
      for (const s of stalls) {
        const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
        const half = STALL_D / 2;
        for (const [on, side] of [[s.lineA, -1], [s.lineB, 1]] as const) {
          if (!on) continue;
          const ox = s.x + s.ux * side * STALL_W / 2, oz = s.z + s.uz * side * STALL_W / 2;
          paintLine(paint, ox - fx * half, oz - fz * half, ox + fx * half, oz + fz * half, y + PAINT, col);
        }
      }
    }
    for (const car of parkCars(stalls, { fill: lot.name ? 0.62 : 0.48 })) {
      const p = placeCar(car, y);
      if (p) placed.push(p);
    }
  }

  const group = new THREE.Group();
  group.name = 'CarParks';
  scene.add(group);
  const layers: [FlatLayer, THREE.Material, string, number][] = [
    [asphalt, createRoadSurfaceMaterial(), 'CarParkAsphalt', 0],
    [paved, createPavementMaterial(), 'CarParkPaving', 0],
    [paint, createRoadPaintMaterial(), 'CarParkPaint', -1]
  ];
  for (const [layer, material, name, renderOrder] of layers) {
    const g = layer.geometry();
    if (!g) continue;
    if (streamer) {
      streamer.addLayer(g, material, { name, renderOrder });
      continue;
    }
    const mesh = new THREE.Mesh(drapeGeometry(g), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
  }

  // The parked cars stop the player like the walls (their turned boxes, a little short of the roof)
  const colliders: Collider[] = placed.map((c) => {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const ex = Math.abs(cs) * c.halfW + Math.abs(sn) * c.halfL, ez = Math.abs(sn) * c.halfW + Math.abs(cs) * c.halfL;
    return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez, minY: c.y, maxY: c.y + c.height * 0.9,
      obb: { cx: c.x, cz: c.z, hx: c.halfW, hz: c.halfL, cs, sn } };
  });

  // The cars by CAR_CELL cell, and per body shape its two instanced meshes (the traffic's materials: the same pipelines)
  const cells = new Map<number, PlacedCar[]>();
  const cellKey = (ix: number, iz: number) => ix * 4096 + iz;
  const perBody = new Map<string, number>();
  for (const c of placed) {
    const k = cellKey(Math.floor(c.x / CAR_CELL), Math.floor(c.z / CAR_CELL));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(c);
    perBody.set(c.body, (perBody.get(c.body) ?? 0) + 1);
  }
  const meshes = new Map<string, BodyMeshes>();
  for (const [body, count] of perBody) {
    const spec = BODY_SPECS[body];
    const material = createLoftedCarMaterial(spec, null, { crumple: true });
    const make = (g: THREE.BufferGeometry) => {
      g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
      // (lamps off, no livery, not crushed)
      g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4));
      const m = new THREE.InstancedMesh(g, material, count);
      m.count = 0;
      m.castShadow = m.receiveShadow = true;
      m.name = `ParkedCars:${body}`;
      group.add(m);
      return m;
    };
    meshes.set(body, { near: make(buildCarGeometry(spec, true)), far: make(buildCarProxyGeometry(spec)) });
  }

  const dummy = new THREE.Object3D();
  let lastX = Infinity, lastZ = Infinity;
  // The cars within CAR_RADIUS of (x, z) into their meshes, once the camera has moved REDRAW m since the last time
  function update(x: number, z: number): void {
    if (Math.hypot(x - lastX, z - lastZ) < REDRAW) return;
    lastX = x;
    lastZ = z;
    for (const m of meshes.values()) m.near.count = m.far.count = 0;
    const r = Math.ceil(CAR_RADIUS / CAR_CELL);
    const ix0 = Math.floor(x / CAR_CELL), iz0 = Math.floor(z / CAR_CELL);
    for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      for (let iz = iz0 - r; iz <= iz0 + r; iz++) {
        const list = cells.get(cellKey(ix, iz));
        if (!list) continue;
        for (const c of list) {
          const d = Math.hypot(c.x - x, c.z - z);
          const m = meshes.get(c.body);
          if (d > CAR_RADIUS || !m) continue;
          const inst = d < NEAR_RADIUS ? m.near : m.far;
          const slot = inst.count++;
          dummy.position.set(c.x, c.y, c.z);
          dummy.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
          dummy.scale.set(c.sx, c.sy, c.sz);
          dummy.updateMatrix();
          inst.setMatrixAt(slot, dummy.matrix);
          const paintAttr = inst.geometry.getAttribute('paintColor');
          paintAttr.setXYZ(slot, c.paint.r, c.paint.g, c.paint.b);
        }
      }
    }
    for (const m of meshes.values()) {
      for (const inst of [m.near, m.far]) {
        inst.instanceMatrix.clearUpdateRanges();
        inst.instanceMatrix.addUpdateRange(0, inst.count * 16);
        inst.instanceMatrix.needsUpdate = true;
        const paintAttr = inst.geometry.getAttribute('paintColor');
        if (paintAttr instanceof THREE.BufferAttribute) {
          paintAttr.clearUpdateRanges();
          paintAttr.addUpdateRange(0, inst.count * 3);
          paintAttr.needsUpdate = true;
        }
        inst.visible = inst.count > 0;
        if (inst.count) inst.computeBoundingSphere();
      }
    }
  }

  console.info(`[car parks] ${lots.length} lots, ${stallCount} stalls, ${placed.length} cars parked`);
  return {
    lots,
    colliders,
    /** Whether (x, z) lies in a car park */
    contains: (px: number, pz: number) => lots.some((l) => inCarPark(l, px, pz)),
    update
  };
}

type CarParksBuild = ReturnType<typeof buildCarParks>;

export type { CarParksBuild };
export { buildCarParks };
