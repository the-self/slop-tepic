import * as THREE from 'three/webgpu';
import { texture, uniform, positionWorld, step, mix } from 'three/tsl';
import { BLOCKS, ROADS, CITY_OUTLINE } from './city-config.js';
import { GEO } from './city-geodata.js';

// js/world/far-ground.js
// The city's ground as seen from afar, the way GTA draws its LOD: beyond the streamed tiles (streaming.js), where the
// road deck, the sidewalks, the lots and the parks are not laid, the floor under the buildings is painted with them
// instead, from one texture of the detailed box: the asphalt between the blocks, the blocks' lots (green where they lie
// open, earth & patios where they are built up: lot-greenery.js openness), the parks, the open country, the rivers and
// the airport. terrain.js puts it on the hills' floor under the tiles (on the slopes), city-grid.js's valley floor in
// the flat city. Its colours are the near layers' own, averaged (tsl-materials.js), so a tile coming in changes the
// detail, not the colour.

const SIZE = 2048; // texels a side (the box is ~16 km: ~8 m a texel, a street a texel or two at 1 km and more)
const COLORS = {
  asphalt: '#383b40', // the road deck (createRoadSurfaceMaterial's light & dark asphalt)
  sidewalk: '#807f78',
  built: '#857b68', // a built-up lot: patios, tiles & the earth between the houses (createLotGroundMaterial)
  open: '#55602f', // an open lot: grass & weeds
  park: '#36682c', // a park's lawn (createParkLawnMaterial)
  meadow: '#486c33', // the open country
  wood: '#2e4a24',
  water: '#4a5848', // the Mololoa's silty water
  airfield: '#6a6c6e'
};

// The colour a block paints from afar: the open country's meadow, a park's lawn, a camellón's grass, else its lot's,
// green where it lies open (over 60 % of it: `open`, lot-greenery.js openness) and earth & patios where built up
function lotColor(b, open = 0.5) {
  if (b.rural) return COLORS.meadow;
  if (b.park > 0.6 && !b.median) return COLORS.park;
  if (b.median) return COLORS.open;
  return open > 0.6 ? COLORS.open : COLORS.built;
}

/**
 * Paints the box's ground into a texture. `open`: Map(block -> 0..1) of how open each block's lot lies
 * (city-grid.js); `box`: { x0, x1, z0, z1 }. Returns { texture, origin, span }: world (x, z) to uv is
 * (x - origin) / span, v down the canvas as z runs south.
 */
function paintFarGround({ open = null, box, size = SIZE } = {}) {
  const span = Math.max(box.x1 - box.x0, box.z1 - box.z0);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  const k = size / span;
  ctx.setTransform(k, 0, 0, k, -box.x0 * k, -box.z0 * k); // world metres in, texels out
  const ring = (pts, path = new Path2D()) => {
    pts.forEach((p, i) => (i ? path.lineTo(p.x, p.z) : path.moveTo(p.x, p.z)));
    path.closePath();
    return path;
  };
  const flatRing = (r, path = new Path2D()) => {
    for (let i = 0; i + 1 < r.length; i += 2) (i ? path.lineTo(r[i], r[i + 1]) : path.moveTo(r[i], r[i + 1]));
    path.closePath();
    return path;
  };
  const flatLine = (r, path = new Path2D()) => {
    for (let i = 0; i + 1 < r.length; i += 2) (i ? path.lineTo(r[i], r[i + 1]) : path.moveTo(r[i], r[i + 1]));
    return path;
  };
  // the deck, then the blocks on it: each one's lot by how open it lies (a sidewalk's share of it at this scale)
  ctx.fillStyle = COLORS.asphalt;
  ctx.fill(ring(CITY_OUTLINE));
  const byColor = new Map();
  for (const b of BLOCKS) {
    const c = lotColor(b, open?.get(b));
    if (!byColor.has(c)) byColor.set(c, new Path2D());
    ring(b.poly, byColor.get(c));
  }
  for (const [c, path] of byColor) {
    ctx.fillStyle = c;
    ctx.fill(path);
  }
  // (each block's edge: its sidewalk, a texel's line)
  ctx.strokeStyle = COLORS.sidewalk;
  ctx.lineWidth = 1 / k;
  for (const path of byColor.values()) ctx.stroke(path);
  // the parks & woods of OpenStreetMap over the open country, the water
  const parks = new Path2D(), woods = new Path2D(), water = new Path2D();
  for (const p of GEO.parks || []) {
    const into = p.cat === 'water' ? water : p.cat === 'wood' || p.cat === 'forest' ? woods : p.cat === 'pitch' ? null : parks;
    if (into) for (const r of p.rings || []) flatRing(r, into);
  }
  ctx.fillStyle = COLORS.park;
  ctx.fill(parks);
  ctx.fillStyle = COLORS.wood;
  ctx.fill(woods);
  ctx.fillStyle = COLORS.water;
  ctx.fill(water);
  // the rivers & arroyos at their widths (as the map draws them), the highways' asphalt over the lots they cross
  ctx.strokeStyle = COLORS.water;
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const [kind, , , flags, pts] of GEO.waterways || []) {
    if (flags & 2) continue;
    ctx.lineWidth = Math.max(kind === 'river' ? 10 : kind === 'stream' ? 3.8 : 2, 1 / k);
    ctx.stroke(flatLine(pts));
  }
  ctx.strokeStyle = COLORS.asphalt;
  for (const r of ROADS) {
    if (!r.highway) continue;
    ctx.lineWidth = Math.max(r.w, 1 / k);
    const path = new Path2D();
    r.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.z) : path.moveTo(p.x, p.z)));
    ctx.stroke(path);
  }
  // the airport's apron, runway & taxiways
  const airport = GEO.airport || { aprons: [], helipads: [], runways: [], taxiways: [] };
  ctx.fillStyle = ctx.strokeStyle = COLORS.airfield;
  for (const r of [...airport.aprons, ...airport.helipads]) ctx.fill(flatRing(r));
  ctx.lineCap = 'butt';
  for (const [list, width] of [[airport.taxiways, 18], [airport.runways, 45]]) {
    ctx.lineWidth = width;
    for (const [, , pts] of list) ctx.stroke(flatLine(pts));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // (row 0 is the box's north edge: v = (z - z0) / span)
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  return { texture: tex, origin: new THREE.Vector2(box.x0, box.z0), span: new THREE.Vector2(span, span) };
}

/**
 * The colour of the far ground at the fragment (TSL): the painted box's inside it, `outside` (a colour node) beyond it
 */
function farGroundColor(far, outside) {
  const uv = positionWorld.xz.sub(uniform(far.origin)).div(uniform(far.span));
  const inside = step(0, uv.x).mul(step(uv.x, 1)).mul(step(0, uv.y)).mul(step(uv.y, 1));
  return mix(outside, texture(far.texture, uv).rgb, inside);
}

export { paintFarGround, farGroundColor, lotColor, COLORS as FAR_GROUND_COLORS };
