import assert from 'node:assert/strict';
import test from 'node:test';
import { Wanted, STAR_HEAT, POLICE, evadeTime, starsFor, inSight, SIGHT } from '../js/sim/crime-rules.ts';

test('running people over brings the police: a star at once, two by the third', () => {
  const w = new Wanted();
  assert.equal(w.report('runOver'), 1);
  assert.equal(w.stars, 1);
  w.report('runOver');
  assert.equal(w.stars, 1);
  w.report('runOver');
  assert.equal(w.stars, 2);
  assert.ok(POLICE.cruisers[w.stars] > 0, 'patrol cars come at two stars');
});

test('unwitnessed crimes and unknown ones add nothing', () => {
  const w = new Wanted();
  assert.equal(w.report('gunfire', false), 0);
  assert.equal(w.report('jaywalking'), 0);
  assert.equal(w.heat, 0);
});

test('killing a cop is two stars, and the stars top out at five', () => {
  const w = new Wanted();
  w.report('killCop');
  assert.equal(w.stars, 3);
  for (let i = 0; i < 20; i++) w.report('killCop');
  assert.equal(w.stars, 5);
  assert.equal(starsFor(1e9), 5);
});

test('stars stay while the police see the player and drop one at a time out of sight', () => {
  const w = new Wanted();
  w.report('killCop'); // 3 stars
  for (let t = 0; t < 120; t += 0.1) w.update(0.1, true);
  assert.equal(w.stars, 3, 'seen: no star is lost');
  for (let t = 0; t < evadeTime(3) - 0.5; t += 0.1) w.update(0.1, false);
  assert.equal(w.stars, 3);
  assert.ok(w.evading > 0.9);
  w.update(1, false);
  assert.equal(w.stars, 2);
  assert.equal(w.heat, STAR_HEAT[2]);
  for (let t = 0; t < 60; t += 0.1) w.update(0.1, false);
  assert.equal(w.stars, 0);
});

test('the police see ahead of them in a cone and right beside them, the helicopter all round', () => {
  assert.equal(SIGHT, 6);
  // an officer at (10, 0) looking south (+z, heading 0), 45 m and 0.95 rad either side, 8 m all round; the helicopter
  // at (0, 0)
  const cones = [10, 0, 45, 0, 0.95, 8, 0, 0, 150, 2, Math.PI, 0];
  assert.ok(inSight(cones, 0, 10, 30), 'straight ahead');
  assert.ok(inSight(cones, 0, 25, 30), 'off to the side, in the cone');
  assert.ok(!inSight(cones, 0, 10, -15), 'behind');
  assert.ok(inSight(cones, 0, 10, -3), 'right behind them: heard, felt');
  assert.ok(!inSight(cones, 0, 50, 5), 'abeam: out of the cone');
  assert.ok(!inSight(cones, 0, 10, 50), 'too far');
  // looking north-ish across the ±π seam
  const north = [0, 0, 45, Math.PI - 0.1, 0.5, 0];
  assert.ok(inSight(north, 0, 2, -30) && inSight(north, 0, -2, -30));
  assert.ok(inSight(cones, SIGHT, -100, -100), 'the helicopter sees behind it');
});

test('the army and the helicopter come at four stars and five, not before', () => {
  for (let stars = 0; stars <= 3; stars++) {
    assert.equal(POLICE.soldiers[stars], 0);
    assert.equal(POLICE.armyTrucks[stars], 0);
    assert.equal(POLICE.helicopter[stars], false);
  }
  for (const stars of [4, 5]) {
    assert.ok(POLICE.soldiers[stars] > 0 && POLICE.armyTrucks[stars] > 0 && POLICE.helicopter[stars], `${stars} stars`);
    assert.ok(POLICE.shoots[stars]);
  }
  assert.ok(POLICE.soldiers[5] > POLICE.soldiers[4], 'more soldiers at five');
  // killing two officers in front of the police is enough to bring them
  const w = new Wanted();
  w.report('killCop');
  w.report('killCop');
  assert.ok(w.stars >= 4);
});
