// js/app/install/sky.ts
// The sky: the time of day (a preset, or Live's real clock) and the weather (Live's real conditions, or a sample of
// world/weather.ts held), the menu's buttons for them and its line under the weather. Alone the player's choice is
// remembered for next time; in a multiplayer room the room's sky is everyone's (`roomSky` on the bus).
import { onLocaleChange, t } from '../../i18n/i18n.ts';
import { WEATHER_SAMPLES, weatherLabel } from '../../world/weather.ts';
import type { WeatherSampleName } from '../../world/weather.ts';
import { SKY_TIMES, SKY_WEATHERS } from '../../../shared/protocol.ts';
import type { SkyTime, SkyWeather } from '../../../shared/protocol.ts';
import type { Boot } from './boot.ts';
import type { RenderingParts } from './rendering.ts';
import type { NetParts } from './multiplayer.ts';

const isWeatherSample = (name: string | null): name is WeatherSampleName => name !== null && name in WEATHER_SAMPLES;
// (SKY_TIMES & SKY_WEATHERS widened to plain strings, to check a stored or clicked name against them)
const SKY_TIME_NAMES: readonly string[] = SKY_TIMES;
const SKY_WEATHER_NAMES: readonly string[] = SKY_WEATHERS;
const isSkyTime = (name: string | null): name is SkyTime => name !== null && SKY_TIME_NAMES.includes(name);
const isSkyWeather = (name: string | null): name is SkyWeather => name !== null && SKY_WEATHER_NAMES.includes(name);

export function installSky({ params, lighting, events, render, net }: Boot & RenderingParts & NetParts): void {
  const { colorGrade } = render;
  const timeButtons = document.querySelectorAll('[data-time]');
  const weatherButtons = document.querySelectorAll('[data-weather]');
  const liveInfo = document.getElementById('menu-live-info');
  const skyNote = document.getElementById('menu-sky-note');

  // Live time of day: the real sun & weather over the weather location (world/weather.ts). ?live-time=<ISO date>
  // starts the clock elsewhere & ?live-weather=<clear|cloudy|overcast|rain|storm|fog> pins the conditions, to preview them
  const liveStart = Date.parse(params.get('live-time') ?? '');
  if (Number.isFinite(liveStart)) {
    const t0 = performance.now();
    lighting.liveClock = () => new Date(liveStart + performance.now() - t0);
  }
  const heldWeather = params.get('live-weather');
  // the menu's line under the weather: the place, the time there and its weather (in the player's language: shown
  // again when it changes)
  let liveShown: Parameters<NonNullable<typeof lighting.onLiveChange>>[0] | null = null;
  const showLive = (state: NonNullable<typeof liveShown>) => {
    liveShown = state;
    if (!liveInfo || lighting.activePresetId !== 'live') return;
    const w = state.weather;
    const temperature = w.temperature;
    const temp = state.live && temperature !== null && Number.isFinite(temperature) ? ` · ${Math.round(temperature)}°` : '';
    let clock = '';
    try {
      clock = ` ${lighting.liveClock().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: state.location.timeZone })}`;
    } catch { /* unknown time zone */ }
    const sky = t(state.live ? weatherLabel(w) : state.loading ? 'time.liveLoading' : 'time.liveUnavailable');
    const source = lighting.weather.held ? '' : t('menu.liveSource');
    liveInfo.textContent = `${state.location.name}${clock} · ${sky}${temp}${source}`;
  };
  lighting.onLiveChange = (state) => {
    colorGrade.applyMix(state.blend.a, state.blend.b, state.blend.t, state.block);
    showLive(state);
  };

  // The weather shows under Live only: the fixed times of day are dry, clear presets
  const sky: { time: SkyTime; weather: SkyWeather } = { time: 'live', weather: 'live' };
  let skyShown = false;
  function showSky(time: SkyTime, weather: SkyWeather) {
    if (!skyShown || weather !== sky.weather) lighting.setWeather(weather === 'live' ? null : WEATHER_SAMPLES[weather]);
    lighting.applyPreset(time);
    // Live grades itself through onLiveChange as the sun moves
    if (lighting.activePresetId !== 'live') colorGrade.applyPreset(lighting.activePresetId);
    sky.time = time;
    sky.weather = weather;
    skyShown = true;
    timeButtons.forEach((btn) => { btn.classList.toggle('active', btn.getAttribute('data-time') === time); });
    weatherButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-weather') === weather);
      if (btn instanceof HTMLButtonElement) btn.disabled = time !== 'live';
    });
    showSkyInfo();
  }
  // The line under the weather: Live's (the place, the hour, the sky: onLiveChange writes it as it changes), or why the
  // weather is greyed out
  function showSkyInfo() {
    if (sky.time === 'live') {
      if (liveShown) showLive(liveShown);
    } else if (liveInfo) {
      liveInfo.textContent = t('menu.weatherNeedsReal');
    }
  }
  // The menu's choice: in a multiplayer room it goes to everyone there and shows when the server passes it back (one
  // sky for the whole room); alone it shows now and is remembered for next time
  function pickSky(time: SkyTime, weather: SkyWeather) {
    if (net.current?.setSky(time, weather)) return;
    showSky(time, weather);
    try {
      localStorage.setItem('time-of-day', time);
      localStorage.setItem('weather', weather);
    } catch { /* Storage may be disabled. */ }
  }
  // ...and whose sky it is: this player's alone, or (once a multiplayer room has sent its own, and while still in it:
  // offline, a choice is this player's again, pickSky) the room's
  let skyShared = false;
  function showSkyNote() {
    if (skyNote) skyNote.textContent = t(skyShared ? 'menu.skyShared' : 'menu.skyLocal');
  }
  events.on('roomSky', ({ time, weather }) => {
    showSky(time, weather);
    skyShared = true;
    showSkyNote();
  });
  events.on('menu', (open) => {
    if (!open) return;
    if (!net.current?.online) skyShared = false; // (the connection lost: the sky is this player's again)
    showSkyNote();
  });

  timeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const time = btn.getAttribute('data-time');
      if (isSkyTime(time)) pickSky(time, sky.weather);
    });
  });
  weatherButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const weather = btn.getAttribute('data-weather');
      if (isSkyWeather(weather)) pickSky(sky.time, weather);
    });
  });
  onLocaleChange(() => {
    showSkyInfo();
    showSkyNote();
  });

  // The sky this player left last time (?live-weather=<sample> holds one for a preview); a multiplayer room's replaces it
  let savedTime: string | null = null;
  let savedWeather: string | null = null;
  try {
    savedTime = localStorage.getItem('time-of-day');
    savedWeather = localStorage.getItem('weather');
  } catch { /* Storage may be disabled. */ }
  showSky(isSkyTime(savedTime) ? savedTime : 'live', isWeatherSample(heldWeather) ? heldWeather : isSkyWeather(savedWeather) ? savedWeather : 'live');
  showSkyNote();
}
