// js/net/remote-cars.ts
// The other players' cars, drawn instanced: one InstancedMesh for each part of the local player's car (body, wheels,
// decals, plates, lamps...), an instance of it for each remote car. They were each a clone of that car, ~10 draws a
// car, so a view of 64 drivers cost ~640 draws, and on an M3 the frame is bound by the CPU's ~12 µs a draw. The parts
// are taken from the local car as it looks (its model, paint and scale: player/controllers/car-looks.ts changes them in
// place) and taken again whenever that look changes; how its wheels stood then is how they stand on every remote car.
import * as THREE from 'three/webgpu';

const CHECK_EVERY = 0.5; // s between the looks at whether the local car changed its parts
const _root = new THREE.Matrix4();
const _car = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

// A drawn mesh of its own (not an instanced or skinned one), by three.js's own flags
function isPlainMesh(o: THREE.Object3D): o is THREE.Mesh {
  return 'isMesh' in o && o.isMesh === true && !('isInstancedMesh' in o) && !('isSkinnedMesh' in o);
}

/** One part of the template car: its instanced mesh, and where it sits in the car's own frame */
interface CarPart {
  mesh: THREE.InstancedMesh;
  local: THREE.Matrix4;
}

class RemoteCarFleet {
  private readonly scene: THREE.Object3D;
  private readonly template: THREE.Object3D;
  private readonly capacity: number;
  private parts: CarPart[] = [];
  private signature = '';
  private sinceCheck = Infinity;
  private count = 0;

  /** `template`: the local player's car (its mesh); `capacity`: the most remote cars drawn */
  constructor(scene: THREE.Object3D, template: THREE.Object3D, capacity: number) {
    this.scene = scene;
    this.template = template;
    this.capacity = capacity;
  }

  /** Before the frame's cars: takes the template's parts again if its look changed (every CHECK_EVERY s at most) */
  begin(dt: number): void {
    this.count = 0;
    this.sinceCheck += dt;
    if (this.sinceCheck < CHECK_EVERY) return;
    this.sinceCheck = 0;
    const signature = this.lookOf();
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild();
    }
  }

  /** A remote car at (x, y, z) m, turned `heading` rad, lying on the ground at `pitch` & `roll` rad */
  add(x: number, y: number, z: number, heading: number, pitch: number, roll: number): void {
    if (this.count >= this.capacity) return;
    _q.setFromEuler(_e.set(pitch, heading, roll, 'YXZ'));
    _car.compose(_p.set(x, y, z), _q, _one);
    for (const part of this.parts) part.mesh.setMatrixAt(this.count, _m.multiplyMatrices(_car, part.local));
    this.count++;
  }

  /** After the frame's cars: as many instances drawn as were added */
  end(): void {
    for (const part of this.parts) {
      part.mesh.count = this.count;
      part.mesh.visible = this.count > 0;
      if (this.count > 0) part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const part of this.parts) {
      part.mesh.removeFromParent();
      part.mesh.dispose();
    }
    this.parts = [];
  }

  // The template's drawn meshes, in the order traverseVisible meets them (its lights left out: dozens of remote
  // headlamps would swamp the clustered lighting)
  private meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.template.traverseVisible((o) => {
      if (isPlainMesh(o)) out.push(o);
    });
    return out;
  }

  // What the remote cars copy of the template: each part's geometry, material and size (the model's scale)
  private lookOf(): string {
    this.template.updateWorldMatrix(true, true);
    return this.meshes().map((m) => `${m.geometry.uuid}:${Array.isArray(m.material) ? 'm' : m.material.uuid}:` +
      m.matrixWorld.getMaxScaleOnAxis().toFixed(3)).join('|');
  }

  private rebuild(): void {
    this.dispose();
    _root.copy(this.template.matrixWorld).invert();
    for (const m of this.meshes()) {
      const mesh = new THREE.InstancedMesh(m.geometry, m.material, this.capacity);
      mesh.name = 'RemoteCars';
      mesh.castShadow = m.castShadow;
      mesh.receiveShadow = m.receiveShadow;
      mesh.renderOrder = m.renderOrder;
      mesh.frustumCulled = false; // (cars all over the view: the parts' bounds would be the whole view anyway)
      mesh.count = 0;
      mesh.visible = false;
      this.scene.add(mesh);
      this.parts.push({ mesh, local: new THREE.Matrix4().multiplyMatrices(_root, m.matrixWorld) });
    }
  }
}

export { RemoteCarFleet };
