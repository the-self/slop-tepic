import assert from 'node:assert/strict';
import test from 'node:test';
import { Scheduler } from '../js/core/scheduler.ts';
import { EventBus } from '../js/core/events.ts';

const step = { dt: 0.016, frameDt: 0.016, rawDt: 0.016, elapsed: 1, now: 1000 };

test('the scheduler steps its systems in the order they were added, with the same frame step', () => {
  const seen = [];
  const scheduler = new Scheduler()
    .run('player', (s) => seen.push(['player', s]))
    .add({ name: 'traffic', update: (s) => seen.push(['traffic', s]) })
    .run('audio', (s) => seen.push(['audio', s]));
  scheduler.step(step);
  assert.deepEqual(seen.map(([name]) => name), ['player', 'traffic', 'audio']);
  assert.ok(seen.every(([, s]) => s === step));
});

test('the scheduler times its systems only when profiling', () => {
  const busy = (ms) => () => { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } };
  const quiet = new Scheduler().run('slow', busy(2));
  quiet.step(step);
  assert.deepEqual(quiet.report(), [{ name: 'slow', ms: 0 }]);

  const profiled = new Scheduler({ profile: true }).run('fast', () => {}).run('slow', busy(2));
  profiled.step(step);
  const report = profiled.report();
  assert.deepEqual(report.map((t) => t.name), ['slow', 'fast'], 'slowest first');
  assert.ok(report[0].ms >= 1.9, `the first frame's time seeds the average (${report[0].ms} ms)`);
});

test('the event bus delivers each event to its subscribers until they unsubscribe', () => {
  const bus = new EventBus();
  const got = [];
  const off = bus.on('crash', (impact) => got.push(['a', impact.speed]));
  bus.on('crash', (impact) => got.push(['b', impact.speed]));
  bus.on('knock', () => got.push(['knock']));
  bus.emit('crash', { speed: 12 });
  off();
  bus.emit('crash', { speed: 3 });
  bus.emit('nobody-listens', {});
  assert.deepEqual(got, [['a', 12], ['b', 12], ['b', 3]]);
});
