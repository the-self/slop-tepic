import assert from 'node:assert/strict';
import test from 'node:test';
import { LAKES, createLakes, triangulate, fillRing } from '../js/world/lakes.ts';
import { GEO } from '../js/world/city-geodata.js';
import { lakes, groundHeight, landHeight, deckHoles } from '../js/world/ground.ts';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} should equal ${b}`);
// the area of flat triangles (x0, z0, x1, z1, x2, z2), and whether every one faces up (clockwise in x & z)
const area = (tris) => {
  let a = 0, up = true;
  for (let k = 0; k + 5 < tris.length; k += 6) {
    const c = (tris[k + 2] - tris[k]) * (tris[k + 5] - tris[k + 1]) - (tris[k + 3] - tris[k + 1]) * (tris[k + 4] - tris[k]);
    if (c > 1e-9) up = false;
    a += Math.abs(c) / 2;
  }
  return { a, up };
};

// An L-shaped pond 60 x 60 m with a 30 x 30 m bite out of it (2700 m²), either way round
const L = [0, 0, 60, 0, 60, 30, 30, 30, 30, 60, 0, 60];
const Lrev = [0, 60, 30, 60, 30, 30, 60, 30, 60, 0, 0, 0];

test('an outline is cut into triangles that cover it and face up, either way round', () => {
  for (const ring of [L, Lrev]) {
    const tris = triangulate(ring);
    assert.equal(tris.length / 6, 4);
    const { a, up } = area(tris);
    close(a, 2700);
    assert.ok(up);
    // ...and on a grid, the same area in small pieces
    const fine = fillRing(tris, 7);
    const f = area(fine);
    close(f.a, 2700, 1e-6);
    assert.ok(f.up);
    assert.ok(fine.length / 6 > 2700 / 49);
  }
});

test('a shore run out round an islet and back leaves the islet out (the Humedal Colosio\'s)', () => {
  // a 100 m square pond, its shore going in along z = 50 to a 20 m islet, round it the other way, and back out
  const ring = [0, 0, 100, 0, 100, 100, 0, 100, 0, 50, 40, 50, 40, 60, 60, 60, 60, 40, 40, 40, 40, 50, 0, 50];
  const tris = triangulate(ring);
  const { a, up } = area(tris);
  close(a, 10000 - 400, 1e-6);
  assert.ok(up);
  const w = createLakes([['wetland', 'Humedal', 0, ring]], { floor: () => 10 });
  assert.equal(w.offset(50, 50), 0); // (on the islet)
  assert.ok(w.offset(20, 80) < 0);
});

test('a lake on a level floor: banks falling from the shore to a flat bed, the water under the shore', () => {
  const { freeboard, depth, slope } = LAKES.pond;
  const w = createLakes([['pond', 'Bordo de prueba', 0, L]], { floor: () => 50 });
  const [b] = w.basins;
  assert.equal(w.hillside.length, 0);
  close(b.level, 50 - freeboard);
  // the bed in the middle of the L's wide arm, 2 m in from the shore, and nothing past it
  close(w.offset(15, 15), -(freeboard + depth), 1e-3);
  close(w.offset(2, 30), -slope * 2, 0.05);
  assert.equal(w.offset(45, 45), 0);
  assert.equal(w.offset(-10, 10), 0);
  // the deck's holes are its outline
  close(area(w.holes()).a, 2700);
  // the meshes: the shore wet (1) only where it is at or under the water
  const { shore, water } = w.meshData();
  for (let v = 0; v < shore.wet.length; v++) {
    const y = shore.position[v * 3 + 1];
    if (shore.wet[v] >= 1) assert.ok(50 + y <= b.level + 1e-4);
    else assert.ok(50 + y > b.level - 1e-4);
  }
  for (let k = 1; k < water.position.length; k += 3) close(water.position[k], b.level, 1e-4); // (Float32)
});

test('on a slope the water stands flat under the shore\'s lowest point; an intermittent one lower still', () => {
  const floor = (x) => 60 - x / 20; // (falling 3 m across the pond)
  const [b] = createLakes([['lake', '', 0, L]], { floor }).basins;
  close(b.level, 57 - LAKES.lake.freeboard, 0.05);
  const [dry] = createLakes([['lake', '', 1, L]], { floor }).basins;
  assert.ok(dry.level < b.level - 1);
});

test('a lake beyond the box or up the hills is laid on the hillside, not sunk', () => {
  const w = createLakes([['reservoir', 'Lejos', 2, L], ['pond', 'Arriba', 4, L], ['pond', 'Cerro', 0, L]],
    { floor: () => 0, hills: (x) => (x > 50 ? 5 : 0) });
  assert.equal(w.basins.length, 0);
  assert.deepEqual(w.hillside.map(([, name]) => name), ['Lejos', 'Arriba', 'Cerro']);
  assert.equal(w.offset(15, 15), 0);
});

test('Tepic\'s lakes: La Presa, Lago de Mora & Presa El Salto sunk into the ground, the deck opened over them', () => {
  const named = new Map(GEO.lakes.map((l) => [l[1], l]));
  for (const name of ['La Presa', 'Lago de Mora', 'Presa El Salto', 'Humedal Luis Donaldo Colosio']) assert.ok(named.has(name), name);
  assert.ok(lakes);
  const mora = lakes.basins.find((b) => b.name === 'Lago de Mora');
  assert.ok(mora);
  // somewhere in it the ground is well under the land around, and under the water
  let x = 0, z = 0;
  for (let k = 0; k < mora.ring.length; k += 2) { x += mora.ring[k]; z += mora.ring[k + 1]; }
  x /= mora.ring.length / 2; z /= mora.ring.length / 2;
  assert.ok(groundHeight(x, z) < landHeight(x, z) - 2);
  assert.ok(groundHeight(x, z) < mora.level);
  assert.ok(deckHoles().length >= lakes.holes().length);
  // the ones beyond the box (El Fresno, Presa Nueva) on the hillside
  assert.ok(lakes.hillside.some(([, name]) => name === 'El Fresno'));
});
