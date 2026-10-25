// tools/models/prepare.mjs
// A model from an image-to-3D service (tools/models/meshy.mjs), made ready for the game: the neighbours the photograph
// caught cropped off (everything wider than the front), optionally everything more than `--cut` m behind the front,
// in metres from a known height, its origin at the foot of the front's middle (the front on z = 0, the building
// towards -z, +y up), simplified, its texture a JPEG of at most 2048 px.
//   (cd tools/models && npm install)   # once: glTF-Transform, meshoptimizer, sharp
//   node tools/models/prepare.mjs <in.glb> <out.glb> --height 40 [--cut 9.5] [--ratio 0.6] [--keep-width]
//   node tools/models/prepare.mjs <in.glb> <out.glb> --length 4.5 --yaw 90 [--wheel 0.317] [--ratio 1] [--texture 1024]   # a vehicle
// --height: the real height of the model's top (m); --keep-width: no cropping (a prop, not a building between others).
// --length: a vehicle (modelled white), scaled to its real length (its long axis turned to z first by --yaw, degrees about +y, so its
// nose faces +z as the game's cars do), whole, its origin on the ground under its middle, with a paint mask (paintMask
// below; --wheel: its tyres' radius, m, from their size: 195/65R15 is (15 × 25.4 + 2 × 0.65 × 195) / 2 mm).
// --texture: the largest side.
// It assumes the service's convention: +y up and the photographed side facing +z (Meshy's front view).
// No quantization: three.js's WebGPU backend has no 3-wide 16-bit vertex format, and the positions came out NaN.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : Number(args[i + 1]);
};
const [inp, out] = args;
const height = opt('height', NaN), length = opt('length', NaN), yaw = (opt('yaw', 0) * Math.PI) / 180;
const cut = opt('cut', Infinity), ratio = opt('ratio', 0.6), texture = opt('texture', 2048), wheel = opt('wheel', 0.31);
const vehicle = length > 0, keepWidth = vehicle || args.includes('--keep-width');
if (!inp || !out || !(height > 0 || vehicle)) throw new Error('usage: node tools/models/prepare.mjs <in.glb> <out.glb> (--height <m> [--cut <m>] [--keep-width] | --length <m> [--yaw <deg>]) [--ratio 0.6] [--texture 2048]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const meshes = doc.getRoot().listMeshes();
if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error('expected one mesh of one primitive (as Meshy gives)');
const prim = meshes[0].listPrimitives()[0];
const posA = prim.getAttribute('POSITION'), pos = posA.getArray();
const n = pos.length / 3;
// turned about +y first (positions & normals)
if (yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const a of [posA, prim.getAttribute('NORMAL')].filter(Boolean)) {
    const v = a.getArray();
    for (let i = 0; i < v.length; i += 3) [v[i], v[i + 2]] = [v[i] * c + v[i + 2] * s, -v[i] * s + v[i + 2] * c];
    a.setArray(v);
  }
}
let zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity, yAll = Infinity, xMin = Infinity, xMax = -Infinity;
for (let i = 0; i < n; i++) {
  zMax = Math.max(zMax, pos[i * 3 + 2]);
  zMin = Math.min(zMin, pos[i * 3 + 2]);
  yMax = Math.max(yMax, pos[i * 3 + 1]);
  yAll = Math.min(yAll, pos[i * 3 + 1]);
  xMin = Math.min(xMin, pos[i * 3]);
  xMax = Math.max(xMax, pos[i * 3]);
}
// the front: the front-most slab's vertices (6% of the height deep); its width (0.5%-99.5% of them) is what's kept,
// its foot is the ground
const xs = [];
for (let i = 0; i < n; i++) {
  if (pos[i * 3 + 2] > zMax - 0.063 * (yMax - yAll)) {
    xs.push(pos[i * 3]);
    yMin = Math.min(yMin, pos[i * 3 + 1]);
  }
}
xs.sort((a, b) => a - b);
const xl = keepWidth ? xMin : xs[Math.floor(xs.length * 0.005)], xr = keepWidth ? xMax : xs[Math.floor(xs.length * 0.995)];
if (keepWidth) yMin = yAll;
const s = vehicle ? length / (zMax - zMin) : height / (yMax - yMin), xc = (xl + xr) / 2, zCut = zMax - cut / s;
const z0 = vehicle ? (zMin + zMax) / 2 : zMax; // (a vehicle's origin under its middle)
console.log(`${((xr - xl) * s).toFixed(2)} m wide, ${((yMax - yMin) * s).toFixed(2)} m high, scale ${s.toFixed(3)}`);
// crop: the triangles within the front's width (and the cut)
const idxA = prim.getIndices(), idx = idxA.getArray(), keep = [];
const inside = (v) => pos[v * 3] > xl - 0.015 && pos[v * 3] < xr + 0.015 && pos[v * 3 + 2] > zCut;
for (let t = 0; t < idx.length; t += 3) if (inside(idx[t]) && inside(idx[t + 1]) && inside(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
idxA.setArray(new Uint32Array(keep));
console.log(`triangles ${idx.length / 3} -> ${keep.length / 3} cropped`);
// the frame: metres, the origin at the front's foot
for (let i = 0; i < n; i++) {
  pos[i * 3] = (pos[i * 3] - xc) * s;
  pos[i * 3 + 1] = (pos[i * 3 + 1] - yMin) * s;
  pos[i * 3 + 2] = (pos[i * 3 + 2] - z0) * s;
}
posA.setArray(pos);
for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(false).setMetallicFactor(0);
await MeshoptSimplifier.ready;
await doc.transform(
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0004 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 82, resize: [texture, texture] }),
  dedup(),
  prune()
);
if (vehicle) await paintMask(doc);
await io.write(out, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
const tris = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
console.log(`${tris} triangles; bounds (m) ${b.min.map((v) => v.toFixed(1))} .. ${b.max.map((v) => v.toFixed(1))}`);

// A vehicle's paint mask, for the game's per-car colour (actor-models.js createModelCarMaterial): the texture's white
// areas (but specks, and the wheels: their rims' faces are white too), grown a few pixels over their edges and the
// atlas's seams, which a plain threshold left as pale stripes. Stored as the
// metallic-roughness texture: R the mask (glTF leaves R unused), G the roughness (gloss paint, matte elsewhere), B 0.
async function paintMask(doc) {
  const mat = doc.getRoot().listMaterials()[0], base = mat && mat.getBaseColorTexture();
  if (!base) return;
  const { data, info } = await sharp(Buffer.from(base.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const white = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255, sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    white[i] = lum > 0.62 && sat < 0.12 ? 1 : 0;
  }
  // the white areas' sizes (4-connected), the small ones dropped
  const label = new Int32Array(N).fill(-1), keep = new Uint8Array(N), stack = new Int32Array(N), minArea = N * 0.00006;
  for (let s = 0; s < N; s++) {
    if (!white[s] || label[s] >= 0) continue;
    let top = 0, area = 0;
    const members = [];
    stack[top++] = s;
    label[s] = s;
    while (top) {
      const i = stack[--top];
      members.push(i);
      area++;
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && white[j] && label[j] < 0) {
          label[j] = s;
          stack[top++] = j;
        }
      }
    }
    if (area >= minArea) for (const i of members) keep[i] = 1;
  }
  // never the wheels (their rims' faces are big white areas too): the triangles in each wheel's disc, its axles found
  // where the tyres meet the ground (a bigger disc takes the wheel arch's paint too)
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), IX = prim.getIndices().getArray();
  let half = 0;
  const ground = [[], []];
  for (let v = 0; v < P.length / 3; v++) {
    half = Math.max(half, Math.abs(P[v * 3]));
    if (P[v * 3 + 1] < 0.05) ground[P[v * 3 + 2] > 0 ? 0 : 1].push(P[v * 3 + 2]);
  }
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const axles = ground.filter((g) => g.length).map(median), radius = wheel;
  const noPaint = new Uint8Array(N);
  for (let t = 0; t < IX.length; t += 3) {
    const [a, b, c] = [IX[t], IX[t + 1], IX[t + 2]];
    const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    if (Math.abs(x) < half - 0.45 || !axles.some((az) => Math.hypot(z - az, y - radius) < radius * 1.02)) continue;
    // its triangle in the texture, filled (with a pixel to spare)
    const tx = [a, b, c].map((v) => UV[v * 2] * W), ty = [a, b, c].map((v) => UV[v * 2 + 1] * H);
    const x0 = Math.max(0, Math.floor(Math.min(...tx)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...tx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...ty)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...ty)) + 1);
    const d = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0]);
    if (Math.abs(d) < 1e-9) continue;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const u = ((tx[1] - qx) * (ty[2] - qy) - (tx[2] - qx) * (ty[1] - qy)) / d;
        const v = ((tx[2] - qx) * (ty[0] - qy) - (tx[0] - qx) * (ty[2] - qy)) / d;
        if (u > -0.08 && v > -0.08 && 1 - u - v > -0.08) noPaint[py * W + px] = 1;
      }
    }
  }
  for (let i = 0; i < N; i++) if (noPaint[i]) keep[i] = 0;
  // grown 3 px (over edges and seams), then softened
  let grown = keep;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(grown);
    for (let i = 0; i < N; i++) {
      if (grown[i]) continue;
      const x = i % W, y = (i / W) | 0;
      if (noPaint[i]) continue;
      if ((x > 0 && grown[i - 1]) || (x < W - 1 && grown[i + 1]) || (y > 0 && grown[i - W]) || (y < H - 1 && grown[i + W])) next[i] = 1;
    }
    grown = next;
  }
  const rgb = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    rgb[i * 3] = grown[i] * 255;
    rgb[i * 3 + 1] = grown[i] ? 85 : 190; // (roughness 0.33 on the paint, 0.75 elsewhere)
  }
  const png = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).blur(0.8).png({ compressionLevel: 9 }).toBuffer();
  const tex = doc.createTexture('paint').setImage(png).setMimeType('image/png');
  mat.setMetallicRoughnessTexture(tex).setRoughnessFactor(1).setMetallicFactor(0);
  mat.getMetallicRoughnessTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
  let painted = 0;
  for (let i = 0; i < N; i++) painted += grown[i];
  console.log(`paint mask: ${((100 * painted) / N).toFixed(0)}% of the texture, ${(png.length / 1024).toFixed(0)} KB; wheels at z ${axles.map((z) => z.toFixed(2))}, r ${radius.toFixed(2)}`);
}
