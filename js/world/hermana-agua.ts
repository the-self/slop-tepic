// js/world/hermana-agua.ts
// La glorieta de la Hermana Agua, where the Paseo de la Loma meets the Calzada de la Cruz & Av. México by the Parque
// La Loma: a nude woman in grey stone, her head bowed over the water cupped in her hands (assets/models/hermana-agua.glb:
// Meshy from a drawn image, prepared by tools/models/prepare-statue.py) on a round pedestal in a two-tier fountain: the
// inner tier rust-brown with the water sheeting down it, the outer a low wall of pale grey blocks, jets rising in its
// pool and arching in from its rim; round it the island's lawn, half-moons of pale pavers, beds of iris, spider plants,
// agaves and shrubs, a band of cobbles inside its curb, painted pink (createCurbMaterial); and the DIF's totem on the
// park's corner across the street. As the user's photographs show it. The island is the roundabout's block
// (OpenStreetMap way 1313667127), ~26 m across.
import * as THREE from 'three/webgpu';
import { atan, color, float, floor, fract, mix, positionWorld, sin, smoothstep, step, vec2 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, blockAt } from './city-config.ts';
import { liftAt } from './ground.ts';
import { offsetPolygonInward } from './park-floor.ts';
import { geoToWorld } from './landmark-models.ts';
import { figure } from './tepic-landmarks.ts';
import { hash2D } from '../render/materials/shared.ts';
import { createParkLawnMaterial, createParkPavingMaterial } from '../render/tsl-materials.ts';
import type { PointXZ } from './city-config.ts';
import type { Collider } from './buildings.ts';

const STATUE_FILE = 'assets/models/hermana-agua.glb';
/** m over the island's ground: the lawn (the sidewalk slab under it tops at 0.22) */
const LAWN_Y = 0.245;
/** m: the fountain's outer wall (radius, height over the lawn, thickness), its pool's level under the coping, and the
 *  inner tier (radius, top over the lawn) */
const OUTER_R = 7.6, OUTER_H = 0.75, WALL = 0.35, POOL = 0.18;
const INNER_R = 3.4, INNER_H = 1.6;
/** m: the round pedestal in the inner pool, and the statue's height on it */
const PEDESTAL_R = 0.75, PEDESTAL_H = 0.35, STATUE_H = 3.8;
// where the roundabout is (the monument isn't mapped; its ring's middle)
const AT = geoToWorld(21.502578, -104.896108);
const ISLAND = blockAt(AT[0], AT[1]);
/** The island, for the lots no tree is planted in (street-details.ts): only the fountain's beds grow there */
const GLORIETA_CLEAR = {
  contains: (x: number, z: number) => !!ISLAND && Math.abs(x - ISLAND.cx) < 16 && Math.abs(z - ISLAND.cz) < 16 && blockAt(x, z) === ISLAND
};

// a seeded random (the beds look the same every load)
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How far a ray from (cx, cz) along angle a runs before it leaves the polygon
function reach(poly: readonly PointXZ[], cx: number, cz: number, a: number) {
  const dx = Math.cos(a), dz = Math.sin(a);
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i];
    const ex = q.x - p.x, ez = q.z - p.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x - cx) * ez - (p.z - cz) * ex) / den;
    const u = ((p.x - cx) * dz - (p.z - cz) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/**
 * A ring of ground round (cx, cz) from radius r0(angle) out to r1(angle), draped on the slopes at `y` over them (relative to
 * y0, the glorieta's floor), angles a0..a1; uv.x carries `style` (the park paving's pick)
 */
function groundRing(cx: number, cz: number, y0: number, y: number, r0: (a: number) => number, r1: (a: number) => number, a0 = 0, a1 = Math.PI * 2, style = 0) {
  const SEG = Math.max(6, Math.round(((a1 - a0) / (Math.PI * 2)) * 96)), RINGS = 4;
  const pos: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const a = a0 + ((a1 - a0) * i) / SEG, ca = Math.cos(a), sa = Math.sin(a), R0 = r0(a), R = r1(a);
    for (let k = 0; k <= RINGS; k++) {
      const r = R0 + ((R - R0) * k) / RINGS, x = ca * r, z = sa * r;
      pos.push(x, liftAt(cx + x, cz + z) - y0 + y, z);
      uvs.push(style, 0);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let k = 0; k < RINGS; k++) {
      const v = i * (RINGS + 1) + k, w = v + RINGS + 1;
      // counter-clockwise seen from above (the angles run from +x towards +z)
      index.push(v, w, v + 1, w, w + 1, v + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}

// A round wall r outer, `t` thick, from bottom to top (a lathe's profile)
function ringWall(r: number, t: number, bottom: number, top: number) {
  return new THREE.LatheGeometry([[r - t, top], [r - t, bottom], [r, bottom], [r, top], [r - t, top]].map(([x, y]) => new THREE.Vector2(x, y)), 72).toNonIndexed();
}

/**
 * The beds' plants as one geometry with vertex colours: clumps of iris (thin yellow-green blades), small agaves (a
 * rosette of broad blue-green leaves) and round shrubs, set at (x, z, y) on the island's ground
 */
function plants(spots: { x: number; z: number; y: number; kind: number }[], rnd: () => number) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const blade = (x: number, y: number, z: number, a: number, w: number, h: number, lean: number, base: THREE.Color, tip: THREE.Color) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    // across the blade (perpendicular to where it leans), and its tip leaning out along a
    const px = -sa * w / 2, pz = ca * w / 2;
    const tx = x + ca * lean, tz = z + sa * lean;
    pos.push(x - px, y, z - pz, x + px, y, z + pz, tx, y + h, tz);
    for (let i = 0; i < 3; i++) nor.push(ca * 0.3, 0.95, sa * 0.3);
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  };
  const irisBase = new THREE.Color(0x4f7a24), irisTip = new THREE.Color(0xc4d65a);
  const agaveBase = new THREE.Color(0x4d6b55), agaveTip = new THREE.Color(0x8fa98c);
  const spiderBase = new THREE.Color(0x5f8a3a), spiderTip = new THREE.Color(0xdfe8b8);
  const geos: THREE.BufferGeometry[] = [];
  for (const s of spots) {
    if (s.kind === 0) {
      for (let i = 0; i < 16; i++) blade(s.x + (rnd() - 0.5) * 0.3, s.y, s.z + (rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, 0.05, 0.45 + rnd() * 0.4, 0.15 + rnd() * 0.2, irisBase, irisTip);
    } else if (s.kind === 3) {
      // a spider plant: arching striped leaves, pale with green
      for (let i = 0; i < 18; i++) blade(s.x, s.y, s.z, rnd() * Math.PI * 2, 0.035, 0.18 + rnd() * 0.12, 0.35 + rnd() * 0.15, spiderBase, spiderTip);
    } else if (s.kind === 1) {
      for (let i = 0; i < 11; i++) blade(s.x, s.y, s.z, (i / 11) * Math.PI * 2 + rnd() * 0.3, 0.13, 0.35 + rnd() * 0.25, 0.35, agaveBase, agaveTip);
    } else {
      const r = 0.35 + rnd() * 0.3;
      const g = new THREE.IcosahedronGeometry(r, 1).scale(1, 0.75, 1).translate(s.x, s.y + r * 0.6, s.z).toNonIndexed();
      g.deleteAttribute('uv');
      const c = new THREE.Color(0x35552a).multiplyScalar(0.85 + rnd() * 0.3);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array<number>(g.attributes.position.count * 3).fill(0).map((_, i) => (i % 3 === 0 ? c.r : i % 3 === 1 ? c.g : c.b)), 3));
      geos.push(g);
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return mergeGeometries([leaves, ...geos]);
}

// The DIF's swirl and name on the totem's face (a canvas: no image files)
function difFace() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 768;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#f4f1ec';
    g.fillRect(0, 0, 256, 768);
    // the swirl: rings of the logo's colours spiralling in
    const cols = ['#e5007e', '#f39200', '#ffd400', '#3aaa35', '#009fe3', '#7b2a84'];
    cols.forEach((c, i) => {
      g.strokeStyle = c;
      g.lineWidth = 13;
      g.beginPath();
      g.arc(128, 300, 80 - i * 13, i * 0.9, i * 0.9 + Math.PI * 1.5);
      g.stroke();
    });
    g.fillStyle = '#7b2a84';
    g.font = 'bold 92px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('DIF', 128, 500);
    // the pink band down its edge
    g.fillStyle = '#e8a3c4';
    g.fillRect(210, 0, 46, 768);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildHermanaAgua(scene: THREE.Object3D): { colliders: Collider[] } {
  const colliders: Collider[] = [];
  const island = ISLAND;
  if (!island) return { colliders };
  const cx = island.cx, cz = island.cz;
  const inner = offsetPolygonInward(island.poly, 0.25) ?? island.poly;
  const edge = (a: number) => Math.min(reach(inner, cx, cz, a), 16);
  const y0 = liftAt(cx, cz);
  const root = new THREE.Group();
  root.name = 'Hermana Agua';
  root.position.set(cx, y0, cz);

  // the statue faces away from the park's corner across the street, where the DIF's totem stands: towards the
  // photographs' camera, which had the totem behind her
  const park = BLOCKS.find((b) => b.parkName === 'Parque La Loma');
  let corner: PointXZ | null = null;
  if (park) {
    for (const p of park.poly) if (!corner || Math.hypot(p.x - cx, p.z - cz) < Math.hypot(corner.x - cx, corner.z - cz)) corner = p;
  }
  const yaw = corner ? Math.atan2(cx - corner.x, cz - corner.z) : 0;

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // the island's ground: lawn from the fountain out to the curb, a band of grey cobbles just inside it, four half-moons
  // of pale pavers between the beds
  const lawn = createParkLawnMaterial(false);
  const paving = createParkPavingMaterial();
  const BAND = 0.6;
  add(groundRing(cx, cz, y0, LAWN_Y, () => OUTER_R - 0.1, (a) => edge(a) - BAND + 0.05), lawn, false);
  const pavers = [groundRing(cx, cz, y0, LAWN_Y, (a) => edge(a) - BAND, edge, 0, Math.PI * 2, 1)];
  for (let q = 0; q < 4; q++) {
    const mid = yaw + Math.PI / 4 + (q * Math.PI) / 2, half = 0.36;
    // a half-moon: its outer edge bowed in towards the ends
    pavers.push(groundRing(cx, cz, y0, LAWN_Y + 0.012, () => OUTER_R, (a) => {
      const t = (a - mid) / half;
      return OUTER_R + (edge(a) - BAND - 1.2 - OUTER_R) * Math.sqrt(Math.max(0, 1 - t * t));
    }, mid - half, mid + half, 1));
  }
  add(mergeGeometries(pavers), paving, false);

  // the beds: iris and spider plants along the fountain's foot, agaves and shrubs among them, out to the grass
  const rnd = seeded(1313667127);
  const spots: { x: number; z: number; y: number; kind: number }[] = [];
  for (let q = 0; q < 4; q++) {
    const mid = yaw + (q * Math.PI) / 2;
    for (let i = 0; i < 30; i++) {
      const a = mid + (rnd() - 0.5) * 0.95;
      const r = OUTER_R + 0.4 + rnd() * Math.max(0.5, edge(a) - BAND - OUTER_R - 1.4);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const k = rnd();
      spots.push({ x, z, y: liftAt(cx + x, cz + z) - y0 + LAWN_Y, kind: k < 0.4 ? 0 : k < 0.7 ? 3 : k < 0.85 ? 1 : 2 });
    }
  }
  const leafMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  add(plants(spots, rnd), leafMat);

  // the fountain. The outer wall: courses of pale grey concrete blocks 0.24 m high and 0.48 m long (laid round the
  // ring: the joints by the angle about its middle), each block its own shade
  const low = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => liftAt(cx + Math.cos(i * Math.PI / 4) * OUTER_R, cz + Math.sin(i * Math.PI / 4) * OUTER_R))) - y0;
  const wallMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  {
    const along = atan(positionWorld.z.sub(cz), positionWorld.x.sub(cx)).mul(OUTER_R).div(0.48);
    const course = positionWorld.y.div(0.24);
    const brick = along.add(floor(course).mul(0.5));
    const joint = step(0.93, fract(course)).max(step(0.96, fract(brick)));
    const shade = hash2D(vec2(floor(brick), floor(course))).mul(0.12);
    wallMat.colorNode = mix(color(0xa8a59c).mul(float(0.94).add(shade)), color(0x76736c), joint.mul(0.7));
  }
  const copeMat = new THREE.MeshStandardNodeMaterial({ color: 0xbdb9b0, roughness: 0.8, side: THREE.DoubleSide });
  // the inner tier, rust-brown, the water sheeting down it in streaks
  const tierMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, side: THREE.DoubleSide });
  {
    const a = atan(positionWorld.z.sub(cz), positionWorld.x.sub(cx));
    const streak = smoothstep(0.2, 1.0, sin(a.mul(57.0)).mul(sin(a.mul(23.0).add(1.3))));
    tierMat.colorNode = mix(color(0x6a4630), color(0x9a7a5e), streak.mul(0.6));
  }
  const greyMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e8b84, roughness: 0.85, side: THREE.DoubleSide });
  const waterMat = new THREE.MeshStandardNodeMaterial({ color: 0x2e4a44, roughness: 0.3, metalness: 0.05 });
  const top = LAWN_Y + OUTER_H, pool = top - POOL;
  add(ringWall(OUTER_R, WALL, low - 0.3, top), wallMat);
  add(ringWall(OUTER_R + 0.05, WALL + 0.1, top, top + 0.07), copeMat);
  add(new THREE.CircleGeometry(OUTER_R - WALL, 72).rotateX(-Math.PI / 2).translate(0, pool, 0).toNonIndexed(), waterMat, false);
  add(ringWall(INNER_R, 0.3, low - 0.3, LAWN_Y + INNER_H), tierMat);
  add(ringWall(INNER_R + 0.03, 0.36, LAWN_Y + INNER_H, LAWN_Y + INNER_H + 0.05), tierMat);
  add(new THREE.CircleGeometry(INNER_R - 0.3, 56).rotateX(-Math.PI / 2).translate(0, LAWN_Y + INNER_H - 0.06, 0).toNonIndexed(), waterMat, false);
  // the jets: six rising round the inner tier, twelve arching in from the outer rim, in white water
  const jetMat = new THREE.MeshStandardNodeMaterial({ color: 0xeef6f8, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
  const jets: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = yaw + (i / 6) * Math.PI * 2 + 0.26, r = (OUTER_R + INNER_R) / 2;
    jets.push(new THREE.CylinderGeometry(0.02, 0.06, 1.5, 6, 1, true).translate(Math.cos(a) * r, pool + 0.75, Math.sin(a) * r).toNonIndexed());
  }
  for (let i = 0; i < 12; i++) {
    const a = yaw + (i / 12) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const from = new THREE.Vector3(ca * (OUTER_R - 0.2), top + 0.05, sa * (OUTER_R - 0.2));
    const to = new THREE.Vector3(ca * (INNER_R + 0.6), pool, sa * (INNER_R + 0.6));
    const mid = from.clone().lerp(to, 0.45).setY(top + 1.6);
    jets.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 14, 0.022, 4).toNonIndexed());
  }
  add(mergeGeometries(jets.map((g) => {
    g.deleteAttribute('uv');
    return g;
  })), jetMat, false);
  // the round pedestal in the inner pool, and the statue on it (drawn until her model has loaded)
  const foot = LAWN_Y + INNER_H - 0.06 + PEDESTAL_H;
  add(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R + 0.08, PEDESTAL_H + 0.1, 32).translate(0, foot - (PEDESTAL_H + 0.1) / 2, 0).toNonIndexed(), greyMat);
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0x66665f, roughness: 0.75, metalness: 0.1 });
  const drawn = add(figure(STATUE_H * 0.92, false).rotateY(yaw).translate(0, foot, 0), stone);
  const loading = import('three/addons/loaders/GLTFLoader.js');
  void loading.then(({ GLTFLoader }) => {
    new GLTFLoader().load(STATUE_FILE, (gltf) => {
      const model = gltf.scene;
      model.position.y = foot;
      model.rotation.y = yaw;
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = stone;
          o.castShadow = o.receiveShadow = true;
        }
      });
      root.add(model);
      // (the landmarks' world matrices are frozen once the city is built, scene-culling.ts: work this one out now)
      model.updateMatrixWorld(true);
      drawn.visible = false;
    }, undefined, (err) => {
      console.warn(`[landmarks] the Hermana Agua's model: could not load ${STATUE_FILE}`, err);
    });
  });
  scene.add(root);

  // the DIF's totem on the park's corner, 3 m in from it, its face to the glorieta
  if (corner) {
    const d = Math.hypot(cx - corner.x, cz - corner.z) || 1;
    const tx = corner.x + ((corner.x - cx) / d) * 3, tz = corner.z + ((corner.z - cz) / d) * 3;
    const totem = new THREE.Group();
    totem.name = 'DIF';
    totem.position.set(tx, liftAt(tx, tz), tz);
    totem.rotation.y = Math.atan2(cx - tx, cz - tz);
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf1eee8, roughness: 0.6 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4.2, 0.4).translate(0, 2.1 + 0.2, 0), white);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.9).translate(0, 2.25 + 0.2, 0.201), new THREE.MeshStandardNodeMaterial({ map: difFace(), roughness: 0.55 }));
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.9).translate(0, 0.0, 0), white);
    for (const m of [slab, face, base]) {
      m.castShadow = m.receiveShadow = true;
      totem.add(m);
    }
    scene.add(totem);
    colliders.push({ minX: tx - 0.8, maxX: tx + 0.8, minZ: tz - 0.8, maxZ: tz + 0.8, minY: totem.position.y, maxY: totem.position.y + 4.6 });
  }

  // the fountain's wall keeps the player out (its square inside the round wall), and the statue's plinth
  const h = OUTER_R * 0.8;
  colliders.push({ minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h, minY: y0 + low, maxY: y0 + top + 0.1 });
  colliders.push({ minX: cx - 1, maxX: cx + 1, minZ: cz - 1, maxZ: cz + 1, minY: y0 + low, maxY: y0 + foot + STATUE_H });
  console.info('[landmarks] the Hermana Agua\'s glorieta');
  return { colliders };
}

export { buildHermanaAgua, GLORIETA_CLEAR };
