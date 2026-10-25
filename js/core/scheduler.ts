// js/core/scheduler.ts
// The frame loop's systems, stepped in the order they were added. Every per-frame part of the game (the player, the
// traffic, the crime, the audio...) is one System; the loop builds the frame's FrameStep and runs them all, so the
// order they read each other's state in is written down in one place (app/frame-loop.ts) instead of being implied by
// a long list of calls. With ?debug it also times each system, for the console (__slop.scheduler.report()).

/** One frame's times, shared by every system (the same object every frame: read it, don't keep it). */
export interface FrameStep {
  /** s: the world's step, at most 0.05 s (below 20 fps the world runs slow rather than unstably), weapon-wheel slowed */
  dt: number;
  /** s: the player's step, real time down to 10 fps (at most 0.1 s), weapon-wheel slowed */
  frameDt: number;
  /** s: the wall time since the last frame, unclamped */
  rawDt: number;
  /** s: the world's time since the first frame (the sum of the dt) */
  elapsed: number;
  /** ms: the animation frame's timestamp (performance.now()'s clock) */
  now: number;
}

/** A part of the game that steps once a frame. */
export interface System {
  /** For the timings report */
  readonly name: string;
  update(step: Readonly<FrameStep>): void;
}

/** How long a system took, smoothed over the last frames */
export interface SystemTiming {
  readonly name: string;
  /** ms per frame, exponentially smoothed */
  readonly ms: number;
}

// Each frame's time weighs this much in the smoothed timing (about the last 30 frames)
const SMOOTHING = 1 / 30;

export class Scheduler {
  private readonly systems: System[] = [];
  private readonly smoothed: number[] = [];
  private readonly profile: boolean;

  constructor({ profile = false }: { profile?: boolean } = {}) {
    this.profile = profile;
  }

  /** Steps `system` after every system added before it */
  add(system: System): this {
    this.systems.push(system);
    this.smoothed.push(Number.NaN); // (until its first timed frame, which seeds the average)
    return this;
  }

  /** Shorthand for a system that is a function */
  run(name: string, update: (step: Readonly<FrameStep>) => void): this {
    return this.add({ name, update });
  }

  step(step: Readonly<FrameStep>): void {
    const { systems } = this;
    if (!this.profile) {
      for (const system of systems) system.update(step);
      return;
    }
    const { smoothed } = this;
    for (let i = 0; i < systems.length; i++) {
      const t0 = performance.now();
      systems[i]?.update(step);
      const ms = performance.now() - t0;
      const was = smoothed[i] ?? Number.NaN;
      smoothed[i] = Number.isNaN(was) ? ms : was + (ms - was) * SMOOTHING;
    }
  }

  /** The systems' smoothed timings, slowest first (only measured with { profile: true }) */
  report(): SystemTiming[] {
    return this.systems
      .map((system, i) => ({ name: system.name, ms: Math.round((this.smoothed[i] || 0) * 1000) / 1000 }))
      .sort((a, b) => b.ms - a.ms);
  }
}
