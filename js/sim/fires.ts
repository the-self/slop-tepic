import * as THREE from 'three/webgpu';
import { getLocationLabel } from '../world/city-config.ts';
import type { GunfireFX } from './gunfire-fx.ts';
import type { EmergencyCall } from './emergency.ts';
import type { AmbientSource } from '../audio/audio-ambience.ts';
import type { ThirdPersonControllerManager } from '../player/controllers.ts';

// js/sim/fires.ts
// Fires: a car burning after a blast, a house on fire now and then somewhere near, and in the dry season (March to
// May, the grass straw-yellow) the quemas on the hills round the valley sending up their smoke. Flames & smoke in the
// gunfire effects' particle pools (gunfire-fx.ts), a flickering light, heat that hurts whoever stands in it. The
// bomberos come for the cars & houses: two to four trucks from their station drive across the city (emergency.ts),
// park, and their crews in turnout gear hose the fire down; a house burns on till they get there.

type FireKind = 'car' | 'house' | 'grass';
interface XZ {
  x: number;
  z: number;
}
// A fire: where (m; y the ground, roof the height it burns up to), `size` m across, heat 0..1 (taking hold, dying
// down), life & t (s it burns for, has burnt), called: s after which the bomberos are called (Infinity: never, or
// called), spread: m a grass fire has crept out, call: the bomberos' (emergency.ts)
interface Fire extends XZ {
  kind: FireKind;
  y: number;
  size: number;
  heat: number;
  life: number;
  t: number;
  called: number;
  roof: number;
  spread: number;
  call?: EmergencyCall;
  sound?: AmbientSource;
}
// What fires uses of the CrimeSystem (sim/crime.ts): its effects, the player, toasts & hurt
interface FireCrime {
  fx: GunfireFX;
  player?: { position: XZ } | null;
  toast(text: string): void;
  hurt(amount: number, fromX?: number, fromZ?: number): void;
}
// What fires uses of the emergency services (sim/emergency.ts): the bomberos called
interface FireServices {
  callFire(x: number, z: number, size: number, want: number): EmergencyCall;
}
// What fires uses of player/controllers.ts: the ground and the walls
type FireControllers = Pick<ThirdPersonControllerManager, 'getGroundHeight' | 'isSolidAt'>;
interface FiresOptions {
  scene: THREE.Object3D;
  crime: FireCrime;
  services: FireServices;
  controllers: FireControllers;
  houses?: ArrayLike<number>; // city-geodata.js: stride numbers a house (x, z in dm, ..., floors at 5, flags at 6)
  stride?: number;
}

const MAX_FIRES = 6;
const MAX_LIGHTS = 3;
const HOUSE_EVERY: [number, number] = [420, 840]; // s between house fires near the player
const GRASS_EVERY: [number, number] = [150, 300]; // s between the dry season's quemas
const CALL_DELAY: [number, number] = [6, 14]; // s before someone has called the bomberos
const HOSE = 0.018; // heat 1/s each truck's hoses beat a fire back by
const MAX_BURN = 900; // s a house burns at most, waiting for the bomberos

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

class Fires {
  crime: FireCrime;
  services: FireServices;
  fx: GunfireFX;
  controllers: FireControllers;
  houses: ArrayLike<number>;
  stride: number;
  fires: Fire[];
  timers: { house: number; grass: number }; // s to the next
  dryness: number;
  lights: THREE.PointLight[];
  time: number;

  /**
   * @param {object} o - scene; crime (sim/crime.ts: its effects, the player's health, toasts); services (the bomberos:
   *   sim/emergency.ts); controllers (the ground, the walls: player/controllers.ts); houses & stride (city-geodata.js,
   *   for house fires)
   */
  constructor({ scene, crime, services, controllers, houses = [], stride = 8 }: FiresOptions) {
    this.crime = crime;
    this.services = services;
    this.fx = crime.fx;
    this.controllers = controllers;
    this.houses = houses;
    this.stride = stride;
    this.fires = [];
    this.timers = { house: rnd(...HOUSE_EVERY) * 0.5, grass: rnd(...GRASS_EVERY) * 0.3 };
    this.dryness = 0;
    this.lights = Array.from({ length: MAX_LIGHTS }, () => {
      const l = new THREE.PointLight(0xff7a2a, 0, 26, 1.4);
      l.position.y = -1000;
      l.visible = false;
      scene.add(l);
      return l;
    });
    this.time = 0;
  }

  // A fire starts: 'car' (a wreck), 'house', 'grass'; `size` m across
  ignite(kind: FireKind, x: number, z: number, size = kind === 'house' ? 9 : kind === 'grass' ? 14 : 4): Fire | null {
    if (this.fires.length >= MAX_FIRES) return null;
    if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < f.size)) return null; // (already burning)
    const fire: Fire = {
      kind, x, z, y: this.controllers.getGroundHeight(x, z, 'car'), size, heat: 0, life: kind === 'car' ? rnd(70, 110) : kind === 'house' ? rnd(200, 300) : rnd(160, 260),
      t: 0, called: kind === 'grass' ? Infinity : rnd(...CALL_DELAY), roof: 0, spread: 0
    };
    this.fires.push(fire);
    return fire;
  }

  // A blast (crime.ts explode): a burning wreck where it went off, and the house it went off against catches
  onExplosion(x: number, _y: number, z: number, radius: number): void {
    if (radius < 4) return;
    this.ignite('car', x, z, 4);
    const c = this.controllers;
    for (let a = 0; a < 8; a++) {
      const hx = x + Math.cos(a * 0.785) * 4, hz = z + Math.sin(a * 0.785) * 4;
      if (c.isSolidAt(hx, hz, 3, c.getGroundHeight(hx, hz, 'car'))) {
        const f = this.ignite('house', hx, hz);
        if (f) this.crime.toast('¡Se incendió una casa!');
        break;
      }
    }
  }

  // A house somewhere 150-450 m from (x, z) for a fire (a real one of the city data, its roof's height)
  houseNear(x: number, z: number): { x: number; z: number; roof: number } | null {
    const H = this.houses, S = this.stride;
    for (let tries = 0; tries < 400; tries++) {
      const i = Math.floor(Math.random() * (H.length / S)) * S;
      const hx = H[i] / 10, hz = H[i + 1] / 10;
      const d = Math.hypot(hx - x, hz - z);
      if (d < 150 || d > 450 || H[i + 6] & 8) continue;
      return { x: hx, z: hz, roof: H[i + 5] * 3.0 };
    }
    return null;
  }

  // The bomberos called: two trucks for a burning car, three or four for a house
  callBomberos(fire: Fire): void {
    fire.call = this.services.callFire(fire.x, fire.z, fire.size, fire.kind === 'house' ? 3 + Math.round(Math.random()) : 2);
  }

  /**
   * The frame: fires start, burn, spread their heat & smoke, die down (faster under the bomberos' hoses, emergency.ts).
   * `dryness` 0..1 (lot-greenery.ts grassDryness: the quemas only in the dry season)
   */
  update(dt: number, dryness: number, camera: { position: XZ }): void {
    this.time += dt;
    const crime = this.crime;
    const p = crime.player ? crime.player.position : camera.position;
    // a house on fire now and then; the dry season's quemas on the open country round the town
    this.timers.house -= dt;
    if (this.timers.house <= 0) {
      this.timers.house = rnd(...HOUSE_EVERY);
      const h = this.houseNear(p.x, p.z);
      if (h) {
        const f = this.ignite('house', h.x, h.z);
        if (f) {
          f.roof = h.roof;
          crime.toast(`Incendio: ${getLocationLabel(h.x, h.z)}`);
        }
      }
    }
    if (dryness > 0.6) {
      this.timers.grass -= dt;
      if (this.timers.grass <= 0) {
        this.timers.grass = rnd(...GRASS_EVERY);
        const a = Math.random() * Math.PI * 2, r = rnd(600, 1600);
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        // (out on the open country: no walls there)
        if (!this.controllers.isSolidAt(x, z, 3, this.controllers.getGroundHeight(x, z, 'car'))) this.ignite('grass', x, z);
      }
    }

    const fx = this.fx;
    let lit = 0;
    for (let k = this.fires.length - 1; k >= 0; k--) {
      const f = this.fires[k];
      f.t += dt;
      // it takes hold, burns, dies down; the hoses beat it back. A house burns on while the bomberos are on their way
      const call = f.call;
      if (f.kind === 'house' && call?.units.length && !call.working && f.t > f.life - 20 && f.t < MAX_BURN) f.life += dt;
      const target = f.t < f.life ? 1 : 0;
      f.heat += ((target - f.heat) * dt) / (target ? 12 : 25) - (call ? call.working : 0) * dt * HOSE;
      if (call) call.reach = f.size * 0.5 + f.spread;
      if (f.kind === 'grass') f.spread = Math.min(f.size * 2.2, f.spread + dt * 0.12);
      if (f.heat <= 0 && f.t > 5) {
        this.fires.splice(k, 1);
        if (f.call) f.call.open = false;
        continue;
      }
      if (f.t > f.called && !f.call && Math.hypot(f.x - p.x, f.z - p.z) < 700) {
        this.callBomberos(f);
        f.called = Infinity;
      }
      const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
      const heat = Math.max(0, f.heat);
      // flames (near) and a column of smoke (seen from afar: black from a house or a car, grey-yellow from the grass)
      if (d < 500) {
        const n = dt * f.size * 7 * heat;
        for (let q = 0; q < n || Math.random() < n - q; q++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * (f.size * 0.45 + f.spread);
          fx.flame(f.x + Math.cos(a) * r, f.y + f.roof * Math.random() + 0.2, f.z + Math.sin(a) * r, f.size * 0.28);
        }
      }
      if (d < 3000 && Math.random() < dt * (4 + f.size * 0.6) * heat) {
        const dark = f.kind === 'grass' ? 0.35 : 0.7;
        const c = 0.62 - dark * 0.5;
        fx.puff.spawn(f.x + (Math.random() - 0.5) * f.size, f.y + f.roof + 1.5, f.z + (Math.random() - 0.5) * f.size,
          (Math.random() - 0.5) * 1.2, 2.8 + Math.random() * 2, (Math.random() - 0.5) * 1.2, 7 + Math.random() * 5,
          f.size * 0.2, f.size * 0.6, c, c * 0.98, c * (f.kind === 'grass' ? 0.85 : 0.95), -0.5, 0.25);
      }
      // the heat: standing in it hurts
      const pd = Math.hypot(f.x - p.x, f.z - p.z);
      if (pd < f.size * 0.6 + f.spread && heat > 0.3) crime.hurt(dt * 14 * heat, f.x, f.z);
      // the flicker of the nearest fires
      if (lit < MAX_LIGHTS && d < 300) {
        const l = this.lights[lit++];
        l.visible = true;
        l.position.set(f.x, f.y + f.roof + 1.5, f.z);
        l.intensity = 120 * heat * (0.75 + 0.25 * Math.sin(this.time * 17 + k) * Math.sin(this.time * 7.3));
      }
    }
    // (an unlit light is hidden: the clustered lighting takes 256 lights at most)
    for (let i = lit; i < MAX_LIGHTS; i++) this.lights[i].visible = false;
  }

  // The fires on the minimap
  blips(out: (string | number)[]): (string | number)[] {
    for (const f of this.fires) out.push('fire', f.x, f.z);
    return out;
  }

  // The crackle & roar of the nearest fires, for the audio's loops
  sounds(out: AmbientSource[]): AmbientSource[] {
    for (const f of this.fires) {
      if (f.heat <= 0.1) continue;
      // (each fire's own sound record, its level filled in again every frame)
      const snd = (f.sound ??= { kind: 'fire', id: f, x: f.x, y: f.y + 1, z: f.z, gain: 0, range: 90 });
      snd.gain = Math.min(1, f.heat) * (f.kind === 'grass' ? 0.8 : 1);
      out.push(snd);
    }
    return out;
  }
}

export type { FireKind, Fire, FireCrime, FireServices, FireControllers, FiresOptions };
export { Fires };
