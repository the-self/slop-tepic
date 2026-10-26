// js/sim/crime/road-graph.ts
// The patrol cars' map (sim/crime.ts): the road graph as an undirected weighted graph, bucketed for nearest-node
// lookups, A* routes over it, and lines of sight past the buildings.
import type { XZ } from './types.ts';
import type { CrimeSystem } from '../crime.ts';

// A tiny binary heap of [cost, node] pairs, for the patrol cars' route search
class Heap {
  items: [number, number][];

  constructor() {
    this.items = [];
  }

  push(cost: number, node: number): void {
    const a = this.items;
    a.push([cost, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (last && a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

// The road graph as an undirected weighted graph, bucketed for nearest-node lookups: the patrol cars' map. And the
// same the ways its lanes run (`ways`: a one-way street one way, a divided avenue's roadways each their own way), for
// the fire trucks & ambulances, which keep to the right side
export function buildRoadGraph(crime: CrimeSystem): void {
  const { nodes, edges } = crime.traffic.network;
  crime.nodes = nodes;
  const index = new Map(nodes.map((n, i) => [n, i]));
  crime.links = nodes.map(() => []);
  crime.ways = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const cost = Math.hypot(e.to.x - e.from.x, e.to.z - e.from.z);
    if (!crime.links[a].some((l) => l[0] === b)) crime.links[a].push([b, cost]);
    if (!crime.links[b].some((l) => l[0] === a)) crime.links[b].push([a, cost]);
    if (e.lanes.length && !crime.ways[a].some((l) => l[0] === b)) crime.ways[a].push([b, cost]);
  }
  crime.nodeCells = new Map();
  nodes.forEach((n, i) => {
    if (!crime.links[i].length) return;
    const k = `${Math.floor(n.x / 80)},${Math.floor(n.z / 80)}`;
    let cell = crime.nodeCells.get(k);
    if (!cell) crime.nodeCells.set(k, (cell = []));
    cell.push(i);
  });
}

// The nearest intersection to (x, z) that can be driven to straight (no building in between), else the nearest
export function nearestNode(crime: CrimeSystem, x: number, z: number): number {
  const cx = Math.floor(x / 80), cz = Math.floor(z / 80);
  let best = -1;
  let bestD = Infinity;
  let seen = -1;
  let seenD = Infinity;
  for (let r = 0; r <= 3 && seen < 0; r++) {
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
        for (const i of crime.nodeCells.get(`${ix},${iz}`) ?? []) {
          const n = crime.nodes[i];
          const d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
          if (d < seenD && d < 160 * 160 && crime.clearLine(x, z, n.x, n.z)) {
            seenD = d;
            seen = i;
          }
        }
      }
    }
  }
  return seen >= 0 ? seen : best;
}

// The intersections a patrol car drives through from (x0, z0) to (x1, z1): A* over the road graph, or null. It gives
// up after `limit` intersections (a chase's route is short; a fire truck's across the city is not); `oneWay`: only
// the ways the lanes run (crime.ways)
export function route(crime: CrimeSystem, x0: number, z0: number, x1: number, z1: number, limit = 4000, oneWay = false): XZ[] | null {
  const s = crime.nearestNode(x0, z0), g = crime.nearestNode(x1, z1);
  if (s < 0 || g < 0) return null;
  if (s === g) return [crime.nodes[g]];
  const goal = crime.nodes[g];
  const cost = new Map([[s, 0]]);
  const from = new Map<number, number>();
  const open = new Heap();
  open.push(0, s);
  let expanded = 0;
  while (open.size && expanded < limit) {
    const [, i] = open.pop();
    if (i === g) break;
    expanded++;
    const base = cost.get(i);
    if (base === undefined) continue;
    for (const [j, w] of (oneWay ? crime.ways : crime.links)[i]) {
      const c = base + w;
      if (c >= (cost.get(j) ?? Infinity)) continue;
      cost.set(j, c);
      from.set(j, i);
      const n = crime.nodes[j];
      open.push(c + Math.hypot(n.x - goal.x, n.z - goal.z), j);
    }
  }
  if (!from.has(g)) return null;
  const path: XZ[] = [];
  for (let i: number | undefined = g; i !== undefined; i = from.get(i)) path.push(crime.nodes[i]);
  return path.reverse();
}

// Can one see from (x0, z0) to (x1, z1) past the buildings? (every 2.5 m)
export function clearLine(crime: CrimeSystem, x0: number, z0: number, x1: number, z1: number): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 2.5);
  for (let i = 1; i < n; i++) {
    if (crime.solidAt(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n)) return false;
  }
  return true;
}
