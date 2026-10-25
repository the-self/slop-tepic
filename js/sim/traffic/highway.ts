// js/sim/traffic/highway.ts
// AMBIENT SHORE-HIGHWAY TRAFFIC: a lighter model of its own on the shore highways, which aren't part of the road graph
import * as THREE from 'three/webgpu';
import { cityUniforms, createCarFlareMaterial } from '../../render/tsl-materials.ts';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from '../../actors/vehicle-lights.ts';
import {
  BODY_SPECS, buildCarGeometry, buildCarProxyGeometry, createLoftedCarMaterial
} from '../../actors/actor-models.ts';
import { clamp } from './constants.ts';
import type { DriverModel } from './types.ts';

/** A shore-highway lane (city-grid.ts): its centre line and speed (m/s) */
interface HighwayLaneSpec {
  pts: THREE.Vector3[];
  speed: number;
}
/** ...with what createHighwayTraffic adds to it: metres along it at each point, its length, heading at each point,
 *  bounds [x0, x1, z0, z1] (m) and its cars */
interface HighwayLane extends HighwayLaneSpec {
  cum: number[];
  len: number;
  yaw: number[];
  box: [x0: number, x1: number, z0: number, z1: number];
  cars: HighwayCar[];
}
type HighwayKind = 'taxi' | 'sedan' | 'suv';
/** A highway car: metres along its lane (u), speed (m/s) & acceleration, the lane segment it is on, its pose, paint */
interface HighwayCar {
  lane: HighwayLane;
  kind: HighwayKind;
  u: number;
  v: number;
  acc: number;
  seg: number;
  placed: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  col: [r: number, g: number, b: number];
  /** headlights this frame: camera distance squared, how near it counts, its mesh & slot, brake lights */
  _d2: number;
  _effDist: number;
  _mesh: THREE.InstancedMesh | null;
  _slot: number;
  _brake: number;
}
/** The player as the highway reads it: a position (m) and a heading, speed & knock velocity */
interface HighwayPlayerEntity {
  position: THREE.Vector3;
  heading?: number;
  speed?: number;
  vx?: number;
  vz?: number;
}

// ============================================================================
// AMBIENT SHORE-HIGHWAY TRAFFIC (West Side Highway, Henry Hudson Parkway, FDR Drive)
// ============================================================================
// The shore highways city-grid.ts lays along both rivers are not part of the road graph, so a lighter model fills
// them: cars follow each lane's centre line and keep their distance with the IDM. Nobody changes lanes, so the order
// in a lane never changes and every car's leader is simply the next one (cyclically: cars dip below the deck at the
// end of a lane as if into an underpass and come back up at its start; West St and the FDR's lanes are joined through
// the Battery Park Underpass, lane points well below ground). Cars queue behind the player standing or
// driving in their lane. Within HWY_NEAR_LOD m of the camera they use the full model with wheels and cast shadows,
// up to HWY_MID_LOD m a wheel-less body, further out a coarse ~250-triangle lofted proxy; beyond HWY_FAR_CULL m (or well behind
// the camera) they aren't drawn.
const HWY_DRIVER: Omit<DriverModel, 'aLat'> = { a: 1.6, b: 2.8, T: 1.3, s0: 3.0 };
const HWY_CAR_LEN = 4.6;
const HWY_NEAR_LOD = 170;
const HWY_MID_LOD = 450;
const HWY_FAR_CULL = 1600;
const HWY_RAMP = 32; // the dip at the lane ends: 2.4 m down over this many metres

// The player's arc position and speed along `lane` if they are in it (within 2 m of the centre line and near
// its road height, not on its underground stretches), else null
function playerInLane(lane: HighwayLane, pl: { x: number; y: number; z: number; vx: number; vz: number }) {
  const [x0, x1, z0, z1] = lane.box;
  if (pl.x < x0 - 3 || pl.x > x1 + 3 || pl.z < z0 - 3 || pl.z > z1 + 3) return null;
  const P = lane.pts;
  for (let i = 0; i + 1 < P.length; i++) {
    if (P[i].y < -1 && P[i + 1].y < -1) continue;
    const ax = P[i].x, az = P[i].z;
    const sx = P[i + 1].x - ax, sz = P[i + 1].z - az;
    const horizontalLengthSq = sx * sx + sz * sz;
    if (horizontalLengthSq === 0) continue;
    const L = lane.cum[i + 1] - lane.cum[i];
    const t = ((pl.x - ax) * sx + (pl.z - az) * sz) / horizontalLengthSq;
    if (t < 0 || t > 1) continue;
    const y = P[i].y + (P[i + 1].y - P[i].y) * t;
    if (Math.abs(pl.y - y) >= 2.6) continue;
    if (Math.abs((pl.z - az) * sx - (pl.x - ax) * sz) / Math.sqrt(horizontalLengthSq) < 2.0) {
      // Convert horizontal progress to distance along the sloped lane, as with the cars' u.
      return { u: lane.cum[i] + t * L, v: Math.max(0, ((pl.vx * sx + pl.vz * sz) / horizontalLengthSq) * L) };
    }
  }
  return null;
}

// The player as the highway's cars see it: where they are and their velocity (m/s), or null (none, or flying)
function highwayPlayer(entity: HighwayPlayerEntity | null, mode: string) {
  return entity && mode !== 'helicopter' ? {
    x: entity.position.x, y: entity.position.y, z: entity.position.z,
    vx: Math.sin(entity.heading || 0) * (entity.speed || 0) + (entity.vx || 0),
    vz: Math.cos(entity.heading || 0) * (entity.speed || 0) + (entity.vz || 0)
  } : null;
}

function createHighwayTraffic(scene: THREE.Scene, laneSpecs: HighwayLaneSpec[]) {
  // (each gets its arc lengths, headings, bounds and cars just below)
  const lanes = laneSpecs as HighwayLane[];
  const group = new THREE.Group();
  group.name = 'HighwayTraffic';
  scene.add(group);
  const KINDS: HighwayKind[] = ['taxi', 'sedan', 'suv'];
  const PALETTES: Record<HighwayKind, number[]> = {
    taxi: [0xffbe14],
    sedan: [0x1c2026, 0xcfd6de, 0x1d3b6c, 0x52575e, 0x6e1f24, 0x8a8f96, 0xe9ecef],
    suv: [0x16191e, 0xf0f3f7, 0x3a434d, 0x28382e, 0xbec6cf, 0x5b2a2a]
  };
  let seed = 20240917;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // Lanes: arc length and heading at every centre-line vertex, bounds for the player test, cars every 24-74 m
  const cars: HighwayCar[] = [];
  const counts: Record<HighwayKind, number> = { taxi: 0, sedan: 0, suv: 0 };
  for (const lane of lanes) {
    const P = lane.pts;
    lane.cum = [0];
    for (let i = 1; i < P.length; i++) lane.cum.push(lane.cum[i - 1] + P[i].distanceTo(P[i - 1]));
    lane.len = lane.cum[P.length - 1];
    lane.yaw = P.map((_p, i) => {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      return Math.atan2(b.x - a.x, b.z - a.z);
    });
    lane.box = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of P) lane.box = [Math.min(lane.box[0], p.x), Math.max(lane.box[1], p.x), Math.min(lane.box[2], p.z), Math.max(lane.box[3], p.z)];
    lane.cars = [];
    for (let u = rand() * 30; u < lane.len - 12; u += 24 + rand() * 50) {
      const h = rand();
      const kind = h < 0.20 ? 'taxi' : h < 0.65 ? 'sedan' : 'suv';
      const col = new THREE.Color(PALETTES[kind][Math.floor(rand() * PALETTES[kind].length)]);
      // (float32 values, so update() can tell whether an instance slot's paint changes by comparing with the buffer)
      const car: HighwayCar = {
        lane, kind, u, v: lane.speed, acc: 0, seg: 0,
        placed: false, x: 0, y: -1000, z: 0, yaw: 0,
        col: [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)],
        // its headlights this frame (update)
        _d2: 0, _effDist: 0, _mesh: null, _slot: 0, _brake: 0
      };
      lane.cars.push(car);
      cars.push(car);
      counts[kind]++;
    }
  }

  // Per body type: [near (with wheels, casts shadows), mid (wheel-less), far (lofted proxy)] instanced meshes sharing
  // the traffic's cached car material (per-instance paintColor & carState)
  const meshes = {} as Record<HighwayKind, THREE.InstancedMesh[]>; // (every kind's, just below)
  for (const kind of KINDS) {
    const spec = BODY_SPECS[kind];
    const n = Math.max(1, counts[kind]);
    meshes[kind] = [0, 1, 2].map((lod) => {
      const geo = lod === 2 ? buildCarProxyGeometry(spec) : buildCarGeometry(spec, lod === 0);
      geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const mesh = new THREE.InstancedMesh(geo, createLoftedCarMaterial(spec), n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    });
  }

  // Night lamp flares: a soft glow on every head- and tail-lamp, at least a couple of pixels wide, so the highways read
  // as streams of white and red lights from across the river once the lamp geometry shrinks below a pixel.
  // (flareCol is rgb + an unused w: 3-component attributes get re-padded to 4 on every upload)
  const flarePos = new Float32Array(cars.length * 4 * 4); // x, y, z, size
  const flareCol = new Float32Array(cars.length * 4 * 4); // r, g, b, -
  const flareGeo = new THREE.PlaneGeometry(1, 1);
  flareGeo.setAttribute('flarePos', new THREE.InstancedBufferAttribute(flarePos, 4));
  flareGeo.setAttribute('flareCol', new THREE.InstancedBufferAttribute(flareCol, 4));
  const flares = new THREE.Mesh(flareGeo, createCarFlareMaterial());
  flares.name = 'HighwayLampFlares';
  flares.frustumCulled = false;
  flares.visible = false;
  flares.renderOrder = 2;
  group.add(flares);
  let flareCount = 0;

  // Clustered SpotLight pool for nearby highway cars (within 105 m)
  const HWY_SPOT_POOL = 28;
  const HWY_LIGHT_DIST = 105;
  const HWY_LIGHT_DIST_SQ = HWY_LIGHT_DIST * HWY_LIGHT_DIST;
  const hwyLightsGroup = new THREE.Group();
  hwyLightsGroup.name = 'HighwayClusteredLights';
  group.add(hwyLightsGroup);

  const hwySpotPool: THREE.SpotLight[] = [];
  for (let i = 0; i < HWY_SPOT_POOL; i++) {
    const spot = createVehicleHeadlight();
    spot.position.set(0, -1000, 0);
    spot.target.position.set(0, -1001, 0);
    hwyLightsGroup.add(spot, spot.target);
    hwySpotPool.push(spot);
  }
  const hwyLitCars: HighwayCar[] = [];
  let hwyLitCount = 0;
  function addFlare(px: number, py: number, pz: number, size: number, r: number, g: number, b: number): void {
    const o = flareCount * 4;
    flarePos[o] = px;
    flarePos[o + 1] = py;
    flarePos[o + 2] = pz;
    flarePos[o + 3] = size;
    const k = flareCount * 4;
    flareCol[k] = r;
    flareCol[k + 1] = g;
    flareCol[k + 2] = b;
    flareCount++;
  }
  const flareFacing = (f: number) => { const t = Math.min(1, Math.max(0, (f + 0.3) / 0.9)); return t * t * (3 - 2 * t); };

  const D = HWY_DRIVER;
  const brakeTerm = 2 * Math.sqrt(D.a * D.b);
  const ease = (x: number) => { const t = Math.min(1, Math.max(0, x / HWY_RAMP)); return t * t * (3 - 2 * t); };
  const easeSlope = (x: number) => { if (x <= 0 || x >= HWY_RAMP) return 0; const t = x / HWY_RAMP; return (6 * t * (1 - t)) / HWY_RAMP; };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  const fwd = new THREE.Vector3();
  const dirtyPaint = new Set<THREE.InstancedMesh>();
  const dirtyState = new Set<THREE.InstancedMesh>();
  let updates = 0;
  // Flags the first n items of an attribute for upload (static usage: once per frame, not once per render pass)
  function flagRange(attr: THREE.BufferAttribute, n: number) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * attr.itemSize);
    attr.needsUpdate = true;
  }
  // ...by name, of a geometry given it as an InstancedBufferAttribute (paintColor, carState, flarePos, flareCol)
  function flagAttribute(geo: THREE.BufferGeometry, name: string, n: number) {
    const attr = geo.getAttribute(name);
    if (attr instanceof THREE.BufferAttribute) flagRange(attr, n);
  }

  function update(dt: number, camera: THREE.PerspectiveCamera, entity: HighwayPlayerEntity | null, mode: string): void {
    // 1. Car following (IDM) in every lane, the player counting as a leader
    const pl = highwayPlayer(entity, mode);
    for (const lane of lanes) {
      const list = lane.cars;
      const n = list.length;
      const pIn = pl ? playerInLane(lane, pl) : null;
      for (let k = 0; k < n; k++) {
        const c = list[k];
        let gap = Infinity;
        let dv = 0;
        if (n > 1) {
          const lead = list[(k + 1) % n];
          gap = lead.u - c.u;
          if (gap < 0) gap += lane.len;
          gap -= HWY_CAR_LEN;
          dv = c.v - lead.v;
        }
        if (pIn && pIn.u > c.u && pIn.u - c.u - HWY_CAR_LEN < gap) {
          gap = pIn.u - c.u - HWY_CAR_LEN;
          dv = c.v - pIn.v;
        }
        const sStar = D.s0 + Math.max(0, c.v * D.T + (c.v * dv) / brakeTerm);
        c.acc = Math.max(-9, D.a * (1 - (c.v / lane.speed) ** 4 - (sStar / Math.max(gap, 0.1)) ** 2));
      }
      for (const c of list) {
        c.v = Math.max(0, c.v + c.acc * dt);
        c.u += c.v * dt;
        if (c.u >= lane.len) {
          c.u -= lane.len;
          c.seg = 0;
        }
      }
    }

    // 2. Instances: LOD by distance, far cars well behind the camera skipped; lamp flares at dusk & night
    const cam = camera.position;
    camera.getWorldDirection(fwd);
    for (const kind of KINDS) for (const mesh of meshes[kind]) mesh.count = 0;
    const flaresOn = cityUniforms.uInteriorGlow.value > 0.65;
    const pxAt1m = (2 * Math.tan(((camera.fov || 55) * Math.PI) / 360)) / Math.max(360, window.innerHeight || 800);
    flareCount = 0;
    hwyLitCount = 0;
    for (const c of cars) {
      const lane = c.lane;
      const cum = lane.cum;
      while (c.seg < cum.length - 2 && cum[c.seg + 1] < c.u) c.seg++;
      const i = c.seg;
      const segLen = cum[i + 1] - cum[i];
      const t = Math.min(1, Math.max(0, (c.u - cum[i]) / segLen));
      const a = lane.pts[i];
      const b = lane.pts[i + 1];
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const toEnd = lane.len - c.u;
      const dip = c.u < toEnd ? c.u : toEnd;
      const y = a.y + (b.y - a.y) * t - 2.4 * (1 - ease(dip));
      let dYaw = lane.yaw[i + 1] - lane.yaw[i];
      if (dYaw > Math.PI) dYaw -= Math.PI * 2;
      else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const yaw = lane.yaw[i] + dYaw * t;
      // Keep the current world pose available to audio, including cars behind the camera.
      c.x = x;
      c.y = y;
      c.z = z;
      c.yaw = yaw;
      c.placed = true;
      const dx = x - cam.x;
      const dz = z - cam.z;
      const dy = y - cam.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > HWY_FAR_CULL * HWY_FAR_CULL) continue;
      const lod = d2 < HWY_NEAR_LOD * HWY_NEAR_LOD ? 0 : d2 < HWY_MID_LOD * HWY_MID_LOD ? 1 : 2;
      if (lod > 0 && dx * fwd.x + dz * fwd.z < -40) continue;
      if (y < -3.6) continue; // in the Battery Park Underpass, out of sight behind the portals' screens
      const slope = (b.y - a.y) / segLen + 2.4 * easeSlope(dip) * (c.u < toEnd ? 1 : -1);
      euler.set(-Math.atan(slope), yaw, 0);
      q.setFromEuler(euler);
      m4.compose(pos.set(x, y, z), q, ONE);
      const mesh = meshes[c.kind][lod];
      const slot = mesh.count++;
      m4.toArray(mesh.instanceMatrix.array, slot * 16);
      // Paint & brake lights change only when a slot changes hands or a car brakes: flagged for upload just then
      const attrs = mesh.geometry.attributes;
      const paint = attrs.paintColor.array;
      const o3 = slot * 3;
      if (paint[o3] !== c.col[0] || paint[o3 + 1] !== c.col[1] || paint[o3 + 2] !== c.col[2]) {
        paint.set(c.col, o3);
        dirtyPaint.add(mesh);
      }
      const brake = c.acc < -1.2 ? 1 : 0; // brake lights
      if (attrs.carState.array[slot * 4] !== brake) {
        attrs.carState.array[slot * 4] = brake;
        dirtyState.add(mesh);
      }

      if (d2 < HWY_LIGHT_DIST_SQ && dip > 1) {
        const d = Math.sqrt(d2);
        const forwardDot = dx * fwd.x + dz * fwd.z;
        const effDist = d + Math.max(0, 5.0 - forwardDot) * 3.2;
        if (effDist < HWY_LIGHT_DIST) {
          c._d2 = d2;
          c._effDist = effDist;
          c._mesh = mesh;
          c._slot = slot;
          c._brake = brake;
          hwyLitCars[hwyLitCount++] = c;
        }
      }

      // Flares (from 40 m out, full by 120 m): sprites just off the lamp faces, white at the front and red at the back,
      // brightest seen head-on / from behind, dimmed by haze
      if (!flaresOn || d2 < 1600 || dip < 1) continue;
      const d = Math.sqrt(d2);
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      const facing = -(dx * sy + dz * cy) / d;
      const k = (Math.min(1, (d - 40) / 80) / (1 + (d / 2000) ** 2)) * ease(dip);
      const size = Math.max(0.6, d * pxAt1m * 3);
      const spec = BODY_SPECS[c.kind];
      const { lamps, lampX } = spec;
      if (!lamps || !lampX) continue; // (every body's: actor-models.ts)
      for (let e = 0; e < 2; e++) {
        const front = e === 0;
        const w = k * (0.3 + 0.7 * flareFacing(front ? facing : -facing));
        const lz = front ? spec.zFront + 0.3 : spec.zRear - 0.3;
        const ly = y + (front ? lamps[0] : lamps[1]);
        for (let s = -1; s <= 1; s += 2) {
          const lx = s * lampX[front ? 0 : 1];
          if (front) addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 4.4 * w, 4.1 * w, 3.6 * w);
          else addFlare(x + lx * cy + lz * sy, ly, z - lx * sy + lz * cy, size, 3.4 * w, 0.16 * w, 0.1 * w);
        }
      }
    }
    // Upload just the instances in use (the buffers hold every car of the kind), and nothing for empty meshes, which
    // are hidden too (an empty instanced mesh still costs a render object update in every pass). They stay visible
    // for the first couple of frames so that the shader precompile & warm-up frame (main.ts) see all of them.
    const hideEmpty = ++updates > 2;
    for (const kind of KINDS) {
      for (const mesh of meshes[kind]) {
        const n = mesh.count;
        mesh.visible = n > 0 || !hideEmpty;
        if (n === 0) continue;
        flagRange(mesh.instanceMatrix, n);
        if (dirtyPaint.has(mesh)) flagAttribute(mesh.geometry, 'paintColor', n);
        if (dirtyState.has(mesh)) flagAttribute(mesh.geometry, 'carState', n);
      }
    }
    dirtyPaint.clear();
    dirtyState.clear();
    flares.visible = flareCount > 0;
    flares.count = flareCount;
    if (flareCount > 0) {
      flagAttribute(flareGeo, 'flarePos', flareCount);
      flagAttribute(flareGeo, 'flareCol', flareCount);
    }

    // Update clustered highway SpotLights (dual left/right beams for nearby cars)
    hwyLitCars.length = hwyLitCount;
    if (hwyLitCount > 1) {
      hwyLitCars.sort((a, b) => a._effDist - b._effDist);
    }
    const glow = cityUniforms.uInteriorGlow.value;
    const beamScale = clamp((glow - 0.60) * 1.45, 0.0, 1.28);
    const maxHwyVeh = HWY_SPOT_POOL >> 1;
    const hwyCutoff = hwyLitCount > maxHwyVeh
      ? Math.min(HWY_LIGHT_DIST, hwyLitCars[maxHwyVeh]._effDist)
      : HWY_LIGHT_DIST;
    let spotUsed = 0;
    if (beamScale > 0.001) {
      for (let i = 0; i < hwyLitCount && spotUsed + 2 <= HWY_SPOT_POOL; i++) {
        const c = hwyLitCars[i];
        const t = clamp((hwyCutoff - c._effDist) / Math.max(1, hwyCutoff * 0.38), 0, 1);
        const fade = (t * t * (3 - 2 * t)) * ease(Math.min(c.u, c.lane.len - c.u));
        if (fade <= 0.001) continue;
        const spec = BODY_SPECS[c.kind];
        const baseInt = HEADLIGHTS.intensity * beamScale * fade;
        // Reuse the exact rendered transform, including the road slope and underpass dip.
        c._mesh?.getMatrixAt(c._slot, m4);
        for (let side = -1; side <= 1; side += 2) {
          const spot = hwySpotPool[spotUsed++];
          placeVehicleHeadlight(spot, spec, side, m4);
          spot.intensity = baseInt;
        }
      }
    }
    for (let i = spotUsed; i < HWY_SPOT_POOL; i++) {
      const spot = hwySpotPool[i];
      spot.intensity = 0;
      spot.position.set(0, -1000, 0);
    }
  }

  return { group, update, cars, lanes };
}

export type { HighwayLaneSpec, HighwayLane, HighwayKind, HighwayCar };
export { playerInLane, highwayPlayer, createHighwayTraffic };
