// js/ui/weapon-wheel.ts
// The weapon wheel, GTA-style, and the quick switch. Hold Tab (or LB on a gamepad, or tap the weapon on the HUD) and
// the arsenal (sim/weapons.ts) opens round the middle of the screen, one wedge per weapon with its 3D picture
// (ui/weapon-icons.ts) and its rounds; the one pointed at turns in the middle, with its name and its bars. Move the mouse
// (or the right stick) towards a wedge, or scroll, and let go of Tab, or click it, to take it in hand; Esc closes it as
// it was. The game runs slowed while it is open (main.ts scales the frame by timeScale).
// Closed, the mouse wheel on foot switches to the next or previous weapon with rounds (as do R and the d-pad), and a
// strip of the arsenal shows under the HUD for a moment whenever the weapon in hand changes.
// Safe DOM APIs only; text changes only when the rounds do.

import { WEAPONS, WEAPON_ORDER, weaponStats } from '../sim/weapons.ts';
import type { Arsenal, WeaponId, WeaponStats } from '../sim/weapons.ts';
import type { WeaponIcons } from './weapon-icons.ts';

/** What the wheel uses of the CrimeSystem (sim/crime.ts) */
export interface WheelCrime {
  arsenal: Pick<Arsenal, 'current' | 'ammo' | 'has'>;
  state: string; // 'play' | 'wasted' | 'busted'
  selectWeapon(id: WeaponId): boolean; // false (and a message) without rounds
  cycleWeapon(dir?: number): void;
}

export interface WeaponWheelOptions {
  aim?: { release(): void } | null; // player/aim.ts: lets go of the pointer while choosing
  canvas?: HTMLElement | null; // the mouse wheel switches weapons over it…
  canScroll?: ((e: WheelEvent) => boolean) | null; // …while this says so
  doc?: Document;
}

/** A weapon's picture element and how to swap its flat symbol for the baked one */
interface Picture {
  el: HTMLSpanElement;
  set: (url: string | null) => void;
}
interface WheelSlot {
  wedge: SVGPathElement;
  rim: SVGPathElement;
  slot: HTMLDivElement;
  ammo: HTMLSpanElement;
  picture: Picture['set'];
}
interface StripTile {
  tile: HTMLDivElement;
  ammo: HTMLSpanElement;
  picture: Picture['set'];
}

const SVG = 'http://www.w3.org/2000/svg';
const SLOW = 0.25; // the game's speed while the wheel is open
const PICK_RADIUS = 28; // px the mouse moves from where the wheel opened before it picks a slot
const PULL_MAX = 140; // px: how far that pull is remembered (a turn the other way picks again at once)
const STICK_PICK = 0.55; // how far the right stick leans before it picks a slot
const HINT: Readonly<Record<WeaponId, string>> = { fists: '1', pistol: '2', smg: '3', rifle: '3', bazooka: '4' }; // (crime.ts's keys)
// the wheel's SVG, in its own units (viewBox -SIZE/2 .. SIZE/2): the wedges between R0 and R1, GAP degrees apart
const SIZE = 460;
const R0 = 100;
const R1 = 222;
const GAP = 1.4;
const SCROLL_STEP = 60; // deltaY (px) per weapon: one notch of a mouse wheel, a short swipe on a trackpad
const SCROLL_REST = 0.25; // s without scrolling before a part-swipe is forgotten
const SWITCH_GAP = 0.09; // s between weapons switched by scrolling (a trackpad's swipe runs on: one at a time)
const STRIP_TIME = 1.6; // s the quick-switch strip stays
const SPIN_FPS = 12;
const STATS: readonly (readonly [keyof WeaponStats, string])[] = [['damage', 'Damage'], ['rate', 'Fire rate'], ['range', 'Range'], ['accuracy', 'Accuracy']];

// The slot (0 at the top, clockwise) a pull of (dx, dy) screen px points at, of n
function slotAt(dx: number, dy: number, n: number): number {
  const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1; // (0 at the top, clockwise; screen y runs down)
  return Math.round(turn * n) % n;
}

// The SVG path of slot i's wedge of n: the ring between r0 and r1, centred on its direction, gap degrees from the next
function wedgePath(i: number, n: number, r0: number, r1: number, gap: number): string {
  const half = (Math.PI / n) - (gap * Math.PI) / 360;
  const mid = (i / n) * Math.PI * 2;
  const pt = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
  const a0 = mid - half;
  const a1 = mid + half;
  const large = half * 2 > Math.PI ? 1 : 0;
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}

const roundsText = (rounds: number) => (rounds === Infinity ? '' : String(rounds));

class WeaponWheel {
  crime: WheelCrime;
  aim: { release(): void } | null;
  doc: Document;
  root: HTMLElement | null; // null: no wheel in the page (index.html #weapon-wheel), and nothing to do
  stripEl: HTMLElement | null;
  isOpen: boolean;
  highlight: WeaponId | null; // weapon id the wheel points at
  pullX: number; // px the mouse moved since the wheel opened (capped at PULL_MAX)
  pullY: number;
  byKey: boolean;
  icons: WeaponIcons | null;
  slots: Map<WeaponId, WheelSlot>;
  shown: Map<WeaponId, string>; // the rounds each slot shows
  tiles: Map<WeaponId, StripTile>;
  held: WeaponId;
  quiet: boolean;
  stripUntil: number; // s (performance.now() / 1000)
  scroll: number; // deltaY px scrolled towards the next step
  scrollAt: number; // s
  scrollNext: number; // s
  spinFrame: number;
  spinId: WeaponId | null;
  // the middle of the wheel (put together by build())
  spin: HTMLCanvasElement;
  spinCtx: CanvasRenderingContext2D | null;
  centreName: HTMLDivElement;
  centreAmmo: HTMLDivElement;
  bars: Partial<Record<keyof WeaponStats, HTMLElement>>;

  /**
   * @param crime - the CrimeSystem (sim/crime.ts): its arsenal, selectWeapon(), cycleWeapon() and state
   * @param o - aim (player/aim.ts, optional: let go of the pointer while choosing), canvas (the mouse wheel
   *   switches weapons over it while canScroll(event) says so), doc
   */
  constructor(crime: WheelCrime, { aim = null, canvas = null, canScroll = null, doc = document }: WeaponWheelOptions = {}) {
    this.crime = crime;
    this.aim = aim;
    this.doc = doc;
    this.root = doc.getElementById('weapon-wheel');
    this.stripEl = doc.getElementById('weapon-strip');
    this.isOpen = false;
    this.highlight = null; // weapon id the wheel points at
    this.pullX = 0;
    this.pullY = 0;
    this.byKey = false; // opened with Tab (closes when it comes up) rather than a tap
    this.icons = null;
    this.slots = new Map();
    this.shown = new Map();
    this.tiles = new Map();
    this.held = crime.arsenal.current; // the weapon in hand last frame (a change shows the strip)
    this.quiet = false; // (a change made in the wheel, which doesn't need the strip)
    this.stripUntil = 0;
    this.scroll = 0;
    this.scrollAt = 0;
    this.scrollNext = 0;
    this.spinFrame = -1;
    this.spinId = null;
    this.spin = doc.createElement('canvas');
    this.spinCtx = null;
    this.centreName = doc.createElement('div');
    this.centreAmmo = doc.createElement('div');
    this.bars = {};
    if (!this.root) return;
    this.build();
    this.buildStrip();
    this.bind(canvas, canScroll);
  }

  get timeScale() {
    return this.isOpen ? SLOW : 1;
  }

  // The 3D pictures, once they are baked (ui/weapon-icons.ts)
  setIcons(icons: WeaponIcons): void {
    this.icons = icons;
    icons.onReady(() => {
      for (const [id, s] of this.slots) s.picture(icons.url(id));
      for (const [id, t] of this.tiles) t.picture(icons.url(id));
      this.spinFrame = -1;
    });
  }

  build(): void {
    const doc = this.doc;
    const root = this.root;
    if (!root) return;
    const ring = doc.createElement('div');
    ring.className = 'wheel-ring';
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'wheel-svg');
    svg.setAttribute('viewBox', `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`);
    const hub = doc.createElementNS(SVG, 'circle');
    hub.setAttribute('class', 'wheel-hub');
    hub.setAttribute('r', String(R0 - 6));
    svg.appendChild(hub);
    ring.appendChild(svg);
    const n = WEAPON_ORDER.length;
    WEAPON_ORDER.forEach((id, i) => {
      const w = WEAPONS[id];
      const wedge = doc.createElementNS(SVG, 'path');
      wedge.setAttribute('class', 'wheel-wedge');
      wedge.setAttribute('d', wedgePath(i, n, R0, R1, GAP));
      wedge.dataset.weapon = id;
      const rim = doc.createElementNS(SVG, 'path');
      rim.setAttribute('class', 'wheel-rim');
      rim.setAttribute('d', wedgePath(i, n, R1 - 5, R1, GAP));
      svg.append(wedge, rim);
      wedge.addEventListener('pointerenter', () => { this.point(id); });
      wedge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.point(id);
        this.close(true);
      });

      // its picture, rounds and key, over the middle of the wedge (as shares of the ring, so it scales with it)
      const a = (i / n) * Math.PI * 2;
      const r = (R0 + R1) / 2;
      const slot = doc.createElement('div');
      slot.className = 'wheel-slot';
      slot.style.left = `${50 + (Math.sin(a) * r * 100) / SIZE}%`;
      slot.style.top = `${50 - (Math.cos(a) * r * 100) / SIZE}%`;
      const picture = this.picture(id, 'wheel-icon');
      const ammo = doc.createElement('span');
      ammo.className = 'wheel-ammo';
      const label = doc.createElement('span');
      label.className = 'wheel-label';
      label.textContent = w.label;
      const key = doc.createElement('span');
      key.className = 'wheel-key';
      key.textContent = HINT[id] || '';
      slot.append(picture.el, label, ammo, key);
      ring.appendChild(slot);
      this.slots.set(id, { wedge, rim, slot, ammo, picture: picture.set });
    });

    // the middle: the weapon pointed at, turning, its name and rounds
    const centre = doc.createElement('div');
    centre.className = 'wheel-centre';
    this.spin.className = 'wheel-spin';
    this.spin.width = 256;
    this.spin.height = 128;
    this.spinCtx = this.spin.getContext('2d');
    this.centreName.className = 'wheel-centre-name';
    this.centreAmmo.className = 'wheel-centre-ammo';
    centre.append(this.spin, this.centreName, this.centreAmmo);
    ring.appendChild(centre);

    // its bars, under the wheel
    const stats = doc.createElement('div');
    stats.className = 'wheel-stats';
    for (const [key, text] of STATS) {
      const row = doc.createElement('div');
      row.className = 'wheel-stat';
      const label = doc.createElement('span');
      label.textContent = text;
      const bar = doc.createElement('span');
      bar.className = 'wheel-bar';
      const fill = doc.createElement('i');
      bar.appendChild(fill);
      row.append(label, bar);
      stats.appendChild(row);
      this.bars[key] = fill;
    }
    root.append(ring, stats);
    // a tap outside the wedges closes it as it was
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target === ring || e.target === svg) this.close(false);
    });
  }

  // A weapon's picture: its flat symbol (index.html) until the 3D one is baked
  picture(id: WeaponId, className: string): Picture {
    const doc = this.doc;
    const el = doc.createElement('span');
    el.className = className;
    const icon = doc.createElementNS(SVG, 'svg');
    icon.setAttribute('class', 'wheel-glyph');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 48 24');
    const use = doc.createElementNS(SVG, 'use');
    use.setAttribute('href', `#w-${id}`);
    icon.appendChild(use);
    el.appendChild(icon);
    const set = (url: string | null) => {
      if (!url) return;
      const img = doc.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      el.replaceChildren(img);
    };
    return { el, set };
  }

  // The strip of the arsenal that shows for a moment when the weapon changes
  buildStrip(): void {
    const strip = this.stripEl;
    if (!strip) return;
    for (const id of WEAPON_ORDER) {
      const tile = this.doc.createElement('div');
      tile.className = 'strip-tile';
      const picture = this.picture(id, 'strip-icon');
      const label = this.doc.createElement('span');
      label.className = 'strip-label';
      label.textContent = WEAPONS[id].label;
      const ammo = this.doc.createElement('span');
      ammo.className = 'strip-ammo';
      tile.append(picture.el, label, ammo);
      strip.appendChild(tile);
      this.tiles.set(id, { tile, ammo, picture: picture.set });
    }
  }

  bind(canvas: HTMLElement | null, canScroll: ((e: WheelEvent) => boolean) | null): void {
    const doc = this.doc;
    const root = this.root;
    if (!root) return;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Tab') {
        e.preventDefault(); // (not the browser's focus hopping)
        if (!e.repeat && !this.isOpen) this.open(true);
      } else if (e.code === 'Escape' && this.isOpen) {
        this.close(false);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && this.isOpen && this.byKey) this.close(true);
    });
    window.addEventListener('blur', () => {
      if (this.isOpen) this.close(false);
    });
    // the mouse's pull from where it was when the wheel opened points at a slot (it works the same with the pointer
    // locked or free)
    doc.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      this.pullX += e.movementX || 0;
      this.pullY += e.movementY || 0;
      const d = Math.hypot(this.pullX, this.pullY);
      if (d > PULL_MAX) {
        this.pullX *= PULL_MAX / d;
        this.pullY *= PULL_MAX / d;
      }
      if (d >= PICK_RADIUS) this.point(WEAPON_ORDER[slotAt(this.pullX, this.pullY, WEAPON_ORDER.length)]);
    });
    // scrolling: round the wheel while it is open, and on foot the next or previous weapon (canScroll says when)
    const onWheel = (e: WheelEvent) => {
      const open = this.isOpen;
      if (!open && !(canvas && e.currentTarget === canvas && canScroll?.(e))) return;
      e.preventDefault();
      const now = performance.now() * 0.001;
      if (now - this.scrollAt > SCROLL_REST) this.scroll = 0;
      this.scrollAt = now;
      // (lines or pages from some mice: as many notches)
      this.scroll += e.deltaMode ? Math.sign(e.deltaY) * SCROLL_STEP : e.deltaY;
      while (Math.abs(this.scroll) >= SCROLL_STEP) {
        const dir = Math.sign(this.scroll);
        this.scroll -= dir * SCROLL_STEP;
        if (open) {
          this.step(dir);
        } else {
          this.scroll = 0;
          if (now < this.scrollNext) break;
          this.scrollNext = now + SWITCH_GAP;
          this.crime.cycleWeapon(dir);
        }
      }
    };
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('wheel', onWheel, { passive: false });
    // the weapon on the HUD opens it too (a tap on a phone)
    doc.getElementById('hud-weapon')?.addEventListener('click', () => {
      if (this.isOpen) this.close(false);
      else this.open(false);
    });
  }

  open(byKey: boolean): void {
    if (!this.root || this.isOpen || this.crime.state !== 'play') return;
    this.isOpen = true;
    this.byKey = byKey;
    this.pullX = 0;
    this.pullY = 0;
    // (choosing needs the cursor: an aim lets go of it)
    if (this.aim) this.aim.release();
    if (this.doc.pointerLockElement) this.doc.exitPointerLock();
    this.highlight = null;
    this.point(this.crime.arsenal.current);
    this.refresh();
    this.hideStrip();
    this.root.hidden = false;
    this.root.classList.add('is-open');
    this.doc.body.classList.add('is-choosing-weapon');
  }

  // Closed, taking the weapon it points at in hand (`take`), or as it was
  close(take: boolean): void {
    if (!this.isOpen || !this.root) return; // (open only with a root)
    this.isOpen = false;
    this.root.classList.remove('is-open');
    this.root.hidden = true;
    this.doc.body.classList.remove('is-choosing-weapon');
    const id = this.highlight;
    if (take && id && id !== this.crime.arsenal.current && this.crime.selectWeapon(id)) this.quiet = true;
  }

  // The right stick (x right, y down, -1..1) leaning towards a slot while the wheel is open (gamepad-controls.ts)
  stick(x: number, y: number): void {
    if (!this.isOpen || Math.hypot(x, y) < STICK_PICK) return;
    this.point(WEAPON_ORDER[slotAt(x, y, WEAPON_ORDER.length)]);
  }

  // The next (dir 1, clockwise) or previous slot with rounds
  step(dir: number): void {
    const n = WEAPON_ORDER.length;
    let i = WEAPON_ORDER.indexOf(this.highlight ?? this.crime.arsenal.current);
    for (let k = 0; k < n; k++) {
      i = (i + (dir < 0 ? n - 1 : 1)) % n;
      if (this.crime.arsenal.has(WEAPON_ORDER[i])) {
        this.point(WEAPON_ORDER[i]);
        return;
      }
    }
  }

  point(id: WeaponId): void {
    if (!this.crime.arsenal.has(id)) return; // (an empty slot can't be chosen)
    if (this.highlight === id) return;
    this.highlight = id;
    for (const [key, s] of this.slots) {
      s.wedge.classList.toggle('is-pointed', key === id);
      s.rim.classList.toggle('is-pointed', key === id);
      s.slot.classList.toggle('is-pointed', key === id);
    }
    this.centreName.textContent = WEAPONS[id].label;
    this.centreAmmo.textContent = this.roundsLine(id);
    const stats = weaponStats(id);
    for (const [key] of STATS) {
      const bar = this.bars[key];
      if (bar && stats) bar.style.transform = `scaleX(${stats[key].toFixed(3)})`;
    }
    this.spinFrame = -1;
  }

  roundsLine(id: WeaponId): string {
    const rounds = this.crime.arsenal.ammo[id];
    return rounds === Infinity ? 'Melee' : `${rounds} rounds`;
  }

  // The slots' rounds and which are empty or in hand
  refresh(): void {
    const arsenal = this.crime.arsenal;
    for (const [id, s] of this.slots) {
      const text = roundsText(arsenal.ammo[id]);
      if (this.shown.get(id) !== text) {
        this.shown.set(id, text);
        s.ammo.textContent = text;
        if (id === this.highlight) this.centreAmmo.textContent = this.roundsLine(id);
      }
      const empty = !arsenal.has(id);
      s.wedge.classList.toggle('is-empty', empty);
      s.slot.classList.toggle('is-empty', empty);
      s.slot.classList.toggle('is-current', id === arsenal.current);
      s.wedge.classList.toggle('is-current', id === arsenal.current);
    }
  }

  // The strip: the weapons with rounds, the one in hand lit, for STRIP_TIME s
  showStrip(now: number): void {
    const strip = this.stripEl;
    if (!strip) return;
    const arsenal = this.crime.arsenal;
    for (const [id, t] of this.tiles) {
      t.tile.hidden = !arsenal.has(id);
      t.tile.classList.toggle('is-current', id === arsenal.current);
      t.ammo.textContent = roundsText(arsenal.ammo[id]);
    }
    strip.hidden = false;
    strip.classList.remove('is-in');
    void strip.getBoundingClientRect(); // (a reflow: restarts its animation)
    strip.classList.add('is-in');
    this.stripUntil = now + STRIP_TIME;
  }

  hideStrip(): void {
    if (this.stripEl && !this.stripEl.hidden) this.stripEl.hidden = true;
    this.stripUntil = 0;
  }

  // Every frame: the strip on a change of weapon, the wheel kept up with the rounds and its middle turning, and shut
  // when the player goes down
  update(): void {
    const now = performance.now() * 0.001;
    const current = this.crime.arsenal.current;
    if (current !== this.held) {
      this.held = current;
      if (!this.quiet && !this.isOpen && this.crime.state === 'play') this.showStrip(now);
    }
    this.quiet = false;
    if (this.stripUntil && now > this.stripUntil) this.hideStrip();
    if (!this.isOpen) return;
    if (this.crime.state !== 'play') {
      this.close(false);
      return;
    }
    this.refresh();
    const id = this.highlight;
    const f = Math.floor(now * SPIN_FPS) % (this.icons?.frames || 1);
    if (id && (f !== this.spinFrame || id !== this.spinId) && this.icons?.ready && this.spinCtx) {
      this.spinFrame = f;
      this.spinId = id;
      this.icons.drawSpin(this.spinCtx, id, f);
    }
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export { WeaponWheel, slotAt, wedgePath };
