// js/app/weather-effects.ts
// What the Live weather does to the city every frame (the fixed times of day stay dry): the rain falling round the
// camera slanted by the wind, the water it leaves on the roads (the tyres' grip for the player & the traffic, the hiss
// in the audio), the storms' floods and the word of them, and in a thunderstorm lightning every 8-30 s with its thunder
// after the time its sound takes to arrive.
import { CLEAR_WEATHER, wetGrip } from '../world/weather.ts';
import type { RoadWater } from '../world/weather.ts';
import type { FrameStep, System } from '../core/scheduler.ts';
import type { LightingSystem } from '../render/lighting.ts';
import type { Rain } from '../render/rain.ts';
import type { Floods } from '../world/floods.ts';
import type { FloodSpot } from '../world/flood-model.ts';
import type { ThirdPersonControllerManager } from '../player/controllers.ts';
import type { CameraSystem } from '../player/cameras.ts';
import type { TrafficSystem } from '../sim/traffic.ts';
import type { CrimeSystem } from '../sim/crime.ts';
import type { CityAudioSystem } from '../audio/audio-system.ts';
import type { Interiors } from '../world/interiors.ts';
import { t } from '../i18n/i18n.ts';

const SPEED_OF_SOUND = 343; // m/s
const FLOOD_WORD = 0.3; // flood level the city hears of (and forgets again below half that)
const THUNDERSTORM = 95; // WMO weather code of a thunderstorm and up

export interface WeatherEffectsSystems {
  lighting: LightingSystem;
  roadWater: RoadWater;
  rain: Rain;
  floods: Floods;
  controllers: ThirdPersonControllerManager;
  cameras: CameraSystem;
  traffic: TrafficSystem;
  crime: CrimeSystem;
  audio: CityAudioSystem;
  interiors: Interiors;
  /** whether (x, y, z) is under a roof the rain keeps out from under (Forum Tepic's: world/forum.ts) */
  sheltered: (x: number, y: number, z: number) => boolean;
  /** ° the street grid is turned clockwise from true north (world/city-config.ts CITY.bearingDeg) */
  bearingDeg: number;
}

export class WeatherEffects implements System {
  readonly name = 'weather';
  private readonly s: WeatherEffectsSystems;
  private floodWarned = false;
  private floodSpot: FloodSpot | null = null;
  private nextLightning = 0; // s (elapsed), 0 while no storm

  constructor(systems: WeatherEffectsSystems) {
    this.s = systems;
  }

  update({ dt, elapsed }: Readonly<FrameStep>): void {
    const { lighting, roadWater, rain, floods, controllers, cameras, traffic, crime, audio, interiors } = this.s;
    const w = lighting.activePresetId === 'live' ? lighting.liveWeather ?? CLEAR_WEATHER : CLEAR_WEATHER;
    roadWater.update(dt, w);
    floods.update(dt, w, cameras.camera);
    // word of a flood once it is deep
    if (floods.level > FLOOD_WORD && !this.floodWarned) crime.toast(t('toast.flood'));
    this.floodWarned = floods.level > FLOOD_WORD || (this.floodWarned && floods.level > FLOOD_WORD / 2);
    // ...and of the places that flood every year as the player comes into one (flood-model.ts FLOOD_SPOTS)
    const here = controllers.getActiveEntity().position;
    const spot = floods.spotAt(here.x, here.z);
    if (spot && spot !== this.floodSpot) crime.toast(t('toast.floodAt', { place: spot.name }));
    this.floodSpot = spot;
    // wind blows from windDirection (° clockwise from true north): toward the opposite bearing, in the grid frame
    const toward = (w.windDirection + 180 - this.s.bearingDeg) * Math.PI / 180;
    const wind = (w.windSpeed || 0) / 3.6;
    // (indoors, no rain falls round the camera nor drums on the roof over it; under the mall's roofs it falls outside
    // only, heard faintly on the roof)
    const falling = interiors.active ? 0 : roadWater.rain;
    rain.update(falling, Math.sin(toward) * wind, -Math.cos(toward) * wind, elapsed, cameras.camera);
    const eye = cameras.camera.position;
    const heard = this.s.sheltered(eye.x, eye.y, eye.z) ? falling * 0.25 : falling;
    controllers.roadWet = floods.level > 0.05 ? 1 : roadWater.wet; // (a flood soaks every street)
    controllers.rain = roadWater.rain; // (washing the blood off the car, controllers.ts)
    controllers.roadGrip = wetGrip(roadWater.wet);
    traffic.setRoadWater(roadWater.wet, roadWater.rain, controllers.roadGrip);
    audio.setRain(heard);
    if (w.code >= THUNDERSTORM && roadWater.rain > 0.3) {
      if (!this.nextLightning) this.nextLightning = elapsed + 4 + Math.random() * 10;
      if (elapsed >= this.nextLightning) {
        const distance = 600 + Math.random() * 5400; // m to the strike
        const near = 1 - distance / 6000;
        lighting.flash(0.35 + 0.65 * near);
        audio.thunder(distance / SPEED_OF_SOUND, near);
        this.nextLightning = elapsed + 8 + Math.random() * 22;
      }
    } else this.nextLightning = 0;
  }
}
