// js/ui/tachometer.ts
// The car's instrument cluster in the HUD, shown only while driving (css: body[data-mode='car']): a rev counter dial
// with its red zone at the engine's redline (drivetrain.ts), the gear in its centre, the speed in km/h, the gearbox
// (automatic or manual), the nitro left and the engine's health. Built with createElementNS & textContent only.

import type { DriveState } from '../player/drivetrain.ts';

/** What the dial reads of an engine (player/drivetrain.ts DriveSpec): redline in rpm */
export interface TachoSpec {
  name: string;
  redline: number;
  electric?: boolean;
  nitro?: boolean; // has a nitrous kit
}
/** What the dial reads of the drivetrain's running state: nitro 0..1 */
export type TachoDrive = Pick<DriveState, 'rpm' | 'gear' | 'manual' | 'nitro' | 'nitroOn' | 'limiter'>;

/** What the cluster last showed, so only a change touches the DOM */
interface TachoShown {
  angle: number;
  gear: string;
  speed: number;
  manual: string | null;
  nitro: number;
  health: number;
  limiter: boolean | null;
  shiftNow: boolean | null;
  nitroOn: boolean | null;
  dead: boolean | null;
  hurt: boolean | null;
}
type TachoFlag = 'limiter' | 'shiftNow' | 'nitroOn' | 'dead' | 'hurt';

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 148; // px, the dial's viewBox
const C = SIZE / 2;
const R = 62; // radius of the scale's arc
const SWEEP = 270; // degrees from 0 rpm (bottom left) to the top of the scale (bottom right)

// Angle in degrees clockwise from 12 o'clock for `rpm` on a scale up to `max`
const angleOf = (rpm: number, max: number) => -SWEEP / 2 + SWEEP * Math.max(0, Math.min(1, rpm / max));
const point = (deg: number, r: number): [x: number, y: number] => {
  const a = deg * Math.PI / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};

function el(name: string, attrs: Record<string, string | number> = {}, parent: Element | null = null): SVGElement {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

class Tachometer {
  root: HTMLElement | null; // null: no cluster in the page, and nothing to do
  specName: string;
  shown: TachoShown;
  // the engine's scale (setSpec): NaN till the first spec, as the readings that use them
  electric: boolean;
  max: number; // rpm at the top of the scale
  redline: number; // rpm
  shiftPoint: number; // rpm the manual's shift light comes on
  dial: SVGElement;
  scale: SVGElement;
  needle: SVGElement;
  gear: SVGElement;
  speed: SVGElement;
  side: HTMLDivElement;
  box: HTMLSpanElement;
  nitroBar: HTMLSpanElement;
  healthBar: HTMLSpanElement;
  warning: HTMLSpanElement;

  constructor(root: HTMLElement | null) {
    this.root = root;
    this.specName = '';
    this.shown = { angle: NaN, gear: '', speed: -1, manual: null, nitro: -1, health: -1, limiter: null, shiftNow: null, nitroOn: null, dead: null, hurt: null };
    this.electric = false;
    this.max = NaN;
    this.redline = NaN;
    this.shiftPoint = NaN;
    // (the parts are built even without a root, so they always exist; they go on the page only with one)
    this.dial = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'tacho-dial', 'aria-hidden': 'true' });
    this.scale = el('g', {}, this.dial);
    this.needle = el('g', { class: 'tacho-needle' }, this.dial);
    el('path', { d: `M ${C - 2.2} ${C + 10} L ${C} ${C - R + 8} L ${C + 2.2} ${C + 10} Z` }, this.needle);
    el('circle', { cx: C, cy: C, r: 24, class: 'tacho-hub' }, this.dial);
    this.gear = el('text', { x: C, y: C + 9, class: 'tacho-gear', 'text-anchor': 'middle' }, this.dial);
    this.speed = el('text', { x: C, y: C + 44, class: 'tacho-speed', 'text-anchor': 'middle' }, this.dial);
    el('text', { x: C, y: C + 56, class: 'tacho-unit', 'text-anchor': 'middle' }, this.dial).textContent = 'km/h';

    this.side = document.createElement('div');
    this.side.className = 'tacho-side';
    this.box = document.createElement('span');
    this.box.className = 'tacho-box';
    this.side.appendChild(this.box);
    this.nitroBar = this.bar('Nitro', 'tacho-nitro');
    this.healthBar = this.bar('Engine', 'tacho-health');
    this.warning = document.createElement('span');
    this.warning.className = 'tacho-warning';
    this.warning.textContent = 'Engine dead · F to get out';
    this.side.appendChild(this.warning);
    if (root) root.replaceChildren(this.dial, this.side);
  }

  bar(label: string, cls: string): HTMLSpanElement {
    const wrap = document.createElement('div');
    wrap.className = `tacho-bar ${cls}`;
    const name = document.createElement('span');
    name.className = 'tacho-bar-label';
    name.textContent = label;
    const track = document.createElement('span');
    track.className = 'tacho-track';
    const fill = document.createElement('span');
    fill.className = 'tacho-fill';
    track.appendChild(fill);
    wrap.append(name, track);
    this.side.appendChild(wrap);
    return fill;
  }

  // The scale for this engine: a tick every 500 rpm, numbered every 1000, red from its redline (an electric motor's
  // scale runs to ~18000: every 2000, and no red zone)
  setSpec(spec: TachoSpec): void {
    if (!this.root || spec.name === this.specName) return;
    this.specName = spec.name;
    this.electric = Boolean(spec.electric);
    const major = spec.redline > 10000 ? 2000 : 1000;
    this.max = Math.ceil((spec.redline + (this.electric ? 0 : 600)) / major) * major;
    this.redline = spec.redline;
    this.shiftPoint = spec.redline * 0.93;
    // (the nitro's gauge only on a car that has a kit)
    const nitroGauge = this.nitroBar.parentElement?.parentElement;
    if (nitroGauge) nitroGauge.hidden = !spec.nitro;
    const g = this.scale;
    g.replaceChildren();
    el('path', { d: arc(-SWEEP / 2, SWEEP / 2, R), class: 'tacho-arc' }, g);
    if (!this.electric) el('path', { d: arc(angleOf(spec.redline, this.max), SWEEP / 2, R - 3), class: 'tacho-red' }, g);
    for (let rpm = 0; rpm <= this.max; rpm += major / 2) {
      const majorTick = rpm % major === 0;
      const deg = angleOf(rpm, this.max);
      const [x1, y1] = point(deg, R);
      const [x2, y2] = point(deg, R - (majorTick ? 9 : 5));
      el('line', { x1, y1, x2, y2, class: `tacho-tick${majorTick ? ' major' : ''}${!this.electric && rpm >= spec.redline ? ' red' : ''}` }, g);
      if (majorTick) {
        const [tx, ty] = point(deg, R - 18);
        el('text', { x: tx, y: ty + 3.5, class: 'tacho-num', 'text-anchor': 'middle' }, g).textContent = String(rpm / 1000);
      }
    }
    this.shown.angle = NaN;
  }

  // Every frame while driving: only what changed touches the DOM
  update(spec: TachoSpec, drive: TachoDrive | null | undefined, kmh: number, health: number, dead: boolean, gear: string): void {
    const root = this.root;
    if (!root || !drive) return;
    this.setSpec(spec);
    const s = this.shown;
    const angle = Math.round(angleOf(drive.rpm, this.max) * 2) / 2;
    if (angle !== s.angle) {
      s.angle = angle;
      this.needle.setAttribute('transform', `rotate(${angle} ${C} ${C})`);
    }
    if (gear !== s.gear) s.gear = this.gear.textContent = gear;
    if (kmh !== s.speed) this.speed.textContent = String((s.speed = kmh));
    const box = this.electric ? 'EV' : drive.manual ? 'Manual' : 'Auto';
    if (box !== s.manual) this.box.textContent = s.manual = box;
    const nitro = Math.round(drive.nitro * 100);
    if (nitro !== s.nitro) this.nitroBar.style.transform = `scaleX(${(s.nitro = nitro) / 100})`;
    const hp = Math.round(health * 100);
    if (hp !== s.health) this.healthBar.style.transform = `scaleX(${(s.health = hp) / 100})`;
    const toggle = (key: TachoFlag, cls: string, on: boolean) => {
      if (on === s[key]) return;
      s[key] = on;
      root.classList.toggle(cls, on);
    };
    toggle('limiter', 'is-limiter', drive.limiter);
    toggle('shiftNow', 'is-shift', drive.manual && drive.gear > 0 && drive.rpm > this.shiftPoint);
    toggle('nitroOn', 'is-nitro', drive.nitroOn);
    toggle('dead', 'is-dead', dead);
    toggle('hurt', 'is-hurt', health < 0.35);
  }
}

export { Tachometer, angleOf };
