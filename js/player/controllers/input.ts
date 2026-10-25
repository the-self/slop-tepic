// js/player/controllers/input.ts
// The player's controls: the keyboard bound once, the touch and gamepad inputs blended with it (the strongest
// wins, a held key over an analog one), cleared when the window loses focus; and whether the player is sprinting
import { isTypingInField } from '../../world/city-config.ts';
import type { SprintMode } from '../stats.ts';
import type { KeyValue, InputAction, InputSource } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

export function bindKeyboard(ctl: ThirdPersonControllerManager): void {
  const bindings: Record<InputAction, string[]> = {
    forward: ['KeyW', 'ArrowUp'],
    backward: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    up: ['Space', 'KeyE'],
    down: ['KeyQ', 'KeyC'],
    boost: ['ShiftLeft', 'ShiftRight'],
    // the car's handbrake & gearbox share keys with jumping and the helicopter's collective
    handbrake: ['Space'],
    shiftUp: ['KeyE'],
    shiftDown: ['KeyQ'],
    gearbox: ['KeyT'],
    fire: ['KeyX']
  };
  const actionsByCode = new Map<string, InputAction[]>();
  // (bindings' keys are the actions)
  for (const [action, codes] of Object.entries(bindings) as [InputAction, string[]][]) {
    for (const code of codes) actionsByCode.set(code, [...(actionsByCode.get(code) ?? []), action]);
  }
  ctl._pressedCodes = new Set();
  ctl._keyboardKeys = {};
  ctl._touchKeys = {};
  ctl._gamepadKeys = {};

  const onKey = (e: KeyboardEvent, isDown: boolean) => {
    const actions = actionsByCode.get(e.code);
    if (!actions || (isDown && isTypingInField(e))) return;
    if (isDown) ctl._pressedCodes.add(e.code);
    else ctl._pressedCodes.delete(e.code);
    for (const action of actions) {
      // Releasing one binding must not cancel another key held for the same action.
      ctl._keyboardKeys[action] = bindings[action].some((code) => ctl._pressedCodes.has(code));
      ctl._blendInput(action);
    }
  };

  window.addEventListener('keydown', (e) => { onKey(e, true); });
  window.addEventListener('keyup', (e) => { onKey(e, false); });
  window.addEventListener('blur', () => { ctl.resetInput(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctl.resetInput();
  });
}

export function _blendInput(ctl: ThirdPersonControllerManager, action: InputAction): void {
  const keyboard = ctl._keyboardKeys[action] || false;
  const touch = ctl._touchKeys[action] || false;
  const gamepad = ctl._gamepadKeys[action] || false;
  const strength = Math.max(Number(keyboard), Number(touch), Number(gamepad));
  // Preserve digital button values while allowing either analog source to be strongest.
  ctl.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
}

export function _setAnalogInput(ctl: ThirdPersonControllerManager, source: InputSource, action: InputAction, value: KeyValue): void {
  if (!Object.hasOwn(ctl.keys, action)) return;
  const strength = Number(value);
  source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  ctl._blendInput(action);
}

export function setTouchInput(ctl: ThirdPersonControllerManager, action: InputAction, value: KeyValue): void {
  ctl._setAnalogInput(ctl._touchKeys, action, value);
}

export function setGamepadInput(ctl: ThirdPersonControllerManager, action: InputAction, value: KeyValue): void {
  ctl._setAnalogInput(ctl._gamepadKeys, action, value);
}

export function clearTouchInput(ctl: ThirdPersonControllerManager): void {
  ctl._touchKeys = {};
  for (const action of Object.keys(ctl.keys) as InputAction[]) ctl._blendInput(action);
}

export function clearGamepadInput(ctl: ThirdPersonControllerManager): void {
  ctl._gamepadKeys = {};
  for (const action of Object.keys(ctl.keys) as InputAction[]) ctl._blendInput(action);
}

export function resetInput(ctl: ThirdPersonControllerManager): void {
  ctl._pressedCodes.clear();
  ctl._keyboardKeys = {};
  ctl._touchKeys = {};
  ctl._gamepadKeys = {};
  for (const action of Object.keys(ctl.keys) as InputAction[]) ctl.keys[action] = false;
}

// The mode the player is sprinting in now ('person' | 'cyclist', shift held going forward at speed: on foot, any way
// it is steered), or null: what runs the stamina down (player/stats.ts)
export function sprintingMode(ctl: ThirdPersonControllerManager): SprintMode | null {
  const mode = ctl.activeMode;
  const k = ctl.keys;
  const going = mode === 'person' ? k.forward || k.backward || k.left || k.right : k.forward;
  if (!k.boost || !going || !ctl.canSprint || (mode !== 'person' && mode !== 'cyclist')) return null;
  return ctl.entities[mode].speed > (mode === 'person' ? 4.6 : 3) ? mode : null;
}
