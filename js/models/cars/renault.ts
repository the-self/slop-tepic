// js/models/cars/renault.ts
// Renault (the Kwid from India, the Duster from Brazil). Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'renault-kwid', name: 'Renó Cuid', body: 'hatch', class: 'economy',
    size: [3.73, 1.58, 1.48], mass: 905, drive: 'fwd', power: [49, 5500], torque: [94, 4250], redline: 6200,
    gears: 5, top: 150, accel: 14.6, rarity: 6
  },
  {
    id: 'renault-duster', name: 'Renó Polvito', body: 'suv', class: 'economy',
    size: [4.34, 1.82, 1.69], mass: 1275, drive: 'fwd', power: [84, 5500], torque: [156, 4000], redline: 6200,
    gears: 5, top: 170, accel: 11.9, rarity: 4
  }
];
