// js/sim/traffic/sidewalks.ts
// The tracks people walk (pedestrian-routes.ts), and the curbs of the crosswalks they queue at and step off on the WALK
import type { Ped, TrafficEdge, TrafficNode } from './types.ts';
import type { TrafficState } from './state.ts';
import { walkOn } from './signals.ts';
import { leadOf } from './occupancy.ts';
import { canStop } from './right-of-way.ts';

const KERB = 1.6; // how far along a crosswalk track pedestrians wait to cross (the curb is 2 m along)
function sidewalkTrack(ts: TrafficState, e: TrafficEdge | undefined): boolean {
  if (!e) return false;
  const choices = ts.pedRoutes.along(e);
  if (!choices.length) return false;
  const route = choices[Math.floor(Math.random() * choices.length)];
  Object.assign(ts.track, route, { route });
  return true;
}

function crosswalkTrack(ts: TrafficState, n: TrafficNode): boolean {
  const choices = ts.pedRoutes.across(n);
  if (!choices.length) return false;
  const route = choices[Math.floor(Math.random() * choices.length)];
  Object.assign(ts.track, route, { route });
  return true;
}

// Who is at (or just past) the curbs of each intersection's crosswalks, for whoever comes up behind to queue
const QUEUE_GAP = 0.62; // m from one person standing in a queue to the next
const curbProgress = (p: Ped) => (p.dir > 0 ? p.t : p.len - p.t); // m along its way over (the curb it waits at is KERB)
function atCurb(ts: TrafficState, p: Ped): void {
  const crossing = p.node ? undefined : p.nextRoute?.find((leg, i) => i >= p.nextLeg && leg.track.node);
  const n = p.node ?? crossing?.track.node;
  if (!n || (p.node && curbProgress(p) > KERB + 0.5) || n.curb.includes(p)) return;
  if (!n.curb.length) ts.curbNodes.push(n);
  n.curb.push(p);
}
function gatherCurbs(ts: TrafficState): void {
  for (const n of ts.curbNodes) n.curb.length = 0;
  ts.curbNodes.length = 0;
  for (const p of ts.peds) if (p.placed && !p.fallen) atCurb(ts, p);
}

// May p step off the curb onto its crosswalk? On the WALK (early in the parallel traffic's green, so red for the
// traffic arriving over it), once no vehicle is crossing it or committed to, and none is too close to stop
function mayCross(ts: TrafficState, p: Ped): boolean {
  const n = p.node;
  if (!n || !walkOn(ts, p.side) || n.crossing[p.side] > 0) return false;
  const e = n.approach[p.side];
  if (!e) return true;
  for (const list of e.occ) {
    const lead = leadOf(list);
    if (lead && !canStop(ts, lead, e, true)) return false;
  }
  return true;
}

export { KERB, sidewalkTrack, crosswalkTrack, QUEUE_GAP, curbProgress, atCurb, gatherCurbs, mayCross };
