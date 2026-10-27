// js/app/hud.ts
// The HUD's text parts, built with safe DOM APIs only (textContent, classList, replaceChildren): the keys guide for the
// mode the player is in, the place and street corner they are at (drawn as a pair of street-name signs), what F does
// here, the sound button, and the 250 ms telemetry (fps, speed, altitude). The popovers (camera, time, teleports) open
// against the control that toggles them.
import type { PlayerMode } from '../player/controllers.ts';
import type { PromptAction } from './boarding.ts';
import { setText, t, tName } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';

/** A keyboard guide row: [keys (a key's name, or the message key of a word: 'key.space'), what they do] */
type Hint = readonly [keys: readonly string[], action: MessageKey];

// Keyboard guide for each mode
const CONTROL_HINTS: Readonly<Record<PlayerMode, readonly Hint[]>> = {
  // (the mouse looks once a click has locked the pointer, cameras.ts)
  person: [[['W', 'A', 'S', 'D'], 'hint.walk'], [['key.mouse'], 'hint.look'], [['Shift'], 'hint.sprint'], [['key.space'], 'hint.jump'],
    [['key.rmb', 'Z'], 'hint.aim'], [['key.lmb', 'X'], 'hint.fire'], [['Tab', '1-4'], 'hint.weapons'], [['F'], 'hint.stealBoard']], // (3 again: SMG / rifle)
  // (Shift's Nitro only in a car with a kit, drivetrain.ts)
  car: [[['W', 'S'], 'hint.gasBrake'], [['A', 'D'], 'hint.steer'], [['Shift'], 'hint.nitro'], [['key.space'], 'hint.handbrake'], [['E', 'Q'], 'hint.gears'],
    [['T'], 'hint.gearbox'], [['key.rmb', 'X'], 'hint.shoot'], [['F'], 'hint.exit']],
  cyclist: [[['W', 'S'], 'hint.pedal'], [['A', 'D'], 'hint.lean'], [['Shift'], 'hint.sprint'], [['key.rmb', 'X'], 'hint.shoot'], [['F'], 'hint.exit']],
  moto: [[['W', 'S'], 'hint.gasBrake'], [['A', 'D'], 'hint.lean'], [['Shift'], 'hint.nitro'], [['E', 'Q'], 'hint.gears'], [['T'], 'hint.gearbox'],
    [['key.rmb', 'X'], 'hint.shoot'], [['F'], 'hint.exit']],
  helicopter: [[['W', 'S'], 'hint.pitch'], [['A', 'D'], 'hint.yaw'], [['key.space', 'E'], 'hint.ascend'], [['Q', 'C'], 'hint.descend'], [['F'], 'hint.exit']]
};
// The touch button's word for what F would do
const BOARD_LABELS: Readonly<Record<PromptAction, MessageKey>> = {
  none: 'touch.board.board', board: 'touch.board.board', steal: 'touch.board.steal', exit: 'touch.board.exit', use: 'touch.board.use'
};
// Boosted top speeds in km/h (controllers.ts caps them; the car has its tachometer instead): the
// speed meter's full scale
const TOP_SPEED_KMH: Readonly<Record<PlayerMode, number>> = { person: 30, car: 200, cyclist: 48, helicopter: 187, moto: 110 };

/** What the sound button shows */
export interface SoundState {
  supported: boolean;
  enabled: boolean;
}

/** One telemetry update (every 250 ms) */
export interface Telemetry {
  fps: number;
  mode: PlayerMode;
  /** km/h */
  kmh: number;
  /** ft over the town's floor */
  altitudeFt: number;
  boosting: boolean;
}

export class Hud {
  private readonly fps = document.getElementById('hud-fps');
  private readonly mode = document.getElementById('hud-active-mode');
  private readonly camera = document.getElementById('hud-active-camera');
  private readonly speed = document.getElementById('hud-speed');
  private readonly speedMeter = document.getElementById('hud-speed-meter');
  private readonly altitude = document.getElementById('hud-altitude');
  private readonly location = document.getElementById('hud-location');
  private readonly controlsHint = document.getElementById('hud-controls-hint');
  private readonly prompt = document.getElementById('hud-prompt');
  private readonly boardButton = document.getElementById('touch-board');
  private readonly soundButton = document.getElementById('btn-sound');
  private readonly roadNames: ReadonlySet<string>;
  private readonly placeNames: ReadonlySet<string>;
  private locationText = '';
  private promptState = '';

  /** `roads` and `places`: the city's street and landmark names, to tell a place from a street corner */
  constructor(roads: readonly string[], places: readonly string[]) {
    this.roadNames = new Set(roads);
    this.placeNames = new Set(places);
    if (this.fps) this.fps.textContent = '60';
  }

  /** The mode's name (the vehicle the player is in) and its keys guide; `nitro` when the vehicle has the kit */
  showMode(mode: PlayerMode, label: string, nitro: boolean): void {
    document.body.dataset.mode = mode;
    if (this.mode) this.mode.textContent = label;
    if (!this.controlsHint) return;
    const hints = CONTROL_HINTS[mode].filter(([, action]) => action !== 'hint.nitro' || nitro);
    const items = hints.map(([keys, action]) => {
      const item = document.createElement('span');
      item.className = 'hint';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = tName(key);
        item.appendChild(kbd);
      }
      const text = document.createElement('span');
      text.className = 'hint-label';
      setText(text, action);
      item.appendChild(text);
      return item;
    });
    this.controlsHint.replaceChildren(...items);
  }

  showCamera(name: string): void {
    if (this.camera) this.camera.textContent = name;
  }

  /** Where the player is: "place · streets", a place, or a street corner ("A & B", "near A & B") */
  showLocation(label: string): void {
    if (!this.location || label === this.locationText) return;
    this.locationText = label;
    let place = '';
    let streets = label;
    const split = label.indexOf(' · ');
    if (split >= 0) {
      place = label.slice(0, split);
      streets = label.slice(split + 3);
    } else if (this.placeNames.has(label) || (!label.includes(' & ') && !this.roadNames.has(label))) {
      place = label;
      streets = '';
    }
    const nodes: HTMLElement[] = [];
    if (place) {
      const el = document.createElement('div');
      el.className = 'location-place';
      el.textContent = place;
      nodes.push(el);
    }
    if (streets) {
      const row = document.createElement('div');
      row.className = 'location-signs';
      if (streets.startsWith('near ')) {
        streets = streets.slice(5);
        const near = document.createElement('span');
        near.className = 'location-near';
        setText(near, 'hud.near');
        row.appendChild(near);
      }
      for (const name of streets.split(' & ')) {
        const sign = document.createElement('span');
        sign.className = 'street-sign';
        sign.textContent = name;
        row.appendChild(sign);
      }
      nodes.push(row);
    }
    this.location.replaceChildren(...nodes);
  }

  /** What F does here (`text`, '' for nothing), over the controls guide; `action`, its word on the touch button */
  showPrompt(text: string, action: PromptAction): void {
    const state = `${action}:${text}`;
    if (state === this.promptState) return;
    this.promptState = state;
    if (this.boardButton) {
      // the touch button: get in or take what is at hand, or get out
      this.boardButton.hidden = action === 'none';
      const label = this.boardButton.querySelector<HTMLElement>('[data-board-label]');
      if (label) setText(label, BOARD_LABELS[action]);
    }
    if (!this.prompt) return;
    this.prompt.hidden = !text;
    if (!text) return;
    const key = document.createElement('kbd');
    key.textContent = 'F';
    const label = document.createElement('span');
    label.textContent = text;
    this.prompt.replaceChildren(key, label);
  }

  showSound({ supported, enabled }: SoundState): void {
    const button = this.soundButton;
    if (!button) return;
    if (button instanceof HTMLButtonElement) button.disabled = !supported;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', t(enabled ? 'sound.mute' : 'sound.enable'));
    button.title = t(!supported ? 'sound.unavailable' : enabled ? 'sound.muteTitle' : 'sound.enableTitle');
    button.querySelector('use')?.setAttribute('href', enabled ? '#i-sound' : '#i-sound-off');
  }

  showTelemetry({ fps, mode, kmh, altitudeFt, boosting }: Telemetry): void {
    if (this.fps) {
      this.fps.textContent = String(fps);
      this.fps.className = fps >= 50 ? 'fps-ok' : fps >= 30 ? 'fps-warn' : 'fps-bad';
    }
    if (this.speed) this.speed.textContent = String(kmh);
    if (this.speedMeter) this.speedMeter.style.transform = `scaleX(${Math.min(1, kmh / TOP_SPEED_KMH[mode])})`;
    document.body.classList.toggle('is-boosting', boosting && kmh > 0);
    if (this.altitude) this.altitude.textContent = altitudeFt.toLocaleString('en-US');
  }
}

/**
 * Popovers (native [popover]: light dismiss & Esc for free) open against the control that toggles them: data-anchor
 * names the element they sit above / below, data-align the one whose right edge they line up with. Returns the
 * function that closes them all.
 */
export function wirePopovers(): () => void {
  const popovers = document.querySelectorAll<HTMLElement>('.popover[popover]');
  const supportsPopover = typeof HTMLElement.prototype.togglePopover === 'function';
  popovers.forEach((pop) => {
    const invoker = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      if (invoker) invoker.classList.toggle('is-open', open);
      if (!open) return;
      const anchor = document.getElementById(pop.dataset.anchor ?? '') ?? invoker;
      const align = document.getElementById(pop.dataset.align ?? '') ?? invoker;
      if (!anchor || !align) return;
      const r = anchor.getBoundingClientRect();
      const spaceAbove = Math.max(0, r.top - 20);
      const spaceBelow = Math.max(0, window.innerHeight - r.bottom - 20);
      let above = pop.dataset.side === 'above';
      // The camera control moves to the top on touch screens; open toward the available space.
      if ((above ? spaceAbove : spaceBelow) < 160) above = spaceAbove > spaceBelow;
      pop.style.right = `${Math.max(8, window.innerWidth - align.getBoundingClientRect().right)}px`;
      if (above) {
        pop.style.top = 'auto';
        pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
        pop.style.maxHeight = `${spaceAbove}px`;
      } else {
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom + 8}px`;
        pop.style.maxHeight = `${spaceBelow}px`;
      }
    });
  });
  return () => {
    if (!supportsPopover) return;
    popovers.forEach((pop) => {
      if (pop.matches(':popover-open')) pop.hidePopover();
    });
  };
}
