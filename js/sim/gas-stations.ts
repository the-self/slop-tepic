// js/sim/gas-stations.ts
// Tepic's gas stations (the geodata's `fuel`, Overture Maps' places): a canopy over two pump islands on a concrete
// forecourt laid on the lot beside each, along its street, two driveways in from the street over the curb (rampAt),
// the islands solid. Stopped by a pump in the car, G (refuel) fills it up (its tank: player/controllers' fuel) for the
// pesos it costs, and mends its flat tyres; a pump shot to pieces, rammed hard
// or caught in a blast goes up, the other with it, and the station burns (the bomberos come, fires.ts); it stands
// again once the player has long gone.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from '../world/city-geodata.js';
import { blockAt, nearestRoads } from '../world/city-config.ts';
import type { ShotProp } from './crime/types.ts';
import type { FireKind } from './fires.ts';
import { boxHit } from './mayhem.ts';
import { SW_TOP, RAMP_OUT, RAMP_IN, rampHeight, rampTriangles } from '../world/car-parks.ts';
import type { Ramp } from '../world/car-parks.ts';
import { drapeGeometry } from '../world/drape.ts';
import { townHeight } from '../world/ground.ts';
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
  /** s to its blast, once something set it off (the second goes up a moment after the first) */
  fuse: number;
  byPlayer: boolean;
  index: number; // its instance
  collider: PlayerCollider; // its island, solid to the player and the car (broken: gone with it)
}
/** A station: its canopy's middle (m), turn (rad: world = c + R_y(yaw)·local, local x along the street), name, pumps,
 *  its driveways' ramps over the curb; burnt: s since it went up (0: whole) */
interface Station extends XZ {
  name: string;
  y: number;
  yaw: number;
  pumps: Pump[];
  drives: Ramp[];
  burnt: number;
  index: number;
}
/** What the stations use of the rest: the walls & ground (player/controllers.ts), the car & its tank, the money &
 *  blasts (sim/crime.ts), the fires (sim/fires.ts) */
interface StationsWorld {
  scene: THREE.Object3D;
  isSolidAt(x: number, z: number, height?: number, ground?: number, minSize?: number): boolean;
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
  /** the pumps' islands made solid (player/controllers.ts: walls for the player, the car's physics) */
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
const CHAIN = 0.7; // s the second pump goes up after the first
const REBUILT = 240; // s a burnt station takes to stand again, once the player is REBUILD_AWAY m off
const REBUILD_AWAY = 450;
const CANOPY: [along: number, across: number, height: number] = [13, 8, 5]; // m
const PUMPS_AT = 3; // m either side of the canopy's middle, along the street
const ISLAND: [halfLong: number, halfWide: number] = [1.6, 0.5]; // m: a pump's island
const ISLAND_END = ISLAND[0] - ISLAND[1]; // m from the pump to the middle of each of its island's rounded ends
const FORECOURT: [along: number, across: number] = [CANOPY[0] + 4, CANOPY[1] + 3]; // m of concrete round the canopy
const LOT_Y = SW_TOP + 0.018; // m over the town's floor the forecourt lies, a hair over the block's ground (as a car park)
const DRIVE_W = 4.5; // m: a driveway's width
const DRIVE_AT = FORECOURT[0] / 2 - DRIVE_W / 2 - 0.4; // m either side of the middle the two driveways come in
const RAMP_CELL = 16; // m: the cells the ramps are found by (rampAt)

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
  broke = false; // (told there's not the money for it: till the car leaves the pump)
  lastSpeed = 0; // m/s the player went at last frame (a ram is judged by the speed it came in at, not what the island left)
  at: Pump | null = null; // the pump the car stands by (update)
  wanted = false; // the player asked for a fill there (refuel: G)
  rampCells = new Map<number, Ramp[]>();

  constructor(world: StationsWorld) {
    this.world = world;
    this.stations = [];
    this.pumps = [];
    for (const [x, z, name] of GEO.fuel) {
      const at = this.place(x, z);
      if (at) this.stations.push({ ...at, name, y: world.groundAt(at.x, at.z), pumps: [], burnt: 0, index: this.stations.length });
    }
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
    // the canopy: a white roof on four posts, its fascia in the station's green with a red band; the islands, each a
    // kerb with a white & red dispenser on it (the concrete forecourt under them is laid on the ground: forecourts)
    const [al, ac, ht] = CANOPY;
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.5 });
    const green = new THREE.MeshStandardNodeMaterial({ color: 0x0b7a3e, roughness: 0.45 });
    const red = new THREE.MeshStandardNodeMaterial({ color: 0xce1126, roughness: 0.45 });
    const grey = new THREE.MeshStandardNodeMaterial({ color: 0x9a9a96, roughness: 0.8 });
    const posts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push(box(0.4, ht, 0.4, sx * (al / 2 - 1.5), 0, sz * (ac / 2 - 1.2)));
    const canopyGeo = mergeGeometries([
      mergeGeometries([box(al, 0.35, ac, 0, ht, 0)]), mergeGeometries([box(al + 0.1, 0.55, ac + 0.1, 0, ht + 0.35, 0)]),
      mergeGeometries([box(al + 0.12, 0.14, ac + 0.12, 0, ht + 0.5, 0)]), mergeGeometries(posts)
    ], true);
    this.canopy = new THREE.InstancedMesh(canopyGeo, [white, green, red, grey], Math.max(1, this.stations.length));
    const charred = new THREE.MeshStandardNodeMaterial({ color: 0x1d1b1a, roughness: 0.95, metalness: 0.1 });
    this.ruin = new THREE.InstancedMesh(mergeGeometries([box(al, 0.3, ac, 0, ht, 0), ...posts]), charred, Math.max(1, this.stations.length));
    this.forecourts(world.scene);
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
        const x = s.x + ux * side * PUMPS_AT, z = s.z + uz * side * PUMPS_AT;
        // (the island's box turned with the station: its length along the street, as boarding.ts leaveCarBehind's; waist
        // high, so a round aimed at the dispenser over it isn't stopped by it)
        const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), hx = ISLAND[0], hz = ISLAND[1];
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
      }
      this.draw(s);
    }
    world.addColliders(this.pumps.map((p) => p.collider));
    this.canopy.count = this.ruin.count = this.stations.length;
    this.pumpMesh.count = this.pumps.length;
    this.canopy.computeBoundingSphere();
    this.ruin.computeBoundingSphere();
    this.pumpMesh.computeBoundingSphere();
  }

  /**
   * Where a station by (x, z) lays its forecourt: beside the street nearest it, along it, on open ground clear of the
   * buildings (the station's own shop, its neighbours) with a way in from the street, as near its point as can be
   * (where nowhere near has a clear way in, the nearest all the same, its driveways as they come). Null if no room
   */
  place(x: number, z: number): { x: number; z: number; yaw: number; drives: Ramp[] } | null {
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
    type Spot = { x: number; z: number; yaw: number; drives: Ramp[] } | null;
    let found: Spot = null, foundD = Infinity;
    let blocked: Spot = null, blockedD = Infinity; // (the nearest without a clear way in)
    for (const along of [along0, 5, -5, 10, -10, 15, -15, 20, -20, 25, -25, 30, -30]) {
      for (let k = 0; k < 8; k++) {
        const cx = qx + ux * along + nx * (edge + k * 3), cz = qz + uz * along + nz * (edge + k * 3);
        const d = Math.hypot(cx - x, cz - z);
        if (d >= Math.max(foundD, blockedD) || d > 55 || !this.clear(cx, cz, ux, uz, nx, nz)) continue;
        const drives = this.driveways(qx + ux * along, qz + uz * along, ux, uz, nx, nz, edge + k * 3);
        if (drives.some((r) => r.open) && d < foundD) {
          found = { x: cx, z: cz, yaw, drives: drives.filter((r) => r.open) };
          foundD = d;
        } else if (!found && d < blockedD) {
          blocked = { x: cx, z: cz, yaw, drives };
          blockedD = d;
        }
      }
    }
    return found ?? blocked;
  }

  // The ways in from the street to a forecourt `depth` m off the road's middle at (rx, rz) (u along the road, n across it
  // towards the forecourt), one near either end of it: from the curb (where the block's ground starts) across the
  // sidewalk; open where nothing stands in the way (a wall, a barda: not a pole, driven round). Their ramps over the curb
  driveways(rx: number, rz: number, ux: number, uz: number, nx: number, nz: number, depth: number): (Ramp & { open: boolean })[] {
    const out: (Ramp & { open: boolean })[] = [];
    const reach = depth - FORECOURT[1] / 2; // m from the road's middle to the forecourt's edge
    const w = this.world;
    for (const side of [-1, 1]) {
      const bx = rx + ux * side * DRIVE_AT, bz = rz + uz * side * DRIVE_AT;
      let curb = -1;
      for (let t = 0; t <= reach; t += 0.25) {
        if (blockAt(bx + nx * t, bz + nz * t)) {
          curb = t;
          break;
        }
      }
      if (curb < 0) continue;
      let open = true;
      for (let t = curb; t <= reach + 1 && open; t += 0.5) {
        for (const a of [-1, 0, 1]) {
          const px = bx + nx * t + ux * a * (DRIVE_W / 2 - 0.3), pz = bz + nz * t + uz * a * (DRIVE_W / 2 - 0.3);
          if (w.isSolidAt(px, pz, 1.5, w.groundAt(px, pz), 1)) open = false;
        }
      }
      out.push({ x: bx + nx * curb, z: bz + nz * curb, nx, nz, half: DRIVE_W / 2, top: LOT_Y + 0.004, open });
    }
    return out;
  }

  // The forecourts and their driveways, in concrete laid on the town's slopes: each forecourt round its canopy, the
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
    const [fa, fc] = FORECOURT;
    for (const s of this.stations) {
      const ux = Math.cos(s.yaw), uz = -Math.sin(s.yaw), nx = -uz, nz = ux; // (along the street; across it)
      const at = (a: number, c: number): [number, number] => [s.x + ux * a + nx * c, s.z + uz * a + nz * c];
      const hill = s.y - townHeight(s.x, s.z) - SW_TOP > 0.1;
      out = hill ? onHills : tris;
      const y = hill ? s.y + LOT_Y - SW_TOP : LOT_Y; // (on a hill: over its ground, in the world's own heights)
      quad([at(-fa / 2, -fc / 2), at(fa / 2, -fc / 2), at(fa / 2, fc / 2), at(-fa / 2, fc / 2)], y);
      for (const r of s.drives) {
        if (!hill) rampTriangles(tris, r);
        // (from the ramp's top to the forecourt: its near edge, on the street's side of the station)
        const len = (s.x - r.x) * r.nx + (s.z - r.z) * r.nz - fc / 2 + 0.3;
        if (len <= RAMP_IN) continue;
        const tx = -r.nz * r.half, tz = r.nx * r.half;
        const a = [r.x + r.nx * RAMP_IN, r.z + r.nz * RAMP_IN], b = [r.x + r.nx * len, r.z + r.nz * len];
        quad([[a[0] - tx, a[1] - tz], [a[0] + tx, a[1] + tz], [b[0] + tx, b[1] + tz], [b[0] - tx, b[1] - tz]], y + 0.002);
      }
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
    p.collider.broken = true;
    p.fuse = Infinity;
    const s = p.station;
    const w = this.world;
    w.crime.explode(p.x, p.y + 1, p.z, BLAST[0], BLAST[1], p.byPlayer);
    for (const o of s.pumps) this.setOff(o, CHAIN, p.byPlayer);
    if (!s.burnt) {
      s.burnt = 1e-3;
      w.ignite('house', s.x, s.z, 12);
      w.crime.toast(t('toast.stationBlew', { station: s.name }));
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
      // driven into hard (its box, a little grown, reaching the island: two circles along it): it goes up
      let hit = false;
      if (driving && Math.max(Math.abs(me.speed), this.lastSpeed) > RAM) {
        const ux = Math.cos(p.station.yaw) * ISLAND_END, uz = -Math.sin(p.station.yaw) * ISLAND_END;
        const hw = (me.halfW ?? 0.5) + 0.3, hl = (me.halfL ?? 1) + 0.3;
        hit = boxHit(player.x, player.z, me.heading, hw, hl, p.x + ux, p.z + uz, ISLAND[1]) !== null ||
          boxHit(player.x, player.z, me.heading, hw, hl, p.x - ux, p.z - uz, ISLAND[1]) !== null;
      }
      if (hit) this.setOff(p, 0, true);
      else if (mode === 'car' && Math.hypot(p.x - player.x, p.z - player.z) < NEAR) at = p;
    }
    this.lastSpeed = driving ? Math.abs(me.speed) : 0;
    // (driven off the pump: asked afresh at the next)
    if (at !== this.at) this.wanted = false;
    this.at = at;
    this.fill(at, dt);
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
