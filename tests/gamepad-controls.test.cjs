const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/input/gamepad-controls.ts'), 'utf8');

// A standard-mapping pad whose buttons and sticks the test sets
function rig() {
  const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const on = () => {};
  const globals = {
    window: { addEventListener: on },
    document: { addEventListener: on, hasFocus: () => true, hidden: false, activeElement: null },
    navigator: { getGamepads: () => [pad] }
  };
  const { GamepadControls } = loadModule(source, { imports: { '../world/city-config.ts': { isTypingInField: () => false } }, globals });
  const inputs = {};
  const controller = { activeMode: 'person', setGamepadInput: (k, v) => { inputs[k] = v; }, clearGamepadInput() {} };
  const looks = [];
  const camera = { applyGamepadInput: (x, y) => looks.push([x, y]), resetOrbit() {} };
  const calls = [];
  const pads = new GamepadControls(controller, camera, {
    onCycleCamera: (dir) => calls.push(['camera', dir]),
    onWeaponWheel: (action, x, y) => calls.push(action === 'aim' ? ['aim', Math.round(x * 10) / 10, Math.round(y * 10) / 10] : [action])
  });
  const press = (i, down) => { pad.buttons[i] = { pressed: down, value: down ? 1 : 0 }; };
  const frames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) pads.update(dt); };
  frames(1); // (connecting syncs the buttons)
  return { pad, press, frames, calls, inputs, looks };
}

test('a tap of LB still goes back a camera', () => {
  const { press, frames, calls } = rig();
  press(4, true);
  frames(5);
  press(4, false);
  frames(1);
  assert.deepEqual(calls, [['camera', -1]]);
});

test('LB held opens the weapon wheel, the right stick points, letting go takes the weapon', () => {
  const { pad, press, frames, calls, inputs, looks } = rig();
  press(4, true);
  frames(20); // a third of a second
  assert.deepEqual(calls.filter(([kind]) => kind !== 'aim'), [['open']], 'opened once, after the hold');
  pad.axes[2] = 1; // the right stick, to the right
  press(7, true); // the trigger is held too
  looks.length = 0;
  frames(1);
  assert.deepEqual(calls.at(-1), ['aim', 1, 0]);
  assert.equal(inputs.fire, 0, 'no shooting while choosing');
  assert.deepEqual(looks.at(-1), [0, 0], 'the stick does not turn the camera meanwhile');
  press(4, false);
  frames(1);
  assert.deepEqual(calls.at(-1), ['close']);
  assert.ok(!calls.some(([kind]) => kind === 'camera'), 'a long hold is not a camera change');
});
