// js/main.ts
// The entry point: Tepic, Nayarit in three.js WebGPURenderer & TSL (three.js dev, see index.html). It builds the scene
// and the city (app/city.ts), creates the player, the crime, the audio and the HUD and wires them to each other, then
// steps them every frame through the Scheduler (core/scheduler.ts) in the order written down at "The frame loop" below.
import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { cycleLocale, onLocaleChange, t, tName, translatePage, setText } from './i18n/i18n.ts';
import { CITY, getLocationLabel, isTypingInField, ROADS, CITY_LANDMARKS, TELEPORT_LOCATIONS, HOSPITALS } from './world/city-config.ts';
import { ThirdPersonControllerManager } from './player/controllers.ts';
import { Stamina, struckDamage, hardness, crashDamage, walletAmount, nearest, CRASH_GRACE } from './player/stats.ts';
import { TouchControls, TOUCH_SCREEN } from './input/touch-controls.ts';
import { keyBindings, keyLabel, isBindAction } from './input/keybindings.ts';
import { KeyConfig } from './ui/key-config.ts';
import { GamepadControls } from './input/gamepad-controls.ts';
import { CameraSystem, CAMERA_PRESETS } from './player/cameras.ts';
import { LightingSystem } from './render/lighting.ts';
import { WEATHER_SAMPLES, weatherLabel, RoadWater } from './world/weather.ts';
import { createRain } from './render/rain.ts';
import { CityMapSystem } from './ui/city-map.ts';
import { Tachometer } from './ui/tachometer.ts';
import { gearLabel } from './player/drivetrain.ts';
import { setupSceneCulling, updateSceneCulling, freezeStaticMatrices, updateDynamicMatrices, releaseStaticArrays } from './render/scene-culling.ts';
import { CityAudioSystem } from './audio/audio-system.ts';
import { groundHeight, gradeHeight, townHeight, landHeight, deckLift, walkDeckLift, surfaceHeight } from './world/ground.ts';
import { CrimeSystem } from './sim/crime.ts';
import { CrimeHud } from './ui/crime-hud.ts';
import { WeaponWheel } from './ui/weapon-wheel.ts';
import { WeaponIcons } from './ui/weapon-icons.ts';
import { AimControl } from './player/aim.ts';
import { createCarPhysics } from './player/car-physics.ts';
import { createRagdolls } from './sim/ragdolls.ts';
import type { RagdollHandle } from './sim/ragdolls.ts';
import type { PowerFault } from './world/cfe-sparks.ts';
import { BloodPools } from './sim/blood.ts';
import { cityUniforms } from './render/tsl-materials.ts';
import { grassDryness } from './world/lot-greenery.ts';
import { GEO } from './world/city-geodata.js';
import { findVenues } from './world/venues.ts';
import { StreetFood } from './world/street-food.ts';
import { Floods } from './world/floods.ts';
import { Nightlife } from './world/nightlife.ts';
import { Interiors } from './world/interiors.ts';
import { Fires } from './sim/fires.ts';
import { EmergencyServices } from './sim/emergency.ts';
import { GasStations } from './sim/gas-stations.ts';
import { FUEL_TANK } from './player/controllers/constants.ts';
import { Scheduler } from './core/scheduler.ts';
import type { FrameStep } from './core/scheduler.ts';
import { EventBus } from './core/events.ts';
import { LoadingScreen } from './app/loading.ts';
import { buildCity } from './app/city.ts';
import { playerStateKey, restorePlayer, savePlayer } from './app/player-state.ts';
import { createRenderPipeline } from './app/render-pipeline.ts';
import { pickQuality } from './app/quality.ts';
import { precompileShaders, warmUpFrame } from './app/shaders.ts';
import { loadPersonBody } from './actors/person-body.ts';
import { PLAYER_BODY } from './player/controllers/constants.ts';
import { Hud } from './app/hud.ts';
import { GameMenu } from './app/menu.ts';
import { createTeleport, wireTeleportButtons } from './app/teleport.ts';
import { Boarding } from './app/boarding.ts';
import { WeatherEffects } from './app/weather-effects.ts';
import type { CollisionImpact } from './audio/audio-sources.ts';
import type { AmbientSource } from './audio/audio-ambience.ts';
import type { Multiplayer } from './net/multiplayer.ts';
import type { WeatherSampleName } from './world/weather.ts';
import { SKY_TIMES, SKY_WEATHERS } from '../shared/protocol.ts';
import type { SkyTime, SkyWeather } from '../shared/protocol.ts';
import type { CameraPresetId } from './player/cameras.ts';

/** What the game's systems tell each other without importing each other (core/events.ts) */
interface GameEvents {
  /** a crash of the player, the traffic or a street prop (each system's collision report); `kind` what struck:
   *  'vehicle', 'prop', a building's... (player/stats.ts hardness) */
  collision: CollisionImpact & { kind: string };
  /** someone thrown, shot or knocked down come to rest (sim/ragdolls.ts onSettle): blood under them, an ambulance */
  settle: RagdollHandle;
  /** a CFE line down (world/cfe-network.ts): an arc's crackle, a transformer's bang, a shock to the player */
  power: PowerFault;
}
const HARD_CRASH = 9; // m/s (~32 km/h) a crash is struck at for an ambulance to be called
const SHOCK_DAMAGE = 22; // health a fallen line's shock takes at its worst (a few and you are down)

const isWeatherSample = (name: string | null): name is WeatherSampleName => name !== null && name in WEATHER_SAMPLES;
// (SKY_TIMES & SKY_WEATHERS widened to plain strings, to check a stored or clicked name against them)
const SKY_TIME_NAMES: readonly string[] = SKY_TIMES;
const SKY_WEATHER_NAMES: readonly string[] = SKY_WEATHERS;
const isSkyTime = (name: string | null): name is SkyTime => name !== null && SKY_TIME_NAMES.includes(name);
const isSkyWeather = (name: string | null): name is SkyWeather => name !== null && SKY_WEATHER_NAMES.includes(name);
const PERSON_WAIT = 8000; // ms the loading screen waits for the player's body (3 MB) before the shaders compile

async function initApp(): Promise<void> {
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
  joltReady.catch(() => { /* (awaited below, once the controllers are up) */ });

  await renderer.init();
  loading.mark('renderer');

  // 2. The scene: the physical sky, PMREM IBL and the 4096² shadow cascades (render/lighting.ts)
  const scene = new THREE.Scene();
  const lightingSystem = new LightingSystem(scene, renderer, quality.shadowMapSize);
  // Rain falling round the camera, and the water it leaves on the roads (Live weather only: the fixed times of day
  // stay dry)
  const rain = createRain(scene, lightingSystem.uNightFactor);
  const roadWater = new RoadWater();
  loading.mark('lighting');

  // 3. The city: streets, hills, landmarks, blocks, street details & traffic
  loading.status('loading.city', { city: CITY.city || t('loading.cityFallback') });
  const city = buildCity(scene, { stream: params.get('stream') !== '0', mark: (label) => { loading.mark(label); } });
  const { streamer, rivers, cityBlocks, stores, carParks, streetDetails, powerLines, traffic: trafficSystem, highwayTraffic, colliders } = city;

  // 4. The player (on foot, car, bicycle, moto, helicopter), its cameras and its input
  const controllerManager = new ThirdPersonControllerManager(scene, colliders);
  // The ground (world/ground.ts): the town's own slopes and the hills over them (the flat city with ?slopes=0)
  controllerManager.setTerrain(groundHeight, townHeight, landHeight, deckLift, walkDeckLift); // (and the bridges' decks over it; on foot the footbridges' too)
  controllerManager.setCurbRamps(carParks.rampAt); // (the car parks' driveways, up over the curb)
  trafficSystem.setHillQuery(gradeHeight); // (the roads' lifts are over the ground at grade: down an underpass, < 0)
  trafficSystem.setSurfaceQuery(surfaceHeight);
  // People, bicycles & hydrants knocked flying bounce off the buildings' walls (sim/mayhem.ts)
  const solidAt = (x: number, z: number) => controllerManager.isSolidAt(x, z, 1.5, groundHeight(x, z));
  trafficSystem.setSolidQuery(solidAt);
  // (the walls the sidewalks' walkers turn back at: the buildings', not the poles' they pass by)
  trafficSystem.setWallQuery((x, z) => controllerManager.isSolidAt(x, z, 1.5, groundHeight(x, z), 2));
  // A camión or combi the player takes is built from the traffic's own parts, its route and all
  controllerManager.setLookKits((look) => trafficSystem.lookKit(look));
  // The traffic's damaged engines smoke with the player's car's smoke
  trafficSystem.setSmokeEmitter((x, y, z, vx, vz, count, shade, size) => { controllerManager.puffSmoke(x, y, z, vx, vz, count, shade, size); });
  streetDetails.breaker.setGroundQuery(groundHeight);
  // Saved players return at rest close to where they left. The game always starts on foot: someone who left driving
  // steps out of that vehicle where it was.
  const stateKey = playerStateKey(CITY.city);
  const saved = restorePlayer(controllerManager, stateKey);
  controllerManager.setMode('person');
  controllerManager.landHelicopter(true);
  if (saved.mode === 'car' || saved.mode === 'cyclist' || saved.mode === 'moto') {
    controllerManager.setMode(saved.mode);
    controllerManager.exitVehicle();
  }
  let physics;
  try {
    physics = createCarPhysics(await joltReady, {
      // what the car stands on: the ground at its level (a bridge's deck it is on), the sidewalks over the street
      groundAt: (x, z, fromY) => controllerManager.getGroundHeight(x, z, 'person', fromY),
      collidersNear: (x, z, r) => controllerManager.nearColliders(x, z, r)
    });
    controllerManager.setCarPhysics(physics);
  } catch (err) {
    loading.status('loading.physicsFailed');
    throw err;
  }
  // Who is hit, shot or thrown falls as a body (sim/ragdolls.ts), in the car's world; a pool of blood spreads under
  // whoever was hit hard as they come to rest (sim/blood.ts)
  const ragdolls = createRagdolls(physics);
  // ...and the street furniture vehicles knock loose (sim/mayhem.ts)
  streetDetails.breaker.setPhysics(physics);
  controllerManager.ragdolls = ragdolls;
  trafficSystem.setRagdolls(ragdolls);
  // ...and the traffic's cars thrown about in a crash near the player (sim/traffic.ts crash)
  trafficSystem.setPhysics(physics);
  const bloodPools = new BloodPools(scene, (x, z, fromY) => controllerManager.getGroundHeight(x, z, 'person', fromY));
  // What the game's systems tell each other (core/events.ts): crashes, someone come to rest
  const events = new EventBus<GameEvents>();
  ragdolls.onSettle = (h) => { events.emit('settle', h); };
  events.on('settle', (h) => {
    if (!(h.bleed > 0.05)) return;
    bloodPools.add(h.px, h.pz, h.py + 0.3, 0.9 + h.bleed * 1.7);
    // ...and smeared along the ground from where they came down onto it (not through the air) to where they lie
    bloodPools.trail(h.x0, h.z0, h.px, h.pz, h.py + 0.3, h.bleed);
  });
  loading.mark('physics');
  // Sprinting runs out of breath (player/stats.ts)
  const stamina = new Stamina();

  const cameraSystem = new CameraSystem(renderer.domElement, controllerManager);
  // Free aim on foot: the right button (or Z) brings the camera over the shoulder with a crosshair (player/aim.ts)
  const aimControl = new AimControl({ canvas: renderer.domElement, controllers: controllerManager });
  cameraSystem.aim = aimControl;
  cameraSystem.setGroundQuery(groundHeight); // the chase cameras stay over the ground
  // ...and in front of the walls between them and the player (what is under 1 m across, a pole, left out)
  cameraSystem.setObstacleQuery((x, y, z) => controllerManager.isSolidAt(x, z, 0, y, 1));
  // The scenic cameras frame the city's own spots (see cameras.ts)
  const T = TELEPORT_LOCATIONS;
  cameraSystem.setScenicAnchors({
    fifthAve: T.plaza, timesSquare: T.alameda, chryslerGCT: T.uan, centralPark: T.loma, bryantPark: T.mercado,
    waterfront: T.estacion, observatory: T.plaza, drone: T.plaza
  });
  const touchControls = new TouchControls(controllerManager);
  const hud = new Hud(ROADS.map((r) => r.name), CITY_LANDMARKS.map((l) => l.name));
  const audioSystem = new CityAudioSystem({ controllerManager, trafficSystem, highwayTraffic, streetDetails, propBreaker: streetDetails.breaker }, {
    onStateChange: () => { hud.showSound(audioSystem); }
  });
  document.getElementById('btn-sound')?.addEventListener('click', () => { audioSystem.setEnabled(!audioSystem.enabled); });
  hud.showSound(audioSystem);

  // Guns, the police, gangs & thieves (sim/crime.ts); killed, the player comes round at the nearest hospital
  // (OpenStreetMap's, HOSPITALS), arrested at the nearest teleport spot, on foot either way
  const crimeSystem = new CrimeSystem({
    scene, controllers: controllerManager, traffic: trafficSystem, groundHeight, solidAt, canvas: renderer.domElement,
    audio: audioSystem, aim: aimControl,
    onRespawn: (kind) => {
      if (controllerManager.activeMode === 'helicopter') {
        controllerManager.setMode('person');
        controllerManager.landHelicopter();
      } else if (controllerManager.activeMode !== 'person') {
        controllerManager.exitVehicle();
      }
      const p = controllerManager.entities.person.position;
      // (a hospital has no heading: the teleport's default faces the player south)
      const spot: { x: number; z: number; name: string; heading?: number } | null =
        (kind === 'wasted' ? nearest(HOSPITALS, p.x, p.z) : null) ?? nearest(Object.values(TELEPORT_LOCATIONS), p.x, p.z);
      if (spot) teleportTo(spot.x, spot.z, spot.heading);
      if (kind === 'wasted' && spot?.name) crimeSystem.toast(spot.name);
      stamina.reset();
      syncMode();
    }
  });
  if (saved.money !== undefined && Number.isFinite(saved.money)) crimeSystem.money = Math.max(0, Math.round(saved.money));
  // The city's eating & drinking places, off the real shop signs (world/venues.ts), and the night's street food stands
  // in front of them and at the parks (world/street-food.ts)
  const venues = findVenues(GEO.houses, GEO.signs, GEO.houseStride || 8);
  const streetFood = new StreetFood({ scene, venues, pois: GEO.pois, controllers: controllerManager, crime: crimeSystem });
  // The Live weather's storms flood the low streets & the Mololoa's banks (world/floods.ts); ?flood=<0..1> to preview
  const floodParam = Number.parseFloat(params.get('flood') ?? '');
  const floods = new Floods({ scene, rivers, hold: Number.isFinite(floodParam) ? floodParam : null });
  controllerManager.waterAt = (x, z) => floods.depthAt(x, z);
  // The bars & antros open at night and the colonias' weekend parties (world/nightlife.ts)
  const nightlife = new Nightlife({ scene, venues, houses: GEO.houses, stride: GEO.houseStride || 8, controllers: controllerManager, audio: audioSystem });
  // In through their doors (F): the restaurants', bars' and antros' rooms, the Tapanko's tapanco and all
  const rooms = new Interiors({ scene, venues, controllers: controllerManager, cameras: cameraSystem, crime: crimeSystem });
  // The bomberos' trucks & the Cruz Roja's ambulances, sent from their real stations (sim/emergency.ts): in the patrol
  // cars' pool, so before the audio takes that for its sirens
  const emergency = new EmergencyServices({ scene, crime: crimeSystem, ground: (x, z) => controllerManager.getGroundHeight(x, z, 'person') });
  trafficSystem.setSirens(emergency.sirens); // (the cars ahead of them pull over)
  // Burning wrecks, house fires, the dry season's quemas, and the bomberos who come for them (sim/fires.ts)
  const fires = new Fires({ scene, crime: crimeSystem, services: emergency, controllers: controllerManager, houses: GEO.houses, stride: GEO.houseStride || 8 });
  // Tepic's gas stations (sim/gas-stations.ts): the car fills up stopped by a pump; a pump shot, rammed or caught in a
  // blast goes up
  const gasStations = new GasStations({
    scene, crime: crimeSystem, car: controllerManager.entities.car,
    isSolidAt: (x, z, height, ground) => controllerManager.isSolidAt(x, z, height, ground),
    groundAt: (x, z) => controllerManager.getGroundHeight(x, z, 'person'),
    active: () => controllerManager.getActiveEntity(), activeMode: () => controllerManager.activeMode,
    addColliders: (list) => { controllerManager.addColliders(list); },
    ignite: (kind, x, z, size) => fires.ignite(kind, x, z, size)
  });
  controllerManager.onFuelOut = () => { crimeSystem.toast(t('toast.outOfGas')); };
  crimeSystem.onExplosion = (x, y, z, radius) => {
    fires.onExplosion(x, y, z, radius);
    gasStations.onExplosion(x, y, z, radius);
  };
  // Someone killed or badly hurt (shot dead, thrown hard) come to rest: an ambulance for them. Not for the player
  // (killed on foot or thrown out of a vehicle), who comes round at the hospital or gets up
  events.on('settle', (h) => {
    if (h.bleed >= 0.45 && h !== crimeSystem.playerFall && h !== controllerManager.entities.person.ragdoll) emergency.callAmbulance(h.px, h.pz, h);
  });
  audioSystem.sources.pursuers = [...crimeSystem.cruisers, crimeSystem.heli]; // (the patrol cars & trucks, the helicopter)
  crimeSystem.ragdolls = ragdolls;
  // Thrown out through the windscreen (controllers.ts ejectDriver), or off the moto (ejectRider; stepping off it as it
  // falls over, offMoto, impact 0): on foot now, bleeding; out of the car hurt by how hard it hit (off the moto, the
  // crash itself already hurt, crashDamage)
  controllerManager.onEject = (impact, x, z, kind, bail = false) => {
    syncMode();
    const v = controllerManager.entities[kind];
    // jumped out at speed (boarding.ts leaveVehicle): grazed, not thrown through glass; past ~50 km/h it bleeds
    if (bail) {
      if (impact > 14) crimeSystem.fx.splatter(x, v.position.y + 1, z, impact * 0.5, Math.sin(v.heading), Math.cos(v.heading));
      crimeSystem.hurt(Math.min(60, Math.max(0, impact - 6) * 2.5), x, z);
      return;
    }
    if (impact > 0) crimeSystem.fx.splatter(x, v.position.y + 1, z, impact, Math.sin(v.heading), Math.cos(v.heading));
    if (kind === 'car') crimeSystem.hurt(Math.min(95, 25 + (impact - 19) * 4), x, z);
  };
  const crimeHud = new CrimeHud();
  // The weapon wheel, held open with Tab (ui/weapon-wheel.ts): the game runs slowed meanwhile. On foot the mouse wheel
  // switches weapons (Alt + the wheel, or a pinch, still zooms the camera); in a vehicle it zooms.
  const scrollSwitches = (e: WheelEvent) => !e.altKey && !e.ctrlKey && controllerManager.activeMode === 'person' && crimeSystem.state === 'play';
  const weaponWheel = new WeaponWheel(crimeSystem, { aim: aimControl, canvas: renderer.domElement, canScroll: scrollSwitches });
  cameraSystem.wheelZooms = (e) => !scrollSwitches(e);
  // Its pictures and the HUD's, the arsenal's 3D models in the hand (ui/weapon-icons.ts), baked once the city is up
  const weaponIcons = new WeaponIcons(renderer);
  crimeHud.icons = weaponIcons;
  weaponWheel.setIcons(weaponIcons);

  // Crashes hurt as well as sound: each system reports its crashes to the bus, which the audio and the player's
  // health listen to
  for (const system of [controllerManager, trafficSystem, streetDetails.breaker]) {
    system.setCollisionListener((impact) => { events.emit('collision', impact); });
  }
  // A CFE pole knocked down: its lines arcing in the street, its transformer going up, a shock for who walks into them
  streetDetails.cfe.listener = (e) => { events.emit('power', e); };
  events.on('power', (e) => {
    if (e.type === 'bang') audioSystem.gunfire('explosion', e.x, e.y, e.z);
    else audioSystem.arc(e.x, e.y, e.z, e.strength);
    if (e.type === 'shock') crimeSystem.hurt(SHOCK_DAMAGE * e.strength, e.x, e.z);
  });
  events.on('collision', (impact) => { audioSystem.onCollision(impact); });
  // a hard crash (~32 km/h and up: the player's, or two of the traffic's): an ambulance (sim/emergency.ts)
  events.on('collision', (impact) => { if (impact.speed >= HARD_CRASH) emergency.callAmbulance(impact.x, impact.z); });
  let lastCrash = -Infinity;
  events.on('collision', (impact) => {
    // the car, bicycle, moto or helicopter the player is in, hitting something hard enough (crashDamage)
    const mode = controllerManager.activeMode;
    const me = controllerManager.getActiveEntity();
    if (mode === 'person' || (impact.a !== me && impact.b !== me)) return;
    const damage = crashDamage(mode, impact.speed, hardness(impact.kind, impact.a === me ? impact.b : impact.a), impact.kind);
    const now = performance.now() * 0.001;
    if (damage <= 0 || now - lastCrash < CRASH_GRACE) return;
    lastCrash = now;
    crimeSystem.hurt(damage, impact.x, impact.z);
  });
  // A vehicle driving into the player on foot hurts; whoever the player knocked over leaves a wallet where they lie
  trafficSystem.setMayhemListener((type, x, _y, z, speed, mass) => {
    if (type === 'struck') crimeSystem.hurt(struckDamage(speed, mass), x, z);
    else crimeSystem.drop('money', x, z, walletAmount()); // ('down')
  });
  const save = () => { savePlayer(controllerManager, stateKey, crimeSystem.money, rooms.inside?.venue ?? null); };
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    save();
    if (!event.persisted) audioSystem.dispose();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  loading.mark('controllers');

  // City-wide static geometry: chunk & distance-cull the small props, shadow stand-ins for the big casters
  // (render/scene-culling.ts)
  const named = (names: readonly string[]) => names.map((name) => scene.getObjectByName(name)).filter((o) => o !== undefined);
  // (the high-voltage towers too: 884 of them, 960 triangles each, were drawn whole in the view and both cascades)
  const cullingRoots = named(['CityGrid', 'CityBlocks', 'StreetDetails', 'Hills', 'Rivers', 'Bridges', 'Bardas', 'PowerLines']);
  setupSceneCulling(scene, cullingRoots, lightingSystem.sunLight.shadow, quality.propDistance);
  // ...whose world matrices never change again: rendering stops walking them (the loop updates the rest of the scene)
  const staticRoots = [...cullingRoots, ...named(['TepicLandmarks', 'Cotos', 'CarParks', 'Airport', 'RoadMarkings', 'Pavements', 'Footways', 'Topes', 'StreamedTiles', 'BusStops', 'PowerLines', 'Pools', 'Furniture'])
    .filter((o) => o.parent === scene)];
  freezeStaticMatrices(scene, staticRoots);
  loading.mark('culling');

  // On WebGPU, small InstancedMeshes (<= 1000 instances) keep their matrices in uniform buffers that three.js
  // re-uploads on every draw of every pass (~2.5 MB/frame with the shadow cascades, stalling the GPU queue).
  // Storage attributes only upload when needed; WebGL2 needs ordinary instanced attributes for correct transforms.
  if (renderer.backend instanceof THREE.WebGPUBackend) {
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
      }
    });
  }

  // 5. The render pipeline: the scene pass, half-res screen-space reflections, bloom & the colour grade
  const render = createRenderPipeline(renderer, scene, cameraSystem.camera, quality.ssr);
  const { colorGrade } = render;

  // 6. The HUD's controls (safe DOM APIs only: textContent, classList, addEventListener)
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const timeButtons = document.querySelectorAll('[data-time]');
  const weatherButtons = document.querySelectorAll('[data-weather]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const boardButton = document.getElementById('touch-board');
  const tachometer = new Tachometer(document.getElementById('hud-tacho'));
  const liveInfo = document.getElementById('menu-live-info');
  const skyNote = document.getElementById('menu-sky-note');

  // Live time of day: the real sun & weather over the weather location (world/weather.ts). ?live-time=<ISO date>
  // starts the clock elsewhere & ?live-weather=<clear|cloudy|overcast|rain|storm|fog> pins the conditions, to preview them
  const liveStart = Date.parse(params.get('live-time') ?? '');
  if (Number.isFinite(liveStart)) {
    const t0 = performance.now();
    lightingSystem.liveClock = () => new Date(liveStart + performance.now() - t0);
  }
  const heldWeather = params.get('live-weather');
  // the menu's line under the weather: the place, the time there and its weather (in the player's language: shown
  // again when it changes)
  let liveShown: Parameters<NonNullable<typeof lightingSystem.onLiveChange>>[0] | null = null;
  const showLive = (state: NonNullable<typeof liveShown>) => {
    liveShown = state;
    if (!liveInfo || lightingSystem.activePresetId !== 'live') return;
    const w = state.weather;
    const temperature = w.temperature;
    const temp = state.live && temperature !== null && Number.isFinite(temperature) ? ` · ${Math.round(temperature)}°` : '';
    let clock = '';
    try {
      clock = ` ${lightingSystem.liveClock().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: state.location.timeZone })}`;
    } catch { /* unknown time zone */ }
    const sky = t(state.live ? weatherLabel(w) : state.loading ? 'time.liveLoading' : 'time.liveUnavailable');
    const source = lightingSystem.weather.held ? '' : t('menu.liveSource');
    liveInfo.textContent = `${state.location.name}${clock} · ${sky}${temp}${source}`;
  };
  lightingSystem.onLiveChange = (state) => {
    colorGrade.applyMix(state.blend.a, state.blend.b, state.blend.t, state.block);
    showLive(state);
  };
  const gamepadControls = new GamepadControls(controllerManager, cameraSystem, {
    onBoard: () => { boarding.board(); },
    onCycleCamera: cycleCamera,
    onCycleWeapon: (dir) => { crimeSystem.cycleWeapon(dir); },
    // LB held: the weapon wheel, the right stick pointing
    onWeaponWheel: (action, x, y) => {
      if (action === 'open') weaponWheel.open(false);
      else if (action === 'aim') weaponWheel.stick(x ?? 0, y ?? 0);
      else weaponWheel.close(action === 'close');
    },
    onToggleMap: () => {
      menu.toggle(false);
      mapSystem.toggleFullMap(!mapSystem.isFullMapOpen);
    },
    onCloseMap: () => {
      mapSystem.toggleFullMap(false);
      menu.toggle(false);
    },
    onMenu: () => { if (!mapSystem.isFullMapOpen) menu.toggle(!menu.isOpen); }
  });

  // The HUD follows whatever the player is in now (on foot, or the vehicle it got into)
  // the mode's name (the vehicle's)
  function showMode() {
    hud.showMode(controllerManager.activeMode, tName(controllerManager.getActiveEntity().label));
  }
  function syncMode() {
    const mode = controllerManager.activeMode;
    touchControls.setMode(mode);
    gamepadControls.reset();
    showMode();
    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    if (cameraSystem.getActivePreset().category !== 'follow') selectCamera('chase', false);
  }

  const boarding = new Boarding({
    controllers: controllerManager, traffic: trafficSystem, carParks, crime: crimeSystem, tills: stores.tills, interiors: rooms, streetFood,
    mapOpen: () => mapSystem.isFullMapOpen, onModeChange: syncMode
  });
  boardButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    boarding.board();
  });

  function selectCamera(camId: CameraPresetId, snap = false) {
    cameraSystem.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, the pad's RB)
  function cycleCamera(step: number) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameraSystem.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }

  // The sky: the time of day (a preset, or Live's real clock) and the weather (Live's real conditions, or a sample of
  // world/weather.ts held). The weather shows under Live only: the fixed times of day are dry, clear presets
  const sky: { time: SkyTime; weather: SkyWeather } = { time: 'live', weather: 'live' };
  let skyShown = false;
  function showSky(time: SkyTime, weather: SkyWeather) {
    if (!skyShown || weather !== sky.weather) lightingSystem.setWeather(weather === 'live' ? null : WEATHER_SAMPLES[weather]);
    lightingSystem.applyPreset(time);
    // Live grades itself through onLiveChange as the sun moves
    if (lightingSystem.activePresetId !== 'live') colorGrade.applyPreset(lightingSystem.activePresetId);
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
    if (multiplayer?.setSky(time, weather)) return;
    showSky(time, weather);
    try {
      localStorage.setItem('time-of-day', time);
      localStorage.setItem('weather', weather);
    } catch { /* Storage may be disabled. */ }
  }
  // ...and whose sky it is: this player's alone, or (once a multiplayer room has sent its own) the room's
  let skyShared = false;
  function showSkyNote() {
    if (skyNote) skyNote.textContent = t(skyShared ? 'menu.skyShared' : 'menu.skyLocal');
  }

  const isCameraId = (id: string | null): id is CameraPresetId => CAMERA_PRESETS.some((p) => p.id === id);
  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-camera');
      if (isCameraId(id)) selectCamera(id, true);
      menu.toggle(false);
    });
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

  // No browser context menu in the game (text fields keep theirs): right-click or macOS Ctrl+click opened it, and
  // opened mid-drag it swallowed the pointerup so the camera kept orbiting with the bare mouse
  document.addEventListener('contextmenu', (e) => {
    if (!isTypingInField(e)) e.preventDefault();
  });
  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  const teleportTo = createTeleport({
    controllers: controllerManager, touch: touchControls, gamepad: gamepadControls, cameras: cameraSystem,
    room: () => rooms, selectCamera
  });
  const mapSystem = new CityMapSystem({
    controllerManager,
    cameraSystem,
    trafficSystem,
    allBlocks: [...cityBlocks.allBlocks, city.uan.map], // (the UAN's buildings are uan.ts's, not among the blocks')
    onToggle: (open) => {
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touchControls.available && mapHint) {
        setText(mapHint, 'map.hintTouch');
      }
    },
    onTeleport: teleportTo
  });
  // The menu [Esc] (app/menu.ts): the game's input waits while it is open, as it does under the map. Its Keys tab
  // rebinds the keyboard (ui/key-config.ts); the keycaps shown elsewhere in the menu follow
  const keyConfig = new KeyConfig(document.getElementById('key-config'), keyBindings, document.getElementById('keys-reset'));
  const menu = new GameMenu({
    onToggle: (open) => {
      keyConfig.cancel();
      controllerManager.resetInput();
      touchControls.setEnabled(!open);
      gamepadControls.setEnabled(!open);
    },
    busy: () => mapSystem.isFullMapOpen || weaponWheel.isOpen,
    onKey: (e) => keyConfig.handleKey(e)
  });
  // (the menu's keycaps: kbd[data-key="<binding>"])
  const showKeycaps = () => {
    for (const kbd of document.querySelectorAll<HTMLElement>('kbd[data-key]')) {
      const action = kbd.dataset.key;
      const code = isBindAction(action) ? keyBindings.get(action).at(0) : undefined;
      kbd.textContent = code ? keyLabel(code) : '';
      kbd.hidden = !code;
    }
  };
  keyBindings.onChange(showKeycaps);
  showKeycaps();
  document.getElementById('btn-menu')?.addEventListener('click', () => { menu.toggle(true); });
  wireTeleportButtons(document.querySelectorAll('[data-teleport]'), TELEPORT_LOCATIONS, teleportTo, () => { menu.toggle(false); });
  // (the police, gangs, pickups, fires & gas stations on the radar)
  mapSystem.setBlipSource(() => gasStations.blips(fires.blips(crimeSystem.blips())));
  mapSystem.setPolice(crimeSystem); // (where the police can see the player, on both maps)
  document.getElementById('btn-open-map')?.addEventListener('click', () => {
    menu.toggle(false);
    mapSystem.toggleFullMap(true);
  });

  const showHudToggle = () => {
    if (!hudToggleBtn) return;
    const isMin = document.body.classList.contains('hud-minimized');
    hudToggleBtn.setAttribute('aria-pressed', String(isMin));
    hudToggleBtn.title = t(isMin ? 'hud.showTitle' : 'hud.hideTitle');
  };
  showHudToggle();
  hudToggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('hud-minimized');
    showHudToggle();
  });

  // The language (the menu's Settings, and the loading screen's button): every text the HUD keeps is shown again in
  // the new language
  document.getElementById('btn-lang')?.addEventListener('click', cycleLocale);
  onLocaleChange(() => {
    showMode();
    hud.showSound(audioSystem);
    showHudToggle();
    showSkyInfo();
    showSkyNote();
  });

  // Global keyboard shortcuts (their keys the menu's, input/keybindings.ts): getting in & out, cameras (and 5-0), the
  // clean view, sound and the horn
  const CAMERA_KEYS: Readonly<Partial<Record<string, CameraPresetId>>> = {
    Digit5: 'chase', Digit6: 'action', Digit7: 'pov', Digit8: 'fifthAve', Digit9: 'timesSquare', Digit0: 'chryslerGCT'
  };
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    if (e.code === 'Tab') e.preventDefault(); // (in play Tab never hops the focus onto a button Space would then press)
    const plain = !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey;
    const camera = CAMERA_KEYS[e.code];
    if (camera) selectCamera(camera, true);
    else if (keyBindings.is('board', e.code) && plain) boarding.board();
    else if (keyBindings.is('camera', e.code)) cycleCamera(e.shiftKey ? -1 : 1);
    else if (keyBindings.is('cleanView', e.code)) hudToggleBtn?.click();
    else if (keyBindings.is('sound', e.code) && plain) audioSystem.setEnabled(!audioSystem.enabled);
    else if (keyBindings.is('horn', e.code) && plain && !mapSystem.isFullMapOpen) audioSystem.honk(controllerManager.getActiveEntity());
  });

  window.addEventListener('resize', () => {
    cameraSystem.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (mapSystem.isFullMapOpen) {
      mapSystem.resizeFullCanvas();
      mapSystem.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the player, on foot.
  syncMode();
  selectCamera('chase', true);
  // The sky this player left last time (?live-weather=<sample> holds one for a preview); a multiplayer room's replaces it
  let savedTime: string | null = null;
  let savedWeather: string | null = null;
  try {
    savedTime = localStorage.getItem('time-of-day');
    savedWeather = localStorage.getItem('weather');
  } catch { /* Storage may be disabled. */ }
  showSky(isSkyTime(savedTime) ? savedTime : 'live', isWeatherSample(heldWeather) ? heldWeather : isSkyWeather(savedWeather) ? savedWeather : 'live');
  showSkyNote();
  // Multiplayer (?multiplayer=1, see net/multiplayer.ts) loads only when asked for, so single-player pays nothing
  let multiplayer: Multiplayer | null = null;
  if (params.has('multiplayer')) {
    Promise.all([import('./net/multiplayer.ts'), import('./net/lobby.ts')])
      .then(async ([{ Multiplayer, multiplayerOptions }, { openLobby }]) => {
        const options = multiplayerOptions();
        if (!options) {
          console.info('[mp] no server to connect to: add &mp-server=wss://… (or serve from localhost)');
          return;
        }
        // the lobby first: the player's name and the room to play in (net/lobby.ts)
        const { roomsUrl, ...connection } = options;
        const lobby = (more: Partial<Parameters<typeof openLobby>[0]> = {}) => {
          controllerManager.resetInput(); // (whatever key was held stays held otherwise)
          return openLobby({ roomsUrl, name: multiplayer?.name ?? connection.name ?? '', ...more });
        };
        const first = await lobby();
        if (!first) return;
        const mp = new Multiplayer({
          scene, controllers: controllerManager, camera: cameraSystem.camera, crime: crimeSystem, cameras: cameraSystem,
          ...connection, name: first.name, entry: first.entry,
          // (the room's sky, everyone's: on joining, and whenever someone in the room changes it)
          onSky: (time, weather) => {
            showSky(time, weather);
            skyShared = true;
            showSkyNote();
          }
        });
        multiplayer = mp;
        boarding.ride = mp; // (F by a friend's car: in with them)
        // a room without police: crimes raise no wanted level (PvP is net/multiplayer.ts's own)
        mp.onRules = (rules) => {
          crimeSystem.policeOff = !rules.police;
          if (!rules.police) crimeSystem.wanted.clear();
        };
        const go = (choice: Awaited<ReturnType<typeof openLobby>>) => { if (choice) mp.rejoin(choice.entry, choice.name); };
        mp.onRejected = (code) => { void lobby({ error: code }).then(go); };
        mp.onLobby = () => {
          void lobby({
            current: mp.current,
            onSave: ({ time, weather, rules }) => {
              mp.setSky(time, weather);
              mp.sendRules(rules);
            }
          }).then(go);
        };
      })
      .catch((err: unknown) => { console.warn('[mp] could not start multiplayer:', err); });
  }
  loading.mark('ui');

  // The streamed tiles round the player, laid before the first frame; and a stand-in of every streamed layer for the
  // shader warm-up, so no tile builds pipelines in play when its layer first comes in (taken out after the first frame)
  let streamWarmup: THREE.Group | null = null;
  let warmupMeshes: THREE.Mesh[] = [];
  if (streamer) {
    loading.status('loading.tiles');
    const here = controllerManager.getActiveEntity().position;
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
  await precompileShaders(renderer, scene, cameraSystem.camera, render, (done) => {
    loading.progress(done);
  }, () => { loading.mark('postFX'); });
  loading.mark('compile');

  // The frame loop. Each system steps once a frame, in this order: input & the player first (what everything else
  // follows), then the cameras, the world's clock & the traffic (and the props it knocks down), the CFE's lines down,
  // the crime, the city's life and the emergency services
  // (the fires there call the bomberos), the HUD, the city's
  // level of detail round the camera, the weather, the network, the map & the audio, and the streamed tiles.
  const weather = new WeatherEffects({
    lighting: lightingSystem, roadWater, rain, floods, controllers: controllerManager, cameras: cameraSystem,
    traffic: trafficSystem, crime: crimeSystem, audio: audioSystem, interiors: rooms, bearingDeg: CITY.bearingDeg || 0
  });
  const ambience: AmbientSource[] = [];
  let weekday = new Date().getDay();
  let nextPlayerSave = 0;
  let warmedUp = false; // see the first frame below
  const scheduler = new Scheduler({ profile: debug })
    .run('gamepad', ({ dt }) => { gamepadControls.update(dt); })
    .run('player', ({ frameDt, elapsed }) => {
      // out of breath, no sprinting
      controllerManager.canSprint = stamina.canSprint;
      // on foot WASD go the way the camera looks (cameras.ts)
      controllerManager.viewHeading = cameraSystem.viewHeading();
      // the player keeps real time down to 10 fps, in steps of at most 1/30 s: a slow frame mustn't stretch a car's
      // 0-100 km/h or slow its speed over the ground
      const playerSteps = Math.ceil(frameDt * 30 - 1e-6);
      for (let i = 0; i < playerSteps; i++) controllerManager.update(frameDt / playerSteps, elapsed);
      // the car's or moto's tachometer follows the engine every frame (the rest of the HUD every 250 ms, below)
      const mode = controllerManager.activeMode;
      if (mode === 'car' || mode === 'moto') {
        const v = controllerManager.entities[mode];
        const engine = 'damage' in v ? 1 - v.damage.engine : 1; // (a moto has no engine damage)
        const fuel = 'fuel' in v ? v.fuel / FUEL_TANK : 1; // (a moto runs on air)
        tachometer.update(v.spec, v.drive, Math.round(Math.abs(v.speed) * 3.6), engine, engine <= 0 || fuel <= 0, v.drive ? gearLabel(v.drive, v.spec) : '1', fuel);
      }
    })
    .run('aim', ({ dt }) => {
      // (aiming only on foot and in play, not while choosing a weapon)
      aimControl.allowed = crimeSystem.state === 'play' && !weaponWheel.isOpen;
      aimControl.update(dt);
    })
    // riding in a friend's car (multiplayer): the ride where the car is, before the cameras follow it
    .run('passenger', () => { multiplayer?.seat(); })
    .run('cameras', ({ dt, elapsed }) => {
      cameraSystem.update(dt, elapsed);
      streetDetails.signalClock.value = elapsed;
      cityUniforms.uClock.value = elapsed;
    })
    .run('traffic', ({ dt, elapsed }) => {
      // the hour sets how much traffic and how many people are out (sim/traffic-demand.ts): rush hours on the avenues
      trafficSystem.setHour(lightingSystem.hourOfDay);
      trafficSystem.setParked(crimeSystem.addObstacles(controllerManager.parkedVehicles()));
      const entity = controllerManager.getActiveEntity();
      trafficSystem.update(dt, elapsed, cameraSystem.currentPos, entity, controllerManager.activeMode, cameraSystem.camera);
      highwayTraffic.update(dt, cameraSystem.camera, entity, controllerManager.activeMode);
      // lamp posts, sign posts, hydrants & bins, CFE poles & trees the player's vehicle runs into (sim/mayhem.ts)
      streetDetails.breaker.update(dt, entity, controllerManager.activeMode);
    })
    // the CFE's lines: those down arcing, the runs without power going dark (world/cfe-network.ts)
    .run('power', ({ dt }) => {
      streetDetails.cfe.update(dt, cameraSystem.camera, controllerManager.getActiveEntity().position, controllerManager.activeMode === 'person');
    })
    .run('crime', ({ dt, elapsed }) => {
      // gunfire, the police, gangs & thieves, and a blast's shake of the camera
      crimeSystem.update(dt, elapsed, cameraSystem.camera);
      bloodPools.update(dt);
    })
    .run('city life', ({ dt }) => {
      streetFood.update(dt, lightingSystem.hourOfDay, cameraSystem.camera);
      nightlife.update(dt, lightingSystem.hourOfDay, weekday, cameraSystem.camera);
      rooms.update(dt, lightingSystem.hourOfDay);
      if (!rooms.active) fires.update(dt, cityUniforms.uDryness.value, cameraSystem.camera);
      // the sounds that stay put (audio/audio-ambience.ts): the planchas, the antros' & parties' music, the fires
      ambience.length = 0;
      streetFood.sounds(ambience);
      nightlife.sounds(ambience);
      rooms.sounds(ambience);
      fires.sounds(ambience);
      audioSystem.setAmbience(ambience);
      crimeSystem.shakeCamera(cameraSystem.camera);
    })
    // the bomberos & ambulances on their way, at work, going back (sim/emergency.ts)
    .run('emergency', ({ dt }) => { emergency.update(dt, cameraSystem.camera); })
    // pumps going up, the car filling up (sim/gas-stations.ts)
    .run('gas stations', ({ dt }) => { gasStations.update(dt); })
    .run('hud', ({ dt, now }) => {
      stamina.update(dt, crimeSystem.state === 'play' ? controllerManager.sprintingMode() : null);
      crimeHud.update(crimeSystem, dt, stamina);
      weaponWheel.update();
      if (!document.hidden && now >= nextPlayerSave) {
        save();
        nextPlayerSave = now + 5000;
      }
    })
    .run('city detail', () => {
      const eye = cameraSystem.currentPos;
      cityBlocks.update(eye.x, eye.z);
      stores.update(eye.x, eye.z);
      carParks.update(eye.x, eye.z);
      // (no parked car where another vehicle stands: the player's left standing, the other players')
      for (const v of controllerManager.parkedVehicles()) carParks.clearAt(v.x, v.z);
      for (const r of crimeSystem.remotes) if (!r.person) carParks.clearAt(r.x, r.z);
      cityBlocks.updateLights(cameraSystem.camera);
      streetDetails.update(cameraSystem.camera);
      powerLines.update(cameraSystem.camera.position);
      lightingSystem.update(eye);
    })
    .add(weather)
    .run('multiplayer', ({ dt, elapsed }) => { multiplayer?.update(dt, elapsed); })
    .run('map', () => { mapSystem.update(); })
    .run('audio', ({ dt, elapsed }) => { audioSystem.update(dt, elapsed, cameraSystem.camera, lightingSystem.isNight); })
    .run('culling', () => { if (warmedUp) updateSceneCulling(cameraSystem.camera.position); }) // (the warm-up frame draws every chunk)
    .run('streaming', ({ rawDt }) => {
      if (!streamer) return;
      // (in a room the camera is in its pocket high over the map: the tiles stay laid round the door)
      const door = rooms.inside?.venue;
      const eye = cameraSystem.camera.position;
      if (door) streamer.update(door, 0, Math.max(0, rawDt));
      else streamer.update(eye, eye.y - groundHeight(eye.x, eye.z), Math.max(0, rawDt));
    });
  if (debug) {
    // Debugging handle for the console, only with ?debug in the URL
    Object.assign(window, { __slop: {
      scene, renderer, streamer, streetFood, venues, floods, nightlife, interiors: rooms, fires, emergency, gasStations, controllerManager, trafficSystem,
      cameraSystem, streetDetails, cityGrid: city.cityGrid, cityBlocks, mapSystem, audioSystem, crimeSystem, stamina, aimControl,
      weaponWheel, weaponIcons, scheduler, boarding, quality, multiplayer: () => multiplayer
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
      const entity = controllerManager.getActiveEntity();
      const kmh = Math.round(Math.abs(entity.speed) * 3.6);
      // over the town's floor (its slopes put the streets well over y = 0)
      const altM = entity.position.y - controllerManager.floorHeight(entity.position.x, entity.position.z);
      hud.showTelemetry({
        fps, mode: controllerManager.activeMode, kmh, altitudeFt: Math.max(0, Math.round(altM * 3.281)),
        boosting: Boolean(controllerManager.keys.boost)
      });
      // the grass greens in the rains & browns in the dry season (world/lot-greenery.ts), by the month shown
      cityUniforms.uDryness.value = grassDryness(lightingSystem.liveClock().getMonth());
      cityUniforms.uHour.value = lightingSystem.hourOfDay; // (the lit rooms & the shops' shutters)
      weekday = lightingSystem.liveClock().getDay(); // (the weekend's parties)
      // The street corner of the player on the follow cameras, of the camera itself on the scenic ones
      const where = cameraSystem.getActivePreset().category === 'follow' ? entity.position : cameraSystem.currentPos;
      hud.showLocation(getLocationLabel(where.x, where.z));
      hud.showPrompt(boarding.prompt(), boarding.promptAction);
    }
  });

  // The loading screen stays up until the GPU has got through the first frame (and the pipelines its warm-up
  // compiled), i.e. until the city is actually on screen
  function onFirstFrame() {
    const backend = renderer.backend;
    const device = 'device' in backend && backend.device instanceof GPUDevice ? backend.device : undefined;
    Promise.resolve(device?.queue.onSubmittedWorkDone()).catch(() => { /* the city shows anyway */ }).then(() => {
      loading.mark('gpu');
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
      audioSystem.ready = true;
      loading.progress(1);
      // (the weapon pictures, off screen, once the first frames are through)
      setTimeout(() => { void weaponIcons.bake(); }, 400);
    }).catch((err: unknown) => { console.error(err); });
  }
}

void initApp();
