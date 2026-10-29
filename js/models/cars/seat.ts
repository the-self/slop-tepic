// js/models/cars/seat.ts
// SEAT (built in Martorell). Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'seat-ibiza', name: 'Siat Ibizita', body: 'hatch', class: 'economy',
    size: [4.06, 1.78, 1.44], mass: 1205, drive: 'fwd', power: [81, 5800], torque: [155, 3800], redline: 6500,
    gears: 5, top: 190, accel: 10.4, rarity: 2
  }
];
