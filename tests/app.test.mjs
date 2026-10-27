import assert from 'node:assert/strict';
import test from 'node:test';
import { Boarding } from '../js/app/boarding.ts';
import { playerStateKey, restorePlayer, savePlayer } from '../js/app/player-state.ts';
import { setLocale, t } from '../js/i18n/i18n.ts';

setLocale('es'); // (the prompts below in Spanish, whatever language Node says it speaks)

const at = (x, z) => ({ x, y: 0, z });

// A world with the player on foot at the origin: `own` their vehicle within reach, `taken` the traffic's, `parked` a car
// park's, `tills` the stores' tills; every call to the systems is recorded
// (`taken` and `parked` are `near` m from the player: the nearest within reach is the one taken)
function world({ mode = 'person', own = null, taken = null, parked = null, near = { taken: 1, parked: 1 }, tills = [], inside = false, food = '', door = '', state = 'play' } = {}) {
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
    leaveVehicle: () => { calls.push(['exit']); return true; },
    leaveCarBehind: () => calls.push(['leaveCarBehind']),
    enterVehicle: (...args) => calls.push(['enter', ...args]),
    takeLeftCar: (left) => calls.push(['takeLeftCar', left]),
    getGroundHeight: () => 0
  };
  const traffic = {
    vehicleNear: (x, z, reach) => (taken && near.taken < reach ? taken : null),
    hijack: (v) => ({ kind: v.bike ? 'cyclist' : 'car', police: Boolean(v.isPolice) }),
    panic: (...args) => calls.push(['panic', ...args])
  };
  const carParks = {
    carNear: (x, z, reach) => (parked && near.parked < reach ? { car: parked, distance: near.parked } : null),
    take: (car) => { calls.push(['take', car]); return { x: 1, y: 0.2, z: 2, heading: 3, bodyType: 'sedan', model: 'nissan-tsuru', paint: 0xff0000 }; }
  };
  const interiors = { active: inside, act: () => calls.push(['act']), prompt: () => door };
  const streetFood = { buy: () => (food ? (calls.push(['buy']), true) : false), prompt: () => food };
  const boarding = new Boarding({
    controllers, traffic, carParks, crime, tills, interiors, streetFood, mapOpen: () => false, onModeChange: () => calls.push(['sync'])
  });
  return { boarding, calls, crime };
}

test('F on foot takes the traffic vehicle within reach: a patrol car is always a crime, any other one if the police see it', () => {
  const patrol = world({ taken: { isPolice: true } });
  assert.equal(patrol.boarding.prompt(), 'Robar la patrulla');
  assert.equal(patrol.boarding.promptAction, 'steal'); // (the touch button's word)
  patrol.boarding.board();
  assert.deepEqual(patrol.calls, [['leaveCarBehind'], ['enter', 'car', { kind: 'car', police: true }], ['report', 'stealCop', true], ['sync']]);

  const bike = world({ taken: { bike: true } });
  assert.equal(bike.boarding.prompt(), 'Robar la bici');
  bike.boarding.board();
  assert.deepEqual(bike.calls, [['enter', 'cyclist', { kind: 'cyclist', police: false }], ['report', 'carjack'], ['sync']]);
});

test('F on foot steals the car parked within reach: off its stall, the player\'s own car in its place', () => {
  const spot = { id: 'spot' };
  const { boarding, calls } = world({ parked: spot });
  assert.equal(boarding.prompt(), 'Robar el coche');
  boarding.board();
  assert.deepEqual(calls, [
    ['take', spot], ['leaveCarBehind'],
    ['enter', 'car', { kind: 'car', speed: 0, police: false, x: 1, y: 0.2, z: 2, heading: 3, bodyType: 'sedan', model: 'nissan-tsuru', paint: 0xff0000 }],
    ['report', 'carjack'], ['sync']
  ]);
  // (the nearer of the traffic's vehicle and the parked car, when both are within reach)
  assert.equal(world({ taken: { isPolice: true }, parked: spot, near: { taken: 1, parked: 0.3 } }).boarding.prompt(), 'Robar el coche');
  assert.equal(world({ taken: { isPolice: true }, parked: spot, near: { taken: 0.3, parked: 1 } }).boarding.prompt(), 'Robar la patrulla');
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
  assert.deepEqual(calls.slice(1), [['report', 'robbery', true], ['panic', 1, 0, 45, false]]); // (the people run; the drivers aren't frightened: no shot)
  assert.ok(till.refill - performance.now() / 1000 > 599);
  calls.length = 0;
  boarding.board();
  assert.deepEqual(calls, [['toast', 'La caja está vacía']]);
});

test('with nothing to board, F buys at a stand or goes through a door; in a vehicle it gets out', () => {
  const stand = world({ food: 'Comprar tacos', door: 'Entrar' });
  assert.equal(stand.boarding.prompt(), 'Comprar tacos');
  assert.equal(stand.boarding.promptAction, 'use');
  stand.boarding.board();
  assert.deepEqual(stand.calls, [['buy']]);
  const door = world({ door: 'Entrar' });
  assert.equal(door.boarding.prompt(), 'Entrar');
  door.boarding.board();
  assert.deepEqual(door.calls, [['act']]);
  const driving = world({ mode: 'car' });
  assert.equal(driving.boarding.prompt(), '');
  assert.equal(driving.boarding.promptAction, 'exit');
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

test('every language says the same prompts in its own words, and back again', () => {
  setLocale('en');
  assert.equal(world({ taken: { isPolice: true } }).boarding.prompt(), 'Steal the police car');
  assert.equal(t('prompt.buy', { item: 'tacos', price: 25 }), 'Buy tacos ($25)');
  setLocale('es');
  assert.equal(world({ taken: { isPolice: true } }).boarding.prompt(), 'Robar la patrulla');
  assert.equal(t('prompt.buy', { item: 'tacos', price: 25 }), 'Comprar tacos ($25)');
});
