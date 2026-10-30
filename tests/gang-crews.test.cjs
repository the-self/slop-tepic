const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');
const { i18n } = require('./helpers/i18n.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
class Scratch { makeScale() { return this; } }
const THREE = { Object3D: Scratch, Matrix4: Scratch, Color: Scratch };
const constants = loadModule(read('js/sim/crime/constants.ts'), { imports: { 'three/webgpu': THREE, '../crime-rules.ts': {}, './types.ts': {} } });
const GANGS = [
  { name: 'Los Rojos', weapon: 'smg', narco: false },
  { name: 'Los Verdes', weapon: 'shotgun', narco: false },
  { name: 'Cártel de la Sierra', weapon: 'rifle', narco: true }
];
// One colonia, Los Rojos', west of x = 500 (the rest nobody's), its one corner 100 m east of the origin
const corner = { id: 0, x: 100, z: 0, colonia: 0 };
const turf = {
  colonias: [{ name: 'La Loma', x: 0, z: 0, gang: 0, corners: [corner] }],
  coloniaAt: (x) => (x < 500 ? 0 : -1),
  cornersNear: (x, z, r, out) => {
    out.length = 0;
    if (Math.hypot(corner.x - x, corner.z - z) <= r) out.push(corner);
    return out;
  }
};
const { dispatch } = loadModule(read('js/sim/crime/dispatch.ts'), {
  imports: { '../crime-rules.ts': { POLICE: { helicopter: [false] }, GANGS, NARCO: 2 }, '../gang-turf.ts': { townTurf: () => turf }, './constants.ts': constants, '../../i18n/i18n.ts': i18n }
});

// A crime system with nothing but the gangs to dispatch: no stars, no thieves, no pickups
function crimeAt(px, pz, { inView = false, solid = () => false } = {}) {
  const toasts = [];
  const crime = {
    state: 'play', wanted: { stars: 0 }, mode: 'person', px, pz, money: 0, health: 100, armor: 100, agents: [], cruisers: [], pickups: [],
    timers: { dispatch: 1e9, gangs: 0, trucks: 1e9, thief: 1e9, health: 1e9, bazooka: 1e9, patrols: 1e9, heli: 1e9, gangCall: 1e9 },
    heli: { active: false }, arsenal: { has: () => true }, seen: false, huntX: px, huntZ: pz, clock: 0,
    cornerQuiet: new Map(), lastTurf: -1, lastTurfAt: -Infinity,
    traffic: { sidewalkSpot: () => null, inView: () => inView },
    solidAt: solid,
    toast: (text) => toasts.push(text),
    spawnAgent: (kind, x, z, opts) => {
      const a = { kind, x, z, dead: false, gang: opts.gang, weapon: opts.weapon, corner: opts.corner, homeX: x, homeZ: z, idleYaw: 0 };
      crime.agents.push(a);
      return a;
    }
  };
  return { crime, toasts };
}
const tick = (crime, s = 2) => {
  crime.clock += s;
  dispatch(crime, s);
};

test('a crew comes out on its corner when the player comes by, not twice', () => {
  const { crime, toasts } = crimeAt(0, 0);
  tick(crime);
  assert.ok(crime.agents.length >= 3 && crime.agents.length <= 4, `${crime.agents.length} on the corner`);
  for (const a of crime.agents) {
    assert.equal(a.gang, 0);
    assert.equal(a.corner, 0);
    assert.ok(Math.hypot(a.homeX - 100, a.homeZ) < 0.01, 'all of them about the corner');
  }
  assert.equal(toasts.length, 1, 'told of the turf');
  const n = crime.agents.length;
  tick(crime);
  assert.equal(crime.agents.length, n, 'a corner with its crew gets no other');
});

test('no crew comes out of thin air before the player\'s eyes', () => {
  const close = crimeAt(80, 0);
  tick(close.crime);
  assert.equal(close.crime.agents.length, 0, 'not 20 m off');
  const seen = crimeAt(0, 0, { inView: true });
  tick(seen.crime);
  assert.equal(seen.crime.agents.length, 0, 'not in view 100 m off');
  const far = crimeAt(-30, 0, { inView: true });
  tick(far.crime);
  assert.ok(far.crime.agents.length > 0, 'in view but far off: they do');
});

test('a corner on a wall\'s footing keeps its crew a step off it, the same step every time', () => {
  const wall = (x, z) => Math.hypot(x - 100, z) < 2;
  const a = crimeAt(0, 0, { solid: wall });
  tick(a.crime);
  assert.ok(a.crime.agents.length > 0);
  const home = [a.crime.agents[0].homeX, a.crime.agents[0].homeZ];
  assert.ok(!wall(...home), 'off the wall');
  assert.ok(Math.hypot(home[0] - 100, home[1]) <= 6, 'near its corner');
  const b = crimeAt(0, 0, { solid: wall });
  tick(b.crime);
  assert.deepEqual([b.crime.agents[0].homeX, b.crime.agents[0].homeZ], home);
  const walled = crimeAt(0, 0, { solid: () => true });
  tick(walled.crime);
  assert.equal(walled.crime.agents.length, 0, 'no clear ground: no crew');
});

test('the crews keep to the cap, and a corner whose crew was killed stays quiet', () => {
  const { crime } = crimeAt(0, 0);
  for (let i = 0; i < 10; i++) crime.agents.push({ kind: 'gang', dead: false, corner: -1 });
  tick(crime);
  assert.equal(crime.agents.length, 10, 'a crew would take them past 12');
  const quiet = crimeAt(0, 0).crime;
  quiet.cornerQuiet.set(0, 300);
  tick(quiet);
  assert.equal(quiet.agents.length, 0, 'quiet till its time is up');
  quiet.clock = 300;
  tick(quiet);
  assert.ok(quiet.agents.length > 0, 'then a new crew');
});

test('the turf is told once on coming in, not along its edge, nor from the helicopter', () => {
  const { crime, toasts } = crimeAt(-400, 0);
  tick(crime);
  assert.equal(toasts.length, 1);
  crime.px = 600; // out, and straight back in
  tick(crime);
  crime.px = 400;
  tick(crime);
  assert.equal(toasts.length, 1, 'not again along its edge');
  crime.px = 600;
  tick(crime, 200);
  crime.px = 400;
  tick(crime);
  assert.equal(toasts.length, 2, 'again after a while away');
  const heli = crimeAt(-400, 0);
  heli.crime.mode = 'helicopter';
  tick(heli.crime);
  assert.equal(heli.toasts.length, 0, 'not from the air');
  assert.equal(heli.crime.agents.length, 0, 'and no crew for it');
});
