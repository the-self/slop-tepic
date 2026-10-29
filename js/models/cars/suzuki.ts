// js/models/cars/suzuki.ts
// Suzuki (from India & Japan). Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'suzuki-swift', name: 'Suzuqui Suiftito', body: 'hatch', class: 'economy',
    size: [3.86, 1.74, 1.50], mass: 995, drive: 'fwd', power: [61, 5700], torque: [112, 4500], redline: 6500,
    gears: 5, top: 175, accel: 12.0, rarity: 4
  },
  {
    id: 'suzuki-vitara', name: 'Suzuqui Vitamina', body: 'crossover', class: 'family',
    size: [4.18, 1.78, 1.61], mass: 1220, drive: 'fwd', power: [86, 6000], torque: [156, 4400], redline: 6500,
    gears: 6, top: 180, accel: 11.5, rarity: 2
  }
];
