// js/models/cars/exotic.ts
// Supercars: a once-in-a-while sight on Tepic's streets. Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'porsche-911', name: 'Porchi 911 Carrerita', body: 'coupe', class: 'super',
    size: [4.52, 1.85, 1.30], mass: 1520, drive: 'rwd', power: [283, 6500], torque: [450, 1950], redline: 7500,
    gears: 8, top: 293, accel: 4.2, rarity: 0.15, paints: [0xf2f2ee, 0x1a1c20, 0xc0c4c8, 0xe8a200, 0x2a5aa8]
  },
  {
    id: 'ferrari-f8', name: 'Fierrari F8 Tributo', body: 'supercar', class: 'super',
    size: [4.61, 1.98, 1.21], mass: 1480, drive: 'rwd', power: [530, 8000], torque: [770, 3250], redline: 8000,
    gears: 7, top: 340, accel: 2.9, rarity: 0.05, paints: [0xc8102e, 0xc8102e, 0xe8c200, 0x1a1c20]
  },
  {
    id: 'lamborghini-huracan', name: 'Lamborjini Ciclón EVO', body: 'supercar', class: 'super',
    size: [4.52, 1.93, 1.17], mass: 1470, drive: 'awd', power: [470, 8000], torque: [600, 6500], redline: 8500,
    gears: 7, top: 325, accel: 2.9, rarity: 0.05, paints: [0x7fbf2a, 0xe89a00, 0xf2f2ee, 0x1a1c20]
  }
];
