// js/render/sun-shadow.ts
// The sun's two shadow cascades with the far one drawn every other frame. Measured on an M3 at street level
// (2026-10-27): the far cascade (~80-300 m of the view) was ~280 draws and ~2.8 ms of the CPU's frame, more than the
// near one, for shadows a few texels across that hardly move between two frames. On the frames it is skipped it stays
// in the atlas as last drawn, with the shadow matrix it was drawn with, and only the near cascade's tile is cleared and
// drawn again (WebGPU's clear takes the whole atlas: a quad writes the cleared depth into that tile instead).
// Whatever would show the old far cascade out of place draws both again: the camera moving or turning, the sun moving,
// the cascades' depth ranges or the map's size changing.
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { SunShadowNode } from 'three/addons/lights/SunShadowNode.js';
import type { SunLight } from 'three/addons/lights/SunLight.js';

const FAR = 1; // the far cascade's index
const MAX_MOVE = 2; // m the camera may have moved since the far cascade was drawn...
const MAX_TURN = Math.cos(THREE.MathUtils.degToRad(1)); // ...and turned (the cosine of 1°)...
const MAX_SUN_TURN = Math.cos(THREE.MathUtils.degToRad(0.05)); // ...and the sun

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _sun = new THREE.Vector3();

/** The sun's cascaded shadow, the far cascade drawn every other frame (see above) */
class HalfRateSunShadowNode extends SunShadowNode {
  private readonly sun: SunLight;
  private readonly farMatrix = new THREE.Matrix4(); // the far cascade's shadow matrix as last drawn
  private readonly farAt = new THREE.Vector3(); // where the camera was then (m)...
  private readonly farLook = new THREE.Vector3(); // ...the way it looked...
  private readonly farSun = new THREE.Vector3(); // ...where the sun was...
  private farKey = ''; // ...and the depth ranges & map size the cascades were fitted for
  private skipped = true; // (the far cascade was skipped last frame: draw it this one)
  private clearQuad: THREE.QuadMesh | null = null;

  constructor(sun: SunLight) {
    super(sun);
    this.sun = sun;
  }

  override renderShadow(frame: THREE.NodeFrame): void {
    const { renderer, scene, camera } = frame;
    const shadow = this.sun.shadow;
    const atlas = shadow.map;
    if (!renderer || !scene || !camera || !atlas) {
      super.renderShadow(frame);
      return;
    }
    camera.getWorldPosition(_pos);
    camera.getWorldDirection(_dir);
    _sun.setFromMatrixPosition(this.sun.matrixWorld).normalize();
    const near = 'near' in camera && typeof camera.near === 'number' ? camera.near : 0;
    const far = 'far' in camera && typeof camera.far === 'number' ? camera.far : 0;
    const key = `${near},${far},${shadow.camera.far},${shadow.mapSize.x},${shadow.mapSize.y}`;
    if (this.skipped || key !== this.farKey || _pos.distanceToSquared(this.farAt) > MAX_MOVE * MAX_MOVE ||
      _dir.dot(this.farLook) < MAX_TURN || _sun.dot(this.farSun) < MAX_SUN_TURN) {
      super.renderShadow(frame);
      this.farMatrix.copy(shadow.getMatrix(FAR));
      this.farAt.copy(_pos);
      this.farLook.copy(_dir);
      this.farSun.copy(_sun);
      this.farKey = key;
      this.skipped = false;
      return;
    }
    // Only the near cascade: fitted to this frame's view, the far one kept as it was drawn
    shadow.updateMatrices(this.sun, camera);
    shadow.getMatrix(FAR).copy(this.farMatrix);
    const sceneName = scene.name;
    scene.name = `Shadow Map [ ${this.sun.name || `ID: ${String(this.sun.id)}`} ]`;
    renderer.autoClear = false;
    // (the near tile, in the atlas's bottom-up rows: as SunShadowNode lays it)
    const tile = shadow.getViewport(0);
    const w = shadow.mapSize.width, h = shadow.mapSize.height;
    atlas.viewport.set(w * tile.x, atlas.height - h * (tile.y + tile.w), w * tile.z, h * tile.w);
    this.clearQuadFor(renderer).render(renderer);
    renderer.render(scene, shadow.getCamera(0));
    scene.name = sceneName;
    this.skipped = true;
  }

  // A quad writing the cleared depth over the viewport it is drawn in, colour untouched (the shadow pass draws only
  // what casts a shadow)
  private clearQuadFor(renderer: THREE.Renderer): THREE.QuadMesh {
    if (this.clearQuad) return this.clearQuad;
    const material = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
    material.depthFunc = THREE.AlwaysDepth;
    material.depthNode = float(renderer.reversedDepthBuffer ? 0 : 1);
    const quad = new THREE.QuadMesh(material);
    quad.castShadow = true;
    quad.name = 'ShadowTileClear';
    this.clearQuad = quad;
    return quad;
  }
}

/** The SunLight's node with the half-rate far cascade (register it in place of three's SunLightNode) */
class HalfRateSunLightNode extends SunLightNode {
  override setupShadowNode(): SunShadowNode {
    return this.light ? new HalfRateSunShadowNode(this.light) : super.setupShadowNode();
  }
}

export { HalfRateSunLightNode };
