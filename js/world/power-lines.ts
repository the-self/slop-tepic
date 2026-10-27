// js/world/power-lines.ts
// The CFE's high-voltage lines (city-geodata.js `powerLines`, OpenStreetMap power=line: the 115 kV lines round the
// valley, the 230 & 400 kV ones over the hills): a steel lattice tower at each of the line's points, turned square to
// it, and the conductors and the shield wire sagging from tower to tower (the CFE's poles & wires down the streets
// are street-details.ts': Tepic maps none of its distribution lines). The towers in the town stop the player. The
// wires are built in CELL m cells, each hidden once it is all beyond the wire material's WIRE_FADE.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { landHeight } from './ground.ts';
import { ISLAND_BOUNDS } from './city-config.ts';
import { createWireMaterial, WIRE_FADE } from '../render/tsl-materials.ts';
import type { Collider } from './buildings.ts';

/** A tower's height (m) to its peak by the line's kV, and the half spans of its arms (m) */
const TOWER: { minKv: number; h: number; arm: number }[] = [
  { minKv: 300, h: 46, arm: 9 },
  { minKv: 200, h: 38, arm: 7.5 },
  { minKv: 0, h: 30, arm: 6 }
];
const towerOf = (kv: number) => TOWER.find((t) => kv >= t.minKv) ?? TOWER[TOWER.length - 1];
const SAG = 0.035; // of a span, the conductors' sag at its middle
const BASE = 3.2; // m: half the tower's footprint at the ground
const CELL = 200; // m: the wires' cells (street-details.ts' for the CFE's)

// A lattice tower h m high: four legs tapering from BASE to 0.6 m at the waist, braced at each level, the waist on up
// to the peak, and two crossarms `arm` m either side (x across the line, z along it, y up)
function towerGeometry(h: number, arm: number) {
  const parts: THREE.BufferGeometry[] = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  // a square beam r thick from a to b
  const beam = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(zAxis, d.normalize());
    parts.push(new THREE.BoxGeometry(r, r, len).applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  };
  const waist = h * 0.72, w = BASE, top = 0.6;
  const at = (y: number) => (y < waist ? w + (top - w) * (y / waist) : top);
  const corners = (y: number) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * at(y), y, sz * at(y)));
  const levels = [0, waist * 0.3, waist * 0.55, waist * 0.78, waist, h * 0.86, h];
  for (let k = 0; k + 1 < levels.length; k++) {
    const lo = corners(levels[k]), hi = corners(levels[k + 1]);
    for (let c = 0; c < 4; c++) {
      beam(lo[c], hi[c], 0.22); // (the legs)
      beam(lo[c], hi[(c + 1) % 4], 0.08); // (the cross bracing)
    }
    for (let c = 0; c < 4; c++) beam(hi[c], hi[(c + 1) % 4], 0.1);
  }
  // the crossarms: the conductors' at the waist and a shorter one above it
  for (const [y, span] of [[waist, arm], [h * 0.86, arm * 0.7]]) {
    beam(new THREE.Vector3(-span, y, 0.5), new THREE.Vector3(span, y, 0.5), 0.18);
    beam(new THREE.Vector3(-span, y, -0.5), new THREE.Vector3(span, y, -0.5), 0.18);
    beam(new THREE.Vector3(-span, y, 0), new THREE.Vector3(-top, y + 2.2, 0), 0.1);
    beam(new THREE.Vector3(span, y, 0), new THREE.Vector3(top, y + 2.2, 0), 0.1);
  }
  return mergeGeometries(parts);
}

// The conductors' attachment points in a tower's frame (x across the line): three phases & the shield wire at the peak
const phases = (h: number, arm: number) => [[-arm, h * 0.72 - 2.2], [arm, h * 0.72 - 2.2], [-arm * 0.7, h * 0.86 - 2.2], [0, h + 0.2]];

/** The lines drawn into `scene`: the colliders of the towers in the detailed box, and update(), which hides the cells
 *  of wire out of sight of the camera at `at` */
function buildPowerLines(scene: THREE.Object3D): { colliders: Collider[]; update(at: { x: number; z: number }): void } {
  const group = new THREE.Group();
  group.name = 'PowerLines';
  const colliders: Collider[] = [];
  const byKind = new Map<(typeof TOWER)[number], THREE.Matrix4[]>();
  // (each cell's ribbons: positions, tangent & half width per vertex, indices; by the cell its span's middle is in)
  const cells = new Map<number, { pos: number[]; wire: number[]; idx: number[] }>();
  const up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), tan = new THREE.Vector3();
  const addWire = (a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number) => {
    const key = Math.floor((a.x + b.x) / 2 / CELL) * 100003 + Math.floor((a.z + b.z) / 2 / CELL);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { pos: [], wire: [], idx: [] }));
    const { pos, wire, idx } = c;
    const segs = Math.max(4, Math.min(12, Math.ceil(a.distanceTo(b) / 30)));
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      p.copy(a).lerp(b, t).addScaledVector(up, -4 * sag * t * (1 - t));
      tan.copy(b).sub(a).addScaledVector(up, -4 * sag * (1 - 2 * t)).normalize();
      for (const w of [r, -r]) {
        pos.push(p.x, p.y, p.z);
        wire.push(tan.x, tan.y, tan.z, w);
      }
      if (s < segs) {
        const v = base + s * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  };
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let towers = 0;
  for (const [kv, flat] of GEO.powerLines) {
    const kind = towerOf(kv);
    const n = flat.length / 2;
    // each tower turned square to the line: its x along the bisector of the spans either side
    const frames: { x: number; y: number; z: number; ax: number; az: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = flat[i * 2], z = flat[i * 2 + 1];
      const px = flat[Math.max(0, i - 1) * 2], pz = flat[Math.max(0, i - 1) * 2 + 1];
      const nx = flat[Math.min(n - 1, i + 1) * 2], nz = flat[Math.min(n - 1, i + 1) * 2 + 1];
      let dx = nx - px, dz = nz - pz;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      const y = landHeight(x, z);
      // (across the line: its x; the tower's local z runs along it)
      frames.push({ x, y, z, ax: dz, az: -dx });
      // (R_y(θ) takes x to (cos θ, -sin θ): onto (dz, -dx), across the line)
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      let list = byKind.get(kind);
      if (!list) byKind.set(kind, (list = []));
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, one));
      towers++;
      if (x > ISLAND_BOUNDS.minX && x < ISLAND_BOUNDS.maxX && z > ISLAND_BOUNDS.minZ && z < ISLAND_BOUNDS.maxZ) {
        colliders.push({ minX: x - BASE, maxX: x + BASE, minZ: z - BASE, maxZ: z + BASE, minY: y, maxY: y + kind.h });
      }
    }
    const att = phases(kind.h, kind.arm);
    for (let i = 0; i + 1 < n; i++) {
      const a = frames[i], b = frames[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1) continue;
      att.forEach(([across, y], k) => {
        addWire(new THREE.Vector3(a.x + a.ax * across, a.y + y, a.z + a.az * across),
          new THREE.Vector3(b.x + b.ax * across, b.y + y, b.z + b.az * across), SAG * L, k === 3 ? 0.012 : 0.02);
      });
    }
  }
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x8d9296, roughness: 0.55, metalness: 0.6 });
  for (const [kind, list] of byKind) {
    const mesh = new THREE.InstancedMesh(towerGeometry(kind.h, kind.arm), steel, list.length);
    list.forEach((m, i) => { mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = 'PowerTowers';
    group.add(mesh);
  }
  // (a cell is in sight while any of it, its spans hundreds of m long reaching out of it, is within WIRE_FADE)
  const wireCells: { mesh: THREE.Mesh; at: THREE.Vector3; reach: number }[] = [];
  const wireMat = createWireMaterial();
  for (const c of cells.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    geo.setAttribute('wire', new THREE.Float32BufferAttribute(c.wire, 4));
    geo.setIndex(c.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(c.idx, 1) : new THREE.Uint16BufferAttribute(c.idx, 1));
    geo.computeBoundingSphere();
    const sphere = geo.boundingSphere;
    if (!sphere) continue;
    sphere.radius += 1; // (the ribbons widen in the vertex shader)
    const mesh = new THREE.Mesh(geo, wireMat);
    mesh.name = 'PowerWires';
    mesh.renderOrder = 2; // (update() hides the far cells after the warm-up frame has compiled them)
    group.add(mesh);
    wireCells.push({ mesh, at: sphere.center, reach: sphere.radius + WIRE_FADE });
  }
  for (const c of wireCells.slice(1)) c.mesh.userData.sharesPipelineWith = wireCells[0].mesh;
  scene.add(group);
  console.info(`[power] ${GEO.powerLines.length} high-voltage lines, ${towers} towers (${colliders.length} in the town), wires in ${wireCells.length} cells`);
  return {
    colliders,
    update(at) {
      for (const c of wireCells) {
        const dx = c.at.x - at.x, dz = c.at.z - at.z;
        c.mesh.visible = dx * dx + dz * dz < c.reach * c.reach;
      }
    }
  };
}

export { buildPowerLines };
