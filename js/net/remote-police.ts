// js/net/remote-police.ts
// The police after each player, shared: every game runs its own chase (sim/crime.ts), after its own player alone, so
// a friend never saw the patrol cars after you. Now the player's game sends its wanted stars (WANTED, when they change)
// and the units chasing it (UNITS: its patrol cars, the cartel's and the army's trucks, the helicopter, SEND_EVERY s
// apart while there are any), and those who see the player draw them (UNITS_SEEN): carried on along their heading at
// their speed between updates, on the map too. They are drawn only, as the far poses are: no shots, no crashes.
import * as THREE from 'three/webgpu';
import { BODY_SPECS, buildCarGeometry, buildLightbarGeometry, createLightbarMaterial, createLoftedCarMaterial } from '../actors/actor-models.ts';
import { RemoteCarFleet } from './remote-cars.ts';
import { cloneVisual, counterpart } from './visuals.ts';
import { encodeUnits, encodeWanted, UNITS_MAX } from '../../shared/protocol-play.ts';
import type { Unit, UnitKind } from '../../shared/protocol-play.ts';
import type { Blips, Cruiser, Helicopter } from '../sim/crime.ts';
import type { GroundTilt } from './multiplayer.ts';

const SEND_EVERY = 0.25; // s between the player's units sent
const UNIT_REACH = 500; // m from the player a unit is sent within (the rest are no part of its chase on screen)
const CARRY_S = 0.6; // s a unit goes on along its heading past its last update, at most
const HELIS_MAX = 3; // helicopters drawn at once
const STALE_MS = 3000; // a player's units not heard of for this long are dropped (it left, or its chase ended)

/** What the shared chase uses of sim/crime.ts's CrimeSystem */
export interface PoliceCrime {
  wanted: { stars: number };
  cruisers: readonly Cruiser[];
  heli: Helicopter;
  player: { position: { x: number; z: number } };
}
/** How a car lies on the slope under it (net/multiplayer.ts MultiplayerControllers.groundTilt) */
export type TiltAt = (x: number, z: number, heading: number, along: number, across: number, out: GroundTilt) => GroundTilt;

interface UnitsHeard {
  units: Unit[];
  at: number; // performance.now() ms they came
}
interface HeliCopy {
  mesh: THREE.Object3D;
  rotor: THREE.Object3D | undefined;
  tail: THREE.Object3D | undefined;
}

const UNIT_OF: Partial<Record<Cruiser['faction'], UnitKind>> = { police: 'cruiser', narco: 'truck', army: 'army' };
const BLIP_OF: Record<UnitKind, string> = { cruiser: 'cruiser', truck: 'truck', army: 'army', heli: 'heli' };

// A patrol car or a truck as sim/crime/models.ts builds them: a body shape with its wheels, its paint, a light bar
function unitTemplate(kind: Exclude<UnitKind, 'heli'>): THREE.Group {
  const spec = kind === 'cruiser' ? BODY_SPECS.sedan : BODY_SPECS.suv;
  const root = new THREE.Group();
  const paint = kind === 'cruiser' ? 0xf6f9fd : kind === 'truck' ? 0x0c0d0f : 0x4a5130;
  const body = new THREE.Mesh(buildCarGeometry(spec, true), createLoftedCarMaterial(spec, paint));
  body.castShadow = body.receiveShadow = true;
  root.add(body);
  if (kind === 'cruiser') root.add(new THREE.Mesh(buildLightbarGeometry(spec), createLightbarMaterial(true)));
  return root;
}

class RemotePolice {
  private readonly scene: THREE.Object3D;
  private readonly crime: PoliceCrime;
  private readonly tiltAt: TiltAt;
  private readonly send: (frame: Uint8Array<ArrayBuffer>) => void;
  private readonly heard = new Map<number, UnitsHeard>(); // player id → its units
  private readonly fleets: Record<Exclude<UnitKind, 'heli'>, RemoteCarFleet>;
  private readonly fleetList: readonly RemoteCarFleet[]; // (the same, to go through each frame without a new array)
  private readonly helis: HeliCopy[] = [];
  private readonly mine: Unit[] = [];
  private readonly tilt: GroundTilt = { pitch: 0, roll: 0 };
  private sinceSend = 0;
  private sentAny = false; // the last units sent were some (an empty list follows once, when they go)
  private stars = -1; // the stars last sent

  constructor(scene: THREE.Object3D, crime: PoliceCrime, tiltAt: TiltAt, send: (frame: Uint8Array<ArrayBuffer>) => void) {
    this.scene = scene;
    this.crime = crime;
    this.tiltAt = tiltAt;
    this.send = send;
    this.fleets = {
      cruiser: new RemoteCarFleet(scene, unitTemplate('cruiser'), 8),
      truck: new RemoteCarFleet(scene, unitTemplate('truck'), 4),
      army: new RemoteCarFleet(scene, unitTemplate('army'), 4)
    };
    this.fleetList = [this.fleets.cruiser, this.fleets.truck, this.fleets.army];
  }

  /** The player is in a room now (again): what it is wanted for goes again */
  rejoined(): void {
    this.stars = -1;
    this.sentAny = false;
    this.heard.clear();
  }

  /** Units of player `from` came (UNITS_SEEN), at `now` (performance.now() ms) */
  receive(from: number, units: Unit[], now: number): void {
    if (units.length === 0) this.heard.delete(from);
    else this.heard.set(from, { units, at: now });
  }

  /** Player `id` left the view: its chase goes with it */
  forget(id: number): void {
    this.heard.delete(id);
  }

  /** Once a frame: the player's own stars and units out, the others' drawn */
  update(dt: number, now: number): void {
    this.sendMine(dt);
    for (const f of this.fleetList) f.begin(dt);
    let helis = 0;
    for (const [id, h] of this.heard) {
      const age = (now - h.at) / 1000;
      if (age * 1000 > STALE_MS) {
        this.heard.delete(id);
        continue;
      }
      const carry = Math.min(age, CARRY_S);
      for (const u of h.units) {
        const x = u.x + Math.sin(u.heading) * u.speed * carry, z = u.z + Math.cos(u.heading) * u.speed * carry;
        if (u.kind === 'heli') {
          if (helis < HELIS_MAX) this.placeHeli(helis++, x, u.y, z, u.heading, dt);
          continue;
        }
        const t = this.tiltAt(x, z, u.heading, 1.35, 0.8, this.tilt);
        this.fleets[u.kind].add(x, u.y, z, u.heading, t.pitch, t.roll);
      }
    }
    for (let i = helis; i < this.helis.length; i++) this.helis[i].mesh.visible = false;
    for (const f of this.fleetList) f.end();
  }

  /** The others' units on the maps (sim/crime.ts moreBlips) */
  blips(out: Blips): void {
    for (const h of this.heard.values()) for (const u of h.units) out.push(BLIP_OF[u.kind], u.x, u.z);
  }

  dispose(): void {
    for (const f of this.fleetList) f.dispose();
    for (const h of this.helis) h.mesh.removeFromParent();
    this.helis.length = 0;
  }

  // The player's stars when they change, and its units every SEND_EVERY s while there are some (once more when they go)
  private sendMine(dt: number): void {
    const crime = this.crime;
    if (crime.wanted.stars !== this.stars) {
      this.stars = crime.wanted.stars;
      this.send(encodeWanted(this.stars));
    }
    this.sinceSend += dt;
    if (this.sinceSend < SEND_EVERY) return;
    this.sinceSend = 0;
    const mine = this.mine;
    mine.length = 0;
    const p = crime.player.position;
    for (const cr of crime.cruisers) {
      const kind = UNIT_OF[cr.faction];
      if (!kind || !cr.active || cr.wreck || mine.length >= UNITS_MAX || Math.hypot(cr.x - p.x, cr.z - p.z) > UNIT_REACH) continue;
      mine.push({ kind, x: cr.x, y: cr.y, z: cr.z, heading: cr.heading, speed: cr.speed });
    }
    const h = crime.heli;
    if (h.active && h.state !== 'down' && mine.length < UNITS_MAX) mine.push({ kind: 'heli', x: h.x, y: h.y, z: h.z, heading: h.heading, speed: h.speed });
    if (mine.length === 0 && !this.sentAny) return;
    this.sentAny = mine.length > 0;
    this.send(encodeUnits(mine));
  }

  // The i-th helicopter drawn this frame: a copy of the chase's own (its rotors turning)
  private placeHeli(i: number, x: number, y: number, z: number, heading: number, dt: number): void {
    let copy = this.helis.at(i);
    if (!copy) {
      const h = this.crime.heli;
      const mesh = cloneVisual(h.mesh);
      copy = { mesh, rotor: counterpart(h.mesh, mesh, h.rotor), tail: counterpart(h.mesh, mesh, h.tail) };
      this.helis.push(copy);
      this.scene.add(mesh);
    }
    copy.mesh.visible = true;
    copy.mesh.position.set(x, y, z);
    copy.mesh.rotation.set(0, heading, 0);
    if (copy.rotor) copy.rotor.rotation.y += dt * 24.0;
    if (copy.tail) copy.tail.rotation.x += dt * 32.0;
  }
}

export { RemotePolice };
