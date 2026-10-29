// js/app/install/city-life.ts
// The city's life round the player: the eating & drinking places and the night's street food, the floods, the bars,
// antros & parties, the rooms behind the venues' doors, the bomberos & the Cruz Roja, the fires, the gas stations, and
// Forum Tepic's shoppers, glass & escalators.
// And who they answer on the bus: an ambulance for a hard crash or someone badly hurt come to rest.
import { t } from '../../i18n/i18n.ts';
import { GEO } from '../../world/city-geodata.js';
import { findVenues } from '../../world/venues.ts';
import { StreetFood } from '../../world/street-food.ts';
import { Floods } from '../../world/floods.ts';
import { Nightlife } from '../../world/nightlife.ts';
import { Interiors } from '../../world/interiors.ts';
import { inReservedLot } from '../../world/buildings.ts';
import { Fires } from '../../sim/fires.ts';
import { EmergencyServices } from '../../sim/emergency.ts';
import { GasStations } from '../../sim/gas-stations.ts';
import { ForumLife } from '../../sim/forum.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';
import type { PlayerParts } from './player.ts';
import type { AudioParts } from './audio.ts';
import type { CrimeParts } from './crime.ts';

const HARD_CRASH = 9; // m/s (~32 km/h) a crash is struck at for an ambulance to be called

export type CityLifeParts = ReturnType<typeof installCityLife>;

export function installCityLife({ params, scene, loading, events, rain, city, controllers, cameras, physics, ragdolls, audio, crime }:
  Boot & CityParts & PlayerParts & AudioParts & CrimeParts) {
  const { rivers, carParks, traffic, forum } = city;
  // The city's eating & drinking places, off the real shop signs (world/venues.ts), and the night's street food stands
  // in front of them and at the parks (world/street-food.ts)
  const venues = findVenues(GEO.houses, GEO.signs, GEO.houseStride || 8);
  const streetFood = new StreetFood({ scene, venues, pois: GEO.pois, controllers, crime });
  // The Live weather's storms flood the low streets & the Mololoa's banks (world/floods.ts); ?flood=<0..1> to preview
  const floodParam = Number.parseFloat(params.get('flood') ?? '');
  const floods = new Floods({ scene, rivers, hold: Number.isFinite(floodParam) ? floodParam : null });
  controllers.waterAt = (x, z) => floods.depthAt(x, z);
  // The bars & antros open at night and the colonias' weekend parties (world/nightlife.ts)
  const nightlife = new Nightlife({ scene, venues, houses: GEO.houses, stride: GEO.houseStride || 8, controllers, audio });
  // In through their doors (F): the restaurants', bars' and antros' rooms, the Tapanko's tapanco and all
  const rooms = new Interiors({ scene, venues, controllers, cameras, crime });
  // The bomberos' trucks & the Cruz Roja's ambulances, sent from their real stations (sim/emergency.ts): in the patrol
  // cars' pool, so before the audio takes that for its sirens
  const emergency = new EmergencyServices({ scene, crime, ground: (x, z) => controllers.getGroundHeight(x, z, 'person') });
  traffic.setSirens(emergency.sirens); // (the cars ahead of them pull over)
  audio.sources.pursuers = [...crime.cruisers, crime.heli]; // (the patrol cars & trucks, the helicopter)
  // Burning wrecks, house fires, the dry season's quemas, and the bomberos who come for them (sim/fires.ts)
  const fires = new Fires({ scene, crime, services: emergency, controllers, houses: GEO.houses, stride: GEO.houseStride || 8,
    reserved: inReservedLot });
  // Tepic's gas stations (sim/gas-stations.ts): the car fills up stopped by a pump (G); a pump shot, rammed or caught in a
  // blast goes up
  const gasStations = new GasStations({
    scene, crime, car: controllers.entities.car,
    isSolidAt: (x, z, height, ground, minSize) => controllers.isSolidAt(x, z, height, ground, minSize),
    groundAt: (x, z) => controllers.getGroundHeight(x, z, 'person'),
    active: () => controllers.getActiveEntity(), activeMode: () => controllers.activeMode,
    addColliders: (list) => { controllers.addColliders(list); },
    ignite: (kind, x, z, size) => fires.ignite(kind, x, z, size)
  });
  // (the stations' driveways over the curb too, besides the car parks')
  controllers.setCurbRamps((x, z) => Math.max(carParks.rampAt(x, z), gasStations.rampAt(x, z)));
  controllers.onFuelOut = () => { crime.toast(t('toast.outOfGas')); };
  crime.onExplosion = (x, y, z, radius) => {
    fires.onExplosion(x, y, z, radius);
    gasStations.onExplosion(x, y, z, radius);
  };
  // Someone killed or badly hurt (shot dead, thrown hard) come to rest: an ambulance for them. Not for the player
  // (killed on foot or thrown out of a vehicle), who comes round at the hospital or gets up
  events.on('settle', (h) => {
    if (h.bleed >= 0.45 && h !== crime.playerFall && h !== controllers.entities.person.ragdoll) emergency.callAmbulance(h.px, h.pz, h);
  });
  // a hard crash (~32 km/h and up: the player's, or two of the traffic's): an ambulance (sim/emergency.ts)
  events.on('collision', (impact) => { if (impact.speed >= HARD_CRASH) emergency.callAmbulance(impact.x, impact.z); });
  // the player's vehicle driven into a parked car (a wall to it, in Jolt): the parked car dented too (world/car-parks.ts)
  events.on('collision', (impact) => {
    if (impact.kind === 'building' && impact.a === controllers.getActiveEntity()) carParks.strike(impact.x, impact.z, impact.speed);
  });
  // Forum Tepic (sim/forum.ts): no rain under its roofs; its shoppers fall as bodies in the car's world, and one run
  // over there is a crime as on the street (sim/crime.ts's traffic knock listener), always seen (the mall is full of
  // shoppers); the glass a car drives through goes from its world, heard breaking
  rain.setRoofs(forum.roofs);
  const forumLife = new ForumLife(scene, forum);
  forumLife.shoppers.ragdolls = ragdolls;
  forumLife.shoppers.onKnock = (x, z, speed) => {
    crime.report('runOver', true);
    crime.fx.splatter(x, crime.groundAt(x, z) + 0.9, z, speed);
    controllers.bloodyCar(x, z, speed);
  };
  forumLife.glass.physics = physics;
  forumLife.glass.sound = audio;
  loading.mark('controllers');
  return { venues, streetFood, floods, nightlife, rooms, emergency, fires, gasStations, forumLife };
}
