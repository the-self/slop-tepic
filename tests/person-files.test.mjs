import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { BONE_COUNT } from '../js/sim/person-skeleton.ts';

// A .glb's JSON and binary chunks (glTF 2.0: a 12-byte header, then chunks of [length, type, data])
function readGlb(path) {
  const buf = readFileSync(path);
  let json = null, bin = null;
  for (let o = 12; o < buf.length;) {
    const length = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    o += 8 + length;
  }
  return { json, bin };
}
// The float vectors of an accessor (its buffer view interleaved or not)
function floats({ json, bin }, index) {
  const acc = json.accessors[index], view = json.bufferViews[acc.bufferView];
  assert.equal(acc.componentType, 5126, 'float components');
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const stride = view.byteStride ?? width * 4, base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  return Array.from({ length: acc.count }, (_, i) => Array.from({ length: width }, (_, k) => bin.readFloatLE(base + i * stride + k * 4)));
}

test('the player\'s person file names a near and a far body, each vertex two of the skeleton\'s bones and a weight', () => {
  const glb = readGlb(new URL('../assets/models/people/player.glb', import.meta.url));
  const meshes = new Map(glb.json.meshes.map((m) => [m.name, m]));
  assert.ok(meshes.has('person') && meshes.has('lod1'), 'person & lod1');
  for (const name of ['person', 'lod1']) {
    const prim = meshes.get(name).primitives[0];
    assert.ok('_SKIN' in prim.attributes && 'TEXCOORD_0' in prim.attributes, `${name}: _SKIN and uv`);
    const skin = floats(glb, prim.attributes._SKIN);
    for (const [a, b, w] of skin) {
      assert.ok(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < BONE_COUNT && b < BONE_COUNT, `${name}: bones ${a}, ${b}`);
      assert.ok(w >= 0 && w <= 1, `${name}: weight ${w}`);
    }
    // standing on y = 0, 1.75 m tall, facing +z
    const pos = floats(glb, prim.attributes.POSITION);
    const ys = pos.map((p) => p[1]);
    assert.ok(Math.abs(Math.min(...ys)) < 0.02 && Math.abs(Math.max(...ys) - 1.75) < 0.03, `${name}: 0..1.75 m`);
  }
  assert.ok(glb.json.accessors[meshes.get('lod1').primitives[0].indices].count / 3 <= 3500, 'the far level is light');
});
