// js/app/resolution.ts
// The phone's render resolution, following the frame rate: a phone heats up and slows down after a few minutes of
// play, and its GPU has a few times less to give than a computer's (app/quality.ts), so the 'low' tier draws fewer
// pixels while the frames come slower than 60 a second, and more (a sharper picture on a 3x screen) while they keep
// up with it. The game's other costs don't move with the pixels: this only takes up the slack the GPU has or hasn't.
// Three-free: node --test imports it as it is.

/** The span the pixel ratio moves in (app/quality.ts) */
export interface ResolutionRange {
  /** the lowest pixel ratio it falls to (CSS px → device px) */
  min: number;
  /** the highest it climbs to (capped by the screen's own, devicePixelRatio) */
  max: number;
}

const WINDOW = 1; // s of frames each judgement is made on
const STEP = 0.1; // the pixel ratio's step up or down
// The frame rate aimed at: a phone's Safari shows 60 a second (a 120 Hz screen only keeps stepping up while above it)
const SLOW = 51; // fps below which a step down
const VERY_SLOW = 36; // ...and below which two
const FAST = 57; // fps at or above which the frames keep up: room to step up
const FAST_WINDOWS = 4; // windows in a row that must keep up before a step up
const BACK_OFF = 30; // s a ratio that had to be stepped down from is not tried again
const HITCH = 0.25; // s: a frame this long is a stall (a tab hidden, a tile laid, a shader built), not the GPU's pace

export class ResolutionGovernor {
  readonly min: number;
  readonly max: number;
  /** the pixel ratio now */
  ratio: number;
  private time = 0; // s in the current window
  private frames = 0;
  private fastRun = 0; // windows in a row that kept up
  private ceiling: number; // a ratio known too heavy, banned until ceilingUntil
  private ceilingUntil = 0; // s, on the governor's clock
  private clock = 0; // s

  constructor({ min, max }: ResolutionRange, start = 1) {
    this.min = min;
    this.max = Math.max(min, max);
    this.ratio = Math.min(this.max, Math.max(this.min, start));
    this.ceiling = this.max;
  }

  /** One frame of `dt` seconds (wall time). Returns the new pixel ratio when it changes, else 0. */
  update(dt: number): number {
    if (!(dt > 0) || dt > HITCH) {
      // (a stall says nothing of the GPU: the window starts again)
      this.time = 0;
      this.frames = 0;
      return 0;
    }
    this.clock += dt;
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW) return 0;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    if (this.clock > this.ceilingUntil) this.ceiling = this.max;

    let next = this.ratio;
    if (fps < SLOW) {
      next = this.ratio - (fps < VERY_SLOW ? 2 * STEP : STEP);
      // (what had to be stepped down from isn't tried again for a while: no see-sawing round a heavy view)
      this.ceiling = Math.min(this.ceiling, this.ratio - STEP);
      this.ceilingUntil = this.clock + BACK_OFF;
      this.fastRun = 0;
    } else if (fps >= FAST) {
      if (++this.fastRun >= FAST_WINDOWS) {
        next = this.ratio + STEP;
        this.fastRun = 0;
      }
    } else {
      this.fastRun = 0;
    }
    next = Math.round(Math.max(this.min, Math.min(this.ceiling, this.max, next)) * 100) / 100;
    if (next === this.ratio) return 0;
    this.ratio = next;
    return next;
  }
}
