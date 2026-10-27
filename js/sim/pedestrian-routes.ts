// js/sim/pedestrian-routes.ts
// Small, lazily connected sidewalk tracks. Junctions only connect points on the same curb island;
// crossing the roadway is a separate, signal-controlled track owned by traffic.ts, or a footbridge over it: a route up
// its stairs, over its deck and down to a sidewalk on the far side (tracks with lifts), or a street crossing along a
// road (OpenStreetMap's, world/crossings.ts): the sidewalks split at it, a track over the road from curb to curb. The
// footways, paths, pedestrian streets & steps (OpenStreetMap's, world/footways.ts) are tracks of their own, meeting at
// their shared points and joining the sidewalk of the street their ends come out by (split there, as at a crossing).

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
interface WalkTrack<N, E, B, C = WalkCrossing<E>> {
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
  /** Its lift over the ground at its start and its end (m): 0 but up a footbridge's stairs and over its deck */
  la: number;
  lb: number;
  /** Over a street crossing: the crossing, else null */
  cross: C | null;
  /** Along a footway (world/footways.ts), not a sidewalk: on the ground of whatever it crosses */
  foot: boolean;
  /** Its end at a join (a street crossing's, a footway's) instead of its edge's node, at its start or end */
  fromJoin?: WalkJoin<N, E, B, C>;
  toJoin?: WalkJoin<N, E, B, C>;
}
/** Where tracks meet away from the junctions: on a road (edge, m along it from its stop line, and the edge back along
 *  it and m along that), a street crossing's (its crossing) or a footway's end by a sidewalk; or off the roads, a
 *  footway's own point (no edge). Its ports: the tracks that end there */
interface WalkJoin<N, E, B, C> {
  edge: E | null;
  s: number;
  back: E | null;
  bs: number;
  cross: C | null;
  ports: WalkPort<N, E, B, C>[];
}
/** A leg of a walk: a track, walked forwards (1) or backwards (-1) */
interface WalkLeg<N, E, B, C = WalkCrossing<E>> {
  track: WalkTrack<N, E, B, C>;
  dir: number;
}
interface WalkPort<N, E, B, C = WalkCrossing<E>> {
  track: WalkTrack<N, E, B, C>;
  end: number;
}
/** The road network's tests of open ground (road-network.ts) */
interface WalkSurface {
  walkable: (x0: number, x1: number, z0: number, z1: number) => boolean;
  onSidewalk: (x: number, z: number) => boolean;
}
/** A crossing of a street along it (world/crossings.ts) as the walkers see it: the edge it crosses and m along it from
 *  its stop line, and the edge back along the same road (if two-way) and m along that */
interface WalkCrossing<E> {
  edge: E;
  s: number;
  back: E | null;
  bs: number;
}
/** A footway as the walkers see it (city-geodata.js footways): its points */
interface WalkFootway {
  pts: WalkPoint[];
}
/** A footbridge as the walkers see it (city-geodata.js footbridges): its points from one foot to the other, and the
 *  lift over the ground at each (m) */
interface WalkBridge {
  pts: WalkPoint[];
  lifts: number[];
}

const BRIDGE_REACH = 80; // m from a footbridge's foot to the intersections whose sidewalks lead to it
const BRIDGE_LAND = 25; // m from a footbridge's far foot to the sidewalk its walkers carry on along
const BRIDGE_BAND = 14; // m from the curb the way to a footbridge's foot may run
const APRON = 2; // m walked straight in line into a footbridge's stairs
const CROSS_CURB = 2; // m of sidewalk a street crossing's track starts & ends with (as a crosswalk's: KERB is short of it)
const CROSS_SPLIT = 3; // m from an edge's ends a sidewalk is split at a crossing (nearer, the crossing is the junction's)
const CROSS_REACH = 8; // m from a sidewalk piece's end to the tracks it meets at a crossing
const FOOT_OUT = 6; // m from its curb a footway's end may be and still join that street's sidewalk
const FOOT_CELL = 100; // m, the cells of the lookup of the footways' tracks

function createPedestrianRoutes<N extends WalkNode<E>, E extends WalkEdge<N>, B extends WalkBlock, C extends WalkCrossing<E> = WalkCrossing<E>>(
  { walkable, onSidewalk }: WalkSurface, blockAt: (x: number, z: number) => B | null,
  { bridges = [], nodes = [], streetCrossings = [], footways = [] }:
  { bridges?: readonly WalkBridge[]; nodes?: readonly N[]; streetCrossings?: readonly C[]; footways?: readonly WalkFootway[] } = {}
) {
  type Track = WalkTrack<N, E, B, C>;
  type Leg = WalkLeg<N, E, B, C>;
  type Port = WalkPort<N, E, B, C>;
  type Join = WalkJoin<N, E, B, C>;
  const sidewalks = new Map<E, Track[]>(), crossings = new Map<N, Track[]>(), junctions = new Map<N, Port[]>();
  const connections = new WeakMap<Track, Leg[][][]>();
  // which side of edge e's centre line p lies (< 0 left, > 0 right)
  const sideOf = (e: E, p: WalkPoint) => (p.x - e.sx) * e.rx + (p.z - e.sz) * e.rz;
  const point = (track: Track, end: number): WalkPoint => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
  const segment = (a: WalkPoint, b: WalkPoint, extra: Partial<Track> = {}): Track => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      len, node: null, side: 0, line: 0, la: 0, lb: 0, cross: null, foot: false, ...extra };
  };

  // The joins on the roads: where along each edge its sidewalks split (both edges of a two-way road), and the tracks
  // that meet there (the sidewalks' pieces; a crossing's own track, its curb ends; a footway's way in)
  const splits = new Map<E, { j: Join; s: number }[]>();
  const joinOn = (edge: E, s: number, back: E | null, bs: number, cross: C | null): Join => {
    const j: Join = { edge, s, back, bs, cross, ports: [] };
    for (const [e, at] of [[edge, s], [back, bs]] as const) {
      if (!e) continue;
      let list = splits.get(e);
      if (!list) splits.set(e, (list = []));
      list.push({ j, s: at });
    }
    return j;
  };
  // (one on a junction's crosswalk, at either end of its edge, is that junction's: its track meets the sidewalks there;
  // so is one by an end of the edge back, whose stop lines may stand further out: its sidewalks split there no more)
  const atJunction = (c: C): N | null => {
    if (c.s < CROSS_SPLIT) return c.edge.from;
    if (c.s > c.edge.len - CROSS_SPLIT) return c.edge.to;
    if (!c.back) return null;
    return c.bs < CROSS_SPLIT ? c.back.from : c.bs > c.back.len - CROSS_SPLIT ? c.back.to : null;
  };
  const junctionCrossings = new Map<N, C[]>();
  const crossJoins = new Map<C, Join>();
  for (const c of streetCrossings) {
    const n = atJunction(c);
    if (n) {
      let list = junctionCrossings.get(n);
      if (!list) junctionCrossings.set(n, (list = []));
      list.push(c);
    } else {
      crossJoins.set(c, joinOn(c.edge, c.s, c.back, c.bs, c));
    }
  }
  // the crossing's own track, curb to curb across the road where it is taken (if both its ends are sidewalk), or null
  const crossTracks = new Map<C, Track | null>();
  const crossingTrack = (c: C): Track | null => {
    let track = crossTracks.get(c);
    if (track === undefined) {
      const e = c.edge, off = e.half + CROSS_CURB;
      const x = e.sx + e.dx * c.s, z = e.sz + e.dz * c.s;
      const a = { x: x - e.rx * off, z: z - e.rz * off }, b = { x: x + e.rx * off, z: z + e.rz * off };
      const n = atJunction(c), j = crossJoins.get(c);
      // (on a curb island at either end: of the centreline streets, by the island's outline, as their sidewalks)
      const curb = (p: WalkPoint) => (e.general ? blockAt(p.x, p.z) !== null : onSidewalk(p.x, p.z));
      track = (n || j) && curb(a) && curb(b) && clear(a, b)
        ? segment(a, b, n ? { cross: c, from: n, to: n } : { cross: c, fromJoin: j, toJoin: j }) : null;
      crossTracks.set(c, track);
      if (track && j) j.ports.push({ track, end: 0 }, { track, end: 1 });
    }
    return track;
  };
  for (const c of crossJoins.keys()) crossingTrack(c);

  // The footways: a track along each straight piece, meeting the others at their shared points (joins off the roads),
  // and from an end that comes out by a street, a way in to that street's sidewalk (a join on the road there)
  const footTracks: Track[] = [];
  const footCells = new Map<number, Track[]>();
  {
    const pointJoins = new Map<string, Join>();
    const joinAt = (p: WalkPoint) => {
      const key = `${Math.round(p.x * 10)},${Math.round(p.z * 10)}`;
      let j = pointJoins.get(key);
      if (!j) pointJoins.set(key, (j = { edge: null, s: 0, back: null, bs: 0, cross: null, ports: [] }));
      return j;
    };
    const addFoot = (a: WalkPoint, b: WalkPoint, ja: Join, jb: Join) => {
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) return;
      const track = segment(a, b, { foot: true, fromJoin: ja, toJoin: jb });
      ja.ports.push({ track, end: 0 });
      jb.ports.push({ track, end: 1 });
      footTracks.push(track);
      const key = Math.floor((a.x + b.x) / 2 / FOOT_CELL) * 100003 + Math.floor((a.z + b.z) / 2 / FOOT_CELL);
      let list = footCells.get(key);
      if (!list) footCells.set(key, (list = []));
      list.push(track);
    };
    for (const { pts } of footways) for (let i = 0; i + 1 < pts.length; i++) addFoot(pts[i], pts[i + 1], joinAt(pts[i]), joinAt(pts[i + 1]));
    // the ends (a point only one track meets) by a street: the edge nearest, with the end on its side within FOOT_OUT
    // m of its curb and clear of its ends; the end is that street's join there, its sidewalk split level with it
    const edges = new Set<E>();
    for (const n of nodes) for (const e of [...n.in, ...n.out]) edges.add(e);
    const edgeCells = new Map<number, E[]>();
    const EC = 48;
    for (const e of edges) {
      const r = e.half + FOOT_OUT;
      const x0 = Math.min(e.sx, e.sx + e.dx * e.len) - r, x1 = Math.max(e.sx, e.sx + e.dx * e.len) + r;
      const z0 = Math.min(e.sz, e.sz + e.dz * e.len) - r, z1 = Math.max(e.sz, e.sz + e.dz * e.len) + r;
      for (let i = Math.floor(x0 / EC); i <= Math.floor(x1 / EC); i++) for (let k = Math.floor(z0 / EC); k <= Math.floor(z1 / EC); k++) {
        const key = i * 100003 + k;
        let list = edgeCells.get(key);
        if (!list) edgeCells.set(key, (list = []));
        list.push(e);
      }
    }
    for (const j of pointJoins.values()) {
      if (j.ports.length !== 1) continue;
      const p = point(j.ports[0].track, j.ports[0].end);
      let best: E | null = null, bestOut = Infinity, bestS = 0;
      for (const e of edgeCells.get(Math.floor(p.x / EC) * 100003 + Math.floor(p.z / EC)) ?? []) {
        const s = (p.x - e.sx) * e.dx + (p.z - e.sz) * e.dz;
        const right = (p.x - e.sx) * e.rx + (p.z - e.sz) * e.rz;
        const out = Math.abs(right) - e.half;
        if (s < CROSS_SPLIT || s > e.len - CROSS_SPLIT || out < -1 || out > FOOT_OUT || out >= bestOut) continue;
        best = e; bestOut = out; bestS = s;
      }
      if (!best) continue;
      const e = best;
      const back = e.to.out.find((o) => o.to === e.from && o.dx * e.dx + o.dz * e.dz < -0.9) ?? null;
      const bs = back ? (p.x - back.sx) * back.dx + (p.z - back.sz) * back.dz : 0;
      if (back && (bs < CROSS_SPLIT || bs > back.len - CROSS_SPLIT)) continue;
      const road = joinOn(e, bestS, back, bs, null);
      for (const port of j.ports) {
        road.ports.push(port);
        if (port.end) port.track.toJoin = road;
        else port.track.fromJoin = road;
      }
      j.ports.length = 0;
    }
  }
  for (const list of splits.values()) list.sort((p, q) => p.s - q.s);
  /** The footways' tracks with their middle within `r` m of (x, z) (for those who start out on one) */
  const footNear = (x: number, z: number, r: number): Track[] => {
    const out: Track[] = [];
    const n = Math.ceil(r / FOOT_CELL), ci = Math.floor(x / FOOT_CELL), cj = Math.floor(z / FOOT_CELL);
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
      for (const t of footCells.get(i * 100003 + j) ?? []) if (Math.hypot(t.ax + t.ux * t.len / 2 - x, t.az + t.uz * t.len / 2 - z) < r) out.push(t);
    }
    return out;
  };

  // The footbridges: their tracks foot to foot, and the intersections near each foot (node -> the bridge ends there)
  interface Bridge {
    ends: [WalkPoint, WalkPoint];
    near: [N[], N[]];
    forward: Leg[];
    backward: Leg[];
  }
  const bridgeEnds = new Map<N, { bridge: Bridge; end: number }[]>();
  // (the intersections in BRIDGE_REACH cells, for those near each foot)
  const nodeCells = new Map<number, N[]>();
  const cellOf = (x: number, z: number) => Math.floor(x / BRIDGE_REACH) * 100003 + Math.floor(z / BRIDGE_REACH);
  if (bridges.length) {
    for (const n of nodes) {
      const k = cellOf(n.x, n.z);
      let list = nodeCells.get(k);
      if (!list) nodeCells.set(k, (list = []));
      list.push(n);
    }
  }
  for (const { pts: line, lifts: lineLifts } of bridges) {
    if (line.length < 2) continue;
    // (with an apron APRON m long in line with the stairs at either foot: the way on and off runs straight into them,
    // not in over their railings from the side)
    const out = (p: WalkPoint, q: WalkPoint): WalkPoint => {
      const l = Math.hypot(p.x - q.x, p.z - q.z) || 1;
      return { x: p.x + ((p.x - q.x) / l) * APRON, z: p.z + ((p.z - q.z) / l) * APRON };
    };
    const n = line.length;
    const pts = [out(line[0], line[1]), ...line, out(line[n - 1], line[n - 2])];
    const lifts = [lineLifts[0], ...lineLifts, lineLifts[n - 1]];
    const forward: Leg[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) < 0.01) continue;
      forward.push({ track: segment(pts[i], pts[i + 1], { la: lifts[i], lb: lifts[i + 1] }), dir: 1 });
    }
    if (!forward.length) continue;
    const bridge: Bridge = { ends: [pts[0], pts[pts.length - 1]], near: [[], []], forward,
      backward: forward.map((l) => ({ track: l.track, dir: -1 })).reverse() };
    for (const end of [0, 1]) {
      const p = bridge.ends[end];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const n of nodeCells.get(cellOf(p.x + i * BRIDGE_REACH, p.z + j * BRIDGE_REACH)) ?? []) {
          if (Math.hypot(n.x - p.x, n.z - p.z) > BRIDGE_REACH) continue;
          bridge.near[end].push(n);
          let list = bridgeEnds.get(n);
          if (!list) bridgeEnds.set(n, (list = []));
          list.push({ bridge, end });
        }
      }
    }
  }

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
        // (in pieces between the joins along it, each piece's end there one of the join's)
        let from: { p: WalkPoint; j: Join | null } = { p: a, j: null };
        for (const cut of [...(splits.get(e) ?? []), null]) {
          const p = cut ? { x: a.x + e.dx * cut.s, z: a.z + e.dz * cut.s } : b;
          if (cut && Math.hypot(p.x - from.p.x, p.z - from.p.z) < 0.05) continue; // (two joins at one spot: the first)
          const piece = segment(from.p, p, { edge: e, block });
          if (from.j) { piece.fromJoin = from.j; from.j.ports.push({ track: piece, end: 0 }); } else piece.from = e.from;
          if (cut) { piece.toJoin = cut.j; cut.j.ports.push({ track: piece, end: 1 }); } else piece.to = e.to;
          result.push(piece);
          if (cut) from = { p, j: cut.j };
        }
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

  function ports(n: N): Port[] {
    const known = junctions.get(n);
    if (known) return known;
    const result: Port[] = [], seen = new Set<E>();
    junctions.set(n, result);
    for (const e of [...n.in, ...n.out]) {
      if (seen.has(e)) continue;
      seen.add(e);
      for (const track of along(e)) {
        // (a sidewalk's piece whose end here is a street crossing's, not this junction's, isn't one of its ports)
        const end = e.from === n ? 0 : 1;
        if ((end ? track.to : track.from) === n) result.push({ track, end });
      }
    }
    for (const track of across(n)) result.push({ track, end: 0 }, { track, end: 1 });
    // (and the street crossings on its own crosswalks)
    for (const c of junctionCrossings.get(n) ?? []) {
      const track = crossingTrack(c);
      if (track) result.push({ track, end: 0 }, { track, end: 1 });
    }
    return result;
  }

  // Stay in the sidewalk band (`band` m of the curb) even where angled building colliders are deliberately omitted
  // from the road graph.
  function cornerClear(a: WalkPoint, b: WalkPoint, block: B, band = 4): boolean {
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
      if (distance > band) return false;
    }
    return true;
  }

  function links(track: Track, dir: number): Leg[][] {
    let ends = connections.get(track);
    if (!ends) connections.set(track, ends = []);
    const end = dir > 0 ? 1 : 0;
    if (ends[end]) return ends[end];
    const result: Leg[][] = ends[end] = [];
    const j = end ? track.toJoin : track.fromJoin;
    if (j) {
      // at a join: on along the sidewalk, onto the other line of it, over the road, along a footway or into one
      const a = point(track, end), block = blockAt(a.x, a.z);
      if (j.edge) along(j.edge);
      if (j.back) along(j.back);
      for (const port of j.ports) {
        const next = port.track, nextDir = port.end ? -1 : 1;
        if (next === track) continue;
        const b = point(next, port.end);
        if (Math.hypot(b.x - a.x, b.z - a.z) > CROSS_REACH) continue;
        // (from a sidewalk or a crossing, only to the same curb island's: never across the road but over a crossing; and
        // between a sidewalk and a footway's end, only on its side of the road)
        if (!track.foot && !next.foot && (!block || blockAt(b.x, b.z) !== block)) continue;
        if (track.foot !== next.foot && j.edge && sideOf(j.edge, a) * sideOf(j.edge, b) <= 0) continue;
        const path: Leg[] = [];
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.01) path.push({ track: segment(a, b), dir: 1 });
        path.push({ track: next, dir: nextDir });
        result.push(path);
      }
      return result;
    }
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
    // Over a footbridge whose foot is on this curb island: to its foot, up, over and down, and on to the nearest
    // sidewalk by its far foot (a flight coming down in line with the bridge lands up to ~10 m in from the curb: the
    // way to its foot keeps within BRIDGE_BAND of it)
    for (const { bridge, end } of bridgeEnds.get(n) ?? []) {
      const f = bridge.ends[end], g = bridge.ends[1 - end];
      if (Math.hypot(f.x - a.x, f.z - a.z) > 45 || blockAt(f.x, f.z) !== block || !cornerClear(a, f, block, BRIDGE_BAND)) continue;
      const far = blockAt(g.x, g.z);
      if (!far) continue;
      // the nearest point along a sidewalk of the far foot's island, and on from there either way: a route for each
      let near: Track | null = null, at = 0, best = BRIDGE_LAND;
      const seen = new Set<Track>();
      for (const m of bridge.near[1 - end]) {
        for (const port of ports(m)) {
          const t = port.track;
          if (t.node || seen.has(t)) continue; // (a sidewalk, not a crosswalk)
          seen.add(t);
          const s = Math.max(0, Math.min(t.len, (g.x - t.ax) * t.ux + (g.z - t.az) * t.uz));
          const b = { x: t.ax + t.ux * s, z: t.az + t.uz * s }, d = Math.hypot(b.x - g.x, b.z - g.z);
          if (d >= best || blockAt(b.x, b.z) !== far || !cornerClear(g, b, far, BRIDGE_BAND)) continue;
          best = d;
          near = t;
          at = s;
        }
      }
      if (!near) continue;
      const landAt = { x: near.ax + near.ux * at, z: near.az + near.uz * at };
      const over: Leg[] = [];
      if (Math.hypot(f.x - a.x, f.z - a.z) > 0.01) over.push({ track: segment(a, f), dir: 1 });
      over.push(...(end === 0 ? bridge.forward : bridge.backward));
      if (best > 0.01) over.push({ track: segment(g, landAt), dir: 1 });
      // (the rest of that sidewalk from there, towards its end or back to its start, and on from its intersection)
      for (const toEnd of [true, false]) {
        const tip = point(near, toEnd ? 1 : 0);
        if (Math.hypot(tip.x - landAt.x, tip.z - landAt.z) < 1) continue;
        result.push([...over, { track: segment(landAt, tip, { edge: near.edge, block: near.block, from: toEnd ? near.from : near.to, to: toEnd ? near.to : near.from }), dir: 1 }]);
      }
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

  return { along, across, next, crossingTrack, footNear, footTracks };
}

type PedestrianRoutes<N extends WalkNode<E>, E extends WalkEdge<N>, B extends WalkBlock, C extends WalkCrossing<E> = WalkCrossing<E>> =
  ReturnType<typeof createPedestrianRoutes<N, E, B, C>>;

export type {
  WalkPoint, WalkBlock, WalkRoad, WalkEdge, WalkNode, WalkTrack, WalkLeg, WalkSurface, WalkBridge, WalkCrossing, WalkFootway, WalkJoin,
  PedestrianRoutes
};
export { createPedestrianRoutes };
