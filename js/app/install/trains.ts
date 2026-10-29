// js/app/install/trains.ts
// Ferromex's freight trains through Tepic (sim/trains.ts) and the level crossings' signals (world/rail-crossings.ts):
// a train closing a crossing stops the traffic there (sim/traffic), one striking the player on foot kills them (190 t
// at 35 km/h: nobody walks away), and one striking their vehicle hurts as a crash into a wall TRAIN_HIT m/s faster than
// the train itself. ?train=1 sends the next one past the player half a minute after the start.
import { liftAt } from '../../world/ground.ts';
import { buildRailCrossings } from '../../world/rail-crossings.ts';
import { TrainSystem } from '../../sim/trains.ts';
import { crashDamage } from '../../player/stats.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';
import type { PlayerParts } from './player.ts';
import type { CrimeParts } from './crime.ts';

const TRAIN_HIT = 12; // m/s (a car's crash damage starts at 11)
const TRAIN_KILLS = 1000; // health: past any armour
const TRAIN_HARD = 1.4; // (a bus's hardness: player/stats.ts)

export type TrainParts = ReturnType<typeof installTrains>;

export function installTrains({ params, scene, loading, city, physics, controllers, crime }: Boot & CityParts & PlayerParts & CrimeParts) {
  const { traffic } = city;
  const trains = new TrainSystem({ scene, physics, traffic, ground: liftAt });
  const railCrossings = buildRailCrossings(scene, trains.crossings);
  traffic.setRailClosed(trains.closed); // (the same array, closed and opened in place every frame)
  trains.onStruck = (x, z, speed, _mass, onFoot) => {
    crime.hurt(onFoot ? TRAIN_KILLS : crashDamage(controllers.activeMode, speed + TRAIN_HIT, TRAIN_HARD), x, z);
  };
  if (params.get('train') === '1') {
    const here = controllers.getActiveEntity().position;
    trains.summon(here.x, here.z);
  }
  loading.mark('trains');
  return { trains, railCrossings };
}
