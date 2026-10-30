// server/index.ts
// Multiplayer room server: players connect over WebSocket, say hello with their region, and are placed in a room of
// that region (server/rooms.ts). The server keeps every player's latest pose and, TICK_HZ times a second, sends each
// one a single binary TICK frame (shared/protocol.ts) about the nearest VIEW_MAX players within VIEW_RADIUS
// (server/aoi.ts): who left the view, who entered it, and only the poses that changed since that client last heard
// them, so traffic per client stays flat however many players share the room and parked players cost nothing. It
// relays poses as sent (no physics), only checking their shape. It passes on what players do to each other: chat lines
// to the room, shots to those who see the shooter, and the hits a shooter's client found to the player struck. It
// keeps each room's sky (time of day & weather): a player who changes it changes it for the whole room.
// A player can open a room of its own (CREATE: a title, a code to share, an optional password, the sky and the rules,
// police and PvP, it is played with) that friends join by its code; there only its host changes the sky and rules.
// GET /rooms lists a region's rooms.
// It believes the clients no more than it must (server/checks.ts): moves no faster than their mode goes, hits only on the
// line of a shot it saw and no more than their weapon does; it keeps every player's health (server/vitals.ts), so a
// game that ignores its hurts dies all the same (KILLED), and credits kills to whoever landed the last hit. A player it
// keeps turning down is kicked, and banned if it keeps coming back (server/conduct.ts), and players can report others. The players play together through
// server/play.ts: crews, passive mode, car looks, the police after them. Each keeps a profile (server/profiles.ts:
// kills, deaths, time played; GET /rankings), saved under DATA_DIR.
// With STATIC_DIR it also serves the game's page (server/static.ts), so one address, behind one tunnel (tools/play.ts)
// or one deploy (Dockerfile), is the game and its server.
//
//   node server/index.ts        PORT=8787 ROOM_CAPACITY=200 VIEW_RADIUS=800 VIEW_MAX=64 MAX_PLAYERS=5000
//                                ALLOWED_ORIGINS=https://example.com,http://localhost:8765 (unset = any origin)
//                                STATIC_DIR=.. (unset = no page) DATA_DIR=/data (unset = profiles in memory)
//                                TRUST_PROXY=1 (behind a proxy, Fly.io's: the player's address from its headers)

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { RoomManager } from './rooms.ts';
import type { Room, RoomStats, RoomSummary } from './rooms.ts';
import { hashPassword, checkPassword } from './passwords.ts';
import { PlayerChecks } from './checks.ts';
import { Vitals } from './vitals.ts';
import { Conduct } from './conduct.ts';
import { ProfileStore } from './profiles.ts';
import type { Profile, Ranking } from './profiles.ts';
import { canHurt, handlePlay, crewChanged, introduce } from './play.ts';
import { serveStatic } from './static.ts';
import {
  PROTOCOL_VERSION,
  TICK_HZ,
  OP,
  HIT_REACH,
  sanitizeName,
  sanitizeChat,
  isRegion,
  decodeClient,
  encodeWelcome,
  encodeRoom,
  sanitizeTitle,
  encodeTick,
  TickFrame,
  updateEvery,
  encodeError,
  encodeChatLine,
  encodeShotSeen,
  encodeHurt,
  encodeSkySet,
  encodeNote,
  MODES
} from '../shared/protocol.ts';
import type { WirePose } from '../shared/protocol.ts';
import { encodeProfile, encodeKilled, isPlayClient, PLAY_OP } from '../shared/protocol-play.ts';
import type { CarLookWire } from '../shared/protocol-play.ts';

const HELLO_TIMEOUT_MS = 5000;
const PING_MS = 15000;
const MAX_MSGS_PER_SEC = 40; // a client sends ~10 poses/s; far more is a bug or abuse
const MAX_BUFFERED = 256 * 1024; // skip snapshots to a client whose socket is this far behind
const CHAT_PER_SEC = 1; // chat lines a player may say a second, sustained...
const CHAT_BURST = 5; // ...after a burst of this many
const PASSWORD_FAILS = 10; // passwords a room checks a minute (from everyone) that aren't right before it refuses the rest
const PASSWORD_WINDOW_MS = 60000;
const ROOM_GRACE_MS = 120000; // a player's own room left empty waits this long for them to come back (a dropped connection)
// Ticks between the times a client's view (who is nearest) is worked out again, staggered by its id: the nearest 64
// change slowly, and finding them was most of a crowded tick. In between, the poses still go out every tick
const VIEW_EVERY = 3;

export interface ServerOptions {
  port?: number; // 0 picks a free one
  host?: string;
  capacity?: number; // players per room
  viewRadius?: number; // m
  viewMax?: number; // players in one client's view
  maxPlayers?: number; // connected at once, over all rooms
  allowedOrigins?: readonly string[] | null; // null: any origin
  tickHz?: number;
  staticDir?: string | null; // the game's folder, to serve its page from (null: none)
  dataDir?: string | null; // where the profiles, the bans and the reports are kept (null: in memory, lost when it stops)
  trustProxy?: boolean; // behind a proxy that says who connected (Fly-Client-IP, X-Forwarded-For): believe it
  log?: (message: string) => void;
}

/** One connected client; id 0 means it was refused (server full) */
export interface Player {
  id: number;
  ws: WebSocket;
  name: string | null; // set by its HELLO
  room: Room<Player> | null;
  joining: boolean; // its HELLO or CREATE is being checked (a password hashing): it says no other
  closing: boolean; // turned away (fail): what it sent after is not heard
  state: WirePose | null; // its latest pose, in wire units (cm)
  sent: Map<number, WirePose>; // id → the pose this client last received for that player (its local player list)
  view: number[]; // the ids of the players it was last found to see (nearest first), worked out every VIEW_EVERY ticks
  alive: boolean; // answered the last ping
  budget: number; // messages left in its token bucket
  budgetAt: number; // ms (Date.now()) the bucket was last refilled
  chatBudget: number; // chat lines left in its own bucket
  chatAt: number; // ms (Date.now()) that one was last refilled
  checks: PlayerChecks; // its moves and hits as the server holds them (server/checks.ts)
  profile: Profile | null; // what the server keeps of it between visits (its HELLO's token)
  joinedAt: number; // ms (Date.now()) it came in, for the time it played
  passive: boolean; // in passive mode: it hurts nobody and nobody hurts it
  fightAt: number; // ms it last hurt or was hurt by another player
  stars: number; // its wanted level, 0-5
  look: CarLookWire | null; // its car's look (LOOK)
  units: Uint8Array | null; // the units after it, as UNITS_SEEN goes to its viewers (null: none)
  vitals: Vitals; // its health & armour as the server keeps them (server/vitals.ts)
  address: string; // where it connected from, for the bans
  viewers: Set<Player>; // the players who have it in view (it is in their `sent`): its shots, tags & units go to them
}

/** GET /rooms?region=<region>: the region's rooms to pick from */
export interface RoomList {
  region: string;
  rooms: RoomSummary[];
}

/** GET /rankings: the players with the most kills on this server */
export interface RankingList {
  rankings: Ranking[];
}

/** GET /health: the rooms, plus moving averages of the tick's cost (ms) and of the bytes it sends */
export type Health = RoomStats & { tickMs: number; bytesPerTick: number };

export interface RunningServer {
  port: number;
  rooms: RoomManager<Player>;
  players: Map<number, Player>;
  profiles: ProfileStore;
  conduct: Conduct;
  tick: () => void;
  close: () => Promise<void>;
}

function createServer({
  port = 8787,
  host,
  capacity = 200,
  viewRadius = 800,
  viewMax = 64,
  maxPlayers = 5000,
  allowedOrigins = null,
  tickHz = TICK_HZ,
  staticDir = null,
  dataDir = null,
  trustProxy = false,
  log = console.log
}: ServerOptions = {}): Promise<RunningServer> {
  const profiles = new ProfileStore(dataDir, log);
  const conduct = new Conduct(dataDir, log);
  // Poses stay in wire units (centimetres) server-side, so the grid's 250 m cells are 25 000 cm
  const rooms = new RoomManager<Player>({ capacity, cellSize: 25000, unit: 100 });
  const players = new Map<number, Player>(); // id → player
  const load = { tickMs: 0, bytesPerTick: 0 }; // moving averages, reported by /health
  let lastId = 0;
  // Ids are u16 on the wire: hand out the next one not in use, wrapping after 65535
  const allocateId = () => {
    for (let i = 0; i < 0xffff; i++) {
      lastId = (lastId % 0xffff) + 1;
      if (!players.has(lastId)) return lastId;
    }
    return 0;
  };

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      const health: Health = { ...rooms.stats(), tickMs: +load.tickMs.toFixed(3), bytesPerTick: Math.round(load.bytesPerTick) };
      res.end(JSON.stringify(health));
      return;
    }
    if (req.url?.startsWith('/rooms')) {
      const region = new URL(req.url, 'http://x').searchParams.get('region') ?? '';
      if (!isRegion(region)) {
        res.writeHead(400, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
        res.end('region?\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      const list: RoomList = { region, rooms: rooms.list(region) };
      res.end(JSON.stringify(list));
      return;
    }
    if (req.url === '/rankings') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      const list: RankingList = { rankings: profiles.rankings() };
      res.end(JSON.stringify(list));
      return;
    }
    if (staticDir && serveStatic(staticDir, req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('slop multiplayer server: connect over WebSocket, or GET /health\n');
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 4096,
    verifyClient: ({ origin }: { origin: string }) => !allowedOrigins || allowedOrigins.includes(origin)
  });

  const send = (p: Player, bytes: Uint8Array) => {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(bytes, { binary: true });
  };
  const fail = (p: Player, code: string) => {
    p.closing = true;
    send(p, encodeError(code));
    p.ws.close(1008, code);
  };
  const welcome = (p: Player, room: Room<Player>) => {
    p.room = room;
    p.joinedAt = Date.now();
    send(p, encodeWelcome(p.id, rooms.capacity, tickHz, { id: room.id, title: room.title, code: room.code, locked: room.password !== null, host: room.host, rules: room.rules }));
    send(p, encodeSkySet(0, room.sky)); // (the sky everyone in the room already sees)
    log(`[mp] ${p.name ?? ''} (#${p.id}) joined ${room.id} (${room.players.size}/${rooms.capacity})`);
  };
  const toRoom = (room: Room<Player>, frame: Uint8Array) => {
    for (const other of room.players.values()) send(other, frame);
  };
  // A player whose moves or hits the server keeps turning down: kicked, or banned when it keeps coming back
  const behave = (p: Player, now: number) => {
    if (!conduct.judge(p.checks)) return;
    const until = conduct.kicked(p.profile?.key ?? '', p.address, p.name ?? '', now);
    fail(p, until ? 'banned' : 'cheat');
  };
  // Player `victim` died at `now`, killed by player `killer` (none: by the city): the room hears it, the kill counts on
  // the profiles (once in a while for the same two: conduct.ts), and when the server's own count of its health ran out
  // (`tell`), its game hears it is dead whatever it thinks
  const died = (victim: Player, killer: Player | undefined, now: number, tell: boolean) => {
    const room = victim.room;
    if (!room) return;
    victim.checks.hurtBy = 0;
    const note = killer ? encodeNote('killed', killer.name ?? '', victim.name ?? '') : encodeNote('died', victim.name ?? '');
    toRoom(room, note);
    if (tell) send(victim, encodeKilled(killer?.id ?? 0));
    const kp = killer?.profile, vp = victim.profile;
    if (kp && vp && conduct.countsKill(kp.key, vp.key, now)) {
      profiles.kill(kp, vp);
      send(killer, encodeProfile({ ...kp, token: '' }));
    } else if (vp) {
      profiles.died(vp);
    }
    if (vp) send(victim, encodeProfile({ ...vp, token: '' }));
  };
  // A player's own room by its code: the password checked (with a brake on guessing), then a seat taken
  const enter = async (p: Player, region: string, key: string, password: string) => {
    const room = rooms.find(region, key);
    if (!room) {
      fail(p, 'room');
      return;
    }
    if (room.password) {
      const now = Date.now();
      if (now - room.failsAt > PASSWORD_WINDOW_MS) {
        room.fails = 0;
        room.failsAt = now;
      }
      if (room.fails >= PASSWORD_FAILS) {
        fail(p, 'wait');
        return;
      }
      // counted before it is checked, so a burst of guesses on many sockets at once meets the brake too
      room.fails++;
      const right = await checkPassword(password, room.password);
      if (right) room.fails--;
      if (p.ws.readyState !== p.ws.OPEN) return; // (it hung up while the password was checked)
      if (!right) {
        fail(p, 'password');
        return;
      }
    }
    if (!rooms.rooms.has(room.id)) {
      fail(p, 'room'); // (it closed while the password was checked)
      return;
    }
    if (!rooms.enter(room, p)) {
      fail(p, 'roomfull');
      return;
    }
    welcome(p, room);
  };

  wss.on('connection', (ws, req) => {
    const p: Player = {
      id: players.size >= maxPlayers ? 0 : allocateId(),
      ws,
      name: null,
      room: null,
      joining: false,
      closing: false,
      state: null,
      sent: new Map(), // id → the pose this client last received for that player (its local player list)
      view: [],
      alive: true,
      budget: MAX_MSGS_PER_SEC,
      budgetAt: Date.now(),
      chatBudget: CHAT_BURST,
      chatAt: Date.now(),
      checks: new PlayerChecks(),
      profile: null,
      joinedAt: 0,
      passive: false,
      fightAt: -Infinity,
      stars: 0,
      look: null,
      units: null,
      vitals: new Vitals(),
      address: addressOf(req, trustProxy),
      viewers: new Set()
    };
    if (!p.id) {
      fail(p, 'full');
      return;
    }
    players.set(p.id, p);
    const helloTimer = setTimeout(() => {
      if (!p.room) fail(p, 'hello');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      p.alive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (p.closing) return;
      // token bucket: MAX_MSGS_PER_SEC sustained, refilled continuously
      const now = Date.now();
      p.budget = Math.min(MAX_MSGS_PER_SEC, p.budget + ((now - p.budgetAt) / 1000) * MAX_MSGS_PER_SEC);
      p.budgetAt = now;
      if (--p.budget < 0) {
        fail(p, 'rate');
        return;
      }
      // binaryType is the default 'nodebuffer', so a binary message is one Buffer (never a 'fragments' array)
      const msg = isBinary && !Array.isArray(data) ? decodeClient(data) : null;
      if (!msg) return;

      if ((msg.op === OP.HELLO || msg.op === OP.CREATE) && !p.room && !p.joining) {
        if (msg.version !== PROTOCOL_VERSION) {
          fail(p, 'version');
          return;
        }
        if (!isRegion(msg.region)) {
          fail(p, 'region');
          return;
        }
        clearTimeout(helloTimer);
        p.name = sanitizeName(msg.name, p.id);
        // its profile (a new one, and its token to keep, for a newcomer)
        const opened = profiles.open(msg.token, p.name);
        // (banned: its profile, or where it connects from)
        if (conduct.banned(opened.profile.key, p.address, now)) {
          fail(p, 'banned');
          return;
        }
        p.profile = opened.profile;
        send(p, encodeProfile({ ...opened.profile, token: opened.token }));
        const region = msg.region;
        if (msg.op === OP.HELLO && !msg.room) {
          welcome(p, rooms.join(region, p));
          return;
        }
        p.joining = true;
        const done = () => { p.joining = false; };
        // (a password that can't be hashed or checked turns this player away, never the whole server down)
        const broke = (err: unknown) => {
          log(`[mp] ${p.name ?? ''} (#${p.id}) could not join: ${err instanceof Error ? err.message : String(err)}`);
          fail(p, 'error');
        };
        if (msg.op === OP.HELLO) {
          void enter(p, region, msg.room, msg.password).catch(broke).finally(done);
          return;
        }
        // a room of its own: its title (else its host's name), the password kept hashed
        const { sky, rules, password } = msg;
        const title = sanitizeTitle(msg.title) || p.name;
        void (password ? hashPassword(password) : Promise.resolve(null))
          .then((hash) => {
            if (p.ws.readyState !== p.ws.OPEN) return;
            welcome(p, rooms.create(region, p, { title, password: hash, sky, rules }));
          })
          .catch(broke)
          .finally(done);
      } else if (msg.op === OP.RULES && p.room) {
        // only its host changes a room's rules (a public room has none to change); everyone in it hears them
        if (p.room.host !== p.id) return;
        p.room.rules = { ...msg.rules };
        toRoom(p.room, encodeRoom(p.room.host, p.room.rules));
      } else if (msg.op === OP.STATE && p.room) {
        const st = msg.state; // centimetres: the grid works in the same units
        // Keep the old object for an unchanged pose, so ticks can tell "moved" by identity and skip parked players
        p.vitals.revive(now); // (a dead player is back up after a while)
        if (samePose(p.state, st)) return;
        if (!p.checks.move(p.state, st, now)) {
          behave(p, now);
          return; // (faster than it can go: it stays where it was)
        }
        p.state = st;
        p.room.grid.update(p.id, st.x, st.z);
      } else if (msg.op === OP.CHAT && p.room) {
        // its own, slower bucket: a line a second after a burst of five; past it, lines are dropped (not the socket)
        p.chatBudget = Math.min(CHAT_BURST, p.chatBudget + ((now - p.chatAt) / 1000) * CHAT_PER_SEC);
        p.chatAt = now;
        const text = sanitizeChat(msg.text);
        if (!text || p.chatBudget < 1) return;
        p.chatBudget -= 1;
        const line = encodeChatLine(p.id, p.name ?? '', text);
        for (const other of p.room.players.values()) send(other, line);
      } else if (msg.op === OP.SHOT && p.room) {
        // to those who have the shooter in view (they hear and see it), not back to the shooter; one from nowhere near
        // it, or fired dead, shows nowhere and strikes nobody
        if (!p.vitals.alive || !p.checks.shot(msg.shot, p.state, now)) {
          behave(p, now);
          return;
        }
        const frame = encodeShotSeen(p.id, msg.shot);
        for (const other of p.viewers) send(other, frame);
      } else if (msg.op === OP.HIT && p.room && p.state) {
        const target = p.room.players.get(msg.target);
        // (a room without PvP, crew mates, a player in passive mode: nobody hurt)
        if (!target || target === p || !target.state || !canHurt(p.room, p, target)) return;
        const reach = Math.hypot(target.state.x - p.state.x, target.state.y - p.state.y, target.state.z - p.state.z) / 100;
        if (reach > HIT_REACH || !p.checks.hit(msg.kind, msg.damage, p.state, target.state, now)) {
          behave(p, now);
          return;
        }
        target.checks.struck(p.id, now);
        p.fightAt = target.fightAt = now;
        target.vitals.hurt(msg.damage, MODES.at(target.state.m) ?? 'person');
        send(target, encodeHurt(p.id, msg.damage));
        // (out of health on the server: dead, whatever its game says)
        if (target.vitals.spent && target.vitals.die(now)) died(target, p, now, true);
      } else if (msg.op === OP.SKY && p.room) {
        // the chat's bucket: a sky a second, after a burst, so nobody strobes the room's weather
        p.chatBudget = Math.min(CHAT_BURST, p.chatBudget + ((now - p.chatAt) / 1000) * CHAT_PER_SEC);
        p.chatAt = now;
        const room = p.room;
        if (room.host && room.host !== p.id) return; // (a room of its own: the sky is its host's to set)
        if (p.chatBudget < 1 || (msg.sky.time === room.sky.time && msg.sky.weather === room.sky.weather)) return;
        p.chatBudget -= 1;
        room.sky = msg.sky;
        const frame = encodeSkySet(p.id, room.sky);
        const note = encodeNote('sky', p.name ?? '');
        for (const other of room.players.values()) {
          send(other, frame);
          send(other, note);
        }
      } else if (msg.op === OP.DOWN && p.room) {
        // its game says it died (of the city's harm, or of a hit before the server's count ran out): the killer the
        // one whose hit really struck it last, lately, never the one it names; nothing when the server killed it first
        if (!p.vitals.die(now)) return;
        const by = p.checks.killer(now);
        died(p, by && by !== p.id ? p.room.players.get(by) : undefined, now, false);
      } else if (msg.op === PLAY_OP.REPORT && p.room) {
        const reported = p.room.players.get(msg.player);
        if (!reported || reported === p || !p.profile || !conduct.mayReport(p.profile.key, reported.profile?.key ?? reported.address, now)) return;
        conduct.report({
          at: new Date(now).toISOString(), room: p.room.id, reason: msg.reason,
          reporter: { name: p.name ?? '', profile: p.profile.key },
          reported: {
            name: reported.name ?? '', profile: reported.profile?.key ?? '', address: reported.address,
            refusedMoves: Math.round(reported.checks.refusedMoves), refusedHits: Math.round(reported.checks.refusedHits)
          }
        });
      } else if (p.room && isPlayClient(msg)) {
        handlePlay(p, p.room, msg, now, send);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      players.delete(p.id);
      if (p.profile && p.joinedAt) profiles.played(p.profile, (Date.now() - p.joinedAt) / 1000);
      // (it sees nobody now)
      for (const id of p.sent.keys()) players.get(id)?.viewers.delete(p);
      if (p.room) {
        const room = p.room;
        crewChanged(room, room.crews.leave(p.id).slice(1), send); // (its mates hear it left)
        // someone else hosts the room now: everyone hears who
        if (rooms.leave(room, p.id)) toRoom(room, encodeRoom(room.host, room.rules));
        // everyone who had this player in view drops it now rather than waiting for the next tick
        for (const other of room.players.values()) {
          if (other.sent.delete(p.id)) send(other, encodeTick(room.players.size, [p.id], [], []));
        }
        log(`[mp] ${p.name} (#${p.id}) left ${room.id}`);
      }
    });
  });

  // One TICK frame per client: departures, newcomers (with names) and the poses that changed since it last heard, the
  // farther ones less often (protocol.ts updateEvery). Nothing is allocated a client but its frame's bytes: the view is
  // kept in the player's own array, who is in it marked in `inView` by a number new to each client
  const positions = new Map<number, WirePose>(); // reused per room: id → state
  const radiusCm = viewRadius * 100;
  const frame = new TickFrame();
  const inView = new Float64Array(65536); // id → the mark of the last client whose view it is in
  const entered: number[] = []; // the players who came into the client's view this tick
  let mark = 0;
  let tickNo = 0;
  function tick() {
    const t0 = performance.now();
    let bytes = 0;
    tickNo++;
    for (const room of rooms.rooms.values()) {
      positions.clear();
      for (const [id, pl] of room.players) if (pl.state) positions.set(id, pl.state);
      for (const p of room.players.values()) {
        const me = p.state;
        if (!me || p.ws.bufferedAmount > MAX_BUFFERED) continue;
        if (p.view.length === 0 || (tickNo + p.id) % VIEW_EVERY === 0) {
          room.grid.nearest(p.id, positions, radiusCm, viewMax, p.view);
          // its crew mates however far off: it sees them on the map, and goes to them
          for (const id of room.crews.mates(p.id)) if (id !== p.id && positions.has(id) && !p.view.includes(id)) p.view.push(id);
        }
        mark++;
        entered.length = 0;
        for (const id of p.view) if (positions.has(id)) inView[id] = mark;
        frame.begin(room.players.size);
        for (const id of p.sent.keys()) {
          if (inView[id] === mark) continue;
          frame.gone(id);
          p.sent.delete(id);
          room.players.get(id)?.viewers.delete(p);
        }
        for (const id of p.view) {
          if (inView[id] === mark && !p.sent.has(id)) {
            const other = room.players.get(id);
            frame.info(id, other?.name ?? ''); // (players in a room said hello: they have names)
            other?.viewers.add(p);
            entered.push(id);
          }
        }
        for (const id of p.view) {
          const st = positions.get(id);
          if (!st) continue;
          const last = p.sent.get(id);
          if (last === st) continue;
          // (a newcomer's pose goes at once; the others' as often as they are near)
          if (last && (tickNo + id) % updateEvery((st.x - me.x) ** 2 + (st.z - me.z) ** 2) !== 0) continue;
          frame.moved(id, st);
          p.sent.set(id, st);
        }
        const bytesOut = frame.done();
        bytes += bytesOut.byteLength;
        send(p, bytesOut);
        if (entered.length) introduce(room, p, entered, send); // (their tags, car looks and units, now it knows them)
      }
    }
    load.tickMs += (performance.now() - t0 - load.tickMs) * 0.1;
    load.bytesPerTick += (bytes - load.bytesPerTick) * 0.1;
  }
  const tickTimer = setInterval(tick, 1000 / tickHz);

  // Drop sockets that stopped answering pings (closed laptops, lost mobile signal)
  const pingTimer = setInterval(() => {
    rooms.sweep(Date.now(), ROOM_GRACE_MS); // (the players' own rooms nobody came back to)
    for (const p of players.values()) {
      if (!p.alive) {
        p.ws.terminate();
        continue;
      }
      p.alive = false;
      p.ws.ping();
    }
  }, PING_MS);

  return new Promise<RunningServer>((resolve) => {
    httpServer.listen(port, host, () => {
      const address = httpServer.address(); // an AddressInfo for a TCP port (a string only for a pipe)
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        rooms,
        players,
        profiles,
        conduct,
        tick,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tickTimer);
            clearInterval(pingTimer);
            for (const p of players.values()) p.ws.terminate();
            wss.close(() => httpServer.close(() => { void profiles.flush().then(done); }));
          })
      });
    });
  });
}

// Where a client connected from: its socket's address, or (behind a proxy that says so, `trust`) the address the proxy
// saw (Fly.io's Fly-Client-IP, else the first of X-Forwarded-For)
function addressOf(req: http.IncomingMessage, trust: boolean): string {
  if (trust) {
    const fly = req.headers['fly-client-ip'];
    const forwarded = req.headers['x-forwarded-for'];
    const said = (typeof fly === 'string' ? fly : '') || (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '');
    if (said) return said;
  }
  return req.socket.remoteAddress ?? '';
}

function samePose(a: WirePose | null, b: WirePose): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.z === b.z && a.h === b.h && a.m === b.m && a.s === b.s;
}

const intEnv = (name: string, fallback: number) => {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const origins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : null;
  void createServer({
    port: intEnv('PORT', 8787),
    host: process.env.HOST || undefined,
    capacity: intEnv('ROOM_CAPACITY', 200),
    viewRadius: intEnv('VIEW_RADIUS', 800),
    viewMax: intEnv('VIEW_MAX', 64),
    maxPlayers: intEnv('MAX_PLAYERS', 5000),
    allowedOrigins: origins,
    staticDir: process.env.STATIC_DIR || null,
    dataDir: process.env.DATA_DIR || null,
    trustProxy: process.env.TRUST_PROXY === '1'
  }).then((server) => {
    console.log(`[mp] listening on :${server.port} (rooms of ${intEnv('ROOM_CAPACITY', 200)})`);
    // (a deploy stopping it: the profiles written before it goes)
    const stop = () => { void server.close().then(() => process.exit(0)); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}

export { createServer };
