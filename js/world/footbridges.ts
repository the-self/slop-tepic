import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { groundHeight } from './ground.ts';
import { drapeGeometry } from './drape.ts';
import { miters, soup, addBox } from './bridges.ts';
import { createBridgeConcreteMaterial } from '../render/tsl-materials.ts';
import type { P2, P3, Soup } from './bridges.ts';
import type { Collider } from './buildings.ts';

// js/world/footbridges.ts
// The puentes peatonales over the roads, from the geodata builder's footbridges (tools/build-tepic-geodata.mjs, 3C: the
// OSM bridge ways over a main road, a flight of stairs down at either end, lifts in dm over the ground at each point):
// a concrete walkway on a painted steel deck, steel railings along it and down the stairs, columns under the stairs'
// tops and halfway down them. The walkway and stairs are what the player stands on (ground.ts walkDeckLift, on foot
// only); the railings and the space under the stairs stop the player and the vehicles. Built flat (y = lift over the
// ground) and laid on the town's slopes like the road bridges (bridges.ts).

const DECK = 0.6; // m: the deck's depth, walkway to soffit (the builder's FOOT_DECK)
const FASCIA = 0.12; // m: the thickness of the steel beam down either side
const RAIL_H = 1.15; // m: the railings' height over the walkway or the step
const POST_EVERY = 1.6; // m between the railings' posts
const RISE = 0.18; // m: a step's rise
const STRINGER = 0.32; // m: the stairs' steel stringers, under the steps' nosings
const COLUMN = 0.18; // m: a column's half size
const UNDER_STEP = 0.5; // m: the solid under the stairs stays this far under them

/** Unit direction of a → b on the ground, or null for two points in one place */
function dir(a: P2, b: P2): P2 | null {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
}

function buildFootbridges(scene: THREE.Scene): { group: THREE.Group; colliders: Collider[] } {
  const group = new THREE.Group();
  group.name = 'Footbridges';
  const colliders: Collider[] = [];
  const walk = soup(); // the walkway and the steps' treads
  const steel = soup(); // the deck's beams, stringers, columns
  const rails = soup(); // posts and rails

  // An oriented box collider from a to b, `off` to the left of the line (against the miters), half thickness ht, between heights y0..y1
  const wall = (a: P2, b: P2, off: number, ht: number, y0: number, y1: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.2) return;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const cx = (a[0] + b[0]) / 2 - uz * off, cz = (a[1] + b[1]) / 2 + ux * off;
    const yaw = Math.atan2(-uz, ux);
    const cs = Math.cos(yaw), sn = Math.sin(yaw), hx = len / 2, hz = ht;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: y0, maxY: y1, obb: { cx, cz, hx, hz, cs, sn } });
  };

  // A railing along one side (side +1: the miters' side, right of a → b) from lift la to lb: posts, a handrail and a mid rail; and its
  // collider, in pieces of at most 3 m (on the stairs each spans little of their rise)
  const railing = (a: P2, b: P2, ma: P2, mb: P2, la: number, lb: number, half: number, side: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = dir(a, b);
    if (!d) return;
    const at = (f: number, up: number): P3 => {
      const mx = ma[0] + (mb[0] - ma[0]) * f, mz = ma[1] + (mb[1] - ma[1]) * f;
      return [a[0] + (b[0] - a[0]) * f + mx * half * side, la + (lb - la) * f + up, a[1] + (b[1] - a[1]) * f + mz * half * side];
    };
    const posts = Math.max(1, Math.round(len / POST_EVERY));
    for (let k = 0; k <= posts; k++) {
      const p = at(k / posts, 0);
      addBox(rails, p[0], p[1] + RAIL_H / 2, p[2], d[0], d[1], 0.03, 0.03, RAIL_H / 2);
    }
    // the rails: square tubes along the slope (quads on four sides)
    for (const [up, r] of [[RAIL_H, 0.035], [RAIL_H * 0.5, 0.02]] as const) {
      const p0 = at(0, up), p1 = at(1, up);
      const nx = d[1] * side, nz = -d[0] * side; // outward (the miters lean to the right of a → b)
      const off = (p: P3, o: number, h: number): P3 => [p[0] + nx * o, p[1] + h, p[2] + nz * o];
      rails.quad(off(p0, r, -r), off(p0, r, r), off(p1, r, r), off(p1, r, -r), [nx, 0, nz]);
      rails.quad(off(p1, -r, -r), off(p1, -r, r), off(p0, -r, r), off(p0, -r, -r), [-nx, 0, -nz]);
      rails.quad(off(p0, -r, r), off(p1, -r, r), off(p1, r, r), off(p0, r, r), [0, 1, 0]);
      rails.quad(off(p0, r, -r), off(p1, r, -r), off(p1, -r, -r), off(p0, -r, -r), [0, -1, 0]);
    }
    // (along the railing itself, mitered as drawn: at a landing's turn the line off the centre would cross the stairs)
    const n = Math.ceil(len / 3);
    for (let j = 0; j < n; j++) {
      const f0 = j / n, f1 = (j + 1) / n;
      const p0 = at(f0, 0), p1 = at(f1, 0);
      const g = groundHeight((p0[0] + p1[0]) / 2, (p0[2] + p1[2]) / 2);
      wall([p0[0], p0[2]], [p1[0], p1[2]], 0, 0.08, g + Math.min(p0[1], p1[1]) - 0.3, g + Math.max(p0[1], p1[1]) + RAIL_H);
    }
  };

  // A column from the ground up to `top` under (x, z) (its collider stopping short of it, as under the stairs)
  const column = (x: number, z: number, d: P2, top: number) => {
    addBox(steel, x, (top - 0.3) / 2, z, d[0], d[1], COLUMN, COLUMN, (top + 0.3) / 2);
    const g = groundHeight(x, z);
    colliders.push({ minX: x - COLUMN, maxX: x + COLUMN, minZ: z - COLUMN, maxZ: z + COLUMN, minY: g - 0.3, maxY: g + top - UNDER_STEP });
  };

  for (const [flat, dm, width] of GEO.footbridges) {
    const pts: P2[] = [];
    for (let k = 0; k + 1 < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
    const lifts = dm.map((v) => v / 10);
    const top = Math.max(...lifts);
    const half = width / 20;
    const m = miters(pts);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], ma = m[i], mb = m[i + 1];
      const la = lifts[i], lb = lifts[i + 1];
      const d = dir(a, b);
      if (!d) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const P = (p: P2, mm: P2, o: number, y: number): P3 => [p[0] + mm[0] * o, y, p[1] + mm[1] * o];
      const outOf = (side: number): P3 => [d[1] * side, 0, -d[0] * side]; // a side's outward normal (miters: +1 right of a → b)
      if (Math.abs(lb - la) < 0.05) {
        // the deck: the walkway, the steel beams down its sides and the soffit between them
        walk.quad(P(a, ma, half, la), P(b, mb, half, lb), P(b, mb, -half, lb), P(a, ma, -half, la), [0, 1, 0]);
        for (const side of [1, -1]) {
          const o = half * side, oi = (half - FASCIA) * side;
          const out = outOf(side);
          steel.quad(P(a, ma, o, la - DECK), P(a, ma, o, la + 0.08), P(b, mb, o, lb + 0.08), P(b, mb, o, lb - DECK), out);
          steel.quad(P(a, ma, oi, la + 0.08), P(a, ma, o, la + 0.08), P(b, mb, o, lb + 0.08), P(b, mb, oi, lb + 0.08), [0, 1, 0]);
        }
        steel.quad(P(a, ma, half, la - DECK), P(b, mb, half, lb - DECK), P(b, mb, -half, lb - DECK), P(a, ma, -half, la - DECK), [0, -1, 0]);
      } else {
        // a flight of stairs: treads and risers, the stringers under their nosings and the sloping soffit
        const up = lb > la;
        const steps = Math.max(1, Math.round(Math.abs(lb - la) / RISE));
        for (let k = 0; k < steps; k++) {
          // step k from the stairs' foot: its tread at the rise it climbs to
          const f0 = up ? k / steps : 1 - (k + 1) / steps, f1 = up ? (k + 1) / steps : 1 - k / steps;
          const y = Math.min(la, lb) + ((k + 1) / steps) * Math.abs(lb - la);
          const fa = up ? f0 : f1; // the tread's edge nearer the foot (its riser)
          const A = (f: number): P2 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          const M = (f: number): P2 => [ma[0] + (mb[0] - ma[0]) * f, ma[1] + (mb[1] - ma[1]) * f];
          walk.quad(P(A(f0), M(f0), half, y), P(A(f1), M(f1), half, y), P(A(f1), M(f1), -half, y), P(A(f0), M(f0), -half, y), [0, 1, 0]);
          const toFoot: P3 = up ? [-d[0], 0, -d[1]] : [d[0], 0, d[1]];
          walk.quad(P(A(fa), M(fa), -half, y - Math.abs(lb - la) / steps), P(A(fa), M(fa), -half, y), P(A(fa), M(fa), half, y), P(A(fa), M(fa), half, y - Math.abs(lb - la) / steps), toFoot);
        }
        for (const side of [1, -1]) {
          const o = half * side;
          const out = outOf(side);
          steel.quad(P(a, ma, o, Math.max(0, la - STRINGER)), P(a, ma, o, la + 0.06), P(b, mb, o, lb + 0.06), P(b, mb, o, Math.max(0, lb - STRINGER)), out);
        }
        steel.quad(P(a, ma, half, Math.max(0, la - STRINGER)), P(b, mb, half, Math.max(0, lb - STRINGER)), P(b, mb, -half, Math.max(0, lb - STRINGER)), P(a, ma, -half, Math.max(0, la - STRINGER)), [0, -1, 0]);
        // under the stairs: solid to whoever walks or drives into them from the side or below, in 1 m pieces each
        // topped UNDER_STEP under the step at its lower end (who climbs them stands over it: a walker's body reaches
        // a piece before its feet, a body's radius further down the flight)
        const n = Math.ceil(len);
        for (let j = 0; j < n; j++) {
          const f0 = j / n, f1 = (j + 1) / n;
          const low = Math.min(la + (lb - la) * f0, la + (lb - la) * f1);
          if (low < UNDER_STEP + 0.3) continue;
          const c0: P2 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], c1: P2 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
          const g = groundHeight((c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2);
          wall(c0, c1, 0, half, g - 0.3, g + low - UNDER_STEP);
        }
        // a column halfway down a tall flight
        const mid = (la + lb) / 2;
        if (mid > 2.5) column((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d, mid - STRINGER);
      }
      for (const side of [1, -1]) railing(a, b, ma, mb, la, lb, half - 0.04, side);
      // the columns under the deck's ends, just outside the walkway either side (out of the way of a flight turning off
      // a landing), where the stairs come up to it
      if (Math.abs(lb - la) < 0.05 && la > top - 0.05) {
        for (const [p, mm, other] of [[a, ma, i > 0 ? lifts[i - 1] : la], [b, mb, i + 2 < pts.length ? lifts[i + 2] : lb]] as const) {
          if (other > top - 0.05) continue; // (the deck carries on: no stair here)
          for (const side of [1, -1]) column(p[0] + mm[0] * (half + COLUMN) * side, p[1] + mm[1] * (half + COLUMN) * side, d, top - DECK);
        }
      }
    }
  }

  const add = (s: Soup, material: THREE.Material, name: string) => {
    const geo = s.geometry();
    if (!geo) return;
    const mesh = new THREE.Mesh(drapeGeometry(geo), material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(walk, createBridgeConcreteMaterial(), 'FootbridgeWalkways');
  // painted steel: the SCT's grey-blue, its railings darker
  add(steel, new THREE.MeshStandardNodeMaterial({ color: 0x5f7484, metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide }), 'FootbridgeSteel');
  add(rails, new THREE.MeshStandardNodeMaterial({ color: 0x3a4650, metalness: 0.6, roughness: 0.45 }), 'FootbridgeRailings');
  scene.add(group);
  console.info(`[footbridges] ${GEO.footbridges.length} puentes peatonales, ${colliders.length} colliders`);
  return { group, colliders };
}

export { buildFootbridges };
