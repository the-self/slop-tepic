// js/models/cars/chinese.ts
// The Chinese makes that came to Mexico in the 2020s, with their dealers on Insurgentes: JAC (assembled in Ciudad
// Sahagún), Chirey (Chery), Changan and Geely. MG and BYD are in premium.ts & electric.ts. Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'jac-sei4-pro', name: 'Yac Sei Cuatro Pro', body: 'crossover', class: 'economy',
    size: [4.41, 1.80, 1.66], mass: 1400, drive: 'fwd', power: [110, 5500], torque: [210, 2000], redline: 6200,
    gears: 6, top: 185, accel: 10.5, rarity: 1.5
  },
  {
    id: 'chirey-tiggo-4-pro', name: 'Chiréi Tigrito 4 Pro', body: 'suv', class: 'economy',
    size: [4.32, 1.83, 1.66], mass: 1400, drive: 'fwd', power: [108, 5500], torque: [210, 1750], redline: 6200,
    gears: 6, top: 180, accel: 10.8, rarity: 2.5
  },
  {
    id: 'chirey-tiggo-7-pro', name: 'Chiréi Tigrito 7 Pro', body: 'suv', class: 'family',
    size: [4.50, 1.84, 1.71], mass: 1580, drive: 'fwd', power: [145, 5500], torque: [290, 2000], redline: 6200,
    gears: 7, top: 190, accel: 9.5, rarity: 1.5
  },
  {
    id: 'changan-cs35-plus', name: 'Changán CS35 Plus', body: 'crossover', class: 'economy',
    size: [4.34, 1.83, 1.66], mass: 1460, drive: 'fwd', power: [118, 5500], torque: [260, 1500], redline: 6200,
    gears: 7, top: 190, accel: 9.8, rarity: 1
  },
  {
    id: 'geely-coolray', name: 'Yili Fresquito', body: 'crossover', class: 'family',
    size: [4.33, 1.80, 1.61], mass: 1415, drive: 'fwd', power: [130, 5500], torque: [255, 1500], redline: 6200,
    gears: 7, top: 200, accel: 7.9, rarity: 1
  }
];
