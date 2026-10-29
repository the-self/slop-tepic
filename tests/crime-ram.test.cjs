const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule, stripTypes } = require('./helpers/module.cjs');

// crime/player.ts's rammed, its imports stubbed (three.js only builds scratch objects there)
const source = readFileSync(join(__dirname, '../js/sim/crime/player.ts'), 'utf8');
const imports = {};
for (const [, specifier] of stripTypes(source).matchAll(/^import\s[^;]*?\sfrom\s+'([^']+)';/gm)) imports[specifier] = {};
class Scratch {}
imports['three/webgpu'] = { Quaternion: Scratch, Vector3: Scratch };
const { rammed } = loadModule(source, { imports });

// The player driving east at `speed` m/s into a patrol car standing (or driving at `theirs` m/s west) just east of it:
// the normal points from the patrol car towards the player, west
function crash({ speed = 10, theirs = 0, police = true, chase = true } = {}) {
  const reports = [];
  const cruiser = { active: true, wreck: 0, faction: police ? 'police' : 'narco', heading: -Math.PI / 2, speed: theirs, vx: 0, vz: 0 };
  const patrol = { isPolice: true, burnt: false, tx: -1, tz: 0, speed: theirs, vx: 0, vz: 0 };
  const crime = {
    pvx: speed, pvz: 0, clock: 10, lastRam: -Infinity, cruisers: [cruiser], trafficPolice: [patrol],
    report: (kind, seen) => reports.push([kind, seen])
  };
  return { crime, reports, other: chase ? cruiser : patrol };
}

test('driving into a patrol car, of the chase or of the traffic, is a crime against the police, seen by them', () => {
  for (const chase of [true, false]) {
    const { crime, reports, other } = crash({ chase });
    rammed(crime, other, -1, 0);
    assert.deepEqual(reports, [['ramCop', true]]);
  }
});

test('not a bump, not a patrol car driving into the player, not another car, and one crash counts once', () => {
  const slow = crash({ speed: 2 });
  rammed(slow.crime, slow.other, -1, 0);
  assert.equal(slow.reports.length, 0, 'a bump while parking');
  const rammedBy = crash({ speed: 4, theirs: 12 });
  rammed(rammedBy.crime, rammedBy.other, -1, 0);
  assert.equal(rammedBy.reports.length, 0, 'the patrol car came at the player faster');
  const cartel = crash({ police: false });
  rammed(cartel.crime, cartel.other, -1, 0);
  assert.equal(cartel.reports.length, 0, "the cartel's truck: no police");
  const { crime, reports, other } = crash();
  rammed(crime, {}, -1, 0);
  assert.equal(reports.length, 0, 'any other car');
  rammed(crime, other, -1, 0);
  crime.clock += 0.2;
  rammed(crime, other, -1, 0);
  assert.equal(reports.length, 1, 'its contact lasting a few steps');
  crime.clock += 2;
  rammed(crime, other, -1, 0);
  assert.equal(reports.length, 2, 'a second crash, a while later');
});
