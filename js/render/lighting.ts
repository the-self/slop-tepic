import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec3,
  vec4,
  uniform,
  mix,
  fog,
  pmremTexture,
  positionWorld,
  cameraPosition,
  length,
  normalize,
  max,
  exp,
  abs,
  select
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { HalfRateSunLightNode } from './sun-shadow.ts';
import { cityUniforms } from './tsl-materials.ts';
import { GEO } from '../world/city-geodata.js';
import { LiveWeather, sunDirection, isRaining } from '../world/weather.ts';
import type { Weather, WeatherLocation, SunPosition } from '../world/weather.ts';
import { localHour } from '../sim/traffic-demand.ts';
import { SLOPES, townHeight } from '../world/ground.ts';
import type { Node, UniformNode } from 'three/webgpu';

// js/render/lighting.ts
// Physically-Based Atmospheric Sky (Preetham SkyMesh + Beer-Powder Clouds),
// Live PMREMGenerator IBL Cubemap, Three.js r186 SunLight (2-Cascade CSM),
// and Occlusion-Aware Urban Canyon Global Illumination for Three.js r186 WebGPURenderer

/**
 * A time of day: the sun (direction toward it, colour, intensity), the sky & ground fill, the fog (FogExp2 density, 1/m),
 * the city's shared uniforms (cityUniforms), the image-based light's intensity and the physical sky's parameters;
 * nightFactor 0 day .. 1 night
 */
export interface TimePreset {
  id: PresetName;
  name: string;
  hour: number; // 0-24, local
  sunDir: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  fogDensity: number;
  interiorGlow: number;
  roadWetness: number;
  envIntensity: number;
  canyonBounce: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  cloudDensity: number;
  skyExposure: number;
  nightFactor: number;
}
export type PresetName = 'golden' | 'midday' | 'twilight' | 'midnight';

const COLOR_KEYS = ['sunColor', 'hemiSky', 'hemiGround', 'skyTop', 'skyHorizon', 'fogColor'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
type NumberKey = Exclude<keyof TimePreset, ColorKey | 'id' | 'name' | 'sunDir'>;
/** What the scene is lit with: a preset's numbers & colours, or a blend of two under the live weather */
export type LightParams = Record<NumberKey, number> & Record<ColorKey, THREE.ColorRepresentation>;
/** A blend of two presets (its colours mixed), with the live weather's cloud drift (sky units / s) */
export type LiveParams = Record<NumberKey, number> & Record<ColorKey, THREE.Color> & { cloudSpeed?: number };

export interface PresetBlend {
  a: PresetName;
  b: PresetName;
  t: number;
}
/** What Live shows: the sun, the presets blended for it, how much of the sun the clouds block (0..1), the conditions */
export interface LiveState {
  sun: SunPosition;
  blend: PresetBlend;
  block: number;
  weather: Weather;
  live: boolean;
  loading: boolean;
  location: WeatherLocation;
}

const TIME_PRESETS: Partial<Record<string, TimePreset>> & Record<PresetName, TimePreset> = {
  golden: {
    id: 'golden',
    name: 'Golden Hour · 17:45',
    hour: 17.75, // (the traffic's and the crowds' hour, traffic-demand.ts)
    // Crisp street-canyon sun slicing across avenues & intersections so buildings, cars, trees & pedestrians cast sharp shadows
    sunDir: new THREE.Vector3(-0.44, 0.58, -0.68).normalize(),
    sunColor: 0xffca92,
    sunIntensity: 5.8,
    hemiSky: 0x9abbe6,
    hemiGround: 0xc88a62, // Warm terracotta / limestone upward canyon bounce
    hemiIntensity: 1.48,
    skyTop: 0x2c568c,
    skyHorizon: 0xebd1b5,
    fogColor: 0xdcc5ae,
    fogDensity: 0.00024,
    interiorGlow: 0.48,
    roadWetness: 0.28,
    envIntensity: 0.54,
    canyonBounce: 0.52,
    turbidity: 8.0,
    rayleigh: 2.8,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.88,
    cloudCoverage: 0.36,
    cloudDensity: 0.38,
    skyExposure: 0.148,
    nightFactor: 0.0
  },
  midday: {
    id: 'midday',
    name: 'Sunny Midday · 13:30',
    hour: 13.5,
    sunDir: new THREE.Vector3(-0.34, 0.82, -0.46).normalize(),
    sunColor: 0xfff5e8,
    sunIntensity: 6.6,
    hemiSky: 0xaad2ff,
    hemiGround: 0xb89678, // Warm sunlit masonry & pavement bounce
    hemiIntensity: 1.58,
    skyTop: 0x225ea8,
    skyHorizon: 0xc8dff5,
    fogColor: 0xc6dcf2,
    fogDensity: 0.00018,
    interiorGlow: 0.24,
    roadWetness: 0.08,
    envIntensity: 0.58,
    canyonBounce: 0.58,
    turbidity: 6.5,
    rayleigh: 2.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.86,
    cloudCoverage: 0.32,
    cloudDensity: 0.35,
    skyExposure: 0.142,
    nightFactor: 0.0
  },
  twilight: {
    id: 'twilight',
    name: 'Blue Hour · 19:15',
    hour: 19.25,
    sunDir: new THREE.Vector3(-0.52, 0.36, -0.77).normalize(),
    sunColor: 0xff9466,
    sunIntensity: 3.1,
    hemiSky: 0x4c6ca8,
    hemiGround: 0x6e5048,
    hemiIntensity: 0.85,
    skyTop: 0x102248,
    skyHorizon: 0xb86b6c,
    fogColor: 0x353c58,
    fogDensity: 0.00032,
    interiorGlow: 1.25,
    roadWetness: 0.55,
    envIntensity: 0.36,
    canyonBounce: 0.32,
    turbidity: 9.5,
    rayleigh: 3.4,
    mieCoefficient: 0.010,
    mieDirectionalG: 0.90,
    cloudCoverage: 0.40,
    cloudDensity: 0.42,
    skyExposure: 0.115,
    nightFactor: 0.28
  },
  midnight: {
    id: 'midnight',
    name: 'Night · 23:00',
    hour: 23,
    sunDir: new THREE.Vector3(0.42, 0.68, -0.60).normalize(),
    sunColor: 0x8cb0e8,
    sunIntensity: 1.45,
    hemiSky: 0x263a62,
    hemiGround: 0x382e36,
    hemiIntensity: 0.72,
    skyTop: 0x060c1a,
    skyHorizon: 0x182640,
    fogColor: 0x0c1424,
    fogDensity: 0.00036,
    interiorGlow: 1.55,
    roadWetness: 0.62,
    envIntensity: 0.30,
    canyonBounce: 0.18,
    turbidity: 4.0,
    rayleigh: 1.5,
    mieCoefficient: 0.004,
    mieDirectionalG: 0.80,
    cloudCoverage: 0.22,
    cloudDensity: 0.25,
    skyExposure: 0.022,
    nightFactor: 0.86
  }
};

// Live time of day: the presets are pinned at these real sun elevations (degrees) and blend in between; the weather then
// dims, greys, fogs and wets the result
const LIVE_KEYFRAMES: { elevation: number; id: PresetName }[] = [
  { elevation: -12, id: 'midnight' },
  { elevation: -4, id: 'twilight' },
  { elevation: 7, id: 'golden' },
  { elevation: 32, id: 'midday' }
];
// Live checks every LIVE_TICK_MS but only re-applies (and re-bakes the sky IBL) once the sun has moved LIVE_SUN_STEP
// degrees (~2 min) or the weather is still easing toward new conditions
const LIVE_TICK_MS = 15000;
const LIVE_SUN_STEP = 0.5;
const LIVE_EASE = 0.35; // share of the way the shown weather moves toward newly fetched conditions per tick
const EASED_WEATHER_KEYS = ['temperature', 'cloudCover', 'cloudLow', 'cloudMid', 'cloudHigh', 'rainRate', 'recentRain', 'visibility', 'windSpeed'] as const;
const MOON_DIR = TIME_PRESETS.midnight.sunDir;
const { smoothstep } = THREE.MathUtils;

// Presets either side of a sun elevation & the smoothstepped weight of the upper one
function liveBlend(elevationDeg: number): PresetBlend {
  const k = LIVE_KEYFRAMES;
  if (elevationDeg <= k[0].elevation) return { a: k[0].id, b: k[0].id, t: 0 };
  for (let i = 1; i < k.length; i++) {
    if (elevationDeg < k[i].elevation) {
      return { a: k[i - 1].id, b: k[i].id, t: smoothstep(elevationDeg, k[i - 1].elevation, k[i].elevation) };
    }
  }
  const last = k[k.length - 1].id;
  return { a: last, b: last, t: 0 };
}

function mixPresets(a: PresetName, b: PresetName, t: number): LiveParams {
  const pa = TIME_PRESETS[a];
  const pb = TIME_PRESETS[b];
  const p: Partial<Record<keyof TimePreset, number | THREE.Color>> = {};
  // (the keys of a preset object are its own)
  for (const key of Object.keys(pa) as (keyof TimePreset)[]) {
    const va = pa[key];
    const vb = pb[key];
    if (typeof va === 'number' && typeof vb === 'number' && !(COLOR_KEYS as readonly string[]).includes(key)) p[key] = va + (vb - va) * t;
  }
  for (const key of COLOR_KEYS) p[key] = new THREE.Color(pa[key]).lerp(new THREE.Color(pb[key]), t);
  // (every number of the presets, every colour)
  return p as LiveParams;
}

// Overlays live conditions onto blended preset params; returns how much of the direct sun the clouds block (0..1)
function applyWeather(p: LiveParams, w: Weather): number {
  const raining = isRaining(w);
  const storm = w.code >= 95 ? 1 : 0;
  const foggy = w.code === 45 || w.code === 48 ? 1 : 0;
  // Low & mid decks shade the sun; thin high cirrus barely does
  const block = Math.min(0.92, w.cloudLow * 0.9 + w.cloudMid * 0.6 + w.cloudHigh * 0.15 + foggy * 0.4 + storm * 0.2);

  p.sunIntensity *= 1 - 0.85 * block;
  p.hemiIntensity *= 1 + 0.12 * block - 0.25 * storm;
  p.envIntensity *= 1 - 0.18 * block;
  p.skyExposure *= 1 - 0.3 * block;
  p.turbidity += 4 * block;
  // Overcast light is flat & grey: pull the sky-driven colours toward their own luminance
  const grey = new THREE.Color();
  for (const key of ['hemiSky', 'skyTop', 'skyHorizon', 'fogColor'] as const) {
    const c = p[key];
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    c.lerp(grey.setRGB(l, l, l), block * 0.55);
  }
  // Dark storm afternoons switch the street & window lights on early
  p.interiorGlow += 0.45 * block * block * (1 - p.nightFactor);

  p.cloudCoverage = w.cloudCover < 0.03 ? 0 : Math.min(0.92, 0.1 + 0.75 * w.cloudCover);
  p.cloudDensity = Math.min(1, 0.25 + 0.55 * Math.min(1, w.cloudLow + w.cloudMid) + 0.2 * storm);
  p.cloudSpeed = 0.000015 * (0.5 + w.windSpeed / 15);

  // FogExp2-style haze: 1.73 / visibility leaves ~5% contrast at the reported visibility distance
  p.fogDensity = Math.min(0.004, Math.max(p.fogDensity, 1.73 / w.visibility) * (raining ? 1.3 : 1));

  if (raining) p.roadWetness = Math.max(p.roadWetness, 0.6 + 0.12 * Math.min(w.rainRate, 3));
  else if (w.recentRain > 0.2) p.roadWetness = Math.max(p.roadWetness, 0.45);
  else p.roadWetness = Math.min(p.roadWetness, 0.25);
  return block;
}

class LightingSystem {
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer | null;
  activePresetId: string; // a PresetName or 'live'
  weather: LiveWeather;
  liveClock: () => Date;
  liveState: LiveState | null;
  liveWeather: Weather | null;
  nextLiveTick: number; // performance.now() ms
  liveSunApplied: SunPosition | null;
  onLiveChange: ((state: LiveState) => void) | null;
  sky: SkyMesh;
  uSkyExposure: UniformNode<'float', number>;
  uNightFactor: UniformNode<'float', number>;
  uNightSkyColor: UniformNode<'color', THREE.Color>;
  pmremGenerator: THREE.PMREMGenerator | null;
  envScene: THREE.Scene;
  envRenderTarget: THREE.RenderTarget | null = null;
  sunLight: SunLight;
  hemiLight: THREE.HemisphereLight;
  // (made after the first applyPreset, which runs before them)
  uFogDensity: UniformNode<'float', number> | undefined;
  uFogHeight: UniformNode<'float', number>; // m
  uFogBase: UniformNode<'float', number>; // m
  baseHemi: number | undefined;
  baseSkyExposure: number | undefined;
  flashStart = 0; // performance.now() ms, 0 when no flash
  flashStrength = 0;
  flashFlicker = 0; // s

  /** maxShadowMap: the graphics tier's shadow map per cascade (px, app/quality.ts) */
  constructor(scene: THREE.Scene, renderer: THREE.WebGPURenderer | null = null, maxShadowMap = 3072) {
    this.scene = scene;
    this.renderer = renderer;
    this.activePresetId = 'golden';
    this.weather = new LiveWeather();
    this.liveClock = () => new Date();
    this.liveState = null;
    this.liveWeather = null; // eased copy of this.weather.current that the scene shows
    this.nextLiveTick = 0;
    this.liveSunApplied = null; // sun position the scene was last lit for
    this.onLiveChange = null;

    // Assign SunLight its node implementation for WebGPURenderer (Light.registerNode since r187; r186 used the library)
    // (@types/three 0.186 doesn't know Light.registerNode yet)
    // (ours draws the far cascade every other frame: render/sun-shadow.ts)
    const sunLightClass: { prototype: SunLight; registerNode?: (nodeClass: typeof HalfRateSunLightNode) => void } = SunLight;
    if (sunLightClass.registerNode) {
      sunLightClass.registerNode(HalfRateSunLightNode);
    } else if (renderer) {
      renderer.library.addLight(HalfRateSunLightNode, SunLight);
    }

    this.scene.fog = new THREE.FogExp2(0xdcc5ae, 0.00024);
    // Leave scene.background = null because SkyMesh renders the 360° sky dome, and setting
    // a THREE.Color on scene.background sets forceClear=true in WebGPURenderer's Background.update,
    // which would otherwise clear Cascade 0 when rendering Cascade 1 in SunShadowNode!
    this.scene.background = null;

    // Physical Preetham SkyMesh + Beer-Powder Clouds (from three/addons/objects/SkyMesh.js). Its unit box must contain
    // the camera wherever it flies over the 1:1 valley (the city box alone is ~15 km across; it renders at the far
    // plane whatever its size)
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(200000);
    this.sky.turbidity.value = 8.0;
    this.sky.rayleigh.value = 2.8;
    this.sky.mieCoefficient.value = 0.008;
    this.sky.mieDirectionalG.value = 0.88;
    this.sky.cloudScale.value = 0.00018;
    this.sky.cloudSpeed.value = 0.000015;
    this.sky.cloudCoverage.value = 0.36;
    this.sky.cloudDensity.value = 0.38;
    this.sky.cloudElevation.value = 0.52;

    // Calibrate SkyMesh raw radiance (EE=1000 * 0.04) into standard exposure=1.0 HDR range
    this.uSkyExposure = uniform(0.148);
    this.uNightFactor = uniform(0.0);
    this.uNightSkyColor = uniform(new THREE.Color(0x0b1528));
    const rawSkyNode = this.sky.material.colorNode as Node<'vec4'>; // (SkyMesh's own: the sky's radiance, a vec4)
    this.sky.material.colorNode = Fn(() => {
      const raw = rawSkyNode;
      const dayCol = raw.rgb.mul(this.uSkyExposure);
      const finalSky = mix(dayCol, this.uNightSkyColor, this.uNightFactor);
      return vec4(finalSky, float(1.0));
    })();

    // In reversedDepthBuffer mode ([1..0]), camera.far is z = 0.0 (whereas SkyMesh defaults to z = w)
    if (renderer?.reversedDepthBuffer) {
      const rawSkyVertexNode = this.sky.material.vertexNode as Node<'vec4'>; // (SkyMesh's own: a clip-space position)
      this.sky.material.vertexNode = Fn(() => {
        const pos = rawSkyVertexNode.toVar();
        pos.z.assign(0.0);
        return pos;
      })();
    }

    this.scene.add(this.sky);

    // Reusable PMREMGenerator & offscreen envScene (mirrors webgpu_generator_city.html)
    this.pmremGenerator = renderer ? new THREE.PMREMGenerator(renderer) : null;
    this.envScene = new THREE.Scene();

    // Three.js r186 SunLight with automatic 2-Cascade Shadow Map (SunLightShadow + SunShadowNode)
    // Shines from its position vector toward the origin (no .target needed)
    this.sunLight = new SunLight(0xffca92, 5.8);
    this.sunLight.position.copy(TIME_PRESETS.golden.sunDir);
    this.sunLight.castShadow = true;
    // 3072x3072 per cascade = 6144x3072 2-cascade shadow atlas (an 8192x4096 one cost ~20% fps and caused hitches),
    // 2048 where the device allows less, and the tier's own on a phone (app/quality.ts). The near cascade spans
    // ~0.35-80 m of the view at street level (see update)
    const backend = renderer?.backend;
    // (the WebGPU backend's device, which @types/three doesn't declare: the WebGL fallback has none)
    const device = backend instanceof THREE.WebGPUBackend && 'device' in backend ? backend.device : null;
    const maxTex = (device instanceof GPUDevice && device.limits.maxTextureDimension2D) || 4096;
    const tile = Math.min(maxShadowMap, maxTex >= 6144 ? 3072 : 2048);
    this.sunLight.shadow.mapSize.set(tile, tile);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 300;
    // Suppress shadow acne along the surface normal in world units
    // so short casters like cars, curbs, tree trunks, and pedestrians keep crisp contact shadows
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);

    // Subtle Hemisphere Sky + Warm Terracotta/Limestone Ground Bounce Fill
    // (Kept intentionally lower than sunLight so urban canyon shadows remain deep and crisp)
    this.hemiLight = new THREE.HemisphereLight(0x9abbe6, 0xc88a62, 1.05);
    this.hemiLight.position.set(0, 300, 0);
    this.scene.add(this.hemiLight);

    this.applyPreset('golden');

    // Sky-matched aerial perspective (replaces the flat FogExp2 colour): distant surfaces fade into the baked sky
    // radiance just above the horizon in their view direction (sun glow included), through an exponential haze layer
    // so helicopter / observatory views stay clearer than the horizon.
    this.uFogDensity = uniform(TIME_PRESETS.golden.fogDensity);
    this.uFogHeight = uniform(900.0);
    // the haze thins from the valley floor up (the town's slopes raise it to the far floor's height)
    this.uFogBase = uniform(SLOPES && GEO.ground ? GEO.ground.floor : 0.0);
    if (this.envRenderTarget) this.scene.fogNode = this.createAerialFogNode();
  }

  createAerialFogNode(): Node<'vec4'> | null {
    if (!this.envRenderTarget || !this.uFogDensity) return null;
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = length(toFrag);
    const dir = toFrag.div(max(dist, 0.001));
    const horizonDir = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
    const skyColor = pmremTexture(this.envRenderTarget.texture, horizonDir, float(0.3)).rgb;
    // Mean haze density exp(-y / H) along the ray between the fragment and the camera
    const H = this.uFogHeight;
    const ya = max(positionWorld.y.sub(this.uFogBase), 0.0);
    const yb = max(cameraPosition.y.sub(this.uFogBase), 0.0);
    const dy = yb.sub(ya);
    const ea = exp(ya.div(H).negate());
    const eb = exp(yb.div(H).negate());
    const meanDensity = select(abs(dy).greaterThan(1.0), ea.sub(eb).mul(H).div(dy), ea);
    const tau = this.uFogDensity.mul(dist).mul(meanDensity);
    return fog(skyColor, float(1.0).sub(exp(tau.mul(tau).negate())));
  }

  bakeEnvironmentMap(): void {
    if (!this.pmremGenerator) return;
    // Bake physical SkyMesh (without solar disc) into scene.environment for realistic canyon IBL.
    // Reuses a single RenderTarget so texture identity never changes.
    this.sky.showSunDisc.value = 0;
    this.envScene.add(this.sky);
    this.envRenderTarget = this.pmremGenerator.fromScene(this.envScene, 0, 0.1, 100, {
      renderTarget: this.envRenderTarget
    });
    this.scene.environment = this.envRenderTarget.texture;
    this.sky.showSunDisc.value = 1;
    this.scene.add(this.sky);
  }

  // The hour of the day it is in the town (0-24, local): the live clock's in the weather location's time zone, or the
  // preset's own
  get hourOfDay(): number {
    if (this.activePresetId !== 'live') return TIME_PRESETS[this.activePresetId]?.hour ?? 14;
    return localHour(this.liveClock(), this.weather.location.timeZone);
  }

  get isNight(): boolean {
    return this.activePresetId === 'midnight' || (this.activePresetId === 'live' && this.uNightFactor.value > 0.5);
  }

  applyPreset(presetId: string, force = false): void {
    if (presetId === 'live') {
      if (!force && this.activePresetId === 'live' && this.envRenderTarget !== null) return;
      this.activePresetId = 'live';
      this.liveWeather = null; // snap to the current conditions instead of easing in from another preset
      this.liveState = null;
      this.updateLive(true);
      return;
    }
    const p = TIME_PRESETS[presetId] ?? TIME_PRESETS.golden;
    if (!force && this.activePresetId === p.id && this.envRenderTarget !== null) {
      return;
    }
    this.activePresetId = p.id;
    this.liveState = null;
    this.sky.cloudSpeed.value = 0.000015;
    this.applyParams(p, p.sunDir, p.sunDir);
  }

  // Pins the Live weather to `conditions` (world/weather.ts's WEATHER_SAMPLES), or with null goes back to the real
  // conditions; the scene eases into them on the next live tick
  setWeather(conditions: Readonly<Weather> | null): void {
    if (conditions) this.weather.hold(conditions);
    else this.weather.release();
    this.nextLiveTick = 0;
  }

  // Real sun over the weather location, blended presets & live conditions; re-fetches the weather when it is due
  updateLive(force = false): void {
    const now = performance.now();
    if (!force && now < this.nextLiveTick) return;
    this.nextLiveTick = now + LIVE_TICK_MS;
    const fetching = this.weather.refresh();
    if (this.weather.pending) {
      void fetching.then(() => {
        if (this.activePresetId === 'live') this.nextLiveTick = 0; // show the new conditions (or the failure) right away
      });
    }

    const target = this.weather.current;
    let easing = false;
    // Snap rather than ease when entering Live or when the first real conditions replace the clear placeholder
    if (!this.liveWeather || (this.weather.live && !this.liveState?.live)) {
      this.liveWeather = { ...target };
      force = true;
    } else {
      const eased = { ...target };
      for (const key of EASED_WEATHER_KEYS) {
        const from = this.liveWeather[key];
        const to = target[key];
        if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) continue;
        const next = from + (to - from) * LIVE_EASE;
        // settle once within 1% (of the value, or of 1 for fractions near zero)
        if (Math.abs(to - next) > 0.01 * Math.max(1, Math.abs(to))) {
          eased[key] = next;
          easing = true;
        }
      }
      easing = easing || target.code !== this.liveWeather.code;
      this.liveWeather = eased;
    }

    const sun = this.weather.sun(this.liveClock());
    const last = this.liveSunApplied;
    const sunMoved = !last || Math.abs(sun.elevationDeg - last.elevationDeg) > LIVE_SUN_STEP || Math.abs(sun.azimuthDeg - last.azimuthDeg) > LIVE_SUN_STEP;
    const prev = this.liveState;
    const statusChanged = prev?.live !== this.weather.live || prev.loading !== !!this.weather.pending;
    if (!force && !easing && !sunMoved && !statusChanged) return;
    this.liveSunApplied = sun;
    const blend = liveBlend(sun.elevationDeg);
    const p = mixPresets(blend.a, blend.b, blend.t);
    const block = applyWeather(p, this.liveWeather);

    const bearing = GEO.frame.bearingDeg;
    const real = sunDirection(sun.elevationDeg, sun.azimuthDeg, bearing);
    // Grazing light keeps every street in shadow, so the key light never drops below 8°; under the horizon it hands
    // over to the presets' moonlight
    const lightSun = sunDirection(Math.max(8, sun.elevationDeg), sun.azimuthDeg, bearing);
    const dayWeight = smoothstep(sun.elevationDeg, -6, 3);
    const lightDir = new THREE.Vector3().copy(MOON_DIR).lerp(new THREE.Vector3(lightSun.x, lightSun.y, lightSun.z), dayWeight).normalize();
    const skyDir = sun.elevationDeg >= -5 ? new THREE.Vector3(real.x, real.y, real.z) : new THREE.Vector3().copy(sunDirection(-5, sun.azimuthDeg, bearing));
    if (p.cloudSpeed !== undefined) this.sky.cloudSpeed.value = p.cloudSpeed;
    this.applyParams(p, lightDir, skyDir.normalize());

    this.liveState = {
      sun, blend, block, weather: this.liveWeather, live: this.weather.live, loading: !!this.weather.pending, location: this.weather.location
    };
    if (this.onLiveChange) this.onLiveChange(this.liveState);
  }

  applyParams(p: LightParams, sunDir: THREE.Vector3, skySunDir: THREE.Vector3): void {
    this.sunLight.color.set(p.sunColor);
    this.sunLight.intensity = p.sunIntensity;
    this.sunLight.position.copy(sunDir);
    this.sunLight.updateMatrixWorld();

    this.hemiLight.color.set(p.hemiSky);
    this.hemiLight.groundColor.set(p.hemiGround);
    this.hemiLight.intensity = p.hemiIntensity;
    this.baseHemi = p.hemiIntensity; // (what a lightning flash adds to, see flash())

    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.set(p.fogColor);
      fog.density = p.fogDensity;
    }
    if (this.uFogDensity) this.uFogDensity.value = p.fogDensity;

    // Update physical Preetham SkyMesh uniforms
    this.sky.turbidity.value = p.turbidity;
    this.sky.rayleigh.value = p.rayleigh;
    this.sky.mieCoefficient.value = p.mieCoefficient;
    this.sky.mieDirectionalG.value = p.mieDirectionalG;
    this.sky.cloudCoverage.value = p.cloudCoverage;
    this.sky.cloudDensity.value = p.cloudDensity;
    this.sky.sunPosition.value.copy(skySunDir);
    this.uSkyExposure.value = p.skyExposure;
    this.baseSkyExposure = p.skyExposure;
    this.uNightFactor.value = p.nightFactor;

    cityUniforms.uSunColor.value.set(p.sunColor);
    cityUniforms.uSkyTopColor.value.set(p.skyTop);
    cityUniforms.uSkyHorizonColor.value.set(p.skyHorizon);
    cityUniforms.uSkySunDir.value.copy(sunDir);
    cityUniforms.uInteriorGlow.value = p.interiorGlow;
    cityUniforms.uRoadWetness.value = p.roadWetness;
    cityUniforms.uCanyonBounce.value = p.canyonBounce;

    this.scene.environmentIntensity = p.envIntensity;
    this.bakeEnvironmentMap();
  }

  update(focusPos: THREE.Vector3 | null): void {
    // SunLightShadow automatically fits & texel-snaps its 2 cascades to the view camera frustum
    // every frame inside SunShadowNode.renderShadow(), splitting [near, far] halfway between a uniform and a
    // logarithmic split (the near cascade ends at ~far / 4). Keep far at 300 m at street level so the near cascade
    // stays sharp, and expand it with altitude (helicopter / observatory) so shadows reach all the way down to street level.
    // (over the town's floor: its slopes put the streets well over y = 0)
    const altitude = focusPos && Number.isFinite(focusPos.y) ? Math.max(0, focusPos.y - townHeight(focusPos.x, focusPos.z)) : 0;
    this.sunLight.shadow.camera.far = Math.max(300, Math.min(720, 260 + altitude * 1.6));
    if (this.activePresetId === 'live') this.updateLive();
    if (this.flashStart) this.updateFlash();
  }

  // Lightning: the sky and everything under it light up white for a moment, flicker once or twice and fade within a
  // second (strength 0..1, a near strike 1). app/weather-effects.ts fires it during thunderstorms
  flash(strength = 1): void {
    this.flashStart = performance.now();
    this.flashStrength = strength;
    this.flashFlicker = 0.18 + Math.random() * 0.12;
  }

  updateFlash(): void {
    const t = (performance.now() - this.flashStart) / 1000;
    const on = t < 0.08 || Math.abs(t - this.flashFlicker) < 0.05 ? 1 : 0.35;
    const f = t > 0.9 ? 0 : this.flashStrength * Math.exp(-t * 4) * on;
    this.hemiLight.intensity = (this.baseHemi ?? this.hemiLight.intensity) + 4 * f;
    if (this.baseSkyExposure !== undefined) this.uSkyExposure.value = this.baseSkyExposure * (1 + 3 * f);
    if (!f) this.flashStart = 0;
  }
}

export { LightingSystem };
