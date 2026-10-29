// js/models/trains.ts
// Ferromex's rolling stock as its trains through Tepic carry it (the Pacific line, Guadalajara to Nogales: grain from
// Sinaloa & Sonora, the plants' new cars, double-stacked containers, cement, scrap & fuel): the GE diesels at the head
// in the company's two liveries, and the cars behind them, at their real sizes and weights. Plain data: the trains'
// schedule (sim/trains/) and their models (actors/vehicles/train.ts) both read it.

/** A kind of rail vehicle */
export type RailCarKind = 'loco' | 'hopper' | 'boxcar' | 'tank' | 'gondola' | 'stack' | 'autorack';

/** What a kind of rail vehicle is like */
export interface RailCarSpec {
  /** m over its couplers: its place in the train */
  length: number;
  /** m */
  width: number;
  /** m over the rails' top */
  height: number;
  /** kg, loaded */
  mass: number;
  /** m from its middle to each truck's pivot */
  trucks: number;
  /** its paints (0xrrggbb), one drawn per car */
  paints: readonly number[];
}

/** The rail vehicles: their sizes from the builders' diagrams (GE ES44AC & AC4400CW, Trinity & Greenbrier cars) */
export const RAIL_CARS: Record<RailCarKind, RailCarSpec> = {
  // the GE Evolution (ES44AC) and AC4400CW: 73 ft 2 in over the couplers, 15 ft 5 in tall, 188 t
  loco: { length: 22.3, width: 3.13, height: 4.72, mass: 190000, trucks: 7.95, paints: [] },
  // a covered hopper for grain (4750 ft³): its 286,000 lb loaded
  hopper: { length: 18.0, width: 3.25, height: 4.6, mass: 130000, trucks: 6.95, paints: [0xa8acae, 0xd6d2c6, 0x8a5a3c, 0x6e7276, 0xc4b08a] },
  // a 60 ft boxcar: boxcar red, Ferromex's red, teal, TTX yellow, grey, blue
  boxcar: { length: 19.4, width: 3.2, height: 5.15, mass: 100000, trucks: 7.3, paints: [0x7a2e22, 0xa8231d, 0x1f5f5b, 0xd8a419, 0x4a5258, 0x2f4e78] },
  // a general-service tank car (fuel, molasses, chemicals)
  tank: { length: 18.4, width: 3.2, height: 4.6, mass: 120000, trucks: 7.0, paints: [0x1b1c1e, 0xe2e2de, 0x5c6066, 0x1b1c1e] },
  // a mill gondola: scrap, rail, pipe
  gondola: { length: 16.6, width: 3.2, height: 2.6, mass: 100000, trucks: 6.2, paints: [0x2a2622, 0x5b3a26, 0x7a2e22, 0x3d4a3a] },
  // a 40 ft well car, two containers stacked in it: their colours, the lines' (the car itself is dark)
  stack: { length: 18.6, width: 3.0, height: 5.95, mass: 70000, trucks: 7.6, paints: [0x2a6fb0, 0xb3261e, 0x2f7d4f, 0xe2e2df, 0x8a8f94, 0xd96c1e, 0x7d2a5a, 0x1d3f6e] },
  // an enclosed autorack (89 ft): the plants' new cars, three decks of them behind its perforated sides
  autorack: { length: 27.4, width: 3.25, height: 5.6, mass: 60000, trucks: 9.75, paints: [0xd9d9d6, 0x9ea2a6, 0x5a6066, 0x7a2e22] }
};

/** A locomotive's paint: 0 the red, teal & white Ferromex of 1998, 1 the charcoal & red chevrons of 2017 (GMXT) */
export type Livery = 0 | 1;

/** What a train carries: a unit train of grain, a manifest of everything, containers, new cars */
export type ConsistKind = 'grain' | 'manifest' | 'intermodal' | 'autos';
export const CONSIST_KINDS: readonly ConsistKind[] = ['grain', 'manifest', 'intermodal', 'autos'];

/** Each kind of train: how often it runs (a weight), and its cars by their share of it */
export const CONSISTS: Record<ConsistKind, { weight: number; cars: readonly (readonly [RailCarKind, number])[] }> = {
  grain: { weight: 0.35, cars: [['hopper', 1]] },
  manifest: { weight: 0.35, cars: [['boxcar', 0.3], ['tank', 0.25], ['hopper', 0.25], ['gondola', 0.2]] },
  intermodal: { weight: 0.2, cars: [['stack', 1]] },
  autos: { weight: 0.1, cars: [['autorack', 0.8], ['boxcar', 0.2]] }
};
