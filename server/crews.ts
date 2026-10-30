// server/crews.ts
// A room's crews: a few friends (CREW_MAX) who play together. One invites another, who accepts (or declines) within
// INVITE_MS; accepting puts it in the inviter's crew (a new one, if the inviter had none), out of any it was in. Crew
// mates can't hurt each other, and the server keeps them in each other's view however far apart they are
// (server/index.ts). A crew of one is no crew: the last one left in it is out of it too.
import { CREW_MAX } from '../shared/protocol-play.ts';

const INVITE_MS = 60000; // an invitation stands this long

class Crews {
  private next = 1;
  private readonly members = new Map<number, Set<number>>(); // crew id → its players
  private readonly crewOf = new Map<number, number>(); // player → its crew id
  private readonly invites = new Map<number, Map<number, number>>(); // invitee → inviter → ms (Date.now()) it was sent

  /** The crew player `id` is in (0: none) */
  crew(id: number): number {
    return this.crewOf.get(id) ?? 0;
  }

  /** The players in player `id`'s crew, itself among them (empty: in none) */
  mates(id: number): ReadonlySet<number> {
    return this.members.get(this.crew(id)) ?? NONE;
  }

  /** Whether players a and b are in one crew */
  together(a: number, b: number): boolean {
    const crew = this.crew(a);
    return crew !== 0 && crew === this.crew(b);
  }

  /** Player `from` invites player `to` at `now` (ms): false when it can't (itself, a mate already, its crew full) */
  invite(from: number, to: number, now: number): boolean {
    if (from === to || this.together(from, to) || this.mates(from).size >= CREW_MAX) return false;
    let mine = this.invites.get(to);
    if (!mine) this.invites.set(to, (mine = new Map<number, number>()));
    mine.set(from, now);
    return true;
  }

  /** Player `to` takes player `from`'s invitation at `now` (ms): the players whose crew changed, or null (none stands) */
  accept(to: number, from: number, now: number): number[] | null {
    const sent = this.invites.get(to)?.get(from);
    this.invites.get(to)?.delete(from);
    if (sent === undefined || now - sent > INVITE_MS || this.together(from, to) || this.mates(from).size >= CREW_MAX) return null;
    const changed = this.leave(to);
    let crew = this.crew(from);
    if (!crew) {
      crew = this.next++;
      this.members.set(crew, new Set([from]));
      this.crewOf.set(from, crew);
    }
    this.members.get(crew)?.add(to);
    this.crewOf.set(to, crew);
    for (const id of this.mates(to)) if (!changed.includes(id)) changed.push(id);
    return changed;
  }

  /** Player `to` turns down player `from`'s invitation */
  decline(to: number, from: number): void {
    this.invites.get(to)?.delete(from);
  }

  /** Player `id` leaves its crew (or the room): the players whose crew changed, itself first (none: it was in none) */
  leave(id: number): number[] {
    const crew = this.crew(id);
    this.invites.delete(id);
    if (!crew) return [];
    const left = this.members.get(crew);
    this.crewOf.delete(id);
    left?.delete(id);
    const changed = [id, ...(left ?? [])];
    // (the last one left is in no crew either)
    if (left && left.size < 2) {
      for (const other of left) this.crewOf.delete(other);
      this.members.delete(crew);
    }
    return changed;
  }
}

const NONE: ReadonlySet<number> = new Set();

export { Crews, INVITE_MS };
