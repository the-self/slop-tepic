// js/world/embotelladora/buildings.ts
// The bottling plant's buildings (embotelladora-plan.ts lays them out): the shed, white to 6 m and grey cladding over
// it, its loading doors on the yard and the name on its cladding over the front; the front on Insurgentes, white
// between cream pilasters, a hedge at its foot and ribbon windows over it; the trucks' way in under the brown canopy,
// its red gate between the striped posts, the guard's booth; the offices, the round glass tower at their door, the
// name over their windows; the depot on Hamburgo, its brown louvres and red shutters; the shed and the tanks by
// Otranto; the ficus in their white planters along the sidewalk. Each on its own floor (the block slopes), their walls
// run on down into the ground. What they are made of is materials.ts'.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FRONT, FRONT_H, SHED, SHED_H, PILASTER_BAY, OFFICE, OFFICE_H, TOWER, GATE, GATE_H, CANOPY, CANOPY_H, BOOTH, DEPOT, DEPOT_H,
  STORES, STORE_H, ANNEX, ANNEX_H, TANKS, TOPIARY_V, TOPIARIES, DOCKS, plantAt
} from '../embotelladora-plan.ts';
import { hash } from '../hash.ts';
import { PLANT_YAW, floorOf, frameAt, groundAt } from './site.ts';
import type { Kit, Frame } from '../building-kit.ts';
import type { PlantMaterials } from './materials.ts';
import type { PlantRect } from '../embotelladora-plan.ts';
import type { Footprint } from '../buildings.ts';

const BELOW = 3; // m the walls run on down into the ground under their floor

/** The brand's name lettered on the buildings, cut out of the clear (materials.ts brandTexture) */
export interface BrandSigns {
  /** white on the cladding */
  white: THREE.Material;
  /** red on the white render */
  red: THREE.Material;
}

// A box over a rectangle of the frame from y0 to y1 (m over the frame's floor), its UVs in metres from its u0
function slab(kit: Kit, f: Frame, [u0, u1, v0, v1]: PlantRect, y0: number, y1: number, mat: THREE.Material, cast = true): void {
  kit.box(f, u1 - u0, y1 - y0, v1 - v0, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2, mat, u0, 0, cast);
}
// A cylinder (radius r, from y0 to y1 over the floor) standing at (u, v) of the frame
function column(kit: Kit, f: Frame, u: number, v: number, r: number, y0: number, y1: number, mat: THREE.Material, segments = 16, cast = true): void {
  kit.add(new THREE.CylinderGeometry(r, r, y1 - y0, segments), mat, f, u, (y0 + y1) / 2, v, 0, cast);
}
// What stops the player over a rectangle of the frame, from y0 to y1 over its floor
function block(kit: Kit, f: Frame, [u0, u1, v0, v1]: PlantRect, y0: number, y1: number): void {
  kit.collide(f, (u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2, y0, y1);
}

/** The shed & its front on Insurgentes */
function buildShed(kit: Kit, mats: PlantMaterials, signs: BrandSigns): void {
  const f = frameAt(0, 0, floorOf([0, 155, 30, 186]));
  for (const r of SHED) {
    slab(kit, f, r, -BELOW, 6, mats.white);
    slab(kit, f, [r[0] - 0.03, r[1] + 0.03, r[2] - 0.03, r[3] + 0.03], 6, SHED_H, mats.cladding);
    slab(kit, f, [r[0] + 0.25, r[1] - 0.25, r[2] + 0.25, r[3] - 0.25], SHED_H, SHED_H + 0.08, mats.roof, false);
    block(kit, f, r, -BELOW, SHED_H);
  }
  // the units on its roof: the extractors in a row along it, the cooling plant's boxes
  for (let u = 14; u < 150; u += 18) {
    kit.box(f, 2.2, 1.6, 2.2, u, SHED_H + 0.8, 52, mats.concrete);
    kit.box(f, 1.4, 1.1, 1.4, u, SHED_H + 0.55, 98, mats.dark);
  }
  for (const [u, v] of [[30, 140], [55, 160], [20, 176]]) kit.box(f, 5.5, 2.2, 3.2, u, SHED_H + 1.1, v, mats.concrete);
  // the name on the cladding over the front (its roof the front's), both ends of it
  const [u0, u1, v0, v1] = FRONT;
  const g = frameAt(0, 0, floorOf([u0, u1, v0, v0 + 4]));
  const over = Math.max(6, g.y + FRONT_H - f.y) + 0.3;
  for (const u of [30, 94]) kit.sign(f, 3.1 * (SHED_H - over - 0.3), SHED_H - over - 0.3, u, (over + SHED_H) / 2, 29.95, signs.white, [0, 0, 1, 1], Math.PI);
  // its loading doors on the yard (a red shutter each, under a little canopy)
  for (const d of DOCKS) {
    const y = groundAt(d.u, d.v) - f.y;
    kit.box(f, 0.14, 4.4, 3.8, d.u + 0.07, y + 2.2, d.v, mats.shutter);
    kit.box(f, 1.6, 0.18, 4.8, d.u + 0.8, y + 4.9, d.v, mats.brown);
    kit.box(f, 1.2, 1.1, 3.4, d.u + 0.6, y + 0.55 - 0.6, d.v, mats.concrete); // (the leveller's ramp)
  }

  // the front: white render between cream pilasters, a hedge between them at its foot, the ribbon windows over it
  slab(kit, g, FRONT, -BELOW, FRONT_H, mats.white);
  slab(kit, g, [u0 + 0.25, u1 - 0.25, v0 + 0.25, v1 - 0.25], FRONT_H, FRONT_H + 0.08, mats.roof, false);
  slab(kit, g, [u0 - 0.2, u1 + 0.2, v0 - 0.45, v0], FRONT_H - 0.9, FRONT_H + 0.25, mats.cream);
  block(kit, g, FRONT, -BELOW, FRONT_H);
  const n = Math.round((u1 - u0) / PILASTER_BAY), bay = (u1 - u0) / n;
  for (let k = 0; k <= n; k++) {
    const u = u0 + k * bay;
    slab(kit, g, [u - 0.45, u + 0.45, v0 - 0.7, v0], -BELOW, FRONT_H - 0.9, mats.cream);
    kit.collide(g, u, v0 - 0.35, 0.45, 0.35, -BELOW, FRONT_H);
    if (k === n) break;
    const a = u + 0.5, b = u + bay - 0.5, mid = (a + b) / 2;
    // its doors in two bays, glazed, under a canopy; the hedge in the others, the sidewalk's level under it
    const y = groundAt(mid, v0 - 0.5) - g.y;
    if (k === 4 || k === 12) {
      kit.plane(g, b - a - 0.6, 2.8, mid, y + 1.4, v0 - 0.02, mats.glass, Math.PI);
      kit.box(g, b - a, 0.2, 1.6, mid, y + 3.2, v0 - 0.8, mats.cream);
    } else {
      kit.box(g, b - a, 2.3 + BELOW / 2, 0.75, mid, y + (2.3 - BELOW / 2) / 2, v0 - 0.4, mats.hedge);
      kit.collide(g, mid, v0 - 0.4, (b - a) / 2, 0.38, y - 0.5, y + 2.3);
    }
    if (hash(u, 3.1, 91) > 0.25) kit.plane(g, b - a - 0.5, 2.3, mid, 6.2, v0 - 0.02, mats.glass, Math.PI);
  }
}

/** The building by the gate: white, two floors of windows on the street, a cream band at its top */
function buildAnnex(kit: Kit, mats: PlantMaterials): void {
  const [u0, u1, v0, v1] = ANNEX;
  const f = frameAt(0, 0, floorOf(ANNEX));
  slab(kit, f, ANNEX, -BELOW, ANNEX_H, mats.white);
  slab(kit, f, [u0 - 0.15, u1 + 0.15, v0 - 0.15, v1 + 0.15], ANNEX_H, ANNEX_H + 0.45, mats.cream);
  slab(kit, f, [u0 + 0.3, u1 - 0.3, v0 + 0.3, v1 - 0.3], ANNEX_H + 0.1, ANNEX_H + 0.18, mats.roof, false);
  for (const y of [1.9, 5.1]) kit.plane(f, u1 - u0 - 2.4, 1.7, (u0 + u1) / 2, y, v0 - 0.02, mats.glass, Math.PI);
  block(kit, f, ANNEX, -BELOW, ANNEX_H + 0.45);
  // its garden behind the fence: a hedge along it
  const g = frameAt(0, 0, groundAt((u0 + u1) / 2, 2));
  for (let u = 120; u < 144; u += 6) kit.box(g, 5.4, 1.2, 0.9, u + 2.7, 0.35, 1.0, mats.hedge);
}

/** The trucks' way in: the canopy, its posts, the gate & the booth */
function buildGate(kit: Kit, mats: PlantMaterials): void {
  const [g0, g1, gv] = GATE;
  const f = frameAt(0, 0, groundAt((g0 + g1) / 2, gv));
  const [c0, c1, d0, d1] = CANOPY;
  // the canopy: its brown slab, the slatted soffit under it, its columns at the back
  slab(kit, f, CANOPY, CANOPY_H - 1.6, CANOPY_H, mats.brown);
  slab(kit, f, [c0 + 0.1, c1 - 0.1, d0 + 0.1, d1 - 0.1], CANOPY_H - 1.66, CANOPY_H - 1.6, mats.soffit, false);
  for (const u of [c0 + 0.6, (c0 + c1) / 2, c1 - 0.6]) {
    const y = groundAt(u, d1 - 0.6) - f.y;
    slab(kit, f, [u - 0.3, u + 0.3, d1 - 0.9, d1 - 0.3], y - 0.5, CANOPY_H - 1.6, mats.brown);
    kit.collide(f, u, d1 - 0.6, 0.3, 0.3, y, CANOPY_H - 1.6);
  }
  // the striped posts either end of the gate, up to the canopy
  for (const u of [g0 - 0.25, g1 + 0.25]) {
    column(kit, f, u, gv, 0.24, -0.5, CANOPY_H - 1.6, mats.striped);
    kit.collide(f, u, gv, 0.25, 0.25, -0.5, CANOPY_H - 1.6);
  }
  // the gate: two leaves of red steel, a frame round each of its panels crossed by an X, the wire mesh behind
  const leaf = (g1 - g0) / 2, panel = leaf / 2;
  kit.plane(f, g1 - g0, GATE_H - 0.15, (g0 + g1) / 2, (GATE_H - 0.15) / 2 + 0.08, gv + 0.06, mats.mesh);
  for (let k = 0; k < 4; k++) {
    const a = g0 + k * panel, mid = a + panel / 2;
    for (const y of [0.1, GATE_H - 0.06]) kit.box(f, panel, 0.12, 0.1, mid, y, gv, mats.red);
    const len = Math.hypot(panel, GATE_H - 0.2), ang = Math.atan2(GATE_H - 0.2, panel);
    for (const s of [1, -1]) kit.add(new THREE.BoxGeometry(len, 0.09, 0.08).rotateZ(s * ang), mats.red, f, mid, GATE_H / 2, gv);
  }
  for (let k = 0; k <= 4; k++) kit.box(f, 0.12, GATE_H, 0.1, g0 + k * panel, GATE_H / 2, gv, mats.red);
  kit.collide(f, (g0 + g1) / 2, gv, (g1 - g0) / 2, 0.15, -0.5, GATE_H);
  // the booth: white, a brown band round its top, windows on the gate and the street (on the fence's line)
  const [b0, b1, e0, e1] = BOOTH;
  const h = frameAt(0, 0, floorOf(BOOTH));
  slab(kit, h, BOOTH, -1, 2.8, mats.white);
  slab(kit, h, [b0 - 0.15, b1 + 0.15, e0 - 0.15, e1 + 0.15], 2.8, 3.3, mats.brown);
  kit.plane(h, b1 - b0 - 1, 1.1, (b0 + b1) / 2, 1.75, e0 - 0.02, mats.glass, Math.PI);
  kit.plane(h, e1 - e0 - 1.4, 1.1, b0 - 0.02, 1.75, (e0 + e1) / 2, mats.glass, -Math.PI / 2);
  block(kit, h, BOOTH, -1, 3.3);
}

/** The offices, the glass tower at their door, the hedges in their garden behind the fence */
function buildOffices(kit: Kit, mats: PlantMaterials, signs: BrandSigns): void {
  const [u0, u1, v0, v1] = OFFICE;
  const f = frameAt(0, 0, floorOf(OFFICE));
  slab(kit, f, OFFICE, -BELOW, OFFICE_H, mats.white);
  slab(kit, f, [u0 - 0.15, u1 + 0.15, v0 - 0.15, v1 + 0.15], OFFICE_H, OFFICE_H + 0.5, mats.white);
  slab(kit, f, [u0 + 0.3, u1 - 0.3, v0 + 0.3, v1 - 0.3], OFFICE_H + 0.1, OFFICE_H + 0.18, mats.roof, false);
  block(kit, f, OFFICE, -BELOW, OFFICE_H + 0.5);
  const [tu, tv, tr, th] = TOWER;
  // the ribbon windows: both floors on the street but behind the tower, the name over the lower one east of it; the
  // gate's side
  for (const [a, b, y] of [[u0 + 1.2, tu - tr - 0.4, 2.0], [tu + tr + 0.4, u1 - 1.2, 2.0], [u0 + 1.2, tu - tr - 0.4, 5.6]]) {
    kit.plane(f, b - a, 1.9, (a + b) / 2, y, v0 - 0.02, mats.glass, Math.PI);
  }
  kit.sign(f, 12.6, 4.1, (tu + tr + u1) / 2, 5.75, v0 - 0.03, signs.red, [0, 0, 1, 1], Math.PI);
  for (const y of [2.0, 5.6]) kit.plane(f, v1 - v0 - 2, 1.9, u0 - 0.02, y, (v0 + v1) / 2, mats.glass, -Math.PI / 2);
  // the tower: glass in red mullions, a red band at the first floor's slab and a red crown, white over it
  const t = frameAt(tu, tv, f.y);
  column(kit, t, 0, 0, tr, -0.5, th, mats.towerGlass, 28, false);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    kit.box(t, 0.2, th + 0.5, 0.2, Math.cos(a) * (tr + 0.06), th / 2 - 0.25, Math.sin(a) * (tr + 0.06), mats.red, 0, -a);
  }
  column(kit, t, 0, 0, tr + 0.14, 4.1, 4.45, mats.red, 28);
  column(kit, t, 0, 0, tr + 0.3, th, th + 0.9, mats.red, 28);
  column(kit, t, 0, 0, tr + 0.1, th + 0.9, th + 1.0, mats.roof, 28, false);
  // (it stops the player: three boxes with their corners on the glass, wide & shallow to narrow & deep, inside it)
  for (const a of [Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8]) kit.collide(t, 0, 0, tr * Math.cos(a), tr * Math.sin(a), -0.5, th + 1);
  // the garden behind the fence: a low hedge along it, the ficus balls before the windows
  const yard = frameAt(0, 0, groundAt((u0 + u1) / 2, 2));
  for (let u = 177; u < 218; u += 6) kit.box(yard, 5.4, 1.1, 0.9, u + 2.7, 0.3, 1.0, mats.hedge);
  for (let u = u0 + 3; u < u1; u += 5.5) {
    if (Math.abs(u - tu) < tr + 1.5) continue;
    kit.add(new THREE.SphereGeometry(0.75, 10, 7), mats.ficus, yard, u, 0.95, v0 - 2.2);
  }
}

/** The depot on Hamburgo, the shed & the tanks by Otranto */
function buildYardBuildings(kit: Kit, mats: PlantMaterials): void {
  const [u0, u1, , v1] = DEPOT;
  const f = frameAt(0, 0, floorOf(DEPOT));
  slab(kit, f, DEPOT, -BELOW, DEPOT_H, mats.depotWall);
  slab(kit, f, [u0 - 0.1, u1 + 0.1, v1, v1 + 0.22], DEPOT_H - 1.4, DEPOT_H + 0.1, mats.louvres);
  slab(kit, f, [u0 + 0.3, u1 - 0.3, DEPOT[2] + 0.3, v1 - 0.3], DEPOT_H, DEPOT_H + 0.08, mats.roof, false);
  for (const u of [u0 + 7, u0 + 13, u0 + 19]) kit.box(f, 3.6, 3.4, 0.12, u, groundAt(u, v1) - f.y + 1.7, v1 + 0.06, mats.shutter);
  kit.plane(f, 1.3, 2.4, u0 + 25.5, groundAt(u0 + 25.5, v1) - f.y + 1.2, v1 + 0.02, mats.glass);
  block(kit, f, DEPOT, -BELOW, DEPOT_H);
  for (const r of STORES) {
    const g = frameAt(0, 0, floorOf(r));
    slab(kit, g, r, -BELOW, 4, mats.white);
    slab(kit, g, [r[0] - 0.03, r[1] + 0.03, r[2] - 0.03, r[3] + 0.03], 4, STORE_H, mats.cladding);
    slab(kit, g, [r[0] + 0.2, r[1] - 0.2, r[2] + 0.2, r[3] - 0.2], STORE_H, STORE_H + 0.08, mats.roof, false);
    kit.box(g, 0.12, 3.6, 4, r[0] - 0.06, groundAt(r[0], (r[2] + r[3]) / 2) - g.y + 1.8, (r[2] + r[3]) / 2, mats.shutter);
    block(kit, g, r, -BELOW, STORE_H);
  }
  // the tanks on their pad, a ring & a ladder each
  const pad: PlantRect = [221.5, 249.5, 55.5, 69.5];
  const p = frameAt(0, 0, floorOf(pad));
  slab(kit, p, pad, -1, 0.35, mats.concrete, false);
  for (const [u, v, r, h] of TANKS) {
    column(kit, p, u, v, r, 0.35, h, mats.tank, 24);
    column(kit, p, u, v, r + 0.08, h - 0.9, h - 0.6, mats.tank, 24);
    kit.add(new THREE.ConeGeometry(r, 0.9, 24), mats.tank, p, u, h + 0.45, v);
    kit.box(p, 0.5, h, 0.08, u, h / 2 + 0.35, v - r - 0.12, mats.dark);
    kit.collide(p, u, v, r * 0.9, r * 0.9, 0, h + 0.9);
  }
}

/** The ficus along Insurgentes' sidewalk, clipped square or in tiers, in their white planters */
function buildTopiaries(kit: Kit, mats: PlantMaterials): void {
  for (const u of TOPIARIES) {
    const f = frameAt(u, TOPIARY_V, groundAt(u, TOPIARY_V) - 0.05);
    column(kit, f, 0, 0, 0.8, -0.3, 0.42, mats.white, 18);
    column(kit, f, 0, 0, 0.72, 0.42, 0.46, mats.hedge, 18, false);
    column(kit, f, 0, 0, 0.11, 0.4, 2.0, mats.brown, 7);
    const pick = hash(u, 7.7, 92);
    if (pick < 0.4) {
      kit.box(f, 2.3, 1.9, 2.3, 0, 2.85, 0, mats.ficus);
    } else {
      // (the bell: tiers narrowing up the trunk)
      for (const [r, y] of [[1.25, 2.4], [1.0, 3.45], [0.78, 4.35], [0.5, 5.0]]) {
        kit.add(new THREE.SphereGeometry(r, 12, 8).scale(1, 0.75, 1), mats.ficus, f, 0, y, 0);
      }
    }
    kit.collide(f, 0, 0, 0.8, 0.8, 0, 3);
  }
}

/**
 * The little signal on the gate's west post, over the trucks' way out, lenses on both faces (the yard's and the
 * street's): a head 0.8 m tall, its lenses red over amber over green at ±0.36 m of its own height (scaled 0.7), as the
 * town's signals' lens material reads them (street-details.ts). Into `parent`, in the world
 */
export function buildGateSignal(parent: THREE.Object3D, mats: PlantMaterials, lensMat: THREE.Material): void {
  const [g0, , gv] = GATE;
  const u = g0 - 0.25, v = gv - 0.42, p = plantAt(u, v);
  const head = new THREE.Group();
  head.name = 'EmbotelladoraGateSignal';
  head.position.set(p.x, groundAt(u, v) + 3.1, p.z);
  head.rotation.y = PLANT_YAW;
  head.scale.setScalar(0.7);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.14, 0.3), mats.dark);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5).translate(0, 0, 0.35), mats.dark);
  const lenses: THREE.BufferGeometry[] = [];
  for (const y of [0.36, 0, -0.36]) {
    for (const s of [-1, 1]) {
      lenses.push(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14).rotateX(Math.PI / 2).translate(0, y, s * 0.16));
      head.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.16).translate(0, y + 0.15, s * 0.23), mats.dark)); // (its visor)
    }
  }
  housing.castShadow = true;
  head.add(housing, bracket, new THREE.Mesh(mergeGeometries(lenses), lensMat));
  parent.add(head);
}

/** The plant's buildings into the kit; their footprints as the maps read them */
export function buildPlantBuildings(kit: Kit, mats: PlantMaterials, signs: BrandSigns): Footprint[] {
  buildShed(kit, mats, signs);
  buildAnnex(kit, mats);
  buildGate(kit, mats);
  buildOffices(kit, mats, signs);
  buildYardBuildings(kit, mats);
  buildTopiaries(kit, mats);
  const foot = (r: PlantRect, h: number, tone: number): Footprint => {
    const pts = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([u, v]) => plantAt(u, v));
    return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)),
      z1: Math.max(...pts.map((p) => p.z)), h, tone, pts };
  };
  return [...SHED.map((r) => foot(r, SHED_H, 0.35)), foot(FRONT, FRONT_H, 0.3), foot(OFFICE, OFFICE_H, 0.3), foot(CANOPY, CANOPY_H, 0.2),
    foot(ANNEX, ANNEX_H, 0.3), foot(DEPOT, DEPOT_H, 0.3), ...STORES.map((r) => foot(r, STORE_H, 0.3))];
}
