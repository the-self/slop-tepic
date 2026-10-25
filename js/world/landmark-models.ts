import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import type { GeoFrame } from './city-geodata.js';
import { landHeight } from './ground.ts';
import type { Collider } from './buildings.ts';

// js/world/landmark-models.ts
// Landmarks as 3D models (.glb files in assets/models/: photogrammetry from a phone, e.g. Polycam or RealityScan, or
// modelled by hand) standing on their real lots in place of the generic houses: LANDMARK_MODELS below says where each
// goes. The lots are kept clear and get their colliders at once (MODEL_RESERVES, buildLandmarkModels); the models
// themselves load in the background, so a missing or slow file never holds up the city. See assets/models/README.md
// for how to make one.

/**
 * { name, file (from the site's root), lat, lon (the footprint's centre), heading (° clockwise from true north that
 *   the model's front, its +z, faces), size: [width, depth] (m: its footprint, the lot kept clear of houses),
 *   height (m, for the collider), scale? (1: the file is in metres), lift? (m, raises it off the ground) }
 */
export interface LandmarkModel {
  name: string;
  /** from the site's root */
  file: string;
  /** the footprint's centre (°) */
  lat: number;
  lon: number;
  /** ° clockwise from true north that the model's front, its +z, faces */
  heading: number;
  /** [width, depth] (m): its footprint, the lot kept clear of houses */
  size: [number, number];
  /** m, for the collider */
  height: number;
  /** 1: the file is in metres */
  scale?: number;
  /** m, raises it off the ground */
  lift?: number;
}

/** What the projection reads of GEO.frame: its origin (°) and the street grid's turn (° clockwise from true north) */
type ProjectionFrame = Pick<GeoFrame, 'lat0' | 'lon0' | 'bearingDeg'>;

/** Where a model stands: its centre (m), its yaw (rad) and front (fx, fz), its footprint's half-sizes (m) */
export interface ModelFrame {
  x: number;
  z: number;
  yaw: number;
  fx: number;
  fz: number;
  hx: number;
  hz: number;
}

/** A lot kept clear of the generic houses */
export interface LotReserve {
  contains(x: number, z: number): boolean;
}

const LANDMARK_MODELS: LandmarkModel[] = [
  // { name: 'Presidencia Municipal', file: 'assets/models/presidencia-municipal.glb', lat: 21.51195, lon: -104.89305,
  //   heading: 90, size: [38, 26], height: 12 },
];

// The builder's projection (tools/build-tepic-geodata.mjs): metres east & north of the plaza on the WGS84 ellipsoid,
// turned to the street grid
const A = 6378137.0, E2 = 6.69437999014e-3;
function geoToWorld(lat: number, lon: number, frame: ProjectionFrame = GEO.frame): [number, number] {
  const phi = (frame.lat0 * Math.PI) / 180, s = Math.sin(phi);
  const kx = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * s * s)) * Math.cos(phi);
  const ky = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5));
  const e = (lon - frame.lon0) * kx, n = (lat - frame.lat0) * ky;
  const th = ((frame.bearingDeg || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
  return [e * c - n * sn, -(e * sn + n * c)];
}

// Where a model stands: its centre, its turn (the world's yaw for its +z) and its footprint's half-sizes
function modelFrame(m: LandmarkModel, frame: ProjectionFrame = GEO.frame): ModelFrame {
  const [x, z] = geoToWorld(m.lat, m.lon, frame);
  // a true bearing in the grid frame: x = east along the grid, z = south; bearing b points (sin b', -cos b')
  const b = ((m.heading - (frame.bearingDeg || 0)) * Math.PI) / 180;
  const fx = Math.sin(b), fz = -Math.cos(b);
  return { x, z, yaw: Math.atan2(fx, fz), fx, fz, hx: m.size[0] / 2, hz: m.size[1] / 2 };
}

// The lots kept clear of the generic houses (buildings.ts, with tepic-landmarks.ts's): { contains(x, z) }
const MODEL_RESERVES: LotReserve[] = LANDMARK_MODELS.map((m) => {
  const f = modelFrame(m);
  return {
    contains(px: number, pz: number) {
      const dx = px - f.x, dz = pz - f.z;
      const along = dx * f.fx + dz * f.fz, across = dx * -f.fz + dz * f.fx;
      return Math.abs(along) < f.hz + 2 && Math.abs(across) < f.hx + 2;
    }
  };
});

function buildLandmarkModels(scene: THREE.Object3D): { group: THREE.Group; colliders: Collider[] } {
  const group = new THREE.Group();
  group.name = 'LandmarkModels';
  const colliders: Collider[] = [];
  if (!LANDMARK_MODELS.length) return { group, colliders };
  scene.add(group);
  const frames = LANDMARK_MODELS.map((m) => modelFrame(m));
  LANDMARK_MODELS.forEach((m, i) => {
    const f = frames[i];
    const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const ex = Math.abs(cs) * f.hx + Math.abs(sn) * f.hz, ez = Math.abs(sn) * f.hx + Math.abs(cs) * f.hz;
    const base = landHeight(f.x, f.z);
    colliders.push({ minX: f.x - ex, maxX: f.x + ex, minZ: f.z - ez, maxZ: f.z + ez, minY: base, maxY: base + (m.height || 10), obb: { cx: f.x, cz: f.z, hx: f.hx, hz: f.hz, cs, sn } });
  });
  // the models in the background, one loader for all (not preloaded: only fetched when there are models to show)
  const loading = import('three/addons/loaders/GLTFLoader.js');
  void loading.then(({ GLTFLoader }) => {
    const loader = new GLTFLoader();
    LANDMARK_MODELS.forEach((m, i) => {
      const f = frames[i];
        loader.load(m.file, (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(m.scale || 1);
        model.position.set(f.x, landHeight(f.x, f.z) + (m.lift || 0), f.z);
        model.rotation.y = f.yaw;
        model.traverse((o) => {
          if ('isMesh' in o && o.isMesh) o.castShadow = o.receiveShadow = true;
        });
        group.add(model);
      }, undefined, (err) => {
        console.warn(`[models] ${m.name}: could not load ${m.file}`, err);
      });
    });
  });
  console.info(`[models] ${LANDMARK_MODELS.length} landmark models: ${LANDMARK_MODELS.map((m) => m.name).join(', ')}`);
  return { group, colliders };
}

export { LANDMARK_MODELS, MODEL_RESERVES, buildLandmarkModels, geoToWorld, modelFrame };
