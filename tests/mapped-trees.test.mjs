import assert from 'node:assert/strict';
import test from 'node:test';
import { mappedTreeSites, clearOfMapped } from '../js/world/mapped-trees.ts';
import { GEO } from '../js/world/city-geodata.js';

// A park west of x = 0, a house block east of it, the road between x = 0 and 10
const park = { park: 1 }, block = { park: 0 };
const blockAt = (x) => (x < 0 ? park : x > 10 ? block : null);

test('a mapped tree stands where it is, on the ground of its island; one in a roadway is left out', () => {
  const sites = mappedTreeSites([-20, 5, 0, 30, 5, 0, 5, 5, 0, 31, 40, 1, 31, 47, 1], blockAt, () => 100);
  assert.equal(sites.length, 4);
  const [inPark, onBlock] = sites;
  assert.equal(inPark.x, -20);
  assert.ok(Math.abs(inPark.y - 100.26) < 1e-9, 'on the park\'s walks');
  assert.ok(Math.abs(onBlock.y - 100.232) < 1e-9, 'on the yards\' ground');
  // a row keeps one species along it
  assert.equal(sites[2].species, sites[3].species);
});

test('the game\'s own trees keep clear of the mapped ones', () => {
  const mapped = [{ x: 0, z: 0, scale: 1 }];
  const own = [{ x: 3, z: 0, scale: 1 }, { x: 5, z: 0, scale: 1 }, { x: -2, z: -2, scale: 1 }, { x: 100, z: 0, scale: 1 }];
  assert.deepEqual(clearOfMapped(own, mapped).map((t) => t.x), [5, 100]);
});

test('Tepic\'s mapped trees: the lone ones and the rows', () => {
  let rows = 0;
  for (let k = 2; k < GEO.trees.length; k += 3) if (GEO.trees[k] === 1) rows++;
  assert.ok(GEO.trees.length / 3 > 400);
  assert.ok(rows > 20);
});
