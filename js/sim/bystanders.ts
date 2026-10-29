import type { Object3D } from 'three/webgpu';
import { PersonCrowd, PersonRig, OUTFIT, OUTFIT_SEED } from './pedestrians.ts';

// js/sim/bystanders.ts
// The people who stay put: the taqueros and their customers at the stalls (street-food.ts), the crowds outside the
// antros and at the house parties dancing (nightlife.ts), the diners & dancers inside (interiors.ts), the bomberos at a
// fire (fires.ts), the paramédicos by someone hurt (emergency.ts). One skinned crowd (pedestrians.ts PersonCrowd) and a pool of rigs, each kept by the key its owner
// gives it (a number: no string is built per frame), so a person keeps their looks and their footing from frame to
// frame. Every frame: begin(), then place() each person in view (lay() one a ragdoll has thrown), then end(dt).

// How someone stands (place()'s `style`, shared: nothing is allocated per person): `dance` 0..1 steps to the music,
// `sway` shifts the weight about; `outfit` an OUTFIT (pedestrians.ts) or 0 for everyday clothes; `female` & `scale`
// fix those, else the person's own seed picks them
interface BystanderStyle {
  dance: number;
  sway: number;
  outfit: number;
  female: boolean | null;
  scale: number | null;
}
// One person kept by its owner's key: the frame it was last placed in, where it stands (m, rad) and how far from the
// camera (m), and its own phase in the dance
interface BystanderSlot {
  rig: PersonRig;
  phase: number;
  seen: number;
  x: number;
  z: number;
  heading: number;
  distance: number;
  /** lying where it was thrown: its rig a ragdoll's (sim/ragdolls.ts), drawn as it lies and not walked */
  fallen: boolean;
}

const STYLES = {
  stand: { dance: 0, sway: 1, outfit: 0, female: null, scale: null },
  dance: { dance: 1, sway: 0, outfit: 0, female: null, scale: null },
  sway: { dance: 0.3, sway: 1, outfit: 0, female: null, scale: null },
  bouncer: { dance: 0, sway: 0, outfit: OUTFIT.narco, female: false, scale: 1.08 }, // (black over olive)
  bombero: { dance: 0, sway: 0, outfit: OUTFIT.bombero, female: false, scale: null },
  paramedic: { dance: 0, sway: 0.4, outfit: OUTFIT.paramedic, female: null, scale: null }
} satisfies Record<string, BystanderStyle>;

class Bystanders {
  crowd: PersonCrowd;
  max: number;
  ground: (owner: unknown, x: number, z: number) => number;
  rigs: Map<number, BystanderSlot>;
  frame: number;
  placed: BystanderSlot[];
  time: number; // s

  /**
   * @param {THREE.Scene} scene
   * @param {number} max - most people drawn at once
   * @param {(x: number, z: number) => number} ground - the height they stand on
   */
  constructor(scene: Object3D, max: number, ground: (x: number, z: number) => number, { farDistance = 30 } = {}) {
    this.crowd = new PersonCrowd(max, { farDistance });
    for (const m of this.crowd.meshes) scene.add(m);
    this.max = max;
    this.ground = (_owner, x, z) => ground(x, z);
    this.rigs = new Map(); // key → { rig, seen }
    this.frame = 0;
    this.placed = [];
    this.time = 0;
  }

  begin(): void {
    this.frame++;
    this.placed.length = 0;
  }

  /**
   * Someone at (x, z) facing `heading`, `distance` m from the camera, kept by the number `key`. `seed` (any number)
   * picks their looks; `style` one of STYLES
   */
  place(key: number, x: number, z: number, heading: number, distance: number, seed = 0, style: BystanderStyle = STYLES.stand): void {
    if (this.placed.length >= this.max) return;
    let slot = this.rigs.get(key);
    if (!slot) {
      const r = (k: number) => {
        const s = Math.sin((seed + 1) * 91.7 + k * 13.3) * 43758.5453;
        return s - Math.floor(s);
      };
      const isFemale = style.female ?? r(1) < 0.5;
      slot = {
        rig: new PersonRig({
          // (the crowd's material reads the outfit off the seed's thousands: an everyday seed stays under 1000)
          seed: style.outfit * OUTFIT_SEED + Math.floor(r(2) * 997) + 0.5,
          scale: style.scale ?? 0.92 + r(3) * 0.14, female: isFemale, girth: 0.92 + r(4) * 0.22,
          hair: isFemale ? 0.3 + r(5) * 0.7 : r(5) * 0.25, armSwing: 0.9 + r(6) * 0.2
        }),
        phase: r(7) * 6.28,
        seen: 0, x: 0, z: 0, heading: 0, distance: 0, fallen: false // (placed just below)
      };
      this.rigs.set(key, slot);
    }
    slot.seen = this.frame;
    slot.fallen = false;
    // dancing: a little step from side to side and a turn to the beat (~2 beats/s); swaying: weight shifts
    const t = this.time + slot.phase;
    const step = style.dance * 0.16 * Math.sin(t * 3.1) + style.sway * 0.05 * Math.sin(t * 0.7);
    const turn = style.dance * 0.35 * Math.sin(t * 1.55);
    slot.x = x + Math.cos(heading) * step;
    slot.z = z - Math.sin(heading) * step;
    slot.heading = heading + turn;
    slot.distance = distance;
    this.placed.push(slot);
  }

  /** The one kept by `key` lying where a ragdoll threw it (its rig posed by the ragdoll), `distance` m from the camera */
  lay(key: number, distance: number): void {
    const slot = this.rigs.get(key);
    if (!slot || this.placed.length >= this.max) return;
    slot.seen = this.frame;
    slot.fallen = true;
    slot.distance = distance;
    this.placed.push(slot);
  }

  /** The one kept by `key`, placed this frame, has just been thrown: its rig is the ragdoll's from now on */
  fell(key: number): void {
    const slot = this.rigs.get(key);
    if (slot) slot.fallen = true;
  }

  /** The rig of the one kept by `key` (to throw it: sim/ragdolls.ts), if they've been placed */
  rigOf(key: number): PersonRig | null {
    return this.rigs.get(key)?.rig ?? null;
  }

  end(dt: number): void {
    this.time += dt;
    this.crowd.begin();
    for (const slot of this.placed) {
      // (the far ones keep their pose: their footing is too small to see; the fallen are the ragdoll's)
      if (!slot.fallen) slot.rig.update(dt, slot.x, slot.z, slot.heading, this.ground, null, 0, slot.distance < 60 || !slot.rig.placed);
      this.crowd.add(slot.rig, slot.distance);
    }
    this.crowd.end();
    // forget whoever has been out of view a while
    if (this.frame % 120 === 0) {
      for (const [key, slot] of this.rigs) if (this.frame - slot.seen > 600) this.rigs.delete(key);
    }
  }
}

export type { BystanderStyle, BystanderSlot };
export { Bystanders, STYLES as BYSTANDER_STYLES };
