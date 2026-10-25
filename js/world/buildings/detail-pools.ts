// js/world/buildings/detail-pools.ts
// The pools of high-detail architectural elements streamed around the camera (detail-streaming.ts): stone cornices,
// cedar water towers, rooftop HVAC units, tinacos, storefront awnings and scaffolding sheds, each one instanced mesh
// sized for the most the streaming radius holds.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  Fn,
  vec2,
  color,
  uv,
  normalWorldGeometry,
  abs,
  fract,
  step,
  smoothstep,
  max,
  min,
  mix,
  length
} from 'three/tsl';

// ============================================================================
// D. QUADTREE-STREAMED HIGH-DETAIL ARCHITECTURAL POOLS (LOD0 around player)
// ============================================================================
const MAX_CORNICES = 7000;
const MAX_WATER_TOWERS = 1400;
const MAX_HVAC = 1600;
const MAX_AWNINGS = 1800;
const MAX_SHEDS = 300;
const MAX_TINACOS = 2400;

/** The pools' meshes (the awnings' with their canvas colours) */
export interface DetailPools {
  corniceInst: THREE.InstancedMesh;
  legsInst: THREE.InstancedMesh;
  barrelInst: THREE.InstancedMesh;
  coneInst: THREE.InstancedMesh;
  hvacInst: THREE.InstancedMesh;
  tinacoInst: THREE.InstancedMesh;
  awningInst: THREE.InstancedMesh;
  awningPalette: THREE.Color[];
}

/** The pools of cornices, water towers, HVAC units, tinacos & awnings, added to `group` */
function createDetailPools(group: THREE.Group, unitBox: THREE.BoxGeometry): DetailPools {

  // 1. Projecting horizontal stone cornices & parapet ledges
  const corniceMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8bca6, roughness: 0.78, metalness: 0.08 });
  const corniceInst = new THREE.InstancedMesh(unitBox, corniceMat, MAX_CORNICES);
  corniceInst.castShadow = true;
  corniceInst.receiveShadow = true;
  corniceInst.frustumCulled = false;
  group.add(corniceInst);

  // 2. 3-part rooftop cedar water towers with steel hoop bands & open 4-leg steel trestle
  const woodMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 });
  woodMat.colorNode = Fn(() => {
    const u = uv();
    const staveSeam = smoothstep(0.08, 0.0, abs(fract(u.x.mul(28.0)).sub(0.5)));
    const staveTone = mix(color(0x8e6343), color(0x5c3e26), staveSeam.mul(0.55));
    const bandY = fract(u.y.mul(5.0));
    const isHoop = smoothstep(0.11, 0.05, abs(bandY.sub(0.5)));
    return mix(staveTone, color(0x1f2328), isHoop);
  })();
  const roofCapMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b4045, roughness: 0.65, metalness: 0.3 });
  const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x262b30, roughness: 0.45, metalness: 0.68 });
  const barrelGeo = new THREE.CylinderGeometry(1.65, 1.75, 3.6, 12);
  const coneGeo = new THREE.ConeGeometry(1.9, 1.5, 12);

  // Open 4-leg structural steel trestle with cross-bracing and top chime deck
  const trestleParts: THREE.BufferGeometry[] = [];
  const legPostGeo = new THREE.BoxGeometry(0.24, 2.75, 0.24);
  const legPositions = [
    [-1.05, 0, -1.05],
    [1.05, 0, -1.05],
    [-1.05, 0, 1.05],
    [1.05, 0, 1.05],
  ];
  for (const [lx, ly, lz] of legPositions) {
    const g = legPostGeo.clone();
    g.rotateZ(lx > 0 ? 0.08 : -0.08);
    g.rotateX(lz > 0 ? -0.08 : 0.08);
    g.translate(lx, ly, lz);
    trestleParts.push(g);
  }
  const deckRingGeo = new THREE.CylinderGeometry(1.88, 1.88, 0.22, 12);
  deckRingGeo.translate(0, 1.22, 0);
  trestleParts.push(deckRingGeo);
  const braceX1 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX1.translate(0, 0.2, -1.02);
  trestleParts.push(braceX1);
  const braceX2 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX2.translate(0, 0.2, 1.02);
  trestleParts.push(braceX2);
  const braceZ1 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ1.translate(-1.02, -0.45, 0);
  trestleParts.push(braceZ1);
  const braceZ2 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ2.translate(1.02, -0.45, 0);
  trestleParts.push(braceZ2);
  const riserPipe = new THREE.CylinderGeometry(0.24, 0.24, 2.6, 8);
  trestleParts.push(riserPipe);
  const legsGeo = mergeGeometries(trestleParts, false);

  const barrelInst = new THREE.InstancedMesh(barrelGeo, woodMat, MAX_WATER_TOWERS);
  const coneInst = new THREE.InstancedMesh(coneGeo, roofCapMat, MAX_WATER_TOWERS);
  const legsInst = new THREE.InstancedMesh(legsGeo, legMat, MAX_WATER_TOWERS);
  barrelInst.castShadow = barrelInst.receiveShadow = true;
  coneInst.castShadow = coneInst.receiveShadow = true;
  legsInst.castShadow = legsInst.receiveShadow = true;
  barrelInst.frustumCulled = coneInst.frustumCulled = legsInst.frustumCulled = false;
  group.add(legsInst, barrelInst, coneInst);

  // 3. Rooftop mechanical penthouses & HVAC chillers with top exhaust fans & side louvers
  const hvacMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0.45 });
  hvacMat.colorNode = Fn(() => {
    const u = uv();
    const isTop = step(0.7, normalWorldGeometry.y);
    const fan1 = length(u.sub(vec2(0.3, 0.5)));
    const fan2 = length(u.sub(vec2(0.7, 0.5)));
    const fanDist = min(fan1, fan2);
    const inFanWell = smoothstep(0.19, 0.17, fanDist);
    const fanRing = smoothstep(0.025, 0.008, abs(fract(fanDist.mul(16.0)).sub(0.5))).mul(inFanWell);
    const topCol = mix(color(0x889098), color(0x1b2026), inFanWell.mul(0.82).sub(fanRing.mul(0.45)));

    const inLouverBox = step(0.12, u.x).mul(step(u.x, 0.88)).mul(step(0.18, u.y)).mul(step(u.y, 0.82));
    const louverSlat = step(0.45, fract(u.y.mul(14.0))).mul(inLouverBox);
    const panelSeam = smoothstep(0.03, 0.0, abs(fract(u.x.mul(3.0)).sub(0.5)));
    const sideCol = mix(color(0x7c848c), color(0x282e36), max(louverSlat.mul(0.72), panelSeam.mul(0.35)));
    return mix(sideCol, topCol, isTop);
  })();
  const hvacInst = new THREE.InstancedMesh(unitBox, hvacMat, MAX_HVAC);
  hvacInst.castShadow = hvacInst.receiveShadow = true;
  hvacInst.frustumCulled = false;
  group.add(hvacInst);

  // 3B. Black polyethylene water tanks (tinacos) on the Mexican houses' flat roofs: ribbed drum, domed lid, a cap
  const tinacoGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.56, 0.6, 1.25, 14).translate(0, 0.625, 0),
    new THREE.SphereGeometry(0.56, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 1.25, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10).translate(0, 1.47, 0),
    new THREE.BoxGeometry(0.9, 0.12, 0.9).translate(0, 0.06, 0)
  ].map((g) => g.toNonIndexed()));
  const tinacoInst = new THREE.InstancedMesh(tinacoGeo, new THREE.MeshStandardNodeMaterial({ color: 0x17181a, roughness: 0.55 }), MAX_TINACOS);
  tinacoInst.castShadow = tinacoInst.receiveShadow = true;
  tinacoInst.frustumCulled = false;
  tinacoInst.count = 0;
  group.add(tinacoInst);

  // 5. Ground-floor retail canvas awnings & illuminated storefront fascia signs
  const awningMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.65 });
  const awningPalette = [
    new THREE.Color(0x9e222e),
    new THREE.Color(0x1f593b),
    new THREE.Color(0x213d68),
    new THREE.Color(0xd9912b),
    new THREE.Color(0x2d2d32)
  ];
  const awningInst = new THREE.InstancedMesh(unitBox, awningMat, MAX_AWNINGS);
  awningInst.castShadow = awningInst.receiveShadow = true;
  awningInst.frustumCulled = false;
  // Pre-initialize instanceColor buffer so dynamic updates work cleanly
  for (let i = 0; i < MAX_AWNINGS; i++) {
    awningInst.setColorAt(i, awningPalette[i % awningPalette.length]);
  }
  group.add(awningInst);
  return { corniceInst, legsInst, barrelInst, coneInst, hvacInst, tinacoInst, awningInst, awningPalette };
}

/** The pool of sidewalk scaffolding sheds, added to `group` (after the sign atlas, as it always was) */
function createShedPool(group: THREE.Group, unitBox: THREE.BoxGeometry) {
  // 6. Sidewalk construction scaffolding sheds
  const shedMat = new THREE.MeshStandardNodeMaterial({ color: 0x214f37, roughness: 0.6, metalness: 0.25 });
  const shedInst = new THREE.InstancedMesh(unitBox, shedMat, MAX_SHEDS);
  shedInst.castShadow = shedInst.receiveShadow = true;
  shedInst.frustumCulled = false;
  group.add(shedInst);
  return shedInst;
}

export { MAX_CORNICES, MAX_WATER_TOWERS, MAX_HVAC, MAX_AWNINGS, MAX_SHEDS, MAX_TINACOS, createDetailPools, createShedPool };
