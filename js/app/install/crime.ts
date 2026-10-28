// js/app/install/crime.ts
// Guns, the police, gangs & thieves (sim/crime.ts), and what hurts the player: crashes, a vehicle driven into them, a
// line down's shock, being thrown out of the car. Its HUD, the weapon wheel and the weapons' pictures. Killed or
// arrested, the player comes round elsewhere: the crime says so on the bus (`respawn`, install/controls.ts).
import { struckDamage, hardness, crashDamage, walletAmount, CRASH_GRACE } from '../../player/stats.ts';
import { groundHeight } from '../../world/ground.ts';
import { CrimeSystem } from '../../sim/crime.ts';
import { CrimeHud } from '../../ui/crime-hud.ts';
import { WeaponWheel } from '../../ui/weapon-wheel.ts';
import { WeaponIcons } from '../../ui/weapon-icons.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';
import type { PlayerParts } from './player.ts';
import type { AudioParts } from './audio.ts';

const SHOCK_DAMAGE = 22; // health a fallen line's shock takes at its worst (a few and you are down)

export type CrimeParts = ReturnType<typeof installCrime>;

export function installCrime({ scene, renderer, events, city, controllers, solidAt, saved, physics, ragdolls, cameras, aim, audio }:
  Boot & CityParts & PlayerParts & AudioParts) {
  const { traffic } = city;
  const crime = new CrimeSystem({
    scene, controllers, traffic, groundHeight, solidAt, canvas: renderer.domElement, audio, aim,
    onRespawn: (kind) => { events.emit('respawn', kind); }
  });
  if (saved.money !== undefined && Number.isFinite(saved.money)) crime.money = Math.max(0, Math.round(saved.money));
  crime.ragdolls = ragdolls;
  // (the patrol cars and the trucks near the player are cars in Jolt: crime/cruiser-bodies.ts)
  crime.physics = physics;
  // Thrown out through the windscreen (controllers.ts ejectDriver), or off the moto (ejectRider; stepping off it as it
  // falls over, offMoto, impact 0): on foot now, bleeding; out of the car hurt by how hard it hit (off the moto, the
  // crash itself already hurt, crashDamage)
  controllers.onEject = (impact, x, z, kind, bail = false) => {
    events.emit('mode', controllers.activeMode);
    const v = controllers.entities[kind];
    // jumped out at speed (boarding.ts leaveVehicle): grazed, not thrown through glass; past ~50 km/h it bleeds
    if (bail) {
      if (impact > 14) crime.fx.splatter(x, v.position.y + 1, z, impact * 0.5, Math.sin(v.heading), Math.cos(v.heading));
      crime.hurt(Math.min(60, Math.max(0, impact - 6) * 2.5), x, z);
      return;
    }
    if (impact > 0) crime.fx.splatter(x, v.position.y + 1, z, impact, Math.sin(v.heading), Math.cos(v.heading));
    if (kind === 'car') crime.hurt(Math.min(95, 25 + (impact - 19) * 4), x, z);
  };
  const crimeHud = new CrimeHud();
  // The weapon wheel, held open with Tab (ui/weapon-wheel.ts): the game runs slowed meanwhile. On foot the mouse wheel
  // switches weapons (Alt + the wheel, or a pinch, still zooms the camera); in a vehicle it zooms.
  const scrollSwitches = (e: WheelEvent) => !e.altKey && !e.ctrlKey && controllers.activeMode === 'person' && crime.state === 'play';
  const weaponWheel = new WeaponWheel(crime, { aim, canvas: renderer.domElement, canScroll: scrollSwitches });
  cameras.wheelZooms = (e) => !scrollSwitches(e);
  // Its pictures and the HUD's, the arsenal's 3D models in the hand (ui/weapon-icons.ts), baked once the city is up
  const weaponIcons = new WeaponIcons(renderer);
  crimeHud.icons = weaponIcons;
  weaponWheel.setIcons(weaponIcons);

  // A CFE line's shock, for who walks into it
  events.on('power', (e) => { if (e.type === 'shock') crime.hurt(SHOCK_DAMAGE * e.strength, e.x, e.z); });
  let lastCrash = -Infinity;
  events.on('collision', (impact) => {
    // the car, bicycle, moto or helicopter the player is in, hitting something hard enough (crashDamage)
    const mode = controllers.activeMode;
    const me = controllers.getActiveEntity();
    if (mode === 'person' || (impact.a !== me && impact.b !== me)) return;
    const damage = crashDamage(mode, impact.speed, hardness(impact.kind, impact.a === me ? impact.b : impact.a), impact.kind);
    const now = performance.now() * 0.001;
    if (damage <= 0 || now - lastCrash < CRASH_GRACE) return;
    lastCrash = now;
    crime.hurt(damage, impact.x, impact.z);
  });
  // A vehicle driving into the player on foot hurts; whoever the player knocked over leaves a wallet where they lie
  traffic.setMayhemListener((type, x, _y, z, speed, mass) => {
    if (type === 'struck') crime.hurt(struckDamage(speed, mass), x, z);
    else crime.drop('money', x, z, walletAmount()); // ('down')
  });
  return { crime, crimeHud, weaponWheel, weaponIcons };
}
