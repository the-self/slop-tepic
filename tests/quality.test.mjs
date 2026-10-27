import assert from 'node:assert/strict';
import test from 'node:test';
import { pickQuality } from '../js/app/quality.ts';

test('a touch screen gets the low tier, a computer the high one, and ?quality= overrides either', () => {
  assert.equal(pickQuality(null, false).tier, 'high');
  assert.equal(pickQuality(null, true).tier, 'low');
  assert.equal(pickQuality('high', true).tier, 'high');
  assert.equal(pickQuality('low', false).tier, 'low');
  assert.equal(pickQuality('ultra', true).tier, 'low', 'an unknown tier falls back to the device\'s');
});

test('the low tier costs less in every setting', () => {
  const high = pickQuality('high', false), low = pickQuality('low', false);
  assert.ok(low.shadowMapSize < high.shadowMapSize);
  assert.ok(low.propDistance < high.propDistance);
  assert.equal(high.ssr, true);
  assert.equal(low.ssr, false);
});
