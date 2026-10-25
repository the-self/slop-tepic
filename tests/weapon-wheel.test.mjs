import assert from 'node:assert/strict';
import test from 'node:test';
import { slotAt, wedgePath } from '../js/ui/weapon-wheel.js';
import { WEAPONS, WEAPON_ORDER, weaponStats } from '../js/sim/weapons.js';

test('a pull of the mouse or the stick points at the wedge in its direction, clockwise from the top', () => {
  const n = 5;
  assert.equal(slotAt(0, -1, n), 0, 'up: the top wedge');
  assert.equal(slotAt(1, -0.3, n), 1, 'right and a little up: the next one clockwise');
  assert.equal(slotAt(0.6, 1, n), 2, 'down and to the right');
  assert.equal(slotAt(-0.6, 1, n), 3, 'down and to the left');
  assert.equal(slotAt(-1, -0.3, n), 4, 'left and a little up: the last');
  // across the seam at the top, either side still the top wedge
  assert.equal(slotAt(-0.2, -1, n), 0);
  assert.equal(slotAt(0.2, -1, n), 0);
});

test('each wedge is a closed ring sector centred on its own direction', () => {
  const n = WEAPON_ORDER.length;
  for (let i = 0; i < n; i++) {
    const d = wedgePath(i, n, 100, 222, 1.4);
    assert.match(d, /^M [-\d. ]+ A 222 222 0 0 1 [-\d. ]+ L [-\d. ]+ A 100 100 0 0 0 [-\d. ]+ Z$/);
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    // the outer arc's ends lie on the outer circle, either side of the wedge's direction
    const [x0, y0] = nums.slice(0, 2);
    assert.ok(Math.abs(Math.hypot(x0, y0) - 222) < 0.01);
    const mid = (i / n) * Math.PI * 2;
    const a0 = Math.atan2(x0, -y0);
    const off = ((mid - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    assert.ok(Math.abs(off - (Math.PI / n - (1.4 * Math.PI) / 360)) < 1e-3, `wedge ${i} starts half a wedge back`);
  }
});

test('the wheel\'s bars rank the arsenal sensibly', () => {
  for (const id of WEAPON_ORDER) {
    const s = weaponStats(id);
    for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1, `${id}: ${JSON.stringify(s)}`);
  }
  assert.equal(weaponStats('nope'), null);
  assert.equal(weaponStats('bazooka').damage, 1, 'the rocket hits hardest');
  assert.ok(weaponStats('smg').rate > weaponStats('rifle').rate && weaponStats('rifle').rate > weaponStats('pistol').rate);
  assert.ok(weaponStats('rifle').range > weaponStats('pistol').range && weaponStats('pistol').range > weaponStats('fists').range);
  assert.ok(weaponStats('pistol').accuracy > weaponStats('smg').accuracy, 'a sprayed SMG is the least accurate gun');
  assert.equal(weaponStats('fists').accuracy, 1 - WEAPONS.fists.spread / 0.06);
});
