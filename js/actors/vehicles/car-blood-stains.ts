import * as THREE from 'three/webgpu';
import {
  float,
  vec2,
  sin,
  abs,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  length,
  uniform
} from 'three/tsl';
import { FRONT_SLOTS, TOP_SLOTS } from '../../player/car-blood.ts';
import type { BodySpec } from '../../models/bodies.ts';
import type { Node, UniformNode } from 'three/webgpu';

// js/actors/vehicles/car-blood-stains.ts
// The blood on the player's car, painted by its material: the stains' uniform slots and how much of a fragment
// they cover.

/** The slots of a car's stains (player/car-blood.ts fills them): x, y the stain's centre on the body (m: x and y on
 *  the nose, x and z on the bonnet & windscreen), z its size (m across), w how fresh (1 new, fading as it dries) */
export interface BloodUniforms {
  front: UniformNode<'vec4', THREE.Vector4>[];
  top: UniformNode<'vec4', THREE.Vector4>[];
}
/** What bloodStains gives the car's material: its uniforms, and how much of a fragment they cover and how dried */
interface BloodStains {
  uniforms: BloodUniforms;
  /** 0..1 of the fragment under blood */
  cover: Node<'float'>;
  /** 0..0.6: how dark (old, washed) the stain there looks */
  dried: Node<'float'>;
}

/**
 * Blood on a car's body (player/car-blood.ts): its stains' slots as uniforms, and how much of each fragment at
 * position `p` (the body shape's frame) with normal `n` they cover there (`mask`: where they may be at all). The
 * nose's stains face forward: a splash round where the body struck, flecks round it, runs dripping down; the bonnet's
 * and windscreen's face up: smeared back along the car by the air. `dried`: how dark (old, washed) the one there looks
 */
export function bloodStains(p: Node<'vec3'>, n: Node<'vec3'>, spec: BodySpec, mask: Node<'float'>): BloodStains {
  const uniforms: BloodUniforms = {
    front: Array.from({ length: FRONT_SLOTS }, () => uniform(new THREE.Vector4(0, 0, 0, 0))),
    top: Array.from({ length: TOP_SLOTS }, () => uniform(new THREE.Vector4(0, 0, 0, 0)))
  };
  // a ragged edge, and droplets: products of sines of the position (cells a few cm across, no per-pixel noise to
  // shimmer)
  const wobble = sin(p.x.mul(37.0).add(p.y.mul(23.0)).add(p.z.mul(11.0))).mul(sin(p.y.mul(41.0).sub(p.x.mul(19.0)).add(p.z.mul(29.0))));
  const drops = sin(p.x.mul(83.0).add(p.z.mul(17.0))).mul(sin(p.y.mul(97.0).sub(p.x.mul(31.0)))).mul(sin(p.z.mul(89.0).add(p.y.mul(23.0))));
  const droplet = smoothstep(0.42, 0.5, drops);
  const frontFacing = smoothstep(0.15, 0.45, n.z).mul(step(spec.zFront - 0.6, p.z));
  const upFacing = smoothstep(0.2, 0.5, n.y);
  let cover: Node<'float'> = float(0.0);
  let fresh: Node<'float'> = float(0.0); // (the freshest stain here: the darker, the older)
  // (a slot's size is how far across its stain is: its radius half that)
  for (const u of uniforms.front) {
    const r = max(u.z.mul(0.5), 0.01);
    const dx = p.x.sub(u.x), dy = p.y.sub(u.y);
    const d = length(vec2(dx, dy.mul(1.3))).div(r);
    const splash = smoothstep(1.0, 0.85, d.add(wobble.mul(0.3)));
    const flecks = droplet.mul(smoothstep(2.3, 1.2, d));
    // runs down from it: a few thin streaks
    const runs = smoothstep(0.93, 0.98, sin(dx.mul(34.0)).mul(0.5).add(0.5))
      .mul(smoothstep(u.y.sub(r.mul(3.0)), u.y, p.y)).mul(step(p.y, u.y))
      .mul(smoothstep(r.mul(0.8), 0.0, abs(dx)));
    // (a fresh stain whole; washed out, fading)
    const shape = max(max(splash, flecks), runs).mul(frontFacing);
    cover = max(cover, shape.mul(clamp(u.w.mul(1.6), 0.0, 1.0)));
    fresh = max(fresh, shape.mul(u.w));
  }
  for (const u of uniforms.top) {
    const r = max(u.z.mul(0.5), 0.01);
    const dx = p.x.sub(u.x), dz = p.z.sub(u.y);
    // (behind it the stain is drawn out: thrown back along the bonnet and up the glass)
    const back = mix(float(1.0), float(0.5), step(dz, 0.0));
    const d = length(vec2(dx, dz.mul(back))).div(r);
    const splash = smoothstep(1.0, 0.85, d.add(wobble.mul(0.35)));
    const flecks = droplet.mul(smoothstep(2.4, 1.2, d));
    const shape = max(splash, flecks).mul(upFacing);
    cover = max(cover, shape.mul(clamp(u.w.mul(1.6), 0.0, 1.0)));
    fresh = max(fresh, shape.mul(u.w));
  }
  return { uniforms, cover: clamp(cover, 0.0, 1.0).mul(mask), dried: float(1.0).sub(fresh).mul(0.6) };
}
