// js/sim/traffic/mishaps.ts
// The traffic's own crashes, rare: now and then (MISHAP_EVERY) a driver near the player, in sight of it, looks down at
// their phone a few seconds short of a car stopped ahead (the back of a queue at a light), doesn't brake (driving.ts)
// and runs into it. Both go into Jolt (crashes.ts), which takes the crash from there; the collision it reports brings the
// ambulance (main.ts, sim/emergency.ts).
import { CRASH_RANGE, MISHAP_EVERY, onRoad } from './constants.ts';
import type { Car } from './types.ts';
import type { TrafficState } from './state.ts';
import { visible } from './view.ts';
import { crash } from './crashes.ts';

const LOOK_AWAY = 6; // s at most a driver doesn't look (then it brakes, if it still can)
const CLOSING = 5; // m/s at least it is going at (and on speeding up, not braking: a crash that is heard and seen)
const STOPPED = 2.5; // m/s at most the car ahead is going at (stopped, or creeping in a queue)
const SHORT = 4; // s at most it is from it (before the queue moves off)
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// The car v is closing on in its lane: ahead within `reach` m, within 1.4 m of its line, going its way; a car of the
// traffic (not a bus nor a bike: those Jolt doesn't take), or null
function carAhead(ts: TrafficState, v: Car, reach: number): Car | null {
  let best: Car | null = null, bestD = reach;
  for (const o of ts.cars) {
    if (o === v || !o.edge || o.crash) continue;
    const dx = o.x - v.x, dz = o.z - v.z;
    const along = dx * v.tx + dz * v.tz;
    if (along <= 0 || along > bestD || Math.abs(dx * v.tz - dz * v.tx) > 1.4 || o.tx * v.tx + o.tz * v.tz < 0.8) continue;
    best = o;
    bestD = along;
  }
  return best;
}

function lookUp(ts: TrafficState): void {
  const m = ts.mishap;
  if (m.v) m.v.distracted = 0;
  m.v = m.o = null;
}

// Per frame, after the traffic has driven: the distracted driver closing in (and striking), or one looked for
function mishaps(ts: TrafficState, dt: number): void {
  const m = ts.mishap;
  const v = m.v, o = m.o;
  if (v) {
    // (taken out of the traffic meanwhile, and maybe placed again elsewhere: retireVehicle has it look up)
    if (!(v.distracted > 0) || !o || o.crash || !o.edge || !v.edge || v.crash || v.distracted > LOOK_AWAY) {
      lookUp(ts);
      return;
    }
    v.distracted += dt;
    if (v.gap < 0.6) {
      // struck: both thrown about in Jolt (v at its speed, into o)
      if (crash(ts, v)) crash(ts, o);
      lookUp(ts);
    }
    return;
  }
  if (ts.clock < m.next || !ts.physics || ts.crashed.length) return;
  m.next = ts.clock + 0.25; // (no one to be had now: looked for again in a moment)
  for (const c of ts.cars) {
    if (!onRoad(c) || c.conn || c.crash || c.wrecked || c.isPolice || c.fleet || c.speed < CLOSING) continue;
    if (c.gap < 6 || c.gap > c.speed * SHORT || c.leaderSpeed > STOPPED) continue;
    // (near enough for Jolt to take the crash, crashes.ts CRASH_RANGE, and where the player can see it)
    const d = Math.hypot(c.x - ts.player.x, c.z - ts.player.z);
    if (d < 8 || d > CRASH_RANGE - 3 || !visible(ts, c.x, c.z, 3, (c.hy ?? 0) + 1)) continue;
    const ahead = carAhead(ts, c, c.gap + c.half + 12);
    if (!ahead || ahead.speed > STOPPED) continue;
    c.distracted = dt;
    m.v = c;
    m.o = ahead;
    m.next = ts.clock + rnd(...MISHAP_EVERY);
    return;
  }
}

export { mishaps };
