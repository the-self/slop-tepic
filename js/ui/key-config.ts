// js/ui/key-config.ts
// The menu's Keys tab (app/menu.ts): every binding of input/keybindings.ts by group, each with its two keys as
// buttons. Click one and press a key to bind it there (Esc leaves it as it was, Backspace or Delete takes it off); a key
// that does something else too says so, and Reset puts the defaults back. Built with safe DOM APIs only.
import { BIND_ACTIONS, BIND_ORDER, BIND_SLOTS, bindable, keyLabel } from '../input/keybindings.ts';
import type { BindAction, BindSpec, KeyBindings } from '../input/keybindings.ts';

const GROUPS: readonly BindSpec['group'][] = ['Moving', 'Vehicles', 'Weapons', 'Game'];

export class KeyConfig {
  private readonly root: HTMLElement | null;
  private readonly bindings: KeyBindings;
  private listening: { action: BindAction; slot: number } | null = null;

  constructor(root: HTMLElement | null, bindings: KeyBindings, reset: HTMLElement | null) {
    this.root = root;
    this.bindings = bindings;
    bindings.onChange(() => { this.render(); });
    reset?.addEventListener('click', () => {
      this.listening = null;
      bindings.reset();
    });
    // a click anywhere but on a key button gives up choosing (a tab, the backdrop, Resume)
    document.addEventListener('pointerdown', (e) => {
      if (this.listening && !(e.target instanceof Element && e.target.closest('.key-slot'))) this.cancel();
    }, true);
    this.render();
  }

  /** The menu hands its keys here first: while a key is being chosen, the one pressed is it. True when taken */
  handleKey(e: KeyboardEvent): boolean {
    const choosing = this.listening;
    if (!choosing) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.listening = null;
    if (e.code === 'Backspace' || e.code === 'Delete') this.bindings.set(choosing.action, choosing.slot, null);
    else if (e.code !== 'Escape' && bindable(e.code)) this.bindings.set(choosing.action, choosing.slot, e.code);
    this.render(); // (a key it already had, or a fixed one, changes nothing: the button still has to stop waiting)
    return true;
  }

  /** Stops waiting for a key (the menu closed, or the click went elsewhere) */
  cancel(): void {
    if (!this.listening) return;
    this.listening = null;
    this.render();
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const nodes: HTMLElement[] = [];
    for (const group of GROUPS) {
      const title = document.createElement('h3');
      title.className = 'menu-title';
      title.textContent = group;
      const rows = document.createElement('div');
      rows.className = 'key-rows';
      for (const action of BIND_ORDER) if (BIND_ACTIONS[action].group === group) rows.append(this.row(action));
      nodes.push(title, rows);
    }
    root.replaceChildren(...nodes);
  }

  private row(action: BindAction): HTMLElement {
    const row = document.createElement('div');
    row.className = 'key-row';
    const name = document.createElement('span');
    name.className = 'key-name';
    name.textContent = BIND_ACTIONS[action].label;
    const slots = document.createElement('span');
    slots.className = 'key-slots';
    const codes = this.bindings.get(action);
    for (let slot = 0; slot < BIND_SLOTS; slot++) {
      const code = codes[slot];
      const waiting = this.listening?.action === action && this.listening.slot === Math.min(slot, codes.length);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = waiting ? 'key-slot is-listening' : code ? 'key-slot' : 'key-slot is-empty';
      button.textContent = waiting ? 'Press a key…' : code ? keyLabel(code) : '—';
      button.title = waiting ? 'Esc: leave it · Backspace: no key' : code ? 'Click to change' : 'Click to add a key';
      button.addEventListener('click', () => {
        // (an empty slot fills the first free one: the keys stay main-first)
        this.listening = { action, slot: Math.min(slot, codes.length) };
        this.render();
      });
      slots.append(button);
    }
    row.append(name, slots);
    // a key this action shares with another: fine where each mode reads its own (Space: jump & handbrake), worth
    // knowing otherwise
    const shared = new Set(codes.flatMap((code) => this.bindings.usedBy(code, action)));
    if (shared.size) {
      const also = document.createElement('span');
      also.className = 'key-also';
      also.textContent = `Also: ${[...shared].map((other) => BIND_ACTIONS[other].label).join(', ')}`;
      row.append(also);
    }
    return row;
  }
}
