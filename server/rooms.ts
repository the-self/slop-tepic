// server/rooms.ts
// Rooms are per region (a metro area or state that shares one map, e.g. "nayarit" or "valle-de-mexico"), capped at
// `capacity` players. When every room of a region is full the next player opens a mirror room ("nayarit#2"), and
// empty rooms are dropped, so busy regions split instead of overflowing while quiet ones stay together.
// A player can also open a room of their own (create): a title, a short code friends type to join it, an optional
// password (kept hashed, server/passwords.ts), the sky it starts with and its rules (police, PvP), which only its host
// changes. When the host leaves, the oldest player left takes over. Left empty, it waits a while (sweep) for its
// players to come back, a dropped connection rejoining by its code, before it closes.

import { randomInt } from 'node:crypto';
import { SpatialGrid } from './aoi.ts';
import { DEFAULT_RULES, SKY_TIMES, SKY_WEATHERS } from '../shared/protocol.ts';
import type { RoomRules, SkyTime, SkyWeather, WireSky } from '../shared/protocol.ts';
import type { PasswordHash } from './passwords.ts';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // (no 0/O or 1/I: read out loud or off a phone)
const CODE_LENGTH = 5;

/**
 * A room of one region. A public one's `id` is "<region>#<index>", index 1 being the first, the others its mirrors; a
 * player's own is "<region>~<code>", index 0.
 */
export interface Room<P> {
  id: string;
  region: string;
  index: number;
  players: Map<number, P>;
  grid: SpatialGrid;
  /** the time of day & weather everyone in the room sees (wire indices; a new room starts on the real ones, 0 & 0) */
  sky: WireSky;
  title: string; // '' for a public room
  code: string; // what friends type to join it ('' for a public room)
  password: PasswordHash | null;
  rules: RoomRules;
  host: number; // the player who sets the sky and rules (0: nobody, a public room: anyone sets its sky)
  fails: number; // passwords tried (and not right) since failsAt (ms, Date.now()): the brake on guessing
  failsAt: number;
  emptyAt: number; // ms (Date.now()) a player's own room was left empty (0: someone is in it)
}

/** A room as the room list (GET /rooms) shows it */
export interface RoomSummary {
  id: string;
  title: string;
  code: string;
  players: number;
  capacity: number;
  locked: boolean;
  time: SkyTime;
  weather: SkyWeather;
  rules: RoomRules;
}

/** What a player's own room opens with */
export interface RoomOpening {
  title: string;
  password: PasswordHash | null;
  sky: WireSky;
  rules: RoomRules;
}

export interface RoomStats {
  players: number;
  capacity: number;
  rooms: { id: string; region: string; players: number }[];
}

// P is what the server keeps per player; the rooms only need its id
class RoomManager<P extends { id: number }> {
  capacity: number;
  cellSize: number;
  unit: number; // position units a metre
  rooms: Map<string, Room<P>>;

  // cellSize is in the units of the positions the grid is fed, `unit` of them a metre (see server/aoi.ts)
  constructor({ capacity = 200, cellSize = 250, unit = 1 }: { capacity?: number; cellSize?: number; unit?: number } = {}) {
    this.capacity = capacity;
    this.cellSize = cellSize;
    this.unit = unit;
    this.rooms = new Map(); // room id → room
  }

  // Puts a player ({ id, ... }) in the fullest-first open room of its region; returns that room
  join(region: string, player: P): Room<P> {
    let best: Room<P> | null = null;
    for (const room of this.rooms.values()) {
      if (room.region !== region || room.code || room.players.size >= this.capacity) continue;
      // Fill the busiest open mirror first so players meet instead of spreading thin
      if (!best || room.players.size > best.players.size || (room.players.size === best.players.size && room.index < best.index)) {
        best = room;
      }
    }
    best ??= this.open(region);
    best.players.set(player.id, player);
    return best;
  }

  open(region: string): Room<P> {
    let index = 1;
    while (this.rooms.has(`${region}#${index}`)) index++;
    const room = this.room(`${region}#${index}`, region, index, '', { title: '', password: null, sky: { time: 0, weather: 0 }, rules: DEFAULT_RULES });
    this.rooms.set(room.id, room);
    return room;
  }

  // Opens a player's own room in `region`, with a code no other room there has, and puts `player` in it as its host
  create(region: string, player: P, opening: RoomOpening): Room<P> {
    const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
    let code = newCode();
    while (this.rooms.has(`${region}~${code}`)) code = newCode();
    const room = this.room(`${region}~${code}`, region, 0, code, opening);
    room.host = player.id;
    room.players.set(player.id, player);
    this.rooms.set(room.id, room);
    return room;
  }

  // The room of `region` whose id or code is `key` (codes ignore case and spaces)
  find(region: string, key: string): Room<P> | undefined {
    const byId = this.rooms.get(key);
    if (byId) return byId.region === region ? byId : undefined;
    const code = key.replace(/\s+/g, '').toUpperCase();
    return code ? this.rooms.get(`${region}~${code}`) : undefined;
  }

  // Puts `player` in `room` unless it is full; true when it got in
  enter(room: Room<P>, player: P): boolean {
    if (room.players.size >= this.capacity) return false;
    if (room.code && room.players.size === 0) room.host = player.id; // (the first one back into an empty room hosts it)
    room.emptyAt = 0;
    room.players.set(player.id, player);
    return true;
  }

  // Takes the player out of its room; true when that made someone else the host (the server tells the room)
  leave(room: Room<P> | null, playerId: number): boolean {
    if (!room) return false;
    room.players.delete(playerId);
    room.grid.remove(playerId);
    if (room.players.size === 0) {
      // a public room goes at once (the next player opens another); a player's own waits for its players (sweep)
      if (room.code) room.emptyAt = Date.now();
      else this.rooms.delete(room.id);
      return false;
    }
    if (room.host !== playerId) return false;
    room.host = room.players.keys().next().value ?? 0; // (a Map keeps the order they came in: the oldest)
    return true;
  }

  // Closes the players' own rooms left empty more than `graceMs` before `now` (ms, Date.now())
  sweep(now: number, graceMs: number): void {
    for (const room of this.rooms.values()) if (room.emptyAt && now - room.emptyAt > graceMs) this.rooms.delete(room.id);
  }

  // The rooms of `region` a player can pick from: the public ones, then the players' own, fullest first
  list(region: string): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => r.region === region)
      .sort((a, b) => Number(Boolean(a.code)) - Number(Boolean(b.code)) || b.players.size - a.players.size)
      .map((r) => ({
        id: r.id, title: r.title, code: r.code, players: r.players.size, capacity: this.capacity, locked: r.password !== null,
        time: SKY_TIMES.at(r.sky.time) ?? 'live', weather: SKY_WEATHERS.at(r.sky.weather) ?? 'live', rules: r.rules
      }));
  }

  private room(id: string, region: string, index: number, code: string, { title, password, sky, rules }: RoomOpening): Room<P> {
    return {
      id, region, index, players: new Map(), grid: new SpatialGrid(this.cellSize, this.unit), sky: { ...sky }, title, code, password,
      rules: { ...rules }, host: 0, fails: 0, failsAt: 0, emptyAt: 0
    };
  }

  stats(): RoomStats {
    const rooms = [...this.rooms.values()].map((r) => ({ id: r.id, region: r.region, players: r.players.size }));
    return { players: rooms.reduce((n, r) => n + r.players, 0), capacity: this.capacity, rooms };
  }
}

export { RoomManager };
