// js/ui/crime-hud.ts
// The crime HUD (crime.ts's state): wanted stars, health, stamina (player/stats.ts) & armour bars, money, the weapon in hand (in
// 3D once ui/weapon-icons.ts has baked it, drawn again on a change) and its rounds, short messages, the red edges of getting hurt and the WASTED / BUSTED screen. Safe DOM APIs only; the text and
// bars change only when their values do.

import type { WeaponId } from '../sim/weapons.ts';
import type { WeaponIcons } from './weapon-icons.ts';

const TOAST_TIME = 2.6; // s a message stays

/** What the HUD reads of the CrimeSystem (sim/crime.ts) */
export interface CrimeHudState {
  wanted: { stars: number; evading: number }; // stars 0..5; evading > 0 while the police have lost sight of the player
  health: number; // 0..100
  armor: number; // 0..100
  money: number; // pesos
  arsenal: { weapon: { id: WeaponId; label: string }; ammo: Readonly<Record<WeaponId, number>> }; // (Infinity: fists)
  toasts: string[]; // messages waiting, oldest first (the HUD takes them)
  state: string; // 'play' | 'wasted' | 'busted'
  hurtFlash: number; // 0..1
}

/** player/stats.ts's stamina: value 0..100 */
export interface StaminaState {
  value: number;
  winded: boolean;
}

interface CrimeHudElements {
  root: HTMLElement;
  stars: Element[];
  wanted: HTMLElement;
  health: HTMLElement;
  armor: HTMLElement;
  armorRow: HTMLElement;
  stamina: HTMLElement | null;
  staminaRow: HTMLElement | null;
  money: HTMLElement;
  weapon: HTMLElement;
  weaponCard: HTMLElement | null;
  weaponImg: HTMLImageElement | null;
  weaponGlyph: Element | null;
  ammo: HTMLElement;
  toast: HTMLElement;
  banner: HTMLElement;
  vignette: HTMLElement;
}

class CrimeHud {
  el: CrimeHudElements | null; // null without the HUD's markup (index.html #hud-crime)
  shown: Record<string, unknown>; // what each part last showed
  toastTime: number; // s the message showing has left
  money: number | null; // the money shown, counting towards the real figure
  icons: WeaponIcons | null; // ui/weapon-icons.ts, set by main.ts

  constructor(doc = document) {
    const root = doc.getElementById('hud-crime');
    const wanted = doc.getElementById('hud-wanted');
    const health = doc.getElementById('hud-health');
    const armor = doc.getElementById('hud-armor');
    const armorRow = doc.getElementById('hud-armor-row');
    const money = doc.getElementById('hud-money');
    const weapon = doc.getElementById('hud-weapon-name');
    const ammo = doc.getElementById('hud-ammo');
    const toast = doc.getElementById('hud-toast');
    const banner = doc.getElementById('hud-banner');
    const vignette = doc.getElementById('hud-hurt');
    this.el = root && wanted && health && armor && armorRow && money && weapon && ammo && toast && banner && vignette
      ? {
        root,
        stars: [...doc.querySelectorAll('#hud-wanted .wanted-star')],
        wanted,
        health,
        armor,
        armorRow,
        stamina: doc.getElementById('hud-stamina'),
        staminaRow: doc.getElementById('hud-stamina-row'),
        money,
        weapon,
        weaponCard: doc.getElementById('hud-weapon'),
        weaponImg: doc.querySelector<HTMLImageElement>('#hud-weapon-icon img'),
        weaponGlyph: doc.querySelector('#hud-weapon-icon svg'),
        ammo,
        toast,
        banner,
        vignette
      }
      : null;
    this.shown = {};
    this.toastTime = 0;
    this.money = null;
    this.icons = null;
  }

  set<T>(key: string, value: T, apply: (value: T) => void): void {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    apply(value);
  }

  update(crime: CrimeHudState, dt: number, stamina: StaminaState | null = null): void {
    const el = this.el;
    if (!el) return;
    // wanted stars: lit up to the level, the next to go flashing while the police have lost sight of the player
    const stars = crime.wanted.stars;
    const evading = crime.wanted.evading > 0.05 && stars > 0;
    this.set('stars', stars, (n) => {
      el.stars.forEach((s, i) => s.classList.toggle('is-lit', i < n));
      el.wanted.classList.toggle('is-wanted', n > 0);
      el.wanted.setAttribute('aria-label', `Wanted level: ${n} of 5`);
    });
    this.set('evading', evading, (on) => el.wanted.classList.toggle('is-evading', on));

    this.set('health', Math.ceil(crime.health), (h) => {
      el.health.style.transform = `scaleX(${Math.max(0, h) / 100})`;
      el.health.parentElement?.classList.toggle('is-low', h <= 25);
    });
    // stamina only while it isn't full
    const { stamina: staminaBar, staminaRow } = el;
    if (stamina && staminaBar && staminaRow) {
      this.set('stamina', Math.round(stamina.value), (v) => {
        staminaBar.style.transform = `scaleX(${v / 100})`;
        staminaRow.hidden = v >= 100;
      });
      this.set('winded', stamina.winded, (on) => staminaRow.classList.toggle('is-winded', on));
    }
    this.set('armor', Math.ceil(crime.armor), (a) => {
      el.armor.style.transform = `scaleX(${a / 100})`;
      el.armorRow.hidden = a <= 0;
    });

    // money rolls towards its new value
    this.money ??= crime.money;
    const diff = crime.money - this.money;
    this.money = Math.abs(diff) < 1 ? crime.money : this.money + diff * Math.min(1, dt * 8);
    this.set('money', Math.round(this.money), (m) => {
      el.money.textContent = `$${Math.max(0, m).toLocaleString('en-US')}`;
    });

    const w = crime.arsenal.weapon;
    this.set('weapon', w.label, (label) => { el.weapon.textContent = label; });
    // its picture: the 3D one in the hand once baked, the flat symbol till then
    const url = this.icons?.ready ? this.icons.url(w.id, true) : null;
    this.set('weaponIcon', url || w.id, () => {
      if (el.weaponImg && url) {
        el.weaponImg.src = url;
        el.weaponImg.hidden = false;
        el.weaponGlyph?.setAttribute('hidden', ''); // (an SVG element has no hidden property)
      } else {
        el.weaponGlyph?.firstElementChild?.setAttribute('href', `#w-${w.id}`);
      }
    });
    this.set('weaponDrawn', w.id, (id) => {
      const card = el.weaponCard;
      if (!card || this.shown.weaponFirst === undefined) {
        this.shown.weaponFirst = id;
        return;
      }
      card.classList.remove('is-switching');
      void card.getBoundingClientRect(); // (a reflow: restarts its animation)
      card.classList.add('is-switching');
    });
    const rounds = crime.arsenal.ammo[w.id];
    this.set('ammo', rounds, (n) => { el.ammo.textContent = n === Infinity ? '' : String(n); });

    // messages, one at a time
    this.toastTime -= dt;
    if (this.toastTime <= 0 && crime.toasts.length) {
      el.toast.textContent = crime.toasts.shift() ?? '';
      el.toast.hidden = false;
      el.toast.classList.remove('is-in');
      void el.toast.getBoundingClientRect(); // (a reflow: restarts its animation)
      el.toast.classList.add('is-in');
      this.toastTime = TOAST_TIME;
    } else if (this.toastTime <= 0 && !el.toast.hidden) {
      el.toast.hidden = true;
    }

    this.set('banner', crime.state, (state) => {
      el.banner.hidden = state === 'play';
      el.banner.textContent = state === 'wasted' ? 'Wasted' : state === 'busted' ? 'Busted' : '';
      el.banner.classList.toggle('is-busted', state === 'busted');
      document.body.classList.toggle('is-down', state !== 'play');
    });
    this.set('hurt', Math.round(crime.hurtFlash * 20) / 20, (k) => { el.vignette.style.opacity = String(Math.min(0.85, k)); });
  }
}

export { CrimeHud };
