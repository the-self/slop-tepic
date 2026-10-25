import assert from 'node:assert/strict';
import test from 'node:test';
import { insidePoly, insideRing } from '../js/world/rings.ts';

// The plain even-odd loop the city's builders used before
function plain(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// A star-ish outline of n vertices round (cx, cz), radius wobbling (concave), some vertices on band edges
function outline(n, cx = 0, cz = 0, r = 400, seed = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.55 + 0.45 * Math.abs(Math.sin(i * 7.3 + seed)));
    pts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.round(Math.sin(a) * rr / 16) * 16 + (i % 3 ? 0.5 : 0) });
  }
  return pts;
}

test('a big outline tested by bands answers as the plain loop does, everywhere', () => {
  for (const n of [5, 30, 1000]) {
    const pts = outline(n, 120, -80, 400, n);
    const flat = pts.flatMap((p) => [p.x, p.z]);
    let inside = 0;
    for (let k = 0; k < 20000; k++) {
      const x = -450 + ((k * 7919) % 1000) * 1.1, z = -560 + ((k * 104729) % 1000) * 1.0 + (k % 2 ? 0 : 16 * (k % 5));
      const want = plain(pts, x, z);
      assert.equal(insidePoly(pts, x, z), want, `poly ${n} at ${x}, ${z}`);
      assert.equal(insideRing(flat, x, z), want, `ring ${n} at ${x}, ${z}`);
      inside += want;
    }
    assert.ok(inside > 1000 && inside < 19000, 'the points fall on both sides');
  }
  // far outside its bands, either way
  const pts = outline(100);
  assert.equal(insidePoly(pts, 0, 5000), false);
  assert.equal(insidePoly(pts, 0, -5000), false);
});

test('an outline that grows after its first test is indexed again', () => {
  const pts = outline(40);
  assert.equal(insidePoly(pts, 2000, 0), false);
  // (pushed out to take in (2000, 0): a long spike from the vertex nearest it)
  pts.splice(1, 0, { x: 2100, z: -10 }, { x: 2100, z: 10 });
  assert.equal(insidePoly(pts, 2000, 0), plain(pts, 2000, 0));
});
