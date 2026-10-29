// js/places/embotelladora/plan.ts
// The Coca-Cola bottling plant on Av. Insurgentes (Ciudad del Valle), across Prolongación Otranto from Ley Álica: the
// whole block between Insurgentes, Calle Buenos Aires, Av. Paseo de Hamburgo and Otranto, as OpenStreetMap maps it
// (landuse=industrial "Embotelladora del Nayar", way 1419418991; the plant's shed, way 295445279; the offices, way
// 295445261; the shed by Otranto, way 1419418990; the depot on Hamburgo, way 295445260) and as the street shows it:
// along Insurgentes the shed's front, white between cream pilasters behind a hedge, its grey cladding rising over it
// with the name; the trucks' gate, red, under a brown canopy, the guard's booth; the two-storey offices behind a red
// bar fence, a round glass tower at their door; the staff's car park in the corner; along Otranto a precast concrete
// wall, the white tanks over it; along Hamburgo a brick wall, chain-link and barbed wire on top, and the depot's red
// shutters. In the yard the tráilers back up to the shed and the red route trucks stand in rows. Overture had the shed
// as one 159 × 188 m box over the whole block (and OSM's footprints overhang Hamburgo's sidewalk): the plan keeps
// their lines, cut to the property lines. Laid out in the plant's own frame: u along Insurgentes from Buenos Aires
// towards Otranto, v across it from Insurgentes towards Hamburgo (m). Plain data (no three.js), so node --test reads
// it: index.ts builds it.

import { geoToWorld } from '../../world/geo.ts';
import { hash } from '../../world/hash.ts';
import { insidePoly } from '../../world/rings.ts';
import type { PointXZ } from '../../world/city-config.ts';
import type { PlaceClaims } from '../../world/place-claims.ts';

// The frame: its origin the block's corner on Insurgentes & Buenos Aires, u towards its corner on Insurgentes &
// Otranto (OpenStreetMap's nodes of way 1419418991), v square to it towards Hamburgo
const [OX, OZ] = geoToWorld(21.4960924, -104.8842698);
const [EX, EZ] = geoToWorld(21.4943811, -104.8826047);
const UL = Math.hypot(EX - OX, EZ - OZ);
const UX = (EX - OX) / UL, UZ = (EZ - OZ) / UL;
const VX = -UZ, VZ = UX;

/** A point of the frame (u, v) in the world (m) */
function plantAt(u: number, v: number): PointXZ {
  return { x: OX + u * UX + v * VX, z: OZ + u * UZ + v * VZ };
}
/** A world point (m) in the frame: [u, v] */
function plantFrame(x: number, z: number): [number, number] {
  const dx = x - OX, dz = z - OZ;
  return [dx * UX + dz * UZ, dx * VX + dz * VZ];
}
/** A heading (rad, atan2 of the nose's x over its z: the traffic's convention) for a direction (du, dv) of the frame */
function plantHeading(du: number, dv: number): number {
  return Math.atan2(du * UX + dv * VX, du * UZ + dv * VZ);
}

/** An axis-aligned rectangle of the frame (m): [u0, u1, v0, v1] */
export type PlantRect = [u0: number, u1: number, v0: number, v1: number];
/** A point of the frame (m): [u, v] */
export type PlantPoint = [u: number, v: number];

/** The block inside its property lines (the street grid's block, its sidewalks taken off) */
const LOT: PlantPoint[] = [[-2.5, -1.2], [255.6, -0.6], [249, 199.8], [237, 198.8], [135.6, 194.8], [-5.6, 186.8], [-3.3, 103]];
/** The yard's concrete: the lot but for the staff's car park in its north-east corner (its own asphalt, car-parks.ts) */
const YARD: PlantPoint[] = [[-2.5, -1.2], [223.5, -1.0], [223.3, 37], [224, 46.4], [254.1, 46.4], [249, 199.8], [237, 198.8],
  [135.6, 194.8], [-5.6, 186.8], [-3.3, 103]];

/** The shed's front on Insurgentes: the offices & stores along it, lower than the shed behind (m: their roof) */
const FRONT: PlantRect = [0, 119, 1.4, 30];
const FRONT_H = 9;
/** The shed (way 295445279), in rectangles: its east wall on the yard, the loading bay cut into its south-east */
const SHED: PlantRect[] = [[0, 155, 30, 120], [0, 100, 120, 145], [0, 78, 145, 172], [0, 100, 172, 186]];
const SHED_H = 12.5;
/** The two-storey building by the gate, behind the red fence (one of Overture's footprints) */
const ANNEX: PlantRect = [126.5, 144.4, 6.3, 17.7];
const ANNEX_H = 7;
/** The pilasters along the front (m apart), the hedge between them */
const PILASTER_BAY = 6.6;
/** The offices (way 295445261), two storeys; the round glass tower at their door ([u, v, radius, height] m) */
const OFFICE: PlantRect = [175, 224, 12.7, 28.2];
const OFFICE_H = 8.2;
const TOWER: [u: number, v: number, r: number, h: number] = [196.5, 15.2, 6.4, 10.6];
/** The trucks' gate: its two leaves from u0 to u1 at v, under the canopy over the way in (its posts the gate's) */
const GATE: [u0: number, u1: number, v: number] = [145.3, 169.7, 1.0];
const GATE_H = 3.4;
const CANOPY: PlantRect = [141, 173.5, 0.2, 21];
const CANOPY_H = 8.0;
/** The guard's booth by the gate, on the fence's line: it closes the way between the gate's post and the fence */
const BOOTH: PlantRect = [170.2, 175.3, 0.3, 5.5];
/** The depot on Hamburgo (way 295445260): its red shutters on the street */
const DEPOT: PlantRect = [186, 222, 180.5, 196.4];
const DEPOT_H = 6.2;
/** The sheds along Otranto (way 1419418990, and Overture's south of it) */
const STORES: PlantRect[] = [[239, 250.3, 80, 118], [239, 249.6, 124, 154], [239, 249.1, 174, 193.5]];
const STORE_H = 7;
/** The tanks by Otranto: [u, v, radius, height] (m) */
const TANKS: [u: number, v: number, r: number, h: number][] = [[227, 61.5, 4.3, 10.5], [237.4, 61.5, 4.3, 10.5], [246, 64, 2.4, 7.5]];
/** The topiary ficus along Insurgentes' sidewalk, in white round planters: their u (m), at TOPIARY_V */
const TOPIARY_V = -2.2;
const TOPIARIES = [6, 19, 32, 45, 58, 71, 84, 97, 110, 123, 136, 179, 189, 207, 216, 232, 245];

/** A wall's or a fence's run: its points (m, the frame's), its kind: the red bar fence on Insurgentes, the precast
 *  concrete wall on Otranto, the brick wall (chain-link & barbed wire on top) on Hamburgo, the chain-link by the depot.
 *  With the buildings on the street (the shed and its front, the annex, the gate & its booth, the depot) they close
 *  the block all round: each run's ends meet another run's or a building's wall (tests/embotelladora.test.mjs) */
export type FenceKind = 'bars' | 'precast' | 'brick' | 'chain';
export interface FenceRun {
  kind: FenceKind;
  pts: PlantPoint[];
}
const FENCES: FenceRun[] = [
  // (from the front's last pilaster out to the property line, along it, and in to the gate's post)
  { kind: 'bars', pts: [[119, 0.7], [119.3, 0.2], [144.8, 0.2], [145.05, 0.78]] },
  { kind: 'bars', pts: [[175.3, 0.2], [255.5, 0.2], [254.1, 46.4]] },
  { kind: 'precast', pts: [[254.1, 46.4], [249, 199.6]] },
  { kind: 'brick', pts: [[249, 199.6], [237, 198.6], [222, 198], [222, 196.4]] },
  { kind: 'brick', pts: [[186, 196.6], [176, 196.2]] },
  { kind: 'chain', pts: [[176, 196.2], [164, 195.7]] },
  { kind: 'brick', pts: [[164, 195.7], [135.6, 194.6], [100.2, 192.9], [100.2, 186]] }
];
/** How tall each kind stands (m) */
const FENCE_H: Record<FenceKind, number> = { bars: 2.6, precast: 3.0, brick: 4.2, chain: 2.4 };

/** The route trucks' size (m), as the model's (actors/vehicles/route-truck.ts ROUTE_TRUCK_SIZE) */
const TRUCK_L = 8.2;
const TRUCK_W = 2.45;
/** The tráilers' (actors/vehicles/tractor-trailer.ts TRUCK_SIZE) */
const TRAILER_L = 23.55;

/** A row of the yard's bays: from u0 to u1 at v (the trucks' middles), noses towards Insurgentes; the share taken */
interface TruckRow {
  u0: number;
  u1: number;
  v: number;
  fill: number;
}
const ROWS: TruckRow[] = [
  { u0: 183, u1: 222, v: 76, fill: 0.8 },
  { u0: 183, u1: 237, v: 104, fill: 0.75 },
  { u0: 160, u1: 236, v: 136, fill: 0.7 },
  { u0: 104, u1: 182, v: 167, fill: 0.7 }
];
const BAY_GAP = 1.2; // m between two trucks' sides

/** A bay: where a truck stands in it (its middle, m), the way its nose faces (heading, rad), the row */
export interface TruckBay {
  x: number;
  z: number;
  heading: number;
  row: number;
}
/** The yard's bays, row by row */
function truckBays(): TruckBay[] {
  const bays: TruckBay[] = [];
  const pitch = TRUCK_W + BAY_GAP, heading = plantHeading(0, -1);
  ROWS.forEach((r, row) => {
    const n = Math.floor((r.u1 - r.u0) / pitch);
    for (let k = 0; k < n; k++) {
      const p = plantAt(r.u0 + (k + 0.5) * pitch, r.v);
      bays.push({ x: p.x, z: p.z, heading, row });
    }
  });
  return bays;
}
/** The bays with a truck in them (the same ones every load) */
function parkTrucks(bays: readonly TruckBay[]): TruckBay[] {
  return bays.filter((b) => hash(b.x, b.z, 83) < ROWS[b.row].fill);
}

/** The shed's loading doors on the yard: [u, v] of the door (m, on the wall), the way out of it (du, dv); a tráiler
 *  backed up to the ones `docked` */
const DOCKS: { u: number; v: number; du: number; dv: number; docked: boolean }[] = [
  { u: 155, v: 48, du: 1, dv: 0, docked: true },
  { u: 155, v: 62, du: 1, dv: 0, docked: false },
  { u: 155, v: 76, du: 1, dv: 0, docked: true },
  { u: 155, v: 90, du: 1, dv: 0, docked: true },
  { u: 155, v: 104, du: 1, dv: 0, docked: false },
  { u: 78, v: 158.5, du: 1, dv: 0, docked: true }
];
/** The tráilers at the docks: their middle (m), heading (nose out of the door) */
function trailers(): { x: number; z: number; heading: number }[] {
  return DOCKS.filter((d) => d.docked).map((d) => {
    const p = plantAt(d.u + d.du * (TRAILER_L / 2 + 0.4), d.v + d.dv * (TRAILER_L / 2 + 0.4));
    return { x: p.x, z: p.z, heading: plantHeading(d.du, d.dv) };
  });
}

const LOT_FRAME = LOT.map(([u, v]) => ({ x: u, z: v }));
/** Whether (x, z) lies in the plant's block (inside its property lines) */
function inPlant(x: number, z: number): boolean {
  const [u, v] = plantFrame(x, z);
  return u > -7 && u < 257 && v > -2 && v < 201 && insidePoly(LOT_FRAME, u, v);
}
/** The block, as the buildings (no house of Overture's in it), the yards' trees and the bardas keep off it */
const EMBOTELLADORA_RESERVE = { contains: inPlant };
/** What the plant claims of the town's ground (world/place-claims.ts): its block, no house of Overture's on it, no tree
 *  of the town's, no barda of ours (its own walls & fences close it) */
const EMBOTELLADORA_CLAIMS: PlaceClaims = { houses: EMBOTELLADORA_RESERVE, trees: EMBOTELLADORA_RESERVE, open: inPlant };

export {
  LOT, YARD, FRONT, FRONT_H, SHED, SHED_H, PILASTER_BAY, OFFICE, OFFICE_H, TOWER, GATE, GATE_H, CANOPY, CANOPY_H, BOOTH,
  DEPOT, DEPOT_H, STORES, STORE_H, ANNEX, ANNEX_H, TANKS, TOPIARY_V, TOPIARIES, FENCES, FENCE_H, DOCKS, TRUCK_L, TRUCK_W, TRAILER_L,
  EMBOTELLADORA_RESERVE, EMBOTELLADORA_CLAIMS, plantAt, plantFrame, plantHeading, truckBays, parkTrucks, trailers, inPlant
};
