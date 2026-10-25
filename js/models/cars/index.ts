// js/models/cars/index.ts
// Every car model, from the makes' files (README.md: how to add one): by id, by body shape, and the weighted draw the
// traffic uses so that best sellers fill the streets and supercars turn up once in a long while.
import { CARS as nissan } from './nissan.ts';
import { CARS as chevrolet } from './chevrolet.ts';
import { CARS as volkswagen } from './volkswagen.ts';
import { CARS as toyota } from './toyota.ts';
import { CARS as honda } from './honda.ts';
import { CARS as mazda } from './mazda.ts';
import { CARS as kiaHyundai } from './kia-hyundai.ts';
import { CARS as ford } from './ford.ts';
import { CARS as stellantis } from './stellantis.ts';
import { CARS as electric } from './electric.ts';
import { CARS as premium } from './premium.ts';
import { CARS as exotic } from './exotic.ts';
import type { BodyShapeName } from '../bodies.ts';

/** The body shapes a model is drawn with: actor-models.ts's own, bodies.ts's, the bus and the motorcycle */
export type CarBody = 'sedan' | 'taxi' | 'suv' | 'pickup' | 'van' | 'hatch' | BodyShapeName | 'bus' | 'moto';
/** Tyres & brakes (drivetrain.ts CLASSES), and the paints when a model has none of its own */
export type CarClass = 'economy' | 'family' | 'truck' | 'premium' | 'sport' | 'super' | 'moto';

/** A car (or motorcycle) model's real figures: README.md says what each field means */
export interface CarModel {
  id: string; // unique, `make-model`
  name: string; // what the HUD shows
  body: CarBody;
  class: CarClass;
  size: [length: number, width: number, height: number]; // m
  mass: number; // kg with a driver (a moto: with its rider)
  drive: 'fwd' | 'rwd' | 'awd';
  power: [kW: number, rpm: number]; // peak power
  torque: [Nm: number, rpm: number]; // peak torque
  redline: number; // rpm (an EV: its motor's top rpm)
  gears: number; // forward gears (an EV: 1)
  top: number; // top speed, km/h
  limited?: boolean; // an electronic limiter sets the top speed
  accel?: number; // 0-100 km/h, s (the maker's figure)
  electric?: boolean; // battery-electric: one gear, full torque from 0 rpm, regenerative braking
  rarity: number; // weight in the traffic draw (~20 for the best sellers, 0.05 for a Ferrari), 0 for never
  paints?: number[]; // body colours (hex)
  glb?: string; // a 3D model of it (assets/models/cars/<id>.glb: white, nose to +z, at its real length), drawn near the camera instead of its body shape
  traffic?: boolean; // false keeps it out of the random traffic
  nitro?: boolean; // whether it has a nitrous kit (by default the sport and super cars do, electric ones never)
  wheelRadius?: number; // m, when the body shape's own doesn't fit
}

const CAR_MODELS: CarModel[] = [
  ...nissan, ...chevrolet, ...volkswagen, ...toyota, ...honda, ...mazda, ...kiaHyundai, ...ford, ...stellantis,
  ...electric, ...premium, ...exotic
];
const CAR_MODEL_BY_ID: Partial<Record<string, CarModel>> = Object.fromEntries(CAR_MODELS.map((m) => [m.id, m]));
// (the models the taxi & police slots are drawn with: a typo in an id fails here, at load)
const modelById = (id: string): CarModel => {
  const m = CAR_MODEL_BY_ID[id];
  if (!m) throw new Error(`No car model '${id}'`);
  return m;
};
const TAXI_MODEL = modelById('nissan-tsuru');
const POLICE_MODEL = modelById('dodge-charger-pursuit');
// The camiones on Tepic's routes run on front-engined Mercedes-Benz Boxer OF chassis (OM 924 LA: 160 kW at 2200 rpm,
// 810 N·m from 1200 rpm, 17 t gross); this one, ~11.5 t with its passengers, is what the player drives off in after
// taking one off its route. Never drawn into the car traffic: the buses run as buses (traffic.ts)
const BUS_MODEL: CarModel = {
  id: 'mercedes-boxer-of', name: 'Mercedes-Benz Boxer OF 1722', body: 'bus', class: 'truck', traffic: false, rarity: 0,
  size: [11.6, 2.6, 3.0], mass: 11500, drive: 'rwd', power: [160, 2200], torque: [810, 1400], redline: 2600,
  gears: 6, top: 90, limited: true, wheelRadius: 0.48
};
CAR_MODEL_BY_ID[BUS_MODEL.id] = BUS_MODEL;

// Body colours by class when a model has none of its own (white, silver & grey cars are most of Mexico's fleet)
const PAINTS: Partial<Record<CarClass, number[]>> & { economy: number[] } = {
  economy: [0xf2f2ee, 0xf2f2ee, 0xcfd6de, 0xcfd6de, 0x52575e, 0x1c2026, 0x9e1b22, 0x1d3b6c, 0x6e1f24],
  family: [0xf2f2ee, 0xcfd6de, 0x52575e, 0x1c2026, 0x1d3b6c, 0x6e1f24, 0x3a434d],
  truck: [0xf2f2ee, 0xcfd6de, 0x1c2026, 0x52575e, 0x6e1f24, 0x28382e],
  premium: [0x1c2026, 0xf2f2ee, 0x52575e, 0x1d3b6c],
  sport: [0xb3121b, 0x1c2026, 0xf2f2ee, 0x2a5aa8],
  super: [0xc8102e, 0xe8a200, 0x1c2026, 0xf2f2ee]
};
const paintsOf = (m: CarModel): number[] => m.paints ?? PAINTS[m.class] ?? PAINTS.economy;

// The models that drive in traffic with each body shape, and each shape's share of the traffic (its models' rarity)
const TRAFFIC_MODELS = CAR_MODELS.filter((m) => m.traffic !== false && m.rarity > 0);
const BY_BODY: Partial<Record<string, CarModel[]>> = {};
for (const m of TRAFFIC_MODELS) (BY_BODY[m.body] ??= []).push(m);
const BODY_SHARE: Record<string, number> = Object.fromEntries(Object.entries(BY_BODY).map(([body, list = []]) => [body, list.reduce((s, m) => s + m.rarity, 0)]));

// A model with this body shape, drawn by rarity (rand: 0..1)
function pickModel(body: string, rand = Math.random()): CarModel | null {
  const list = BY_BODY[body];
  if (!list) return body === 'taxi' ? TAXI_MODEL : null;
  let r = rand * BODY_SHARE[body];
  for (const m of list) {
    r -= m.rarity;
    if (r < 0) return m;
  }
  return list[list.length - 1];
}

// A body shape for a traffic slot, drawn by the shapes' shares (rand: 0..1)
function pickBody(rand = Math.random()): string {
  const total = Object.values(BODY_SHARE).reduce((s, w) => s + w, 0);
  let r = rand * total;
  for (const [body, w] of Object.entries(BODY_SHARE)) {
    r -= w;
    if (r < 0) return body;
  }
  return 'sedan';
}

export { CAR_MODELS, CAR_MODEL_BY_ID, TAXI_MODEL, POLICE_MODEL, BUS_MODEL, BODY_SHARE, paintsOf, pickModel, pickBody };
