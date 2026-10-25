import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLOPES, LATTICE, townHeight } from './ground.ts';
import { visibleTriangles, layOnFloor, clipToLattice } from './lattice.ts';
import type { Numbers } from './lattice.ts';
import type { TileStreamer } from './streaming.ts';

// js/world/drape.ts
// Lays the city's ground layers, built flat at y = 0 (the road deck, sidewalks & curbs, meadows, park walks, yards,
// road paint), on the town's slopes (ground.ts): their triangles are cut along the ground's lattice and each vertex
// raised by the town's floor under it, so a layer follows the ground exactly and the layers stacked on it keep their
// few centimetres apart. In the flat city (?slopes=0) everything is left as built.

const FLAT_CELL = 37.5; // m: the cells the flat city's deck is cut in before its holes (the slopes' lattice cell)

const _inverse = new THREE.Matrix4();
const _identity = new THREE.Matrix4();

// A plain (not instanced) mesh, by three's own flags
function isPlainMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return 'isMesh' in obj && Boolean(obj.isMesh) && !('isInstancedMesh' in obj && obj.isInstancedMesh);
}
type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
// An attribute's values, in a plain array for an interleaved one
const attributeArray = (a: Attribute): Numbers => ('isInterleavedBufferAttribute' in a
  ? Float32Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize)) : a.array);

/**
 * A geometry in world space laid on the town's floor (a new, non-indexed geometry; the same one with ?slopes=0).
 * `undersides: false` leaves out the triangles facing down.
 */
function drapeGeometry(geo: THREE.BufferGeometry, { undersides = true }: { undersides?: boolean } = {}): THREE.BufferGeometry {
  if (!SLOPES || !LATTICE) return geo;
  const names = Object.keys(geo.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
  const attrs = names.map((name) => geo.attributes[name]);
  const arrays = attrs.map(attributeArray);
  let index: Numbers | null = geo.index ? geo.index.array : null;
  if (!undersides) {
    const keep = visibleTriangles(arrays[0], index);
    const corners = new Uint32Array(keep.length * 3);
    const from = index;
    keep.forEach((t, k) => {
      for (let c = 0; c < 3; c++) corners[k * 3 + c] = from ? from[t * 3 + c] : t * 3 + c;
    });
    index = corners;
  }
  // (the faces that looked up then look square off the slope under them, each piece lying in one ground triangle's
  // plane; walls keep facing sideways)
  const out = layOnFloor(arrays, attrs.map((a) => a.itemSize), LATTICE, townHeight, names.indexOf('normal'), index);
  const draped = new THREE.BufferGeometry();
  names.forEach((name, k) => draped.setAttribute(name, new THREE.BufferAttribute(out[k], attrs[k].itemSize, attrs[k].normalized)));
  draped.computeBoundingBox();
  draped.computeBoundingSphere();
  return draped;
}

// A mesh (its world matrix up to date) laid on the town's floor in place, without its undersides
function drapeMesh(obj: THREE.Mesh) {
  // (in world space: the city's ground layers are, most often, already)
  const placed = !obj.matrixWorld.equals(_identity);
  const world = placed ? obj.geometry.clone().applyMatrix4(obj.matrixWorld) : obj.geometry;
  const draped = drapeGeometry(world, { undersides: false });
  if (placed) {
    draped.applyMatrix4(_inverse.copy(obj.matrixWorld).invert());
    world.dispose();
  }
  obj.geometry.dispose();
  obj.geometry = draped;
}

/** A geometry (world space) cut in FLAT_CELL squares from the origin: a new, non-indexed geometry */
function cutOnCells(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const names = Object.keys(geo.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
  const attrs = names.map((name) => geo.attributes[name]);
  const out = clipToLattice(attrs.map((a) => a.array), attrs.map((a) => a.itemSize), geo.index ? geo.index.array : null,
    { x0: 0, z0: 0, cell: FLAT_CELL });
  const cut = new THREE.BufferGeometry();
  names.forEach((name, k) => cut.setAttribute(name, new THREE.BufferAttribute(out[k], attrs[k].itemSize, attrs[k].normalized)));
  geo.dispose();
  return cut;
}

/** Every plain (not instanced) mesh under `root` but those in `skip` laid on the town's floor, without its undersides */
function drapeMeshes(root: THREE.Object3D, skip: Set<THREE.Object3D> | null = null): void {
  if (!SLOPES || !LATTICE) return;
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (isPlainMesh(obj) && !skip?.has(obj)) drapeMesh(obj);
  });
}

/** What streamMeshes reads of a group of meshes of one material, merged into one layer. */
interface LayerGroup {
  material: THREE.Material;
  geos: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  name: string;
}

/**
 * Every plain (not instanced) mesh under `root` but those in `skip` handed to the tile streamer (streaming.ts) instead
 * of laid whole: taken out of the scene, put in world space and merged by material (one layer each, without their
 * undersides), so they are laid on the floor tile by tile around the camera. `covers`: the materials of the layers that
 * cover all the ground under them (the road deck); `cutHoles`: those opened over the river channels once laid.
 */
function streamMeshes(root: THREE.Object3D, streamer: Pick<TileStreamer, 'addLayer'>,
  { skip = null, covers = new Set(), cutHoles = new Set() }:
  { skip?: Set<THREE.Object3D> | null; covers?: Set<THREE.Material>; cutHoles?: Set<THREE.Material> } = {}): void {
  root.updateMatrixWorld(true);
  const groups = new Map<string, LayerGroup>(); // material + attribute names -> { material, geos, castShadow, receiveShadow, renderOrder }
  const meshes: THREE.Mesh[] = [];
  const several: THREE.Mesh[] = []; // (meshes of several materials: laid whole, as drapeMeshes would)
  root.traverse((obj) => {
    if (!isPlainMesh(obj) || skip?.has(obj)) return;
    (Array.isArray(obj.material) ? several : meshes).push(obj);
  });
  if (SLOPES && LATTICE) several.forEach(drapeMesh);
  for (const obj of meshes) {
    const material = obj.material;
    if (Array.isArray(material)) continue; // (none: those are in `several`)
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    if (!obj.matrixWorld.equals(_identity)) geo.applyMatrix4(obj.matrixWorld);
    const key = material.uuid + ':' + Object.keys(geo.attributes).sort().join(',');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material, geos: [], castShadow: false, receiveShadow: false, renderOrder: obj.renderOrder, name: obj.name }));
    g.geos.push(geo);
    g.castShadow ||= obj.castShadow;
    g.receiveShadow ||= obj.receiveShadow;
    obj.parent?.remove(obj);
    obj.geometry.dispose();
  }
  for (const g of groups.values()) {
    // (mergeGeometries returns null when they can't be merged, which its typings leave out)
    const merged = g.geos.length > 1 ? mergeGeometries(g.geos, false) as THREE.BufferGeometry | null : g.geos[0];
    if (g.geos.length > 1) for (const geo of g.geos) geo.dispose();
    if (!merged) continue;
    streamer.addLayer(merged, g.material, {
      name: g.name || root.name, castShadow: g.castShadow, receiveShadow: g.receiveShadow, renderOrder: g.renderOrder,
      undersides: false, covers: covers.has(g.material), cutHoles: cutHoles.has(g.material)
    });
  }
}

export { drapeGeometry, drapeMeshes, streamMeshes, cutOnCells, FLAT_CELL };
