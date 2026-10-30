// js/sim/crime-rules.ts
// The rules of the street: the wanted level (heat from crimes, one to five stars, lost by staying out of the
// police's sight), the gangs (their turf: gang-turf.ts), and how many police each star sends. No three.js, so node
// --test imports it directly (tests/crime-rules.test.mjs). crime.ts plays them out.

import type { WeaponId } from './weapons.ts';
import { wrapAngle } from './weapons.ts';

// Heat at which each star is reached (index = stars)
const STAR_HEAT: readonly number[] = [0, 10, 60, 150, 320, 560];
const MAX_HEAT = 800;
// Heat each crime adds when the police witness it (crime.ts witnessed: an officer, a patrol car or the helicopter in
// sight of it; crimes against the police themselves always count, and a store's staff call a robbery in). Running
// someone over in front of a patrol: the first one is a star, the third two. Driving into a patrol car is a star of
// its own; the second, two.
const CRIME_HEAT = {
  runOver: 22,
  punch: 12,
  shootPed: 35,
  shootCar: 5,
  gunfire: 3,
  carjack: 15,
  hitCop: 70,
  ramCop: 35,
  shootCop: 110,
  killCop: 170,
  explosion: 45,
  stealCop: 60,
  robbery: 70 // a store's till (app/boarding.ts): two stars, the staff call the police
};
// A crime Wanted.report() knows
type CrimeKind = keyof typeof CRIME_HEAT;

// The guns the police and the gangs carry
type StreetGun = Extract<WeaponId, 'pistol' | 'smg' | 'rifle'>;

// The police each star sends after the player: officers on foot and patrol cars; from four stars the army too
// (soldiers with rifles, on foot and in their trucks) and a helicopter whose gunner shoots from the door (each array
// indexed by stars, 0..5)
interface PoliceByStars {
  foot: readonly number[];
  cruisers: readonly number[];
  soldiers: readonly number[];
  armyTrucks: readonly number[];
  helicopter: readonly boolean[];
  shoots: readonly boolean[];
  weapon: readonly (StreetGun | null)[];
  speed: readonly number[];
}
const POLICE: PoliceByStars = {
  foot: [0, 2, 3, 4, 5, 6],
  cruisers: [0, 1, 2, 3, 4, 5],
  soldiers: [0, 0, 0, 0, 3, 6],
  armyTrucks: [0, 0, 0, 0, 1, 2],
  helicopter: [false, false, false, false, true, true],
  shoots: [false, false, true, true, true, true], // one star: they only come to arrest
  weapon: [null, null, 'pistol', 'pistol', 'smg', 'smg'],
  speed: [0, 15, 18, 21, 24, 27] // m/s the patrol cars drive at
};

// Seconds out of the police's sight it takes to lose a star
const evadeTime = (stars: number): number => 10 + stars * 5;

// The police's eyes, flat: SIGHT numbers each (crime/types.ts SightCones: x, z, reach, heading, half angle, near).
// Whether (x, z) is in the eyes at `i` in `cones`: within `near` m all round (someone right beside them), or within
// their reach and no further than their half angle off where they look. (Walls are the caller's: crime.ts update.)
const SIGHT = 6;
function inSight(cones: readonly number[], i: number, x: number, z: number): boolean {
  const dx = x - cones[i], dz = z - cones[i + 1];
  const d = Math.hypot(dx, dz);
  if (d < cones[i + 5]) return true;
  if (d >= cones[i + 2]) return false;
  const half = cones[i + 4];
  return half >= Math.PI || Math.abs(wrapAngle(Math.atan2(dx, dz) - cones[i + 3])) <= half;
}

const starsFor = (heat: number): number => {
  let stars = 0;
  for (let i = 1; i < STAR_HEAT.length; i++) if (heat >= STAR_HEAT[i]) stars = i;
  return stars;
};

class Wanted {
  heat = 0;
  stars = 0; // 0..5
  unseen = 0; // s since the police last saw the player

  constructor() {
    this.clear();
  }

  clear(): void {
    this.heat = 0;
    this.stars = 0;
    this.unseen = 0; // s since the police last saw the player
  }

  // A crime of `kind` (CRIME_HEAT); unwitnessed crimes go unpunished. Returns the stars gained.
  report(kind: CrimeKind, witnessed = true): number {
    if (!witnessed || !Object.hasOwn(CRIME_HEAT, kind)) return 0;
    const before = this.stars;
    this.heat = Math.min(MAX_HEAT, this.heat + CRIME_HEAT[kind]);
    this.stars = Math.max(this.stars, starsFor(this.heat));
    this.unseen = 0;
    return this.stars - before;
  }

  // Stars stay while the police can see the player; out of sight long enough, they drop one at a time
  update(dt: number, seen: boolean): void {
    if (this.stars === 0) {
      this.heat = Math.max(0, this.heat - dt * 2);
      return;
    }
    this.unseen = seen ? 0 : this.unseen + dt;
    if (this.unseen >= evadeTime(this.stars)) {
      this.stars--;
      this.heat = this.stars ? STAR_HEAT[this.stars] : 0;
      this.unseen = 0;
    }
  }

  // 0..1: how close the player is to losing the next star (for the HUD's flashing stars)
  get evading(): number {
    return this.stars ? Math.min(1, this.unseen / evadeTime(this.stars)) : 0;
  }
}

// Two street gangs share the town's turf: Los Rojos shoot at whoever comes close, Los Verdes only at whoever starts
// it. Out on the town's edges the (made-up) Cártel de la Sierra holds colonias with rifles: they shoot on sight,
// fight the police wherever they meet, and send trucks of reinforcements after whoever takes them on (crime.ts).
// outfit: the colours they wear (pedestrians.ts OUTFIT); sight: m they open fire from
interface Gang {
  id: number; // its index in GANGS
  name: string;
  outfit: number;
  hostile: boolean; // shoots at whoever comes close, not only at whoever starts it
  weapon: StreetGun;
  sight: number;
  narco?: boolean;
}
const GANGS: readonly Gang[] = [
  { id: 0, name: 'Los Rojos', outfit: 2, hostile: true, weapon: 'smg', sight: 15 },
  { id: 1, name: 'Los Verdes', outfit: 3, hostile: false, weapon: 'pistol', sight: 15 },
  { id: 2, name: 'Cártel de la Sierra', outfit: 5, hostile: true, weapon: 'rifle', sight: 28, narco: true }
];
const NARCO = 2; // GANGS index

export type { CrimeKind, StreetGun, PoliceByStars, Gang };
export { STAR_HEAT, CRIME_HEAT, POLICE, GANGS, NARCO, Wanted, SIGHT, starsFor, evadeTime, inSight };
