// js/models/cars/volkswagen.ts
// Volkswagen (built in Puebla). Fields: README.md

import type { CarModel } from './index.ts';

export const CARS: CarModel[] = [
  {
    id: 'volkswagen-vento', name: 'Vochowagen Viento', body: 'sedan', class: 'economy',
    size: [4.39, 1.70, 1.47], mass: 1170, drive: 'fwd', power: [81, 5250], torque: [155, 3800], redline: 6200,
    gears: 5, top: 185, accel: 11.5, rarity: 14
  },
  {
    // the Vento's successor (since 2023), with the 1.6 MSI most of them have
    id: 'volkswagen-virtus', name: 'Vochowagen Virtud', body: 'sedan', class: 'economy',
    size: [4.56, 1.75, 1.48], mass: 1190, drive: 'fwd', power: [81, 5750], torque: [155, 4000], redline: 6250,
    gears: 6, top: 185, accel: 11.2, rarity: 8
  },
  {
    id: 'volkswagen-jetta', name: 'Vochowagen Yeta', body: 'sedan', class: 'family',
    size: [4.70, 1.80, 1.46], mass: 1370, drive: 'fwd', power: [110, 5000], torque: [250, 1750], redline: 6500,
    gears: 8, top: 210, accel: 8.6, rarity: 10
  },
  {
    id: 'volkswagen-gol', name: 'Vochowagen Golazo', body: 'hatch', class: 'economy',
    size: [3.89, 1.66, 1.46], mass: 1000, drive: 'fwd', power: [74, 5250], torque: [155, 4000], redline: 6200,
    gears: 5, top: 180, accel: 11.0, rarity: 14
  },
  {
    id: 'volkswagen-tiguan', name: 'Vochowagen Tigüán', body: 'suv', class: 'family',
    size: [4.70, 1.84, 1.67], mass: 1620, drive: 'fwd', power: [110, 5000], torque: [250, 1500], redline: 6500,
    gears: 6, top: 195, accel: 9.2, rarity: 4
  },
  {
    id: 'volkswagen-golf-gti', name: 'Vochowagen Golfo GTI', body: 'hatch', class: 'sport',
    size: [4.28, 1.79, 1.44], mass: 1450, drive: 'fwd', power: [180, 5000], torque: [370, 1600], redline: 6700,
    gears: 7, top: 250, limited: true, accel: 6.3, rarity: 0.8, paints: [0xc8102e, 0xf2f2ee, 0x1a1c20, 0x52575e]
  }
];
