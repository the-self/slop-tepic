import * as THREE from 'three/webgpu';
import { Fn, float, color, positionGeometry, uniform, mod, step, smoothstep, mix, attribute, texture } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIGNAL_TIMING, blockAt, BLOCKS, nearestRoads, onRoadway } from './city-config.ts';
import { cityUniforms, createTreeGrateMaterial, atlasSlotUV } from '../render/tsl-materials.ts';
import { PropBreaker, hideInstance, showInstance } from '../sim/mayhem.ts';
import { createTreeField, treeTrunkColliders, treeFall } from './trees.ts';
import { CfeNetwork, cfePoint, cfeHash } from './cfe-network.ts';
import { mappedTreeSites, clearOfMapped } from './mapped-trees.ts';
import { lampFinder } from './mapped-lamps.ts';
import { lotTrees } from './lot-greenery.ts';
import { campusTrees, inCampus, inCampusBuilding } from './uan-campus.ts';
import { medianTrees } from './medians.ts';
import { parkTreeSites, sidewalkBlocks, parkLampSites, medianRuns, onPitch } from './city-grid.ts';
import { liftAt } from './ground.ts';
import { surfaceY } from './footways.ts';
import { LA_LOMA, laLomaKeepsClear, laLomaWoods } from './la-loma-plan.ts';
import { FORUM } from './forum-plan.ts';
import { hashPos } from './hash.ts';
import { GEO } from './city-geodata.js';
import type { PointXZ, Bounds, CityBlock } from './city-config.ts';
import type { BreakableProp, PropCollider, PropBody, PropLook } from '../sim/mayhem.ts';
import type { TreeSite } from './trees.ts';
import type { CfePole } from './cfe-network.ts';
import type { Collider } from './buildings.ts';
import type { RoadNetwork } from './road-network.ts';
import type { AudioSignalSite } from '../audio/audio-sources.ts';

// js/world/street-details.ts
// Populates the city's streets with street furniture using InstancedMesh:
// - Mast-arm traffic signals at the road network's signalised junctions (addJunctionSignals)
// - Cobra-head streetlights along the curbs and post-top lamps in the centro
// - The CFE's concrete poles down one side of every street (crossarm, insulators, a transformer here and there, a
//   streetlight on the arm) strung with their lines and the cables sagging across to the houses (cfe-network.ts): a
//   car snaps them, the lines coming down and arcing, the run their transformer feeds going dark
// - A few fire hydrants (rare in Tepic), the municipality's green bins, bollards round the plazas' corners, park &
//   street trees, palms down the camellones
// - A post with the two streets' name plates on a corner of every junction (addJunctionSignals: their names are drawn
//   into a small atlas for the junctions near the camera, redrawn as it moves)
// Each prop stands on the ground at its base (ground.ts liftAt: the town's slopes, y = 0 in the flat city). The lamps,
// sign posts, hydrants and bins are the breaker's (sim/mayhem.ts): knocked loose as bodies in Jolt; so, by a car only,
// are the CFE's poles and the trees thin enough to give (trees.ts treeFall).

/** A cobra-head streetlight's light: the luminaire (m), the ground under its pole (g) and where it aims (tx, tz) */
interface CobraLampSite {
  x: number;
  y: number;
  z: number;
  g: number;
  tx: number;
  tz: number;
  /** Knocked over (mayhem.ts): its light is out */
  broken: boolean;
  /** Out for want of power (cfe-network.ts), or flickering off: its light is out */
  dark?: boolean;
  /** How many outages cut it (its lens dark while any does) */
  cuts?: number;
  /** Its lens's instance (and where it stands), swapped for a dark one while it has no power */
  lens?: LampLens;
  /** ...the dark one's slot meanwhile */
  darkSlot?: number;
  /** Its distance this frame, weighted to the ones ahead of the camera (m) */
  _effDist: number;
}

/** A lamp's glowing lens or globe among the instances: its mesh, index and matrix */
interface LampLens {
  mesh: THREE.InstancedMesh;
  index: number;
  matrix: THREE.Matrix4;
  /** a globe's (else a cobra head's lens) */
  globe: boolean;
}

/** A post-top globe's or park lamp's point light: where (m), the ground under it (g), colour, intensity and reach (m) */
interface PointLampSite {
  x: number;
  y: number;
  z: number;
  g: number;
  color: number;
  intensity: number;
  dist: number;
  broken: boolean;
  dark?: boolean;
  cuts?: number;
  lens?: LampLens;
  darkSlot?: number;
  _effDist: number;
}

/** The street furniture the player can knock over (mayhem.ts), with its instances in the meshes below */
interface CobraProp extends BreakableProp {
  kind: 'cobra';
  idx: { pole: number; arm: number; head: number };
}
interface PostProp extends BreakableProp {
  kind: 'post';
  idx: { post: number };
  /** Its globe's light in streetPointSites */
  lightIndex: number;
}
interface HydrantProp extends BreakableProp {
  kind: 'hydrant';
}
interface BinProp extends BreakableProp {
  kind: 'bin';
}
type StreetProp = CobraProp | PostProp | HydrantProp | BinProp;

/** A sidewalk tree: its tree site, the ground under it (g) and its pit */
interface StreetTree extends TreeSite {
  y: number;
  g: number;
  /** false: a bare pit (no grate) */
  grate?: boolean;
  pitRot?: number;
  pitS?: number;
}

/**
 * A street corner's name plates: the post (m, the ground under it g) and each street's [yaw, name]; its collider (the
 * player's), and broken once a vehicle has knocked it loose (mayhem.ts)
 */
interface CornerSign {
  x: number;
  z: number;
  g: number;
  a: [number, string];
  b: [number, string];
  collider: PropCollider;
  broken?: boolean;
}

/**
 * TSL 3-Aspect Traffic Signal Lens Material (red on top, amber, green: the lenses at 0.36, 0, -0.36 in the head)
 * Driven by the shared signal clock and SIGNAL_TIMING (city-config.ts), which js/sim/traffic.ts obeys.
 */
function createTrafficSignalLensMaterial(isAvenueHead: boolean, clock: THREE.UniformNode<'float', number>) {
  const { cycle, avenueAmber, avenueRed, streetAmber } = SIGNAL_TIMING;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const t = mod(clock, cycle);
    // which lens, from its height in the head (not in the world: the heads stand on the ground, at any height)
    const ly = positionGeometry.y;
    const isTopRed = step(0.18, ly);
    const isBottomGreen = float(1.0).sub(step(-0.18, ly));
    const isMidAmber = float(1.0).sub(isTopRed).mul(float(1.0).sub(isBottomGreen));

    // Avenue phase: Green, then Amber from avenueAmber, Red from avenueRed
    // Street phase: Red until avenueRed, then Green, Amber from streetAmber
    const greenActive = isAvenueHead
      ? float(1.0).sub(step(avenueAmber, t))
      : step(avenueRed, t).mul(float(1.0).sub(step(streetAmber, t)));
    const amberActive = isAvenueHead
      ? step(avenueAmber, t).mul(float(1.0).sub(step(avenueRed, t)))
      : step(streetAmber, t);
    const redActive = isAvenueHead
      ? step(avenueRed, t)
      : float(1.0).sub(step(avenueRed, t));

    const activeMask = isTopRed.mul(redActive)
      .add(isMidAmber.mul(amberActive))
      .add(isBottomGreen.mul(greenActive));

    const lensHue = mix(
      mix(color(0x18ff68), color(0xffaa10), isMidAmber),
      color(0xff2424),
      isTopRed
    );
    return mix(color(0x14181e), lensHue.mul(1.35), activeMask);
  })();
  return mat;
}

// keepClear: lots no tree is planted in ({ contains(x, z) }: the halls of the stores you walk into, the car parks)
function buildStreetDetails(scene: THREE.Scene, keepClear: readonly { contains(x: number, z: number): boolean }[] = []) {
  const group = new THREE.Group();
  group.name = 'StreetDetails';

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);

  // Ground footprints of street furniture that traffic and pedestrians must keep clear of
  const footprints: Bounds[] = [];
  const addFootprint = (x: number, z: number, w: number, d: number) => footprints.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

  // Signal clock (seconds), set every frame by app/frame-loop.ts
  const signalClock = uniform(0);

  // Shared materials
  const poleMetalMat = new THREE.MeshStandardNodeMaterial({
    color: 0x3b4046,
    roughness: 0.45,
    metalness: 0.78
  });
  const farolGreenMat = new THREE.MeshStandardNodeMaterial({ color: 0x24402f, roughness: 0.5, metalness: 0.55 });
  const aveSignalLensMat = createTrafficSignalLensMaterial(true, signalClock);
  const streetSignalLensMat = createTrafficSignalLensMaterial(false, signalClock);
  // Cobra-head LED streetlight lens & pedestrian post-top globe: pale diffuser by day, warm white after dusk
  const lampBulbGlow = new THREE.MeshBasicNodeMaterial();
  lampBulbGlow.colorNode = mix(color(0x8f918c), color(0xfff1d6).mul(2.1), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));
  const pedGlobeGlow = new THREE.MeshBasicNodeMaterial();
  pedGlobeGlow.colorNode = mix(color(0xd4d2c8), color(0xffe4b0).mul(1.95), smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow));

  // 12-inch three-section signal head (origin at its centre, y = 5.42): housing, a tunnel visor over each lens
  // and a hanger to the mast arm, lenses on both faces (+-z) so it reads from both approaches; the lens material
  // picks red / amber / green from each lens's height in the head (0.36 / 0 / -0.36)
  const HEAD_W = 0.4;
  const HEAD_H = 1.12;
  const HEAD_D = 0.28;
  const LENS_R = 0.145;
  const LENS_Y = [0.36, 0, -0.36];
  const bothFaces = (geo: THREE.BufferGeometry) => [geo, geo.clone().rotateY(Math.PI)];
  const signalHousingGeo = mergeGeometries([
    new THREE.BoxGeometry(HEAD_W, HEAD_H, HEAD_D),
    new THREE.BoxGeometry(0.07, 0.2, 0.07).translate(0, HEAD_H / 2 + 0.1, 0),
    ...LENS_Y.flatMap((ly) => bothFaces(
      new THREE.CylinderGeometry(LENS_R + 0.03, LENS_R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2).translate(0, ly, HEAD_D / 2 + 0.12)
    ))
  ].map((g) => g.toNonIndexed()));
  const signalLensGeo = mergeGeometries(LENS_Y.flatMap((ly) => bothFaces(new THREE.CircleGeometry(LENS_R, 18).translate(0, ly, HEAD_D / 2 + 0.004))));
  // Cobra-head luminaire on the end of the arm: flattened grey housing, flat lens underneath (70 & 10 triangles: there
  // are ~62k of them, and at 14 x 8 segments they were 13M triangles over the city, ~1M in a street-level view)
  const lampHousingGeo = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.7, 0.2, 0.3);
  const lampLensGeo = new THREE.CircleGeometry(1, 10).rotateX(Math.PI / 2).scale(0.6, 1, 0.24).translate(0, -0.005, 0);
  // The centro's cast-iron farol, painted dark green: a fluted base, a slender shaft, a swan-neck arm curving out over
  // the sidewalk (local +x, turned towards the street) and a bell lantern hanging from it, its glass lit at night
  const SWAN = { x: 0.82, y: 3.62 }; // where the lantern hangs (its glass's centre)
  // (236 triangles: the swan neck's 3.5 cm tube needs no more than 4 sides)
  const pedLampPostGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, 0.85, 8).translate(0, 0.425, 0),
    new THREE.CylinderGeometry(0.065, 0.085, 3.35, 8).translate(0, 2.52, 0),
    new THREE.TorusGeometry(0.42, 0.035, 4, 8, Math.PI * 0.6).rotateZ(Math.PI * 0.2).translate(0.42, 3.95, 0),
    new THREE.SphereGeometry(0.07, 6, 4).translate(0, 4.22, 0),
    new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6).translate(SWAN.x, SWAN.y + 0.43, 0),
    new THREE.ConeGeometry(0.24, 0.2, 8).translate(SWAN.x, SWAN.y + 0.24, 0),
    new THREE.CylinderGeometry(0.06, 0.1, 0.06, 8).translate(SWAN.x, SWAN.y - 0.2, 0)
  ].map((g) => g.toNonIndexed()));
  const pedGlobeGeo = new THREE.CylinderGeometry(0.17, 0.12, 0.34, 12).translate(SWAN.x, SWAN.y, 0);
  // the farol's turn: its arm (local +x) over the street, whose outward normal is (ox, oz)
  const farolYaw = (ox: number, oz: number) => Math.atan2(-oz, ox);

  // =========================================================================
  // 1. POLES, LAMPS & THE PROPS THE PLAYER CAN KNOCK OVER
  // =========================================================================
  const poleMatrices: THREE.Matrix4[] = [];
  const armMatrices: THREE.Matrix4[] = [];
  const audioSignals: AudioSignalSite[] = []; // WALK panels heard by audio-sources.ts (the junction signals have none)
  const lampHeadMatrices: THREE.Matrix4[] = [];
  const pedPostMatrices: THREE.Matrix4[] = [];
  const cobraLampSites: CobraLampSite[] = [];
  const streetPointSites: PointLampSite[] = [];
  const placedPoles: PointXZ[] = [];
  // Street furniture the player can knock over (mayhem.ts): its instances in the meshes below, resolved once built
  const breakables: StreetProp[] = [];

  // On (or within m of) a paved park (city-grid.ts section 7): its own island, tested on its outline (the parks'
  // bounding boxes took in whole colonias round a long diagonal park like the Parque Lineal)
  const isPavedPark = (b: CityBlock | null) => !!b && b.park > 0.6 && !b.rural && !b.median;
  const inPlaza = (x: number, z: number, m = 1.0) =>
    isPavedPark(blockAt(x, z)) || isPavedPark(blockAt(x + m, z)) || isPavedPark(blockAt(x - m, z)) ||
    isPavedPark(blockAt(x, z + m)) || isPavedPark(blockAt(x, z - m));

  // True only when (x, z) and its surrounding pad-meter footprint sit on a real curb island (never in a road or median)
  const isOnCurbIsland = (x: number, z: number, pad = 0.55) => {
    const b = blockAt(x, z);
    if (!b || b.median) return false;
    if (pad <= 0) return true;
    const b1 = blockAt(x - pad, z);
    const b2 = blockAt(x + pad, z);
    const b3 = blockAt(x, z - pad);
    const b4 = blockAt(x, z + pad);
    return !!(b1 && !b1.median && b2 && !b2.median && b3 && !b3.median && b4 && !b4.median);
  };

  // True only when (x, z) is on a non-park, non-median, non-plaza sidewalk with `pad` clearance from all curbs
  const isOnSidewalk = (x: number, z: number, pad = 0.55) => {
    if (!isOnCurbIsland(x, z, pad) || inCampusBuilding(x, z, pad + 0.3)) return false; // (the UAN's run to their curbs)
    const b = blockAt(x, z);
    return !(b && b.park > 0.6) && !inPlaza(x, z, 1.0); // (b: on a curb island)
  };

  // Poles indexed in 8 m cells (a city-wide list scanned per candidate costs seconds with tens of thousands of poles)
  const POLE_CELL = 8;
  const poleCells = new Map<number, PointXZ[]>();
  const poleKey = (ix: number, iz: number) => ix * 1000003 + iz;
  placedPoles.push = (...pts: PointXZ[]) => {
    for (const p of pts) {
      const k = poleKey(Math.floor(p.x / POLE_CELL), Math.floor(p.z / POLE_CELL));
      let list = poleCells.get(k);
      if (!list) poleCells.set(k, (list = []));
      list.push(p);
    }
    return Array.prototype.push.apply(placedPoles, pts);
  };
  const isClearOfPoles = (x: number, z: number, minDist = 6.0) => {
    const md2 = minDist * minDist;
    const r = Math.ceil(minDist / POLE_CELL);
    const ix = Math.floor(x / POLE_CELL), iz = Math.floor(z / POLE_CELL);
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const list = poleCells.get(poleKey(ix + a, iz + b));
        if (!list) continue;
        for (const p of list) {
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < md2) return false;
        }
      }
    }
    return true;
  };

  // A cobra-head streetlight: its pole at (lx, lz) on the sidewalk, its arm out over the street along (outX, outZ)
  function addCobra(lx: number, lz: number, outX: number, outZ: number) {
    const armYaw = Math.atan2(-outZ, outX);
    const headX = lx + outX * 2.6;
    const headZ = lz + outZ * 2.6;
    placedPoles.push({ x: lx, z: lz });
    addFootprint(lx, lz, 0.45, 0.45);
    const g = liftAt(lx, lz); // the whole lamp stands on the ground at its pole
    // (parts: resolved once the meshes are built)
    const cobraProp: CobraProp = { kind: 'cobra', x: lx, z: lz, yaw: armYaw, ground: 0.1 + g, base: g, idx: { pole: poleMatrices.length, arm: armMatrices.length, head: lampHeadMatrices.length }, parts: [] };
    breakables.push(cobraProp);

    // Tall ornamental streetlight pole
    dummy.position.set(lx, 4.3 + g, lz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.12, 8.4, 0.12);
    dummy.updateMatrix();
    poleMatrices.push(dummy.matrix.clone());

    // Upper luminaire bracket arm overhanging the street
    dummy.position.set(lx + outX * 1.15, 8.2 + g, lz + outZ * 1.15);
    dummy.rotation.set(0, armYaw, 0);
    dummy.scale.set(2.3, 0.09, 0.09);
    dummy.updateMatrix();
    armMatrices.push(dummy.matrix.clone());

    // Cobra-head LED luminaire on the end of the arm, lens facing the street
    dummy.position.set(headX, 8.08 + g, headZ);
    dummy.rotation.set(0, armYaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lampHeadMatrices.push(dummy.matrix.clone());
    dummy.rotation.set(0, 0, 0);

    cobraLampSites.push({
      x: headX,
      y: 8.02 + g,
      z: headZ,
      g,
      tx: lx + outX * 3.4,
      tz: lz + outZ * 3.4,
      broken: false,
      _effDist: 0
    });
    cobraProp.light = cobraLampSites[cobraLampSites.length - 1];
  }
  // A cast-iron post-top globe lightpole at (px, pz), its swan neck out towards the street along (outX, outZ)
  function addPostTop(px: number, pz: number, outX: number, outZ: number, intensity: number, dist: number) {
    placedPoles.push({ x: px, z: pz });
    addFootprint(px, pz, 0.4, 0.4);

    const g = liftAt(px, pz);
    const yaw = farolYaw(outX, outZ);
    dummy.position.set(px, 0.18 + g, pz);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    breakables.push({ kind: 'post', x: px, z: pz, yaw, ground: 0.18 + g, base: g, idx: { post: pedPostMatrices.length }, lightIndex: streetPointSites.length, parts: [] });
    pedPostMatrices.push(dummy.matrix.clone());
    streetPointSites.push({
      x: px + outX * SWAN.x,
      y: 0.18 + SWAN.y + g,
      z: pz + outZ * SWAN.x,
      g,
      color: 0xffe0aa,
      intensity,
      dist,
      broken: false,
      _effDist: 0
    });
  }

  // =========================================================================
  // 1b. THE STREET LAMPS OPENSTREETMAP MAPS (highway=street_lamp): each on the sidewalk where it is mapped (or the
  //     nearest spot of one within LAMP_SNAP m), a cobra head with its arm out over the nearest roadway, or a post-top
  //     globe where no roadway is near (in a plaza). Round them (LAMP_REPLACE m) the lamps of sections 2 & 2b, which
  //     guess where the town's lamps are, aren't put up: there the map knows better (mapped-lamps.ts)
  // =========================================================================
  const LAMP_SNAP = 4;
  const nearMappedLamp = lampFinder(GEO.lamps);
  {
    let cobras = 0, posts = 0, off = 0;
    for (let k = 0; k + 1 < GEO.lamps.length; k += 2) {
      const mx = GEO.lamps[k], mz = GEO.lamps[k + 1];
      // where it stands: the mapped point, or the nearest spot on a curb island round it
      let spot: PointXZ | null = isOnCurbIsland(mx, mz, 0.3) ? { x: mx, z: mz } : null;
      for (let r = 0.5; !spot && r <= LAMP_SNAP; r += 0.5) {
        for (let a = 0; a < 16 && !spot; a++) {
          const x = mx + Math.cos((a * Math.PI) / 8) * r, z = mz + Math.sin((a * Math.PI) / 8) * r;
          if (isOnCurbIsland(x, z, 0.3)) spot = { x, z };
        }
      }
      if (!spot || !isClearOfPoles(spot.x, spot.z, 1.5)) { off++; continue; }
      // the nearest roadway: the first step off the island round it
      let out: PointXZ | null = null;
      for (let r = 1; !out && r <= 7; r += 0.5) {
        for (let a = 0; a < 16 && !out; a++) {
          const ox = Math.cos((a * Math.PI) / 8), oz = Math.sin((a * Math.PI) / 8);
          if (!blockAt(spot.x + ox * r, spot.z + oz * r)) out = { x: ox, z: oz };
        }
      }
      if (out) { addCobra(spot.x, spot.z, out.x, out.z); cobras++; }
      else { addPostTop(spot.x, spot.z, 1, 0, 28, 14.0); posts++; }
    }
    console.info(`[streetDetails] ${cobras + posts} of ${GEO.lamps.length / 2} mapped street lamps (${cobras} cobra heads, ${posts} post-top globes), ${off} on no sidewalk`);
  }

  // =========================================================================
  // 2. MID-BLOCK AVENUE & STREET ORNAMENTAL ACORN & COBRA STREETLIGHTS
  //    Placed directly along the true curb edges of every city block (BLOCKS)
  //    and verified with blockAt(x, z) so no pole ever stands in any roadway.
  // =========================================================================
  const allBlocks = BLOCKS;

  for (const b of allBlocks) {
    if (b.poly.length < 3 || b.median || b.park > 0.6) continue;

    const poly = b.poly;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 24) continue;

      const ux = dx / len;
      const uz = dz / len;
      const mx = (p0.x + p1.x) * 0.5;
      const mz = (p0.z + p1.z) * 0.5;

      // Determine inward normal (into the sidewalk block) and outward normal (into the street roadway)
      let inx = -uz;
      let inz = ux;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) {
        inx = uz;
        inz = -ux;
      }
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) continue;
      const outX = -inx;
      const outZ = -inz;
      // Confirm this curb edge fronts an open roadway
      if (blockAt(mx + outX * 2.5, mz + outZ * 2.5)) continue;

      // Every street gets cobra lamps on its longer frontages; the post-top globes stay in the centro
      const isAvenueEdge = len >= 40 && (Math.abs(uz) > 0.5 || Math.hypot(mx, mz) > 650);
      const postTops = Math.hypot(mx, mz) < 650;
      if (isAvenueEdge) {
        const cobraFracs = inx > 0 ? [0.26, 0.72] : [0.32, 0.78];
        for (const f of cobraFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const lx = cx + inx * 1.08;
          const lz = cz + inz * 1.08;
          const headX = lx + outX * 2.6;
          const headZ = lz + outZ * 2.6;
          if (
            !isOnSidewalk(lx, lz, 0.55) ||
            blockAt(cx + outX * 2.5, cz + outZ * 2.5) ||
            blockAt(headX, headZ) ||
            !isClearOfPoles(lx, lz, 6.5) ||
            nearMappedLamp(lx, lz)
          ) {
            continue;
          }
          addCobra(lx, lz, outX, outZ);
        }

        // Cast-iron pedestrian post-top globe lightpoles along avenue sidewalks (with PointLights)
        const pedFracs = !postTops ? [] : len >= 48 ? [0.16, 0.50, 0.84] : [0.24, 0.76];
        for (const f of pedFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.42;
          const pz = cz + inz * 1.42;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.2) ||
            nearMappedLamp(px, pz)
          ) {
            continue;
          }
          addPostTop(px, pz, outX, outZ, 30, 14.5);
        }
      } else if (len >= 36 && postTops) {
        // Cross-street cast-iron pedestrian post-top globe lightpoles along north and south block curbs
        const crossFracs = len >= 115 ? [0.20, 0.40, 0.60, 0.80] : [0.24, 0.50, 0.76];
        for (const f of crossFracs) {
          const cx = p0.x + dx * f;
          const cz = p0.z + dz * f;
          const px = cx + inx * 1.22;
          const pz = cz + inz * 1.22;
          if (
            !isOnSidewalk(px, pz, 0.55) ||
            blockAt(cx + outX * 2.2, cz + outZ * 2.2) ||
            !isClearOfPoles(px, pz, 5.5) ||
            nearMappedLamp(px, pz)
          ) {
            continue;
          }
          addPostTop(px, pz, outX, outZ, 28, 14.0);
        }
      }
    }
  }

  // =========================================================================
  // 2b. THE CFE'S POLES & OVERHEAD WIRES
  //     Tepic's power runs overhead: a concrete pole of the Comisión Federal de Electricidad every ~30 m down one
  //     side of every street (the curb whose outward normal points the same half of the compass, so one of the two
  //     facing curbs), 11 m tall, a crossarm with three insulators carrying the primaries, the secondary and the
  //     phone & cable lines under it, a pole-top transformer on one in five and a streetlight on an arm over the
  //     street. The lines span pole to pole, along each curb and on across the junctions, and the service cables sag
  //     from the poles to the houses on both sides. Local pole frame: x out over the street, z along it, y up.
  // =========================================================================
  const cfePoles: CfePole[] = [];
  const cfeEdges: CfePole[][] = [];
  const CFE_SP = 30;
  const CFE_H = 11;
  for (const b of allBlocks) {
    if (b.poly.length < 3 || b.median || b.park > 0.6 || b.rural) continue;
    const poly = b.poly;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (len < 18) continue;
      const ux = (p1.x - p0.x) / len;
      const uz = (p1.z - p0.z) / len;
      const mx = (p0.x + p1.x) * 0.5;
      const mz = (p0.z + p1.z) * 0.5;
      let inx = -uz;
      let inz = ux;
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b) {
        inx = uz;
        inz = -ux;
      }
      if (blockAt(mx + inx * 1.6, mz + inz * 1.6) !== b || blockAt(mx - inx * 2.5, mz - inz * 2.5)) continue;
      const outX = -inx;
      const outZ = -inz;
      if (outX * 0.8 + outZ * 0.6 <= 0) continue; // the other curb of this street carries them
      const n = Math.floor((len - 12) / CFE_SP) + 1;
      const step = n > 1 ? (len - 12) / (n - 1) : 0;
      const edge: CfePole[] = [];
      for (let k = 0; k < n; k++) {
        const d = n > 1 ? 6 + k * step : len / 2;
        const px = p0.x + ux * d + inx * 0.45;
        const pz = p0.z + uz * d + inz * 0.45;
        if (!isOnSidewalk(px, pz, 0.3) || !isClearOfPoles(px, pz, 2.5)) continue;
        // the far curb across the street (the houses the cables cross to)
        let across = 0;
        for (let sx = 3; sx <= 30; sx += 1.5) {
          if (blockAt(px + outX * sx, pz + outZ * sx)) {
            across = sx;
            break;
          }
        }
        const pole: CfePole = { x: px, z: pz, g: liftAt(px, pz), ux, uz, outX, outZ, across, edge: cfeEdges.length, i: cfePoles.length };
        placedPoles.push({ x: px, z: pz });
        edge.push(pole);
        cfePoles.push(pole);
      }
      cfeEdges.push(edge);
    }
  }
  // (which carry a transformer: one in five)
  const cfeTransformer = cfePoles.map((p) => cfeHash(p, 4.7) < 0.2);
  // Spans: along each curb, and from the end poles on to the nearest pole of another curb straight ahead (within 42 m)
  const cfeSpans: [CfePole, CfePole][] = [];
  {
    const CELL = 21;
    const grid = new Map<number, CfePole[]>();
    const keyOf = (x: number, z: number) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    for (const p of cfePoles) {
      const k = keyOf(p.x, p.z);
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(p);
    }
    const linked = new Set<string>();
    for (const edge of cfeEdges) {
      for (let k = 0; k + 1 < edge.length; k++) cfeSpans.push([edge[k], edge[k + 1]]);
      for (const [end, sign] of edge.length ? ([[edge[edge.length - 1], 1], [edge[0], -1]] as const) : []) {
        let best: CfePole | null = null;
        let bestD = 42;
        for (let a = -2; a <= 2; a++) {
          for (let c = -2; c <= 2; c++) {
            for (const q of grid.get(keyOf(end.x + a * CELL, end.z + c * CELL)) ?? []) {
              if (q.edge === end.edge) continue;
              const dx = q.x - end.x, dz = q.z - end.z;
              const d = Math.hypot(dx, dz);
              if (d < 4 || d >= bestD || (dx * end.ux + dz * end.uz) * sign < d * 0.94) continue;
              best = q;
              bestD = d;
            }
          }
        }
        if (!best) continue;
        const key = `${Math.min(end.i, best.i)}:${Math.max(end.i, best.i)}`;
        if (linked.has(key)) continue;
        linked.add(key);
        cfeSpans.push([end, best]);
      }
    }
  }
  // The streetlight on the arm: a cobra head like the avenues', lit at night from the same pool (section 8); its arm's
  // and head's instances and its light, by pole, go down with it
  const cfeLamps = new Map<number, { arm: number; head: number }>();
  for (const p of cfePoles) {
    if (cfeHash(p, 2.2) < 0.35 || nearMappedLamp(p.x, p.z)) continue; // not every pole carries one (nor round a mapped lamp)
    const yaw = Math.atan2(-p.outZ, p.outX);
    const arm = cfePoint(p, 0.9, 8.1);
    dummy.position.copy(arm);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1.8, 0.08, 0.08);
    dummy.updateMatrix();
    armMatrices.push(dummy.matrix.clone());
    const head = cfePoint(p, 1.85, 8.0);
    dummy.position.copy(head);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    cfeLamps.set(p.i, { arm: armMatrices.length - 1, head: lampHeadMatrices.length });
    lampHeadMatrices.push(dummy.matrix.clone());
    dummy.rotation.set(0, 0, 0);
    cobraLampSites.push({ x: head.x, y: head.y - 0.06, z: head.z, g: p.g, tx: p.x + p.outX * 3.4, tz: p.z + p.outZ * 3.4, broken: false, _effDist: 0 });
  }

  function addMatrixArrayInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], castShadow = true) {
    if (matrices.length === 0) return null;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    if (castShadow && !('isMeshBasicNodeMaterial' in mat) && mat.type !== 'MeshBasicNodeMaterial' && !mat.transparent) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return inst;
  }

  const poleInst = addMatrixArrayInstanced(unitCyl, poleMetalMat, poleMatrices);
  const armInst = addMatrixArrayInstanced(unitBox, poleMetalMat, armMatrices);
  const lampHousingInst = addMatrixArrayInstanced(lampHousingGeo, poleMetalMat, lampHeadMatrices);
  const lampLensInst = addMatrixArrayInstanced(lampLensGeo, lampBulbGlow, lampHeadMatrices, false);
  const pedPostInst = addMatrixArrayInstanced(pedLampPostGeo, farolGreenMat, pedPostMatrices);
  const pedGlobeInst = addMatrixArrayInstanced(pedGlobeGeo, pedGlobeGlow, pedPostMatrices, false);
  // knock-over props hide their instances (mayhem.ts): their meshes keep their own shadows (no static stand-ins)
  for (const m of [poleInst, armInst, lampHousingInst, lampLensInst, pedPostInst, pedGlobeInst]) if (m) m.userData.keepOwnShadow = true;
  for (const b of breakables) {
    const parts: BreakableProp['parts'] = [];
    const add = (mesh: THREE.InstancedMesh | null, index: number) => { if (mesh && index >= 0) parts.push({ mesh, index }); };
    if (b.kind === 'cobra') {
      add(poleInst, b.idx.pole);
      add(armInst, b.idx.arm);
      add(lampHousingInst, b.idx.head);
      add(lampLensInst, b.idx.head);
    } else if (b.kind === 'post') {
      add(pedPostInst, b.idx.post);
      add(pedGlobeInst, b.idx.post);
      b.light = streetPointSites[b.lightIndex];
      if (pedGlobeInst) streetPointSites[b.lightIndex].lens = { mesh: pedGlobeInst, index: b.idx.post, matrix: pedPostMatrices[b.idx.post], globe: true };
    }
    b.parts = parts;
  }
  // (each cobra head's lens: its light is the one pushed with its head)
  if (lampLensInst) cobraLampSites.forEach((s, k) => { s.lens = { mesh: lampLensInst, index: k, matrix: lampHeadMatrices[k], globe: false }; });

  // The CFE poles' meshes: concrete shafts, the galvanised crossarms & racks, porcelain insulators, transformers. Each
  // pole is a prop only a car knocks over (mayhem.ts): its instances, its streetlight's, its collider (which stops
  // walkers) and its stand-in going with it, its lines coming down (cfe-network.ts)
  const cfeColliders: Collider[] = [];
  const cfeProps: BreakableProp[] = [];
  const cfe = new CfeNetwork(scene, group, cfePoles, cfeSpans, cfeTransformer);
  if (cfePoles.length) {
    const shaftGeo = new THREE.CylinderGeometry(0.09, 0.16, CFE_H, 8).translate(0, CFE_H / 2, 0);
    const steelGeo = mergeGeometries([
      new THREE.BoxGeometry(2.3, 0.1, 0.1).translate(0.3, 10.55, 0),
      // the crossarm's braces & the racks of the secondary and the phone line
      new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(-0.3, 10.2, 0).rotateZ(0),
      new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(0.9, 10.2, 0),
      new THREE.BoxGeometry(0.28, 0.32, 0.06).translate(0.14, 9.0, 0),
      new THREE.BoxGeometry(0.22, 0.18, 0.05).translate(0.12, 7.6, 0)
    ].map((g) => g.toNonIndexed()));
    const insulatorGeo = mergeGeometries([-0.7, 0.3, 1.3].map((x) => new THREE.CylinderGeometry(0.045, 0.07, 0.24, 8).translate(x, 10.72, 0).toNonIndexed()));
    const transformerGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.3, 0.3, 0.95, 12).translate(0.42, 9.65, 0),
      new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12).translate(0.42, 10.16, 0),
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6).translate(0.32, 10.27, 0.12),
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6).translate(0.32, 10.27, -0.12)
    ].map((g) => g.toNonIndexed()));
    const concreteMat = new THREE.MeshStandardNodeMaterial({ color: 0x9d998f, roughness: 0.92 });
    const galvMat = new THREE.MeshStandardNodeMaterial({ color: 0x7c8084, roughness: 0.5, metalness: 0.6 });
    const porcelainMat = new THREE.MeshStandardNodeMaterial({ color: 0xcfcabd, roughness: 0.35 });
    const tankMat = new THREE.MeshStandardNodeMaterial({ color: 0x8a9094, roughness: 0.55, metalness: 0.35 });
    const all: THREE.Matrix4[] = [];
    const transformers: THREE.Matrix4[] = [];
    const transformerOf = new Map<number, number>();
    const poleColliders: PropCollider[] = [];
    for (const p of cfePoles) {
      dummy.position.set(p.x, p.g, p.z);
      dummy.rotation.set(0, Math.atan2(-p.outZ, p.outX), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      all.push(dummy.matrix.clone());
      if (cfeTransformer[p.i]) {
        transformerOf.set(p.i, transformers.length);
        transformers.push(dummy.matrix.clone());
      }
      // concrete stops a car (app/city.ts adds these to the player's colliders), till one strikes it hard enough
      const collider: PropCollider = { minX: p.x - 0.17, maxX: p.x + 0.17, minZ: p.z - 0.17, maxZ: p.z + 0.17, minY: p.g, maxY: p.g + CFE_H };
      poleColliders.push(collider);
      cfeColliders.push(collider);
    }
    dummy.rotation.set(0, 0, 0);
    const shaftInst = addMatrixArrayInstanced(shaftGeo, concreteMat, all);
    const steelInst = addMatrixArrayInstanced(steelGeo, galvMat, all);
    const insulatorInst = addMatrixArrayInstanced(insulatorGeo, porcelainMat, all);
    const transformerInst = addMatrixArrayInstanced(transformerGeo, tankMat, transformers);
    for (const m of [shaftInst, steelInst, insulatorInst, transformerInst]) if (m) m.userData.keepOwnShadow = true;
    // the stand-in, in the pole's frame (x out over the street): the pole, and its transformer & its lamp if it has them
    const poleLook: PropLook[] = [
      { geometry: shaftGeo, material: concreteMat },
      { geometry: steelGeo, material: galvMat },
      { geometry: insulatorGeo, material: porcelainMat }
    ];
    const lampLook: PropLook[] = [
      { geometry: unitBox, material: poleMetalMat, matrix: new THREE.Matrix4().makeScale(1.8, 0.08, 0.08).setPosition(0.9, 8.1, 0) },
      { geometry: lampHousingGeo, material: poleMetalMat, matrix: new THREE.Matrix4().makeTranslation(1.85, 8.0, 0) },
      { geometry: lampLensGeo, material: poleMetalMat, matrix: new THREE.Matrix4().makeTranslation(1.85, 8.0, 0) } // (out)
    ];
    const tankLook: PropLook = { geometry: transformerGeo, material: tankMat };
    for (const p of cfePoles) {
      const parts: BreakableProp['parts'] = [];
      const add = (mesh: THREE.InstancedMesh | null, index: number | undefined) => { if (mesh && index !== undefined && index >= 0) parts.push({ mesh, index }); };
      add(shaftInst, p.i);
      add(steelInst, p.i);
      add(insulatorInst, p.i);
      const tank = transformerOf.get(p.i);
      add(transformerInst, tank);
      const lamp = cfeLamps.get(p.i);
      add(armInst, lamp?.arm);
      add(lampHousingInst, lamp?.head);
      add(lampLensInst, lamp?.head);
      const prop: BreakableProp = {
        kind: 'cfe', x: p.x, z: p.z, yaw: Math.atan2(-p.outZ, p.outX), ground: p.g, base: p.g, parts,
        collider: poleColliders[p.i], hard: 1,
        light: lamp ? cobraLampSites[lamp.head] : null,
        look: [...poleLook, ...(tank !== undefined ? [tankLook] : []), ...(lamp ? lampLook : [])],
        onBreak: () => { cfe.fell(p); }
      };
      poleColliders[p.i].prop = prop;
      cfeProps.push(prop);
    }
  }
  console.info(`[cfe] ${cfePoles.length} poles, ${cfeSpans.length} spans in ${cfe.cells.length} cells`);

  // =========================================================================
  // 6. FIRE HYDRANTS ALONG CURBS (INSTANCED)
  // =========================================================================
  // A hydrant near a corner of one block in fourteen, on the sidewalk by the curb (Tepic has few: a New York corner's
  // hydrant on every block read as another city)
  const hydrantPositions: [number, number][] = [];
  {
    let k = 0;
    for (const b of allBlocks) {
      if (b.median || b.park > 0.6 || b.poly.length < 4 || (k++ % 14)) continue;
      const a = b.poly[0], c = b.poly[1];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < 12) continue;
      const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
      let inx = -uz, inz = ux;
      if (blockAt(a.x + ux * 4 + inx * 1.2, a.z + uz * 4 + inz * 1.2) !== b) { inx = uz; inz = -ux; }
      const hx = a.x + ux * 4 + inx * 0.9, hz = a.z + uz * 4 + inz * 0.9;
      if (isOnSidewalk(hx, hz, 0.4) && isClearOfPoles(hx, hz, 1.5)) hydrantPositions.push([hx, hz]);
    }
  }
  const hydrantMat = new THREE.MeshStandardNodeMaterial({ color: 0xb8241e, roughness: 0.5, metalness: 0.4 });
  const hydrantInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.85, 8), hydrantMat, Math.max(1, hydrantPositions.length));
  hydrantPositions.forEach(([hx, hz], i) => {
    dummy.position.set(hx, 0.64 + liftAt(hx, hz), hz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydrantInst.setMatrixAt(i, dummy.matrix);
  });
  hydrantInst.count = hydrantPositions.length;
  hydrantInst.userData.keepOwnShadow = true;
  hydrantInst.instanceMatrix.needsUpdate = true;
  if (hydrantPositions.length) group.add(hydrantInst);
  hydrantPositions.forEach(([hx, hz], i) => breakables.push({ kind: 'hydrant', x: hx, z: hz, yaw: 0, ground: 0.215 + liftAt(hx, hz), base: liftAt(hx, hz), parts: [{ mesh: hydrantInst, index: i }] }));

  // 6b. Bins: the municipality's green steel bins, on the sidewalk a few metres from a block's corner (one block in
  //     nine), standing loose (mayhem.ts knocks them flying)
  const binPositions: [number, number][] = [];
  {
    let k = 0;
    for (const b of allBlocks) {
      if (b.median || b.park > 0.6 || b.poly.length < 4 || (k++ % 9) !== 4) continue;
      const a = b.poly[1], c = b.poly[2];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < 14) continue;
      const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
      let inx = -uz, inz = ux;
      if (blockAt(a.x + ux * 5 + inx * 1.2, a.z + uz * 5 + inz * 1.2) !== b) { inx = uz; inz = -ux; }
      const bx = a.x + ux * 5 + inx * 0.8, bz = a.z + uz * 5 + inz * 0.8;
      if (isOnSidewalk(bx, bz, 0.35) && isClearOfPoles(bx, bz, 1.2)) {
        binPositions.push([bx, bz]);
        placedPoles.push({ x: bx, z: bz });
      }
    }
  }
  // (and the bins OpenStreetMap maps, where they stand)
  for (let k = 0; k + 1 < GEO.bins.length; k += 2) {
    binPositions.push([GEO.bins[k], GEO.bins[k + 1]]);
    placedPoles.push({ x: GEO.bins[k], z: GEO.bins[k + 1] });
  }
  const binMat = new THREE.MeshStandardNodeMaterial({ color: 0x2c5a37, roughness: 0.55, metalness: 0.35 });
  const binLidMat = new THREE.MeshStandardNodeMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.3 });
  const binGeo = new THREE.CylinderGeometry(0.23, 0.2, 0.86, 12, 1, true).translate(0, 0.43, 0);
  const binLidGeo = new THREE.CylinderGeometry(0.245, 0.245, 0.07, 12).translate(0, 0.885, 0);
  const binInst = new THREE.InstancedMesh(binGeo, binMat, Math.max(1, binPositions.length));
  const binLidInst = new THREE.InstancedMesh(binLidGeo, binLidMat, Math.max(1, binPositions.length));
  binPositions.forEach(([bx, bz], i) => {
    dummy.position.set(bx, liftAt(bx, bz), bz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    binInst.setMatrixAt(i, dummy.matrix);
    binLidInst.setMatrixAt(i, dummy.matrix);
    breakables.push({ kind: 'bin', x: bx, z: bz, yaw: 0, ground: liftAt(bx, bz), base: liftAt(bx, bz), parts: [{ mesh: binInst, index: i }, { mesh: binLidInst, index: i }] });
  });
  for (const inst of [binInst, binLidInst]) {
    inst.count = binPositions.length;
    inst.castShadow = true;
    inst.userData.keepOwnShadow = true;
    if (binPositions.length) group.add(inst);
  }

  // 6c. Bollards: short concrete posts round the plazas' corners, three to a corner, keeping cars off the paving
  //     (fixed: what runs into one stops)
  const bollardPositions: [number, number][] = [];
  for (const b of allBlocks) {
    if (!isPavedPark(b) || b.poly.length < 3) continue;
    const n = b.poly.length;
    for (let i = 0; i < n; i++) {
      const v = b.poly[i], prev = b.poly[(i + n - 1) % n], next = b.poly[(i + 1) % n];
      const ax = prev.x - v.x, az = prev.z - v.z, bx = next.x - v.x, bz = next.z - v.z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 6 || lb < 6) continue;
      // (into the plaza between its two edges)
      for (const [t, along] of [[0.5, 0], [0.5, 1.4], [0.5, -1.4]]) {
        const ex = along >= 0 ? bx / lb : ax / la, ez = along >= 0 ? bz / lb : az / la;
        const ox = ax / la + bx / lb, oz = az / la + bz / lb, ol = Math.hypot(ox, oz) || 1;
        const px = v.x + (ox / ol) * t + ex * Math.abs(along), pz = v.z + (oz / ol) * t + ez * Math.abs(along);
        if (blockAt(px, pz) !== b || !isClearOfPoles(px, pz, 0.8) || inCampusBuilding(px, pz, 0.5)) continue;
        bollardPositions.push([px, pz]);
      }
    }
  }
  for (const [px, pz] of bollardPositions) placedPoles.push({ x: px, z: pz });
  const bollardMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a968e, roughness: 0.85, metalness: 0.0 });
  const bollardGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.15, 0.8, 10).translate(0, 0.4, 0),
    new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.8, 0)
  ]);
  const bollardInst = new THREE.InstancedMesh(bollardGeo, bollardMat, Math.max(1, bollardPositions.length));
  bollardPositions.forEach(([px, pz], i) => {
    const g = liftAt(px, pz);
    dummy.position.set(px, g, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bollardInst.setMatrixAt(i, dummy.matrix);
    cfeColliders.push({ minX: px - 0.15, maxX: px + 0.15, minZ: pz - 0.15, maxZ: pz + 0.15, minY: g - 0.6, maxY: g + 0.93 });
  });
  bollardInst.count = bollardPositions.length;
  bollardInst.castShadow = true;
  bollardInst.userData.keepOwnShadow = true;
  if (bollardPositions.length) group.add(bollardInst);

  // =========================================================================
  // 7. TREES: PARKS & PLAZAS, STREET TREES, THE CAMELLONES' PALMS
  //    Tepic's laureles de la India, jacarandas, mangos, tabachines & Washingtonia palms (js/world/trees.ts)
  // =========================================================================
  const treePositions: TreeSite[] = []; // species: 0 laurel, 1 jacaranda, 2 mango, 3 tabachín, 4 palm
  // A sidewalk tree: mostly laureles (clipped), then tabachines, jacarandas & mangos, each planted by the house before it
  const streetSpecies = (r: number) => (r < 0.5 ? 0 : r < 0.7 ? 3 : r < 0.85 ? 1 : 2);

  // A. The parks & the plazas (sites laid out by city-grid.ts)
  for (const s of parkTreeSites ?? []) if (!laLomaKeepsClear(s.x, s.z)) treePositions.push(laLomaWoods(s));
  //    and the Parque La Loma's rows of big laureles along its curb, the ISSSTE's palms (la-loma-plan.ts)
  for (const t of LA_LOMA?.trees ?? []) treePositions.push({ ...t, y: liftAt(t.x, t.z) + surfaceY(t.x, t.z), tier: 0 });

  // B. Street trees on the raised sidewalks of every rectangular block (city-config.ts BLOCKS via the slabs city-grid.ts
  //    laid): along their long w / e fronts, here and there (Tepic's streets are no avenue of planes: a tree where a
  //    neighbour planted one, its trunk painted white with cal), in a bare square pit. Never in plazas or parks.
  const sidewalkTreePositions: StreetTree[] = [];
  const SIDEWALK_Y = 0.22;
  const swBlocks = sidewalkBlocks ?? [];
  const onSidewalk = (x: number, z: number) => {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6) && !b.median;
  };
  // Street trees turn in 90° steps with the crown squeezed across the sidewalk, away from the facades
  function addStreetTree(x: number, z: number, scale: number, species: number, acrossX: boolean, extra: { grate?: boolean; whitewash?: boolean; squeeze?: number } = {}) {
    if (!onSidewalk(x, z) || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.2)) return;
    const q = Math.floor(hashPos(x, 8.8, z) * 3.999);
    const g = liftAt(x, z);
    const t: StreetTree = { x, y: SIDEWALK_Y + g, g, z, scale, species, yaw: q * Math.PI * 0.5, tier: acrossX ? 1 : 2, ...extra };
    if (acrossX === (q % 2 === 0)) t.sx = extra.squeeze || 0.82;
    else t.sz = extra.squeeze || 0.82;
    treePositions.push(t);
    sidewalkTreePositions.push(t);
  }
  const AVE_SP = 17;
  for (const s of swBlocks) {
    const b = s.block;
    if (b.median || b.park > 0.6) continue;
    const x0 = s.cx - s.w * 0.5;
    const x1 = s.cx + s.w * 0.5;
    const z0 = s.cz - s.d * 0.5;
    if (s.d >= 20) {
      const thin = 0.72;
      for (const [x, side] of [[x0 + 1.3, -1], [x1 - 1.3, 1]] as const) {
        const n = Math.floor((s.d - 10) / AVE_SP) + 1;
        const zs = z0 + (s.d - (n - 1) * AVE_SP) * 0.5;
        for (let i = 0; i < n; i++) {
          const tz = zs + i * AVE_SP;
          if (hashPos(x, 3.1, tz) < thin) continue;
          addStreetTree(x, tz, 0.62 + hashPos(tz, 3.1, x) * 0.16, streetSpecies(hashPos(x, side, tz)), true,
            { grate: false, whitewash: hashPos(tz, 6.2, x) < 0.65 });
        }
      }
    }
  }

  // C. The camellones: the long, narrow curb islands between the two roadways of a boulevard (mean width 2 x area /
  //    perimeter under 9 m), planted down their middle every ~11 m with Washingtonia palms, some laureles & tabachines
  for (const b of allBlocks) {
    if (b.rural || b.park > 0.6 || b.poly.length < 3) continue;
    let per = 0;
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      per += Math.hypot(c.x - a.x, c.z - a.z);
    }
    const width = (2 * b.area) / Math.max(per, 1);
    if (width >= 9 || width < 1.8 || per / 2 < 25) continue;
    const SP = 11;
    const planted: TreeSite[] = [];
    for (let i = 0; i < b.poly.length; i++) {
      const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < SP * 0.6) continue;
      const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
      // into the island: the side of the edge its own block lies on
      let inx = -uz, inz = ux;
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      if (blockAt(mx + inx * width * 0.5, mz + inz * width * 0.5) !== b) { inx = uz; inz = -ux; }
      for (let d = SP * 0.5; d < L - 2; d += SP) {
        const x = a.x + ux * d + inx * width * 0.5, z = a.z + uz * d + inz * width * 0.5;
        if (blockAt(x, z) !== b || inPlaza(x, z, 1.5) || !isClearOfPoles(x, z, 2.0)) continue;
        if (planted.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < SP * SP * 0.5)) continue;
        const r = hashPos(x, 9.7, z);
        const species = r < 0.62 ? 4 : r < 0.85 ? 0 : 3;
        const scale = species === 4 ? 0.85 + hashPos(z, 2.7, x) * 0.45 : 0.62 + hashPos(z, 2.7, x) * 0.16;
        const t = { x, y: SIDEWALK_Y + liftAt(x, z), z, scale, species, tier: 1, whitewash: species !== 4 && r < 0.78 };
        planted.push(t);
        treePositions.push(t);
      }
    }
  }
  // D. The yards & vacant lots: the mangos, laureles & tabachines standing over the open ground inside the blocks
  //    (lot-greenery.ts), clear of the walls, thick in the yards & round the lots, sparse out in a field's middle
  //    The Libramiento's camellón has its own rows, either side of the ciclovía (medians.ts)
  const medianBlocks = new Set<CityBlock>();
  for (const run of medianRuns ?? []) {
    for (const p of run) {
      const blk = blockAt(p.x, p.z);
      if (blk) medianBlocks.add(blk);
    }
  }
  // (as the trees' sites, which stand at a height)
  const medianSites: TreeSite[] = medianTrees(medianRuns ?? []);
  for (const t of medianSites) {
    t.y = SIDEWALK_Y + 0.012 + liftAt(t.x, t.z);
    treePositions.push(t);
  }
  // (the UAN's campus planted as its own: uan-campus.ts)
  const yardTrees: TreeSite[] = lotTrees(allBlocks, GEO.houses, { stride: GEO.houseStride || 8, sidewalk: GEO.frame.sidewalk || 2.2, skip: medianBlocks })
    .filter((t) => !inCampus(t.x, t.z))
    .concat(campusTrees());
  for (const t of yardTrees) {
    t.y = SIDEWALK_Y + 0.012 + liftAt(t.x, t.z);
    treePositions.push(t);
  }
  // E. The trees OpenStreetMap maps (mapped-trees.ts), where they are; the ones planted above keep clear of them, and
  //    off the mapped pitches (city-grid.ts onPitch: the yards' & the street rows' guesses know nothing of a field) and
  //    off every roadway the traffic drives (city-config.ts onRoadway: the unnamed drives & alleys among them)
  const mappedTrees = mappedTreeSites(GEO.trees, blockAt, liftAt);
  {
    const kept = new Set(clearOfMapped(treePositions, mappedTrees).filter((t) => !onPitch(t.x, t.z) && !onRoadway(t.x, t.z) && !inCampusBuilding(t.x, t.z, 1.5)));
    const before = treePositions.length;
    const all = treePositions.filter((t) => kept.has(t));
    treePositions.length = 0;
    treePositions.push(...all, ...mappedTrees);
    const streets = sidewalkTreePositions.filter((t) => kept.has(t));
    sidewalkTreePositions.length = 0;
    sidewalkTreePositions.push(...streets);
    console.info(`[streetDetails] ${mappedTrees.length} of ${GEO.trees.length / 3} mapped trees planted (the rest in a roadway), ${before - all.length} of the game's own kept clear of them`);
  }
  console.info(`[streetDetails] ${treePositions.length} trees (${sidewalkTreePositions.length} street trees, ${yardTrees.length} in the yards & lots)`);

  const grateMat = createTreeGrateMaterial();
  const pitCurbMat = new THREE.MeshStandardNodeMaterial({ color: 0x484642, roughness: 0.88 });
  const pitSoilMat = new THREE.MeshStandardNodeMaterial({ color: 0x241c14, roughness: 0.96 });

  // Curbside tree pit surrounds & dark soil beds (the cast-iron grates, t.grate, are New York's: none in Tepic)
  // (pits run along the curb: t.pitRot = PI/2 on cross streets)
  const pitCurbGeo = new THREE.BoxGeometry(1.3, 0.22, 1.3);
  const pitSoilGeo = new THREE.BoxGeometry(1.0, 0.23, 1.0);
  const pitGrateGeo = new THREE.RingGeometry(0.24, 0.82, 12, 1).rotateX(-Math.PI / 2);
  const gratedTrees = sidewalkTreePositions.filter((t) => t.grate !== false);

  const pitCurbInst = new THREE.InstancedMesh(pitCurbGeo, pitCurbMat, sidewalkTreePositions.length);
  const pitSoilInst = new THREE.InstancedMesh(pitSoilGeo, pitSoilMat, sidewalkTreePositions.length);
  const pitGrateInst = new THREE.InstancedMesh(pitGrateGeo, grateMat, Math.max(1, gratedTrees.length));
  pitCurbInst.receiveShadow = true;
  pitSoilInst.receiveShadow = true;
  pitGrateInst.receiveShadow = true;
  pitGrateInst.count = gratedTrees.length;

  sidewalkTreePositions.forEach((t, i) => {
    dummy.rotation.set(0, t.pitRot || 0, 0);
    dummy.scale.set(t.pitS || 1, 1, 1);
    dummy.position.set(t.x, 0.19 + t.g, t.z);
    dummy.updateMatrix();
    pitCurbInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, 0.20 + t.g, t.z);
    dummy.updateMatrix();
    pitSoilInst.setMatrixAt(i, dummy.matrix);
  });
  gratedTrees.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, 0.225 + t.g, t.z);
    dummy.updateMatrix();
    pitGrateInst.setMatrixAt(i, dummy.matrix);
  });
  pitCurbInst.instanceMatrix.needsUpdate = true;
  pitSoilInst.instanceMatrix.needsUpdate = true;
  pitGrateInst.instanceMatrix.needsUpdate = true;
  for (const pit of [pitCurbInst, pitSoilInst, pitGrateInst]) pit.computeBoundingSphere();
  group.add(pitCurbInst, pitSoilInst, pitGrateInst);


  // Procedural trees (js/world/trees.ts): species skeletons with leaf-spray cards, one instanced mesh per species, variant &
  // level of detail, each tree's level following the camera
  // (and the palms on Forum Tepic's sidewalk, forum-plan.ts: inside the mall's lot, kept clear of the others)
  const planted = [...(keepClear.length ? treePositions.filter((t) => !keepClear.some((r) => r.contains(t.x, t.z))) : treePositions),
    ...FORUM.palms.map((t) => ({ ...t, y: liftAt(t.x, t.z) + surfaceY(t.x, t.z), tier: 0 }))];
  const treeField = createTreeField(scene, planted);
  group.add(treeField.group);
  // ...and their trunks stop the player, like the CFE poles (app/city.ts adds both to the player's colliders); those
  // thin enough to give, till a car strikes them hard enough (trees.ts treeFall: a body a size, shared)
  const treeProps: BreakableProp[] = [];
  {
    const bodies = new Map<string, PropBody>();
    treeTrunkColliders(planted).forEach((c: PropCollider, i) => {
      cfeColliders.push(c);
      const t = planted[i];
      const shape = treeField.shapeOf(i);
      const fall = treeFall(t, shape.top, shape.half, shape.yaw, bodies);
      if (!fall) return;
      const ground = t.y ?? 0;
      const prop: BreakableProp = {
        kind: 'tree', x: t.x, z: t.z, yaw: fall.yaw, ground, base: liftAt(t.x, t.z), parts: [], collider: c, def: fall.def, hard: fall.hard,
        standIn: () => treeField.standIn(i),
        onBreak: () => { treeField.fell(i); }
      };
      c.prop = prop;
      treeProps.push(prop);
    });
    console.info(`[streetDetails] ${treeProps.length} of ${planted.length} trees a car can fell, in ${bodies.size} sizes`);
  }

  // =========================================================================
  // 8. CLUSTERED STREETLIGHTS & STREET FURNITURE LIGHT POOLS
  // =========================================================================
  for (const s of parkLampSites ?? []) {
    streetPointSites.push({ x: s.x, y: s.y, z: s.z, g: liftAt(s.x, s.z), color: 0xffe4b4, intensity: 32, dist: 14.0, broken: false, _effDist: 0 });
  }

  const STREETLIGHT_SPOT_POOL = 36;
  const STREET_POINT_POOL = 48;
  const STREETLIGHT_DIST = 115;
  const STREETLIGHT_DIST_SQ = STREETLIGHT_DIST * STREETLIGHT_DIST;
  const STREET_POINT_DIST = 110;
  const STREET_POINT_DIST_SQ = STREET_POINT_DIST * STREET_POINT_DIST;

  const streetLightsGroup = new THREE.Group();
  streetLightsGroup.name = 'StreetClusteredLights';
  scene.add(streetLightsGroup);

  const streetlightSpotPool: THREE.SpotLight[] = [];
  for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
    // Cobra-head LED luminaire: wide downward spread (0.96 rad half-angle) illuminating both road and sidewalk
    const spot = new THREE.SpotLight(0xffe8c2, 0, 25, 0.96, 0.82, 1.25);
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    streetLightsGroup.add(spot, spot.target);
    streetlightSpotPool.push(spot);
  }

  const streetPointPool: THREE.PointLight[] = [];
  for (let i = 0; i < STREET_POINT_POOL; i++) {
    const pt = new THREE.PointLight(0xffe4b4, 0, 12, 1.35);
    pt.position.set(0, -1000, 0);
    streetLightsGroup.add(pt);
    streetPointPool.push(pt);
  }

  const activeCobras: CobraLampSite[] = [];
  const activePoints: PointLampSite[] = [];
  const byEffDist = (a: { _effDist: number }, b: { _effDist: number }) => a._effDist - b._effDist;
  // The lamps in SITE_CELL m cells, for the few cells round the camera each night frame instead of every lamp in the
  // city (tens of thousands: ~1 ms a frame on an M3). Built the first night frame, again if lamps were added since;
  // the arcs' flash, which moves, is looked at on its own
  const SITE_CELL = 64;
  const siteKey = (ix: number, iz: number) => ix * 100003 + iz;
  const cobraCells = new Map<number, CobraLampSite[]>(), pointCells = new Map<number, PointLampSite[]>();
  let cellsOf = { cobras: -1, points: -1 }; // (the lists' lengths they were built from)
  function fillCells<T extends { x: number; z: number }>(cells: Map<number, T[]>, sites: readonly T[], skip?: T) {
    cells.clear();
    for (const site of sites) {
      if (site === skip) continue;
      const k = siteKey(Math.floor(site.x / SITE_CELL), Math.floor(site.z / SITE_CELL));
      let cell = cells.get(k);
      if (!cell) cells.set(k, (cell = []));
      cell.push(site);
    }
  }
  // The lamps whose lenses are dark (darkOn): one knocked over takes its dark lens with it, wherever the camera is
  const darkSites = new Set<CobraLampSite | PointLampSite>();

  function smoothFade(d: number, start: number, end: number) {
    const t = Math.min(1, Math.max(0, (end - d) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  // Globe s among the lights the camera at (cx, cy, cz), looking along (fwdX, fwdZ), may light, as the count-th: the count after
  function considerPoint(s: PointLampSite, cx: number, cy: number, cz: number, fwdX: number, fwdZ: number, count: number) {
    if (s.broken || s.dark) return count;
    const dx = s.x - cx;
    const dy = s.g - cy;
    const dz = s.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > STREET_POINT_DIST_SQ) return count;
    const d = Math.sqrt(d2);
    const forwardDot = dx * fwdX + dz * fwdZ;
    const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
    if (effDist >= STREET_POINT_DIST) return count;
    s._effDist = effDist;
    activePoints[count] = s;
    return count + 1;
  }

  let cornerSigns: { update(at: PointXZ): void } | null = null; // (built by addJunctionSignals once the road network is known)
  function update(camera: THREE.Camera | null) {
    if (!camera) return;
    if (cornerSigns) cornerSigns.update(camera.position);
    const glow = cityUniforms.uInteriorGlow.value;
    // Streetlights fade in smoothly as dusk approaches (matching lampBulbGlow smoothstep(0.4, 1.1, uInteriorGlow))
    const lampScale = Math.min(1.25, Math.max(0.0, (glow - 0.36) * 1.15));
    if (lampScale <= 0.001) {
      for (let i = 0; i < STREETLIGHT_SPOT_POOL; i++) {
        streetlightSpotPool[i].intensity = 0;
        streetlightSpotPool[i].position.set(0, -1000, 0);
      }
      for (let i = 0; i < STREET_POINT_POOL; i++) {
        streetPointPool[i].intensity = 0;
        streetPointPool[i].position.set(0, -1000, 0);
      }
      return;
    }

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const me = camera.matrixWorld.elements;
    const fwdX = -me[8];
    const fwdZ = -me[10];

    if (cellsOf.cobras !== cobraLampSites.length || cellsOf.points !== streetPointSites.length) {
      fillCells(cobraCells, cobraLampSites);
      fillCells(pointCells, streetPointSites, flashSite);
      cellsOf = { cobras: cobraLampSites.length, points: streetPointSites.length };
    }
    for (const s of darkSites) if (s.broken) darkOff(s); // (knocked over without power: its dark lens goes with it)
    const ix0 = Math.floor((cx - STREETLIGHT_DIST) / SITE_CELL), ix1 = Math.floor((cx + STREETLIGHT_DIST) / SITE_CELL);
    const iz0 = Math.floor((cz - STREETLIGHT_DIST) / SITE_CELL), iz1 = Math.floor((cz + STREETLIGHT_DIST) / SITE_CELL);

    let cobraCount = 0;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const cell = cobraCells.get(siteKey(ix, iz));
      if (!cell) continue;
      for (const s of cell) {
        if (s.broken || s.dark) continue;
        const dx = s.x - cx;
        const dy = s.g - cy; // from the lamp's foot (the town's slopes put it well over y = 0)
        const dz = s.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > STREETLIGHT_DIST_SQ) continue;
        const d = Math.sqrt(d2);
        const forwardDot = dx * fwdX + dz * fwdZ;
        const effDist = d + Math.max(0, 6.0 - forwardDot) * 2.8;
        if (effDist >= STREETLIGHT_DIST) continue;
        s._effDist = effDist;
        activeCobras[cobraCount++] = s;
      }
    }
    activeCobras.length = cobraCount;
    if (cobraCount > 1) activeCobras.sort(byEffDist);

    const cobraCutoff = cobraCount > STREETLIGHT_SPOT_POOL
      ? Math.min(STREETLIGHT_DIST, activeCobras[STREETLIGHT_SPOT_POOL]._effDist)
      : STREETLIGHT_DIST;
    const spotUsed = Math.min(cobraCount, STREETLIGHT_SPOT_POOL);
    for (let i = 0; i < spotUsed; i++) {
      const s = activeCobras[i];
      const fade = smoothFade(s._effDist, cobraCutoff * 0.62, cobraCutoff);
      const spot = streetlightSpotPool[i];
      spot.position.set(s.x, s.y, s.z);
      spot.target.position.set(s.tx, s.g, s.tz);
      spot.target.updateMatrixWorld();
      spot.intensity = 88.0 * lampScale * fade;
    }
    for (let i = spotUsed; i < STREETLIGHT_SPOT_POOL; i++) {
      streetlightSpotPool[i].intensity = 0;
      streetlightSpotPool[i].position.set(0, -1000, 0);
    }

    // (STREET_POINT_DIST is within STREETLIGHT_DIST: the same cells)
    let ptCount = 0;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const cell = pointCells.get(siteKey(ix, iz));
      if (cell) for (const s of cell) ptCount = considerPoint(s, cx, cy, cz, fwdX, fwdZ, ptCount);
    }
    ptCount = considerPoint(flashSite, cx, cy, cz, fwdX, fwdZ, ptCount);
    activePoints.length = ptCount;
    if (ptCount > 1) activePoints.sort(byEffDist);

    const ptCutoff = ptCount > STREET_POINT_POOL
      ? Math.min(STREET_POINT_DIST, activePoints[STREET_POINT_POOL]._effDist)
      : STREET_POINT_DIST;
    const ptUsed = Math.min(ptCount, STREET_POINT_POOL);
    for (let i = 0; i < ptUsed; i++) {
      const s = activePoints[i];
      const fade = smoothFade(s._effDist, ptCutoff * 0.62, ptCutoff);
      const pt = streetPointPool[i];
      pt.color.setHex(s.color);
      pt.position.set(s.x, s.y, s.z);
      pt.distance = s.dist;
      pt.intensity = s.intensity * lampScale * fade;
    }
    for (let i = ptUsed; i < STREET_POINT_POOL; i++) {
      streetPointPool[i].intensity = 0;
      streetPointPool[i].position.set(0, -1000, 0);
    }
  }

  scene.add(group);
  // Knock-over stand-ins, in each prop's own frame (base at the origin, +x towards the street)
  const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  const breaker = new PropBreaker(scene, breakables.filter((b) => b.parts.length > 0), {
    cobra: [
      { geometry: unitCyl, material: poleMetalMat, matrix: at(0, 4.2, 0, 0.12, 8.4, 0.12) },
      { geometry: unitBox, material: poleMetalMat, matrix: at(1.15, 8.1, 0, 2.3, 0.09, 0.09) },
      { geometry: lampHousingGeo, material: poleMetalMat, matrix: at(2.6, 7.98, 0) },
      { geometry: lampLensGeo, material: lampBulbGlow, matrix: at(2.6, 7.98, 0) }
    ],
    post: [
      { geometry: pedLampPostGeo, material: farolGreenMat },
      { geometry: pedGlobeGeo, material: pedGlobeGlow }
    ],
    hydrant: [{ geometry: hydrantInst.geometry, material: hydrantMat, matrix: at(0, 0.425, 0) }],
    bin: [{ geometry: binGeo, material: binMat }, { geometry: binLidGeo, material: binLidMat }]
  });
  breaker.addProps(cfeProps);
  breaker.addProps(treeProps);

  // =========================================================================
  // 8b. THE POWER CUT: the streetlights along a run without power (cfe-network.ts) go out, flickering first; once out
  //     for good their lenses & globes are swapped for dark ones. The arcs' flash borrows a light of the pool.
  // =========================================================================
  const LAMP_OUT_REACH = 10; // m from the poles' line: the lamps on them and on the curb across a narrow street
  const LAMP_GRID = 32; // m: the cells the lamps are found by
  type LampSite = CobraLampSite | PointLampSite;
  const darkLens = (geo: THREE.BufferGeometry, capacity: number) => {
    const mesh = new THREE.InstancedMesh(geo, poleMetalMat, Math.max(1, capacity));
    mesh.name = 'DarkLamps';
    mesh.count = 0;
    group.add(mesh);
    const free: number[] = []; // (the slots of lamps whose power came back, for the next to go out)
    return { mesh, free };
  };
  const darkLenses = darkLens(lampLensGeo, lampHeadMatrices.length);
  const darkGlobes = darkLens(pedGlobeGeo, pedPostMatrices.length);
  // Lamp s's glowing lens swapped for a dark one, and back (its dark slot freed)
  function darkOn(s: LampSite) {
    const lens = s.lens;
    if (!lens || s.darkSlot !== undefined) return;
    const dark = lens.globe ? darkGlobes : darkLenses;
    const slot = dark.free.pop() ?? (dark.mesh.count < dark.mesh.instanceMatrix.count ? dark.mesh.count++ : -1);
    if (slot < 0) return;
    hideInstance(lens.mesh, lens.index);
    darkSites.add(s);
    dark.mesh.setMatrixAt(slot, lens.matrix);
    dark.mesh.instanceMatrix.needsUpdate = true;
    dark.mesh.computeBoundingSphere();
    s.darkSlot = slot;
  }
  function darkOff(s: LampSite) {
    const lens = s.lens, slot = s.darkSlot;
    if (!lens || slot === undefined) return;
    const dark = lens.globe ? darkGlobes : darkLenses;
    hideInstance(dark.mesh, slot);
    dark.free.push(slot);
    s.darkSlot = undefined;
    darkSites.delete(s);
    if (!s.broken) showInstance(lens.mesh, lens.index, lens.matrix);
  }
  // The lamps in LAMP_GRID m cells (built the first time the power goes), and those along each outage's stretches
  let lampCells: Map<number, LampSite[]> | null = null;
  const lampKey = (ix: number, iz: number) => ix * 100003 + iz;
  const lampsAlong = new WeakMap<readonly number[], LampSite[]>();
  function lampsNear(segs: readonly number[]) {
    if (!lampCells) {
      lampCells = new Map();
      for (const s of [...cobraLampSites, ...streetPointSites]) {
        if (s === flashSite) continue;
        const k = lampKey(Math.floor(s.x / LAMP_GRID), Math.floor(s.z / LAMP_GRID));
        let cell = lampCells.get(k);
        if (!cell) lampCells.set(k, (cell = []));
        cell.push(s);
      }
    }
    const found = new Set<LampSite>();
    for (let k = 0; k + 3 < segs.length; k += 4) {
      const ax = segs[k], az = segs[k + 1], bx = segs[k + 2] - ax, bz = segs[k + 3] - az;
      const len2 = Math.max(1e-6, bx * bx + bz * bz);
      const x0 = Math.floor((Math.min(ax, ax + bx) - LAMP_OUT_REACH) / LAMP_GRID), x1 = Math.floor((Math.max(ax, ax + bx) + LAMP_OUT_REACH) / LAMP_GRID);
      const z0 = Math.floor((Math.min(az, az + bz) - LAMP_OUT_REACH) / LAMP_GRID), z1 = Math.floor((Math.max(az, az + bz) + LAMP_OUT_REACH) / LAMP_GRID);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          for (const s of lampCells.get(lampKey(ix, iz)) ?? []) {
            const t = Math.max(0, Math.min(1, ((s.x - ax) * bx + (s.z - az) * bz) / len2));
            if (Math.hypot(s.x - ax - bx * t, s.z - az - bz * t) < LAMP_OUT_REACH) found.add(s);
          }
        }
      }
    }
    return [...found];
  }
  cfe.lampsOut = (segs, change) => {
    let lamps = lampsAlong.get(segs);
    if (!lamps) lampsAlong.set(segs, (lamps = lampsNear(segs)));
    for (const s of lamps) {
      const cuts = s.cuts ?? 0;
      if (change === 'off' || change === 'on') {
        if (!cuts) s.dark = change === 'off'; // (a lamp already out for another outage stays out)
        continue;
      }
      s.cuts = Math.max(0, cuts + (change === 'cut' ? 1 : -1));
      s.dark = s.cuts > 0;
      if (s.dark && !s.broken) darkOn(s);
      else if (!s.dark) darkOff(s);
    }
  };
  const flashSite: PointLampSite = { x: 0, y: -1000, z: 0, g: -1000, color: 0xc4d8ff, intensity: 0, dist: 26, broken: true, _effDist: 0 };
  streetPointSites.push(flashSite);
  cfe.sparks.flash = flashSite;

  /**
   * Mexican mast-arm traffic signals at the road network's signalised junctions (built once the network exists, see
   * app/city.ts): on each approach a black pole at the right-hand curb, an arm over the lanes, a black three-light head
   * over them facing the traffic (lit with that road's phase, like the grid's heads at the same height) and a green
   * blade with the name of the street crossing it. Each pole's collider goes into `colliders` (the player's).
   */
  function addJunctionSignals(network: RoadNetwork | null, colliders: Collider[] | null = null) {
    if (!network) return 0;
    const housingMat = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
    const mastMat = new THREE.MeshStandardNodeMaterial({ color: 0x2e3236, roughness: 0.45, metalness: 0.6 });
    const poles: THREE.Matrix4[] = [], arms: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = [], aveLenses: THREE.Matrix4[] = [], stLenses: THREE.Matrix4[] = [];
    const blades: { m: THREE.Matrix4; slot: number }[] = [];
    const names: string[] = [];
    const nameSlot = new Map<string, number>();
    const slotOf = (name: string) => {
      let slot = nameSlot.get(name);
      if (slot === undefined) { nameSlot.set(name, (slot = names.length)); names.push(name); }
      return slot;
    };
    const roadName = (x: number, z: number) => {
      const r = nearestRoads(x, z, 12).find((q) => q.road.name);
      return r ? r.road.name : '';
    };
    for (const n of network.nodes) {
      if (!n.signal) continue;
      for (const e of n.in) {
        if (!e.lanes.length) continue;
        const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len; // its stop line, on the centreline
        let off = e.half + 1.1;
        let px = ex + e.rx * off, pz = ez + e.rz * off;
        if (!isOnCurbIsland(px, pz, 0.3)) {
          off = e.half + 1.7;
          px = ex + e.rx * off;
          pz = ez + e.rz * off;
          if (!isOnCurbIsland(px, pz, 0.3)) continue;
        }
        const mid = e.lanes.reduce((t, o) => t + o, 0) / e.lanes.length; // over the middle of its lanes
        const reach = off - mid;
        if (reach < 1.5) continue;
        placedPoles.push({ x: px, z: pz });
        const g = liftAt(px, pz); // pole, arm, head & blade on the ground at the pole
        colliders?.push({ minX: px - 0.2, maxX: px + 0.2, minZ: pz - 0.2, maxZ: pz + 0.2, minY: g, maxY: 6.6 + g });
        const yaw = Math.atan2(e.dx, e.dz);
        const armYaw = Math.atan2(e.rz, -e.rx); // the arm runs from the pole to the left (−r)
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(px, 3.3 + g, pz);
        dummy.scale.set(0.17, 6.6, 0.17);
        dummy.updateMatrix();
        poles.push(dummy.matrix.clone());
        dummy.rotation.set(0, armYaw, 0);
        dummy.position.set(px - e.rx * (reach + 0.4) * 0.5, 6.1 + g, pz - e.rz * (reach + 0.4) * 0.5);
        dummy.scale.set(reach + 0.4, 0.13, 0.13);
        dummy.updateMatrix();
        arms.push(dummy.matrix.clone());
        // the head over the lanes, its lenses facing the approach
        dummy.rotation.set(0, yaw, 0);
        dummy.position.set(ex + e.rx * mid, 5.42 + g, ez + e.rz * mid);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        heads.push(dummy.matrix.clone());
        (e.axisIndex === 0 ? aveLenses : stLenses).push(dummy.matrix.clone());
        // the green blade with the cross street's name, on the arm between the pole and the head
        const own = roadName(ex - e.dx * 15, ez - e.dz * 15);
        let cross = '';
        for (const f of n.in) {
          if (f === e || Math.abs(f.dx * e.dx + f.dz * e.dz) > 0.5) continue;
          const nm = roadName(f.sx + f.dx * (f.len - 15), f.sz + f.dz * (f.len - 15));
          if (nm && nm !== own) { cross = nm; break; }
        }
        if (cross && reach > 3.2) {
          const bx = px - e.rx * reach * 0.55, bz = pz - e.rz * reach * 0.55;
          dummy.rotation.set(0, yaw, 0);
          dummy.position.set(bx, 6.55 + g, bz);
          dummy.scale.set(Math.min(3.4, reach - 1.2), 0.5, 0.05);
          dummy.updateMatrix();
          blades.push({ m: dummy.matrix.clone(), slot: slotOf(cross.toUpperCase()) });
        }
        dummy.rotation.set(0, 0, 0);
      }
    }
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = true) => {
      if (!list.length) return null;
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.castShadow = shadow;
      inst.receiveShadow = shadow;
      group.add(inst);
      return inst;
    };
    add(unitCyl, mastMat, poles);
    add(unitBox, mastMat, arms);
    add(signalHousingGeo, housingMat, heads);
    add(signalLensGeo, aveSignalLensMat, aveLenses, false);
    add(signalLensGeo, streetSignalLensMat, stLenses, false);
    // street name blades: an atlas of the names, a slot per blade
    if (blades.length) {
      const COLS = 4, SW = 512, SH = 64;
      const rows = Math.ceil(names.length / COLS);
      const c = document.createElement('canvas');
      c.width = COLS * SW;
      c.height = rows * SH;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('[signals] no 2D canvas for the street name blades');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      names.forEach((name, k) => {
        const x0 = (k % COLS) * SW, y0 = Math.floor(k / COLS) * SH;
        ctx.fillStyle = '#0b6b3a';
        ctx.fillRect(x0, y0, SW, SH);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(x0 + 5, y0 + 5, SW - 10, SH - 10);
        ctx.fillStyle = '#ffffff';
        let px = 34;
        do { ctx.font = `700 ${px}px Overpass, Inter, Arial, sans-serif`; px--; } while (px > 12 && ctx.measureText(name).width > SW - 30);
        ctx.fillText(name, x0 + SW / 2, y0 + SH / 2 + 2);
      });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const geo = unitBox.clone();
      const slots = new THREE.InstancedBufferAttribute(new Float32Array(blades.map((b) => b.slot)), 1);
      geo.setAttribute('bladeSlot', slots);
      const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35 });
      mat.colorNode = texture(tex, atlasSlotUV(attribute('bladeSlot', 'float'), COLS, rows));
      add(geo, mat, blades.map((b) => b.m));
    }
    console.info(`[signals] ${heads.length} mast-arm signal heads, ${blades.length} street name blades at the signalised junctions`);
    cornerSigns = buildCornerSigns(network, roadName, colliders);
    return heads.length;
  }

  // The name plates on the corners: a 2.8 m post on the curb at one corner of every junction (three or more ways, no
  // signals: those carry their blades) with a blue plate along each of the two streets. 3,442 street names won't fit
  // one texture, so the plates within NEAR m of the camera get the slots of a small atlas (least recently seen names
  // are drawn over first) and the plates' instanced mesh is refilled whenever the camera has moved REFRESH m.
  function buildCornerSigns(network: RoadNetwork, roadName: (x: number, z: number) => string, colliders: Collider[] | null) {
    const NEAR = 260, REFRESH = 50, CELL = 100;
    const corners: CornerSign[] = [];
    for (const n of network.nodes) {
      if (n.signal || n.shape || n.in.length < 2) continue;
      for (const e of n.in) {
        if (!e.lanes.length) continue;
        const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len;
        const px = ex + e.rx * (e.half + 0.8) + e.dx * 1.2, pz = ez + e.rz * (e.half + 0.8) + e.dz * 1.2;
        if (!isOnCurbIsland(px, pz, 0.25) || !isClearOfPoles(px, pz, 1.2)) continue;
        const own = roadName(ex - e.dx * 15, ez - e.dz * 15);
        let cross: [number, string] | null = null;
        for (const f of n.in) {
          if (f === e || Math.abs(f.dx * e.dx + f.dz * e.dz) > 0.5) continue;
          const nm = roadName(f.sx + f.dx * (f.len - 15), f.sz + f.dz * (f.len - 15));
          if (nm && nm !== own) {
            cross = [Math.atan2(-f.dz, f.dx), nm];
            break;
          }
        }
        if (!own || !cross) continue;
        placedPoles.push({ x: px, z: pz });
        const g = liftAt(px, pz);
        const collider: PropCollider = { minX: px - 0.06, maxX: px + 0.06, minZ: pz - 0.06, maxZ: pz + 0.06, minY: g, maxY: g + 2.8 };
        corners.push({ x: px, z: pz, g, a: [Math.atan2(-e.dz, e.dx), own], b: cross, collider });
        colliders?.push(collider);
        break; // one corner per junction
      }
    }
    if (!corners.length) return null;
    // the posts: all of them, static
    const postMat = new THREE.MeshStandardNodeMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.6 });
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 2.8, 6).translate(0, 1.4, 0), postMat, corners.length);
    corners.forEach((c, i) => {
      dummy.position.set(c.x, c.g, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    });
    posts.castShadow = true;
    group.add(posts);
    // each a prop a vehicle knocks loose (mayhem.ts), its plates going with it: a stand-in post & two blank plates in
    // its own frame (turned to its first street's plate), its collider (which stops walkers) gone once it is down
    const plateLook = (yaw: number, y: number) => new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(yaw) * 0.48, y, -Math.sin(yaw) * 0.48),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(0.92, 0.22, 0.025));
    const blankPlateMat = new THREE.MeshStandardNodeMaterial({ color: 0x1b3f8b, roughness: 0.4 });
    breaker.addProps(corners.map((c, i) => {
      const prop: BreakableProp = {
        kind: 'sign', x: c.x, z: c.z, yaw: c.a[0], ground: c.g, base: c.g, parts: [{ mesh: posts, index: i }],
        collider: c.collider,
        look: [
          { geometry: posts.geometry, material: postMat },
          { geometry: unitBox, material: blankPlateMat, matrix: plateLook(0, 2.62) },
          { geometry: unitBox, material: blankPlateMat, matrix: plateLook(c.b[0] - c.a[0], 2.36) }
        ],
        // (its plates off the refilled plates at once)
        onBreak: () => {
          c.broken = true;
          lastX = Infinity;
        }
      };
      c.collider.prop = prop;
      return prop;
    }));
    const grid = new Map<number, CornerSign[]>();
    for (const c of corners) {
      const k = Math.floor(c.x / CELL) * 100003 + Math.floor(c.z / CELL);
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(c);
    }
    // the atlas: COLS x ROWS slots of SW x SH px
    const COLS = 5, ROWS = 52, SW = 384, SH = 48, SLOTS = COLS * ROWS;
    const canvas = document.createElement('canvas');
    canvas.width = COLS * SW;
    canvas.height = ROWS * SH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[signs] no 2D canvas for the name plates');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const slotOfName = new Map<string, number>();
    const nameInSlot = new Array<string | null>(SLOTS).fill(null);
    const lastSeen = new Float64Array(SLOTS);
    let stamp = 0;
    const draw = (k: number, name: string) => {
      const x0 = (k % COLS) * SW, y0 = Math.floor(k / COLS) * SH;
      ctx.fillStyle = '#1b3f8b';
      ctx.fillRect(x0, y0, SW, SH);
      ctx.strokeStyle = '#f4f4f0';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 4, y0 + 4, SW - 8, SH - 8);
      ctx.fillStyle = '#f4f4f0';
      let px = 26;
      do { ctx.font = `700 ${px}px Overpass, Inter, Arial, sans-serif`; px--; } while (px > 10 && ctx.measureText(name).width > SW - 22);
      ctx.fillText(name, x0 + SW / 2, y0 + SH / 2 + 1);
    };
    const slotFor = (name: string) => {
      let k = slotOfName.get(name);
      if (k === undefined) {
        // the slot whose name was seen longest ago
        k = 0;
        for (let i = 1; i < SLOTS; i++) if (lastSeen[i] < lastSeen[k]) k = i;
        const old = nameInSlot[k];
        if (old !== null) slotOfName.delete(old);
        nameInSlot[k] = name;
        slotOfName.set(name, k);
        draw(k, name);
        tex.needsUpdate = true;
      }
      lastSeen[k] = stamp;
      return k;
    };
    const MAX = SLOTS * 2;
    const geo = unitBox.clone();
    const slotAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    slotAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('plateSlot', slotAttr);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
    mat.colorNode = texture(tex, atlasSlotUV(attribute('plateSlot', 'float'), COLS, ROWS));
    const plates = new THREE.InstancedMesh(geo, mat, MAX);
    plates.count = 0;
    plates.frustumCulled = false;
    group.add(plates);
    let lastX = Infinity, lastZ = Infinity;
    function update(at: PointXZ) {
      if (Math.hypot(at.x - lastX, at.z - lastZ) < REFRESH) return;
      lastX = at.x;
      lastZ = at.z;
      stamp++;
      const near: [number, CornerSign][] = [];
      const r = Math.ceil(NEAR / CELL);
      const ix = Math.floor(at.x / CELL), iz = Math.floor(at.z / CELL);
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          for (const c of grid.get((ix + a) * 100003 + iz + b) ?? []) {
            if (c.broken) continue;
            const d = Math.hypot(c.x - at.x, c.z - at.z);
            if (d < NEAR) near.push([d, c]);
          }
        }
      }
      near.sort((p, q) => p[0] - q[0]);
      let n = 0;
      const names = new Set<string>();
      for (const [, c] of near) {
        if (n + 2 > MAX) break;
        // never more names than slots in one refresh
        if (!names.has(c.a[1]) || !names.has(c.b[1])) {
          if (names.size + 2 > SLOTS) break;
          names.add(c.a[1]);
          names.add(c.b[1]);
        }
        for (const [[yaw, name], y] of [[c.a, 2.62], [c.b, 2.36]] as const) {
          dummy.position.set(c.x, c.g + y, c.z);
          dummy.rotation.set(0, yaw, 0);
          // (along its street, a little out from the post)
          dummy.translateX(0.48);
          dummy.scale.set(0.92, 0.22, 0.025);
          dummy.updateMatrix();
          plates.setMatrixAt(n, dummy.matrix);
          slotAttr.array[n] = slotFor(name);
          n++;
        }
      }
      dummy.rotation.set(0, 0, 0);
      plates.count = n;
      plates.instanceMatrix.needsUpdate = true;
      slotAttr.needsUpdate = true;
    }
    console.info(`[signs] ${corners.length} corners with the two streets' name plates`);
    return { update };
  }

  return { group, footprints, colliders: cfeColliders, signalClock, audioSignals, update, breaker, cfe, addJunctionSignals };
}

export { buildStreetDetails };
