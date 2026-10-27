// tools/models/prepare-rigged-person.mjs
// A person Meshy rigged (meshy_rig: its own 24-bone skeleton, Hips to the toes) and animated (meshy_rig's walking and
// running, meshy_animate's clips) made one file for the game (js/actors/person-body.ts): the rigged body, simplified,
// its texture a JPEG, and every clip moved onto its bones by name, renamed for what the game plays it for.
//   node tools/models/prepare-rigged-person.mjs <rigged.glb> <out.glb> <name>=<clips.glb>[:<clip in it>]... [--faces 30000] [--texture 2048]
// e.g. walk=walking.glb run=running.glb idle=clips.glb:Idle jump=clips.glb:Regular_Jump
// A clip keeps only its bones' turns and the hips' place (the bones' lengths are the body's own, and a clip's scale
// tracks are all 1); clips made "in place" keep the hips over the feet, as the game moves the body itself.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [inp, out, ...wanted] = plain;
const faces = Number(opt('faces', 30000)), texture = Number(opt('texture', 2048));
if (!inp || !out || !wanted.length) throw new Error('usage: node tools/models/prepare-rigged-person.mjs <rigged.glb> <out.glb> <name>=<clips.glb>[:<clip>]... [--faces 30000] [--texture 2048]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));

// ---- the clips, onto this body's bones ----
for (const a of root.listAnimations()) a.dispose(); // (the rigged file's own: one frame of its rest pose)
const files = new Map();
for (const want of wanted) {
  const [name, src] = want.split('=');
  const [file, clip] = src.split(':');
  if (!files.has(file)) files.set(file, await io.read(file));
  const from = files.get(file).getRoot().listAnimations();
  const anim = clip ? from.find((a) => a.getName() === clip) : from[0];
  if (!anim) throw new Error(`${file}: no clip ${clip ?? ''} (it has ${from.map((a) => a.getName()).join(', ')})`);
  const made = doc.createAnimation(name);
  for (const ch of anim.listChannels()) {
    const bone = ch.getTargetNode()?.getName(), path = ch.getTargetPath();
    if (!bone || path === 'scale' || (path === 'translation' && bone !== 'Hips')) continue;
    const node = nodes.get(bone);
    if (!node) throw new Error(`${file} ${anim.getName()}: no bone ${bone} in ${inp}`);
    const s = ch.getSampler();
    const copy = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput())).setInterpolation(s.getInterpolation());
    made.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
  const len = made.listSamplers()[0].getInput().getMax([])[0];
  console.log(`${name}: ${anim.getName()} from ${file}, ${made.listChannels().length} tracks, ${len.toFixed(2)} s`);
}

// ---- the body: no tangents (no normal map), welded and simplified, its weights kept ----
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const tangent = prim.getAttribute('TANGENT');
if (tangent) prim.setAttribute('TANGENT', null);
await MeshoptSimplifier.ready;
await doc.transform(weld());
const tris = prim.getIndices().getCount() / 3;
simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.min(1, faces / tris), error: 0.0005 });
console.log(`body: ${tris} -> ${prim.getIndices().getCount() / 3} triangles, ${prim.getAttribute('POSITION').getCount()} vertices`);
mesh.setName('person');

// ---- the texture a JPEG, no bigger than --texture; matte (cotton and skin) ----
for (const tex of root.listTextures()) {
  const jpg = await sharp(Buffer.from(tex.getImage())).resize({ width: texture, height: texture, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  tex.setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
}
for (const mat of root.listMaterials()) mat.setMetallicFactor(0).setRoughnessFactor(0.85).setNormalTexture(null).setMetallicRoughnessTexture(null);
await doc.transform(dedup(), prune());
await io.write(out, doc);
