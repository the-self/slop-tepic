import * as THREE from 'three/webgpu';
import { color, float, mix, positionGeometry, positionWorld, fract, step, smoothstep } from 'three/tsl';
import { GEO } from './city-geodata.js';
import { BLOCKS, blockAt } from './city-config.ts';
import { liftAt } from './ground.ts';
import { hash } from './hash.ts';
import { indexHouses } from './lot-greenery.ts';
import { bardaRuns, GATE_W } from './barda-runs.ts';
import type { ObbCollider } from './cotos.ts';

// js/world/bardas.ts
// Builds Tepic's bardas: the walls OpenStreetMap maps (city-geodata.js `walls`: the ranchos', the schools', the
// lienzos', El Ranchito de Pérez's red one on Paseo de Hamburgo), and round the big open plots where it maps none
// (barda-runs.ts finds where): rendered block 2.5 m over the plot's ground (or as high as mapped) in the plot's paint, a
// darker plinth and a pale coping, cut in pieces of at most PIECE m that step down the slopes as the real ones do, and
// a steel portón (painted grey, its vertical ribs) in the long ones; the few fences in a dark chain-link grey. Walls,
// fences & gates stop the player.

const WALL_H = 2.5; // m over the plot's ground (unless OSM says)
const WALL_T = 0.2; // m: a 15 cm block and its render
const SINK = 0.35; // m the wall's foot goes into the ground (the slope under a piece, the sidewalk's 0.22 m)
const LOT_Y = 0.22; // m: the block's ground over the town's floor (city-grid.ts's sidewalk top)
const PIECE = 6; // m at most per piece
const GATE_H = 2.3;

/** A piece of wall or a gate: centre (m), length along it, yaw (rad, its length along local x), foot (m), paint, height
 *  over the plot's ground and thickness (m) */
interface Piece {
  cx: number;
  cz: number;
  len: number;
  yaw: number;
  y: number;
  paint: number;
  h: number;
  t: number;
}
const OSM_PAINTS = [0xa8382b, 0xf1eee6, 0xe9dcc0, 0xd9a441, 0x9c9a92, 0xc46a4c];
const FENCE = 0x4a4f52;
const NEAR_OSM = 4; // m: no wall of our own this near one OpenStreetMap maps
const OSM_CELL = 25;

/**
 * The bardas into the scene. `keepOpen(x, z)`: ground left open to the street (the car parks & their driveways,
 * car-parks.ts keepsOpen); `claimed(x, z)`: ground walled otherwise (the UAN's grounds, places/uan/), where neither
 * OpenStreetMap's walls nor ours stand. Returns the group and the walls' & gates' colliders
 */
function buildBardas(scene: THREE.Object3D, keepOpen: ((x: number, z: number) => boolean) | null = null,
  claimed: ((x: number, z: number) => boolean) | null = null): { group: THREE.Group; colliders: ObbCollider[] } {
  const group = new THREE.Group();
  group.name = 'Bardas';
  scene.add(group);
  const colliders: ObbCollider[] = [];
  // the blocks walled otherwise (the cotos' houses, cotos.ts) or with no building at all (fields): none here
  const H = GEO.houses, S = GEO.houseStride || 8;
  const built = new Set<number>(), cotos = new Set<number>();
  for (let i = 0; i + 6 < H.length; i += S) {
    const b = blockAt(H[i] / 10, H[i + 1] / 10);
    if (!b) continue;
    built.add(b.id);
    if (H[i + 6] & 32) cotos.add(b.id);
  }
  const skip = new Set(BLOCKS.filter((b) => !built.has(b.id) || cotos.has(b.id)).map((b) => b.id));
  const pieces: Piece[] = [];
  const gates: Piece[] = [];
  const piece = (ax: number, az: number, bx: number, bz: number, paint: number, list: Piece[], h = WALL_H, t = WALL_T) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.2) return;
    const n = Math.ceil(len / PIECE);
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n, x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      // (a little longer than the piece, so the bends close)
      list.push({ cx, cz, len: len / n + t, yaw: Math.atan2(-(z1 - z0), x1 - x0), y: liftAt(cx, cz), paint, h, t });
    }
  };
  // OpenStreetMap's walls & fences, and their segments by OSM_CELL cell (for the walls of our own to keep off)
  const osmCells = new Map<number, number[][]>();
  for (const [kind, height, pts] of GEO.walls) {
    const paint = kind ? FENCE : OSM_PAINTS[Math.floor(hash(pts[0], pts[1], 43) * OSM_PAINTS.length)];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      if (claimed?.((ax + bx) / 2, (az + bz) / 2)) continue;
      piece(ax, az, bx, bz, paint, pieces, height || (kind ? 2.0 : WALL_H), kind ? 0.06 : WALL_T);
      for (let ix = Math.floor((Math.min(ax, bx) - NEAR_OSM) / OSM_CELL); ix <= Math.floor((Math.max(ax, bx) + NEAR_OSM) / OSM_CELL); ix++) {
        for (let iz = Math.floor((Math.min(az, bz) - NEAR_OSM) / OSM_CELL); iz <= Math.floor((Math.max(az, bz) + NEAR_OSM) / OSM_CELL); iz++) {
          const key = ix * 4096 + iz;
          let list = osmCells.get(key);
          if (!list) osmCells.set(key, (list = []));
          list.push([ax, az, bx, bz]);
        }
      }
    }
  }
  const nearOsm = (x: number, z: number) => (osmCells.get(Math.floor(x / OSM_CELL) * 4096 + Math.floor(z / OSM_CELL)) ?? []).some(([ax, az, bx, bz]) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    return Math.hypot(x - ax - dx * t, z - az - dz * t) < NEAR_OSM;
  });
  const osmPieces = pieces.length;

  const walls = indexHouses(H, S);
  const runs = bardaRuns(BLOCKS, walls.wallDistance, {
    keepOpen: (x, z) => nearOsm(x, z) || (keepOpen?.(x, z) ?? false) || (claimed?.(x, z) ?? false), skip, sidewalk: GEO.frame.sidewalk || 2.2
  });
  for (const run of runs) {
    // the wall's face on the property line: its middle half its thickness in
    const pts = run.pts.map((p, i) => ({ x: p.x + run.inward[i].x * WALL_T / 2, z: p.z + run.inward[i].z * WALL_T / 2 }));
    const gate = run.gate >= 0 ? pts[run.gate] : null;
    const inGate = (p: { x: number; z: number }) => !!gate && Math.hypot(p.x - gate.x, p.z - gate.z) < GATE_W / 2;
    // straight stretches between the bends (or the gate), cut in pieces
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (inGate(a) || inGate(b)) { start = i; continue; }
      const last = i === pts.length - 1;
      const next = last ? null : pts[i + 1];
      const s0 = pts[start];
      const turn = next ? Math.atan2(next.z - b.z, next.x - b.x) - Math.atan2(b.z - s0.z, b.x - s0.x) : 0;
      const bend = !next || inGate(next) || Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > 0.05;
      if (bend) {
        piece(s0.x, s0.z, b.x, b.z, run.paint, pieces);
        start = i;
      }
    }
    if (gate) {
      const g = run.gate, a = pts[Math.max(0, g - 1)], b = pts[Math.min(pts.length - 1, g + 1)];
      const ux = b.x - a.x, uz = b.z - a.z, L = Math.hypot(ux, uz) || 1;
      piece(gate.x - (ux / L) * GATE_W / 2, gate.z - (uz / L) * GATE_W / 2, gate.x + (ux / L) * GATE_W / 2, gate.z + (uz / L) * GATE_W / 2, 0x6e7378, gates);
    }
  }
  const obb = (p: Piece, half: number, top: number) => {
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw), hx = p.len / 2;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * half, ez = Math.abs(sn) * hx + Math.abs(cs) * half;
    colliders.push({ minX: p.cx - ex, maxX: p.cx + ex, minZ: p.cz - ez, maxZ: p.cz + ez, minY: p.y, maxY: p.y + top,
      obb: { cx: p.cx, cz: p.cz, hx, hz: half, cs, sn } });
  };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  // (an InstancedMesh of no instances would bind an empty buffer on WebGPU: none is made)
  if (pieces.length) {
    // rendered block in the plot's paint (instance colour), weathered in streaks, a darker plinth, a pale coping (the
    // fences' too: grey on grey). The box spans SINK under the ground to its top, in world space (its height varies)
    const wallMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.93 });
    const streak = fract(positionWorld.x.mul(0.31).add(positionWorld.z.mul(0.47)));
    const up = positionGeometry.y.add(0.5); // 0 at the foot, 1 at the top
    let c = color(0xffffff).mul(smoothstep(0.0, 1.0, streak).mul(0.08).add(0.92));
    c = mix(c, c.mul(0.68), step(up, 0.22));
    wallMat.colorNode = mix(c, color(0xe9e6de), step(0.97, up));
    const inst = new THREE.InstancedMesh(unitBox, wallMat, pieces.length);
    pieces.forEach((p, i) => {
      const height = SINK + LOT_Y + p.h;
      dummy.position.set(p.cx, p.y - SINK + height / 2, p.cz);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(p.len, height, p.t);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, tint.setHex(p.paint));
      obb(p, p.t / 2 + 0.05, LOT_Y + p.h);
    });
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }
  if (gates.length) {
    // the portón: sheet steel in vertical ribs every 10 cm, grey paint, its frame darker
    const gateMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.3 });
    const rib = step(0.5, fract(positionWorld.x.add(positionWorld.z).mul(10.0)));
    gateMat.colorNode = color(0x6e7378).mul(rib.mul(0.12).add(0.88));
    gateMat.roughnessNode = float(0.55);
    const inst = new THREE.InstancedMesh(unitBox, gateMat, gates.length);
    gates.forEach((g, i) => {
      dummy.position.set(g.cx, g.y + LOT_Y + GATE_H / 2 - 0.05, g.cz);
      dummy.rotation.set(0, g.yaw, 0);
      dummy.scale.set(g.len - WALL_T, GATE_H, 0.08);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      obb(g, 0.1, LOT_Y + GATE_H);
    });
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
  }
  console.info(`[bardas] ${GEO.walls.length} walls & fences from OSM (${osmPieces} pieces), ${runs.length} big plots walled ` +
    `(${pieces.length - osmPieces} pieces, ${gates.length} gates)`);
  return { group, colliders };
}

export { buildBardas };
