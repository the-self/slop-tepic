import assert from 'node:assert/strict';
import test from 'node:test';
import { createStains, bloodFrame, addHit, wash, clean, FRONT_SLOTS, TOP_SLOTS, MAX_SIZE } from '../js/player/car-blood.js';

const frame = bloodFrame({ zFront: 2.2, bumpers: [[0.46, 0.03]], bumperLine: [0.775], cabin: { cowl: 1.0, roofFront: 0.3 } }, 0.88);
const still = () => 0.5;
const live = (slots) => [...Array(slots.length / 4).keys()].filter((i) => slots[i * 4 + 3] > 0);

test('a slow knock marks the nose, a faster one the bonnet too, a fast one the windscreen', () => {
  const slow = createStains();
  addHit(slow, frame, 0.2, 7, 0.3, still);
  assert.equal(live(slow.front).length, 1);
  assert.equal(live(slow.top).length, 0);
  assert.ok(Math.abs(slow.front[1] - frame.noseY) < 0.05 && Math.abs(slow.front[0] - 0.2) < 0.01, 'where the body struck');

  const middling = createStains();
  addHit(middling, frame, 0, 10, 0.45, still);
  assert.equal(live(middling.top).length, 1, 'the bonnet');
  assert.ok(middling.top[1] < frame.zFront && middling.top[1] > frame.cowl);

  const fast = createStains();
  addHit(fast, frame, 0, 20, 0.9, still);
  const zs = live(fast.top).map((i) => fast.top[i * 4 + 1]);
  assert.equal(zs.length, 2);
  assert.ok(zs.some((z) => z < frame.cowl && z > frame.roofFront), 'the windscreen');
  // nothing from a knock that draws no blood
  const none = createStains();
  addHit(none, frame, 0, 4, 0, still);
  assert.equal(live(none.front).length + live(none.top).length, 0);
});

test('stains build up hit after hit, merging where they overlap, never past their slots or size', () => {
  const s = createStains();
  addHit(s, frame, 0.1, 9, 0.4, still);
  const before = s.front[3];
  addHit(s, frame, 0.12, 9, 0.4, still);
  assert.equal(live(s.front).length, 1, 'the same spot darker');
  assert.ok(s.front[3] > before);
  for (let k = 0; k < 40; k++) addHit(s, frame, (k % 9 - 4) * 0.2, 25, 1, Math.random);
  assert.ok(live(s.front).length <= FRONT_SLOTS && live(s.top).length <= TOP_SLOTS);
  for (let i = 0; i < FRONT_SLOTS; i++) assert.ok(s.front[i * 4 + 2] <= MAX_SIZE && s.front[i * 4 + 3] <= 1);
  // across the car's width only
  for (let i = 0; i < FRONT_SLOTS; i++) assert.ok(Math.abs(s.front[i * 4]) < frame.halfW);
});

test('heavy rain washes them off in a minute or two, a drizzle doesn\'t, a repair at once', () => {
  const s = createStains();
  addHit(s, frame, 0, 20, 1, still);
  for (let t = 0; t < 120; t += 0.5) wash(s, 0.5, 0.2);
  assert.ok(s.front[3] > 0.9, 'a drizzle leaves it');
  let left = true, t = 0;
  while (left && t < 600) { left = wash(s, 0.5, 1); t += 0.5; }
  assert.ok(t > 30 && t < 150, `a storm takes ${t} s`);
  addHit(s, frame, 0, 20, 1, still);
  clean(s);
  assert.equal(live(s.front).length + live(s.top).length, 0);
});
