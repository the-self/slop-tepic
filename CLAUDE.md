# CLAUDE.md

A browser open world (three.js `WebGPURenderer` + TSL shaders) of Mexican cities at 1:1 scale, starting with Tepic, Nayarit (with Xalisco), forked from Slop New York. It is written in strict TypeScript (`js/**/*.ts`), bundled for the page by esbuild into `dist/` (`tools/build.ts`). three.js and Jolt stay out of the bundle: they come from jsDelivr through the import map in `index.html`.

## Run and test

```bash
npm install
npm run dev        # rebuilds on every change and serves http://localhost:8765
npm run check      # tsc (strict) + ESLint (typescript-eslint strictTypeChecked) + the tests
npm run build      # the minified bundle in dist/, as the page is published
npm run play       # play with someone over the internet: the game + its server behind a Cloudflare tunnel (server/README.md)
(cd server && npm install && npm test)  # multiplayer server tests
```

- Node ≥ 24: it runs the same `.ts` files the bundle is made of, by stripping their types (the tests, the tools, the server).
- `npm run check` must pass before a change is done: `npm run typecheck`, `npm run lint` and `npm test` one by one. CI (`.github/workflows/ci.yml`) runs all of them and the build.
- Load the page and look at it after any visual change. The tests don't render.
- URL switches:
  - `?live-time=<ISO date>` and `?live-weather=<clear|cloudy|overcast|rain|storm|fog>` preview the Live time of day.
  - `?multiplayer=1` joins the room server (see `server/README.md`).
  - `?slopes=0` builds the flat city of before, everything at y = 0 (the default lays the town on its real slopes, `world/ground.ts`).
  - `?stream=0` lays all the ground layers at start-up, as before streaming (the default lays them tile by tile around the camera, `world/streaming.ts`).
  - `?quality=<high|low>` picks the graphics tier (`app/quality.ts`); a touch screen gets `low` by default: a smaller shadow map, no SSR, the small props drawn nearer.
  - `?debug` adds `window.__slop` (the scene and every system) and times each system of the frame loop: `__slop.scheduler.report()`.

## Layout

`js/main.ts` is the entry: a list of installers (`app/install/`), one per feature, each taking the parts installed before it and returning its own (`player.ts`: the player, the cameras, the car's physics; `crime.ts`; `city-life.ts`; `controls.ts`: the input, the map & the menu; `sky.ts`...). Then `app/frame-loop.ts` steps them every frame through the `Scheduler`, in the order written down there. An installer never reaches one installed after it: it says what happened on the `EventBus` (`GameEvents` in `app/game.ts`: `respawn`, `mode`, `menu`...) and the later one listens. The other modules are grouped by concern.

A big system is a small facade module with a folder of its pieces next to it: `sim/traffic.ts` + `sim/traffic/`, `sim/crime.ts` + `sim/crime/`, `player/controllers.ts` + `player/controllers/`, `world/buildings.ts` + `world/buildings/`, `render/tsl-materials.ts` + `render/materials/`, `actors/actor-models.ts` + `actors/vehicles/`. Import the facade from outside; inside, the pieces share the system's state through one typed object (`TrafficState`, `CityBuild`) or the class instance they take as their first parameter (`crime: CrimeSystem`, `ctl: ThirdPersonControllerManager`), and `import type` the facade's class, never its value (no load-time cycles). Keep a piece to one responsibility and about 600 lines; when a module outgrows that, split it the same way.

| Folder | What lives there |
|---|---|
| `core/` | The architecture's pieces, free of three.js: `scheduler.ts` (the frame loop's `System`s, stepped in order and timed with `?debug`), `events.ts` (a typed `EventBus`: systems report and react without importing each other) |
| `app/` | What `main.ts` is made of: the installers (`install/`: one per feature, in `main.ts`'s order), the parts they share and the bus's events (`game.ts`), the frame loop (`frame-loop.ts`), the city's build order (`city.ts`), the render pipeline (`render-pipeline.ts`: scene pass, SSR, grade), shader precompile & warm-up (`shaders.ts`), the HUD's text parts (`hud.ts`), boarding (`boarding.ts`), teleports (`teleport.ts`), the saved player (`player-state.ts`), the Live weather's effects (`weather-effects.ts`), the loading screen (`loading.ts`) |
| `render/` | Sky and sun light, IBL and fog (`lighting.ts`), post-processing and grading, TSL materials (`tsl-materials.ts` + `materials/`: the shared `cityUniforms`, facades, interiors, roads, foliage...), culling |
| `world/` | Map data and everything built from it: `city-config.ts` (street database and frame helpers over the generated geodata, typed by `city-geodata.d.ts`), blocks and buildings (`buildings.ts` + `buildings/`: lots, massing, layouts by district, the shop sign atlas, the detail streamed round the camera), landmarks, street furniture, trees, the road graph and paint, terrain, storefronts, the car parks (`parking.ts` lays out the stalls, three-free; `car-parks.ts` draws the asphalt, the paint, the driveways and the parked cars round the camera; the car dealers' lots too, their make's cars on show: the makes in `storefronts/agencias.ts`), the Central de Autobuses (`central-plan.ts` lays out its terminal, andenes & patio, three-free; `central.ts` builds them and the coaches in their bays), the Coca-Cola bottling plant by Ley Álica (`embotelladora-plan.ts` lays out its shed, offices, walls & fleet, three-free; `embotelladora.ts` + `embotelladora/` builds them, the route trucks in `actors/vehicles/route-truck.ts`), the supermarkets' loading docks (`loading-docks.ts` finds them and their trucks' hours, three-free; `delivery-trucks.ts` draws the tráilers there in the small hours), the bardas (`barda-runs.ts` finds the big open plots to wall, three-free; `bardas.ts` builds them and OSM's mapped walls), the UAN's campus (`uan-campus.ts` finds its walls, gates, buildings & trees, three-free; `uan.ts` + `uan/` builds them, with the building kit `building-kit.ts` the bottling plant uses too), Forum Tepic, the mall you walk into (`forum-plan.ts` lays out its buildings, two floors of shops, escalators & walls, three-free, its pieces in `forum/plan-*.ts`; `forum.ts` + `forum/` builds it), the CFE's lines (`cfe-grid.ts`: which transformer feeds each pole and what goes dark when one falls, three-free; `cfe-network.ts`: the wires, the lines down and the blackout; `cfe-sparks.ts`: their arcs), `weather.ts` (real sun and Open-Meteo conditions); the streaming of the ground layers: `tiles.ts` & `lattice.ts` (the tile grid and the drape's arithmetic, three-free), `streaming.ts` (which tiles to lay, around the camera and ahead of it), `tile-worker.ts` (lays them off the main thread), `far-ground.ts` (the city painted on the floor beyond them) |
| `sim/` | Traffic (`traffic.ts` + `traffic/`: spawning, lanes & right of way, junctions, collisions, Jolt crashes, carjacking, camiones, combis & taxis stopping for people at the curb (`pickups.ts`), rendering), pedestrians and their routes, knock-downs (`mayhem.ts`: people, street furniture, and to a car the CFE's poles & the thinner trees), crime (`crime.ts` + `crime/`: guns, the wanted level and the police, gangs, thieves; rules in `weapons.ts` and `crime-rules.ts`, effects in `gunfire-fx.ts`); what lives in Forum Tepic (`forum.ts` + `forum/`: its shoppers, run over as on the street, the glass a car breaks through, the escalators carrying you) |
| `actors/` | Vehicle and helicopter geometry and materials (`actor-models.ts` + `vehicles/`), vehicle lights, weapon models |
| `player/` | The player controllers (`controllers.ts` + `controllers/`: person, car, cyclist, moto, helicopter, boarding, collisions, input), Jolt vehicle physics, the car's drivetrain, crash damage & blood, and the camera rigs |
| `input/` | Touch and gamepad controls (keyboard lives in `player/controllers.ts`) |
| `ui/` | The minimap and full map (`city-map.ts`), the crime HUD (`crime-hud.ts`: stars, health, money, weapon), the weapon wheel |
| `i18n/` | The game's languages: `i18n.ts` (picks the language, `t()`, translates the page and re-translates it on a switch), `en.ts` (sets the keys), `es.ts` (the default); `README.md` says how to add a text or a language |
| `audio/` | Procedural city audio, synthesised (no audio files) |
| `net/` | Multiplayer client (`multiplayer.ts`), loaded only with `?multiplayer=1` (its own chunk in the bundle) |
| `models/` | Vehicle data: `cars/` (one file per make: real sizes, engines, top speeds, rarity in traffic; `cars/README.md` says how to add one), `motos/`, and the body shapes they are drawn with (`bodies.ts`) |
| `types/` | Declarations only: `three-fixes.d.ts`, where @types/three is narrower than what three.js does (extra overloads, not casts) |

Outside `js/`:
- `shared/protocol.ts`: the binary multiplayer protocol, imported by both the client and the server.
- `server/`: the region-room WebSocket server (TypeScript run by Node, ≥ 22.18).
- `tools/`: the build (`build.ts`), geodata builders and benchmarks, `port-to-ts.ts` (below); `tools/models/`, the
  image-to-3D pipeline (Meshy, then `prepare.mjs`).
- `assets/models/`: the 3D models (`.glb`). **Read `assets/models/CLAUDE.md` before making or placing one**: what to
  cut, how to place it on the street, and the traps (frozen matrices, released arrays, no quantization).
- `tests/`: `node:test` suites (plain JavaScript: they import or `loadModule` the `.ts` sources).

### Branches from before TypeScript

A branch that still adds `.js` modules: merge it, then `node tools/port-to-ts.ts` prints the plan and `--apply` renames them to `.ts` (git mv) and rewrites every specifier that named them (imports, test and tool paths, the import names tests stub). Edits to modules that already moved follow their rename in the merge. Then type the newcomers until `npm run check` passes.

## TypeScript

- **Strict, no escape hatches:** `strict` plus `noImplicitReturns`, `noUnusedLocals/Parameters`, `noImplicitOverride` (`tsconfig.base.json`), and ESLint's `strictTypeChecked` + `stylisticTypeChecked`. No `any`, no non-null `!`, no `as unknown as`, no `@ts-ignore` / `@ts-expect-error`, no `eslint-disable`: narrow with a check (`if (!x) return;`, `instanceof`, `in`) or fix the type where it is declared. A plain `as T` only where TS can't see what is provably true (`JSON.parse`, a DOM query, three's `userData`), with the reason next to it.
- **Erasable syntax only** (Node strips the types; `erasableSyntaxOnly`): no `enum`, `namespace`, constructor parameter properties. Type-only imports use `import type` (`verbatimModuleSyntax`).
- **Imports name the `.ts` file** (`'./city-config.ts'`), except the generated `'./city-geodata.js'`, whose `.d.ts` sits next to it. `tests/boot.test.cjs` checks every relative import exists.
- **Types live with the data they describe:** a module exports the interfaces of what it creates (lanes, vehicles, tiles, specs, option bags), and consumers `import type` them. Say the units of a field in its doc comment (m, rad, km/h, s).
- **Let inference work:** annotate parameters, class fields and exported shapes, not locals TS already infers.
- `skipLibCheck` is on (Jolt's typings use `declare module Jolt`, an error since TypeScript 6), and it skips our own `.d.ts` files too: ESLint's type-aware rules are what catch a broken type in `city-geodata.d.ts` or `types/three-fixes.d.ts`.

## Conventions

- **The frame loop:** every per-frame part of the game is a `System` (`core/scheduler.ts`) added to the scheduler in `app/frame-loop.ts`, in the order it must read the others' state. A new per-frame system goes there, not in an ad-hoc call. A new feature gets its own installer in `app/install/` (or joins the one it belongs to), not lines in `main.ts`. Things one system reports and others react to (a crash: the audio and the player's health) go through the `EventBus` (`GameEvents` in `app/game.ts`).
- **Layers:** the folders of `js/` are layers, lowest first: the foundations (`core/`, `i18n/`, `models/`, `types/`), `render/`, `actors/`, `world/`, `player/`, `sim/`, `audio/`, `input/`, `ui/`, `net/`, `app/`, `main.ts`. A module imports only from the layers below its own or from its own folder, type-only imports included; what a lower one has to tell a higher one goes up through the bus or a listener or query it is handed. `tests/layers.test.cjs` enforces it. Its `EXCEPTIONS` are the imports that went up before the test existed: the list only shrinks (one fixed must leave it), and never add to it. A new folder of `js/` gets a place in its `LAYERS`.
- **Stylesheet:** bump the `style.css?v=` query in `index.html` when you change the CSS, so returning players don't keep a stale stylesheet.
- **World frame:** 1 unit = 1 m. `x` runs east along the city's street grid, `z` runs south, and `y` is up. The grid is turned `GEO.frame.bearingDeg` degrees clockwise from true north. Real-world bearings (the sun, wind, compass) must go through it.
- **Generated data:** `city-geodata.js` (and `pavement-data.ts`) say "GENERATED … do not edit by hand": they come from `tools/build-tepic-geodata.mjs` (and `build-tepic-pavements.mjs`) over the OpenStreetMap / Overture data in `tools/data/tepic/` (see `README.md`). Change the builder or its data instead, and keep `city-geodata.d.ts` in step with what the builder writes.
- **Tests and `loadModule`:** module tests load a source file with `tests/helpers/module.cjs`'s `loadModule`, which strips the types and stubs each import by its exact specifier (`'./city-config.ts'`). Moving a module or changing an import path means updating those stub keys. Tests that slice a source by text read it through `stripTypes` first (the stripped annotations leave blanks: keep such regexes tolerant of them).
- **Keep Node-testable logic free of three.js imports** where you can: `weather.ts`, `core/` and `shared/protocol.ts` are like that, so `node --test` imports them directly.
- **DOM:** the HUD uses safe DOM APIs only (`textContent`, `classList`, `addEventListener`), never `innerHTML` with data.
- **Style:** match the surrounding code. Each module opens with a `// js/<path>` comment saying what it is, and comments explain *why*: units, invariants, the real-world source of a number. UI text lives in `i18n/` (one file per language, `es.ts` & `en.ts`; `i18n/README.md`): code asks `t('key')`, the page names its key in `data-i18n`, and nothing branches on the language. Proper names (streets, places, the cars' joke names) are not translated.
- **Performance:**
  - The frame loop is hot. Don't allocate per frame (reuse vectors), and spread expensive work out. For example, Live re-bakes the sky IBL only when the sun moved about 0.5° or the weather changed. A type must never cost the hot path an object or a closure.
  - Check fps in the HUD, `__slop.scheduler.report()` with `?debug`, and `tools/benchmark-pedestrians.mjs` or `server/bench.ts` where they apply.
- **Attribution:** keep the credits in `README.md` when adding data sources: OpenStreetMap and Overture Maps (ODbL), Open-Meteo (CC BY 4.0).

## Multiplayer in one paragraph

`server/index.ts` puts players in rooms per region (`ROOM_CAPACITY`, with mirror rooms when full). Every 10 Hz tick it sends each client one binary `TICK` frame. That frame covers only the nearest `VIEW_MAX` players within `VIEW_RADIUS` (found by rings of grid cells, again every third tick), and only the poses that changed since that client last heard them, the farther ones every second or third tick (`updateEvery`). The protocol is in `shared/protocol.ts`: opcodes, integer centimetres, 18-byte poses. The client in `net/multiplayer.ts` draws others 200 ms in the past, interpolated (extrapolated past a far one's last pose), reusing the player models: the cars instanced (`net/remote-cars.ts`). The server relays and shape-checks poses but runs no physics. Players also chat (`CHAT`), see each other's shots (`SHOT`), and hurt each other: the shooter's `sim/crime.ts` traces its shots, blows and blasts against the others' poses (`CrimeSystem.remotes`) and sends `HIT`, which the server passes on as `HURT` to the one struck. A player can ride in a friend's car (mode `passenger`, the camera following the car through `CameraSystem.follow`). Besides the region's public rooms, a player can open a room of its own from the lobby (`net/lobby.ts`: `CREATE`, a code to share, a password kept as a scrypt hash in `server/passwords.ts`) where only its host sets the room's sky (`SKY`) and its rules, police and PvP (`RULES` → `ROOM`); `GET /rooms` lists a region's rooms. With `STATIC_DIR` the server also serves the game's page, which is what `npm run play` puts behind its tunnel.
