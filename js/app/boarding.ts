// js/app/boarding.ts
// GTA-style boarding (F, the gamepad's Y, the touch button): on foot, get into the nearest of the player's own vehicles,
// take the nearest car, bicycle or moto from the traffic (its driver is left in the street), rob a store's till, buy
// from a taco stand or go in through a door; in a vehicle, get out (a helicopter once it has landed). In multiplayer,
// by a friend's car, get in with them (and F again gets out). And the prompt for what F would do here.
import type { ThirdPersonControllerManager, LeftCar, VehicleMode } from '../player/controllers.ts';
import type { TrafficSystem } from '../sim/traffic.ts';
import type { CrimeSystem } from '../sim/crime.ts';
import type { StoreTill } from '../world/store-interiors.ts';
import type { Interiors } from '../world/interiors.ts';
import type { StreetFood } from '../world/street-food.ts';

const BOARD_REACH = 1.6; // m from the vehicle's body
const TILL_REACH = 1.8; // m from a store's till (store-interiors.ts)
const TILL_REFILL = 600; // s: a robbed till stays empty this long
const PROMPT_NAMES: Readonly<Record<VehicleMode, string>> = {
  car: 'Subir al coche', cyclist: 'Subir a la bici', moto: 'Subir a la moto', helicopter: 'Subir al helicóptero'
};

/** A vehicle of the traffic the player can take */
type TrafficVehicle = NonNullable<ReturnType<TrafficSystem['vehicleNear']>>;
/** What F would act on, on foot */
type BoardTarget =
  | { taken: TrafficVehicle }
  | { mode: VehicleMode; left: LeftCar | undefined }
  | { till: StoreTill };

export interface BoardingSystems {
  controllers: ThirdPersonControllerManager;
  traffic: TrafficSystem;
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
    const { controllers, traffic, tills } = this.systems;
    // (not while lying in the road, thrown out of a car)
    if (controllers.activeMode !== 'person' || controllers.entities.person.ragdoll) return null;
    const p = controllers.entities.person.position;
    const own = controllers.ownVehicleNear(BOARD_REACH);
    const taken = traffic.vehicleNear(p.x, p.z, own ? Math.min(BOARD_REACH, own.distance) : BOARD_REACH);
    if (taken) return { taken };
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
      crime.toast('The till is empty');
      return;
    }
    const amount = Math.round(400 + Math.random() * 1100);
    crime.money += amount;
    crime.toast(`+$${amount} · ${till.store.name}`);
    crime.report('robbery', true);
    traffic.panic(till.x, till.z, 45);
    till.refill = now + TILL_REFILL;
  }

  /** F */
  board(): void {
    const { controllers, traffic, crime, interiors, streetFood, mapOpen, onModeChange } = this.systems;
    if (mapOpen() || crime.state !== 'play') return;
    if (this.ride?.riding) {
      this.ride.leaveRide();
      onModeChange();
      return;
    }
    if (controllers.activeMode !== 'person') {
      if (controllers.exitVehicle()) onModeChange();
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
      // taking a patrol car is always a crime; any other car, if the police see it
      const p = controllers.entities.person.position;
      if (taken.kind === 'car' && taken.police) crime.report('stealCop');
      else crime.report('carjack', crime.copNear(p.x, p.z, 40));
    } else if (target.left) {
      controllers.takeLeftCar(target.left);
    } else {
      controllers.enterVehicle(target.mode);
    }
    onModeChange();
  }

  /** What F would do here ('' for nothing) */
  prompt(): string {
    const { controllers, interiors, streetFood } = this.systems;
    if (this.ride?.riding) return 'Bajar del coche';
    const friend = this.ride?.rideTarget();
    if (friend) return `Subir con ${friend.name}`;
    if (controllers.activeMode === 'person') {
      const target = this.target();
      if (!target) return (interiors.active ? '' : streetFood.prompt()) || interiors.prompt();
      if ('till' in target) return 'Asaltar la caja';
      if ('mode' in target) return PROMPT_NAMES[target.mode];
      const v = target.taken;
      return v.bike ? 'Robar la bici' : v.moto ? 'Robar la moto' : v.isPolice ? 'Robar la patrulla' : v.bus ? 'Robar el camión' : v.fleet === 'combi' ? 'Robar la combi' : 'Robar el coche';
    }
    if (controllers.activeMode === 'helicopter') {
      const h = controllers.entities.helicopter;
      const air = h.position.y - controllers.getGroundHeight(h.position.x, h.position.z, 'helicopter');
      return air > 3 ? 'Aterriza para bajar' : 'Bajar del helicóptero';
    }
    return '';
  }
}
