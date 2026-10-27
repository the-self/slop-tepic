import assert from 'node:assert/strict';
import test from 'node:test';

// A window and document just big enough for player/aim.js: listeners, the crosshair and the body's classes
function fakeDom() {
  const target = () => {
    const listeners = new Map();
    return {
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
      dispatch: (type, e) => (listeners.get(type) || []).forEach((fn) => fn(e))
    };
  };
  const classes = () => {
    const set = new Set();
    return { set, toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const crosshair = { hidden: true, classList: classes() };
  const doc = Object.assign(target(), {
    hidden: false,
    pointerLockElement: null,
    body: { classList: classes() },
    getElementById: (id) => (id === 'hud-crosshair' ? crosshair : null),
    exitPointerLock() { this.pointerLockElement = null; }
  });
  const canvas = { requestPointerLock() { doc.pointerLockElement = canvas; } };
  return { win: target(), doc, canvas, crosshair };
}

globalThis.window = fakeDom().win;
const { AimControl, PITCH_MIN, PITCH_MAX } = await import('../js/player/aim.ts');

function setup() {
  const dom = fakeDom();
  globalThis.window = dom.win;
  const controllers = { activeMode: 'person', entities: { person: { heading: 0 } }, aiming: false };
  const aim = new AimControl({ canvas: dom.canvas, controllers, doc: dom.doc });
  return { ...dom, controllers, aim };
}

test('the right button aims on foot: the pointer is locked, the crosshair shows, the player strafes', () => {
  const { win, doc, canvas, crosshair, controllers, aim } = setup();
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 2, target: canvas, stopPropagation() {}, preventDefault() {} });
  assert.equal(doc.pointerLockElement, canvas);
  for (let i = 0; i < 20; i++) aim.update(1 / 60);
  assert.ok(aim.active && aim.blend > 0.9);
  assert.equal(controllers.aiming, true);
  assert.equal(crosshair.hidden, false);
  assert.ok(doc.body.classList.contains('is-aiming'));
  // the left button now fires, and doesn't reach the camera's drag
  let stopped = false;
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, target: canvas, stopPropagation() { stopped = true; }, preventDefault() {} });
  assert.ok(aim.fire && stopped);
  win.dispatch('mouseup', { button: 2 });
  for (let i = 0; i < 40; i++) aim.update(1 / 60);
  assert.equal(aim.active, false);
  assert.equal(aim.fire, false, 'letting go of the aim lets go of the trigger');
  assert.equal(doc.pointerLockElement, canvas, 'the pointer stays locked: the mouse goes on looking around');
  assert.equal(crosshair.hidden, true);
  assert.equal(aim.blend, 0);
});

test('the mouse turns the player and tilts the aim, within limits', () => {
  const { doc, controllers, aim } = setup();
  aim.held = true;
  aim.update(1 / 60);
  doc.dispatch('mousemove', { movementX: 100, movementY: 0 });
  assert.ok(controllers.entities.person.heading < 0, 'moving right turns right (clockwise from above)');
  doc.dispatch('mousemove', { movementX: 0, movementY: -100000 });
  assert.equal(aim.pitch, PITCH_MAX);
  doc.dispatch('mousemove', { movementX: 0, movementY: 100000 });
  assert.equal(aim.pitch, PITCH_MIN);
});

test('Z toggles the aim; it ends in a vehicle, out of play, and when Esc lets go of the pointer', () => {
  const { win, doc, controllers, aim } = setup();
  win.dispatch('keydown', { code: 'KeyZ', target: {} });
  aim.update(1 / 60);
  assert.equal(aim.active, true);
  doc.pointerLockElement = null;
  doc.dispatch('pointerlockchange', {});
  aim.update(1 / 60);
  assert.equal(aim.active, false, 'Esc released the pointer');
  win.dispatch('keydown', { code: 'KeyZ', target: {} });
  controllers.activeMode = 'car';
  aim.update(1 / 60);
  assert.equal(aim.active, false);
  controllers.activeMode = 'person';
  aim.update(1 / 60);
  assert.equal(aim.active, false, 'the toggle is dropped on getting in, not carried out again');
  aim.held = true;
  aim.allowed = false;
  aim.update(1 / 60);
  assert.equal(aim.active, false);
});

test('on foot with the pointer locked the left button fires from the hip; in a vehicle it does not', () => {
  const { win, doc, canvas, controllers, aim } = setup();
  const press = () => win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, target: canvas, stopPropagation() {}, preventDefault() {} });
  press();
  assert.equal(aim.fire, false, 'the click that takes the lock is not a shot');
  doc.pointerLockElement = canvas;
  press();
  aim.update(1 / 60);
  assert.equal(aim.fire, true);
  assert.equal(aim.active, false, 'firing from the hip is not aiming');
  win.dispatch('mouseup', { button: 0 });
  assert.equal(aim.fire, false);
  controllers.activeMode = 'car';
  press();
  aim.update(1 / 60);
  assert.equal(aim.fire, false);
});

test('from a vehicle the right button aims too, the left one fires; the mouse tilts the aim, not the player', () => {
  const { win, doc, canvas, crosshair, controllers, aim } = setup();
  controllers.activeMode = 'car';
  aim.update(1 / 60);
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 2, target: canvas, stopPropagation() {}, preventDefault() {} });
  assert.equal(doc.pointerLockElement, canvas);
  for (let i = 0; i < 20; i++) aim.update(1 / 60);
  assert.ok(aim.active && aim.blend > 0.9);
  assert.equal(crosshair.hidden, false);
  assert.equal(controllers.aiming, false, 'only on foot does aiming strafe');
  doc.dispatch('mousemove', { movementX: 100, movementY: -50 });
  assert.equal(controllers.entities.person.heading, 0, 'the camera turns the aim round the vehicle (cameras.ts)');
  assert.ok(aim.pitch > 0);
  win.dispatch('pointerdown', { pointerType: 'mouse', button: 0, target: canvas, stopPropagation() {}, preventDefault() {} });
  assert.equal(aim.fire, true);
  // not from the helicopter
  controllers.activeMode = 'helicopter';
  aim.update(1 / 60);
  assert.equal(aim.active, false);
  assert.equal(aim.fire, false);
});
