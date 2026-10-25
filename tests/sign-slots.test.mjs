import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignSlots } from '../js/world/sign-slots.js';

test('a name keeps its slot while it stays near, and is drawn once', () => {
  const slots = createSignSlots(2, 4);
  slots.begin();
  const a = slots.acquire(10);
  assert.equal(slots.acquire(10), a, 'the same name on two buildings shares a slot');
  assert.deepEqual(slots.drawn, [a, 10]);
  slots.begin();
  assert.equal(slots.acquire(10), a);
  assert.deepEqual(slots.drawn, [], 'already drawn');
  assert.equal(slots.dirty.size, 0, 'nothing to upload');
});

test('new names fill one page before the next, and the least recently seen give way', () => {
  const slots = createSignSlots(2, 4);
  slots.begin();
  for (let s = 0; s < 4; s++) slots.acquire(s);
  assert.deepEqual([...slots.dirty], [0], 'four names, one page');
  slots.begin();
  for (let s = 0; s < 4; s++) slots.acquire(100 + s);
  assert.deepEqual([...slots.dirty], [1], 'the empty page before evicting anything');
  slots.begin();
  for (const s of [0, 1, 100, 101]) slots.acquire(s); // seen again: kept
  const s = slots.acquire(200);
  assert.ok(s === 2 || s === 3, 'as much room on each page: the first, its unseen names giving way');
  assert.deepEqual([...slots.dirty], [0]);
  slots.acquire(201);
  assert.deepEqual([...slots.dirty], [0], 'the page already being redrawn first');
  slots.acquire(202);
  assert.deepEqual([...slots.dirty].sort(), [0, 1]);
});

test('a full atlas answers -1 (the trade sign stands in)', () => {
  const slots = createSignSlots(1, 2);
  slots.begin();
  assert.ok(slots.acquire(1) >= 0);
  assert.ok(slots.acquire(2) >= 0);
  assert.equal(slots.acquire(3), -1);
  slots.begin();
  assert.ok(slots.acquire(3) >= 0, 'a slot frees up on the next pass');
});
