import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from '../world/city-geodata.js';
import { blockAt, nearestRoads } from '../world/city-config.ts';
import type { ShotProp } from './crime/types.ts';
import type { FireKind } from './fires.ts';

// js/sim/gas-stations.ts
// Tepic's gas stations (the geodata's `fuel`, Overture Maps' places): a canopy over two pump islands laid on the lot
// beside each, along its street. Stopped by a pump in the car, it fills up (its tank: player/controllers' fuel) for
// the pesos it costs, and its flat tyres are mended; a pump shot to pieces, rammed hard or caught in a blast goes up, the other with it, and the
// station burns (the bomberos come, fires.ts); it stands again once the player has long gone.

interface XZ {
  x: number;
  z: number;
}
/** A pump: where (m), its ground (m), what it can take before it goes up (hp), whether it has */
interface Pump extends ShotProp {
  station: Station;
  hp: number;
  blown: boolean;
  /** s to its blast, once something set it off (the second goes up a moment after the first) */
  fuse: number;
  byPlayer: boolean;
  index: number; // its instance
}
/** A station: its canopy's middle (m), turn (rad: world = c + R_y(yaw)·local, local x along the street), name, pumps;
 *  burnt: s since it went up (0: whole) */
interface Station extends XZ {
  name: string;
  y: number;
  yaw: number;
  pumps: Pump[];
  burnt: number;
  index: number;
}
/** What the stations use of the rest: the walls & ground (player/controllers.ts), the car & its tank, the money &
 *  blasts (sim/crime.ts), the fires (sim/fires.ts) */
interface StationsWorld {
  scene: THREE.Object3D;
  isSolidAt(x: number, z: number, height?: number, ground?: number): boolean;
  groundAt(x: number, z: number): number;
  crime: {
    money: number;
    props: ShotProp[];
    toast(text: string): void;
    explode(x: number, y: number, z: number, radius: number, damage: number, byPlayer: boolean): void;
  };
  car: { speed: number; fuel: number; damage: { flats: number } };
  /** what the player is in (or on foot): where, how fast (m/s), half its length (m) */
  active(): { position: XZ; speed: number; halfL?: number };
  activeMode(): string;
  ignite(kind: FireKind, x: number, z: number, size?: number): unknown;
}

const TANK = 50; // L (player/controllers' FUEL_TANK)
const PRICE = 24; // $ a litre (Magna, 2026)
const FILL = 7; // L/s at the pump
const NEAR = 4.2; // m from a pump the car fills up at
const TYRE = 150; // $ a flat tyre mended there (the station's talachero)
const PUMP_HP = 120; // four pistol rounds, a short burst of the SMG's or the rifle's (sim/weapons.ts damage)
const RAM = 7; // m/s a car hitting a pump sets it off
const BLAST: [radius: number, damage: number] = [10, 170];
const CHAIN = 0.7; // s the second pump goes up after the first
const REBUILT = 240; // s a burnt station takes to stand again, once the player is REBUILD_AWAY m off
const REBUILD_AWAY = 450;
const CANOPY: [along: number, across: number, height: number] = [13, 8, 5]; // m
const PUMPS_AT = 3; // m either side of the canopy's middle, along the street

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

class GasStations {
  world: StationsWorld;
  stations: Station[];
  pumps: Pump[];
  canopy: THREE.InstancedMesh;
  ruin: THREE.InstancedMesh; // a burnt station's canopy, charred black
  pumpMesh: THREE.InstancedMesh;
  filling: Station | null = null;
  paid = 0; // $ this fill so far
  litres = 0;

  constructor(world: StationsWorld) {
    this.world = world;
    this.stations = [];
    this.pumps = [];
    for (const [x, z, name] of GEO.fuel) {
      const at = this.place(x, z);
      if (at) this.stations.push({ ...at, name, y: world.groundAt(at.x, at.z), pumps: [], burnt: 0, index: this.stations.length });
    }
    // the canopy: a white roof on four posts, its fascia in the station's green with a red band, over a concrete
    // forecourt; the islands, each a kerb with a white & red dispenser on it
    const [al, ac, ht] = CANOPY;
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    const green = new THREE.MeshStandardNodeMaterial({ color: 0x0b7a3e, roughness: 0.45 });
    const red = new THREE.MeshStandardNodeMaterial({ color: 0xce1126, roughness: 0.45 });
    const grey = new THREE.MeshStandardNodeMaterial({ color: 0x9a9a96, roughness: 0.8 });
    const posts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(box(0.4, ht, 0.4, sx * (al / 2 - 1.5), 0, sz * (ac / 2 - 1.2)));
    const canopyGeo = mergeGeometries([
      mergeGeometries([box(al, 0.35, ac, 0, ht, 0)]), mergeGeometries([box(al + 0.1, 0.55, ac + 0.1, 0, ht + 0.35, 0)]),
      mergeGeometries([box(al + 0.12, 0.14, ac + 0.12, 0, ht + 0.5, 0)]), mergeGeometries(posts),
      mergeGeometries([box(al + 4, 0.08, ac + 3, 0, 0, 0)])
    ], true);
    const concrete = new THREE.MeshStandardNodeMaterial({ color: 0xb8b5ad, roughness: 0.9 });
    this.canopy = new THREE.InstancedMesh(canopyGeo, [white, green, red, grey, concrete], Math.max(1, this.stations.length));
    const charred = new THREE.MeshStandardNodeMaterial({ color: 0x1d1b1a, roughness: 0.95, metalness: 0.1 });
    this.ruin = new THREE.InstancedMesh(mergeGeometries([box(al, 0.3, ac, 0, ht, 0), ...posts, box(al + 4, 0.08, ac + 3, 0, 0, 0)]), charred, Math.max(1, this.stations.length));
    const pumpGeo = mergeGeometries([
      mergeGeometries([box(3.2, 0.2, 1.0, 0, 0, 0)]), mergeGeometries([box(0.75, 1.75, 0.45, 0, 0.2, 0)]),
      mergeGeometries([box(0.78, 0.35, 0.48, 0, 1.6, 0)])
    ], true);
    this.pumpMesh = new THREE.InstancedMesh(pumpGeo, [grey, white, red], Math.max(1, this.stations.length * 2));
    for (const m of [this.canopy, this.ruin, this.pumpMesh]) {
      m.name = 'GasStations';
      m.castShadow = true;
      m.receiveShadow = true;
      world.scene.add(m);
    }
    for (const s of this.stations) {
      for (const side of [-1, 1]) {
        const ux = Math.cos(s.yaw), uz = -Math.sin(s.yaw); // (local x in the world)
        const p: Pump = {
          station: s, x: s.x + ux * side * PUMPS_AT, z: s.z + uz * side * PUMPS_AT, y: s.y, r: 0.55, top: 1.95, hp: PUMP_HP,
          blown: false, fuse: Infinity, byPlayer: false, index: this.pumps.length,
          shot: (damage, byPlayer) => { this.hurt(p, damage, byPlayer); }
        };
        s.pumps.push(p);
        this.pumps.push(p);
        world.crime.props.push(p);
      }
      this.draw(s);
    }
    this.canopy.count = this.ruin.count = this.stations.length;
    this.pumpMesh.count = this.pumps.length;
    this.canopy.computeBoundingSphere();
    this.ruin.computeBoundingSphere();
    this.pumpMesh.computeBoundingSphere();
  }

  /**
   * Where a station by (x, z) lays its forecourt: beside the street nearest it, along it, on open ground clear of the
   * buildings (the station's own shop, its neighbours), as near its point as can be. Null if no room nearby
   */
  place(x: number, z: number): { x: number; z: number; yaw: number } | null {
    const near = nearestRoads(x, z, 90).at(0);
    if (!near) return null;
    // the street's segment nearest it: its direction, and which side the station is on
    const pts = near.road.pts;
    let best = Infinity, qx = x, qz = z, ux = 1, uz = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < best) {
        best = d;
        qx = px;
        qz = pz;
        const l = Math.sqrt(l2);
        ux = dx / l;
        uz = dz / l;
      }
    }
    let nx = -uz, nz = ux; // (across the street, towards the station)
    if ((x - qx) * nx + (z - qz) * nz < 0) { nx = -nx; nz = -nz; }
    const along0 = 0, edge = near.road.w / 2 + 2.5 + CANOPY[1] / 2;
    const yaw = Math.atan2(-uz, ux);
    let found: { x: number; z: number; yaw: number } | null = null, foundD = Infinity;
    for (const along of [along0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25, 30, -30]) {
      for (let k = 0; k < 8; k++) {
        const cx = qx + ux * along + nx * (edge + k * 3), cz = qz + uz * along + nz * (edge + k * 3);
        const d = Math.hypot(cx - x, cz - z);
        if (d >= foundD || d > 55 || !this.clear(cx, cz, ux, uz, nx, nz)) continue;
        found = { x: cx, z: cz, yaw };
        foundD = d;
      }
    }
    return found;
  }

  // Is the forecourt round (cx, cz) open ground off the street: on a block (the curb's island, not the road), no wall
  // anywhere under the canopy?
  clear(cx: number, cz: number, ux: number, uz: number, nx: number, nz: number): boolean {
    const [al, ac] = CANOPY;
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 1; j++) {
        const x = cx + ux * (i * al / 4.4) + nx * (j * ac / 2.4), z = cz + uz * (i * al / 4.4) + nz * (j * ac / 2.4);
        if (!blockAt(x, z) || this.world.isSolidAt(x, z, 1.5, this.world.groundAt(x, z))) return false;
      }
    }
    return true;
  }

  // A station's canopy & pumps where it stands: whole, or burnt (its charred ruin, its pumps gone)
  draw(s: Station): void {
    _q.setFromAxisAngle(_up, s.yaw);
    _m.compose(_p.set(s.x, s.y, s.z), _q, _s);
    this.canopy.setMatrixAt(s.index, s.burnt ? HIDDEN : _m);
    this.ruin.setMatrixAt(s.index, s.burnt ? _m : HIDDEN);
    for (const p of s.pumps) {
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
      if (p.blown) _m.makeScale(0, 0, 0);
      this.pumpMesh.setMatrixAt(p.index, _m);
    }
    this.canopy.instanceMatrix.needsUpdate = true;
    this.ruin.instanceMatrix.needsUpdate = true;
    this.pumpMesh.instanceMatrix.needsUpdate = true;
  }

  // A round into pump p: past what it can take, it goes up
  hurt(p: Pump, damage: number, byPlayer: boolean): void {
    if (p.blown) return;
    p.hp -= damage;
    if (p.hp <= 0) this.setOff(p, 0, byPlayer);
  }

  // Pump p to go up in `fuse` s (the player's doing or not)
  setOff(p: Pump, fuse: number, byPlayer: boolean): void {
    if (p.blown || p.fuse <= fuse) return;
    p.fuse = fuse;
    p.byPlayer ||= byPlayer;
  }

  // A blast (crime.ts explode): the pumps it reaches go up too
  onExplosion(x: number, _y: number, z: number, radius: number): void {
    for (const p of this.pumps) if (!p.blown && Math.hypot(p.x - x, p.z - z) < radius * 0.8 + 1) this.setOff(p, CHAIN * 0.5, false);
  }

  // Pump p goes up: a blast, the other pump after it, the station burning (the bomberos are called, fires.ts)
  blow(p: Pump): void {
    p.blown = true;
    p.fuse = Infinity;
    const s = p.station;
    const w = this.world;
    w.crime.explode(p.x, p.y + 1, p.z, BLAST[0], BLAST[1], p.byPlayer);
    for (const o of s.pumps) this.setOff(o, CHAIN, p.byPlayer);
    if (!s.burnt) {
      s.burnt = 1e-3;
      w.ignite('house', s.x, s.z, 12);
      w.crime.toast(`${s.name} went up`);
    }
    this.draw(s);
  }

  /**
   * The frame: fuses burning down, pumps rammed, the car filling up by a pump, burnt stations standing again once the
   * player is far
   */
  update(dt: number): void {
    const w = this.world;
    const me = w.active(), player = me.position;
    for (const p of this.pumps) {
      if (p.blown) continue;
      p.fuse -= dt;
      if (p.fuse <= 0) this.blow(p);
    }
    const mode = w.activeMode();
    const driving = mode === 'car' || mode === 'moto';
    let at: Pump | null = null;
    for (const p of this.pumps) {
      if (p.blown || Math.abs(p.x - player.x) > 12 || Math.abs(p.z - player.z) > 12) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      // driven into hard: it goes up
      if (driving && d < (me.halfL ?? 1) * 0.6 + 0.6 && Math.abs(me.speed) > RAM) this.setOff(p, 0, true);
      else if (mode === 'car' && d < NEAR) at = p;
    }
    this.fill(at, dt);
    for (const s of this.stations) {
      if (!s.burnt) continue;
      s.burnt += dt;
      if (s.burnt > REBUILT && Math.hypot(s.x - player.x, s.z - player.z) > REBUILD_AWAY) {
        s.burnt = 0;
        for (const p of s.pumps) {
          p.blown = false;
          p.hp = PUMP_HP;
          p.byPlayer = false;
        }
        this.draw(s);
      }
    }
  }

  // Stopped by pump `at` (or null: not by one): the tank filling, paid for litre by litre, the bill once it's full
  fill(at: Pump | null, dt: number): void {
    const w = this.world, car = w.car;
    // its flat tyres mended first, if there's the money for them
    const flats = car.damage.flats;
    if (at && flats && Math.abs(car.speed) < 0.6) {
      let n = 0;
      for (let b = flats; b; b >>= 1) n += b & 1;
      if (w.crime.money >= n * TYRE) {
        w.crime.money -= n * TYRE;
        car.damage.flats = 0;
        w.crime.toast(`Tyres mended: $${n * TYRE}`);
      }
    }
    const wants = at && Math.abs(car.speed) < 0.6 && car.fuel < TANK - 0.05;
    if (!wants) {
      if (this.filling && this.litres > 0.5) w.crime.toast(`Gas: ${Math.round(this.litres)} L, $${Math.round(this.paid)}`);
      this.filling = null;
      this.litres = this.paid = 0;
      return;
    }
    if (!this.filling) {
      this.filling = at.station;
      w.crime.toast(`${at.station.name}: filling up`);
    }
    const litres = Math.min(FILL * dt, TANK - car.fuel, w.crime.money / PRICE);
    if (litres <= 0) {
      if (w.crime.money < PRICE) w.crime.toast('Not enough money for gas');
      this.filling = null;
      return;
    }
    car.fuel += litres;
    w.crime.money -= litres * PRICE;
    this.litres += litres;
    this.paid += litres * PRICE;
    if (car.fuel >= TANK - 0.05) {
      w.crime.money = Math.floor(w.crime.money);
      w.crime.toast(`Full tank: ${Math.round(this.litres)} L, $${Math.round(this.paid)}`);
      this.litres = this.paid = 0;
    }
  }

  // The stations on the radar
  blips(out: (string | number)[]): (string | number)[] {
    for (const s of this.stations) if (!s.burnt) out.push('fuel', s.x, s.z);
    return out;
  }
}

export type { Pump, Station, StationsWorld };
export { GasStations };
