// js/world/cfe-sparks.ts
// The CFE's lines down in the street (cfe-network.ts): where the primaries' broken ends lie they arc, in bursts of
// sparks (a pool of streaks flying, bouncing on the street and dying), a blue-white flash lighting the street at night
// (a light of street-details.ts' pool, `flash`) and a crackle (`listener`, on the bus: app/install/audio.ts), sparser
// as the minutes go by till the line is dead; whoever walks into one is shocked. A pole's transformer going up is a
// bang: a fountain of sparks off its top, a flash, a blast heard across the colonia.
import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';

/** What a line down does that others hear or feel (on the bus, app/game.ts): an arc's crackle, a transformer's bang, a
 * shock to the
 *  player (`strength` 0..1 of the worst) */
interface PowerFault {
  type: 'arc' | 'bang' | 'shock';
  x: number;
  y: number;
  z: number;
  strength: number;
}

/** A light of street-details.ts' point light pool lent to the arcs: where it stands, how bright it is, and `broken`
 *  while it is off */
interface FlashSite {
  x: number;
  y: number;
  z: number;
  g: number;
  intensity: number;
  broken: boolean;
}

/** A broken end arcing: where (m), from the line of the pole still standing (`pole`), its age and life (s), s to its
 *  next burst, s since its last crackle was told */
interface Arc {
  pole: number;
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  next: number;
  heard: number;
}

/** A spark: where (m), how fast (m/s), the street under it (m), s left of its life */
interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  floor: number;
  life: number;
}

const MAX_SPARKS = 220;
const ARC_LIFE: [number, number] = [70, 110]; // s a broken end arcs for (till the substation's breaker gives up on it)
const SHOCK_REACH = 1.6; // m round a live end a walker is shocked within
const SHOCK_EVERY = 0.5; // s between shocks
const FLASH_LIGHT = 70; // the flash's light's intensity (the pool's lamps run at ~30)
const BANG_LIGHT = 240;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const FORWARD = new THREE.Vector3(0, 0, 1);

class CfeSparks {
  arcs: Arc[];
  sparks: Spark[];
  cursor: number;
  mesh: THREE.InstancedMesh;
  flashMesh: THREE.Mesh;
  flashMat: THREE.MeshBasicNodeMaterial;
  /** s left of the flash (and how long it lasts), its size (m) */
  flashT: number;
  flashLen: number;
  flashSize: number;
  flash: FlashSite | null;
  flashPower: number;
  shockT: number;
  /** No spark in the air (the pool's instances left as they are) */
  idle: boolean;
  listener: ((e: PowerFault) => void) | null;
  event: PowerFault;

  constructor(group: THREE.Group) {
    this.arcs = [];
    this.sparks = Array.from({ length: MAX_SPARKS }, () => ({ x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, floor: -1000, life: 0 }));
    this.cursor = 0;
    // a streak each, glowing well over white (the bloom takes it up)
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = color(0xffd890).mul(6);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.32), mat, MAX_SPARKS);
    this.mesh.name = 'CfeSparks';
    this.mesh.frustumCulled = false; // (they fly anywhere a line is down)
    // one empty instance till the first burst, so the warm-up compiles its pipeline
    _m.makeScale(0, 0, 0).setPosition(0, -1000, 0);
    this.mesh.setMatrixAt(0, _m);
    this.mesh.count = 1;
    group.add(this.mesh);
    this.flashMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flashMat.colorNode = color(0xb8d0ff).mul(2.2);
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.flashMat);
    this.flashMesh.name = 'CfeFlash';
    this.flashMesh.position.set(0, -1000, 0);
    this.flashMesh.scale.setScalar(0.001);
    group.add(this.flashMesh);
    this.flashT = 0;
    this.flashLen = 1;
    this.flashSize = 1;
    this.flash = null;
    this.flashPower = 0;
    this.shockT = 0;
    this.idle = true;
    this.listener = null;
    this.event = { type: 'arc', x: 0, y: 0, z: 0, strength: 0 };
  }

  /** The broken ends of pole `pole`'s lines arcing at (x, y, z), from now */
  live(pole: number, x: number, y: number, z: number): void {
    const life = ARC_LIFE[0] + Math.random() * (ARC_LIFE[1] - ARC_LIFE[0]);
    this.arcs.push({ pole, x, y, z, age: 0, life, next: 0.05 + Math.random() * 0.2, heard: Infinity });
  }

  /** Pole `pole` come down too: its lines' broken ends are no longer live */
  drop(pole: number): void {
    this.arcs = this.arcs.filter((a) => a.pole !== pole);
  }

  /** A transformer going up at `at`: a fountain of sparks, a big flash, a blast */
  bang(at: THREE.Vector3): void {
    this.burst(at.x, at.y, at.z, 70, 9, 0);
    this.flashAt(at.x, at.y, at.z, 1.1, 0.3, BANG_LIGHT);
    this.tell('bang', at.x, at.y, at.z, 1);
  }

  tell(type: PowerFault['type'], x: number, y: number, z: number, strength: number): void {
    if (!this.listener) return;
    const e = this.event;
    e.type = type; e.x = x; e.y = y; e.z = z; e.strength = strength;
    this.listener(e);
  }

  // n sparks off (x, y, z) at up to `speed` m/s, onto the street at `floor` m (NaN: y)
  burst(x: number, y: number, z: number, n: number, speed: number, floor = NaN): void {
    this.idle = false;
    for (let k = 0; k < n; k++) {
      const s = this.sparks[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.65);
      s.x = x + (Math.random() - 0.5) * 0.3;
      s.y = y + Math.random() * 0.15;
      s.z = z + (Math.random() - 0.5) * 0.3;
      s.vx = Math.cos(a) * v * 0.8;
      s.vz = Math.sin(a) * v * 0.8;
      s.vy = v * (0.4 + Math.random() * 0.8);
      s.floor = Number.isNaN(floor) ? y - 0.02 : floor;
      s.life = 0.25 + Math.random() * 0.6;
    }
  }

  // The flash at (x, y, z): `size` m across, `len` s long, its light `power` bright
  flashAt(x: number, y: number, z: number, size: number, len: number, power: number): void {
    if (this.flashT > 0 && power < this.flashPower) return; // (a bigger one is lit)
    this.flashMesh.position.set(x, y, z);
    this.flashT = this.flashLen = len;
    this.flashSize = size;
    this.flashPower = power;
    if (this.flash) {
      this.flash.x = x; this.flash.y = y + 0.6; this.flash.z = z; this.flash.g = y;
    }
  }

  /** Per frame: the arcs' bursts, the sparks flying, the flash, and a shock for the player on foot (`player`) */
  update(dt: number, camera: THREE.Camera, player: { x: number; y: number; z: number } | null, onFoot: boolean): void {
    this.shockT = Math.max(0, this.shockT - dt);
    for (let k = this.arcs.length - 1; k >= 0; k--) {
      const a = this.arcs[k];
      a.age += dt;
      a.heard += dt;
      if (a.age > a.life) {
        this.arcs.splice(k, 1);
        continue;
      }
      const spent = a.age / a.life; // (dying down: fewer, smaller bursts)
      if (player && onFoot && this.shockT <= 0 && Math.hypot(player.x - a.x, player.z - a.z) < SHOCK_REACH && Math.abs(player.y - a.y) < 2.2) {
        this.shockT = SHOCK_EVERY;
        this.burst(a.x, a.y, a.z, 18, 5);
        this.flashAt(a.x, a.y + 0.3, a.z, 0.5, 0.12, FLASH_LIGHT);
        this.tell('shock', player.x, player.y, player.z, 1 - spent * 0.5);
      }
      a.next -= dt;
      if (a.next > 0) continue;
      a.next = 0.12 + Math.random() * (0.45 + spent * 2.8);
      // (out of sight, the arcs go on unseen: no sparks for nobody)
      if (Math.hypot(a.x - camera.position.x, a.z - camera.position.z) > 220) continue;
      this.burst(a.x, a.y, a.z, Math.round((5 + Math.random() * 10) * (1 - spent * 0.6)), 4.5 - spent * 2);
      if (Math.random() < 0.6 - spent * 0.4) this.flashAt(a.x, a.y + 0.2, a.z, 0.22 + Math.random() * 0.2, 0.06 + Math.random() * 0.08, FLASH_LIGHT * (1 - spent * 0.6));
      if (a.heard > 0.25) {
        a.heard = 0;
        this.tell('arc', a.x, a.y, a.z, 1 - spent * 0.7);
      }
    }
    this.fly(dt);
    // the flash: swelling at once, fading out
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const f = this.flashT / this.flashLen;
      this.flashMesh.scale.setScalar(this.flashSize * (0.5 + 0.5 * f) * (0.85 + Math.random() * 0.3));
      this.flashMat.opacity = f * 0.8;
      if (this.flash) {
        this.flash.intensity = this.flashPower * f * (0.7 + Math.random() * 0.6);
        this.flash.broken = this.flashT <= 0;
      }
      if (this.flashT <= 0) this.flashMesh.position.set(0, -1000, 0);
    }
  }

  // The sparks: falling, dragged, skipping off the street, each a streak along its flight
  fly(dt: number): void {
    if (this.idle) return;
    let n = 0;
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) continue;
      s.vy -= 9.8 * dt;
      const drag = Math.exp(-1.6 * dt);
      s.vx *= drag; s.vz *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.y < s.floor) {
        s.y = s.floor;
        s.vy *= -0.35;
        s.vx *= 0.6; s.vz *= 0.6;
      }
      const speed = Math.hypot(s.vx, s.vy, s.vz);
      _v.set(s.vx, s.vy, s.vz).divideScalar(speed || 1);
      _q.setFromUnitVectors(FORWARD, _v);
      const fade = Math.min(1, s.life * 4);
      _s.set(fade, fade, (0.4 + speed * 0.06) * fade);
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s);
      this.mesh.setMatrixAt(n++, _m);
    }
    if (!n) {
      _m.makeScale(0, 0, 0).setPosition(0, -1000, 0);
      this.mesh.setMatrixAt(n++, _m);
      this.idle = true;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export type { PowerFault, FlashSite };
export { CfeSparks };
