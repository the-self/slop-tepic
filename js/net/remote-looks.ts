// js/net/remote-looks.ts
// The other players' cars as they look in their own games (LOOK_SEEN, shared/protocol-play.ts): each look (its model,
// stretched as the player's car is, its paint, a patrol car's livery & light bar) a car of its own, drawn instanced
// (net/remote-cars.ts) for all the cars in view that have it. Up to LOOKS_MAX looks are kept at once, nearest first,
// within LOOK_DISTANCE; a car beyond, or one whose look hasn't come yet, is drawn as the player's own car (the default
// fleet, as before). A model's 3D file (actors/vehicles/car-files.ts) loading later takes its look's place once it does.
import * as THREE from 'three/webgpu';
import {
  BODY_SPECS, bodyDims, buildCarGeometry, buildLightbarGeometry, buildSteerableWheelGeo, createLightbarMaterial,
  createLoftedCarMaterial, createModelCarMaterial, createModelWheelMaterial
} from '../actors/actor-models.ts';
import type { BodySpec } from '../models/bodies.ts';
import { carFile, onCarFile } from '../actors/vehicles/car-files.ts';
import { SPEC_BY_NAME, modelFor } from '../player/controllers/constants.ts';
import { RemoteCarFleet } from './remote-cars.ts';
import type { CarLookWire } from '../../shared/protocol-play.ts';

const LOOKS_MAX = 12; // looks drawn as their own at once (each its fleet's draws: ~4-10 meshes)
const LOOK_DISTANCE = 180; // m within which another player's car shows its own look
const POLICE_PAINT = 0xf6f9fd; // the patrol cars' white (sim/crime/models.ts: its material carries the livery)
const UNUSED_S = 10; // s a look nobody drives is kept before it goes

/** Where a remote car stands, as RemoteCarFleet.add takes it: m, rad */
export interface CarPlacement {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

interface LookFleet {
  key: string;
  look: CarLookWire;
  template: THREE.Group;
  fleet: RemoteCarFleet;
  usedAt: number; // s (the fleets' own clock) it last drew a car
  file: boolean; // drawn from its model's file
  owned: THREE.Material[]; // the materials made for it alone (its model file's, its paint a uniform of each), freed with it
}

const lookKey = (l: CarLookWire) => `${l.body}|${l.model}|${l.paint.toString(16)}|${l.police ? 'p' : ''}`;

// The wheel geometries of a body shape, made once
const wheelGeos = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
const bodyGeos = new Map<string, THREE.BufferGeometry>();
function shapeGeos(spec: BodySpec): { body: THREE.BufferGeometry; wheels: [THREE.BufferGeometry, THREE.BufferGeometry] } {
  let wheels = wheelGeos.get(spec.name);
  if (!wheels) wheelGeos.set(spec.name, (wheels = [buildSteerableWheelGeo(spec, -1), buildSteerableWheelGeo(spec, 1)]));
  let body = bodyGeos.get(spec.name);
  if (!body) bodyGeos.set(spec.name, (body = buildCarGeometry(spec, false)));
  return { body, wheels };
}

const shaded = (mesh: THREE.Mesh) => {
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
};

// The look as a car standing at the origin, facing +z (the player's car's frame, player/controllers/car-model.ts):
// its model's file when it has loaded (and the car is no patrol car), else its body shape stretched to the model's size
// (with the shared lofted materials). The materials made for it alone go into `owned` (the old ones freed first)
function buildTemplate(look: CarLookWire, into: THREE.Group, owned: THREE.Material[]): boolean {
  into.clear();
  for (const m of owned) m.dispose();
  owned.length = 0;
  const model = modelFor({ bodyType: look.body, police: look.police, model: look.model || null });
  const file = look.police ? undefined : carFile(model.id);
  if (file?.wheel && file.wheels) {
    const w = file.wheels;
    const wheelMat = createModelWheelMaterial(file.map, file.paintMap);
    const bodyMat = createModelCarMaterial(file.map, file.paintMap, look.paint, file.glowMap);
    owned.push(bodyMat, wheelMat);
    into.add(shaded(new THREE.Mesh(file.geometry, bodyMat)));
    for (const side of [-1, 1]) {
      for (const z of [w.front, w.rear]) {
        const tire = shaded(new THREE.Mesh(side < 0 ? file.wheel.left : file.wheel.right, wheelMat));
        tire.position.set(side * w.x, w.radius, z);
        into.add(tire);
      }
    }
    return true;
  }
  const spec = look.police ? BODY_SPECS.sedan : SPEC_BY_NAME[look.body] ?? SPEC_BY_NAME[model.body] ?? BODY_SPECS.taxi;
  const geos = shapeGeos(spec);
  const mat = createLoftedCarMaterial(spec, look.police ? POLICE_PAINT : look.paint);
  const dims = bodyDims(spec);
  const sx = model.size[1] / dims.width, sy = model.size[2] / dims.height, sz = model.size[0] / dims.length;
  const sw = Math.min(sy, sz);
  const chassis = new THREE.Group();
  chassis.scale.set(sx, sy, sz);
  chassis.add(shaded(new THREE.Mesh(geos.body, mat)));
  if (look.police) chassis.add(new THREE.Mesh(buildLightbarGeometry(spec), createLightbarMaterial(true)));
  into.add(chassis);
  for (const side of [-1, 1]) {
    for (const front of [true, false]) {
      const tire = shaded(new THREE.Mesh(geos.wheels[side < 0 ? 0 : 1], mat));
      tire.scale.setScalar(sw);
      tire.position.set(side * spec.wheelX * sx, spec.wheelRadius * sw, (front ? spec.wheelZ : -spec.wheelZ) * sz);
      into.add(tire);
    }
  }
  return false;
}

class RemoteLooks {
  private readonly scene: THREE.Object3D;
  private readonly fleets = new Map<string, LookFleet>();
  private clock = 0;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
    // (a model's file that loads later: the looks drawn from its body shape till now take it up)
    onCarFile((id) => {
      for (const f of this.fleets.values()) if (!f.file && !f.look.police && f.look.model === id) f.file = buildTemplate(f.look, f.template, f.owned);
    });
  }

  /** Before the frame's cars */
  begin(dt: number): void {
    this.clock += dt;
    for (const f of this.fleets.values()) f.fleet.begin(dt);
  }

  /**
   * A car of `look` (`key` its lookKey) at `at`, `dist` m from the camera: drawn as its own, true, or false when it has
   * to be drawn as the default (too far, no look, every look slot taken by nearer ones)
   */
  add(look: CarLookWire | null, key: string, at: CarPlacement, dist: number): boolean {
    // (a camión is the traffic's to build: drawn as the default)
    if (!look || dist > LOOK_DISTANCE || look.body === 'bus') return false;
    let f = this.fleets.get(key);
    if (!f) {
      if (this.fleets.size >= LOOKS_MAX && !this.dropUnused()) return false;
      const template = new THREE.Group();
      const owned: THREE.Material[] = [];
      const file = buildTemplate(look, template, owned);
      f = { key, look, template, fleet: new RemoteCarFleet(this.scene, template, 4), usedAt: this.clock, file, owned };
      this.fleets.set(key, f);
      f.fleet.begin(Infinity); // (its parts taken now)
    }
    f.usedAt = this.clock;
    f.fleet.add(at.x, at.y, at.z, at.heading, at.pitch, at.roll);
    return true;
  }

  /** After the frame's cars; the looks nobody has driven for a while go */
  end(): void {
    for (const f of this.fleets.values()) f.fleet.end();
    if (this.fleets.size > LOOKS_MAX / 2) this.dropUnused();
  }

  dispose(): void {
    for (const f of this.fleets.values()) this.free(f);
    this.fleets.clear();
  }

  // A look's fleet and the materials made for it alone
  private free(f: LookFleet): void {
    f.fleet.dispose();
    for (const m of f.owned) m.dispose();
    f.owned.length = 0;
  }

  // The looks unused for UNUSED_S; true when one went
  private dropUnused(): boolean {
    let dropped = false;
    for (const [key, f] of this.fleets) {
      if (this.clock - f.usedAt < UNUSED_S) continue;
      this.free(f);
      this.fleets.delete(key);
      dropped = true;
    }
    return dropped;
  }
}

export { RemoteLooks, lookKey };
