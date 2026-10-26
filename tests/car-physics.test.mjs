import assert from 'node:assert/strict';
import test from 'node:test';
import { wheelLayout, headingOf, isDrive, steerLimit, overTurn } from '../js/player/car-physics.ts';
import { tipExcess, rollExcess, crashRolls, kerbScrub } from '../js/player/car-physics/aids.ts';

test('the wheels hang on springs that settle them where the body shape draws them', () => {
  const [w] = wheelLayout([{ x: 0.8, z: 1.4, radius: 0.35, front: true }], 1.4);
  const sag = 9.81 / (2 * Math.PI * 1.4) ** 2;
  // at rest the spring is `sag` short of full droop: the wheel's centre is its radius over the car's floor
  assert.ok(Math.abs(w.attachY - w.maxLength + sag - 0.35) < 1e-9);
  assert.ok(w.minLength < w.maxLength - sag, 'room to compress over a bump');
  assert.equal(w.left, true);
});

test('the heading follows the nose, and holds where the nose points straight down or up', () => {
  const h = 0.7, fx = Math.sin(h), fz = Math.cos(h);
  assert.ok(Math.abs(headingOf(fx, 0, fz, 0, 0) - h) < 1e-12);
  // pitched 89.9° nose down (its roof then faces the way it was heading) and 89.9° nose up (its floor does)
  const p = (89.9 * Math.PI) / 180;
  const down = headingOf(fx * Math.cos(p), -Math.sin(p), fz * Math.cos(p), fx * Math.sin(p), fz * Math.sin(p));
  const up = headingOf(fx * Math.cos(p), Math.sin(p), fz * Math.cos(p), -fx * Math.sin(p), -fz * Math.sin(p));
  assert.ok(Math.abs(down - h) < 1e-9 && Math.abs(up - h) < 1e-9, `${down}, ${up}`);
});

test('pulling away and speeding up go to the driven wheels, braking to all of them', () => {
  assert.equal(isDrive(5000, 0), true, 'from a standstill');
  assert.equal(isDrive(-3000, 0.1), true, 'backing away from a standstill');
  assert.equal(isDrive(5000, 20), true);
  assert.equal(isDrive(-8000, 20), false, 'braking');
  assert.equal(isDrive(-200, 20), false, 'drag & rolling resistance');
  assert.equal(isDrive(0, 20), false);
});

test('the steering turns the wheels no further than the front tyres hold at speed, all the way when slow', () => {
  const lock = 0.58, wheelbase = 2.7, grip = 0.93;
  assert.equal(steerLimit(lock, wheelbase, grip, 0), lock, 'standing');
  assert.equal(steerLimit(lock, wheelbase, grip, 5), lock, 'parking speed');
  const at100 = steerLimit(lock, wheelbase, grip, 100 / 3.6);
  assert.ok(at100 > 0.08 && at100 < 0.12, `${at100} rad at 100 km/h (~6°)`);
  // (a wet road holds less: less steering)
  assert.ok(steerLimit(lock, wheelbase, grip * 0.75, 100 / 3.6) < at100);
  assert.ok(steerLimit(lock, wheelbase, grip, 150 / 3.6) < at100);
});

test('the stability control takes off only the turn past what the wheels steer, never adds any', () => {
  const wheelbase = 2.7, grip = 0.93, u = 25, steer = 0.03; // (to the left, ~0.28 rad/s asked)
  const asked = u * Math.tan(steer) / wheelbase;
  assert.equal(overTurn(asked, steer, u, wheelbase, grip), 0, 'turning as asked');
  assert.equal(overTurn(asked * 0.5, steer, u, wheelbase, grip), 0, 'running wide');
  assert.ok(overTurn(asked * 3, steer, u, wheelbase, grip) > 0, 'its tail out, turning too fast to the left');
  assert.ok(overTurn(-0.5, steer, u, wheelbase, grip) < 0, 'spinning the other way');
  assert.equal(overTurn(2, steer, 2, wheelbase, grip), 0, 'slow: left alone');
  // (no more asked than the tyres hold: full lock at speed asks for what grip allows)
  const most = grip * 9.81 / u;
  assert.ok(overTurn(most * 1.5, 0.5, u, wheelbase, grip) > 0);
});

test('a car someone drives rolls and pitches freely, only what would tip it over is held', () => {
  assert.equal(tipExcess(0.4), 0, 'a hard corner\'s body roll');
  assert.equal(tipExcess(-0.4), 0);
  assert.ok(Math.abs(tipExcess(2.6) - 1.9) < 1e-9, 'a kerb throwing one side up at 2.6 rad/s');
  assert.ok(Math.abs(tipExcess(-2.6) + 1.9) < 1e-9);
  // on all four wheels, leant on a slope: only the excess, never a push upright
  assert.equal(rollExcess(0.3, 0.5, true), 0);
  // come down on one side's wheels leant over 30° to its right: turned back at TIP_RIGHT, falling on or not
  const lean = 0.52;
  assert.ok(rollExcess(0.3, lean, false) > 0, 'toppling on over: held');
  assert.ok(rollExcess(-0.5, lean, false) === 0, 'righting itself at the rate the aid would');
  assert.ok(rollExcess(-0.3, -lean, false) < 0, 'the same over to its left');
  assert.equal(rollExcess(0.3, 0.2, false), 0, 'leant a little on three wheels: left alone');
});

test('a crash may roll a car over, the ground under it never does', () => {
  assert.equal(crashRolls(8, 0.1, false), true, 'into a wall');
  assert.equal(crashRolls(8, 0.9, true), true, 'another car, from above or below');
  assert.equal(crashRolls(8, 0.95, false), false, 'landing on the road');
  assert.equal(crashRolls(2, 0.1, false), false, 'a scrape');
});

test('a kerb taken fast costs a share of the speed for each wheel that strikes its bump stop, no more than it has', () => {
  assert.ok(Math.abs(kerbScrub(10, 1) - 0.3) < 1e-9, '3% at 36 km/h');
  assert.ok(Math.abs(kerbScrub(25, 2) - 1.5) < 1e-9, '...two wheels at 90 km/h');
  assert.equal(kerbScrub(50, 1), 1, 'at most 1 m/s a wheel');
  assert.equal(kerbScrub(0.5, 4), 0.06);
  assert.equal(kerbScrub(1, 100), 1, 'never past a standstill');
});
