import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadModule } = require('./helpers/module.cjs');
const source = readFileSync(new URL('../js/world/far-ground.js', import.meta.url), 'utf8');
const { lotColor, FAR_GROUND_COLORS: C } = loadModule(source, {
  imports: {
    'three/webgpu': {}, 'three/tsl': {},
    './city-config.js': { BLOCKS: [], ROADS: [], CITY_OUTLINE: [] },
    './city-geodata.js': { GEO: {} }
  }
});

test('a block paints from afar as the near layers draw it: country, park, camellón, open or built-up lot', () => {
  assert.equal(lotColor({ rural: true, park: 1 }), C.meadow);
  assert.equal(lotColor({ park: 0.9 }), C.park);
  assert.equal(lotColor({ park: 0.9, median: true }), C.open, 'a planted camellón is no park');
  assert.equal(lotColor({ park: 0 }, 0.9), C.open);
  assert.equal(lotColor({ park: 0 }, 0.2), C.built);
  assert.equal(lotColor({ park: 0 }), C.built, 'unknown openness: built up');
});
