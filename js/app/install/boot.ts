// js/app/install/boot.ts
// The game's start: the URL's switches, the loading screen, the WebGPURenderer, the scene with its sky & sun, the rain,
// the HUD's text and the event bus every part installed after it reports to. Jolt's WASM starts downloading here, to
// compile while the city is built.
import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { translatePage } from '../../i18n/i18n.ts';
import { ROADS, CITY_LANDMARKS } from '../../world/city-config.ts';
import { TOUCH_SCREEN } from '../../input/touch-controls.ts';
import { LightingSystem } from '../../render/lighting.ts';
import { RoadWater } from '../../world/weather.ts';
import { createRain } from '../../render/rain.ts';
import { EventBus } from '../../core/events.ts';
import { LoadingScreen } from '../loading.ts';
import { pickQuality } from '../quality.ts';
import { Hud } from '../hud.ts';
import type { GameEvents } from '../game.ts';

export type Boot = Awaited<ReturnType<typeof boot>>;

export async function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  // ?debug: node creation stack traces for shader build errors
  if (debug) THREE.Node.captureStackTrace = true;
  const container = document.getElementById('canvas-container');
  if (!container) throw new Error('The page has no #canvas-container');
  translatePage(document); // (the page's static text, in the player's language)
  const loading = new LoadingScreen();
  // The graphics tier: 'low' on a touch screen (the same the touch controls show on), or as ?quality=low|high asks
  // (app/quality.ts)
  const quality = pickQuality(params.get('quality'), window.matchMedia(TOUCH_SCREEN).matches);
  loading.status('loading.renderer', { revision: THREE.REVISION });

  // 1. The WebGPURenderer, with a 32-bit float reversed depth buffer
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true
  });
  renderer.setPixelRatio(1.0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);

  // The player's car is a rigid body on sprung wheels in Jolt Physics (player/car-physics.ts): its WASM downloads and
  // compiles while the city is built
  const joltReady = import('jolt-physics').then(({ default: initJolt }) => initJolt());
  joltReady.catch(() => { /* (awaited by install/player.ts, once the controllers are up) */ });

  await renderer.init();
  loading.mark('renderer');

  // 2. The scene: the physical sky, PMREM IBL and the 4096² shadow cascades (render/lighting.ts)
  const scene = new THREE.Scene();
  const lighting = new LightingSystem(scene, renderer, quality.shadowMapSize);
  // Rain falling round the camera, and the water it leaves on the roads (Live weather only: the fixed times of day
  // stay dry)
  const rain = createRain(scene, lighting.uNightFactor);
  const roadWater = new RoadWater();
  loading.mark('lighting');

  const hud = new Hud(ROADS.map((r) => r.name), CITY_LANDMARKS.map((l) => l.name));
  // What the game's systems tell each other (core/events.ts): crashes, someone come to rest, a line down...
  const events = new EventBus<GameEvents>();
  return { params, debug, loading, quality, renderer, joltReady, scene, lighting, rain, roadWater, hud, events };
}
