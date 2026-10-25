// tools/models/prepare.mjs
// A model from an image-to-3D service (tools/models/meshy.mjs), made ready for the game: the neighbours the photograph
// caught cropped off (everything wider than the front), optionally everything more than `--cut` m behind the front,
// in metres from a known height, its origin at the foot of the front's middle (the front on z = 0, the building
// towards -z, +y up), simplified, its texture a JPEG of at most 2048 px.
//   (cd tools/models && npm install)   # once: glTF-Transform, meshoptimizer, sharp
//   node tools/models/prepare.mjs <in.glb> <out.glb> --height 40 [--cut 9.5] [--ratio 0.6] [--keep-width]
// --height: the real height of the model's top (m); --keep-width: no cropping (a prop, not a building between others).
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
const height = opt('height', NaN), cut = opt('cut', Infinity), ratio = opt('ratio', 0.6), keepWidth = args.includes('--keep-width');
if (!inp || !out || !(height > 0)) throw new Error('usage: node tools/models/prepare.mjs <in.glb> <out.glb> --height <m> [--cut <m>] [--ratio 0.6] [--keep-width]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const meshes = doc.getRoot().listMeshes();
if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) throw new Error('expected one mesh of one primitive (as Meshy gives)');
const prim = meshes[0].listPrimitives()[0];
const posA = prim.getAttribute('POSITION'), pos = posA.getArray();
const n = pos.length / 3;
let zMax = -Infinity, yMin = Infinity, yMax = -Infinity, yAll = Infinity, xMin = Infinity, xMax = -Infinity;
for (let i = 0; i < n; i++) {
  zMax = Math.max(zMax, pos[i * 3 + 2]);
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
const s = height / (yMax - yMin), xc = (xl + xr) / 2, zCut = zMax - cut / s;
console.log(`front ${((xr - xl) * s).toFixed(1)} m wide, scale ${s.toFixed(3)}`);
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
  pos[i * 3 + 2] = (pos[i * 3 + 2] - zMax) * s;
}
posA.setArray(pos);
for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(false).setMetallicFactor(0);
await MeshoptSimplifier.ready;
await doc.transform(
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0004 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 82, resize: [2048, 2048] }),
  dedup(),
  prune()
);
await io.write(out, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
const tris = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices().getCount() / 3;
console.log(`${tris} triangles; bounds (m) ${b.min.map((v) => v.toFixed(1))} .. ${b.max.map((v) => v.toFixed(1))}`);
