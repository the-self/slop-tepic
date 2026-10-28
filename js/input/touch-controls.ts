// js/input/touch-controls.ts
// Touch input stays separate from the keyboard, so releasing a finger never releases a held key.
import type { PlayerMode, ThirdPersonControllerManager } from '../player/controllers.ts';
import { setLabel, setText } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';

/** What the touch controls drive of the controllers (player/controllers.ts) */
export type TouchTarget = Pick<ThirdPersonControllerManager, 'activeMode' | 'setTouchInput' | 'clearTouchInput'>;
/** The on-screen buttons' actions (index.html data-touch-action) */
type TouchAction = 'boost' | 'up' | 'down' | 'fire';
interface HeldButton {
  button: HTMLElement;
  action: TouchAction;
}

// What each button says in each mode (in the car the up button is its handbrake, see updateButton)
const TOUCH_LABELS: Readonly<Record<PlayerMode, Readonly<Record<TouchAction, MessageKey>>>> = {
  person: { boost: 'touch.sprint', up: 'touch.jump', down: 'touch.descend', fire: 'touch.fire' },
  cyclist: { boost: 'touch.sprint', up: 'touch.jump', down: 'touch.descend', fire: 'touch.fire' },
  car: { boost: 'touch.nitro', up: 'touch.handbrake', down: 'touch.descend', fire: 'touch.fire' },
  moto: { boost: 'touch.nitro', up: 'touch.jump', down: 'touch.descend', fire: 'touch.fire' },
  helicopter: { boost: 'touch.boost', up: 'touch.ascend', down: 'touch.descend', fire: 'touch.fire' }
};

const DEAD_ZONE = 0.15;
const MAX_RADIUS = 44;
/**
 * The media query of a touch screen: what shows these controls, and what gets the phone's graphics tier
 * (app/install/boot.ts). The primary pointer's (not any-pointer: a laptop with a touch screen has its trackpad first,
 * and keeps the keys' hints, the Keys tab and the full tier; a touch on it still brings the controls up, touchSeen)
 */
const TOUCH_SCREEN = '(pointer: coarse)';

class TouchControls {
  controller: TouchTarget;
  root: HTMLElement | null;
  stick: HTMLElement | null;
  knob: HTMLElement | null;
  buttons: HTMLElement[];
  buttonPointers: Map<number, HeldButton>;
  stickPointer: number | null;
  stickCenter?: { x: number; y: number }; // px, the stick's middle on the screen (set as a finger takes it)
  stickRadius?: number; // px
  enabled: boolean;
  available: boolean;
  touchSeen: boolean;
  onAvailabilityChange: ((available: boolean) => void) | null;
  media: MediaQueryList;
  mode?: PlayerMode;

  constructor(controllerManager: TouchTarget) {
    this.controller = controllerManager;
    this.root = document.getElementById('touch-controls');
    this.stick = document.getElementById('touch-stick');
    this.knob = document.getElementById('touch-stick-knob');
    this.buttons = this.root ? [...this.root.querySelectorAll<HTMLElement>('[data-touch-action]')] : [];
    this.buttonPointers = new Map();
    this.stickPointer = null;
    this.enabled = true;
    this.available = false;
    this.touchSeen = false;
    this.onAvailabilityChange = null;
    this.media = window.matchMedia(TOUCH_SCREEN);

    const { stick } = this;
    if (!this.root || !stick || !this.knob) return;

    stick.addEventListener('pointerdown', (event) => {
      if (!this.canInteract() || event.button !== 0 || this.stickPointer !== null || this.buttonPointers.has(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = stick.getBoundingClientRect();
      this.stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stickRadius = Math.min(MAX_RADIUS, Math.min(rect.width, rect.height) / 2) || MAX_RADIUS;
      this.stickPointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      stick.classList.add('is-pressed');
      this.moveStick(event);
    });
    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveStick(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      stick.addEventListener(type, (event) => { this.releaseStick(event.pointerId); });
    }

    for (const button of this.buttons) {
      // (the buttons are those with the attribute, index.html gives them these)
      const action = button.getAttribute('data-touch-action') as TouchAction;
      button.addEventListener('pointerdown', (event) => {
        if (!this.canInteract() || button.hidden || event.button !== 0 || this.buttonPointers.has(event.pointerId) || event.pointerId === this.stickPointer) return;
        event.preventDefault();
        event.stopPropagation();
        this.buttonPointers.set(event.pointerId, { button, action });
        button.setPointerCapture(event.pointerId);
        this.updateButton(button, action);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(type, (event) => { this.releaseButton(event.pointerId); });
      }
    }

    this.media.addEventListener('change', () => { this.updateAvailability(); });
    // Hybrid devices can report a fine pointer until their first touch. Capture runs before the control handlers.
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || this.touchSeen) return;
      this.touchSeen = true;
      this.updateAvailability();
    }, { capture: true, passive: true });
    window.addEventListener('blur', () => { this.reset(); });
    window.addEventListener('resize', () => { this.reset(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this.setMode(controllerManager.activeMode);
    this.updateAvailability();
  }

  canInteract(): boolean {
    return this.enabled && this.available && !document.hidden;
  }

  updateAvailability(): void {
    const available = this.media.matches || this.touchSeen;
    const changed = available !== this.available;
    if (changed) this.reset();
    this.available = available;
    document.body.classList.toggle('touch-enabled', available);
    if (this.root) this.root.hidden = !this.enabled || !available;
    if (changed && typeof this.onAvailabilityChange === 'function') this.onAvailabilityChange(available);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.enabled) this.reset();
    if (this.root) this.root.hidden = !this.enabled || !this.available;
  }

  setMode(mode: PlayerMode): void {
    if (!['person', 'car', 'cyclist', 'helicopter', 'moto'].includes(mode)) return;
    this.reset();
    if (!this.root) return;
    this.mode = mode;
    const labels = TOUCH_LABELS[mode];
    for (const button of this.buttons) {
      const action = button.getAttribute('data-touch-action') as TouchAction;
      button.hidden = (action === 'up' && (mode === 'cyclist' || mode === 'moto')) || (action === 'down' && mode !== 'helicopter') ||
        (action === 'fire' && mode === 'helicopter'); // (no guns from the helicopter, crime.ts)
      setLabel(button, labels[action]);
      const label = this.root.querySelector<HTMLElement>(`[data-touch-label="${action}"]`);
      if (label) setText(label, labels[action]);
    }
  }

  moveStick(event: PointerEvent): void {
    if (!this.stickCenter || this.stickRadius === undefined || !this.knob) return; // (only once a finger took the stick)
    const dx = event.clientX - this.stickCenter.x;
    const dy = event.clientY - this.stickCenter.y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.min(distance / this.stickRadius, 1);
    const strength = Math.max(0, (reach - DEAD_ZONE) / (1 - DEAD_ZONE));
    const x = distance ? dx / distance : 0;
    const y = distance ? dy / distance : 0;
    this.knob.style.setProperty('--stick-x', `${x * reach * this.stickRadius}px`);
    this.knob.style.setProperty('--stick-y', `${y * reach * this.stickRadius}px`);
    this.controller.setTouchInput('left', Math.max(0, -x * strength));
    this.controller.setTouchInput('right', Math.max(0, x * strength));
    this.controller.setTouchInput('forward', Math.max(0, -y * strength));
    this.controller.setTouchInput('backward', Math.max(0, y * strength));
  }

  releaseCapture(element: HTMLElement, pointerId: number): void {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  releaseStick(pointerId: number | null): void {
    if (pointerId !== this.stickPointer || pointerId === null || !this.stick || !this.knob) return;
    this.stickPointer = null;
    this.releaseCapture(this.stick, pointerId);
    this.stick.classList.remove('is-pressed');
    this.knob.style.setProperty('--stick-x', '0px');
    this.knob.style.setProperty('--stick-y', '0px');
    for (const action of ['forward', 'backward', 'left', 'right'] as const) this.controller.setTouchInput(action, 0);
  }

  updateButton(button: HTMLElement, action: TouchAction): void {
    const held = [...this.buttonPointers.values()];
    const pressed = held.some((pointer) => pointer.button === button);
    button.classList.toggle('is-pressed', pressed);
    button.setAttribute('aria-pressed', String(pressed));
    this.controller.setTouchInput(this.mode === 'car' && action === 'up' ? 'handbrake' : action, held.some((pointer) => pointer.action === action) ? 1 : 0);
  }

  releaseButton(pointerId: number): void {
    const pointer = this.buttonPointers.get(pointerId);
    if (!pointer) return;
    this.buttonPointers.delete(pointerId);
    this.releaseCapture(pointer.button, pointerId);
    this.updateButton(pointer.button, pointer.action);
  }

  reset(): void {
    this.releaseStick(this.stickPointer);
    for (const pointerId of this.buttonPointers.keys()) this.releaseButton(pointerId);
    for (const button of this.buttons) {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
    this.controller.clearTouchInput();
  }
}

export { TouchControls, TOUCH_SCREEN };
