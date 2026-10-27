// server/rooms.ts
// Rooms are per region (a metro area or state that shares one map, e.g. "nayarit" or "valle-de-mexico"), capped at
// `capacity` players. When every room of a region is full the next player opens a mirror room ("nayarit#2"), and
// empty rooms are dropped, so busy regions split instead of overflowing while quiet ones stay together.

import { SpatialGrid } from './aoi.ts';
import type { WireSky } from '../shared/protocol.ts';

/** A room of one region: `id` is "<region>#<index>", index 1 being the first, the others its mirrors */
export interface Room<P> {
  id: string;
  region: string;
  index: number;
  players: Map<number, P>;
  grid: SpatialGrid;
  /** the time of day & weather everyone in the room sees (wire indices; a new room starts on the real ones, 0 & 0) */
  sky: WireSky;
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
  rooms: Map<string, Room<P>>;

  // cellSize is in the units of the positions the grid is fed (see server/aoi.ts)
  constructor({ capacity = 200, cellSize = 250 }: { capacity?: number; cellSize?: number } = {}) {
    this.capacity = capacity;
    this.cellSize = cellSize;
    this.rooms = new Map(); // room id → room
  }

  // Puts a player ({ id, ... }) in the fullest-first open room of its region; returns that room
  join(region: string, player: P): Room<P> {
    let best: Room<P> | null = null;
    for (const room of this.rooms.values()) {
      if (room.region !== region || room.players.size >= this.capacity) continue;
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
    const room: Room<P> = { id: `${region}#${index}`, region, index, players: new Map(), grid: new SpatialGrid(this.cellSize), sky: { time: 0, weather: 0 } };
    this.rooms.set(room.id, room);
    return room;
  }

  leave(room: Room<P> | null, playerId: number): void {
    if (!room) return;
    room.players.delete(playerId);
    room.grid.remove(playerId);
    if (room.players.size === 0) this.rooms.delete(room.id);
  }

  stats(): RoomStats {
    const rooms = [...this.rooms.values()].map((r) => ({ id: r.id, region: r.region, players: r.players.size }));
    return { players: rooms.reduce((n, r) => n + r.players, 0), capacity: this.capacity, rooms };
  }
}

export { RoomManager };
