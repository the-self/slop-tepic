// js/models/motos/index.ts
// Motorcycles, with the same fields as the car models (../cars/README.md; body 'moto', mass with its rider, `rarity` how
// often the traffic's motorcyclists ride one). Italika, Mexico's best-selling make, is what most of Tepic rides; once
// in a while a Yamaha MT-09 goes by, strong enough to lift its front wheel. The player's moto is the FT150 parked near
// the start, or whichever they take from the traffic.

import type { CarModel } from '../cars/index.ts';

const MOTO_MODELS: CarModel[] = [
  {
    id: 'italika-ft150', name: 'Italika FT150', body: 'moto', class: 'moto',
    size: [1.98, 0.76, 1.08], mass: 195, drive: 'rwd', power: [8.2, 8000], torque: [11.2, 6000], redline: 9500,
    gears: 5, top: 105, rarity: 20, paints: [0xb3121b, 0x1a1c20, 0x2a5aa8]
  },
  {
    id: 'italika-250z', name: 'Italika 250Z', body: 'moto', class: 'moto',
    size: [2.05, 0.8, 1.12], mass: 230, drive: 'rwd', power: [12.7, 8000], torque: [17, 6500], redline: 9500,
    gears: 5, top: 125, rarity: 6, paints: [0x1a1c20, 0xb3121b, 0xf2f2ee]
  },
  {
    id: 'italika-vort-x-300r', name: 'Italika Vort-X 300R', body: 'moto', class: 'moto',
    size: [2.02, 0.74, 1.1], mass: 215, drive: 'rwd', power: [21.3, 9000], torque: [25, 7000], redline: 10500,
    gears: 6, top: 150, rarity: 3, paints: [0x1a1c20, 0x2a5aa8, 0xe06a1b]
  },
  {
    // (890 cc triple, 119 PS & 93 N·m, 189 kg wet; Yamaha's 0-100 km/h ~3.3 s)
    id: 'yamaha-mt-09', name: 'Yamaha MT-09', body: 'moto', class: 'moto',
    size: [2.09, 0.8, 1.19], mass: 264, drive: 'rwd', power: [87.5, 10000], torque: [93, 7000], redline: 11000,
    gears: 6, top: 230, accel: 3.3, rarity: 0.4, paints: [0x1c2a4a, 0x2b2d31, 0xc9cdd2]
  }
];
const MOTO_MODEL_BY_ID: Partial<Record<string, CarModel>> = Object.fromEntries(MOTO_MODELS.map((m) => [m.id, m]));
const PLAYER_MOTO = (() => {
  const m = MOTO_MODEL_BY_ID['italika-ft150'];
  if (!m) throw new Error("No moto model 'italika-ft150'");
  return m;
})();
const MOTO_SHARE = MOTO_MODELS.reduce((sum, m) => sum + m.rarity, 0);

/** A model for one of the traffic's motorcyclists, by the models' rarity (rand: 0..1) */
function pickMoto(rand = Math.random()): CarModel {
  let r = rand * MOTO_SHARE;
  for (const m of MOTO_MODELS) {
    r -= m.rarity;
    if (r < 0) return m;
  }
  return MOTO_MODELS[MOTO_MODELS.length - 1];
}

export { MOTO_MODELS, MOTO_MODEL_BY_ID, PLAYER_MOTO, pickMoto };
