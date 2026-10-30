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
- **Area of interest:** that frame covers only the `VIEW_MAX` nearest players within `VIEW_RADIUS`, using a 250 m grid ([`aoi.ts`](aoi.ts)). They are found by rings of cells outward from the player's own, stopping once nothing further out can be nearer, and found again every third tick (staggered by player): the nearest change slowly.
- **Only changes:** within the frame, only the poses that changed since that client last heard them are sent. Parked players cost nothing.
- **Fewer for the far ones:** a player within 150 m is sent every tick, within 400 m every other one, beyond that every third (`updateEvery` in the protocol). The client carries the far ones on along their heading at their speed in between.

| Message | Size |
|---|---|
| Client pose (`STATE`) | 18 bytes |
| One moved player in a `TICK` | 19 bytes |
| A full view of 64 moving players | ~1.2 KB, about 12 KB/s per client |

Besides poses, the server passes on what players do to each other:

- **Chat (`CHAT` → `CHAT_LINE`):** a line (up to 140 characters, cleaned like names) goes to the whole room. Each player may say a line a second after a burst of five; past that, lines are dropped.
- **Shots (`SHOT` → `SHOT_SEEN`):** each shot the player fires (its two ends, its weapon, rocket or bullet) goes to the players who have the shooter in view, so they see and hear it.
- **Hits (`HIT` → `HURT`):** the shooter's client traces its shots, blows and blasts against the others' poses and says whom they struck, and with what (`fists`, `pistol`, `smg`, `rifle`, `bazooka`, `blast`). The server passes the damage on only when the two can hurt each other (PvP on, not crew mates, neither in passive mode) and the hit is one its weapon could land ([`checks.ts`](checks.ts), by [`shared/combat.ts`](../shared/combat.ts)'s limits).
- **Deaths (`DOWN`):** a killed player says who killed it, and the server believes it only if that player's hit really struck it last, in the last 10 s, and only once. It tells the room (`NOTE`: who killed whom, or who changed the sky), which each client words in its player's language ("Ana mató a Beto", "Ana killed Beto") in its chat, and counts the kill on both profiles.

## Playing together

[`play.ts`](play.ts), and on the wire [`shared/protocol-play.ts`](../shared/protocol-play.ts):

- **Crews (`CREW` → `CREW_ASK`, `CREW_SET`):** a player invites another (the game's Crew button, or U), who accepts or declines within a minute. Up to 8 friends in one crew ([`crews.ts`](crews.ts)). Crew mates can't hurt each other, see each other on the map in their own colour, and the server keeps them in each other's view however far apart they are.
- **Passive mode (`PASSIVE`):** a player in it (the Crew card's button, or P) can't hurt other players and can't be hurt by them. Not within 10 s of a fight: the server turns it down, and the player's own `TAG` says so.
- **Tags (`TAG`):** each player's crew, passive mode and wanted stars, sent to those who have it in view (and to a newcomer to that view). The stars show after its name.
- **Car looks (`LOOK` → `LOOK_SEEN`):** the model, paint and livery of the player's car, so the others draw it as it is ([`js/net/remote-looks.ts`](../js/net/remote-looks.ts)), not as their own.
- **The police after a player (`WANTED`, `UNITS` → `UNITS_SEEN`):** every game runs its own chase, after its own player. Now it sends the units after it (patrol cars, the cartel's and the army's trucks, the helicopter, 4 times a second) to those who see it, who draw them and show them on the map ([`js/net/remote-police.ts`](../js/net/remote-police.ts)). They are drawn only: they don't shoot at the others.

The others' cars also push the player's car (and its traffic) out of their way, in each player's own game: a ram hurts only when the two can hurt each other.

## What the server decides

The game is the client's to draw and the server's to judge: like RuneScape's or Fortnite's, the server assumes any client may be modified, and believes it only as far as it must. It runs no physics and doesn't see the city, so it can't stop an aimbot or a shot through a wall, but it decides everything one player does to another:

- **Moves** ([`checks.ts`](checks.ts)): no faster across the ground than the player's mode goes ([`shared/combat.ts`](../shared/combat.ts) `MODE_SPEED`, with slack and a couple of seconds saved up for poses that arrive in a burst). A jump further than that is a teleport (the map's, a respawn), allowed every 4 s. Any other move is dropped: the player stays where it was for the others.
- **Shots:** a `SHOT` must start where the shooter stands; one from anywhere else, or fired dead, shows to nobody.
- **Hits:** a gun's hit must lie on the line of a round of that gun the server saw in the last 2 s, and each round strikes once; a blast must be near a rocket's line or where a round ended; a punch within arm's reach. No more damage than the weapon does, no faster than it fires, and all of a player's guns and fists together no more damage a second than the strongest of them alone.
- **Health** ([`vitals.ts`](vitals.ts)): the server keeps every player's health and armour. The others' hits take them as the player's own game does; the game's own reports (`VITALS`) only ever lower them (the city's harm, which the server doesn't see); pickups (`HEAL`) raise them no more often than the game drops them. When the health runs out the player is dead, whatever its game says (`KILLED`): a god-mode client still dies, and for the 4 s it is down it hurts nobody.
- **Kills:** only the player whose hit really struck the victim last, and on the rankings once every 3 minutes for the same killer and victim, so two friends can't trade kills up the table.
- **Kicks and bans** ([`conduct.ts`](conduct.ts)): a player whose moves or hits the server keeps turning down, beyond what lag explains, is kicked (`ERROR cheat`); kicked three times in half an hour, its profile and its address are banned for an hour, then twice as long each time (`ERROR banned`), kept in `DATA_DIR/bans.json`. Behind a proxy (Fly.io), `TRUST_PROXY=1` takes the address from its headers.
- **Reports** (`REPORT`, the Crew card's Report button): written to `DATA_DIR/reports.log`, one JSON line each, with what the server knows of the one reported (how many of its moves and hits it turned down), for a person to read.

Everything travels as the protocol's own binary frames over the WebSocket (`wss://` behind Fly's https: nobody in between reads or changes them), and is checked as it arrives, not on a tick: only the others' poses go out on the 10 Hz tick.

## Profiles and rankings

There's no sign-up. A player's first `HELLO` gets a token (`PROFILE`), which its browser keeps (`localStorage`); a new profile is kept once it has played a minute or fought. The token is the profile, its kills and deaths of other players, its best run of kills without dying and its time played ([`profiles.ts`](profiles.ts)). The lobby shows it as a code (`abcd-efgh-ijkl-mnop-qrst`) to type on another device, a phone say, to be the same player there.

The profiles are kept in `DATA_DIR/profiles.json`, a few seconds after each change and when the server stops. The file holds only each token's SHA-256, so a copy of it lets nobody in as anyone. Without `DATA_DIR` they are kept in memory and lost when it stops. `GET /rankings` lists the 20 players with the most kills, shown in the lobby.

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
| `DATA_DIR` | none | Where the profiles (`profiles.json`), the bans (`bans.json`) and the reports (`reports.log`) are kept. Unset, in memory only |
| `TRUST_PROXY` | unset | `1` behind a proxy that says who connected (Fly.io): the bans go by that address |

`GET /rooms?region=<region>` lists the region's rooms. `GET /rankings` lists the players with the most kills. `GET /health` returns the rooms, the player count, the tick cost (`tickMs`) and the bytes sent per tick.

## Test and measure

```bash
npm test
BOTS=1000 SPREAD=20000 node bench.ts
```

`bench.ts` drives simulated players against an in-process server. Bots and server share one Node process, so real numbers are better. On an Apple-silicon laptop:

| Bots | Area | Tick (budget 100 ms) | Out per tick |
|---|---|---|---|
| 2000 | 3 km, a crowd | 43-58 ms (192 ms before the rings, the view every third tick and the sparser far poses) | 1.5 MB (2.2 MB before) |
| 2000 | 10 km, the city | 41 ms (85 ms before) | 0.6 MB (1.2 MB before) |

(Measured 2026-10-27 on an M3 MacBook already loaded with other work: the bots share the process too.)

One room of 1000 (`ROOM_CAPACITY=1000 BOTS=1000`), measured 2026-10-29: 18 ms a tick and 630 KB out per tick crowded into 3 km (about 50 Mbit/s out), 10 ms and 145 KB spread over 10 km. Each player still sees only its nearest `VIEW_MAX` (64).

## Deploy

GitHub Pages only serves the static game. The room server has to run somewhere that keeps a process alive. The [`Dockerfile`](../Dockerfile) at the repository's root makes one image of both, the server serving the game's page, so the game's address is the server's:

```bash
docker build -t slop-tepic .
docker run -p 8787:8787 -v slop-data:/data slop-tepic
```

On [Fly.io](https://fly.io), with [`fly.toml`](../fly.toml) (one machine in Querétaro, always on, the profiles on a volume):

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config    # pick a name of your own for the app
fly volumes create slop_data --size 1 --region qro
fly deploy
```

Then the game is at `https://<app>.fly.dev/?multiplayer=1`, for anyone, phones included. Keep it to **one machine**: the rooms live in its memory, so two machines would be two worlds that never meet. A 2-CPU, 1 GB machine handles a few rooms of 200; a room of 1000 crowded together sends about 50 Mbit/s, which is what to budget for.

To keep the page on GitHub Pages and only the server on Fly, open it as `https://<you>.github.io/<repo>/?multiplayer=1&mp-server=wss://<app>.fly.dev`, and set `ALLOWED_ORIGINS=https://<you>.github.io` on the server.

## Scope

The server holds poses, shots, hits and health to what the players could do (above), but it runs no physics and has no line of sight: an aimbot, or a shot through a wall, still works. Weapons and ammunition are the client's (picked up in its own city), held only to their rates. The world besides the players and the police after them (the traffic, the pedestrians) is each game's own. Accounts are a token, with no email or password to recover one lost with its browser's storage (unless its code was written down).
