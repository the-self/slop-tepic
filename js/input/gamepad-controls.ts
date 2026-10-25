import { isTypingInField } from '../world/city-config.ts';

const DEAD_ZONE = 0.15;
const BUTTON_COUNT = 17;
const WHEEL_HOLD = 0.22; // s LB is held before it opens the weapon wheel rather than going back a camera

function axis(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function stick(pad, offset) {
  const x = axis(pad.axes?.[offset]), y = axis(pad.axes?.[offset + 1]);
  const distance = Math.hypot(x, y);
  const strength = Math.max(0, (Math.min(distance, 1) - DEAD_ZONE) / (1 - DEAD_ZONE));
  return distance ? { x: x / distance * strength, y: y / distance * strength } : { x: 0, y: 0 };
}

function buttonValue(pad, index) {
  const button = pad.buttons?.[index];
  return Number.isFinite(button?.value) ? Math.max(0, Math.min(1, button.value)) : button?.pressed ? 1 : 0;
}

function buttons(pad) {
  return Array.from({ length: BUTTON_COUNT }, (_, i) => Boolean(pad.buttons?.[i]?.pressed) || buttonValue(pad, i) > 0.5);
}

class GamepadControls {
  constructor(controllerManager, cameraSystem, callbacks = {}) {
    this.controller = controllerManager;
    this.camera = cameraSystem;
    this.callbacks = callbacks;
    this.connected = false;
    this.enabled = true;
    this.padIndex = null;
    this.padId = null;
    this.previousButtons = [];
    this.suppressedButtons = [];
    this.syncButtons = true;
    this.revision = 0;
    this.wheelHold = 0; // s LB has been held
    this.wheelOpen = false;
    this.lbHeld = false;
    this.focused = typeof document.hasFocus !== 'function' || document.hasFocus();

    window.addEventListener('blur', () => {
      this.focused = false;
      this.reset();
    });
    window.addEventListener('focus', () => {
      this.focused = true;
      this.reset();
    });
    document.addEventListener('visibilitychange', () => this.reset());
  }

  readPad() {
    // Some browsers expose the API but reject it through Permissions Policy.
    try {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
      const pads = navigator.getGamepads();
      let first = null;
      for (let i = 0; i < (pads?.length || 0); i++) {
        const pad = pads[i];
        if (!pad?.connected || pad.mapping !== 'standard') continue;
        if (pad.index === this.padIndex && pad.id === this.padId) return pad;
        if (!first) first = pad;
      }
      return first;
    } catch {
      return null;
    }
  }

  // The weapon wheel shut as it was (focus lost, the pad changed, the map opened)
  cancelWheel() {
    if (this.wheelOpen) this.callbacks.onWeaponWheel?.('cancel');
    this.wheelOpen = false;
    this.wheelHold = 0;
    this.lbHeld = false;
  }

  reset() {
    this.revision++;
    this.cancelWheel();
    this.controller.clearGamepadInput();
    const pad = this.readPad();
    if (pad && pad.index === this.padIndex && pad.id === this.padId) {
      this.previousButtons = buttons(pad);
      this.suppressedButtons = this.previousButtons.slice();
      this.syncButtons = false;
    } else {
      this.syncButtons = true;
    }
  }

  setEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  update(dt) {
    const pad = this.readPad();
    const connected = Boolean(pad);
    const changedPad = pad ? pad.index !== this.padIndex || pad.id !== this.padId : this.connected;
    if (changedPad) {
      this.controller.clearGamepadInput();
      this.padIndex = pad ? pad.index : null;
      this.padId = pad ? pad.id : null;
      this.syncButtons = true;
    }
    this.connected = connected;
    if (!pad) return;

    const pressed = buttons(pad);
    if (this.syncButtons) {
      // Connecting, switching pads, or resetting must not turn a held button into a fresh action.
      this.previousButtons = pressed.slice();
      this.suppressedButtons = pressed.slice();
      this.syncButtons = false;
    }
    for (let i = 0; i < BUTTON_COUNT; i++) if (!pressed[i]) this.suppressedButtons[i] = false;
    const edge = (i) => pressed[i] && !this.previousButtons[i] && !this.suppressedButtons[i];
    const held = (i) => pressed[i] && !this.suppressedButtons[i];
    // Capture edges before callbacks: changing mode or opening the map may synchronously call reset().
    const toggleMap = edge(9), closeMap = edge(1);
    const board = edge(3); // Y: get in or out, as in GTA
    let cycleCamera = Number(Boolean(edge(5)));
    const recenter = edge(11);
    const cycleWeapon = Number(Boolean(edge(15))) - Number(Boolean(edge(14))); // d-pad right / left
    this.previousButtons = pressed;

    const target = document.activeElement;
    const typing = isTypingInField({ target }) || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    if (!this.focused || document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()) || typing) {
      this.suppressedButtons = pressed.slice();
      this.controller.clearGamepadInput();
      this.cancelWheel();
      return;
    }

    const revision = this.revision;
    if (toggleMap) {
      this.controller.clearGamepadInput();
      this.callbacks.onToggleMap?.();
      return;
    }
    if (!this.enabled) {
      this.controller.clearGamepadInput();
      this.cancelWheel();
      for (let i = 0; i < BUTTON_COUNT; i++) if (i !== 1 && i !== 9) this.suppressedButtons[i] = pressed[i];
      if (closeMap) this.callbacks.onCloseMap?.();
      return;
    }
    // LB: a tap goes back a camera; held, it opens the weapon wheel (ui/weapon-wheel.js), the right stick points at a
    // weapon and letting go takes it
    const lb = Boolean(held(4));
    const wheels = Boolean(this.callbacks.onWeaponWheel);
    let wheel = null;
    if (lb) {
      this.wheelHold += Number.isFinite(dt) ? dt : 0;
      if (wheels && !this.wheelOpen && this.wheelHold >= WHEEL_HOLD) {
        this.wheelOpen = true;
        wheel = 'open';
      }
    } else if (this.lbHeld) {
      if (this.wheelOpen) wheel = 'close';
      else cycleCamera -= 1;
      this.wheelOpen = false;
      this.wheelHold = 0;
    }
    this.lbHeld = lb;

    if (board) this.callbacks.onBoard?.();
    if (revision !== this.revision) return;
    if (cycleCamera) this.callbacks.onCycleCamera?.(cycleCamera);
    if (revision !== this.revision) return;
    if (recenter) this.camera.resetOrbit();
    if (cycleWeapon) this.callbacks.onCycleWeapon?.(cycleWeapon);
    if (wheel) this.callbacks.onWeaponWheel(wheel);

    const movement = stick(pad, 0), look = stick(pad, 2);
    // (the right stick chooses on the wheel instead of turning the camera)
    if (this.wheelOpen) this.callbacks.onWeaponWheel('aim', look.x, look.y);
    const mode = this.controller.activeMode;
    let drive = -movement.y;
    let vertical = 0;
    if (mode === 'car' || mode === 'cyclist' || mode === 'moto') {
      drive = Math.max(0, drive, buttonValue(pad, 7)) - Math.max(0, -drive, buttonValue(pad, 6));
    } else if (mode === 'helicopter') {
      vertical = buttonValue(pad, 7) - buttonValue(pad, 6);
    }
    this.controller.setGamepadInput('forward', Math.max(0, drive));
    this.controller.setGamepadInput('backward', Math.max(0, -drive));
    this.controller.setGamepadInput('left', Math.max(0, -movement.x));
    this.controller.setGamepadInput('right', Math.max(0, movement.x));
    this.controller.setGamepadInput('up', mode === 'person' ? Number(Boolean(held(0))) : Math.max(0, vertical));
    this.controller.setGamepadInput('down', Math.max(0, -vertical));
    this.controller.setGamepadInput('boost', Number(Boolean(held(2))));
    this.controller.setGamepadInput('handbrake', mode === 'car' ? Number(Boolean(held(0))) : 0); // A: the car's handbrake
    // fire: the right trigger on foot (in a vehicle it is the throttle), B from a car or a bicycle
    const fire = mode === 'person' ? Number(buttonValue(pad, 7) > 0.5) : Number(Boolean(held(1)));
    this.controller.setGamepadInput('fire', this.wheelOpen ? 0 : fire);
    const zoom = Number(Boolean(held(13))) - Number(Boolean(held(12)));
    const free = !this.wheelOpen;
    this.camera.applyGamepadInput(free ? look.x : 0, free ? look.y : 0, zoom, Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0);
  }
}

export { GamepadControls };
