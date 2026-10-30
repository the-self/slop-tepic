// js/sim/crime/pickups.ts
// What lies about to be picked up (sim/crime.ts): money, health, armour and guns, drawn as one instanced draw of
// spinning gems, and what each gives the player.
import type { Weapon } from '../weapons.ts';
import { WEAPONS } from '../weapons.ts';
import type { PickupKind, Pickup } from './types.ts';
import { MAX_PICKUPS, PICKUP_COLORS, dummy, zero, tint } from './constants.ts';
import type { CrimeSystem } from '../crime.ts';
import { t } from '../../i18n/i18n.ts';

export function buildPickups(crime: CrimeSystem): void {
  crime.pickupMesh.name = 'Pickups';
  crime.pickupMesh.frustumCulled = false;
  for (let i = 0; i < MAX_PICKUPS; i++) {
    crime.pickupMesh.setMatrixAt(i, zero);
    crime.pickupMesh.setColorAt(i, tint.setRGB(1, 1, 1));
  }
  crime.pickupMesh.count = 1;
  crime.scene.add(crime.pickupMesh);
}

export function drop(crime: CrimeSystem, kind: PickupKind, x: number, z: number, amount = 0, life = 90): void {
  if (crime.pickups.length >= MAX_PICKUPS) crime.pickups.shift();
  crime.pickups.push({ kind, x, z, y: crime.groundAt(x, z), amount, life });
}

export function updatePickups(crime: CrimeSystem, dt: number, elapsed: number): void {
  const mesh = crime.pickupMesh;
  let n = 0;
  for (let i = crime.pickups.length - 1; i >= 0; i--) {
    const p = crime.pickups[i];
    p.life -= dt;
    if (p.life <= 0) {
      crime.pickups.splice(i, 1);
      continue;
    }
    if (crime.state === 'play' && crime.mode !== 'helicopter' && Math.hypot(p.x - crime.px, p.z - crime.pz) < 1.5) {
      crime.collect(p);
      crime.pickups.splice(i, 1);
    }
  }
  for (const p of crime.pickups) {
    dummy.position.set(p.x, p.y + 0.75 + Math.sin(elapsed * 2.4 + p.x) * 0.12, p.z);
    dummy.rotation.set(0, elapsed * 2, 0);
    dummy.scale.setScalar(p.kind === 'money' ? 0.8 : 1.1);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    const c = PICKUP_COLORS[p.kind];
    mesh.setColorAt(n, tint.setRGB(c[0], c[1], c[2]));
    n++;
  }
  mesh.count = Math.max(1, n);
  if (!n) mesh.setMatrixAt(0, zero);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function collect(crime: CrimeSystem, p: Pickup): void {
  crime.audio?.gunfire?.('pickup', p.x, p.y + 1, p.z);
  if (p.kind === 'money') {
    crime.money += p.amount;
    crime.toast(t('toast.cash', { amount: p.amount }));
  } else if (p.kind === 'health') {
    crime.health = Math.min(100, crime.health + p.amount);
    crime.onHeal?.('health');
    crime.toast(t('toast.health'));
  } else if (p.kind === 'armor') {
    crime.armor = Math.min(100, crime.armor + p.amount);
    crime.onHeal?.('armor');
    crime.toast(t('toast.armor'));
  } else {
    const w: Weapon = WEAPONS[p.kind];
    const had = crime.arsenal.has(w.id);
    crime.arsenal.add(w.id, w.pickup);
    if (!had && w.id !== 'fists') crime.arsenal.select(w.id);
    crime.toast(t('toast.ammo', { weapon: t(w.label), rounds: w.pickup }));
  }
}
