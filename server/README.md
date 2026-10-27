# Multiplayer room server

Players connect over WebSocket and are placed in a room for their **region** (a metro area or state that shares one map, such as `nayarit` or `valle-de-mexico`). Each room holds up to `ROOM_CAPACITY` players. When a region's rooms are full, the next player opens a mirror room (`nayarit#2`), and empty rooms close.

## Rooms of their own

Besides the region's public rooms, a player can open a room of their own from the game's lobby ([`js/net/lobby.ts`](../js/net/lobby.ts), with `?multiplayer=1`). It has:

- a **title**, and a **code** of five letters and digits (`K7Q2M`, no 0/O or 1/I) that friends type to join it;
- an optional **password**, kept only as a salted scrypt hash ([`passwords.ts`](passwords.ts)). After ten tries in a minute that weren't right (counted as they come in, so a burst on many sockets meets the brake too), the room refuses the rest (`wait`) until the minute is up;
- its **sky** (the time of day and the weather, as any room has: `SKY` → `SKY_SET`) and its **rules**: police on or off, and PvP on or off. With PvP off the server passes on no hits.

Whoever opens a room hosts it: only the host changes its sky (a guest's `SKY` is ignored) and its rules (`RULES`), and everyone in it hears them (`SKY_SET`, `ROOM`). When the host leaves, the player who has been in it longest takes over. Left empty, it waits two minutes for its players to come back (a dropped connection rejoins it by its code, and the first one back hosts it), then closes.

`GET /rooms?region=nayarit` lists a region's rooms (public first, then the players' own, fullest first): their title, code, players, whether they have a password, and their sky and rules. Never the password.

The wire protocol ([`shared/protocol.ts`](../shared/protocol.ts)) is binary, in the spirit of RuneScape's. Every frame starts with a 1-byte opcode, and positions travel as integer centimetres.

- **One frame per tick:** each server tick (10 Hz) sends every client a single `TICK` frame.
- **Area of interest:** that frame covers only the `VIEW_MAX` nearest players within `VIEW_RADIUS`, using a 250 m grid ([`aoi.ts`](aoi.ts)).
- **Only changes:** within the frame, only the poses that changed since that client last heard them are sent. Parked players cost nothing.

| Message | Size |
|---|---|
| Client pose (`STATE`) | 18 bytes |
| One moved player in a `TICK` | 19 bytes |
| A full view of 64 moving players | ~1.2 KB, about 12 KB/s per client |

Besides poses, the server passes on what players do to each other:

- **Chat (`CHAT` → `CHAT_LINE`):** a line (up to 140 characters, cleaned like names) goes to the whole room. Each player may say a line a second after a burst of five; past that, lines are dropped.
- **Shots (`SHOT` → `SHOT_SEEN`):** each shot the player fires (its two ends, its weapon, rocket or bullet) goes to the players who have the shooter in view, so they see and hear it.
- **Hits (`HIT` → `HURT`):** the shooter's client traces its shots, blows and blasts against the others' poses and says whom they struck. The server passes the damage on if the target is in the same room and within 400 m. It is a game among friends: nothing more is checked.
- **Deaths (`DOWN`):** a killed player says who killed it (the last player to hit it in the last 10 s), and the server tells the room (`NOTE`: who killed whom, or who changed the sky), which each client words in its player's language ("Ana mató a Beto", "Ana killed Beto") in its chat.

A player can also ride in a friend's car (F by it, F again to get out): it then sends the car's pose with the mode `passenger`, and the others draw nothing for it but its name.

## Play with someone over the internet

```bash
brew install cloudflared   # once
npm install && (cd server && npm install)   # once
npm run play
```

`npm run play` ([`tools/play.ts`](../tools/play.ts)) builds the game, starts this server serving the game's page too (`STATIC_DIR`), and opens a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) to it. It prints a public `https://….trycloudflare.com/?multiplayer=1` link. Whoever opens it (Chrome or Edge on a computer: WebGPU) plays in your room, asked their name the first time. The address changes each run and works while the command runs.

The page needs https: browsers only enable WebGPU on secure pages, so a computer on your own network can't join over plain `http://192.168.…` either. It goes through the tunnel too.

## Run it

```bash
cd server
npm install
npm start
```

The server is TypeScript that Node runs as is, stripping the types (Node ≥ 22.18; no build step).

Then open the game with `?multiplayer=1` from `localhost`. It connects to `ws://localhost:8787` on its own (and served from anywhere else, to its page's own server). The lobby comes up once the city has loaded: join the public room, a friend's by its code, or open your own. Open a second tab with `&mp-name=Beto` to see each other.

| URL parameter | Meaning |
|---|---|
| `multiplayer=1` | Turn multiplayer on (off by default; single player never loads it) |
| `mp-server=wss://host/path` | Server to use. Required when the page is not served from localhost |
| `mp-region=nayarit` | Room region (defaults to this map's) |
| `mp-name=Lalo` | Display name (remembered; the lobby asks for it otherwise) |

| Environment variable | Default | |
|---|---|---|
| `PORT` | 8787 | |
| `ROOM_CAPACITY` | 200 | Players per room before a mirror opens |
| `VIEW_RADIUS` | 800 | Metres within which other players are sent |
| `VIEW_MAX` | 64 | Most players sent to one client |
| `MAX_PLAYERS` | 5000 | Per server process |
| `ALLOWED_ORIGINS` | any | Comma-separated page origins allowed to connect |
| `STATIC_DIR` | none | The game's folder: the server serves its page (`index.html`, `css/`, `dist/`, `assets/`) and nothing else of it |

`GET /rooms?region=<region>` lists the region's rooms. `GET /health` returns the rooms, the player count, the tick cost (`tickMs`) and the bytes sent per tick.

## Test and measure

```bash
npm test
BOTS=1000 SPREAD=20000 node bench.ts
```

`bench.ts` drives simulated players against an in-process server. Bots and server share one Node process, so real numbers are better. On an Apple-silicon laptop:

| Bots | Area | Tick (budget 100 ms) | Per client |
|---|---|---|---|
| 200 | 2 km | 6 ms | 10 KB/s |
| 1000 | 2 km, everyone in view | 62 ms | 11.5 KB/s |
| 1000 | 20 km | 14 ms | 1 KB/s |

## Scope

The server relays poses as clients send them. It checks their shape and rate, but it runs no physics and doesn't validate movement. Anti-cheat, accounts and persistence (economy, rankings) belong in later layers.

GitHub Pages only serves the static game. This server has to run somewhere that keeps a process alive: a VPS, Fly.io, Railway, and so on.
