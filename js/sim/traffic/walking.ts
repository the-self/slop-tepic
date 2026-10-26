// js/sim/traffic/walking.ts
// Walking the sidewalks: on along connected tracks towards a goal, queueing at curbs, stopping short of cars and
// walls, and meeting to talk
import { clamp } from './constants.ts';
import type { Conversation, Ped, TrafficEdge } from './types.ts';
import type { TrafficState } from './state.ts';
import { walkOn } from './signals.ts';
import { stepBlocked } from './bodies.ts';
import { KERB, QUEUE_GAP, atCurb, curbProgress, mayCross } from './sidewalks.ts';

// Continue through validated sidewalk corners. Crossing tracks retain their curb queues and right of way;
// only a dead end needs a turnaround. Goals guide local choices without a city-wide path search.
const PED_ACCEL = 1.3; // m/s^2 setting off
const PED_BRAKE = 1.6; // m/s^2 easing to a stop
const TURN_TIME = 0.85; // s turning round at the end of the track
const WALL_CHECK = 0.08; // s between a walker's looks for a wall ahead (~0.11 m at a walk)
function walk(ts: TrafficState, p: Ped, dt: number): void {
  if (p.pause > 0) p.pause = Math.max(0, p.pause - dt);
  const ahead = p.dir > 0 ? p.len - p.t : p.t;
  if (ts.clock >= p.goalTime || Math.hypot(p.x - p.goalX, p.z - p.goalZ) < 25) {
    const destination = ts.nearEdges[Math.floor(Math.random() * ts.nearEdges.length)] as TrafficEdge | undefined; // (none yet: no roads near)
    p.goalX = destination ? destination.sx + destination.dx * destination.len * 0.5 : p.x;
    p.goalZ = destination ? destination.sz + destination.dz * destination.len * 0.5 : p.z;
    p.goalTime = ts.clock + 120 + Math.random() * 180;
  }
  if (!p.nextRoute && p.route && ahead < 4) {
    p.nextRoute = ts.pedRoutes.next(p.route, p.dir, p.goalX, p.goalZ);
    p.nextLeg = 0;
    if (!p.node && p.nextRoute) atCurb(ts, p);
  }
  if (!p.node && p.route?.edge && p.t > 6 && p.t < p.len - 6 && ts.clock >= p.restTime && ts.rainNow < 0.3) {
    p.pause = 1.5 + Math.random() * 3;
    p.restTime = ts.clock + 35 + Math.random() * 55;
  }
  let vMax = p.pause > 0 || p.conversation ? 0 : p.speed * (1 + 0.45 * ts.rainNow);
  if (!p.nextRoute) vMax = Math.min(vMax, Math.sqrt(2 * PED_BRAKE * ahead));
  let room = Infinity;
  if (!p.node && p.nextRoute) {
    // A queue can reach back onto the sidewalk. Keep clear before entering its track, including short corner
    // segments; actual separation matters where the approach meets the crossing at an angle.
    const crossing = p.nextRoute.find((leg, i) => i >= p.nextLeg && leg.track.node);
    if (crossing?.track.node) {
      const entranceX = crossing.track.ax + (crossing.dir < 0 ? crossing.track.ux * crossing.track.len : 0);
      const entranceZ = crossing.track.az + (crossing.dir < 0 ? crossing.track.uz * crossing.track.len : 0);
      let leader: Ped | null = null, nearest = Infinity;
      for (const q of crossing.track.node.curb) {
        const next = q.node ? undefined : q.nextRoute?.find((leg, i) => i >= q.nextLeg && leg.track.node);
        const queued = q.node ? q : next?.track;
        if (queued?.node !== crossing.track.node || queued.side !== crossing.track.side || (q.node ? q.dir : next?.dir) !== crossing.dir || Math.abs(queued.line - crossing.track.line) > 0.55) continue;
        const distance = Math.hypot(q.x - entranceX, q.z - entranceZ);
        if (!q.node && distance < nearest) { leader = q; nearest = distance; }
        if (q === p) continue;
        const dx = q.x - p.x, dz = q.z - p.z;
        const forward = (dx * p.ux + dz * p.uz) * p.dir;
        const lateral2 = Math.max(0, dx * dx + dz * dz - forward * forward);
        if (forward >= 0 && lateral2 < QUEUE_GAP * QUEUE_GAP) {
          room = Math.min(room, Math.max(0, forward - Math.sqrt(QUEUE_GAP * QUEUE_GAP - lateral2)));
        }
      }
      if (leader && leader !== p) {
        // The closest arrival merges first. Keep other approaches outside its remaining walking lines,
        // so perpendicular queues cannot trap each other at the entrance after WALK turns green.
        const yieldToLine = (line: { ax: number; az: number; ux: number; uz: number }) => {
          const side = (p.x - line.ax) * line.uz - (p.z - line.az) * line.ux;
          const toward = (p.ux * line.uz - p.uz * line.ux) * p.dir;
          if (side * toward < 0) room = Math.min(room, Math.max(0, (Math.abs(side) - QUEUE_GAP - 0.01) / Math.abs(toward)));
        };
        yieldToLine(leader);
        const legs = leader.nextRoute;
        for (let i = leader.nextLeg; legs && i < legs.length; i++) {
          yieldToLine(legs[i].track);
          if (legs[i].track.node) break;
        }
      }
    }
  }
  if (p.node) {
    // room to walk before standing: up to the curb unless p may cross, and up to the back of whoever is ahead
    const s = curbProgress(p);
    room = s <= KERB && !mayCross(ts, p) ? KERB - s : Infinity;
    for (const q of p.node.curb) {
      if (q === p || q.node !== p.node || q.side !== p.side || q.dir !== p.dir || Math.abs(q.line - p.line) > 0.55) continue;
      const gap = curbProgress(q) - s;
      if (gap > 0) room = Math.min(room, Math.max(0, gap - QUEUE_GAP));
    }
  }
  vMax = Math.min(vMax, Math.sqrt(2 * PED_BRAKE * room));
  p.v += Math.max(-2 * PED_BRAKE * dt, Math.min(PED_ACCEL * dt, vMax - p.v));
  const movement = Math.min(p.v * dt, room);
  if (p.v * dt > room) p.v = 0;
  let t = p.t + p.dir * movement;
  const reachesCurb = !!p.node && curbProgress(p) <= KERB && (p.dir > 0 ? t : p.len - t) >= KERB - 1e-6;
  p.waiting = reachesCurb && !mayCross(ts, p);
  if (p.waiting) {
    t = p.dir > 0 ? Math.min(t, KERB) : Math.max(t, p.len - KERB);
    p.v = 0;
  }
  // A car standing across the way, or a building's wall reaching over the sidewalk: stop short of it (probed a little
  // ahead, so the body stays out of it), and turn back at a wall, or once the car plainly isn't moving off
  if (t !== p.t) {
    const tc = clamp(t, 0, p.len);
    const fx = p.ux * p.dir, fz = p.uz * p.dir;
    const nx = p.ax + p.ux * tc, nz = p.az + p.uz * tc;
    p.wallT = (p.wallT || 0) - dt;
    let wall = false;
    const up = !!(p.la || p.lb); // (up a footbridge: over the walls and the cars below)
    if (ts.wallAt && !p.node && !up && p.wallT <= 0) {
      p.wallT = WALL_CHECK;
      // (one who has grazed a step into the wall turns back out too; only one deep inside it, a step behind as well,
      // walks on out of it)
      wall = ts.wallAt(nx + fx * 0.45, nz + fz * 0.45) && !ts.wallAt(p.x - fx * 0.35, p.z - fz * 0.35);
    }
    if (wall || (!up && stepBlocked(ts, p.x, p.z, nx + fx * 0.25, nz + fz * 0.25))) {
      t = p.t;
      p.v = 0;
      p.blocked = (p.blocked || 0) + dt;
      if (wall || p.blocked > (p.node ? 4 : 1.5)) {
        p.dir = -p.dir;
        p.nextRoute = null;
        p.nextLeg = 0;
        p.pause = TURN_TIME;
        p.blocked = 0;
      }
    } else {
      p.blocked = 0;
    }
  }
  if (p.dir > 0 ? t >= p.len : t <= 0) {
    t = p.dir > 0 ? p.len : 0;
    if (p.nextRoute) {
      const leg = p.nextRoute[p.nextLeg++];
      Object.assign(p, leg.track);
      p.route = leg.track;
      p.dir = leg.dir;
      t = p.dir > 0 ? 0 : p.len;
      p.t = t;
      if (p.node) atCurb(ts, p); // later arrivals this frame must see the newly occupied entrance
      if (p.nextLeg === p.nextRoute.length) p.nextRoute = null;
    } else {
      p.dir = -p.dir;
      p.v = 0;
      p.pause = TURN_TIME;
    }
  }
  p.t = t;
  p.x = p.ax + p.ux * t;
  p.z = p.az + p.uz * t;
  if (p.node && ((t > KERB && t < p.len - KERB) || (p.waiting && walkOn(ts, p.side)))) {
    p.coord = p.side >= 2 ? p.x : p.z;
    if (!p.node.walkers.length) ts.walkedNodes.push(p.node);
    p.node.walkers.push(p);
  }
}

function endConversation(ts: TrafficState, conversation: Conversation): void {
  for (const p of [conversation.a, conversation.b]) {
    p.conversation = null;
    p.socialTime = ts.clock + 30 + Math.random() * 60;
  }
  conversation.remaining = 0;
}

function meet(ts: TrafficState, dt: number): void {
  for (const p of ts.peds) {
    const conversation = p.conversation;
    if (conversation?.a !== p) continue;
    conversation.remaining -= dt;
    if (conversation.remaining <= 0) endConversation(ts, conversation);
  }
  if (ts.clock < ts.nextMeeting) return;
  ts.nextMeeting = ts.clock + 1;
  ts.meetingCells.clear();
  for (const p of ts.peds) {
    if (!p.placed || p.fallen || p.ride || p.node || !p.route?.edge || p.conversation || ts.clock < p.socialTime || p.t < 6 || p.t > p.len - 6) continue;
    const ix = Math.floor(p.x / 2), iz = Math.floor(p.z / 2);
    let partner = null;
    for (let dx = -1; dx <= 1 && !partner; dx++) {
      for (let dz = -1; dz <= 1 && !partner; dz++) {
        for (const q of ts.meetingCells.get(`${ix + dx}:${iz + dz}`) ?? []) {
          const distance = Math.hypot(p.x - q.x, p.z - q.z);
          if (q.conversation || p.route.block !== q.route?.block || distance < 0.75 || distance > 2 || Math.random() > 0.15 * (1 - ts.rainNow)) continue;
          partner = q;
          break;
        }
      }
    }
    if (partner) {
      p.conversation = partner.conversation = { a: p, b: partner, remaining: 6 + Math.random() * 6 };
      p.v = partner.v = 0;
    } else {
      const key = `${ix}:${iz}`;
      let cell = ts.meetingCells.get(key);
      if (!cell) ts.meetingCells.set(key, (cell = []));
      cell.push(p);
    }
  }
}

export { walk, endConversation, meet };
