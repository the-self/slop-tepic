// tools/build-tepic-geodata.mjs — writes js/world/city-geodata.js for Tepic, Nayarit, from OpenStreetMap.
// The generic fields (roadGraph, blocks, parks, roads) carry the whole city. The schema keeps a few empty fields from
// the New York game this project was forked from (streets, avenues, centralPark, boroughs, piers, bridges...), with
// `frame.grid` / `frame.waterfront` false, so the generated file keeps its shape; `manhattan` is the city's box.
//
// Frame: 1 unit = 1 m, x = east, z = south (north = -z), origin at the Plaza Principal (Plaza de Armas), axes turned
// to the centro's street grid (a few degrees from true north, measured from the streets themselves).
//
// Inputs (tools/data/tepic/, fetched by tools/data/tepic/fetch.sh through Overpass):
//   osm_tepic_roads.json      every highway=* way with geometry
//   osm_tepic_land.json       parks, pitches, schools, water, rail, land use
//   osm_tepic_pois.json       neighbourhoods, monuments, signals, lamps
//   osm_tepic_buildings.json  building footprints (sparse in Tepic; only notable ones are kept)
//   osm_tepic_details.json    stops, speed bumps, trees, power lines, street furniture, businesses, fences
//   semovi_routes.json        the bus & combi routes (Secretaría de Movilidad de Nayarit, tools/data/tepic/fetch-routes.sh)
//
// usage: node --max-old-space-size=8192 tools/build-tepic-geodata.mjs [outFile]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { log, ringArea, bbox, centroid, rdp, rdpRing, extractBlocks, ringCells, traceOutline, clearCapsule, minAreaRect, decodePNG, createRouteMatcher, houseAt } from './tepic-lib.mjs';
import { BUILDING_OVERRIDES } from '../js/world/building-overrides.ts';
import { STOREFRONTS } from '../js/world/storefronts/index.ts';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/tepic/', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../js/world/city-geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const q = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);

// =====================================================================================================================
// 1. FRAME: origin at the Plaza Principal, axes along the centro's grid
// =====================================================================================================================
const LAT0 = 21.51224;
const LON0 = -104.89269;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
let THETA = 0;
const enu = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
// World: x east along the grid, z south along the grid
function toWorld(lon, lat) {
  const [e, n] = enu(lon, lat);
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  return [e * c - n * s, -(e * s + n * c)];
}

const roadsOSM = load('osm_tepic_roads.json');
const landOSM = load('osm_tepic_land.json');
// grid frame -> lon/lat (for the logs)
function toLonLat(x, z) {
  const c = Math.cos(THETA), s = Math.sin(THETA);
  const e = x * c - z * s, n = -(x * s + z * c);
  return [LON0 + e / KX, LAT0 + n / KY];
}
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const ways = roadsOSM.elements.filter((e) => e.type === 'way' && e.geometry && e.tags && e.tags.highway);
// Overpass' `out geom tags` carries no node ids: ways sharing a node share its exact coordinates
const nodeKey = (g) => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
{
  // Bearing: length-weighted circular mean (mod 90°) of the street directions within 1.2 km of the plaza
  let sx = 0, sy = 0;
  for (const w of ways) {
    if (!DRIVE.has(w.tags.highway)) continue;
    const g = w.geometry;
    for (let i = 0; i + 1 < g.length; i++) {
      const [e0, n0] = enu(g[i].lon, g[i].lat);
      const [e1, n1] = enu(g[i + 1].lon, g[i + 1].lat);
      if (Math.hypot(e0, n0) > 1200) continue;
      const L = Math.hypot(e1 - e0, n1 - n0);
      if (L < 5) continue;
      const a = Math.atan2(e1 - e0, n1 - n0); // bearing east of north
      sx += L * Math.cos(4 * a);
      sy += L * Math.sin(4 * a);
    }
  }
  THETA = Math.atan2(sy, sx) / 4;
  log(`grid bearing ${((THETA * 180) / Math.PI).toFixed(2)}° east of true north`);
}

// The detailed city: a box around the centro (metres in the grid frame). Everything the game builds lives in here.
// From Lo de Lamedo & Las Brisas (west) to San Cayetano & Vistas de la Cantera (east), from El Tajo (north) to the south
// of Xalisco: the whole metropolitan area of Tepic & Xalisco, and the airport (Pantanal, its terminal & access roads
// at x ~9400-10100, its runway along grid z 6000-9100). East of it the box takes in the highway that leads there: the
// Autopista Tepic - Compostela (MEX 200D, x ~11700-12900) from its junction with the Libramiento Norte (MEX 15D,
// x ~12750, z ~3950) down to the Ramal Aeropuerto (x ~10100-11700, z ~7100-8850) that runs west to the terminal
const BOX = { x0: -5800, x1: 13500, z0: -4800, z1: 10100 };
log(`detail box corners: ${[[BOX.x0, BOX.z0], [BOX.x1, BOX.z0], [BOX.x1, BOX.z1], [BOX.x0, BOX.z1]].map(([x, z]) => toLonLat(x, z).map((v) => v.toFixed(4)).reverse().join(',')).join('  ')}`);
const inBox = (x, z) => x >= BOX.x0 && x <= BOX.x1 && z >= BOX.z0 && z <= BOX.z1;
const boxRing = [[BOX.x0, BOX.z0], [BOX.x0, BOX.z1], [BOX.x1, BOX.z1], [BOX.x1, BOX.z0]]; // negative shoelace area (x, z)

// =====================================================================================================================
// 2. STREETS: curb-to-curb widths, lanes and direction per OSM way
// =====================================================================================================================
const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
function roadSpec(t) {
  const hw = t.highway;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.oneway === '-1' || t.junction === 'roundabout';
  const dir = t.oneway === '-1' ? -1 : oneway ? 1 : 0;
  const widths = {
    motorway: [11, 11], trunk: [10.5, 16], primary: [10, 14], secondary: [9, 12], tertiary: [8, 10],
    unclassified: [7.4, 7.4], residential: [7.4, 7.4], living_street: [6, 6],
    motorway_link: [7, 7], trunk_link: [7, 7], primary_link: [7, 7], secondary_link: [7, 7], tertiary_link: [7, 7]
  }[hw] || [7.4, 7.4];
  let w = num(t.width);
  if (!(w >= 4 && w <= 30)) w = oneway ? widths[0] : widths[1];
  let lanes = num(t.lanes);
  if (!(lanes >= 1 && lanes <= 8)) {
    lanes = { motorway: 2, trunk: oneway ? 3 : 4, primary: oneway ? 2 : 2, secondary: oneway ? 2 : 2, tertiary: oneway ? 1 : 2 }[hw];
    if (!lanes) lanes = oneway ? 1 : 2;
  }
  const major = /^(motorway|trunk|primary)$/.test(hw);
  return { w: Math.round(w * 10) / 10, lanes: Math.round(lanes), dir, major, hw };
}
const roadName = (t) => t.name || t['name:es'] || t.ref || '';

// =====================================================================================================================
// 3. ROAD GRAPH: every drivable way split at shared nodes, clipped to the box
// =====================================================================================================================
const nodeUse = new Map();
for (const w of ways) {
  if (!DRIVE.has(w.tags.highway)) continue;
  for (const g of w.geometry) { const k = nodeKey(g); nodeUse.set(k, (nodeUse.get(k) || 0) + 1); }
}
const MERGE = 1.0;
const gnodes = [];
const gcells = new Map();
function nodeAt(x, z) {
  const ix = Math.floor(x / MERGE), iz = Math.floor(z / MERGE);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (const id of gcells.get((ix + dx) * 1000003 + iz + dz) || []) {
        if (Math.hypot(gnodes[id][0] - x, gnodes[id][1] - z) <= MERGE) return id;
      }
    }
  }
  const id = gnodes.length;
  gnodes.push([x, z]);
  const k = ix * 1000003 + iz;
  if (!gcells.has(k)) gcells.set(k, []);
  gcells.get(k).push(id);
  return id;
}
const names = [];
const nameIds = new Map();
const nameId = (n) => {
  if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); }
  return nameIds.get(n);
};
// Clip a polyline to the box: the pieces inside, cut at the box edges
function clipChain(pts) {
  const out = [];
  let cur = [];
  const cross = (a, b) => {
    // first intersection of segment a-b with the box edges, as a point (a inside xor b inside)
    let best = null, bt = Infinity;
    const test = (t) => { if (t >= 0 && t <= 1 && t < bt) { bt = t; best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } };
    if (b[0] !== a[0]) { test((BOX.x0 - a[0]) / (b[0] - a[0])); test((BOX.x1 - a[0]) / (b[0] - a[0])); }
    if (b[1] !== a[1]) { test((BOX.z0 - a[1]) / (b[1] - a[1])); test((BOX.z1 - a[1]) / (b[1] - a[1])); }
    if (!best) return null;
    best[0] = Math.min(BOX.x1, Math.max(BOX.x0, best[0]));
    best[1] = Math.min(BOX.z1, Math.max(BOX.z0, best[1]));
    return best;
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = inBox(p[0], p[1]);
    if (inside) {
      if (!cur.length && i > 0) { const c = cross(pts[i - 1], p); if (c) cur.push(c); }
      cur.push(p);
    } else if (cur.length) {
      const c = cross(cur[cur.length - 1], p);
      if (c) cur.push(c);
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((c) => c.length > 1);
}
const links = [];
const linkDrafts = []; // { a, b, ni, spec, line, bridge, tunnel }: the links before their bridges are raised
const drivePieces = []; // for the block raster: { x0, z0, x1, z1, r, major }
const roadLines = []; // for maps & labels
const nodeWorld = new Map(); // node coordinate key -> world point (for signals)
for (const w of ways) {
  const t = w.tags;
  if (!DRIVE.has(t.highway)) continue;
  const spec = roadSpec(t);
  const name = roadName(t);
  const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
  for (let i = 0; i < w.geometry.length; i++) nodeWorld.set(nodeKey(w.geometry[i]), pts[i]);
  // split at junctions (nodes shared with another drivable way) and at the way's ends
  let chain = [pts[0]];
  const chains = [];
  for (let i = 1; i < pts.length; i++) {
    chain.push(pts[i]);
    if (i === pts.length - 1 || nodeUse.get(nodeKey(w.geometry[i])) > 1) { chains.push(chain); chain = [pts[i]]; }
  }
  const ni = nameId(name);
  // (a bridge over something, or a road through a tunnel under it: see the bridges & ramps below)
  const bridge = !!t.bridge && t.bridge !== 'no';
  const tunnel = !!t.tunnel && t.tunnel !== 'no';
  for (const ch of chains) {
    for (const piece of clipChain(ch)) {
      const line = rdp(piece, 0.4);
      const a = nodeAt(...line[0]);
      const b = nodeAt(...line[line.length - 1]);
      if (a === b) continue;
      linkDrafts.push({ a, b, ni, spec, line, bridge, tunnel });
      for (let i = 0; i + 1 < line.length; i++) {
        drivePieces.push({ x0: line[i][0], z0: line[i][1], x1: line[i + 1][0], z1: line[i + 1][1], r: spec.w / 2 + 0.3, major: spec.major });
      }
    }
  }
  for (const piece of clipChain(pts)) {
    roadLines.push({ name, w: spec.w, dir: spec.dir === 0 ? 'TW' : spec.dir > 0 ? 'FT' : 'TF', lanes: spec.lanes, hw: spec.major, pts: rdp(piece, 0.8) });
  }
}

// =====================================================================================================================
// 3B. BRIDGES, UNDERPASSES & RAMPS: the overpasses (a bridge over another road or the railway) raised over what passes
//     under them, the roads through tunnels sunk under the roads over them (in a cut, the road over it kept at grade),
//     their approaches ramping to them. Each link gets the lift of every vertex over the ground (< 0 down in a cut;
//     piecewise linear between them), the same for the traffic, the player and the deck or cut drawn
// =====================================================================================================================
const CLEARANCE = 6.0; // m: an overpass's deck over the road under it (~5 m of headroom under a ~1 m deck)
const RAIL_CLEARANCE = 7.0;
const RAMP = 0.07; // the steepest ramp up to a deck (7 %)
const railLines = [];
for (const e of landOSM.elements) {
  if (e.type !== 'way' || !e.geometry || !e.tags || e.tags.railway !== 'rail') continue;
  const t = e.tags;
  for (const piece of clipChain(e.geometry.map((g) => toWorld(g.lon, g.lat)))) {
    railLines.push({ line: rdp(piece, 0.3), bridge: !!t.bridge && t.bridge !== 'no', main: (t.usage || '') === 'main' || !t.service });
  }
}
// where two segments cross (strictly inside both), as [t along the first, u along the second, x, z]
const segCross = (p, q, r, s2) => {
  const d = (q[0] - p[0]) * (s2[1] - r[1]) - (q[1] - p[1]) * (s2[0] - r[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s2[1] - r[1]) - (r[1] - p[1]) * (s2[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return [t, u, p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
};
// The segments of the links & rails in 50 m cells
const SEG_CELL = 50;
const segCells = new Map();
const addSeg = (owner, i, a, b) => {
  const x0 = Math.floor(Math.min(a[0], b[0]) / SEG_CELL), x1 = Math.floor(Math.max(a[0], b[0]) / SEG_CELL);
  const z0 = Math.floor(Math.min(a[1], b[1]) / SEG_CELL), z1 = Math.floor(Math.max(a[1], b[1]) / SEG_CELL);
  for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
    const k = ix * 100003 + iz;
    if (!segCells.has(k)) segCells.set(k, []);
    segCells.get(k).push([owner, i]);
  }
};
linkDrafts.forEach((d, id) => { d.id = id; for (let i = 0; i + 1 < d.line.length; i++) addSeg(d, i, d.line[i], d.line[i + 1]); });
railLines.forEach((r, id) => { r.id = -1 - id; for (let i = 0; i + 1 < r.line.length; i++) addSeg(r, i, r.line[i], r.line[i + 1]); });
const crossings = (owner) => {
  const out = [];
  const seen = new Set();
  for (let i = 0; i + 1 < owner.line.length; i++) {
    const a = owner.line[i], b = owner.line[i + 1];
    const x0 = Math.floor(Math.min(a[0], b[0]) / SEG_CELL), x1 = Math.floor(Math.max(a[0], b[0]) / SEG_CELL);
    const z0 = Math.floor(Math.min(a[1], b[1]) / SEG_CELL), z1 = Math.floor(Math.max(a[1], b[1]) / SEG_CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      for (const [other, j] of segCells.get(ix * 100003 + iz) || []) {
        const key = `${other.id}:${j}:${i}`;
        if (other === owner || seen.has(key)) continue;
        seen.add(key);
        const c = segCross(a, b, other.line[j], other.line[j + 1]);
        if (!c) continue;
        out.push({ i, t: c[0], other, j, u: c[1], x: c[2], z: c[3] });
      }
    }
  }
  return out;
};
// Vertices put into a line at the points the solve needs: { line, at: [x, z], lift?, pin? } (insertion keeps the
// line's shape, only splitting a segment)
const fixes = []; // { owner, x, z, lift } raised to `lift` (> 0) or sunk to it (< 0); lift 0: held at grade
for (const d of linkDrafts) {
  if (!d.bridge && !d.tunnel) continue;
  for (const c of crossings(d)) {
    const o = c.other;
    const oRoad = !!o.spec;
    if (d.bridge && !(oRoad && o.bridge)) {
      // over a road (or the railway): this bridge's span up, the road (or rail) under it held at grade
      const lift = oRoad ? CLEARANCE : RAIL_CLEARANCE;
      for (const p of d.line) fixes.push({ owner: d, x: p[0], z: p[1], lift });
      fixes.push({ owner: o, x: c.x, z: c.z, lift: 0 });
    } else if (d.tunnel && oRoad && !o.tunnel && !o.bridge) {
      // a road through a tunnel under another (Insurgentes under Av. México, the Nodo Vial de la Cruz): sunk in its cut
      // all along the tunnel, the road over it held at grade (the cut's roof: ground.ts, underpasses.ts)
      for (const p of d.line) fixes.push({ owner: d, x: p[0], z: p[1], lift: -CLEARANCE });
      fixes.push({ owner: d, x: c.x, z: c.z, lift: -CLEARANCE });
      fixes.push({ owner: o, x: c.x, z: c.z, lift: 0 });
    }
  }
}
for (const r of railLines) {
  if (!r.bridge) continue;
  for (const c of crossings(r)) {
    if (!c.other.spec || c.other.bridge) continue;
    for (const p of r.line) fixes.push({ owner: r, x: p[0], z: p[1], lift: RAIL_CLEARANCE });
    fixes.push({ owner: c.other, x: c.x, z: c.z, lift: 0 });
  }
}
// put each fix's point into its line (a vertex within 0.5 m of it serves)
for (const f of fixes) {
  const line = f.owner.line;
  let best = -1, bd = 0.5;
  line.forEach((p, i) => { const dd = Math.hypot(p[0] - f.x, p[1] - f.z); if (dd < bd) { bd = dd; best = i; } });
  if (best >= 0) { f.v = line[best]; continue; }
  let seg = -1, sd = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((f.x - ax) * (bx - ax) + (f.z - az) * (bz - az)) / L2));
    const dd = Math.hypot(ax + (bx - ax) * t - f.x, az + (bz - az) * t - f.z);
    if (dd < sd) { sd = dd; seg = i; }
  }
  if (seg < 0 || sd > 2) continue;
  const v = [f.x, f.z];
  line.splice(seg + 1, 0, v);
  f.v = v;
}
// The junctions a ramp may not climb through: where a cross street meets the road (two of the links there leave it
// 50-130° apart), the cross street stays at grade, so the junction does too and the road's ramp comes down before it.
// A road that only forks there (an interchange's slip road peeling off) or a way split in two ramps on through it.
const CROSS_MIN = Math.cos((50 * Math.PI) / 180), CROSS_MAX = Math.cos((130 * Math.PI) / 180);
const heldJunctions = (() => {
  const out = new Map(); // node -> unit directions of the links leaving it
  for (const d of linkDrafts) {
    for (const [n, p, q] of [[d.a, d.line[0], d.line[1]], [d.b, d.line[d.line.length - 1], d.line[d.line.length - 2]]]) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      if (!out.has(n)) out.set(n, []);
      out.get(n).push([(q[0] - p[0]) / L, (q[1] - p[1]) / L]);
    }
  }
  const held = new Set();
  for (const [n, dirs] of out) {
    if (dirs.length < 3) continue;
    let cross = false;
    for (let i = 0; i < dirs.length && !cross; i++) for (let j = i + 1; j < dirs.length; j++) {
      const c = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1];
      if (c < CROSS_MIN && c > CROSS_MAX) { cross = true; break; }
    }
    if (cross) held.add(n);
  }
  return held;
})();
// The lifts: from each raised vertex down every way out at RAMP (a graph of the links' vertices, joined at the junction
// nodes; the rails apart), held to RAMP x the distance from any vertex kept at grade (and from the junctions in
// `heldNodes`), and stopped there: a ramp spreading on past a street kept at grade would raise the streets beyond it
function solveLifts(lines, nodeOf, heldNodes = []) {
  const verts = new Map(); // vertex array -> id
  const adj = [];
  const idOf = (line, i) => {
    const key = nodeOf ? nodeOf(line, i) : null;
    const k = key !== null ? `n${key}` : line[i];
    if (!verts.has(k)) { verts.set(k, adj.length); adj.push([]); }
    return verts.get(k);
  };
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = idOf(line, i), b = idOf(line, i + 1);
      const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
      adj[a].push([b, L]);
      adj[b].push([a, L]);
    }
  }
  const spread = (seeds, value) => {
    // the largest value reached from a seed, value(v, L, n) being v's at a vertex L m on to its neighbour n (a
    // max-plus Dijkstra), cut off at 0 (in doubles: a float array
    // would round what it keeps above what the heap holds, and the vertex would never be spread from)
    const best = new Float64Array(adj.length);
    const heap = [];
    const push = (id, v) => { heap.push([v, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const [id, v] of seeds) if (v > best[id]) { best[id] = v; push(id, v); }
    while (heap.length) {
      const [v, id] = pop();
      if (v < best[id]) continue;
      for (const [n, L] of adj[id]) {
        const nv = value(v, L, n);
        if (nv > best[n]) { best[n] = nv; push(n, nv); }
      }
    }
    return best;
  };
  const raised = [], sunk = [], held = [];
  const mine = new Set(lines);
  for (const f of fixes) {
    if (!f.v || !mine.has(f.owner.line)) continue;
    const i = f.owner.line.indexOf(f.v);
    const id = idOf(f.owner.line, i);
    if (f.lift > 0) raised.push([id, f.lift]);
    else if (f.lift < 0) sunk.push([id, -f.lift]);
    else held.push([id, 0]);
  }
  for (const n of heldNodes) if (verts.has(`n${n}`)) held.push([verts.get(`n${n}`), 0]);
  // how far below its cap each vertex must stay: RAMP x its distance from the nearest one held at grade, as a "height"
  // spreading down from a large value
  const BIG = 1000;
  const fromHeld = spread(held.map(([id]) => [id, BIG]), (v, L) => v - RAMP * L);
  const capOf = (id) => (fromHeld[id] > 0 ? BIG - fromHeld[id] : Infinity);
  // (each step held to its vertex's cap, so nothing climbs on through a vertex kept at grade; the cuts' depths alike)
  const ramp = (seeds) => spread(seeds.map(([id, v]) => [id, Math.min(v, capOf(id))]), (v, L, n) => Math.min(v - RAMP * L, capOf(n)));
  const up = ramp(raised), deep = ramp(sunk);
  return (line, i) => {
    const id = idOf(line, i);
    const l = Math.max(0, Math.min(up[id], capOf(id))), s = Math.max(0, Math.min(deep[id], capOf(id)));
    return l >= s ? l : -s;
  };
}
const nodeOfDraft = new Map();
for (const d of linkDrafts) nodeOfDraft.set(d.line, d);
const roadLift = solveLifts(linkDrafts.map((d) => d.line), (line, i) => {
  const d = nodeOfDraft.get(line);
  return i === 0 ? d.a : i === line.length - 1 ? d.b : null;
}, heldJunctions);
const railLift = solveLifts(railLines.map((r) => r.line), null);
for (const d of linkDrafts) d.lifts = d.line.map((_, i) => Math.round(roadLift(d.line, i) * 10));
// A sunk road as wide as its cut can be between the roads beside it: OpenStreetMap draws Insurgentes' four roadways
// through the underpass ~5 m apart, each tagged 10 m wide, so the cut would swallow the laterales at grade on either
// side and the traffic's lanes would run on top of each other. Wherever it is down in its cut (its ramps' tails too,
// which would widen the cut they open into), each roadway keeps clear of the lanes of the roads alongside it at grade
// (and of the wall, CUT_SIDE) and of half the gap to another one sunk beside it, down to one lane.
const CUT_SIDE = 0.9; // m from the roadway's edge to the lanes beyond the cut's wall (the shoulder, the wall)
const LANE_MIN = 3.2;
for (const d of linkDrafts) {
  if (!d.lifts.some((v) => v < 0)) continue;
  let half = d.spec.w / 2;
  const x0 = Math.min(...d.line.map((p) => p[0])) - 25, x1 = Math.max(...d.line.map((p) => p[0])) + 25;
  const z0 = Math.min(...d.line.map((p) => p[1])) - 25, z1 = Math.max(...d.line.map((p) => p[1])) + 25;
  const near = linkDrafts.filter((o) => o !== d && o.a !== d.a && o.a !== d.b && o.b !== d.a && o.b !== d.b && o.line.some((p) => p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1));
  for (let i = 0; i + 1 < d.line.length; i++) {
    const [ax, az] = d.line[i], [bx, bz] = d.line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let k = 0; k <= Math.ceil(L / 4); k++) {
      const f = Math.min(1, (k * 4) / L);
      if (d.lifts[i] + (d.lifts[i + 1] - d.lifts[i]) * f >= 0) continue;
      const px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
      for (const o of near) {
        const sunk = o.lifts.some((v) => v < 0);
        for (let j = 0; j + 1 < o.line.length; j++) {
          const [cx, cz] = o.line[j], [ex, ez] = o.line[j + 1];
          const M = Math.hypot(ex - cx, ez - cz);
          if (M < 0.5 || Math.abs(((ex - cx) * ux + (ez - cz) * uz) / M) < 0.85) continue; // (alongside it, not across)
          const t = ((px - cx) * (ex - cx) + (pz - cz) * (ez - cz)) / (M * M);
          if (t < 0 || t > 1) continue; // (beside it, not on past its end: the same road's next link ahead)
          const dist = Math.hypot(px - cx - (ex - cx) * t, pz - cz - (ez - cz) * t);
          if (dist > 20) continue;
          // (the lanes of a road at grade: as many as its width takes, 3.5 m each, about its centreline)
          const lanesOut = Math.min(o.spec.w / 2, (o.spec.dir === 0 ? Math.max(2, o.spec.lanes) : o.spec.lanes) * 1.75);
          half = Math.min(half, sunk ? dist / 2 - 0.1 : dist - lanesOut - CUT_SIDE);
        }
      }
    }
  }
  half = Math.max(LANE_MIN / 2, half);
  if (half < d.spec.w / 2 - 0.05) {
    const w = Math.round(half * 20) / 10;
    d.spec = { ...d.spec, w, lanes: Math.max(1, Math.min(d.spec.lanes, Math.floor(w / LANE_MIN))) };
  }
}
let raisedLinks = 0, raisedLen = 0, sunkLinks = 0, sunkLen = 0;
for (const d of linkDrafts) {
  const lifts = d.lifts;
  const inner = d.line.slice(1, -1).flatMap(([x, z]) => [q(x), q(z)]);
  const any = lifts.some((v) => v !== 0);
  if (lifts.some((v) => v > 0)) raisedLinks++;
  if (lifts.some((v) => v < 0)) sunkLinks++;
  for (let i = 0; i + 1 < d.line.length; i++) {
    const L = Math.hypot(d.line[i + 1][0] - d.line[i][0], d.line[i + 1][1] - d.line[i][1]);
    if (lifts[i] > 0 || lifts[i + 1] > 0) raisedLen += L;
    if (lifts[i] < 0 || lifts[i + 1] < 0) sunkLen += L;
  }
  // [a, b, name, width, lanes, dir, inner, lifts (dm over the ground at a, inner..., b; < 0 down in a cut) or 0,
  //  way (1: a bridge way, 2: a tunnel way, 0 neither)]
  links.push([d.a, d.b, d.ni, d.spec.w, d.spec.lanes, d.spec.dir, inner, any ? lifts : 0, d.bridge ? 1 : d.tunnel ? 2 : 0]);
}
const rails = railLines.map((r) => {
  const lifts = r.line.map((_, i) => Math.round(railLift(r.line, i) * 10));
  return [flat(r.line), lifts.some((v) => v > 0) ? lifts : 0, r.bridge ? 1 : 0, r.main ? 1 : 0];
});
log(`bridges: ${raisedLinks} links raised over ${(raisedLen / 1000).toFixed(1)} km (overpasses & their ramps), ${sunkLinks} sunk over ${(sunkLen / 1000).toFixed(1)} km (underpasses); ${rails.length} rail lines, ${(railLines.reduce((t, r) => t + r.line.reduce((s2, p, i, a) => s2 + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0), 0) / 1000).toFixed(1)} km`);
log(`road graph: ${gnodes.length} nodes, ${links.length} links, ${names.length} street names`);

// =====================================================================================================================
// 3C. FOOTBRIDGES: the pedestrian bridges over the roads (the puentes peatonales: OSM footway, path, cycleway bridge
//     ways crossing a road or the railway at grade), their deck held high enough over everything they cross; a flight
//     of stairs down at either end once the buildings are known (7, footbridgeStairs: OpenStreetMap draws the span, rarely
//     the stairs)
// =====================================================================================================================
const FOOT_CLEARANCE = 5.5; // m: headroom under a puente peatonal (the SCT's 5.5 m over a road)
const FOOT_DECK = 0.6; // m: its deck's depth, walkway to soffit
const STAIR = 0.62; // the stairs' rise over run (~32°)
const FOOT_CURB = 1.0; // m: the deck reaches this far past the roadway's edge before its stairs start down
const FOOT_WAY = /^(footway|path|pedestrian|cycleway|steps)$/;
const footDecks = []; // { deck: points along the way between the stairs' tops, out: [unit heading away from the deck at
// its start, at its end], half: half its width (m) }
const footOthers = []; // { line, half }: the bridge ways over no road (over the arroyos & drains, see 6C)
{
  // the bridge ways, joined end to end into whole bridges where OSM splits one (at a median, at a lamp)
  const pieces = ways.filter((w) => FOOT_WAY.test(w.tags.highway) && w.tags.bridge && w.tags.bridge !== 'no' && (num(w.tags.layer) ?? 1) > 0)
    .map((w) => ({ keys: [nodeKey(w.geometry[0]), nodeKey(w.geometry[w.geometry.length - 1])], pts: w.geometry.map((g) => toWorld(g.lon, g.lat)), wide: w.tags.highway === 'cycleway' || w.tags.highway === 'pedestrian' }));
  const ends = new Map();
  for (const p of pieces) for (const k of p.keys) ends.set(k, (ends.get(k) || []).concat([p]));
  const used = new Set();
  const chains = [];
  for (const start of pieces) {
    if (used.has(start)) continue;
    used.add(start);
    let pts = start.pts.slice(), keys = start.keys.slice(), wide = start.wide;
    // grow it at either end while exactly one other bridge way carries on from there
    for (const atEnd of [true, false]) {
      for (;;) {
        const k = atEnd ? keys[1] : keys[0];
        const next = (ends.get(k) || []).filter((p) => p !== start && !used.has(p));
        if (next.length !== 1 || (ends.get(k) || []).length !== 2) break;
        const p = next[0];
        used.add(p);
        wide ||= p.wide;
        const fwd = p.keys[0] === k ? p.pts : p.pts.slice().reverse();
        const far = p.keys[0] === k ? p.keys[1] : p.keys[0];
        if (atEnd) { pts = pts.concat(fwd.slice(1)); keys[1] = far; } else { pts = fwd.slice().reverse().concat(pts.slice(1)); keys[0] = far; }
      }
    }
    chains.push({ pts, wide });
  }
  const walk = (line) => line.map((_, i) => line.slice(1, i + 1).reduce((s, p, j) => s + Math.hypot(p[0] - line[j][0], p[1] - line[j][1]), 0));
  const atS = (line, cum, s) => {
    // the point s m along the line, carried on straight past either end
    const n = line.length - 1;
    const i = s <= 0 ? 0 : s >= cum[n] ? n - 1 : cum.findIndex((c, k) => k > 0 && c >= s) - 1;
    const L = cum[i + 1] - cum[i] || 1;
    const f = (s - cum[i]) / L;
    return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
  };
  let deckLen = 0;
  for (const chain of chains) {
    for (const piece of clipChain(chain.pts)) {
      const line = rdp(piece, 0.3);
      if (line.length < 2) continue;
      const owner = { id: `foot${footDecks.length}`, line };
      const cum = walk(line);
      const half = chain.wide ? 1.5 : 1.2;
      // where along it each road (or the track) at grade under it begins and ends, and what it must clear there
      // (a bridge over a stream that clips a side street's corner is no puente peatonal: it takes a main road or the
      // track under it, and then it spans whatever else it crosses, the laterales beside the road too)
      let s0 = Infinity, s1 = -Infinity, main = false;
      for (const c of crossings(owner)) {
        const o = c.other;
        // (a road on a deck or down a cut passes over or under it already: lifts in dm)
        if (o.spec ? o.bridge || o.tunnel || Math.abs(o.lifts[c.j] + (o.lifts[c.j + 1] - o.lifts[c.j]) * c.u) > 5 : o.bridge) continue;
        const a = line[c.i], b = line[c.i + 1], p = o.line[c.j], q2 = o.line[c.j + 1];
        const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lo = Math.hypot(q2[0] - p[0], q2[1] - p[1]);
        const sin = Math.abs(((b[0] - a[0]) * (q2[1] - p[1]) - (b[1] - a[1]) * (q2[0] - p[0])) / (la * lo || 1));
        if (sin < 0.25) continue; // (alongside, not across)
        const cos = Math.sqrt(1 - sin * sin);
        const roadHalf = o.spec ? o.spec.w / 2 : 2.5;
        const s = cum[c.i] + la * c.t;
        const reach = (roadHalf + FOOT_CURB + half * cos) / sin;
        s0 = Math.min(s0, s - reach);
        s1 = Math.max(s1, s + reach);
        main ||= !o.spec || /^(motorway|trunk|primary|secondary|tertiary)/.test(o.spec.hw);
      }
      if (!(s1 > s0)) footOthers.push({ line, half });
      if (!main || !(s1 > s0)) continue;
      // the deck from s0 to s1 along the way (the way's own hooks onto the paths beside it left out), and which way
      // it heads at either end: its first and last 3 m

      const along = (sa, sb) => {
        const p = atS(line, cum, sa), q2 = atS(line, cum, sb);
        const L = Math.hypot(q2[0] - p[0], q2[1] - p[1]) || 1;
        return [(q2[0] - p[0]) / L, (q2[1] - p[1]) / L];
      };
      const t0 = atS(line, cum, s0), t1 = atS(line, cum, s1);
      const inset = Math.min(3, (s1 - s0) / 2);
      const d0 = along(s0, s0 + inset), d1 = along(s1 - inset, s1);
      const deck = [t0, ...cum.flatMap((s, i) => (s > s0 + 0.3 && s < s1 - 0.3 ? [line[i]] : [])), t1];
      footDecks.push({ deck, out: [[-d0[0], -d0[1]], d1], half });
      deckLen += s1 - s0;
    }
  }
  log(`footbridges: ${footDecks.length} over the roads (${chains.length} bridge ways joined), ${(deckLen / 1000).toFixed(2)} km of deck`);
}

// Traffic signals on drivable streets
const poisOSM = load('osm_tepic_pois.json');
const signals = [];
for (const e of poisOSM.elements) {
  if (e.type !== 'node' || !e.tags || e.tags.highway !== 'traffic_signals') continue;
  const p = nodeWorld.get(nodeKey(e)) || toWorld(e.lon, e.lat);
  if (inBox(p[0], p[1])) signals.push(q(p[0]), q(p[1]));
}
log(`${signals.length / 2} traffic signals`);
// The pedestrian crossings on the drivable streets (OSM highway=crossing, a node of the street's way): [x, z, kind]
// each, flat; kind 0 unmarked, 1 marked (crossing=zebra | marked | uncontrolled, or its crossing:markings), 2 with
// lights (crossing=traffic_signals, crossing:signals=yes). A crossing's lights not mapped as a signal of their own
// stop the traffic as one (js/world/road-network.ts makes them a stop along the street)
const pedCrossings = [];
{
  const tally = { kinds: [0, 0, 0], off: 0, lights: 0 };
  for (const e of poisOSM.elements) {
    const t = e.tags;
    if (e.type !== 'node' || !t || t.highway !== 'crossing') continue;
    const p = nodeWorld.get(nodeKey(e));
    if (!p || !inBox(p[0], p[1])) { tally.off++; continue; } // (on a footway, a track, a service road; or off the box)
    const markings = t['crossing:markings'];
    const kind = t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes' ? 2
      : /^(zebra|marked|uncontrolled)$/.test(t.crossing || '') || (markings && markings !== 'no') ? 1 : 0;
    tally.kinds[kind]++;
    pedCrossings.push(q(p[0]), q(p[1]), kind);
    if (kind === 2) {
      let near = false;
      for (let i = 0; i < signals.length && !near; i += 2) near = Math.hypot(signals[i] - p[0], signals[i + 1] - p[1]) < 15;
      if (!near) { signals.push(q(p[0]), q(p[1])); tally.lights++; }
    }
  }
  log(`pedestrian crossings: ${pedCrossings.length / 3} on the streets (${tally.kinds[0]} unmarked, ${tally.kinds[1]} marked, ${tally.kinds[2]} with lights, ${tally.lights} of those made signals), ${tally.off} off them`);
}
// The bus stops (OSM highway=bus_stop, public_transport=platform: the camiones' & combis' paradas on the sidewalk;
// the stop positions on the roadway only where no stop is mapped beside them): [x, z, flags] each, flat; flags 1 a
// shelter (shelter=yes, or not said: Tepic's paradas mostly have their parabús), 2 a bench (bench=yes, or not said
// under a shelter). Two within STOP_SAME m are one stop
const detailsOSM = load('osm_tepic_details.json');
const busStops = [];
{
  const STOP_SAME = 12;
  const tally = { stops: 0, merged: 0, off: 0 };
  const isStop = (t) => t.highway === 'bus_stop' || t.public_transport === 'platform';
  const at = (e) => (e.type === 'node' ? [e.lon, e.lat] : e.geometry?.length
    ? [e.geometry.reduce((s, g) => s + g.lon, 0) / e.geometry.length, e.geometry.reduce((s, g) => s + g.lat, 0) / e.geometry.length] : null);
  const stops = [];
  for (const pass of [0, 1]) {
    for (const e of detailsOSM.elements) {
      const t = e.tags || {};
      if (pass === 0 ? !isStop(t) : t.public_transport !== 'stop_position' || isStop(t)) continue;
      const ll = at(e);
      if (!ll) continue;
      const [x, z] = toWorld(...ll);
      if (!inBox(x, z)) { tally.off++; continue; }
      const same = stops.find((s) => Math.hypot(s.x - x, s.z - z) < STOP_SAME);
      const shelter = t.shelter === 'yes' || (t.shelter !== 'no' && pass === 0);
      const bench = t.bench === 'yes' || (t.bench !== 'no' && shelter);
      if (same) {
        // (a stop's node and its platform's: what either says of it)
        same.shelter = (same.shelter || t.shelter === 'yes') && t.shelter !== 'no';
        same.bench = same.bench || t.bench === 'yes';
        tally.merged++;
        continue;
      }
      stops.push({ x, z, shelter, bench });
    }
  }
  for (const s of stops) busStops.push(q(s.x), q(s.z), (s.shelter ? 1 : 0) | (s.bench ? 2 : 0));
  log(`bus stops: ${stops.length} (${stops.filter((s) => s.shelter).length} with a shelter, ${stops.filter((s) => s.bench).length} with a bench), ${tally.merged} more points of the same stops, ${tally.off} off the box`);
}
// The speed bumps (OSM traffic_calming=*: a node of the street's way, or a way across it, a raised crossing's table):
// [x, z, kind] each, flat; kind 0 a bump or hump (the topes), 1 a table, 2 a cushion, 3 a rumble strip
const topes = [];
{
  const KINDS = { bump: 0, hump: 0, yes: 0, table: 1, cushion: 2, rumble_strip: 3 };
  const tally = { off: 0, other: 0 };
  for (const e of detailsOSM.elements) {
    const t = e.tags || {};
    if (!t.traffic_calming) continue;
    const kind = KINDS[t.traffic_calming];
    if (kind === undefined) { tally.other++; continue; } // (chicanes, islands, choked lanes: no hump)
    const g = e.type === 'node' ? [e] : e.geometry || [];
    if (!g.length) continue;
    const p = (e.type === 'node' && nodeWorld.get(nodeKey(e))) || toWorld(g.reduce((s, n) => s + n.lon, 0) / g.length, g.reduce((s, n) => s + n.lat, 0) / g.length);
    if (!inBox(p[0], p[1])) { tally.off++; continue; }
    topes.push(q(p[0]), q(p[1]), kind);
  }
  log(`speed bumps: ${topes.length / 3} mapped in the box, ${tally.off} off it, ${tally.other} of other kinds`);
}
// The trees OpenStreetMap maps one by one (natural=tree) and the rows of them (natural=tree_row, a tree every
// TREE_ROW_STEP m along): [x, z, kind] each, flat; kind 0 a lone tree, 1 one of a row. (Tepic's say no species)
const mappedTrees = [];
{
  const TREE_ROW_STEP = 7;
  const tally = { lone: 0, rows: 0, inRows: 0, off: 0 };
  for (const e of detailsOSM.elements) {
    if (e.type !== 'node' || e.tags?.natural !== 'tree') continue;
    const [x, z] = toWorld(e.lon, e.lat);
    if (!inBox(x, z)) { tally.off++; continue; }
    mappedTrees.push(q(x), q(z), 0);
    tally.lone++;
  }
  for (const e of landOSM.elements) {
    if (e.type !== 'way' || e.tags?.natural !== 'tree_row' || !e.geometry) continue;
    const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
    tally.rows++;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / TREE_ROW_STEP));
      for (let k = i ? 1 : 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (!inBox(x, z)) continue;
        mappedTrees.push(q(x), q(z), 1);
        tally.inRows++;
      }
    }
  }
  log(`trees: ${tally.lone} mapped one by one, ${tally.inRows} along ${tally.rows} rows, ${tally.off} off the box`);
}
// The street lamps OpenStreetMap maps (highway=street_lamp): x, z each, flat
const streetLamps = [];
for (const e of poisOSM.elements) {
  if (e.type !== 'node' || e.tags?.highway !== 'street_lamp') continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (inBox(x, z)) streetLamps.push(q(x), q(z));
}
log(`street lamps: ${streetLamps.length / 2} mapped`);
// The high-voltage lines (OSM power=line: the CFE's 115, 230 & 400 kV lines over the valley and the hills; Tepic maps
// no distribution lines or poles), their towers at the ways' points: [kV (0 not said), flat points], each run of a
// way inside the hills' grid (5D: TX0..TX1, TZ0..TZ1) one line
const powerLines = [];
{
  const GRID = { x0: -16900, x1: 20900, z0: -15900, z1: 20900 }; // (5D's grid, a cell in)
  const inGrid = ([x, z]) => x >= GRID.x0 && x <= GRID.x1 && z >= GRID.z0 && z <= GRID.z1;
  let km = 0, towers = 0;
  for (const e of detailsOSM.elements) {
    const t = e.tags || {};
    if (e.type !== 'way' || t.power !== 'line' || !e.geometry) continue;
    const kv = Math.round((num(String(t.voltage || '').split(';')[0]) ?? 0) / 1000);
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        powerLines.push([kv, flat(run)]);
        towers += run.length;
        for (let i = 1; i < run.length; i++) km += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]) / 1000;
      }
      run = [];
    };
    for (const g of e.geometry) {
      const p = toWorld(g.lon, g.lat);
      if (inGrid(p)) run.push(p);
      else flush();
    }
    flush();
  }
  log(`power lines: ${powerLines.length} runs, ${km.toFixed(0)} km, ${towers} towers`);
}

// =====================================================================================================================
// 4. BLOCKS: the box minus every roadway (and the things that cut blocks without carrying traffic)
// =====================================================================================================================
const SIDEWALK = 2.2; // property line in from the curb (Tepic's banquetas)
const RES = 1;
const X0 = BOX.x0, Z0 = BOX.z0;
const W = Math.ceil((BOX.x1 - BOX.x0) / RES), H = Math.ceil((BOX.z1 - BOX.z0) / RES);
const land = new Uint8Array(W * H).fill(1);
const cutters = [];
for (const w of ways) {
  const hw = w.tags.highway;
  const r = hw === 'pedestrian' ? 3 : hw === 'service' && w.tags.service !== 'parking_aisle' && w.tags.service !== 'driveway' && w.tags.name ? 2.8 : 0;
  if (!r) continue;
  const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
  for (let i = 0; i + 1 < pts.length; i++) cutters.push({ x0: pts[i][0], z0: pts[i][1], x1: pts[i + 1][0], z1: pts[i + 1][1], r });
}
const bldOSM = load('osm_tepic_buildings.json');
// The rivers, arroyos, canals & drains (OSM waterway=*, drawn downstream), for the maps and the channels cut in the
// ground (js/world/waterways.js): [kind, half-width of the gap left between the blocks (m, 0: none), name, flags
// (1 intermittent, 2 underground: a culvert or tunnel), flat points]
const WATERWAY = /^(river|stream|canal|drain|ditch)$/;
const LINED_HALF = { canal: 3.5, drain: 2.2, ditch: 1.4 }; // m: the gap the blocks leave a concrete-lined channel, either side
const waterways = [];
// A canal's, drain's or ditch's stretch running along a street, within its width and the channel's of the roadway's
// edge: a roadside drain under the sidewalk or the street's own gutter as OpenStreetMap draws it, not a channel through
// the blocks beside it (its gap would take the sidewalk and the houses' fronts)
const DRIVE_CELL = 50;
const driveCells = new Map();
for (const r of drivePieces) {
  for (let ix = Math.floor((Math.min(r.x0, r.x1) - r.r) / DRIVE_CELL); ix <= Math.floor((Math.max(r.x0, r.x1) + r.r) / DRIVE_CELL); ix++) {
    for (let iz = Math.floor((Math.min(r.z0, r.z1) - r.r) / DRIVE_CELL); iz <= Math.floor((Math.max(r.z0, r.z1) + r.r) / DRIVE_CELL); iz++) {
      const k = ix * 100003 + iz;
      if (!driveCells.has(k)) driveCells.set(k, []);
      driveCells.get(k).push(r);
    }
  }
}
const alongStreet = (a, b, half) => {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (const r of driveCells.get(Math.floor(mx / DRIVE_CELL) * 100003 + Math.floor(mz / DRIVE_CELL)) || []) {
    const ux = r.x1 - r.x0, uz = r.z1 - r.z0, M = Math.hypot(ux, uz) || 1;
    if (Math.abs(((b[0] - a[0]) * ux + (b[1] - a[1]) * uz) / (L * M)) < 0.85) continue; // (across it: a culvert's)
    const t = Math.max(0, Math.min(1, ((mx - r.x0) * ux + (mz - r.z0) * uz) / (M * M)));
    if (Math.hypot(r.x0 + ux * t - mx, r.z0 + uz * t - mz) < r.r + half + 1) return true;
  }
  return false;
};
for (const e of landOSM.elements) {
  if (e.type !== 'way' || !e.geometry || !e.tags) continue;
  const t = e.tags;
  const underground = !!t.tunnel || t.location === 'underground';
  // (the canals, drenes & ditches open to the sky: OSM's width where it gives one, else as the kind usually runs)
  const lined = !underground && LINED_HALF[t.waterway] ? Math.min(8, Math.max(LINED_HALF[t.waterway], (num(t.width) ?? 0) / 2 + 0.6)) : 0;
  const r = t.railway === 'rail' ? 5 : t.waterway === 'river' ? 6 : t.waterway === 'stream' ? 2.5 : lined;
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  const flags = (t.intermittent === 'yes' || t.seasonal === 'yes' ? 1 : 0) | (underground ? 2 : 0);
  if (lined) {
    // in runs open (a gap and a channel) and along a street (neither)
    for (const piece of clipChain(pts)) {
      let run = [piece[0]], side = null;
      const flush = () => { if (run.length > 1) waterways.push([t.waterway, side ? 0 : r, t.name || '', flags, flat(rdp(run, 0.5))]); };
      for (let i = 0; i + 1 < piece.length; i++) {
        const along = alongStreet(piece[i], piece[i + 1], r);
        if (side !== null && along !== side) { flush(); run = [piece[i]]; }
        side = along;
        run.push(piece[i + 1]);
        if (!along) cutters.push({ x0: piece[i][0], z0: piece[i][1], x1: piece[i + 1][0], z1: piece[i + 1][1], r });
      }
      flush();
    }
    continue;
  }
  if (WATERWAY.test(t.waterway || '')) {
    for (const piece of clipChain(pts)) waterways.push([t.waterway, r, t.name || '', flags, flat(rdp(piece, 0.5))]);
  }
  if (!r) continue;
  for (let i = 0; i + 1 < pts.length; i++) cutters.push({ x0: pts[i][0], z0: pts[i][1], x1: pts[i + 1][0], z1: pts[i + 1][1], r });
}
// The rivers' whole courses (the Mololoa on down the valley, the Río Puente de Enmedio, the Arroyo Grande), for the
// stretches beyond the detailed box: water laid on the hills' terrain (js/world/terrain.ts buildFarRivers)
const farRivers = landOSM.elements.filter((e) => e.type === 'way' && e.geometry && e.tags?.waterway === 'river' && !e.tags.tunnel)
  .map((e) => [e.tags.name || '', e.geometry.map((g) => toWorld(g.lon, g.lat))])
  .filter(([, pts]) => pts.some(([x, z]) => !inBox(x, z)))
  .map(([name, pts]) => [name, flat(rdp(pts, 1.5))]);
log(`${waterways.length} waterways (${waterways.filter((w) => w[0] === 'river').length} river pieces, ${waterways.filter((w) => LINED_HALF[w[0]] && w[1] > 0).length} open canals, drains & ditches)`);
// The airport (Aeropuerto Internacional de Tepic – Riviera Nayarit, MMEP; OSM aeroway=*): the runways & taxiways as
// centrelines with their widths (runway 02/20 is 45 m wide, its taxiways ~18 m), the aprons & helipads as rings. They
// are cut out of the blocks like roads, and js/world/airport.js lays their pavement & markings over the asphalt.
const airport = { name: '', runways: [], taxiways: [], aprons: [], helipads: [], gates: [] };
const airportRings = [];
const airfieldPieces = []; // (the runway & taxiways, which the hills are levelled under like the streets, 5D)
for (const e of landOSM.elements) {
  const a = e.type === 'way' && e.geometry && e.tags && e.tags.aeroway;
  if (!a) continue;
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!pts.some(([x, z]) => inBox(x, z))) continue;
  if (a === 'aerodrome') airport.name = e.tags.name || '';
  else if (a === 'runway' || a === 'taxiway') {
    const w = num(e.tags.width) || (a === 'runway' ? 45 : 18);
    for (const piece of clipChain(pts)) (a === 'runway' ? airport.runways : airport.taxiways).push([e.tags.ref || '', w, flat(rdp(piece, 0.3))]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const piece = { x0: pts[i][0], z0: pts[i][1], x1: pts[i + 1][0], z1: pts[i + 1][1], r: w / 2 + (a === 'runway' ? 4 : 1) };
      cutters.push(piece);
      airfieldPieces.push(piece);
    }
  } else if (a === 'jet_bridge' && pts.length > 1) {
    // a gate's boarding bridge: from the terminal to the aircraft's door
    const [p0, p1] = [pts[0], pts[pts.length - 1]];
    airport.gates.push([q(p0[0]), q(p0[1]), q(p1[0]), q(p1[1])]);
  } else if ((a === 'apron' || a === 'helipad') && pts.length > 3) {
    const ring = rdpRing(pts.slice(0, -1), 0.3);
    (a === 'apron' ? airport.aprons : airport.helipads).push(flat(ring));
    if (a === 'apron') airportRings.push(ring);
  }
}
log(`airport ${airport.name || '(none)'}: ${airport.runways.length} runway, ${airport.taxiways.length} taxiways, ${airport.aprons.length} aprons, ${airport.helipads.length} helipads`);
// The lakes, presas, ponds & reservoirs (OSM natural=water but for the rivers' own areas & the fountains, landuse=
// reservoir | basin): La Presa, Lago de Mora, Presa El Salto, the ponds of the colonias, the Humedal Colosio. Inside
// the box the blocks leave each a gap (its outline and LAKE_GAP m round it, as the rivers' channels), the ground is
// levelled under it (5D) and js/world/lakes.ts sinks a basin into it with the water in it; beyond the box, or up on
// the hills, the water is laid on the hillside (js/world/terrain.ts). [kind, name, flags (1 intermittent, 2 beyond
// the box: no gap, no basin; 4 up the hills: the ground not levelled), outline LAKE_SHORE m out from OSM's]
const LAKE_GAP = 1.5, LAKE_SHORE = 1.0;
const LAKE_MIN = 150; // m²: a smaller pond is a garden's
const lakeKind = (water, name, area) => {
  if (/^(lake|lagoon|oxbow)$/.test(water)) return 'lake';
  if (/^rese/.test(water)) return 'reservoir'; // (one is tagged 'rese{')
  if (water === 'wetland') return 'wetland';
  if (water === 'pond' || water === 'basin') return 'pond';
  return /\bpresa\b/i.test(name) ? 'reservoir' : area > 15000 ? 'lake' : 'pond';
};
const lakes = []; // { kind, name, flags, ring (OSM's), shore (LAKE_SHORE m out) }
const lakeDropped = { small: 0, open: 0 };
for (const e of landOSM.elements) {
  const t = e.tags || {};
  const water = t.natural === 'water' ? t.water || '' : /^(reservoir|basin)$/.test(t.landuse || '') ? t.landuse : null;
  if (water === null || /^(river|stream|canal|ditch|drain|fountain|moat|wastewater)$/.test(water)) continue;
  const rings = elemRings(e);
  if (!rings.length) { lakeDropped.open++; continue; }
  for (const raw of rings) {
    const area = Math.abs(ringArea(raw));
    if (area < LAKE_MIN) { lakeDropped.small++; continue; }
    const ring = rdpRing(raw, 0.5);
    const kind = lakeKind(water, t.name || '', area);
    const flags = (t.intermittent === 'yes' || t.seasonal === 'yes' ? 1 : 0) | (ring.every(([x, z]) => inBox(x, z)) ? 0 : 2);
    lakes.push({ kind, name: t.name || '', flags, ring, shore: insetRing(ring, -LAKE_SHORE) });
  }
}
{
  const kinds = {};
  for (const l of lakes) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
  log(`lakes: ${lakes.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${lakes.filter((l) => !(l.flags & 2)).length} in the box; dropped ${lakeDropped.small} under ${LAKE_MIN} m², ${lakeDropped.open} not closed`);
}
// the cells inside a ring (their centres), in turn
function ringRows(ring, fn) {
  const bb = bbox(ring);
  for (let j = Math.max(0, Math.floor((bb.z0 - Z0) / RES)); j <= Math.min(H - 1, Math.ceil((bb.z1 - Z0) / RES)); j++) {
    const z = Z0 + (j + 0.5) * RES;
    const xs = [];
    for (let a = 0, k = ring.length - 1; a < ring.length; k = a++) {
      const [xa, za] = ring[k], [xb, zb] = ring[a];
      if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((p, q) => p - q);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      for (let i = Math.max(0, Math.ceil((xs[n] - X0) / RES - 0.5)); i <= Math.min(W - 1, Math.floor((xs[n + 1] - X0) / RES - 0.5)); i++) fn(j * W + i);
    }
  }
}
for (const s of drivePieces) clearCapsule(land, W, H, X0, Z0, RES, s);
for (const s of cutters) clearCapsule(land, W, H, X0, Z0, RES, s);
// (the aprons too: the cells whose centres lie inside their rings)
for (const ring of airportRings) ringRows(ring, (k) => { land[k] = 0; });
// (and the lakes in the box, with their gap; marked, as no roadway: 5D's town is its streets & houses)
const lakeCell = new Uint8Array(W * H);
for (const l of lakes) {
  if (l.flags & 2) continue;
  ringRows(insetRing(l.ring, -LAKE_GAP), (k) => { if (land[k]) { land[k] = 0; lakeCell[k] = 1; } });
}
// A lake enclosed by one block would be cut open by extractBlocks with a 1 m slot straight north, which the block's
// simplified outline folds over (its fill then spans the lake): each such lake is opened instead along the shortest
// straight way to a roadway, LAKE_OPENING m wide (a lane down to the water)
const LAKE_OPENING = 5;
{
  let opened = 0;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const l of lakes) {
    if (l.flags & 2) continue;
    const bb = bbox(insetRing(l.ring, -LAKE_GAP));
    const i0 = Math.max(1, Math.floor((bb.x0 - X0) / RES) - 1), i1 = Math.min(W - 2, Math.ceil((bb.x1 - X0) / RES) + 1);
    const j0 = Math.max(1, Math.floor((bb.z0 - Z0) / RES) - 1), j1 = Math.min(H - 2, Math.ceil((bb.z1 - Z0) / RES) + 1);
    let touches = false;
    let best = null;
    for (let j = j0; j <= j1 && !touches; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      if (!lakeCell[k]) continue;
      // (already open to a roadway beside it: nothing to cut)
      for (const n of [k - 1, k + 1, k - W, k + W, k - W - 1, k - W + 1, k + W - 1, k + W + 1]) if (!land[n] && !lakeCell[n]) touches = true;
      if (touches) break;
      for (const [di, dj] of DIRS) {
        if (!land[k + dj * W + di]) continue; // (the way out starts on land)
        let n = 1;
        for (let a = i + di, b = j + dj; a > 0 && b > 0 && a < W - 1 && b < H - 1 && land[b * W + a]; a += di, b += dj) n++;
        if (!best || n < best.n) best = { i, j, di, dj, n };
      }
    }
    if (touches || !best || best.n > 400) continue;
    const { i, j, di, dj, n } = best;
    const half = Math.floor(LAKE_OPENING / RES / 2);
    for (let s = 0; s <= n; s++) for (let w = -half; w <= half; w++) {
      const a = i + di * s + dj * w, b = j + dj * s + di * w;
      if (a > 0 && b > 0 && a < W - 1 && b < H - 1) land[b * W + a] = 0;
    }
    opened++;
  }
  log(`lakes: ${opened} enclosed by a block opened onto the street`);
}
log(`${drivePieces.length} roadway pieces and ${cutters.length} other cuts stamped on a ${W} x ${H} raster`);
// Urban or open country: the share of each island under built-up land use (OSM landuse=residential & co., schools,
// building footprints) against fields, woods & scrub. Small islands are always city blocks.
const URBAN_USE = (t) => /^(residential|commercial|retail|industrial|education|institutional|religious|construction|garages)$/.test(t.landuse || '') ||
  /^(school|university|college|hospital|marketplace|bus_station|place_of_worship|parking)$/.test(t.amenity || '');
const RURAL_USE = (t) => /^(farmland|meadow|orchard|forest|grass|greenfield|quarry|plant_nursery|vineyard|farmyard)$/.test(t.landuse || '') ||
  /^(wood|scrub|grassland|heath|wetland|bare_rock)$/.test(t.natural || '');
function classify(comps, labels) {
  const urban = new Map();
  const green = new Map();
  const r = { lab: labels, w: W, h: H, x0: X0, z0: Z0, res: RES };
  const tally = (map, ring) => ringCells(ring, r, (L) => map.set(L, (map.get(L) || 0) + 1));
  for (const e of landOSM.elements) {
    const t = e.tags || {};
    const u = URBAN_USE(t), g = !u && RURAL_USE(t);
    if (!u && !g) continue;
    for (const ring of elemRings(e)) tally(u ? urban : green, ring);
  }
  for (const e of bldOSM.elements) for (const ring of elemRings(e)) tally(urban, ring);
  const out = new Set();
  // The islets in the lakes (the Humedal Colosio's: OSM's shore runs out round them and back): an island whose edge
  // is mostly lake is open ground, never a block of houses or a paved plaza
  const shoreEdge = new Map(), roadEdge = new Map();
  const comp = new Map(comps.map((c) => [c.id, c]));
  for (const l of lakes) {
    if (l.flags & 2) continue;
    const bb = bbox(l.ring);
    const i0 = Math.max(1, Math.floor((bb.x0 - X0) / RES) - 8), i1 = Math.min(W - 2, Math.ceil((bb.x1 - X0) / RES) + 8);
    const j0 = Math.max(1, Math.floor((bb.z0 - Z0) / RES) - 8), j1 = Math.min(H - 2, Math.ceil((bb.z1 - Z0) / RES) + 8);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i, L = labels[k];
      if (L <= 0) continue;
      // (only an island the window holds whole: its edge all counted)
      const c = comp.get(L);
      if (!c || c.i0 < i0 || c.i1 > i1 || c.j0 < j0 || c.j1 > j1) continue;
      for (const n of [k - 1, k + 1, k - W, k + W]) {
        if (labels[n] > 0) continue;
        const m = lakeCell[n] ? shoreEdge : roadEdge;
        m.set(L, (m.get(L) || 0) + 1);
      }
    }
  }
  let islets = 0;
  for (const [L, n] of shoreEdge) if (n > 2 * (roadEdge.get(L) || 0)) { out.add(L); islets++; }
  if (islets) log(`lakes: ${islets} islets left open`);
  for (const c of comps) {
    const ha = (c.n * RES * RES) / 10000;
    if (ha < 1.5) continue;
    const us = (urban.get(c.id) || 0) / c.n;
    const gs = (green.get(c.id) || 0) / c.n;
    if ((ha > 4 && us < 0.25) || (ha > 60 && us < 0.6) || gs > 0.5) out.add(c.id);
  }
  return out;
}
const { blocks, lab, prop } = extractBlocks({ land, w: W, h: H, x0: X0, z0: Z0, res: RES, sidewalk: SIDEWALK, classify });
// the raster cell under world (x, z) (-1 off the raster), the block label there (0: a roadway or off the raster) and
// whether it lies inside a property line
const cellAt = (x, z) => {
  const i = Math.floor((x - X0) / RES), j = Math.floor((z - Z0) / RES);
  return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
};
const labAt = (x, z) => { const k = cellAt(x, z); return k < 0 ? 0 : lab[k]; };
const propAt = (x, z) => { const k = cellAt(x, z); return k < 0 ? 0 : prop[k]; };

// --- Parks, pitches, schoolyards, scrub & water onto the blocks ---------------------------------------------------------
function elemRings(e) {
  if (e.type === 'way') {
    const r = (e.geometry || []).map((g) => toWorld(g.lon, g.lat));
    return r.length > 3 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5 ? [r.slice(0, -1)] : [];
  }
  const parts = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => toWorld(g.lon, g.lat)));
  return stitch(parts).filter((r) => r.pts.length > 3).map((r) => (r.closed ? r.pts.slice(0, -1) : r.pts));
}
// Polylines [[x, z], ...] joined end to end where they meet (within 0.5 m), either way round: [{ pts, closed }], a
// closed one ending on its first point (a relation's outer ring, a roundabout drawn as several ways)
function stitch(parts) {
  parts = parts.slice();
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  const out = [];
  while (parts.length) {
    let pts = parts.shift();
    for (let guard = 0; guard < 500 && !close(pts[0], pts[pts.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], pts[pts.length - 1]) || close(p[p.length - 1], pts[pts.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      pts = pts.concat(close(p[0], pts[pts.length - 1]) ? p.slice(1) : p.slice().reverse().slice(1));
    }
    out.push({ pts, closed: close(pts[0], pts[pts.length - 1]) });
  }
  return out;
}
// a ring's vertices `d` m inwards (each vertex along the bisector of its two edges' inward normals)
function insetRing(ring, d) {
  return ring.map((_, i) => insetVertex(ring, i, d));
}
// the vertices `idx` of a ring, `d` m inwards: a stretch of its outline as an open polyline
function insetRun(ring, idx, d) {
  return idx.map((i) => insetVertex(ring, i, d));
}
function insetVertex(ring, i, d) {
  const n = ring.length;
  const p = ring[i], a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
  const inward = (u, v) => {
    const L = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
    let nx = (v[1] - u[1]) / L, nz = -(v[0] - u[0]) / L;
    if (!inRing(ring, (u[0] + v[0]) / 2 + nx * 0.3, (u[1] + v[1]) / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
    return [nx, nz];
  };
  const [n1x, n1z] = inward(a, p), [n2x, n2z] = inward(p, b);
  let bx = n1x + n2x, bz = n1z + n2z;
  const bl = Math.hypot(bx, bz);
  if (bl < 1e-3) return [p[0] + n1x * d, p[1] + n1z * d];
  bx /= bl; bz /= bl;
  const k = Math.min(3, 1 / Math.max(0.33, bx * n1x + bz * n1z)); // the miter, capped at sharp corners
  return [p[0] + bx * d * k, p[1] + bz * d * k];
}
// point (x, z) inside the ring [[x, z], ...] (even-odd rule)
function inRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const GREEN = (t) => {
  if (/^(park|garden|pitch|playground|stadium|track|sports_centre|recreation_ground|golf_course|nature_reserve|dog_park|common)$/.test(t.leisure || '')) return t.leisure;
  if (/^(grass|cemetery|recreation_ground|village_green|forest|meadow|farmland|orchard|greenfield|flowerbed)$/.test(t.landuse || '')) return t.landuse;
  if (/^(wood|scrub|grassland|heath|water|wetland)$/.test(t.natural || '')) return t.natural;
  return null;
};
const greens = [];
for (const e of landOSM.elements) {
  const t = e.tags || {};
  const cat = GREEN(t);
  if (!cat) continue;
  const rings = elemRings(e).filter((r) => Math.abs(ringArea(r)) > 150);
  if (!rings.length) continue;
  greens.push({ name: t.name || '', cat, rings });
}
const raster = { lab, w: W, h: H, x0: X0, z0: Z0, res: RES };
const byLab = new Map(blocks.map((b) => [b._lab, b]));
const parkOf = new Map();
for (const g of greens) {
  for (const ring of g.rings) {
    const counts = new Map();
    ringCells(ring, raster, (L) => counts.set(L, (counts.get(L) || 0) + 1));
    for (const [L, n] of counts) {
      const b = byLab.get(L);
      if (!b) continue;
      b.parkCells = (b.parkCells || 0) + n;
      const prev = parkOf.get(b);
      if (!prev || n > prev.cells) parkOf.set(b, { name: g.name, cells: n });
    }
  }
}
for (const b of blocks) {
  b.park = b.rural ? 1 : Math.min(1, Math.round(((b.parkCells || 0) / b.cells) * 100) / 100);
  b.parkName = parkOf.get(b)?.name || '';
}
// Roundabouts (junction=roundabout | circular, often mapped as several ways): the island inside the ring is a planted
// glorieta, never a block of houses (an island 20-80 m across is too wide for a median and has no real footprints)
{
  const chains = ways.filter((w) => /^(roundabout|circular)$/.test(w.tags.junction || '') && DRIVE.has(w.tags.highway))
    .map((w) => w.geometry.map((g) => toWorld(g.lon, g.lat)));
  const rings = stitch(chains).filter((r) => r.closed && r.pts.length > 3).map((r) => r.pts.slice(0, -1));
  let islands = 0;
  for (const b of blocks) {
    if (b.rural) continue;
    const [cx, cz] = centroid(b.poly);
    const ring = rings.find((r) => Math.abs(ringArea(b.poly)) < Math.abs(ringArea(r)) && inRing(r, cx, cz));
    if (!ring) continue;
    b.park = 1;
    b.parkName = b.parkName || 'Glorieta';
    b.roundabout = true;
    islands++;
  }
  log(`${rings.length} roundabouts, ${islands} islands planted`);
}
log(`${greens.length} green/water areas; ${blocks.filter((b) => b.park > 0.6).length} park blocks`);
const parks = greens.filter((g) => g.name || g.rings.some((r) => Math.abs(ringArea(r)) > 2500)).map((g) => ({
  name: g.name, cat: g.cat, acres: Math.round((g.rings.reduce((t, r) => t + Math.abs(ringArea(r)), 0) / 4046.86) * 10) / 10,
  rings: g.rings.map((r) => flat(rdpRing(r, 0.8)))
}));

// --- Car parks (OSM amenity=parking): the open lots in front of the supermarkets, the plazas & the hospitals -----------
// Each mapped area (parking=surface, or untagged: OSM's default) as it lies inside the property lines: cut to the
// raster cells inside both, one piece per block it spans (a named service road cuts some in two), traced round and
// straightened like the blocks. Multi-storey, underground & street-side ones (bays along the curb) are left out. Its
// rows of stalls run square with its sides, along its longer extent: θ (the rows' direction (cos θ, -sin θ), the houses'
// frame convention). The houses (5B) leave them clear.
const PARKING_SKIP = /^(multi-storey|underground|street_side|rooftop|lane|layby|carports|garage_boxes)$/;
// Car parks OpenStreetMap maps where someone who knows the place says there is none: a point inside each (degrees)
const NOT_PARKING = [
  { lat: 21.490935, lon: -104.881585, note: 'beside Walmart Insurgentes, round the lienzo charro: it has no car park' }
];
const PARKING_MIN = 150; // m²: smaller pieces are a strip along a wall, not a lot (8 stalls is about 100 m² with its aisle)
// the lot's surface: 0 asphalt (OSM's untagged lots are, mostly), 1 poured concrete, 2 setts (adoquín, empedrado),
// 3 earth or gravel
const PARKING_SURFACE = (t) => /^(concrete|concrete:plates)$/.test(t) ? 1 : /^(paving_stones|sett|cobblestone|unhewn_cobblestone)$/.test(t) ? 2 :
  /^(unpaved|ground|dirt|earth|gravel|fine_gravel|compacted|grass|sand|mud|pebblestone)$/.test(t) ? 3 : 0;
const parkingLots = [];
{
  let skipped = 0, small = 0;
  for (const e of landOSM.elements) {
    const t = e.tags || {};
    if (t.amenity !== 'parking') continue;
    if (PARKING_SKIP.test(t.parking || '')) { skipped++; continue; }
    for (const ring of elemRings(e)) {
      if (NOT_PARKING.some((n) => inRing(ring, ...toWorld(n.lon, n.lat)))) { skipped++; continue; }
      // the cells inside the ring and a property line, by block
      const byBlock = new Map();
      ringCells(ring, raster, (L, k) => {
        if (!prop[k] || !byLab.has(L)) return;
        if (!byBlock.has(L)) byBlock.set(L, []);
        byBlock.get(L).push(k);
      });
      for (const [L, cells] of byBlock) {
        let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
        for (const k of cells) {
          const i = k % W, j = (k - i) / W;
          i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        }
        const w = i1 - i0 + 1, h = j1 - j0 + 1;
        const m = new Uint8Array(w * h);
        for (const k of cells) { const i = k % W, j = (k - i) / W; m[(j - j0) * w + i - i0] = 1; }
        const at = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? m[j * w + i] : 0);
        // each 4-connected patch (its top-left cell first met row by row), flood-filled off the mask once traced
        for (let s0 = 0; s0 < w * h; s0++) {
          if (m[s0] !== 1) continue;
          const si = s0 % w, sj = (s0 - si) / w;
          let n = 0;
          const stack = [s0];
          m[s0] = 2;
          while (stack.length) {
            const k = stack.pop();
            n++;
            const i = k % w, j = (k - i) / w;
            for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
              if (a >= 0 && b >= 0 && a < w && b < h && m[b * w + a] === 1) { m[b * w + a] = 2; stack.push(b * w + a); }
            }
          }
          if (n * RES * RES < PARKING_MIN) { small++; continue; }
          const patch = (i, j) => (at(i, j) === 2 ? 1 : 0);
          let poly = rdpRing(traceOutline(patch, si, sj, X0 + i0 * RES, Z0 + j0 * RES, RES), 0.5);
          for (let k = 0; k < w * h; k++) if (m[k] === 2) m[k] = 3; // (traced: no other patch's outline sees it)
          if (poly.length < 3) continue;
          if (ringArea(poly) > 0) poly = poly.reverse();
          // the rows square with the lot's sides: its edges' direction, weighted by their lengths, folded into a
          // quarter turn (an L-shaped lot round a store keeps both legs square), then turned along its longer extent
          let sx = 0, sz = 0;
          for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
            const dx = poly[a][0] - poly[b][0], dz = poly[a][1] - poly[b][1], L = Math.hypot(dx, dz), phi = Math.atan2(dz, dx);
            sx += L * Math.cos(4 * phi); sz += L * Math.sin(4 * phi);
          }
          const phi = Math.atan2(sz, sx) / 4;
          const ux = Math.cos(phi), uz = Math.sin(phi);
          const along = poly.map(([x, z]) => x * ux + z * uz), across = poly.map(([x, z]) => z * ux - x * uz);
          const long = Math.max(...along) - Math.min(...along) >= Math.max(...across) - Math.min(...across);
          // (θ: the rows along (cos θ, -sin θ))
          parkingLots.push({ name: t.name || '', surface: PARKING_SURFACE(t.surface || ''), th: long ? -phi : -phi - Math.PI / 2,
            poly, box: bbox(poly), area: n * RES * RES, lab: L, entrances: [] });
        }
      }
    }
  }
  log(`car parks: ${parkingLots.length} lots inside the property lines (${Math.round(parkingLots.reduce((t, p) => t + p.area, 0) / 1000)}k m²), ` +
    `${skipped} multi-storey, underground, along the curb or not there left out, ${small} slivers dropped`);
}
const parkingAt = (x, z) => parkingLots.find((p) => x > p.box.x0 && x < p.box.x1 && z > p.box.z0 && z < p.box.z1 && inRing(p.poly, x, z));
// Where OpenStreetMap maps a lot's parking aisles (service=parking_aisle), its rows run along them instead: Walmart's
// on Insurgentes run square to the avenue, under their long shades, not along the lot's long side. The aisles' own
// direction, weighted by their lengths in the lot, at its peak (the loop round the lot's edge counts less than the
// rows' aisles together)
{
  const aisles = new Map(); // lot -> [angle mod π, length (m)][]
  for (const w of ways) {
    if (w.tags.highway !== 'service' || w.tags.service !== 'parking_aisle') continue;
    const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const lot = L > 2 && parkingAt((ax + bx) / 2, (az + bz) / 2);
      if (!lot) continue;
      if (!aisles.has(lot)) aisles.set(lot, []);
      aisles.get(lot).push([((Math.atan2(bz - az, bx - ax) % Math.PI) + Math.PI) % Math.PI, L]);
    }
  }
  const DEG = Math.PI / 180;
  let turned = 0;
  for (const [lot, list] of aisles) {
    if (list.reduce((t, [, L]) => t + L, 0) < 25) continue;
    // the peak of the lengths by direction (5° steps, each aisle spread over ±10°), then the mean round it
    const near = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
    let best = 0, bestScore = -1;
    for (let k = 0; k < 36; k++) {
      const score = list.reduce((t, [a, L]) => t + L * Math.max(0, 1 - near(a, k * 5 * DEG) / (10 * DEG)), 0);
      if (score > bestScore) { bestScore = score; best = k * 5 * DEG; }
    }
    let sx = 0, sz = 0;
    for (const [a, L] of list) if (near(a, best) < 12 * DEG) { sx += L * Math.cos(2 * a); sz += L * Math.sin(2 * a); }
    const phi = Math.atan2(sz, sx) / 2;
    lot.th = -phi; // (the rows along (cos θ, -sin θ) = the aisles' (cos φ, sin φ))
    turned++;
  }
  log(`car parks: ${turned} lots laid out along their mapped parking aisles`);
}

// =====================================================================================================================
// 5. PLACES, POINTS OF INTEREST, NOTABLE FOOTPRINTS
// =====================================================================================================================
const places = [];
const pois = [];
const center = (e) => (e.type === 'node' ? toWorld(e.lon, e.lat) : e.center ? toWorld(e.center.lon, e.center.lat) : null);
for (const e of poisOSM.elements) {
  const t = e.tags || {};
  const p = center(e);
  if (!p || !t.name) continue;
  if (/^(neighbourhood|quarter|suburb)$/.test(t.place || '')) { places.push({ name: t.name, x: q(p[0]), z: q(p[1]) }); continue; }
  const kind = t.tourism || t.historic || t.amenity || (t.natural === 'peak' ? 'peak' : null) || t.leisure;
  if (!kind || /^(motel|hotel|hostel|camp_site)$/.test(kind)) continue;
  pois.push({ name: t.name, kind, x: q(p[0]), z: q(p[1]) });
}
for (const e of landOSM.elements) {
  const t = e.tags || {};
  const kind = t.leisure === 'park' || t.leisure === 'stadium' || t.amenity === 'marketplace' || t.amenity === 'bus_station' || t.amenity === 'hospital' || t.amenity === 'university' ? (t.leisure || t.amenity) : null;
  if (!kind || !t.name) continue;
  const rings = elemRings(e);
  const p = rings.length ? centroid(rings[0]) : null;
  if (!p || !inBox(p[0], p[1])) continue;
  if (pois.some((o) => o.name === t.name && Math.hypot(o.x - p[0], o.z - p[1]) < 150)) continue;
  pois.push({ name: t.name, kind, x: q(p[0]), z: q(p[1]) });
}
log(`${places.length} neighbourhoods, ${pois.length} points of interest`);

const landmarks = {};
for (const e of bldOSM.elements) {
  const t = e.tags || {};
  if (!t.name || !/^(cathedral|church|train_station|stadium|hospital|government|public|university|hotel|cathedral)$/.test(t.building || '')) continue;
  const r = elemRings(e)[0];
  if (!r || !inBox(...centroid(r))) continue;
  const b = bbox(r);
  const area = Math.abs(ringArea(r));
  if (landmarks[t.name] && landmarks[t.name].area >= area) continue;
  landmarks[t.name] = { x: q((b.x0 + b.x1) / 2), z: q((b.z0 + b.z1) / 2), w: q(b.x1 - b.x0), d: q(b.z1 - b.z0), h: num(t.height), area: Math.round(area), ring: flat(rdpRing(r, 0.4)), kind: t.building };
}
log(`${Object.keys(landmarks).length} notable footprints`);

// =====================================================================================================================
// 5B. HOUSES: every building footprint of Overture Maps (OpenStreetMap + Microsoft & Google ML footprints), as the
//     oriented box the game builds: kept inside the property line, its front towards the nearest street
// =====================================================================================================================
const HS = 8; // integers per house (see `houses` below)
// bits of a house's kind (its 7th integer, over the front side 0-3): a shop on the ground floor, a big box (a hall: a
// supermarket, department store, mall or warehouse), a strip plaza (a row of locales under one roof), a house of a
// gated community (fraccionamiento / coto, see 5B2: its number + 1 from bit COTO_SHIFT up)
const KIND = { shop: 4, big: 8, strip: 16, coto: 32 };
const COTO_SHIFT = 6;
const houses = [];
{
  const file = path.join(DATA, 'overture', 'buildings.geojsonl');
  const hashf = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
  // OpenStreetMap's commercial buildings (the malls, supermarkets & department stores mapped by hand), to tell the
  // Overture footprint standing on one from the houses: the ML footprints carry no use at all (98.8% of them)
  const STORE_SHOP = /^(mall|supermarket|department_store|wholesale|doityourself|hardware|furniture|car|garden_centre|variety_store|trade)$/;
  const STORE_BUILDING = /^(retail|commercial|supermarket|warehouse|industrial)$/;
  const stores = [];
  for (const e of bldOSM.elements) {
    const t = e.tags || {};
    if (!STORE_SHOP.test(t.shop || '') && !STORE_BUILDING.test(t.building || '')) continue;
    for (const ring of elemRings(e)) stores.push({ ring, box: bbox(ring), mall: t.shop === 'mall' || /^plaza\b|centro comercial/i.test(t.name || '') });
  }
  const storeAt = (x, z) => stores.find((s) => x > s.box.x0 && x < s.box.x1 && z > s.box.z0 && z < s.box.z1 && inRing(s.ring, x, z));
  // The open canals, drains & ditches (not underground), in 50 m cells. A footprint standing on one in a green block
  // (a camellón, a park) is an ML footprint's mistake: Ciudad del Valle's canal runs down Paseo de Hamburgo's planted
  // median, where Overture had a house. (Elsewhere a drain under a hall or across a yard is more likely a culvert.)
  const CH = 50;
  const channels = new Map();
  for (const [kind, , , flags, pts] of waterways) {
    if (!/^(canal|drain|ditch)$/.test(kind) || flags & 2) continue;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const seg = pts.slice(i, i + 4);
      for (let ix = Math.floor(Math.min(seg[0], seg[2]) / CH); ix <= Math.floor(Math.max(seg[0], seg[2]) / CH); ix++) {
        for (let iz = Math.floor(Math.min(seg[1], seg[3]) / CH); iz <= Math.floor(Math.max(seg[1], seg[3]) / CH); iz++) {
          const k = `${ix},${iz}`;
          if (!channels.has(k)) channels.set(k, []);
          channels.get(k).push(seg);
        }
      }
    }
  }
  // whether a channel runs within 0.5 m of the oriented box (centre, size, turn's cos & sin), sampled every 0.25 m
  const onChannel = (cx, cz, w, d, cs, sn) => {
    const r = Math.hypot(w, d) / 2 + 1;
    for (let ix = Math.floor((cx - r) / CH); ix <= Math.floor((cx + r) / CH); ix++) {
      for (let iz = Math.floor((cz - r) / CH); iz <= Math.floor((cz + r) / CH); iz++) {
        for (const [x0, z0, x1, z1] of channels.get(`${ix},${iz}`) || []) {
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
          for (let k = 0; k <= n; k++) {
            const dx = x0 + ((x1 - x0) * k) / n - cx, dz = z0 + ((z1 - z0) * k) / n - cz;
            // (world = c + R(θ)·local, so local = R(−θ)·(p − c))
            if (Math.abs(dx * cs - dz * sn) <= w / 2 + 0.5 && Math.abs(dx * sn + dz * cs) <= d / 2 + 0.5) return true;
          }
        }
      }
    }
    return false;
  };
  let read = 0, small = 0, outside = 0, squeezed = 0, onCanal = 0, onLot = 0, hallsOnLots = 0, bigBoxes = 0;
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const line = text.slice(start, end);
      start = end + 1;
      if (!line.trim()) continue;
      const f = JSON.parse(line);
      read++;
      const g = f.geometry;
      const outer = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
      if (!outer || outer.length < 4) continue;
      const ring = outer.map(([lon, lat]) => toWorld(lon, lat));
      const area = Math.abs(ringArea(ring));
      if (area < 25 || area > 120000) { small++; continue; }
      const r = minAreaRect(ring);
      if (!r || !inBox(r.cx, r.cz) || !labAt(r.cx, r.cz)) { outside++; continue; }
      if (byLab.get(labAt(r.cx, r.cz))?.roundabout) { outside++; continue; } // (a glorieta's monument base or kiosk)
      let { cx, cz, w, d } = r;
      const th = r.th, cs = Math.cos(th), sn = Math.sin(th);
      const toW = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
      // Pull each side back (0.4 m at a time) while it reaches past the property line: the footprint and our curbs
      // are mapped independently and the street's width is only nominal
      let ok = false;
      for (let it = 0; it < 24; it++) {
        const hw = w / 2, hd = d / 2;
        const bad = [
          [toW(-hw, -hd * 0.9), toW(-hw, 0), toW(-hw, hd * 0.9)],
          [toW(hw, -hd * 0.9), toW(hw, 0), toW(hw, hd * 0.9)],
          [toW(-hw * 0.9, -hd), toW(0, -hd), toW(hw * 0.9, -hd)],
          [toW(-hw * 0.9, hd), toW(0, hd), toW(hw * 0.9, hd)]
        ].map((pts) => pts.some(([x, z]) => !propAt(x, z)));
        if (!bad.some(Boolean)) { ok = true; break; }
        const step = 0.4;
        if (bad[0]) { w -= step; cx += step / 2 * cs; cz -= step / 2 * sn; }
        if (bad[1]) { w -= step; cx -= step / 2 * cs; cz += step / 2 * sn; }
        if (bad[2]) { d -= step; cx += step / 2 * sn; cz += step / 2 * cs; }
        if (bad[3]) { d -= step; cx -= step / 2 * sn; cz -= step / 2 * cs; }
        if (w < 3 || d < 3) break;
      }
      if (!ok || w < 3 || d < 3) { squeezed++; continue; }
      const block = byLab.get(labAt(cx, cz));
      if (block && !block.rural && block.park >= 0.6 && onChannel(cx, cz, w, d, cs, sn)) { onCanal++; continue; }
      // Front: the side with the nearest roadway straight out from its middle (w, e, n, s of the house's own frame)
      const outs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      let front = 0, bestD = Infinity;
      outs.forEach(([ou, ov], k) => {
        const reach = ou ? w / 2 : d / 2;
        for (let t = 0.5; t < 30; t += 0.5) {
          const [x, z] = toW(ou * (reach + t), ov * (reach + t));
          if (!labAt(x, z)) { if (t < bestD) { bestD = t; front = k; } return; }
        }
      });
      // Storeys: the mapped ones, else by size & place (one-storey houses on the colonias, more in the centro)
      const p = f.properties || {};
      const cls = p.class || '';
      const centro = Math.hypot(cx, cz) < 650;
      const hr = hashf(cx, cz);
      let floors = p.num_floors ? Math.round(p.num_floors) : p.height ? Math.max(1, Math.round(p.height / 3)) : 0;
      if (!floors) {
        if (area < 45) floors = 1;
        else if (centro) floors = hr < 0.3 ? 1 : hr < 0.82 ? 2 : 3;
        else if (area > 600) floors = hr < 0.7 ? 1 : 2;
        else floors = hr < 0.6 ? 1 : hr < 0.94 ? 2 : 3;
      }
      floors = Math.min(12, Math.max(1, floors));
      // Big boxes (a supermarket, a department store, a mall, a warehouse): a building mapped as one in OpenStreetMap or
      // Overture, or simply too big for a house (1500 m2 and 20 m deep: Tepic's houses run 60-300 m2), built as one hall
      // with no house split, tinaco or rejas. Malls of OSM too small to be a hall are a row of locales (a strip plaza)
      const store = storeAt(...centroid(ring));
      const big = (area >= 1500 && Math.min(w, d) >= 20) || (area >= 700 && (!!store || /supermarket|warehouse|industrial|retail|commercial/.test(cls)));
      const strip = !big && !!store && store.mall;
      // A footprint standing in a car park (25 m² to a few hundred: a guard's booth, a kiosk, the shade over a row of
      // stalls, an ML footprint of the cars themselves) leaves the lot to the cars. A hall in one is the lot mapped
      // round the store too: it stays, and the game keeps the stalls off it
      if (parkingAt(cx, cz)) {
        if (!big) { onLot++; continue; }
        hallsOnLots++;
      }
      if (big) {
        floors = p.num_floors ? Math.min(3, Math.round(p.num_floors)) : area > 6000 ? 3 : 2; // (a hall 6-9 m high)
        bigBoxes++;
      }
      // Ground floor shops: tagged commercial buildings, most of the centro, a few on every street
      const shop = big || strip || /commercial|retail|office|supermarket|hotel/.test(cls) || (bestD < 6 && (centro ? hr > 0.25 : hashf(cz, cx) < 0.12));
      houses.push(Math.round(cx * 10), Math.round(cz * 10), Math.round(w * 10), Math.round(d * 10), Math.round(th * 1000), floors,
        front + (shop ? KIND.shop : 0) + (big ? KIND.big : 0) + (strip ? KIND.strip : 0), 0);
    }
  }
  log(`houses: ${houses.length / HS} built of ${read} Overture footprints (${small} too small or large, ${outside} off the blocks, ${squeezed} squeezed out by the streets, ${onCanal} on a canal through green, ${onLot} in a car park), ${bigBoxes} big boxes (${hallsOnLots} on a mapped car park)`);
}

// --- Car parks' entrances: where a lot opens onto the street ---------------------------------------------------------
// Where a service road or aisle that runs through a lot (OSM highway=service: the parking aisles, the driveways, the
// plazas' access roads) leaves the lot's block onto the street: the point on the curb it crosses (found to a few cm
// along the way), the way into the block square to the curb (from the block's cells round it), its width, and its
// path from the curb to the lot (across the sidewalk, and the strip of grass some lots are mapped short of); one per
// 10 m of curb. Where OpenStreetMap has none along a side of a lot that faces a street (Walmart's aisles on Insurgentes
// stop short of it), the lot gets its own: one in the middle of that side, one per FRONTAGE m of a long one. The game
// drops the curb there in a ramp and paves the way through to the lot
{
  const SERVICE_WIDTH = { driveway: 4.5, alley: 4.0 }; // m; the rest (aisles, access roads) two-way, 6 m
  const FRONTAGE = 80;
  const REACH = 30; // m from a lot's edge to the curb at most (the grass strip by Walmart's on Insurgentes is ~25 m)
  const pieces = new Map(); // block label -> its lots
  for (const lot of parkingLots) {
    if (!pieces.has(lot.lab)) pieces.set(lot.lab, []);
    pieces.get(lot.lab).push(lot);
  }
  // the houses in 20 m cells: no driveway through a building
  const HC = 20;
  const houseCells = new Map();
  for (let k = 0; k < houses.length; k += HS) {
    const cx = houses[k] / 10, cz = houses[k + 1] / 10, r = Math.hypot(houses[k + 2], houses[k + 3]) / 20;
    for (let ix = Math.floor((cx - r) / HC); ix <= Math.floor((cx + r) / HC); ix++) {
      for (let iz = Math.floor((cz - r) / HC); iz <= Math.floor((cz + r) / HC); iz++) {
        const key = ix * 100003 + iz;
        if (!houseCells.has(key)) houseCells.set(key, []);
        houseCells.get(key).push(k);
      }
    }
  }
  const inHouse = (x, z, pad) => (houseCells.get(Math.floor(x / HC) * 100003 + Math.floor(z / HC)) || []).some((k) => {
    const th = houses[k + 4] / 1000, cs = Math.cos(th), sn = Math.sin(th), dx = x - houses[k] / 10, dz = z - houses[k + 1] / 10;
    return Math.abs(cs * dx - sn * dz) < houses[k + 2] / 20 + pad && Math.abs(sn * dx + cs * dz) < houses[k + 3] / 20 + pad;
  });
  // the drivable roadways (drivePieces) in 50 m cells: a street, not a footpath's or a river's gap between the blocks
  const RC = 50;
  const roadCells = new Map();
  for (const r of drivePieces) {
    for (let ix = Math.floor((Math.min(r.x0, r.x1) - r.r) / RC); ix <= Math.floor((Math.max(r.x0, r.x1) + r.r) / RC); ix++) {
      for (let iz = Math.floor((Math.min(r.z0, r.z1) - r.r) / RC); iz <= Math.floor((Math.max(r.z0, r.z1) + r.r) / RC); iz++) {
        const key = ix * 100003 + iz;
        if (!roadCells.has(key)) roadCells.set(key, []);
        roadCells.get(key).push(r);
      }
    }
  }
  const onRoad = (x, z) => (roadCells.get(Math.floor(x / RC) * 100003 + Math.floor(z / RC)) || []).some((r) => {
    const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - r.x0) * dx + (z - r.z0) * dz) / L2)) : 0;
    return Math.hypot(x - r.x0 - dx * t, z - r.z0 - dz * t) < r.r;
  });
  // From a curb point (cx, cz) in along (nx, nz): how far the lot begins (m), or -1 when a building stands in the way
  // or the lot is further than REACH; `half`: the driveway's half width (0: its middle only)
  const depthTo = (lot, cx, cz, nx, nz, half) => {
    for (let d = 0.5; d <= REACH + 1; d += 0.5) {
      const x = cx + nx * d, z = cz + nz * d;
      if (inRing(lot.poly, x, z)) return d;
      for (const o of [-half, 0, half]) if (inHouse(x - nz * o, z + nx * o, 0.3)) return -1;
    }
    return -1;
  };
  let found = 0, made = 0;
  for (const w of ways) {
    const t = w.tags;
    if (t.highway !== 'service' || /^(drive-through|emergency_access)$/.test(t.service || '') || /^(private|no)$/.test(t.access || '')) continue;
    const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
    // the way sampled every 0.5 m, and its block label at each sample
    const samples = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let k = i ? 1 : 0; k <= n; k++) samples.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    const labs = samples.map(([x, z]) => labAt(x, z));
    for (let k = 1; k < samples.length; k++) {
      const inner = labs[k - 1] || labs[k];
      if (!!labs[k - 1] === !!labs[k] || !pieces.has(inner)) continue;
      // the run of the way inside the block on this side must reach one of its lots
      const step = labs[k - 1] ? -1 : 1;
      let lot = null;
      const run = [];
      for (let j = labs[k - 1] ? k - 1 : k; j >= 0 && j < samples.length && labs[j] === inner && !lot; j += step) {
        run.push(samples[j]);
        lot = pieces.get(inner).find((p) => inRing(p.poly, samples[j][0], samples[j][1])) || null;
      }
      if (!lot || run.length * 0.5 > 80) continue;
      // the curb: bisect between the two samples
      let [ox, oz] = labs[k - 1] ? samples[k - 1] : samples[k], [rx, rz] = labs[k - 1] ? samples[k] : samples[k - 1];
      for (let it = 0; it < 5; it++) {
        const mx = (ox + rx) / 2, mz = (oz + rz) / 2;
        if (labAt(mx, mz) === inner) [ox, oz] = [mx, mz]; else [rx, rz] = [mx, mz];
      }
      const cx = (ox + rx) / 2, cz = (oz + rz) / 2;
      // into the block, square to the curb: the mean direction of the block's cells on a 4 m circle round the point
      let nx = 0, nz = 0;
      for (let a = 0; a < 32; a++) {
        const ux = Math.cos((a * Math.PI) / 16), uz = Math.sin((a * Math.PI) / 16);
        if (labAt(cx + ux * 4, cz + uz * 4) === inner) { nx += ux; nz += uz; }
      }
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-3 || lot.entrances.some((e) => Math.hypot(e[0] - cx, e[1] - cz) < 10)) continue;
      nx /= nl; nz /= nl;
      const width = Math.min(12, Math.max(3.5, Number.parseFloat(t.width) || SERVICE_WIDTH[t.service] || 6));
      // the way in: the service road itself from the curb to the lot (at least across the sidewalk, square to it)
      const path = rdp([[cx, cz], [cx + nx * (SIDEWALK + 0.3), cz + nz * (SIDEWALK + 0.3)], ...run.filter(([x, z]) => (x - cx) * nx + (z - cz) * nz > SIDEWALK + 0.8)], 0.3);
      lot.entrances.push([q(cx), q(cz), Math.round(Math.atan2(nz, nx) * 1000), q(width), flat(path)]);
      found++;
    }
  }
  for (const lot of parkingLots) {
    const poly = lot.poly;
    for (let a = 0; a < poly.length; a++) {
      const [ax, az] = poly[a], [bx, bz] = poly[(a + 1) % poly.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 12) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      // outwards: the side of the edge's middle off the lot
      let ox = uz, oz = -ux;
      if (inRing(poly, (ax + bx) / 2 + ox * 0.5, (az + bz) / 2 + oz * 0.5)) { ox = -ox; oz = -oz; }
      // from a point of the edge out to the curb (the block's last cell): its distance, or -1 past REACH
      const toCurb = (x, z) => {
        for (let d = 0; d <= REACH; d += 0.25) if (labAt(x + ox * (d + 0.25), z + oz * (d + 0.25)) !== lot.lab) return d;
        return -1;
      };
      // a side facing a street: from most of it the curb is within REACH and a drivable roadway lies just past it
      let facing = 0, n = 0;
      for (let d = 2; d <= len - 2; d += 2, n++) {
        const x = ax + ux * d, z = az + uz * d, c = toCurb(x, z);
        if (c >= 0 && onRoad(x + ox * (c + 1.5), z + oz * (c + 1.5))) facing++;
      }
      if (!n || facing < n * 0.7) continue;
      // (the entrances already along this side: off its line no further than the curb, over its length; none is made
      // within half a FRONTAGE of one)
      const along = lot.entrances.map(([ex, ez]) => [(ex - ax) * ux + (ez - az) * uz, (ex - ax) * ox + (ez - az) * oz])
        .filter(([u, v]) => u > -3 && u < len + 3 && v > -2 && v < REACH + 1).map(([u]) => u);
      const count = Math.max(1, Math.round(len / FRONTAGE));
      for (let k = 0; k < count; k++) {
        const d = (len * (k + 0.5)) / count;
        if (along.some((u) => Math.abs(u - d) < FRONTAGE / 2)) continue;
        const x = ax + ux * d, z = az + uz * d, c = toCurb(x, z);
        if (c < 0) continue;
        const cx = x + ox * (c + 0.12), cz = z + oz * (c + 0.12);
        const depth = depthTo(lot, cx, cz, -ox, -oz, 3);
        if (depth < 0) continue;
        const reach = Math.max(SIDEWALK + 0.3, depth + 0.5);
        lot.entrances.push([q(cx), q(cz), Math.round(Math.atan2(-oz, -ox) * 1000), 6, flat([[cx, cz], [cx - ox * reach, cz - oz * reach]])]);
        made++;
      }
    }
  }
  log(`car parks: ${found} entrances from the street where OSM maps them, ${made} more on the sides facing a street, ` +
    `${parkingLots.filter((p) => !p.entrances.length).length} lots with none (facing no street)`);
}

// =====================================================================================================================
// 5B2. GATED COMMUNITIES (fraccionamientos cerrados, cotos): the blocks along streets mapped access=private, each
//      network of such streets one coto. Walled round along the property line where it faces a public street (a barda
//      of ~2.6 m), a guard booth (caseta) & barrier arm where a private street meets a public one, and the same house
//      over and over inside: one colour, one height, no shops (one developer built them all)
// =====================================================================================================================
const cotos = [];
{
  // (drivable streets only: a private service road or driveway is a car park's or a house's, not a coto's)
  const PRIVATE = (t) => /^(private|residents)$/.test(t.access || '') && /^(residential|living_street|unclassified)$/.test(t.highway);
  const priv = ways.filter((w) => PRIVATE(w.tags) && w.geometry.length > 1);
  // the private streets' roadways on a raster (1: a private street)
  const privRaster = new Uint8Array(W * H).fill(1);
  const privSegs = priv.map((w) => {
    const r = roadSpec(w.tags).w / 2 + 0.3;
    const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
    for (let i = 0; i + 1 < pts.length; i++) clearCapsule(privRaster, W, H, X0, Z0, RES, { x0: pts[i][0], z0: pts[i][1], x1: pts[i + 1][0], z1: pts[i + 1][1], r });
    return { w, r, pts };
  });
  const isPriv = (x, z) => { const k = cellAt(x, z); return k >= 0 && privRaster[k] === 0; };
  // where a private street meets a public one: the gates (the public streets' nodes, and those a public street ends on)
  const pubNodes = new Set();
  const pubEnds = new Map(); // node -> [{ w, pts, e }], a public street ending there (its end index e)
  for (const w of ways) {
    if (!DRIVE.has(w.tags.highway) || PRIVATE(w.tags)) continue;
    for (const g of w.geometry) pubNodes.add(nodeKey(g));
    for (const e of [0, w.geometry.length - 1]) {
      const k = nodeKey(w.geometry[e]);
      if (!pubEnds.has(k)) pubEnds.set(k, []);
      pubEnds.get(k).push({ w, e });
    }
  }
  // the point `dist` m along a polyline from its vertex i, stepping `step` (±1) vertices at a time (at most 80% of the
  // way to its end), and the direction there
  const walk = (pts, i, step, dist) => {
    let total = 0;
    for (let k = i; k + step >= 0 && k + step < pts.length; k += step) total += Math.hypot(pts[k + step][0] - pts[k][0], pts[k + step][1] - pts[k][1]);
    let left = Math.min(dist, total * 0.8);
    let last = null;
    for (let k = i; k + step >= 0 && k + step < pts.length; k += step) {
      const a = pts[k], b = pts[k + step];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      last = { x: b[0], z: b[1], ux: (b[0] - a[0]) / L, uz: (b[1] - a[1]) / L };
      if (L >= left) return { x: a[0] + last.ux * left, z: a[1] + last.uz * left, ux: last.ux, uz: last.uz };
      left -= L;
    }
    return last;
  };
  // footprints per block (how many, how many house-sized), to tell a coto from a campus or an industrial park that
  // also has private streets
  const HOUSE_SIZED = 300; // m2: Tepic's houses run 60-300 m2
  const blockHouses = new Map();
  for (let i = 0; i < houses.length; i += HS) {
    const b = byLab.get(labAt(houses[i] / 10, houses[i + 1] / 10));
    if (!b) continue;
    const st = blockHouses.get(b) || { n: 0, small: 0 };
    st.n++;
    if ((houses[i + 2] * houses[i + 3]) / 100 <= HOUSE_SIZED) st.small++;
    blockHouses.set(b, st);
  }
  // networks of private streets (sharing a node)
  const parent = priv.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byNode = new Map();
  priv.forEach((w, i) => {
    for (const g of w.geometry) {
      const k = nodeKey(g);
      if (byNode.has(k)) parent[find(i)] = find(byNode.get(k));
      else byNode.set(k, i);
    }
  });
  const nets = new Map();
  privSegs.forEach((s, i) => {
    const root = find(i);
    if (!nets.has(root)) nets.set(root, []);
    nets.get(root).push(s);
  });
  const owner = new Map(); // block -> coto number
  let walled = 0;
  for (const segs of nets.values()) {
    // the blocks lining the network: probed from both sides of each street, clear of its mouths onto public streets
    const members = new Set();
    let length = 0;
    for (const { w, r, pts } of segs) {
      const mouths = w.geometry.filter((g) => pubNodes.has(nodeKey(g))).map((g) => toWorld(g.lon, g.lat));
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        length += L;
        if (L < 0.1) continue;
        const nx = -(bz - az) / L, nz = (bx - ax) / L;
        for (let t = 1; t < L; t += 2) {
          const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
          if (mouths.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 18)) continue;
          for (const side of [-1, 1]) {
            const b = byLab.get(labAt(x + nx * side * (r + SIDEWALK + 2), z + nz * side * (r + SIDEWALK + 2)));
            if (b && !b.rural && b.park <= 0.6 && b.area < 150000 && !owner.has(b)) members.add(b);
          }
        }
      }
    }
    if (!members.size || length < 60) continue; // (a private lane or two: a gated cul-de-sac, not a coto)
    // (mostly bigger buildings than houses: a campus, a hospital, an industrial park)
    let n = 0, small = 0;
    for (const b of members) { const st = blockHouses.get(b); if (st) { n += st.n; small += st.small; } }
    if (n >= 10 && small < n * 0.6) continue;
    const id = cotos.length;
    for (const b of members) owner.set(b, id);
    // the barda: each member block's outline where it faces neither a private street nor another block of the coto,
    // pulled in to the property line
    const walls = [];
    for (const b of members) {
      const poly = b.poly;
      const n = poly.length;
      const wallEdge = poly.map((a, i) => {
        const c = poly[(i + 1) % n];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.5) return false;
        let nx = (c[1] - a[1]) / L, nz = -(c[0] - a[0]) / L;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        if (inRing(poly, mx + nx * 0.5, mz + nz * 0.5)) { nx = -nx; nz = -nz; }
        const px = mx + nx * 3, pz = mz + nz * 3;
        if (isPriv(px, pz)) return false;
        const other = byLab.get(labAt(px, pz));
        return !(other && owner.get(other) === id);
      });
      // runs of wall edges as polylines (starting after a gap, so a run never wraps)
      const start = wallEdge.findIndex((e) => !e);
      if (start < 0 && wallEdge.length) {
        walls.push(insetRing(poly, SIDEWALK + 0.15).concat([insetRing(poly, SIDEWALK + 0.15)[0]]));
        continue;
      }
      let run = null;
      for (let k = 1; k <= n; k++) {
        const i = (start + k) % n;
        if (wallEdge[i]) {
          if (!run) run = [i];
          run.push((i + 1) % n);
        } else if (run) { walls.push(insetRun(poly, run, SIDEWALK + 0.15)); run = null; }
      }
      if (run) walls.push(insetRun(poly, run, SIDEWALK + 0.15));
    }
    // the gates: each mouth of the network onto a public street, the booth 12 m inside along the private street (past
    // the public one's half width & sidewalk); where a public street ends on a private one part way along, 10 m back
    // along the public street, facing the coto
    const gates = [];
    const addGate = (at, width) => {
      if (!at) return;
      for (let g = 0; g < gates.length; g += 4) if (Math.hypot(gates[g] - at.x, gates[g + 1] - at.z) < 12) return; // (entry & exit drawn as two ways: one booth)
      gates.push(q(at.x), q(at.z), Math.round(Math.atan2(at.uz, at.ux) * 1000), q(width));
    };
    for (const { w, r, pts } of segs) {
      const last = pts.length - 1;
      w.geometry.forEach((g, e) => {
        const k = nodeKey(g);
        if (!pubNodes.has(k)) return;
        if (e === 0 || e === last) {
          addGate(walk(pts, e, e === 0 ? 1 : -1, 12), r * 2 - 0.6);
          return;
        }
        for (const end of pubEnds.get(k) || []) {
          const pp = end.w.geometry.map((p) => toWorld(p.lon, p.lat));
          const at = walk(pp, end.e, end.e === 0 ? 1 : -1, 10);
          if (at) addGate({ x: at.x, z: at.z, ux: -at.ux, uz: -at.uz }, roadSpec(end.w.tags).w - 0.6);
        }
      });
    }
    const lots = walls.filter((pl) => pl.length > 1).map((pl) => flat(rdp(pl, 0.4)));
    cotos.push([lots, gates]);
    walled += members.size;
  }
  // the houses inside: one look per coto (a colour, two storeys mostly), no shops; anything bigger than a house (the
  // clubhouse, a school, a tower of flats) keeps its own
  let cotoHouses = 0;
  const built = new Set();
  for (let i = 0; i < houses.length; i += HS) {
    const b = byLab.get(labAt(houses[i] / 10, houses[i + 1] / 10));
    const id = b ? owner.get(b) : undefined;
    if (id === undefined) continue;
    built.add(b);
    if (houses[i + 6] & (KIND.big | KIND.strip) || (houses[i + 2] * houses[i + 3]) / 100 > HOUSE_SIZED) continue;
    houses[i + 5] = id % 5 === 3 ? 1 : 2;
    houses[i + 6] = (houses[i + 6] & 3) | KIND.coto | ((id + 1) << COTO_SHIFT);
    cotoHouses++;
  }
  // Blocks of a coto none of the footprints stand on (newer fraccionamientos than the ML imagery): rows of the coto's
  // house, 7 m fronts by 12 m deep, along the sides facing its private streets
  let rowHouses = 0;
  const taken = new Set(); // raster cells under the row houses placed so far
  // the cells under a house centred on (cx, cz), w along (ex, ez) by d along (nx, nz), sampled every 0.7 m
  const cellsUnder = (cx, cz, ex, ez, nx, nz, w, d) => {
    const out = [];
    for (let u = -w / 2 + 0.2; u <= w / 2 - 0.2; u += 0.7) for (let v = -d / 2 + 0.2; v <= d / 2 - 0.2; v += 0.7) out.push(cellAt(cx + ex * u + nx * v, cz + ez * u + nz * v));
    return out;
  };
  for (const [b, id] of owner) {
    if (built.has(b) || b.area > 40000) continue;
    const poly = b.poly, n = poly.length;
    for (let e = 0; e < n; e++) {
      const a = poly[e], c = poly[(e + 1) % n];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 9) continue;
      const ex = (c[0] - a[0]) / L, ez = (c[1] - a[1]) / L;
      let nx = ez, nz = -ex; // inward normal
      if (!inRing(poly, (a[0] + c[0]) / 2 + nx * 0.5, (a[1] + c[1]) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }
      if (!isPriv((a[0] + c[0]) / 2 - nx * 3, (a[1] + c[1]) / 2 - nz * 3)) continue; // a side on a private street
      const th = Math.atan2(-ez, ex); // local u along the edge, local v = (-ez, ex)
      const front = -ez * nx + ex * nz > 0 ? 2 : 3; // the street lies against the inward normal
      const W0 = 7, D0 = 12, set = SIDEWALK + 0.4;
      const count = Math.floor((L - 2) / W0);
      const t0 = (L - count * W0) / 2;
      for (let k = 0; k < count; k++) {
        const t = t0 + (k + 0.5) * W0;
        const cx = a[0] + ex * t + nx * (set + D0 / 2), cz = a[1] + ez * t + nz * (set + D0 / 2);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [cx + ex * su * W0 * 0.48 + nx * sv * D0 * 0.48, cz + ez * su * W0 * 0.48 + nz * sv * D0 * 0.48]);
        if (!corners.every(([x, z]) => propAt(x, z) && byLab.get(labAt(x, z)) === b)) continue;
        // (a house already there from another side of the block: the opposite one, or round the corner)
        const under = cellsUnder(cx, cz, ex, ez, nx, nz, W0, D0);
        if (under.some((k) => taken.has(k))) continue;
        for (const k of under) taken.add(k);
        houses.push(Math.round(cx * 10), Math.round(cz * 10), W0 * 10, D0 * 10, Math.round(th * 1000), id % 5 === 3 ? 1 : 2,
          front | KIND.coto | ((id + 1) << COTO_SHIFT), 0);
        rowHouses++;
      }
    }
  }
  log(`gated communities: ${rowHouses} row houses on their empty blocks`);
  log(`gated communities: ${cotos.length} cotos of ${priv.length} private streets, ${walled} blocks, ${cotoHouses} houses (${owner.size - built.size} blocks with none), ${cotos.reduce((t, c) => t + c[1].length / 4, 0)} gates`);
}

// =====================================================================================================================
// 5C. SHOP SIGNS: the businesses of Overture Maps' places on the buildings they stand in. Chains get a parody name in
//     their colours on a fascia band, local businesses their own name on the awning (those Overture is fairly sure of,
//     confidence >= 0.5: about half of them are Facebook pages, some closed or pinned on the wrong roof), every other
//     shop a generic sign of its trade. The game draws the names into its sign atlas only around the camera
//     (js/world/sign-slots.js), so there's no cap on how many there are
// =====================================================================================================================
const signs = [];
{
  // the chain stores' looks & parody names live in js/world/storefronts (one module per kind of store)
  const CHAINS = STOREFRONTS;
  const GENERIC = [
    [/tortiller/i, 'TORTILLERÍA'], [/carnicer/i, 'CARNICERÍA'], [/papeler/i, 'PAPELERÍA'], [/marisc/i, 'MARISCOS'],
    [/pollo/i, 'POLLOS ASADOS'], [/\btaco/i, 'TACOS'], [/birria/i, 'BIRRIA'], [/torta/i, 'TORTAS AHOGADAS'],
    [/panader|bakery/i, 'PANADERÍA'], [/ferreter|hardware/i, 'FERRETERÍA'], [/abarrote|food_and_beverage|grocery/i, 'ABARROTES'],
    [/mini ?s[uú]per|convenience/i, 'MINI SÚPER'], [/farmac|pharmacy/i, 'FARMACIA'], [/est[eé]tica|beauty|salon|barber/i, 'ESTÉTICA'],
    [/taller|automotive_service/i, 'TALLER MECÁNICO'], [/refaccion|vehicle_parts/i, 'REFACCIONARIA'], [/llant/i, 'LLANTERA'],
    [/dental/i, 'CONSULTORIO DENTAL'], [/ropa|boutique|fashion/i, 'BOUTIQUE'], [/zapat|shoe/i, 'ZAPATERÍA'],
    [/flor|flowers/i, 'FLORERÍA'], [/celular|electronics/i, 'CELULARES'], [/caf[eé]|cafe/i, 'CAFÉ'], [/bar\b|cantina/i, 'CANTINA'],
    [/hamburgues|fast_food/i, 'HAMBURGUESAS'], [/lonch|casual_eatery|food_truck/i, 'LONCHERÍA'], [/restaurant/i, 'RESTAURANTE'],
    [/gym|gimnas/i, 'GIMNASIO'], [/hotel|motel/i, 'HOTEL'], [/lavander/i, 'LAVANDERÍA'], [/cerrajer/i, 'CERRAJERÍA'],
    [/veterinari|pet/i, 'VETERINARIA'], [/optic/i, 'ÓPTICA'], [/muebler/i, 'MUEBLERÍA'], [/dulcer/i, 'DULCERÍA'], [/nieve|helad/i, 'NEVERÍA']
  ];
  const STREET_TRADES = ['ABARROTES', 'TORTILLERÍA', 'PAPELERÍA', 'MISCELÁNEA', 'FARMACIA', 'ESTÉTICA', 'TACOS', 'LONCHERÍA', 'CARNICERÍA',
    'FERRETERÍA', 'CELULARES', 'REFACCIONARIA', 'DULCERÍA', 'NEVERÍA', 'BIRRIA', 'MARISCOS', 'PANADERÍA', 'POLLOS ASADOS'];
  const LOCAL_COLOURS = [['#1f4e8c', '#ffffff'], ['#9e1b1b', '#fff3d6'], ['#1d6b3a', '#ffffff'], ['#f2b705', '#1a1a1a'], ['#ffffff', '#b3121b'],
    ['#6a1b9a', '#ffffff'], ['#e8611a', '#ffffff'], ['#0b7a75', '#ffffff'], ['#222222', '#ffd34d']];
  const NAME_CONFIDENCE = 0.5;
  const signIndex = new Map();
  const addSign = (key, entry) => {
    if (signIndex.has(key)) return signIndex.get(key);
    signs.push(entry);
    signIndex.set(key, signs.length);
    return signs.length;
  };
  const hashS = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
  // chains first, then the trades: the game keeps these in its atlas for good, the names (which carry `trade`, their
  // trade's sign, for when the atlas is full) come and go
  CHAINS.forEach((sf, k) => addSign(`chain:${sf.id}`, { text: sf.name, ...sf.sign, chain: 1, big: sf.big ? 1 : 0, store: k }));
  for (const t of new Set([...GENERIC.map((g) => g[1]), ...STREET_TRADES, 'MISCELÁNEA'])) {
    const [bg, fg] = LOCAL_COLOURS[hashS(t) % LOCAL_COLOURS.length];
    addSign(`trade:${t}`, { text: t, bg, fg, border: fg });
  }
  const tradeOf = (name, cat) => {
    for (const [re, t] of GENERIC) if (re.test(name) || re.test(cat)) return t;
    return null;
  };

  // houses in 20 m cells, to find the building a business stands in
  const CELL = 20;
  const cells = new Map();
  for (let i = 0; i < houses.length; i += HS) {
    const k = `${Math.floor(houses[i] / 10 / CELL)},${Math.floor(houses[i + 1] / 10 / CELL)}`;
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(i);
  }
  const houseAt = (x, z, reach) => {
    let best = -1, bd = Infinity;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      for (const i of cells.get(`${ix + a},${iz + b}`) || []) {
        const cx = houses[i] / 10, cz = houses[i + 1] / 10, hw = houses[i + 2] / 20, hd = houses[i + 3] / 20, th = houses[i + 4] / 1000;
        const dx = x - cx, dz = z - cz;
        const u = Math.abs(dx * Math.cos(th) - dz * Math.sin(th)) - hw, v = Math.abs(dx * Math.sin(th) + dz * Math.cos(th)) - hd;
        const d = Math.hypot(Math.max(0, u), Math.max(0, v)); // 0 inside the footprint
        if (d < bd || (d === 0 && bd === 0 && houses[i + 2] * houses[i + 3] < houses[best + 2] * houses[best + 3])) { bd = d; best = i; }
      }
    }
    return bd <= reach ? best : -1;
  };
  // the biggest building within `reach` m (a supermarket's pin often falls on its car park, its kiosk or the street)
  const biggestAt = (x, z, reach) => {
    let best = -1, ba = 0;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      for (const i of cells.get(`${ix + a},${iz + b}`) || []) {
        const area = houses[i + 2] * houses[i + 3];
        if (area > ba && Math.hypot(x - houses[i] / 10, z - houses[i + 1] / 10) - Math.hypot(houses[i + 2], houses[i + 3]) / 20 <= reach) { ba = area; best = i; }
      }
    }
    return best;
  };

  // A supermarket or department store is a place whose own name is the chain's ("Soriana", "Casa Ley Álica", "The Home
  // Depot Tepic"), not one that names it after something else: the cafés, banks & phone shops inside or beside it
  // ("Doña Tota Soriana Cigarrera", "BanCoppel", "Credi 7 Chedraui") would otherwise put the store's sign on the
  // building they stand in (Soriana's on the Burger King of Insurgentes)
  const leads = (sf) => new RegExp(`^(?:(?:casa|mi|plaza|tienda|the)\\s+)?(?:${sf.match.source})`, 'i');
  const HALL_MIN = 700; // m²: a supermarket's or department store's hall at least (Tepic's are 1,300-18,000 m²)
  const chainPlaces = [];
  const file = path.join(DATA, 'overture', 'places.geojsonl');
  const locals = [];
  let chains = 0, named = 0, generic = 0, plazas = 0;
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const f = JSON.parse(line);
      const p = f.properties || {};
      const name = ((p.names && p.names.primary) || '').trim();
      const brand = (p.brand && p.brand.names && p.brand.names.primary) || '';
      const cat = p.basic_category || (p.taxonomy && p.taxonomy.primary) || '';
      if (!name || !f.geometry || f.geometry.type !== 'Point') continue;
      if (/school|place_of_learning|government|worship|college|university|real_estate|attorney|professional_service|home_service|event_or_party|manufacturer|park|public_plaza/.test(cat)) continue;
      const [x, z] = toWorld(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      if (!inBox(x, z)) continue;
      // a shopping centre (Plaza Cigarrera, Plaza del Valle...; not a public square): the building it stands in is a row
      // of locales, unless it's a hall already
      if (cat === 'shopping_mall' || /^plaza\b|centro comercial/i.test(name)) {
        const i = houseAt(x, z, 12);
        if (i >= 0 && !(houses[i + 6] & (KIND.big | KIND.coto))) { houses[i + 6] |= KIND.strip | KIND.shop; plazas++; }
      }
      const chain = CHAINS.find((sf) => (sf.big ? leads(sf).test(name) : sf.match.test(name) || sf.match.test(brand)));
      if (chain) {
        chainPlaces.push({ chain, x, z, conf: p.confidence || 0 });
        continue;
      }
      // (a business that only names the store it stands in or by: "Doña Tota Soriana Cigarrera", "Afore Coppel")
      if (CHAINS.some((sf) => sf.big && (sf.match.test(name) || sf.match.test(brand)))) continue;
      const i = houseAt(x, z, 8);
      if (i < 0 || houses[i + 7] || houses[i + 6] & KIND.coto) continue; // (no shops inside a coto)
      locals.push({ i, name, cat, conf: p.confidence || 0, d: Math.hypot(x, z) });
    }
  }
  // The chains' stores, the surest first. Overture often has a big store twice (a second, older pin: "Liverpool" 430 m
  // down Av. México from "Liverpool Centro"): within DUPLICATE m of a surer one of the same chain, a pin both aren't
  // sure of (confidence 0.9) is that one again. A big store takes the biggest building by its pin if that is a hall
  // (HALL_MIN), else it is a small branch (a Soriana Express) and signs the building it stands in (or that one), like
  // the OXXOs
  const DUPLICATE = 500;
  chainPlaces.sort((a, b) => Number(b.chain.big) - Number(a.chain.big) || b.conf - a.conf);
  const kept = [];
  let duplicates = 0;
  for (const c of chainPlaces) {
    if (c.chain.big && kept.some((k) => k.chain === c.chain && Math.min(k.conf, c.conf) < 0.9 && Math.hypot(k.x - c.x, k.z - c.z) < DUPLICATE)) { duplicates++; continue; }
    kept.push(c);
    const hall = c.chain.big ? biggestAt(c.x, c.z, 40) : -1;
    const big = hall >= 0 && (houses[hall + 2] * houses[hall + 3]) / 100 >= HALL_MIN;
    const at = big ? -1 : houseAt(c.x, c.z, 15);
    const i = big ? hall : at >= 0 ? at : hall; // (a branch pinned on its car park: the building by it)
    if (i < 0) continue;
    // (a convenience store or pharmacy inside a hall or a mall: the hall keeps its own front, height & name)
    if (!big && houses[i + 6] & KIND.big) continue;
    houses[i + 7] = signIndex.get(`chain:${c.chain.id}`);
    houses[i + 6] |= KIND.shop;
    if (big) houses[i + 6] = (houses[i + 6] | KIND.big) & ~KIND.strip;
    houses[i + 5] = big ? Math.max(2, Math.min(houses[i + 5], 3)) : 1;
    chains++;
  }
  // a sign's text: no emoji, no "- Tepic" tacked on the end (Facebook pages' names), something to read left (the emoji
  // and their joiners one code point at a time: in a character class they'd read as one joined sequence)
  const signText = (name) => {
    let t = name.normalize('NFC').replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}|\u{20E3}/gu, '')
      .replace(/\s*[|·•–—-]\s*tepic\b.*$/i, '').replace(/\s+/g, ' ').trim().toUpperCase();
    // a long one: its first part ("DENTALUX - ODONTOLOGÍA INTEGRAL"), else cut at a word
    if (t.length > 30) t = t.replace(/\s*\([^)]*(\)|$)/g, ' ').trim(); // (what's in brackets goes first)
    if (t.length > 30) {
      const head = t.split(/\s+[-|:–—]\s+/)[0];
      if (head.length <= 30 && (head.match(/\p{L}/gu) || []).length >= 4) t = head;
      else {
        t = t.slice(0, 29).replace(/\s+\S*$/, '');
        // (not on "Y", "DE", "LA"...: "PROVEEDORA DE HULES…", not "PROVEEDORA DE HULES Y…")
        for (let u = ''; u !== t;) [u, t] = [t, t.replace(/[\s,;:.|&\-–(“"]+$/, '').replace(/\s+(Y|E|DE|DEL|LA|LAS|EL|LOS|EN|CON|PARA|AND|THE|OF)$/i, '')];
        t += '…';
      }
    }
    return /\p{L}.*\p{L}/u.test(t) ? t : null;
  };
  // several businesses in one building: the surest names it (then the one nearest the plaza)
  locals.sort((a, b) => b.conf - a.conf || a.d - b.d);
  for (const l of locals) {
    if (houses[l.i + 7]) continue;
    const trade = signIndex.get(`trade:${tradeOf(l.name, l.cat) || 'MISCELÁNEA'}`);
    const text = l.conf >= NAME_CONFIDENCE ? signText(l.name) : null;
    let k;
    if (text) {
      const [bg, fg] = LOCAL_COLOURS[hashS(text) % LOCAL_COLOURS.length];
      k = addSign(`name:${text}`, { text, bg, fg, trade });
      named++;
    } else if (houses[l.i + 6] & KIND.big) continue; // (a hall carries its own name or none, never a trade's)
    else {
      k = trade;
      generic++;
    }
    houses[l.i + 7] = k;
    houses[l.i + 6] |= KIND.shop;
  }
  // shops with no business on record: a trade by the house's hash
  for (let i = 0; i < houses.length; i += HS) {
    if (!(houses[i + 6] & KIND.shop) || houses[i + 7] || houses[i + 6] & KIND.big) continue;
    const t = STREET_TRADES[hashS(`${houses[i]},${houses[i + 1]}`) % STREET_TRADES.length];
    houses[i + 7] = signIndex.get(`trade:${t}`);
  }
  log(`shop signs: ${plazas} shopping centres, ${chains} chain stores (${duplicates} pinned twice), ${named + generic} shops from ${locals.length} local businesses (${named} named, ${generic} by trade), ${signs.length} sign faces`);
}

// =====================================================================================================================
// 5D. TERRAIN: the hills around the valley (Cerro de San Juan, Cerro de la Cruz, the lomas) from the Terrarium elevation
//     tiles (tools/data/tepic/fetch-terrain.sh). The city itself stays flat: the valley floor's slow tilt (a wide blur
//     of the elevation under the streets & blocks) is taken off, and what rises above it fades in away from them.
//     That tilt is kept apart as `ground`, the town's own slopes (js/world/ground.js)
// =====================================================================================================================
const { ground = null, ...terrainGrid } = (() => {
  const dir = path.join(DATA, 'terrain');
  if (!fs.existsSync(dir)) return {};
  const Z = 12, N = 2 ** Z;
  const tiles = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = /^12_(\d+)_(\d+)\.png$/.exec(f);
    if (m) tiles.set(`${m[1]}_${m[2]}`, decodePNG(fs.readFileSync(path.join(dir, f)), zlib.inflateSync));
  }
  if (!tiles.size) return {};
  const pixel = (gx, gy) => {
    const t = tiles.get(`${Math.floor(gx / 256)}_${Math.floor(gy / 256)}`);
    if (!t) return NaN;
    const o = ((gy & 255) * 256 + (gx & 255)) * t.channels;
    return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
  };
  const elevation = (lon, lat) => {
    const r = (lat * Math.PI) / 180;
    const fx = ((lon + 180) / 360) * N * 256 - 0.5;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256 - 0.5;
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    return (pixel(x, y) * (1 - tx) + pixel(x + 1, y) * tx) * (1 - ty) + (pixel(x, y + 1) * (1 - tx) + pixel(x + 1, y + 1) * tx) * ty;
  };
  const CELL = 75;
  const TX0 = -17000, TZ0 = -16000, TX1 = 21000, TZ1 = 21000;
  const TW = Math.round((TX1 - TX0) / CELL) + 1, TH = Math.round((TZ1 - TZ0) / CELL) + 1;
  const E = new Float32Array(TW * TH), U = new Float32Array(TW * TH);
  // the built-up city: cells with houses, a cell around them, and the streets within three cells of them (roads &
  // tracks up the hills alone don't flatten them)
  const houseCount = new Uint16Array(TW * TH);
  for (let k = 0; k < houses.length; k += HS) {
    const i = Math.round((houses[k] / 10 - TX0) / CELL), j = Math.round((houses[k + 1] / 10 - TZ0) / CELL);
    if (i >= 0 && j >= 0 && i < TW && j < TH) houseCount[j * TW + i]++;
  }
  // (a chapel or antennas on a summit don't make it town: four buildings to a cell do)
  const built = houseCount.map((n) => (n >= 4 ? 1 : 0));
  const dilate = (src, r) => {
    const dst = new Uint8Array(src.length);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      if (!src[j * TW + i]) continue;
      for (let b = Math.max(0, j - r); b <= Math.min(TH - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(TW - 1, i + r); a++) dst[b * TW + a] = 1;
    }
    return dst;
  };
  const builtNear = dilate(built, 1), builtArea = dilate(built, 3), outskirts = dilate(built, 6);
  // The grid points around every roadway (the four corners of each cell a street crosses): the streets are drawn flat,
  // so no triangle under one may rise, or a stretch of street vanishes under a brown hump of hillside and comes out
  // the other side (the streets of the colonias up the lomas, the boulevards past empty lots)
  const roadV = new Uint8Array(TW * TH);
  // (the airfield likewise: the runway & taxiways as their strips, the apron cell by cell)
  for (const ring of airportRings) {
    const bb = bbox(ring);
    for (let z = bb.z0; z <= bb.z1; z += CELL / 4) for (let x = bb.x0; x <= bb.x1; x += CELL / 4) {
      if (!inRing(ring, x, z)) continue;
      const i = Math.floor((x - TX0) / CELL), j = Math.floor((z - TZ0) / CELL);
      if (i < 0 || j < 0 || i >= TW - 1 || j >= TH - 1) continue;
      roadV[j * TW + i] = roadV[j * TW + i + 1] = roadV[(j + 1) * TW + i] = roadV[(j + 1) * TW + i + 1] = 1;
    }
  }
  for (const s of [...drivePieces, ...airfieldPieces]) {
    const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    for (let t = 0; t <= L; t += CELL / 6) {
      const x = s.x0 + ((s.x1 - s.x0) * t) / Math.max(L, 1e-6), z = s.z0 + ((s.z1 - s.z0) * t) / Math.max(L, 1e-6);
      // (the roadway's edges too: a wide avenue near a cell line reaches into the next cell)
      for (const [ox, oz] of [[0, 0], [s.r, 0], [-s.r, 0], [0, s.r], [0, -s.r]]) {
        const i = Math.floor((x + ox - TX0) / CELL), j = Math.floor((z + oz - TZ0) / CELL);
        if (i < 0 || j < 0 || i >= TW - 1 || j >= TH - 1) continue;
        roadV[j * TW + i] = roadV[j * TW + i + 1] = roadV[(j + 1) * TW + i] = roadV[(j + 1) * TW + i + 1] = 1;
      }
    }
  }
  const roadAt = (x, z) => { const k = cellAt(x, z); return k >= 0 && lab[k] === 0 && !lakeCell[k]; }; // (off the raster, or a lake: no road)
  let missing = 0;
  for (let j = 0; j < TH; j++) {
    for (let i = 0; i < TW; i++) {
      const x = TX0 + i * CELL, z = TZ0 + j * CELL;
      const [lon, lat] = toLonLat(x, z);
      let e = elevation(lon, lat);
      if (!Number.isFinite(e)) { e = NaN; missing++; }
      E[j * TW + i] = e;
      // the city: built-up cells, and streets near them (a 4 x 4 sample of the cell)
      let road = 0;
      if (builtArea[j * TW + i]) {
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (roadAt(x + (a - 1.5) * CELL / 4, z + (b - 1.5) * CELL / 4)) road++;
      }
      U[j * TW + i] = builtNear[j * TW + i] || road >= 3 ? 1 : 0;
    }
  }
  // fill tiles we don't have with the mean
  let sum = 0, cnt = 0;
  for (const e of E) if (Number.isFinite(e)) { sum += e; cnt++; }
  for (let k = 0; k < E.length; k++) if (!Number.isFinite(E[k])) E[k] = sum / cnt;
  // separable box blur (3 passes ~ a Gaussian of sigma ~ r cells) over a w x h grid, the hills' by default
  const blur = (src, r, w = TW, h = TH, passes = 3) => {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 0; j < h; j++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += a[j * w + Math.min(w - 1, Math.max(0, i))];
        for (let i = 0; i < w; i++) {
          b[j * w + i] = acc / (2 * r + 1);
          acc += a[j * w + Math.min(w - 1, i + r + 1)] - a[j * w + Math.max(0, i - r)];
        }
      }
      for (let i = 0; i < w; i++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) acc += b[Math.min(h - 1, Math.max(0, j)) * w + i];
        for (let j = 0; j < h; j++) {
          a[j * w + i] = acc / (2 * r + 1);
          acc += b[Math.min(h - 1, j + r + 1) * w + i] - b[Math.max(0, j - r) * w + i];
        }
      }
    }
    return a;
  };
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  // The hills' heights h (m) over the valley floor, the floor being the elevation of the city cells U (1) nearby (near,
  // far: the blurred floor & its weights; D: metres to the city)
  const shape = (U) => {
    const EU = E.map((e, k) => e * U[k]);
    const near = [blur(EU, 7), blur(U, 7)];
    const far = [blur(EU, 30), blur(U, 30)];
    let usum = 0, ucnt = 0;
    for (let k = 0; k < E.length; k++) if (U[k]) { usum += E[k]; ucnt++; }
    const floorMean = ucnt ? usum / ucnt : sum / cnt;
    // distance (m) to the city: two-pass chamfer
    const D = new Float32Array(TW * TH).fill(1e9);
    for (let k = 0; k < D.length; k++) if (U[k]) D[k] = 0;
    const DG = CELL * Math.SQRT2;
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      if (i > 0) D[k] = Math.min(D[k], D[k - 1] + CELL);
      if (j > 0) {
        D[k] = Math.min(D[k], D[k - TW] + CELL);
        if (i > 0) D[k] = Math.min(D[k], D[k - TW - 1] + DG);
        if (i < TW - 1) D[k] = Math.min(D[k], D[k - TW + 1] + DG);
      }
    }
    for (let j = TH - 1; j >= 0; j--) for (let i = TW - 1; i >= 0; i--) {
      const k = j * TW + i;
      if (i < TW - 1) D[k] = Math.min(D[k], D[k + 1] + CELL);
      if (j < TH - 1) {
        D[k] = Math.min(D[k], D[k + TW] + CELL);
        if (i < TW - 1) D[k] = Math.min(D[k], D[k + TW + 1] + DG);
        if (i > 0) D[k] = Math.min(D[k], D[k + TW - 1] + DG);
      }
    }
    const h = new Float32Array(TW * TH);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      // the valley floor here: the city's elevation nearby, else further out, else its mean
      const wN = near[1][k], wF = far[1][k];
      const base = wN > 0.05 ? near[0][k] / wN : wF > 0.01 ? far[0][k] / wF : floorMean;
      h[k] = Math.max(0, E[k] - base) * smooth(15, 150, D[k]);
      // fade out at the edge of the grid
      const edge = Math.min(i, j, TW - 1 - i, TH - 1 - j) * CELL;
      h[k] *= smooth(0, 2500, edge);
    }
    return { h, near, far, D, floorMean };
  };
  // The streets in town and out to 450 m from it under up to 30 m of hill join the valley floor (the colonias' streets
  // up the lomas, the boulevards past empty lots: a cut sloping back ~20° over the next 75-150 m); the ones deeper in a
  // hill stay under it rather than cut a canyon into the cerro
  const h0 = shape(U).h;
  let lifted = 0;
  for (let k = 0; k < U.length; k++) if (!U[k] && roadV[k] && outskirts[k] && h0[k] < 30) { U[k] = 1; lifted++; }
  const { h: hills, near, far, D, floorMean } = shape(U);
  const out = new Int16Array(TW * TH);
  let peak = 0;
  for (let k = 0; k < hills.length; k++) {
    let h = hills[k];
    // out in the country a road cuts through the low rises (up to 8 m) instead of under them; the highways over the
    // sierra stay where they are
    if (roadV[k] && h < 8) h = 0;
    out[k] = Math.round(Math.min(3200, h) * 10);
    if (h > peak) peak = h;
  }
  // The lakes in the box (4) lie on the valley floor: the low rises under them (up to LAKE_HILL m) taken off, as under
  // the streets (every corner of a cell they reach into); a pond higher up a hill stays on it (flags 4: its water laid
  // on the hillside, js/world/terrain.ts)
  const LAKE_HILL = 30;
  let lakesUp = 0;
  for (const l of lakes) {
    if (l.flags & 2) continue;
    const corners = new Set();
    const mark = (x, z) => {
      const i = Math.floor((x - TX0) / CELL), j = Math.floor((z - TZ0) / CELL);
      if (i < 0 || j < 0 || i >= TW - 1 || j >= TH - 1) return;
      for (const k of [j * TW + i, j * TW + i + 1, (j + 1) * TW + i, (j + 1) * TW + i + 1]) corners.add(k);
    };
    const bb = bbox(l.shore);
    for (let z = bb.z0; z <= bb.z1; z += CELL / 4) for (let x = bb.x0; x <= bb.x1; x += CELL / 4) if (inRing(l.shore, x, z)) mark(x, z);
    for (const [x, z] of l.shore) mark(x, z);
    let top = 0;
    for (const k of corners) top = Math.max(top, out[k] / 10);
    if (top >= LAKE_HILL) { l.flags |= 4; lakesUp++; continue; }
    for (const k of corners) out[k] = 0;
  }
  // The ground under the town (js/world/ground.js): the city's own elevation on a 37.5 m grid (about the elevation
  // tiles' own ~38 m pixels), its lone spikes taken off and lightly blurred: SRTM measures roofs & treetops, and what's
  // wanted is a street's grade, not each house, but a wide blur flattened the town's short steep streets into long
  // gentle rises. Like the hills'
  // floor it is the built-up cells' elevation only (a normalised blur), so a hill beside a street doesn't lift it, and
  // away from the city (and towards the grid's edge) it eases to the city's mean, the floor the hills stand on now. Its
  // cells halve the hills' 75 m ones, so the world laid on the ground is cut along one lattice for both
  // (lattice.js clipToLattice).
  // Heights are over the datum, the lowest point of the town (built-up cells in BOX), so its ground is never under y = 0
  const GCELL = CELL / 2, GMARGIN = 1200, GEDGE = 600;
  // over the detailed city (BOX) and a margin for the roads leaving it, on whole cells of the hills' grid
  const GX0 = TX0 + Math.floor((BOX.x0 - GMARGIN - TX0) / CELL) * CELL, GZ0 = TZ0 + Math.floor((BOX.z0 - GMARGIN - TZ0) / CELL) * CELL;
  const GW = 2 * Math.ceil((BOX.x1 + GMARGIN - GX0) / CELL) + 1, GH = 2 * Math.ceil((BOX.z1 + GMARGIN - GZ0) / CELL) + 1;
  // a field of the hills' grid at (x, z), bilinear
  const coarse = (arr, x, z) => {
    const fx = Math.min(TW - 1.001, Math.max(0, (x - TX0) / CELL)), fz = Math.min(TH - 1.001, Math.max(0, (z - TZ0) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * TW + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + TW] * (1 - tx) + arr[k + TW + 1] * tx) * tz;
  };
  const GE = new Float32Array(GW * GH), GU = new Float32Array(GW * GH), GD = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i, x = GX0 + i * GCELL, z = GZ0 + j * GCELL;
    const e = elevation(...toLonLat(x, z));
    GE[k] = Number.isFinite(e) ? e : coarse(E, x, z);
    GU[k] = coarse(U, x, z);
    GD[k] = coarse(D, x, z);
  }
  // the roofs & treetops standing out of the ground one pixel at a time taken off (a 3 x 3 median), then a light blur
  const median = new Float32Array(GE.length);
  const around = new Float32Array(9);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    let n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) around[n++] = GE[Math.min(GH - 1, Math.max(0, j + b)) * GW + Math.min(GW - 1, Math.max(0, i + a))];
    median[j * GW + i] = around.sort()[4];
  }
  const GEU = median.map((e, k) => e * GU[k]);
  const gNear = [blur(GEU, 1, GW, GH, 1), blur(GU, 1, GW, GH, 1)]; // (one pass over 3 x 3 cells, σ ~ 30 m)
  const gFar = [blur(GEU, 13, GW, GH), blur(GU, 13, GW, GH)]; // (~500 m)
  const GF = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    const wN = gNear[1][k], wF = gFar[1][k];
    const f = wN > 0.05 ? gNear[0][k] / wN : wF > 0.01 ? gFar[0][k] / wF : floorMean;
    const edge = Math.min(i, j, GW - 1 - i, GH - 1 - j) * GCELL;
    GF[k] = f + (floorMean - f) * Math.max(smooth(300, GMARGIN, GD[k]), 1 - smooth(0, GEDGE, edge));
  }
  // The ground under each lake in the box levelled to its water: the nodes inside its shore at the height of the
  // lower quarter of the ground round it (water lies flat; the blurred elevation tilts with the slopes around it)
  const gBilinear = (x, z) => {
    const fx = Math.min(GW - 1.001, Math.max(0, (x - GX0) / GCELL)), fz = Math.min(GH - 1.001, Math.max(0, (z - GZ0) / GCELL));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * GW + i;
    return (GF[k] * (1 - tx) + GF[k + 1] * tx) * (1 - tz) + (GF[k + GW] * (1 - tx) + GF[k + GW + 1] * tx) * tz;
  };
  let lakeNodes = 0;
  for (const l of lakes) {
    if (l.flags & 6) continue;
    const rim = [];
    for (let a = 0; a < l.shore.length; a++) {
      const [x0, z0] = l.shore[a], [x1, z1] = l.shore[(a + 1) % l.shore.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 5));
      for (let s = 0; s < n; s++) rim.push(gBilinear(x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n));
    }
    rim.sort((p, q) => p - q);
    const level = rim[Math.floor(0.25 * (rim.length - 1))];
    const bb = bbox(l.shore);
    for (let j = Math.max(0, Math.ceil((bb.z0 - GZ0) / GCELL)); j <= Math.min(GH - 1, Math.floor((bb.z1 - GZ0) / GCELL)); j++) {
      for (let i = Math.max(0, Math.ceil((bb.x0 - GX0) / GCELL)); i <= Math.min(GW - 1, Math.floor((bb.x1 - GX0) / GCELL)); i++) {
        if (!inRing(l.shore, GX0 + i * GCELL, GZ0 + j * GCELL)) continue;
        GF[j * GW + i] = level;
        lakeNodes++;
      }
    }
  }
  log(`lakes: ${lakesUp} up the hills, the hills taken off under the rest, ${lakeNodes} nodes of the town's ground levelled under them`);
  // the datum is the lowest node under the town's streets & houses (a node of a cell with a built-up corner in BOX),
  // so no point of the town is under it
  const town = (i, j) => {
    const x = GX0 + i * GCELL, z = GZ0 + j * GCELL;
    return inBox(x, z) && coarse(U, x, z) >= 0.5;
  };
  let datum = Infinity, datumAt = [0, 0];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    let near = false;
    for (let b = Math.max(0, j - 1); b <= Math.min(GH - 1, j + 1) && !near; b++) for (let a = Math.max(0, i - 1); a <= Math.min(GW - 1, i + 1); a++) if (town(a, b)) { near = true; break; }
    if (near && GF[j * GW + i] < datum) { datum = GF[j * GW + i]; datumAt = [GX0 + i * GCELL, GZ0 + j * GCELL]; }
  }
  datum = Math.round(datum * 10) / 10;
  const groundOut = new Int16Array(GW * GH);
  for (let k = 0; k < GF.length; k++) groundOut[k] = Math.round((GF[k] - datum) * 10);
  // the ground between the nodes, on the same triangles as ground.js (each cell split from its +x corner to its +z)
  const gAt = (x, z) => {
    const fx = (x - GX0) / GCELL, fz = (z - GZ0) / GCELL;
    const i = Math.min(GW - 2, Math.max(0, Math.floor(fx))), j = Math.min(GH - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - i, tz = fz - j, k = j * GW + i;
    const h00 = groundOut[k], h10 = groundOut[k + 1], h01 = groundOut[k + GW], h11 = groundOut[k + GW + 1];
    return (tx + tz <= 1 ? h00 + (h10 - h00) * tx + (h01 - h00) * tz : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz)) / 10;
  };
  {
    // the grades the town's streets get: drivable ways, sampled every 10 m, in the built-up city
    const grades = [];
    let top = 0;
    for (const w of ways) {
      if (!DRIVE.has(w.tags.highway)) continue;
      const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const len = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s + 10 <= len; s += 10) {
          const x0 = ax + (bx - ax) * s / len, z0 = az + (bz - az) * s / len;
          const x1 = ax + (bx - ax) * (s + 10) / len, z1 = az + (bz - az) * (s + 10) / len;
          if (coarse(U, x0, z0) < 0.5 || !inBox(x0, z0)) continue;
          grades.push(Math.abs(gAt(x1, z1) - gAt(x0, z0)) / 10);
          top = Math.max(top, gAt(x0, z0));
        }
      }
    }
    grades.sort((a, b) => a - b);
    const pc = (q) => (grades[Math.floor(q * (grades.length - 1))] * 100).toFixed(1);
    const [dLon, dLat] = toLonLat(...datumAt);
    log(`ground: ${GW} x ${GH} cells of ${GCELL} m, datum ${datum} m a.s.l. (at ${dLat.toFixed(4)},${dLon.toFixed(4)}), town up to ${top.toFixed(0)} m over it, plaza ${gAt(0, 0).toFixed(1)} m; street grades p50 ${pc(0.5)}%, p90 ${pc(0.9)}%, p99 ${pc(0.99)}%, max ${pc(1)}%`);
  }
  const ground = { x0: GX0, z0: GZ0, cell: GCELL, w: GW, h: GH, datum, floor: Math.round((floorMean - datum) * 10) / 10, data: Buffer.from(groundOut.buffer).toString('base64') };

  // the cross on Cerro de la Cruz
  const crossPoi = (poisOSM.elements || []).find((e) => e.tags && /cerro de la cruz/i.test(e.tags.name || ''));
  const cross = crossPoi ? toWorld(crossPoi.lon, crossPoi.lat).map(q) : null;

  // The ways up the hills (the cobbled calzada to the cross, its stairs & footpaths, the tracks): each as
  // [surface (0 cobbles, 1 concrete / paving, 2 earth), width (m), flat points] where it climbs over 4 m of hill
  const heightAt = (x, z) => {
    const fx = (x - TX0) / CELL, fz = (z - TZ0) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= TW - 1 || j >= TH - 1) return 0;
    const tx = fx - i, tz = fz - j, k = j * TW + i;
    return ((out[k] * (1 - tx) + out[k + 1] * tx) * (1 - tz) + (out[k + TW] * (1 - tx) + out[k + TW + 1] * tx) * tz) / 10;
  };
  const CLIMB = /^(unclassified|residential|tertiary|service|pedestrian|footway|path|steps|track|living_street)$/;
  const paths = [];
  let pathLen = 0;
  for (const w of ways) {
    const t = w.tags;
    if (!CLIMB.test(t.highway)) continue;
    const pts = w.geometry.map((g) => toWorld(g.lon, g.lat));
    let top = 0;
    for (const [x, z] of pts) top = Math.max(top, heightAt(x, z));
    if (top < 4) continue;
    // the trails & tracks of the far hills only near Cerro de la Cruz
    const minor = /^(path|track)$/.test(t.highway);
    if (minor && (!cross || Math.min(...pts.map(([x, z]) => Math.hypot(x - cross[0], z - cross[1]))) > 1500)) continue;
    const surf = t.surface || '';
    const surface = /cobble|sett|unhewn/.test(surf) ? 0 : /paving|concrete|asphalt|paved/.test(surf) || t.highway === 'steps' || t.highway === 'pedestrian' ? 1 : /^(unclassified|residential|tertiary|living_street)$/.test(t.highway) ? 0 : 2;
    const width = t.highway === 'path' ? 1.6 : t.highway === 'steps' || t.highway === 'footway' ? 2.2 : t.highway === 'pedestrian' ? 4 : t.highway === 'track' ? 3.2 : 5.5;
    const line = rdp(pts, 0.6);
    for (let i = 1; i < line.length; i++) pathLen += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    paths.push([surface, width, flat(line)]);
  }
  log(`hill paths: ${paths.length} ways, ${(pathLen / 1000).toFixed(1)} km`);
  if (process.env.TERRAIN_DEBUG) {
    for (const [name, x, z] of [['cross', ...(cross || [0, 0])], ['san juan', -3900, 1400], ['plaza', 0, 0]]) {
      const i = Math.round((x - TX0) / CELL), j = Math.round((z - TZ0) / CELL), k = j * TW + i;
      const wN = near[1][k], wF = far[1][k];
      const base = wN > 0.05 ? near[0][k] / wN : wF > 0.01 ? far[0][k] / wF : floorMean;
      log(`  ${name}: elevation ${E[k].toFixed(0)}, floor ${base.toFixed(0)}, urban ${U[k]}, ${D[k].toFixed(0)} m from the city, height ${out[k] / 10}`);
    }
  }
  log(`terrain: ${lifted} grid points under streets brought down to the valley floor`);
  log(`terrain: ${TW} x ${TH} cells of ${CELL} m, highest ${Math.round(peak)} m over the valley floor (${Math.round(floorMean)} m a.s.l.), ${missing} cells off the tiles`);
  return { x0: TX0, z0: TZ0, cell: CELL, w: TW, h: TH, floor: Math.round(floorMean), data: Buffer.from(out.buffer).toString('base64'), cross, paths, ground };
})();
const terrain = ground ? terrainGrid : null;

// =====================================================================================================================
// 6. TELEPORTS & START: named spots snapped onto the nearest drivable street
// =====================================================================================================================
const SPOTS = [
  ['plaza', 'Plaza Principal y Catedral', 'Av. México · Centro Histórico', 21.51224, -104.89269, 21.51184, -104.89121],
  ['alameda', 'La Alameda', 'Parque Juan Escutia · Centro', 21.50991, -104.90109],
  ['loma', 'Parque La Loma', 'Av. Insurgentes · La Loma', 21.50388, -104.89890],
  ['mercado', 'Mercado Morelos', 'Centro Histórico', 21.51075, -104.89532],
  ['uan', 'Estadio de Béisbol UAN', 'Ciudad de la Cultura · Av. Insurgentes', 21.49074, -104.88983],
  ['central', 'Central de Autobuses', 'Av. Insurgentes · Ciudad del Valle', 21.49839, -104.88706],
  ['estacion', 'Antigua estación del tren', 'Av. Allende · Ferrocarril', 21.50392, -104.88208],
  ['juventud', 'Parque Lineal Juventud', 'Colonia Juventud', 21.49525, -104.87694],
  ['xalisco', 'Xalisco Centro', 'Plaza Benito Juárez · Xalisco', 21.44370, -104.90170],
  ['bonaterra', 'Bonaterra', 'Libramiento · Bonaterra', 21.46550, -104.84385],
  ['aeropuerto', 'Aeropuerto de Tepic', 'Terminal · Pantanal', 21.41720, -104.83820, 21.41700, -104.83930]
];
const linkPts = links.map(([a, b, , , , dir, inner]) => {
  const pts = [gnodes[a]];
  for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
  pts.push(gnodes[b]);
  return { pts, dir };
});
function snapToStreet(x, z, faceX, faceZ) {
  let best = null;
  for (const l of linkPts) {
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [ax, az] = l.pts[i], [bx, bz] = l.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + t * dx, pz = az + t * dz;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { d, px, pz, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2), dir: l.dir };
    }
  }
  if (!best || best.d > 260) return null;
  let { dx, dz } = best;
  // travel direction: the street's one-way direction, else towards the thing to face
  if (best.dir < 0 || (best.dir === 0 && Number.isFinite(faceX) && dx * (faceX - best.px) + dz * (faceZ - best.pz) < 0)) { dx = -dx; dz = -dz; }
  const rx = -dz, rz = dx; // right of travel
  return { x: q(best.px + rx * 1.8), z: q(best.pz + rz * 1.8), heading: Math.round(Math.atan2(dx, dz) * 1000) / 1000 };
}
const teleports = {};
for (const [key, name, sub, lat, lon, flat2, flon] of SPOTS) {
  const [x, z] = toWorld(lon, lat);
  const face = flat2 !== undefined ? toWorld(flon, flat2) : [NaN, NaN];
  const s = snapToStreet(x, z, face[0], face[1]);
  if (!s) { log(`teleport ${key}: no street within 120 m`); continue; }
  teleports[key] = { name, sub, ...s };
}
log(`teleports: ${Object.keys(teleports).join(', ')}`);

// =====================================================================================================================
// 6B. PUBLIC TRANSPORT: the Secretaría de Movilidad's routes, driven along the road graph
// =====================================================================================================================
// Tepic's routes are run by camiones (midibuses painted in their route's colours, its name across the windshield)
// and combis (white Urvan & Hiace vans with the route's sign on the roof). The map doesn't say which serves which;
// photos of the streets do for some, and the game puts both on the rest.
const ROUTE_FLEET = [[/^Progreso/, 'bus'], [/^Mololoa/, 'bus'], [/^Cantera Hospitales/, 'combi'], [/^Allende$/, 'combi']];
const transit = { groups: [], routes: [] };
{
  const file = path.join(DATA, 'semovi_routes.json');
  if (fs.existsSync(file)) {
    const src = JSON.parse(fs.readFileSync(file, 'utf8'));
    const groups = src.geojson.groups || [];
    transit.groups = groups.map((g) => g.title.replace(/^Rutas? Tepic - /, ''));
    const match = createRouteMatcher(linkPts.map(({ pts, dir }, i) => ({ a: links[i][0], b: links[i][1], pts, dir })));
    let drawn = 0, on = 0;
    for (const f of src.geojson.features) {
      if (!f.geometry || f.geometry.type !== 'LineString') continue;
      const name = f.properties.title.trim();
      const r = match(f.geometry.coordinates.map(([lon, lat]) => toWorld(lon, lat)));
      drawn += r.samples;
      on += r.matched;
      if (!r.pieces.length) { log(`route ${name}: not on the map`); continue; }
      const fleet = (ROUTE_FLEET.find(([re]) => re.test(name)) || [null, ''])[1];
      // [name, group index, the map's line colour, 'bus' | 'combi' | '' (both), loops 1 | 0, pieces: signed link refs]
      transit.routes.push([name, Math.max(0, groups.findIndex((g) => g.id === f.properties.group)), f.properties.stroke || '#5a5a5a',
        fleet, r.loop ? 1 : 0, r.pieces]);
      if (r.pieces.length > 1 || !r.loop) log(`route ${name}: ${r.pieces.length} piece(s), ${r.loop ? 'loops' : 'open'}, ${Math.round((100 * r.matched) / r.samples)}% on the map`);
    }
    log(`transit: ${transit.routes.length} routes, ${((100 * on) / Math.max(1, drawn)).toFixed(1)}% of their drawn length matched to streets`);
  } else log('transit: no semovi_routes.json (tools/data/tepic/fetch-routes.sh)');
}

// =====================================================================================================================
// 6C. THE FOOTBRIDGES' STAIRS (3C): a straight flight down from either end of each deck, in line with it where that
//     is clear of the buildings (5B) and the roadways, else turned along the road from a landing, to whichever side is
//     clearer (a roadway counts for ten buildings: a flight can't stand in the street, but OpenStreetMap's stairs stand
//     where Overture may have drawn a shop). The buildings a flight still stands on go. And the low footbridges: the
//     bridge ways over no road that cross an open channel (5B's waterways), a walkway just over it
//     (Before 6D: it takes houses out of the list, whose indices 6D keeps)
// =====================================================================================================================
const FOOT_LOW = 0.3; // m: a footbridge's walkway over an arroyo or a drain, over the ground either side
const footbridges = [];
{
  const top = FOOT_CLEARANCE + FOOT_DECK;
  const run = top / STAIR;
  let turned = 0, blocked = 0;
  const gone = new Set(); // houses (index) a flight stands on
  for (const f of footDecks) {
    // the buildings and roadway pieces within reach of the bridge
    const xs = f.deck.map((p) => p[0]), zs = f.deck.map((p) => p[1]);
    const R = run + 15;
    const x0 = Math.min(...xs) - R, x1 = Math.max(...xs) + R, z0 = Math.min(...zs) - R, z1 = Math.max(...zs) + R;
    const near = []; // house indices
    for (let k = 0; k + HS <= houses.length; k += HS) {
      const cx = houses[k] / 10, cz = houses[k + 1] / 10;
      if (cx > x0 && cx < x1 && cz > z0 && cz < z1) near.push(k / HS);
    }
    const roads = drivePieces.filter((r) => Math.max(r.x0, r.x1) > x0 && Math.min(r.x0, r.x1) < x1 && Math.max(r.z0, r.z1) > z0 && Math.min(r.z0, r.z1) < z1);
    const inRoad = (x, z) => roads.some((r) => {
      const ux = r.x1 - r.x0, uz = r.z1 - r.z0;
      const t = Math.max(0, Math.min(1, ((x - r.x0) * ux + (z - r.z0) * uz) / (ux * ux + uz * uz || 1)));
      return Math.hypot(r.x0 + ux * t - x, r.z0 + uz * t - z) < r.r;
    });
    // the house (index) at (x, z), or -1
    const houseIn = (x, z) => {
      for (const n of near) {
        const k = n * HS;
        const cx = houses[k] / 10, cz = houses[k + 1] / 10, hx = houses[k + 2] / 20, hz = houses[k + 3] / 20;
        const th = houses[k + 4] / 1000, cs = Math.cos(th), sn = Math.sin(th);
        const dx = x - cx, dz = z - cz;
        if (Math.abs(cs * dx - sn * dz) < hx && Math.abs(sn * dx + cs * dz) < hz) return n;
      }
      return -1;
    };
    // a flight from `from` down along `dir`: its sides and middle every metre (from 2 m down: its top stands by the
    // roadway it spans), and what each stands in
    const footprint = (from, dir, fn) => {
      for (let s = 2; s <= run; s += 1) {
        for (const o of [-f.half, 0, f.half]) fn(from[0] + dir[0] * s - dir[1] * o, from[1] + dir[1] * s + dir[0] * o);
      }
    };
    const cost = (from, dir) => {
      let n = 0;
      footprint(from, dir, (x, z) => { n += inRoad(x, z) ? 10 : houseIn(x, z) >= 0 ? 1 : 0; });
      return n;
    };
    const flight = (end0, out) => {
      // in line; or from a landing just past the deck's end, along the road either way. Where all three come down in
      // a street (a lateral beside the road the bridge spans), the deck carries on over it first, up to 25 m
      let best = null, bestN = Infinity;
      for (const more of [0, 5, 10, 15, 20, 25]) {
        const end = [end0[0] + out[0] * more, end0[1] + out[1] * more];
        const landing = [end[0] + out[0] * (f.half + 0.3), end[1] + out[1] * (f.half + 0.3)];
        const ways = [{ from: end, dir: out, land: null }, { from: landing, dir: [-out[1], out[0]], land: landing }, { from: landing, dir: [out[1], -out[0]], land: landing }];
        for (const w of ways) {
          const n = cost(w.from, w.dir) + (w.land ? 2 : 0) + more * 0.4; // (in line, unless that runs into more)
          if (n < bestN) { bestN = n; best = { ...w, deckTo: more ? end : null }; }
        }
        if (bestN < 10) break;
      }
      if (best.land) turned++;
      if (bestN >= 10) blocked++;
      footprint(best.from, best.dir, (x, z) => { const n = houseIn(x, z); if (n >= 0) gone.add(n); });
      if (best.land) {
        for (const o of [-f.half, 0, f.half]) for (const s of [-f.half, 0, f.half]) {
          const n = houseIn(best.land[0] + out[0] * s - out[1] * o, best.land[1] + out[1] * s + out[0] * o);
          if (n >= 0) gone.add(n);
        }
      }
      const foot = [best.from[0] + best.dir[0] * run, best.from[1] + best.dir[1] * run];
      return [...(best.deckTo ? [best.deckTo] : []), ...(best.land ? [best.land, foot] : [foot])];
    };
    const [start, end] = [flight(f.deck[0], f.out[0]), flight(f.deck[f.deck.length - 1], f.out[1])];
    const pts = [...start.reverse(), ...f.deck, ...end];
    footbridges.push([flat(pts), pts.map((_, i) => (i === 0 || i === pts.length - 1 ? 0 : Math.round(top * 10))), Math.round(f.half * 20)]);
  }
  // (from the last down, so the indices still to go stay put)
  for (const n of [...gone].sort((a, b) => b - a)) houses.splice(n * HS, HS);
  log(`footbridge stairs: ${footbridges.length * 2} flights, ${turned} turned along the road, ${blocked} still into a roadway; ${gone.size} buildings under them taken out`);

  // The low footbridges: over an open channel (the waterways the blocks leave a gap for, above ground)
  const open = waterways.filter((w) => w[1] > 0 && !(w[3] & 2)).map((w) => { const p = []; for (let k = 0; k + 1 < w[4].length; k += 2) p.push([w[4][k], w[4][k + 1]]); return p; });
  let low = 0;
  for (const { line, half } of footOthers) {
    const over = open.some((w) => {
      for (let i = 0; i + 1 < line.length; i++) for (let j = 0; j + 1 < w.length; j++) if (segCross(line[i], line[i + 1], w[j], w[j + 1])) return true;
      return false;
    });
    if (!over) continue;
    footbridges.push([flat(line), line.map(() => Math.round(FOOT_LOW * 10)), Math.round(half * 20)]);
    low++;
  }
  log(`low footbridges: ${low} over the arroyos, rivers & drains`);
}

// =====================================================================================================================
// 6D. WHAT'S KNOWN OF PARTICULAR BUILDINGS (js/world/building-overrides.js): each entry finds the building it points
// at; its storeys go into the house, its paint into GEO.overrides [house index, storeys (0: as guessed), paint
// (0xrrggbb, -1: the palette's)], which also tells buildings.js to draw it whole
// =====================================================================================================================
const overrides = [];
for (const o of BUILDING_OVERRIDES) {
  const [x, z] = toWorld(o.lon, o.lat);
  const n = houseAt(houses, HS, x, z);
  if (n < 0) { log(`override ${o.note || `${o.lat},${o.lon}`}: no building there`); continue; }
  const storeys = Number.isInteger(o.storeys) ? Math.max(1, Math.min(12, o.storeys)) : 0;
  if (storeys) houses[n * HS + 5] = storeys;
  const paint = /^#[0-9a-f]{6}$/i.test(o.paint || '') ? parseInt(o.paint.slice(1), 16) : -1;
  overrides.push([n, storeys, paint]);
}
if (BUILDING_OVERRIDES.length) log(`overrides: ${overrides.length} of ${BUILDING_OVERRIDES.length} pinned to a building`);

// =====================================================================================================================
// 7. ASSEMBLE
// =====================================================================================================================
const GEO = {
  version: 2,
  frame: {
    city: 'Tepic', grid: false, waterfront: false,
    bearingDeg: Math.round((THETA * 180) / Math.PI * 100) / 100, origin: 'Plaza Principal de Tepic', units: 'm',
    lat0: LAT0, lon0: LON0,
    cutZ: BOX.z0 - 50, strip: 0, sidewalk: SIDEWALK,
    box: { ...BOX },
    start: teleports.plaza ? { x: teleports.plaza.x, z: teleports.plaza.z, heading: teleports.plaza.heading } : { x: 0, z: 0, heading: 0 }
  },
  manhattan: flat(boxRing),
  upperManhattan: [],
  innerShore: flat(boxRing),
  islands: {},
  boroughs: {},
  streets: [],
  avenues: [],
  broadway: [],
  plazas: [],
  roads: roadLines.map((r) => [r.name, q(r.w), r.dir, r.lanes, r.hw ? 1 : 0, flat(r.pts)]),
  // links: [a, b, name, width, lanes, dir, inner, lifts (dm over the ground at a, inner..., b, < 0 down in an
  // underpass; 0 when all at grade), way (1: a bridge way, 2: a tunnel way, 0 neither)]
  roadGraph: { nodes: gnodes.flatMap(([x, z]) => [q(x), q(z)]), links, names, signals },
  // The railway: [flat points, lifts (dm, or 0), bridge (1: a bridge way), main line (1) or siding / yard (0)]
  rails,
  // The footbridges (3C, 6C): [flat points from one stair's foot to the other's, lifts (dm over the ground at each; the
  // deck between the stairs' tops; a low one over an arroyo FOOT_LOW all along), width (dm)]
  footbridges,
  // [outline, lot rects, park share, park name, rectangular, frontage frames | 0, open country (no buildings) 1 | 0]
  blocks: blocks.map((b) => [flat(b.poly), b.rects.map((r) => r.map(q)), b.park || 0, b.parkName || '', b.rect ? 1 : 0,
    b.frames ? b.frames.map(([th, px, pz, rs]) => [Math.round(th * 1e4) / 1e4, q(px), q(pz), rs.map((r) => r.map(q))]) : 0, b.rural ? 1 : 0]),
  parks,
  // [kind (river, stream, canal, drain, ditch), half-width of the gap between the blocks (m), name, flags (1
  // intermittent, 2 underground), flat points downstream]
  waterways,
  // The rivers' whole courses where they run on beyond the box: [name, flat points downstream]
  farRivers,
  centralPark: null,
  piers: [],
  bridges: {},
  landmarks,
  points: {},
  places,
  pois,
  teleports,
  // Real buildings (Overture Maps), 8 integers each: centre x, z (dm), width, depth (dm, local x / z), turn θ
  // (mrad, world = c + R_y(θ)·local), storeys, front side (0 w, 1 e, 2 n, 3 s of the local frame) + KIND bits (4 a shop, 8 a big box, 16 a strip plaza, 32 a coto's house, its number + 1 from bit 6 up), sign
  // (1-based index into `signs`, 0 none)
  houseStride: HS,
  houses,
  // Gated communities (5B2), [walls, gates] each: walls, polylines along the property line (flat x, z); gates, 4 numbers
  // each: booth x, z (m), heading into the coto (mrad, atan2 of z over x), private street width (m)
  cotos,
  // Shop sign faces: { text, bg, fg, border, chain?, big? } (chains carry parody names)
  signs,
  // The hills around the valley: heights (dm, Int16 little-endian, base64) over the flat city on a w x h grid of
  // `cell` m from (x0, z0), row by row; `cross`: the Cerro de la Cruz summit
  terrain,
  // The ground under the town: heights (dm, Int16 little-endian, base64) over `datum` (m a.s.l., the
  // town's lowest point) on a w x h grid of `cell` m from (x0, z0), row by row; `floor`: its height away from town
  ground,
  // Bus & combi routes (6B): groups, the zones' names; routes, [name, group, colour, fleet 'bus' | 'combi' | '' (both),
  // loops 1 | 0, pieces], each piece the roadGraph links driven in turn (index + 1 from a to b, -(index + 1) back)
  transit,
  // The airport (4): runways & taxiways [ref, width (m), flat centreline], aprons & helipads (flat rings), gates (the
  // boarding bridges [x, z at the terminal, x, z at the aircraft])
  airport,
  // Buildings drawn as they are (6D): [house index, storeys (0: as guessed), paint (0xrrggbb, -1: the palette's)]
  overrides,
  // Surface car parks (4), inside the property lines: [name ('' none), surface (0 asphalt, 1 concrete, 2 setts, 3 earth
  // or gravel), the stall rows' direction θ (mrad: along (cos θ, -sin θ)), outline (flat ring), entrances ([x, z on
  // the curb (m), the way in square to it (mrad, atan2 of z over x), width (m), path from the curb to the lot (flat)])]
  parking: parkingLots.map((p) => [p.name, p.surface, Math.round(p.th * 1000), flat(p.poly), p.entrances]),
  // Lakes, presas, ponds & reservoirs (4): [kind (lake, pond, reservoir, wetland), name, flags (1 intermittent, 2
  // beyond the box, 4 up the hills: laid on the hillside, no basin), outline (flat ring, its shore)]
  lakes: lakes.map((l) => [l.kind, l.name, l.flags, flat(l.shore)]),
  // Pedestrian crossings on the streets (3): x, z (m), kind (0 unmarked, 1 marked, 2 with lights), flat
  crossings: pedCrossings,
  // Bus stops on the sidewalks (3): x, z (m), flags (1 a shelter, 2 a bench), flat
  busStops,
  // Speed bumps (3): x, z (m), kind (0 a bump or hump, 1 a table, 2 a cushion, 3 a rumble strip), flat
  topes,
  // Trees OpenStreetMap maps (3): x, z (m), kind (0 a lone tree, 1 one of a row), flat
  trees: mappedTrees,
  // Street lamps OpenStreetMap maps (3): x, z (m), flat
  lamps: streetLamps,
  // High-voltage lines (3): [kV (0 not said), flat points: a tower at each]
  powerLines
};

const json = JSON.stringify(GEO);
const header = `// js/world/city-geodata.js — GENERATED by tools/build-tepic-geodata.mjs, do not edit by hand.
// Tepic, Nayarit in the simulation's world frame: 1 unit = 1 m, x = east along the centro's grid, z = south,
// origin at the Plaza Principal, axes turned ${GEO.frame.bearingDeg}° from true north.
// Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.
// Source: © OpenStreetMap contributors (ODbL), via Overpass (tools/data/tepic/); bus & combi routes from the
// Secretaría de Movilidad del Estado de Nayarit.
`;
fs.writeFileSync(OUT, `${header}export const GEO = ${json};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
