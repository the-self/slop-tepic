// js/sim/traffic/signals.ts
// The signals as the traffic reads them: the light at the end of an edge, and whether a crosswalk has the WALK
import type { TrafficEdge } from './types.ts';
import type { TrafficState } from './state.ts';

const phaseOf = (ts: TrafficState, e: TrafficEdge) => (e.axisIndex === 0 ? ts.avePhase : ts.stPhase);

// Do people on crosswalk `side` have the WALK? Across the avenue with the cross street's traffic, across the street
// with the avenue's.
const walkOn = (ts: TrafficState, side: number) => (side >= 2 ? ts.stWalk : ts.aveWalk);

export { phaseOf, walkOn };
