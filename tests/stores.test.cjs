const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

const tsl = new Proxy({}, { get: () => () => ({}) });
// (the module makes its unit geometries & scratch objects on load)
class Stub { rotateX() { return this; } }
const three = { BoxGeometry: Stub, PlaneGeometry: Stub, Matrix4: Stub, Quaternion: Stub, Vector3: Stub };
const store = loadModule(readFileSync(join(__dirname, '../js/world/store-interiors.ts'), 'utf8'), {
  imports: {
    'three/webgpu': three,
    'three/tsl': tsl,
    '../render/tsl-materials.ts': { cityUniforms: {} },
    './drape.ts': { drapeGeometry: (g) => g },
    './ground.ts': { townHeight: () => 0 }
  },
  globals: { Math, console }
});

// A Gualmart-sized hall (100 x 126 m) turned 24°, its front on its local west side
const hall = { cx: 1994, cz: 1602, w: 100, d: 126, th: -0.42, front: 0, base: 0, top: 9.6, name: 'GUALMART', band: '#0071ce' };

test('only a big chain on a hall big enough to be a store is walked into', () => {
  assert.equal(store.isEnterableStore({ big: true }, 100, 126), true);
  assert.equal(store.isEnterableStore({ big: true }, 6, 5), false, 'a small box tagged by a loose match');
  assert.equal(store.isEnterableStore({ big: false }, 100, 126), false, 'a convenience store stays shut');
  assert.equal(store.isEnterableStore(null, 100, 126), false);
});

test('a store has its door clear, its tills before the checkouts, and everything inside its walls, nothing overlapping', () => {
  const L = store.storeLayout(hall);
  const { halfFront, halfDepth } = L.frame;
  assert.equal(halfFront, 63, 'the front runs along the hall\'s local z (126 m)');
  assert.equal(halfDepth, 50);
  const walls = L.boxes.filter((b) => b.kind === 'wall');
  assert.equal(walls.length, 5, 'the front wall is two pieces either side of the door');
  // walking straight in through the middle of the door meets no wall nor counter until the lobby's end
  for (const b of L.boxes) {
    const blocksDoor = Math.abs(b.a) < b.la / 2 + 1 && b.b - b.lb / 2 < 9;
    assert.ok(!blocksDoor, `${b.kind} at ${b.a}, ${b.b} stands in the doorway`);
  }
  const counters = L.boxes.filter((b) => b.kind === 'counter');
  assert.equal(L.tills.length, counters.length);
  assert.ok(counters.length >= 6 && counters.length <= 12);
  for (const b of L.boxes) {
    assert.ok(Math.abs(b.a) + b.la / 2 <= halfFront + 1e-9 && b.b - b.lb / 2 >= -1e-9 && b.b + b.lb / 2 <= 2 * halfDepth + 1e-9, `${b.kind} inside the hall`);
  }
  const solid = L.boxes.filter((b) => b.kind !== 'wall');
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const p = solid[i], q = solid[j];
    const apart = Math.abs(p.a - q.a) >= (p.la + q.la) / 2 - 1e-9 || Math.abs(p.b - q.b) >= (p.lb + q.lb) / 2 - 1e-9;
    assert.ok(apart, `${p.kind} and ${q.kind} overlap`);
  }
  assert.ok(L.boxes.filter((b) => b.kind === 'gondola').length > 40, 'aisles of shelving');
});

test("a store's colliders sit inside the hall's footprint, turned with it", () => {
  const cols = store.storeColliders(hall);
  const cs = Math.cos(hall.th), sn = Math.sin(hall.th);
  for (const c of cols) {
    // back into the hall's local frame (world = c + R_y(θ)·local)
    const dx = c.obb.cx - hall.cx, dz = c.obb.cz - hall.cz;
    const u = cs * dx - sn * dz, v = sn * dx + cs * dz;
    assert.ok(Math.abs(u) + c.obb.hx <= hall.w / 2 + 1e-6 && Math.abs(v) + c.obb.hz <= hall.d / 2 + 1e-6);
    assert.equal(c.obb.cs, cs);
    assert.equal(c.obb.sn, sn);
  }
  // the door: the front wall's two pieces leave 7 m open at the middle of the local west side
  const front = cols.filter((c) => Math.abs((cs * (c.obb.cx - hall.cx) - sn * (c.obb.cz - hall.cz)) + hall.w / 2 - 0.25) < 1e-6);
  assert.equal(front.length, 2);
  const mids = front.map((c) => sn * (c.obb.cx - hall.cx) + cs * (c.obb.cz - hall.cz)).sort((p, q) => p - q);
  assert.ok(Math.abs(mids[1] - front[1].obb.hz - (mids[0] + front[0].obb.hz)) > 6.9);
});
