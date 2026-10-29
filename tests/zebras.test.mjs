import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeZebras } from '../js/world/zebras.ts';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} should equal ${b}`);
// a zebra across a street running along z (across: x), at (x, z), half `half` m long, facing away from its junction
// along +z (oz 1: the junction north of it) or -z (oz -1)
const zb = (x, z, half, oz = 1, e = null) => ({ x, z, ux: 1, uz: 0, half, w: 2.2, ox: 0, oz, e });

test("a divided road's two halves of one crossing are painted as one zebra curb to curb, out from the junction", () => {
  // two carriageways 4.5 m wide each side of a 1 m median, their stop lines 6 m apart along the street
  const { painted, of } = mergeZebras([zb(-2.75, 10, 2.25), zb(2.75, 16, 2.25)]);
  assert.equal(painted.length, 1);
  assert.deepEqual(of, [0, 0]);
  const [p] = painted;
  close(p.half, 5);
  close(p.x, 0);
  close(p.z, 16); // (the half further out from the junction)
});

test('the zebras either side of a junction, and on crossing streets meeting at a corner, stay apart', () => {
  // a 9 m street's crossings south and north of a junction 12 m across, and the cross street's east of it
  const south = zb(0, 7.25, 4.5, 1), north = zb(0, -7.25, 4.5, -1);
  const east = { x: 7.25, z: 0, ux: 0, uz: 1, half: 4.5, w: 2.2, ox: 1, oz: 0, e: null };
  const { painted } = mergeZebras([south, north, east]);
  assert.equal(painted.length, 3);
});

test('a zebra laid across a longer one (a slip lane\'s, through the junction\'s) is left out', () => {
  const main = zb(0, 0, 6);
  const slip = { x: 0, z: 0.5, ux: Math.SQRT1_2, uz: Math.SQRT1_2, half: 3, w: 2.2, ox: 0, oz: 0, e: null };
  const { painted, of } = mergeZebras([main, slip]);
  assert.equal(painted.length, 1);
  assert.equal(painted[0], main);
  assert.deepEqual(of, [0, -1]);
});

test('two crossing zebras that only touch at their ends (an island\'s tip) are both painted', () => {
  const a = { x: 0, z: 0, ux: 1, uz: 0, half: 4, w: 2.2, ox: 0, oz: 1, e: null };
  const b = { x: 4 + 2.8, z: 2.8, ux: Math.SQRT1_2, uz: Math.SQRT1_2, half: 4, w: 2.2, ox: -Math.SQRT1_2, oz: Math.SQRT1_2, e: null };
  assert.equal(mergeZebras([a, b]).painted.length, 2);
});

test('a zebra standing in the middle of a street running across it (a short link\'s, inside a junction) is left out', () => {
  // an east-west avenue 9 m wide along z = 0, from x = -50 to 50; a zebra across a link north-south in it, and the
  // north arm's own one clear of it, 6.75 m north of its centreline
  const avenue = { x0: -50, z0: 0, dx: 1, dz: 0, span: 100, half: 4.5 };
  const inside = zb(0, 2, 3.5), clear = zb(10, -6.75, 4.5, -1);
  const { painted } = mergeZebras([inside, clear], [avenue]);
  assert.deepEqual(painted, [clear]);
  // and the avenue's own zebras are not in it: they run across it, not along
  const own = { x: 40, z: 0, ux: 0, uz: 1, half: 4.5, w: 2.2, ox: 1, oz: 0, e: null };
  assert.equal(mergeZebras([own], [avenue]).painted.length, 1);
});
