import assert from 'node:assert/strict';
import test from 'node:test';
import { createPedestrianRoutes } from '../js/sim/pedestrian-routes.ts';

// A street 14 m wide east along z = 0 between two curb islands (north: z -30..-7, south: 7..30), its sidewalks' tracks
// from the intersection at x = 30 to the one at x = 70, and a footbridge over it at x = 50: stairs from the north
// island's z = -25 up to 6.1 m at z = -15, the deck over the street, stairs down to z = 25 on the south island
const north = { id: 'north', poly: [{ x: -100, z: -30 }, { x: 200, z: -30 }, { x: 200, z: -7 }, { x: -100, z: -7 }] };
const south = { id: 'south', poly: [{ x: -100, z: 7 }, { x: 200, z: 7 }, { x: 200, z: 30 }, { x: -100, z: 30 }] };
const blockAt = (x, z) => (x > -100 && x < 200 ? (z > -30 && z < -7 ? north : z > 7 && z < 30 ? south : null) : null);
function street() {
  const node = (x) => ({ x, z: 0, hx: 0, hz: 0, signal: false, in: [], out: [], road: [] });
  const A = node(30), B = node(70);
  const edge = (from, to) => {
    const dx = Math.sign(to.x - from.x);
    return { from, to, sx: from.x, sz: 0, dx, dz: 0, rx: 0, rz: dx, len: 40, half: 7, general: true };
  };
  const ab = edge(A, B), ba = edge(B, A);
  A.out.push(ab); B.in.push(ab); B.out.push(ba); A.in.push(ba);
  return { A, B, ab, ba };
}
const surface = { walkable: () => true, onSidewalk: (x, z) => !!blockAt(x, z) };
const bridge = { pts: [{ x: 50, z: -25 }, { x: 50, z: -15 }, { x: 50, z: 15 }, { x: 50, z: 25 }], lifts: [0, 6.1, 6.1, 0] };

test('a walker reaching an intersection by a footbridge may cross the street over it, up and down its stairs', () => {
  const { A, B, ab } = street();
  const routes = createPedestrianRoutes(surface, blockAt, { bridges: [bridge], nodes: [A, B] });
  // walking east along the north sidewalk, towards somewhere far south
  const track = routes.along(ab).find((t) => blockAt(t.ax, t.az) === north);
  assert.ok(track, 'a sidewalk track on the north island');
  let over = null;
  for (let i = 0; i < 200 && !over; i++) {
    const path = routes.next(track, 1, 50, 500);
    if (path?.some((leg) => leg.track.la || leg.track.lb)) over = path;
  }
  assert.ok(over, 'a route over the footbridge');
  // up to the deck and down again, landing on a sidewalk of the south island
  const lifts = over.flatMap((leg) => (leg.dir > 0 ? [leg.track.la, leg.track.lb] : [leg.track.lb, leg.track.la]));
  assert.equal(Math.max(...lifts), 6.1);
  assert.equal(lifts[0], 0);
  assert.equal(lifts[lifts.length - 1], 0);
  const last = over[over.length - 1].track;
  assert.equal(blockAt(last.ax, last.az), south);
  assert.equal(last.la, 0, 'and back on the ground');
});

test('a footbridge out of reach of the intersections, or none at all, adds no route over the street', () => {
  const { A, B, ab } = street();
  const far = { pts: bridge.pts.map((p) => ({ x: p.x + 400, z: p.z })), lifts: bridge.lifts };
  for (const routes of [createPedestrianRoutes(surface, blockAt), createPedestrianRoutes(surface, blockAt, { bridges: [far], nodes: [A, B] })]) {
    const track = routes.along(ab).find((t) => blockAt(t.ax, t.az) === north);
    for (let i = 0; i < 50; i++) {
      const path = routes.next(track, 1, 50, 500);
      assert.ok(!path?.some((leg) => leg.track.la || leg.track.lb));
    }
  }
});

test('a street crossing along the road splits its sidewalks, and a walker crosses there from curb to curb', () => {
  const { A, B, ab, ba } = street();
  // a crossing at x = 50: 20 m along either edge
  const crossing = { edge: ab, s: 20, back: ba, bs: 20 };
  const routes = createPedestrianRoutes(surface, blockAt, { nodes: [A, B], streetCrossings: [crossing] });
  const pieces = routes.along(ab);
  // each of the four lines in two pieces, meeting at the crossing
  assert.equal(pieces.length, 8);
  for (const p of pieces) assert.ok(Math.abs(p.len - 20) < 1e-9);
  const first = pieces.find((t) => blockAt(t.ax, t.az) === north && t.toCross === crossing);
  assert.ok(first, 'a piece of the north sidewalk ending at the crossing');
  assert.equal(first.to, undefined); // (its end there is the crossing's, not the junction's)
  let over = null;
  for (let i = 0; i < 100 && !over; i++) {
    const path = routes.next(first, 1, 50, 500);
    if (path?.some((leg) => leg.track.cross === crossing)) over = path;
  }
  assert.ok(over, 'a route over the crossing');
  const across = over.find((leg) => leg.track.cross === crossing).track;
  // over the road from 2 m in on one sidewalk to 2 m in on the other, at x = 50
  assert.ok(Math.abs(across.len - (14 + 4)) < 1e-9);
  assert.ok(Math.abs(across.ax - 50) < 1e-9 && Math.abs(across.ux) < 1e-9);
  // ...and from its far end on along the south sidewalk
  const far = over.find((leg) => leg.track.cross === crossing);
  const end = far.dir > 0 ? 1 : 0;
  const onward = routes.next(across, far.dir, 50, 500) ?? [];
  assert.ok(onward.some((leg) => leg.track.edge && blockAt(leg.track.ax, leg.track.az) === south), `from z ${across.az + across.uz * across.len * end}`);
  // the junctions' ports keep only their own ends: none of the pieces ending at the crossing
  const atA = routes.next(pieces.find((t) => t.from === A && blockAt(t.ax, t.az) === north), -1, -100, 0);
  assert.ok(!atA?.some((leg) => leg.track.toCross === crossing && leg.dir < 0));
});

test('a street crossing on a junction\'s crosswalk is one of the junction\'s ways over, from its sidewalks', () => {
  const { A, B, ab, ba } = street();
  // on B's crosswalk, 1.25 m past the end of ab
  const crossing = { edge: ab, s: 41.25, back: ba, bs: -1.25 };
  const routes = createPedestrianRoutes(surface, blockAt, { nodes: [A, B], streetCrossings: [crossing] });
  const track = routes.crossingTrack(crossing);
  assert.ok(track && track.from === B && track.to === B && track.cross === crossing);
  assert.equal(routes.along(ab).length, 4); // (no sidewalk split for it)
  const toB = routes.along(ab).find((t) => blockAt(t.ax, t.az) === north);
  let over = null;
  for (let i = 0; i < 100 && !over; i++) {
    const path = routes.next(toB, 1, 70, 500);
    if (path?.some((leg) => leg.track === track)) over = path;
  }
  assert.ok(over, 'from the north sidewalk at B over to the south');
});
