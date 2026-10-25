const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule, stripTypes } = require('./helpers/module.cjs');

// A stand-in for three.js, TSL and the bus's spec that accepts any shader graph: every property, call and `new` gives
// a node back (a number in arithmetic, a few nodes when destructured), and `new` a fresh object (a material of its own)
function* some() { for (let i = 0; i < 4; i++) yield node; }
const node = new Proxy(function () {}, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => 0 : key === Symbol.iterator ? some : node),
  apply: () => node,
  construct: () => ({})
});

const source = readFileSync(join(__dirname, '../js/actors/vehicles/bus-materials.ts'), 'utf8');
const imports = {};
for (const [, specifier] of stripTypes(source).matchAll(/^import\s[^;]*?\sfrom\s+'([^']+)';/gm)) imports[specifier] = node;
const { createLoftedBusMaterial } = loadModule(source, { imports });

test('each livery palette gets its own camión material, and the same palette the same one', () => {
  const routes = { image: { width: 12 } };
  const other = { image: { width: 3 } };
  const a = createLoftedBusMaterial(routes);
  assert.equal(createLoftedBusMaterial(routes), a, 'cached per palette');
  const b = createLoftedBusMaterial(other);
  assert.notEqual(b, a, 'another palette is not handed the first one\'s material');
  assert.equal(createLoftedBusMaterial(other), b);
  assert.notEqual(createLoftedBusMaterial(), a, 'and none, the plain white one');
});
