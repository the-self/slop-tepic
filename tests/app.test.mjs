import assert from 'node:assert/strict';
import test from 'node:test';
import { Boarding } from '../js/app/boarding.ts';
import { playerStateKey, restorePlayer, savePlayer } from '../js/app/player-state.ts';

const at = (x, z) => ({ x, y: 0, z });

// A world with the player on foot at the origin: `own` their vehicle within reach, `taken` the traffic's, `tills` the
// stores' tills; every call to the systems is recorded
function world({ mode = 'person', own = null, taken = null, tills = [], inside = false, food = '', door = '', state = 'play' } = {}) {
  const calls = [];
  const crime = {
    state, money: 100,
    toast: (text) => calls.push(['toast', text]),
    // (whether the police saw it is crime's own to tell: report's default)
    report: (...args) => calls.push(['report', ...args])
  };
  const controllers = {
    activeMode: mode,
    entities: { person: { position: at(0, 0), ragdoll: null }, helicopter: { position: { x: 0, y: 10, z: 0 } } },
    ownVehicleNear: () => own,
    exitVehicle: () => { calls.push(['exit']); return true; },
    leaveCarBehind: () => calls.push(['leaveCarBehind']),
    enterVehicle: (...args) => calls.push(['enter', ...args]),
    takeLeftCar: (left) => calls.push(['takeLeftCar', left]),
    getGroundHeight: () => 0
  };
  const traffic = {
    vehicleNear: () => taken,
    hijack: (v) => ({ kind: v.bike ? 'cyclist' : 'car', police: Boolean(v.isPolice) }),
    panic: (...args) => calls.push(['panic', ...args])
  };
  const interiors = { active: inside, act: () => calls.push(['act']), prompt: () => door };
  const streetFood = { buy: () => (food ? (calls.push(['buy']), true) : false), prompt: () => food };
  const boarding = new Boarding({
    controllers, traffic, crime, tills, interiors, streetFood, mapOpen: () => false, onModeChange: () => calls.push(['sync'])
  });
  return { boarding, calls, crime };
}

test('F on foot takes the traffic vehicle within reach: a patrol car is always a crime, any other one if the police see it', () => {
  const patrol = world({ taken: { isPolice: true } });
  assert.equal(patrol.boarding.prompt(), 'Robar la patrulla');
  patrol.boarding.board();
  assert.deepEqual(patrol.calls, [['leaveCarBehind'], ['enter', 'car', { kind: 'car', police: true }], ['report', 'stealCop', true], ['sync']]);

  const bike = world({ taken: { bike: true } });
  assert.equal(bike.boarding.prompt(), 'Robar la bici');
  bike.boarding.board();
  assert.deepEqual(bike.calls, [['enter', 'cyclist', { kind: 'cyclist', police: false }], ['report', 'carjack'], ['sync']]);
});

test('F gets into the player\'s own vehicle, or the car they left in the street', () => {
  const own = world({ own: { mode: 'moto', distance: 1 } });
  assert.equal(own.boarding.prompt(), 'Subir a la moto');
  own.boarding.board();
  assert.deepEqual(own.calls, [['enter', 'moto'], ['sync']]);
  const left = { id: 'left' };
  const parked = world({ own: { mode: 'car', distance: 1, left } });
  parked.boarding.board();
  assert.deepEqual(parked.calls, [['takeLeftCar', left], ['sync']]);
});

test('a store\'s till pays out once, raises the alarm, then stays empty for ten minutes', () => {
  const till = { x: 1, z: 0, refill: 0, store: { name: 'Ley' } };
  const { boarding, calls, crime } = world({ tills: [till] });
  assert.equal(boarding.prompt(), 'Asaltar la caja');
  boarding.board();
  assert.ok(crime.money > 100 + 399 && crime.money < 100 + 1501, `took ${crime.money - 100}`);
  assert.deepEqual(calls.slice(1), [['report', 'robbery', true], ['panic', 1, 0, 45]]);
  assert.ok(till.refill - performance.now() / 1000 > 599);
  calls.length = 0;
  boarding.board();
  assert.deepEqual(calls, [['toast', 'The till is empty']]);
});

test('with nothing to board, F buys at a stand or goes through a door; in a vehicle it gets out', () => {
  const stand = world({ food: 'Comprar tacos', door: 'Entrar' });
  assert.equal(stand.boarding.prompt(), 'Comprar tacos');
  stand.boarding.board();
  assert.deepEqual(stand.calls, [['buy']]);
  const door = world({ door: 'Entrar' });
  assert.equal(door.boarding.prompt(), 'Entrar');
  door.boarding.board();
  assert.deepEqual(door.calls, [['act']]);
  const driving = world({ mode: 'car' });
  assert.equal(driving.boarding.prompt(), '');
  driving.boarding.board();
  assert.deepEqual(driving.calls, [['exit'], ['sync']]);
  const wasted = world({ taken: {}, state: 'wasted' });
  wasted.boarding.board();
  assert.deepEqual(wasted.calls, [], 'nothing while wasted or busted');
});

test('the saved player comes back where each vehicle was, with its looks and money; on foot outside the room\'s door', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const modes = ['person', 'car', 'cyclist', 'helicopter', 'moto'];
  const entity = (x) => ({ position: { x, y: 1, z: -x }, heading: 0.5 });
  const looks = { car: { bodyType: 'taxi', paint: 0xffbe14, police: false, model: 'nissan-tsuru', route: null }, cyclist: { color: 255 }, moto: { model: 'italika-ft150', paint: 3 } };
  const saving = { activeMode: 'car', entities: Object.fromEntries(modes.map((m, i) => [m, { ...entity(i * 10), look: looks[m] }])) };
  const key = playerStateKey('Tepic');
  assert.equal(key, 'tepic-player-state');
  savePlayer(saving, key, 1234, { x: 5, z: 5, nx: 1, nz: 0, heading: 2 });

  const calls = [];
  const restoring = {
    setMode: (m) => calls.push(['mode', m]),
    teleportActiveTo: (...args) => calls.push(['at', ...args]),
    setCarLook: (...args) => calls.push(['car', ...args]),
    setBikeColor: (c) => calls.push(['bike', c]),
    setMotoLook: (...args) => calls.push(['moto', ...args])
  };
  const restored = restorePlayer(restoring, key);
  assert.deepEqual(restored, { mode: 'car', money: 1234 });
  assert.deepEqual(calls.slice(0, 2), [['mode', 'person'], ['at', 6.2, 5, 2, 0]], 'on foot just outside the door');
  assert.deepEqual(calls.slice(2, 4), [['mode', 'car'], ['at', 10, -10, 0.5, 1]]);
  assert.deepEqual(calls.slice(-3), [['car', 'taxi', 0xffbe14, false, 'nissan-tsuru', null], ['bike', 255], ['moto', 'italika-ft150', 3]]);

  store.set(key, '{"version":0}');
  assert.deepEqual(restorePlayer(restoring, key), { mode: null, money: undefined }, 'another version is ignored');
  store.set(key, 'not json');
  assert.deepEqual(restorePlayer(restoring, key), { mode: null, money: undefined }, 'and so is a broken one');
  delete globalThis.localStorage;
});
