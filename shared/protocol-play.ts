// shared/protocol-play.ts
// The protocol's messages about how the players play together (shared/protocol.ts has the rest and decodes these
// too): crews, passive mode, each one's car look, the wanted level and the police after it, and the player's profile.
//
// client → server
//   LOOK    u8 op, str body, str model, u8 r, u8 g, u8 b, u8 flags (1 police)   the player's car as it looks now
//   CREW    u8 op, u8 action (CREW_ACTIONS), u16 player                        invite a player, accept or decline its
//                                                                             invitation, leave the crew (player 0)
//   PASSIVE u8 op, u8 on                                                       passive mode on or off
//   WANTED  u8 op, u8 stars                                                    the player's wanted level (0-5)
//   UNITS   u8 op, u8 n, n × (u8 kind, i32 x, i32 y, i32 z (cm), u16 heading, i16 speed (dm/s))
//                                                                             the police (and the rest) after the player
//   VITALS  u8 op, u8 health, u8 armor                                         the player's health & armor as its game has them
//   HEAL    u8 op, u8 kind (HEAL_KINDS)                                        it took a health or an armour pickup
//   REPORT  u8 op, u16 player, u8 reason (REPORT_REASONS)                      it reports another player
// server → client
//   PROFILE    u8 op, str token, u32 kills, u32 deaths, u32 best, u32 seconds  the player's profile (its token to keep)
//   TAG        u8 op, u16 id, u16 crew, u8 flags (TAG_*)                       a player's crew, passive mode & stars
//   CREW_ASK   u8 op, u16 from, str name                                       player `from` invites this one to its crew
//   CREW_SET   u8 op, u16 crew, u8 n, n × (u16 id, str name)                   the crew this player is in now (n 0: none)
//   LOOK_SEEN  u8 op, u16 id, (look as LOOK)                                   a player in view's car look
//   UNITS_SEEN u8 op, u16 from, u8 n, (units as UNITS)                         the units after player `from`
//   KILLED     u8 op, u16 by (0: nobody)                                       the server's word: this player is dead
//
// The server keeps each player's health (server/vitals.ts): the other players' hits take it, VITALS only ever lower it
// (the city's own harm, which the server doesn't see), HEAL raises it no more often than the pickups come. When it runs
// out the player is dead, whatever its game says (KILLED), and hurts nobody till it is back up.
// A crew is a few friends in one room (CREW_MAX): they can't hurt each other, see each other on the map wherever they
// are, and the server sends their poses however far off they are. A player in passive mode can't hurt or be hurt by
// other players (the server drops the HITs either way).
import { Writer, toCm, toHeading, toSpeed, fromHeading, capped } from './wire.ts';
import type { Reader } from './wire.ts';

const CREW_MAX = 8; // players in one crew
const UNITS_MAX = 12; // units one player's chase sends
const LOOK_TEXT_MAX = 32; // characters in a look's body or model id
const TOKEN_LENGTH = 20; // characters in a profile's token (base-32: 100 bits)
const TOKEN_RE = /^[a-z2-7]{20}$/;
const STARS_MAX = 5;
const WORLD_CM = 2e9; // |x|, |y|, |z| a unit may stand at, in cm (protocol.ts WORLD_LIMIT)
// (new ones go at the end: older clients' indices hold)
const CREW_ACTIONS = ['invite', 'accept', 'decline', 'leave'] as const;
const HEAL_KINDS = ['health', 'armor'] as const;
const REPORT_REASONS = ['cheating', 'abuse'] as const;
const UNIT_KINDS = ['cruiser', 'truck', 'army', 'heli'] as const;
const LOOK_POLICE = 1; // LOOK flags: a patrol car's livery
const TAG_PASSIVE = 1; // TAG flags: in passive mode, and (bits 1-3) its wanted stars
const TAG_STARS_SHIFT = 1;

const PLAY_OP = {
  // client → server
  LOOK: 10,
  CREW: 11,
  PASSIVE: 12,
  WANTED: 13,
  UNITS: 14,
  VITALS: 15,
  HEAL: 16,
  REPORT: 17,
  // server → client
  PROFILE: 110,
  TAG: 111,
  CREW_ASK: 112,
  CREW_SET: 113,
  LOOK_SEEN: 114,
  UNITS_SEEN: 115,
  KILLED: 116
} as const;

export type CrewAction = (typeof CREW_ACTIONS)[number];
export type UnitKind = (typeof UNIT_KINDS)[number];
export type HealKind = (typeof HEAL_KINDS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A car's look as it travels: its body shape and model ids (js/models/cars), its paint (0xrrggbb), a patrol car's livery */
export interface CarLookWire {
  body: string;
  model: string;
  paint: number;
  police: boolean;
}
/** A unit after a player: what it is, where (cm), its heading (1/65536 turns) and speed (dm/s), in wire units */
export interface WireUnit {
  kind: number;
  x: number;
  y: number;
  z: number;
  h: number;
  s: number;
}
/** A unit as the client has it: metres, radians, m/s */
export interface Unit {
  kind: UnitKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
}

// client → server, decoded by the server
export interface LookMessage {
  op: typeof PLAY_OP.LOOK;
  look: CarLookWire;
}
export interface CrewMessage {
  op: typeof PLAY_OP.CREW;
  action: CrewAction;
  player: number;
}
export interface PassiveMessage {
  op: typeof PLAY_OP.PASSIVE;
  on: boolean;
}
export interface WantedMessage {
  op: typeof PLAY_OP.WANTED;
  stars: number;
}
export interface UnitsMessage {
  op: typeof PLAY_OP.UNITS;
  units: WireUnit[];
}
export interface VitalsMessage {
  op: typeof PLAY_OP.VITALS;
  health: number; // hit points, 0-100
  armor: number;
}
export interface HealMessage {
  op: typeof PLAY_OP.HEAL;
  kind: HealKind;
}
export interface ReportMessage {
  op: typeof PLAY_OP.REPORT;
  player: number;
  reason: ReportReason;
}
export type PlayClientMessage = LookMessage | CrewMessage | PassiveMessage | WantedMessage | UnitsMessage | VitalsMessage | HealMessage | ReportMessage;

// server → client
/** The player's profile on this server: kills & deaths of other players, the best run of kills without dying, the
 *  seconds played; its token is what the client keeps to be the same player next time (and on another device) */
export interface ProfileMessage {
  op: typeof PLAY_OP.PROFILE;
  token: string;
  kills: number;
  deaths: number;
  best: number;
  seconds: number;
}
export interface TagMessage {
  op: typeof PLAY_OP.TAG;
  id: number;
  crew: number; // 0: in none
  passive: boolean;
  stars: number;
}
export interface CrewAskMessage {
  op: typeof PLAY_OP.CREW_ASK;
  from: number;
  name: string;
}
export interface CrewMember {
  id: number;
  name: string;
}
export interface CrewSetMessage {
  op: typeof PLAY_OP.CREW_SET;
  crew: number; // 0: in none
  members: CrewMember[];
}
export interface LookSeenMessage {
  op: typeof PLAY_OP.LOOK_SEEN;
  id: number;
  look: CarLookWire;
}
export interface UnitsSeenMessage {
  op: typeof PLAY_OP.UNITS_SEEN;
  from: number;
  units: Unit[];
}
/** The server's word that this player is dead (its health ran out there), killed by player `by` (0: nobody) */
export interface KilledMessage {
  op: typeof PLAY_OP.KILLED;
  by: number;
}
export type PlayServerMessage = ProfileMessage | TagMessage | CrewAskMessage | CrewSetMessage | LookSeenMessage | UnitsSeenMessage | KilledMessage;

const PLAY_CLIENT_OPS: ReadonlySet<number> = new Set([PLAY_OP.LOOK, PLAY_OP.CREW, PLAY_OP.PASSIVE, PLAY_OP.WANTED, PLAY_OP.UNITS, PLAY_OP.VITALS, PLAY_OP.HEAL, PLAY_OP.REPORT]);
/** Whether a decoded client message is one of these (the server hands them to server/play.ts) */
const isPlayClient = (m: { op: number }): m is PlayClientMessage => PLAY_CLIENT_OPS.has(m.op);

const PLAY_SERVER_OPS: ReadonlySet<number> = new Set([PLAY_OP.PROFILE, PLAY_OP.TAG, PLAY_OP.CREW_ASK, PLAY_OP.CREW_SET, PLAY_OP.LOOK_SEEN, PLAY_OP.UNITS_SEEN, PLAY_OP.KILLED]);
/** Whether a decoded server message is one of these (the client hands them to net/play.ts) */
const isPlayServer = (m: { op: number }): m is PlayServerMessage => PLAY_SERVER_OPS.has(m.op);

const isLookText = (s: string) => /^[a-z0-9_-]{0,32}$/i.test(s);
const isToken = (s: string): boolean => TOKEN_RE.test(s);

function writeLook(w: Writer, look: CarLookWire): void {
  w.str(capped(look.body, LOOK_TEXT_MAX));
  w.str(capped(look.model, LOOK_TEXT_MAX));
  w.u8((look.paint >> 16) & 0xff);
  w.u8((look.paint >> 8) & 0xff);
  w.u8(look.paint & 0xff);
  w.u8(look.police ? LOOK_POLICE : 0);
}
function readLook(r: Reader): CarLookWire | null {
  const body = r.str(), model = r.str();
  const paint = (r.u8() << 16) | (r.u8() << 8) | r.u8();
  const police = (r.u8() & LOOK_POLICE) !== 0;
  return isLookText(body) && isLookText(model) ? { body, model, paint, police } : null;
}
function writeUnits(w: Writer, units: readonly WireUnit[]): void {
  const n = Math.min(UNITS_MAX, units.length);
  w.u8(n);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    w.u8(u.kind); w.i32(u.x); w.i32(u.y); w.i32(u.z); w.u16(u.h); w.i16(u.s);
  }
}
function readUnits(r: Reader): WireUnit[] | null {
  const n = r.u8();
  if (n > UNITS_MAX) return null;
  const units: WireUnit[] = [];
  for (let i = 0; i < n; i++) {
    const u = { kind: r.u8(), x: r.i32(), y: r.i32(), z: r.i32(), h: r.u16(), s: r.i16() };
    if (u.kind >= UNIT_KINDS.length || Math.abs(u.x) > WORLD_CM || Math.abs(u.y) > WORLD_CM || Math.abs(u.z) > WORLD_CM) return null;
    units.push(u);
  }
  return units;
}

// ---- client → server -------------------------------------------------------------------------------------------

function encodeLook(look: CarLookWire): Uint8Array<ArrayBuffer> {
  const w = new Writer(80);
  w.u8(PLAY_OP.LOOK);
  writeLook(w, look);
  return w.done();
}

// Invite `player` to the crew, accept or decline its invitation, or leave the crew (player 0)
function encodeCrew(action: CrewAction, player = 0): Uint8Array<ArrayBuffer> {
  const w = new Writer(4);
  w.u8(PLAY_OP.CREW);
  w.u8(CREW_ACTIONS.indexOf(action));
  w.u16(player);
  return w.done();
}

function encodePassive(on: boolean): Uint8Array<ArrayBuffer> {
  const w = new Writer(2);
  w.u8(PLAY_OP.PASSIVE);
  w.u8(on ? 1 : 0);
  return w.done();
}

function encodeWanted(stars: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(2);
  w.u8(PLAY_OP.WANTED);
  w.u8(Math.max(0, Math.min(STARS_MAX, Math.round(stars))));
  return w.done();
}

// The units after the player, in metres / radians / m/s (UNITS_MAX at most go)
function encodeUnits(units: readonly Unit[]): Uint8Array<ArrayBuffer> {
  const w = new Writer(2 + units.length * 17);
  w.u8(PLAY_OP.UNITS);
  writeUnits(w, units.map((u) => ({ kind: UNIT_KINDS.indexOf(u.kind), x: toCm(u.x), y: toCm(u.y), z: toCm(u.z), h: toHeading(u.heading), s: toSpeed(u.speed) })));
  return w.done();
}

// The player's health & armor as its game has them (hit points, 0-100)
function encodeVitals(health: number, armor: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(3);
  w.u8(PLAY_OP.VITALS);
  w.u8(Math.max(0, Math.min(100, Math.ceil(health))));
  w.u8(Math.max(0, Math.min(100, Math.ceil(armor))));
  return w.done();
}

// The player took a pickup of `kind`
function encodeHeal(kind: HealKind): Uint8Array<ArrayBuffer> {
  const w = new Writer(2);
  w.u8(PLAY_OP.HEAL);
  w.u8(HEAL_KINDS.indexOf(kind));
  return w.done();
}

// The player reports `player` for `reason`
function encodeReport(player: number, reason: ReportReason): Uint8Array<ArrayBuffer> {
  const w = new Writer(4);
  w.u8(PLAY_OP.REPORT);
  w.u16(player);
  w.u8(REPORT_REASONS.indexOf(reason));
  return w.done();
}

// Server side: the play messages of decodeClient (protocol.ts), after their op; null when malformed, undefined when
// `op` is none of them
function decodePlayClient(op: number, r: Reader): PlayClientMessage | null | undefined {
  if (op === PLAY_OP.LOOK) {
    const look = readLook(r);
    return look ? { op, look } : null;
  }
  if (op === PLAY_OP.CREW) {
    const action = CREW_ACTIONS.at(r.u8());
    const player = r.u16();
    return action ? { op, action, player } : null;
  }
  if (op === PLAY_OP.PASSIVE) return { op, on: r.u8() !== 0 };
  if (op === PLAY_OP.WANTED) {
    const stars = r.u8();
    return stars <= STARS_MAX ? { op, stars } : null;
  }
  if (op === PLAY_OP.UNITS) {
    const units = readUnits(r);
    return units ? { op, units } : null;
  }
  if (op === PLAY_OP.VITALS) {
    const health = r.u8(), armor = r.u8();
    return health <= 100 && armor <= 100 ? { op, health, armor } : null;
  }
  if (op === PLAY_OP.HEAL) {
    const kind = HEAL_KINDS.at(r.u8());
    return kind ? { op, kind } : null;
  }
  if (op === PLAY_OP.REPORT) {
    const player = r.u16();
    const reason = REPORT_REASONS.at(r.u8());
    return player && reason ? { op, player, reason } : null;
  }
  return undefined;
}

// ---- server → client -------------------------------------------------------------------------------------------

/** What PROFILE carries: the profile's token and its counts */
export interface ProfileWire {
  token: string;
  kills: number;
  deaths: number;
  best: number;
  seconds: number;
}

function encodeProfile(p: ProfileWire): Uint8Array<ArrayBuffer> {
  const w = new Writer(48);
  w.u8(PLAY_OP.PROFILE);
  w.str(p.token);
  w.u32(p.kills);
  w.u32(p.deaths);
  w.u32(p.best);
  w.u32(Math.floor(p.seconds));
  return w.done();
}

function encodeTag(id: number, crew: number, passive: boolean, stars: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(6);
  w.u8(PLAY_OP.TAG);
  w.u16(id);
  w.u16(crew);
  w.u8((passive ? TAG_PASSIVE : 0) | (Math.max(0, Math.min(STARS_MAX, stars)) << TAG_STARS_SHIFT));
  return w.done();
}

function encodeCrewAsk(from: number, name: string): Uint8Array<ArrayBuffer> {
  const w = new Writer(32);
  w.u8(PLAY_OP.CREW_ASK);
  w.u16(from);
  w.str(name);
  return w.done();
}

function encodeCrewSet(crew: number, members: readonly CrewMember[]): Uint8Array<ArrayBuffer> {
  const w = new Writer(8 + members.length * 32);
  w.u8(PLAY_OP.CREW_SET);
  w.u16(crew);
  const n = Math.min(CREW_MAX, members.length);
  w.u8(n);
  for (let i = 0; i < n; i++) {
    w.u16(members[i].id);
    w.str(members[i].name);
  }
  return w.done();
}

function encodeLookSeen(id: number, look: CarLookWire): Uint8Array<ArrayBuffer> {
  const w = new Writer(80);
  w.u8(PLAY_OP.LOOK_SEEN);
  w.u16(id);
  writeLook(w, look);
  return w.done();
}

// Player `from`'s units, as it sent them (wire units)
function encodeUnitsSeen(from: number, units: readonly WireUnit[]): Uint8Array<ArrayBuffer> {
  const w = new Writer(4 + units.length * 17);
  w.u8(PLAY_OP.UNITS_SEEN);
  w.u16(from);
  writeUnits(w, units);
  return w.done();
}

// The server's word: this player is dead, killed by `by` (0: nobody)
function encodeKilled(by: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(3);
  w.u8(PLAY_OP.KILLED);
  w.u16(by);
  return w.done();
}

// Client side: the play messages of decodeServer (protocol.ts), after their op, in metres / radians / m/s; null when
// malformed, undefined when `op` is none of them
function decodePlayServer(op: number, r: Reader): PlayServerMessage | null | undefined {
  if (op === PLAY_OP.PROFILE) return { op, token: r.str(), kills: r.u32(), deaths: r.u32(), best: r.u32(), seconds: r.u32() };
  if (op === PLAY_OP.TAG) {
    const id = r.u16(), crew = r.u16(), flags = r.u8();
    return { op, id, crew, passive: (flags & TAG_PASSIVE) !== 0, stars: Math.min(STARS_MAX, flags >> TAG_STARS_SHIFT) };
  }
  if (op === PLAY_OP.CREW_ASK) return { op, from: r.u16(), name: r.str() };
  if (op === PLAY_OP.KILLED) return { op, by: r.u16() };
  if (op === PLAY_OP.CREW_SET) {
    const crew = r.u16();
    const members: CrewMember[] = [];
    for (let i = r.u8(); i > 0; i--) members.push({ id: r.u16(), name: r.str() });
    return { op, crew, members };
  }
  if (op === PLAY_OP.LOOK_SEEN) {
    const id = r.u16();
    const look = readLook(r);
    return look ? { op, id, look } : null;
  }
  if (op === PLAY_OP.UNITS_SEEN) {
    const from = r.u16();
    const wire = readUnits(r);
    if (!wire) return null;
    // (a newer server's kind this client doesn't know: left out)
    const units: Unit[] = [];
    for (const u of wire) {
      const kind = UNIT_KINDS.at(u.kind);
      if (kind) units.push({ kind, x: u.x / 100, y: u.y / 100, z: u.z / 100, heading: fromHeading(u.h), speed: u.s / 10 });
    }
    return { op, from, units };
  }
  return undefined;
}

export {
  PLAY_OP,
  CREW_MAX,
  UNITS_MAX,
  TOKEN_LENGTH,
  STARS_MAX,
  CREW_ACTIONS,
  UNIT_KINDS,
  HEAL_KINDS,
  REPORT_REASONS,
  isToken,
  isPlayClient,
  isPlayServer,
  encodeLook,
  encodeCrew,
  encodePassive,
  encodeWanted,
  encodeUnits,
  encodeVitals,
  encodeHeal,
  encodeReport,
  decodePlayClient,
  encodeProfile,
  encodeTag,
  encodeCrewAsk,
  encodeCrewSet,
  encodeLookSeen,
  encodeUnitsSeen,
  encodeKilled,
  decodePlayServer
};
