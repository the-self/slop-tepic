// js/app/install/player.ts
// The player (on foot, car, bicycle, moto, helicopter) on the city's ground, back where it left; the car's Jolt world
// and the bodies that fall in it; the cameras and the free aim. And what the world and the player report to the bus:
// their crashes, someone come to rest, a CFE line down.
import { CITY, TELEPORT_LOCATIONS } from '../../world/city-config.ts';
import { ThirdPersonControllerManager } from '../../player/controllers.ts';
import { Stamina } from '../../player/stats.ts';
import { CameraSystem } from '../../player/cameras.ts';
import { AimControl } from '../../player/aim.ts';
import { createCarPhysics } from '../../player/car-physics.ts';
import { createRagdolls } from '../../sim/ragdolls.ts';
import { BloodPools } from '../../sim/blood.ts';
import { groundHeight, gradeHeight, townHeight, landHeight, deckLift, walkDeckLift, surfaceHeight } from '../../world/ground.ts';
import { playerStateKey, restorePlayer } from '../player-state.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';

export type PlayerParts = Awaited<ReturnType<typeof installPlayer>>;

export async function installPlayer({ scene, renderer, loading, joltReady, events, city }: Boot & CityParts) {
  const { carParks, streetDetails, traffic, colliders } = city;
  const controllers = new ThirdPersonControllerManager(scene, colliders);
  // The ground (world/ground.ts): the town's own slopes and the hills over them (the flat city with ?slopes=0)
  controllers.setTerrain(groundHeight, townHeight, landHeight, deckLift, walkDeckLift); // (and the bridges' decks over it; on foot the footbridges' too)
  controllers.setCurbRamps(carParks.rampAt); // (the car parks' driveways, up over the curb)
  traffic.setHillQuery(gradeHeight); // (the roads' lifts are over the ground at grade: down an underpass, < 0)
  traffic.setSurfaceQuery(surfaceHeight);
  // People, bicycles & hydrants knocked flying bounce off the buildings' walls (sim/mayhem.ts)
  const solidAt = (x: number, z: number) => controllers.isSolidAt(x, z, 1.5, groundHeight(x, z));
  traffic.setSolidQuery(solidAt);
  // (the walls the sidewalks' walkers turn back at: the buildings', not the poles' they pass by)
  traffic.setWallQuery((x, z) => controllers.isSolidAt(x, z, 1.5, groundHeight(x, z), 2));
  // A camión or combi the player takes is built from the traffic's own parts, its route and all
  controllers.setLookKits((look) => traffic.lookKit(look));
  // The traffic's damaged engines smoke with the player's car's smoke
  traffic.setSmokeEmitter((x, y, z, vx, vz, count, shade, size) => { controllers.puffSmoke(x, y, z, vx, vz, count, shade, size); });
  streetDetails.breaker.setGroundQuery(groundHeight);
  // Saved players return at rest close to where they left. The game always starts on foot: someone who left driving
  // steps out of that vehicle where it was.
  const stateKey = playerStateKey(CITY.city);
  const saved = restorePlayer(controllers, stateKey);
  controllers.setMode('person');
  controllers.landHelicopter(true);
  if (saved.mode === 'car' || saved.mode === 'cyclist' || saved.mode === 'moto') {
    controllers.setMode(saved.mode);
    controllers.exitVehicle();
  }
  let physics;
  try {
    physics = createCarPhysics(await joltReady, {
      // what the car stands on: the ground at its level (a bridge's deck it is on), the sidewalks over the street
      groundAt: (x, z, fromY) => controllers.getGroundHeight(x, z, 'person', fromY),
      collidersNear: (x, z, r) => controllers.nearColliders(x, z, r)
    });
    controllers.setCarPhysics(physics);
  } catch (err) {
    loading.status('loading.physicsFailed');
    throw err;
  }
  // Who is hit, shot or thrown falls as a body (sim/ragdolls.ts), in the car's world; a pool of blood spreads under
  // whoever was hit hard as they come to rest (sim/blood.ts)
  const ragdolls = createRagdolls(physics);
  // ...and the street furniture vehicles knock loose (sim/mayhem.ts)
  streetDetails.breaker.setPhysics(physics);
  controllers.ragdolls = ragdolls;
  traffic.setRagdolls(ragdolls);
  // ...and the traffic's cars thrown about in a crash near the player (sim/traffic.ts crash)
  traffic.setPhysics(physics);
  const blood = new BloodPools(scene, (x, z, fromY) => controllers.getGroundHeight(x, z, 'person', fromY));
  ragdolls.onSettle = (h) => { events.emit('settle', h); };
  events.on('settle', (h) => {
    if (!(h.bleed > 0.05)) return;
    blood.add(h.px, h.pz, h.py + 0.3, 0.9 + h.bleed * 1.7);
    // ...and smeared along the ground from where they came down onto it (not through the air) to where they lie
    blood.trail(h.x0, h.z0, h.px, h.pz, h.py + 0.3, h.bleed);
  });
  // Crashes hurt as well as sound: each system reports its crashes to the bus, which the audio and the player's
  // health listen to
  for (const system of [controllers, traffic, streetDetails.breaker]) {
    system.setCollisionListener((impact) => { events.emit('collision', impact); });
  }
  // A CFE pole knocked down: its lines arcing in the street, its transformer going up, a shock for who walks into them
  streetDetails.cfe.listener = (e) => { events.emit('power', e); };
  loading.mark('physics');
  // Sprinting runs out of breath (player/stats.ts)
  const stamina = new Stamina();

  const cameras = new CameraSystem(renderer.domElement, controllers);
  // Free aim on foot: the right button (or Z) brings the camera over the shoulder with a crosshair (player/aim.ts)
  const aim = new AimControl({ canvas: renderer.domElement, controllers });
  cameras.aim = aim;
  cameras.setGroundQuery(groundHeight); // the chase cameras stay over the ground
  // ...and in front of the walls between them and the player (what is under 1 m across, a pole, left out)
  cameras.setObstacleQuery((x, y, z) => controllers.isSolidAt(x, z, 0, y, 1));
  // The scenic cameras frame the city's own spots (see cameras.ts)
  const T = TELEPORT_LOCATIONS;
  cameras.setScenicAnchors({
    fifthAve: T.plaza, timesSquare: T.alameda, chryslerGCT: T.uan, centralPark: T.loma, bryantPark: T.mercado,
    waterfront: T.estacion, observatory: T.plaza, drone: T.plaza
  });
  return { controllers, solidAt, stateKey, saved, physics, ragdolls, blood, stamina, cameras, aim };
}
