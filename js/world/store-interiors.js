import * as THREE from 'three/webgpu';
import { color, float, vec2, vec3, mix, step, smoothstep, fract, floor, abs, max, positionGeometry, positionWorld, normalGeometry, sin, dot } from 'three/tsl';
import { cityUniforms } from '../render/tsl-materials.js';
import { drapeGeometry } from './drape.js';
import { townHeight } from './ground.js';

// js/world/store-interiors.js
// The big chain stores you can walk into (the halls buildings.js draws for Gualmart, Bodega Ahorrera, Sorianda, Casa
// Rey, Chedrauy, Samy's...): a door in the middle of the glazed front; inside, a lobby, a row of checkouts, aisles of
// gondola shelving run from the lobby to the back, and the fridges along the back wall, under a white ceiling of light
// panels. The walls, shelves & counters collide from the start (STORE colliders replace the hall's one box); what you
// see inside is built when you come near a store and let go when you leave. The tills can be robbed (main.js).
//
// Layout in each store's own frame: `a` metres along the front from its middle, `b` metres in from the front wall.

const WALL = 0.5; // m, the walls' thickness
const DOOR = 7; // m, the entrance's width
const LOBBY = 10; // m from the front wall to the checkouts
const COUNTER = [0.9, 3.6, 0.95]; // a checkout counter: wide (along the front), deep, high
const LANE = 3.4; // m from one checkout to the next
const GONDOLA = [1.2, 1.9]; // a shelf unit's width & height (its length runs from front to back)
const AISLE = 2.6; // m between two gondolas
const RUN = 14; // m: a gondola run, then a cross aisle
const CROSS = 3.2; // m, a cross aisle
const BUILD_NEAR = 160; // m: inside is built nearer than this and let go farther than LET_GO
const LET_GO = 260;

// Is this hall a store you can walk into? A big chain's (storefronts/*.js `big`) on a hall big enough to be one (some
// small boxes carry a chain's sign by a loose match of a place's name)
function isEnterableStore(chain, w, d) {
  return !!(chain && chain.big && Math.min(w, d) >= 30 && w * d >= 2000);
}

// The store's own frame: F the front's outward normal in the hall's local (u, v), R along the front; half its front's
// length and half its depth
function storeFrame(s) {
  const F = [s.front === 0 ? -1 : s.front === 1 ? 1 : 0, s.front === 2 ? -1 : s.front === 3 ? 1 : 0];
  const R = [-F[1], F[0]];
  const hx = s.w / 2, hz = s.d / 2;
  const halfFront = Math.abs(R[0]) * hx + Math.abs(R[1]) * hz;
  const halfDepth = Math.abs(F[0]) * hx + Math.abs(F[1]) * hz;
  const cs = Math.cos(s.th), sn = Math.sin(s.th);
  return { F, R, halfFront, halfDepth, cs, sn };
}

// (a, b) in the store's frame → world (x, z); and a box laid along R by `la`, along F by `lb` → its local half-sizes
function toWorld(s, f, a, b) {
  const u = f.R[0] * a + f.F[0] * (f.halfDepth - b), v = f.R[1] * a + f.F[1] * (f.halfDepth - b);
  return [s.cx + u * f.cs + v * f.sn, s.cz - u * f.sn + v * f.cs];
}
function halfSizes(f, la, lb) {
  return [(Math.abs(f.R[0]) * la + Math.abs(f.F[0]) * lb) / 2, (Math.abs(f.R[1]) * la + Math.abs(f.F[1]) * lb) / 2];
}

/**
 * What stands in a store, in its frame: boxes { kind: 'wall' | 'counter' | 'gondola' | 'fridge', a, b (centre), la
 * (along the front), lb (in depth), h } and the tills { a, b } (the cashier's end of each counter, towards the lobby)
 */
function storeLayout(s) {
  const f = storeFrame(s);
  const W = f.halfFront * 2, D = f.halfDepth * 2;
  const boxes = [], tills = [];
  const wallH = s.top - s.base;
  // the walls, the front's split by the door
  const side = (W - DOOR) / 2;
  boxes.push({ kind: 'wall', a: -(DOOR / 2 + side / 2), b: WALL / 2, la: side, lb: WALL, h: wallH });
  boxes.push({ kind: 'wall', a: DOOR / 2 + side / 2, b: WALL / 2, la: side, lb: WALL, h: wallH });
  boxes.push({ kind: 'wall', a: 0, b: D - WALL / 2, la: W, lb: WALL, h: wallH });
  boxes.push({ kind: 'wall', a: -W / 2 + WALL / 2, b: D / 2, la: WALL, lb: D, h: wallH });
  boxes.push({ kind: 'wall', a: W / 2 - WALL / 2, b: D / 2, la: WALL, lb: D, h: wallH });
  // the checkouts, centred on the door, as many as the front holds (at most 12)
  const lanes = Math.max(2, Math.min(12, Math.floor((W - 16) / LANE)));
  const bCounter = LOBBY + COUNTER[1] / 2;
  for (let k = 0; k < lanes; k++) {
    const a = (k - (lanes - 1) / 2) * LANE;
    boxes.push({ kind: 'counter', a, b: bCounter, la: COUNTER[0], lb: COUNTER[1], h: COUNTER[2] });
    tills.push({ a: a + COUNTER[0] / 2 + 0.6, b: LOBBY + 0.6 });
  }
  // the fridges along the back wall
  const fridgeB = D - WALL - 0.6;
  boxes.push({ kind: 'fridge', a: 0, b: fridgeB, la: W - 2 * WALL - 4, lb: 1.2, h: 2.2 });
  // the aisles: gondola runs from past the checkouts to short of the fridges, broken by cross aisles
  const b0 = LOBBY + COUNTER[1] + 5, b1 = fridgeB - 0.6 - 4;
  const pitch = GONDOLA[0] + AISLE;
  const n = Math.floor((W - 2 * WALL - 6) / pitch);
  for (let k = 0; k < n; k++) {
    const a = (k - (n - 1) / 2) * pitch;
    for (let b = b0; b + 4 <= b1; b += RUN + CROSS) {
      const len = Math.min(RUN, b1 - b);
      boxes.push({ kind: 'gondola', a, b: b + len / 2, la: GONDOLA[0], lb: len, h: GONDOLA[1] });
    }
  }
  return { boxes, tills, frame: f, W, D };
}

// A store's hall as a lot to keep clear (of the houses overlapping it, of trees): { contains(x, z) }, `margin` m in
function storeReserve(s, margin = 0) {
  const cs = Math.cos(s.th), sn = Math.sin(s.th);
  return {
    contains(x, z) {
      const dx = x - s.cx, dz = z - s.cz;
      return Math.abs(cs * dx - sn * dz) < s.w / 2 + margin && Math.abs(sn * dx + cs * dz) < s.d / 2 + margin;
    }
  };
}

// The colliders of a store's walls, counters, shelves & fridges (oriented with the hall, as buildings.js's)
function storeColliders(s, layout = storeLayout(s)) {
  const f = layout.frame;
  return layout.boxes.map((bx) => {
    const [x, z] = toWorld(s, f, bx.a, bx.b);
    const [hx, hz] = halfSizes(f, bx.la, bx.lb);
    const ex = Math.abs(f.cs) * hx + Math.abs(f.sn) * hz, ez = Math.abs(f.sn) * hx + Math.abs(f.cs) * hz;
    return { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: s.base, maxY: s.base + bx.h + (bx.kind === 'wall' ? 0 : 0.3),
      obb: { cx: x, cz: z, hx, hz, cs: f.cs, sn: f.sn } };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// What you see inside
// ---------------------------------------------------------------------------------------------------------------------

// Products on the shelves: five levels of packs in bright colours, hashed per pack (~25 cm), a metal shelf under
// each; the unit's top & ends plain
// (the shelves, counters & fridges are instanced meshes: their patterns read the unit box's own positionGeometry &
// normalGeometry, positionLocal & normalLocal being already moved by the instance)
function createGondolaMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  const y = positionGeometry.y.add(0.5); // 0..1 up the unit
  const level = floor(y.mul(5.0));
  const inLevel = fract(y.mul(5.0));
  const side = step(0.5, abs(normalGeometry.x)).add(step(0.5, abs(normalGeometry.z))).min(1.0).mul(float(1.0).sub(step(0.5, normalGeometry.y)));
  const pack = floor(positionWorld.xz.mul(4.0));
  const h = fract(sin(dot(vec3(pack.x, pack.y, level), vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const palette = [0xd8232a, 0xf5a623, 0x2b62b8, 0x1f9a3c, 0xf2f2ee, 0x7a3fa0, 0xe86a1a, 0x20a8c8];
  let product = color(palette[0]);
  for (let i = 1; i < palette.length; i++) product = mix(product, color(palette[i]), step(i / palette.length, h));
  const shelf = smoothstep(0.08, 0.04, inLevel); // the metal shelf at each level's foot
  const gap = smoothstep(0.88, 0.95, inLevel); // the dark space over the packs
  const goods = mix(mix(product.mul(float(0.75).add(h.mul(0.35))), color(0x1a1c20), gap), color(0xb8bcc2), shelf);
  const metal = color(0xc9ccd1);
  mat.colorNode = mix(metal, goods, side);
  mat.emissiveNode = mix(metal, goods, side).mul(0.18); // (lit by the ceiling's panels all round)
  return mat;
}

// A checkout: a grey counter, its black belt on top
function createCounterMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
  const top = step(0.5, normalGeometry.y);
  const c = mix(color(0x8f949b), color(0x15171a), top);
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.15);
  return mat;
}

// Fridges: glass doors glowing cold white, frames dark
function createFridgeMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.3 });
  const door = smoothstep(0.04, 0.06, fract(positionWorld.x.add(positionWorld.z).mul(0.8))).mul(step(0.12, positionGeometry.y.add(0.5)));
  const c = mix(color(0x22262b), color(0xdceeff), door);
  mat.colorNode = c;
  mat.emissiveNode = color(0xcfe6ff).mul(door.mul(0.9));
  return mat;
}

// The floor's polished tiles (60 cm), the walls white with the chain's band, the ceiling & its light panels
function createFloorMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.0 });
  const g = abs(fract(positionWorld.xz.div(0.6)).sub(0.5));
  const joint = smoothstep(0.47, 0.49, max(g.x, g.y));
  const c = mix(color(0xe9e6df), color(0xb9b4aa), joint);
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.12);
  return mat;
}
function createWallMaterial(band) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.BackSide });
  const y = positionGeometry.y.add(0.5);
  const c = mix(color(0xf1f0eb), color(band), step(0.3, y).mul(step(y, 0.38)));
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.2);
  return mat;
}
function createPanelMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = color(0xfdfdf8).mul(float(1.0).add(cityUniforms.uInteriorGlow.mul(0.2)));
  return mat;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // facing up
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function buildStores(scene, stores) {
  const layouts = stores.map((s) => storeLayout(s));
  const colliders = stores.flatMap((s, i) => storeColliders(s, layouts[i]));
  // the tills, world positions, for the robberies (main.js): { x, z, store, empty (s since the epoch it refills) }
  const tills = stores.flatMap((s, i) => layouts[i].tills.map((t) => {
    const [x, z] = toWorld(s, layouts[i].frame, t.a, t.b);
    return { x, z, store: s, refill: 0 };
  }));
  const group = new THREE.Group();
  group.name = 'StoreInteriors';
  scene.add(group);
  const mats = { gondola: createGondolaMaterial(), counter: createCounterMaterial(), fridge: createFridgeMaterial(), floor: createFloorMaterial(), panel: createPanelMaterial() };
  const wallMats = new Map();
  const wallMat = (band) => {
    if (!wallMats.has(band)) wallMats.set(band, createWallMaterial(band));
    return wallMats.get(band);
  };
  // one of each, parked far under the ground, so their pipelines compile with the rest at load (no hitch on entering)
  const parked = new THREE.Group();
  parked.position.set(0, -1000, 0);
  for (const m of [mats.gondola, mats.counter, mats.fridge, mats.floor, mats.panel, wallMat('#0071ce')]) parked.add(new THREE.Mesh(unitBox, m));
  group.add(parked);

  // the inside of store i: its floor, walls & ceiling, the boxes, the light panels
  function buildInside(i) {
    const s = stores[i], L = layouts[i], f = L.frame;
    const inside = new THREE.Group();
    const floorY = 0.225; // over the town's floor, as the player stands inside a block (city-config sidewalkHeight)
    const ry = s.th;
    // floor: the hall's footprint, draped on the slope
    const [cx, cz] = toWorld(s, f, 0, L.D / 2);
    const plane = unitPlane.clone().scale(s.w - 2 * WALL, 1, s.d - 2 * WALL).rotateY(ry).translate(cx, floorY, cz);
    const floor = new THREE.Mesh(drapeGeometry(plane), mats.floor);
    floor.receiveShadow = true;
    inside.add(floor);
    const ground = townHeight(cx, cz) + floorY;
    const ceilY = ground + Math.min(s.top - s.base - 1.2, 7.5);
    // walls & ceiling: one box seen from inside (its back faces), the hall's size less the walls
    const shell = new THREE.Mesh(unitBox, wallMat(s.band || '#c0392b'));
    shell.position.set(cx, (ground + ceilY) / 2, cz);
    shell.rotation.y = ry;
    shell.scale.set(s.w - 2 * WALL - 0.05, ceilY - ground, s.d - 2 * WALL - 0.05);
    inside.add(shell);
    // the boxes by kind, each an instanced mesh standing on the ground under its centre
    for (const kind of ['counter', 'gondola', 'fridge']) {
      const list = L.boxes.filter((b) => b.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(unitBox, mats[kind], list.length);
      list.forEach((b, k) => {
        const [x, z] = toWorld(s, f, b.a, b.b);
        const [hx, hz] = halfSizes(f, b.la, b.lb);
        const y = townHeight(x, z) + floorY;
        mesh.setMatrixAt(k, _m.compose(_p.set(x, y + b.h / 2, z), _q.setFromAxisAngle(_up, ry), _s.set(hx * 2, b.h, hz * 2)));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      inside.add(mesh);
    }
    // light panels in rows over the aisles, just under the ceiling
    const panels = [];
    for (let a = -f.halfFront + 6; a <= f.halfFront - 6; a += 6) for (let b = 4; b <= L.D - 4; b += 5) panels.push([a, b]);
    const lights = new THREE.InstancedMesh(unitBox, mats.panel, panels.length);
    panels.forEach(([a, b], k) => {
      const [x, z] = toWorld(s, f, a, b);
      const [hx, hz] = halfSizes(f, 0.6, 2.4);
      lights.setMatrixAt(k, _m.compose(_p.set(x, ceilY - 0.06, z), _q.setFromAxisAngle(_up, ry), _s.set(hx * 2, 0.08, hz * 2)));
    });
    inside.add(lights);
    group.add(inside);
    return inside;
  }

  const built = new Map(); // store index -> its inside
  let lastX = Infinity, lastZ = Infinity;
  return {
    group,
    colliders,
    tills,
    stores,
    reserves: stores.map((s) => storeReserve(s)),
    // Build the inside of the stores near (x, z), let go of those far away (checked every 20 m moved)
    update(x, z) {
      if (Math.hypot(x - lastX, z - lastZ) < 20) return;
      lastX = x;
      lastZ = z;
      stores.forEach((s, i) => {
        const d = Math.hypot(s.cx - x, s.cz - z);
        if (d < BUILD_NEAR && !built.has(i)) built.set(i, buildInside(i));
        else if (d > LET_GO && built.has(i)) {
          const inside = built.get(i);
          group.remove(inside);
          inside.traverse((o) => {
            if (o.isInstancedMesh) o.dispose();
            else if (o.isMesh && o.geometry !== unitBox) o.geometry.dispose();
          });
          built.delete(i);
        }
      });
    }
  };
}

export { buildStores, storeLayout, storeColliders, storeReserve, isEnterableStore, storeFrame, toWorld as storeToWorld };
