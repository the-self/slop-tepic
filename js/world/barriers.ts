import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { liftAt } from './ground.ts';
import type { Collider } from './buildings.ts';

// js/world/barriers.ts
// The walls & fences OpenStreetMap maps (city-geodata.js `barriers`): the plastered bardas round the lots, the schools
// & the plants, the stone & brick walls, the chain-link fences of the fields, the iron railings, a retaining wall. Each
// stands on the ground along its line in pieces of up to PIECE m (each its own height off the slope); every piece
// stops the player.

/** A kind's height & thickness (m), its colour, and how see-through (a fence's mesh) */
const KINDS: { h: number; t: number; color: number; opacity: number }[] = [
  { h: 2.4, t: 0.18, color: 0xd6cdbb, opacity: 1 }, // a barda
  { h: 1.6, t: 0.4, color: 0x8f887a, opacity: 1 }, // stone or brick
  { h: 1.8, t: 0.05, color: 0x9aa0a3, opacity: 0.35 }, // chain-link & wire
  { h: 1.4, t: 0.06, color: 0x2b2e31, opacity: 0.55 }, // an iron railing
  { h: 1.2, t: 0.35, color: 0xa8a49a, opacity: 1 } // a retaining wall
];
const PIECE = 8; // m: the longest piece of a wall laid level
const SINK = 0.25; // m a piece reaches under the ground at its lower end (the slope, a sidewalk's step)

/** Stands the walls & fences up in `scene`: their colliders */
function buildBarriers(scene: THREE.Object3D): { colliders: Collider[] } {
  const group = new THREE.Group();
  group.name = 'Barriers';
  const colliders: Collider[] = [];
  const byKind: THREE.Matrix4[][] = KINDS.map(() => []);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), size = new THREE.Vector3();
  for (const [kind, pts] of GEO.barriers) {
    const spec = KINDS[kind];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const n = Math.ceil(L / PIECE);
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      // (R_y(θ) takes x to (cos θ, -sin θ): onto the wall's direction)
      const th = Math.atan2(-uz, ux);
      q.setFromAxisAngle(up, th);
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
        const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        const g0 = liftAt(x0, z0), g1 = liftAt(x1, z1);
        const lo = Math.min(g0, g1) - SINK, hi = Math.max(g0, g1) + spec.h;
        const len = L / n + spec.t; // (each piece a little past its ends: the corners close)
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        byKind[kind].push(new THREE.Matrix4().compose(at.set(cx, (lo + hi) / 2, cz), q, size.set(len, hi - lo, spec.t)));
        const hx = len / 2, hz = spec.t / 2 + 0.05;
        const ex = Math.abs(ux) * hx + Math.abs(uz) * hz, ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
        colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: lo, maxY: hi, obb: { cx, cz, hx, hz, cs: Math.cos(th), sn: Math.sin(th) } });
      }
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  KINDS.forEach((spec, kind) => {
    const list = byKind[kind];
    if (!list.length) return;
    const mat = new THREE.MeshStandardNodeMaterial({ color: spec.color, roughness: 0.85, metalness: spec.opacity < 1 ? 0.5 : 0 });
    if (spec.opacity < 1) {
      mat.transparent = true;
      mat.opacity = spec.opacity;
      mat.depthWrite = false;
    }
    const mesh = new THREE.InstancedMesh(unit, mat, list.length);
    list.forEach((m, i) => { mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = spec.opacity === 1;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  scene.add(group);
  console.info(`[barriers] ${GEO.barriers.length} walls & fences, ${colliders.length} pieces`);
  return { colliders };
}

export { buildBarriers };
