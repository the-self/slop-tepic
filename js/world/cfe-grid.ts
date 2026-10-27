// js/world/cfe-grid.ts
// The CFE's street circuits, as street-details.ts strings them: which pole-top transformer feeds each pole (its
// secondary runs along the lines from the transformer out to halfway to the next one), which poles go dark when one is
// knocked down (the transformer's whole run; a transformer's own pole takes the runs strung to its run with it), the
// stretches of street they light, and the shape of a line fallen from its pole to the ground. Free of three.js, for the
// tests.

/** A point (m) */
interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** The circuits of `n` poles strung by `spans` ([pole, pole] by index) */
interface CfeCircuits {
  /** Each pole's run: the index of the transformer pole feeding it (or of the first pole of a run with none) */
  run: Int32Array;
  /** The poles each pole is strung to */
  links: number[][];
  /** Each run's poles, by its index */
  members: Map<number, number[]>;
  /** Whether each pole carries a transformer */
  transformer: readonly boolean[];
}

/**
 * The runs: a breadth-first walk out along the spans from every transformer at once, each pole fed by the transformer
 * the fewest spans away (a tie to the one met first). Poles strung to no transformer at all make a run of their own.
 */
function cfeCircuits(n: number, spans: readonly (readonly [number, number])[], transformer: readonly boolean[]): CfeCircuits {
  const links: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of spans) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    links[a].push(b);
    links[b].push(a);
  }
  const run = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!transformer[i]) continue;
    run[i] = i;
    queue.push(i);
  }
  const walk = () => {
    // (the queue grows as it is walked)
    for (const p of queue) {
      for (const q of links[p]) {
        if (run[q] >= 0) continue;
        run[q] = run[p];
        queue.push(q);
      }
    }
    queue.length = 0;
  };
  walk();
  for (let i = 0; i < n; i++) {
    if (run[i] >= 0) continue;
    run[i] = i;
    queue.push(i);
    walk();
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    let list = members.get(run[i]);
    if (!list) members.set(run[i], (list = []));
    list.push(i);
  }
  return { run, links, members, transformer };
}

/**
 * The poles left without power when pole `i` comes down: its run's (the secondary it carries is cut back to the
 * transformer); if it carried the transformer, the runs strung to that run as well (the primaries come down with it)
 */
function poleOutage(c: CfeCircuits, i: number): number[] {
  const runs = new Set<number>([c.run[i]]);
  if (c.transformer[i]) {
    for (const p of c.members.get(c.run[i]) ?? []) {
      for (const q of c.links[p]) runs.add(c.run[q]);
    }
  }
  const out: number[] = [];
  for (const r of runs) out.push(...(c.members.get(r) ?? []));
  return out;
}

/**
 * The stretches of street `dark` poles light, as segments [ax, az, bx, bz] flat (m): each span between two of them, and
 * a pole strung to none of the others as a point (a = b)
 */
function outageSegments(c: CfeCircuits, dark: readonly number[], at: (i: number) => { x: number; z: number }): number[] {
  const set = new Set(dark);
  const out: number[] = [];
  for (const i of dark) {
    let alone = true;
    const a = at(i);
    for (const j of c.links[i]) {
      if (!set.has(j)) continue;
      alone = false;
      if (j < i) continue; // (each span once)
      const b = at(j);
      out.push(a.x, a.z, b.x, b.z);
    }
    if (alone) out.push(a.x, a.z, a.x, a.z);
  }
  return out;
}

/**
 * A line fallen off its far end: hanging from `a` (on the pole still standing) down to touch the ground `reach` m along
 * the way to `end`, a parabola flattening onto it there, and on along the ground to `end` (where the pole lay). `count`
 * points from a, flat [x, y, z, ...] (m), each at least `lift` m over the ground (`groundAt`)
 */
function fallenLine(a: XYZ, end: { x: number; z: number }, reach: number, groundAt: (x: number, z: number) => number,
  count = 14, lift = 0.03): number[] {
  const dx = end.x - a.x, dz = end.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const touch = Math.min(Math.max(0.5, reach), len);
  const tx = a.x + dx * touch / len, tz = a.z + dz * touch / len;
  const ty = groundAt(tx, tz) + lift;
  const hang = Math.max(2, Math.ceil(count * 0.6));
  const out: number[] = [];
  // hanging: its height falls as the square of what is left to the touchdown (level as it meets the ground)
  for (let k = 0; k <= hang; k++) {
    const t = k / hang;
    const x = a.x + (tx - a.x) * t, z = a.z + (tz - a.z) * t;
    const y = ty + (a.y - ty) * (1 - t) * (1 - t);
    out.push(x, Math.max(y, groundAt(x, z) + lift), z);
  }
  // lying on the ground the rest of the way
  const rest = Math.max(1, count - hang);
  if (len - touch > 0.25) {
    for (let k = 1; k <= rest; k++) {
      const t = k / rest;
      const x = tx + (end.x - tx) * t, z = tz + (end.z - tz) * t;
      out.push(x, groundAt(x, z) + lift, z);
    }
  }
  return out;
}

export type { XYZ, CfeCircuits };
export { cfeCircuits, poleOutage, outageSegments, fallenLine };
