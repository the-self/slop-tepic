// js/net/remote-cars.ts
// The other players' cars, drawn instanced: one InstancedMesh for each part of the local player's car (body, wheels,
// decals, plates, lamps...), an instance of it for each remote car. They were each a clone of that car, ~10 draws a
// car, so a view of 64 drivers cost ~640 draws, and on an M3 the frame is bound by the CPU's ~12 µs a draw. The parts
// are taken from the local car as it looks (its model, paint and scale: player/controllers/car-looks.ts changes them in
// place) and taken again whenever that look changes; how its wheels stood then is how they stand on every remote car.
import * as THREE from 'three/webgpu';

const CHECK_EVERY = 0.5; // s between the looks at whether the local car changed its parts
const MAX_REMOTE_CARS = 64; // instances at first: the server's view holds 64 players (VIEW_MAX); more double them
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

/** One part of the template car: its instanced mesh, where it sits in the car's own frame, and the size it had (the
 *  model's scale) */
interface CarPart {
  mesh: THREE.InstancedMesh;
  local: THREE.Matrix4;
  scale: number;
}

class RemoteCarFleet {
  private readonly scene: THREE.Object3D;
  private readonly template: THREE.Object3D;
  private capacity: number;
  private parts: CarPart[] = [];
  private readonly seen: THREE.Mesh[] = []; // (the template's meshes, as last looked at: reused)
  private sinceCheck = Infinity;
  private count = 0;

  /** `template`: the local player's car (its mesh); `capacity`: the remote cars drawn at first (it grows with them) */
  constructor(scene: THREE.Object3D, template: THREE.Object3D, capacity = MAX_REMOTE_CARS) {
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
    if (this.lookChanged()) this.rebuild();
  }

  /** A remote car at (x, y, z) m, turned `heading` rad, lying on the ground at `pitch` & `roll` rad */
  add(x: number, y: number, z: number, heading: number, pitch: number, roll: number): void {
    if (this.count >= this.capacity) {
      // more cars than instances (the server's VIEW_MAX set higher): twice as many from the next frame on
      this.capacity *= 2;
      this.dispose(); // (lookChanged then sees no parts: rebuilt at the next begin)
      this.sinceCheck = Infinity;
      return;
    }
    _q.setFromEuler(_e.set(pitch, heading, roll, 'YXZ'));
    _car.compose(_p.set(x, y, z), _q, _one);
    for (const part of this.parts) part.mesh.setMatrixAt(this.count, _m.multiplyMatrices(_car, part.local));
    this.count++;
  }

  /**
   * Takes the template's parts now and draws one car out of sight (at no size) until clear(): made before the shader
   * precompile (main.ts), the precompile and the warm-up frame build the parts' instanced pipelines, for the view and
   * the shadows, instead of the first remote car to drive into view stalling a frame for them
   */
  prime(): void {
    this.lookChanged();
    this.rebuild();
    this.sinceCheck = 0;
    _m.makeScale(0, 0, 0);
    for (const part of this.parts) {
      part.mesh.setMatrixAt(0, _m);
      part.mesh.count = 1;
      part.mesh.visible = true;
    }
  }

  /** No car drawn (the primed one gone, with no remote players to draw yet) */
  clear(): void {
    this.count = 0;
    this.end();
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
  // headlamps would swamp the clustered lighting), into `seen`
  private look(): THREE.Mesh[] {
    const seen = this.seen;
    seen.length = 0;
    this.template.updateWorldMatrix(true, true);
    this.template.traverseVisible((o) => {
      if (isPlainMesh(o)) seen.push(o);
    });
    return seen;
  }

  // Whether the template's parts are other than the fleet's: their geometry, material or size (the model's scale)
  private lookChanged(): boolean {
    const seen = this.look();
    if (seen.length !== this.parts.length || seen.length === 0) return true;
    for (let i = 0; i < seen.length; i++) {
      const m = seen[i], part = this.parts[i];
      if (m.geometry !== part.mesh.geometry || m.material !== part.mesh.material) return true;
      if (Math.abs(m.matrixWorld.getMaxScaleOnAxis() - part.scale) > 1e-3) return true;
    }
    return false;
  }

  // (from `seen`, as lookChanged just found it)
  private rebuild(): void {
    this.dispose();
    _root.copy(this.template.matrixWorld).invert();
    for (const m of this.seen) {
      const mesh = new THREE.InstancedMesh(m.geometry, m.material, this.capacity);
      mesh.name = 'RemoteCars';
      mesh.castShadow = m.castShadow;
      mesh.receiveShadow = m.receiveShadow;
      mesh.renderOrder = m.renderOrder;
      mesh.frustumCulled = false; // (cars all over the view: the parts' bounds would be the whole view anyway)
      mesh.count = 0;
      mesh.visible = false;
      this.scene.add(mesh);
      this.parts.push({ mesh, local: new THREE.Matrix4().multiplyMatrices(_root, m.matrixWorld), scale: m.matrixWorld.getMaxScaleOnAxis() });
    }
  }
}

export { RemoteCarFleet };
