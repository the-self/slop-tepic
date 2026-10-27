// js/world/cfe-network.ts
// The CFE's overhead lines down the streets, strung on street-details.ts' poles: the primaries, the secondary and the
// phone & cable lines pole to pole and the service cables to the houses, built in 200 m cells (each rebuilt without a
// pole's wires when it comes down: what the cells hold is only which spans & cables are theirs); and what a pole knocked
// down by a car does (sim/mayhem.ts): its spans and cables cut, the lines that hung from it fallen to the street from
// the poles either side (cfe-grid.ts fallenLine), the primaries arcing where they lie (cfe-sparks.ts: sparks, a flash,
// a crackle, a shock to whoever walks into them), a transformer's pole going up with a bang and, a moment later, the
// run its transformer feeds without power (cfe-grid.ts poleOutage): the streetlights out after a flicker (`lampsOut`,
// street-details.ts) and the houses' windows dark (blackoutSpans, the facades' materials). Past BLACKOUT_MAX stretches
// out at once, the oldest outage has its power back (the lines still down).
import * as THREE from 'three/webgpu';
import { createWireMaterial, WIRE_FADE, blackoutSpans, uBlackouts, BLACKOUT_MAX } from '../render/tsl-materials.ts';
import { cfeCircuits, poleOutage, outageSegments, fallenLine } from './cfe-grid.ts';
import { CfeSparks } from './cfe-sparks.ts';
import { blockAt } from './city-config.ts';
import { hashPos } from './hash.ts';
import { liftAt } from './ground.ts';
import { surfaceY } from './footways.ts';
import type { CfeCircuits } from './cfe-grid.ts';
import type { PowerFault } from './cfe-sparks.ts';

/** A CFE pole: its foot (m), the ground there (g), along its curb (ux, uz), out over the street (outX, outZ) */
interface CfePole {
  x: number;
  z: number;
  g: number;
  ux: number;
  uz: number;
  outX: number;
  outZ: number;
  /** m to the far curb (0 if none) */
  across: number;
  /** Its curb's index in street-details.ts' cfeEdges, and its own among the poles */
  edge: number;
  i: number;
}

/** A cell of the wires: its mesh, its centre (m), the spans strung in it (by index) and the service cables (pole index
 *  × 2, + 1 for the one across the street) */
interface WireCell {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  spans: number[];
  services: number[];
}

/** A line strung pole to pole, in the pole's frame (m: x out over the street, y up), its sag (of the span) & half width */
interface Line {
  x: number;
  y: number;
  sag: number;
  r: number;
  /** a primary (13.2 kV, on the insulators): it arcs where it lies */
  primary?: boolean;
  /** strung on one pole in two (the cable company's) */
  some?: boolean;
}
const LINES: Line[] = [
  ...[-0.7, 0.3, 1.3].map((x) => ({ x, y: 10.82, sag: 0.012, r: 0.009, primary: true })),
  { x: 0.28, y: 9.0, sag: 0.025, r: 0.014 }, // the secondary (220/127 V)
  { x: 0.24, y: 7.6, sag: 0.035, r: 0.012 }, // the phone line
  { x: 0.24, y: 7.3, sag: 0.045, r: 0.016, some: true } // the cable's
];
const CELL = 200; // m: the wires' cells, each hidden beyond the wire material's WIRE_FADE
const FLICKER = 1.1; // s the run's lights flicker before they go (the protection tripping)
const OUT_DELAY = 0.6; // s after the pole comes down before they start to

/** Pole p's own hash `k` (0..1): which carry a transformer, a lamp, a cable... */
function cfeHash(p: CfePole, k: number): number {
  return hashPos(p.x, k, p.z);
}
/** A point of pole p's frame in the world: x out over the street, y up from its foot, z along its curb (m) */
function cfePoint(p: CfePole, x: number, y: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p.x + p.outX * x + p.ux * z, p.g + y, p.z + p.outZ * x + p.uz * z);
}
// The ground the fallen lines lie on: the street, or the sidewalk over it
const groundAt = (x: number, z: number) => liftAt(x, z) + surfaceY(x, z);

// A wire's ribbon through the points `pts` (flat xyz, m), r m half wide (the material widens it to a pixel or so):
// two vertices a point, its tangent and half width in the `wire` attribute
interface Ribbons {
  pos: number[];
  wire: number[];
  idx: number[];
}
function ribbon(c: Ribbons, pts: readonly number[], r: number): void {
  const n = pts.length / 3;
  const base = c.pos.length / 3;
  for (let s = 0; s < n; s++) {
    const a = Math.max(0, s - 1) * 3, b = Math.min(n - 1, s + 1) * 3;
    let tx = pts[b] - pts[a], ty = pts[b + 1] - pts[a + 1], tz = pts[b + 2] - pts[a + 2];
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    for (const w of [r, -r]) {
      c.pos.push(pts[s * 3], pts[s * 3 + 1], pts[s * 3 + 2]);
      c.wire.push(tx, ty, tz, w);
    }
    if (s < n - 1) {
      const v = base + s * 2;
      c.idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
}
function ribbonGeometry(c: Ribbons): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
  geo.setAttribute('wire', new THREE.Float32BufferAttribute(c.wire, 4));
  geo.setIndex(c.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(c.idx, 1) : new THREE.Uint16BufferAttribute(c.idx, 1));
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius += 1; // (the ribbons widen in the vertex shader)
  return geo;
}

// A parabola close enough to the catenary for these sags: segs + 1 points from a to b, sagging `sag` m at the middle
function sagging(a: THREE.Vector3, b: THREE.Vector3, sag: number): number[] {
  const segs = Math.max(3, Math.min(8, Math.ceil(a.distanceTo(b) / 5)));
  const out: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t), a.z + (b.z - a.z) * t);
  }
  return out;
}

/** What befalls the street, for those who react (main.ts: the audio, the player's health) */
type FaultListener = (e: PowerFault) => void;

/** What lampsOut does to the streetlights along some stretches: a flicker's 'off' and 'on' (those with power only),
 *  'cut' as an outage takes hold, 'restore' as its power comes back (a lamp stays out while any outage cuts it) */
type LampChange = 'off' | 'on' | 'cut' | 'restore';

/** An outage: its poles and its stretches of street (flat [ax, az, bx, bz], m); s to go while it flickers */
interface Outage {
  poles: number[];
  segs: number[];
  t: number;
}

/**
 * The CFE's lines over `poles`, strung along `spans` ([pole, pole]); `transformer[i]`: pole i carries one. Its wires go
 * into `group` (the street details'), what a fall leaves into a group of its own on `scene`. `lampsOut(segments, change)`
 * puts the streetlights along those stretches of street out or back (LampChange).
 */
class CfeNetwork {
  poles: CfePole[];
  spans: readonly [CfePole, CfePole][];
  circuits: CfeCircuits;
  cells: WireCell[];
  /** Each pole's cells: those its spans and service cables are in */
  cellsOf: number[][];
  material: ReturnType<typeof createWireMaterial>;
  group: THREE.Group;
  sparks: CfeSparks;
  /** The poles down (no lines hang from them) */
  down: Set<number>;
  /** The lines hanging from each pole still standing to one that fell (taken down if it falls too) */
  hanging: Map<number, THREE.Mesh[]>;
  /** The poles without power */
  dark: Set<number>;
  /** The outages in force, the oldest first (its power back past BLACKOUT_MAX stretches) */
  outages: Outage[];
  /** ...and those on their way, flickering */
  pending: Outage[];
  lampsOut: ((segments: readonly number[], change: LampChange) => void) | null;
  listener: FaultListener | null;

  constructor(scene: THREE.Scene, group: THREE.Group, poles: CfePole[], spans: readonly [CfePole, CfePole][], transformer: readonly boolean[]) {
    this.poles = poles;
    this.spans = spans;
    this.circuits = cfeCircuits(poles.length, spans.map(([a, b]) => [a.i, b.i] as const), transformer);
    this.cells = [];
    this.cellsOf = poles.map(() => []);
    this.material = createWireMaterial();
    this.down = new Set();
    this.hanging = new Map();
    this.dark = new Set();
    this.outages = [];
    this.pending = [];
    this.lampsOut = null;
    this.listener = null;
    this.group = new THREE.Group();
    this.group.name = 'CfeFaults';
    scene.add(this.group);
    this.sparks = new CfeSparks(this.group);
    this.sparks.listener = (e) => this.listener?.(e);
    this.build(group, spans);
  }

  // The lines & the service cables in CELL m cells (a span's by the middle of its poles, a cable's by its own), each
  // cell's spans & cables noted by the poles they hang from
  build(group: THREE.Group, spans: readonly [CfePole, CfePole][]): void {
    if (!spans.length) return;
    const cells = new Map<number, number>();
    const cellAt = (mx: number, mz: number) => {
      const ix = Math.floor(mx / CELL), iz = Math.floor(mz / CELL);
      const key = ix * 100003 + iz;
      let c = cells.get(key);
      if (c === undefined) {
        c = this.cells.length;
        cells.set(key, c);
        this.cells.push({ mesh: new THREE.Mesh(undefined, this.material), x: (ix + 0.5) * CELL, z: (iz + 0.5) * CELL, spans: [], services: [] });
      }
      return c;
    };
    const note = (pole: number, c: number) => {
      const list = this.cellsOf[pole];
      if (!list.includes(c)) list.push(c);
    };
    spans.forEach(([a, b], k) => {
      const c = cellAt((a.x + b.x) / 2, (a.z + b.z) / 2);
      this.cells[c].spans.push(k);
      note(a.i, c);
      note(b.i, c);
    });
    for (const q of this.poles) {
      for (const side of [0, 1]) {
        const to = this.service(q, side);
        if (!to) continue;
        const c = cellAt((q.x + to.x) / 2, (q.z + to.z) / 2);
        this.cells[c].services.push(q.i * 2 + side);
        note(q.i, c);
      }
    }
    for (const c of this.cells) {
      c.mesh.geometry = this.cellGeometry(c);
      c.mesh.name = 'CfeWires';
      c.mesh.renderOrder = 2; // (update() hides the far cells after the warm-up frame has compiled them)
      group.add(c.mesh);
    }
    if (this.cells.length > 1) for (const c of this.cells.slice(1)) c.mesh.userData.sharesPipelineWith = this.cells[0].mesh;
  }

  /** Pole q's service cable (`side` 0: down to a house on its side; 1: across the street to one on the other), where it
   *  is tied to the house (m), or null if it has none */
  service(q: CfePole, side: number): THREE.Vector3 | null {
    const h = cfeHash(q, side ? 8.3 : 7.1);
    if (side ? !q.across || h >= 0.6 : h >= 0.75) return null;
    const along = side ? (h - 0.3) * 16 : (h - 0.375) * 20;
    const d = side ? q.across + 2.4 : -2.4;
    const tx = q.x + q.outX * d + q.ux * along, tz = q.z + q.outZ * d + q.uz * along;
    const blk = blockAt(tx, tz);
    if (!blk || blk.park > 0.6) return null;
    return new THREE.Vector3(tx, liftAt(tx, tz) + (side ? 4.6 : 4.3), tz);
  }

  // A cell's wires, those of the poles still up: pole to pole the three primaries on the insulators, the secondary &
  // the phone / cable line; and the service cables
  cellGeometry(c: WireCell): THREE.BufferGeometry {
    const r: Ribbons = { pos: [], wire: [], idx: [] };
    const a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
    for (const k of c.spans) {
      const [a, b] = this.spans[k];
      if (this.down.has(a.i) || this.down.has(b.i)) continue;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (const line of LINES) {
        if (line.some && cfeHash(a, 6.6) >= 0.5) continue;
        ribbon(r, sagging(cfePoint(a, line.x, line.y, 0, a3), cfePoint(b, line.x, line.y, 0, b3), line.sag * L), line.r);
      }
    }
    for (const code of c.services) {
      const q = this.poles[code >> 1];
      const to = this.down.has(q.i) ? null : this.service(q, code & 1);
      if (to) ribbon(r, sagging(cfePoint(q, 0.28, 9.0, 0, a3), to, code & 1 ? 0.5 : 0.35), 0.008);
    }
    return ribbonGeometry(r);
  }

  /**
   * Pole p knocked down (sim/mayhem.ts onBreak): its wires cut, the lines from the poles either side fallen to the
   * street where it stood, the primaries arcing, its transformer (if it has one) going up, and the run it was on
   * soon without power
   */
  fell(p: CfePole): void {
    if (this.down.has(p.i)) return;
    this.down.add(p.i);
    // its cells strung again without it (their first geometry's arrays released once drawn: scene-culling.ts)
    for (const k of this.cellsOf[p.i]) {
      const c = this.cells[k];
      const old = c.mesh.geometry;
      c.mesh.geometry = this.cellGeometry(c);
      old.dispose();
    }
    // (the lines hanging from it, to a pole down before it, come down with it)
    for (const mesh of this.hanging.get(p.i) ?? []) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.hanging.delete(p.i);
    this.sparks.drop(p.i);
    // the lines from each pole still standing either side, down to the street and on to where this one stood
    const from = new THREE.Vector3();
    for (const j of this.circuits.links[p.i]) {
      if (this.down.has(j)) continue;
      const q = this.poles[j];
      const c: Ribbons = { pos: [], wire: [], idx: [] };
      const L = Math.hypot(p.x - q.x, p.z - q.z);
      let arcX = p.x, arcZ = p.z;
      for (const [k, line] of LINES.entries()) {
        if (line.some && cfeHash(q, 6.6) >= 0.5 && cfeHash(p, 6.6) >= 0.5) continue;
        cfePoint(q, line.x, line.y, 0, from);
        // each lies a little apart, across the street from the others, touching down two thirds of the way or so
        const side = (k - 2) * 0.35;
        const end = { x: p.x + p.outX * side, z: p.z + p.outZ * side };
        const reach = Math.min(L - 0.5, line.y * 0.9 + cfeHash(q, 9.1 + k) * 4);
        ribbon(c, fallenLine(from, end, reach, groundAt), line.r * 1.2);
        // (the middle primary's touchdown: where its line arcs)
        if (k === 1) {
          const d = Math.hypot(end.x - from.x, end.z - from.z) || 1, f = Math.min(reach, d) / d;
          arcX = from.x + (end.x - from.x) * f;
          arcZ = from.z + (end.z - from.z) * f;
        }
      }
      const mesh = new THREE.Mesh(ribbonGeometry(c), this.material);
      mesh.name = 'CfeFallenLines';
      mesh.renderOrder = 2;
      this.group.add(mesh);
      let list = this.hanging.get(j);
      if (!list) this.hanging.set(j, (list = []));
      list.push(mesh);
      // the primaries arc where they came down onto the street
      this.sparks.live(j, arcX, groundAt(arcX, arcZ) + 0.05, arcZ);
    }
    if (this.circuits.transformer[p.i]) this.sparks.bang(cfePoint(p, 0.42, 9.65, 0, from));
    // the run without power, a moment later
    const out = poleOutage(this.circuits, p.i).filter((i) => !this.dark.has(i));
    if (!out.length) return;
    for (const i of out) this.dark.add(i);
    this.pending.push({ poles: out, segs: outageSegments(this.circuits, out, (i) => this.poles[i]), t: OUT_DELAY + FLICKER });
  }

  /** Per frame: the wires' cells near enough drawn, the arcs, and the runs going out (their lights flickering) */
  update(dt: number, camera: THREE.Camera, player: { x: number; y: number; z: number } | null, onFoot: boolean): void {
    for (const c of this.cells) {
      const dx = c.x - camera.position.x, dz = c.z - camera.position.z;
      c.mesh.visible = Math.sqrt(dx * dx + dz * dz) - 150 < WIRE_FADE;
    }
    this.sparks.update(dt, camera, player, onFoot);
    if (!this.pending.length) return;
    let flick = false;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const o = this.pending[k];
      o.t -= dt;
      if (o.t > FLICKER) continue;
      if (o.t <= 0) {
        this.pending.splice(k, 1);
        this.outages.push(o);
        this.lampsOut?.(o.segs, 'cut');
        continue;
      }
      // flickering: off and back on, faster as it goes
      const off = Math.sin(o.t * 37) + Math.sin(o.t * 91) > 0.4 - (1 - o.t / FLICKER) * 1.4;
      this.lampsOut?.(o.segs, off ? 'off' : 'on');
      flick ||= off;
    }
    // too many stretches out for the facades: the oldest outage has its power back
    let n = 0;
    for (const o of this.outages) n += o.segs.length / 4;
    while (n > BLACKOUT_MAX && this.outages.length > 1) {
      const old = this.outages.shift();
      if (!old) break;
      n -= old.segs.length / 4;
      for (const i of old.poles) this.dark.delete(i);
      this.lampsOut?.(old.segs, 'restore');
    }
    this.upload(flick);
  }

  // The stretches without power into the facades' uniform: those of the outages in force, and of those flickering
  // while they are off
  upload(flick: boolean): void {
    let n = 0;
    for (let o = 0; o < this.outages.length + this.pending.length; o++) {
      const outage = o < this.outages.length ? this.outages[o] : this.pending[o - this.outages.length];
      if (o >= this.outages.length && !(flick && outage.t <= FLICKER)) continue;
      const s = outage.segs;
      for (let k = 0; k + 3 < s.length && n < BLACKOUT_MAX; k += 4) {
        const v = blackoutSpans.array[n++];
        if (v instanceof THREE.Vector4) v.set(s[k], s[k + 1], s[k + 2], s[k + 3]);
      }
    }
    uBlackouts.value = n;
  }
}

export type { CfePole, FaultListener, LampChange };
export { CfeNetwork, cfePoint, cfeHash };
