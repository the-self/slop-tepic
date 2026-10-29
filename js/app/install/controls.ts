// js/app/install/controls.ts
// How the player plays: the touch and pad controls, the keyboard's shortcuts, the cameras' buttons, getting in & out
// (app/boarding.ts), the teleports, the full map and the menu [Esc]. The HUD follows whatever the player is in now,
// and a respawn (the crime's, on the bus) lands the player at the hospital or a teleport spot.
import { cycleLocale, onLocaleChange, tName, setText, t } from '../../i18n/i18n.ts';
import { isTypingInField, TELEPORT_LOCATIONS, HOSPITALS } from '../../world/city-config.ts';
import { nearest } from '../../player/stats.ts';
import { TouchControls } from '../../input/touch-controls.ts';
import { keyBindings, keyLabel, isBindAction } from '../../input/keybindings.ts';
import { GamepadControls } from '../../input/gamepad-controls.ts';
import { KeyConfig } from '../../ui/key-config.ts';
import { CityMapSystem } from '../../ui/city-map.ts';
import { CAMERA_PRESETS } from '../../player/cameras.ts';
import { GameMenu } from '../menu.ts';
import { createTeleport, wireTeleportButtons } from '../teleport.ts';
import { Boarding } from '../boarding.ts';
import type { CameraPresetId } from '../../player/cameras.ts';
import type { Boot } from './boot.ts';
import type { CityParts } from '../game.ts';
import type { PlayerParts } from './player.ts';
import type { AudioParts } from './audio.ts';
import type { CrimeParts } from './crime.ts';
import type { CityLifeParts } from './city-life.ts';

// The keys 5-0 pick a camera
const CAMERA_KEYS: Readonly<Partial<Record<string, CameraPresetId>>> = {
  Digit5: 'chase', Digit6: 'action', Digit7: 'pov', Digit8: 'fifthAve', Digit9: 'timesSquare', Digit0: 'chryslerGCT'
};
const isCameraId = (id: string | null): id is CameraPresetId => CAMERA_PRESETS.some((p) => p.id === id);

export type ControlsParts = ReturnType<typeof installControls>;

export function installControls({ renderer, hud, events, city, controllers, cameras, stamina, audio, crime, weaponWheel, rooms, streetFood, fires, gasStations }:
  Boot & CityParts & PlayerParts & AudioParts & CrimeParts & CityLifeParts) {
  const { traffic, carParks, stores, cityBlocks } = city;
  const cameraButtons = document.querySelectorAll('[data-camera]');
  const hudToggleBtn = document.getElementById('btn-toggle-hud');
  const boardButton = document.getElementById('touch-board');

  const touch = new TouchControls(controllers);
  const gamepad = new GamepadControls(controllers, cameras, {
    onBoard: () => { if (!gasStations.refuel()) boarding.board(); }, // (by a pump: fill up, sim/gas-stations.ts)
    onCycleCamera: cycleCamera,
    onCycleWeapon: (dir) => { crime.cycleWeapon(dir); },
    // LB held: the weapon wheel, the right stick pointing
    onWeaponWheel: (action, x, y) => {
      if (action === 'open') weaponWheel.open(false);
      else if (action === 'aim') weaponWheel.stick(x ?? 0, y ?? 0);
      else weaponWheel.close(action === 'close');
    },
    onToggleMap: () => {
      menu.toggle(false);
      map.toggleFullMap(!map.isFullMapOpen);
    },
    onCloseMap: () => {
      map.toggleFullMap(false);
      menu.toggle(false);
    },
    onMenu: () => { if (!map.isFullMapOpen) menu.toggle(!menu.isOpen); }
  });

  // The HUD follows whatever the player is in now (on foot, or the vehicle it got into)
  // the mode's name (the vehicle's)
  function showMode() {
    hud.showMode(controllers.activeMode, tName(controllers.getActiveEntity().label));
  }
  function syncMode() {
    const mode = controllers.activeMode;
    touch.setMode(mode);
    // (a horn only in a car, audio.honk; no guns from the helicopter, crime.ts)
    for (const tool of document.querySelectorAll<HTMLElement>('[data-touch-tool]')) {
      tool.hidden = (tool.dataset.touchTool === 'horn' && mode !== 'car') || (tool.dataset.touchTool === 'weapon' && mode === 'helicopter');
    }
    gamepad.reset();
    showMode();
    // If currently on a static scenic camera, switch to 3rd-Person Chase so user sees their selected character/vehicle
    if (cameras.getActivePreset().category !== 'follow') selectCamera('chase', false);
  }
  events.on('mode', syncMode);

  const boarding = new Boarding({
    controllers, traffic, carParks, crime, tills: stores.tills, interiors: rooms, streetFood,
    mapOpen: () => map.isFullMapOpen, onModeChange: syncMode
  });
  boardButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!gasStations.refuel()) boarding.board(); // (by a pump: fill up, sim/gas-stations.ts)
  });
  // The touch screen's M, V, R & B (index.html .touch-tools): the map, the next camera, the next weapon, the horn
  for (const tool of document.querySelectorAll<HTMLElement>('[data-touch-tool]')) {
    tool.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const name = tool.dataset.touchTool;
      if (name === 'map') map.toggleFullMap(true);
      else if (name === 'camera') cycleCamera(1);
      else if (name === 'weapon') crime.cycleWeapon(1);
      else if (name === 'horn') audio.honk(controllers.getActiveEntity());
    });
  }

  function selectCamera(camId: CameraPresetId, snap = false) {
    cameras.setCameraPreset(camId, snap);
    cameraButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-camera') === camId);
    });
  }

  // Steps through CAMERA_PRESETS (V / Shift+V, the pad's RB)
  function cycleCamera(step: number) {
    const n = CAMERA_PRESETS.length;
    const idx = CAMERA_PRESETS.findIndex((p) => p.id === cameras.activePresetId);
    selectCamera(CAMERA_PRESETS[(idx + step + n) % n].id, true);
  }
  cameraButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-camera');
      if (isCameraId(id)) selectCamera(id, true);
      menu.toggle(false);
    });
  });

  // No browser context menu in the game (text fields keep theirs): right-click or macOS Ctrl+click opened it, and
  // opened mid-drag it swallowed the pointerup so the camera kept orbiting with the bare mouse
  document.addEventListener('contextmenu', (e) => {
    if (!isTypingInField(e)) e.preventDefault();
  });
  // A mouse click mustn't leave the focus on a HUD button, or Space (jump / ascend) and Enter would press it again
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (btn && e.detail > 0) btn.blur();
  });

  const teleport = createTeleport({
    controllers, touch, gamepad, cameras,
    room: () => rooms, selectCamera
  });
  // Killed, the player comes round at the nearest hospital (OpenStreetMap's, HOSPITALS), arrested at the nearest
  // teleport spot, on foot either way (sim/crime.ts onRespawn)
  events.on('respawn', (kind) => {
    if (controllers.activeMode === 'helicopter') {
      controllers.setMode('person');
      controllers.landHelicopter();
    } else if (controllers.activeMode !== 'person') {
      controllers.exitVehicle();
    }
    const p = controllers.entities.person.position;
    // (a hospital has no heading: the teleport's default faces the player south)
    const spot: { x: number; z: number; name: string; heading?: number } | null =
      (kind === 'wasted' ? nearest(HOSPITALS, p.x, p.z) : null) ?? nearest(Object.values(TELEPORT_LOCATIONS), p.x, p.z);
    if (spot) teleport(spot.x, spot.z, spot.heading);
    if (kind === 'wasted' && spot?.name) crime.toast(spot.name);
    stamina.reset();
    syncMode();
  });
  const map = new CityMapSystem({
    controllerManager: controllers,
    cameraSystem: cameras,
    trafficSystem: traffic,
    allBlocks: [...cityBlocks.allBlocks, city.uan.map, city.central.map], // (the UAN's & the Central's buildings are their own, not among the blocks')
    onToggle: (open) => {
      controllers.resetInput();
      touch.setEnabled(!open);
      gamepad.setEnabled(!open);
      const mapHint = document.getElementById('fullmap-hover-info');
      if (open && touch.available && mapHint) {
        setText(mapHint, 'map.hintTouch');
      }
    },
    onTeleport: teleport
  });
  // The menu [Esc] (app/menu.ts): the game's input waits while it is open, as it does under the map. Its Keys tab
  // rebinds the keyboard (ui/key-config.ts); the keycaps shown elsewhere in the menu follow
  const keyConfig = new KeyConfig(document.getElementById('key-config'), keyBindings, document.getElementById('keys-reset'));
  const menu = new GameMenu({
    onToggle: (open) => {
      keyConfig.cancel();
      events.emit('menu', open); // (whose sky it is, install/sky.ts)
      controllers.resetInput();
      touch.setEnabled(!open);
      gamepad.setEnabled(!open);
    },
    busy: () => map.isFullMapOpen || weaponWheel.isOpen,
    onKey: (e) => keyConfig.handleKey(e)
  });
  // (the menu's keycaps: kbd[data-key="<binding>"])
  const showKeycaps = () => {
    for (const kbd of document.querySelectorAll<HTMLElement>('kbd[data-key]')) {
      const action = kbd.dataset.key;
      const code = isBindAction(action) ? keyBindings.get(action).at(0) : undefined;
      kbd.textContent = code ? keyLabel(code) : '';
      kbd.hidden = !code;
    }
  };
  keyBindings.onChange(showKeycaps);
  showKeycaps();
  document.getElementById('btn-menu')?.addEventListener('click', () => { menu.toggle(true); });
  wireTeleportButtons(document.querySelectorAll('[data-teleport]'), TELEPORT_LOCATIONS, teleport, () => { menu.toggle(false); });
  // (the police, gangs, pickups, fires & gas stations on the radar)
  map.setBlipSource(() => gasStations.blips(fires.blips(crime.blips())));
  map.setPolice(crime); // (where the police can see the player, on both maps)
  document.getElementById('btn-open-map')?.addEventListener('click', () => {
    menu.toggle(false);
    map.toggleFullMap(true);
  });

  const showHudToggle = () => {
    if (!hudToggleBtn) return;
    const isMin = document.body.classList.contains('hud-minimized');
    hudToggleBtn.setAttribute('aria-pressed', String(isMin));
    hudToggleBtn.title = t(isMin ? 'hud.showTitle' : 'hud.hideTitle');
  };
  showHudToggle();
  hudToggleBtn?.addEventListener('click', () => {
    document.body.classList.toggle('hud-minimized');
    showHudToggle();
  });

  // The language (the menu's Settings, and the loading screen's button): every text the HUD keeps is shown again in
  // the new language
  document.getElementById('btn-lang')?.addEventListener('click', cycleLocale);
  onLocaleChange(() => {
    showMode();
    showHudToggle();
  });

  // Global keyboard shortcuts (their keys the menu's, input/keybindings.ts): getting in & out, cameras (and 5-0), the
  // clean view, sound and the horn
  window.addEventListener('keydown', (e) => {
    if (isTypingInField(e)) return;
    if (e.code === 'Tab') e.preventDefault(); // (in play Tab never hops the focus onto a button Space would then press)
    const plain = !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey;
    const camera = CAMERA_KEYS[e.code];
    if (camera) selectCamera(camera, true);
    else if (keyBindings.is('board', e.code) && plain) boarding.board();
    else if (keyBindings.is('camera', e.code)) cycleCamera(e.shiftKey ? -1 : 1);
    else if (keyBindings.is('cleanView', e.code)) hudToggleBtn?.click();
    else if (keyBindings.is('sound', e.code) && plain) audio.setEnabled(!audio.enabled);
    else if (keyBindings.is('horn', e.code) && plain && !map.isFullMapOpen) audio.honk(controllers.getActiveEntity());
    else if (keyBindings.is('refuel', e.code) && plain) gasStations.refuel();
  });

  window.addEventListener('resize', () => {
    cameras.onResize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (map.isFullMapOpen) {
      map.resizeFullCanvas();
      map.renderFullMap();
    }
  });

  // Initialize the UI and chase camera around the player, on foot.
  syncMode();
  selectCamera('chase', true);
  return { touch, gamepad, boarding, teleport, map, menu };
}
