// js/world/buildings/footprints.ts
// Rectilinear footprints: the lots' rects and the plans carved out of them (courts, notches, light wells) as unions
// of non-overlapping boxes, in the frame of the lots being filled (js/world/buildings.ts).
import type { Rect, Side } from './types.ts';

// ============================================================================
// RECTILINEAR FOOTPRINTS: plans as unions of non-overlapping axis-aligned rects { x0, x1, z0, z1 }
// (x runs west → east, z north → south)
// ============================================================================
const EPS = 0.05;
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' };
const rect = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });
const rectW = (r: Rect) => r.x1 - r.x0;
const rectD = (r: Rect) => r.z1 - r.z0;
const insetAll = (r: Rect, d: number) => rect(r.x0 + d, r.x1 - d, r.z0 + d, r.z1 - d);

// Length of side `s` of rect r, and the rect's extent perpendicular to it
const sideLen = (r: Rect, s: Side) => (s === 'n' || s === 's' ? r.x1 - r.x0 : r.z1 - r.z0);
const sideDepth = (r: Rect, s: Side) => (s === 'n' || s === 's' ? r.z1 - r.z0 : r.x1 - r.x0);

/** Rect in the frame of side `s` of r: `a` runs along that side (from its west / north end), `b` inward from it */
function sideRect(r: Rect, s: Side, a0: number, a1: number, b0: number, b1: number) {
  if (s === 'n') return rect(r.x0 + a0, r.x0 + a1, r.z0 + b0, r.z0 + b1);
  if (s === 's') return rect(r.x0 + a0, r.x0 + a1, r.z1 - b1, r.z1 - b0);
  if (s === 'w') return rect(r.x0 + b0, r.x0 + b1, r.z0 + a0, r.z0 + a1);
  return rect(r.x1 - b1, r.x1 - b0, r.z0 + a0, r.z0 + a1);
}

/** Light court `cw` wide and `cd` deep, cut into the middle of side `s` (shifted `off` along it) */
function courtHole(r: Rect, s: Side, cw: number, cd: number, off = 0) {
  const L = sideLen(r, s);
  return sideRect(r, s, (L - cw) * 0.5 + off, (L + cw) * 0.5 + off, -1, cd);
}

/** Notches nx (along x) by nz (along z) cut from the given corners of r */
function cornerHoles(r: Rect, nx: number, nz: number, corners = ['nw', 'ne', 'sw', 'se']) {
  return corners.map((c) => {
    const x0 = c[1] === 'w' ? r.x0 - 1 : r.x1 - nx;
    const z0 = c.startsWith('n') ? r.z0 - 1 : r.z1 - nz;
    return rect(x0, x0 + nx + 1, z0, z0 + nz + 1);
  });
}

/**
 * `r` minus `holes`, as non-overlapping rects: sliced into strips across `axis` ('x': strips running north-south,
 * 'z': strips running east-west) at every hole edge, neighbouring strips with identical spans merged back, so a
 * U-plan comes out as its base bar plus two wings. Slice so the street front stays one piece (one window grid).
 */
function carve(r: Rect, holes: Rect[], axis: 'x' | 'z' = 'x') {
  const flip = axis === 'z';
  const U0 = flip ? r.z0 : r.x0;
  const U1 = flip ? r.z1 : r.x1;
  const V0 = flip ? r.x0 : r.z0;
  const V1 = flip ? r.x1 : r.z1;
  const hs = holes.map((h) => (flip ? [h.z0, h.z1, h.x0, h.x1] : [h.x0, h.x1, h.z0, h.z1]));
  const cuts = [U0, U1];
  for (const [u0, u1] of hs) {
    if (u0 > U0 + EPS && u0 < U1 - EPS) cuts.push(u0);
    if (u1 > U0 + EPS && u1 < U1 - EPS) cuts.push(u1);
  }
  cuts.sort((a, b) => a - b);

  /** strips [u0, u1, v0, v1] */
  const out: number[][] = [];
  let open: number[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ua = cuts[i];
    const ub = cuts[i + 1];
    if (ub - ua < EPS) continue;
    const um = (ua + ub) * 0.5;
    let spans = [[V0, V1]];
    for (const [u0, u1, v0, v1] of hs) {
      if (um <= u0 || um >= u1) continue;
      const next = [];
      for (const [a, b] of spans) {
        if (v1 <= a + EPS || v0 >= b - EPS) {
          next.push([a, b]);
          continue;
        }
        if (v0 > a + EPS) next.push([a, v0]);
        if (v1 < b - EPS) next.push([v1, b]);
      }
      spans = next;
    }
    const nextOpen: number[][] = [];
    for (const [a, b] of spans) {
      let strip = open.find((o) => Math.abs(o[2] - a) < EPS && Math.abs(o[3] - b) < EPS);
      if (strip) {
        strip[1] = ub;
      } else {
        strip = [ua, ub, a, b];
        out.push(strip);
      }
      nextOpen.push(strip);
    }
    open = nextOpen;
  }
  return out.map(([u0, u1, v0, v1]) => (flip ? rect(v0, v1, u0, u1) : rect(u0, u1, v0, v1)));
}

export { EPS, OPPOSITE, rect, rectW, rectD, insetAll, sideLen, sideDepth, sideRect, courtHole, cornerHoles, carve };
