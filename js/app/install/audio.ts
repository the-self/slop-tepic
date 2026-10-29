// js/app/install/audio.ts
// The city's sound (audio/audio-system.ts): its button and the HUD's note of it, and what it hears on the bus, the
// crashes and the CFE's lines down.
import { onLocaleChange } from '../../i18n/i18n.ts';
import { CityAudioSystem } from '../../audio/audio-system.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';
import type { PlayerParts } from './player.ts';

export type AudioParts = ReturnType<typeof installAudio>;

export function installAudio({ hud, events, city, controllers }: Boot & CityParts & PlayerParts) {
  const { traffic, highwayTraffic, streetDetails } = city;
  const audio = new CityAudioSystem({ controllerManager: controllers, trafficSystem: traffic, highwayTraffic, streetDetails }, {
    onStateChange: () => { hud.showSound(audio); }
  });
  document.getElementById('btn-sound')?.addEventListener('click', () => { audio.setEnabled(!audio.enabled); });
  hud.showSound(audio);
  onLocaleChange(() => { hud.showSound(audio); });
  events.on('collision', (impact) => { audio.onCollision(impact); });
  // a CFE line down: an arc's crackle, a transformer's bang
  events.on('power', (e) => {
    if (e.type === 'bang') audio.gunfire('explosion', e.x, e.y, e.z);
    else audio.arc(e.x, e.y, e.z, e.strength);
  });
  // pagehide also covers navigation away on mobile; preserve the context across back-forward cache restores.
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) audio.dispose();
  });
  return { audio };
}
