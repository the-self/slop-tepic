// js/world/forum-plan.ts
// Where things stand in Forum Tepic, the mall on the Boulevard Colosio, as OpenStreetMap maps it, the user's photographs
// and the satellite view show it: the long wing from the Cinemex at its south end up to the rotunda under its dome,
// the wing east from the rotunda to Liverpool, Sears to the rotunda's north, the Fiesta Inn between Sears and Liverpool,
// the food court & the PlayCity casino on the east wing's south side. Two floors of shops along galleries round
// long voids under clerestories, orange columns, escalators in the rotunda and before Liverpool; three glass entrances
// (north between the hotel & Liverpool, west by Sears, south beside the Cinemex). The shops are the ones OpenStreetMap
// maps there (2026), at their places, the chains under their parody names (storefronts/), the rest of the locales
// filled with trades. The drawing is forum.ts & forum/; no three.js here, so node --test imports it.
//
// Heights are over the mall's floor (FLOOR m over the town's floor, as a walker stands inside a block); the interior is
// laid in two frames: A along the east wing (u east to Liverpool, v south across it, from OSM's corner of Sears &
// the mall) and B along the south wing (u east across it, v south along it, from its north-west corner). Both have
// v = (-u.z, u.x), as three turns a box by yaw = atan2(-u.z, u.x).
// Its pieces: forum/plan-types.ts (the shapes), forum/plan-data.ts (the outlines & tenants), forum/plan-geometry.ts.
import { at, frameFrom, frameYaw, inRing, outerRuns, rectRing, ringDistance, segmentBox, toWorld } from './forum/plan-geometry.ts';
import {
  EAST_B, FIESTA_OUTLINE, FOOD_OUTLINE, FORUM_OUTLINE, LIVERPOOL_OUTLINE, NORTH_A, NORTH_OUTLINE, ROTUNDA_SHOPS, SEARS_OUTLINE, SOUTH_A, STALLS,
  WEST_B, hash01, signName, trade
} from './forum/plan-data.ts';
import type { LotReserve } from './landmark-models.ts';
import type { DeckSegment } from './ground.ts';
import type {
  Escalator, ForumBox, ForumBuilding, ForumEntrance, ForumPlan, Frame, Frontage, Pane, ShopperPath, Vec2
} from './forum/plan-types.ts';
import type { Placed } from './forum/plan-data.ts';

export type { Escalator, ForumBox, ForumBuilding, ForumEntrance, ForumPlan, Frame, Frontage, Pane, ShopperPath } from './forum/plan-types.ts';
export { at, frameYaw, inRing, outerRuns, segmentBox };

/** m: the mall's floor over the town's floor (a block's sidewalk: the walker stands at it), the upper floor over
 *  the lower, the roof over the floor, the lanterns' tops over the floor */
export const FLOOR = 0.225, LEVEL = 5.6, ROOF = 13, LANTERN = 15.6;
/** m: the gallery slab's thickness, a balustrade's height, a shop front's glass and the sign band over it */
export const SLAB = 0.45, RAIL = 1.05, GLASS = 4.1, SIGN = [4.35, 5.05] as const;
/** m: how high the shops' glass breaks (their transom over it) and the entrances' (to the transom over their doors) */
export const PANE = 3.0, DOOR_H = 3.4;
/** m: an escalator's width (its steps & balustrades), and how fast its steps run (m/s) */
export const ESCALATOR = 2.0, ESCALATOR_SPEED = 0.6;

// ---------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------
function planForum(): ForumPlan {
  const forum = toWorld(FORUM_OUTLINE);
  // frame A: from OSM's corner of Sears & the mall (node 21 of the outline) towards Sears's south-east corner
  const A = frameFrom(forum[21], [forum[22][0] - forum[21][0], forum[22][1] - forum[21][1]]);
  // frame B: from the south wing's north-west corner (node 20) its west wall runs south (node 19); u east across it
  const bDown: Vec2 = [forum[19][0] - forum[20][0], forum[19][1] - forum[20][1]];
  const B = frameFrom(forum[20], [bDown[1], -bDown[0]]);
  const buildings: ForumBuilding[] = [
    { name: 'Forum', ring: forum, height: ROOF },
    { name: 'Liverpool', ring: toWorld(LIVERPOOL_OUTLINE), height: 15.5 },
    { name: 'Fiesta Inn', ring: toWorld(FIESTA_OUTLINE), height: 8 },
    { name: 'North', ring: toWorld(NORTH_OUTLINE), height: ROOF },
    { name: 'Sears', ring: toWorld(SEARS_OUTLINE), height: 12 },
    { name: 'Food court', ring: toWorld(FOOD_OUTLINE), height: 11 }
  ];

  // THE LAYOUT (m): frame A's corridor v 11-25 from the rotunda to Liverpool's court, its void down the middle (v 15-21:
  // 4 m galleries either side, as the photographs show); frame B's corridor u 27-41 (void 31-37) from the rotunda to
  // the south court. Both floors hold shops all round: the upper floor is the lower one's over again, but where the
  // entrances and the food court stand two floors high, and the Cinemex is upstairs over the south court
  const UP = FLOOR + LEVEL; // the upper floor's lift over the ground (the deck's)
  const rotunda = { u: 33.6, v: 18, r: 15, void: 11.5 }; // in frame A
  const [rx, rz] = at(A, rotunda.u, rotunda.v);
  const A_END = 176, COURT_END = 190; // Liverpool's court u 176-190 (its front at 190), v 7-43
  const NP = [164, 176]; // the north passage (u), v -26.7..11
  const FOOD = { u0: 62, u1: 92, v1: 75 }; // the food court, upstairs off the corridor's south gallery, v 25..75
  const COURT_S = { u0: 14, u1: 70, v0: 104, v1: 120 }; // the south court (frame B)
  const SP = [46, 56]; // the south passage (u), v 120..the facade
  const WP = [2, 14]; // the west passage (v), u 0..27
  const VA = [15, 21], VB = [31, 37]; // the corridors' voids (A's v, B's u)
  // where the corridors meet the rotunda's circle
  const aStart = rotunda.u + Math.sqrt(rotunda.r ** 2 - 7 ** 2);
  const [rbU, rbV] = (() => { const dx = rx - B.ox, dz = rz - B.oz; return [dx * B.ux + dz * B.uz, dx * B.vx + dz * B.vz]; })();
  const bStart = rbV + Math.sqrt(rotunda.r ** 2 - 7 ** 2);
  const aVoid = rotunda.u + rotunda.r, bVoid = rbV + rotunda.r; // (the corridors' voids from the rotunda's rim)
  // the facades the passages run out to (frame A's v at the north passage's end, frame B's v at the south facade)
  const northFace = (() => { const p = forum[0], q = forum[1]; const dx = (p[0] + q[0]) / 2 - A.ox, dz = (p[1] + q[1]) / 2 - A.oz; return dx * A.vx + dz * A.vz; })();
  const southFace = (() => { const p = forum[16], q = forum[17]; const dx = (p[0] + q[0]) / 2 - B.ox, dz = (p[1] + q[1]) / 2 - B.oz; return dx * B.vx + dz * B.vz; })();

  const frontages: Frontage[] = [];
  const normal = (f: Frame, n: Vec2): Vec2 => [f.ux * n[0] + f.vx * n[1], f.uz * n[0] + f.vz * n[1]];
  // shops along a run in frame f: from (u, v) a to b, facing (along its normal) towards the walkway; names placed by
  // where they stand along it, the rest of the locales trades; the same run upstairs with trades (when `upper`)
  const run = (f: Frame, a: Vec2, b: Vec2, n: Vec2, placed: Placed[] = [], upper = true, along: (p: Vec2) => number = (p) => p[0]) => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const L = Math.hypot(bx - ax, bz - az);
    const count = Math.max(1, Math.round(L / 9));
    const [nx, nz] = normal(f, n);
    const names: string[] = [], above: string[] = [];
    for (let k = 0; k < count; k++) {
      const s0 = along(a), s1 = along(b), mid = s0 + ((k + 0.5) / count) * (s1 - s0), half = Math.abs(s1 - s0) / count / 2;
      const p = placed.find(([s]) => Math.abs(s - mid) <= half + 0.01);
      names.push(p ? signName(p[1]) : trade());
      above.push(trade());
    }
    frontages.push({ ax, az, bx, bz, nx, nz, y0: 0, y1: upper ? LEVEL : ROOF, kind: 'shops', names, rooms: [] });
    if (upper) frontages.push({ ax, az, bx, bz, nx, nz, y0: LEVEL, y1: ROOF, kind: 'shops', names: above, rooms: [] });
  };
  // an anchor's front on the floor (or floors) it stands on
  // (returns its front on the top floor it stands on)
  const anchor = (f: Frame, a: Vec2, b: Vec2, n: Vec2, name: string, levels: (0 | 1)[] = [0, 1], y1 = ROOF): Frontage => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const [nx, nz] = normal(f, n);
    const made = levels.map((l): Frontage => ({ ax, az, bx, bz, nx, nz, y0: l ? LEVEL : 0, y1: l || levels.length === 1 ? y1 : LEVEL, kind: 'anchor', names: [signName(name)], rooms: [] }));
    frontages.push(...made);
    return made[made.length - 1];
  };
  // shops on the upper floor only (the food court's sides)
  const upstairs = (f: Frame, a: Vec2, b: Vec2, n: Vec2, along: (p: Vec2) => number = (p) => p[0]) => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const count = Math.max(1, Math.round(Math.abs(along(b) - along(a)) / 9));
    const [nx, nz] = normal(f, n);
    frontages.push({ ax, az, bx, bz, nx, nz, y0: LEVEL, y1: ROOF, kind: 'shops', names: Array.from({ length: count }, trade), rooms: [] });
  };
  const blank = (f: Frame, a: Vec2, b: Vec2, n: Vec2, y0 = 0, y1 = ROOF) => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const [nx, nz] = normal(f, n);
    frontages.push({ ax, az, bx, bz, nx, nz, y0, y1, kind: 'blank', names: [], rooms: [] });
  };

  // Corridor A: its north side (Sears' shops, then the row to the north passage), its south side (to the food court,
  // then on to the court)
  run(A, [aStart, 11], [NP[0], 11], [0, 1], NORTH_A);
  run(A, [aStart, 25], [FOOD.u0, 25], [0, -1]);
  // (under the food court the PlayCity casino, its doors on the corridor; upstairs the food court opens off the gallery)
  anchor(A, [FOOD.u0, 25], [FOOD.u1, 25], [0, -1], 'PlayCity Casino', [0], LEVEL);
  run(A, [FOOD.u1, 25], [A_END, 25], [0, -1], SOUTH_A);
  // the north passage's sides (Telcel, USA Shoes): it runs up through both floors to the glass, shops on its floor
  // (short of the corridor's row, whose locales reach back to it)
  run(A, [NP[0], northFace + 6], [NP[0], 2], [1, 0], [[-5, 'Telcel'], [-14, 'USA Shoes']], false, (p) => p[1]);
  blank(A, [NP[0], 2], [NP[0], 11], [1, 0]);
  run(A, [NP[1], northFace + 6], [NP[1], -2], [-1, 0], [[-5, 'Telcel']], false, (p) => p[1]);
  blank(A, [NP[1], -2], [NP[1], 7], [-1, 0]);
  // Liverpool's court: its north & south sides, its west side beside the corridor's last shop; Liverpool across its
  // east end, on both floors
  run(A, [A_END, 7], [COURT_END, 7], [0, 1]);
  run(A, [A_END, 43], [COURT_END, 43], [0, -1], [[182, 'Muebles Dico']]);
  run(A, [A_END, 25], [A_END, 43], [1, 0], [], true, (p) => p[1]);
  const liverpool = anchor(A, [COURT_END, 7], [COURT_END, 43], [-1, 0], 'Liverpool');
  // the food court upstairs: the stalls along its west side, shops along its east side and its south end, the sides of
  // the gallery's last shops on either hand
  {
    const [ax, az] = at(A, FOOD.u0, 38), [bx, bz] = at(A, FOOD.u0, 72);
    frontages.push({ ax, az, bx, bz, nx: A.ux, nz: A.uz, y0: LEVEL, y1: ROOF, kind: 'stalls', names: STALLS.map(signName), rooms: [] });
    blank(A, [FOOD.u0, 25], [FOOD.u0, 38], [1, 0], LEVEL, ROOF);
    blank(A, [FOOD.u0, 72], [FOOD.u0, FOOD.v1], [1, 0], LEVEL, ROOF);
    upstairs(A, [FOOD.u0, FOOD.v1], [FOOD.u1, FOOD.v1], [0, -1]);
    upstairs(A, [FOOD.u1, 25], [FOOD.u1, FOOD.v1], [-1, 0], (p) => p[1]);
  }
  // Corridor B: its west side from the west passage to the south court, its east side from the rotunda
  run(B, [27, WP[1]], [27, COURT_S.v0], [1, 0], WEST_B, true, (p) => p[1]);
  run(B, [41, bStart], [41, COURT_S.v0], [-1, 0], EAST_B, true, (p) => p[1]);
  // the west passage's sides
  run(B, [0, WP[1]], [27, WP[1]], [0, -1], [[17, 'Sally Beauty']], false);
  // the south court, both floors: shops on its north side either side of the corridor and at its ends; across its
  // south side the shops either side of the passage out, Suburbia, and upstairs the Cinemex over them
  run(B, [COURT_S.u0, COURT_S.v0], [27, COURT_S.v0], [0, 1]);
  run(B, [41, COURT_S.v0], [COURT_S.u1, COURT_S.v0], [0, 1]);
  run(B, [COURT_S.u0, COURT_S.v0], [COURT_S.u0, COURT_S.v1], [1, 0], [], true, (p) => p[1]);
  run(B, [COURT_S.u1, COURT_S.v0], [COURT_S.u1, COURT_S.v1], [-1, 0], [], true, (p) => p[1]);
  {
    const [ax, az] = at(B, COURT_S.u0, COURT_S.v1), [bx, bz] = at(B, SP[0], COURT_S.v1);
    frontages.push({ ax, az, bx, bz, nx: -B.vx, nz: -B.vz, y0: 0, y1: LEVEL, kind: 'shops', names: [trade(), trade(), trade()], rooms: [] });
  }
  blank(B, [SP[0], COURT_S.v1], [SP[1], COURT_S.v1], [0, -1], LEVEL - SLAB, LEVEL);
  anchor(B, [COURT_S.u0, COURT_S.v1], [SP[1], COURT_S.v1], [0, -1], 'Cinemex', [1]);
  anchor(B, [SP[1], COURT_S.v1], [COURT_S.u1, COURT_S.v1], [0, -1], 'Suburbia');
  // the south passage under the Cinemex: its sides
  run(B, [SP[0], COURT_S.v1], [SP[0], southFace - 8], [1, 0], [], false, (p) => p[1]);
  run(B, [SP[1], COURT_S.v1], [SP[1], southFace - 8], [-1, 0], [], false, (p) => p[1]);
  // the rotunda's wall between its openings (corridor A east, corridor B & the west passage south and west): facets of
  // shops on both floors, Sears' entrance across its north, on both floors
  {
    const ang = (x: number, z: number) => Math.atan2(z - rz, x - rx);
    const open: [number, number][] = [];
    const edge = (f: Frame, u: number, v: number) => { const [x, z] = at(f, u, v); return ang(x, z); };
    open.push([edge(A, aStart, 11), edge(A, aStart, 25)]); // (corridor A's two walls on the circle)
    // corridor B's east wall on the circle round to where the west passage's north wall meets it
    const wpU = rbU - Math.sqrt(rotunda.r ** 2 - (WP[0] - rbV) ** 2);
    open.push([edge(B, 41, bStart), edge(B, wpU, WP[0])]);
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const spans = open.map(([a, b]) => { const a0 = norm(Math.min(a, b)); return [a0, a0 + norm(Math.max(a, b) - Math.min(a, b))]; });
    // the closed arcs: between the openings' ends, walked round
    spans.sort((p, q) => p[0] - q[0]);
    const searsAt = Math.atan2(-A.vz, -A.vx); // (north in frame A: Sears)
    let shop = 0;
    for (let k = 0; k < spans.length; k++) {
      const a0 = spans[k][1], a1 = spans[(k + 1) % spans.length][0] + (k + 1 === spans.length ? 2 * Math.PI : 0);
      const n = Math.max(1, Math.round(((a1 - a0) * rotunda.r) / 8.5));
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
        const ax = rx + Math.cos(t0) * rotunda.r, az = rz + Math.sin(t0) * rotunda.r, bx = rx + Math.cos(t1) * rotunda.r, bz = rz + Math.sin(t1) * rotunda.r;
        const mid = (t0 + t1) / 2, nx = -Math.cos(mid), nz = -Math.sin(mid);
        const d = Math.abs(norm(mid - searsAt + Math.PI) - Math.PI);
        if (d < (t1 - t0) / 2 + 0.01) {
          for (const y0 of [0, LEVEL]) frontages.push({ ax, az, bx, bz, nx, nz, y0, y1: y0 ? ROOF : LEVEL, kind: 'anchor', names: ['SEARS'], rooms: [] });
          continue;
        }
        frontages.push({ ax, az, bx, bz, nx, nz, y0: 0, y1: LEVEL, kind: 'shops', names: [shop < ROTUNDA_SHOPS.length ? ROTUNDA_SHOPS[shop++] : trade()], rooms: [] });
        frontages.push({ ax, az, bx, bz, nx, nz, y0: LEVEL, y1: ROOF, kind: 'shops', names: [trade()], rooms: [] });
      }
    }
  }

  // THE ENTRANCES: north (the passage between the hotel & Liverpool), west (by Sears), south (beside the Cinemex)
  const entrances: ForumEntrance[] = [];
  const entrance = (f: Frame, a: Vec2, b: Vec2, n: Vec2, out: number, height: number) => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const [nx, nz] = normal(f, n);
    entrances.push({ ax, az, bx, bz, nx, nz, out, height });
  };
  entrance(A, [NP[0], northFace], [NP[1], northFace], [0, -1], 6, 17);
  entrance(B, [0, WP[0]], [0, WP[1]], [-1, 0], 5, 15);
  entrance(B, [SP[0], southFace], [SP[1], southFace], [0, 1], 6, 17);
  // the passages' walls from the shops' runs out to the glass (blank, both floors high)
  blank(A, [NP[0], northFace], [NP[0], northFace + 6], [1, 0]);
  blank(A, [NP[1], northFace], [NP[1], northFace + 6], [-1, 0]);
  blank(B, [SP[0], southFace - 8], [SP[0], southFace], [1, 0]);
  blank(B, [SP[1], southFace - 8], [SP[1], southFace], [-1, 0]);
  {
    // the west passage's north wall, from the facade to the rotunda
    const wpU = rbU - Math.sqrt(rotunda.r ** 2 - (WP[0] - rbV) ** 2);
    run(B, [0, WP[0]], [wpU, WP[0]], [0, 1], [], false);
  }

  // THE OPEN FLOOR: the corridors, courts & passages, on the floors they're open on (no room reaches into them)
  const open: { ring: Vec2[]; levels: (0 | 1)[] }[] = [
    { ring: rectRing(A, rotunda.u, A_END, 11, 25), levels: [0, 1] },
    { ring: Array.from({ length: 36 }, (_, k): Vec2 => [rx + Math.cos((k / 36) * 2 * Math.PI) * 14.2, rz + Math.sin((k / 36) * 2 * Math.PI) * 14.2]), levels: [0, 1] },
    { ring: rectRing(A, A_END, COURT_END, 7, 43), levels: [0, 1] },
    { ring: rectRing(A, NP[0], NP[1], northFace - 8, 11), levels: [0, 1] },
    { ring: rectRing(A, FOOD.u0, FOOD.u1, 25, FOOD.v1), levels: [1] },
    { ring: rectRing(B, 27, 41, rbV, COURT_S.v0), levels: [0, 1] },
    { ring: rectRing(B, -8, 27, WP[0], WP[1]), levels: [0, 1] },
    { ring: rectRing(B, COURT_S.u0, COURT_S.u1, COURT_S.v0, COURT_S.v1), levels: [0, 1] },
    { ring: rectRing(B, SP[0], SP[1], COURT_S.v1, southFace + 8), levels: [0] },
    { ring: rectRing(B, SP[0], SP[1], southFace - 8, southFace + 8), levels: [1] }
  ];

  // THE UPPER FLOOR: the galleries along the voids, the bridges across them, the ring round the rotunda's void, the
  // courts' galleries; their open edges railed (but where an escalator lands)
  const slabs: ForumPlan['slabs'] = [], voids: Vec2[][] = [], rails: ForumPlan['rails'] = [], decks: DeckSegment[] = [];
  const deckRing = (ring: Vec2[]) => {
    // (a rect's deck: along its longer side, as wide as the shorter)
    const [p0, p1, , p3] = ring, l01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l03 = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const long = l01 >= l03, half = (long ? l03 : l01) / 2;
    const c: Vec2 = [(p0[0] + ring[2][0]) / 2, (p0[1] + ring[2][1]) / 2];
    const dir: Vec2 = long ? [(p1[0] - p0[0]) / l01, (p1[1] - p0[1]) / l01] : [(p3[0] - p0[0]) / l03, (p3[1] - p0[1]) / l03];
    // (never none: a segment of no length is a disc to ground.ts, short of a square's corners)
    const reach = Math.max(0.05, (long ? l01 : l03) / 2 - half);
    decks.push({ ax: c[0] - dir[0] * reach, az: c[1] - dir[1] * reach, bx: c[0] + dir[0] * reach, bz: c[1] + dir[1] * reach, la: UP, lb: UP, half: half + 0.05 });
  };
  const deckRect = (f: Frame, u0: number, u1: number, v0: number, v1: number) => {
    const ring = rectRing(f, u0, u1, v0, v1);
    slabs.push({ ring });
    deckRing(ring);
  };
  // (a balustrade in pieces of 2 m at most: those an escalator lands across are left out below)
  const rail = (f: Frame, a: Vec2, b: Vec2) => {
    const [ax, az] = at(f, a[0], a[1]), [bx, bz] = at(f, b[0], b[1]);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = 0; k < n; k++) rails.push({ ax: ax + ((bx - ax) * k) / n, az: az + ((bz - az) * k) / n, bx: ax + ((bx - ax) * (k + 1)) / n, bz: az + ((bz - az) * (k + 1)) / n });
  };
  const BRIDGES_A = [92, 134], BRIDGES_B = [44, 78];
  // corridor A's galleries (the north one on over the passage into the court, the south one to the court's west
  // gallery), the bridges & the rails along the void
  deckRect(A, aStart, 186, 11, VA[0]);
  deckRect(A, aStart, 178, VA[1], 25);
  for (const u of BRIDGES_A) {
    deckRect(A, u - 2.5, u + 2.5, VA[0], VA[1]);
    rail(A, [u - 2.5, VA[0]], [u - 2.5, VA[1]]);
    rail(A, [u + 2.5, VA[0]], [u + 2.5, VA[1]]);
  }
  {
    const stopsN = [aVoid, ...BRIDGES_A.flatMap((u) => [u - 2.5, u + 2.5]), 186];
    for (let k = 0; k + 1 < stopsN.length; k += 2) rail(A, [stopsN[k], VA[0]], [stopsN[k + 1], VA[0]]);
    const stopsS = [aVoid, ...BRIDGES_A.flatMap((u) => [u - 2.5, u + 2.5]), 178];
    for (let k = 0; k + 1 < stopsS.length; k += 2) rail(A, [stopsS[k], VA[1]], [stopsS[k + 1], VA[1]]);
    rail(A, [NP[0], 11], [NP[1], 11]); // (over the north passage, open to the floor)
    rail(A, [NP[1], 7], [NP[1], 11]); // (the court's north gallery's end over it)
    rail(A, [aVoid, VA[0]], [aVoid, VA[1]]);
  }
  // Liverpool's court: its void on from the corridor's, galleries round it (north, Liverpool's front, south, and a
  // strip on its west from the corridor's south gallery); the escalators up to Liverpool's
  deckRect(A, A_END, 186, 7, 11);
  deckRect(A, 186, COURT_END, 7, 43);
  deckRect(A, 178, 186, 35, 43);
  deckRect(A, A_END, 178, 25, 43);
  rail(A, [178, VA[1]], [178, 35]);
  rail(A, [178, 35], [186, 35]);
  rail(A, [186, VA[0]], [186, 35]);
  voids.push([at(A, aVoid, VA[0]), at(A, 186, VA[0]), at(A, 186, 35), at(A, 178, 35), at(A, 178, VA[1]), at(A, aVoid, VA[1])]);
  const escalators: Escalator[] = [];
  const escalator = (f: Frame, foot: Vec2, head: Vec2, up: boolean) => {
    const [ax, az] = at(f, foot[0], foot[1]), [bx, bz] = at(f, head[0], head[1]);
    escalators.push({ ax, az, bx, bz, width: ESCALATOR, up });
    // its deck from the floor to the gallery, held level a metre past either end (its landings)
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
    decks.push({ ax: ax + dx * 1.2, az: az + dz * 1.2, bx: bx - dx * 1.2, bz: bz - dz * 1.2, la: FLOOR, lb: UP, half: ESCALATOR / 2 - 0.05 });
  };
  escalator(A, [175, 17.2], [186.4, 17.2], true);
  escalator(A, [175, 32.8], [186.4, 32.8], false);
  // the rotunda: the ring round its void, the escalators up to it
  {
    const n = 24, mid = (rotunda.r + rotunda.void) / 2, half = (rotunda.r - rotunda.void) / 2;
    const ring: Vec2[] = [], hole: Vec2[] = [];
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * 2 * Math.PI, a1 = ((k + 1) / n) * 2 * Math.PI;
      decks.push({ ax: rx + Math.cos(a0) * mid, az: rz + Math.sin(a0) * mid, bx: rx + Math.cos(a1) * mid, bz: rz + Math.sin(a1) * mid, la: UP, lb: UP, half: half + 0.05 });
      ring.push([rx + Math.cos(a0) * rotunda.r, rz + Math.sin(a0) * rotunda.r]);
      hole.push([rx + Math.cos(a0) * rotunda.void, rz + Math.sin(a0) * rotunda.void]);
      rails.push({ ax: rx + Math.cos(a0) * rotunda.void, az: rz + Math.sin(a0) * rotunda.void, bx: rx + Math.cos(a1) * rotunda.void, bz: rz + Math.sin(a1) * rotunda.void });
    }
    slabs.push({ ring, hole });
    // (railed round its rim where it stands over the west passage's mouth, two floors high)
    {
      const ang = (f: Frame, u: number, v: number) => { const [x, z] = at(f, u, v); return Math.atan2(z - rz, x - rx); };
      const wpU = rbU - Math.sqrt(rotunda.r ** 2 - (WP[0] - rbV) ** 2);
      const a0 = ang(B, 27, bStart);
      let a1 = ang(B, wpU, WP[0]);
      if (a1 < a0) a1 += 2 * Math.PI;
      const m = Math.max(1, Math.ceil(((a1 - a0) * rotunda.r) / 2)), rr = rotunda.r - 0.1;
      for (let k = 0; k < m; k++) {
        const t0 = a0 + ((a1 - a0) * k) / m, t1 = a0 + ((a1 - a0) * (k + 1)) / m;
        rails.push({ ax: rx + Math.cos(t0) * rr, az: rz + Math.sin(t0) * rr, bx: rx + Math.cos(t1) * rr, bz: rz + Math.sin(t1) * rr });
      }
    }
    const top = rotunda.u + Math.sqrt((rotunda.void + 0.3) ** 2 - 5.2 ** 2);
    escalator(A, [top - 10.4, rotunda.v - 5.2], [top + 1.2, rotunda.v - 5.2], true);
    escalator(A, [top - 10.4, rotunda.v + 5.2], [top + 1.2, rotunda.v + 5.2], false);
  }
  // corridor B's galleries & bridges, railed; its void runs on into the south court's, galleries all round that
  deckRect(B, 27, VB[0], bStart, COURT_S.v0);
  deckRect(B, VB[1], 41, bStart, COURT_S.v0);
  rail(B, [27, bStart], [27, WP[1]]); // (over the west passage's mouth)
  for (const v of BRIDGES_B) {
    deckRect(B, VB[0], VB[1], v - 2.5, v + 2.5);
    rail(B, [VB[0], v - 2.5], [VB[1], v - 2.5]);
    rail(B, [VB[0], v + 2.5], [VB[1], v + 2.5]);
  }
  const CV = { u0: 24, u1: 60, v0: 107, v1: 117 }; // the south court's void
  {
    const stops = [bVoid, ...BRIDGES_B.flatMap((v) => [v - 2.5, v + 2.5]), CV.v0];
    for (let k = 0; k + 1 < stops.length; k += 2) {
      rail(B, [VB[0], stops[k]], [VB[0], stops[k + 1]]);
      rail(B, [VB[1], stops[k]], [VB[1], stops[k + 1]]);
    }
    rail(B, [VB[0], bVoid], [VB[1], bVoid]);
    deckRect(B, COURT_S.u0, VB[0], COURT_S.v0, CV.v0);
    deckRect(B, VB[1], COURT_S.u1, COURT_S.v0, CV.v0);
    deckRect(B, COURT_S.u0, COURT_S.u1, CV.v1, COURT_S.v1);
    deckRect(B, COURT_S.u0, CV.u0, CV.v0, CV.v1);
    deckRect(B, CV.u1, COURT_S.u1, CV.v0, CV.v1);
    rail(B, [CV.u0, CV.v0], [VB[0], CV.v0]);
    rail(B, [VB[1], CV.v0], [CV.u1, CV.v0]);
    rail(B, [CV.u1, CV.v0], [CV.u1, CV.v1]);
    rail(B, [CV.u0, CV.v1], [CV.u1, CV.v1]);
    rail(B, [CV.u0, CV.v0], [CV.u0, CV.v1]);
    voids.push([at(B, VB[0], bVoid), at(B, VB[1], bVoid), at(B, VB[1], CV.v0), at(B, CV.u1, CV.v0), at(B, CV.u1, CV.v1), at(B, CV.u0, CV.v1), at(B, CV.u0, CV.v0), at(B, VB[0], CV.v0)]);
    // the escalators up to the Cinemex: from the court's floor to its east gallery
    escalator(B, [49.8, 109.2], [61.2, 109.2], true);
    escalator(B, [49.8, 114.8], [61.2, 114.8], false);
  }
  // (a balustrade an escalator lands across is cut just as wide as the escalator)
  for (let i = rails.length - 1; i >= 0; i--) {
    const r = rails[i];
    const rx0 = r.bx - r.ax, rz0 = r.bz - r.az, L = Math.hypot(rx0, rz0);
    for (const e of escalators) {
      const ex = e.bx - e.ax, ez = e.bz - e.az, den = rx0 * ez - rz0 * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((e.ax - r.ax) * ez - (e.az - r.az) * ex) / den, s = ((e.ax - r.ax) * rz0 - (e.az - r.az) * rx0) / den;
      if (t < -0.2 || t > 1.2 || s < 0 || s > 1) continue;
      const sin = Math.abs(den) / (L * Math.hypot(ex, ez)), gap = (e.width / 2 + 0.15) / sin / L;
      const keep: [number, number][] = [[0, t - gap], [t + gap, 1]];
      rails.splice(i, 1, ...keep.filter(([a, b]) => (b - a) * L > 0.15)
        .map(([a, b]) => ({ ax: r.ax + rx0 * Math.max(0, a), az: r.az + rz0 * Math.max(0, a), bx: r.ax + rx0 * Math.min(1, b), bz: r.az + rz0 * Math.min(1, b) })));
      break;
    }
  }

  // THE COLUMNS: orange, square, at the voids' edges every 12 m (not on a bridge), round the rotunda's void
  const columns: ForumPlan['columns'] = [];
  const column = (f: Frame, u: number, v: number) => {
    const [x, z] = at(f, u, v), th = frameYaw(f);
    columns.push({ x, z, cs: Math.cos(th), sn: Math.sin(th) });
  };
  for (let u = aStart + 4; u < A_END - 2; u += 12) {
    if (BRIDGES_A.some((b) => Math.abs(b - u) < 4)) continue;
    column(A, u, VA[0]);
    column(A, u, VA[1]);
  }
  for (let v = bStart + 4; v < COURT_S.v0 - 2; v += 12) {
    if (BRIDGES_B.some((b) => Math.abs(b - v) < 4)) continue;
    column(B, VB[0], v);
    column(B, VB[1], v);
  }
  for (let k = 0; k < 8; k++) {
    // (one ahead of the corridor between the escalators, the rest every 45° round)
    const a = (k / 8) * 2 * Math.PI + Math.atan2(A.uz, A.ux);
    columns.push({ x: rx + Math.cos(a) * rotunda.void, z: rz + Math.sin(a) * rotunda.void, cs: Math.cos(a), sn: -Math.sin(a) });
  }
  column(A, 186, VA[0]);
  column(A, 186, 35);
  column(B, CV.u0, CV.v1);
  column(B, CV.u1, CV.v1);

  // THE FOOD COURT's floor upstairs, and what stands about: its tables, the kiosks (Sunglass Hut, the Thrifty's ice
  // cream, Santander's ATM), the planters
  deckRect(A, FOOD.u0, FOOD.u1, 25, FOOD.v1);
  const floors: Vec2[][] = [];
  const tables: Vec2[] = [];
  for (let u = FOOD.u0 + 7; u <= FOOD.u1 - 3; u += 4.2) for (let v = 33; v <= FOOD.v1 - 4; v += 4.2) tables.push(at(A, u, v));
  const kiosks: ForumPlan['kiosks'] = [];
  const kiosk = (f: Frame, u: number, v: number, alongU: boolean, name: string) => {
    const [x, z] = at(f, u, v), th = frameYaw(f) + (alongU ? 0 : Math.PI / 2);
    kiosks.push({ x, z, cs: Math.cos(th), sn: Math.sin(th), name: signName(name) });
  };
  kiosk(A, 158, 18, true, 'Sunglass Hut');
  kiosk(A, 112, 18, true, 'Perfumería');
  kiosk(A, 70, 18, true, 'Celulares');
  kiosk(B, 34, 27, false, 'Thrifty');
  kiosk(B, 34, 96, false, 'Santander');
  kiosk(B, 34, 62, false, 'Accesorios');
  const planters: Vec2[] = [];
  for (const u of [80, 104, 122, 146, 166]) planters.push(at(A, u, 18));
  for (const v of [16, 54, 88]) planters.push(at(B, 34, v));

  // THE ROOMS behind the fronts: each locale's as deep as it can run (9 m a shop, 30 an anchor) inside the buildings,
  // off the open floor and the rooms already laid on its floor (the Cinemex's floor is the south passage's ceiling)
  // (rings with their bounds, so most tests stop at those)
  interface Boxed { ring: Vec2[]; x0: number; x1: number; z0: number; z1: number }
  const boxed = (ring: Vec2[]): Boxed => ({ ring, x0: Math.min(...ring.map((p) => p[0])), x1: Math.max(...ring.map((p) => p[0])), z0: Math.min(...ring.map((p) => p[1])), z1: Math.max(...ring.map((p) => p[1])) });
  const inBoxed = (b: Boxed, x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inRing(b.ring, x, z);
  const complex = buildings.map((b) => boxed(b.ring));
  const inComplex = (x: number, z: number) => complex.some((b) => inBoxed(b, x, z));
  const openBy: [Boxed[], Boxed[]] = [open.filter((o) => o.levels.includes(0)).map((o) => boxed(o.ring)), open.filter((o) => o.levels.includes(1)).map((o) => boxed(o.ring))];
  const laid: [Vec2[], Vec2[]] = [[], []]; // (sample points of the rooms laid, by floor, and their rings)
  const laidRings: [Boxed[], Boxed[]] = [[], []];
  for (const f of frontages) {
    if (f.kind !== 'shops' && f.kind !== 'anchor') continue;
    const level = f.y0 > 0 ? 1 : 0;
    const L = Math.hypot(f.bx - f.ax, f.bz - f.az), ux = (f.bx - f.ax) / L, uz = (f.bz - f.az) / L;
    const n = f.names.length, w = L / n;
    for (let k = 0; k < n; k++) {
      const ox = f.ax + ux * w * k, oz = f.az + uz * w * k;
      const ring = (d: number): Vec2[] => [[ox, oz], [ox + ux * w, oz + uz * w], [ox + ux * w - f.nx * d, oz + uz * w - f.nz * d], [ox - f.nx * d, oz - f.nz * d]];
      const fits = (d: number) => {
        for (let a = 0.4; a < w - 0.2; a += 1) {
          for (let b = 0.4; b < d - 0.2; b += 1) {
            const x = ox + ux * a - f.nx * b, z = oz + uz * a - f.nz * b;
            if (!inComplex(x, z)) return false;
            if (openBy[level].some((o) => inBoxed(o, x, z))) return false;
            if (laidRings[level].some((r) => inBoxed(r, x, z))) return false;
          }
        }
        // (and no room laid before reaching into this one)
        const r = ring(d);
        return !laid[level].some(([x, z]) => inRing(r, x, z));
      };
      let depth = 0;
      for (let d = f.kind === 'anchor' ? 30 : 9; d >= 3; d -= 0.5) if (fits(d)) { depth = d; break; }
      f.rooms.push({ depth, door: depth ? Math.min(f.kind === 'anchor' ? 8 : 2.8, w - 2) : 0 });
      if (!depth) continue;
      const r = ring(depth);
      laidRings[level].push(boxed(r));
      for (let a = 0.5; a < w; a += 1) for (let b = 0.5; b < depth; b += 1) laid[level].push([ox + ux * a - f.nx * b, oz + uz * a - f.nz * b]);
      // upstairs, the room's floor is walked on
      if (level) {
        slabs.push({ ring: r });
        deckRing(r);
      }
    }
  }

  // THE WALLS: the fronts (either side of each room's doorway) and the rooms' sides, backs, counters & shelves; the
  // entrances' sides, the kiosks & planters, the escalators' sides and the outer walls the passages don't open
  const walls: ForumBox[] = [];
  // (a pane of glass a car breaks: its wall the pane's own, behind its face)
  const panes: Pane[] = [];
  const pane = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, y1: number, kind: Pane['kind']) => {
    walls.push(segmentBox(ax - nx * 0.15, az - nz * 0.15, bx - nx * 0.15, bz - nz * 0.15, 0.3, 0, y1));
    panes.push({ ax, az, bx, bz, nx, nz, y1, kind, wall: walls.length - 1 });
  };
  for (const f of frontages) {
    const top = f.y0 === 0 && f.y1 === LEVEL ? LEVEL - SLAB : f.y1;
    const L = Math.hypot(f.bx - f.ax, f.bz - f.az), ux = (f.bx - f.ax) / L, uz = (f.bz - f.az) / L;
    const n = Math.max(1, f.names.length), w = L / n;
    for (let k = 0; k < n; k++) {
      const room = k < f.rooms.length ? f.rooms[k] : null;
      const P = (a: number, b: number): Vec2 => [f.ax + ux * (w * k + a) - f.nx * b, f.az + uz * (w * k + a) - f.nz * b];
      const wall = (a0: number, b0: number, a1: number, b1: number, thick: number, y1: number) => {
        const [x0, z0] = P(a0, b0), [x1, z1] = P(a1, b1);
        walls.push(segmentBox(x0, z0, x1, z1, thick, f.y0, f.y0 + y1));
      };
      if (!room?.depth) {
        wall(0, 0.2, w, 0.2, 0.4, top - f.y0);
        continue;
      }
      const d = room.depth, side = (w - room.door) / 2;
      if (f.y0 === 0) {
        // downstairs the glass either side of the doorway breaks (a car through it: forum.ts), the wall over it stays
        for (const [a0, a1] of [[0.2, side], [w - side, w - 0.2]]) {
          const [x0, z0] = P(a0, 0), [x1, z1] = P(a1, 0);
          pane(x0, z0, x1, z1, f.nx, f.nz, PANE, 'shop');
        }
        wall(0, 0.15, w, 0.15, 0.3, top - f.y0);
        walls[walls.length - 1].y0 = PANE;
      } else {
        wall(0, 0.15, side, 0.15, 0.3, top - f.y0);
        wall(w - side, 0.15, w, 0.15, 0.3, top - f.y0);
      }
      wall(0.1, 0, 0.1, d, 0.2, top - f.y0);
      wall(w - 0.1, 0, w - 0.1, d, 0.2, top - f.y0);
      wall(0, d - 0.1, w, d - 0.1, 0.2, top - f.y0);
      // the shelves along its back and sides, the counter before the back
      wall(0.2, d - 0.55, w - 0.2, d - 0.55, 0.6, 2.2);
      if (d > 4) {
        wall(0.55, 2, 0.55, d - 1, 0.6, 2.2);
        wall(w - 0.55, 2, w - 0.55, d - 1, 0.6, 2.2);
      }
      // (a room too shallow for its counter in the middle has none)
      if (d >= 6.5) wall(w / 2 - Math.min(1.6, w / 2 - 1.5), d - 2.6, w / 2 + Math.min(1.6, w / 2 - 1.5), d - 2.6, 0.7, 1.05);
      // an anchor's racks down its floor
      if (f.kind === 'anchor' && d > 12) for (let a = 3; a < w - 3; a += 4) if (Math.abs(a - w / 2) > 2.5) wall(a, 5, a, d - 5, 0.7, 1.4);
    }
  }
  for (const r of rails) walls.push(segmentBox(r.ax, r.az, r.bx, r.bz, 0.15, LEVEL, LEVEL + RAIL));
  for (const k of kiosks) walls.push({ cx: k.x, cz: k.z, hu: 1.6, hv: 1.0, cs: k.cs, sn: k.sn, y0: 0, y1: 1.2 });
  for (const [x, z] of planters) walls.push({ cx: x, cz: z, hu: 1.1, hv: 1.1, cs: 1, sn: 0, y0: 0, y1: 0.8 });
  for (const c of columns) walls.push({ cx: c.x, cz: c.z, hu: 0.5, hv: 0.5, cs: c.cs, sn: c.sn, y0: 0, y1: ROOF });
  for (const e of escalators) {
    // (its sides, from the floor: a walker steps onto its foot between them)
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L, px = -dz * (e.width / 2 + 0.1), pz = dx * (e.width / 2 + 0.1);
    for (const s of [1, -1]) walls.push(segmentBox(e.ax + px * s + dx * 1.2, e.az + pz * s + dz * 1.2, e.bx + px * s - dx * 1.2, e.bz + pz * s - dz * 1.2, 0.12, 0, LEVEL + RAIL));
  }
  for (const e of entrances) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L;
    // its glass: the sides, and the front either side of the doors (7 m wide in the middle), breaking below the
    // transom over the doors, fixed over it
    const door = Math.min(7, L - 2);
    const fa: Vec2 = [e.ax + e.nx * e.out, e.az + e.nz * e.out], fb: Vec2 = [e.bx + e.nx * e.out, e.bz + e.nz * e.out];
    const runs: [Vec2, Vec2, Vec2][] = [
      [[e.ax, e.az], fa, [-dx, -dz]],
      [[e.bx, e.bz], fb, [dx, dz]],
      [fa, [fa[0] + dx * (L - door) / 2, fa[1] + dz * (L - door) / 2], [e.nx, e.nz]],
      [[fb[0] - dx * (L - door) / 2, fb[1] - dz * (L - door) / 2], fb, [e.nx, e.nz]]
    ];
    for (const [a, b, n] of runs) {
      pane(a[0], a[1], b[0], b[1], n[0], n[1], DOOR_H, 'entrance');
      walls.push(segmentBox(a[0], a[1], b[0], b[1], 0.3, DOOR_H, e.height));
    }
  }
  for (const b of buildings) {
    for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
      for (const [ax, az, bx, bz, low] of outerRuns(b, j, i, buildings, entrances)) if (low === 0) walls.push(segmentBox(ax, az, bx, bz, 0.4, 0, b.height));
    }
  }

  // THE ROOFS the rain keeps out from under: each building's outline in the frame it is squarest in; the mall's own in
  // four (its east wing's band, and the south wing's three widths)
  const roofs: ForumBox[] = [];
  const roofBox = (f: Frame, u0: number, u1: number, v0: number, v1: number, h: number) => {
    const [cx, cz] = at(f, (u0 + u1) / 2, (v0 + v1) / 2), th = frameYaw(f);
    roofs.push({ cx, cz, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, cs: Math.cos(th), sn: Math.sin(th), y0: 0, y1: h });
  };
  const inFrame = (f: Frame, ring: Vec2[]) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) {
      const dx = x - f.ox, dz = z - f.oz, u = dx * f.ux + dz * f.uz, v = dx * f.vx + dz * f.vz;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return { u0, u1, v0, v1, area: (u1 - u0) * (v1 - v0) };
  };
  for (const b of buildings) {
    if (b.name === 'Forum') continue;
    const a = inFrame(A, b.ring), bb = inFrame(B, b.ring), r = a.area <= bb.area ? a : bb;
    roofBox(a.area <= bb.area ? A : B, r.u0, r.u1, r.v0, r.v1, b.height);
  }
  roofBox(A, 0, COURT_END, northFace, 43, LANTERN);
  roofBox(B, 0, 64, 0, 51, ROOF);
  roofBox(B, 0, 74, 51, 102, ROOF);
  roofBox(B, 0, 93, 102, southFace, ROOF);
  // (and the entrances' glass boxes under their canopies)
  for (const e of entrances) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), th = Math.atan2(-(e.bz - e.az) / L, (e.bx - e.ax) / L);
    roofs.push({ cx: (e.ax + e.bx) / 2 + e.nx * (e.out + 2) / 2, cz: (e.az + e.bz) / 2 + e.nz * (e.out + 2) / 2, hu: L / 2 + 1, hv: (e.out + 2) / 2,
      cs: Math.cos(th), sn: Math.sin(th), y0: 0, y1: e.height });
  }

  // THE SHOPPERS' WALKS: up & down the corridors a few metres either side of the middle, on both floors, through the
  // rotunda; and round the food court
  const paths: ShopperPath[] = [];
  // (downstairs along the shops' fronts, either side of the columns, where a car fits too)
  for (const side of [-5, 5]) {
    // (through the rotunda between its escalators)
    paths.push({ level: 0, pts: [at(A, A_END - 2, 18 + side), at(A, aStart + 2, 18 + side), at(A, aStart - 2, 18 + side * 0.5), at(A, rotunda.u, rotunda.v + side * 0.4),
      at(B, rbU + side * 0.4, rbV + 8), at(B, rbU + side, bStart + 3), at(B, 34 + side, COURT_S.v0 + 6)] });
  }
  paths.push({ level: 1, pts: [at(A, aStart, 12.8), at(A, 188, 12.8), at(A, 188, 41)] });
  paths.push({ level: 1, pts: [at(A, aStart, 23.2), at(A, A_END - 1, 23.2)] });
  for (const u of [28.8, 39.2]) paths.push({ level: 1, pts: [at(B, u, bStart), at(B, u, COURT_S.v0 - 1)] });
  paths.push({ level: 1, pts: [at(A, FOOD.u0 + 4, 29), at(A, FOOD.u1 - 3, 29), at(A, FOOD.u1 - 3, FOOD.v1 - 3), at(A, FOOD.u0 + 4, FOOD.v1 - 3), at(A, FOOD.u0 + 4, 29)] });
  paths.push({ level: 0, pts: [at(A, (NP[0] + NP[1]) / 2, northFace + 2), at(A, (NP[0] + NP[1]) / 2, 18)] });
  paths.push({ level: 0, pts: [at(B, 2, (WP[0] + WP[1]) / 2), at(B, 30, (WP[0] + WP[1]) / 2)] });
  paths.push({ level: 0, pts: [at(B, (SP[0] + SP[1]) / 2, southFace - 2), at(B, (SP[0] + SP[1]) / 2, COURT_S.v1 - 1), at(B, 30, COURT_S.v1 - 1), at(B, 30, COURT_S.v0 + 2)] });
  // (upstairs round the south court, before the Cinemex)
  paths.push({ level: 1, pts: [at(B, 28.8, COURT_S.v0 - 1), at(B, 28.8, COURT_S.v0 + 1.5), at(B, 18, COURT_S.v0 + 1.5), at(B, 18, CV.v1 + 1.5), at(B, 58, CV.v1 + 1.5)] });

  // THE PALMS along the sidewalk round the mall, 2.5 m off its walls every 13 m, clear of the entrances
  const palms: ForumPlan['palms'] = [];
  for (const b of buildings) {
    for (let i = 0, j = b.ring.length - 1; i < b.ring.length; j = i++) {
      for (const [ax, az, bx, bz, low] of outerRuns(b, j, i, buildings, entrances)) {
        const L = Math.hypot(bx - ax, bz - az);
        if (low || L < 10) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        let nx = uz, nz = -ux;
        if (inRing(b.ring, (ax + bx) / 2 + nx * 0.5, (az + bz) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }
        const n = Math.floor(L / 13);
        for (let k = 0; k < n; k++) {
          const t = (L - (n - 1) * 13) / 2 + k * 13, x = ax + ux * t + nx * 2.5, z = az + uz * t + nz * 2.5;
          if (entrances.some((e) => Math.hypot(x - (e.ax + e.bx) / 2 - e.nx * e.out, z - (e.az + e.bz) / 2 - e.nz * e.out) < 12)) continue;
          if (buildings.some((o) => inRing(o.ring, x, z))) continue;
          palms.push({ x, z, scale: 0.9 + hash01(palms.length + 40) * 0.25, species: 4 });
        }
      }
    }
  }
  // (and a small one in each planter)
  for (const [x, z] of planters) palms.push({ x, z, scale: 0.32, species: 4 });

  return {
    A, B, buildings, palms, roofs, panes, rotunda: { x: rx, z: rz, r: rotunda.r, void: rotunda.void }, floors, voids, slabs, rails, frontages,
    entrances, columns, escalators, tables, kiosks, planters, walls, decks, paths, liverpool,
    skylights: [rectRing(A, aStart + 3, A_END - 2, 16.6, 19.4), rectRing(A, A_END + 2, 184, 17, 36.5), rectRing(B, 32.6, 35.4, rbV + rotunda.r + 3, COURT_S.v0 - 3)]
  };
}

export const FORUM: ForumPlan = planForum();

/** The mall's lots, kept clear of the generic houses, the yard trees & the bardas: its buildings and 4 m round them,
 *  its glass entrances, and the strip along the south wing's east side Overture draws its signs' slivers on */
export const FORUM_RESERVE: LotReserve = (() => {
  const strip = rectRing(FORUM.B, 70, 86, 48, 104);
  // (and the glass entrances under their canopies, a metre round)
  const porches = FORUM.entrances.map((e): Vec2[] => {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L, o = e.out + 3;
    return [[e.ax - dx * 2, e.az - dz * 2], [e.bx + dx * 2, e.bz + dz * 2], [e.bx + dx * 2 + e.nx * o, e.bz + dz * 2 + e.nz * o], [e.ax - dx * 2 + e.nx * o, e.az - dz * 2 + e.nz * o]];
  });
  const boxes = FORUM.buildings.map((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { ring: b.ring, x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 };
  });
  return {
    contains(x: number, z: number) {
      if (inRing(strip, x, z) || porches.some((r) => inRing(r, x, z))) return true;
      return boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && (inRing(b.ring, x, z) || ringDistance(b.ring, x, z) < 4));
    }
  };
})();
