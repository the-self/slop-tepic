// js/app/game.ts
// What the game is put together from: the events its systems tell each other, and the whole set of parts main.ts
// installs (app/install/), one feature at a time. Each installer takes the parts installed before it and returns its
// own; the frame loop (app/frame-loop.ts) steps them all. Where a part installed early has to reach one installed
// later (the crime's respawn, the teleport; an ejection, the HUD), it says so on the bus instead of holding it.
import type { CollisionImpact } from '../audio/audio-sources.ts';
import type { RagdollHandle } from '../sim/ragdolls.ts';
import type { DownKind } from '../sim/crime.ts';
import type { PowerFault } from '../world/cfe-sparks.ts';
import type { PlayerMode } from '../player/controllers.ts';
import type { SkyTime, SkyWeather } from '../../shared/protocol.ts';
import type { Boot } from './install/boot.ts';
import type { City } from './city.ts';
import type { PlayerParts } from './install/player.ts';
import type { AudioParts } from './install/audio.ts';
import type { CrimeParts } from './install/crime.ts';
import type { CityLifeParts } from './install/city-life.ts';
import type { RenderingParts } from './install/rendering.ts';
import type { ControlsParts } from './install/controls.ts';
import type { NetParts } from './install/multiplayer.ts';

/** What the game's systems tell each other without importing each other (core/events.ts) */
export interface GameEvents {
  /** a crash of the player, the traffic or a street prop (each system's collision report); `kind` what struck:
   *  'vehicle', 'prop', a building's... (player/stats.ts hardness) */
  collision: CollisionImpact & { kind: string };
  /** someone thrown, shot or knocked down come to rest (sim/ragdolls.ts onSettle): blood under them, an ambulance */
  settle: RagdollHandle;
  /** a CFE line down (world/cfe-network.ts): an arc's crackle, a transformer's bang, a shock to the player */
  power: PowerFault;
  /** the player got into, out of or was thrown from something (boarding, an ejection, a respawn): the HUD, the
   *  touch & pad controls and the camera follow it */
  mode: PlayerMode;
  /** the player killed ('wasted') or arrested ('busted'), to come round somewhere safe (sim/crime.ts onRespawn) */
  respawn: DownKind;
  /** the menu opened (true) or closed */
  menu: boolean;
  /** a multiplayer room's sky, everyone's there: on joining, and whenever someone in the room changes it */
  roomSky: { time: SkyTime; weather: SkyWeather };
}

/** The city as installed, under `city` (app/city.ts) */
export interface CityParts { city: City }

/** Every part of the game, once all installed */
export type Game = Boot & CityParts & PlayerParts & AudioParts & CrimeParts & CityLifeParts & RenderingParts & ControlsParts & NetParts;
