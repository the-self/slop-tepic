import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyBindings, BIND_ACTIONS, BIND_ORDER, keyLabel, bindable, isBindAction } from '../js/input/keybindings.ts';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, data };
}

test('the defaults are the keys the game always had, each mode reading its own of the shared ones', () => {
  const keys = new KeyBindings();
  assert.deepEqual(keys.get('forward'), ['KeyW', 'ArrowUp']);
  assert.ok(keys.is('up', 'Space') && keys.is('handbrake', 'Space'), 'Space jumps on foot and is the handbrake');
  assert.deepEqual(keys.usedBy('KeyE', 'shiftUp'), ['up']);
  assert.equal(keys.label('board'), 'F');
  for (const action of BIND_ORDER) {
    assert.ok(BIND_ACTIONS[action].keys.length >= 1 && BIND_ACTIONS[action].keys.length <= 2, `${action}: one or two keys`);
    assert.ok(BIND_ACTIONS[action].keys.every(bindable), `${action}: bindable defaults`);
  }
});

test('a key set in the menu replaces its slot, lasts in storage and comes back; reset gives the defaults', () => {
  const storage = memoryStorage();
  const keys = new KeyBindings(storage);
  let changes = 0;
  keys.onChange(() => { changes++; });
  keys.set('board', 0, 'KeyG');
  keys.set('forward', 1, null); // (no arrow)
  keys.set('horn', 1, 'KeyJ'); // (a second key)
  assert.deepEqual(keys.get('board'), ['KeyG']);
  assert.deepEqual(keys.get('forward'), ['KeyW']);
  assert.deepEqual(keys.get('horn'), ['KeyB', 'KeyJ']);
  assert.equal(changes, 3);
  assert.deepEqual(JSON.parse(storage.data.get('key-bindings')), { forward: ['KeyW'], board: ['KeyG'], horn: ['KeyB', 'KeyJ'] },
    'only what differs from the defaults is kept');
  const again = new KeyBindings(storage);
  assert.deepEqual(again.get('board'), ['KeyG']);
  assert.ok(again.is('horn', 'KeyJ'));
  again.reset();
  assert.deepEqual(again.get('board'), ['KeyF']);
  assert.deepEqual(new KeyBindings(storage).get('board'), ['KeyF']);
});

test('Esc, the numbers and the system keys stay fixed; a broken saved entry falls back to the defaults', () => {
  const keys = new KeyBindings();
  for (const code of ['Escape', 'Digit1', 'Digit0', 'MetaLeft', 'F5', '../x', '']) {
    assert.equal(bindable(code), false, code);
    keys.set('map', 0, code);
  }
  assert.deepEqual(keys.get('map'), ['KeyM']);
  keys.set('map', 0, 'KeyM');
  assert.deepEqual(keys.get('map'), ['KeyM'], 'a key it already has changes nothing');
  const storage = memoryStorage();
  storage.setItem('key-bindings', '{"map": ["Escape", 7, "KeyL", "KeyK", "KeyJ"], "fire": "KeyX", "nope": ["KeyQ"]}');
  const restored = new KeyBindings(storage);
  assert.deepEqual(restored.get('map'), ['KeyL', 'KeyK'], 'the fixed and the junk dropped, two at most');
  assert.deepEqual(restored.get('fire'), ['KeyX']);
  storage.setItem('key-bindings', '{not json');
  assert.deepEqual(new KeyBindings(storage).get('map'), ['KeyM']);
});

test('keycaps read as on the keyboard; binding names are checked', () => {
  assert.deepEqual(['KeyW', 'ArrowUp', 'ShiftLeft', 'Digit7', 'Numpad5', 'Space', 'Backquote'].map(keyLabel), ['W', '↑', 'Shift', '7', 'Num 5', 'Space', '`']);
  assert.equal(isBindAction('camera'), true);
  assert.equal(isBindAction('toString'), false);
  assert.equal(isBindAction(undefined), false);
});
