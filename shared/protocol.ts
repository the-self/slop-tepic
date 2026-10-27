// shared/protocol.ts
// Multiplayer wire protocol, shared verbatim by the browser client (js/net/multiplayer.ts) and the room server
// (server/index.ts). Binary WebSocket frames in the spirit of RuneScape's: a 1-byte opcode, fixed-width little-endian
// integers (positions in centimetres, heading in 1/65536 turns), one TICK frame per client per server tick, and in it
// only the players whose pose changed since that client last heard about them; the client keeps the rest where they
// were (its "local player list", grown by INFO entries and shrunk by GONE ones).
//
// client → server
//   HELLO  u8 op, u8 version, str region, str name, str room, str password   once, right after connecting: room '' is
//                                                                          the region's public rooms, else a room's id
//                                                                          or its code (a private room's password)
//   CREATE u8 op, u8 version, str region, str name, str title, str password, u8 time, u8 weather, u8 rules
//                                                                          instead of HELLO: opens a room of its own
//   STATE  u8 op, i32 x, i32 y, i32 z (cm), u16 heading, u8 mode, i16 speed (dm/s)   SEND_HZ times a second
//   CHAT   u8 op, str text                                                 a line said to the room
//   SHOT   u8 op, i32 × 3 from, i32 × 3 to (cm), str weapon, u8 flags      a shot the player fired (flags: 1 rocket)
//   HIT    u8 op, u16 target, u8 damage                                    the player's shot, blow or blast struck a player
//   DOWN   u8 op, u16 killer (0: nobody)                                   the player was killed
//   SKY    u8 op, u8 time, u8 weather                                      the player set the room's sky (SKY_TIMES, SKY_WEATHERS)
//   RULES  u8 op, u8 rules                                                 the host of a room of its own changes them
// server → client
//   WELCOME u8 op, u16 id, u16 capacity, u8 tickHz, str room, str title, str code, u8 flags (1 locked), u16 host, u8 rules
//   TICK    u8 op, u16 players in room,
//           u16 nGone,  nGone × u16 id                                    left the view or the room
//           u16 nInfo,  nInfo × (u16 id, str name)                        came into view
//           u16 nMoved, nMoved × (u16 id, i32 x, i32 y, i32 z, u16 heading, u8 mode, i16 speed)
//   ERROR   u8 op, str code                                                then the server closes the socket
//   CHAT    u8 op, u16 from (0: the server), str name, str text            to everyone in the room
//   SHOT    u8 op, u16 from, i32 × 3 from, i32 × 3 to (cm), str weapon, u8 flags   to those who have the shooter in view
//   HURT    u8 op, u16 from, u8 damage                                     to the player struck
//   SKY_SET u8 op, u16 from (0: the room's, on joining), u8 time, u8 weather   to everyone in the room
//   ROOM    u8 op, u16 host, u8 rules                                      the room's host or rules changed
// rules = u8 flags: 1 the police come after crimes, 2 the players can hurt each other (PvP)
// str = u8 byte length + UTF-8 bytes
//
// Shots are the shooter's to judge (its client traces them against the others' poses and says whom they hit), as
// befits a game among friends: the server only checks that the target is in the same room and within reach.
// The sky (the time of day and the weather) is the room's: whoever changes it changes it for everyone in the room,
// and a newcomer gets the room's on joining. A player can also open a room of its own (CREATE): a title, a code
// friends type to join it, an optional password, its sky and its rules; there only its host changes the sky and rules.

const PROTOCOL_VERSION = 5;
const SEND_HZ = 10; // client pose updates per second
const TICK_HZ = 10; // server ticks per second (OSRS runs 600 ms ticks; driving needs 100 ms)
// How often a client hears another player's pose by how far off it is: every tick within NEAR_UPDATE, every other one
// within MID_UPDATE, every third beyond (staggered by the player's id), so a crowd's traffic is mostly the few nearby.
// The client extrapolates between the sparser ones (net/multiplayer.ts)
const NEAR_UPDATE = 150; // m
const MID_UPDATE = 400; // m
const MAX_UPDATE_EVERY = 3; // ticks between a far player's poses
// (new modes go at the end: older clients' indices hold). A passenger travels at its driver's pose, inside its car
const MODES = ['person', 'car', 'cyclist', 'helicopter', 'moto', 'passenger'] as const;
// The room's sky: the time of day (render/lighting.ts's presets, 'live' the real clock) and the weather ('live' the
// real conditions from Open-Meteo, the rest world/weather.ts's WEATHER_SAMPLES). New ones go at the end, as with MODES
const SKY_TIMES = ['live', 'golden', 'midday', 'twilight', 'midnight'] as const;
const SKY_WEATHERS = ['live', 'clear', 'cloudy', 'overcast', 'rain', 'storm', 'fog'] as const;
const NAME_MAX = 24; // characters
const CHAT_MAX = 140; // characters in a chat line
const WEAPON_MAX = 16; // characters in a weapon's id
const SHOT_REACH = 600; // m: the farthest a shot's two ends may lie apart (the bazooka's rocket flies 300 m)
const HIT_REACH = 400; // m between a shooter and the player it says it hit (the server's check)
const DAMAGE_MAX = 100; // hit points one HIT may take
const REGION_RE = /^[a-z0-9-]{1,32}$/;
const WORLD_LIMIT = 2e7; // |x|, |y|, |z| in metres, inside the i32-centimetre range (±21 474 km)
const MAX_FRAME = 4096; // bytes a client may send in one message
const TITLE_MAX = 32; // characters in a room's title
const PASSWORD_MAX = 64; // characters in a room's password
const RULE_POLICE = 1; // rules flags: the police come after crimes...
const RULE_PVP = 2; // ...and the players can hurt each other
const ROOM_LOCKED = 1; // WELCOME flags: the room has a password

const OP = {
  // client → server
  HELLO: 1,
  STATE: 2,
  CHAT: 3,
  SHOT: 4,
  HIT: 5,
  DOWN: 6,
  SKY: 7,
  CREATE: 8,
  RULES: 9,
  // server → client
  WELCOME: 101,
  TICK: 102,
  ERROR: 103,
  CHAT_LINE: 104,
  SHOT_SEEN: 105,
  HURT: 106,
  SKY_SET: 107,
  ROOM: 108
} as const;

/** How a room is played: whether the police come after crimes, whether the players can hurt each other */
export interface RoomRules {
  police: boolean;
  pvp: boolean;
}
/** A public room's, and a new room's unless its host says otherwise: police and PvP on */
const DEFAULT_RULES: Readonly<RoomRules> = Object.freeze({ police: true, pvp: true });

/** A player mode as it travels on the wire (its index in MODES) */
export type Mode = (typeof MODES)[number];
export type Op = (typeof OP)[keyof typeof OP];
export type SkyTime = (typeof SKY_TIMES)[number];
export type SkyWeather = (typeof SKY_WEATHERS)[number];
/** The room's sky in wire units: indices in SKY_TIMES and SKY_WEATHERS */
export interface WireSky {
  time: number;
  weather: number;
}

/** A pose in wire units: x/y/z in centimetres, h in 1/65536 turns, m the MODES index, s the speed in dm/s */
export interface WirePose {
  x: number;
  y: number;
  z: number;
  h: number;
  m: number;
  s: number;
}

/** What encodeState reads from a player entity: position in metres, heading in radians, speed in m/s */
export interface PoseSource {
  position: { readonly x: number; readonly y: number; readonly z: number };
  heading: number;
  speed?: number;
}

// client → server, decoded by the server
export interface HelloMessage {
  op: typeof OP.HELLO;
  version: number;
  region: string;
  name: string;
  room: string; // '' for the region's public rooms, else a room's id or code
  password: string;
}
export interface CreateMessage {
  op: typeof OP.CREATE;
  version: number;
  region: string;
  name: string;
  title: string; // raw: the server sanitizes it
  password: string; // '' for none
  sky: WireSky;
  rules: RoomRules;
}
export interface RulesMessage {
  op: typeof OP.RULES;
  rules: RoomRules;
}
export interface StateMessage {
  op: typeof OP.STATE;
  state: WirePose;
}
export interface ChatMessage {
  op: typeof OP.CHAT;
  text: string; // raw: the server sanitizes it
}
/** A shot's two ends in wire units (cm), its weapon's id and flags (SHOT_ROCKET) */
export interface WireShot {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  weapon: string;
  flags: number;
}
export interface ShotMessage {
  op: typeof OP.SHOT;
  shot: WireShot;
}
export interface HitMessage {
  op: typeof OP.HIT;
  target: number;
  damage: number; // hit points
}
export interface DownMessage {
  op: typeof OP.DOWN;
  killer: number; // 0: nobody
}
export interface SkyMessage {
  op: typeof OP.SKY;
  sky: WireSky;
}
export type ClientMessage = HelloMessage | CreateMessage | StateMessage | ChatMessage | ShotMessage | HitMessage | DownMessage | SkyMessage | RulesMessage;

// server → client, decoded by the client in metres / radians / m/s
export interface WelcomeMessage {
  op: typeof OP.WELCOME;
  id: number;
  capacity: number;
  tickHz: number;
  room: string;
  title: string; // '' for a public room
  code: string; // what friends type to join it ('' for a public room)
  locked: boolean; // it has a password
  host: number; // the player who sets its sky and rules (0: nobody, a public room: anyone sets its sky)
  rules: RoomRules;
}
/** The room's host or rules changed */
export interface RoomMessage {
  op: typeof OP.ROOM;
  host: number;
  rules: RoomRules;
}
export interface ErrorMessage {
  op: typeof OP.ERROR;
  code: string;
}
/** A player that came into view */
export interface PlayerInfo {
  id: number;
  name: string;
}
/** A player whose pose changed: x/y/z in metres, heading in radians, speed in m/s */
export interface MovedPlayer {
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  mode: Mode;
  speed: number;
}
export interface TickMessage {
  op: typeof OP.TICK;
  roomPlayers: number;
  gone: number[];
  info: PlayerInfo[];
  moved: MovedPlayer[];
}
/** A line said in the room (from 0: the server's, like who killed whom) */
export interface ChatLineMessage {
  op: typeof OP.CHAT_LINE;
  from: number;
  name: string;
  text: string;
}
/** Someone else's shot, in metres */
export interface Shot {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  weapon: string;
  rocket: boolean;
}
export interface ShotSeenMessage {
  op: typeof OP.SHOT_SEEN;
  from: number;
  shot: Shot;
}
export interface HurtMessage {
  op: typeof OP.HURT;
  from: number;
  damage: number; // hit points
}
/** The room's sky, set by player `from` (0: as the room had it when this client joined) */
export interface SkySetMessage {
  op: typeof OP.SKY_SET;
  from: number;
  time: SkyTime;
  weather: SkyWeather;
}
export type ServerMessage = WelcomeMessage | ErrorMessage | TickMessage | ChatLineMessage | ShotSeenMessage | HurtMessage | SkySetMessage | RoomMessage;

/** What decodeClient / decodeServer read: a whole frame, as a byte view or its buffer */
export type FrameData = Uint8Array | ArrayBuffer;

const STATE_BYTES = 1 + 12 + 2 + 1 + 2;
const ROW_BYTES = 2 + 12 + 2 + 1 + 2; // one moved player in a TICK
const TURN = 2 * Math.PI;

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

// Visible, single-line text of at most `max` characters
function cleanText(text: string | null | undefined, max: number): string {
  // Array.from splits by code points, so the cap never cuts a character outside the BMP in half
  return Array.from((text ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ') // line breaks & tabs become spaces before the remaining control characters go
    .replace(/[\p{Cc}\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu, '') // \p{Cc}: U+0000–001F & U+007F–009F
    .trim())
    .slice(0, max)
    .join('')
    .trim();
}

// Visible, single-line, length-capped player names; empty or unusable names get a numbered default
function sanitizeName(name: string | null | undefined, fallbackSeed = 0): string {
  return cleanText(name, NAME_MAX) || `Player-${String(Math.abs(Math.floor(fallbackSeed)) % 10000).padStart(4, '0')}`;
}

// A chat line as the room will read it ('' when nothing visible is left)
function sanitizeChat(text: string | null | undefined): string {
  return cleanText(text, CHAT_MAX);
}

// A room's title as everyone reads it ('' when nothing visible is left)
function sanitizeTitle(text: string | null | undefined): string {
  return cleanText(text, TITLE_MAX);
}

const rulesFlags = (r: RoomRules) => (r.police ? RULE_POLICE : 0) | (r.pvp ? RULE_PVP : 0);
const rulesOf = (flags: number): RoomRules => ({ police: (flags & RULE_POLICE) !== 0, pvp: (flags & RULE_PVP) !== 0 });

function isRegion(region: unknown): region is string {
  return typeof region === 'string' && REGION_RE.test(region);
}

const toCm = (m: number) => Math.round(m * 100);
const toHeading = (rad: number) => Math.round((((rad % TURN) + TURN) % TURN) / TURN * 65536) & 0xffff;
const toSpeed = (ms: number) => Math.max(-32768, Math.min(32767, Math.round(ms * 10)));

// Growable little-endian byte writer
class Writer {
  bytes: Uint8Array<ArrayBuffer>;
  view: DataView;
  at: number;

  constructor(size = 256) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  room(n: number): void {
    if (this.at + n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.at + n));
    bigger.set(this.bytes);
    this.bytes = bigger;
    this.view = new DataView(bigger.buffer);
  }
  u8(v: number): void { this.room(1); this.view.setUint8(this.at, v); this.at += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.at, v, true); this.at += 2; }
  i16(v: number): void { this.room(2); this.view.setInt16(this.at, v, true); this.at += 2; }
  i32(v: number): void { this.room(4); this.view.setInt32(this.at, v, true); this.at += 4; }
  str(s: string): void {
    let b = utf8.encode(s);
    if (b.length > 255) b = b.subarray(0, 255);
    this.u8(b.length);
    this.room(b.length);
    this.bytes.set(b, this.at);
    this.at += b.length;
  }
  pose(st: WirePose): void {
    this.i32(st.x); this.i32(st.y); this.i32(st.z); this.u16(st.h); this.u8(st.m); this.i16(st.s);
  }
  shot(s: WireShot): void {
    this.i32(s.ox); this.i32(s.oy); this.i32(s.oz); this.i32(s.ex); this.i32(s.ey); this.i32(s.ez);
    this.str(Array.from(s.weapon).slice(0, WEAPON_MAX).join(''));
    this.u8(s.flags);
  }
  done(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.at);
  }
}

// Bounds-checked reader; any overrun throws RangeError, which decoders turn into "malformed"
class Reader {
  bytes: Uint8Array;
  view: DataView;
  at: number;

  constructor(data: FrameData) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }
  u8(): number { const v = this.view.getUint8(this.at); this.at += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  i32(): number { const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  str(): string {
    const n = this.u8();
    if (this.at + n > this.bytes.length) throw new RangeError('string overruns frame');
    const s = utf8Decode.decode(this.bytes.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
  pose(): WirePose {
    return { x: this.i32(), y: this.i32(), z: this.i32(), h: this.u16(), m: this.u8(), s: this.i16() };
  }
  shot(): WireShot {
    return { ox: this.i32(), oy: this.i32(), oz: this.i32(), ex: this.i32(), ey: this.i32(), ez: this.i32(), weapon: this.str(), flags: this.u8() };
  }
}

const SHOT_ROCKET = 1; // WireShot.flags: the bazooka's rocket (it flies, then blows up), not a bullet

// A shot whose ends lie in the world and within SHOT_REACH of each other, and whose weapon's id is a plain word
function validShot(s: WireShot): boolean {
  const lim = WORLD_LIMIT * 100;
  const ends = [s.ox, s.oy, s.oz, s.ex, s.ey, s.ez];
  if (ends.some((v) => Math.abs(v) > lim)) return false;
  const reach = Math.hypot(s.ex - s.ox, s.ey - s.oy, s.ez - s.oz) / 100;
  return reach <= SHOT_REACH && /^[a-z0-9_-]{1,16}$/.test(s.weapon);
}

// ---- client → server -------------------------------------------------------------------------------------------

const capped = (text: string, max: number) => Array.from(text).slice(0, max).join('');

// `room`: '' for the region's public rooms, else a room's id or code; `password`, a private room's
function encodeHello(region: string, name?: string | null, room = '', password = ''): Uint8Array<ArrayBuffer> {
  const w = new Writer(96);
  w.u8(OP.HELLO);
  w.u8(PROTOCOL_VERSION);
  w.str(region);
  w.str(capped(name ?? '', NAME_MAX)); // the server sanitizes it & numbers empty ones
  w.str(capped(room, TITLE_MAX));
  w.str(capped(password, PASSWORD_MAX));
  return w.done();
}

/** A room to open: its title, its password ('' for none), the sky it starts with and its rules */
export interface RoomSpec {
  title: string;
  password: string;
  time: SkyTime;
  weather: SkyWeather;
  rules: RoomRules;
}

// Opens a room (`spec`) and puts the player in it, as its host
function encodeCreate(region: string, name: string, spec: RoomSpec): Uint8Array<ArrayBuffer> {
  const w = new Writer(128);
  w.u8(OP.CREATE);
  w.u8(PROTOCOL_VERSION);
  w.str(region);
  w.str(capped(name, NAME_MAX));
  w.str(capped(spec.title, TITLE_MAX));
  w.str(capped(spec.password, PASSWORD_MAX));
  w.u8(Math.max(0, SKY_TIMES.indexOf(spec.time)));
  w.u8(Math.max(0, SKY_WEATHERS.indexOf(spec.weather)));
  w.u8(rulesFlags(spec.rules));
  return w.done();
}

// The host's new rules for its room
function encodeRules(rules: RoomRules): Uint8Array<ArrayBuffer> {
  const w = new Writer(2);
  w.u8(OP.RULES);
  w.u8(rulesFlags(rules));
  return w.done();
}

// MODES widened to plain strings, so any mode name can be looked up (an unknown one goes as MODES[0])
const MODE_NAMES: readonly string[] = MODES;
const SKY_TIME_NAMES: readonly string[] = SKY_TIMES;
const SKY_WEATHER_NAMES: readonly string[] = SKY_WEATHERS;

// A player entity ({ position, heading, speed }) in a MODES mode → STATE frame (18 bytes)
function encodeState(entity: PoseSource, mode: string): Uint8Array<ArrayBuffer> {
  const p = entity.position;
  const w = new Writer(STATE_BYTES);
  w.u8(OP.STATE);
  w.pose({ x: toCm(p.x), y: toCm(p.y), z: toCm(p.z), h: toHeading(entity.heading), m: Math.max(0, MODE_NAMES.indexOf(mode)), s: toSpeed(entity.speed || 0) });
  return w.done();
}

// A chat line (the server cleans it and drops it if nothing visible is left)
function encodeChat(text: string): Uint8Array<ArrayBuffer> {
  const w = new Writer(8 + CHAT_MAX * 4);
  w.u8(OP.CHAT);
  w.str(Array.from(text).slice(0, CHAT_MAX).join(''));
  return w.done();
}

/** A shot as the client fires it: its two ends in metres, its weapon's id (sim/weapons.ts), a rocket or a bullet */
export type ShotSource = Shot;

// A shot the player fired → SHOT frame
function encodeShot(s: ShotSource): Uint8Array<ArrayBuffer> {
  const w = new Writer(48);
  w.u8(OP.SHOT);
  w.shot({ ox: toCm(s.ox), oy: toCm(s.oy), oz: toCm(s.oz), ex: toCm(s.ex), ey: toCm(s.ey), ez: toCm(s.ez), weapon: s.weapon, flags: s.rocket ? SHOT_ROCKET : 0 });
  return w.done();
}

// The player's shot, blow or blast took `damage` hit points off player `target`
function encodeHit(target: number, damage: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(4);
  w.u8(OP.HIT);
  w.u16(target);
  w.u8(Math.max(0, Math.min(DAMAGE_MAX, Math.round(damage))));
  return w.done();
}

// The player was killed, by player `killer` (0: by nobody, or by the city)
function encodeDown(killer: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(3);
  w.u8(OP.DOWN);
  w.u16(killer);
  return w.done();
}

// The player set the room's sky (an unknown name goes as 'live')
function encodeSky(time: string, weather: string): Uint8Array<ArrayBuffer> {
  const w = new Writer(3);
  w.u8(OP.SKY);
  w.u8(Math.max(0, SKY_TIME_NAMES.indexOf(time)));
  w.u8(Math.max(0, SKY_WEATHER_NAMES.indexOf(weather)));
  return w.done();
}

// Server side: one client frame → { op, ... } or null when malformed / out of range
function decodeClient(data: FrameData | null | undefined): ClientMessage | null {
  try {
    if (!data || data.byteLength < 1 || data.byteLength > MAX_FRAME) return null;
    const r = new Reader(data);
    const op = r.u8();
    if (op === OP.HELLO) return { op, version: r.u8(), region: r.str(), name: r.str(), room: r.str(), password: r.str() };
    if (op === OP.CREATE) {
      const version = r.u8(), region = r.str(), name = r.str(), title = r.str(), password = r.str();
      const sky = { time: r.u8(), weather: r.u8() };
      if (sky.time >= SKY_TIMES.length || sky.weather >= SKY_WEATHERS.length) return null;
      return { op, version, region, name, title, password, sky, rules: rulesOf(r.u8()) };
    }
    if (op === OP.RULES) return { op, rules: rulesOf(r.u8()) };
    if (op === OP.STATE) {
      const st = r.pose();
      const lim = WORLD_LIMIT * 100;
      if (Math.abs(st.x) > lim || Math.abs(st.y) > lim || Math.abs(st.z) > lim || st.m >= MODES.length) return null;
      return { op, state: st };
    }
    if (op === OP.CHAT) return { op, text: r.str() };
    if (op === OP.SHOT) {
      const shot = r.shot();
      return validShot(shot) ? { op, shot } : null;
    }
    if (op === OP.HIT) {
      const target = r.u16();
      const damage = r.u8();
      return target && damage <= DAMAGE_MAX ? { op, target, damage } : null;
    }
    if (op === OP.DOWN) return { op, killer: r.u16() };
    if (op === OP.SKY) {
      const sky = { time: r.u8(), weather: r.u8() };
      return sky.time < SKY_TIMES.length && sky.weather < SKY_WEATHERS.length ? { op, sky } : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- server → client -------------------------------------------------------------------------------------------

/** What WELCOME says of the room the player is in */
export interface RoomInfo {
  id: string;
  title: string;
  code: string;
  locked: boolean;
  host: number;
  rules: RoomRules;
}

function encodeWelcome(id: number, capacity: number, tickHz: number, room: RoomInfo): Uint8Array<ArrayBuffer> {
  const w = new Writer(128);
  w.u8(OP.WELCOME);
  w.u16(id);
  w.u16(capacity);
  w.u8(tickHz);
  w.str(room.id);
  w.str(room.title);
  w.str(room.code);
  w.u8(room.locked ? ROOM_LOCKED : 0);
  w.u16(room.host);
  w.u8(rulesFlags(room.rules));
  return w.done();
}

// The room's host (0: nobody) and rules, to everyone in it when either changes
function encodeRoom(host: number, rules: RoomRules): Uint8Array<ArrayBuffer> {
  const w = new Writer(4);
  w.u8(OP.ROOM);
  w.u16(host);
  w.u8(rulesFlags(rules));
  return w.done();
}

/** Ticks between the poses a client is sent of a player `d2` cm² off (its squared distance in wire units) */
function updateEvery(d2: number): number {
  return d2 < (NEAR_UPDATE * 100) ** 2 ? 1 : d2 < (MID_UPDATE * 100) ** 2 ? 2 : MAX_UPDATE_EVERY;
}

/**
 * A TICK frame written as it is found, in one buffer reused frame after frame (the server writes one a client a tick:
 * no arrays of entries in between). Call begin(), then gone() for each, info() for each, moved() for each, in that
 * order, then done() for the frame's own copy of the bytes.
 */
class TickFrame {
  private readonly w = new Writer(1024);
  private countAt = 0; // where the open section's count goes
  private count = 0;
  private section = 0; // 0 gone, 1 info, 2 moved

  begin(roomPlayers: number): void {
    this.w.at = 0;
    this.w.u8(OP.TICK);
    this.w.u16(Math.min(roomPlayers, 0xffff));
    this.section = 0;
    this.open();
  }
  gone(id: number): void {
    this.w.u16(id);
    this.count++;
  }
  info(id: number, name: string): void {
    this.upTo(1);
    this.w.u16(id);
    this.w.str(name);
    this.count++;
  }
  moved(id: number, st: WirePose): void {
    this.upTo(2);
    this.w.u16(id);
    this.w.pose(st);
    this.count++;
  }
  done(): Uint8Array<ArrayBuffer> {
    this.upTo(2);
    this.close();
    return this.w.done();
  }
  private open(): void {
    this.countAt = this.w.at;
    this.w.u16(0);
    this.count = 0;
  }
  private close(): void {
    this.w.view.setUint16(this.countAt, this.count, true);
  }
  // (the sections before `section` closed, empty if nothing was written in them)
  private upTo(section: number): void {
    while (this.section < section) {
      this.close();
      this.open();
      this.section++;
    }
  }
}

// gone: [id], info: [[id, name]], moved: [[id, state]] with states in wire units (cm, 1/65536 turn, dm/s)
function encodeTick(
  roomPlayers: number,
  gone: readonly number[],
  info: readonly (readonly [id: number, name: string])[],
  moved: readonly (readonly [id: number, state: WirePose])[]
): Uint8Array<ArrayBuffer> {
  const f = new TickFrame();
  f.begin(roomPlayers);
  for (const id of gone) f.gone(id);
  for (const [id, name] of info) f.info(id, name);
  for (const [id, st] of moved) f.moved(id, st);
  return f.done();
}

function encodeError(code: string): Uint8Array<ArrayBuffer> {
  const w = new Writer(24);
  w.u8(OP.ERROR);
  w.str(code);
  return w.done();
}

// A line said in the room by player `from` (0: the server) called `name`
function encodeChatLine(from: number, name: string, text: string): Uint8Array<ArrayBuffer> {
  const w = new Writer(12 + (NAME_MAX + CHAT_MAX) * 4);
  w.u8(OP.CHAT_LINE);
  w.u16(from);
  w.str(name);
  w.str(text);
  return w.done();
}

// Player `from`'s shot (wire units), to those who see it
function encodeShotSeen(from: number, shot: WireShot): Uint8Array<ArrayBuffer> {
  const w = new Writer(48);
  w.u8(OP.SHOT_SEEN);
  w.u16(from);
  w.shot(shot);
  return w.done();
}

// Player `from` took `damage` hit points off this client's player
function encodeHurt(from: number, damage: number): Uint8Array<ArrayBuffer> {
  const w = new Writer(4);
  w.u8(OP.HURT);
  w.u16(from);
  w.u8(Math.max(0, Math.min(DAMAGE_MAX, Math.round(damage))));
  return w.done();
}

// The room's sky (wire indices), set by player `from` (0: sent to a newcomer as the room has it)
function encodeSkySet(from: number, sky: WireSky): Uint8Array<ArrayBuffer> {
  const w = new Writer(5);
  w.u8(OP.SKY_SET);
  w.u16(from);
  w.u8(sky.time);
  w.u8(sky.weather);
  return w.done();
}

// Client side: one server frame → { op, ... } in metres / radians / m/s, or null when malformed
function decodeServer(data: FrameData): ServerMessage | null {
  try {
    const r = new Reader(data);
    const op = r.u8();
    if (op === OP.WELCOME) {
      const id = r.u16(), capacity = r.u16(), tickHz = r.u8(), room = r.str(), title = r.str(), code = r.str();
      const locked = (r.u8() & ROOM_LOCKED) !== 0;
      return { op, id, capacity, tickHz, room, title, code, locked, host: r.u16(), rules: rulesOf(r.u8()) };
    }
    if (op === OP.ROOM) return { op, host: r.u16(), rules: rulesOf(r.u8()) };
    if (op === OP.ERROR) return { op, code: r.str() };
    if (op === OP.CHAT_LINE) return { op, from: r.u16(), name: r.str(), text: r.str() };
    if (op === OP.SHOT_SEEN) {
      const from = r.u16();
      const s = r.shot();
      return { op, from, shot: { ox: s.ox / 100, oy: s.oy / 100, oz: s.oz / 100, ex: s.ex / 100, ey: s.ey / 100, ez: s.ez / 100, weapon: s.weapon, rocket: (s.flags & SHOT_ROCKET) !== 0 } };
    }
    if (op === OP.HURT) return { op, from: r.u16(), damage: r.u8() };
    // (a newer server's sky this client doesn't know → 'live')
    if (op === OP.SKY_SET) return { op, from: r.u16(), time: SKY_TIMES.at(r.u8()) ?? 'live', weather: SKY_WEATHERS.at(r.u8()) ?? 'live' };
    if (op !== OP.TICK) return null;
    const roomPlayers = r.u16();
    const gone: number[] = [];
    for (let i = r.u16(); i > 0; i--) gone.push(r.u16());
    const info: PlayerInfo[] = [];
    for (let i = r.u16(); i > 0; i--) info.push({ id: r.u16(), name: r.str() });
    const moved: MovedPlayer[] = [];
    for (let i = r.u16(); i > 0; i--) {
      const id = r.u16();
      const st = r.pose();
      // a newer server's mode this client doesn't know → MODES[0] (st.m is a u8, so .at() never counts from the end)
      moved.push({ id, x: st.x / 100, y: st.y / 100, z: st.z / 100, heading: (st.h / 65536) * TURN, mode: MODES.at(st.m) ?? MODES[0], speed: st.s / 10 });
    }
    return { op, roomPlayers, gone, info, moved };
  } catch {
    return null;
  }
}

export {
  PROTOCOL_VERSION,
  SEND_HZ,
  TICK_HZ,
  NEAR_UPDATE,
  MID_UPDATE,
  MAX_UPDATE_EVERY,
  MODES,
  SKY_TIMES,
  SKY_WEATHERS,
  NAME_MAX,
  CHAT_MAX,
  HIT_REACH,
  DAMAGE_MAX,
  TITLE_MAX,
  PASSWORD_MAX,
  DEFAULT_RULES,
  OP,
  STATE_BYTES,
  ROW_BYTES,
  sanitizeName,
  sanitizeChat,
  sanitizeTitle,
  isRegion,
  encodeHello,
  encodeCreate,
  encodeRules,
  encodeState,
  encodeChat,
  encodeShot,
  encodeHit,
  encodeDown,
  encodeSky,
  decodeClient,
  encodeWelcome,
  encodeTick,
  updateEvery,
  TickFrame,
  encodeError,
  encodeChatLine,
  encodeShotSeen,
  encodeHurt,
  encodeSkySet,
  encodeRoom,
  decodeServer
};
