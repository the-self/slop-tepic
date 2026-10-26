// js/player/aim.ts
// Free aim on foot, GTA-style: hold the right mouse button (or press Z to toggle it, for a trackpad) and the camera
// comes in over the player's right shoulder (cameras.ts) with a crosshair in the middle of the screen. The mouse turns
// the player and tilts the aim (pointer lock), the left button (or X) fires along the crosshair (crime.ts), and WASD
// walks and strafes (controllers.ts). The crosshair turns red over someone or something the shot would hit.
// The pointer stays locked after (the mouse goes on looking around, cameras.ts), and on foot the left button fires
// from the hip then, at whoever is ahead (crime.ts' lock-on).
// No three.js: only the DOM, the controllers' person entity and its keys.

import type { ThirdPersonControllerManager } from './controllers.ts';

/** What the aim uses of the game's canvas: some browsers have no pointer lock, or a requestPointerLock returning nothing */
export interface AimCanvas extends EventTarget {
  requestPointerLock?: () => Promise<void> | undefined;
}
/** ...and of the document (the body may be missing before it is parsed, exitPointerLock in an old browser) */
export type AimDocument = Pick<Document, 'addEventListener' | 'hidden' | 'pointerLockElement' | 'getElementById'> & {
  body: HTMLElement | null;
  exitPointerLock?: () => void;
};
/** ...and of the controllers (player/controllers.ts): the mode, the person's heading, and its aiming flag */
export type AimControllers = Pick<ThirdPersonControllerManager, 'activeMode' | 'entities' | 'aiming'>;

export interface AimOptions {
  canvas: AimCanvas; // the game's, which takes the pointer lock
  controllers: AimControllers;
  doc?: AimDocument;
}

const SENSITIVITY = 0.0024; // rad per pixel of mouse movement
const PITCH_MIN = -0.85; // rad, looking down at the street
const PITCH_MAX = 0.7; // rad, looking up at the rooftops
const BLEND_RATE = 14; // 1/s: how fast the shoulder view comes in and goes

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

class AimControl {
  canvas: AimCanvas;
  controllers: AimControllers;
  doc: AimDocument;
  held: boolean;
  toggled: boolean;
  active: boolean;
  fire: boolean;
  pitch: number;
  blend: number;
  onTarget: boolean;
  allowed: boolean;
  crosshair: HTMLElement | null;
  shown: { visible: boolean | null; target: boolean | null };

  constructor({ canvas, controllers, doc = document }: AimOptions) {
    this.canvas = canvas;
    this.controllers = controllers;
    this.doc = doc;
    this.held = false; // the right button is down
    this.toggled = false; // Z
    this.active = false;
    this.fire = false; // the left button, while aiming
    this.pitch = 0; // rad, up positive
    this.blend = 0; // 0..1 into the shoulder view
    this.onTarget = false; // (crime.ts: the shot would hit someone or a vehicle)
    this.allowed = true; // on foot and in play (main.ts, every frame)
    this.crosshair = doc.getElementById('hud-crosshair');
    this.shown = { visible: null, target: null };
    this.bind();
  }

  bind(): void {
    const canvas = this.canvas;
    const doc = this.doc;
    const onFoot = () => this.controllers.activeMode === 'person' && this.allowed;
    // a left click aiming, or on foot with the pointer locked, is a shot
    const shot = () => this.active || (onFoot() && doc.pointerLockElement === canvas);
    // (in the capture phase, ahead of the camera's own drag)
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || (e.target !== canvas && doc.pointerLockElement !== canvas)) return;
      if (e.button === 2) {
        this.held = true;
        if (onFoot()) this.lock();
      } else if (e.button === 0 && shot()) {
        this.fire = true;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
    // (some browsers send the second button's press as a chorded pointermove instead of a pointerdown)
    window.addEventListener('mousedown', (e) => {
      if (e.target !== canvas && doc.pointerLockElement !== canvas) return;
      if (e.button === 2 && !this.held) {
        this.held = true;
        if (onFoot()) this.lock();
      } else if (e.button === 0 && shot()) {
        this.fire = true;
      }
    }, true);
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.held = false;
      if (e.button === 0) this.fire = false;
    });
    window.addEventListener('blur', () => { this.release(); });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) this.release();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyZ' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      this.toggled = !this.toggled;
      if (this.toggled && onFoot()) this.lock();
    });
    // Esc lets go of the pointer: that ends a toggled aim too (a held one ends with the button)
    doc.addEventListener('pointerlockchange', () => {
      if (doc.pointerLockElement !== canvas) this.toggled = false;
    });
    doc.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      const p = this.controllers.entities.person;
      p.heading -= (e.movementX || 0) * SENSITIVITY;
      this.pitch = clamp(this.pitch - (e.movementY || 0) * SENSITIVITY, PITCH_MIN, PITCH_MAX);
    });
  }

  // The pointer locked to the canvas, so the mouse turns without a cursor running off the screen (it needs the press
  // that asked for it; where it is refused the mouse still turns while it moves)
  lock(): void {
    const canvas = this.canvas;
    if (!canvas.requestPointerLock || this.doc.pointerLockElement === canvas) return;
    try {
      const pending = canvas.requestPointerLock();
      pending?.catch(() => { /* (refused: as below) */ });
    } catch {
      // (refused: an embedded page, or too soon after Esc)
    }
  }

  release(): void {
    this.held = false;
    this.toggled = false;
    this.fire = false;
  }

  // Every frame, before the camera: whether the player is aiming, the shoulder view eased in or out, the crosshair
  update(dt: number): void {
    const onFoot = this.controllers.activeMode === 'person' && this.allowed;
    if (!onFoot) this.toggled = false;
    const was = this.active;
    this.active = onFoot && (this.held || this.toggled);
    if (this.active && !was) this.pitch = 0;
    // (letting go of the aim lets go of the trigger too; the hip's is the left button held on foot)
    if (!onFoot || (was && !this.active)) this.fire = false;
    this.controllers.aiming = this.active;
    this.blend += ((this.active ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * BLEND_RATE));
    if (!this.active && this.blend < 0.002) this.blend = 0;

    const visible = this.active && this.blend > 0.4;
    const target = visible && this.onTarget;
    if (this.shown.visible !== visible) {
      this.shown.visible = visible;
      if (this.crosshair) this.crosshair.hidden = !visible;
      this.doc.body?.classList.toggle('is-aiming', visible);
    }
    if (this.shown.target !== target) {
      this.shown.target = target;
      this.crosshair?.classList.toggle('is-target', target);
    }
  }
}

// (the key's target may be any EventTarget: an element being typed in has these)
function isTyping(e: Event): boolean {
  const t = e.target;
  if (!t) return false;
  if ('isContentEditable' in t && t.isContentEditable) return true;
  return 'tagName' in t && typeof t.tagName === 'string' && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export { AimControl, PITCH_MIN, PITCH_MAX };
