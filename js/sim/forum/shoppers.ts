// js/sim/forum/shoppers.ts
// The people in Forum Tepic: shoppers walking the corridors to and fro on both floors, through the rotunda, round the
// food court and in & out of the entrances, and some at the food court's tables. Each walks its walk at its own pace
// from its own start, so where everyone is is a function of the clock (nothing to keep but the people's rigs), and
// only those near the camera are placed (sim/bystanders.ts: one skinned crowd per floor). A car, a moto or a bicycle
// driven into one downstairs fast enough throws them down (sim/ragdolls.ts), as the traffic's pedestrians are: they
// lie there a while, then are back on their walk.
import type * as THREE from 'three/webgpu';
import { Bystanders } from '../bystanders.ts';
import { boxHit } from '../mayhem.ts';
import { bleedOf } from '../ragdolls.ts';
import { FORUM, LEVEL } from '../../world/forum-plan.ts';
import type { BystanderStyle } from '../bystanders.ts';
import type { RagdollHandle, Ragdolls } from '../ragdolls.ts';

type Vec2 = [number, number];

const NEAR = 110; // m: the shoppers farther from the camera are not placed
const PER_100M = 7; // shoppers per 100 m of walk
/** walking: no dance, no sway (the rig's own gait does the walking) */
const WALK: BystanderStyle = { dance: 0, sway: 0, outfit: 0, female: null, scale: null };
const STAND: BystanderStyle = { dance: 0, sway: 1, outfit: 0, female: null, scale: null };

/** A walk: its points and the lengths along it (m), its floor */
interface Walk {
  pts: Vec2[];
  at: number[];
  length: number;
  level: 0 | 1;
}
/** A shopper on a walk: where it starts (m along it) and its pace (m/s); thrown down by the player, its ragdoll and
 *  how long it has lain (s) */
interface Shopper {
  walk: Walk;
  start: number;
  pace: number;
  key: number;
  side: number;
  down: { body: RagdollHandle; t: number } | null;
}

/** The player's vehicle as it may knock people down: where it is (m) and faces (rad), its half width & length (m),
 *  its speed (m/s), and whether it goes fast enough on the floor to throw someone */
export interface Hitter {
  x: number;
  z: number;
  heading: number;
  halfW: number;
  halfL: number;
  speed: number;
  /** backing up: its tail leads */
  back: boolean;
  knocks: boolean;
}

const LIE = 25; // s a shopper thrown down lies there, before they are back on their walk

export class Shoppers {
  floors: [Bystanders, Bystanders];
  shoppers: Shopper[] = [];
  diners: { x: number; z: number; heading: number; key: number }[] = [];
  time = 0;
  /** who is thrown falls as a body (main.ts hands them over), and who is told someone was run over (the crime: wanted) */
  ragdolls: Ragdolls | null = null;
  onKnock: ((x: number, z: number, speed: number) => void) | null = null;

  constructor(scene: THREE.Object3D, base: (x: number, z: number) => number) {
    this.floors = [new Bystanders(scene, 40, base), new Bystanders(scene, 48, (x, z) => base(x, z) + LEVEL)];
    let key = 1;
    for (const p of FORUM.paths) {
      const at = [0];
      for (let i = 1; i < p.pts.length; i++) at.push(at[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]));
      const walk: Walk = { pts: p.pts, at, length: at[at.length - 1], level: p.level };
      const n = Math.max(2, Math.round((walk.length / 100) * PER_100M));
      for (let k = 0; k < n; k++) {
        const r = Math.sin(key * 12.9898) * 43758.5453;
        const f = r - Math.floor(r);
        this.shoppers.push({ walk, start: (k / n) * 2 * walk.length + f * 7, pace: 0.95 + f * 0.5, key: key++, side: (f - 0.5) * 1.0, down: null });
      }
    }
    // two or three by some of the food court's tables (upstairs)
    FORUM.tables.forEach(([x, z], i) => {
      if (i % 3) return;
      this.diners.push({ x: x + 0.7, z: z + 0.2, heading: -Math.PI / 2, key: 10000 + i });
      if (i % 2) this.diners.push({ x: x - 0.7, z: z - 0.1, heading: Math.PI / 2, key: 20000 + i });
    });
  }

  // One thrown down back on their walk: their ragdoll let go, their rig stood up where their walk has them
  private standUp(s: Shopper): void {
    if (!s.down) return;
    this.ragdolls?.release(s.down.body);
    s.down = null;
    const rig = this.floors[0].rigOf(s.key);
    if (rig) rig.placed = false; // (the rig's next update puts them on their walk)
  }

  /** Places the people near the camera (when it is near the mall at all), and throws down whoever `hit` runs into */
  update(dt: number, camera: THREE.Camera, hit: Hitter | null): void {
    this.time += dt;
    const cx = camera.position.x, cz = camera.position.z;
    const [low, high] = this.floors;
    low.begin();
    high.begin();
    const near = Math.hypot(cx - FORUM.rotunda.x, cz - FORUM.rotunda.z) < 320;
    // (the camera gone, whoever was thrown down is up again: their bodies out of the physics, their rigs not kept)
    if (!near) for (const s of this.shoppers) if (s.down) this.standUp(s);
    if (near) {
      // (the diners first: the walkers fill what's left of the upper floor's crowd)
      for (const d of this.diners) {
        const dist = Math.hypot(d.x - cx, d.z - cz);
        if (dist < NEAR) high.place(d.key, d.x, d.z, d.heading, dist, d.key, STAND);
      }
      for (const s of this.shoppers) {
        const w = s.walk;
        if (s.down) {
          // lying where they were thrown; back on their walk once they've lain a while
          s.down.t += dt;
          if (s.down.t > LIE) this.standUp(s);
          else {
            const b = s.down.body;
            low.lay(s.key, Math.hypot(b.px - cx, b.pz - cz));
            continue;
          }
        }
        // to and fro along the walk: a lap is there and back
        let d = (s.start + this.time * s.pace) % (2 * w.length);
        const back = d > w.length;
        if (back) d = 2 * w.length - d;
        let i = 1;
        while (i < w.at.length - 1 && w.at[i] < d) i++;
        const t = (d - w.at[i - 1]) / (w.at[i] - w.at[i - 1] || 1);
        const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
        const L = w.at[i] - w.at[i - 1] || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
        // (each keeps to its own side of the walk: to the right of the way it goes)
        const side = back ? -s.side : s.side;
        const x = ax + (bx - ax) * t - uz * side, z = az + (bz - az) * t + ux * side;
        const dist = Math.hypot(x - cx, z - cz);
        if (dist > NEAR) continue;
        const heading = back ? Math.atan2(-ux, -uz) : Math.atan2(ux, uz);
        (w.level ? high : low).place(s.key, x, z, heading, dist, s.key, WALK);
        // run into downstairs by the player's vehicle: thrown, its body taking theirs (as sim/traffic/peds.ts throwPed)
        if (!w.level && hit?.knocks && this.ragdolls && boxHit(hit.x, hit.z, hit.heading, hit.halfW, hit.halfL, x, z, 0.3)) {
          const rig = low.rigOf(s.key);
          if (!rig?.placed) continue;
          s.down = { body: this.ragdolls.spawn(rig, { vx: rig.vx || 0, vy: 0, vz: rig.vz || 0, spin: 0, bleed: bleedOf(hit.speed) }), t: 0 };
          low.fell(s.key);
          this.onKnock?.(x, z, hit.speed);
        }
      }
    }
    low.end(dt);
    high.end(dt);
  }
}
