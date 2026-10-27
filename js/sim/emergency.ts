// js/sim/emergency.ts
// The emergency services: for a fire the bomberos set out from their station on Av. Insurgentes, two to four trucks;
// for someone killed or a hard crash the Cruz Roja's ambulance from their base next door, or the nearest hospital's,
// there a minute or two after the call. They drive across the city with their sirens (the patrol cars' driving: they
// are in crime.ts's pool of them), park by the scene, their crews get down to work (the bomberos hose the fire down,
// the paramédicos bring the hurt round one by one: they get up and walk off), and once it is over they drive back, out
// of the world again when out of sight or home.
import * as THREE from 'three/webgpu';
import { Bystanders, BYSTANDER_STYLES } from './bystanders.ts';
import { FIRE_STATIONS, AMBULANCE_BASES, nearestStation } from './emergency/stations.ts';
import { buildFireTrucks, buildAmbulances } from './emergency/models.ts';
import { setOut, driveTo, park, stable } from './emergency/driving.ts';
import type { Station } from './emergency/stations.ts';
import type { CrimeSystem } from './crime.ts';
import type { Cruiser } from './crime/types.ts';
import type { RagdollHandle } from './ragdolls.ts';
import { t } from '../i18n/i18n.ts';

type Service = 'fire' | 'ambulance';
interface XZ {
  x: number;
  z: number;
}
/**
 * A call for help at (x, z) (m): which service, how many units it wants, how far from its middle the trouble reaches
 * (m: a fire's size), whether it still needs them (the fire burning, the hurt not seen to yet), s since it was made
 * (negative: not yet, someone is still dialling), the units sent, how many are at work on it (fires.ts: the hoses), s
 * since it was closed; the bodies lying there for the paramédicos (they wait for them: RagdollHandle awaiting), how
 * many they have brought round and s on the one they see to now; s after it was made its ambulance is to be there by
 */
interface EmergencyCall extends XZ {
  service: Service;
  want: number;
  reach: number;
  open: boolean;
  t: number;
  units: Responder[];
  working: number;
  closedT: number;
  bodies: RagdollHandle[];
  treated: number;
  treatT: number;
  due: number;
}
/**
 * A fire truck or ambulance: its vehicle (a Cruiser in crime.ts's pool), its station, the call it answers; idle in its
 * station, waiting to set out (t < 0), on its way, at work at the scene, or going back; t s in that phase, its place
 * among the call's units (where it parks), s it has stood stuck behind the traffic, the nearest it has come to the
 * scene (m) and s since it last came nearer
 */
interface Responder {
  cr: Cruiser;
  service: Service;
  home: Station;
  call: EmergencyCall | null;
  phase: 'idle' | 'wait' | 'go' | 'work' | 'back';
  t: number;
  slot: number;
  blocked: number;
  closest: number;
  closeT: number;
}
interface EmergencyOptions {
  scene: THREE.Object3D;
  crime: CrimeSystem;
  ground: (x: number, z: number) => number;
}

const FIRE_TRUCKS = 4;
const AMBULANCES = 3;
const SPEED: Readonly<Record<Service, number>> = { fire: 17, ambulance: 20 }; // m/s on the way, sirens on (~60, 70 km/h)
const BACK_SPEED = 12; // m/s going back, no hurry
const STAGGER = 3; // s between the trucks of one call setting out
const AMBULANCE_DELAY: [number, number] = [4, 9]; // s before someone has called the 911
const AMBULANCE_ARRIVES: [number, number] = [60, 110]; // s from the call to the ambulance there (a minute or two)
const ROAD_FACTOR = 1.4; // the road's length over the crow's flight across Tepic's grid (a first guess, before the route)
const CITY_SPEED = 10; // m/s an ambulance makes good along its route, sirens on (slowed at the crossings, by the traffic)
const SAME_SCENE = 45; // m: a call this near an open one is the same
const WORK_TIME = 30; // s the paramédicos stay at least
const TREAT_TIME = 14; // s the paramédicos take to bring one round
const LINGER = 12; // s the bomberos stay once the fire is out
const GONE = 320; // m from the camera going back: out of sight, back in its station
const LATE = 15; // s past when it should have been there that a held-up ambulance gets through (headStart)
const UNSEEN = 160; // m from the camera nothing is seen to jump (the player is mostly at the scene)
const LAST_STRETCH = 230; // m of its route a late ambulance is still seen to drive, once it has got through
const PARK_NEAR = 30; // m from the hurt an ambulance that can get no nearer parks (they lie in a park, a plaza)
const GIVE_UP = 300; // s on its way before it gives up (stuck somewhere: across the city takes 3 at most)
const CREW = 3; // bomberos per truck
const PARAMEDICS = 2;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
// Whether there were bodies and every one is gone from the street (a loop, not a closure: this runs every frame)
const allGone = (bodies: readonly RagdollHandle[]): boolean => {
  for (const b of bodies) if (!b.released) return false;
  return bodies.length > 0;
};

class EmergencyServices {
  crime: CrimeSystem;
  units: Responder[];
  calls: EmergencyCall[];
  people: Bystanders;
  barMat = new THREE.MeshBasicNodeMaterial({ color: 0xff2020 }); // the fire trucks' light bars
  sirens: Cruiser[] = []; // those on their way, sirens on: the traffic pulls over for them (traffic.ts setSirens)
  junctions: Set<XZ>; // the road graph's intersections where three roads or more meet: it slows down crossing them
  time = 0;

  /**
   * @param {object} o - scene; crime (sim/crime.ts: the patrol cars' pool, its driving & road graph, its effects);
   *   ground (the height the crews stand on)
   */
  constructor({ scene, crime, ground }: EmergencyOptions) {
    this.crime = crime;
    const vehicles = [...buildFireTrucks(scene, FIRE_TRUCKS, this.barMat), ...buildAmbulances(scene, AMBULANCES)];
    // (in the patrol cars' pool: the traffic stops for them, they shove it and the player, sirens, gunfire)
    crime.cruisers.push(...vehicles);
    this.units = vehicles.map((cr): Responder => ({
      cr, service: cr.faction === 'fire' ? 'fire' : 'ambulance', home: (cr.faction === 'fire' ? FIRE_STATIONS : AMBULANCE_BASES)[0],
      call: null, phase: 'idle', t: 0, slot: 0, blocked: 0, closest: Infinity, closeT: 0
    }));
    this.calls = [];
    this.junctions = new Set(crime.nodes.filter((_, i) => crime.links[i].length >= 3));
    this.people = new Bystanders(scene, FIRE_TRUCKS * CREW + AMBULANCES * PARAMEDICS, ground);
  }

  /** The bomberos called to a fire at (x, z) `size` m across: `want` trucks (more set out as others come free) */
  callFire(x: number, z: number, size: number, want: number): EmergencyCall {
    const call: EmergencyCall = {
      service: 'fire', x, z, want, reach: size * 0.5, open: true, t: 0, units: [], working: 0, closedT: 0, bodies: [], treated: 0, treatT: 0, due: Infinity
    };
    this.calls.push(call);
    return call;
  }

  /**
   * An ambulance called for someone hurt at (x, z), unless one is already called nearby: there a minute or two on
   * (`due`), from the base nearest it, setting out as late as that allows (a few seconds on, someone having dialled);
   * from a base too far for that, it is one already out on the streets, on its way along its route (headStart).
   * `body`: their body, which lies there till the paramédicos bring them round
   */
  callAmbulance(x: number, z: number, body: RagdollHandle | null = null): EmergencyCall {
    let call = this.calls.find((c) => c.service === 'ambulance' && c.open && Math.hypot(c.x - x, c.z - z) < SAME_SCENE);
    if (!call) {
      const base = nearestStation(AMBULANCE_BASES, x, z);
      const due = rnd(...AMBULANCE_ARRIVES), dial = rnd(...AMBULANCE_DELAY);
      const road = base ? (Math.hypot(base.x - x, base.z - z) * ROAD_FACTOR) : 0; // m, a first guess
      const delay = Math.max(dial, due - road / CITY_SPEED);
      call = {
        service: 'ambulance', x, z, want: 1, reach: 0, open: true, t: -delay, units: [], working: 0, closedT: 0, bodies: [], treated: 0, treatT: 0,
        due: due - delay // (on t's clock, which reaches 0 as it sets out, delay s after the hurt)
      };
      this.calls.push(call);
    }
    if (body) {
      body.awaiting = true;
      call.bodies.push(body);
    }
    return call;
  }

  // The idle units of call's service sent to it (from the station nearest it), each STAGGER s after the one before
  assign(call: EmergencyCall): void {
    const home = nearestStation(call.service === 'fire' ? FIRE_STATIONS : AMBULANCE_BASES, call.x, call.z);
    if (!home) return;
    for (const u of this.units) {
      if (call.units.length >= call.want) break;
      if (u.service !== call.service || u.phase !== 'idle') continue;
      Object.assign(u, { call, home, phase: 'wait', t: -call.units.length * STAGGER, slot: call.units.length, closest: Infinity, closeT: 0 });
      call.units.push(u);
    }
  }

  // u off its call (back home, wrecked): another may be sent in its place
  detach(u: Responder): void {
    const call = u.call;
    if (call) call.units.splice(call.units.indexOf(u), 1);
    u.call = null;
  }

  /**
   * The frame: calls made and answered, the units driving, parked at work, going back; the crews at the scenes.
   * `camera`: where the player looks from (units going back vanish out of its sight)
   */
  update(dt: number, camera: { position: XZ }): void {
    this.time += dt;
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      c.t += dt;
      if (!c.open) c.closedT += dt;
      // (nobody came for a hurt in two minutes: they were taken some other way)
      if (c.service === 'ambulance' && c.open && !c.units.length && c.t > 120) c.open = false;
      // (the bodies it was called for all gone from the street, taken out of the world: nobody left to see to)
      if (c.service === 'ambulance' && c.open && allGone(c.bodies)) c.open = false;
      if (c.open && c.t >= 0 && c.units.length < c.want) this.assign(c);
      // closed: the bodies taken away (or, nobody having come, left to the traffic & the police to clear)
      if (!c.open && c.bodies.length) {
        for (const b of c.bodies) b.awaiting = false;
        c.bodies.length = 0;
      }
      if (!c.open && !c.units.length) this.calls.splice(i, 1);
    }
    // the trucks' light bars flashing red & white
    this.barMat.color.setHex(Math.sin(this.time * 14) > 0 ? 0xff1a1a : 0xfff4f4);
    for (const c of this.calls) c.working = 0;
    const ppl = this.people;
    ppl.begin();
    this.sirens.length = 0;
    for (let k = 0; k < this.units.length; k++) {
      const u = this.units[k];
      this.step(u, k, dt, camera);
      if (u.phase === 'go' && !u.cr.wreck) this.sirens.push(u.cr);
    }
    ppl.end(dt);
  }

  step(u: Responder, k: number, dt: number, camera: { position: XZ }): void {
    const cr = u.cr;
    if (u.phase === 'idle') return;
    u.t += dt;
    // blown up (crime.ts burns the wreck out and takes it away): off its call
    if (u.phase !== 'wait' && (!cr.active || cr.wreck)) {
      this.detach(u);
      if (!cr.active) u.phase = 'idle';
      return;
    }
    const call = u.call;
    switch (u.phase) {
      case 'wait': {
        if (!call?.open) {
          this.detach(u);
          u.phase = 'idle';
        } else if (u.t >= 0) {
          if (setOut(this, u, call.x, call.z)) {
            u.phase = 'go';
            u.t = 0;
            // (its route longer than it can drive by when it is due: one already out on the streets, on its way)
            if (call.service === 'ambulance') this.headStart(u, call, (call.due - call.t) * CITY_SPEED, camera);
            const p = this.crime.player.position;
            if (u.slot === 0 && call.service === 'fire' && Math.hypot(p.x - call.x, p.z - call.z) < 800) this.crime.toast(t('toast.firefighters'));
          } else {
            // (no way there: nobody can get to it)
            call.open = false;
            this.detach(u);
            u.phase = 'idle';
          }
        }
        return;
      }
      case 'go': {
        if (!call?.open) {
          this.goBack(u);
          return;
        }
        // hopelessly stuck on the way: it turns back (and the hurt are taken some other way)
        if (u.t > GIVE_UP) {
          if (call.service === 'ambulance') call.open = false;
          this.goBack(u);
          return;
        }
        // (held up past when it should have been there: out of sight, it gets through the rest but the last stretch)
        if (call.service === 'ambulance' && call.t > call.due + LATE) this.headStart(u, call, LAST_STRETCH, camera);
        // the trucks park one behind another short of the fire; the ambulance by the hurt
        const stop = call.service === 'fire' ? call.reach + 7 + u.slot * 10 : 4;
        const d = driveTo(this, u, dt, call.x, call.z, stop, SPEED[u.service]);
        if (d < u.closest - 0.5) {
          u.closest = d;
          u.closeT = 0;
        } else {
          u.closeT += dt;
        }
        // (an ambulance on the last leg of its route that can't get nearer the hurt, off the road, parks as near as it
        // got: they walk the rest. Not one going by on its way round: it comes nearer again)
        const lastLeg = !cr.path || cr.pathI >= cr.path.length - 1;
        const stuckNear = call.service === 'ambulance' && lastLeg && d < PARK_NEAR && u.closeT > 3;
        if (d <= stop + 1.5 || (d < stop + 12 && Math.abs(cr.speed) < 0.5 && u.t > 5) || stuckNear) {
          u.phase = 'work';
          u.t = 0;
        }
        return;
      }
      case 'work': {
        park(this, u, dt);
        if (!call) {
          this.goBack(u);
          return;
        }
        if (call.service === 'fire') {
          if (u.t > 6 && call.open) call.working++;
          this.crew(u, k, call, dt, camera);
          const p = this.crime.player.position;
          if (!call.open && (call.closedT > LINGER || Math.hypot(p.x - cr.x, p.z - cr.z) > 200)) this.goBack(u);
        } else {
          // the paramédicos see to the hurt one by one, and bring each round: they get up (traffic/peds.ts, crime/agents.ts)
          // (passing over those gone from the street meanwhile)
          while (call.bodies.at(call.treated)?.released) call.treated++;
          const b = call.bodies.at(call.treated);
          if (u.t > 2) {
            this.paramedics(k, b, call, camera);
            if (b) call.treatT += dt;
          }
          if (b && call.treatT > TREAT_TIME) {
            b.revived = true;
            call.treated++;
            call.treatT = 0;
            const p = this.crime.player.position;
            if (Math.hypot(p.x - b.px, p.z - b.pz) < 60) this.crime.toast(t('toast.revived'));
          }
          if (u.t > WORK_TIME && call.treated >= call.bodies.length) {
            call.open = false;
            this.goBack(u);
          }
        }
        return;
      }
      case 'back': {
        const d = driveTo(this, u, dt, u.home.x, u.home.z, 8, BACK_SPEED);
        if (d < 25 || Math.hypot(cr.x - camera.position.x, cr.z - camera.position.z) > GONE) {
          stable(this, u);
          u.phase = 'idle';
        }
      }
    }
  }

  /**
   * An ambulance with more of its route ahead than `reach` m (setting out from a base across the city, held up on its
   * way in a jam that won't clear for its siren or a street it can't get round) is put on along it, out of the player's
   * sight, to the crossing from which reach m or so of it is left, where it is seen coming the rest of the way
   */
  headStart(u: Responder, call: EmergencyCall, reach: number, camera: { position: XZ }): void {
    const cr = u.cr, path = cr.path;
    if (!path) return;
    const cam = camera.position;
    if (Math.hypot(cr.x - cam.x, cr.z - cam.z) < UNSEEN) return; // (where the player sees it: it comes on as it can)
    // the route still ahead of each crossing on it (m), back from the scene
    let left = Math.hypot(call.x - (path.at(-1)?.x ?? cr.x), call.z - (path.at(-1)?.z ?? cr.z));
    for (let i = path.length - 1; i > cr.pathI; i--) {
      const p = path[i], q = path[i - 1];
      const before = left + Math.hypot(p.x - q.x, p.z - q.z); // (from q on)
      if (before > reach && left <= reach) {
        // p is the farthest crossing within reach: on from there, unless the player would see it appear there
        if (Math.hypot(p.x - cam.x, p.z - cam.z) < UNSEEN) return;
        const next = path.at(i + 1) ?? call; // (on the leg from it to the next: cruisers.ts follows path[pathI - 1] to path[pathI])
        Object.assign(cr, {
          x: p.x, z: p.z, heading: Math.atan2(next.x - p.x, next.z - p.z), speed: 0, vx: 0, vz: 0, pathI: Math.min(i + 1, path.length - 1),
          stuckT: 0, stuckCount: 0, reverseT: 0, checkX: p.x, checkZ: p.z, passSide: 0, slowT: 0 // (not passing, set down)
        });
        cr.y = this.crime.groundAt(cr.x, cr.z);
        cr.mesh.position.set(cr.x, cr.y, cr.z);
        return;
      }
      left = before;
    }
  }

  // Done: off its call and home, its siren and lights off
  goBack(u: Responder): void {
    this.detach(u);
    u.phase = 'back';
    u.t = 0;
    u.cr.siren = false;
    u.cr.lightbar.visible = false;
    u.cr.path = null;
  }

  // A truck's crew: three bomberos between it and the fire, facing it, their hoses' water arcing onto it
  crew(u: Responder, k: number, call: EmergencyCall, dt: number, camera: { position: XZ }): void {
    const cr = u.cr, ppl = this.people;
    const ax = call.x - cr.x, az = call.z - cr.z, ad = Math.hypot(ax, az) || 1;
    const ux = ax / ad, uz = az / ad;
    const g = cr.y;
    for (let j = 0; j < CREW; j++) {
      const along = Math.max(2, Math.min(ad - call.reach - 2, 3 + j * 1.2)), side = (j - 1) * 2.2;
      const x = cr.x + ux * along - uz * side, z = cr.z + uz * along + ux * side;
      ppl.place(k * 8 + j, x, z, Math.atan2(call.x - x, call.z - z), Math.hypot(x - camera.position.x, z - camera.position.z), k * 31 + j, BYSTANDER_STYLES.bombero);
      if (u.t > 4 && call.open && Math.random() < dt * 30) {
        const v = 11 + Math.random() * 2;
        const tx = call.x - x + (Math.random() - 0.5) * call.reach * 1.2, tz = call.z - z + (Math.random() - 0.5) * call.reach * 1.2;
        const td = Math.hypot(tx, tz) || 1;
        this.crime.fx.puff.spawn(x + (tx / td) * 0.6, g + 1.3, z + (tz / td) * 0.6, (tx / td) * v * 0.8, 5 + Math.random(), (tz / td) * v * 0.8,
          1.1, 0.12, 0.35, 0.86, 0.92, 1.0, 9.8, 0.1);
      }
    }
  }

  // The paramédicos seeing to the hurt: either side of `b`, the one they see to now (where they were called to, if
  // none lies there), facing them
  paramedics(k: number, b: RagdollHandle | undefined, call: EmergencyCall, camera: { position: XZ }): void {
    const cx = b ? b.px : call.x, cz = b ? b.pz : call.z;
    for (let j = 0; j < PARAMEDICS; j++) {
      const a = j * Math.PI + k;
      const x = cx + Math.cos(a) * 0.9, z = cz + Math.sin(a) * 0.9;
      this.people.place(k * 8 + j, x, z, Math.atan2(cx - x, cz - z), Math.hypot(x - camera.position.x, z - camera.position.z), k * 17 + j, BYSTANDER_STYLES.paramedic);
    }
  }
}

export type { Service, EmergencyCall, Responder, EmergencyOptions };
export { EmergencyServices };
