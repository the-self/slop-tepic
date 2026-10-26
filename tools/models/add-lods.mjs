// tools/models/add-lods.mjs
// A heavy car file's lighter levels of detail (20k triangles or more), for the game to draw further off (actors/vehicles/car-files.ts, the traffic's
// render.ts): its body and its wheel simplified to about 30% and 10% of their triangles, as meshes of their own in the
// same file ('lod1' & 'lod1_wheel', 'lod2' & 'lod2_wheel'), with the same material. As GTA V does (its cars have four
// or five, by distance), so a car far off costs a tenth of one close by and doesn't jump to the plain body shape all at
// once. Run on a prepared car (tools/models/prepare.mjs or prepare-made.mjs); again on the same file replaces its levels.
//   node tools/models/add-lods.mjs assets/models/cars/<id>.glb [...more]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, normals } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// each level: its share of the triangles, and how far (of the model's size) the simplifier may move the surface
const LEVELS = [['lod1', 0.3, 0.02], ['lod2', 0.1, 0.08]];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // (for 'Prune': loose bits too small for the far level go)
const count = (mesh) => mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);

// The far level of a car painted from a palette (tools/models/prepare-made.mjs): its corners joined by place alone, so
// the seams between its parts' colours don't stop the simplifier, then each triangle one colour (its first corner's
// cell: from 50 m, a border off by a triangle doesn't show)
function byPlace(p, ratio) {
  const P = p.getAttribute('POSITION').getArray(), UV = p.getAttribute('TEXCOORD_0').getArray(), I = p.getIndices().getArray();
  const place = new Map(), first = [], pos = [];
  const id = (v) => {
    const key = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
    if (!place.has(key)) { place.set(key, first.length); first.push(v); pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
    return place.get(key);
  };
  const joined = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = id(I[t]), b = id(I[t + 1]), c = id(I[t + 2]);
    if (a !== b && b !== c && a !== c) joined.push(a, b, c);
  }
  const [kept] = MeshoptSimplifier.simplify(Uint32Array.from(joined), Float32Array.from(pos), 3, Math.max(3, Math.floor((joined.length * ratio) / 3) * 3), 0.2, ['Prune']);
  const outP = new Float32Array(kept.length * 3), outUV = new Float32Array(kept.length * 2);
  for (let k = 0; k < kept.length; k++) {
    outP.set(pos.slice(kept[k] * 3, kept[k] * 3 + 3), k * 3);
    const v = first[kept[k - (k % 3)]];
    outUV.set([UV[v * 2], UV[v * 2 + 1]], k * 2);
  }
  p.getAttribute('POSITION').setArray(outP);
  p.getAttribute('TEXCOORD_0').setArray(outUV);
  p.getIndices().setArray(Uint32Array.from(kept.keys()));
}

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot(), scene = root.listScenes()[0];
  // (the levels a run before made, gone first)
  for (const node of root.listNodes()) if (node.getName().startsWith('lod')) { node.getMesh()?.dispose(); node.dispose(); }
  const body = root.listMeshes().find((m) => m.getExtras()?.wheels), wheel = root.listMeshes().find((m) => m.getName() === 'wheel');
  if (!body) throw new Error(`${file}: no body (the mesh whose extras say where the wheels are)`);
  // (a light car needs none: its whole is what a heavy one's far level is)
  if (count(body) < 20000) { await io.write(file, doc); console.log(`${file.split('/').pop()}: body ${count(body)}, light enough: no levels`); continue; }
  const out = [`${file.split('/').pop()}: body ${count(body)}${wheel ? `, wheel ${count(wheel)}` : ''}`];
  for (const [name, ratio, error] of LEVELS) {
    // simplified in a copy of the file, the result's arrays brought back as new meshes
    const copy = await io.read(file);
    for (const node of copy.getRoot().listNodes()) if (node.getName().startsWith('lod')) { node.getMesh()?.dispose(); node.dispose(); }
    // (its normals dropped first and made again after: the seams where they part stopped the simplifier short)
    for (const mesh of copy.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute('NORMAL', null);
    const palette = (copy.getRoot().listTextures()[0]?.getSize()?.[0] ?? 1024) <= 256;
    if (name === 'lod2' && palette) for (const mesh of copy.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) byPlace(p, ratio);
    else await copy.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    await copy.transform(normals(), weld());
    const cBody = copy.getRoot().listMeshes().find((m) => m.getExtras()?.wheels), cWheel = copy.getRoot().listMeshes().find((m) => m.getName() === 'wheel');
    const buffer = root.listBuffers()[0];
    const bring = (src, label) => {
      const p = src.listPrimitives()[0], mesh = doc.createMesh(label);
      const prim = doc.createPrimitive().setMaterial(body.listPrimitives()[0].getMaterial());
      for (const semantic of p.listSemantics()) {
        const a = p.getAttribute(semantic);
        prim.setAttribute(semantic, doc.createAccessor().setType(a.getType()).setArray(a.getArray().slice()).setBuffer(buffer));
      }
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(p.getIndices().getArray())).setBuffer(buffer));
      mesh.addPrimitive(prim);
      // (where its source stands in the scene: a body's node may be turned)
      const at = root.listNodes().find((n) => n.getMesh() === (src === cBody ? body : wheel));
      scene.addChild(doc.createNode(label).setMesh(mesh).setMatrix(at ? at.getWorldMatrix() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      return count(mesh);
    };
    out.push(`${name} ${bring(cBody, name)}${cWheel ? ` + ${bring(cWheel, `${name}_wheel`)}` : ''}`);
  }
  await io.write(file, doc);
  console.log(out.join(' | '));
}
