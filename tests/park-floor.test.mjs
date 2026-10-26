import assert from 'node:assert/strict';
import test from 'node:test';
import { PARK_WALK_Y, PARK_BED_Y, isRaisedPark, parkBed, parkFloorAt } from '../js/world/park-floor.ts';
import { blockAt } from '../js/world/city-config.ts';

// A 40 m square park block, as city-config.ts BLOCKS describes one
function square(size, extra = {}) {
  const h = size / 2;
  return {
    poly: [{ x: -h, z: -h }, { x: h, z: -h }, { x: h, z: h }, { x: -h, z: h }],
    minX: -h, maxX: h, minZ: -h, maxZ: h, area: size * size, park: 1, median: false, rural: false, ...extra
  };
}

test('a park block over 250 m² is raised; a camellón, the open country, a small park or a plain block are not', () => {
  assert.equal(isRaisedPark(square(40)), true);
  assert.equal(isRaisedPark(square(40, { median: true })), false);
  assert.equal(isRaisedPark(square(40, { rural: true })), false);
  assert.equal(isRaisedPark(square(15)), false);
  assert.equal(isRaisedPark(square(40, { park: 0.2 })), false);
});

test('a walker stands on the lawn inside the bed and on the walk round it', () => {
  const b = square(40);
  assert.ok(parkBed(b), 'a 40 m park has a lawn bed');
  assert.equal(parkBed(b), parkBed(b), 'the bed is worked out once');
  assert.equal(parkFloorAt(b, 0, 0), PARK_BED_Y);
  assert.equal(parkFloorAt(b, 18, 0), PARK_WALK_Y); // (the bed is inset 5 m: the walk is the outer 5 m)
  assert.equal(parkFloorAt(b, 14, 14), PARK_BED_Y);
});

test('the plaza by the start is a raised park, its walk above the sidewalks', () => {
  // (the player sank 0.26 m into its hex-paver walk while the ground took it for the street)
  const b = blockAt(-55.5, 32);
  assert.ok(b && isRaisedPark(b));
  assert.ok(parkFloorAt(b, -55.5, 32) >= PARK_WALK_Y);
  assert.ok(PARK_WALK_Y > 0.22);
});
