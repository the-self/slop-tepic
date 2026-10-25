// js/app/player-state.ts
// The player saved in the browser between visits: where each of their vehicles (and they, on foot) stood, their car's
// look and their bicycle's colour, what they were in, and their money. Saved positions belong to one city's frame, so
// the storage key carries the city's name. Storage can be missing, disabled or full: playing never depends on it.
import type { CarLook, PlayerMode, ThirdPersonControllerManager } from '../player/controllers.ts';

/** Where one of the player's entities stood (m, rad) */
interface SavedPlace {
  x: number;
  y: number;
  z: number;
  heading: number;
}
/** A door to come back out of (an interior's venue): its position (m), outward normal and heading away from it */
export interface SavedDoor {
  x: number;
  z: number;
  nx: number;
  nz: number;
  heading: number;
}
/** What is stored (version 1) */
interface SavedPlayer {
  version: 1;
  activeMode: PlayerMode;
  entities: Partial<Record<PlayerMode, SavedPlace>>;
  looks: { car: CarLook; cyclist: { color: number }; moto?: { model: string; paint: number } };
  stats: { money: number };
}
/** What a saved player brings back: the mode they left in and their money (undefined when nothing was saved) */
export interface RestoredPlayer {
  mode: PlayerMode | null;
  money: number | undefined;
}

const MODES: readonly PlayerMode[] = ['person', 'car', 'cyclist', 'helicopter', 'moto'];
const isMode = (mode: unknown): mode is PlayerMode => MODES.some((m) => m === mode);

/** The storage key of a city's player */
export const playerStateKey = (city: string): string => `${(city || 'city').toLowerCase()}-player-state`;

/**
 * Puts the player's entities back where they were saved, at rest (through the teleport's placement), and their looks.
 * Leaves the controllers in whatever mode the last entity was restored in: the caller picks the mode to play in.
 */
export function restorePlayer(controllers: ThirdPersonControllerManager, key: string): RestoredPlayer {
  const restored: RestoredPlayer = { mode: null, money: undefined };
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return restored;
    const saved = JSON.parse(raw) as Partial<SavedPlayer> | null;
    if (saved?.version !== 1) return restored;
    for (const mode of MODES) {
      const p = saved.entities?.[mode];
      if (!p || ![p.x, p.y, p.z, p.heading].every(Number.isFinite)) continue;
      controllers.setMode(mode);
      controllers.teleportActiveTo(p.x, p.z, p.heading, p.y);
    }
    const car = saved.looks?.car;
    if (car && Number.isFinite(car.paint)) controllers.setCarLook(car.bodyType, car.paint, car.police, car.model, car.route);
    const bike = saved.looks?.cyclist;
    if (bike && Number.isFinite(bike.color)) controllers.setBikeColor(bike.color);
    const moto = saved.looks?.moto;
    if (moto && Number.isFinite(moto.paint)) controllers.setMotoLook(moto.model, moto.paint);
    restored.mode = isMode(saved.activeMode) ? saved.activeMode : null;
    restored.money = saved.stats?.money;
  } catch { /* Missing or unavailable storage does not prevent playing. */ }
  return restored;
}

/** Saves the player; inside a room (`door`: its venue's), on foot they are saved just outside its door */
export function savePlayer(controllers: ThirdPersonControllerManager, key: string, money: number, door: SavedDoor | null): void {
  try {
    const entities: Partial<Record<PlayerMode, SavedPlace>> = {};
    for (const mode of MODES) {
      const entity = controllers.entities[mode];
      entities[mode] = { x: entity.position.x, y: entity.position.y, z: entity.position.z, heading: entity.heading };
    }
    if (door) entities.person = { x: door.x + door.nx * 1.2, y: 0, z: door.z + door.nz * 1.2, heading: door.heading };
    const state: SavedPlayer = {
      version: 1,
      activeMode: controllers.activeMode,
      entities,
      looks: { car: controllers.entities.car.look, cyclist: controllers.entities.cyclist.look, moto: controllers.entities.moto.look },
      stats: { money }
    };
    localStorage.setItem(key, JSON.stringify(state));
  } catch { /* Storage may be disabled or full. */ }
}
