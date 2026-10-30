// js/net/visuals.ts
// Copies of a model to draw another player's vehicle or the police after it with (net/multiplayer.ts,
// net/remote-police.ts): sharing its geometry and materials, without its lights, and its moving parts found again in
// the copy.
import * as THREE from 'three/webgpu';

// The node at the same child-index path in a clone as `node` is in `root`
export function counterpart(root: THREE.Object3D, clone: THREE.Object3D, node: THREE.Object3D | undefined): THREE.Object3D | undefined {
  const path: number[] = [];
  for (let n: THREE.Object3D | null | undefined = node; n && n !== root; n = n.parent) {
    if (!n.parent) return undefined; // (not under root)
    path.unshift(n.parent.children.indexOf(n));
  }
  let c: THREE.Object3D | undefined = clone;
  for (const i of path) c = c?.children.at(i); // (i ≥ 0: an indexOf of a child that is there)
  return c;
}

// A visual copy of `mesh` sharing its geometry & materials, without its lights (dozens of remote headlamps would swamp
// the clustered light budget), shown whatever its model's own visibility is
export function cloneVisual(mesh: THREE.Object3D): THREE.Object3D {
  const copy = mesh.clone(true);
  copy.visible = true;
  const lights: THREE.Light[] = [];
  copy.traverse((o) => {
    if (o instanceof THREE.Light) lights.push(o);
  });
  for (const l of lights) l.removeFromParent();
  return copy;
}
