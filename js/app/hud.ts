// js/app/hud.ts
// The HUD's text parts, built with safe DOM APIs only (textContent, classList, replaceChildren): the mode the player
// is in, the place and street corner they are at (drawn as a pair of street-name signs), what F (or whichever key the
// menu gave it, input/keybindings.ts) does here, the menu's sound button, and the 250 ms telemetry (fps, speed,
// altitude).
import { keyBindings } from '../input/keybindings.ts';
import type { BindAction } from '../input/keybindings.ts';
import type { PlayerMode } from '../player/controllers.ts';
import type { PromptAction } from './boarding.ts';
import { setText, t } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';

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
  private readonly speed = document.getElementById('hud-speed');
  private readonly speedMeter = document.getElementById('hud-speed-meter');
  private readonly altitude = document.getElementById('hud-altitude');
  private readonly location = document.getElementById('hud-location');
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

  /** The mode's name (the vehicle the player is in) */
  showMode(mode: PlayerMode, label: string): void {
    document.body.dataset.mode = mode;
    if (this.mode) this.mode.textContent = label;
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

  /** What F (the board key, input/keybindings.ts, or `key`'s) does here (`text`, '' for nothing); `action`, its word on
   * the touch button */
  showPrompt(text: string, action: PromptAction, key: BindAction = 'board'): void {
    const state = `${action}:${keyBindings.label(key)}:${text}`; // (the key too: the menu may change it)
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
    const kbd = document.createElement('kbd');
    kbd.textContent = keyBindings.label(key);
    const label = document.createElement('span');
    label.textContent = text;
    this.prompt.replaceChildren(kbd, label);
  }

  showSound({ supported, enabled }: SoundState): void {
    const button = this.soundButton;
    if (!button) return;
    if (button instanceof HTMLButtonElement) button.disabled = !supported;
    button.setAttribute('aria-pressed', String(enabled));
    button.title = t(!supported ? 'sound.unavailable' : enabled ? 'sound.muteTitle' : 'sound.enableTitle');
    button.querySelector('use')?.setAttribute('href', enabled ? '#i-sound' : '#i-sound-off');
    const label = button.querySelector<HTMLElement>('[data-sound-label]');
    if (label) setText(label, enabled ? 'sound.on' : 'sound.off');
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
