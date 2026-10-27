import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRoomSettings } from '../js/app/room-settings.ts';
import { LiveWeather, WEATHER_SAMPLES } from '../js/world/weather.ts';
import { localHour } from '../js/sim/traffic-demand.ts';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

// A Live time of day and a crime system, as much of them as a room's settings touch
function world() {
  const fetched = [];
  const weather = new LiveWeather(undefined, { fetchImpl: (url) => { fetched.push(url); return new Promise(() => {}); }, storage: null });
  const ownClock = () => new Date('2026-10-27T18:00:00Z');
  const lighting = { weather, liveClock: ownClock, activePresetId: 'golden', presets: [], applyPreset(id) { this.activePresetId = id; this.presets.push(id); } };
  let cleared = 0;
  const crime = { policeOff: false, wanted: { clear: () => { cleared++; } } };
  let shown = 0;
  const targets = { lighting, crime, ownClock, showLive: () => { shown++; } };
  return { weather, lighting, crime, targets, ownClock, cleared: () => cleared, shown: () => shown };
}

test('a stormy night without police: the weather held, the clock stopped at 23:00 in Tepic, Live shown, the stars gone', () => {
  const w = world();
  applyRoomSettings({ weather: 'storm', time: 'night', police: false, pvp: true }, w.targets);
  assert.equal(w.weather.current.code, WEATHER_SAMPLES.storm.code);
  assert.equal(w.weather.fetchImpl, null, 'no fetching the real weather over it');
  assert.equal(Math.round(localHour(w.lighting.liveClock(), w.weather.location.timeZone)), 23);
  assert.equal(w.lighting.liveClock(), w.lighting.liveClock(), 'the hour holds');
  assert.deepEqual(w.lighting.presets, ['live']);
  assert.equal(w.shown(), 1);
  assert.equal(w.crime.policeOff, true);
  assert.equal(w.cleared(), 1);
});

test('back in a room of the real Tepic: the real weather and clock again, and the player\'s own time of day left alone', () => {
  const w = world();
  applyRoomSettings({ ...DEFAULT_SETTINGS, weather: 'rain' }, w.targets);
  w.lighting.activePresetId = 'midday'; // (the player then picks their own)
  applyRoomSettings(DEFAULT_SETTINGS, w.targets);
  assert.equal(w.weather.fetchImpl, w.weather.ownFetch, 'fetching the real weather again');
  assert.equal(w.weather.nextAttempt, 0, 'right away');
  assert.equal(w.lighting.liveClock, w.ownClock);
  assert.equal(w.lighting.activePresetId, 'midday', 'nothing fixed: their Midday stays');
  assert.equal(w.crime.policeOff, false);
});
