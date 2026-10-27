// js/app/boarding.ts
// Boarding (F, the gamepad's Y, the touch button): on foot, get into the nearest of the player's own vehicles,
// take the nearest car, bicycle or moto from the traffic (its driver is left in the street) or a car parked in a car
// park, rob a store's till, buy
// from a taco stand or go in through a door; in a vehicle, get out (a helicopter once it has landed). In multiplayer,
// by a friend's car, get in with them (and F again gets out). And the prompt for what F would do here.
import type { ThirdPersonControllerManager, LeftCar, VehicleMode } from '../player/controllers.ts';
import type { TrafficSystem } from '../sim/traffic.ts';
import type { CrimeSystem } from '../sim/crime.ts';
import type { StoreTill } from '../world/store-interiors.ts';
import type { Interiors } from '../world/interiors.ts';
import type { StreetFood } from '../world/street-food.ts';
import type { CarParksBuild, PlacedCar } from '../world/car-parks.ts';
import { t } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';

const BOARD_REACH = 1.6; // m from the vehicle's body
const TILL_REACH = 1.8; // m from a store's till (store-interiors.ts)
const TILL_REFILL = 600; // s: a robbed till stays empty this long
const PROMPT_NAMES: Readonly<Record<VehicleMode, MessageKey>> = {
  car: 'prompt.board.car', cyclist: 'prompt.board.cyclist', moto: 'prompt.board.moto', helicopter: 'prompt.board.helicopter'
};

/** What F would do, for the touch button's word: get in, steal or rob, get out, use what is at hand (buy, go in) */
export type PromptAction = 'none' | 'board' | 'steal' | 'exit' | 'use';

/** A vehicle of the traffic the player can take */
type TrafficVehicle = NonNullable<ReturnType<TrafficSystem['vehicleNear']>>;
/** What F would act on, on foot */
type BoardTarget =
  | { taken: TrafficVehicle }
  | { parked: PlacedCar }
  | { mode: VehicleMode; left: LeftCar | undefined }
  | { till: StoreTill };

export interface BoardingSystems {
  controllers: ThirdPersonControllerManager;
  traffic: TrafficSystem;
  /** the car parks' parked cars, to steal */
  carParks: Pick<CarParksBuild, 'carNear' | 'take'>;
  crime: CrimeSystem;
  tills: readonly StoreTill[];
  interiors: Interiors;
  streetFood: StreetFood;
  /** whether the full map is open (F does nothing then) */
  mapOpen: () => boolean;
  /** after the player got into or out of something: the HUD follows */
  onModeChange: () => void;
}

/** Riding in a friend's car (net/multiplayer.ts), once multiplayer has loaded */
export interface RideHook {
  readonly riding: boolean;
  rideTarget(): { id: number; name: string } | null;
  startRide(id: number): void;
  leaveRide(): void;
}

export class Boarding {
  private readonly systems: BoardingSystems;
  ride: RideHook | null = null;

  constructor(systems: BoardingSystems) {
    this.systems = systems;
  }

  private target(): BoardTarget | null {
    const { controllers, traffic, carParks, tills } = this.systems;
    // (not while lying in the road, thrown out of a car)
    if (controllers.activeMode !== 'person' || controllers.entities.person.ragdoll) return null;
    const p = controllers.entities.person.position;
    const own = controllers.ownVehicleNear(BOARD_REACH);
    // (the nearest of the traffic's and the car parks' wins)
    const reach = own ? Math.min(BOARD_REACH, own.distance) : BOARD_REACH;
    const parked = carParks.carNear(p.x, p.z, reach);
    const taken = traffic.vehicleNear(p.x, p.z, parked ? parked.distance : reach);
    if (taken) return { taken };
    if (parked) return { parked: parked.car };
    if (own) return { mode: own.mode, left: own.left };
    for (const till of tills) if (Math.hypot(till.x - p.x, till.z - p.z) < TILL_REACH) return { till };
    return null;
  }

  // Robbing a store's till: what's in it (a supermarket's takings since it was last emptied), the store's alarm (two
  // stars: the staff call the police) and the shoppers' panic; it's empty for ten minutes after
  private robTill(till: StoreTill): void {
    const { crime, traffic } = this.systems;
    const now = performance.now() / 1000;
    if (now < till.refill) {
      crime.toast(t('toast.tillEmpty'));
      return;
    }
    const amount = Math.round(400 + Math.random() * 1100);
    crime.money += amount;
    crime.toast(t('toast.robbed', { amount, store: till.store.name }));
    crime.report('robbery', true);
    traffic.panic(till.x, till.z, 45, false);
    till.refill = now + TILL_REFILL;
  }

  /** F */
  board(): void {
    const { controllers, traffic, carParks, crime, interiors, streetFood, mapOpen, onModeChange } = this.systems;
    if (mapOpen() || crime.state !== 'play') return;
    if (this.ride?.riding) {
      this.ride.leaveRide();
      onModeChange();
      return;
    }
    if (controllers.activeMode !== 'person') {
      if (controllers.leaveVehicle()) onModeChange();
      return;
    }
    if (interiors.active) {
      interiors.act(); // (inside: the counter, or out of the door)
      return;
    }
    // by a friend's car: in with them
    const friend = this.ride?.rideTarget();
    if (friend && this.ride) {
      this.ride.startRide(friend.id);
      onModeChange();
      return;
    }
    const target = this.target();
    if (!target) {
      // on foot at a taco stand: something to eat; at a restaurant's, bar's or antro's door: in
      if (!streetFood.buy()) interiors.act();
      return;
    }
    if ('till' in target) {
      this.robTill(target.till);
      return;
    }
    if ('taken' in target) {
      const taken = traffic.hijack(target.taken);
      if (taken.kind === 'car') controllers.leaveCarBehind(); // (the player's own car stays where it is)
      controllers.enterVehicle(taken.kind, taken);
      // taking a patrol car is always a crime (its crew saw it); any other car, if the police see it
      if (taken.kind === 'car' && taken.police) crime.report('stealCop', true);
      else crime.report('carjack');
    } else if ('parked' in target) {
      // a parked car: off its stall, the player's own car in its place (a theft, if the police see it)
      const car = carParks.take(target.parked);
      controllers.leaveCarBehind();
      controllers.enterVehicle('car', { kind: 'car', speed: 0, police: false, ...car });
      crime.report('carjack');
    } else if (target.left) {
      controllers.takeLeftCar(target.left);
    } else {
      controllers.enterVehicle(target.mode);
    }
    onModeChange();
  }

  /** What the last prompt() offers, for the touch button */
  promptAction: PromptAction = 'none';

  /** What F would do here ('' for nothing), in the player's language; promptAction says which kind of thing it is */
  prompt(): string {
    const { controllers, interiors, streetFood } = this.systems;
    const onFoot = controllers.activeMode === 'person';
    this.promptAction = onFoot ? 'none' : 'exit';
    if (this.ride?.riding) return this.offer('exit', t('prompt.exitRide'));
    const friend = this.ride?.rideTarget();
    if (friend) return this.offer('board', t('prompt.rideWith', { name: friend.name }));
    if (onFoot) {
      const target = this.target();
      if (!target) {
        const text = (interiors.active ? '' : streetFood.prompt()) || interiors.prompt();
        return this.offer(text ? 'use' : 'none', text);
      }
      if ('till' in target) return this.offer('steal', t('prompt.robTill'));
      if ('mode' in target) return this.offer('board', t(PROMPT_NAMES[target.mode]));
      if ('parked' in target) return this.offer('steal', t('prompt.steal.car'));
      const v = target.taken;
      const what: MessageKey = v.bike ? 'prompt.steal.bike' : v.moto ? 'prompt.steal.moto' : v.isPolice ? 'prompt.steal.police'
        : v.bus ? 'prompt.steal.bus' : v.fleet === 'combi' ? 'prompt.steal.combi' : 'prompt.steal.car';
      return this.offer('steal', t(what));
    }
    if (controllers.activeMode === 'helicopter') {
      const h = controllers.entities.helicopter;
      const air = h.position.y - controllers.getGroundHeight(h.position.x, h.position.z, 'helicopter');
      return t(air > 3 ? 'prompt.land' : 'prompt.exitHeli');
    }
    return '';
  }

  private offer(action: PromptAction, text: string): string {
    this.promptAction = action;
    return text;
  }
}
