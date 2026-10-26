// server/index.ts
// Multiplayer room server: players connect over WebSocket, say hello with their region, and are placed in a room of
// that region (server/rooms.ts). The server keeps every player's latest pose and, TICK_HZ times a second, sends each
// one a single binary TICK frame (shared/protocol.ts) about the nearest VIEW_MAX players within VIEW_RADIUS
// (server/aoi.ts): who left the view, who entered it, and only the poses that changed since that client last heard
// them, so traffic per client stays flat however many players share the room and parked players cost nothing. It
// relays poses as sent (no physics), only checking their shape. It passes on what players do to each other: chat lines
// to the room, shots to those who see the shooter, and the hits a shooter's client found to the player struck.
// With STATIC_DIR it also serves the game's page (index.html, css/, dist/, assets/ under it), so one address, behind
// one tunnel (tools/play.ts), is the game and its server.
//
//   node server/index.ts        PORT=8787 ROOM_CAPACITY=200 VIEW_RADIUS=800 VIEW_MAX=64 MAX_PLAYERS=5000
//                                ALLOWED_ORIGINS=https://example.com,http://localhost:8765 (unset = any origin)
//                                STATIC_DIR=.. (unset = no page)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { RoomManager } from './rooms.ts';
import type { Room, RoomStats } from './rooms.ts';
import { nearestInView } from './aoi.ts';
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
  encodeTick,
  encodeError,
  encodeChatLine,
  encodeShotSeen,
  encodeHurt
} from '../shared/protocol.ts';
import type { WirePose } from '../shared/protocol.ts';

const HELLO_TIMEOUT_MS = 5000;
const PING_MS = 15000;
const MAX_MSGS_PER_SEC = 40; // a client sends ~10 poses/s; far more is a bug or abuse
const MAX_BUFFERED = 256 * 1024; // skip snapshots to a client whose socket is this far behind
const CHAT_PER_SEC = 1; // chat lines a player may say a second, sustained...
const CHAT_BURST = 5; // ...after a burst of this many

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
  log?: (message: string) => void;
}

/** One connected client; id 0 means it was refused (server full) */
export interface Player {
  id: number;
  ws: WebSocket;
  name: string | null; // set by its HELLO
  room: Room<Player> | null;
  state: WirePose | null; // its latest pose, in wire units (cm)
  sent: Map<number, WirePose>; // id → the pose this client last received for that player (its local player list)
  alive: boolean; // answered the last ping
  budget: number; // messages left in its token bucket
  budgetAt: number; // ms (Date.now()) the bucket was last refilled
  chatBudget: number; // chat lines left in its own bucket
  chatAt: number; // ms (Date.now()) that one was last refilled
}

/** GET /health: the rooms, plus moving averages of the tick's cost (ms) and of the bytes it sends */
export type Health = RoomStats & { tickMs: number; bytesPerTick: number };

export interface RunningServer {
  port: number;
  rooms: RoomManager<Player>;
  players: Map<number, Player>;
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
  log = console.log
}: ServerOptions = {}): Promise<RunningServer> {
  // Poses stay in wire units (centimetres) server-side, so the grid's 250 m cells are 25 000 cm
  const rooms = new RoomManager<Player>({ capacity, cellSize: 25000 });
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
    send(p, encodeError(code));
    p.ws.close(1008, code);
  };

  wss.on('connection', (ws) => {
    const p: Player = {
      id: players.size >= maxPlayers ? 0 : allocateId(),
      ws,
      name: null,
      room: null,
      state: null,
      sent: new Map(), // id → the pose this client last received for that player (its local player list)
      alive: true,
      budget: MAX_MSGS_PER_SEC,
      budgetAt: Date.now(),
      chatBudget: CHAT_BURST,
      chatAt: Date.now()
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

      if (msg.op === OP.HELLO && !p.room) {
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
        p.room = rooms.join(msg.region, p);
        send(p, encodeWelcome(p.id, rooms.capacity, tickHz, p.room.id));
        log(`[mp] ${p.name} (#${p.id}) joined ${p.room.id} (${p.room.players.size}/${rooms.capacity})`);
      } else if (msg.op === OP.STATE && p.room) {
        const st = msg.state; // centimetres: the grid works in the same units
        // Keep the old object for an unchanged pose, so ticks can tell "moved" by identity and skip parked players
        if (!samePose(p.state, st)) p.state = st;
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
        // to those who have the shooter in view (they hear and see it), not back to the shooter
        const frame = encodeShotSeen(p.id, msg.shot);
        for (const other of p.room.players.values()) if (other !== p && other.sent.has(p.id)) send(other, frame);
      } else if (msg.op === OP.HIT && p.room && p.state) {
        const target = p.room.players.get(msg.target);
        if (!target || target === p || !target.state) return;
        const reach = Math.hypot(target.state.x - p.state.x, target.state.y - p.state.y, target.state.z - p.state.z) / 100;
        if (reach <= HIT_REACH) send(target, encodeHurt(p.id, msg.damage));
      } else if (msg.op === OP.DOWN && p.room) {
        // the room hears who killed whom, as a line from the server
        const killer = msg.killer && msg.killer !== p.id ? p.room.players.get(msg.killer) : undefined;
        const text = killer ? `${killer.name ?? ''} mató a ${p.name ?? ''}` : `${p.name ?? ''} murió`;
        const line = encodeChatLine(0, '', text);
        for (const other of p.room.players.values()) send(other, line);
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      players.delete(p.id);
      if (p.room) {
        const room = p.room;
        rooms.leave(room, p.id);
        // everyone who had this player in view drops it now rather than waiting for the next tick
        for (const other of room.players.values()) {
          if (other.sent.delete(p.id)) send(other, encodeTick(room.players.size, [p.id], [], []));
        }
        log(`[mp] ${p.name} (#${p.id}) left ${room.id}`);
      }
    });
  });

  // One TICK frame per client: departures, newcomers (with names) and the poses that changed since it last heard
  const positions = new Map<number, WirePose>(); // reused per room: id → state
  const radiusCm = viewRadius * 100;
  function tick() {
    const t0 = performance.now();
    let bytes = 0;
    for (const room of rooms.rooms.values()) {
      positions.clear();
      for (const [id, pl] of room.players) if (pl.state) positions.set(id, pl.state);
      for (const p of room.players.values()) {
        if (!p.state || p.ws.bufferedAmount > MAX_BUFFERED) continue;
        const inView = nearestInView(room.grid, positions, p.id, radiusCm, viewMax);
        const now = new Set(inView);
        const gone: number[] = [];
        for (const id of p.sent.keys()) if (!now.has(id)) gone.push(id);
        for (const id of gone) p.sent.delete(id);
        const info: [number, string][] = [];
        const moved: [number, WirePose][] = [];
        for (const id of inView) {
          const st = positions.get(id);
          if (!st) continue; // (inView only holds ids from positions)
          const last = p.sent.get(id);
          if (!last) info.push([id, room.players.get(id)?.name ?? '']); // (players in a room said hello: they have names)
          if (last !== st) {
            moved.push([id, st]);
            p.sent.set(id, st);
          }
        }
        const frame = encodeTick(room.players.size, gone, info, moved);
        bytes += frame.byteLength;
        send(p, frame);
      }
    }
    load.tickMs += (performance.now() - t0 - load.tickMs) * 0.1;
    load.bytesPerTick += (bytes - load.bytesPerTick) * 0.1;
  }
  const tickTimer = setInterval(tick, 1000 / tickHz);

  // Drop sockets that stopped answering pings (closed laptops, lost mobile signal)
  const pingTimer = setInterval(() => {
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
        tick,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tickTimer);
            clearInterval(pingTimer);
            for (const p of players.values()) p.ws.terminate();
            wss.close(() => httpServer.close(() => { done(); }));
          })
      });
    });
  });
}

// The game's page and what it loads, from `root`: index.html for /, and the files under css/, dist/ and assets/ (the
// rest of the folder, its sources, tools and dotfiles among them, is never served). True when it answered.
const STATIC_FOLDERS = ['css', 'dist', 'assets'];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm'
};
function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return false;
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((part) => part.startsWith('.') || part.includes('\\'))) return false; // (no dotfiles, no climbing out)
  const allowed = parts.length === 0 || (parts.length === 1 && parts[0] === 'index.html') || (parts.length > 1 && STATIC_FOLDERS.includes(parts[0]));
  if (!allowed) return false;
  const base = path.resolve(root);
  const file = path.resolve(base, parts.length ? parts.join('/') : 'index.html');
  if (!file.startsWith(base + path.sep)) return false;
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;
  let size: number;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    size = stat.size;
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
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
    staticDir: process.env.STATIC_DIR || null
  }).then(({ port }) => { console.log(`[mp] listening on :${port} (rooms of ${intEnv('ROOM_CAPACITY', 200)})`); });
}

export { createServer };
