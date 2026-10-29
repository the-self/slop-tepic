// js/places/uan/build/walls.ts
// The campus's walls along the streets (plan.ts finds where): cut in straight stretches between the bends, each
// in pieces that step down the slopes as the real ones do.
// - The UAN's blue (the boulevard, Av. de la Cultura): a low blue wall, square blue piers every ~3.6 m and a steel reja
//   between them; a broader pier every so often with "UAN" on it, as by the gates.
// - The old stone (Revolución, 12 de Octubre): rubble stone 1.3 m high under a concrete coping, a stone pilaster every
//   ~22 m, and on top a chain-link fence 2 m high on steel posts every 3 m, a rail along its top; José María Mercado's
//   the same, whitewashed.
// Along the streets, the sidewalk from the wall to the curb paved (the campus's blocks are lawn to their curbs): red
// on Revolución, grey concrete elsewhere.
import * as THREE from 'three/webgpu';
import { liftAt } from '../../../world/ground.ts';
import { GEO } from '../../../world/city-geodata.js';
import { letteringMaterial, REJA_H } from './materials.ts';
import type { CampusWall } from '../plan.ts';
import type { PointXZ } from '../../../world/city-config.ts';
import type { Frame, Kit } from '../../kit/pieces.ts';
import type { UanMaterials } from './materials.ts';

const LOT_Y = 0.22; // m: the block's ground over the town's floor (city-grid.ts's sidewalk top)
const SINK = 0.35; // m the walls' feet go into the ground
const PIECE = 6; // m at most per piece of the stone wall and the sidewalk
const SIDEWALK = GEO.frame.sidewalk || 2.2; // m from the property line to the block's curb
const WALK_PIECE = 2; // m a piece of the sidewalk
const WALK_DEPTH = 0.8; // m from its top down into the ground

// The blue: low wall, piers, the reja between
const BLUE = { wallH: 0.75, wallT: 0.3, every: 3.6, pierW: 0.8, pierD: 0.55, pierH: 2.5, bigW: 1.6, bigD: 0.75, bigH: 2.9, bigEvery: 14 };
// The stone: wall, coping, pilasters; the chain-link over it
const STONE = { h: 1.3, t: 0.45, pilasterEvery: 22, fenceH: 2.0, postEvery: 3 };

/** A straight stretch of wall: its ends (m) and the way out to the street (unit) */
interface Stretch {
  a: PointXZ;
  b: PointXZ;
  out: PointXZ;
}

// A run cut in straight stretches at its bends
function stretches(w: CampusWall): Stretch[] {
  const out: Stretch[] = [];
  let start = 0;
  for (let i = 1; i < w.pts.length; i++) {
    const a = w.pts[start], b = w.pts[i], next = i + 1 < w.pts.length ? w.pts[i + 1] : null;
    const turn = next ? Math.atan2(next.z - b.z, next.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x) : 0;
    if (!next || Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > 0.06 || Math.hypot(b.x - a.x, b.z - a.z) > 60) {
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.3) out.push({ a, b, out: w.out[Math.floor((start + i) / 2)] });
      start = i;
    }
  }
  return out;
}

// The frame of a stretch's piece from s0 to s1 m along it: its middle on the ground, local +x along it, +z out
function pieceFrame(st: Stretch, s0: number, s1: number): { f: Frame; len: number } {
  const dx = st.b.x - st.a.x, dz = st.b.z - st.a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const m = (s0 + s1) / 2, x = st.a.x + ux * m, z = st.a.z + uz * m;
  // (local +z out: flip along when the out side is the other one)
  const flip = -uz * st.out.x + ux * st.out.z < 0 ? -1 : 1;
  return { f: { x, y: liftAt(x, z), z, yaw: Math.atan2(-uz * flip, ux * flip) }, len: s1 - s0 };
}

function buildWalls(kit: Kit, walls: readonly CampusWall[], mats: UanMaterials): { blue: number; stone: number } {
  let blueM = 0, stoneM = 0;
  const uanMat = letteringMaterial('UAN', 1.4, 0.9, '#d9dde2', { fill: 0.8, weight: 700 });
  for (const w of walls) {
    let u = 0; // (m along the run: the stone's texture runs on from piece to piece)
    for (const [si, st] of stretches(w).entries()) {
      const k0 = si === 0 ? 0 : 1; // (a bend's pier is the stretch before's last)
      const L = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z);
      if (w.style === 'blue') {
        blueM += L;
        // piers at both ends and every ~3.6 m between; a reja & its low wall between each two
        const n = Math.max(1, Math.round(L / BLUE.every)), step = L / n;
        for (let k = 0; k <= n; k++) {
          if (k >= k0) {
            const big = k > 0 && k < n && Math.round(u / step + k) % Math.round(BLUE.bigEvery) === 0;
            const { f } = pieceFrame(st, k * step, k * step);
            const pw = big ? BLUE.bigW : BLUE.pierW, pd = big ? BLUE.bigD : BLUE.pierD, ph = LOT_Y + (big ? BLUE.bigH : BLUE.pierH);
            kit.box(f, pw, ph + SINK, pd, 0, (ph - SINK) / 2, 0, mats.blue);
            kit.box(f, pw + 0.06, 0.06, pd + 0.06, 0, ph, 0, mats.blue); // (its cap)
            kit.collide(f, 0, 0, pw / 2, pd / 2, 0, ph);
            if (big) {
              kit.plane(f, 1.4, 0.9, 0, LOT_Y + 1.9, pd / 2 + 0.01, uanMat);
              kit.plane(f, 1.4, 0.9, 0, LOT_Y + 1.9, -pd / 2 - 0.01, uanMat, Math.PI);
            }
          }
          if (k === n) break;
          const { f: g, len } = pieceFrame(st, k * step, (k + 1) * step);
          const span = len - BLUE.pierW;
          kit.box(g, len, BLUE.wallH + LOT_Y + SINK, BLUE.wallT, 0, (BLUE.wallH + LOT_Y - SINK) / 2, 0, mats.blue);
          kit.box(g, len, 0.05, BLUE.wallT + 0.04, 0, BLUE.wallH + LOT_Y + 0.025, 0, mats.blue);
          kit.plane(g, span, REJA_H, 0, LOT_Y + BLUE.wallH + 0.05 + REJA_H / 2, 0, mats.reja);
          kit.collide(g, 0, 0, len / 2, BLUE.wallT / 2 + 0.05, 0, LOT_Y + BLUE.wallH + REJA_H);
        }
      } else {
        stoneM += L;
        const rubble = w.style === 'cal' ? mats.cal : mats.stone;
        const n = Math.max(1, Math.ceil(L / PIECE)), step = L / n;
        for (let k = 0; k < n; k++) {
          const { f, len } = pieceFrame(st, k * step, (k + 1) * step);
          const h = LOT_Y + STONE.h;
          // (a little longer than the piece, so the steps close)
          kit.box(f, len + 0.02, h + SINK, STONE.t, 0, (h - SINK) / 2, 0, rubble, u + k * step);
          kit.box(f, len + 0.04, 0.1, STONE.t + 0.08, 0, h + 0.05, 0, mats.coping);
          // the chain-link on its posts, the rail along the top
          const top = h + 0.1;
          kit.plane(f, len, STONE.fenceH, 0, top + STONE.fenceH / 2, 0, mats.chainLink, 0, u + k * step);
          kit.box(f, len, 0.045, 0.045, 0, top + STONE.fenceH, 0, mats.steel);
          const posts = Math.max(1, Math.round(len / STONE.postEvery));
          for (let p = 0; p < posts; p++) {
            kit.add(new THREE.CylinderGeometry(0.03, 0.03, STONE.fenceH + 0.1, 6), mats.steel, f, -len / 2 + (p * len) / posts, top + STONE.fenceH / 2, 0);
          }
          kit.collide(f, 0, 0, len / 2, STONE.t / 2 + 0.05, 0, top + STONE.fenceH);
        }
        // the pilasters, every ~22 m and at the stretch's ends
        const np = Math.max(1, Math.round(L / STONE.pilasterEvery));
        for (let p = k0; p <= np; p++) {
          const { f } = pieceFrame(st, (p * L) / np, (p * L) / np);
          const h = LOT_Y + STONE.h + 0.3;
          kit.box(f, 0.8, h + SINK, 0.7, 0, (h - SINK) / 2, 0, rubble, u + (p * L) / np);
          kit.box(f, 0.9, 0.12, 0.8, 0, h + 0.06, 0, mats.coping);
          // (the fence's corner post on it)
          kit.add(new THREE.CylinderGeometry(0.04, 0.04, STONE.fenceH, 6), mats.steel, f, 0, h + 0.12 + STONE.fenceH / 2 - 0.3, 0);
        }
      }
      // the sidewalk out to the roadway's edge (past the block's curb where the street's own edge runs further: the
      // poles stand on it), in short pieces deep enough to stay above the ground as it slopes under them
      if (w.curb > 0) {
        const paving = w.style === 'stone' ? mats.sidewalkRed : mats.sidewalk;
        const t = w.style === 'blue' ? BLUE.wallT : STONE.t, width = Math.min(9, Math.max(SIDEWALK, w.curb)) - t / 2;
        const n = Math.max(1, Math.ceil(L / WALK_PIECE)), step = L / n;
        for (let k = 0; k < n; k++) {
          const { f, len } = pieceFrame(st, k * step, (k + 1) * step);
          kit.box(f, len + 0.05, WALK_DEPTH, width, 0, LOT_Y + 0.03 - WALK_DEPTH / 2, t / 2 + width / 2, paving, u + k * step);
        }
      }
      u += L;
    }
  }
  return { blue: blueM, stone: stoneM };
}

// The pipe railings along Mercado's canal: a tube 0.8 m up on posts every ~2.4 m, painted, in straight pieces
function buildRails(kit: Kit, rails: readonly PointXZ[][], mats: UanMaterials): number {
  let metres = 0;
  for (const line of rails) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.2) continue;
      metres += L;
      const f: Frame = { x: (a.x + b.x) / 2, y: liftAt((a.x + b.x) / 2, (a.z + b.z) / 2), z: (a.z + b.z) / 2, yaw: Math.atan2(-(b.z - a.z), b.x - a.x) };
      kit.add(new THREE.CylinderGeometry(0.06, 0.06, L + 0.12, 8).rotateZ(Math.PI / 2), mats.pipe, f, 0, 0.82, 0);
      if (i % 2 === 1) kit.add(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8), mats.pipe, f, -L / 2, 0.4, 0);
    }
    const end = line[line.length - 1];
    kit.add(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8), mats.pipe, { x: end.x, y: liftAt(end.x, end.z), z: end.z, yaw: 0 }, 0, 0.4, 0);
  }
  return metres;
}

export { buildWalls, buildRails, LOT_Y, SINK };
