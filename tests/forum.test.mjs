import test from 'node:test';
import assert from 'node:assert/strict';

// js/world/forum-plan.ts: Forum Tepic, the mall on the Boulevard Colosio
const { FORUM: P, FORUM_RESERVE, FLOOR, LEVEL, inRing } = await import('../js/world/forum-plan.ts');
const { GEO } = await import('../js/world/city-geodata.js');

const inMall = (x, z) => P.buildings.some((b) => inRing(b.ring, x, z));
// does a body of radius r at (x, z), feet `y` m over the floor, stand in one of the plan's walls?
function blocked(x, z, y, r = 0.3) {
  return P.walls.some((w) => {
    if (y + 1.8 <= w.y0 || y >= w.y1) return false;
    const dx = x - w.cx, dz = z - w.cz, lx = dx * w.cs - dz * w.sn, lz = dx * w.sn + dz * w.cs;
    const qx = lx - Math.max(-w.hu, Math.min(w.hu, lx)), qz = lz - Math.max(-w.hv, Math.min(w.hv, lz));
    return Math.hypot(qx, qz) < r;
  });
}
// points every `step` m along a polyline
function along(pts, step = 1) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

test('Forum: its buildings on their OpenStreetMap outlines, its two frames square', () => {
  assert.deepEqual(P.buildings.map((b) => b.name), ['Forum', 'Liverpool', 'Fiesta Inn', 'North', 'Sears', 'Food court']);
  for (const f of [P.A, P.B]) {
    assert.ok(Math.abs(Math.hypot(f.ux, f.uz) - 1) < 1e-9 && Math.abs(f.ux * f.vx + f.uz * f.vz) < 1e-9, 'unit, square axes');
  }
  // (the mall stands by the Boulevard Colosio, east of the centro: its rotunda about 3.35 km east, 950 m south)
  assert.ok(Math.abs(P.rotunda.x - 3350) < 15 && Math.abs(P.rotunda.z - 951) < 15, `the rotunda at ${P.rotunda.x}, ${P.rotunda.z}`);
  assert.ok(inRing(P.buildings[0].ring, P.rotunda.x, P.rotunda.z), 'the rotunda inside the mall');
});

test('Forum: OpenStreetMap\'s shops on their fronts, the chains under their parody names', () => {
  const names = new Set(P.frontages.flatMap((f) => f.names));
  for (const n of ['STARBUCKS', 'MACSTORE', 'C&A', 'MINISO', 'CINEMEX', 'SEARS', 'LIVERPUL', 'SUBURBIOS', 'COPPELITO', 'BURGUER QUING', 'SUBGÜEY', 'KFC']) {
    assert.ok(names.has(n), `${n} has a front`);
  }
  for (const n of ['LIVERPOOL', 'SUBURBIA', 'COPPEL', 'BURGER KING', 'SUBWAY']) assert.ok(!names.has(n), `${n} goes by its parody name`);
  assert.equal(P.liverpool.names[0], 'LIVERPUL');
  for (const f of P.frontages) {
    const mx = (f.ax + f.bx) / 2 + f.nx * 1, mz = (f.az + f.bz) / 2 + f.nz * 1;
    assert.ok(inMall(mx, mz) || P.entrances.some((e) => Math.hypot(mx - (e.ax + e.bx) / 2, mz - (e.az + e.bz) / 2) < 12), `the front ${f.names[0] ?? f.kind} faces into the mall`);
  }
});

test('Forum: the shoppers\' walks run clear of every wall, on both floors', () => {
  for (const p of P.paths) {
    for (const [x, z] of along(p.pts)) {
      assert.ok(!blocked(x, z, p.level ? LEVEL : 0, 0.25), `a walk on floor ${p.level} runs through a wall at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
});

test('Forum: in through each entrance, out to the corridors', () => {
  for (const e of P.entrances) {
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
    // from 4 m before the glass, 25 m in
    const pts = along([[mx + e.nx * (e.out + 4), mz + e.nz * (e.out + 4)], [mx - e.nx * 25, mz - e.nz * 25]]);
    for (const [x, z] of pts) assert.ok(!blocked(x, z, 0), `the way in at ${x.toFixed(1)}, ${z.toFixed(1)} is open`);
  }
});

test('Forum: the upper floor, walked on and reached by the escalators', () => {
  const UP = FLOOR + LEVEL;
  const flat = P.decks.filter((d) => d.la === UP && d.lb === UP);
  const ramps = P.decks.filter((d) => d.la !== d.lb);
  assert.ok(flat.length > 20, 'the galleries, the bridges & the ring round the rotunda');
  assert.equal(ramps.length, P.escalators.length);
  assert.equal(P.escalators.length, 6);
  for (const r of ramps) {
    assert.equal(r.la, FLOOR, 'an escalator starts on the floor');
    assert.equal(r.lb, UP, 'and lands on the upper floor');
    // its head on a gallery: a flat deck within reach of it
    const onGallery = flat.some((d) => {
      const dx = d.bx - d.ax, dz = d.bz - d.az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((r.bx - d.ax) * dx + (r.bz - d.az) * dz) / L2));
      return Math.hypot(d.ax + dx * t - r.bx, d.az + dz * t - r.bz) <= d.half + 1.3;
    });
    assert.ok(onGallery, `the escalator heading for ${r.bx.toFixed(1)}, ${r.bz.toFixed(1)} lands on a gallery`);
  }
  // no balustrade across an escalator's head
  for (const e of P.escalators) {
    const [hx, hz] = [e.bx, e.bz], [ax, az] = [e.ax, e.az], L = Math.hypot(hx - ax, hz - az);
    const near = along([[ax + ((hx - ax) / L) * (L - 2.5), az + ((hz - az) / L) * (L - 2.5)], [hx, hz]], 0.25);
    for (const [x, z] of near) assert.ok(!blocked(x, z, LEVEL - 0.3, 0.2), `the way off the escalator at ${x.toFixed(1)}, ${z.toFixed(1)} is open`);
  }
});

test('Forum: its lots kept clear of the houses, its car park round it', () => {
  assert.ok(FORUM_RESERVE.contains(P.rotunda.x, P.rotunda.z));
  for (const b of P.buildings) {
    const [x, z] = b.ring[0];
    assert.ok(FORUM_RESERVE.contains(x, z), `${b.name}'s corner`);
  }
  assert.ok(!FORUM_RESERVE.contains(3465.3, 848.8), "the Carl's Jr. by the north entrance stays");
  for (const e of P.entrances) assert.ok(FORUM_RESERVE.contains((e.ax + e.bx) / 2 + e.nx * (e.out + 1), (e.az + e.bz) / 2 + e.nz * (e.out + 1)), 'no tree before a glass entrance');
  // the car park the city data lays round it (tools/build-tepic-geodata.mjs KNOWN_PARKING): big, and never inside it
  const lots = GEO.parking.filter((p) => p[0] === 'Forum Tepic');
  assert.ok(lots.length >= 10, `${lots.length} lots`);
  let inside = 0, n = 0;
  for (const [, , , ring] of lots) {
    for (let i = 0; i < ring.length; i += 2, n++) if (P.buildings.some((b) => b.name !== 'Fiesta Inn' && inRing(b.ring, ring[i], ring[i + 1]))) inside++;
  }
  assert.ok(inside / n < 0.02, `${inside} of the lots' ${n} corners inside the mall`);
  // ...nor a stall in the glass entrances standing out of its walls under their canopies
  for (const e of P.entrances) {
    const box = [[e.ax, e.az], [e.bx, e.bz], [e.bx + e.nx * (e.out + 2), e.bz + e.nz * (e.out + 2)], [e.ax + e.nx * (e.out + 2), e.az + e.nz * (e.out + 2)]];
    for (const [, , , ring] of lots) for (let i = 0; i < ring.length; i += 2) assert.ok(!inRing(box, ring[i], ring[i + 1]), 'a lot reaching into an entrance');
    for (const [, , , ring] of lots) {
      const poly = [];
      for (let i = 0; i < ring.length; i += 2) poly.push([ring[i], ring[i + 1]]);
      assert.ok(!inRing(poly, (e.ax + e.bx) / 2 + e.nx * (e.out / 2), (e.az + e.bz) / 2 + e.nz * (e.out / 2)), 'an entrance standing in a lot');
    }
  }
});

test('Forum: every locale with a room is walked into through its doorway, on both floors', () => {
  let rooms = 0;
  for (const f of P.frontages) {
    const L = Math.hypot(f.bx - f.ax, f.bz - f.az), ux = (f.bx - f.ax) / L, uz = (f.bz - f.az) / L, w = L / f.names.length;
    f.rooms.forEach((room, k) => {
      if (!room.depth) return;
      rooms++;
      assert.ok(room.door >= 1.5, `${f.names[k]}'s doorway is wide enough`);
      const mid = w * (k + 0.5), y = f.y0 > 0 ? LEVEL : 0;
      // from a metre out in the walkway, through the doorway, to the middle of the room
      for (let b = -1; b <= room.depth / 2; b += 0.5) {
        const x = f.ax + ux * mid - f.nx * b, z = f.az + uz * mid - f.nz * b;
        assert.ok(!blocked(x, z, y, 0.25), `the way into ${f.names[k]} (floor ${y ? 1 : 0}) at ${b} m is open`);
      }
    });
  }
  assert.ok(rooms > 120, `${rooms} rooms`);
  // the anchors on the floors they stand on: Liverpool, Sears & Suburbia on both, the Cinemex upstairs
  const floorsOf = (name) => P.frontages.filter((f) => f.kind === 'anchor' && f.names[0] === name).map((f) => (f.y0 > 0 ? 1 : 0)).sort();
  assert.deepEqual(floorsOf('LIVERPUL'), [0, 1]);
  assert.deepEqual(floorsOf('SEARS'), [0, 1]);
  assert.deepEqual(floorsOf('SUBURBIOS'), [0, 1]);
  assert.deepEqual(floorsOf('CINEMEX'), [1]);
});

test('Forum: its roofs keep the rain off every room and walkway', () => {
  const covered = (x, z) => P.roofs.some((r) => {
    const dx = x - r.cx, dz = z - r.cz;
    return Math.abs(dx * r.cs - dz * r.sn) < r.hu && Math.abs(dx * r.sn + dz * r.cs) < r.hv;
  });
  assert.ok(P.roofs.length <= 12, 'as many roofs as the rain takes');
  for (const p of P.paths) for (const [x, z] of along(p.pts, 3)) assert.ok(covered(x, z), `the walk at ${x.toFixed(1)}, ${z.toFixed(1)} is under a roof`);
  // (and the car park round it isn't)
  assert.ok(!covered(3445.3, 809.7), 'the north lot gets the rain');
});

test('Forum: no edge of the upper floor to fall off, but down an escalator', () => {
  const UP = FLOOR + LEVEL;
  const flat = P.decks.filter((d) => d.la === UP && d.lb === UP), ramps = P.decks.filter((d) => d.la !== d.lb);
  // (as ground.ts deckLift reads a segment: within its half width, along it and a half width past its ends)
  const on = (d, x, z) => {
    const ux = d.bx - d.ax, uz = d.bz - d.az, L = Math.hypot(ux, uz);
    if (L === 0) return Math.hypot(x - d.ax, z - d.az) <= d.half;
    const t = ((x - d.ax) * ux + (z - d.az) * uz) / (L * L);
    return t >= -d.half / L && t <= 1 + d.half / L && Math.abs((x - d.ax) * uz - (z - d.az) * ux) / L <= d.half;
  };
  let edges = 0;
  for (const d of flat) {
    const ux = d.bx - d.ax, uz = d.bz - d.az, L = Math.hypot(ux, uz) || 1, dx = ux / L, dz = uz / L, px = -dz, pz = dx;
    // points round its outline, 0.4 m out
    const pts = [];
    for (let s = -d.half; s <= L + d.half; s += 0.5) for (const side of [1, -1]) pts.push([d.ax + dx * s + px * side * (d.half + 0.4), d.az + dz * s + pz * side * (d.half + 0.4)]);
    for (let c = -d.half; c <= d.half; c += 0.5) for (const [s, out] of [[-d.half - 0.4, -1], [L + d.half + 0.4, 1]]) pts.push([d.ax + dx * s + px * c, d.az + dz * s + pz * c, out]);
    for (const [x, z] of pts) {
      if (flat.some((o) => on(o, x, z)) || ramps.some((o) => on(o, x, z))) continue;
      edges++;
      // (a wall, a front or a balustrade somewhere on the way out from the floor's edge: back towards its middle line)
      const t = Math.max(0, Math.min(1, ((x - d.ax) * dx + (z - d.az) * dz) / L));
      const nx = d.ax + dx * L * t - x, nz = d.az + dz * L * t - z, nl = Math.hypot(nx, nz) || 1;
      let stopped = false;
      for (let k = 0; k <= 8 && !stopped; k++) stopped = blocked(x + (nx / nl) * k * 0.1, z + (nz / nl) * k * 0.1, LEVEL, 0.3);
      assert.ok(stopped, `a fall off the upper floor at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  }
  assert.ok(edges > 500, `${edges} points along the edges`);
});
