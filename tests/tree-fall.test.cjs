const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { hashPos } = loadModule(readFileSync(join(__dirname, '../js/world/hash.ts'), 'utf8'), { filename: 'hash.ts' });

class Vector3 {}
const { treeFall, TREE_SPECIES } = loadModule(readFileSync(join(__dirname, '../js/world/trees.ts'), 'utf8'), {
  imports: {
    'three/webgpu': { Vector3 },
    'three/tsl': { lights() {} },
    '../render/tsl-materials.ts': { createTreeMaterial() {} },
    './ground.ts': { liftAt: () => 0 },
    './hash.ts': { hashPos }
  },
  filename: 'trees.ts'
});
const species = (name) => TREE_SPECIES.findIndex((s) => s.name === name);
const fall = (name, scale, bodies = new Map(), at = { x: 10, z: 20 }) => treeFall({ ...at, scale, species: species(name) }, 7, 4, 0.3, bodies);

test('a young street tree snaps at a slow knock, an old laurel stands, and a palm gives whatever its size', () => {
  const young = fall('jacaranda', 0.6);
  const street = fall('laurel', 0.62);
  assert.ok(young && street, 'a street jacaranda and a street laurel give');
  assert.ok(young.def.breakAt < street.def.breakAt, 'the thinner, the slower it snaps');
  assert.equal(fall('laurel', 1.3), null, "a plaza's old laurel stops the car");
  assert.equal(fall('mango', 1.2), null);
  for (const scale of [0.8, 1.3]) assert.ok(fall('palma', scale), 'a palm snaps at any size');
  for (const f of [young, street]) {
    assert.ok(f.def.heavy, 'a car only');
    assert.ok(f.def.mass >= 150 && f.def.mass <= 1200);
    assert.ok(f.hard > 0 && f.hard <= 1);
  }
});

test("a felled tree's crown is a core of it, not a box as wide as it, and trees of one size share one body", () => {
  const bodies = new Map();
  const a = fall('tabachin', 0.7, bodies, { x: 0, z: 0 });
  const [, , , hx, , hz] = a.def.boxes[0];
  assert.ok(hx <= 0.9 && hz <= 0.9, 'within a metre of its trunk: beside a facade it is not inside the wall');
  assert.ok(a.def.cyl[1] < a.def.boxes[0][1], 'the crown above the trunk');
  // (a tree of the same size elsewhere: hashPos varies its scale a little, so look for one that rounds alike)
  let same = null;
  for (let x = 1; x < 400 && !same; x++) {
    const b = fall('tabachin', 0.7, bodies, { x, z: 0 });
    if (b && Math.abs(hashPos(x, 1.3, 0) - hashPos(0, 1.3, 0)) < 0.005) same = b;
  }
  assert.ok(same && same.def === a.def, 'one body, one shape in Jolt');
});
