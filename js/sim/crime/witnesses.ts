// js/sim/crime/witnesses.ts
// Who sees a crime (sim/crime.ts): no witness from the police, no stars. An officer on foot within COP_SIGHT, a
// patrol car (the chase's or the traffic's own) within CRUISER_SIGHT, past the buildings; the helicopter from above
// within HELI_SIGHT.
import type { Car } from '../traffic.ts';
import { COP_SIGHT, CRUISER_SIGHT, HELI_SIGHT } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';

export function witnessed(crime: CrimeSystem, x: number, z: number): boolean {
  for (const a of crime.agents) {
    if (a.kind !== 'cop' || a.fallen) continue;
    if (Math.hypot(a.x - x, a.z - z) < COP_SIGHT && crime.clearLine(a.x, a.z, x, z)) return true;
  }
  for (const cr of crime.cruisers) {
    if (!cr.active || cr.wreck || !cr.police) continue;
    if (Math.hypot(cr.x - x, cr.z - z) < CRUISER_SIGHT && crime.clearLine(cr.x, cr.z, x, z)) return true;
  }
  const h = crime.heli;
  if (h.active && h.state !== 'down' && Math.hypot(h.x - x, h.z - z) < HELI_SIGHT) return true;
  return trafficPatrolSees(crime, x, z) !== null;
}

// The nearest of the traffic's patrol cars on the road that sees (x, z) within CRUISER_SIGHT, or null
export function trafficPatrolSees(crime: CrimeSystem, x: number, z: number): Car | null {
  let best: Car | null = null;
  let bestD = CRUISER_SIGHT;
  for (const v of crime.trafficPolice) {
    if (!v.edge || v.wrecked) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d < bestD && crime.clearLine(v.x, v.z, x, z)) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
