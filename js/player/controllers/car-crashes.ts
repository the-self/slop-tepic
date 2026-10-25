// js/player/controllers/car-crashes.ts
// The car's crashes: the jump in its velocity that dents it (vehicle-damage.ts), its body's mesh pressed in, and
// the driver thrown out through the windscreen
import { MIN_IMPACT, applyImpact, deformBody } from '../vehicle-damage.ts';
import type { CarEntity } from './types.ts';
import type { ThirdPersonControllerManager } from '../controllers.ts';

// The driver thrown out through the windscreen at the car's speed before the crash (`v`: vx, vy, vz), from over the
// bonnet, as a ragdoll; on foot from here, the car going on without them. main.ts hears of it (onEject: the HUD, the
// harm)
export function ejectDriver(ctl: ThirdPersonControllerManager, c: CarEntity, v: { vx: number; vy: number; vz: number }, impact: number): void {
  const p = ctl.entities.person;
  if (!ctl.ragdolls || p.ragdoll) return;
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
  const x = c.position.x + sn * c.halfL * 0.55, z = c.position.z + cs * c.halfL * 0.55;
  // lifted onto the bonnet's height: its feet at its top
  ctl.throwPlayer(x, z, c.heading, c.position.y + (c.bodyHeight || 1.45) * 0.55, false,
    { vx: v.vx * 0.9, vy: v.vy + 2.5, vz: v.vz * 0.9, spin: 5, bleed: 1 });
  ctl.onEject?.(impact, x, z, 'car');
}

// A crash since the last frame: the jump in the car's velocity that nothing it did itself explains
export function checkImpact(ctl: ThirdPersonControllerManager, c: CarEntity): void {
  const vx = Math.sin(c.heading) * c.speed + c.vx, vz = Math.cos(c.heading) * c.speed + c.vz;
  if (c.impactArmed) ctl.impactCar(c, vx - c.lastVx, vz - c.lastVz);
  c.impactArmed = true;
}

// Remember where the car's velocity ended up ctl frame, for checkImpact
export function recordVelocity(c: CarEntity): void {
  c.lastVx = Math.sin(c.heading) * c.speed + c.vx;
  c.lastVz = Math.cos(c.heading) * c.speed + c.vz;
}

// The car's velocity changed by (dvx, dvz) at once: if that was hard enough, it is damaged where it was hit (the
// side the push came from), its body dented and its wheels knocked out of true
export function impactCar(ctl: ThirdPersonControllerManager, c: CarEntity, dvx: number, dvz: number): number {
  const dv = Math.hypot(dvx, dvz);
  if (!(dv > MIN_IMPACT)) return 0;
  const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
  // in the car's frame (+z ahead, +x its left), towards what hit it: against the push
  const lx = -(dvx * cs - dvz * sn), lz = -(dvx * sn + dvz * cs);
  // (the dents go in the body shape's own frame, before it is stretched to the model's size)
  const k = c.scale ?? { x: 1, z: 1 };
  const severity = applyImpact(c.damage, lx / k.x, lz / k.z, dv, c.bodyHalf?.w, c.bodyHalf?.l);
  if (severity > 0) ctl.deformCar(c);
  return severity;
}

// Presses the car's dents into its own copy of the body mesh (shared, undented, by every car of its kind until then)
export function deformCar(c: CarEntity): void {
  if (!c.dented) {
    const base = c.bodyMesh.geometry;
    const geometry = base.clone();
    c.dented = {
      geometry,
      basePos: base.attributes.position.array.slice(),
      baseNrm: base.attributes.normal.array.slice()
    };
    c.bodyMesh.geometry = geometry;
  }
  const { geometry, basePos, baseNrm } = c.dented;
  deformBody(basePos, baseNrm, geometry.attributes.position.array, geometry.attributes.normal.array, c.damage.dents);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.normal.needsUpdate = true;
  // front-right, front-left, rear-right, rear-left wheel pivots (side -1 is the car's right) against the damage's
  // front-left, front-right, rear-left, rear-right camber
  for (const w of c.wheels) w.steerPivot.rotation.z = c.damage.camber[(w.isFront ? 0 : 2) + (w.side > 0 ? 0 : 1)];
}
