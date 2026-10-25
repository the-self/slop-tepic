// js/sim/pedestrian-routes.ts
// Small, lazily connected sidewalk tracks. Junctions only connect points on the same curb island;
// crossing the roadway is a separate, signal-controlled track owned by traffic.ts.

interface WalkPoint {
  x: number;
  z: number;
}
/** A curb island (city-config.ts blockAt): its outline */
interface WalkBlock {
  poly: readonly WalkPoint[];
}
/** The road a crosswalk spans (an edge of road-network.ts): its centreline's offset across (m) and half its width */
interface WalkRoad {
  x0: number;
  z0: number;
  half: number;
}
/** What the tracks read of a road-network.ts edge: start, unit direction & right (m), length, half width */
interface WalkEdge<N> {
  from: N;
  to: N;
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  rx: number;
  rz: number;
  len: number;
  half: number;
  general?: boolean;
}
/** ...and of an intersection: centre, half extents (m), signal, edges in & out, and the road over each side's
 *  crosswalk (traffic.ts) */
interface WalkNode<E> {
  x: number;
  z: number;
  hx: number;
  hz: number;
  signal: boolean;
  in: E[];
  out: E[];
  road: (WalkRoad | null)[];
}
/** A straight walking line: start (m), unit direction, length (m). Along a sidewalk it has the edge (and its ends,
 *  its block); over a crosswalk the intersection, its side and its line off the crosswalk's centre (m); a corner
 *  piece neither. */
interface WalkTrack<N, E, B> {
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  node: N | null;
  side: number;
  line: number;
  edge?: E;
  from?: N;
  to?: N;
  block?: B;
}
/** A leg of a walk: a track, walked forwards (1) or backwards (-1) */
interface WalkLeg<N, E, B> {
  track: WalkTrack<N, E, B>;
  dir: number;
}
interface WalkPort<N, E, B> {
  track: WalkTrack<N, E, B>;
  end: number;
}
/** The road network's tests of open ground (road-network.ts) */
interface WalkSurface {
  walkable: (x0: number, x1: number, z0: number, z1: number) => boolean;
  onSidewalk: (x: number, z: number) => boolean;
}

function createPedestrianRoutes<N extends WalkNode<E>, E extends WalkEdge<N>, B extends WalkBlock>(
  { walkable, onSidewalk }: WalkSurface, blockAt: (x: number, z: number) => B | null
) {
  type Track = WalkTrack<N, E, B>;
  type Leg = WalkLeg<N, E, B>;
  const sidewalks = new Map<E, Track[]>(), crossings = new Map<N, Track[]>(), junctions = new Map<N, WalkPort<N, E, B>[]>();
  const connections = new WeakMap<Track, Leg[][][]>();
  const point = (track: Track, end: number): WalkPoint => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
  const segment = (a: WalkPoint, b: WalkPoint, extra: Partial<Track> = {}): Track => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      len, node: null, side: 0, line: 0, ...extra };
  };

  function clear(a: WalkPoint, b: WalkPoint, block: B | null = null): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    let x = a.x, z = a.z;
    for (let i = 0; i <= steps; i++) {
      const nx = a.x + (b.x - a.x) * i / steps, nz = a.z + (b.z - a.z) * i / steps;
      if (!walkable(Math.min(x, nx) - 0.4, Math.max(x, nx) + 0.4, Math.min(z, nz) - 0.4, Math.max(z, nz) + 0.4)) return false;
      if (block && blockAt(nx, nz) !== block) return false;
      x = nx; z = nz;
    }
    return true;
  }

  function along(e: E): Track[] {
    const known = sidewalks.get(e);
    if (known) return known;
    const result: Track[] = [];
    sidewalks.set(e, result);
    // Two walking lines on each side leave room for people to pass or stop together.
    for (const sign of [-1, 1]) {
      for (const inset of [1.7, 2.8]) {
        const off = sign * (e.half + inset);
        const a = { x: e.sx + e.rx * off, z: e.sz + e.rz * off };
        const b = { x: a.x + e.dx * e.len, z: a.z + e.dz * e.len };
        const block = blockAt(a.x, a.z);
        if (!block || blockAt(b.x, b.z) !== block || !clear(a, b, block)) continue;
        if (!e.general && (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z))) continue;
        result.push(segment(a, b, { edge: e, from: e.from, to: e.to, block }));
      }
    }
    return result;
  }

  function across(n: N): Track[] {
    const known = crossings.get(n);
    if (known) return known;
    const result: Track[] = [];
    crossings.set(n, result);
    if (!n.signal) return result;
    for (let side = 0; side < 4; side++) {
      const road = n.road[side];
      if (!road) continue;
      const avenue = side >= 2, sign = side % 2 === 0 ? 1 : -1;
      for (const line of avenue ? [sign * 0.75] : [-0.75, 0.75]) {
        const a = { x: avenue ? road.x0 - road.half - 2 : n.x + sign * (n.hx + 1.25) + line,
          z: avenue ? n.z + sign * (n.hz + 1.25) + line : road.z0 - road.half - 2 };
        const len = road.half * 2 + 4;
        const b = { x: a.x + (avenue ? len : 0), z: a.z + (avenue ? 0 : len) };
        if (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z) || !clear(a, b)) continue;
        result.push(segment(a, b, { node: n, side, line, from: n, to: n }));
      }
    }
    return result;
  }

  function ports(n: N): WalkPort<N, E, B>[] {
    const known = junctions.get(n);
    if (known) return known;
    const result: WalkPort<N, E, B>[] = [], seen = new Set<E>();
    junctions.set(n, result);
    for (const e of [...n.in, ...n.out]) {
      if (seen.has(e)) continue;
      seen.add(e);
      for (const track of along(e)) result.push({ track, end: e.from === n ? 0 : 1 });
    }
    for (const track of across(n)) result.push({ track, end: 0 }, { track, end: 1 });
    return result;
  }

  // Stay in the sidewalk band even where angled building colliders are deliberately omitted from the road graph.
  function cornerClear(a: WalkPoint, b: WalkPoint, block: B): boolean {
    if (!clear(a, b, block)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
      let distance = Infinity;
      for (let j = 0, k = block.poly.length - 1; j < block.poly.length; k = j++) {
        const p = block.poly[j], q = block.poly[k], dx = q.x - p.x, dz = q.z - p.z;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
        distance = Math.min(distance, Math.hypot(x - p.x - dx * t, z - p.z - dz * t));
      }
      if (distance > 4) return false;
    }
    return true;
  }

  function links(track: Track, dir: number): Leg[][] {
    let ends = connections.get(track);
    if (!ends) connections.set(track, ends = []);
    const end = dir > 0 ? 1 : 0;
    if (ends[end]) return ends[end];
    const result: Leg[][] = ends[end] = [];
    const n = end ? track.to : track.from;
    if (!n) return result;
    const a = point(track, end), block = blockAt(a.x, a.z);
    if (!block) return result;
    for (const port of ports(n)) {
      const next = port.track, nextDir = port.end ? -1 : 1;
      if (next === track) continue;
      const b = point(next, port.end), distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (distance > 32 || blockAt(b.x, b.z) !== block) continue;
      const path: Leg[] = [];
      if (distance > 0.01) {
        if (cornerClear(a, b, block)) {
          path.push({ track: segment(a, b), dir: 1 });
        } else {
          // Meeting the two offset sidewalk lines rounds the curb instead of cutting diagonally through a lot.
          const ax = track.ux * dir, az = track.uz * dir, bx = next.ux * nextDir, bz = next.uz * nextDir;
          const cross = ax * bz - az * bx;
          if (Math.abs(cross) < 0.2) continue;
          const t = ((b.x - a.x) * bz - (b.z - a.z) * bx) / cross;
          const c = { x: a.x + ax * t, z: a.z + az * t };
          if (t < 0 || t > 20 || (b.x - c.x) * bx + (b.z - c.z) * bz < 0 || Math.hypot(b.x - c.x, b.z - c.z) > 20) continue;
          if (!cornerClear(a, c, block) || !cornerClear(c, b, block)) continue;
          if (t > 0.01) path.push({ track: segment(a, c), dir: 1 });
          if (Math.hypot(b.x - c.x, b.z - c.z) > 0.01) path.push({ track: segment(c, b), dir: 1 });
        }
      }
      path.push({ track: next, dir: nextDir });
      result.push(path);
    }
    return result;
  }

  function next(track: Track, dir: number, goalX: number, goalZ: number): Leg[] | null {
    let best: Leg[] | null = null, bestScore = -Infinity;
    const a = point(track, dir > 0 ? 1 : 0);
    const gx = goalX - a.x, gz = goalZ - a.z, distance = Math.hypot(gx, gz) || 1;
    for (const path of links(track, dir)) {
      const last = path[path.length - 1], target = last.track;
      const ux = target.ux * last.dir, uz = target.uz * last.dir;
      const back = ux * track.ux * dir + uz * track.uz * dir < -0.8;
      const score = (ux * gx + uz * gz) / distance + Math.random() * 0.7 - (back ? 2 : 0);
      if (score > bestScore) { best = path; bestScore = score; }
    }
    return best;
  }

  return { along, across, next };
}

type PedestrianRoutes<N extends WalkNode<E>, E extends WalkEdge<N>, B extends WalkBlock> = ReturnType<typeof createPedestrianRoutes<N, E, B>>;

export type { WalkPoint, WalkBlock, WalkRoad, WalkEdge, WalkNode, WalkTrack, WalkLeg, WalkSurface, PedestrianRoutes };
export { createPedestrianRoutes };
