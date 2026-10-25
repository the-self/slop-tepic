const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./helpers/module.cjs');

// js/world/tepic-landmarks.js's frame & plan (no three.js needed: only the drawing uses it)
async function landmarks() {
  const { GEO } = await import('../js/world/city-geodata.js');
  const { blockAt } = await import('../js/world/city-config.js');
  const source = readFileSync(join(__dirname, '../js/world/tepic-landmarks.js'), 'utf8');
  const tsl = new Proxy({}, { get: () => () => ({}) });
  return loadModule(source, {
    imports: {
      'three/webgpu': {}, 'three/tsl': tsl, 'three/addons/utils/BufferGeometryUtils.js': {},
      './city-geodata.js': { GEO }, './city-config.js': { blockAt }, '../render/tsl-materials.js': { cityUniforms: {} },
      './ground.js': { liftAt: () => 0, landHeight: () => 0 }, './landmark-models.js': { MODEL_RESERVES: [], geoToWorld: () => [0, 0] }
    },
    globals: { Math, console, Proxy }
  });
}

// inside a [x, z] polygon
function inside(poly, x, z) {
  let isIn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) isIn = !isIn;
  }
  return isIn;
}

test('the Catedral and its neighbours stand on their block, behind the curb of Av. México', async () => {
  const { CATEDRAL: C, PLAN, curbFront, frontRuns } = await landmarks();
  assert.ok(C && C.curb, 'the facade and its block are found');
  assert.ok(Math.abs(C.width - 17.4) < 1, `the facade is OpenStreetMap's 17 m front, not the whole lot: ${C.width}`);
  assert.ok(C.setback >= 0 && C.setback < 4, `stands back ${C.setback} m`);
  // the facade (z = 0 in its frame) behind the curb all along
  for (let x = -C.width / 2; x <= C.width / 2; x += 0.5) assert.ok(curbFront(C.curb, x) >= 0.5, `the facade at ${x} is behind the curb`);
  // the church & the casona inside the block
  for (const [x0, x1, z0, z1] of [PLAN.nave, PLAN.cross, PLAN.apse, PLAN.casona]) {
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) assert.ok(inside(C.curb, x, z), `${x}, ${z} is on the block`);
  }
  // the pink building & the portales follow the curb, a sidewalk's width in from it, and stay on the block
  const runs = frontRuns(PLAN.pink[0], PLAN.portales[1]);
  assert.ok(runs.length >= 2, 'the street turns along the portales');
  for (const r of runs) {
    const c = Math.cos(r.th), s = Math.sin(r.th);
    for (const u of [0, r.len / 2, r.len]) {
      for (const v of [0, -12]) {
        const x = r.ox + u * c + v * s, z = r.oz - u * s + v * c;
        assert.ok(inside(C.curb, x, z), `the corner ${x.toFixed(1)}, ${z.toFixed(1)} is on the block`);
        if (v === 0) assert.ok(curbFront(C.curb, x) - z > 2, `the front at ${x.toFixed(1)} leaves the sidewalk`);
      }
    }
  }
});
