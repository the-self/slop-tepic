import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import { createHillPaths } from '../js/world/hill-paths.ts';
import { hillPaths, landHeight, bareLand } from '../js/world/ground.ts';
import { carFree, cerroParking } from '../js/world/car-free.ts';
import { terrainHeight, liftAt } from '../js/world/ground.ts';

// A hillside rising 1 m per metre north (-z), and a path 6 m wide running east along it
const side = (_x, z) => Math.max(0, -z);
const path = [0, 6, [0, -50, 100, -50]];

test('a hill path is level across its width, at its highest edge, and climbs along it as the hill does', () => {
  const { paths, level } = createHillPaths([path], side, side);
  const [p] = paths;
  assert.equal(p.half, 3);
  assert.ok(p.sections.length >= 40);
  for (const s of p.sections) assert.equal(s.level, 53); // the uphill edge, 3 m north of the middle
  // standing on it, anywhere across: the path's level; off it, the hillside
  for (const z of [-52.9, -50, -47.1]) assert.equal(level(40, z, side(40, z)), 53);
  assert.equal(level(40, -46, side(40, -46)), 46);
  assert.equal(level(40, -60, side(40, -60)), 60);
  // a path climbing the hill (north) climbs, level across
  const up = createHillPaths([[2, 2, [10, -20, 10, -40]]], side, side);
  const s = up.paths[0].sections;
  assert.ok(s.at(-1).level > s[0].level + 19);
  assert.equal(up.level(10.9, -30, side(10.9, -30)), up.level(9.1, -30, side(9.1, -30)));
});

test('in town (the hill not rising) a path is left to the streets', () => {
  const flat = () => 0;
  const { paths, level } = createHillPaths([path], side, flat);
  assert.ok(paths[0].on.every((on) => on === 0));
  assert.equal(level(40, -50, 7), 7);
});

test('the paths up the hills around Tepic are level across: walkers stand on that', () => {
  assert.ok(hillPaths && hillPaths.paths.length > 100);
  let runs = 0, flat = 0;
  for (const p of hillPaths.paths) {
    for (let k = 0; k + 1 < p.sections.length; k += 7) {
      if (!p.on[k]) continue;
      const a = p.sections[k], b = p.sections[k + 1];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, o = p.half * 0.8;
      const l = landHeight(mx - a.dz * o, mz + a.dx * o), r = landHeight(mx + a.dz * o, mz - a.dx * o);
      runs++;
      if (Math.abs(l - r) / (2 * o) < 0.05) flat++;
      // never under the hillside's mesh
      assert.ok(landHeight(mx, mz) >= bareLand(mx, mz));
    }
  }
  // (but where two paths meet at different levels)
  assert.ok(flat > runs * 0.99, `${flat} of ${runs}`);
});

test('the road up the Cerro de la Cruz is closed to the traffic, the town round it is not', () => {
  const [cx, cz] = GEO.terrain.cross;
  // the road's climb to the summit (road graph link nodes, m) and the street at its foot
  assert.equal(carFree(-320, -2753, -343, -2730), true);
  assert.equal(carFree(-286, -2645, -273, -2629), true);
  assert.equal(carFree(-69, -2580, -102, -2637), false);
  assert.equal(carFree(cx + 2000, cz, cx + 2050, cz), false);
});

test('cars stand parked at the foot of each way up the Cerro, level on the street, apart', () => {
  const [cx, cz] = GEO.terrain.cross;
  const cars = cerroParking();
  assert.ok(cars.length >= 4 && cars.length <= 20, `${cars.length}`);
  for (const c of cars) {
    assert.ok(Math.hypot(c.x - cx, c.z - cz) < 500);
    assert.ok(terrainHeight(c.x, c.z) < 0.3, `${c.x}, ${c.z}`);
    // level across, where the street at the foot leans with the hill (levelled, as its paths up)
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const roll = (liftAt(c.x + fz * 0.8, c.z - fx * 0.8) - liftAt(c.x - fz * 0.8, c.z + fx * 0.8)) / 1.6;
    assert.ok(Math.abs(roll) < 0.08, `${c.x}, ${c.z} rolls ${roll}`);
    assert.ok(c.seed >= 0 && c.seed < 1);
    for (const o of cars) if (o !== c) assert.ok(Math.hypot(o.x - c.x, o.z - c.z) > 5.5);
  }
  // the same every load
  assert.deepEqual(cerroParking(), cars);
});

test('the streets leaning along the Cerro de la Cruz\'s foot are levelled; elsewhere the town is as it lies', () => {
  // Luis Echeverría at the foot, ~35° across on the town's grid
  const lean = (f, x, z, nx, nz) => Math.abs(f(x + nx, z + nz) - f(x - nx, z - nz)) / 2;
  assert.ok(lean(bareLand, -114, -2667, 0.8, -0.5) > 0.4);
  assert.ok(lean(landHeight, -114, -2667, 0.8, -0.5) < 0.05);
  // far from it, nothing changes
  assert.equal(landHeight(4000, 3000), bareLand(4000, 3000));
});
