// js/world/central-plan.ts
// The Central de Autobuses de Tepic on Av. Insurgentes (Ciudad del Valle), as OpenStreetMap maps it (amenity=
// bus_station way 1314077649, its patio the landuse=industrial depot 1314077682, the buses' one-way loop round it
// way 295445292) and as the satellite shows it: the long terminal under its red tile roof along the avenue, its front
// on the car park, the andenes along its back where the coaches stand nose in, slanted, under the canopy, and behind
// them the patio, open to Av. Preparatoria, where the coaches wait in a slanted row along the wall on Calle Dr.
// Bernardo Martínez. Neither OpenStreetMap nor Overture has the terminal's footprint, so the block was an empty lot.
// Everything is laid out in the terminal's own frame: u along it from its north-west end towards Av. Preparatoria, v
// across it from its front on Insurgentes towards the patio (m). Plain data (no three.js), so node --test reads it:
// central.ts builds it.

import { geoToWorld } from './geo.ts';
import { hash } from './hash.ts';
import { insidePoly } from './rings.ts';
import type { PointXZ } from './city-config.ts';

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

/** The terminal's hall (its walls), the portal along its front on the car park and the canopy over the andén behind it */
const TERMINAL: FrameRect = [0, 93, 0, 26];
const PORTAL = 3.2; // m the roof runs on past the front wall, over the walk by the car park
const CANOPY = 6.5; // m it runs on past the back wall, over the andén and the coaches' noses
/** The andén: the raised walk along the back wall where the passengers board, its curb (m) */
const PLATFORM: FrameRect = [0, 93, 26, 29.5];
/** The patio, paved: from the andenes to the wall on Calle Dr. Martínez, the shed by República de Chile (one of
 *  Overture's buildings, u -52..-31) on its west and the workshop in its south-east corner (OpenStreetMap's way
 *  295445278) left out */
const PATIO: [number, number][] = [[-30.5, 26], [103, 26], [103, 67], [66.5, 67], [66.5, 81.5], [-30.5, 81.5]];
/** The walls round the patio (u0, v0, u1, v1), a gap on Av. Preparatoria where the loop goes in and out */
const WALLS: [number, number, number, number][] = [[-30.5, 81.7, 66.5, 81.7], [103.2, 29.5, 103.2, 45], [103.2, 64.5, 103.2, 67]];
/** The block (m of the frame): what is left to the Central, no yard tree, no barda */
const BLOCK: FrameRect = [-53, 104, -4, 82];

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

/** A coach standing in a bay: the bay, its line (an index into the lines' table, central.ts) */
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

/** The coaches in the bays: each row's share of them taken (the same ones every load), each of one of `lines` lines */
function parkCoaches(bays: readonly CoachBay[], lines: number): ParkedCoach[] {
  const out: ParkedCoach[] = [];
  for (const bay of bays) {
    if (hash(bay.x, bay.z, 61) >= ROWS[bay.row].fill) continue;
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
/** Whether (x, z) lies in the Central's block (inside its property lines) */
function inCentral(x: number, z: number): boolean {
  const [u, v] = centralFrame(x, z);
  return u >= BLOCK[0] && u <= BLOCK[1] && v >= BLOCK[2] && v <= BLOCK[3];
}

export {
  TERMINAL, PORTAL, CANOPY, PLATFORM, PATIO_PTS, WALLS, COACH_L, COACH_W,
  centralAt, centralFrame, centralHeading, coachBays, parkCoaches, inPatio, inCentral
};
