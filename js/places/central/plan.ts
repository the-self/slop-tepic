// js/places/central/plan.ts
// The Central de Autobuses de Tepic on Av. Insurgentes (Ciudad del Valle), as OpenStreetMap maps it (amenity=
// bus_station way 1314077649, its patio the landuse=industrial depot 1314077682, the buses' one-way loop round it
// way 295445292) and as the satellite shows it: the long terminal under its red tile roof along the avenue, its front
// on the car park, the andenes along its back where the coaches stand nose in, slanted, under the canopy, and behind
// them the patio, open to Av. Preparatoria, where the coaches wait in a slanted row along the wall on Calle Dr.
// Bernardo Martínez. Neither OpenStreetMap nor Overture has the terminal's footprint, so the block was an empty lot.
// Here too: the hall's doors and what stands inside it (the taquillas, the waiting room's chairs), the KFC on its
// corner, the patio's wall closed all round but for the gate, and the gates' casetas & arms (the photos of 2024).
// Everything is laid out in the terminal's own frame: u along it from its north-west end towards Av. Preparatoria, v
// across it from its front on Insurgentes towards the patio (m). Plain data (no three.js), so node --test reads it:
// index.ts builds it.

import { geoToWorld } from '../../world/geo.ts';
import { hash } from '../../world/hash.ts';
import { insidePoly } from '../../world/rings.ts';
import type { PointXZ } from '../../world/city-config.ts';
import type { CarPark } from '../../world/parking.ts';
import type { PlaceClaims } from '../../world/place-claims.ts';

// The frame: its origin the station's north corner (its outline's vertex on the car park), u towards its east corner
// on the same side (OpenStreetMap's nodes of way 1314077649), v square to it towards the patio
const [OX, OZ] = geoToWorld(21.4987315, -104.8869456);
const [EX, EZ] = geoToWorld(21.4980991, -104.8863505);
const UL = Math.hypot(EX - OX, EZ - OZ);
const UX = (EX - OX) / UL, UZ = (EZ - OZ) / UL;
const VX = -UZ, VZ = UX;

/** A point of the frame (u, v) in the world (m) */
function centralAt(u: number, v: number): PointXZ {
  return { x: OX + u * UX + v * VX, z: OZ + u * UZ + v * VZ };
}
/** A world point (m) in the frame: [u, v] */
function centralFrame(x: number, z: number): [number, number] {
  const dx = x - OX, dz = z - OZ;
  return [dx * UX + dz * UZ, dx * VX + dz * VZ];
}
/** A heading (rad, atan2 of the nose's x over its z: the traffic's convention) for a direction (du, dv) of the frame */
function centralHeading(du: number, dv: number): number {
  return Math.atan2(du * UX + dv * VX, du * UZ + dv * VZ);
}

/** An axis-aligned rectangle of the frame (m): [u0, u1, v0, v1] */
export type FrameRect = [u0: number, u1: number, v0: number, v1: number];

/** The terminal's hall (its walls), the walk along its front on the car park and the canopy over the andén behind it */
const TERMINAL: FrameRect = [0, 93, 0, 26];
const PORTAL = 3.2; // m of walk in front of the glass, under the dark band's overhang, on the hall's floor
const CANOPY = 6.5; // m the andén's umbrellas reach past the back wall, over the andén and the coaches' noses
/** The andén: the walk along the back wall where the passengers board, on the hall's floor (m) */
const PLATFORM: FrameRect = [0, 93, 26, 29.5];
/** The KFC at the terminal's east end, on the corner of Av. Preparatoria (the photos: its flank on the avenue) */
const ANNEX: FrameRect = [93.15, 103, 0, 14];
/** The patio, paved: from the andenes to the wall on Calle Dr. Martínez, the shed by República de Chile (one of
 *  Overture's buildings, u -52..-31) on its west and the workshop in its south-east corner (OpenStreetMap's way
 *  295445278) left out */
const PATIO: [number, number][] = [[-30.5, 26], [103, 26], [103, 67], [66.5, 67], [66.5, 81.5], [-30.5, 81.5]];
/** The bus gate on Av. Preparatoria (u, the wall's line; v0..v1 its opening): the way in nearer Insurgentes, the
 *  caseta on its island, the way out (the order the coaches meet them coming down the avenue on its right) */
const GATE = { u: 103.2, v0: 45, v1: 64.5, inV: [45.4, 54.1] as Span, island: [54.3, 57.7] as Span, outV: [57.9, 64.1] as Span };
/**
 * The walls round the patio (u0, v0, u1, v1), closed all round but for the bus gate: on Calle Dr. Martínez, along the
 * workshop's two sides, on Preparatoria from the KFC to the gate and on from it to the workshop, along the shed by
 * República de Chile, and across from it to the hall's corner, shutting off the car park on República de Chile
 */
const WALLS: [number, number, number, number][] = [
  [-30.5, 81.7, 66.3, 81.7], [66.3, 66.8, 66.3, 81.7], [66.3, 66.8, 103.2, 66.8],
  [103.2, ANNEX[3] - 0.5, 103.2, GATE.v0], [103.2, GATE.v1, 103.2, 66.8],
  [-30.3, 27.6, -30.3, 81.7], [-30.5, 27.6, -0.15, 27.6], [-0.15, 26, -0.15, 27.6]
];
/** The block (m of the frame): what is left to the Central, no yard tree, no barda */
const BLOCK: FrameRect = [-53, 104, -4, 82];

/** A span of the frame (m) */
type Span = [number, number];
/** The front's bays: the glass between pillars, BAYS of them along the hall */
const BAYS = 12;
/** The doors in the front's glass (u of their middle, m): the two under the sign, one towards either end */
const FRONT_DOORS = [1, 5, 6, 10].map((k) => TERMINAL[0] + ((k + 0.5) * (TERMINAL[1] - TERMINAL[0])) / BAYS);
const DOOR_W = 3.0; // m: a front door's opening (two leaves sliding apart)
const DOOR_H = 2.7; // m
/** The doors in the back wall onto the andén (u0..u1 of each opening, m): one every 4.5 m */
const BACK_DOORS: Span[] = [];
for (let u = TERMINAL[0] + 3; u + 2.6 < TERMINAL[1]; u += 4.5) BACK_DOORS.push([u, u + 2.6]);
/** Chairs to a row in the waiting room (a row 2.4 m long) */
const SEATS_PER = 4;
/** A chair's seat over the floor (m) */
const SEAT_H = 0.45;
/** The ceiling's height over the hall's floor (m) */
const CEILING = 4.6;

/** Inside: what stands on the hall's floor, as boxes of the frame [u0, u1, v0, v1, height (m)] */
interface HallFurniture {
  /** the lines' ticket counters (taquillas), each with its name board over it: [u0, u1] and the line it sells */
  taquillas: { u0: number; u1: number; line: number }[];
  /** the counters' run across the hall (v of their front, their depth, the board's back) */
  counterV: Span;
  /** the waiting room's rows of chairs, facing the andén's doors: [u0, u1, v] (their backs' v), SEATS_PER chairs to a
   *  row on one beam */
  benches: [number, number, number][];
  /** each chair's seat: its middle (u, v; m) — whoever sits on it faces +v, the andén */
  seats: [number, number][];
  /** the columns holding up the roof inside: (u, v) */
  columns: [number, number][];
  /** the kiosks in the lobby (snacks, magazines): [u0, u1, v0, v1] and their awning's colour (0xrrggbb) */
  kiosks: [number, number, number, number, number][];
}
/** The hall's layout: the taquillas in two runs either side of the way through to the andén (u 44..49), the lobby in
 *  front of them, the waiting room behind them by the doors onto the andén */
function hallFurniture(lines: number): HallFurniture {
  const taquillas: HallFurniture['taquillas'] = [];
  const runs: Span[] = [[14, 44], [49, 79]];
  const per = Math.ceil(lines / runs.length);
  runs.forEach(([a, b], r) => {
    for (let k = 0; k < per && r * per + k < lines; k++) {
      const w = (b - a) / per;
      taquillas.push({ u0: a + k * w, u1: a + (k + 1) * w, line: r * per + k });
    }
  });
  const benches: [number, number, number][] = [];
  for (const v of [19.5, 22.5]) {
    for (let u = 4; u + 2.4 < 89; u += 3.1) {
      // (a gap to walk through every few benches, and the way through behind the taquillas' gap)
      if (Math.floor((u - 4) / 3.1) % 4 === 3 || (u + 2.4 > 43 && u < 50)) continue;
      benches.push([u, u + 2.4, v]);
    }
  }
  const seats: [number, number][] = [];
  for (const [a, b, v] of benches) for (let k = 0; k < SEATS_PER; k++) seats.push([a + ((k + 0.5) * (b - a)) / SEATS_PER, v + 0.3]);
  const columns: [number, number][] = [];
  for (let k = 1; k < 6; k++) columns.push([(k * (TERMINAL[1] - TERMINAL[0])) / 6, 8]);
  const kiosks: HallFurniture['kiosks'] = [[4, 9, 4, 7, 0xd8402a], [84, 89, 4, 7, 0x2a6fd8]];
  return { taquillas, counterV: [15, 16.2], benches, seats, columns, kiosks };
}

/** A barrier arm (pluma) at a gate: its pivot (m), the way the arm reaches from it when down (unit), its length (m),
 *  the way through it (unit, either way) and its lane's half width (m), its caseta's side */
export interface GateArm {
  x: number;
  z: number;
  ax: number;
  az: number;
  length: number;
  /** across the arm: the way in through it (into the Central's ground, away from the street) */
  tx: number;
  tz: number;
  /** whose: the coaches' gate (stripes yellow & black) or a car park's (red & white) */
  kind: 'bus' | 'car';
}
/** A caseta: where it stands (m), its turn (rad, its front facing (sin, cos)), its size w × d × h (m), whether it has
 *  the car parks' curved canopy over the way in */
export interface Caseta {
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
  canopy: boolean;
}

/** The bus gate's casetas and arms: the caseta on the island between the way in and the way out, an arm across each */
function busGate(): { arms: GateArm[]; casetas: Caseta[] } {
  const u = GATE.u - 0.6;
  // (the way in, from Preparatoria: -u)
  const [tx, tz] = (() => { const a = centralAt(1, 0), b = centralAt(0, 0); return [b.x - a.x, b.z - a.z]; })();
  const arm = (v0: number, v1: number): GateArm => {
    const p = centralAt(u, v0), q = centralAt(u, v1), L = Math.hypot(q.x - p.x, q.z - p.z);
    return { x: p.x, z: p.z, ax: (q.x - p.x) / L, az: (q.z - p.z) / L, length: L, tx, tz, kind: 'bus' };
  };
  const c = centralAt(GATE.u - 1.6, (GATE.island[0] + GATE.island[1]) / 2);
  return {
    // (each pivots on the island, its tip over the far side of its lane)
    arms: [arm(GATE.island[0] - 0.2, GATE.inV[0] + 0.3), arm(GATE.island[1] + 0.2, GATE.outV[1] - 0.3)],
    casetas: [{ x: c.x, z: c.z, yaw: centralHeading(1, 0), w: GATE.island[1] - GATE.island[0] - 0.6, d: 2.4, h: 2.7, canopy: false }]
  };
}

/** A totem by the way in: the lines that leave from the Central lettered down it (the photos: on the car park's corner
 *  of Preparatoria), where it stands (m) and the way its faces look (heading, rad) */
export interface Totem {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The car parks' gates by the Central: at each entrance of a lot whose curb lies within 8 m of its block (the front
 * one's on Preparatoria, the side one's on República de Chile), a caseta beside the driveway on the hall's side under
 * its curved canopy, an arm across the driveway where it meets the lot; and on Preparatoria the totem on its other side
 */
function carParkGates(lots: readonly Pick<CarPark, 'entrances'>[]): { arms: GateArm[]; casetas: Caseta[]; totems: Totem[] } {
  const arms: GateArm[] = [], casetas: Caseta[] = [], totems: Totem[] = [];
  const hall = centralAt((TERMINAL[0] + TERMINAL[1]) / 2, (TERMINAL[2] + TERMINAL[3]) / 2);
  for (const lot of lots) {
    for (const e of lot.entrances) {
      const [u, v] = centralFrame(e.x, e.z);
      if (u < BLOCK[0] - 8 || u > BLOCK[1] + 8 || v < BLOCK[2] - 8 || v > BLOCK[3] + 8) continue;
      const end = e.path[e.path.length - 1];
      const len = Math.hypot(end.x - e.x, end.z - e.z);
      // across the driveway, towards the hall
      let sx = -e.nz, sz = e.nx;
      if ((hall.x - e.x) * sx + (hall.z - e.z) * sz < 0) [sx, sz] = [-sx, -sz];
      const half = e.width / 2;
      const at = (along: number, across: number): PointXZ => ({ x: e.x + e.nx * along + sx * across, z: e.z + e.nz * along + sz * across });
      // the arm where the driveway meets the lot, pivoting on the caseta's side
      const p = at(Math.max(0, len - 0.6), half - 0.15);
      arms.push({ x: p.x, z: p.z, ax: -sx, az: -sz, length: e.width - 0.4, tx: e.nx, tz: e.nz, kind: 'car' });
      // the caseta beside it, its window on the driveway (short of the curb: the sidewalk is left to walk on)
      const W = 2.0, D = 1.8;
      const c = at(Math.min(len, Math.max(1.4, len - 2.5)), half + 0.5 + D / 2);
      casetas.push({ x: c.x, z: c.z, yaw: Math.atan2(-sx, -sz), w: W, d: D, h: 2.5, canopy: true });
      if (u > TERMINAL[1]) {
        const t = at(0.9, -(half + 1.4));
        totems.push({ x: t.x, z: t.z, yaw: Math.atan2(-e.nx, -e.nz) });
      }
    }
  }
  return { arms, casetas, totems };
}

/** A coach's size (m), as the coach model's (actors/vehicles/coach.ts COACH_SIZE) */
const COACH_L = 13.2;
const COACH_W = 2.6;

/** A slanted row of bays: from u0 to u1 along a line at v (its front: the noses' end), the noses towards `dir`
 *  (+1: +v, -1: -v), slanted `slant` rad off square towards +u, the bays `gap` m apart between the coaches' sides */
interface BayRow {
  u0: number;
  u1: number;
  v: number;
  dir: 1 | -1;
  slant: number;
  gap: number;
  /** the share of the bays taken */
  fill: number;
}
const ROWS: BayRow[] = [
  // the andenes: nose in to the platform's curb (v 29.5), slanted 30° (the photo: they back out towards Preparatoria)
  { u0: 3, u1: 91, v: 29.8, dir: -1, slant: 0.52, gap: 1.4, fill: 0.7 },
  // the patio's row along the wall on Dr. Martínez: nose to the wall, slanted 40°
  { u0: -21, u1: 63, v: 81.0, dir: 1, slant: 0.7, gap: 1.1, fill: 0.85 }
];

/** A bay: where a coach stands in it (its middle, m), the way its nose faces (heading, rad), and its side lines'
 *  two ends either side (m: the line from the front to the back) */
export interface CoachBay {
  x: number;
  z: number;
  heading: number;
  lines: [PointXZ, PointXZ][];
  /** the row it is in (0 the andenes, 1 the patio's) */
  row: number;
}

/** A coach standing in a bay: the bay, its line (an index into the lines' table, build/site.ts LINES) */
export interface ParkedCoach {
  bay: CoachBay;
  line: number;
}

/** The bays of the andenes and the patio's row */
function coachBays(): CoachBay[] {
  const bays: CoachBay[] = [];
  ROWS.forEach((r, row) => {
    // the nose's direction in the frame
    const fu = Math.sin(r.slant), fv = r.dir * Math.cos(r.slant);
    const pitch = (COACH_W + r.gap) / Math.cos(r.slant); // m along the row from one bay to the next
    // (the nose's leading corner on the row's line: the middle of the nose a little short of it)
    const back = (COACH_W / 2) * Math.sin(r.slant);
    // a line from the row's line back along the coaches, at u (the one between two bays, painted by the first)
    const line = (u: number): [PointXZ, PointXZ] => [centralAt(u, r.v), centralAt(u - fu * (COACH_L + 0.8), r.v - fv * (COACH_L + 0.8))];
    const n = Math.floor((r.u1 - r.u0) / pitch);
    for (let k = 0; k < n; k++) {
      const u = r.u0 + (k + 0.5) * pitch;
      const nu = u, nv = r.v - r.dir * back;
      const c = centralAt(nu - fu * COACH_L / 2, nv - fv * COACH_L / 2);
      const lines = [line(u - pitch / 2)];
      if (k === n - 1) lines.push(line(u + pitch / 2));
      bays.push({ x: c.x, z: c.z, heading: centralHeading(fu, fv), lines, row });
    }
  });
  return bays;
}

/** The coaches in the bays: each row's share of them taken (the same ones every load), each of one of `lines` lines;
 *  none in the bays `skip` (the coaches that come and go: plan-runs.ts) */
function parkCoaches(bays: readonly CoachBay[], lines: number, skip: readonly CoachBay[] = []): ParkedCoach[] {
  const out: ParkedCoach[] = [];
  for (const bay of bays) {
    if (hash(bay.x, bay.z, 61) >= ROWS[bay.row].fill || skip.includes(bay)) continue;
    out.push({ bay, line: Math.floor(hash(bay.z, bay.x, 62) * lines) % lines });
  }
  return out;
}

const PATIO_PTS = PATIO.map(([u, v]) => centralAt(u, v));
const PATIO_FRAME = PATIO.map(([u, v]) => ({ x: u, z: v }));
/** Whether (x, z) lies on the patio */
function inPatio(x: number, z: number): boolean {
  const [u, v] = centralFrame(x, z);
  return insidePoly(PATIO_FRAME, u, v);
}
/** Whether (u, v) of the frame lies in the Central's block (inside its property lines) */
function inBlock(u: number, v: number): boolean {
  return u >= BLOCK[0] && u <= BLOCK[1] && v >= BLOCK[2] && v <= BLOCK[3];
}
/** Whether (x, z) lies in the Central's block */
function inCentral(x: number, z: number): boolean {
  const [u, v] = centralFrame(x, z);
  return inBlock(u, v);
}

/** What the Central claims of the town's ground (world/place-claims.ts): its block, where the town plants no tree and
 *  raises no barda (its own walls close the patio) */
const CENTRAL_CLAIMS: PlaceClaims = { trees: { contains: inCentral }, open: inCentral };

export type { Span, HallFurniture };
export {
  CENTRAL_CLAIMS,
  TERMINAL, PORTAL, CANOPY, PLATFORM, ANNEX, PATIO_PTS, WALLS, GATE, BAYS, FRONT_DOORS, DOOR_W, DOOR_H, BACK_DOORS, CEILING,
  SEATS_PER, SEAT_H,
  COACH_L, COACH_W, ROWS,
  centralAt, centralFrame, centralHeading, coachBays, parkCoaches, inPatio, inBlock, inCentral, hallFurniture, busGate, carParkGates
};
