// js/app/menu.ts
// The game menu, as GTA's pause menu: Esc opens it (or letting go of the mouse with Esc, the touch button, the pad's
// Back), Esc or Resume closes it. Its tabs (Q / E step through them) hold what used to crowd the screen's corners:
// the time of day and the weather (the room's in multiplayer, main.ts), the camera, the teleports, the settings (sound,
// the clean view, the map) and the keys for what the player is in. The city keeps running behind it; while it is open
// the game's keys stay out of it and the mouse is free.
import { isTypingInField } from '../world/city-config.ts';

/** What the menu asks of the rest of the game */
export interface MenuHooks {
  /** it opened (true) or closed: release or suspend the input */
  onToggle: (open: boolean) => void;
  /** something else answers Esc right now (the full map, the weapon wheel): the menu leaves the key to it */
  busy: () => boolean;
  /** while open, a key for something in the menu first (the Keys tab choosing one, ui/key-config.ts): true if taken */
  onKey?: (e: KeyboardEvent) => boolean;
}

// After an Esc the page heard, the pointer lock it may have freed is that key's doing, not a reason to open the menu
const ESC_GRACE_MS = 400;

export class GameMenu {
  readonly root = document.getElementById('game-menu');
  isOpen = false;
  private readonly hooks: MenuHooks;
  private readonly tabs: HTMLElement[];
  private readonly pages: HTMLElement[];
  private tab = 0; // the tab shown (an index in tabs), kept from one opening to the next
  private lastEscape = -Infinity; // performance.now() ms

  constructor(hooks: MenuHooks) {
    this.hooks = hooks;
    this.tabs = [...(this.root?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])];
    this.pages = [...(this.root?.querySelectorAll<HTMLElement>('[data-page]') ?? [])];
    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => { this.showTab(i); });
    });
    // (capture: before the game's own keys on window, so the menu takes Esc first and keeps the rest from driving)
    window.addEventListener('keydown', (e) => {
      // (an Esc that closes the chat frees a locked pointer too: noted first, so that doesn't open the menu)
      if (e.code === 'Escape') this.lastEscape = performance.now();
      if (isTypingInField(e) || (this.isOpen && this.hooks.onKey?.(e))) return;
      if (e.code === 'Escape') {
        if (e.repeat || (!this.isOpen && this.hooks.busy())) return;
        e.preventDefault();
        this.toggle(!this.isOpen);
      } else if (this.isOpen) {
        e.stopImmediatePropagation();
        if (e.code === 'KeyQ' || e.code === 'KeyE') this.step(e.code === 'KeyE' ? 1 : -1);
      }
    }, { capture: true });
    // A browser takes the first Esc to free a locked pointer, and some never pass the key on: losing the lock that
    // way opens the menu too (the weapon wheel and the map let go of it themselves, and say so through busy())
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement !== null;
      const lost = wasLocked && !locked;
      wasLocked = locked;
      if (!lost || this.isOpen || this.hooks.busy() || document.hidden || !document.hasFocus()) return;
      if (performance.now() - this.lastEscape < ESC_GRACE_MS) return;
      this.toggle(true);
    });
    this.root?.querySelectorAll('[data-menu-close]').forEach((el) => {
      el.addEventListener('click', () => { this.toggle(false); });
    });
  }

  // The next shown tab that way (+1 / -1), wrapping round (a tab hidden on this screen, like the keys on a touch
  // screen, is passed over)
  step(dir: number): void {
    const n = this.tabs.length;
    for (let k = 1; k < n; k++) {
      const i = (((this.tab + dir * k) % n) + n) % n;
      if (this.tabs[i].offsetParent !== null) {
        this.showTab(i);
        return;
      }
    }
  }

  showTab(index: number): void {
    const name = this.tabs[index]?.dataset.tab;
    if (!name) return;
    this.tab = index;
    this.tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); });
    for (const page of this.pages) page.hidden = page.dataset.page !== name;
  }

  toggle(open: boolean): void {
    if (!this.root || open === this.isOpen) return;
    this.isOpen = open;
    this.root.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    if (open && document.pointerLockElement) document.exitPointerLock();
    this.hooks.onToggle(open);
  }
}
