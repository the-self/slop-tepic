// js/app/loading.ts
// The loading screen: its status line, and its bar, which sweeps while the city is built (the main thread is busy) and
// fills as the shaders compile. It also keeps the start-up phase timings, logged once as "[init] ..." when the first
// frame is on screen, to keep load-time regressions traceable.

export class LoadingScreen {
  private readonly overlay = document.getElementById('loading-overlay');
  private readonly statusLine = document.getElementById('loading-status');
  private readonly fill = document.getElementById('loading-progress');
  private readonly track = this.overlay?.querySelector('.loader-track') ?? null;
  private readonly timings: string[] = [];
  private lastMark = performance.now();

  /** Shows what is being done now */
  status(text: string): void {
    if (this.statusLine) this.statusLine.textContent = text;
  }

  /** Fills the bar to `p` (0..1), ending its sweep */
  progress(p: number): void {
    if (!this.fill) return;
    this.track?.classList.remove('is-indeterminate');
    this.fill.style.transform = `scaleX(${Math.min(1, Math.max(0, p))})`;
  }

  /** Ends a start-up phase: `label` and the ms since the previous mark go into the timings */
  mark(label: string): void {
    const now = performance.now();
    this.timings.push(`${label} ${Math.round(now - this.lastMark)}ms`);
    this.lastMark = now;
  }

  /** Logs the timings and takes the screen down (the city is on screen) */
  done(): void {
    console.info(`[init] ${this.timings.join(', ')}`);
    this.timings.length = 0;
    this.overlay?.classList.add('hidden');
  }
}
