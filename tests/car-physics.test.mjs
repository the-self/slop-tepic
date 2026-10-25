import assert from 'node:assert/strict';
import test from 'node:test';
import { wheelLayout, headingOf, isDrive } from '../js/player/car-physics.ts';

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
