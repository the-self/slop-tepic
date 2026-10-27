// js/world/weather.ts
// Live weather & real sun for the "Live" time of day: the sun's true position over Tepic, Nayarit (computed locally
// from the clock, no network) and the current conditions there from Open-Meteo (free, keyless, CORS-enabled; weather
// data by Open-Meteo.com, CC BY 4.0). One point covers the whole map: the forecast models behind it resolve ~10 km
// cells, larger than the city. Kept free of three.js imports so it runs under node:test.

/** The conditions: °C (null unknown), WMO code, cloud fractions 0..1, rain mm/h and mm over the past three hours,
 *  visibility m, wind km/h from `windDirection` degrees (clockwise from true north), fetched at (ms since the epoch). */
export interface Weather {
  temperature: number | null;
  code: number;
  cloudCover: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  rainRate: number;
  recentRain: number;
  visibility: number;
  windSpeed: number;
  windDirection: number;
  fetchedAt: number;
}
/** Where the weather is asked for: degrees, and its IANA time zone. */
export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}
/** The sun's apparent elevation & azimuth (degrees, azimuth clockwise from true north). */
export interface SunPosition {
  elevationDeg: number;
  azimuthDeg: number;
}
export type WeatherSampleName = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog';
/** What LiveWeather fetches with (window.fetch, or a test's). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
/** The part of an Open-Meteo forecast read (`current` as asked for by CURRENT_FIELDS: %, mm, m, km/h, degrees). */
export interface OpenMeteoResponse {
  current?: {
    interval?: number;
    temperature_2m?: number;
    weather_code?: number;
    cloud_cover?: number;
    cloud_cover_low?: number;
    cloud_cover_mid?: number;
    cloud_cover_high?: number;
    precipitation?: number;
    visibility?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  hourly?: { precipitation?: (number | null)[] };
}

const WEATHER_LOCATION: WeatherLocation = { name: 'Tepic', latitude: 21.5042, longitude: -104.8946, timeZone: 'America/Mazatlan' };

const API_URL = 'https://api.open-meteo.com/v1/forecast';
const CURRENT_FIELDS = [
  'temperature_2m', 'weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'precipitation', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'is_day'
];
const CACHE_KEY = 'live-weather-v1';
const REFRESH_MS = 10 * 60 * 1000; // Open-Meteo's "current" block updates every 15 min

// WMO weather interpretation codes (the subset Open-Meteo reports) → short English labels for the HUD
const WMO_LABELS: Partial<Record<number, string>> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Heavy showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'
};

// Clear, dry, unlimited visibility: what Live mode shows until (or unless) the first fetch lands
const CLEAR_WEATHER: Readonly<Weather> = Object.freeze({
  temperature: null, code: 0, cloudCover: 0.1, cloudLow: 0, cloudMid: 0.05, cloudHigh: 0.1,
  rainRate: 0, recentRain: 0, visibility: 24000, windSpeed: 8, windDirection: 0, fetchedAt: 0
});

// Fixed conditions for ?live-weather=<name> (previewing a look without waiting for it to happen in Tepic)
const WEATHER_SAMPLES: Record<WeatherSampleName, Readonly<Weather>> = {
  clear: CLEAR_WEATHER,
  cloudy: { ...CLEAR_WEATHER, code: 2, cloudCover: 0.55, cloudLow: 0.3, cloudMid: 0.25, cloudHigh: 0.3 },
  overcast: { ...CLEAR_WEATHER, code: 3, cloudCover: 1, cloudLow: 0.9, cloudMid: 0.7, cloudHigh: 0.4, visibility: 12000 },
  rain: { ...CLEAR_WEATHER, code: 63, cloudCover: 1, cloudLow: 1, cloudMid: 0.8, cloudHigh: 0.5, rainRate: 3, recentRain: 6, visibility: 5000, windSpeed: 18 },
  storm: { ...CLEAR_WEATHER, code: 95, cloudCover: 1, cloudLow: 1, cloudMid: 1, cloudHigh: 0.9, rainRate: 12, recentRain: 20, visibility: 2500, windSpeed: 35 },
  fog: { ...CLEAR_WEATHER, code: 45, cloudCover: 0.9, cloudLow: 0.9, cloudMid: 0.1, cloudHigh: 0, visibility: 600, windSpeed: 3 }
};

const DEG = Math.PI / 180;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const finite = (v: unknown): v is number => Number.isFinite(v);

// Low-precision solar ephemeris (Astronomical Almanac, ~0.01° over 1950–2050): apparent sun elevation & azimuth
// (degrees, azimuth clockwise from true north) at a UTC instant & a place
function solarPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const H = (gmstHours * 15 + longitude) * DEG - ra; // local hour angle
  const lat = latitude * DEG;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { elevationDeg: elevation / DEG, azimuthDeg: ((azimuth / DEG) % 360 + 360) % 360 };
}

// Unit vector toward the sun in the world frame (x = grid east, y = up, z = grid south) whose grid north is turned
// gridBearingDeg clockwise from true north
function sunDirection(elevationDeg: number, azimuthDeg: number, gridBearingDeg = 0): { x: number; y: number; z: number } {
  const a = (azimuthDeg - gridBearingDeg) * DEG;
  const e = elevationDeg * DEG;
  return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) };
}

// Open-Meteo response → normalized conditions (fractions 0..1, mm/h, m, km/h)
function parseOpenMeteo(json: OpenMeteoResponse | null | undefined, now = Date.now()): Weather {
  const c = json?.current;
  if (!c) throw new Error('Open-Meteo response has no current block');
  const pct = (v: number | undefined) => (finite(v) ? clamp01(v / 100) : 0);
  const intervalHours = (c.interval || 900) / 3600;
  const hourly = json.hourly?.precipitation ?? [];
  return {
    temperature: finite(c.temperature_2m) ? c.temperature_2m : null,
    code: finite(c.weather_code) ? c.weather_code : 0,
    cloudCover: pct(c.cloud_cover),
    cloudLow: pct(c.cloud_cover_low),
    cloudMid: pct(c.cloud_cover_mid),
    cloudHigh: pct(c.cloud_cover_high),
    rainRate: Math.max(0, c.precipitation || 0) / intervalHours, // "current" precipitation is the interval's total
    recentRain: hourly.reduce((sum: number, v) => sum + (finite(v) ? v : 0), 0),
    visibility: finite(c.visibility) && c.visibility > 0 ? c.visibility : 24000,
    windSpeed: finite(c.wind_speed_10m) ? c.wind_speed_10m : 0,
    windDirection: finite(c.wind_direction_10m) ? c.wind_direction_10m : 0,
    fetchedAt: now
  };
}

function weatherLabel(w: Readonly<Weather>): string {
  return WMO_LABELS[w.code] || (w.cloudCover > 0.7 ? 'Overcast' : w.cloudCover > 0.3 ? 'Partly cloudy' : 'Clear');
}

// Is it raining (drizzle, rain, showers, thunderstorm), by the rate or the WMO code?
function isRaining(w: Readonly<Weather>): boolean {
  return w.rainRate > 0.05 || (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.code >= 95;
}

// How hard it falls, 0..1, for the drops drawn & heard: drizzle ~0.25, steady rain (3 mm/h) 0.5, a downpour or a
// storm (8 mm/h and up) 1
function rainIntensity(w: Readonly<Weather>): number {
  if (!isRaining(w)) return 0;
  const rate = Math.max(w.rainRate || 0, w.code >= 95 ? 10 : w.code === 65 || w.code === 81 || w.code === 82 ? 7 : 0);
  return clamp01(0.25 + rate / 10.5);
}

// Tyre grip on the road for a water film `wet` (0 dry .. 1 soaked): wet asphalt keeps roughly 0.7 of its dry friction
// (0.7-0.8 μ wet against 0.9-1.0 dry for road tyres)
const wetGrip = (wet: number) => 1 - 0.3 * clamp01(wet);

/**
 * The water on the roads, for driving (not for the look, which lighting.ts sets): it rises within a minute or two of
 * steady rain and drains & dries over ~20 minutes once it stops (quicker in sun & wind). Starts wet if it rained in
 * the past three hours. `rain` eases to the falling intensity, so showers come and go rather than switch.
 */
class RoadWater {
  /** the water film on the roads, 0 dry .. 1 soaked */
  wet: number;
  /** the falling intensity 0..1, eased */
  rain: number;
  started: boolean;

  constructor() {
    this.wet = 0;
    this.rain = 0;
    this.started = false;
  }

  update(dt: number, w: Readonly<Weather>): this {
    const rain = rainIntensity(w);
    if (!this.started) {
      this.started = true;
      this.rain = rain;
      this.wet = Math.max(rain > 0 ? 0.6 + 0.4 * rain : 0, clamp01((w.recentRain || 0) / 6) * 0.6);
    }
    this.rain += (rain - this.rain) * (1 - Math.exp(-dt / 6));
    if (rain > 0) this.wet = Math.min(1, this.wet + dt * (0.004 + 0.02 * rain) * (1.2 - this.wet));
    else this.wet = Math.max(0, this.wet - dt * (1 + (w.windSpeed || 0) / 20) / 1200);
    return this;
  }
}

class LiveWeather {
  location: WeatherLocation;
  fetchImpl: FetchLike | null;
  storage: StorageLike | null;
  current: Weather;
  /** true once real conditions (fresh or cached) are in */
  live: boolean;
  pending: Promise<boolean> | null;
  /** ms since the epoch */
  nextAttempt: number;
  /** true while hold() pins the conditions */
  held = false;
  /** the fetch hold() set aside, for release() */
  heldFetch: FetchLike | null = null;

  constructor(location = WEATHER_LOCATION,
    { fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null, storage }: { fetchImpl?: FetchLike | null; storage?: StorageLike | null } = {}) {
    this.location = location;
    this.fetchImpl = fetchImpl;
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage; // reading it throws a SecurityError where site data is blocked
      } catch {
        storage = null;
      }
    }
    this.storage = storage;
    this.current = { ...CLEAR_WEATHER };
    this.live = false; // true once real conditions (fresh or cached) are in
    this.pending = null;
    this.nextAttempt = 0;
    this.restoreCache();
  }

  restoreCache(): void {
    try {
      if (!this.storage) return;
      const cached = JSON.parse(this.storage.getItem(CACHE_KEY) ?? 'null') as Partial<Weather> | null;
      if (cached?.fetchedAt && Date.now() - cached.fetchedAt < 3 * REFRESH_MS) {
        this.current = { ...CLEAR_WEATHER, ...cached };
        this.live = true;
        this.nextAttempt = cached.fetchedAt + REFRESH_MS;
      }
    } catch {
      // no storage (private mode / tests) or a stale shape: start clear
    }
  }

  // Fetches once the conditions are older than REFRESH_MS; resolves true when new ones arrived. Never rejects:
  // offline or a failed request keeps the last (or clear) weather
  refresh(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!this.fetchImpl || Date.now() < this.nextAttempt) return Promise.resolve(false);
    const { latitude, longitude } = this.location;
    const url = `${API_URL}?latitude=${latitude}&longitude=${longitude}&current=${CURRENT_FIELDS.join(',')}` +
      '&hourly=precipitation&past_hours=3&forecast_hours=1&timezone=auto';
    this.pending = this.fetchImpl(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (this.held) return false; // (pinned while the request was out: the real conditions wait for release())
        this.current = parseOpenMeteo(json as OpenMeteoResponse);
        this.live = true;
        this.nextAttempt = Date.now() + REFRESH_MS;
        try {
          this.storage?.setItem(CACHE_KEY, JSON.stringify(this.current));
        } catch {
          // storage full or blocked: the in-memory copy still serves this session
        }
        return true;
      })
      .catch((err: unknown) => {
        console.warn('[weather] keeping previous conditions:', err instanceof Error ? err.message : String(err));
        this.nextAttempt = Date.now() + 60000; // retry in a minute, not every tick
        return false;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  // Pins the conditions (no more fetching), e.g. to WEATHER_SAMPLES.storm
  hold(conditions: Partial<Weather>): void {
    if (!this.held) this.heldFetch = this.fetchImpl;
    this.held = true;
    this.fetchImpl = null;
    this.current = { ...CLEAR_WEATHER, ...conditions, fetchedAt: Date.now() };
    this.live = true;
  }

  // Lets go of held conditions: back to the real ones, the cached first, then fresh
  release(): void {
    if (!this.held) return;
    this.held = false;
    this.fetchImpl = this.heldFetch;
    this.heldFetch = null;
    this.current = { ...CLEAR_WEATHER };
    this.live = false;
    this.nextAttempt = 0;
    this.restoreCache();
  }

  sun(date = new Date()): SunPosition {
    return solarPosition(date, this.location.latitude, this.location.longitude);
  }
}

export {
  WEATHER_LOCATION, CLEAR_WEATHER, WEATHER_SAMPLES, solarPosition, sunDirection, parseOpenMeteo, weatherLabel, LiveWeather,
  isRaining, rainIntensity, wetGrip, RoadWater
};
