const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, LANDMARK_SITES, CITY, blockAt, nearestRoads, getIslandBoundsAtZ, getLocationLabel;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, LANDMARK_SITES, CITY, blockAt, nearestRoads, getIslandBoundsAtZ, getLocationLabel } = await import('../js/world/city-config.ts'));
});

test('every teleport button has a destination on a real roadway inside the city', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.equal(blockAt(point.x, point.z), null, `${name} lands outside building blocks`);
    const shore = getIslandBoundsAtZ(point.z);
    assert.ok(point.x > shore.westX + 8 && point.x < shore.eastX - 8, `${name} stays on the island`);
    const nearby = nearestRoads(point.x, point.z, 20);
    assert.ok(nearby.some(({ road, dist }) => dist < road.w / 2), `${name} lands within a street's width`);
  }
});

test('the city starts at the Plaza Principal, on a street, facing the Catedral', () => {
  const start = CITY.start;
  assert.ok(Number.isFinite(start.x) && Number.isFinite(start.z) && Number.isFinite(start.heading));
  assert.deepEqual([start.x, start.z], [TELEPORT_LOCATIONS.plaza.x, TELEPORT_LOCATIONS.plaza.z]);
  assert.ok(Math.hypot(start.x, start.z) < 120, 'the plaza is the origin of the frame');
  assert.equal(blockAt(start.x, start.z), null);
  assert.ok(nearestRoads(start.x, start.z, 20).some(({ road, dist }) => dist < road.w / 2));
  assert.match(getLocationLabel(start.x, start.z), /Plaza Principal/);
  const catedral = LANDMARK_SITES.Catedral;
  assert.ok(catedral, 'the Catedral footprint is in the data');
  assert.ok(Math.hypot(catedral.x - start.x, catedral.z - start.z) < 260, 'the Catedral is next to the plaza');
});

test('preset and map teleports share arrival resets and leave no GPS waypoint', async () => {
  const { createTeleport, wireTeleportButtons } = await import('../js/app/teleport.ts');
  const handlers = new Map();
  const calls = [];
  const landed = { x: -57.8, z: 35.2 };
  let room = null; // (on the street: no room to leave, world/interiors.ts)
  const teleportTo = createTeleport({
    controllers: { teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; } },
    touch: { reset: () => calls.push(['touch']) },
    gamepad: { reset: () => calls.push(['gamepad']) },
    cameras: { resetForTeleport: () => calls.push(['camera']) },
    room: () => room,
    selectCamera: (...args) => calls.push(['selectCamera', ...args])
  });
  const buttons = Object.keys(TELEPORT_LOCATIONS).map((key) => ({
    getAttribute: () => key,
    addEventListener: (_event, handler) => handlers.set(key, handler)
  }));
  let closed = 0;
  wireTeleportButtons(buttons, TELEPORT_LOCATIONS, teleportTo, () => { closed++; });
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    calls.length = 0;
    handlers.get(name)();
    assert.deepEqual(calls, [
      ['teleport', point.x, point.z, point.heading], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]
    ]);
  }
  assert.equal(closed, Object.keys(TELEPORT_LOCATIONS).length, 'each button closes the menu');
  // the full map's teleport (CityMapSystem onTeleport): the default heading, and the safe spot the controller found
  calls.length = 0;
  assert.deepEqual(teleportTo(100, 200), landed, 'map teleports return the safe position from the controller');
  assert.deepEqual(calls, [['teleport', 100, 200, Math.PI], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]]);
  // from inside a room, the player leaves it first
  calls.length = 0;
  room = { abandon: () => calls.push(['abandon']) };
  teleportTo(1, 2, 0);
  assert.deepEqual(calls[0], ['abandon']);
});
