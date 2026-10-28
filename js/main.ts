// js/main.ts
// The entry point: Tepic, Nayarit in three.js WebGPURenderer & TSL (three.js dev, see index.html). It installs the
// game one feature at a time (app/install/), each taking the parts installed before it and adding its own (app/game.ts
// says what they tell each other on the bus), then runs the frame loop (app/frame-loop.ts), which steps them all in
// the order written down there.
import { t } from './i18n/i18n.ts';
import { CITY } from './world/city-config.ts';
import { buildCity } from './app/city.ts';
import { boot } from './app/install/boot.ts';
import { installPlayer } from './app/install/player.ts';
import { installAudio } from './app/install/audio.ts';
import { installCrime } from './app/install/crime.ts';
import { installCityLife } from './app/install/city-life.ts';
import { installRendering } from './app/install/rendering.ts';
import { installControls } from './app/install/controls.ts';
import { installMultiplayer } from './app/install/multiplayer.ts';
import { installSky } from './app/install/sky.ts';
import { startFrameLoop } from './app/frame-loop.ts';

async function initApp(): Promise<void> {
  // 1. The renderer, the scene's sky & sun, the loading screen, the HUD and the bus
  const started = await boot();
  const { loading, params, scene } = started;

  // 2. The city: streets, hills, landmarks, blocks, street details & traffic (app/city.ts)
  loading.status('loading.city', { city: CITY.city || t('loading.cityFallback') });
  const city = buildCity(scene, { stream: params.get('stream') !== '0', mark: (label) => { loading.mark(label); } });
  const withCity = { ...started, city };

  // 3. The player, its cameras and the car's physics; the sound; the crime; the city's life round the player
  const withPlayer = { ...withCity, ...(await installPlayer(withCity)) };
  const withAudio = { ...withPlayer, ...installAudio(withPlayer) };
  const withCrime = { ...withAudio, ...installCrime(withAudio) };
  const withLife = { ...withCrime, ...installCityLife(withCrime) };

  // 4. With everything in the scene: its culling and the render pipeline (scene pass, SSR, bloom & the colour grade)
  const withRendering = { ...withLife, ...installRendering(withLife) };

  // 5. The controls, the map & the menu; multiplayer (?multiplayer=1); the sky
  const withControls = { ...withRendering, ...installControls(withRendering) };
  const game = { ...withControls, ...(await installMultiplayer(withControls)) };
  installSky(game);
  loading.mark('ui');

  // 6. The frame loop
  await startFrameLoop(game);
}

void initApp();
