// js/app/room-settings.ts
// A multiplayer room's settings (net/lobby.ts, shared/protocol.ts RoomSettings) on this player's game: its weather
// held (world/weather.ts) or Tepic's real one, its hour fixed or the real clock (both through the Live time of day,
// so a stormy night is a stormy night), and its police off or on. PvP is net/multiplayer.ts's own.
import { WEATHER_SAMPLES } from '../world/weather.ts';
import { localHour } from '../sim/traffic-demand.ts';
import type { RoomSettings, RoomTime } from '../../shared/protocol.ts';
import type { LightingSystem } from '../render/lighting.ts';
import type { CrimeSystem } from '../sim/crime.ts';

// The hour (local, in the weather location's time zone) each fixed time of day stands at
const ROOM_HOURS: Readonly<Record<Exclude<RoomTime, 'live'>, number>> = { morning: 9, midday: 13, sunset: 18.75, night: 23 };

export interface RoomSettingsTargets {
  lighting: LightingSystem;
  crime: CrimeSystem;
  /** the clock Live ran on before any room (the real one, or ?live-time's) */
  ownClock: () => Date;
  /** shows the Live time of day (main.ts selectTime: its button lit) */
  showLive: () => void;
}

// Today at `hour` in `timeZone`, held there
function fixedClock(hour: number, timeZone: string): () => Date {
  const now = new Date();
  const at = new Date(now.getTime() + (hour - localHour(now, timeZone)) * 3600000);
  return () => at;
}

/** Applies `settings`; a room that fixes neither the weather nor the hour leaves the player's own time of day alone */
export function applyRoomSettings(settings: RoomSettings, { lighting, crime, ownClock, showLive }: RoomSettingsTargets): void {
  const weather = lighting.weather;
  if (settings.weather === 'live') weather.release();
  else weather.hold(WEATHER_SAMPLES[settings.weather]);
  lighting.liveClock = settings.time === 'live' ? ownClock : fixedClock(ROOM_HOURS[settings.time], weather.location.timeZone);
  if (settings.weather !== 'live' || settings.time !== 'live') {
    lighting.applyPreset('live', true); // (snapped to them, not eased in)
    showLive();
  } else if (lighting.activePresetId === 'live') {
    lighting.applyPreset('live', true); // (back to the real ones at once, after a room that fixed them)
  }
  crime.policeOff = !settings.police;
  if (!settings.police) crime.wanted.clear();
}
