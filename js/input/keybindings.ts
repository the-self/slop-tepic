// js/input/keybindings.ts
// The keyboard's bindings: which keys (KeyboardEvent.code, so they stay put whatever the layout) do what, the
// defaults, and the player's own from the menu's Keys tab (ui/key-config.ts), remembered in localStorage. Every part of
// the game that listens to a key asks here (controllers/input.ts, aim.ts, crime/player.ts, the weapon wheel, the map,
// the chat & the crew, app/install/controls.ts), so a key changed in the menu changes everywhere at once. Free of three.js and of
// imports (but the type of its labels' message keys, i18n/en.ts), so node --test runs it as it is.
//
// Some keys stay fixed: Esc (the menu), 1-4 (weapons), 5-0 (cameras) and the mouse.
import type { MessageKey } from '../i18n/en.ts';

/** A thing a key can be bound to */
export type BindAction =
  | 'forward' | 'backward' | 'left' | 'right' | 'boost' | 'up' | 'down'
  | 'handbrake' | 'shiftUp' | 'shiftDown' | 'gearbox' | 'board' | 'horn' | 'refuel'
  | 'fire' | 'aim' | 'weaponWheel' | 'nextWeapon'
  | 'camera' | 'map' | 'cleanView' | 'sound' | 'chat' | 'crew' | 'passive';

/** How the menu shows a binding: its name (a message key, i18n/), the group it is listed under, its default keys */
export interface BindSpec {
  label: MessageKey;
  group: 'moving' | 'vehicles' | 'weapons' | 'game';
  keys: readonly string[];
}

/** Keys an action can have at once: a main one and another */
export const BIND_SLOTS = 2;

// The defaults, as the game shipped them. Some keys do two things in two places (Space jumps on foot and is the
// car's handbrake; E is the helicopter's climb and the gearbox's shift up): each mode reads only its own
export const BIND_ACTIONS: Readonly<Record<BindAction, BindSpec>> = {
  forward: { label: 'bind.forward', group: 'moving', keys: ['KeyW', 'ArrowUp'] },
  backward: { label: 'bind.backward', group: 'moving', keys: ['KeyS', 'ArrowDown'] },
  left: { label: 'bind.left', group: 'moving', keys: ['KeyA', 'ArrowLeft'] },
  right: { label: 'bind.right', group: 'moving', keys: ['KeyD', 'ArrowRight'] },
  boost: { label: 'bind.boost', group: 'moving', keys: ['ShiftLeft', 'ShiftRight'] },
  up: { label: 'bind.up', group: 'moving', keys: ['Space', 'KeyE'] },
  down: { label: 'bind.down', group: 'moving', keys: ['KeyQ', 'KeyC'] },
  handbrake: { label: 'bind.handbrake', group: 'vehicles', keys: ['Space'] },
  shiftUp: { label: 'bind.shiftUp', group: 'vehicles', keys: ['KeyE'] },
  shiftDown: { label: 'bind.shiftDown', group: 'vehicles', keys: ['KeyQ'] },
  gearbox: { label: 'bind.gearbox', group: 'vehicles', keys: ['KeyT'] },
  board: { label: 'bind.board', group: 'vehicles', keys: ['KeyF'] },
  horn: { label: 'bind.horn', group: 'vehicles', keys: ['KeyB'] },
  refuel: { label: 'bind.refuel', group: 'vehicles', keys: ['KeyG'] },
  fire: { label: 'bind.fire', group: 'weapons', keys: ['KeyX'] },
  aim: { label: 'bind.aim', group: 'weapons', keys: ['KeyZ'] },
  weaponWheel: { label: 'bind.weaponWheel', group: 'weapons', keys: ['Tab'] },
  nextWeapon: { label: 'bind.nextWeapon', group: 'weapons', keys: ['KeyR'] },
  camera: { label: 'bind.camera', group: 'game', keys: ['KeyV'] },
  map: { label: 'bind.map', group: 'game', keys: ['KeyM'] },
  cleanView: { label: 'bind.cleanView', group: 'game', keys: ['KeyH'] },
  sound: { label: 'bind.sound', group: 'game', keys: ['KeyN'] },
  chat: { label: 'bind.chat', group: 'game', keys: ['Enter'] },
  crew: { label: 'bind.crew', group: 'game', keys: ['KeyU'] },
  passive: { label: 'bind.passive', group: 'game', keys: ['KeyP'] }
};

// (BIND_ACTIONS' keys are the actions)
export const BIND_ORDER = Object.keys(BIND_ACTIONS) as BindAction[];

/** Keys that can't be bound: the menu's (Esc), the weapons' & cameras' numbers, and the system's */
const FIXED = /^(Escape|Digit[0-9]|Meta(Left|Right)|OS(Left|Right)|ContextMenu|F([1-9]|1[0-2]))$/;
const CODE = /^[A-Za-z0-9]{1,24}$/;
const STORAGE_KEY = 'key-bindings';

/** What KeyBindings keeps the player's bindings in (localStorage, or nothing) */
export interface BindStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True for the name of a binding (BIND_ACTIONS' keys), as the page writes them (kbd[data-key]) */
export function isBindAction(name: string | undefined): name is BindAction {
  return name !== undefined && Object.hasOwn(BIND_ACTIONS, name);
}

/** True for a key code the player may bind (KeyboardEvent.code) */
export function bindable(code: string): boolean {
  return CODE.test(code) && !FIXED.test(code);
}

const NAMES: Readonly<Partial<Record<string, string>>> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'R Shift',
  ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', Backquote: '`', Minus: '-',
  Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/', CapsLock: 'Caps', Backspace: '⌫', PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del',
  Insert: 'Ins', NumpadEnter: 'Num Enter'
};

/** A key code as a keycap shows it: 'KeyW' → 'W', 'ArrowUp' → '↑', 'Numpad5' → 'Num 5' */
export function keyLabel(code: string): string {
  const named = NAMES[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export class KeyBindings {
  private codes: Record<BindAction, string[]>;
  private readonly storage: BindStorage | null;
  private readonly listeners: (() => void)[] = [];

  constructor(storage: BindStorage | null = null) {
    this.storage = storage;
    this.codes = KeyBindings.defaults();
    this.restore();
  }

  static defaults(): Record<BindAction, string[]> {
    const codes = {} as Record<BindAction, string[]>; // (filled for every action just below)
    for (const action of BIND_ORDER) codes[action] = [...BIND_ACTIONS[action].keys];
    return codes;
  }

  /** The keys bound to `action`, its main one first */
  get(action: BindAction): readonly string[] {
    return this.codes[action];
  }

  /** Whether the key `code` does `action` */
  is(action: BindAction, code: string): boolean {
    return this.codes[action].includes(code);
  }

  /** The main key's keycap, '' when the action has none */
  label(action: BindAction): string {
    const code = this.codes[action][0];
    return code ? keyLabel(code) : '';
  }

  /** The other actions the key `code` is bound to (a key may do two things: the menu says so) */
  usedBy(code: string, except: BindAction): BindAction[] {
    return BIND_ORDER.filter((action) => action !== except && this.codes[action].includes(code));
  }

  /** Binds `code` in `action`'s slot (0: the main key), or with null takes that slot's key off */
  set(action: BindAction, slot: number, code: string | null): void {
    if (slot < 0 || slot >= BIND_SLOTS || (code !== null && !bindable(code))) return;
    const keys = [...this.codes[action]];
    if (code === null) keys.splice(slot, 1);
    else if (keys.includes(code)) return; // (already one of its keys)
    else if (slot < keys.length) keys[slot] = code;
    else keys.push(code);
    this.codes[action] = keys.slice(0, BIND_SLOTS);
    this.changed();
  }

  /** Back to the defaults */
  reset(): void {
    this.codes = KeyBindings.defaults();
    this.changed();
  }

  /** `listener` runs after every change */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    try {
      // only what differs from the defaults is kept, so a default changed in a later version still reaches the player
      const own: Partial<Record<BindAction, string[]>> = {};
      for (const action of BIND_ORDER) {
        if (this.codes[action].join() !== BIND_ACTIONS[action].keys.join()) own[action] = this.codes[action];
      }
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(own));
    } catch { /* Storage may be full or disabled: the bindings still last the session */ }
    for (const listener of this.listeners) listener();
  }

  private restore(): void {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null') as unknown; // (checked field by field)
      if (!saved || typeof saved !== 'object') return;
      for (const action of BIND_ORDER) {
        const keys: unknown = (saved as Partial<Record<string, unknown>>)[action];
        if (!Array.isArray(keys)) continue;
        this.codes[action] = keys.filter((k): k is string => typeof k === 'string' && bindable(k)).slice(0, BIND_SLOTS);
      }
    } catch { /* Storage blocked, or a broken entry: the defaults */ }
  }
}

function siteStorage(): BindStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage; // (reading it throws where site data is blocked)
  } catch {
    return null;
  }
}

/** The game's bindings, shared by everything that listens to the keyboard */
export const keyBindings = new KeyBindings(siteStorage());
