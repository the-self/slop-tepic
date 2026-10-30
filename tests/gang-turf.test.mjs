import assert from 'node:assert/strict';
import test from 'node:test';
import { GANGS, NARCO } from '../js/sim/crime-rules.ts';
import { Turf, townTurf, CENTRE, EDGE } from '../js/sim/gang-turf.ts';

test('the gangs: Los Rojos and the cartel shoot first, Los Verdes only back', () => {
  assert.equal(GANGS.length, 3);
  assert.ok(GANGS[0].hostile && !GANGS[1].hostile && GANGS[2].hostile && GANGS[2].narco);
  assert.equal(GANGS[NARCO].narco, true);
});

// A 5 × 5 grid of back streets 100 m apart around (x0, z0): 3 × 3 four-way junctions inside, three-way ones round
// the edge (and the corners of the grid bends, two arms)
function grid(x0, z0, width = 7.4, lanes = 2, dir = 0) {
  const nodes = [], links = [];
  const id = (i, j) => i * 5 + j;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) nodes.push(x0 + (i - 2) * 100, z0 + (j - 2) * 100);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      if (i < 4) links.push([id(i, j), id(i + 1, j), 0, width, lanes, dir, [], 0, 0, 0]);
      if (j < 4) links.push([id(i, j), id(i, j + 1), 0, width, lanes, dir, [], 0, 0, 0]);
    }
  }
  return { nodes, links, names: [''], signals: [] };
}

test('a colonia is the ground nearest its label, out to the edge of town', () => {
  const turf = new Turf([{ name: 'A', x: 0, z: 0 }, { name: 'B', x: 1000, z: 0 }], grid(0, 0));
  assert.equal(turf.coloniaAt(10, 10), 0);
  assert.equal(turf.coloniaAt(600, 0), 1);
  assert.equal(turf.coloniaAt(0, 5000), -1, 'out of town: nobody\'s colonia');
});

test('nobody holds the centre, a gated coto or a residencial', () => {
  // (a name that would be a gang's anywhere else: the first that hashes to one)
  let held = null;
  for (let i = 0; i < 200 && !held; i++) {
    const t = new Turf([{ name: `Colonia ${i}`, x: 3000, z: 0 }], grid(3000, 0));
    if (t.colonias[0].gang >= 0) held = `Colonia ${i}`;
  }
  assert.ok(held, 'some colonia is a gang\'s');
  assert.equal(new Turf([{ name: held, x: 100, z: 0 }], grid(100, 0)).colonias[0].gang, -1, 'the centre is nobody\'s');
  for (const name of ['Coto Nápoles', 'Biosfera Residencial', 'Valle del Country']) {
    assert.equal(new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0)).colonias[0].gang, -1, name);
  }
});

test('a gang holds its colonia at a corner or two of its back streets, on the sidewalk, not on avenues', () => {
  const names = Array.from({ length: 200 }, (_, i) => `Colonia ${i}`);
  let checked = 0;
  for (const name of names) {
    const turf = new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0));
    const col = turf.colonias[0];
    if (col.gang < 0) {
      assert.equal(col.corners.length, 0);
      continue;
    }
    checked++;
    assert.ok(col.corners.length >= 1 && col.corners.length <= 2, `${col.corners.length} corners`);
    for (const k of col.corners) {
      // (off the junction's roadways: diagonally from it, past the kerb of both streets)
      const ox = ((k.x - 3000) % 100 + 150) % 100 - 50, oz = (k.z % 100 + 150) % 100 - 50;
      assert.ok(Math.abs(ox) > 3.7 && Math.abs(oz) > 3.7 && Math.abs(ox) < 12 && Math.abs(oz) < 12, `${ox}, ${oz} from the junction`);
    }
    if (col.corners.length === 2) assert.ok(Math.hypot(col.corners[0].x - col.corners[1].x, col.corners[0].z - col.corners[1].z) >= 160);
    // the same corners every time
    assert.deepEqual(new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0)).colonias[0].corners, col.corners);
    // an avenue's junctions are nobody's corner: the colonia goes unheld
    assert.equal(new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0, 20)).colonias[0].gang, -1, 'all avenues');
    // and so are a divided avenue's, each carriageway one-way with two lanes, narrower than an avenue
    assert.equal(new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0, 7.4, 2, 1)).colonias[0].gang, -1, 'all carriageways');
    // a one-way back street of the one lane is a back street still
    assert.ok(new Turf([{ name, x: 3000, z: 0 }], grid(3000, 0, 7.4, 1, 1)).colonias[0].gang >= 0, 'one-way back streets');
  }
  assert.ok(checked > 10, `${checked} held`);
});

test('in Tepic, most colonias are nobody\'s, the gangs keep a few corners each, the cartel out on the edges', () => {
  const turf = townTurf();
  const held = turf.colonias.filter((c) => c.gang >= 0);
  const share = held.length / turf.colonias.length;
  assert.ok(share > 0.1 && share < 0.35, `${(share * 100).toFixed(0)}% of the colonias held`);
  for (const g of [0, 1, NARCO]) assert.ok(held.some((c) => c.gang === g), `${GANGS[g].name} holds some`);
  for (const c of held) {
    const r = Math.hypot(c.x, c.z);
    assert.ok(r >= CENTRE, `${c.name}: not in the centre`);
    if (c.gang === NARCO) assert.ok(r > EDGE, `${c.name}: the cartel's out on the edges`);
    assert.ok(c.corners.length >= 1 && c.corners.length <= 2);
    for (const k of c.corners) {
      assert.equal(turf.coloniaAt(k.x, k.z), k.colonia, `${c.name}: its corner in its own ground`);
      assert.ok(Math.hypot(k.x, k.z) >= CENTRE, `${c.name}: its corner out of the centre`);
    }
  }
  assert.equal(turf.coloniaAt(0, 0) >= 0 ? turf.colonias[turf.coloniaAt(0, 0)].gang : -1, -1, 'the plaza is nobody\'s');
  // cornersNear finds a corner from round it, and not from far off
  const k = turf.corners[0];
  const out = [];
  assert.ok(turf.cornersNear(k.x + 100, k.z, 150, out).includes(k));
  assert.ok(!turf.cornersNear(k.x + 400, k.z, 150, out).includes(k));
});
