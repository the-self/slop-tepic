// js/models/cars/mitsubishi.ts
// Mitsubishi (from Thailand & Indonesia). Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'mitsubishi-l200', name: 'Mitsubichi L-Doscientas', body: 'pickup', class: 'truck',
    size: [5.31, 1.82, 1.80], mass: 1950, drive: 'rwd', power: [133, 3500], torque: [430, 2500], redline: 4500,
    gears: 6, top: 175, accel: 11.5, rarity: 2
  },
  {
    id: 'mitsubishi-xpander', name: 'Mitsubichi Expánder', body: 'van', class: 'family',
    size: [4.48, 1.75, 1.70], mass: 1310, drive: 'fwd', power: [77, 6000], torque: [141, 4000], redline: 6500,
    gears: 5, top: 165, accel: 13.5, rarity: 1.5
  }
];
