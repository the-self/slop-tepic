import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY_OUTLINE, BLOCKS, blockAt } from './city-config.ts';
import {
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createParkLawnMaterial,
  createParkPavingMaterial,
  createParkLampGlobeMaterial,
  createParkLampPoolMaterial,
  createLotGroundMaterial,
  createPitchMaterial,
  createCyclewayMaterial
} from '../render/tsl-materials.ts';
import { GEO } from './city-geodata.js';
import { SLOPES, liftAt, groundSlope } from './ground.ts';
import { drapeMeshes, streamMeshes, cutOnCells } from './drape.ts';
import { cutDeckHoles } from './river-channels.ts';
import { openness } from './lot-greenery.ts';
import { lampFinder } from './mapped-lamps.ts';
import { cyclewayRuns, CYCLEWAY_HALF } from './medians.ts';
import { insidePoly, insideRing, polyCover } from './rings.ts';
import { nearPlaceBuilding } from './place-claims.ts';
import { PARK_WALK_Y as PARK_Y, PARK_BED_Y as BED_Y, isRaisedPark, offsetPolygonInward, parkBed } from './park-floor.ts';
import type { PlaceClaims } from './place-claims.ts';
import type { Bounds, CityBlock, PointXZ } from './city-config.ts';
import type { CyclewayPoint } from './medians.ts';
import type { TileStreamer } from './streaming.ts';

/** A park tree to plant (m): `y` the ground it stands on, `scale` over the species' usual, `species` trees.ts SPECIES;
 *  `tier` on the street trees buildings.ts adds to the list. */
export interface ParkTreeSite {
  x: number;
  y: number;
  z: number;
  scale: number;
  species: number;
  tier?: number;
}
/** A raised sidewalk slab (m): an axis-aligned block's, or (`cover`) an irregular island's lot cover; `draped` when it
 *  went into the slabs laid on the slopes instead of the instanced ones. */
export interface SidewalkSlab {
  cx: number;
  cz: number;
  w: number;
  d: number;
  block: CityBlock;
  draped?: boolean;
  cover?: boolean;
}
/** What buildCityGrid hands back: the curbs bounding the roads, the footprints traffic keeps clear of (m), the valley
 *  floor's mesh, and how open each block's lot lies (0..1, lot-greenery.ts openness). */
export interface CityGrid {
  group: THREE.Group;
  sidewalks: Bounds[];
  footprints: Bounds[];
  highwayLanes: never[];
  colliders: never[];
  valley: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
  open: Map<CityBlock, number>;
}
type Vec3 = [x: number, y: number, z: number];

// Live construction data consumed by the building and street-detail builders after buildCityGrid().
let parkTreeSites: ParkTreeSite[] | undefined;
let parkLampSites: { x: number; y: number; z: number }[] | undefined;
let pavedPlazaRects: Bounds[] | undefined;
let sidewalkBlocks: SidewalkSlab[] | undefined;
let medianRuns: CyclewayPoint[][] | undefined; // the Libramiento's cycleway (medians.ts cyclewayRuns), for its trees (street-details.ts)

// js/world/city-grid.ts
// Builds the city's ground: the valley floor, the roadway deck over the city outline, the raised sidewalks &
// curbstones of every real curb island (city-config.ts BLOCKS), the open country between the roads, and the parks &
// plazas with their walks, lawns, trees and lamps. All of it is built flat at y = 0 and laid on the town's slopes at
// the end (drape.ts), its lamps & trees set on the ground under them.

// A plain (not instanced) mesh, by three's own flags
const isPlainMesh = (obj: THREE.Object3D): obj is THREE.Mesh =>
  'isMesh' in obj && Boolean(obj.isMesh) && !('isInstancedMesh' in obj && obj.isInstancedMesh);

/**
 * Merges static non-instanced THREE.Mesh objects sharing the same material into a single
 * batched BufferGeometry per material to minimize WebGPU render & shadow pass draw calls.
 */
function batchStaticGroupMeshes(rootGroup: THREE.Object3D, excludeMaterials: ReadonlySet<THREE.Material | THREE.Material[]> | null = null) {
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map<THREE.Material | THREE.Material[], THREE.Mesh[]>();

  rootGroup.traverse((obj) => {
    if (!isPlainMesh(obj)) return;
    if (excludeMaterials?.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!('position' in attrs) || !('normal' in attrs) || !('uv' in attrs)) return;
    let list = buckets.get(obj.material);
    if (!list) {
      buckets.set(obj.material, (list = []));
    }
    list.push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      m.parent?.remove(m);
    }

    // (mergeGeometries returns null when they can't be merged, which its typings leave out)
    const merged = mergeGeometries(geos, false) as THREE.BufferGeometry | null;
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z)
 * with an upward (+Y) surface normal.
 */
function createWorldXZShape(pts: PointXZ[]) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  return shape;
}

function createExtrudedPolygonMesh(pts: PointXZ[], bottomY: number, height: number, material: THREE.Material, receiveShadow = true,
  castShadow = false) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

/**
 * A curb as much as shows of it around a sidewalk slab inset into it: the walls of `outer` from the ground up to
 * `height`, and the top as the ring between `outer` and `inner` (the same polygon offset inward, vertex by vertex).
 * Laid on the slopes its full top would be cut up along the ground's lattice under the slab for nothing.
 */
function createCurbRingGeometry(outer: PointXZ[], inner: PointXZ[], height: number) {
  const position: number[] = [];
  const normal: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3, nx: number, ny: number, nz: number) => {
    // wound to face (nx, ny, nz)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const face = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (face < 0) [b, c] = [c, b];
    position.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) normal.push(nx, ny, nz);
  };
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const p = outer[i], q = outer[(i + 1) % n], pi = inner[i], qi = inner[(i + 1) % n];
    // the wall faces away from the inner ring
    let ox = -(q.z - p.z), oz = q.x - p.x;
    const len = Math.hypot(ox, oz) || 1;
    ox /= len; oz /= len;
    if ((pi.x + qi.x - p.x - q.x) * ox + (pi.z + qi.z - p.z - q.z) * oz > 0) { ox = -ox; oz = -oz; }
    const p0: Vec3 = [p.x, 0, p.z], q0: Vec3 = [q.x, 0, q.z], p1: Vec3 = [p.x, height, p.z], q1: Vec3 = [q.x, height, q.z];
    tri(p0, q0, q1, ox, 0, oz);
    tri(p0, q1, p1, ox, 0, oz);
    const pin: Vec3 = [pi.x, height, pi.z], qin: Vec3 = [qi.x, height, qi.z];
    tri(p1, q1, qin, 0, 1, 0);
    tri(p1, qin, pin, 0, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((position.length / 3) * 2), 2));
  return geo;
}

function createFlatPolygonMesh(pts: PointXZ[], y: number, material: THREE.Material, receiveShadow = true): THREE.Mesh {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 hex asphalt pavers, 1 light granite plaza pavers, 2 bluestone slabs).
 */
function setPavingStyle(geo: THREE.BufferGeometry, style: number) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

// With `streamer` (streaming.ts) the flat ground layers go to it, laid tile by tile around the camera, instead of
// laid on the slopes whole here

// The mapped pitches & the stadiums' fields (OpenStreetMap's leisure=pitch | stadium), by PLAY_CELL m cell: no tree or
// lamp of the game's own stands on one, nor within PLAY_CLEAR m of its edge (the park's, the lots' & yards')
const PLAY_CLEAR = 3, PLAY_CELL = 50;
let PLAYS: Map<number, number[][]> | null = null;
function onPitch(x: number, z: number): boolean {
  if (!PLAYS) {
    PLAYS = new Map();
    for (const p of GEO.parks) {
      if (p.cat !== 'pitch' && p.cat !== 'stadium') continue;
      for (const r of p.rings) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
        for (let ix = Math.floor((x0 - PLAY_CLEAR) / PLAY_CELL); ix <= Math.floor((x1 + PLAY_CLEAR) / PLAY_CELL); ix++) {
          for (let iz = Math.floor((z0 - PLAY_CLEAR) / PLAY_CELL); iz <= Math.floor((z1 + PLAY_CLEAR) / PLAY_CELL); iz++) {
            const k = ix * 100003 + iz;
            let list = PLAYS.get(k);
            if (!list) PLAYS.set(k, (list = []));
            list.push(r);
          }
        }
      }
    }
  }
  return (PLAYS.get(Math.floor(x / PLAY_CELL) * 100003 + Math.floor(z / PLAY_CELL)) ?? []).some((r) =>
    ([[0, 0], [PLAY_CLEAR, 0], [-PLAY_CLEAR, 0], [0, PLAY_CLEAR], [0, -PLAY_CLEAR]] satisfies [number, number][]).some(([dx, dz]) => insideRing(r, x + dx, z + dz)));
}

/** `places`: what the places (js/places/) claim of the ground: no lamp, no goal against their buildings */
function buildCityGrid(scene: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'> | null, places: readonly PlaceClaims[]): CityGrid {
  const group = new THREE.Group();
  group.name = 'CityGrid';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // Ground footprints that traffic and pedestrians must keep clear of (medians, plazas, monuments, parks)
  const footprints: Bounds[] = [];
  const addFootprint = (x: number, z: number, w: number, d: number) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // =========================================================================
  // 1. THE VALLEY FLOOR
  // =========================================================================
  let valleyMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
  {
    // Dry valley floor out to the horizon around the detailed box (the roads deck sits on it). On the town's slopes the
    // hills' mesh (terrain.ts) is the ground over all of its grid, and the floor rings it at the far floor's height
    const groundMat = new THREE.MeshStandardNodeMaterial({ color: 0x56653c, roughness: 0.96, metalness: 0.0 });
    let groundGeo: THREE.BufferGeometry;
    const T = GEO.terrain;
    if (SLOPES && T && GEO.ground) {
      const R = 30000;
      const ring = createWorldXZShape([{ x: -R, z: -R }, { x: R, z: -R }, { x: R, z: R }, { x: -R, z: R }]);
      const x1 = T.x0 + (T.w - 1) * T.cell, z1 = T.z0 + (T.h - 1) * T.cell;
      ring.holes.push(createWorldXZShape([{ x: T.x0, z: T.z0 }, { x: x1, z: T.z0 }, { x: x1, z: z1 }, { x: T.x0, z: z1 }]));
      groundGeo = new THREE.ShapeGeometry(ring, 1);
      groundGeo.rotateX(-Math.PI / 2);
    } else {
      groundGeo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
      groundGeo.rotateX(-Math.PI / 2);
    }
    valleyMesh = new THREE.Mesh(groundGeo, groundMat);
    valleyMesh.position.set(0, (SLOPES && GEO.ground ? GEO.ground.floor : 0) - 0.03, 0);
    valleyMesh.receiveShadow = true;
    group.add(valleyMesh);
  }

  // =========================================================================
  // 2. ROADWAY ASPHALT DECK (Y = 0.0) over the city outline
  // =========================================================================
  const roadMat = createRoadSurfaceMaterial();
  const roadMesh = createFlatPolygonMesh(CITY_OUTLINE, 0.0, roadMat, true);
  group.add(roadMesh);

  // =========================================================================
  // 3. MEADOW MATERIAL (the open country between the roads)
  // =========================================================================
  const meadowMat = createParkLawnMaterial(true);

  // =========================================================================
  // 4. RAISED SIDEWALKS & GRANITE CURBSTONES: every real curb island of the city (city-config.ts BLOCKS, from the
  //    street centreline at its curb-to-curb widths). Rectangular islands are instanced slabs; the rest (the irregular
  //    blocks, the planted medians) are extruded from their outlines
  // =========================================================================
  const sidewalkMat = createSidewalkMaterial();
  const curbMat = createCurbMaterial();
  const medianHedgeMat = new THREE.MeshStandardNodeMaterial({ color: 0x366e3b, roughness: 0.82 });
  const blockSidewalks: SidewalkSlab[] = []; // { cx, cz, w, d, block } axis-aligned slabs (irregular islands: their lot cover)
  const roadSidewalks: Bounds[] = []; // the curbs road-network.ts bounds the roads with (medians go in as footprints)
  const slabGeos: THREE.BufferGeometry[] = [];
  const curbGeos: THREE.BufferGeometry[] = [];
  const hedgeGeos: THREE.BufferGeometry[] = [];
  const SW_TOP = 0.22;
  const COVER_GROW = Math.max(0.5, (GEO.frame.sidewalk || 4.6) - 0.2);
  for (const b of BLOCKS) {
    if (b.park > 0.6 && !b.median) continue; // parks build their own perimeter sidewalk (section 7)
    if (b.rect) {
      const slab: SidewalkSlab = { cx: (b.minX + b.maxX) * 0.5, cz: (b.minZ + b.maxZ) * 0.5, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b };
      blockSidewalks.push(slab);
      if (SLOPES) {
        // laid on the slopes with the extruded islands (an instanced box can't bend)
        slabGeos.push(new THREE.BoxGeometry(slab.w - 0.5, 0.19, slab.d - 0.5).translate(slab.cx, 0.125, slab.cz).toNonIndexed());
        curbGeos.push(new THREE.BoxGeometry(slab.w, 0.17, slab.d).translate(slab.cx, 0.095, slab.cz).toNonIndexed());
        slab.draped = true;
      }
      if (b.median) addFootprint(slab.cx, slab.cz, slab.w, slab.d);
      else roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      // curb (granite) ring under a sidewalk slab inset by 0.25 m, like the instanced pair below
      const inner = offsetPolygonInward(b.poly, 0.25);
      curbGeos.push(SLOPES && inner ? createCurbRingGeometry(b.poly, inner, 0.18) : createExtrudedPolygonMesh(b.poly, 0.0, 0.18, curbMat).geometry);
      if (inner) slabGeos.push(createExtrudedPolygonMesh(inner, 0.03, SW_TOP - 0.03, sidewalkMat).geometry);
      // rect cover for the consumers that work on rectangles: the lot rects grown back out to (just short of) the curb,
      // by the city's sidewalk width (2.2 m in Tepic: more would reach into the lanes)
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - COVER_GROW, maxX: x1 + COVER_GROW, minZ: z0 - COVER_GROW, maxZ: z1 + COVER_GROW };
        blockSidewalks.push({ cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        if (!b.median) roadSidewalks.push(r);
      }
      if (b.median) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    // Planted medians down the middle of the boulevards: a clipped hedge on the slab
    if (b.median && Math.min(b.maxX - b.minX, b.maxZ - b.minZ) > 2.2) {
      const hedge = offsetPolygonInward(b.poly, 1.0);
      if (hedge) hedgeGeos.push(createExtrudedPolygonMesh(hedge, SW_TOP, 0.55, medianHedgeMat).geometry);
    }
  }
  const mergeInto = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = false) => {
    for (let i = 0; i < geos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(geos.slice(i, i + 400), false), mat);
      m.receiveShadow = true;
      m.castShadow = cast;
      group.add(m);
    }
  };
  mergeInto(curbGeos, curbMat, true);
  mergeInto(slabGeos, sidewalkMat);
  mergeInto(hedgeGeos, medianHedgeMat, true);

  const rectSlabs = blockSidewalks.filter((s) => !s.cover && !s.draped);
  const swInstanced = new THREE.InstancedMesh(unitBox, sidewalkMat, rectSlabs.length);
  const curbInstanced = new THREE.InstancedMesh(unitBox, curbMat, rectSlabs.length);
  swInstanced.receiveShadow = true;
  curbInstanced.receiveShadow = true;
  curbInstanced.castShadow = true;

  rectSlabs.forEach((blk, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(blk.cx, 0.125, blk.cz);
    dummy.scale.set(blk.w - 0.5, 0.19, blk.d - 0.5);
    dummy.updateMatrix();
    swInstanced.setMatrixAt(i, dummy.matrix);

    dummy.position.set(blk.cx, 0.095, blk.cz);
    dummy.scale.set(blk.w, 0.17, blk.d);
    dummy.updateMatrix();
    curbInstanced.setMatrixAt(i, dummy.matrix);
  });
  swInstanced.instanceMatrix.needsUpdate = true;
  curbInstanced.instanceMatrix.needsUpdate = true;
  if (rectSlabs.length) group.add(swInstanced, curbInstanced); // (none left on the slopes: an empty buffer can't bind)

  // 5. THE OPEN GROUND INSIDE THE BLOCKS: inside the sidewalk band, everything between the houses is ground as the
  //    satellite shows it (lot-greenery.ts): grass, weeds & bare earth on the vacant lots and fields, patios in the
  //    built-up blocks. Just over the sidewalk's top; the houses standing on it hide the rest
  const lotMat = createLotGroundMaterial();
  const SIDEWALK = GEO.frame.sidewalk || 2.2;
  const open = openness(BLOCKS, GEO.houses, blockAt, { stride: GEO.houseStride || 8, sidewalk: SIDEWALK });
  {
    const lotGeos: THREE.BufferGeometry[] = [];
    for (const b of BLOCKS) {
      if (b.park > 0.6 || b.median || b.area < 60) continue;
      const lot = offsetPolygonInward(b.poly, SIDEWALK + 0.25);
      if (!lot) continue;
      const geo = createFlatPolygonMesh(lot, SW_TOP + 0.012, lotMat).geometry;
      geo.setAttribute('open', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(open.get(b) ?? 1), 1));
      lotGeos.push(geo);
    }
    for (let i = 0; i < lotGeos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(lotGeos.slice(i, i + 400), false), lotMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // 5b. THE LIBRAMIENTO'S CICLOVÍA: down the middle of the wide camellón between the Periférico's two carriageways
  //     (medians.ts), a two-way bike path in red concrete with its white lines, over the median's ground
  const cyclewayMat = createCyclewayMaterial();
  {
    const inMedian = (x: number, z: number) => {
      const b = blockAt(x, z);
      return !!b && !b.rural && !(b.park > 0.6) && (open.get(b) ?? 0) > 0.97;
    };
    medianRuns = cyclewayRuns(GEO.roads, { inMedian });
    const position: number[] = [], normal: number[] = [], uvs: number[] = [];
    type Corner = [x: number, z: number, u: number, v: number];
    // a triangle facing up whichever way the run goes (three's front faces wind counter-clockwise: (b−a)×(c−a) up)
    const tri = (a: Corner, b: Corner, c: Corner) => {
      if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
      for (const [x, z, u, v] of [a, b, c]) {
        position.push(x, SW_TOP + 0.024, z);
        normal.push(0, 1, 0);
        uvs.push(u, v);
      }
    };
    for (const run of medianRuns) {
      let along = 0;
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1], b = run[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        // the path's edges: u 0 on the left, 1 on the right; v metres along it
        const a0: Corner = [a.x - a.tz * CYCLEWAY_HALF, a.z + a.tx * CYCLEWAY_HALF, 0, along], a1: Corner = [a.x + a.tz * CYCLEWAY_HALF, a.z - a.tx * CYCLEWAY_HALF, 1, along];
        const b0: Corner = [b.x - b.tz * CYCLEWAY_HALF, b.z + b.tx * CYCLEWAY_HALF, 0, along + len], b1: Corner = [b.x + b.tz * CYCLEWAY_HALF, b.z - b.tx * CYCLEWAY_HALF, 1, along + len];
        tri(a0, b1, a1);
        tri(a0, b0, b1);
        along += len;
      }
    }
    if (position.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const m = new THREE.Mesh(geo, cyclewayMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // 6. Park furniture shared by the parks (section 7): paving, granite copings, lampposts & trees
  const pavingMat = createParkPavingMaterial();
  const graniteMat = new THREE.MeshStandardNodeMaterial({ color: 0x86837c, roughness: 0.8 }); // bed copings
  const lampMatrices: THREE.Matrix4[] = []; // cast-iron lampposts with glass globes
  const treeSites: ParkTreeSite[] = []; // { x, y, z, scale, species } park trees planted by street-details.ts (section 7)
  const pavedRects: Bounds[] = []; // park slab bounds, exported so street trees (street-details.ts) stay off them

  const nearMappedLamp = lampFinder(GEO.lamps);
  function addLamp(x: number, y: number, z: number) {
    if (onPitch(x, z) || nearPlaceBuilding(places, x, z, 1)) return;
    lampMatrices.push(new THREE.Matrix4().makeTranslation(x, y + liftAt(x, z), z));
  }

  // 7. THE PARKS: every park block's curb island paved like a park walk, a granite-coped lawn inset from it under
  //    scattered trees, lampposts on the perimeter; the open country around the city as meadow
  // (the walks at PARK_Y, the lawn at BED_Y: park-floor.ts, which the walker stands on)
  const PARK_COVER_BAND = 1.5; // m: the depth of the boxes an irregular park's footprint is made of (rings.ts polyCover)
  const prand = (x: number, z: number, k = 0) => {
    const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  const genericParks = BLOCKS.filter(isRaisedPark);
  // Open country between the roads around an inland city: meadow flush with the road, no walks, lamps or trees
  {
    const fieldGeos: THREE.BufferGeometry[] = [];
    for (const b of BLOCKS) if (b.rural) fieldGeos.push(createFlatPolygonMesh(b.poly, 0.03, meadowMat, true).geometry);
    for (let i = 0; i < fieldGeos.length; i += 400) {
      const m = new THREE.Mesh(mergeGeometries(fieldGeos.slice(i, i + 400), false), meadowMat);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  const parkLawnMat = createParkLawnMaterial(false);
  const parkLawnGeos: THREE.BufferGeometry[] = [];
  for (const b of genericParks) {
    const slab = offsetPolygonInward(b.poly, 0.1) ?? b.poly;
    group.add(createExtrudedPolygonMesh(b.poly, 0.0, PARK_Y - 0.04, curbMat, true, false));
    const top = createExtrudedPolygonMesh(slab, 0.0, PARK_Y, pavingMat, true, false);
    setPavingStyle(top.geometry, 0);
    group.add(top);
    pavedRects.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    // (an irregular park by its outline: the bounds of a strip down a boulevard's median, Insurgentes', take in both
    // roadways, and the traffic would lose the lanes beside it)
    if (b.rect) addFootprint((b.minX + b.maxX) * 0.5, (b.minZ + b.maxZ) * 0.5, b.maxX - b.minX, b.maxZ - b.minZ);
    else footprints.push(...polyCover(b.poly, PARK_COVER_BAND));
    const bed = parkBed(b);
    if (!bed) continue;
    group.add(createExtrudedPolygonMesh(bed, 0.2, BED_Y - 0.21, graniteMat, true, false));
    // the lawn inside the copings (the New York code merged its park lawns elsewhere, so Tepic's parks showed the bare
    // granite bed until the satellite's green came in)
    const lawnTop = offsetPolygonInward(bed, 0.3);
    if (lawnTop) parkLawnGeos.push(createFlatPolygonMesh(lawnTop, BED_Y + 0.006, parkLawnMat).geometry);
    // trees on a jittered grid inside the bed
    const SP = 11;
    for (let gx = b.minX + SP * 0.5; gx < b.maxX; gx += SP) {
      for (let gz = b.minZ + SP * 0.5; gz < b.maxZ; gz += SP) {
        const tx = gx + (prand(gx, gz) - 0.5) * SP * 0.7;
        const tz = gz + (prand(gz, gx, 1) - 0.5) * SP * 0.7;
        if (prand(tx, tz, 9) < 0.3) continue; // glades
        const inner = lawnTop ?? bed;
        if (!insidePoly(inner, tx, tz)) continue;
        // Tepic's park trees (trees.ts): laureles de la India most, then mangos, jacarandas, tabachines & a few palms
        const r = prand(tx, tz, 2);
        const species = r < 0.45 ? 0 : r < 0.6 ? 2 : r < 0.75 ? 1 : r < 0.9 ? 3 : 4;
        treeSites.push({ x: tx, y: BED_Y + liftAt(tx, tz), z: tz, scale: 0.9 + prand(tx, tz, 3) * 0.4, species });
      }
    }
    // lampposts every ~34 m along the walk (not round a lamp the map has: street-details.ts puts that one up)
    for (let i = 0; i < slab.length; i++) {
      const a = slab[i];
      const c = slab[(i + 1) % slab.length];
      const len = Math.hypot(c.x - a.x, c.z - a.z);
      for (let t = 17; t < len - 8; t += 34) {
        const px = a.x + ((c.x - a.x) * t) / len;
        const pz = a.z + ((c.z - a.z) * t) / len;
        if (!nearMappedLamp(px, pz)) addLamp(px, PARK_Y, pz);
      }
    }
  }

  for (let i = 0; i < parkLawnGeos.length; i += 400) {
    const m = new THREE.Mesh(mergeGeometries(parkLawnGeos.slice(i, i + 400), false), parkLawnMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // Instanced park furniture: cast-iron lampposts with globes
  if (lampMatrices.length) {
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.055, 0.085, 3.1, 8).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.13, 0.07, 0.2, 8).translate(0, 3.85, 0)
    ]);
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1c201d, roughness: 0.45, metalness: 0.6 });
    const globeGeo = new THREE.SphereGeometry(0.27, 12, 8).translate(0, 4.17, 0);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampMatrices.length);
    const globeInst = new THREE.InstancedMesh(globeGeo, createParkLampGlobeMaterial(), lampMatrices.length);
    lampMatrices.forEach((m, i) => {
      poleInst.setMatrixAt(i, m);
      globeInst.setMatrixAt(i, m);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    globeInst.instanceMatrix.needsUpdate = true;
    poleInst.castShadow = true;
    poleInst.computeBoundingSphere();
    globeInst.computeBoundingSphere();
    group.add(poleInst, globeInst);

    // Warm pools of lamplight on the walks & bed copings after dusk (additive decal, black by day)
    const poolInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), createParkLampPoolMaterial(), lampMatrices.length);
    const poolM = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), tilt = new THREE.Quaternion();
    const at = new THREE.Vector3(), size = new THREE.Vector3(14, 1, 14), slope = [0, 0];
    lampMatrices.forEach((m, i) => {
      // tilted with the ground: a flat 14 m pool would stand off a sloping walk on one side
      if (SLOPES) groundSlope(m.elements[12], m.elements[14], slope);
      tilt.setFromUnitVectors(up, normal.set(-slope[0], 1, -slope[1]).normalize());
      poolInst.setMatrixAt(i, poolM.compose(at.set(m.elements[12], m.elements[13] + 0.17, m.elements[14]), tilt, size));
    });
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.computeBoundingSphere();
    group.add(poolInst);
  }

  // 8. THE REAL PARKS' & WOODS' TREES: the city's parks, gardens, cemeteries, golf course, mango orchards and the
  //    woods round the town (GEO.parks, from OpenStreetMap) are planted on a jittered grid at their own spacing
  //    (m) with their own share of glades, wherever they lie on parkland or open country (never on a house block or
  //    a road) that no granite park bed (section 7) has planted already: the Alameda, Parque La Loma, the Panteón
  //    Hidalgo... The woods only within ~300 m of the town (beyond, the hills' ground stands for them)
  {
    const GREEN: Partial<Record<string, [spacing: number, glade: number]>> = {
      park: [10, 0.15], garden: [9, 0.2], recreation_ground: [16, 0.4], cemetery: [13, 0.3],
      golf_course: [22, 0.5], orchard: [8, 0.04], wood: [14, 0.12], forest: [14, 0.12]
    };
    // species by place: [laurel, jacaranda, mango, tabachín, palm] shares
    const MIX: Partial<Record<string, number[]>> = {
      park: [0.42, 0.16, 0.12, 0.18, 0.12], garden: [0.42, 0.16, 0.12, 0.18, 0.12], recreation_ground: [0.4, 0.15, 0.2, 0.2, 0.05],
      cemetery: [0.5, 0.2, 0.05, 0.1, 0.15], golf_course: [0.35, 0.2, 0.1, 0.15, 0.2], orchard: [0, 0, 1, 0, 0],
      wood: [0.3, 0.1, 0.35, 0.25, 0], forest: [0.3, 0.1, 0.35, 0.25, 0]
    };
    const pick = (mix: number[], r: number) => {
      for (let k = 0; k < mix.length; k++) if ((r -= mix[k]) < 0) return k;
      return 0;
    };
    // the town: 100 m cells within 300 m of a block of houses
    const C = 100;
    const town = new Set<number>();
    for (const b of BLOCKS) {
      if (b.rural || b.park > 0.6) continue;
      for (let ix = Math.floor(b.minX / C) - 3; ix <= Math.floor(b.maxX / C) + 3; ix++) {
        for (let iz = Math.floor(b.minZ / C) - 3; iz <= Math.floor(b.maxZ / C) + 3; iz++) town.add(ix * 100003 + iz);
      }
    }
    const planted = new Set(genericParks);
    let n = 0;
    for (const p of GEO.parks) {
      const g = GREEN[p.cat], mix = MIX[p.cat];
      if (!g || !mix) continue;
      const [SP, glade] = g;
      const woods = p.cat === 'wood' || p.cat === 'forest';
      for (const r of p.rings) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < r.length; i += 2) {
          x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
          z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
        }
        for (let gx = x0 + SP * 0.5; gx < x1; gx += SP) {
          for (let gz = z0 + SP * 0.5; gz < z1; gz += SP) {
            // an orchard's rows stay in line; the rest scatter
            const jit = p.cat === 'orchard' ? 0.1 : 0.75;
            const tx = gx + (prand(gx, gz, 4) - 0.5) * SP * jit;
            const tz = gz + (prand(gz, gx, 5) - 0.5) * SP * jit;
            if (prand(tx, tz, 6) < glade || !insideRing(r, tx, tz)) continue;
            if (woods && !town.has(Math.floor(tx / C) * 100003 + Math.floor(tz / C))) continue;
            const b = blockAt(tx, tz);
            if (!b || !(b.park > 0.6 || b.rural) || planted.has(b)) continue;
            const species = pick(mix, prand(tx, tz, 7));
            const big = p.cat === 'orchard' ? 0.7 : 0.95;
            treeSites.push({ x: tx, y: (b.rural ? 0.03 : PARK_Y) + liftAt(tx, tz), z: tz, scale: big + prand(tx, tz, 8) * 0.45, species });
            n++;
          }
        }
      }
    }
    console.info(`[cityGrid] ${n} trees in the parks, cemeteries, orchards & woods of OpenStreetMap`);
  }

  // 9. THE SPORTS PITCHES (OpenStreetMap's leisure=pitch: the colonias' canchas, the fútbol rápido pitches, the
  //    schools' courts): a football field's mown turf & white lines with its goals, or under 700 m2 a painted concrete
  //    court; laid as the smallest rectangle round the mapped outline, just over the ground it is on
  const pitchMat = createPitchMaterial();
  const PITCH_CLEAR = (GEO.frame.sidewalk || 2.2) + 0.5; // m a pitch keeps in from its block's curb
  {
    const pitchGeos: THREE.BufferGeometry[] = [];
    const goals: THREE.Matrix4[] = [];
    const parkSet = new Set(genericParks);
    let oddPitches = 0; // (a rodeo's ring, a running track's field, a sliver: no pitch to draw)
    for (const p of GEO.parks) {
      const r = p.cat === 'pitch' && p.rings[0];
      if (!r || r.length < 6) continue;
      // the smallest rectangle round the outline: one of its sides lies along one of the outline's edges
      let best: { area: number; a: number; ux: number; uz: number; u0: number; u1: number; v0: number; v1: number } | null = null;
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        const a = Math.atan2(r[j + 1] - r[i + 1], r[j] - r[i]);
        const ux = Math.cos(a), uz = Math.sin(a);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (let k = 0; k < r.length; k += 2) {
          const u = r[k] * ux + r[k + 1] * uz, v = -r[k] * uz + r[k + 1] * ux;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        }
        const area = (u1 - u0) * (v1 - v0);
        if (!best || area < best.area) best = { area, a, ux, uz, u0, u1, v0, v1 };
      }
      if (!best) continue; // (none: the outline has edges)
      let { a, ux, uz } = best;
      let L = best.u1 - best.u0, W = best.v1 - best.v0;
      const cu = (best.u0 + best.u1) / 2, cv = (best.v0 + best.v1) / 2;
      const cx = cu * ux - cv * uz, cz = cu * uz + cv * ux;
      if (W > L) { [L, W] = [W, L]; a += Math.PI / 2; ux = Math.cos(a); uz = Math.sin(a); } // (u along the length)
      const b = blockAt(cx, cz);
      // (OpenStreetMap's outline may reach over the property line, onto the sidewalk and past the walls: shrunk until
      // the rectangle and the sidewalk's width round it keep to its block)
      if (b && !b.rural) {
        const fits = (l: number, w: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([i, j]) => {
          const u = i * (l / 2 + PITCH_CLEAR), v = j * (w / 2 + PITCH_CLEAR);
          return blockAt(cx + u * ux - v * uz, cz + u * uz + v * ux) === b;
        });
        for (let k = 0; k < 12 && !fits(L, W); k++) { L *= 0.97; W *= 0.97; }
      }
      if (L < 12 || W < 6 || L > 140) { oddPitches++; continue; }
      const y = !b || b.rural ? 0.05 : parkSet.has(b) ? BED_Y + 0.012 : b.park > 0.6 ? PARK_Y + 0.012 : SW_TOP + 0.024;
      const court = L * W < 700 ? 1 : 0;
      const geo = new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2).rotateY(-a).translate(cx, y, cz).toNonIndexed();
      const dims = new Float32Array(geo.attributes.position.count * 3);
      for (let k = 0; k < dims.length; k += 3) dims.set([L, W, court], k);
      geo.setAttribute('dims', new THREE.Float32BufferAttribute(dims, 3));
      pitchGeos.push(geo);
      if (court) continue;
      // the goals on the goal lines, as wide as the field's scale has them (7.32 m on a full-size pitch)
      const k = Math.max(0.25, Math.min(L / 105, W / 68));
      const gw = Math.min(7.32, Math.max(3, 7.32 * k)), gh = gw < 5 ? 2 : 2.44;
      for (const end of [-1, 1]) {
        const gx = cx + ux * end * (L / 2 - 0.4), gz = cz + uz * end * (L / 2 - 0.4);
        if (nearPlaceBuilding(places, gx, gz, 1)) continue; // (a place's building stands over that end of it: the UAN's)
        goals.push(new THREE.Matrix4().compose(new THREE.Vector3(gx, y + liftAt(gx, gz), gz),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + (end > 0 ? Math.PI : 0)), new THREE.Vector3(gw / 7.32, gh / 2.44, 1)));
      }
    }
    console.info(`[cityGrid] ${pitchGeos.length} pitches & courts of ${GEO.parks.filter((p) => p.cat === 'pitch').length} mapped (${oddPitches} of no pitch's size)`);
    for (let i = 0; i < pitchGeos.length; i += 200) {
      const m = new THREE.Mesh(mergeGeometries(pitchGeos.slice(i, i + 200), false), pitchMat);
      m.receiveShadow = true;
      group.add(m);
    }
    if (goals.length) {
      // a full-size goal (7.32 x 2.44 m, scaled to the pitch): two posts & the crossbar, the net's frame back to the ground
      const goalGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.06, 0.06, 2.44, 6).translate(0, 1.22, 3.66),
        new THREE.CylinderGeometry(0.06, 0.06, 2.44, 6).translate(0, 1.22, -3.66),
        new THREE.CylinderGeometry(0.06, 0.06, 7.44, 6).rotateX(Math.PI / 2).translate(0, 2.44, 0),
        new THREE.CylinderGeometry(0.025, 0.025, 2.9, 4).rotateZ(-0.97).translate(-0.98, 1.22, 3.66),
        new THREE.CylinderGeometry(0.025, 0.025, 2.9, 4).rotateZ(-0.97).translate(-0.98, 1.22, -3.66)
      ]);
      const goalInst = new THREE.InstancedMesh(goalGeo, new THREE.MeshStandardNodeMaterial({ color: 0xf1f1ee, roughness: 0.5 }), goals.length);
      goals.forEach((m, i) => { goalInst.setMatrixAt(i, m); });
      goalInst.castShadow = true;
      goalInst.computeBoundingSphere();
      group.add(goalInst);
    }
  }

  // Park & plaza tree and lamp sites, read by street-details.ts after the city grid is built
  parkTreeSites = treeSites.filter((t) => !onPitch(t.x, t.z));
  parkLampSites = lampMatrices.map((m) => ({ x: m.elements[12], y: m.elements[13] + 4.17, z: m.elements[14] }));
  pavedPlazaRects = pavedRects;
  sidewalkBlocks = blockSidewalks; // { cx, cz, w, d } raised sidewalk slabs (cross-street tree rows)

  // Batch static sub-meshes by material to reduce per-frame WebGPU draw calls
  batchStaticGroupMeshes(group, new Set([roadMat, meadowMat, lotMat, parkLawnMat, pitchMat, cyclewayMat]));
  if (streamer) {
    // ...or they all go to the streamer: the deck as the layer covering the ground, opened over the river channels
    // (river-channels.ts draws them sunk into the ground) once each tile is laid; the valley floor beyond the hills'
    // grid stays
    streamMeshes(group, streamer, { skip: new Set([valleyMesh]), covers: new Set([roadMat]), cutHoles: new Set([roadMat]) });
  } else {
    // ...and lay them on the town's slopes; the valley floor beyond the hills' grid stays flat
    drapeMeshes(group, new Set([valleyMesh]));
    // ...and open the deck over the river channels and the open underpasses (river-channels.ts and bridges.ts draw
    // them sunk into the ground): in the flat
    // city, cut in small cells first like the slopes' lattice cuts it (the holes cut out of its few triangles kilometres
    // across would split them into pieces without end)
    if (!SLOPES) roadMesh.geometry = cutOnCells(roadMesh.geometry);
    roadMesh.geometry = cutDeckHoles(roadMesh.geometry);
  }

  scene.add(group);

  // Raised sidewalk blocks bound the roads (the planted medians are obstacles in the roadway, handed over with the
  // footprints). No shore highways or viaducts here: no highway lanes, no extra colliders
  const sidewalks = roadSidewalks;
  // (the valley floor and how open each block's lot lies, for the far ground: far-ground.ts)
  return { group, sidewalks, footprints, highwayLanes: [], colliders: [], valley: valleyMesh, open };
}

export {
  buildCityGrid,
  parkTreeSites,
  onPitch,
  parkLampSites,
  pavedPlazaRects,
  sidewalkBlocks,
  medianRuns
};
