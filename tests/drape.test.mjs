import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { visibleTriangles, layOnFloor } from '../js/world/lattice.ts';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');
const source = readFileSync(new URL('../js/world/drape.ts', import.meta.url), 'utf8');

// Just enough of three.js for drapeGeometry
class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize });
  }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(name, a) { this.attributes[name] = a; }
  computeBoundingBox() {}
  computeBoundingSphere() {}
}
const THREE = { BufferAttribute, BufferGeometry, Matrix4: class {} };

// The town floor rising 0.1 m per metre east, on a 10 m lattice
const floor = (x) => 100 + 0.1 * x;
// (merged geometries: their parts, to look at)
const mergeGeometries = (geos) => Object.assign(new BufferGeometry(), { parts: geos });
function drapeModule(slopes = true) {
  return loadModule(source, {
    imports: {
      'three/webgpu': THREE,
      'three/addons/utils/BufferGeometryUtils.js': { mergeGeometries },
      './ground.ts': { SLOPES: slopes, LATTICE: { x0: 0, z0: 0, cell: 10 }, townHeight: floor },
      './lattice.ts': { visibleTriangles, layOnFloor }
    }
  });
}
const drape = (slopes = true) => drapeModule(slopes).drapeGeometry;

// A 20 m square at y = 0.2 facing up (two triangles wound counter-clockwise from above) and one triangle under it
function slab() {
  const geo = new BufferGeometry();
  const tri = [[0, 0, 0, 20, 20, 0], [20, 0, 0, 20, 20, 20], [0, 0, 20, 0, 0, 20]];
  const position = [], normal = [];
  tri.forEach((t, k) => {
    for (let v = 0; v < 3; v++) {
      position.push(t[v * 2], 0.2, t[v * 2 + 1]);
      normal.push(0, k < 2 ? 1 : -1, 0);
    }
  });
  geo.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  return geo;
}

test('a draped layer is cut on the lattice, raised by the floor under each vertex, its tops tilted with it', () => {
  const geo = drape()(slab(), { undersides: false });
  const p = geo.attributes.position.array, n = geo.attributes.normal.array;
  assert.ok(p.length / 9 >= 8, 'the square is cut along the lattice (the 8 of its 2 x 2 cells)');
  let area = 0;
  for (let t = 0; t < p.length; t += 9) {
    area += Math.abs((p[t + 3] - p[t]) * (p[t + 8] - p[t + 2]) - (p[t + 6] - p[t]) * (p[t + 5] - p[t + 2])) / 2;
    for (let v = 0; v < 9; v += 3) {
      assert.ok(Math.abs(p[t + v + 1] - (0.2 + floor(p[t + v]))) < 1e-4, 'on the floor');
      // square off the slope: (-0.1, 1, 0) normalised, never the underside's (0, -1, 0)
      assert.ok(Math.abs(n[t + v] + 0.1 / Math.hypot(1, 0.1)) < 1e-5 && Math.abs(n[t + v + 1] - 1 / Math.hypot(1, 0.1)) < 1e-5);
    }
  }
  assert.ok(Math.abs(area - 400) < 1e-3, `${area} m² of top, no underside`);
  // undersides kept when asked
  const all = drape()(slab());
  const below = [...all.attributes.normal.array].filter((v, i) => i % 3 === 1 && v < -0.5).length;
  assert.ok(below >= 3);
});

test('in the flat city (?slopes=0) a layer is left as built', () => {
  const geo = slab();
  assert.equal(drape(false)(geo), geo);
});

test('the ground layers go to the streamer merged by material, in world space, taken out of the scene', () => {
  const identity = { equals: (m) => m instanceof THREE.Matrix4 }; // (drape.js compares with a new Matrix4)
  const moved = { equals: () => false };
  const geometry = (tag, indexed = false) => Object.assign(new BufferGeometry(), {
    tag, index: indexed ? {} : null, disposed: false,
    toNonIndexed() { return geometry(tag + '>flat'); },
    clone() { return geometry(tag + '>copy'); },
    applyMatrix4() { this.tag += '>world'; return this; },
    dispose() { this.disposed = true; }
  });
  const root = {
    name: 'CityGrid', children: [], updateMatrixWorld() {},
    traverse(fn) { for (const c of [...this.children]) fn(c); },
    remove(o) { this.children = this.children.filter((c) => c !== o); }
  };
  const mesh = (geo, material, extra = {}) => {
    const m = { isMesh: true, geometry: geo, material, matrixWorld: identity, renderOrder: 0, castShadow: false, receiveShadow: true, name: '', parent: root, ...extra };
    root.children.push(m);
    return m;
  };
  const road = { uuid: 'road' }, curb = { uuid: 'curb' };
  const deck = mesh(Object.assign(geometry('deck'), { attributes: { position: {} } }), road);
  const c1 = mesh(Object.assign(geometry('c1', true), { attributes: { position: {}, uv: {} } }), curb, { castShadow: true });
  const c2 = mesh(Object.assign(geometry('c2'), { attributes: { position: {}, uv: {} } }), curb, { matrixWorld: moved });
  const valley = mesh(geometry('valley'), road);
  const props = mesh(geometry('lamps'), curb, { isInstancedMesh: true });
  const added = [];
  drapeModule().streamMeshes(root, { addLayer: (geo, material, options) => added.push({ geo, material, options }) },
    { skip: new Set([valley]), covers: new Set([road]), cutHoles: new Set([road]) });
  assert.deepEqual(root.children, [valley, props], 'the streamed meshes leave the scene');
  assert.ok(deck.geometry.disposed && c1.geometry.disposed && c2.geometry.disposed);
  assert.equal(added.length, 2);
  const [a, b] = added;
  assert.equal(a.material, road);
  assert.equal(a.options.covers, true);
  assert.equal(a.options.cutHoles, true);
  assert.equal(a.geo.tag, 'deck>copy');
  assert.equal(b.material, curb);
  assert.equal(b.options.covers, false);
  assert.equal(b.options.cutHoles, false);
  assert.equal(b.options.castShadow, true);
  assert.equal(b.options.undersides, false);
  assert.equal(b.geo.parts.map((g) => g.tag).join(' '), 'c1>flat c2>copy>world');
});
