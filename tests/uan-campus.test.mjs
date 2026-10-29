import assert from 'node:assert/strict';
import test from 'node:test';
import { onRoadway } from '../js/world/city-config.ts';
import { campusBuildings, campusClaims, campusGates, campusPlan, campusTrees, campusWalls, inCampus } from '../js/places/uan/plan.ts';

const length = (w) => w.pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - w.pts[i - 1].x, p.z - w.pts[i - 1].z) : 0), 0);

test('the UAN is walled in blue along the boulevard & Av. de la Cultura, in stone along Revolución & 12 de Octubre', () => {
  const walls = campusWalls();
  const metres = { blue: 0, stone: 0 };
  for (const w of walls) metres[w.style] += length(w);
  assert.ok(metres.blue > 600, `${metres.blue} m of blue`);
  assert.ok(metres.stone > 800, `${metres.stone} m of stone`);
  for (const w of walls) for (const o of w.out) assert.ok(Math.abs(Math.hypot(o.x, o.z) - 1) < 1e-6);
  // a stone wall on Revolución north of the stadium, a blue one on Av. de la Cultura (their property lines, in metres)
  const near = (x, z, style) => walls.some((w) => w.style === style && w.pts.some((p) => Math.hypot(p.x - x, p.z - z) < 6));
  assert.ok(near(1240, 1849, 'stone'), 'Revolución');
  assert.ok(near(1150, 2349, 'blue'), 'Av. de la Cultura');
});

test('the walls close round the campus: no gap but at a gate or a street\'s mouth', () => {
  const { walls, gates } = campusPlan();
  // every wall's end meets another wall's or a gate's within 3 m, or stands at a street's mouth (none within 30 m)
  const ends = walls.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
  const all = [...ends, ...gates.flatMap((g) => [g.s0, g.s1].map((s) => ({ x: g.c.x + g.along.x * s, z: g.c.z + g.along.z * s })))];
  const open = ends.filter((e, i) => !all.some((f, j) => j !== i && Math.hypot(f.x - e.x, f.z - e.z) < 3));
  // (where Doctor Joaquín Cánovas, open, crosses the campus: by the Prepa's two corners and the university's on Mercado)
  assert.ok(open.length <= 3, `${open.length} loose ends`);
});

test('the gates stand across their drives, the walls cut where they stand and walled on from their ends', () => {
  const walls = campusWalls();
  const gates = campusGates(walls);
  // (OpenStreetMap's six, then the plain ones where a campus drive crosses a gap in the walls)
  assert.ok(gates.length >= 6);
  assert.deepEqual(gates.map((g) => g.kind).slice(0, 3), ['arch', 'motto', 'name']);
  for (const g of gates) {
    assert.ok(g.s0 < 0 && g.s1 > 0 && g.openings.length > 0);
    for (const o of g.openings) assert.ok(o.t - o.w / 2 > g.s0 && o.t + o.w / 2 < g.s1, `${g.kind}: a drive past its piers`);
    // no wall across the drives
    for (const w of walls) {
      for (const p of w.pts) {
        const t = (p.x - g.c.x) * g.along.x + (p.z - g.c.z) * g.along.z, off = (p.x - g.c.x) * g.out.x + (p.z - g.c.z) * g.out.z;
        assert.ok(!(Math.abs(off) < 2 && g.openings.some((o) => Math.abs(t - o.t) < o.w / 2)), `${g.kind}: a wall across its drive`);
      }
    }
    // a wall from at least one of its ends
    const ends = [g.s0, g.s1].map((s) => ({ x: g.c.x + g.along.x * s, z: g.c.z + g.along.z * s }));
    assert.ok(walls.some((w) => [w.pts[0], w.pts[w.pts.length - 1]].some((p) => ends.some((e) => Math.hypot(p.x - e.x, p.z - e.z) < 1.5))), `${g.kind} stands alone`);
  }
});

test('the campus buildings are its own: rows of aulas, academic buildings, domos', () => {
  const buildings = campusBuildings();
  assert.ok(buildings.length > 100);
  for (const b of buildings) assert.ok(inCampus(b.cx, b.cz) && b.storeys >= 1 && b.seed >= 0 && b.seed < 1);
  const kinds = new Set(buildings.map((b) => b.kind));
  for (const k of ['aulas', 'edificio', 'domo']) assert.ok(kinds.has(k), k);
});

test('the campus claims its grounds & its walls\' line from the town\'s bardas, not the blocks across the street', () => {
  const { walls } = campusPlan();
  let across = 0;
  for (const w of walls) {
    for (const [i, p] of w.pts.entries()) {
      assert.ok(campusClaims(p.x, p.z), `${p.x}, ${p.z}`);
      // (across Revolución & 12 de Octubre, the town's: the property line a street's width and two sidewalks out)
      if (w.style !== 'stone' || !w.curb) continue;
      const q = { x: p.x + w.out[i].x * 14, z: p.z + w.out[i].z * 14 };
      if (!inCampus(q.x, q.z) && campusClaims(q.x, q.z)) across++;
    }
  }
  assert.equal(across, 0);
  assert.ok(!campusClaims(0, 0), 'the Plaza Principal');
});

test('the buildings Overture names carry their names', () => {
  const names = campusBuildings().map((b) => b.name).filter(Boolean);
  assert.ok(names.includes('UNIDAD ACADÉMICA DE ENFERMERÍA'));
  assert.ok(!names.includes('MISCELÁNEA'), 'a trade\'s generic sign is no name');
});

test('the campus is wooded, its trees off its drives, clear of its buildings and apart', () => {
  const trees = campusTrees(), buildings = campusBuildings();
  assert.ok(trees.length > 800, `${trees.length} trees`);
  for (const t of trees) {
    assert.ok(inCampus(t.x, t.z));
    assert.ok(!onRoadway(t.x, t.z, 1), `a tree on a roadway at ${t.x}, ${t.z}`);
    for (const b of buildings) {
      const dx = t.x - b.cx, dz = t.z - b.cz, c = Math.cos(b.th), s = Math.sin(b.th);
      assert.ok(Math.abs(dx * c - dz * s) > b.w / 2 || Math.abs(dx * s + dz * c) > b.d / 2, 'a tree in a building');
    }
  }
  for (let i = 0; i < trees.length; i += 7) for (const u of trees) if (u !== trees[i]) assert.ok(Math.hypot(u.x - trees[i].x, u.z - trees[i].z) > 5);
});
