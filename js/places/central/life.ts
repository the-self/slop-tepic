// js/places/central/life.ts
// The people at the Central de Autobuses (index.ts builds it): travellers walking in from the car park through
// the front doors, across the lobby and out onto the andén, and back; others sitting in the waiting room's chairs; one
// at each taquilla's counter and the clerk behind it, a vendor in each kiosk; and in line on the andén at the coaches
// boarding, the line shuffling up as each climbs aboard. Where everyone is is a function of the clock (as Forum's
// shoppers, places/forum/life/shoppers.ts), and only those near the camera are placed: the walkers and standers on a crowd of
// their own (sim/bystanders.ts), the seated on another, their rigs posed once on their chairs (PersonRig.ride: a
// cyclist's seat with no pedals, hands on the knees).
import * as THREE from 'three/webgpu';
import { Bystanders } from '../../sim/bystanders.ts';
import { PersonCrowd, PersonRig } from '../../sim/pedestrians.ts';
import { hash } from '../../world/hash.ts';
import {
  TERMINAL, PLATFORM, FRONT_DOORS, BACK_DOORS, SEAT_H, COACH_L, COACH_W, centralAt, centralFrame, centralHeading, hallFurniture
} from './plan.ts';
import { LINES } from './build/site.ts';
import type { BystanderStyle } from '../../sim/bystanders.ts';

type Vec2 = [number, number];

const NEAR = 120; // m: the people farther from the camera are not placed
const SHOWN = 320; // m from the hall's middle within which anyone is
const SITTING = 0.45; // the share of the chairs taken
const PER_WALK = 3; // travellers to a walk
const LINE_LEN = 7; // people in a line at a coach's door
const LINE_GAP = 0.8; // m between them
const BOARD = 5; // s for each to climb aboard
const WALK: BystanderStyle = { dance: 0, sway: 0, outfit: 0, female: null, scale: null };
const STAND: BystanderStyle = { dance: 0, sway: 1, outfit: 0, female: null, scale: null };

/** A walk of the frame, to and fro: its points (world), the lengths along it (m) */
interface Walk {
  pts: Vec2[];
  at: number[];
  length: number;
}
/** Someone on a walk: where they start along it (m) and their pace (m/s) */
interface Traveller {
  walk: Walk;
  start: number;
  pace: number;
  key: number;
}
/** A line at a coach's door: its door (world), its first place and the way it runs back from it (unit), its key */
interface BoardingLine {
  door: Vec2;
  head: Vec2;
  back: Vec2;
  key: number;
  phase: number;
}
/** Someone standing still: where, facing, the style they stand in */
interface Stander {
  x: number;
  z: number;
  heading: number;
  key: number;
}
/** A coach in its bay on the andén (index.ts): its middle (m) and heading (rad) */
export interface AndenCoach {
  x: number;
  z: number;
  heading: number;
}

/** A walk through points of the frame (u, v) */
function walkOf(frame: readonly Vec2[]): Walk {
  const pts = frame.map(([u, v]): Vec2 => {
    const p = centralAt(u, v);
    return [p.x, p.z];
  });
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, at, length: at[at.length - 1] };
}

/** The walks: from the car park through each front door, by the way past the taquillas nearest it (their ends, or the
 *  gap between their runs), through the gap between the waiting room's rows of chairs nearest that, out the back door
 *  there onto the andén and along it; and along the walk in front, from the KFC's corner to the hall's other end */
function walks(): Walk[] {
  const [, , v0, v1] = TERMINAL, andén = (PLATFORM[2] + PLATFORM[3]) / 2;
  const inside = hallFurniture(LINES.length);
  // the gaps between the rows of chairs (their middles, u): wider than a walker
  const row = inside.benches.filter(([, , v]) => v === inside.benches[0][2]).sort((p, q) => p[0] - q[0]);
  const gaps = row.slice(1).filter(([a], i) => a - row[i][1] > 1.5).map(([a], i) => {
    const before = row.findLast(([, b]) => b < a) ?? row[i];
    return (before[1] + a) / 2;
  });
  const [cv0, cv1] = inside.counterV, behind = cv1 + 1.3 + 1; // (between the taquillas' wall and the first row)
  const out: Walk[] = [];
  for (const d of FRONT_DOORS) {
    const by = d < 30 ? 9 : d > 62 ? 84 : 46.5;
    const gap = gaps.reduce((a, b) => (Math.abs(b - by) < Math.abs(a - by) ? b : a));
    const back = BACK_DOORS.reduce((a, b) => (Math.abs((b[0] + b[1]) / 2 - gap) < Math.abs((a[0] + a[1]) / 2 - gap) ? b : a));
    const bu = (back[0] + back[1]) / 2;
    out.push(walkOf([[d - 1, v0 - 12], [d, v0 - 2], [d, v0 + 3], [by, cv0 - 4], [by, behind], [gap, behind], [bu, v1 - 1.5], [bu, andén],
      [bu + (d < 46 ? -9 : 9), andén]]));
  }
  out.push(walkOf([[2, v0 - 1.7], [101, v0 - 1.7]]));
  return out;
}

class CentralLife {
  private readonly walkers: Bystanders;
  private readonly seated: PersonCrowd;
  private readonly travellers: Traveller[] = [];
  private readonly lines: BoardingLine[] = [];
  private readonly standers: Stander[] = [];
  private readonly seats: { x: number; z: number; rig: PersonRig | null; seed: number }[] = [];
  private readonly mid: Vec2;
  private readonly floorY: () => number;
  private time = 0;

  /**
   * @param ground - the height someone on foot stands on at (x, z) (m): the hall's floor inside it
   * @param coaches - the coaches standing in their bays on the andén, a line at the door of some of them
   */
  constructor(scene: THREE.Object3D, ground: (x: number, z: number) => number, coaches: readonly AndenCoach[]) {
    this.walkers = new Bystanders(scene, 70, ground, { farDistance: 40 });
    this.seated = new PersonCrowd(90, { farDistance: 40 });
    for (const m of this.seated.meshes) scene.add(m);
    const m = centralAt((TERMINAL[0] + TERMINAL[1]) / 2, (TERMINAL[2] + TERMINAL[3]) / 2);
    this.mid = [m.x, m.z];
    this.floorY = () => ground(m.x, m.z);
    let key = 1;
    for (const walk of walks()) {
      for (let k = 0; k < PER_WALK; k++) {
        const f = hash(key, 3.7, 91);
        this.travellers.push({ walk, start: (k / PER_WALK) * 2 * walk.length + f * 9, pace: 1.0 + f * 0.45, key: key++ });
      }
    }
    // the chairs taken
    const inside = hallFurniture(LINES.length);
    for (const [u, v] of inside.seats) {
      if (hash(u, v, 92) >= SITTING) continue;
      const p = centralAt(u, v);
      this.seats.push({ x: p.x, z: p.z, rig: null, seed: key++ });
    }
    // a traveller at each taquilla, its clerk behind the counter; the kiosks' vendors
    const [cv0, cv1] = inside.counterV, front = centralHeading(0, 1), back = centralHeading(0, -1);
    for (const t of inside.taquillas) {
      const um = (t.u0 + t.u1) / 2;
      const a = centralAt(um + (hash(um, 1, 93) - 0.5) * 2, cv0 - 0.55), c = centralAt(um, cv1 + 0.45);
      if (hash(um, 2, 94) < 0.75) this.standers.push({ x: a.x, z: a.z, heading: front, key: key++ });
      this.standers.push({ x: c.x, z: c.z, heading: back, key: key++ });
    }
    for (const [a, b, c, d] of inside.kiosks) {
      const p = centralAt((a + b) / 2, (c + d) / 2);
      this.standers.push({ x: p.x, z: p.z, heading: front, key: key++ });
    }
    // lines at the doors of the coaches in the middle of the andén (the door: the curb's side, near the nose)
    const byU = [...coaches].sort((p, q) => centralFrame(p.x, p.z)[0] - centralFrame(q.x, q.z)[0]);
    const picks = [Math.floor(byU.length * 0.2), Math.floor(byU.length * 0.45), Math.floor(byU.length * 0.75)];
    for (const i of new Set(picks)) {
      const c = byU.at(i);
      if (!c) continue;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const door: Vec2 = [c.x + fx * (COACH_L / 2 - 1.05) - Math.cos(c.heading) * (COACH_W / 2 + 0.3), c.z + fz * (COACH_L / 2 - 1.05) + Math.sin(c.heading) * (COACH_W / 2 + 0.3)];
      const [du] = centralFrame(door[0], door[1]);
      const h = centralAt(du, PLATFORM[3] - 0.6), r = centralAt(du - 1, PLATFORM[3] - 0.6);
      this.lines.push({ door, head: [h.x, h.z], back: [r.x - h.x, r.z - h.z], key: 100000 * (this.lines.length + 1), phase: hash(du, 5, 95) * BOARD });
    }
  }

  /** Places the people near the camera (when it is near the Central at all) */
  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const cx = camera.position.x, cz = camera.position.z;
    const near = Math.hypot(cx - this.mid[0], cz - this.mid[1]) < SHOWN;
    const crowd = this.walkers;
    crowd.begin();
    this.seated.begin();
    if (near) {
      for (const s of this.standers) {
        const d = Math.hypot(s.x - cx, s.z - cz);
        if (d < NEAR) crowd.place(s.key, s.x, s.z, s.heading, d, s.key, STAND);
      }
      for (const t of this.travellers) this.walk(t, cx, cz);
      for (const line of this.lines) this.board(line, cx, cz);
      for (const s of this.seats) {
        const d = Math.hypot(s.x - cx, s.z - cz);
        if (d > NEAR) continue;
        s.rig ??= this.sit(s.x, s.z, s.seed);
        this.seated.add(s.rig, d);
      }
    }
    crowd.end(dt);
    this.seated.end();
  }

  /** Whether one of the travellers placed this frame stands within r m of (x, z) (the hall's doors open for them) */
  someoneAt(x: number, z: number, r: number): boolean {
    for (const p of this.walkers.placed) if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r && Math.hypot(p.x - x, p.z - z) < r) return true;
    return false;
  }

  // to and fro along its walk: a lap is there and back
  private walk(t: Traveller, cx: number, cz: number): void {
    const w = t.walk;
    let d = (t.start + this.time * t.pace) % (2 * w.length);
    const back = d > w.length;
    if (back) d = 2 * w.length - d;
    let i = 1;
    while (i < w.at.length - 1 && w.at[i] < d) i++;
    const L = w.at[i] - w.at[i - 1] || 1, f = (d - w.at[i - 1]) / L;
    const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    // (each keeps to the right of the way they go)
    const side = back ? -0.45 : 0.45;
    const x = ax + (bx - ax) * f - uz * side, z = az + (bz - az) * f + ux * side;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < NEAR) this.walkers.place(t.key, x, z, back ? Math.atan2(-ux, -uz) : Math.atan2(ux, uz), dist, t.key, WALK);
  }

  // a line at a coach's door: each BOARD s its first climbs aboard and the rest shuffle up a place, a newcomer at its
  // back; the one boarding walks from its head to the door and is gone
  private board(line: BoardingLine, cx: number, cz: number): void {
    const clock = (this.time + line.phase) / BOARD, first = Math.floor(clock), f = clock - first;
    // (they step up in the first second or so of each turn, then stand)
    const shuffle = Math.min(1, f * 2.5);
    const [hx, hz] = line.head, [bx, bz] = line.back;
    for (let k = 0; k < LINE_LEN; k++) {
      const n = first + k, key = line.key + (n % 1000);
      let x: number, z: number, heading: number;
      if (k === 0) {
        // the one boarding: from the head of the line to the door, then aboard
        if (f > 0.85) continue;
        const s = Math.min(1, f / 0.85);
        x = hx + (line.door[0] - hx) * s;
        z = hz + (line.door[1] - hz) * s;
        heading = Math.atan2(line.door[0] - hx, line.door[1] - hz);
      } else {
        const place = k - shuffle; // (from its place k to k - 1)
        x = hx + bx * LINE_GAP * place;
        z = hz + bz * LINE_GAP * place;
        heading = Math.atan2(-bx, -bz);
      }
      const dist = Math.hypot(x - cx, z - cz);
      if (dist < NEAR) this.walkers.place(key, x, z, heading, dist, key, k === 0 ? WALK : STAND);
    }
  }

  // someone sitting on the chair at (x, z), facing the andén: posed once (a cyclist's seat with no pedals, the hands on
  // the knees)
  private sit(x: number, z: number, seed: number): PersonRig {
    const r = (k: number) => hash(seed, k, 96);
    const female = r(1) < 0.5;
    const rig = new PersonRig({ seed: Math.floor(r(2) * 997) + 0.5, scale: 0.92 + r(3) * 0.14, female, girth: 0.92 + r(4) * 0.22, hair: female ? 0.3 + r(5) * 0.7 : r(5) * 0.25 });
    const root = new THREE.Object3D();
    root.position.set(x, this.floorY(), z);
    root.rotation.y = centralHeading(0, 1) + (r(6) - 0.5) * 0.3;
    rig.ride(root, 0, { seat: { y: SEAT_H, z: 0.02 }, bars: { y: SEAT_H + 0.08, z: 0.4 }, gripHalf: 0.17, bracket: { y: 0.09, z: 0.48 }, crankLength: 0, footHalf: 0.13 });
    return rig;
  }
}

export { CentralLife };
