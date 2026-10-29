// js/audio/audio-ambience.ts
// The city's sounds that keep going where they are: the music of the antros and the house parties (cumbia, banda
// sinaloense, reggaetón), the taco stands' planchas sizzling, a fire's crackle & roar, a crowd's murmur; and the
// trains' (sim/trains.ts): a diesel's rumble, the wheels over the rail joints, the horn, a crossing's bell. Each is a
// loop synthesised once, the first time it is wanted (no audio files), and played through the spatial emitter of
// whatever source it belongs to (audio-system.ts, its `loops` pool), muffled by the walls in between like any other.

/** The loops there are: three kinds of music, a plancha, a fire, a crowd, and a train's four */
export type AmbienceKind = 'cumbia' | 'banda' | 'reggaeton' | 'sizzle' | 'fire' | 'crowd' | 'locomotive' | 'wheels' | 'horn' | 'bell';

/**
 * A sound that stays where it is this frame, handed to CityAudioSystem.setAmbience() (the street food, nightlife,
 * interiors and fires all make them): its place (m) and level, and the object it belongs to, whose voice it keeps
 */
export interface AmbientSource {
  kind: AmbienceKind;
  /** Whose sound it is: the same object frame after frame keeps the same voice playing */
  id: object;
  x: number;
  y: number;
  z: number;
  /** 0..1, 1 by default */
  gain?: number;
  /** m beyond which it isn't heard (120 by default) */
  range?: number;
  /** Where in the loop it starts */
  seed?: number;
  /** The audio writes its distance² to the listener here (m²), to pick the nearest */
  d2?: number;
}

/** The loops, each synthesised the first time it is wanted */
export interface AmbienceResources {
  buffer(kind: AmbienceKind): AudioBuffer | null;
}

export interface LoopVoice {
  /** `gain` 0..1 (1 by default) */
  update(params?: { gain?: number }, now?: number): void;
  dispose(): void;
}

/** A waveform over a 0..1 phase, `t` s into its note */
type Wave = (phase: number, t: number) => number;

const TAU = Math.PI * 2;

function random(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Stereo-less loop of `seconds`, filled by `render(out, rate)`, normalised to `peak` with its ends crossfaded so it
// loops without a click
function loopBuffer(ctx: BaseAudioContext, seconds: number, render: (out: Float32Array, rate: number) => void, peak = 0.7) {
  const rate = ctx.sampleRate;
  const n = Math.round(seconds * rate);
  const buffer = ctx.createBuffer(1, n, rate);
  const out = buffer.getChannelData(0);
  render(out, rate);
  const fade = Math.round(rate * 0.02);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = out[i] * t + out[n - fade + i] * (1 - t);
  }
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) for (let i = 0; i < n; i++) out[i] *= peak / max;
  return buffer;
}

// Adds a note to `out`: from `t0` s for `dur` s at `freq` Hz, `wave(phase)` (0..1 phase) under an attack/decay envelope
function note(out: Float32Array, rate: number, t0: number, dur: number, freq: number, gain: number, wave: Wave, attack = 0.005, release = 0.05) {
  const i0 = Math.max(0, Math.floor(t0 * rate));
  const i1 = Math.min(out.length, Math.floor((t0 + dur + release) * rate));
  let phase = 0;
  const step = freq / rate;
  for (let i = i0; i < i1; i++) {
    const t = i / rate - t0;
    const env = t < attack ? t / attack : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release);
    out[i] += wave(phase, t) * env * gain;
    phase += step;
    phase -= Math.floor(phase);
  }
}

const sine = (p: number) => Math.sin(p * TAU);
const saw = (p: number) => 2 * p - 1;
const square = (p: number) => (p < 0.5 ? 1 : -1);
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Drums: a kick (a falling sine), a snare / clap (noise & a tone), a hi-hat or the güiro's scrape (bright noise)
function kick(out: Float32Array, rate: number, t0: number, gain = 1) {
  const n = Math.floor(0.35 * rate), i0 = Math.floor(t0 * rate);
  let phase = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / rate;
    phase += (45 + 110 * Math.exp(-t * 30)) / rate;
    out[i0 + i] += Math.sin(phase * TAU) * Math.exp(-t * 9) * gain;
  }
}
function noiseHit(out: Float32Array, rate: number, t0: number, dur: number, gain: number, rnd: () => number, bright = 0.6, tone = 0) {
  const n = Math.floor(dur * rate), i0 = Math.floor(t0 * rate);
  let lp = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / rate;
    const w = rnd() * 2 - 1;
    lp += (w - lp) * (1 - bright);
    const hiss = w - lp; // (the bright part of the noise)
    out[i0 + i] += (hiss * 0.8 + (tone ? Math.sin(t * tone * TAU) * 0.5 : 0)) * Math.exp(-t / (dur * 0.3)) * gain;
  }
}

// CUMBIA (sonidera, ~100 bpm): the güiro scraping every beat, a bass on the root & fifth, the accordion's chords and a
// line over them, a cowbell; I-V in C, 8 bars
function cumbia(ctx: BaseAudioContext) {
  const bpm = 100, beat = 60 / bpm, bars = 8;
  return loopBuffer(ctx, bars * 4 * beat, (out, rate) => {
    const rnd = random(11);
    const chords = [[48, 52, 55], [43, 47, 50], [43, 47, 50], [48, 52, 55]]; // C G G C
    const accordion: Wave = (p, t) => (saw(p) * 0.6 + square((p * 2) % 1) * 0.25) * (1 + 0.04 * Math.sin(t * 34));
    const scale = [72, 74, 76, 79, 81, 84];
    for (let bar = 0; bar < bars; bar++) {
      const ch = chords[bar % 4];
      for (let b = 0; b < 4; b++) {
        const t = (bar * 4 + b) * beat;
        // güiro: a long scrape on the beat, a short one on the off-beat
        noiseHit(out, rate, t, beat * 0.4, 0.18, rnd, 0.85);
        noiseHit(out, rate, t + beat * 0.5, beat * 0.18, 0.12, rnd, 0.85);
        // bass: root on 1 & 3, the fifth on 2 & 4
        note(out, rate, t, beat * 0.8, midi(ch[0] - 12 + (b % 2 ? 7 : 0)), 0.55, sine);
        // the accordion's chord on the off-beats
        for (const m of ch) note(out, rate, t + beat * 0.5, beat * 0.35, midi(m + 12), 0.07, accordion);
        if (b % 2 === 1) noiseHit(out, rate, t, 0.08, 0.2, rnd, 0.3, 800); // the cowbell's tick
      }
      // the accordion's line over it, an eighth note at a time
      for (let e = 0; e < 8; e++) {
        if (rnd() < 0.3) continue;
        note(out, rate, (bar * 4 + e * 0.5) * beat, beat * 0.45, midi(scale[Math.floor(rnd() * scale.length)]), 0.09, accordion);
      }
      kick(out, rate, bar * 4 * beat, 0.5);
      kick(out, rate, (bar * 4 + 2) * beat, 0.5);
    }
  });
}

// BANDA (sinaloense, ~120 bpm in 2/4): the tuba's oom on the beat, the brass's pah on the off-beat, the tambora,
// a clarinet's run; I-V7 in B♭, 8 bars of 4 beats
function banda(ctx: BaseAudioContext) {
  const bpm = 125, beat = 60 / bpm, bars = 8;
  return loopBuffer(ctx, bars * 4 * beat, (out, rate) => {
    const rnd = random(23);
    const chords = [[46, 50, 53], [41, 45, 48, 51], [41, 45, 48, 51], [46, 50, 53]];
    const tuba: Wave = (p) => sine(p) * 0.8 + sine((p * 2) % 1) * 0.3;
    const brass: Wave = (p, t) => saw(p) * Math.min(1, t * 30) * 0.8;
    const clarinet: Wave = (p) => square(p) * 0.4 + sine(p) * 0.4;
    for (let bar = 0; bar < bars; bar++) {
      const ch = chords[bar % 4];
      for (let b = 0; b < 4; b++) {
        const t = (bar * 4 + b) * beat;
        note(out, rate, t, beat * 0.45, midi(ch[0] - 12 + (b % 2 ? 7 : 0)), 0.6, tuba);
        for (const m of ch) note(out, rate, t + beat * 0.5, beat * 0.25, midi(m + 12), 0.06, brass);
        kick(out, rate, t, b % 2 ? 0.35 : 0.6); // the tambora
        if (b % 2) noiseHit(out, rate, t + beat * 0.5, 0.12, 0.25, rnd, 0.5, 220); // its cymbal side
      }
      for (let e = 0; e < 8; e++) {
        if (rnd() < 0.35) continue;
        note(out, rate, (bar * 4 + e * 0.5) * beat, beat * 0.4, midi(ch[Math.floor(rnd() * ch.length)] + 24), 0.08, clarinet);
      }
    }
  });
}

// REGGAETÓN (~92 bpm): the dembow (kick on the beat, the snare's 3-3-2), a sub bass, a minor pad, an open hi-hat;
// Am F C G, 8 bars
function reggaeton(ctx: BaseAudioContext) {
  const bpm = 92, beat = 60 / bpm, bars = 8, six = beat / 4;
  return loopBuffer(ctx, bars * 4 * beat, (out, rate) => {
    const rnd = random(37);
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const pad: Wave = (p, t) => (saw(p) * 0.5 + saw((p * 1.003) % 1) * 0.5) * Math.min(1, t * 6);
    for (let bar = 0; bar < bars; bar++) {
      const ch = chords[bar % 4];
      const t0 = bar * 4 * beat;
      for (const m of ch) note(out, rate, t0, beat * 3.9, midi(m), 0.05, pad, 0.05, 0.1);
      for (let b = 0; b < 4; b++) {
        kick(out, rate, t0 + b * beat, 0.9);
        note(out, rate, t0 + b * beat, beat * 0.7, midi(ch[0] - 24), 0.5, sine);
      }
      for (const s16 of [3, 6, 11, 14]) noiseHit(out, rate, t0 + s16 * six, 0.16, 0.45, rnd, 0.55, 190);
      for (let s16 = 2; s16 < 16; s16 += 4) noiseHit(out, rate, t0 + s16 * six, 0.07, 0.12, rnd, 0.92);
    }
  });
}

// A plancha's sizzle: dense, bright crackle over a hiss, its fat spitting
function sizzle(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 4, (out, rate) => {
    const rnd = random(5);
    let lp = 0;
    for (let i = 0; i < out.length; i++) {
      const w = rnd() * 2 - 1;
      lp += (w - lp) * 0.3;
      out[i] = (w - lp) * 0.25 * (0.7 + 0.3 * Math.sin(i / rate * 3.1));
      if (rnd() < 0.0015) for (let k = 0; k < 220 && i + k < out.length; k++) out[i + k] += (rnd() * 2 - 1) * Math.exp(-k / 40) * 0.8;
    }
  }, 0.5);
}

// A fire: the low roar of the flames and the wood's (or the car's) cracks and pops
function fire(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 5, (out, rate) => {
    const rnd = random(9);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < out.length; i++) {
      const w = rnd() * 2 - 1;
      lp += (w - lp) * 0.02;
      lp2 += (lp - lp2) * 0.05;
      out[i] = lp * 3 + lp2 * 2 * (1 + 0.5 * Math.sin(i / rate * 1.7));
      if (rnd() < 0.0009) for (let k = 0; k < 600 && i + k < out.length; k++) out[i + k] += (rnd() * 2 - 1) * Math.exp(-k / 90) * 0.9;
    }
  }, 0.75);
}

// A crowd talking: overlapping voices' formants, wandering, under a murmur
function crowd(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 6, (out, rate) => {
    const rnd = random(17);
    for (let v = 0; v < 9; v++) {
      const f0 = 110 + rnd() * 120;
      let t = rnd() * 0.5;
      while (t < 6) {
        const dur = 0.15 + rnd() * 0.35;
        const vowel = 400 + rnd() * 900;
        note(out, rate, t, dur, f0 * (0.9 + rnd() * 0.25), 0.12, (p) => saw(p) * 0.4 + Math.sin(p * TAU * vowel / f0) * 0.6, 0.03, 0.06);
        t += dur + rnd() * 0.25;
      }
    }
  }, 0.5);
}

// A GE diesel working: its 16 cylinders firing ~107 times a second at the crank's ~13 Hz beat, the deep thump under
// it, the turbo's whine over it, the exhaust's rush. Every frequency a whole number of cycles in the loop's 4 s
function locomotive(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 4, (out, rate) => {
    const rnd = random(23);
    let lp = 0, rush = 0;
    const a = 1 - Math.exp(-TAU * 380 / rate);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const crank = 1 + 0.4 * Math.sin(TAU * 13.25 * t) + 0.15 * Math.sin(TAU * 26.5 * t + 1.1);
      lp += (saw(fract(106.75 * t)) - lp) * a;
      rush += ((rnd() * 2 - 1) - rush) * 0.04;
      out[i] = lp * 0.9 * crank + Math.sin(TAU * 53.5 * t) * 0.55 * crank + rush * 1.6 + Math.sin(TAU * 1600 * t) * 0.025;
    }
  }, 0.7);
}

// Steel wheels rolling: the rumble, and each truck's two axles clacking over a rail joint, two cars to the loop
function wheels(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 4, (out, rate) => {
    const rnd = random(31);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < out.length; i++) {
      const w = rnd() * 2 - 1;
      lp += (w - lp) * 0.03;
      lp2 += (w - lp2) * 0.2;
      out[i] = lp * 2.2 + (lp2 - lp) * 0.25;
    }
    for (const car of [0, 2]) {
      for (const at of [0.05, 0.23, 1.44, 1.62]) {
        noiseHit(out, rate, car + at, 0.07, 0.55, rnd, 0.45, 210);
        kick(out, rate, car + at, 0.35);
      }
    }
  }, 0.65);
}

// The horn: a five-chime (D#, F#, A, C#, D#: the K5LA's chord), brassy, a slight waver
function horn(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 2, (out, rate) => {
    const a = 1 - Math.exp(-TAU * 2600 / rate);
    for (const f of [311, 370, 440, 554.5, 622]) {
      let phase = 0, lp = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / rate;
        phase += (f * (1 + 0.003 * Math.sin(TAU * 5 * t))) / rate;
        lp += (saw(phase - Math.floor(phase)) - lp) * a;
        out[i] += lp * 0.2;
      }
    }
  }, 0.8);
}

// A level crossing's bell, struck two and a half times a second
function bell(ctx: BaseAudioContext) {
  return loopBuffer(ctx, 2, (out, rate) => {
    for (let k = 0; k < 5; k++) {
      for (const [ratio, gain] of [[1, 1], [2.41, 0.45], [3.93, 0.22], [5.4, 0.1]] as const) {
        const f = 1180 * ratio, i0 = Math.floor(k * 0.4 * rate);
        for (let i = 0; i < 0.38 * rate && i0 + i < out.length; i++) out[i0 + i] += Math.sin(TAU * f * i / rate) * Math.exp(-i / rate * 9 * ratio ** 0.5) * gain;
      }
    }
  }, 0.6);
}

const fract = (x: number) => x - Math.floor(x);

const MAKERS: Partial<Record<string, (ctx: BaseAudioContext) => AudioBuffer>> = {
  cumbia, banda, reggaeton, sizzle, fire, crowd, locomotive, wheels, horn, bell
};

function createAmbienceResources(ctx: BaseAudioContext): AmbienceResources {
  const buffers = new Map<AmbienceKind, AudioBuffer | null>();
  return {
    buffer(kind) {
      const make = MAKERS[kind];
      if (!buffers.has(kind)) buffers.set(kind, make ? make(ctx) : null);
      return buffers.get(kind) ?? null;
    }
  };
}

/**
 * A loop of `kind` (a MAKERS key) into `output` (an emitter's input), started at a point of its own so two parties
 * playing the same loop don't play in step. update({ gain }) sets its level.
 */
function createLoopVoice(ctx: BaseAudioContext, resources: AmbienceResources, kind: AmbienceKind, output: AudioNode, seed = 0): LoopVoice {
  const buffer = resources.buffer(kind);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(output);
  let source: AudioBufferSourceNode | null = null;
  if (buffer) {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(ctx.currentTime, (Math.abs(seed) * 7.31) % buffer.duration);
  }
  let disposed = false;
  return {
    update({ gain: level = 1 } = {}, now = ctx.currentTime) {
      if (disposed) return;
      gain.gain.setTargetAtTime(level, now, 0.2);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      if (source) {
        source.stop(ctx.currentTime + 0.3);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
      } else gain.disconnect();
    }
  };
}

export { createAmbienceResources, createLoopVoice };
