// The folders of js/ are layers, and a module imports only from the layers below its own (or from its own folder):
// the world doesn't know the player, the player doesn't know the crime, and so on up to main.ts. What a lower layer
// has to tell a higher one goes up through the bus (core/events.ts, GameEvents in app/game.ts) or a function or
// interface it is handed (a listener, a query), never an import. Type-only imports count too: they don't make a
// load-time cycle, but they tie the lower module to the higher one's shapes all the same.
//
// EXCEPTIONS are the imports that went up before this test existed. The list only shrinks: an import fixed must leave
// it (the test says so), and a new one up fails the test. To fix one, move the module to the layer it belongs to
// (pedestrians.ts' bodies are actors, keybindings.ts is a foundation), hand the lower module what it needs, or move a
// feature that spans layers up to where it can see them all (street food, nightlife & interiors).
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, dirname, resolve, relative } = require('node:path');
const test = require('node:test');

const root = join(__dirname, '..');
const js = join(root, 'js');

// Lowest first. A folder may import from the layers before its own; the folders of one layer, not from each other.
const LAYERS = [
  ['core', 'i18n', 'models', 'types'], // foundations: the scheduler & the bus, the languages, the cars' data
  ['render'], // sky, light, materials, culling
  ['actors'], // vehicles', people's & weapons' models
  ['world'], // the city: map data and what is built from it
  ['player'], // the player's controllers, physics & cameras
  ['sim'], // traffic, pedestrians, crime, mayhem, fires, emergencies
  ['places'], // the places built on their own (the UAN, the Central, Forum Tepic): plan, building & life together
  ['audio'], // what the city sounds like
  ['input'], // touch, pad & keyboard
  ['ui'], // map, HUD, weapon wheel
  ['net'], // multiplayer
  ['app'], // the installers and the frame loop: everything wired
  ['main.ts']
];

const EXCEPTIONS = [
  // the person's skeleton & crowd live in sim/, but are actors' bodies
  'js/actors/person-body.ts -> js/sim/pedestrians.ts',
  'js/actors/person-body.ts -> js/sim/person-skeleton.ts',
  'js/actors/vehicles/car-blood-stains.ts -> js/player/car-blood.ts',
  // the key bindings: a foundation (no imports), living in input/
  'js/player/aim.ts -> js/input/keybindings.ts',
  'js/player/controllers/input.ts -> js/input/keybindings.ts',
  'js/sim/crime/player.ts -> js/input/keybindings.ts',
  // the player's body is a pedestrian's, falls as a ragdoll and knocks props down (sim/)
  'js/player/controllers.ts -> js/sim/pedestrians.ts',
  'js/player/controllers.ts -> js/sim/ragdolls.ts',
  'js/player/controllers/bike-models.ts -> js/sim/pedestrians.ts',
  'js/player/controllers/car-looks.ts -> js/sim/ragdolls.ts',
  'js/player/controllers/frame.ts -> js/sim/pedestrians.ts',
  'js/player/controllers/person.ts -> js/sim/pedestrians.ts',
  'js/player/controllers/person.ts -> js/sim/ragdolls.ts',
  'js/player/controllers/types.ts -> js/sim/mayhem.ts',
  'js/player/controllers/types.ts -> js/sim/pedestrians.ts',
  'js/player/controllers/types.ts -> js/sim/ragdolls.ts',
  // the sky reads the city's data (geodata, ground, weather) and the hour's traffic
  'js/render/lighting.ts -> js/sim/traffic-demand.ts',
  'js/render/lighting.ts -> js/world/city-geodata.js',
  'js/render/lighting.ts -> js/world/ground.ts',
  'js/render/lighting.ts -> js/world/weather.ts',
  'js/render/materials/shared.ts -> js/world/ground.ts',
  // the sounds' shapes, named by who makes them
  'js/sim/crime/types.ts -> js/audio/audio-sources.ts',
  'js/sim/fires.ts -> js/audio/audio-ambience.ts',
  'js/world/street-details.ts -> js/audio/audio-sources.ts',
  // the parked cars dent like the player's
  'js/world/car-parks.ts -> js/player/vehicle-damage.ts',
  // the venues' life: features over the world, the player, the people, the crime & the sound
  'js/world/interiors.ts -> js/audio/audio-ambience.ts',
  'js/world/interiors.ts -> js/player/controllers.ts',
  'js/world/interiors.ts -> js/sim/bystanders.ts',
  'js/world/nightlife.ts -> js/audio/audio-ambience.ts',
  'js/world/nightlife.ts -> js/audio/audio-system.ts',
  'js/world/nightlife.ts -> js/player/controllers.ts',
  'js/world/nightlife.ts -> js/sim/bystanders.ts',
  'js/world/street-food.ts -> js/audio/audio-ambience.ts',
  'js/world/street-food.ts -> js/player/controllers.ts',
  'js/world/street-food.ts -> js/sim/bystanders.ts',
  'js/world/street-food.ts -> js/sim/crime.ts',
  // the street furniture & trees a car knocks down (sim/mayhem.ts)
  'js/world/street-details.ts -> js/sim/mayhem.ts',
  'js/world/trees.ts -> js/sim/mayhem.ts'
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const topOf = (path) => relative(js, path).split('/')[0];
const layerOf = (path) => LAYERS.findIndex((layer) => layer.includes(topOf(path)));

const goesUp = (file, target) => topOf(file) !== topOf(target) && layerOf(target) >= layerOf(file);

// Every relative import and re-export, static or dynamic, type-only or not, of every module of js/
function readImports() {
  const found = [];
  for (const file of walk(js)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /^\s*(?:import|export)\s[^'";]*?\bfrom\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]/gm;
    for (const match of source.matchAll(pattern)) {
      const target = resolve(dirname(file), match[1] ?? match[2] ?? match[3]);
      if (target.startsWith(js + '/')) found.push({ file, target, edge: `${relative(root, file)} -> ${relative(root, target)}` });
    }
  }
  return found;
}
const imports = readImports();

test('every folder of js/ is in a layer, and every layer names folders that exist', () => {
  const tops = new Set(walk(js).map(topOf));
  for (const top of tops) assert.ok(layerOf(join(js, top)) >= 0, `js/${top} has no layer: put it in LAYERS where it belongs`);
  for (const name of LAYERS.flat()) assert.ok(tops.has(name), `LAYERS names js/${name}, which isn't there`);
});

test('modules import only from the layers below their own', () => {
  const up = imports.filter(({ file, target }) => goesUp(file, target)).map(({ edge }) => edge);
  const allowed = new Set(EXCEPTIONS);
  const added = [...new Set(up)].filter((edge) => !allowed.has(edge));
  assert.deepEqual(added, [], 'these imports go up the layers (LAYERS): hand the lower module what it needs, or move it');
});

test('the exceptions are all still there (one fixed leaves the list)', () => {
  const edges = new Set(imports.map(({ edge }) => edge));
  assert.equal(new Set(EXCEPTIONS).size, EXCEPTIONS.length, 'an exception listed twice');
  const gone = EXCEPTIONS.filter((edge) => !edges.has(edge));
  assert.deepEqual(gone, [], "these imports are gone: take them off EXCEPTIONS, so they can't come back");
  // ...and still going up: one a change of LAYERS made legal leaves the list too
  const legal = EXCEPTIONS.filter((edge) => {
    const [file, target] = edge.split(' -> ').map((path) => join(root, path));
    return !goesUp(file, target);
  });
  assert.deepEqual(legal, [], 'these imports no longer go up the layers: take them off EXCEPTIONS');
});
