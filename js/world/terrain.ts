import * as THREE from 'three/webgpu';
import { float, color, mix, smoothstep, positionWorld, normalWorld, vec2, sin, fract, dot, floor, attribute, texture, uniform } from 'three/tsl';
import { GEO } from './city-geodata.js';
import { cityUniforms, createRiverWaterMaterial, createLakeWaterMaterial } from '../render/tsl-materials.ts';
import { triangulate, fillRing } from './lakes.ts';
import { farGroundColor } from './far-ground.ts';
import { ISLAND_BOUNDS } from './city-config.ts';
import { SINK, SLOPES, hillHeights, terrainHeight, hillGround, townHeight, lakes, hillPaths } from './ground.ts';
import { PATH_STEP } from './hill-paths.ts';
import type { Node } from 'three/webgpu';
import type { FarGround } from './far-ground.ts';
import type { PathSection } from './hill-paths.ts';
import type { TileMask } from './streaming.ts';

// js/world/terrain.ts
// The hills around the valley (city-geodata.js `terrain`, from open elevation data, see tools/build-tepic-geodata.mjs):
// a heightfield over the flat city, zero under its streets and houses and rising beyond them (Cerro de San Juan to the
// west, Cerro de la Cruz to the north with its cross, the lomas). Its heights & terrainHeight(x, z) live in ground.ts,
// with the rest of the ground; they are re-exported here for the modules that import them from the hills.

type Vec3 = [x: number, y: number, z: number];

const T = GEO.terrain;
// the detailed city, under the road deck (city-grid.ts)
const inBox = (x: number, z: number) => x >= ISLAND_BOUNDS.minX && x <= ISLAND_BOUNDS.maxX && z >= ISLAND_BOUNDS.minZ && z <= ISLAND_BOUNDS.maxZ;
// The height the hills' mesh is drawn at over (x, z) for a hill h m over the floor: on the town's floor, sunk under the
// road deck, and beyond it on the ground everyone stands on (ground.ts hillGround)
const meshHeight = (x: number, z: number, h: number) => (!SLOPES || inBox(x, z) || h > SINK ? h - SINK : 0) + townHeight(x, z);
const heights = hillHeights; // the hills' grid, decoded once by ground.ts

// value noise for the hillside colouring
const hash = (p: Node<'vec2'>) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const vnoise = (p: Node<'vec2'>) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
};

/**
 * `mask` (streaming.ts createTileMask): the streamed tiles' state. With it, the hills' flat cells inside the detailed
 * box (left out for the road deck that covers them) are drawn as a floor under the deck wherever its tile isn't
 * loaded, so the city beyond the streamed tiles stands on ground, not over a hole: painted with `far` (far-ground.ts
 * paintFarGround), the streets, lots and parks it stands in for.
 */
function buildTerrain(scene: THREE.Object3D, { mask = null, far = null }: { mask?: TileMask | null; far?: FarGround | null } = {}): { group: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'Hills';
  if (!heights || !T) {
    scene.add(group);
    return { group };
  }
  // The mesh: the hills' 75 m grid, and on the town's slopes the town's finer grid over its own area instead (its
  // floor bends between the hills' nodes: the mesh must too, on the very triangles the ground is reckoned on). Only
  // the cells that rise at all; on the town's slopes the mesh is the ground all over the grids (the valley floor rings
  // them), but for the detailed city's box where the road deck (city-grid.ts) covers the flat parts. The flat cells,
  // which cast no shadow, go apart: a mesh over the whole grid is never out of a cascade's view
  const G = SLOPES && GEO.ground ? GEO.ground : null;
  const gx1 = G ? G.x0 + (G.w - 1) * G.cell : 0, gz1 = G ? G.z0 + (G.h - 1) * G.cell : 0;
  const position: number[] = [], hill: number[] = [], rising: number[] = [], flat: number[] = [], under: number[] = [];
  const addGrid = (x0: number, z0: number, cell: number, w: number, h: number,
    hillAt: (i: number, j: number, x: number, z: number) => number,
    skip?: ((cx0: number, cz0: number, cx1: number, cz1: number) => boolean) | null) => {
    const base = position.length / 3;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + i * cell, z = z0 + j * cell, hh = hillAt(i, j, x, z);
        position.push(x, meshHeight(x, z, hh), z);
        hill.push(hh);
      }
    }
    for (let j = 0; j + 1 < h; j++) {
      for (let i = 0; i + 1 < w; i++) {
        const cx0 = x0 + i * cell, cz0 = z0 + j * cell, cx1 = cx0 + cell, cz1 = cz0 + cell;
        if (skip?.(cx0, cz0, cx1, cz1)) continue;
        const k = base + j * w + i;
        const rises = Math.max(hill[k], hill[k + 1], hill[k + w], hill[k + w + 1]) >= 0.15;
        if (!rises && (!SLOPES || (inBox(cx0, cz0) && inBox(cx1, cz1)))) {
          if (SLOPES && mask) under.push(k, k + w, k + 1, k + 1, k + w, k + w + 1);
          continue;
        }
        (rises ? rising : flat).push(k, k + w, k + 1, k + 1, k + w, k + w + 1);
      }
    }
  };
  const { w, h, cell, x0, z0 } = T;
  addGrid(x0, z0, cell, w, h, (i, j) => heights[j * w + i],
    G ? (cx0, cz0, cx1, cz1) => cx0 >= G.x0 && cx1 <= gx1 && cz0 >= G.z0 && cz1 <= gz1 : null);
  if (G) addGrid(G.x0, G.z0, G.cell, G.w, G.h, (_i, _j, x, z) => terrainHeight(x, z));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  if (SLOPES) geo.setAttribute('hill', new THREE.Float32BufferAttribute(hill, 1)); // the height over the floor, for the colours
  // (the normals from every cell drawn, before the flat ones and the floor under the deck go into meshes of their own:
  // a vertex only the floor under the deck used kept a zero normal, NaN once normalized, and that floor drew black
  // beyond the streamed tiles)
  geo.setIndex(new THREE.Uint32BufferAttribute([...rising, ...flat, ...under], 1));
  geo.computeVertexNormals();
  geo.setIndex(new THREE.Uint32BufferAttribute(rising, 1));
  geo.computeBoundingSphere();

  // The hills in the dry season: ochre & red-brown grass, green scrub & trees in patches (thicker in the gullies and up
  // on Cerro de San Juan), bare reddish earth & rock where it's steepest
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0.0 });
  const slope = normalWorld.y;
  const y = SLOPES ? attribute('hill', 'float') : positionWorld.y; // height over the valley floor
  const p = positionWorld.xz;
  const patch = vnoise(p.mul(0.004)).mul(0.55).add(vnoise(p.mul(0.035)).mul(0.45));
  const trees = vnoise(p.mul(0.09)).mul(0.5).add(vnoise(p.mul(0.4)).mul(0.5)); // clumps of trees, a few m across
  const dry = mix(color(0x9a6a3e), color(0x7f4f33), vnoise(p.mul(0.012)));
  const straw = color(0xa8834f);
  const scrub = mix(color(0x4a6128), color(0x34491f), vnoise(p.mul(0.05)));
  const forest = color(0x2e4520);
  const earth = color(0x8a5238);
  const rock = color(0x7a6c5e);
  let c = mix(dry, straw, smoothstep(0.55, 0.85, vnoise(p.mul(0.02))).mul(0.5));
  c = mix(c, scrub, smoothstep(0.42, 0.62, trees).mul(smoothstep(0.2, 0.55, patch)).mul(0.9));
  c = mix(c, forest, smoothstep(0.62, 0.8, patch).mul(smoothstep(150.0, 400.0, y)).mul(0.9));
  c = mix(c, earth, smoothstep(0.7, 0.55, slope).mul(0.6));
  c = mix(c, rock, smoothstep(0.5, 0.38, slope));
  // (on the town's slopes the mesh also covers the valley floor around the town: its colour where no hill rises)
  if (SLOPES) c = mix(color(0x56653c), c, smoothstep(0.2, 2.0, y));
  const hillColor = c.mul(vnoise(p.mul(0.25)).mul(0.14).add(0.93));
  mat.colorNode = hillColor;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
  if (flat.length) {
    const flatGeo = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) flatGeo.setAttribute(name, geo.attributes[name]);
    flatGeo.setIndex(new THREE.Uint32BufferAttribute(flat, 1));
    flatGeo.computeBoundingSphere();
    const floorMesh = new THREE.Mesh(flatGeo, mat);
    floorMesh.receiveShadow = true;
    group.add(floorMesh);
  }

  if (under.length && mask) {
    // the floor under the deck: the hills' colours (the valley floor's, there), cut where the tile mask says the tile's
    // layers are drawn. (It covers the river channels too: opening it over them as the deck is opened took seconds
    // at start-up, and beyond the streamed tiles they are too far off to see into.)
    const underGeo = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) underGeo.setAttribute(name, geo.attributes[name]);
    underGeo.setIndex(new THREE.Uint32BufferAttribute(under, 1));
    underGeo.computeBoundingSphere();
    const underMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0.0 });
    underMat.colorNode = far ? farGroundColor(far, hillColor).mul(vnoise(p.mul(0.25)).mul(0.1).add(0.95)) : hillColor;
    const uv = positionWorld.xz.sub(uniform(mask.origin)).div(uniform(mask.span));
    underMat.opacityNode = float(1).sub(texture(mask.texture, uv).r);
    underMat.alphaTest = 0.5;
    const underMesh = new THREE.Mesh(underGeo, underMat);
    underMesh.name = 'UnderFloor';
    underMesh.receiveShadow = true;
    group.add(underMesh);
  }

  buildHillPaths(group);
  buildFarRivers(group);
  buildHillsideLakes(group);

  // the cross on the summit of Cerro de la Cruz (lit at night)
  if (T.cross) {
    const [cx, cz] = T.cross;
    let top = 0, tx = cx, tz = cz;
    for (let a = -60; a <= 60; a += 10) for (let b = -60; b <= 60; b += 10) {
      const hh = terrainHeight(cx + a, cz + b);
      if (hh > top) { top = hh; tx = cx + a; tz = cz + b; }
    }
    // The lookout on the summit: a round stone-walled terrace with a red floor, the big white cross with the Christ
    // before it, a small white cross on either side (lit at night)
    const crossMat = new THREE.MeshStandardNodeMaterial({ color: 0xf4f1ea, roughness: 0.6 });
    crossMat.emissiveNode = color(0xfff3dc).mul(smoothstep(0.35, 1.2, cityUniforms.uInteriorGlow)).mul(1.4);
    const wallMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a948a, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardNodeMaterial({ color: 0xb4553f, roughness: 0.8 });
    const summit = new THREE.Group();
    const R = 9;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 1.2, 14, 40), wallMat);
    wall.position.y = -6.5; // from well down the slope up to the floor
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.35, R - 0.35, 0.1, 40), floorMat);
    floor.position.y = 0.55;
    const parapet = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.9, 40, 1, true), wallMat);
    parapet.position.y = 1.0;
    const crossAt = (x: number, z: number, height: number, arm: number, thick: number) => {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(thick, height, thick), crossMat);
      post.position.y = height / 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(arm, thick, thick), crossMat);
      bar.position.y = height * 0.72;
      post.castShadow = bar.castShadow = true;
      g.add(post, bar);
      g.position.set(x, 0.6, z);
      return g;
    };
    const big = crossAt(0, -1.5, 16, 7.5, 1.0);
    // the Christ before the cross, arms open
    const christ = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 4.2, 12), crossMat);
    body.position.y = 2.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), crossMat);
    head.position.y = 4.6;
    const arms = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 0.4), crossMat);
    arms.position.y = 3.7;
    christ.add(body, head, arms);
    christ.position.set(0, 0.6 + 2.8, -0.6); // on a pedestal of the cross's base
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.6), crossMat);
    pedestal.position.set(0, 0.6 + 1.4, -0.9);
    summit.add(wall, floor, parapet, big, christ, pedestal, crossAt(-5.5, 1.5, 3.4, 1.8, 0.3), crossAt(5.5, 1.5, 3.4, 1.8, 0.3));
    for (const m of [wall, parapet, christ, pedestal]) m.castShadow = true;
    summit.position.set(tx, top + townHeight(tx, tz), tz);
    summit.rotation.y = Math.atan2(-tx, -tz); // local +z towards the city: the Christ stands on that side of the cross
    group.add(summit);
  }
  scene.add(group);
  return { group };
}

// The ways up the hills (city-geodata.js terrain.paths): ribbons laid on the hillside (each edge on the ground under
// it), cobbled, paved or earth; the cobbled calzadas with a dry-stone wall on their downhill side and a lamp every 30 m
function buildHillPaths(group: THREE.Group) {
  if (!T || !hillPaths) return;
  const PATH_LIFT = 0.04;
  const ribbons: [number[], number[], number[]] = [[], [], []]; // positions per surface
  const walls: [a: Vec3, b: Vec3, footA: number, footB: number][] = []; // along the path's edge, down to the hillside
  const banks: number[] = []; // the embankment's earth face under an edge without a wall
  const lamps: Vec3[] = [];
  // where the hillside's mesh is at (x, z), under the path's level
  const bare = (x: number, z: number) => meshHeight(x, z, terrainHeight(x, z));
  // Each run between two cross-sections (hill-paths.ts), level across: its corners at its sections' levels
  for (const { surface, half: hw, sections, on } of hillPaths.paths) {
    const out = ribbons[surface];
    let run = 0;
    for (let k = 0; k + 1 < sections.length; k++) {
      run += PATH_STEP;
      if (!on[k]) continue; // in town: the streets are there already
      const a = sections[k], b = sections[k + 1];
      const corner = (s: PathSection, side: number): Vec3 => [s.x - s.dz * side * hw, s.level + PATH_LIFT, s.z + s.dx * side * hw];
      const a0 = corner(a, -1), a1 = corner(a, 1), b0 = corner(b, -1), b1 = corner(b, 1);
      out.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0); // counter-clockwise from above
      // the downhill side: the wall of a road (from the hillside below up to knee height over the path), the bare
      // embankment of the others (and of a road's uphill side, where the hillside dips under its level)
      const below = (side: number) => {
        const x = a.x - a.dz * side * (hw + 3), z = a.z + a.dx * side * (hw + 3);
        return terrainHeight(x, z) + townHeight(x, z);
      };
      const down = below(-1) < below(1) ? -1 : 1;
      const walled = surface === 0 && hw >= 2;
      for (const side of [-1, 1]) {
        const p = side < 0 ? a0 : a1, q = side < 0 ? b0 : b1;
        const fp = bare(p[0], p[2]), fq = bare(q[0], q[2]);
        if (walled && side === down) {
          walls.push([p, q, fp, fq]);
          if (run % 30 < PATH_STEP) lamps.push([p[0] - a.dz * side * -0.5, p[1], p[2] + a.dx * side * -0.5]);
        } else if (Math.max(p[1] - fp, q[1] - fq) > 0.06) {
          // (sunk a little into the hillside, so its foot never shows a gap; outward-facing either side)
          const pf: Vec3 = [p[0], fp - 0.25, p[2]], qf: Vec3 = [q[0], fq - 0.25, q[2]];
          if (side > 0) banks.push(...p, ...pf, ...q, ...q, ...pf, ...qf);
          else banks.push(...p, ...q, ...pf, ...q, ...qf, ...pf);
        }
      }
    }
  }
  const surfaces = [
    // cobbles: rounded river stones in a dark joint
    (() => {
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92 });
      const q = positionWorld.xz.mul(3.2);
      const cell = fract(q.add(vec2(0.0, floor(q.x).mul(0.5))));
      const stone = smoothstep(0.08, 0.2, cell.x).mul(smoothstep(0.92, 0.8, cell.x)).mul(smoothstep(0.08, 0.2, cell.y)).mul(smoothstep(0.92, 0.8, cell.y));
      const tone = vnoise(floor(q).mul(1.7));
      mat.colorNode = mix(color(0x4e4840), mix(color(0x8b8173), color(0xa89c8a), tone), stone);
      return mat;
    })(),
    new THREE.MeshStandardNodeMaterial({ color: 0xb3ada2, roughness: 0.85 }),
    new THREE.MeshStandardNodeMaterial({ color: 0x8a6448, roughness: 0.97 })
  ];
  for (const mat of surfaces) {
    // (drawn over the hillside a few centimetres under them without fighting it)
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -2;
  }
  ribbons.forEach((list, k) => {
    if (!list.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, surfaces[k]);
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  if (walls.length) {
    // a dry-stone wall: its outer face reaching down the slope, 0.8 m over the path
    const pos: number[] = [];
    for (const [a, b, fa, fb] of walls) {
      // (its foot 1.2 m under the hillside below it at least: the path's embankment may stand a few metres over it)
      const top = 0.8, botA = Math.min(-1.2, fa - a[1] - 1.2), botB = Math.min(-1.2, fb - b[1] - 1.2);
      const quad = (p0: Vec3, p1: Vec3, y00: number, y01: number, y10: number, y11: number) => {
        pos.push(p0[0], p0[1] + y00, p0[2], p1[0], p1[1] + y10, p1[2], p0[0], p0[1] + y01, p0[2]);
        pos.push(p0[0], p0[1] + y01, p0[2], p1[0], p1[1] + y10, p1[2], p1[0], p1[1] + y11, p1[2]);
      };
      quad(a, b, botA, top, botB, top);
      quad(b, a, botB, top, botA, top);
      // coping
      pos.push(a[0], a[1] + top, a[2], b[0], b[1] + top, b[2], a[0], a[1] + top + 0.08, a[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, side: THREE.DoubleSide });
    const q = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).mul(vec2(2.2, 3.4));
    const c = fract(q.add(vec2(floor(q.y).mul(0.5), 0.0)));
    const stone = smoothstep(0.05, 0.14, c.x).mul(smoothstep(0.95, 0.86, c.x)).mul(smoothstep(0.06, 0.16, c.y)).mul(smoothstep(0.94, 0.84, c.y));
    mat.colorNode = mix(color(0x4a453d), mix(color(0x857b6c), color(0xa39784), vnoise(floor(q).mul(1.3))), stone);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (banks.length) {
    // the embankments' faces: packed earth, a little darker than the trails
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(banks, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.97, side: THREE.DoubleSide });
    mat.colorNode = mix(color(0x6f4f38), color(0x87603f), vnoise(positionWorld.xz.add(positionWorld.y).mul(0.7)));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (lamps.length) {
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8).translate(0, 2.1, 0);
    const globeGeo = new THREE.SphereGeometry(0.22, 10, 8).translate(0, 4.35, 0);
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1f2124, roughness: 0.5, metalness: 0.5 });
    const globeMat = new THREE.MeshBasicNodeMaterial();
    globeMat.colorNode = mix(color(0xd8d6cc), color(0xffe2a8).mul(1.9), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
    const globes = new THREE.InstancedMesh(globeGeo, globeMat, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y - PATH_LIFT, z);
      poles.setMatrixAt(i, m);
      globes.setMatrixAt(i, m);
    });
    poles.castShadow = true;
    group.add(poles, globes);
  }
}

// The rivers where they run on beyond the detailed box (city-geodata.js farRivers: the Mololoa down the valley, the Río
// Puente de Enmedio, the Arroyo Grande): water laid on the hills' mesh, FAR_RIVER_HALF m either side of the course,
// seen from the edge of town and from the air (no channel is cut out there: nobody walks those banks)
const FAR_RIVER_HALF = 6;
function buildFarRivers(group: THREE.Group) {
  if (!T) return;
  const { box } = GEO.frame;
  const tx1 = T.x0 + (T.w - 1) * T.cell, tz1 = T.z0 + (T.h - 1) * T.cell;
  const out = (x: number, z: number) => x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1;
  const onGrid = (x: number, z: number) => x > T.x0 && x < tx1 && z > T.z0 && z < tz1;
  const STEP = 4;
  const LIFT = 0.12;
  const position: number[] = [], uvs: number[] = [];
  for (const [, flat] of GEO.farRivers) {
    // samples every STEP m with the direction there, and the metres along
    const samples: [x: number, z: number, dx: number, dz: number, s: number][] = [];
    let along = 0;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const n = Math.max(1, Math.ceil(L / STEP));
      for (let k = 0; k < n; k++) samples.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, (bx - ax) / L, (bz - az) / L, along + (L * k) / n]);
      along += L;
    }
    for (let k = 0; k + 1 < samples.length; k++) {
      const a = samples[k], b = samples[k + 1];
      // (beyond the box only: inside it the river runs in its channel, waterways.ts)
      if (!(out(a[0], a[1]) && out(b[0], b[1])) || !onGrid(a[0], a[1]) || !onGrid(b[0], b[1])) continue;
      const corner = (p: typeof a, side: number): number[] => {
        const x = p[0] - p[3] * side * FAR_RIVER_HALF, z = p[1] + p[2] * side * FAR_RIVER_HALF;
        return [x, meshHeight(x, z, terrainHeight(x, z)) + LIFT, z];
      };
      const a0 = corner(a, -1), a1 = corner(a, 1), b0 = corner(b, -1), b1 = corner(b, 1);
      position.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0); // counter-clockwise from above
      uvs.push(a[4], -1, a[4], 1, b[4], -1, a[4], 1, b[4], 1, b[4], -1); // (metres along the flow, across it)
    }
  }
  if (!position.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mat = createRiverWaterMaterial();
  // (over the hillside it lies on without fighting it)
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'FarRivers';
  mesh.receiveShadow = true;
  group.add(mesh);
}

// The lakes laid on the hillside (lakes.ts `hillside`: the bordos & tanks up the cerros, the presas beyond the box: El
// Fresno, Presa Nueva): their water on the hills' mesh, cut in HILL_LAKE_STEP m cells to follow it, seen from the
// edge of town and from the air (no basin is sunk out there)
const HILL_LAKE_STEP = 8;
function buildHillsideLakes(group: THREE.Group) {
  if (!T || !lakes?.hillside.length) return;
  const tx1 = T.x0 + (T.w - 1) * T.cell, tz1 = T.z0 + (T.h - 1) * T.cell;
  const onGrid = (x: number, z: number) => x > T.x0 && x < tx1 && z > T.z0 && z < tz1;
  const LIFT = 0.15;
  const position: number[] = [], uvs: number[] = [];
  for (const [, , , ring] of lakes.hillside) {
    const tris = fillRing(triangulate(ring), HILL_LAKE_STEP);
    for (let k = 0; k + 5 < tris.length; k += 6) {
      if (!onGrid(tris[k], tris[k + 1]) || !onGrid(tris[k + 2], tris[k + 3]) || !onGrid(tris[k + 4], tris[k + 5])) continue;
      for (let c = 0; c < 6; c += 2) {
        const x = tris[k + c], z = tris[k + c + 1];
        position.push(x, meshHeight(x, z, terrainHeight(x, z)) + LIFT, z);
        uvs.push(x, z);
      }
    }
  }
  if (!position.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = createLakeWaterMaterial();
  // (over the hillside it lies on without fighting it)
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'HillsideLakes';
  mesh.receiveShadow = true;
  group.add(mesh);
}

export { buildTerrain, terrainHeight, hillGround };
