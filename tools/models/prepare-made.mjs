// tools/models/prepare-made.mjs
// A car modelled by hand (a free model from Sketchfab: assets/models/CLAUDE.md), made ready for the game the way the
// Meshy cars are (tools/models/prepare.mjs), so the game draws it with the same code: one body mesh, its wheel as a mesh
// of its own ('wheel', the axle on the origin), where the wheels go in the body's extras, and one material whose colour
// texture and metal-roughness texture (R the paint mask, G the roughness, B the metal) say what each part is.
// Such a model comes in parts with a material each (body, glass, tyres, rims, lamps...) and no texture: each part's
// material gets a cell of a small palette texture, and its vertices that cell's middle as their texture coordinate. So
// the paint is exactly the body's faces, the glass one clean tint, the chrome metal: nothing is guessed from a texture.
//   node tools/models/prepare-made.mjs <in.glb> <out.glb> --length 4.32 [--roles roles.json] [--faces 80000] [--error 0.004] [--wheel 0.3] [--cabin] [--lenses] [--plates 0.45,0.7] [--flip] [--report] [--probe x,y,z]
// --length: the car's real length (m). --roles: {"<material name>": "<role>"} for names the defaults below don't know
// (tools/models/jobs/cars/*.roles.json). --faces: simplified to about that many triangles. --wheel: the tyres' radius
// (m), only for a model with no part named as its tyres. --cabin: what is inside the cabin goes. --lenses: the glass
// over the lamps goes (a model whose lamps' lenses are its windows' material). --plates: a plate
// front and back, at those heights (m). --flip: turns it end for end (the nose is found by the head
// lamps' side, which a model with unnamed lamps can't tell). --report: each part's box, to write its roles.
// Roles: paint, steel (bare metal, tinted by the paint), glass, tyre, rim, wheel (any other part of a wheel, its own colour), chrome, trim (black plastic),
// under, light (head lamps' reflectors), drl (a lamp lit day and night: the Cybertruck's light bar), lamp (red tail lamps), amber, white (reversing lamps), own (its material's own
// colour: the default), backing (black, pushed 4 mm in: a second shell under the paint that fills its gaps), lamps (a
// material shared by the head and tail lamps: light in the front half, lamp in the back) and drop
// (not drawn: the interior, behind the now opaque glass, and the lamps' lenses).
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const [inp, out] = args;
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const length = Number(opt('length')), faces = Number(opt('faces') ?? 0), wheelArg = Number(opt('wheel') ?? 0);
if (!inp || !out || !(length > 0)) throw new Error('usage: node tools/models/prepare-made.mjs <in.glb> <out.glb> --length <m> [--roles roles.json]');

// The roles of the material names hand-made car models use (English, French, Spanish), tried as lower-case prefixes
const NAMES = [
  ['paint', ['body', 'carroc', 'paint', 'pintura', 'carpaint']],
  ['glass', ['vitre', 'glass', 'window', 'vidrio', 'cristal']],
  ['tyre', ['pneu', 'tire', 'tyre', 'llanta', 'rubber']],
  ['rim', ['jante', 'rim', 'wheel', 'rin']],
  ['chrome', ['chrome', 'cromo', 'metal']],
  ['lamp', ['feux_rouge', 'taillight', 'tail', 'brake', 'calavera']],
  ['amber', ['phare_orange', 'orange', 'indicator', 'turn', 'amber']],
  ['white', ['feux_blanc', 'reverse']],
  ['light', ['phare', 'headlight', 'faro', 'feux_chrome']],
  ['under', ['dessous', 'under', 'chassis']],
  ['trim', ['plastique', 'partie_noir', 'plastic', 'trim', 'black', 'grille', 'miroir', 'mirror']],
  ['drop', ['interieur', 'interior', 'siege', 'seat', 'dash', 'steering']]
];
const overrides = opt('roles') ? JSON.parse(readFileSync(opt('roles'), 'utf8')) : {};
// (a lamp's or the headlamps' lens over its reflector: dropped, the reflector shows)
const roleOf = (name) => {
  if (overrides[name]) return overrides[name];
  const n = name.toLowerCase();
  if (n.includes('phare_vitre') || n.includes('lens')) return 'drop';
  for (const [role, prefixes] of NAMES) if (prefixes.some((p) => n.startsWith(p))) return role;
  return 'own';
};
// Each role's look: colour (sRGB, 0-255; null: the material's own), roughness, metal, paint mask
const LOOK = {
  paint: { rgb: [232, 232, 232], rough: 0.26, metal: 0, paint: 1 }, // (the game multiplies its colour by this grey)
  steel: { rgb: [232, 232, 232], rough: 0.4, metal: 1, paint: 1 }, // (bare stainless: the paint's colour as a metal's, no clear coat)
  glass: { rgb: [16, 20, 24], rough: 0.04, metal: 0 },
  tyre: { rgb: [26, 26, 27], rough: 0.85, metal: 0 },
  rim: { rgb: [196, 198, 200], rough: 0.28, metal: 0.85 },
  chrome: { rgb: [210, 212, 215], rough: 0.14, metal: 1 },
  light: { rgb: [220, 224, 228], rough: 0.08, metal: 0.9 },
  drl: { rgb: [240, 242, 245], rough: 0.08, metal: 0, glow: true }, // (a daytime light bar: in the emissive texture, lit always)
  lamp: { rgb: [178, 22, 24], rough: 0.12, metal: 0 }, // (red: the game lights it with the brake, at the back)
  amber: { rgb: [230, 120, 20], rough: 0.12, metal: 0 },
  white: { rgb: [235, 235, 235], rough: 0.12, metal: 0 },
  under: { rgb: [30, 30, 31], rough: 0.9, metal: 0 },
  trim: { rgb: [30, 30, 32], rough: 0.45, metal: 0 }, // (black plastic, whatever grey the model gave it)
  own: { rgb: null, rough: 0.5, metal: 0 },
  backing: { rgb: [22, 22, 24], rough: 0.6, metal: 0 },
  lamps: { rgb: null, rough: 0.12, metal: 0 }, // (made light or lamp by end, below)
  plate: { rgb: [232, 234, 230], rough: 0.4, metal: 0 }, // (--plates: Mexico's are white, 30.5 × 15.2 cm)
  wheel: { rgb: null, rough: 0.35, metal: 0 } // (metal where it is bright: the palette below)
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(inp);
// a textured material's colour: its texture's mean, times its factor
const toSRGB = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
const colourOf = new Map();
for (const mat of src.getRoot().listMaterials()) {
  const f = mat.getBaseColorFactor().slice(0, 3).map(toSRGB), tex = mat.getBaseColorTexture();
  if (!tex?.getImage()) { colourOf.set(mat, f); continue; }
  const { channels } = await sharp(Buffer.from(tex.getImage())).stats();
  colourOf.set(mat, f.map((c, k) => Math.round((c * (channels[k] ?? channels[0]).mean) / 255))); // (a grey texture: one channel)
}

// the parts not drawn dropped, then (--faces) the rest simplified, part by part, before anything is measured: the
// normals below are made for the simplified faces (a simplified mesh with its old normals looks faceted)
for (const mesh of src.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) if (roleOf(prim.getMaterial()?.getName() ?? '') === 'drop') prim.dispose();
}
if (faces > 0) {
  const count = () => src.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const now = count();
  if (faces < now) {
    await MeshoptSimplifier.ready;
    await src.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: faces / now, error: Number(opt('error') ?? 0.004) }));
    console.log(`simplified ${now} -> ${count()} triangles`);
  }
}

// every triangle of the model in world space, with its role and its material's colour
const tris = []; // { p: [9], n: [9], role, rgb }
for (const scene of src.getRoot().listScenes()) {
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    const xf = (x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const role = roleOf(name);
      if (role === 'drop') continue;
      const mat = prim.getMaterial();
      const rgb = LOOK[role].rgb ?? (mat ? colourOf.get(mat) : [50, 50, 50]);
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL');
      const I = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: P.getCount() }, (_, i) => i);
      const a = [], b = [];
      for (let k = 0; k < I.length; k++) {
        const v = I[k];
        a.push(...xf(...P.getElement(v, []), 1));
        b.push(...(N ? xf(...N.getElement(v, []), 0) : [0, 1, 0]));
        if (k % 3 === 2) {
          const p = a.splice(0), n = b.splice(0);
          tris.push({ p, n, role, rgb, name, twoSided: mat?.getDoubleSided() ?? false });
        }
      }
    }
  });
}
console.log(`${tris.length} triangles kept`);

// A double-sided material's faces turned to face out, when it is wound any which way: such a model never needed to
// care, and the game draws one side of each face, so its turned faces showed as holes. Out is away from the middle of
// the car, through an ellipsoid as long, wide and high as the car (its gradient), which suits a car's shell; a material
// with a third of its faces turned in is taken for one wound any which way (a well wound shell turns only its hollows
// in: a pickup's bed, its wheel arches), and only then turned
{
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 9; k++) { lo[k % 3] = Math.min(lo[k % 3], t.p[k]); hi[k % 3] = Math.max(hi[k % 3], t.p[k]); }
  const c = lo.map((l, k) => (l + hi[k]) / 2), h = lo.map((l, k) => Math.max(1e-6, (hi[k] - l) / 2));
  const facesIn = (t) => {
    const p = t.p;
    const u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const out = [0, 1, 2].map((k) => ((p[k] + p[k + 3] + p[k + 6]) / 3 - c[k]) / (h[k] * h[k]));
    return f[0] * out[0] + f[1] * out[1] + f[2] * out[2] < 0;
  };
  const tally = new Map(); // material name -> [in, all]
  for (const t of tris) {
    if (!t.twoSided) continue;
    const n = tally.get(t.name) ?? [0, 0];
    n[0] += facesIn(t) ? 1 : 0;
    n[1]++;
    tally.set(t.name, n);
  }
  let turned = 0;
  for (const t of tris) {
    const n = tally.get(t.name);
    if (!t.twoSided || !n || n[0] < n[1] / 3 || !facesIn(t)) continue;
    for (const a of [t.p, t.n]) [a[3], a[4], a[5], a[6], a[7], a[8]] = [a[6], a[7], a[8], a[3], a[4], a[5]];
    turned++;
  }
  if (turned) console.log(`${turned} double-sided faces turned to face out`);
}

// the frame: the long axis to z (the longer of x and z), the nose (the head lamps' side, against the tail lamps') to +z,
// scaled to `length`, centred, the tyres' bottom on y = 0
const box = (list, f = () => true) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of list) if (f(t)) for (let k = 0; k < 9; k++) { lo[k % 3] = Math.min(lo[k % 3], t.p[k]); hi[k % 3] = Math.max(hi[k % 3], t.p[k]); }
  return { lo, hi };
};
let all = box(tris);
const turn = (fn) => { for (const t of tris) for (let k = 0; k < 9; k += 3) { [t.p[k], t.p[k + 1], t.p[k + 2]] = fn(t.p[k], t.p[k + 1], t.p[k + 2]); [t.n[k], t.n[k + 1], t.n[k + 2]] = fn(t.n[k], t.n[k + 1], t.n[k + 2]); } };
if (all.hi[0] - all.lo[0] > all.hi[2] - all.lo[2]) turn((x, y, z) => [-z, y, x]);
const mid = (role) => { const b = box(tris, (t) => t.role === role); return (b.lo[2] + b.hi[2]) / 2; };
const head = tris.some((t) => t.role === 'light') ? mid('light') : NaN, tail = tris.some((t) => t.role === 'lamp') ? mid('lamp') : NaN;
if (head < tail !== args.includes('--flip')) turn((x, y, z) => [-x, y, -z]); // (--flip: a model whose lamps don't say)
all = box(tris);
const s = length / (all.hi[2] - all.lo[2]);
const named = (t) => t.role === 'tyre' || t.role === 'rim' || t.role === 'wheel';
const ground = tris.some(named) ? box(tris, named).lo[1] : all.lo[1];
const cx = (all.lo[0] + all.hi[0]) / 2, cz = (all.lo[2] + all.hi[2]) / 2;
for (const t of tris) for (let k = 0; k < 9; k += 3) { t.p[k] = (t.p[k] - cx) * s; t.p[k + 1] = (t.p[k + 1] - ground) * s; t.p[k + 2] = (t.p[k + 2] - cz) * s; }
all = box(tris);
console.log(`${(all.hi[0] - all.lo[0]).toFixed(2)} m wide, ${(all.hi[1] - all.lo[1]).toFixed(2)} m high, ${(all.hi[2] - all.lo[2]).toFixed(2)} m long`);
// a backing shell 4 mm in, under the faces drawn over it
for (const t of tris) {
  if (t.role !== 'backing') continue;
  const p = t.p, u = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], v = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
  const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...f) || 1;
  for (let k = 0; k < 9; k++) p[k] -= (f[k % 3] / l) * 0.004;
}
// the lamps' shared material by end; --lenses: the glass at the car's ends below its windows is the lamps' lenses
// (opaque, as the glass is drawn, they hid the lamps black), and goes
for (const t of tris) if (t.role === 'lamps') {
  t.role = t.p[2] + t.p[5] + t.p[8] > 0 ? 'light' : 'lamp';
  t.rgb = LOOK[t.role].rgb;
}
if (args.includes('--lenses')) {
  const half = (all.hi[2] - all.lo[2]) / 2, windowsFrom = all.lo[1] + 0.62 * (all.hi[1] - all.lo[1]);
  const before = tris.length;
  for (let j = tris.length - 1; j >= 0; j--) {
    const t = tris[j];
    if (t.role !== 'glass') continue;
    const z = Math.abs(t.p[2] + t.p[5] + t.p[8]) / 3, y = Math.max(t.p[1], t.p[4], t.p[7]);
    if (z > half - 0.5 && y < windowsFrom) tris.splice(j, 1);
  }
  console.log(`lenses: ${before - tris.length} triangles of glass over the lamps dropped`);
}
// --cabin: what lies inside the cabin goes (a model whose materials' names don't say what is interior): within the
// glass's box, 10 cm in from its sides and 15 cm from its ends, from 40 cm under its bottom up to 5 cm under its top;
// never the paint, glass, lamps or wheels
if (args.includes('--cabin')) {
  const g = box(tris, (t) => t.role === 'glass');
  const keepRoles = new Set(['paint', 'steel', 'glass', 'lamp', 'amber', 'white', 'light', 'drl', 'tyre', 'rim', 'wheel']);
  const inside = (t) => {
    for (let k = 0; k < 9; k += 3) {
      const [x, y, z] = [t.p[k], t.p[k + 1], t.p[k + 2]];
      if (x < g.lo[0] + 0.1 || x > g.hi[0] - 0.1 || y < g.lo[1] - 0.4 || y > g.hi[1] - 0.05 || z < g.lo[2] + 0.15 || z > g.hi[2] - 0.15) return false;
    }
    return true;
  };
  const before = tris.length;
  for (let j = tris.length - 1; j >= 0; j--) if (!keepRoles.has(tris[j].role) && inside(tris[j])) tris.splice(j, 1);
  console.log(`cabin: ${before - tris.length} triangles inside dropped`);
}
// (--probe x,y,z: the parts within 15 cm of that point, m, to find what a spot on the car is made of)
if (opt('probe')) {
  const q = opt('probe').split(',').map(Number), hits = new Map();
  for (const t of tris) {
    const c = [0, 1, 2].map((k) => (t.p[k] + t.p[k + 3] + t.p[k + 6]) / 3);
    if (Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]) < 0.15) hits.set(`${t.name} (${t.role}, ${t.rgb})`, (hits.get(`${t.name} (${t.role}, ${t.rgb})`) ?? 0) + 1);
  }
  console.log('probe', JSON.stringify([...hits]));
}
// --plates yFront,yRear: a plate on each bumper, its middle at that height (m), on the car's middle line, 4 mm off the
// surface the line meets first coming from ahead (or behind), facing out; replace the model's own plates (drop them)
if (opt('plates')) {
  const [yf, yr] = opt('plates').split(',').map(Number);
  // (the outermost surface across the plate's width: 5 rays, 3 mm off the middle line, where a symmetric model has a
  // seam a ray slips through; a bumper may also be open in its middle)
  const surfaceZ = (y, front) => {
    let best = front ? -Infinity : Infinity;
    for (const px of [-0.14, -0.07, 0.003, 0.07, 0.14]) for (const t of tris) {
      if (t.role === 'glass' || t.wheel) continue;
      const p = t.p;
      const d = (p[4] - p[7]) * (p[0] - p[6]) + (p[6] - p[3]) * (p[1] - p[7]);
      if (Math.abs(d) < 1e-12) continue;
      const a = ((p[4] - p[7]) * (px - p[6]) + (p[6] - p[3]) * (y - p[7])) / d, b = ((p[7] - p[1]) * (px - p[6]) + (p[0] - p[6]) * (y - p[7])) / d;
      if (a < 0 || b < 0 || a + b > 1) continue;
      const z = a * p[2] + b * p[5] + (1 - a - b) * p[8];
      best = front ? Math.max(best, z) : Math.min(best, z);
    }
    return best;
  };
  const w = 0.305 / 2, h = 0.152 / 2;
  for (const [y, front] of [[yf, true], [yr, false]]) {
    if (!(y > 0)) continue;
    const z0 = surfaceZ(y, front);
    if (!Number.isFinite(z0)) { console.log(`no surface for the ${front ? 'front' : 'rear'} plate at ${y} m`); continue; }
    const z = z0 + (front ? 0.004 : -0.004), s = front ? 1 : -1, n = [0, 0, s, 0, 0, s, 0, 0, s];
    const quad = [[-w, y - h], [w, y - h], [w, y + h], [-w, y + h]].map(([x, yy]) => [x * s, yy, z]);
    // (its corners' places in the plate's picture, u right and v down, as a viewer facing it sees it)
    const uvq = [[0, 1], [1, 1], [1, 0], [0, 0]];
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      tris.push({ p: [...quad[i], ...quad[j], ...quad[k]], n: [...n], role: 'plate', rgb: LOOK.plate.rgb, name: 'plate', wheel: false, plateUV: [...uvq[i], ...uvq[j], ...uvq[k]] });
    }
    console.log(`${front ? 'front' : 'rear'} plate at y ${y}, z ${z.toFixed(3)}`);
  }
}
// (--report: each material's part and box, m, to write a car's --roles)
if (args.includes('--report')) {
  for (const name of new Set(tris.map((t) => t.name))) {
    const list = tris.filter((t) => t.name === name), b = box(list);
    console.log(`  ${name.padEnd(36)} ${list[0].role.padEnd(6)} ${String(list.length).padStart(7)}t  x ${b.lo[0].toFixed(2)}..${b.hi[0].toFixed(2)}  y ${b.lo[1].toFixed(2)}..${b.hi[1].toFixed(2)}  z ${b.lo[2].toFixed(2)}..${b.hi[2].toFixed(2)}`);
  }
}

// smooth normals: at each corner, the mean of the faces of its part meeting there that turn less than 40° from its own
// (models made for an offline render often come with every face flat; the clear coat shows each facet)
{
  const faceN = tris.map((t) => {
    const u = [t.p[3] - t.p[0], t.p[4] - t.p[1], t.p[5] - t.p[2]], v = [t.p[6] - t.p[0], t.p[7] - t.p[1], t.p[8] - t.p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
    return { n: l ? n.map((c) => c / l) : [0, 1, 0], area: l / 2 };
  });
  const at = new Map(); // place|role -> [triangle index]
  const key = (t, k) => `${Math.round(t.p[k] * 1e4)},${Math.round(t.p[k + 1] * 1e4)},${Math.round(t.p[k + 2] * 1e4)}|${t.role}`;
  tris.forEach((t, j) => { for (let k = 0; k < 9; k += 3) { const q = key(t, k); if (!at.has(q)) at.set(q, []); at.get(q).push(j); } });
  const cos40 = Math.cos((40 * Math.PI) / 180);
  tris.forEach((t, j) => {
    const own = faceN[j].n;
    for (let k = 0; k < 9; k += 3) {
      const sum = [0, 0, 0];
      for (const o of at.get(key(t, k))) {
        const { n, area } = faceN[o];
        if (n[0] * own[0] + n[1] * own[1] + n[2] * own[2] < cos40) continue;
        for (let c = 0; c < 3; c++) sum[c] += n[c] * area;
      }
      const l = Math.hypot(...sum);
      if (l) for (let c = 0; c < 3; c++) t.n[k + c] = sum[c] / l;
    }
  });
}

// the wheels, by corner (left or right, front or back). Their axles and size from the parts named as wheels, or else from
// what touches the ground and `--wheel`; then everything else inside a wheel's cylinder (its rim, hub, brake) is wheel
// too, whatever it is called. The front one on +x is the wheel the game draws at the four corners, about its axle.
const corner = (t) => (t.p[0] + t.p[3] + t.p[6] > 0 ? 1 : 0) + (t.p[2] + t.p[5] + t.p[8] > 0 ? 2 : 0);
// (the named parts only out at the car's sides and low: a model's tyre or rim material often holds its spare wheel, an
// axle or a drive shaft across the middle too, and those made the wheel a metre wide)
const halfW = Math.max(-all.lo[0], all.hi[0]);
const outboard = (t) => Math.min(Math.abs(t.p[0]), Math.abs(t.p[3]), Math.abs(t.p[6])) > 0.45 * halfW && Math.max(t.p[1], t.p[4], t.p[7]) < 1.1;
const seeds = tris.some(named) ? (t) => named(t) && outboard(t) : (t) => t.role !== 'paint' && Math.min(t.p[1], t.p[4], t.p[7]) < 0.05;
const seedBox = [0, 1, 2, 3].map((c) => box(tris, (t) => seeds(t) && corner(t) === c));
if (seedBox.some((b) => !Number.isFinite(b.lo[0]))) throw new Error('no wheel at every corner: name the tyres (--roles) or give --wheel');
const wheelR = tris.some(named) ? seedBox.reduce((r, b) => r + (b.hi[1] - b.lo[1]) / 2, 0) / 4 : wheelArg;
if (!(wheelR > 0)) throw new Error('no part is named as the tyres: give --wheel <radius m>');
const cyl = seedBox.map((b) => ({ z: (b.lo[2] + b.hi[2]) / 2, outer: Math.max(Math.abs(b.lo[0]), Math.abs(b.hi[0])) }));
const notWheel = new Set(['paint', 'steel', 'glass', 'lamp', 'amber', 'white', 'light', 'drl']);
// (inside its wheel's cylinder, named or not: what is named as wheel but lies elsewhere stays with the body)
const inWheel = (t) => {
  if (notWheel.has(t.role)) return false;
  const c = cyl[corner(t)], reach = named(t) ? 1.08 : 1.03, side = corner(t) % 2 ? 1 : -1;
  for (let k = 0; k < 9; k += 3) {
    // (on its wheel's side, every corner of it: a long face across the car has an end in each wheel's cylinder)
    if (Math.hypot(t.p[k + 1] - wheelR, t.p[k + 2] - c.z) > wheelR * reach || t.p[k] * side < c.outer - 0.8 * wheelR) return false;
  }
  return true;
};
for (const t of tris) {
  t.wheel = inWheel(t);
  if (!t.wheel || named(t)) continue;
  // (a part caught by a wheel's cylinder but not named as the wheel: the tyre out at its rim, the rim within)
  const c = cyl[corner(t)], d = Math.hypot((t.p[1] + t.p[4] + t.p[7]) / 3 - wheelR, (t.p[2] + t.p[5] + t.p[8]) / 3 - c.z);
  t.role = d > 0.68 * wheelR ? 'tyre' : 'rim';
  t.rgb = LOOK[t.role].rgb;
}
const isWheel = (t) => t.wheel;
const radius = wheelR;
const wheelX = cyl.reduce((x, c) => x + c.outer, 0) / 4 - 0.3 * wheelR;
const front = (cyl[2].z + cyl[3].z) / 2, rear = (cyl[0].z + cyl[1].z) / 2;
const axle = [wheelX, wheelR, cyl[3].z];
// the wheels tucked under the body: a tyre whose outer face stands out of the body over its axle (its fender, from the
// tyre's height to 2.5 radii up, so not the mirrors) is drawn that much further in, to a centimetre inside it. Some
// models are made on wide wheels, and in the street they looked stuck on
const fender = (z) => {
  let m = 0;
  for (const t of tris) {
    if (t.wheel || t.role === 'glass') continue;
    for (let k = 0; k < 9; k += 3) {
      if (Math.abs(t.p[k + 2] - z) < 0.8 * wheelR && t.p[k + 1] > wheelR && t.p[k + 1] < 2.5 * wheelR) m = Math.max(m, Math.abs(t.p[k]));
    }
  }
  return m;
};
let tyreOuter = -Infinity; // (a loop, not Math.max(...): a big wheel has more corners than a call takes arguments)
for (const t of tris) if (t.wheel && corner(t) === 3) tyreOuter = Math.max(tyreOuter, t.p[0], t.p[3], t.p[6]);
const tuck = Math.max(0, tyreOuter - (Math.min(fender(front), fender(rear)) - 0.01));
if (tuck) console.log(`wheels tucked ${(tuck * 100).toFixed(1)} cm in under the fenders`);
console.log(`wheels at x ±${wheelX.toFixed(3)}, z ${front.toFixed(3)} & ${rear.toFixed(3)}, r ${radius.toFixed(3)}; ${tris.filter(isWheel).length} triangles of wheels`);

// the palette: a 16 px cell per look (a role, or a trim part's own colour), 8 cells a row
const cells = new Map(); // key -> index
const cellOf = (t) => {
  const key = `${t.role}|${t.rgb.join(',')}`;
  if (!cells.has(key)) cells.set(key, { i: cells.size, role: t.role, rgb: t.rgb });
  return cells.get(key).i;
};
for (const t of tris) t.cell = cellOf(t);
// (and under the palette, with --plates, the plate's picture: 128 × 64 px)
const C = 16, cols = 8, rows = Math.ceil(cells.size / cols), TW = C * cols, PH = opt('plates') ? 64 : 0, TH = C * Math.max(1, rows) + PH;
const base = Buffer.alloc(TW * TH * 3), mr = Buffer.alloc(TW * TH * 3);
// (what glows by itself, day and night: the 'drl' role's cells white, all else black: the glTF's emissive texture)
const glow = Buffer.alloc(TW * TH * 3);
let glows = false;
for (const { i, role, rgb } of cells.values()) {
  const look = LOOK[role], x0 = (i % cols) * C, y0 = Math.floor(i / cols) * C;
  for (let y = y0; y < y0 + C; y++) {
    for (let x = x0; x < x0 + C; x++) {
      const o = (y * TW + x) * 3;
      base.set(rgb, o);
      const metal = role === 'wheel' && Math.max(...rgb) > 120 ? 0.8 : look.metal;
      mr.set([Math.round((look.paint ?? 0) * 255), Math.round(look.rough * 255), Math.round(metal * 255)], o);
      if (look.glow) { glow.set([255, 255, 255], o); glows = true; }
    }
  }
}
const uvOf = (cell) => [((cell % cols) * C + C / 2) / TW, (Math.floor(cell / cols) * C + C / 2) / TH];
// A plate of Nayarit, as the player's car has (player/controllers/car-model.ts): white, the state's name on a green band
// across the top, MÉXICO along the bottom, and a number of three letters and four digits made from the out file's name
// (each model its own, the same on every car of it)
if (PH) {
  let h = 2166136261;
  for (const ch of out) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ', pick = (n) => { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; return h % n; };
  const number = `${letters[pick(23)]}${letters[pick(23)]}${letters[pick(23)]}-${pick(10)}${pick(10)}-${pick(10)}${pick(10)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${PH}">
    <rect width="${TW}" height="${PH}" fill="#f4f4f0"/><rect x="2" y="2" width="${TW - 4}" height="${PH - 4}" fill="none" stroke="#2a2d31" stroke-width="2"/>
    <rect x="4" y="4" width="${TW - 8}" height="12" fill="#0f6b3a"/>
    <text x="${TW / 2}" y="14" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="10" fill="#f4f4f0" text-anchor="middle">NAYARIT</text>
    <text x="${TW / 2}" y="44" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="25" fill="#16181c" text-anchor="middle" textLength="${TW - 16}" lengthAdjust="spacingAndGlyphs">${number}</text>
    <text x="${TW / 2}" y="58" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="8" fill="#16181c" text-anchor="middle">MÉXICO</text></svg>`;
  const plate = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  plate.copy(base, (TH - PH) * TW * 3);
  for (let i = (TH - PH) * TW; i < TH * TW; i++) mr.set([0, 102, 0], i * 3); // (roughness 0.4, no paint, no metal)
  console.log(`plates: ${number}`);
}
const plateUV = (u, v) => [(0.5 + u * (TW - 1)) / TW, (TH - PH + 0.5 + v * (PH - 1)) / TH];

// the output: the body and the wheel, one material, both textures
const doc = new Document();
const buffer = doc.createBuffer();
const png = async (raw) => sharp(raw, { raw: { width: TW, height: TH, channels: 3 } }).png().toBuffer();
const material = doc.createMaterial('car')
  .setBaseColorTexture(doc.createTexture('palette').setImage(await png(base)).setMimeType('image/png'))
  .setMetallicRoughnessTexture(doc.createTexture('paint').setImage(await png(mr)).setMimeType('image/png'))
  .setMetallicFactor(1).setRoughnessFactor(1);
if (glows) material.setEmissiveTexture(doc.createTexture('glow').setImage(await png(glow)).setMimeType('image/png')).setEmissiveFactor([1, 1, 1]);
const primitive = (list, offset) => {
  const P = new Float32Array(list.length * 9), N = new Float32Array(list.length * 9), U = new Float32Array(list.length * 6);
  list.forEach((t, j) => {
    for (let k = 0; k < 9; k++) P[j * 9 + k] = t.p[k] - offset[k % 3];
    for (let k = 0; k < 9; k += 3) {
      const l = Math.hypot(t.n[k], t.n[k + 1], t.n[k + 2]) || 1;
      N.set([t.n[k] / l, t.n[k + 1] / l, t.n[k + 2] / l], j * 9 + k);
    }
    if (t.plateUV) for (let k = 0; k < 3; k++) U.set(plateUV(t.plateUV[k * 2], t.plateUV[k * 2 + 1]), j * 6 + k * 2);
    else for (let k = 0; k < 3; k++) U.set(uvOf(t.cell), j * 6 + k * 2);
  });
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return doc.createPrimitive().setMaterial(material).setAttribute('POSITION', acc('VEC3', P))
    .setAttribute('NORMAL', acc('VEC3', N)).setAttribute('TEXCOORD_0', acc('VEC2', U));
};
const body = doc.createMesh('body').addPrimitive(primitive(tris.filter((t) => !isWheel(t)), [0, 0, 0]));
body.setExtras({ wheels: { x: +(wheelX - tuck).toFixed(3), z: [+front.toFixed(3), +rear.toFixed(3)], radius: +radius.toFixed(3) } });
const wheel = doc.createMesh('wheel').addPrimitive(primitive(tris.filter((t) => isWheel(t) && corner(t) === 3), axle));
doc.createScene('car').addChild(doc.createNode('body').setMesh(body)).addChild(doc.createNode('wheel').setMesh(wheel));
await doc.transform(weld());
await io.write(out, doc);
const roles = {};
for (const t of tris) roles[t.role] = (roles[t.role] ?? 0) + 1;
const left = doc.getRoot().listMeshes().map((m) => `${m.getName()} ${m.listPrimitives()[0].getIndices().getCount() / 3}`).join(', ');
console.log(`${cells.size} palette cells; triangles by role ${JSON.stringify(roles)}; out: ${left}`);
