import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLOPES, LATTICE, townHeight } from './ground.js';
import { visibleTriangles, layOnFloor } from './lattice.js';

// js/world/drape.js
// Lays the city's ground layers, built flat at y = 0 (the road deck, sidewalks & curbs, meadows, park walks, yards,
// road paint), on the town's slopes (ground.js): their triangles are cut along the ground's lattice and each vertex
// raised by the town's floor under it, so a layer follows the ground exactly and the layers stacked on it keep their
// few centimetres apart. In the flat city (?slopes=0) everything is left as built.

const _inverse = new THREE.Matrix4();
const _identity = new THREE.Matrix4();

/**
 * A geometry in world space laid on the town's floor (a new, non-indexed geometry; the same one with ?slopes=0).
 * `undersides: false` leaves out the triangles facing down.
 */
function drapeGeometry(geo, { undersides = true } = {}) {
  if (!SLOPES || !LATTICE) return geo;
  const names = Object.keys(geo.attributes).sort((a, b) => (a === 'position' ? -1 : b === 'position' ? 1 : 0));
  const attrs = names.map((name) => geo.attributes[name]);
  const arrays = attrs.map((a) => (a.isInterleavedBufferAttribute ? Float32Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize)) : a.array));
  let index = geo.index ? geo.index.array : null;
  if (!undersides) {
    const keep = visibleTriangles(arrays[0], index);
    const corners = new Uint32Array(keep.length * 3);
    keep.forEach((t, k) => {
      for (let c = 0; c < 3; c++) corners[k * 3 + c] = index ? index[t * 3 + c] : t * 3 + c;
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

/** Every plain (not instanced) mesh under `root` but those in `skip` laid on the town's floor, without its undersides */
function drapeMeshes(root, skip = null) {
  if (!SLOPES || !LATTICE) return;
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || (skip && skip.has(obj))) return;
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
  });
}

/**
 * Every plain (not instanced) mesh under `root` but those in `skip` handed to the tile streamer (streaming.js) instead
 * of laid whole: taken out of the scene, put in world space and merged by material (one layer each, without their
 * undersides), so they are laid on the floor tile by tile around the camera. `covers`: the materials of the layers that
 * cover all the ground under them (the road deck); `cutHoles`: those opened over the river channels once laid.
 */
function streamMeshes(root, streamer, { skip = null, covers = new Set(), cutHoles = new Set() } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map(); // material + attribute names -> { material, geos, castShadow, receiveShadow, renderOrder }
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || (skip && skip.has(obj)) || Array.isArray(obj.material)) return;
    meshes.push(obj);
  });
  for (const obj of meshes) {
    let geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    if (!obj.matrixWorld.equals(_identity)) geo.applyMatrix4(obj.matrixWorld);
    const key = obj.material.uuid + ':' + Object.keys(geo.attributes).sort().join(',');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material: obj.material, geos: [], castShadow: false, receiveShadow: false, renderOrder: obj.renderOrder, name: obj.name }));
    g.geos.push(geo);
    g.castShadow ||= obj.castShadow;
    g.receiveShadow ||= obj.receiveShadow;
    obj.parent.remove(obj);
    obj.geometry.dispose();
  }
  for (const g of groups.values()) {
    const merged = g.geos.length > 1 ? mergeGeometries(g.geos, false) : g.geos[0];
    if (g.geos.length > 1) for (const geo of g.geos) geo.dispose();
    if (!merged) continue;
    streamer.addLayer(merged, g.material, {
      name: g.name || root.name, castShadow: g.castShadow, receiveShadow: g.receiveShadow, renderOrder: g.renderOrder,
      undersides: false, covers: covers.has(g.material), cutHoles: cutHoles.has(g.material)
    });
  }
}

export { drapeGeometry, drapeMeshes, streamMeshes };
