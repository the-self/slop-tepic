// js/sim/traffic/signals.ts
// The signals as the traffic reads them: the light at the end of an edge, and whether a crosswalk has the WALK
import type { TrafficEdge, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';

const phaseOf = (ts: TrafficState, e: TrafficEdge) => (e.axisIndex === 0 ? ts.avePhase : ts.stPhase);

// Do people on crosswalk `side` have the WALK? Across the avenue with the cross street's traffic, across the street
// with the avenue's.
const walkOn = (ts: TrafficState, side: number) => (side >= 2 ? ts.stWalk : ts.aveWalk);

// Who goes on a red, giving way to the cross traffic: the police, and anyone pulled over for a siren close behind
// (giveWay, driving.ts), edging through the light as drivers do to let the ambulance or the bomberos by: a queue
// waiting at a red would otherwise shut it in, every lane held (sim/emergency.ts)
const runsRed = (v: Vehicle): boolean => v.isPolice || v.sirenNear || v.fright === 'flee'; // (fleeing gunfire: through anything)

export { phaseOf, walkOn, runsRed };
