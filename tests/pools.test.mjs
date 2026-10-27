import assert from 'node:assert/strict';
import test from 'node:test';
import { insetOutline as insetPool } from '../js/world/lakes.ts';
import { GEO } from '../js/world/city-geodata.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} should equal ${b}`);

test('a pool\'s water lies its coping\'s width inside its outline, either way round', () => {
  for (const ring of [[0, 0, 25, 0, 25, 10, 0, 10], [0, 10, 25, 10, 25, 0, 0, 0]]) {
    const w = insetPool(ring, 0.5);
    const xs = w.filter((_, i) => i % 2 === 0), zs = w.filter((_, i) => i % 2 === 1);
    close(Math.min(...xs), 0.5);
    close(Math.max(...xs), 24.5);
    close(Math.min(...zs), 0.5);
    close(Math.max(...zs), 9.5);
  }
});

test('Tepic\'s mapped pools and every pitch reach the game', () => {
  assert.ok(GEO.pools.length >= 10);
  assert.ok(GEO.parks.filter((p) => p.cat === 'pitch').length > 200);
});
