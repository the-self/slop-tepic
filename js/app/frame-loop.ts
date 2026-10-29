// js/app/frame-loop.ts
// The game running: the streamed tiles, the player's body and the shaders made ready under the loading screen, then
// every system stepped once a frame through the Scheduler (core/scheduler.ts), in the order written down here. Also
// the HUD's telemetry, the saved player, the lights the clustered lighting takes and the first frame's clean-up.
import * as THREE from 'three/webgpu';
import { getLocationLabel, CITY } from '../world/city-config.ts';
import { groundHeight } from '../world/ground.ts';
import { updateSceneCulling, updateDynamicMatrices, releaseStaticArrays } from '../render/scene-culling.ts';
import { cityUniforms } from '../render/tsl-materials.ts';
import { grassDryness } from '../world/lot-greenery.ts';
import { gearLabel } from '../player/drivetrain.ts';
import { FUEL_TANK, PLAYER_BODY } from '../player/controllers/constants.ts';
import { loadPersonBody } from '../actors/person-body.ts';
import { Tachometer } from '../ui/tachometer.ts';
import { Scheduler } from '../core/scheduler.ts';
import type { FrameStep } from '../core/scheduler.ts';
import { precompileShaders, warmUpFrame } from './shaders.ts';
import { savePlayer } from './player-state.ts';
import { WeatherEffects } from './weather-effects.ts';
import type { AmbientSource } from '../audio/audio-ambience.ts';
import type { Game } from './game.ts';

const PERSON_WAIT = 8000; // ms the loading screen waits for the player's body (3 MB) before the shaders compile

export async function startFrameLoop(game: Game): Promise<void> {
  const {
    debug, quality, loading, renderer, scene, lighting, rain, roadWater, hud, city, controllers, stateKey, blood, stamina, cameras, aim,
    audio, crime, crimeHud, weaponWheel, weaponIcons, venues, streetFood, floods, nightlife, rooms, emergency, fires, gasStations, forumLife, centralLife,
    render, gamepad, boarding, map, net, remoteCars
  } = game;
  const { streamer, cityBlocks, stores, carParks, central, deliveries, streetDetails, powerLines, traffic, highwayTraffic } = city;

  // The saved player: every 5 s in play (the 'hud' system below), and on leaving the page or hiding it
  const save = () => { savePlayer(controllers, stateKey, crime.money, rooms.inside?.venue ?? null); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // The streamed tiles round the player, laid before the first frame; and a stand-in of every streamed layer for the
  // shader warm-up, so no tile builds pipelines in play when its layer first comes in (taken out after the first frame)
  let streamWarmup: THREE.Group | null = null;
  let warmupMeshes: THREE.Mesh[] = [];
  if (streamer) {
    loading.status('loading.tiles');
    const here = controllers.getActiveEntity().position;
    await streamer.preload(here.x, here.z);
    streamWarmup = new THREE.Group();
    warmupMeshes = streamer.warmupMeshes();
    streamWarmup.add(...warmupMeshes);
    scene.add(streamWarmup);
    loading.mark(`tiles ${streamer.stats.shown}`);
  }

  // The player's body (actors/person-body.ts) in before the shaders compile, so its pipelines are among them
  // rather than built in play the frame it comes in; a slow connection waits PERSON_WAIT at most (it then comes in late)
  loading.status('loading.player');
  await Promise.race([loadPersonBody(PLAYER_BODY).catch(() => null), new Promise((resolve) => setTimeout(resolve, PERSON_WAIT))]);
  loading.mark('person');

  // The loading screen stays up while the shaders compile and until the first frame is on screen
  loading.status('loading.shaders');
  await precompileShaders(renderer, scene, cameras.camera, render, (done) => {
    loading.progress(done);
  }, () => { loading.mark('postFX'); });
  loading.mark('compile');

  // The frame loop. Each system steps once a frame, in this order: input & the player first (what everything else
  // follows), then the cameras, the world's clock & the traffic (and the props it knocks down), the CFE's lines down,
  // the crime, the city's life and the emergency services
  // (the fires there call the bomberos), the HUD, the city's
  // level of detail round the camera, the weather, the network, the map & the audio, and the streamed tiles.
  const weather = new WeatherEffects({
    lighting, roadWater, rain, floods, controllers, cameras,
    traffic, crime, audio, interiors: rooms, bearingDeg: CITY.bearingDeg || 0,
    sheltered: (x, y, z) => city.forum.covers(x, y, z)
  });
  const tachometer = new Tachometer(document.getElementById('hud-tacho'));
  const ambience: AmbientSource[] = [];
  let weekday = new Date().getDay();
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below
  // a vehicle standing within r m of (x, z): the player's left standing, another player's (no tráiler pulls in on it)
  const vehicleNear = (x: number, z: number, r: number) =>
    controllers.parkedVehicles().some((v) => Math.hypot(v.x - x, v.z - z) < r) ||
    crime.remotes.some((o) => !o.person && Math.hypot(o.x - x, o.z - z) < r);
  // the Central's gates rise for any vehicle at them; its coaches stop for one in their way, or for the player on foot
  const centralVehicleAt = (x: number, z: number, r: number) => traffic.vehicleAt(x, z, r);
  const centralBlocked = (x: number, z: number, r: number) => {
    if (traffic.vehicleAt(x, z, r)) return true;
    const p = controllers.getActiveEntity().position;
    return controllers.activeMode === 'person' && Math.hypot(p.x - x, p.z - z) < r + 0.6;
  };
  // ...and its doors open for its travellers coming through them (sim/central.ts), as for the player
  const centralSomeoneAt = (x: number, z: number, r: number) => centralLife.someoneAt(x, z, r);
  const scheduler = new Scheduler({ profile: debug })
    .run('gamepad', ({ dt }) => { gamepad.update(dt); })
    .run('player', ({ frameDt, elapsed }) => {
      // out of breath, no sprinting
      controllers.canSprint = stamina.canSprint;
      // on foot WASD go the way the camera looks (cameras.ts)
      controllers.viewHeading = cameras.viewHeading();
      // the player keeps real time down to 10 fps, in steps of at most 1/30 s: a slow frame mustn't stretch a car's
      // 0-100 km/h or slow its speed over the ground
      const playerSteps = Math.ceil(frameDt * 30 - 1e-6);
      for (let i = 0; i < playerSteps; i++) controllers.update(frameDt / playerSteps, elapsed);
      // the car's or moto's tachometer follows the engine every frame (the rest of the HUD every 250 ms, below)
      const mode = controllers.activeMode;
      if (mode === 'car' || mode === 'moto') {
        const v = controllers.entities[mode];
        const engine = 'damage' in v ? 1 - v.damage.engine : 1; // (a moto has no engine damage)
        const fuel = 'fuel' in v ? v.fuel / FUEL_TANK : 1; // (a moto runs on air)
        tachometer.update(v.spec, v.drive, Math.round(Math.abs(v.speed) * 3.6), engine, engine <= 0 || fuel <= 0, v.drive ? gearLabel(v.drive, v.spec) : '1', fuel);
      }
    })
    .run('aim', ({ dt }) => {
      // (aiming only on foot and in play, not while choosing a weapon)
      aim.allowed = crime.state === 'play' && !weaponWheel.isOpen;
      aim.update(dt);
    })
    // riding in a friend's car (multiplayer): the ride where the car is, before the cameras follow it
    .run('passenger', () => { net.current?.seat(); })
    .run('cameras', ({ dt, elapsed }) => {
      cameras.update(dt, elapsed);
      streetDetails.signalClock.value = elapsed;
      cityUniforms.uClock.value = elapsed;
    })
    .run('traffic', ({ dt, elapsed }) => {
      // the hour sets how much traffic and how many people are out (sim/traffic-demand.ts): rush hours on the avenues
      traffic.setHour(lighting.hourOfDay);
      // (and the coaches out round the Central's block: world/central.ts)
      traffic.setParked(central.addObstacles(crime.addObstacles(controllers.parkedVehicles())));
      const entity = controllers.getActiveEntity();
      traffic.update(dt, elapsed, cameras.currentPos, entity, controllers.activeMode, cameras.camera);
      highwayTraffic.update(dt, cameras.camera, entity, controllers.activeMode);
      // lamp posts, sign posts, hydrants & bins, CFE poles & trees the player's vehicle runs into (sim/mayhem.ts)
      streetDetails.breaker.update(dt, entity, controllers.activeMode);
    })
    // the CFE's lines: those down arcing, the runs without power going dark (world/cfe-network.ts)
    .run('power', ({ dt }) => {
      streetDetails.cfe.update(dt, cameras.camera, controllers.getActiveEntity().position, controllers.activeMode === 'person');
    })
    .run('crime', ({ dt, elapsed }) => {
      // gunfire, the police, gangs & thieves, and a blast's shake of the camera
      crime.update(dt, elapsed, cameras.camera);
      blood.update(dt);
    })
    .run('city life', ({ dt }) => {
      streetFood.update(dt, lighting.hourOfDay, cameras.camera);
      nightlife.update(dt, lighting.hourOfDay, weekday, cameras.camera);
      rooms.update(dt, lighting.hourOfDay);
      forumLife.update(dt, cameras.camera, controllers.getActiveEntity(), controllers.activeMode); // (Forum Tepic)
      centralLife.update(dt, cameras.camera); // (the Central de Autobuses' travellers)
      if (!rooms.active) fires.update(dt, cityUniforms.uDryness.value, cameras.camera);
      // the sounds that stay put (audio/audio-ambience.ts): the planchas, the antros' & parties' music, the fires
      ambience.length = 0;
      streetFood.sounds(ambience);
      nightlife.sounds(ambience);
      rooms.sounds(ambience);
      fires.sounds(ambience);
      audio.setAmbience(ambience);
      crime.shakeCamera(cameras.camera);
    })
    // the bomberos & ambulances on their way, at work, going back (sim/emergency.ts)
    .run('emergency', ({ dt }) => { emergency.update(dt, cameras.camera); })
    // pumps going up, the car filling up (sim/gas-stations.ts)
    .run('gas stations', ({ dt }) => { gasStations.update(dt); })
    .run('hud', ({ dt, now }) => {
      stamina.update(dt, crime.state === 'play' ? controllers.sprintingMode() : null);
      crimeHud.update(crime, dt, stamina);
      weaponWheel.update();
      if (!document.hidden && now >= nextPlayerSave) {
        save();
        nextPlayerSave = now + 5000;
      }
    })
    // the Central de Autobuses: its doors opening for the player, its gates' arms rising for the vehicles that come
    // (the traffic's bodies, gathered above), the coaches coming and going round its block (world/central.ts)
    .run('central', ({ dt }) => {
      const eye = cameras.currentPos, at = controllers.getActiveEntity().position;
      central.update(dt, eye.x, eye.z, at.x, at.z, centralVehicleAt, centralBlocked, centralSomeoneAt);
    })
    .run('city detail', () => {
      const eye = cameras.currentPos;
      cityBlocks.update(eye.x, eye.z);
      stores.update(eye.x, eye.z);
      carParks.update(eye.x, eye.z);
      // the tráilers at the supermarkets' docks in the small hours (world/delivery-trucks.ts)
      deliveries.update(lighting.hourOfDay, eye.x, eye.z, vehicleNear);
      // (no parked car where another vehicle stands: the player's left standing, the other players')
      for (const v of controllers.parkedVehicles()) carParks.clearAt(v.x, v.z);
      for (const r of crime.remotes) if (!r.person) carParks.clearAt(r.x, r.z);
      cityBlocks.updateLights(cameras.camera);
      streetDetails.update(cameras.camera);
      powerLines.update(cameras.camera.position);
      lighting.update(eye);
    })
    .add(weather)
    .run('multiplayer', ({ dt, elapsed }) => { net.current?.update(dt, elapsed); })
    .run('map', () => { map.update(); })
    .run('audio', ({ dt, elapsed }) => { audio.update(dt, elapsed, cameras.camera, lighting.isNight); })
    .run('culling', () => { if (warmedUp) updateSceneCulling(cameras.camera.position); }) // (the warm-up frame draws every chunk)
    .run('streaming', ({ rawDt }) => {
      if (!streamer) return;
      // (in a room the camera is in its pocket high over the map: the tiles stay laid round the door)
      const door = rooms.inside?.venue;
      const eye = cameras.camera.position;
      if (door) streamer.update(door, 0, Math.max(0, rawDt));
      else streamer.update(eye, eye.y - groundHeight(eye.x, eye.z), Math.max(0, rawDt));
    });
  if (debug) {
    // Debugging handle for the console, only with ?debug in the URL
    Object.assign(window, { __slop: {
      scene, renderer, streamer, streetFood, venues, forum: forumLife, floods, nightlife, interiors: rooms, fires, emergency, gasStations, controllerManager: controllers,
      deliveries,
      trafficSystem: traffic, cameraSystem: cameras, streetDetails, cityGrid: city.cityGrid, cityBlocks, mapSystem: map, audioSystem: audio,
      crimeSystem: crime, stamina, aimControl: aim, weaponWheel, weaponIcons, scheduler, boarding, quality, multiplayer: () => net.current
    } });
  }

  // The clustered lighting takes the first 256 point & spot lights it finds: those switched off (intensity 0: the
  // traffic's by day, the pools waiting) are hidden, so they don't take the places of the ones on. (Gathered again
  // every couple of seconds: lights come & go with the city's systems, multiplayer's among them.)
  const sceneLights: (THREE.PointLight | THREE.SpotLight)[] = [];
  let lightsCounted = -1;
  const gatherLights = () => {
    sceneLights.length = 0;
    scene.traverse((o) => { if (o instanceof THREE.PointLight || o instanceof THREE.SpotLight) sceneLights.push(o); });
  };
  const step: FrameStep = { dt: 0, frameDt: 0, rawDt: 0, elapsed: 0, now: 0 };
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let nextRelease = Infinity; // (releaseStaticArrays: from when the first frame is on the GPU)

  void renderer.setAnimationLoop((now) => {
    const rawDt = (now - lastTime) * 0.001;
    lastTime = now;
    // The world steps at most 0.05 s a frame (below 20 fps it runs slow rather than unstably). The player keeps real
    // time down to 10 fps, in steps of at most 1/30 s
    step.rawDt = rawDt;
    step.frameDt = Math.min(Math.max(rawDt, 0.001), 0.1) * weaponWheel.timeScale;
    step.dt = Math.min(step.frameDt, 0.05 * weaponWheel.timeScale);
    step.elapsed += step.dt;
    step.now = now;
    scheduler.step(step);

    if (step.elapsed - lightsCounted > 2) {
      gatherLights();
      lightsCounted = step.elapsed;
    }
    // The parts of the static city drawn for the first time since: their CPU-side copies go too (render/scene-culling.ts)
    if (now >= nextRelease) {
      releaseStaticArrays(renderer);
      nextRelease = now + 3000;
    }
    for (const l of sceneLights) {
      if (l.intensity <= 0 && l.visible) {
        l.visible = false;
        l.userData.switchedOff = true;
      } else if (l.intensity > 0 && l.userData.switchedOff) {
        l.visible = true;
        l.userData.switchedOff = false;
      }
    }
    updateDynamicMatrices(scene);

    // Render frame via the TSL RenderPipeline (SSR + Bloom); the first one also warms up what the precompile missed
    if (!warmedUp) {
      warmUpFrame(scene, render.pipeline);
      loading.mark('warmup');
    }
    render.pipeline.render();
    if (!warmedUp) {
      warmedUp = true;
      loading.mark('firstFrame');
      onFirstFrame();
    }

    // Telemetry uses wall time, not the clamped simulation step, so slow frames and high-refresh displays report
    // their actual frame rate (updates DOM every 250ms).
    frameCount++;
    fpsTimer += Math.max(0, rawDt);
    if (fpsTimer >= 0.25) {
      const fps = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;
      const entity = controllers.getActiveEntity();
      const kmh = Math.round(Math.abs(entity.speed) * 3.6);
      // over the town's floor (its slopes put the streets well over y = 0)
      const altM = entity.position.y - controllers.floorHeight(entity.position.x, entity.position.z);
      hud.showTelemetry({
        fps, mode: controllers.activeMode, kmh, altitudeFt: Math.max(0, Math.round(altM * 3.281)),
        boosting: Boolean(controllers.keys.boost)
      });
      // the grass greens in the rains & browns in the dry season (world/lot-greenery.ts), by the month shown
      cityUniforms.uDryness.value = grassDryness(lighting.liveClock().getMonth());
      cityUniforms.uHour.value = lighting.hourOfDay; // (the lit rooms & the shops' shutters)
      weekday = lighting.liveClock().getDay(); // (the weekend's parties)
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameras.getActivePreset().category === 'follow' ? entity.position : cameras.currentPos;
      hud.showLocation(getLocationLabel(where.x, where.z));
      // (stopped by a gas station's pump: G fills up, sim/gas-stations.ts; the touch button does too)
      const text = boarding.prompt(), pump = gasStations.prompt();
      hud.showPrompt(pump || text, pump ? 'use' : boarding.promptAction, pump ? 'refuel' : 'board');
    }
  });

  // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
  // compiled), i.e. until the city is actually on screen
  function onFirstFrame() {
    const backend = renderer.backend;
    const device = 'device' in backend && backend.device instanceof GPUDevice ? backend.device : undefined;
    Promise.resolve(device?.queue.onSubmittedWorkDone()).catch(() => { /* the city shows anyway */ }).then(() => {
      loading.mark('gpu');
      // (the remote cars' pipelines are built: the car drawn out of sight for them goes)
      remoteCars?.clear();
      // What the warm-up drew of the static city is on the GPU now: its CPU-side copies go, and the rest's as it gets
      // drawn (in the loop)
      if (streamWarmup) {
        scene.remove(streamWarmup);
        for (const mesh of warmupMeshes) mesh.geometry.dispose();
      }
      const released = releaseStaticArrays(renderer);
      loading.mark(`release ${Math.round(released / 1e6)}MB`);
      nextRelease = performance.now() + 3000;
      loading.done();
      audio.ready = true;
      loading.progress(1);
      // (the weapon pictures, off screen, once the first frames are through)
      setTimeout(() => { void weaponIcons.bake(); }, 400);
    }).catch((err: unknown) => { console.error(err); });
  }
}
