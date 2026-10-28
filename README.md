# Slop Tepic

A Tepic, Nayarit (with Xalisco) open-world simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL, forked from [Slop New York](https://github.com/mrdoob/slop-newyork). Explore the city on foot, by car, by bicycle, or by helicopter, starting at the Plaza Principal, and knock over pedestrians, cyclists, lamp posts and hydrants. Its camiones and combis run Tepic's real routes, as the state's Secretaría de Movilidad maps them. The map reaches the airport south-east of town (its runway, taxiways, apron and airliners at the gates), by the road as you would really drive there: out on the MEX 15, down the Autopista Tepic – Compostela and along its Ramal Aeropuerto to the terminal. When it rains in Tepic it rains in the game (Live weather): the drops fall round you, the roads stay wet for a while after, tyres grip less and throw up spray, people hurry, and thunderstorms flash and rumble. Try `?live-weather=rain` or `?live-weather=storm`.

The city lies on its real ground: its streets climb and fall with the valley floor (some 300 m from its lowest streets up to the lomas), with the hills around it. Add `?slopes=0` to the URL for the flat city. Its overpasses stand where OpenStreetMap has a road bridged over another road or the railway: decks on piers with ramps up to them, drivable and walkable. The railway through town is laid with ballast, sleepers and rails. Roads through a tunnel stay at grade, and the road over them is raised instead, because the ground is a single surface.

## Run it

The game is written in TypeScript (`js/**/*.ts`) and bundled by esbuild into `dist/`. With Node 24 or later:

```bash
npm install
npm run dev
```

Then open http://localhost:8765 in a WebGPU browser. `npm run dev` rebuilds on every change. For the page as it is
published, `npm run build` writes `dist/`; then serve the folder with any static server (`python3 -m http.server 8000`).

`npm run check` type-checks (strict), lints (typescript-eslint's strict type-aware rules) and runs the tests.

## Rebuild the city data

`js/world/city-geodata.js` is generated from OpenStreetMap (Overpass) and Overture Maps:

```bash
tools/data/tepic/fetch.sh
```

```bash
tools/data/tepic/fetch-overture.sh
```

```bash
tools/data/tepic/fetch-terrain.sh
```

```bash
tools/data/tepic/fetch-routes.sh
```

```bash
node --max-old-space-size=12000 tools/build-tepic-geodata.mjs
```

The streets that are not asphalt (`js/world/pavement-data.ts`: empedrado, adoquín, tierra, concreto) come from OpenStreetMap's `surface` tags, plus the colonias known to be cobbled that OpenStreetMap leaves untagged (`COBBLED` in the tool: add a colonia there, or tag its streets in OpenStreetMap):

```bash
node tools/build-tepic-pavements.mjs
```

## Making the centro look like Tepic

Neither OpenStreetMap nor Overture records a height, a storey count or a colour for any building
near the Plaza Principal, so the game guesses them. Three ways to fix that, best first:

1. **Edit OpenStreetMap.** Tag `building:levels`, `building:colour`, `roof:shape` and shop names.
   The next run of `tools/data/tepic/fetch.sh` and the builder picks them up, and every other map
   of Tepic improves too.
2. **Overrides from photographs:** `js/world/building-overrides.ts` pins storeys and a facade
   colour to a point on a building (`{ lat, lon, storeys, paint }`). Then rebuild
   `city-geodata.js`. The building is drawn whole, as it really is.
3. **Landmark models:** a `.glb` from phone photogrammetry or Blender replaces the generic houses
   on a landmark's lot. See [assets/models/README.md](assets/models/README.md).

## License and data

The project code is available under the [MIT License](LICENSE).

Geographic data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL); building footprints from [Overture Maps](https://overturemaps.org/) (OpenStreetMap, Microsoft ML Buildings and Google Open Buildings; ODbL). Elevation: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) by Mapzen on AWS (SRTM, GMTED2010, ETOPO1 and other sources, see [their attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)). Live weather: [Weather data by Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Bus & combi routes: [Secretaría de Movilidad del Estado de Nayarit](https://semovi.nayarit.gob.mx/muevete-transporte-publico/) (its public transport map). The player's car rides on [Jolt Physics](https://github.com/jrouwe/JoltPhysics.js) (MIT). The Catedral's front and towers (`assets/models/catedral.glb`) are a model made with [Meshy](https://www.meshy.ai/) from [a photograph by Nheyob](https://commons.wikimedia.org/wiki/File:Catedral_de_la_Pur%C3%ADsima_Concepci%C3%B3n_(Tepic,_Nayarit)_-_facade.jpg) on Wikimedia Commons ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), and are shared under the same licence. The player's person (`assets/models/people/player.glb`) was made with Meshy (Meshy 7.1) from two views it drew (Nano Banana Pro), and skinned to the crowd's skeleton by `tools/models/prepare-person.mjs`; its body in play (`assets/models/people/player-rigged.glb`) is that model as Meshy rigged it, moved by clips from Meshy's animation library. The cars in `assets/models/cars/` (the Cybertruck, the Model Y, the Tsuru taxi and not, the Versa, the March, the NP300, the Aveo and the Gol) are modelled by script in Blender (`tools/models/blender/`), our own work. The Hermana Agua's statue (`assets/models/hermana-agua.glb`) was made with Meshy (Meshy 7.1) from an image it drew (Nano Banana Pro), and prepared in Blender (`tools/models/prepare-statue.py`). Third-party data and dependencies retain their respective licenses.
