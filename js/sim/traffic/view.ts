// js/sim/traffic/view.ts
// The camera's view, for drawing and protecting nearby spawn locations: where it is, and whether it could see a spot
import * as THREE from 'three/webgpu';
import type { TrafficState } from './state.ts';
import { hillAt } from './surface.ts';

// The camera's view, for drawing and protecting nearby spawn locations
const viewProjection = new THREE.Matrix4();
function updateView(ts: TrafficState, camera: THREE.Camera | null): void {
  ts.hasView = !!camera;
  if (!camera) return;
  camera.updateMatrixWorld();
  ts.camX = camera.position.x;
  ts.camY = camera.position.y;
  ts.camZ = camera.position.z;
  const me = camera.matrixWorld.elements;
  ts.camFwdX = -me[8];
  ts.camFwdZ = -me[10];
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  ts.frustum.setFromProjectionMatrix(viewProjection);
}
// Could the camera see a sphere of radius r around ground point (x, z) (1 m over the ground, or at height y)? Side
// planes only: the near and far planes depend on depth conventions, and the side planes alone already rule out
// everything behind the camera.
function visible(ts: TrafficState, x: number, z: number, r: number, y = hillAt(ts, x, z) + 1): boolean {
  if (!ts.hasView) return false;
  for (let k = 0; k < 4; k++) {
    const { normal, constant } = ts.frustum.planes[k];
    if (normal.x * x + normal.y * y + normal.z * z + constant < -r) return false;
  }
  return true;
}

export { updateView, visible };
