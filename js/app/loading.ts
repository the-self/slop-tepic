// js/app/loading.ts
// The loading screen: its status line, and its bar, which sweeps while the city is built (the main thread is busy) and
// fills as the shaders compile, with its percentage; a tip that changes every few seconds, and the language switch.
// It also keeps the start-up phase timings, logged once as "[init] ..." when the first frame is on screen, to keep
// load-time regressions traceable.
import { cycleLocale, onLocaleChange, t } from '../i18n/i18n.ts';
import type { MessageKey, MessageParams } from '../i18n/i18n.ts';

const TIPS: readonly MessageKey[] = ['tip.1', 'tip.2', 'tip.3', 'tip.4', 'tip.5', 'tip.6', 'tip.7', 'tip.8'];
const TIP_TIME = 6500; // ms each tip stays
const TIP_FADE = 350; // ms: the tip's fade out (style.css .loader-tip p), before the next comes in

export class LoadingScreen {
  private readonly overlay = document.getElementById('loading-overlay');
  private readonly statusLine = document.getElementById('loading-status');
  private readonly percent = document.getElementById('loading-percent');
  private readonly fill = document.getElementById('loading-progress');
  private readonly tipLine = document.getElementById('loading-tip');
  private readonly track = this.overlay?.querySelector('.loader-track') ?? null;
  private readonly timings: string[] = [];
  private lastMark = performance.now();
  private statusKey: MessageKey = 'loading.start';
  private statusParams: MessageParams | undefined;
  private tip = Math.floor(Math.random() * TIPS.length);
  private readonly tipTimer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;

  constructor() {
    document.getElementById('loader-lang')?.addEventListener('click', cycleLocale);
    this.unsubscribe = onLocaleChange(() => {
      this.status(this.statusKey, this.statusParams);
      this.showTip();
    });
    this.showTip();
    this.tipTimer = setInterval(() => { this.nextTip(); }, TIP_TIME);
  }

  /** Shows what is being done now: `key`'s text, its placeholders filled from `params` */
  status(key: MessageKey, params?: MessageParams): void {
    this.statusKey = key;
    this.statusParams = params;
    if (this.statusLine) this.statusLine.textContent = t(key, params);
  }

  /** Fills the bar to `p` (0..1), ending its sweep */
  progress(p: number): void {
    if (!this.fill) return;
    const share = Math.min(1, Math.max(0, p));
    this.track?.classList.remove('is-indeterminate');
    this.fill.style.transform = `scaleX(${share})`;
    if (this.percent) this.percent.textContent = `${Math.round(share * 100)}%`;
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
    clearInterval(this.tipTimer);
    this.unsubscribe();
    this.overlay?.classList.add('hidden');
  }

  private showTip(): void {
    if (this.tipLine) this.tipLine.textContent = t(TIPS[this.tip % TIPS.length]);
  }

  // Fades the tip out, then the next one in
  private nextTip(): void {
    this.tip++;
    const line = this.tipLine;
    if (!line) return;
    line.classList.add('is-changing');
    setTimeout(() => {
      this.showTip();
      line.classList.remove('is-changing');
    }, TIP_FADE);
  }
}
