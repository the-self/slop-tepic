// server/play.ts
// How the players play together, server side (shared/protocol-play.ts): crews (invite, accept, decline, leave), passive
// mode, each one's car look, its wanted stars and the police after it, its health's reports and pickups (server/vitals.ts). A player's TAG (its crew, passive mode, stars),
// LOOK and UNITS go to those who have it in view, as its poses do, and to a newcomer to that view after its first TICK
// (introduce). Who may hurt whom (canHurt) is the room's rules, the crews and passive mode.
import { encodeTag, encodeCrewAsk, encodeCrewSet, encodeLookSeen, encodeUnitsSeen, PLAY_OP } from '../shared/protocol-play.ts';
import type { PlayClientMessage } from '../shared/protocol-play.ts';
import type { Player } from './index.ts';
import type { Room } from './rooms.ts';

// A player who hurt or was hurt by another this lately can't go passive (no ducking out of a fight it started)
const PASSIVE_AFTER_FIGHT_MS = 10000;

export type Send = (p: Player, bytes: Uint8Array) => void;

const tagOf = (room: Room<Player>, p: Player) => encodeTag(p.id, room.crews.crew(p.id), p.passive, p.stars);
const tagged = (room: Room<Player>, p: Player) => p.passive || p.stars > 0 || room.crews.crew(p.id) !== 0;

// `frame` to those who have `p` in view (not to p)
function toViewers(p: Player, frame: Uint8Array, send: Send): void {
  for (const other of p.viewers) send(other, frame);
}

/** Whether player `a`'s hits land on player `b`: PvP on in the room, both alive, neither in passive mode, not crew mates */
function canHurt(room: Room<Player>, a: Player, b: Player): boolean {
  return room.rules.pvp && a.vitals.alive && b.vitals.alive && !a.passive && !b.passive && !room.crews.together(a.id, b.id);
}

/** A play message from player `p`, in `room`, at `now` (ms) */
function handlePlay(p: Player, room: Room<Player>, msg: PlayClientMessage, now: number, send: Send): void {
  if (msg.op === PLAY_OP.LOOK) {
    p.look = msg.look;
    toViewers(p, encodeLookSeen(p.id, p.look), send);
  } else if (msg.op === PLAY_OP.PASSIVE) {
    if (msg.on === p.passive) return;
    // (turned down: the player hears its own tag as it stands)
    if (msg.on && now - p.fightAt < PASSIVE_AFTER_FIGHT_MS) {
      send(p, tagOf(room, p));
      return;
    }
    p.passive = msg.on;
    const tag = tagOf(room, p);
    toViewers(p, tag, send);
    send(p, tag);
  } else if (msg.op === PLAY_OP.WANTED) {
    if (msg.stars === p.stars) return;
    p.stars = msg.stars;
    toViewers(p, tagOf(room, p), send);
  } else if (msg.op === PLAY_OP.UNITS) {
    const frame = encodeUnitsSeen(p.id, msg.units);
    toViewers(p, frame, send);
    p.units = msg.units.length ? frame : null;
  } else if (msg.op === PLAY_OP.VITALS) {
    p.vitals.report(msg.health, msg.armor);
  } else if (msg.op === PLAY_OP.HEAL) {
    p.vitals.heal(msg.kind, now);
  } else if (msg.op === PLAY_OP.REPORT) {
    // (server/index.ts's: it writes them down)
  } else if (msg.action === 'invite') {
    const target = room.players.get(msg.player);
    if (target && room.crews.invite(p.id, target.id, now)) send(target, encodeCrewAsk(p.id, p.name ?? ''));
  } else if (msg.action === 'accept') {
    const changed = room.crews.accept(p.id, msg.player, now);
    if (changed) crewChanged(room, changed, send);
  } else if (msg.action === 'decline') {
    room.crews.decline(p.id, msg.player);
  } else {
    crewChanged(room, room.crews.leave(p.id), send);
  }
}

/** The players `ids` are in another crew (or none) now: each hears its crew, and those who see it its tag */
function crewChanged(room: Room<Player>, ids: readonly number[], send: Send): void {
  for (const id of ids) {
    const pl = room.players.get(id);
    if (!pl) continue;
    const members = [...room.crews.mates(id)].map((m) => ({ id: m, name: room.players.get(m)?.name ?? '' }));
    send(pl, encodeCrewSet(room.crews.crew(id), members));
    toViewers(pl, tagOf(room, pl), send);
  }
}

/** After a TICK that brought players `entered` into `p`'s view: their tags, car looks and units */
function introduce(room: Room<Player>, p: Player, entered: readonly number[], send: Send): void {
  for (const id of entered) {
    const o = room.players.get(id);
    if (!o) continue;
    if (tagged(room, o)) send(p, tagOf(room, o));
    if (o.look) send(p, encodeLookSeen(o.id, o.look));
    if (o.units) send(p, o.units);
  }
}

export { canHurt, handlePlay, crewChanged, introduce };
