import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash } from './hash.ts';
import { Bystanders, BYSTANDER_STYLES } from '../sim/bystanders.ts';
import type { ThirdPersonControllerManager } from '../player/controllers.ts';
import type { CrimeSystem } from '../sim/crime.ts';
import type { Poi } from './city-geodata.js';
import type { AmbientSource } from '../audio/audio-ambience.ts';

// js/world/street-food.ts
// The night's street food: as the sun goes down the taquerías put their stand out on the sidewalk in front (a table
// under a lona, the trompo al pastor glowing by the plancha, a bare bulb), the burger stands light their griddles, the
// elote carts come to the parks & plazas and the hot dog carts stand outside the hospitals, the universities and the
// stadiums. Each has its taquero and a few customers waiting; the plancha steams. On foot, F buys something to eat
// (it heals) for a few pesos.
// The stands of the taquerías & burger places stand where the city data puts them (venues.ts); the carts at
// OpenStreetMap's parks and the rest (city-geodata.js `pois`), moved onto the nearest sidewalk.

/** The kinds of stand: the taquerías' and burger places' own, and the carts */
export type StallKind = 'tacos' | 'burger' | 'elotes' | 'hotdog';

/** What a kind of stand sells: price (MXN), health it gives back, when it is out (hours, `close` past midnight wraps) */
export interface StallSpec {
  item: string;
  price: number;
  heal: number;
  open: number;
  close: number;
  /** Its lonas' colours (0xrrggbb) */
  lonas: number[];
}

/** A venue as the stands read it (venues.ts findVenues): its door on the street front, facing out along (nx, nz) */
interface StandVenue {
  kind: string;
  name: string;
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** Along the front (unit) and its width (m) */
  ax: number;
  az: number;
  width: number;
  heading: number;
}

/** A stand or cart in the city */
export interface Stand {
  kind: StallKind;
  spec: StallSpec;
  /** Where it stands (m) and which way it faces (yaw, rad: a cart's once it is placed) */
  x: number;
  z: number;
  heading: number;
  name: string;
  cart: boolean;
  /** Put on its sidewalk yet (a cart is when it first comes out) */
  placed: boolean;
  /** No sidewalk near enough: never drawn */
  dead?: boolean;
  /** The ground under it (m) and its distance from the camera (m), this frame */
  y: number;
  distance: number;
  lona: number;
  /** Hours it opens early (-) or late (+) */
  early: number;
  customers: number;
  seed: number;
  sound?: AmbientSource;
}

/** The meshes of the stands & carts, one instance per stand out */
type StandMeshes = Record<'frame' | 'plancha' | 'lona' | 'trompo' | 'grill' | 'bulb' | 'cart' | 'parasol' | 'stools', THREE.InstancedMesh>;

// What each kind sells: price (MXN), health it gives back, when it is out (hours), and its lona's colours
const STALLS: Record<StallKind, StallSpec> = {
  tacos: { item: 'tacos al pastor', price: 45, heal: 30, open: 19, close: 2, lonas: [0xd8322a, 0xe8721c, 0x1f6fb8, 0x2f8f3a] },
  burger: { item: 'una hamburguesa', price: 60, heal: 35, open: 18, close: 1, lonas: [0xf2b705, 0xd8322a, 0x222222] },
  elotes: { item: 'un elote', price: 30, heal: 15, open: 17, close: 23, lonas: [0xf6e7b0, 0xe8c228] },
  hotdog: { item: 'un hot dog', price: 35, heal: 20, open: 18, close: 24, lonas: [0xd8322a, 0x1f6fb8] }
};
const DRAW_DISTANCE = 230; // m: stands drawn within
const PEOPLE_DISTANCE = 110; // m: their people
const MAX_STANDS = 48;
const MAX_LIGHTS = 8;
const REACH = 2.4; // m from the stand's counter the player buys from
const STAND_PARTS = ['frame', 'plancha', 'lona', 'bulb', 'stools'] as const; // (a taco stand's meshes)
const byDistance = (a: Stand, b: Stand) => a.distance - b.distance;

const openAt = (s: StallSpec, hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  return s.open < s.close ? h >= s.open && h < s.close : h >= s.open || h < s.close;
};

class StreetFood {
  controllers: ThirdPersonControllerManager;
  crime: CrimeSystem;
  stands: Stand[];
  /** 100 m cells -> the stands in them (indices) */
  cells: Map<number, number[]>;
  group: THREE.Group;
  meshes: StandMeshes;
  meshList: THREE.InstancedMesh[];
  lights: THREE.PointLight[];
  people: Bystanders;
  /** The stands out round the camera this frame, nearest first */
  near: Stand[];
  /** The stand the player on foot can buy from */
  nearest: Stand | null;
  hour: number;
  steam: number;
  // (scratch for the frame's matrices)
  _m = new THREE.Matrix4();
  _q = new THREE.Quaternion();
  _p = new THREE.Vector3();
  _s = new THREE.Vector3(1, 1, 1);
  _c = new THREE.Color();
  _up = new THREE.Vector3(0, 1, 0);

  /**
   * @param o - scene; venues (venues.ts findVenues); pois (city-geodata.js); controllers (the ground, the
   *   sidewalks & the walls: player/controllers.ts); crime (money, health & toasts: sim/crime.ts)
   */
  constructor({ scene, venues, pois = [], controllers, crime }: { scene: THREE.Scene; venues: readonly StandVenue[]; pois?: readonly Poi[]; controllers: ThirdPersonControllerManager; crime: CrimeSystem }) {
    this.controllers = controllers;
    this.crime = crime;
    this.stands = [];
    // the taquerías & burger places that put a stand out at night (most of them: some stay a dining room only)
    for (const v of venues) {
      if (v.kind !== 'tacos' && v.kind !== 'burger') continue;
      if (hash(v.x, v.z, 1) > (v.kind === 'tacos' ? 0.7 : 0.6)) continue;
      // on the sidewalk just out of the door, turned to the street, a little to one side of it
      const side = (hash(v.x, v.z, 2) - 0.5) * Math.min(2, v.width * 0.3);
      this.addStand(v.kind, v.x + v.nx * 0.5 + v.ax * side, v.z + v.nz * 0.5 + v.az * side, v.heading, v.name);
    }
    // the carts: elotes at the parks & plazas, hot dogs outside the hospitals, universities, stadiums & bus stations
    for (const p of pois) {
      const kind: StallKind | null = p.kind === 'park' || p.kind === 'marketplace' ? 'elotes'
        : p.kind === 'hospital' || p.kind === 'university' || p.kind === 'stadium' || p.kind === 'bus_station' ? 'hotdog' : null;
      if (kind) this.addStand(kind, p.x, p.z, null, p.name, true);
    }
    this.cells = new Map();
    this.stands.forEach((s, i) => {
      const k = this.cellKey(Math.floor(s.x / 100), Math.floor(s.z / 100));
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(i);
    });

    this.group = new THREE.Group();
    this.group.name = 'StreetFood';
    scene.add(this.group);
    this.meshes = this.buildMeshes();
    this.meshList = Object.values(this.meshes);
    this.lights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffb366, 0, 11, 1.6);
      light.position.set(0, -1000, 0);
      light.visible = false;
      this.group.add(light);
      this.lights.push(light);
    }
    this.people = new Bystanders(scene, MAX_STANDS * 3, (x: number, z: number) => controllers.getGroundHeight(x, z, 'person'));
    this.near = [];
    this.nearest = null;
    this.hour = 12;
    this.steam = 0;
  }

  cellKey(ix: number, iz: number) {
    return ix * 100003 + iz;
  }

  // (`heading` null: a cart, turned once it is placed)
  addStand(kind: StallKind, x: number, z: number, heading: number | null, name: string, cart = false) {
    const spec = STALLS[kind];
    this.stands.push({
      kind, spec, x, z, heading: heading ?? 0, name, cart, placed: !cart && heading !== null, y: 0, distance: 0,
      lona: spec.lonas[Math.floor(hash(x, z, 3) * spec.lonas.length)],
      // the night it opens a little earlier or later, so the stands don't all appear at once
      early: (hash(x, z, 4) - 0.5) * 1.2,
      customers: 1 + Math.floor(hash(x, z, 5) * 4),
      seed: Math.floor(hash(x, z, 6) * 1e6)
    });
  }

  // A cart from OpenStreetMap's point goes onto the nearest open sidewalk (the point is a park's middle or a
  // hospital's roof), turned with its back to the wall; null if there is none within 45 m
  placeCart(s: Stand) {
    const c = this.controllers;
    s.placed = true;
    for (let r = 0; r <= 45; r += 3) {
      const n = Math.max(1, Math.round((r * Math.PI * 2) / 3));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + hash(s.x, s.z, 7);
        const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        if (!c.isPointOnSidewalk(x, z) || c.isSolidAt(x, z, 2, c.getGroundHeight(x, z, 'person'))) continue;
        s.x = x;
        s.z = z;
        s.heading = a;
        return;
      }
    }
    s.dead = true;
  }

  buildMeshes(): StandMeshes {
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n).translate(x, y, z);
    // (local frame: +z towards the street, the customers' side; the taquero behind at -z)
    const parts = {
      // the steel table & the plancha on it, the poles
      frame: mergeGeometries([
        box(1.9, 0.06, 0.8, 0, 0.92, 0), box(1.9, 0.86, 0.04, 0, 0.46, 0.38), box(0.05, 0.9, 0.05, -0.92, 0.45, -0.37),
        box(0.05, 0.9, 0.05, 0.92, 0.45, -0.37), cyl(0.025, 0.025, 2.3, -1.05, 1.15, -0.55, 6), cyl(0.025, 0.025, 2.3, 1.05, 1.15, -0.55, 6),
        cyl(0.025, 0.025, 2.0, -1.05, 1.0, 0.75, 6), cyl(0.025, 0.025, 2.0, 1.05, 1.0, 0.75, 6)
      ].map((g) => g.toNonIndexed())),
      plancha: box(0.9, 0.05, 0.55, 0.35, 0.98, -0.05),
      // the lona: a sheet sloping down to the street
      lona: new THREE.BoxGeometry(2.4, 0.03, 1.7).rotateX(0.18).translate(0, 2.18, 0.1),
      // the trompo al pastor: meat on its spit, a glowing grill behind it
      trompo: mergeGeometries([cyl(0.13, 0.19, 0.5, -0.55, 1.3, -0.15, 12), cyl(0.012, 0.012, 0.75, -0.55, 1.33, -0.15, 4)].map((g) => g.toNonIndexed())),
      grill: box(0.38, 0.6, 0.06, -0.55, 1.28, -0.4),
      bulb: new THREE.SphereGeometry(0.07, 8, 6).translate(0, 2.0, 0.1),
      // a cart: a box on two wheels under a parasol (elotes, hot dogs)
      cart: mergeGeometries([
        box(1.3, 0.75, 0.7, 0, 0.75, 0), cyl(0.28, 0.28, 0.06, -0.5, 0.28, 0.38).rotateX(0), cyl(0.18, 0.2, 0.42, 0.3, 1.33, 0, 12),
        cyl(0.02, 0.02, 1.9, 0, 1.75, -0.28, 6)
      ].map((g) => g.toNonIndexed())),
      parasol: new THREE.ConeGeometry(1.15, 0.45, 12, 1, true).translate(0, 2.85, -0.28),
      stools: mergeGeometries([cyl(0.17, 0.15, 0.45, -0.6, 0.225, 1.1, 10), cyl(0.17, 0.15, 0.45, 0.55, 0.225, 1.25, 10)].map((g) => g.toNonIndexed()))
    };
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0xb9bcbe, roughness: 0.35, metalness: 0.8 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1e1d1c, roughness: 0.5, metalness: 0.6 });
    const lona = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, side: THREE.DoubleSide });
    const meat = new THREE.MeshStandardNodeMaterial({ color: 0x9a3b14, roughness: 0.6, emissive: 0x4a1203 });
    const glow = new THREE.MeshBasicNodeMaterial({ color: 0xff7a1c });
    const bulb = new THREE.MeshBasicNodeMaterial({ color: 0xfff1c8 });
    const cartMat = new THREE.MeshStandardNodeMaterial({ color: 0xe9e4d8, roughness: 0.5, metalness: 0.3 });
    const plastic = new THREE.MeshStandardNodeMaterial({ color: 0xc42222, roughness: 0.55 });
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, colored = false) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_STANDS);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STANDS * 3).fill(1), 3);
      this.group.add(m);
      return m;
    };
    const meshes = {
      frame: inst(parts.frame, steel), plancha: inst(parts.plancha, dark), lona: inst(parts.lona, lona, true),
      trompo: inst(parts.trompo, meat), grill: inst(parts.grill, glow), bulb: inst(parts.bulb, bulb),
      cart: inst(parts.cart, cartMat), parasol: inst(parts.parasol, lona, true), stools: inst(parts.stools, plastic)
    };
    meshes.bulb.castShadow = meshes.grill.castShadow = false;
    return meshes;
  }

  isOut(s: Stand) {
    return openAt(s.spec, this.hour - s.early);
  }

  /**
   * The frame: which stands are out round the camera, drawn with their people, lights & steam; the stand the player
   * can buy from. `hour`: the local hour (lighting.js hourOfDay)
   */
  update(dt: number, hour: number, camera: THREE.Camera) {
    this.hour = hour;
    const cx = camera.position.x, cz = camera.position.z;
    const near = this.near;
    near.length = 0;
    const r = Math.ceil(DRAW_DISTANCE / 100);
    const ix0 = Math.floor(cx / 100), iz0 = Math.floor(cz / 100);
    for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      for (let iz = iz0 - r; iz <= iz0 + r; iz++) {
        for (const i of this.cells.get(this.cellKey(ix, iz)) ?? []) {
          const s = this.stands[i];
          const d = Math.hypot(s.x - cx, s.z - cz);
          if (d > DRAW_DISTANCE || !this.isOut(s)) continue;
          if (!s.placed) this.placeCart(s);
          if (s.dead) continue;
          s.distance = d;
          near.push(s);
        }
      }
    }
    near.sort(byDistance);
    if (near.length > MAX_STANDS) near.length = MAX_STANDS;

    const M = this.meshes;
    let stands = 0, carts = 0, trompos = 0;
    for (const s of near) {
      s.y = this.controllers.getGroundHeight(s.x, s.z, 'person');
      this._q.setFromAxisAngle(this._up, s.heading);
      this._m.compose(this._p.set(s.x, s.y, s.z), this._q, this._s);
      this._c.setHex(s.lona);
      if (s.cart) {
        const i = carts++;
        M.cart.setMatrixAt(i, this._m);
        M.parasol.setMatrixAt(i, this._m);
        M.parasol.setColorAt(i, this._c);
      } else {
        const i = stands++;
        for (const k of STAND_PARTS) M[k].setMatrixAt(i, this._m);
        M.lona.setColorAt(i, this._c);
        // only the taquerías turn a trompo
        if (s.kind === 'tacos') {
          M.trompo.setMatrixAt(trompos, this._m);
          M.grill.setMatrixAt(trompos++, this._m);
        }
      }
    }
    for (const k of STAND_PARTS) M[k].count = stands;
    M.trompo.count = M.grill.count = trompos;
    M.cart.count = M.parasol.count = carts;
    for (const m of this.meshList) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // the bulbs light the nearest stands' sidewalks after dark (a warm 60 W bare bulb)
    const dark = hour < 6.5 || hour > 18.6 ? 1 : 0;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = this.lights[i], s = near.at(i); // (undefined past the stands out)
      // (an unlit light is hidden: the clustered lighting takes 256 lights at most)
      light.visible = !!s && !!dark;
      if (!light.visible || !s) continue;
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      light.position.set(s.x + hx * 0.1, s.y + (s.cart ? 2.5 : 1.95), s.z + hz * 0.1);
      light.intensity = 9;
    }

    // the taquero behind the counter, the customers waiting in front of it
    const ppl = this.people;
    ppl.begin();
    for (const s of near) {
      if (s.distance > PEOPLE_DISTANCE) break;
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      const rx = hz, rz = -hx; // across the counter
      // (kept by number: the stand's seed x 8, the taquero 0, the customers 1..)
      ppl.place(s.seed * 8, s.x - hx * 0.85, s.z - hz * 0.85, s.heading, s.distance, s.seed, BYSTANDER_STYLES.stand);
      for (let k = 0; k < s.customers; k++) {
        const across = (k - (s.customers - 1) / 2) * 0.75 + (hash(s.seed, k, 8) - 0.5) * 0.3;
        const out = 1.0 + (k % 2) * 0.55 + hash(s.seed, k, 9) * 0.3;
        ppl.place(s.seed * 8 + k + 1, s.x + hx * out + rx * across, s.z + hz * out + rz * across, s.heading + Math.PI + (hash(s.seed, k, 10) - 0.5) * 0.8,
          s.distance, s.seed + k + 1, BYSTANDER_STYLES.stand);
      }
    }
    ppl.end(dt);

    // steam off the planchas & the elote pots of the nearest few (the player's car smoke system's puffs)
    this.steam += dt;
    if (this.steam > 0.25) {
      for (let i = 0; i < Math.min(4, near.length); i++) {
        const s = near[i];
        if (s.distance > 60) break;
        const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
        const lx = s.cart ? 0.3 : 0.35;
        this.controllers.puffSmoke(s.x + hz * lx, s.y + (s.cart ? 1.6 : 1.1), s.z - hx * lx, 0, 0, 1, 0.92, 0.5);
      }
      this.steam = 0;
    }

    // the stand at hand: the player on foot by its counter
    this.nearest = null;
    if (this.controllers.activeMode === 'person') {
      const p = this.controllers.entities.person.position;
      for (const s of near) {
        const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
        if (Math.hypot(p.x - (s.x + hx * 1.0), p.z - (s.z + hz * 1.0)) < REACH) {
          this.nearest = s;
          break;
        }
      }
    }
  }

  // What F would do here (main.ts updatePrompt): "Comprar tacos al pastor ($45)"
  prompt() {
    const s = this.nearest;
    return s ? `Comprar ${s.spec.item} ($${s.spec.price})` : '';
  }

  // F at a stand: pay & eat
  buy() {
    const s = this.nearest;
    const crime = this.crime;
    if (!s || crime.state !== 'play') return false;
    if (crime.money < s.spec.price) {
      crime.toast('No te alcanza');
      return true;
    }
    crime.money -= s.spec.price;
    crime.health = Math.min(100, crime.health + s.spec.heal);
    crime.toast(`¡Provecho! ${s.spec.item}, +${s.spec.heal} de salud`);
    return true;
  }

  // The stands out near (x, z) for the audio: the planchas' sizzle
  sounds(out: AmbientSource[]) {
    for (const s of this.near) {
      if (s.distance >= 40 || s.cart) continue;
      // (each stand's own sound record, filled in again every frame)
      const snd = (s.sound ??= { kind: 'sizzle', id: s, x: 0, y: 0, z: 0, gain: 0.5, range: 40 });
      snd.x = s.x;
      snd.y = s.y + 1;
      snd.z = s.z;
      out.push(snd);
    }
    return out;
  }
}

export { StreetFood, STALLS };
