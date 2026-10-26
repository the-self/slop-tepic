// js/sim/traffic/peds.ts
// The sidewalk pedestrians (340, see pedestrians.ts): made, stood on their ground, drawn, and knocked down by the
// player's car or bicycle (mayhem.ts)
import { blockAt } from '../../world/city-config.ts';
import { isRaisedPark, parkFloorAt } from '../../world/park-floor.ts';
import { PersonCrowd, PersonRig } from '../pedestrians.ts';
import { boxHit } from '../mayhem.ts';
import type { BoxContact } from '../mayhem.ts';
import { bleedOf, throwVelocity } from '../ragdolls.ts';
import { DOWN_TIME, MASS, NUM_PEDS } from './constants.ts';
import type { Ped } from './types.ts';
import type { TrafficState } from './state.ts';
import { reportCollision } from './hooks.ts';
import { hillAt } from './surface.ts';
import { visible } from './view.ts';
import { endConversation } from './walking.ts';

const hash = (i: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

// One instanced draw per level of detail; every pedestrian has a PersonRig that plants its footsteps on the
// sidewalk (no sliding), with their own build, height, sex, hair, clothes and gait
function createPeds() {
  const pedCrowd = new PersonCrowd(NUM_PEDS);
  const peds: Ped[] = [];
  for (let i = 0; i < NUM_PEDS; i++) {
    const female = hash(i, 1) < 0.48;
    const hairRoll = hash(i, 2);
    peds.push({
      placed: false,
      crossesStreets: i % 6 === 0, // some start near crossings; everyone can use them along their route
      x: 0,
      z: 0,
      ax: 0, // track: start, direction, length; position along it and walking direction
      az: 0,
      ux: 0,
      uz: 1,
      len: 1,
      t: 0,
      dir: 1,
      node: null, // the intersection of its crosswalk, which side of it, where along it
      side: 0,
      coord: 0,
      line: 0, // its line over the crosswalk, off the centre line
      waiting: false,
      speed: 1.22 + (i % 5) * 0.1 + hash(i, 3) * 0.08, // preferred walking speed
      v: 0, // current speed, easing up to it and down to stops
      pause: 0,
      route: null,
      nextRoute: null,
      nextLeg: 0,
      goalX: 0,
      goalZ: 0,
      goalTime: 0,
      restTime: 0,
      socialTime: 0,
      conversation: null,
      wish: hash(i, 8),
      ride: null,
      rig: new PersonRig({
        seed: i * 1.6180339 + 0.13,
        female,
        scale: (female ? 0.91 : 0.97) + hash(i, 4) * 0.1,
        girth: 0.9 + hash(i, 5) * 0.24,
        hair: female ? (hairRoll < 0.68 ? 1 : 0.3 + hairRoll * 0.25) : hairRoll < 0.08 ? 1 : hairRoll * 0.35,
        armSwing: 0.75 + hash(i, 6) * 0.5,
        stride: 0.94 + hash(i, 7) * 0.12
      })
    });
  }
  return { pedCrowd, peds };
}

// Walking surface around a pedestrian: sidewalks are 0.22 m above the road, and crosswalk tracks start and end
// with 2 m of sidewalk (the rig steps down and up the curbs)
const SIDEWALK_Y = 0.22;
const CROSSWALK_Y = 0.012;
function pedGround(ts: TrafficState, p: Ped, x: number, z: number): number {
  const hill = hillAt(ts, x, z);
  if (p.bail || p.ride) {
    // off its tracks (an ejected driver, someone stepping on or off a camión): in the road, or up on the curb island
    // or the raised park (park-floor.ts) it walks onto
    const b = blockAt(x, z);
    if (b && isRaisedPark(b)) return parkFloorAt(b, x, z) + hill;
    return (b && !(b.park > 0.6 && !b.median) ? SIDEWALK_Y : 0) + hill;
  }
  if (!p.node) return SIDEWALK_Y + hill;
  const t = (x - p.ax) * p.ux + (z - p.az) * p.uz;
  return (t > 2 && t < p.len - 2 ? CROSSWALK_Y : SIDEWALK_Y) + hill;
}

// Every rig's gait advances every frame; only those the camera may see (or whose shadow it may see) solve their
// bone transforms and are drawn, the far ones with the light LOD.
function renderPed(ts: TrafficState, p: Ped, dt: number) {
  const draw = !ts.hasView || visible(ts, p.x, p.z, 7);
  const partner = p.conversation && (p.conversation.a === p ? p.conversation.b : p.conversation.a);
  const heading = partner ? Math.atan2(partner.x - p.x, partner.z - p.z)
    : p.ride ? Math.atan2(p.ride.x - p.x, p.ride.z - p.z) : Math.atan2(p.ux * p.dir, p.uz * p.dir);
  p.rig.update(dt, p.x, p.z, heading, ts.pedGround, p, 0, draw);
  if (!draw) return;
  ts.pedCrowd.add(p.rig, Math.hypot(p.x - ts.focusX, p.z - ts.focusZ));
}

// Does the player's vehicle hit a body of radius r at (x, z) fast enough to knock it over?
function playerHits(ts: TrafficState, x: number, z: number, r: number) {
  if (!ts.player.knocks) return null;
  return boxHit(ts.player.x, ts.player.z, ts.player.heading, ts.player.halfW, ts.player.halfL, x, z, r);
}

// Throws pedestrian p to the ground as a ragdoll, hit at velocity (vx, vz) and pushed out along (nx, nz); by the
// player's car (`byCar`) its body throws theirs itself. `bleed` (0..1): how badly they bleed where they come to rest;
// `lift` m/s more up (a blast)
function throwPed(ts: TrafficState, p: Ped, vx: number, vz: number, nx: number, nz: number, byCar = false, bleed = 0, lift = 0): void {
  // a fresh solved pose to fall from (hidden pedestrians only advance their gait)
  const partner = p.conversation && (p.conversation.a === p ? p.conversation.b : p.conversation.a);
  const facing = p.bail ? p.bail.heading : partner ? Math.atan2(partner.x - p.x, partner.z - p.z) : Math.atan2(p.ux * p.dir, p.uz * p.dir);
  p.rig.update(1 / 60, p.x, p.z, facing, ts.pedGround, p, 0, true);
  const v = byCar ? { vx: p.rig.vx || 0, vy: 0, vz: p.rig.vz || 0 } : throwVelocity(vx, vz, nx, nz);
  v.vy += lift;
  if (!ts.ragdolls) return;
  p.fallen = ts.ragdolls.spawn(p.rig, { ...v, spin: byCar ? 0 : 2 + Math.hypot(vx, vz) * 0.3, bleed });
  if (p.conversation) endConversation(ts, p.conversation);
  p.node = null; // off any crosswalk queue (gatherCurbs)
  p.waiting = false;
  p.v = 0;
  p.bail = null;
  p.ride = null; // (a camión waiting for them pulls out, pickups.ts)
}

function knockPed(ts: TrafficState, p: Ped, hit: BoxContact): void {
  const speed = Math.hypot(ts.player.vx, ts.player.vz);
  throwPed(ts, p, ts.player.vx, ts.player.vz, hit.nx, hit.nz, ts.player.mode === 'car', bleedOf(speed));
  reportCollision(ts, ts.player.entity, p, p.x, 1.0, p.z, -hit.nx, -hit.nz, ts.player.speed);
  if (ts.knockListener) ts.knockListener('ped', p.x, p.z, ts.player.speed);
  // (a bicycle loses about half its speed; the car's body loses what it does against theirs, in Jolt)
  if (ts.player.mode !== 'car' && ts.player.entity && typeof ts.player.entity.speed === 'number') ts.player.entity.speed *= ts.player.mass / (ts.player.mass + MASS.person);
}

// A knocked-over pedestrian flies, lands and lies still (its ragdoll), then gets up out of sight (respawned like any
// other)
function tumblePed(ts: TrafficState, p: Ped, _dt: number): void {
  const f = p.fallen;
  if (!f) return;
  if (f.rest > 0.5 && !f.down) {
    f.down = true;
    if (ts.mayhemListener) ts.mayhemListener('down', f.px, f.py - 0.15, f.pz, 0, MASS.person);
  }
  if (f.rest > DOWN_TIME) {
    ts.ragdolls?.release(f);
    p.fallen = null;
    p.placed = false;
    p.rig.placed = false;
    return;
  }
  p.x = f.px;
  p.z = f.pz;
  if (ts.hasView && !visible(ts, p.x, p.z, 4)) return;
  ts.pedCrowd.add(p.rig, Math.hypot(p.x - ts.focusX, p.z - ts.focusZ));
}

export { createPeds, pedGround, renderPed, playerHits, throwPed, knockPed, tumblePed };
