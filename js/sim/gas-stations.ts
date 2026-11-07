// js/sim/gas-stations.ts
// Tepic's gas stations (the geodata's `fuel`, Overture Maps' places and OpenStreetMap's), each laid out before the town
// is built (world/gas-station-plan.ts: a forecourt as big as the real one, along its street, its way in at one end and
// its way out at the other): the concrete forecourt and its driveways over the curb (rampAt), a canopy over rows of
// pump islands, the islands solid, and the customers' cars coming in, queuing for a pump, filling up and driving off
// (gas-stations/customers.ts). Stopped by a pump in the car, G (refuel) fills it up (its tank: player/controllers'
// fuel) for the pesos it costs, and mends its flat tyres; a pump shot to pieces, rammed hard or caught in a blast goes
// up, the others with it, and the station burns (the bomberos come, fires.ts); it stands again once the player has
// long gone.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ShotProp } from './crime/types.ts';
import type { FireKind } from './fires.ts';
import { boxHit } from './mayhem.ts';
import { Customers } from './gas-stations/customers.ts';
import { SW_TOP, RAMP_OUT, RAMP_IN, rampHeight, rampTriangles } from '../world/car-parks.ts';
import type { Ramp } from '../world/car-parks.ts';
import { drapeGeometry } from '../world/drape.ts';
import { townHeight } from '../world/ground.ts';
import type { StationPlan } from '../world/gas-station-plan.ts';
import type { PlayerCollider } from '../player/controllers/types.ts';
import { t } from '../i18n/i18n.ts';

interface XZ {
  x: number;
  z: number;
}
/** A pump: where (m), its ground (m), what it can take before it goes up (hp), whether it has */
interface Pump extends ShotProp {
  station: Station;
  hp: number;
  blown: boolean;
  /** s to its blast, once something set it off (the others go up a moment after the first) */
  fuse: number;
  byPlayer: boolean;
  index: number; // its instance
  collider: PlayerCollider; // its island, solid to the player and the car (broken: gone with it)
}
/** A station: its forecourt's middle (m), turn (rad: world = c + R_y(yaw)·local, local x along the street), name,
 *  pumps, its driveways' ramps over the curb, its plan; burnt: s since it went up (0: whole) */
interface Station extends XZ {
  name: string;
  y: number;
  yaw: number;
  pumps: Pump[];
  drives: Ramp[];
  plan: StationPlan;
  burnt: number;
  index: number;
}
/** What the stations use of the rest: the ground (player/controllers.ts), the car & its tank, the money & blasts
 *  (sim/crime.ts), the fires (sim/fires.ts) */
interface StationsWorld {
  scene: THREE.Object3D;
  groundAt(x: number, z: number): number;
  crime: {
    money: number;
    props: ShotProp[];
    toast(text: string): void;
    explode(x: number, y: number, z: number, radius: number, damage: number, byPlayer: boolean): void;
  };
  car: { speed: number; fuel: number; damage: { flats: number } };
  /** what the player is in (or on foot): where, its heading (rad), how fast (m/s), half its width & length (m) */
  active(): { position: XZ; heading: number; speed: number; halfW?: number; halfL?: number };
  /** the pumps' islands & the canopies' posts made solid (player/controllers.ts: walls for the player, the car's physics) */
  addColliders(list: PlayerCollider[]): void;
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
const CHAIN = 0.7; // s the next pump goes up after the first
const REBUILT = 240; // s a burnt station takes to stand again, once the player is REBUILD_AWAY m off
const REBUILD_AWAY = 450;
const CANOPY_H = 5.4; // m: the canopy's underside
const ISLAND: [halfLong: number, halfWide: number] = [2.4, 0.6]; // m: a pump's island (gas-station-plan.ts ISLAND_L)
const ISLAND_END = ISLAND[0] - ISLAND[1]; // m from the pump to the middle of each of its island's rounded ends
const POST_AT = ISLAND[0] - 0.35; // m from an island's middle to the canopy's posts standing on its ends
const LOT_Y = SW_TOP + 0.018; // m over the town's floor the forecourt lies, a hair over the block's ground (as a car park)
const RAMP_CELL = 16; // m: the cells the ramps are found by (rampAt)

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z).toNonIndexed();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

class GasStations {
  world: StationsWorld;
  stations: Station[];
  pumps: Pump[];
  canopy: THREE.InstancedMesh; // a station's roof, 1 m square scaled to its size
  ruin: THREE.InstancedMesh; // a burnt station's roof, charred black
  posts: THREE.InstancedMesh;
  pumpMesh: THREE.InstancedMesh;
  customers: Customers;
  filling: Station | null = null;
  paid = 0; // $ this fill so far
  litres = 0;
  broke = false; // (told there's not the money for it: till the car leaves the pump)
  lastSpeed = 0; // m/s the player went at last frame (a ram is judged by the speed it came in at, not what the island left)
  at: Pump | null = null; // the pump the car stands by (update)
  wanted = false; // the player asked for a fill there (refuel: G)
  rampCells = new Map<number, Ramp[]>();

  /** `plans`: the stations as laid out (world/gas-station-plan.ts, by app/city.ts) */
  constructor(world: StationsWorld, plans: readonly StationPlan[]) {
    this.world = world;
    this.stations = plans.map((plan, index) => ({
      x: plan.x, z: plan.z, name: plan.name, yaw: plan.yaw, plan, y: world.groundAt(plan.x, plan.z), pumps: [], burnt: 0, index,
      drives: plan.drives.map((d) => ({ x: d.x, z: d.z, nx: d.nx, nz: d.nz, half: d.half, top: LOT_Y + 0.004 }))
    }));
    this.pumps = [];
    // the ramps by RAMP_CELL cell (rampAt)
    for (const s of this.stations) {
      for (const r of s.drives) {
        const reach = RAMP_OUT + r.half;
        for (let ix = Math.floor((r.x - reach) / RAMP_CELL); ix <= Math.floor((r.x + reach) / RAMP_CELL); ix++) {
          for (let iz = Math.floor((r.z - reach) / RAMP_CELL); iz <= Math.floor((r.z + reach) / RAMP_CELL); iz++) {
            const k = ix * 4096 + iz;
            let list = this.rampCells.get(k);
            if (!list) this.rampCells.set(k, (list = []));
            list.push(r);
          }
        }
      }
    }
    // the canopy: a white roof, its fascia in the station's green with a red band, on grey posts standing on the islands'
    // ends; the islands, each a kerb with a white & red dispenser on it (the concrete forecourt under them is laid on the
    // ground: forecourts)
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    const green = new THREE.MeshStandardNodeMaterial({ color: 0x0b7a3e, roughness: 0.45 });
    const red = new THREE.MeshStandardNodeMaterial({ color: 0xce1126, roughness: 0.45 });
    const grey = new THREE.MeshStandardNodeMaterial({ color: 0x9a9a96, roughness: 0.8 });
    const n = Math.max(1, this.stations.length);
    // (1 m square, scaled to each canopy: the fascia and its band stand a little proud of the roof, its top white)
    const roofGeo = mergeGeometries([
      mergeGeometries([box(1, 0.35, 1, 0, 0, 0), box(0.99, 0.02, 0.98, 0, 0.9, 0)]), box(1.008, 0.6, 1.02, 0, 0.3, 0),
      box(1.012, 0.14, 1.03, 0, 0.55, 0)
    ], true);
    this.canopy = new THREE.InstancedMesh(roofGeo, [white, green, red], n);
    const charred = new THREE.MeshStandardNodeMaterial({ color: 0x1d1b1a, roughness: 0.95, metalness: 0.1 });
    this.ruin = new THREE.InstancedMesh(box(1, 0.3, 1, 0, 0, 0), charred, n);
    const postCount = Math.max(1, this.stations.reduce((t, s) => t + s.plan.islands.length * 2, 0));
    this.posts = new THREE.InstancedMesh(box(0.4, CANOPY_H, 0.4, 0, 0, 0), grey, postCount);
    this.forecourts(world.scene);
    const pumpGeo = mergeGeometries([
      box(ISLAND[0] * 2, 0.2, ISLAND[1] * 2, 0, 0, 0), box(0.75, 1.75, 0.45, 0, 0.2, 0), box(0.78, 0.35, 0.48, 0, 1.6, 0)
    ], true);
    this.pumpMesh = new THREE.InstancedMesh(pumpGeo, [grey, white, red], Math.max(1, this.stations.reduce((t, s) => t + s.plan.islands.length, 0)));
    for (const m of [this.canopy, this.ruin, this.posts, this.pumpMesh]) {
      m.name = 'GasStations';
      m.castShadow = true;
      m.receiveShadow = true;
      world.scene.add(m);
    }
    const colliders: PlayerCollider[] = [];
    let post = 0;
    for (const s of this.stations) {
      const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const ux = cs, uz = -sn; // (local x in the world)
      _q.setFromAxisAngle(_up, s.yaw);
      for (const { x, z } of s.plan.islands) {
        // (the island's box turned with the station: its length along the street, as boarding.ts leaveCarBehind's; waist
        // high, so a round aimed at the dispenser over it isn't stopped by it)
        const hx = ISLAND[0], hz = ISLAND[1];
        const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
        const collider: PlayerCollider = {
          minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: s.y - 0.3, maxY: s.y + 0.9, obb: { cx: x, cz: z, hx, hz, cs, sn }, broken: false
        };
        const p: Pump = {
          station: s, x, z, y: s.y, r: 0.55, top: 1.95, hp: PUMP_HP, blown: false, fuse: Infinity, byPlayer: false,
          index: this.pumps.length, collider, shot: (damage, byPlayer) => { this.hurt(p, damage, byPlayer); }
        };
        s.pumps.push(p);
        this.pumps.push(p);
        world.crime.props.push(p);
        colliders.push(collider);
        // its two posts, up to the roof (they stand through a fire: the ruin's roof on them)
        for (const side of [-1, 1]) {
          const px = x + ux * side * POST_AT, pz = z + uz * side * POST_AT;
          this.posts.setMatrixAt(post++, _m.compose(_p.set(px, s.y, pz), _q, _one));
          colliders.push({ minX: px - 0.25, maxX: px + 0.25, minZ: pz - 0.25, maxZ: pz + 0.25, minY: s.y, maxY: s.y + CANOPY_H });
        }
      }
      this.draw(s);
    }
    world.addColliders(colliders);
    this.canopy.count = this.ruin.count = this.stations.length;
    this.posts.count = post;
    this.pumpMesh.count = this.pumps.length;
    for (const m of [this.canopy, this.ruin, this.posts, this.pumpMesh]) m.computeBoundingSphere();
    this.customers = new Customers(world, this.stations);
  }

  // The forecourts and their driveways, in concrete laid on the town's slopes: each forecourt the size of its plan, the
  // ramps up over the curb (car-parks.ts's), the way on across the sidewalk to it. A station up on a hill (ground.ts:
  // its ground over the town's floor) has its forecourt flat where the canopy stands instead, not buried under it
  forecourts(scene: THREE.Object3D): void {
    const tris: number[] = [], onHills: number[] = [];
    let out = tris;
    // (a flat quad, its two triangles wound to face up)
    const quad = (pts: readonly [number, number][], y: number) => {
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        const A = pts[a], B = pts[b], C = pts[c];
        const up = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) > 0;
        const [P, Q] = up ? [B, C] : [C, B];
        out.push(A[0], y, A[1], P[0], y, P[1], Q[0], y, Q[1]);
      }
    };
    for (const s of this.stations) {
      const { ux, uz, nx, nz, along: fa, deep: fc } = s.plan;
      const at = (a: number, c: number): [number, number] => [s.x + ux * a + nx * c, s.z + uz * a + nz * c];
      const hill = s.y - townHeight(s.x, s.z) - SW_TOP > 0.1;
      out = hill ? onHills : tris;
      const y = hill ? s.y + LOT_Y - SW_TOP : LOT_Y; // (on a hill: over its ground, in the world's own heights)
      quad([at(-fa / 2, -fc / 2), at(fa / 2, -fc / 2), at(fa / 2, fc / 2), at(-fa / 2, fc / 2)], y);
      s.drives.forEach((r, k) => {
        if (!hill) rampTriangles(tris, r);
        // (from the ramp's top across the sidewalk to the forecourt's front)
        const len = s.plan.drives[k].depth + 0.3;
        if (len <= RAMP_IN) return;
        const tx = -r.nz * r.half, tz = r.nx * r.half;
        const a = [r.x + r.nx * RAMP_IN, r.z + r.nz * RAMP_IN], b = [r.x + r.nx * len, r.z + r.nz * len];
        quad([[a[0] - tx, a[1] - tz], [a[0] + tx, a[1] + tz], [b[0] + tx, b[1] + tz], [b[0] - tx, b[1] - tz]], y + 0.002);
      });
    }
    const material = new THREE.MeshStandardNodeMaterial({ color: 0xb8b5ad, roughness: 0.9 });
    for (const [list, draped] of [[tris, true], [onHills, false]] as const) {
      if (!list.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(draped ? drapeGeometry(g) : g, material);
      mesh.name = 'GasStationForecourts';
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  /** The height of a driveway's ramp over the curb at (x, z) (m over the town's floor), -1 off them (as car-parks.ts
   *  rampAt: what the player and the car stand on) */
  rampAt = (x: number, z: number): number => {
    const list = this.rampCells.get(Math.floor(x / RAMP_CELL) * 4096 + Math.floor(z / RAMP_CELL));
    if (!list) return -1;
    for (const r of list) {
      const dx = x - r.x, dz = z - r.z;
      const s = dx * r.nx + dz * r.nz, t = dz * r.nx - dx * r.nz;
      if (s >= -RAMP_OUT && s <= RAMP_IN && Math.abs(t) <= r.half) return rampHeight(r, s);
    }
    return -1;
  };

  // A station's canopy & pumps where it stands: whole, or burnt (its charred ruin, its pumps gone)
  draw(s: Station): void {
    const { ux, uz, nx, nz, canopy: c } = s.plan;
    _q.setFromAxisAngle(_up, s.yaw);
    _m.compose(_p.set(s.x + ux * c.u + nx * c.v, s.y + CANOPY_H, s.z + uz * c.u + nz * c.v), _q, _s.set(c.along, 1, c.across));
    this.canopy.setMatrixAt(s.index, s.burnt ? HIDDEN : _m);
    this.ruin.setMatrixAt(s.index, s.burnt ? _m : HIDDEN);
    for (const p of s.pumps) {
      _m.compose(_p.set(p.x, p.y, p.z), _q, _one);
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

  // Pump p goes up: a blast, the others after it, the station burning (the bomberos are called, fires.ts), its
  // customers gone
  blow(p: Pump): void {
    p.blown = true;
    p.collider.broken = true;
    p.fuse = Infinity;
    const s = p.station;
    const w = this.world;
    w.crime.explode(p.x, p.y + 1, p.z, BLAST[0], BLAST[1], p.byPlayer);
    s.pumps.forEach((o, k) => { this.setOff(o, CHAIN * (1 + Math.abs(k - s.pumps.indexOf(p)) * 0.4), p.byPlayer); });
    if (!s.burnt) {
      s.burnt = 1e-3;
      w.ignite('house', s.x, s.z, Math.min(30, Math.max(12, s.plan.canopy.along / 2)));
      w.crime.toast(t('toast.stationBlew', { station: s.name }));
      this.customers.clear(s);
    }
    this.draw(s);
  }

  /**
   * The frame: fuses burning down, pumps rammed, the car filling up by a pump, the customers' cars, burnt stations
   * standing again once the player is far
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
      // driven into hard (its box, a little grown, reaching the island: two circles along it): it goes up
      let hit = false;
      if (driving && Math.max(Math.abs(me.speed), this.lastSpeed) > RAM) {
        const ux = Math.cos(p.station.yaw) * ISLAND_END, uz = -Math.sin(p.station.yaw) * ISLAND_END;
        const hw = (me.halfW ?? 0.5) + 0.3, hl = (me.halfL ?? 1) + 0.3;
        hit = boxHit(player.x, player.z, me.heading, hw, hl, p.x + ux, p.z + uz, ISLAND[1]) !== null ||
          boxHit(player.x, player.z, me.heading, hw, hl, p.x - ux, p.z - uz, ISLAND[1]) !== null;
      }
      if (hit) this.setOff(p, 0, true);
      else if (mode === 'car' && Math.hypot(p.x - player.x, p.z - player.z) < NEAR && (!at || Math.hypot(p.x - player.x, p.z - player.z) < Math.hypot(at.x - player.x, at.z - player.z))) at = p;
    }
    this.lastSpeed = driving ? Math.abs(me.speed) : 0;
    // (driven off the pump: asked afresh at the next)
    if (at !== this.at) this.wanted = false;
    this.at = at;
    this.fill(at, dt);
    this.customers.update(dt);
    for (const s of this.stations) {
      if (!s.burnt) continue;
      s.burnt += dt;
      if (s.burnt > REBUILT && Math.hypot(s.x - player.x, s.z - player.z) > REBUILD_AWAY) {
        s.burnt = 0;
        for (const p of s.pumps) {
          p.blown = p.collider.broken = false;
          p.hp = PUMP_HP;
          p.byPlayer = false;
        }
        this.draw(s);
      }
    }
  }

  // Whether the car stands still by a pump, with a tank to fill or a tyre to mend
  servable(): boolean {
    const car = this.world.car;
    return this.at !== null && Math.abs(car.speed) < 0.6 && (car.fuel < TANK - 0.5 || car.damage.flats !== 0);
  }

  /** G (refuel), or the touch button by a pump: fill up there (its flat tyres mended first, if there's the money for
   *  them), or stop filling. Whether it was by a pump to do so */
  refuel(): boolean {
    if (!this.servable() && !this.filling) return false;
    this.wanted = !this.filling;
    this.broke = false;
    const w = this.world, car = w.car;
    const flats = car.damage.flats;
    if (this.wanted && flats) {
      let n = 0;
      for (let b = flats; b; b >>= 1) n += b & 1;
      if (w.crime.money >= n * TYRE) {
        w.crime.money -= n * TYRE;
        car.damage.flats = 0;
        w.crime.toast(t('toast.tyres', { cost: n * TYRE }));
      } else w.crime.toast(t('toast.noTyreMoney'));
    }
    return true;
  }

  /** What G would do here, in the player's language ('' for nothing): fill up, at so much a litre, or stop */
  prompt(): string {
    if (this.world.activeMode() !== 'car') return '';
    if (this.filling) return t('prompt.refuelStop');
    return this.servable() ? t('prompt.refuel', { price: PRICE }) : '';
  }

  // Stopped by pump `at` (or null: not by one): the tank filling, once asked (refuel), paid for litre by litre, the
  // bill once it's full or the filling stopped
  fill(at: Pump | null, dt: number): void {
    const w = this.world, car = w.car;
    const wants = this.wanted && at && Math.abs(car.speed) < 0.6 && car.fuel < TANK - 0.05;
    if (!at) this.broke = false;
    if (!wants || this.broke) {
      if (this.filling && this.litres > 0.5) w.crime.toast(t('toast.gas', { litres: Math.round(this.litres), paid: Math.round(this.paid) }));
      // (paid in whole pesos)
      if (this.filling) w.crime.money = Math.floor(w.crime.money);
      this.filling = null;
      this.litres = this.paid = 0;
      return;
    }
    if (!this.filling) {
      this.filling = at.station;
      w.crime.toast(t('toast.filling', { station: at.station.name }));
    }
    const litres = Math.min(FILL * dt, TANK - car.fuel, w.crime.money / PRICE);
    if (litres <= 0) {
      w.crime.toast(t('toast.noGasMoney'));
      this.broke = true;
      return;
    }
    car.fuel += litres;
    w.crime.money -= litres * PRICE;
    this.litres += litres;
    this.paid += litres * PRICE;
    if (car.fuel >= TANK - 0.05) {
      w.crime.money = Math.floor(w.crime.money);
      w.crime.toast(t('toast.fullTank', { litres: Math.round(this.litres), paid: Math.round(this.paid) }));
      this.litres = this.paid = 0;
      this.filling = null;
      this.wanted = false;
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
