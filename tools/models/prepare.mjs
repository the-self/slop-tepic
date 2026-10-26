// tools/models/prepare.mjs
// A model from an image-to-3D service (tools/models/meshy.mjs), made ready for the game: the neighbours the photograph
// caught cropped off (everything wider than the front), optionally everything more than `--cut` m behind the front,
// in metres from a known height, its origin at the foot of the front's middle (the front on z = 0, the building
// towards -z, +y up), simplified, its texture a JPEG of at most 2048 px.
//   (cd tools/models && npm install)   # once: glTF-Transform, meshoptimizer, sharp, xatlasjs
//   node tools/models/prepare.mjs <in.glb> <out.glb> --height 40 [--cut 9.5] [--ratio 0.6] [--keep-width]
//   node tools/models/prepare.mjs <in.glb> <out.glb> --length 4.5 --yaw 90 [--wheel 0.317] [--ratio 1] [--texture 1024]   # a vehicle
// --height: the real height of the model's top (m); --keep-width: no cropping (a prop, not a building between others).
// --length: a vehicle (modelled white, or magenta: keyedPaint), scaled to its real length (its long axis turned to z first by --yaw, degrees about +y, so its
// nose faces +z as the game's cars do), whole, its origin on the ground under its middle, its front wheel a mesh of its own
// and the wheels pressed into wells (wheelWells), with a paint mask (paintMask
// below; --wheel: its tyres' radius, m, from their size: 195/65R15 is (15 × 25.4 + 2 × 0.65 × 195) / 2 mm).
// --texture: the largest side.
// It assumes the service's convention: +y up and the photographed side facing +z (Meshy's front view).
// No quantization: three.js's WebGPU backend has no 3-wide 16-bit vertex format, and the positions came out NaN.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { Api } from 'xatlasjs/dist/node/api.mjs';

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
// (a vehicle's own maps are made below from its colours: Meshy's PBR normal & metal-roughness maps are dropped, their
// atlas is the one baked anew; its colour is read at up to 4096 px and written at --texture)
if (vehicle) for (const m of doc.getRoot().listMaterials()) m.setNormalTexture(null).setMetallicRoughnessTexture(null);
const wells = vehicle ? wheelWells(doc) : null; // (before simplifying: the flat walls simplify away)
await MeshoptSimplifier.ready;
await doc.transform(
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0004 }),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: vehicle ? 92 : 82, resize: vehicle ? [4096, 4096] : [texture, texture] }),
  dedup(),
  prune()
);
if (wells) await paintMask(doc, wells.triangles());
await io.write(out, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
const tris = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives()[0].getIndices().getCount() / 3, 0);
console.log(`${tris} triangles; bounds (m) ${b.min.map((v) => v.toFixed(1))} .. ${b.max.map((v) => v.toFixed(1))}`);

// A vehicle's body mesh (the one that isn't its wheel)
function bodyOf(doc) {
  const body = doc.getRoot().listMeshes().find((m) => m.getName() !== 'wheel');
  if (!body) throw new Error('no body mesh');
  return body;
}

// A vehicle's wheels, out of its body so the game can turn them: its front wheel on the +x side (found where the tyres
// touch the ground, `--wheel` their radius) is copied out as a mesh of its own, 'wheel', its axle on the origin (the
// game draws it at all four corners, mirrored on the -x side), and then all four are pressed into a flat dark wall just
// inside where the tyres turn, the wheel well, so the body stays closed. Where the wheels go is the body mesh's extras
// ({ wheels: { x, z: [front, rear], radius } }, m), which three.js's loader hands over as its userData.
function wheelWells(doc) {
  const mesh = bodyOf(doc), prim = mesh.listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL')?.getArray(), IX = prim.getIndices().getArray();
  const nv = P.length / 3, r = wheel;
  let half = 0;
  const ground = [[], []];
  for (let v = 0; v < nv; v++) {
    half = Math.max(half, Math.abs(P[v * 3]));
    if (P[v * 3 + 1] < 0.05) ground[P[v * 3 + 2] > 0 ? 0 : 1].push(P[v * 3 + 2]);
  }
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  if (!ground[0].length || !ground[1].length) throw new Error('no tyres on the ground at both ends');
  const axles = ground.map(median);
  const inDisc = (v, k) => axles.some((az) => Math.hypot(P[v * 3 + 2] - az, P[v * 3 + 1] - r) < r * k);
  // the tyres' outer faces (the widest of what is well inside the discs), so the game's tyre (0.6 r wide) sits flush
  let outer = 0;
  for (let v = 0; v < nv; v++) if (Math.abs(P[v * 3]) > half - 0.45 && inDisc(v, 0.85)) outer = Math.max(outer, Math.abs(P[v * 3]));
  const x = outer - 0.3 * r, inner = x - 0.3 * r - 0.03;
  // the wheel: the triangles wholly in the front disc on the +x side, beyond the wall, copied with their texture
  const UV = prim.getAttribute('TEXCOORD_0').getArray(), fz = axles[0], at = new Map(), wP = [], wN = [], wUV = [], wI = [];
  const inWheel = (v) => P[v * 3] > inner && Math.hypot(P[v * 3 + 2] - fz, P[v * 3 + 1] - r) < r;
  for (let t = 0; t < IX.length; t += 3) {
    if (!inWheel(IX[t]) || !inWheel(IX[t + 1]) || !inWheel(IX[t + 2])) continue;
    for (const v of [IX[t], IX[t + 1], IX[t + 2]]) {
      if (!at.has(v)) {
        at.set(v, at.size);
        wP.push(P[v * 3] - x, P[v * 3 + 1] - r, P[v * 3 + 2] - fz);
        if (N) wN.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        wUV.push(UV[v * 2], UV[v * 2 + 1]);
      }
      wI.push(at.get(v));
    }
  }
  if (!wI.length) throw new Error('no wheel found in the front disc');
  const buffer = doc.getRoot().listBuffers()[0], acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const wheelPrim = doc.createPrimitive().setMaterial(prim.getMaterial()).setIndices(acc('SCALAR', new Uint32Array(wI)))
    .setAttribute('POSITION', acc('VEC3', new Float32Array(wP))).setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(wUV)));
  if (N) wheelPrim.setAttribute('NORMAL', acc('VEC3', new Float32Array(wN)));
  doc.getRoot().listScenes()[0].addChild(doc.createNode('wheel').setMesh(doc.createMesh('wheel').addPrimitive(wheelPrim)));
  console.log(`the wheel: ${wI.length / 3} triangles`);
  for (let v = 0; v < nv; v++) {
    if (Math.abs(P[v * 3]) <= inner || !inDisc(v, 1.04)) continue;
    const side = Math.sign(P[v * 3]);
    P[v * 3] = side * inner;
    if (N) N.set([side, 0, 0], v * 3);
  }
  prim.getAttribute('POSITION').setArray(P);
  if (N) prim.getAttribute('NORMAL').setArray(N);
  const wheels = { x: +x.toFixed(3), z: axles.map((z) => +z.toFixed(3)), radius: r };
  mesh.setExtras({ ...mesh.getExtras(), wheels });
  console.log(`wheels at x ±${wheels.x}, z ${wheels.z}, r ${r}`);
  // the wells' triangles once simplified: two corners or more on a wall
  return {
    triangles() {
      const p = mesh.listPrimitives()[0], Q = p.getAttribute('POSITION').getArray(), I = p.getIndices().getArray();
      const on = (v) => Math.abs(Math.abs(Q[v * 3]) - inner) < 1e-4 && axles.some((az) => Math.hypot(Q[v * 3 + 2] - az, Q[v * 3 + 1] - r) < r * 1.05);
      const list = [];
      // ...and the arches' inner faces, facing the wheel (Meshy paints them pale): near a wheel, turned to its axle
      const facesWheel = (t) => {
        const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
        const cx = (Q[a * 3] + Q[b * 3] + Q[c * 3]) / 3, cy = (Q[a * 3 + 1] + Q[b * 3 + 1] + Q[c * 3 + 1]) / 3, cz = (Q[a * 3 + 2] + Q[b * 3 + 2] + Q[c * 3 + 2]) / 3;
        const az = axles.reduce((best, z) => (Math.abs(z - cz) < Math.abs(best - cz) ? z : best));
        const dy = cy - r, dz = cz - az, d = Math.hypot(dy, dz);
        if (Math.abs(cx) < inner - 0.08 || d > r * 1.3 || d < 1e-6) return false;
        const ux = Q[b * 3] - Q[a * 3], uy = Q[b * 3 + 1] - Q[a * 3 + 1], uz = Q[b * 3 + 2] - Q[a * 3 + 2];
        const vx = Q[c * 3] - Q[a * 3], vy = Q[c * 3 + 1] - Q[a * 3 + 1], vz = Q[c * 3 + 2] - Q[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, n = Math.hypot(nx, ny, nz);
        return n > 0 && (ny * dy + nz * dz) / (n * d) < -0.5 && Math.abs(nx) / n < 0.7;
      };
      for (let t = 0; t < I.length; t += 3) if (on(I[t]) + on(I[t + 1]) + on(I[t + 2]) >= 2 || facesWheel(t)) list.push(t);
      console.log(`${list.length} triangles in the wheel wells`);
      return list;
    }
  };
}

// A vehicle's paint mask, for the game's per-car colour (actors/vehicles/car-material.ts createModelCarMaterial),
// stored as the metallic-roughness texture: R the mask (glTF leaves R unused), G the roughness (gloss paint, matte
// elsewhere), B the metalness (a keyed car's chrome; 0 on a white one). A car drawn in the key colour (magenta,
// tools/models/jobs/cars) is masked by its hue (keyedPaint, which bakes it a new atlas); one drawn white by its white
// areas (but specks), grown a few pixels over their edges and the atlas's seams, which a plain threshold left as pale
// stripes. Never the wheel wells (`wells`: the triangles wheelWells pressed in).
async function paintMask(doc, wells) {
  const mat = doc.getRoot().listMaterials()[0], base = mat && mat.getBaseColorTexture();
  if (!base) return;
  const { data, info } = await sharp(Buffer.from(base.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const prim = bodyOf(doc).listPrimitives()[0];
  const UV = prim.getAttribute('TEXCOORD_0').getArray(), IX = prim.getIndices().getArray();
  // the texels of the triangle at index t in the texture (with `spare` pixels more, in barycentric terms), to `fn`
  const eachTexel = (t, spare, fn) => {
    const [a, b, c] = [IX[t], IX[t + 1], IX[t + 2]];
    const tx = [a, b, c].map((v) => UV[v * 2] * W), ty = [a, b, c].map((v) => UV[v * 2 + 1] * H);
    const x0 = Math.max(0, Math.floor(Math.min(...tx)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(...tx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...ty)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(...ty)) + 1);
    const d = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0]);
    if (Math.abs(d) < 1e-9) return;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const u = ((tx[1] - qx) * (ty[2] - qy) - (tx[2] - qx) * (ty[1] - qy)) / d;
        const v = ((tx[2] - qx) * (ty[0] - qy) - (tx[0] - qx) * (ty[2] - qy)) / d;
        if (u > -spare && v > -spare && 1 - u - v > -spare) fn(py * W + px);
      }
    }
  };
  const keyOf = (i) => keyOfRGB(data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255);
  const keyM = new Float32Array(N);
  let keyed = 0;
  for (let i = 0; i < N; i++) {
    keyM[i] = keyOf(i);
    if (keyM[i] > 0.5) keyed++;
  }
  const key = keyed > N * 0.08;
  if (key) return keyedPaint(doc, mat, data, W, H, keyM, eachTexel, wells);
  const mask = new Float32Array(N);
  const white = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255, sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    white[i] = lum > 0.62 && sat < 0.12 ? 1 : 0;
  }
  // the white areas' sizes (4-connected), the small ones dropped
  const label = new Int32Array(N).fill(-1), stack = new Int32Array(N), minArea = N * 0.00006;
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
    if (area >= minArea) for (const i of members) mask[i] = 1;
  }
  // the wells' triangles in the texture, filled (with a pixel to spare): never painted
  const noPaint = new Uint8Array(N);
  for (const t of wells) eachTexel(t, 0.08, (i) => { noPaint[i] = 1; });
  for (let i = 0; i < N; i++) if (noPaint[i]) mask[i] = 0; // (not darkened: the wheel mesh shares these texels)
  // grown 3 px (over edges and seams; a keyed car's only into what is no paint at all: its soft edges stay soft)
  let grown = mask;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(grown);
    for (let i = 0; i < N; i++) {
      if (grown[i] || noPaint[i]) continue;
      const x = i % W, y = (i / W) | 0;
      next[i] = Math.max(x > 0 ? grown[i - 1] : 0, x < W - 1 ? grown[i + 1] : 0, y > 0 ? grown[i - W] : 0, y < H - 1 ? grown[i + W] : 0);
    }
    grown = next;
  }
  const rgb = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    rgb[i * 3] = Math.round(grown[i] * 255);
    rgb[i * 3 + 1] = Math.round(190 - 105 * grown[i]); // (roughness 0.33 on the paint, 0.75 elsewhere)
  }
  const png = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).blur(key ? 0.5 : 0.8).png({ compressionLevel: 9 }).toBuffer();
  const tex = doc.createTexture('paint').setImage(png).setMimeType('image/png');
  mat.setMetallicRoughnessTexture(tex).setRoughnessFactor(1).setMetallicFactor(0);
  mat.getMetallicRoughnessTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
  base.setImage(await sharp(data, { raw: { width: W, height: H, channels: 3 } }).resize(Math.min(W, texture)).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
  tex.setImage(await sharp(png).resize(Math.min(W, texture)).png({ compressionLevel: 9 }).toBuffer());
  let painted = 0;
  for (let i = 0; i < N; i++) painted += grown[i];
  console.log(`paint mask (${key ? 'magenta key' : 'white'}): ${((100 * painted) / N).toFixed(0)}% of the texture, ${(png.length / 1024).toFixed(0)} KB`);
}

// How much a colour (0-1) is the key: its hue within ~40° of magenta's 300° (fading out over the next 20°), saturated
// (fading in from 15% to 30%)
function keyOfRGB(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
  if (mx - mn < 0.04) return 0;
  let hue = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? ((b - r) / (mx - mn)) * 60 + 120 : ((r - g) / (mx - mn)) * 60 + 240;
  if (hue < 0) hue += 360;
  return Math.min(1, Math.max(0, (60 - Math.abs(hue - 300)) / 20)) * Math.min(1, Math.max(0, (sat - 0.15) / 0.15));
}

// A car drawn in the key colour (magenta: tools/models/jobs/cars), given a new atlas and its texture baked into it.
// Meshy's atlas is hundreds of small islands packed edge to edge, and each island's rim takes in its neighbours'
// colours: painted, a panel's rims came out white or black, lines all over the paint, and worse with distance (the
// mipmaps blend more). So the mesh is unwrapped again by xatlas into charts with gutters between them, and each
// texel of the new atlas takes the old texture's colour at the same point of the surface, read a little in from the
// old triangle's edges. A triangle mostly of the key is paint all over (its rims at its paint's mean brightness),
// the rest by texel; the paint goes grey in the texture (its brightness kept: the shading the game paints over), and
// the gutters take their charts' colours outwards.
async function keyedPaint(doc, mat, old, W, H, keyM, eachTexel, wells) {
  const prim = bodyOf(doc).listPrimitives()[0];
  const IX = prim.getIndices().getArray(), UVo = prim.getAttribute('TEXCOORD_0').getArray();
  const value = (r, g, b) => Math.max(r, g, b);
  // each triangle in the old texture: how much of it is the key, and the key's mean brightness there
  const nt = IX.length / 3, paintT = new Uint8Array(nt), meanT = new Float32Array(nt);
  for (let t = 0; t < IX.length; t += 3) {
    let n = 0, k = 0, sum = 0;
    eachTexel(t, 0, (i) => {
      n++;
      if (keyM[i] > 0.5) {
        k++;
        sum += value(old[i * 3], old[i * 3 + 1], old[i * 3 + 2]);
      }
    });
    if (!n) {
      // (too small to hold a texel's centre: its centre's texel decides)
      const u = (UVo[IX[t] * 2] + UVo[IX[t + 1] * 2] + UVo[IX[t + 2] * 2]) / 3, v = (UVo[IX[t] * 2 + 1] + UVo[IX[t + 1] * 2 + 1] + UVo[IX[t + 2] * 2 + 1]) / 3;
      const i = Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W));
      n = 1;
      if (keyM[i] > 0.5) k = 1, sum = value(old[i * 3], old[i * 3 + 1], old[i * 3 + 2]);
    }
    // (paint all over from a third of the key; with less, at least its pale texels: the seams Meshy left pale)
    if (k / n >= 0.35) paintT[t / 3] = 1;
    else if (k / n >= 0.04) paintT[t / 3] = 2;
    if (k) meanT[t / 3] = sum / k;
  }
  const wellT = new Uint8Array(nt);
  for (const t of wells) wellT[t / 3] = 1;
  smoothPaint(prim, paintT);

  // the new atlas (xatlas keeps the triangles' order; its vertices are the old ones, split along the new seams)
  const XAtlas = Api(createRequire(import.meta.url)('xatlasjs/dist/node/xatlas.js'));
  const xa = await new Promise((resolve) => { const a = new XAtlas(() => { resolve(a); }); });
  // (the body, and the wheel: never paint, its own charts)
  const wheelMesh = doc.getRoot().listMeshes().find((m) => m.getName() === 'wheel');
  const parts = [{ prim, paintT, meanT, wellT }];
  if (wheelMesh) {
    const wp = wheelMesh.listPrimitives()[0], n = wp.getIndices().getCount() / 3;
    parts.push({ prim: wp, paintT: new Uint8Array(n), meanT: new Float32Array(n), wellT: new Uint8Array(n) });
  }
  xa.createAtlas();
  for (const part of parts) {
    const P = part.prim.getAttribute('POSITION').getArray();
    if (P.length / 3 > 65535) throw new Error('xatlasjs takes 16-bit indices: simplify the car further');
    xa.addMesh(new Uint16Array(part.prim.getIndices().getArray()), new Float32Array(P), null, null, part);
  }
  const S = texture, pad = Math.max(4, Math.round(S / 340));
  xa.generateAtlas({ maxIterations: 2 }, { resolution: S, padding: pad, bilinear: true, blockAlign: true }, false);
  let vertices = 0;
  parts.forEach((part, k) => {
    // (read here, not through xatlasjs's getAtlas: that one makes the new indices 16-bit, and a big car's new vertices
    // pass 65535 once its seams are split)
    const data = xa.getMeshData(xa.meshes[k].meshId), heap = xa.xatlas, nv = data.newVertexCount;
    const index = Uint32Array.from(heap.HEAPU32.subarray(data.indexOffset / 4, data.indexOffset / 4 + data.newIndexCount));
    const oldIndexes = Uint32Array.from(heap.HEAPU32.subarray(data.originalIndexOffset / 4, data.originalIndexOffset / 4 + nv));
    const uv = Float32Array.from(heap.HEAPF32.subarray(data.uvOffset / 4, data.uvOffset / 4 + nv * 2));
    xa.destroyMeshData(data);
    data.subMeshes.delete();
    const pr = part.prim;
    const remap = (name, size) => {
      const src = pr.getAttribute(name).getArray(), dst = new Float32Array(nv * size);
      for (let v = 0; v < nv; v++) for (let c = 0; c < size; c++) dst[v * size + c] = src[oldIndexes[v] * size + c];
      return dst;
    };
    part.oldUV = remap('TEXCOORD_0', 2);
    for (const [name, size] of [['POSITION', 3], ['NORMAL', 3]]) if (pr.getAttribute(name)) pr.getAttribute(name).setArray(remap(name, size));
    part.UVn = uv;
    part.IX = index;
    pr.getAttribute('TEXCOORD_0').setArray(uv);
    pr.getIndices().setArray(index);
    vertices += nv;
  });

  // baked: each new triangle's texels from the old texture (bilinear, at barycentrics pulled `in` towards its middle)
  const N = S * S, rgb = new Float32Array(N * 3), mask = new Float32Array(N), rough = new Float32Array(N), metal = new Float32Array(N), got = new Uint8Array(N); // (got: 1 near, 2 inside)
  const sample = (u, v, out) => {
    const x = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), y = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    for (let c = 0; c < 3; c++) {
      const at = (xx, yy) => old[(yy * W + xx) * 3 + c];
      out[c] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  };
  const px = [0, 0, 0];
  for (const { IX: newIX, UVn, oldUV, paintT, meanT, wellT } of parts) {
    for (let t = 0; t < newIX.length; t += 3) {
      const vs = [newIX[t], newIX[t + 1], newIX[t + 2]];
      const nx = vs.map((v) => UVn[v * 2] * S), ny = vs.map((v) => UVn[v * 2 + 1] * S);
      const ox = vs.map((v) => oldUV[v * 2] * W), oy = vs.map((v) => oldUV[v * 2 + 1] * H);
      const d = (nx[1] - nx[0]) * (ny[2] - ny[0]) - (nx[2] - nx[0]) * (ny[1] - ny[0]);
      if (Math.abs(d) < 1e-9) continue;
      const areaOld = Math.abs((ox[1] - ox[0]) * (oy[2] - oy[0]) - (ox[2] - ox[0]) * (oy[1] - oy[0])) / 2;
      const pull = Math.min(0.25, 1.2 / Math.sqrt(Math.max(1e-6, 2 * areaOld)));
      const ti = t / 3;
      const x0 = Math.max(0, Math.floor(Math.min(...nx)) - 2), x1 = Math.min(S - 1, Math.ceil(Math.max(...nx)) + 2);
      const y0 = Math.max(0, Math.floor(Math.min(...ny)) - 2), y1 = Math.min(S - 1, Math.ceil(Math.max(...ny)) + 2);
      for (let py = y0; py <= y1; py++) {
        for (let pxx = x0; pxx <= x1; pxx++) {
          const qx = pxx + 0.5, qy = py + 0.5;
          let a = ((nx[1] - qx) * (ny[2] - qy) - (nx[2] - qx) * (ny[1] - qy)) / d;
          let b = ((nx[2] - qx) * (ny[0] - qy) - (nx[0] - qx) * (ny[2] - qy)) / d;
          let c = 1 - a - b;
          const inside = a >= 0 && b >= 0 && c >= 0;
          if (Math.min(a, b, c) < -0.12) continue;
          const i = py * S + pxx;
          if (got[i] === 2 || (got[i] === 1 && !inside)) continue;
          a = Math.max(0, a); b = Math.max(0, b); c = Math.max(0, c);
          const sum = a + b + c;
          a = (a / sum) * (1 - 3 * pull) + pull; b = (b / sum) * (1 - 3 * pull) + pull; c = 1 - a - b;
          sample((a * ox[0] + b * ox[1] + c * ox[2]) / W, (a * oy[0] + b * oy[1] + c * oy[2]) / H, px);
          let m, ro;
          const hi = value(px[0], px[1], px[2]), lo = Math.min(px[0], px[1], px[2]);
          if (wellT[ti]) {
            px[0] = px[1] = px[2] = 18;
            m = 0;
            ro = 0.8;
          } else {
            const k = keyOfRGB(px[0] / 255, px[1] / 255, px[2] / 255), pale = hi > 150 && hi - lo < 0.15 * hi;
            m = paintT[ti] === 1 || (paintT[ti] === 2 && pale) ? 1 : k;
            const v = m === 1 && k < 0.5 ? meanT[ti] : hi;
            for (let ch = 0; ch < 3; ch++) px[ch] += (v - px[ch]) * m;
            // the paint glossy; the glass and the black trim (dark, grey) glossier still, for the sky's reflections;
            // what is bright grey and isn't paint (the rims, the lamps' chrome) metal
            const chrome = m < 0.5 && hi > 165 && hi - lo < 0.12 * hi;
            ro = m > 0.5 ? 0.26 : chrome ? 0.22 : hi < 70 && hi - lo < 25 ? 0.1 : 0.6;
            metal[i] = chrome ? 0.85 : 0;
          }
          rgb.set(px, i * 3);
          mask[i] = m;
          rough[i] = ro;
          got[i] = inside ? 2 : 1;
        }
      }
    }
  }
  // the paint closed over the pale lines along it (seams, panel edges, the wells' rims that Meshy left pale, a few
  // texels wide): a pale texel touching the paint becomes paint, at its neighbours' brightness, ring by ring
  for (let ring = 0; ring < 6; ring++) {
    const take = [];
    for (let i = 0; i < N; i++) {
      if (got[i] !== 2 || mask[i] >= 0.5) continue;
      const hi = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), lo = Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      if (hi < 140 || hi - lo > 0.18 * hi) continue;
      const x = i % S, y = (i / S) | 0;
      let n = 0, v = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1]) {
        if (j < 0 || mask[j] < 0.5) continue;
        n++;
        v += rgb[j * 3];
      }
      if (n) take.push(i, v / n);
    }
    if (!take.length) break;
    for (let k = 0; k < take.length; k += 2) {
      const i = take[k];
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = take[k + 1];
      mask[i] = 1;
      rough[i] = 0.26;
      metal[i] = 0;
    }
  }
  // the gutters: each empty texel the mean of its filled neighbours', a ring at a time
  for (let ring = 0; ring < 2 * pad + 2; ring++) {
    const fill = [];
    for (let i = 0; i < N; i++) {
      if (got[i]) continue;
      const x = i % S, y = (i / S) | 0;
      let n = 0, r = 0, g = 0, b = 0, m = 0, ro = 0, me = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < S - 1 ? i + 1 : -1, y > 0 ? i - S : -1, y < S - 1 ? i + S : -1]) {
        if (j < 0 || !got[j]) continue;
        n++; r += rgb[j * 3]; g += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; m += mask[j]; ro += rough[j]; me += metal[j];
      }
      if (n) fill.push(i, r / n, g / n, b / n, m / n, ro / n, me / n);
    }
    if (!fill.length) break;
    for (let f = 0; f < fill.length; f += 7) {
      const i = fill[f];
      rgb[i * 3] = fill[f + 1]; rgb[i * 3 + 1] = fill[f + 2]; rgb[i * 3 + 2] = fill[f + 3];
      mask[i] = fill[f + 4];
      rough[i] = fill[f + 5];
      metal[i] = fill[f + 6];
      got[i] = 1;
    }
  }
  const baseOut = Buffer.alloc(N * 3), maskOut = Buffer.alloc(N * 3);
  let painted = 0;
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) baseOut[i * 3 + c] = Math.round(Math.min(255, Math.max(0, rgb[i * 3 + c])));
    maskOut[i * 3] = Math.round(mask[i] * 255);
    maskOut[i * 3 + 1] = Math.round(rough[i] * 255);
    maskOut[i * 3 + 2] = Math.round(metal[i] * 255);
    painted += mask[i];
  }
  const png = await sharp(maskOut, { raw: { width: S, height: S, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  mat.getBaseColorTexture().setImage(await sharp(baseOut, { raw: { width: S, height: S, channels: 3 } }).jpeg({ quality: 86 }).toBuffer()).setMimeType('image/jpeg');
  const tex = doc.createTexture('paint').setImage(png).setMimeType('image/png');
  mat.setMetallicRoughnessTexture(tex).setRoughnessFactor(1).setMetallicFactor(1);
  mat.getMetallicRoughnessTextureInfo().setTexCoord(mat.getBaseColorTextureInfo().getTexCoord());
  console.log(`rebaked into a new ${S} px atlas (padding ${pad} px), ${vertices} vertices; paint ${((100 * painted) / N).toFixed(0)}% of it, mask ${(png.length / 1024).toFixed(0)} KB`);
}

// The painted sheet metal smoothed: Meshy's surfaces are lumpy, and a car's lacquer mirrors every lump. Taubin's
// smoothing (a shrinking step, then a swelling one: the shape keeps its size), a few rounds (more round off the body's
// character lines), over the vertices mostly among paint (`paintT`, one flag per triangle): the glass, trim and lamps
// stay put; then their
// normals are made again from the smoothed faces. Vertices at one place (split along the texture's seams) move as one.
function smoothPaint(prim, paintT, rounds = 5) {
  const P = prim.getAttribute('POSITION').getArray(), IX = prim.getIndices().getArray(), nv = P.length / 3;
  // (one node per place)
  const node = new Int32Array(nv), places = new Map();
  for (let v = 0; v < nv; v++) {
    const key = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
    if (!places.has(key)) places.set(key, places.size);
    node[v] = places.get(key);
  }
  const nn = places.size, pos = new Float64Array(nn * 3), painted = new Uint16Array(nn), around = new Uint16Array(nn);
  for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) pos[node[v] * 3 + c] = P[v * 3 + c];
  const links = Array.from({ length: nn }, () => new Set());
  for (let t = 0; t < IX.length; t += 3) {
    const tri = [node[IX[t]], node[IX[t + 1]], node[IX[t + 2]]];
    for (const a of tri) {
      around[a]++;
      if (paintT[t / 3] === 1) painted[a]++;
      for (const b of tri) if (a !== b) links[a].add(b);
    }
  }
  // (free: at least 70% of its triangles paint, so a stray unpainted sliver in a panel leaves no ridge)
  const free = painted.map((p, a) => (around[a] && p >= 0.7 * around[a] ? 1 : 0));
  const step = (f) => {
    const next = Float64Array.from(pos);
    for (let a = 0; a < nn; a++) {
      if (!free[a] || !links[a].size) continue;
      let x = 0, y = 0, z = 0;
      for (const b of links[a]) { x += pos[b * 3]; y += pos[b * 3 + 1]; z += pos[b * 3 + 2]; }
      const k = links[a].size;
      next[a * 3] += f * (x / k - pos[a * 3]);
      next[a * 3 + 1] += f * (y / k - pos[a * 3 + 1]);
      next[a * 3 + 2] += f * (z / k - pos[a * 3 + 2]);
    }
    pos.set(next);
  };
  for (let i = 0; i < rounds; i++) {
    step(0.5);
    step(-0.53);
  }
  for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) P[v * 3 + c] = pos[node[v] * 3 + c];
  prim.getAttribute('POSITION').setArray(P);
  // the normals about the paint, from the smoothed faces (area-weighted, across the seams)
  const Na = prim.getAttribute('NORMAL');
  if (!Na) return;
  const N = Na.getArray(), acc = new Float64Array(nn * 3);
  for (let t = 0; t < IX.length; t += 3) {
    const [a, b, c] = [node[IX[t]], node[IX[t + 1]], node[IX[t + 2]]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const q of [a, b, c]) for (let k = 0; k < 3; k++) acc[q * 3 + k] += n[k];
  }
  // (every vertex touching paint: a seam between new and old normals showed as a crease)
  let moved = 0;
  for (let v = 0; v < nv; v++) {
    const a = node[v];
    if (!painted[a]) continue;
    const l = Math.hypot(acc[a * 3], acc[a * 3 + 1], acc[a * 3 + 2]);
    if (!l) continue;
    for (let k = 0; k < 3; k++) N[v * 3 + k] = acc[a * 3 + k] / l;
    moved++;
  }
  Na.setArray(N);
  console.log(`paint smoothed: ${moved} of ${nv} vertices, ${rounds} rounds`);
}
