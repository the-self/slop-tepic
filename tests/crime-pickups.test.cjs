const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { i18n } = require('./helpers/i18n.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
// three.js is only built into scratch objects there (dummy, zero, tint)
class Scratch { makeScale() { return this; } }
const THREE = { Object3D: Scratch, Matrix4: Scratch, Color: Scratch };
const constants = loadModule(read('js/sim/crime/constants.ts'), { imports: { 'three/webgpu': THREE, '../crime-rules.ts': {}, './types.ts': {} } });
const { dispatch } = loadModule(read('js/sim/crime/dispatch.ts'), {
  imports: { '../crime-rules.ts': { POLICE: { helicopter: [false] }, GANGS: [], NARCO: 2, gangTurf: () => -1 }, './constants.ts': constants, '../../i18n/i18n.ts': i18n }
});

// A crime system that only lays pickups: no stars, no turf, no thieves (no money), the bazooka in hand
function crimeWith(health, armor) {
  const drops = [];
  const crime = {
    state: 'play', wanted: { stars: 0 }, mode: 'person', px: 0, pz: 0, money: 0, health, armor, agents: [], cruisers: [], pickups: [],
    timers: { dispatch: 99, gangs: 99, trucks: 99, thief: 99, health: 0, bazooka: 99, patrols: 99, heli: 99 },
    heli: { active: false },
    arsenal: { has: () => true },
    traffic: { sidewalkSpot: () => ({ x: 4, z: 5 }) },
    drop: (kind, x, z, amount) => drops.push([kind, amount])
  };
  return { crime, drops };
}

test('a first-aid kit gives half a life back and a vest a whole armour', () => {
  assert.equal(constants.HEALTH_PICKUP, 50);
  assert.equal(constants.ARMOR_PICKUP, 100);
  const hurt = crimeWith(40, 100);
  dispatch(hurt.crime, 1);
  assert.deepEqual(hurt.drops, [['health', constants.HEALTH_PICKUP]], 'hurt: a first-aid kit');
  const bare = crimeWith(100, 0);
  dispatch(bare.crime, 1);
  assert.deepEqual(bare.drops, [['armor', constants.ARMOR_PICKUP]], 'unarmoured: a vest');
  const fine = crimeWith(100, 100);
  dispatch(fine.crime, 1);
  assert.deepEqual(fine.drops, [], 'neither when not needed');
});
