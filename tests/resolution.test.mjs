import assert from 'node:assert/strict';
import test from 'node:test';
import { ResolutionGovernor } from '../js/app/resolution.ts';

// `seconds` of frames at `fps`; the ratios it changed to
const run = (gov, fps, seconds) => {
  const changes = [];
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const r = gov.update(1 / fps);
    if (r) changes.push(r);
  }
  return changes;
};

test('slow frames step the resolution down, very slow ones faster, never under the floor', () => {
  const gov = new ResolutionGovernor({ min: 0.6, max: 1.5 });
  assert.deepEqual(run(gov, 45, 1.05), [0.9]);
  assert.deepEqual(run(gov, 25, 1.05), [0.7]);
  run(gov, 20, 10);
  assert.equal(gov.ratio, 0.6);
});

test('frames that keep up step it up, slowly, to the top', () => {
  const gov = new ResolutionGovernor({ min: 0.6, max: 1.5 });
  assert.deepEqual(run(gov, 60, 3.5), [], 'it waits a few seconds before a step up');
  assert.deepEqual(run(gov, 60, 1), [1.1]);
  run(gov, 60, 60);
  assert.equal(gov.ratio, 1.5);
});

test('a ratio it had to step down from is not tried again for a while: no see-saw', () => {
  const gov = new ResolutionGovernor({ min: 0.6, max: 1.5 }, 1.2);
  run(gov, 45, 1.05); // 1.2 too heavy: 1.1
  assert.equal(gov.ratio, 1.1);
  run(gov, 60, 20);
  assert.equal(gov.ratio, 1.1, 'held under the ratio that was too heavy');
  run(gov, 60, 20);
  assert.ok(gov.ratio > 1.1, 'and tried again once the back-off is over');
});

test('stalls (a hidden tab, a shader built) say nothing of the pace', () => {
  const gov = new ResolutionGovernor({ min: 0.6, max: 1.5 });
  for (let i = 0; i < 20; i++) assert.equal(gov.update(0.5), 0);
  assert.equal(gov.ratio, 1);
});
