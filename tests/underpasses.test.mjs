import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnderpasses } from '../js/world/underpasses.ts';
import { GEO } from '../js/world/city-geodata.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} should equal ${b}`);

// A road east along z = 0 sinking from grade at x = 0 to 6 m down at x = 100, through a tunnel to x = 160 (its way
// tagged tunnel: way 2), and back up to grade at x = 260: three links, 7 m wide (the cut 4.1 m either side of it)
const graph = (z = 0) => ({
  nodes: [0, z, 100, z, 160, z, 260, z],
  links: [
    [0, 1, 0, 7, 2, 1, [], [0, -60], 0],
    [1, 2, 0, 7, 2, 1, [], [-60, -60], 2],
    [2, 3, 0, 7, 2, 1, [], [-60, 0], 0]
  ],
  names: [''],
  signals: []
});

test('a sunk road is cut into the ground: open along its ramps, roofed through its tunnel', () => {
  const u = createUnderpasses(graph());
  assert.equal(u.cuts.length, 1); // (its three links one cut, end to end)
  // down its ramp, and nothing past its walls
  close(u.offset(50, 0), -3);
  close(u.offset(50, 4), -3);
  assert.equal(u.offset(50, 4.2), 0);
  close(u.offset(210, 0), -3);
  // through the tunnel: the street over it for whoever comes from it (or from nowhere), the tunnel's floor for a body
  // already down in it
  assert.equal(u.offset(130, 0), 0);
  assert.equal(u.offset(130, 0, 0.5), 0);
  close(u.offset(130, 0, -5), -6);
});

test('a cut is as wide as each of its roadways, not as its widest', () => {
  // the ramp down 10 m wide, then 3.2 m wide through the tunnel and up
  const g = graph();
  g.links[0][3] = 10;
  g.links[1][3] = g.links[2][3] = 3.2;
  const u = createUnderpasses(g);
  close(u.offset(50, 5), -3); // (inside the wide ramp's 5.6 m)
  assert.equal(u.offset(210, 2.5), 0); // (past the narrow ramp's 2.2 m)
  close(u.offset(210, 2), -3);
});

test('where three sunk roadways meet down in their cuts, no wall closes any of them off', () => {
  // a fork 6 m down at (100, 0): one roadway in from the west, two out east and north
  const rg = { names: [''], signals: [], nodes: [0, 0, 100, 0, 200, 0, 100, -100],
    links: [[0, 1, 0, 7, 2, 1, [], [0, -60], 0], [1, 2, 0, 7, 2, 1, [], [-60, 0], 0], [1, 3, 0, 7, 2, 1, [], [-60, 0], 0]] };
  const u = createUnderpasses(rg);
  assert.ok(u.cuts.every((c) => c.s[0].depth < 0.1 || c.joined[0]));
  assert.ok(u.cuts.every((c) => c.s[c.s.length - 1].depth < 0.1 || c.joined[1]));
  // (an end wall across a roadway at the fork: a quad standing on the line x = 100, or z = 0, where they meet)
  const across = [];
  u.meshData((a, b, c, d) => {
    const q = [a, b, c, d];
    if (q.every((p) => Math.abs(p[0] - 100) < 0.01) || q.every((p) => Math.abs(p[2]) < 0.01 && Math.abs(p[0] - 100) < 5)) across.push(q);
  }, () => {});
  assert.equal(across.length, 0);
  // the outside of the turn from the west into the north roadway is down in the cut too
  close(u.offset(103, 3), -6, 0.2);
});

test("the road deck opens over the open cut, not over the tunnel's roof", () => {
  const u = createUnderpasses(graph());
  const holes = u.holes();
  const inHole = (x, z) => {
    for (let h = 0; h + 5 < holes.length; h += 6) {
      const [ax, az, bx, bz, cx, cz] = holes.slice(h, h + 6);
      const s1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
      const s2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
      const s3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
      if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
    }
    return false;
  };
  assert.ok(inHole(50, 0));
  assert.ok(inHole(210, 2));
  assert.ok(!inHole(130, 0));
  assert.ok(!inHole(50, 6));
});

test('two roadways sunk side by side share one cut: no wall between them, parapets only on its outer rims', () => {
  // the road above and its twin 6 m south, the other way (their cuts overlap)
  const a = graph(0), b = graph(6);
  const both = { nodes: [...a.nodes, ...b.nodes], names: [''], signals: [],
    links: [...a.links, ...b.links.map((l) => [l[0] + 4, l[1] + 4, ...l.slice(2)])] };
  const walls = [];
  const rims = createUnderpasses(both).meshData((p, q, r, s, n) => { if (n[1] === 0) walls.push([p, q, r, s]); }, () => {});
  // no wall stands between z = 0 and z = 6 along the ramps (the walls are at z -4.1 and 10.1)
  const between = walls.filter((w) => w.every((p) => p[0] > 10 && p[0] < 90 && p[2] > -3 && p[2] < 9));
  assert.equal(between.length, 0);
  assert.ok(rims.length > 0);
  assert.ok(rims.every((r) => r.az < -3.5 || r.az > 9.5 || r.ax === r.bx || Math.abs(r.ax - r.bx) < 1));
});

test('two roadways sunk side by side a little apart share one cut, split by a low median, not two walls', () => {
  // two narrow ones 3.2 m wide (each cut 2.2 m either side of it), 5 m apart centre to centre: 0.6 m of ground between
  const a = graph(0), b = graph(5);
  for (const l of [...a.links, ...b.links]) l[3] = 3.2;
  const both = { nodes: [...a.nodes, ...b.nodes], names: [''], signals: [],
    links: [...a.links, ...b.links.map((l) => [l[0] + 4, l[1] + 4, ...l.slice(2)])] };
  const u = createUnderpasses(both);
  // the strip between them is down in the cut, the beds meeting halfway
  close(u.offset(50, 2.5), -3, 0.05);
  close(u.offset(210, 2.5), -3, 0.05);
  const halfway = u.cuts.flatMap((c) => c.s).filter((p) => p.depth > 1 && p.x > 10 && p.x < 250);
  assert.ok(halfway.every((p) => Math.abs(p.half + Math.max(...p.pad) - 2.5) < 0.05));
  // no wall stands between them; the median does, 0.8 m high over the bed, its run handed back for a collider
  const walls = [], tops = [];
  const rims = u.meshData((p, q, r, s, n) => {
    const quad = [p, q, r, s];
    if (!quad.every((v) => v[0] > 10 && v[0] < 90 && v[2] > 0.5 && v[2] < 4.5)) return;
    if (n[1] === 0) walls.push(quad);
    else if (n[1] === 1) tops.push(quad);
  }, () => {});
  assert.equal(walls.length, 0);
  assert.ok(tops.length > 0);
  for (const q of tops) for (const [x, y] of q) close(y, -(x * 6) / 100 + 0.8, 0.01);
  assert.ok(rims.some((r) => r.depth > 1 && Math.abs(r.az - 2.5) < 0.05));
  // drawn once, whole (by one of the two cuts): one top and one collider per piece of it, not two
  const medians = rims.filter((r) => r.depth > 0.1 && r.ax > 10 && r.bx < 90);
  const pieces = new Set(medians.map((r) => Math.round(Math.min(r.ax, r.bx))));
  assert.equal(medians.length, pieces.size);
  assert.equal(tops.length, medians.length);
});

test("Tepic: Insurgentes runs down under Av. México at grade, and the streets by the 2 de Agosto viaduct stay on the ground", () => {
  const rg = GEO.roadGraph;
  const named = (name) => rg.links.filter((l) => rg.names[l[2]] === name);
  const near = (l, x, z, r) => Math.hypot(rg.nodes[l[0] * 2] - x, rg.nodes[l[0] * 2 + 1] - z) < r;
  const lifts = (l) => (l[7] ? l[7] : [0]);
  // the tunnel under Av. México (OpenStreetMap tunnel=yes) sunk 6 m, Av. México over it at grade
  const tunnel = rg.links.filter((l) => l[8] === 2 && near(l, 180, 893, 120));
  assert.ok(tunnel.length >= 2);
  assert.ok(tunnel.every((l) => lifts(l).every((v) => v <= -50)));
  for (const l of named('Avenida México').filter((x) => near(x, 190, 890, 150))) assert.ok(lifts(l).every((v) => v === 0));
  // the viaduct's ramps come down before the cross streets beside it (they used to climb them too)
  for (const name of ['Calle Ernesto Che Guevara', 'Calle Pueblo En Lucha', 'Calle Rubén Jaramillo', 'Calle Egipto']) {
    for (const l of named(name).filter((x) => near(x, 3880, 2440, 400))) assert.ok(lifts(l).every((v) => v === 0), name);
  }
});
