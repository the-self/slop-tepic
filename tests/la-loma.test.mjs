import test from 'node:test';
import assert from 'node:assert/strict';

// js/world/la-loma-plan.ts: the Parque La Loma's edge, the white building on Paseo de la Loma, the ISSSTE
const { LA_LOMA: P, LA_LOMA_RESERVES, ISSSTE_LOT, PAVILION_LOT, laLomaKeepsClear } = await import('../js/world/la-loma-plan.ts');
const { blockAt } = await import('../js/world/city-config.ts');
const { insidePoly } = await import('../js/world/rings.ts');

// a frame's local (x, z) in the world
const world = (F, x, z) => [F.x + x * Math.cos(F.yaw) + z * Math.sin(F.yaw), F.z - x * Math.sin(F.yaw) + z * Math.cos(F.yaw)];
// distance from (x, z) to a polygon's nearest edge
function edgeDistance(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return best;
}

test('La Loma: the park, its andador, laureles & benches along the curb, inside it', () => {
  assert.ok(P, 'the park is found');
  assert.equal(P.park.parkName, 'Parque La Loma');
  const length = P.walks.reduce((n, [, , pts]) => {
    for (let i = 2; i < pts.length; i += 2) n += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return n;
  }, 0);
  assert.ok(length > 1500, `the andador runs most of the way round: ${Math.round(length)} m`);
  for (const [kind, width, pts] of P.walks) {
    assert.equal(kind, 0);
    assert.equal(width, 3.5);
    for (let i = 0; i < pts.length; i += 2) {
      assert.ok(insidePoly(P.park.poly, pts[i], pts[i + 1]) && edgeDistance(P.park.poly, pts[i], pts[i + 1]) > 3.5, `the andador at ${pts[i]}, ${pts[i + 1]} is in the park, clear of the curb`);
    }
  }
  assert.ok(P.trees.filter((t) => t.species === 0).length > 250, 'rows of laureles');
  assert.ok(P.benches.length > 30, 'benches');
  for (const b of P.benches) assert.ok(insidePoly(P.park.poly, b.x, b.z), 'a bench in the park');
  // the park's own trees keep off the strip along the curb, not its middle
  const e = P.walks[0][2];
  assert.ok(laLomaKeepsClear(e[0], e[1]), 'none on the andador');
  assert.ok(!laLomaKeepsClear(P.park.cx, P.park.cz), 'its middle stays wooded');
  assert.ok(P.mural, 'the mural by Insurgentes');
  assert.ok(P.mural.z < P.park.minZ + 40, 'on the park\'s north side');
});

test('La Loma: the ISSSTE and the white building stand on their blocks, behind the curb', () => {
  assert.ok(P.issste && P.pavilion, 'both are found');
  assert.ok(Math.abs(P.issste.w - 81.4) < 1, `the ISSSTE on its Overture footprint: ${P.issste.w} m`);
  assert.equal(LA_LOMA_RESERVES.length, 2);
  // the ISSSTE faces the park, across Paseo de la Loma
  const [fx, fz] = [Math.sin(P.issste.yaw), Math.cos(P.issste.yaw)];
  const [ax, az] = world(P.issste, 0, 25);
  assert.ok(insidePoly(P.park.poly, ax + fx * 10, az + fz * 10), 'the park lies before the ISSSTE');
  for (const [F, lot, onPark] of [[P.issste, ISSSTE_LOT(P.issste), false], [P.pavilion, PAVILION_LOT(P.pavilion), true]]) {
    const [x0, x1, z0, z1] = lot;
    const block = onPark ? P.park : blockAt(...world(F, 0, -F.d / 2));
    assert.ok(block, 'its block');
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [0, z1]]) {
      const [wx, wz] = world(F, x, z);
      assert.ok(insidePoly(block.poly, wx, wz), `its corner ${x}, ${z} is on the block`);
      if (z === z1) assert.ok(edgeDistance(block.poly, wx, wz) > 1.5, `its front at ${x} is behind the curb: ${edgeDistance(block.poly, wx, wz).toFixed(1)} m`);
    }
    assert.ok(LA_LOMA_RESERVES.some((r) => r.contains(...world(F, 0, -F.d / 2))), 'the generic houses keep off it');
  }
});
