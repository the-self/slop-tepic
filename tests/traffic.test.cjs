const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { loadModule, stripTypes } = require('./helpers/module.cjs');

// A part of the traffic (js/sim/traffic/<name>.ts), its imports stubbed: those given, an empty namespace for the rest
function trafficModule(name, imports = {}, globals = {}) {
  const source = readFileSync(join(__dirname, `../js/sim/traffic/${name}.ts`), 'utf8');
  const stubs = {};
  for (const [, specifier] of stripTypes(source).matchAll(/^import\s[^;]*?\sfrom\s+'([^']+)';/gm)) stubs[specifier] = imports[specifier] ?? {};
  return loadModule(source, { imports: stubs, globals });
}
const constants = trafficModule('constants');

// Exercise the production lane query and player snapshot without creating the WebGPU scene.
const { playerInLane, highwayPlayer: snapshot } = trafficModule('highway');

// The player-vs-vehicle box test, also used for cyclists and motorcyclists over their whole bike (contactRider)
const { overlapWithPlayer } = trafficModule('overlap');

function lane(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return {
    pts: points,
    cum,
    box: [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)),
      Math.min(...points.map((p) => p.z)), Math.max(...points.map((p) => p.z))]
  };
}

function player(x, y, z, mode = 'car') {
  return snapshot({ position: { x, y, z }, heading: Math.PI / 2, speed: 10 }, mode);
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('street traffic recognizes players on its own road, including sidewalk height', () => {
  const road = lane([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }]);
  for (const y of [0, 0.22]) {
    const result = playerInLane(road, player(50, y, 0));
    close(result.u, 50);
    close(result.v, 10);
  }
  assert.equal(playerInLane(road, player(50, 7.6, 0)), null);
  assert.equal(playerInLane(road, player(50, 0, 2.1)), null);
});

test('viaduct traffic ignores players below it and recognizes players at deck height', () => {
  const road = lane([{ x: 0, y: 7.6, z: 0 }, { x: 100, y: 7.6, z: 0 }]);
  assert.equal(playerInLane(road, player(50, 0, 0)), null);
  const result = playerInLane(road, player(50, 7.6, 0));
  close(result.u, 50);
  close(result.v, 10);
});

test('sloped lanes use horizontal projection and compare interpolated road height', () => {
  const road = lane([{ x: 0, y: 0, z: 0 }, { x: 100, y: 7.6, z: 0 }]);
  for (const t of [0, 0.5, 1]) {
    const result = playerInLane(road, player(100 * t, 7.6 * t, 0));
    close(result.u, road.cum[1] * t);
    close(result.v, road.cum[1] / 10);
  }
  assert.equal(playerInLane(road, player(50, 0, 0)), null);
  assert.equal(playerInLane(road, player(100.1, 7.6, 0)), null);
  assert.equal(playerInLane(road, player(50, 3.8, 2.001)), null);
});

test('overlapping road segments select the matching elevation', () => {
  const road = lane([{ x: 0, y: 7.6, z: 0 }, { x: 100, y: 7.6, z: 0 },
    { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);
  const result = playerInLane(road, player(50, 0, 0));
  close(result.u, 157.6);
  close(result.v, 0);
});

test('underground lanes and helicopters remain excluded', () => {
  const road = lane([{ x: 0, y: -4.5, z: 0 }, { x: 100, y: -4.5, z: 0 }]);
  assert.equal(playerInLane(road, player(50, -4.5, 0)), null);
  assert.equal(player(50, 0, 0, 'helicopter'), null);
  assert.equal(snapshot(null, 'car'), null);
});

function intersectionHarness() {
  const n = { signal: true, in: [] };
  const exit = { lanes: [0], outSide: 1 };
  const edge = { to: n, axisIndex: 0, occ: [[]], opposite: null, inSide: 0, len: 100 };
  const car = { edge, move: { to: exit, out: [0], turn: 'S' }, lane: 0, s: 80, speed: 4,
    driver: { b: 3 }, half: 2.25, wait: 0, commit: null, onCall: false };
  const state = { phase: 'red', occupied: false, pedestrians: false, space: true, conflict: false };
  const ts = { connector: () => ({ len: 20 }) };
  const junctions = trafficModule('junctions', {
    './constants.ts': constants,
    './signals.ts': { phaseOf: () => state.phase, runsRed: (v) => v.onCall === true || v.sirenNear === true },
    './idm.ts': { canStopBefore: () => true, stopAt: () => -3, timeTo: () => 1 },
    './occupancy.ts': { boxBusy: () => state.occupied, ahead: () => null, laneCoord: () => 0 },
    './right-of-way.ts': {
      yieldToCrossTraffic: () => state.conflict,
      pedestrianOn: () => state.pedestrians,
      room: () => state.space,
      alongside: () => false,
      mergingAhead: () => null
    }
  });
  return {
    car, state,
    mayEnter: (v, d) => junctions.mayEnter(ts, v, d),
    signalAhead: (v, f, d) => junctions.signalAhead(ts, v, f, d)
  };
}

test('a car pulled over for a siren behind edges through a red, giving way to the cross traffic as police do', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  state.phase = 'red';
  car.sirenNear = true;
  assert.equal(signalAhead(car, car.edge, 18), 0);
  assert.equal(mayEnter(car, 18), true);
  state.conflict = true;
  assert.equal(mayEnter(car, 18), false);
  car.sirenNear = false;
  state.conflict = false;
  assert.equal(mayEnter(car, 18), false);
});

test('police on a call pass red and amber signals while ordinary cars stop', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  for (const phase of ['red', 'amber']) {
    state.phase = phase;
    car.onCall = false;
    assert.equal(mayEnter(car, 18), false);
    assert.equal(signalAhead(car, car.edge, 18), -3);
    car.onCall = true;
    assert.equal(mayEnter(car, 18), true);
    assert.equal(signalAhead(car, car.edge, 18), 0);
  }
});

test('a patrol car goes through the reds only on a call, lights & siren on: going about its round it waits', () => {
  const { runsRed } = trafficModule('signals');
  const { setPoliceAlert } = trafficModule('hooks');
  const patrol = { isPolice: true, onCall: false, sirenNear: false, fright: null };
  const taxi = { isPolice: false, onCall: false, sirenNear: false, fright: null };
  const ts = { policeAlert: false, cars: [patrol, taxi] };
  assert.equal(runsRed(patrol), false, 'no call on: it stops at the red');
  setPoliceAlert(ts, true);
  assert.equal(patrol.onCall, true);
  assert.equal(taxi.onCall, false, 'only the police');
  assert.equal(runsRed(patrol), true);
  setPoliceAlert(ts, false);
  assert.equal(runsRed(patrol), false, 'called off: its lights off again, it waits');
});

test('police still wait for crossing traffic, pedestrians and a blocked exit', () => {
  const { car, state, mayEnter } = intersectionHarness();
  car.onCall = true;
  for (const [key, blocked] of [['occupied', true], ['pedestrians', true], ['space', false], ['conflict', true]]) {
    const initial = state[key];
    state[key] = blocked;
    assert.equal(mayEnter(car, 18), false, key);
    state[key] = initial;
  }
  assert.equal(mayEnter(car, 18), true);
});

test('at a signal of more than two roads, the third gives way to the second on their shared green', () => {
  const { car, state, mayEnter } = intersectionHarness();
  state.phase = 'green';
  state.conflict = true;
  car.edge.axisIndex = 1;
  assert.equal(mayEnter(car, 18), true);
  car.edge.axisIndex = 2;
  assert.equal(mayEnter(car, 18), false);
  state.conflict = false;
  assert.equal(mayEnter(car, 18), true);
});

test('police running a red yield to fast cross traffic regardless of how long they waited', () => {
  const car = { edge: { axisIndex: 0 }, wait: 20 };
  const lead = { s: 85, v: { speed: 10 } };
  const side = { axisIndex: 1, occ: [[lead]], len: 100 };
  const node = { signal: true, in: [{ axisIndex: 0, occ: [[lead]] }, side] };
  const rightOfWay = trafficModule('right-of-way', {
    './occupancy.ts': { leadOf: (list) => list.at(-1) },
    './idm.ts': { canStopBefore: () => true }
  });
  lead.v.half = 2.25;
  const yieldToCrossTraffic = (v, at) => rightOfWay.yieldToCrossTraffic({}, v, at);
  assert.equal(yieldToCrossTraffic(car, node), true);
  lead.v.speed = 0;
  assert.equal(yieldToCrossTraffic(car, node), false);
  lead.v.speed = 10;
  lead.s = 10;
  assert.equal(yieldToCrossTraffic(car, node), false);
});

test('left turns account for oncoming police on a call even when their signal is red', () => {
  const edge = { to: { signal: true }, through: 0, len: 100, occ: [] };
  const car = { edge, move: { turn: 'S', out: [0] }, lane: 0, speed: 10, half: 2.25, onCall: false };
  edge.occ.push([{ v: car, s: 85 }]);
  const rightOfWay = trafficModule('right-of-way', {
    './signals.ts': { phaseOf: () => 'red', runsRed: (v) => v.onCall === true || v.sirenNear === true },
    './occupancy.ts': { leadOf: (list) => list.at(-1) }
  });
  const yieldOncoming = (o, impatient) => rightOfWay.yieldOncoming({}, o, impatient);
  assert.equal(yieldOncoming(edge, false), false);
  car.onCall = true;
  assert.equal(yieldOncoming(edge, false), true);
  car.speed = 0;
  assert.equal(yieldOncoming(edge, false), false);
});

// The traffic's state round the focus (ts), as spawning.ts and near.ts read it, with the stubs of the parts they call:
// a test changes ts.visible, ts.sidewalkTrack or ts.crosswalkTrack to steer them
function populationContext() {
  const ts = {
    hasView: true, camX: 0, camY: 10, camZ: 0, visible: () => true,
    focusX: 0, focusZ: 0, player: { active: false },
    clock: 0, hour: 14,
    nearEdges: [], nearTransitEdges: [], nearSignals: [], track: {},
    transit: { paths: [] }, vehicles: [], wallAt: null, parkAt: () => false,
    // (the hour's weighing, traffic-demand.js: uniform here, unless a test sets carDensity)
    nearCarWeights: [], nearBikeWeights: [], nearPedWeights: [], carDensity: 0,
    sidewalkTrack: () => false, crosswalkTrack: () => false
  };
  const globals = { Math: Object.assign(Object.create(Math), { random: () => 0.5 }) };
  const near = trafficModule('near', {
    './constants.ts': constants,
    '../traffic-demand.ts': {
      AVENUE: 2, roadClass: (e) => (e.axis === 'ave' ? 2 : 0), carDensity: () => ts.carDensity, peopleDensity: () => 0, busyFactor: () => 1
    }
  }, globals);
  const spawning = trafficModule('spawning', {
    './constants.ts': constants,
    './surface.ts': { hillAt: () => 0 },
    './view.ts': { visible: (...args) => ts.visible(...args) },
    './near.ts': { pickWeighted: (list, weights) => near.pickWeighted(list, weights) },
    './occupancy.ts': { laneClear: () => true },
    './fleet.ts': { drawModel: () => {} },
    './bodies.ts': { vehicleAt: () => false },
    './motion.ts': { place: (_ts, v, e, lane, s) => Object.assign(v, { edge: e, lane, s }) },
    './sidewalks.ts': {
      KERB: 1.6, QUEUE_GAP: 0.62, atCurb: () => {},
      sidewalkTrack: (...args) => ts.sidewalkTrack(...args),
      crosswalkTrack: (...args) => ts.crosswalkTrack(...args)
    }
  }, globals);
  return {
    ts,
    spawnVehicle: (v, rMin, rMax, protectView) => spawning.spawnVehicle(ts, v, rMin, rMax, protectView),
    spawnPed: (p, rMin, rMax, protectView) => spawning.spawnPed(ts, p, rMin, rMax, protectView),
    refreshNear: () => near.refreshNear(ts)
  };
}

function straightEdge(z, len = 20) {
  return { sx: 0, sz: z, dx: 0, dz: 1, rx: -1, rz: 0, len, lanes: [0], occ: [[]] };
}

test('cars replenish the road ahead while nearby visible spawning stays blocked', () => {
  const { ts: context, spawnVehicle } = populationContext();
  const edge = straightEdge(140);
  context.nearEdges.push(edge);
  const car = { half: 2.25 };
  assert.equal(spawnVehicle(car, 100, 350, true), false);
  edge.sz = 290;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
  assert.equal(edge.sz + car.s, 300);
  edge.sz = 140;
  context.visible = () => false;
  assert.equal(spawnVehicle(car, 100, 350, true), true);
});

test('pedestrians replenish visible sidewalks ahead without appearing nearby', () => {
  const { ts: context, spawnPed } = populationContext();
  context.nearEdges.push(straightEdge(0));
  let z = 100;
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: z - 10, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const ped = { crossesStreets: false, speed: 1.4, rig: {} };
  assert.equal(spawnPed(ped, 60, 280, true), false);
  z = 220;
  assert.equal(spawnPed(ped, 60, 280, true), true);
  assert.equal(ped.z, 220);
  assert.equal(ped.v, ped.speed);
});

test('long roads are available near their ends and spawn only in the local section', () => {
  const { ts: context, refreshNear, spawnVehicle } = populationContext();
  const edge = straightEdge(100, 2000);
  Object.assign(context, { edges: [edge, straightEdge(2000)], nodes: [], nearX: Infinity, nearZ: Infinity });
  refreshNear();
  assert.deepEqual(context.nearEdges, [edge]);
  const car = { half: 2.25 };
  assert.equal(spawnVehicle(car, 0, 350, false), true);
  assert.ok(edge.sz + car.s <= 350);
  assert.ok(car.s >= car.half + 5);
});

test('cyclists are placed on the streets around, never on an avenue', () => {
  const { ts: context, refreshNear, spawnVehicle } = populationContext();
  const avenue = Object.assign(straightEdge(100, 400), { axis: 'ave', lanes: [0, 3.5], occ: [[], []] });
  const street = Object.assign(straightEdge(100, 400), { axis: 'st' });
  Object.assign(context, { edges: [avenue], nodes: [], nearX: Infinity, nearZ: Infinity, carDensity: 20 });
  refreshNear();
  const bike = { half: 0.9, bike: true };
  assert.equal(spawnVehicle(bike, 0, 350, false), false, 'nothing but an avenue around');
  const car = { half: 2.25 };
  assert.equal(spawnVehicle(car, 0, 350, false), true, 'a car goes on it');
  context.edges.push(street);
  context.nearX = Infinity;
  refreshNear();
  assert.equal(context.nearBikeWeights[0], 0, 'the avenue weighs nothing for a cyclist');
  for (let i = 0; i < 5; i++) {
    assert.equal(spawnVehicle(bike, 0, 350, false), true);
    assert.equal(bike.edge, street);
  }
});

test('a cyclist turns off an avenue where it can, and onto one only where the street leads nowhere else', () => {
  const globals = { Math: Object.assign(Object.create(Math), { random: () => 0.5 }) };
  const routing = trafficModule('routing', {
    '../traffic-demand.ts': { AVENUE: 2, ROUTE_PULL: [1, 2.5, 6], roadClass: (e) => (e.axis === 'ave' ? 2 : 0) }
  }, globals);
  const avenue = { axis: 'ave', lanes: [0] }, street = { axis: 'st', lanes: [0] };
  // on an avenue whose lane runs on along it: it changes lanes to turn off into the street
  const along = { axis: 'ave', len: 100, moves: [{ turn: 'S', to: avenue, out: [0] }, { turn: 'L', to: street, out: [-1] }] };
  const bike = { bike: true, edge: along, lane: 0, s: 50, path: null };
  assert.equal(routing.chooseMove({}, bike, true).to, street);
  // a car keeps to the avenue
  assert.equal(routing.chooseMove({}, { ...bike, bike: false }, true).to, avenue);
  // a street ending on an avenue (a T): onto it, there being no other way
  const tee = { axis: 'st', len: 100, moves: [{ turn: 'R', to: avenue, out: [0] }, { turn: 'L', to: avenue, out: [0] }] };
  assert.equal(routing.chooseMove({}, { ...bike, edge: tee }, true).to, avenue);
});

test('a bus whose route turns where the network has no turn goes round the block back onto it', () => {
  // the route east along z = 0 to x = 200, then left (north, -z) up x = 200; the junction at (200, 0) has no left turn
  const transit = loadModule(readFileSync(join(__dirname, '../js/sim/transit.ts'), 'utf8')).createTransit(
    { groups: [''], routes: [['Vuelta', 0, '#000', 'bus', 0, [[1, 2]]]] },
    { nodes: [0, 0, 200, 0, 200, -200], links: [[0, 1, 0, 8, 2, 0, []], [1, 2, 0, 8, 2, 0, []]], names: [''] });
  const routing = trafficModule('routing', {
    '../traffic-demand.ts': { AVENUE: 2, ROUTE_PULL: [1, 2.5, 6], roadClass: () => 1 }
  });
  let offPathCalls = 0; // (detourTo's search asks it of every road it reaches)
  const offPath = transit.offPath;
  transit.offPath = (...args) => { offPathCalls++; return offPath(...args); };
  const edges = [];
  const road = (sx, sz, ex, ez) => {
    const len = Math.hypot(ex - sx, ez - sz);
    const e = { id: edges.length, axis: 'st', sx, sz, dx: (ex - sx) / len, dz: (ez - sz) / len, len, lanes: [0], moves: [] };
    const on = transit.pathsAlong(sx, sz, ex, ez);
    e.transit = on.length ? on : null;
    edges.push(e);
    return e;
  };
  const move = (from, turn, to) => from.moves.push({ turn, to, out: [0] });
  const A = road(0, 0, 190, 0), B = road(210, 0, 290, 0), C = road(200, 10, 200, 90), D = road(200, -10, 200, -90);
  const E = road(300, -10, 300, -90), F = road(290, -100, 210, -100), G = road(200, -110, 200, -190);
  move(A, 'S', B); move(A, 'R', C); // (no left onto D)
  move(B, 'L', E); move(E, 'L', F); move(F, 'R', G); move(F, 'S', road(190, -100, 110, -100)); move(D, 'S', G);
  assert.ok(A.transit && D.transit && G.transit && !B.transit && !E.transit && !F.transit, 'A, D and G are on the route');
  const bus = { bus: true, edge: A, lane: 0, s: 100, path: transit.paths[0], pathS: 190, nextPathS: 190, lost: 0, detour: [], detourAt: 0, detourS: 0, move: null };
  const driven = [];
  for (let k = 0; k < 4; k++) {
    bus.move = routing.chooseMove({ transit }, bus, false);
    // choosing again from its lane before it leaves (junctions.ts mayEnter): the detour's same next road, not a search
    // for another way back (from its cursor before the detour)
    if (k === 0 || k === 3) {
      const searched = offPathCalls;
      assert.equal(routing.chooseMove({ transit }, bus, true), bus.move, `the same move again at ${k}`);
      assert.equal(offPathCalls, searched, `no new search at ${k}`);
    }
    driven.push(bus.move.to);
    bus.edge = bus.move.to;
    bus.pathS = bus.nextPathS; // (junctions.ts leave)
  }
  assert.deepEqual(driven.map((e) => e.id), [B, E, F, G].map((e) => e.id), 'straight on, left, left, right: round the block');
  assert.ok(Math.abs(bus.pathS - 390) < 1e-6, 'and on along the route from where G ends on it');
  assert.equal(bus.lost, 0);
  assert.equal(bus.detourAt, bus.detour.length, 'the detour done');
});

test('combis and buses spawn on the roads of routes their fleet serves, joining the route there', () => {
  const { ts: context, spawnVehicle } = populationContext();
  const shared = { fleet: '', routeIndex: 3, name: 'Insurgentes' };
  const busOnly = { fleet: 'bus', routeIndex: 5, name: 'Progreso 4' };
  const offRoute = straightEdge(100, 400);
  const onRoute = Object.assign(straightEdge(100, 400), { transit: [{ path: shared, s: 1250 }] });
  const busRoad = Object.assign(straightEdge(100, 400), { transit: [{ path: busOnly, s: 40 }] });
  context.nearEdges.push(offRoute, onRoute, busRoad);
  context.transit.paths.push(shared, busOnly);

  context.nearTransitEdges.push(onRoute);
  const combi = { half: 2.45, fleet: 'combi', path: null, detour: [] };
  assert.equal(spawnVehicle(combi, 0, 350, false), true);
  assert.equal(combi.edge, onRoute);
  assert.equal(combi.path, shared);
  assert.equal(combi.pathS, 1250, 'its cursor starts where the road ends on the route');
  assert.equal(combi.sign, 3);
  // ...and never within a headway of the last unit of its route: no convoys of one route
  Object.assign(combi, { x: 0, z: onRoute.sz + combi.s }); // (where it was placed: the stub doesn't locate it)
  context.vehicles.push(combi);
  const next = { half: 2.45, fleet: 'combi', path: null, detour: [] };
  assert.equal(spawnVehicle(next, 0, 350, false), false, 'the route already has a combi here');
  combi.x += 400;
  assert.equal(spawnVehicle(next, 0, 350, false), true);
  assert.equal(next.path, shared);
  context.vehicles.length = 0;

  context.nearTransitEdges.length = 0;
  context.nearTransitEdges.push(busRoad);
  const other = { half: 2.45, fleet: 'combi', path: null, detour: [] };
  assert.equal(spawnVehicle(other, 0, 350, false), false, 'a camión route takes no combis');

  const car = { half: 2.25, fleet: null };
  assert.equal(spawnVehicle(car, 0, 350, false), true);
  assert.equal(car.path, null, 'other traffic follows no route');
});

test('crossing pedestrians fall back to a sidewalk when nearby crosswalks are unusable', () => {
  const { ts: context, spawnPed } = populationContext();
  context.nearSignals.push({});
  context.nearEdges.push(straightEdge(200));
  let crossings = 0;
  context.crosswalkTrack = () => { crossings++; return false; };
  context.sidewalkTrack = () => {
    Object.assign(context.track, { ax: 0, az: 200, ux: 0, uz: 1, len: 20, node: null });
    return true;
  };
  const ped = { crossesStreets: true, speed: 1.4, rig: {} };
  assert.equal(spawnPed(ped, 60, 280, true), true);
  assert.equal(crossings, 5);
  assert.equal(ped.node, null);
  assert.equal(ped.z, 210);
});

test('a car hitting the end of a bicycle touches the bicycle, not just its middle', () => {
  // a bicycle at the origin riding +z (1.9 m long, 0.64 m wide); the player's car (heading +x) noses into its rear
  // wheel, 0.8 m behind its centre, where a pedestrian-sized circle round the bike's middle would miss it
  const hit = overlapWithPlayer(-2.4, -0.8, 0, 0.32, 0.95, Math.PI / 2, 0.86, 2.18);
  assert.ok(hit, 'the car overlaps the bike');
  assert.ok(hit.nx < -0.9, 'and is pushed back the way it came');
  assert.equal(overlapWithPlayer(-2.4, -2.0, 0, 0.32, 0.95, Math.PI / 2, 0.86, 2.18), null, 'behind the bike it misses');
});

test('vehicles pitch with the ground between their axles', () => {
  // the ground rising 0.1 m per metre north (-z)
  const motion = trafficModule('motion', { './surface.ts': { hillAt: (_ts, x, z) => 50 - 0.1 * z, roadLift: () => 0 } });
  const groundPitch = (v) => motion.groundPitch({}, v);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should equal ${b}`);
  close(groundPitch({ x: 0, z: 0, tx: 0, tz: -1, axle: 1.4 }), -Math.atan(0.1)); // heading uphill: nose up
  close(groundPitch({ x: 0, z: 0, tx: 0, tz: 1, axle: 1.4 }), Math.atan(0.1)); // downhill: nose down
  close(groundPitch({ x: 0, z: 0, tx: 1, tz: 0 }), 0); // across the slope
});

test('a vehicle on a ramp pitches with the deck as well as the ground', () => {
  // flat ground, a ramp rising 0.07 m per metre ahead (+z)
  const motion = trafficModule('motion', { './surface.ts': { hillAt: () => 0, roadLift: (v, x, z) => 0.07 * z } });
  const groundPitch = (v) => motion.groundPitch({}, v);
  assert.ok(Math.abs(groundPitch({ x: 0, z: 10, tx: 0, tz: 1, axle: 1.4 }) + Math.atan(0.07)) < 1e-9);
});

test('an edge carries its lift profile: interpolated along it, held past its ends, 0 without one', () => {
  const { edgeLift } = loadModule(readFileSync(join(__dirname, '../js/world/road-network.ts'), 'utf8'), {
    imports: { './city-config.ts': { ISLAND_BOUNDS: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } }, './city-geodata.js': { GEO: {} }, './car-free.ts': { carFree: () => false } }
  });
  const e = { lift: [[0, 0], [40, 2.8], [60, 6], [100, 6]] };
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should equal ${b}`);
  close(edgeLift(e, 20), 1.4);
  close(edgeLift(e, 50), 4.4);
  close(edgeLift(e, 80), 6);
  close(edgeLift(e, -5), 0);
  close(edgeLift(e, 130), 6);
  close(edgeLift({ lift: null }, 50), 0);
});

test('a patrol car never drives through a car thrown about in Jolt, and rams one of the traffic into Jolt', () => {
  const shoves = [];
  const physics = { shove: (body, dvx, dvy, dvz, dwx, dwy, dwz, dx, dz) => shoves.push({ body, dvx, dvz, dx, dz }) };
  const thrown = [];
  const { bumpBody } = trafficModule('collisions', {
    './constants.ts': { ...constants, onRoad: (v) => v.edge !== null },
    './overlap.ts': { overlapWithPlayer },
    // (as crashes.ts: into ts.crashed, its body at rest where it was)
    './crashes.ts': { crash: (ts, v) => { thrown.push(v); ts.crashed.push(v); return (v.crash = { body: { id: 'thrown', out: { vx: 0, vy: 0, vz: 0 } } }); } },
    './hooks.ts': { reportCollision() {} },
    './sparks.ts': { spawnCollisionSparks() {} },
    './surface.ts': { hillAt: () => 0 },
    './motion.ts': { shove() {} }
  });
  // (a patrol car heading -x at 12 m/s, its nose into a car lying across the road ahead of it)
  const cruiser = () => ({ x: 3, z: 0, heading: -Math.PI / 2, halfW: 0.9, halfL: 2.3, speed: 12, vx: 0, vz: 0, mass: 1500 });
  const crashedCar = {
    x: 0, z: 0, yaw: 0, halfWidth: 0.9, half: 2.2, hy: 0, bodyType: 'sedan', edge: null,
    crash: { body: { id: 'crashed', out: { vx: 0, vy: 0, vz: 0 } } }
  };
  const b = cruiser();
  bumpBody({ vehicles: [], crashed: [crashedCar], physics }, b);
  assert.equal(shoves.length, 1);
  assert.equal(shoves[0].body.id, 'crashed');
  assert.ok(shoves[0].dvx < -3, 'the crashed car is knocked on the way the patrol car was going');
  assert.ok(shoves[0].dx < 0, 'and pushed out of it');
  assert.ok(b.x > 3, 'the patrol car is pushed back out of it');
  assert.ok(b.speed < 12, 'and slowed');

  // one of the traffic standing in its lane, rammed at 12 m/s: thrown about in Jolt, not shoved through its lane
  shoves.length = 0;
  const car = {
    x: 0, z: 0, yaw: 0, yawOffset: 0, halfWidth: 0.9, half: 2.2, tx: 0, tz: 1, speed: 0, vx: 0, vz: 0, hy: 0,
    yawVel: 0, rollVel: 0, pitchVel: 0, bodyType: 'sedan', edge: {}, crash: null
  };
  bumpBody({ vehicles: [car], crashed: [], physics }, cruiser());
  assert.deepEqual(thrown, [car]);
  assert.equal(shoves.length, 1, 'struck once: not again as one of the cars already in Jolt');
  assert.equal(shoves[0].body.id, 'thrown');
  assert.ok(shoves[0].dvx < -3);
  // ...but nudged slowly, it is only shoved along
  thrown.length = 0;
  shoves.length = 0;
  car.crash = null;
  bumpBody({ vehicles: [car], crashed: [], physics }, { ...cruiser(), speed: 2 });
  assert.equal(thrown.length, 0);
  assert.equal(shoves.length, 0);
  // ...and an ambulance on its way (ram false) never sends it flying
  bumpBody({ vehicles: [car], crashed: [], physics }, cruiser(), false);
  assert.equal(thrown.length, 0);
});

test('a vehicle bumped or caught in a blast on a bridge reports and sparks over the deck, not the ground under it', () => {
  const GROUND = 5, DECK = 12;
  const reported = [];
  const sparks = [];
  const effects = {
    './hooks.ts': { reportCollision: (...args) => reported.push(args.at(-1)) },
    './sparks.ts': { spawnCollisionSparks: (...args) => sparks.push(args.at(-1)) },
    './surface.ts': { hillAt: () => GROUND },
    './motion.ts': { shove() {} }
  };
  const vehicle = (hy) => ({
    x: 0, z: 0, yaw: 0, yawOffset: 0, halfWidth: 1, half: 2.2, tx: 0, tz: 1, speed: 0, vx: 0, vz: 0,
    yawVel: 0, rollVel: 0, pitchVel: 0, edge: {}, crash: null, hy
  });

  const { bumpBody } = trafficModule('collisions', {
    ...effects,
    './constants.ts': { KNOCK_SPEED: 3, CRASH_SPEED: 99, onRoad: () => true, massOf: () => 1200, clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)) },
    './overlap.ts': { overlapWithPlayer: () => ({ nx: 1, nz: 0, pen: 0.1 }) }
  });
  // the player's car driving into it from +x at 10 m/s
  const body = () => ({ x: 1, z: 0, heading: -Math.PI / 2, halfW: 0.9, halfL: 2.2, speed: 10, vx: 0, vz: 0, mass: 1300 });
  bumpBody({ vehicles: [vehicle(DECK)] }, body());
  bumpBody({ vehicles: [vehicle(undefined)] }, body());
  assert.deepEqual(reported, [DECK, GROUND], 'over its road, the ground until it has been placed');
  assert.deepEqual(sparks, [DECK, GROUND]);

  sparks.length = 0;
  const { blast } = trafficModule('gunfire', {
    ...effects,
    '../weapons.ts': { blastFalloff: () => 1 },
    './constants.ts': { KNOCK_SPEED: 3, MASS: { sedan: 1200 }, massOf: () => 1200 },
    './collisions.ts': { hurtVehicle() {} },
    './crashes.ts': { crash: () => null }
  });
  blast({ peds: [], vehicles: [vehicle(DECK)] }, 3, 0, 10, 20);
  assert.deepEqual(sparks, [DECK]);
});

test('a blast that catches a car full on sets it to blow up, and blown up it is a charred shell with nobody getting out', () => {
  const { blast, burnCar } = trafficModule('gunfire', {
    '../weapons.ts': { blastFalloff: (d, r) => Math.max(0, 1 - d / r) ** 1.5 },
    '../../player/vehicle-damage.ts': { createDamage: () => ({ front: 0, rear: 0, left: 0, right: 0, engine: 0, version: 0 }) },
    './constants.ts': { MASS: { sedan: 1200 }, massOf: () => 1200 },
    './collisions.ts': { hurtVehicle() {} },
    './crashes.ts': { crash: () => null },
    './sparks.ts': { spawnCollisionSparks() {} },
    './surface.ts': { hillAt: () => 0 }
  });
  const car = (x, extra = {}) => ({
    x, z: 0, yaw: 0, yawOffset: 0, halfWidth: 0.9, half: 2.2, tx: 0, tz: 1, speed: 8, vx: 0, vz: 0, hy: 0, yawVel: 0, rollVel: 0,
    pitchVel: 0, edge: {}, crash: null, burnt: false, paint: [0.8, 0.1, 0.1], damage: null, wrecked: false, ...extra
  });
  const hit = car(0), beside = car(3), far = car(10), bus = car(1, { bus: true }), shell = car(-1, { burnt: true });
  const blown = [];
  blast({ peds: [], vehicles: [hit, beside, far, bus, shell] }, 0, 0, 11.2, 24, blown);
  assert.deepEqual(blown, [hit, beside], 'the cars it caught full on, not one further off, a camión or a shell already burnt');
  blast({ peds: [], vehicles: [hit] }, 0, 0, 11.2, 24, blown);
  assert.equal(blown.length, 2, 'each once');
  burnCar(hit);
  assert.equal(hit.burnt, true);
  assert.ok(hit.paint.every((c) => c < 0), 'marked for the car materials to draw it burnt');
  assert.equal(hit.damage.engine, 1);
  assert.equal(hit.wrecked, true);
  assert.equal(hit.abandoned, false, 'its driver dead at the wheel: nobody to get out');
  assert.equal(hit.speed, 0);
});

// The road network over a made-up road graph (no grid, no blocks), the obstacles given
function networkOf(roadGraph, obstacles = []) {
  const { buildRoadNetwork } = loadModule(readFileSync(join(__dirname, '../js/world/road-network.ts'), 'utf8'), {
    imports: {
      './city-config.ts': {
        ALL_AVENUES: [], ALL_STREETS: [], BLOCKS: [], blockAt: () => null,
        ISLAND_BOUNDS: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
        getIslandBoundsAtZ: () => ({ westX: -1e5, eastX: 1e5 })
      },
      './city-geodata.js': { GEO: { roadGraph: { signals: [], names: ['Libramiento'], ...roadGraph } } },
      './car-free.ts': { carFree: () => false }
    }
  });
  const log = console.info;
  console.info = () => {};
  try { return buildRoadNetwork([], obstacles); } finally { console.info = log; }
}
const paintAt = (net, x, z) => net.paintEdges.filter((e) => {
  const t = (x - e.x0) * e.dx + (z - e.z0) * e.dz;
  return t >= 0 && t <= e.span && Math.abs((x - e.x0) * e.dz - (z - e.z0) * e.dx) < e.half;
});

test('a long gentle curve keeps to its road: its chords never cut across to an obstacle off it', () => {
  // a one-way road 7 m wide along a 1 km radius arc, 500 m long, a vertex every 25 m (each bend under 2°): laid as
  // one chord its middle would run 31 m inside the curve, where a lamp post stands
  const nodes = [], inner = [];
  for (let k = 0; k <= 20; k++) {
    const a = (k / 20 - 0.5) * 0.5;
    const x = 1000 * Math.sin(a), z = 1000 - 1000 * Math.cos(a);
    if (k === 0 || k === 20) nodes.push(x, z); else inner.push(x, z);
  }
  const post = { minX: -0.2, maxX: 0.2, minZ: 31, maxZ: 31.4 };
  const net = networkOf({ nodes, links: [[0, 1, 0, 7, 2, 1, inner, 0, 0]] }, [post]);
  // painted (and laned) all along the arc, its middle included (between its vertices: at a station two edges meet)
  for (const k of [2.5, 9.5, 10.5, 17.5]) {
    const a = (k / 20 - 0.5) * 0.5;
    const on = paintAt(net, 1000 * Math.sin(a), 1000 - 1000 * Math.cos(a));
    assert.equal(on.length, 1, `on the road at ${k}`);
    assert.equal(on[0].lanes.length, 2);
  }
});

test('a junction standing off a link\'s end gets an approach, and the rest of the link keeps to its road', () => {
  // a one-way road east from (0, 0); a 10 m link north to (0, -10) makes one junction of both, half way between
  const net = networkOf({ nodes: [0, 0, 300, 0, 0, -10], links: [[0, 1, 0, 7, 2, 1, [], 0, 0], [0, 2, 0, 7, 2, 0, [], 0, 0]] });
  const along = net.paintEdges.filter((e) => Math.abs(e.dz) < 0.5).sort((p, q) => p.x0 - q.x0);
  assert.ok(along.length >= 2, 'the approach and the road beyond it');
  // the approach from the junction (0, -5) to its station on the road, then on along the road's own line
  assert.ok(Math.abs(along[0].z0 + 5) < 1e-6 && Math.abs(along[0].x0) < 1e-6);
  assert.ok(Math.abs(along[1].z0) < 1e-6 && Math.abs(along[1].dz) < 1e-9, 'on the road, straight east');
  assert.ok(along[1].x0 >= 15 - 1e-6);
});

test('a short link off a bend that stands in the way at its junction is kept where it is the only way on', () => {
  // the way out of the Hermana Agua glorieta onto Av. México Sur (the road graph's links within 180 m of (185, 1030)):
  // the exit runs south-east from the glorieta, bends at (185, 1030), and its last few metres into Av. México stand in
  // the way of the traffic crossing there. Dropped, the exit had no way on, and every road leading only to it was pruned
  // (no bus could take its route out of the glorieta).
  const nodes = [196.7, 1016.9, 255.4, 1016.1, 348.7, 1017.9, 272.1, 886, 247.7, 886.5, 193.5, 886.2, 183, 892.3, 93.4, 892.8, 253.2, 1118.2, 251.4, 902.9, 196.8, 1118.4, 100.5, 903.6, 104.7, 1018.6, 114.4, 1105.6, 194.5, 903.6, 244.5, 903.3, 99.2, 887.6, 258.6, 891.5, 187.6, 897.1, 205.2, 897.4, 93.3, 896.7, 258.6, 897.1, 143.8, 1106.9, 169.8, 1060.6, 192.7, 1059, 141.6, 1130.8, 147.1, 1117.9, 112, 1109.3, 116.3, 1131.4, 123.1, 1135.2, 128.1, 1135.9, 132.2, 1135.6];
  const links = [
    [0, 1, 0, 7.4, 1, 1, [], 0, 0],
    [1, 2, 0, 7.4, 1, 1, [260, 1016.7], 0, 0],
    [3, 4, 0, 10, 2, 1, [], 0, 0],
    [4, 5, 0, 10, 2, 1, [231.4, 885.2], 0, 0],
    [6, 7, 0, 3.2, 1, 1, [99.6, 892.7], [-60, -60, -60], 2],
    [8, 1, 0, 7.4, 1, 1, [], 0, 0],
    [1, 9, 0, 7.4, 1, 1, [], 0, 0],
    [8, 10, 0, 7.4, 1, 1, [], 0, 0],
    [11, 12, 0, 7.4, 1, 1, [], 0, 0],
    [12, 13, 0, 7.4, 1, 1, [110.5, 1093.8, 111.2, 1098.2], 0, 0],
    [11, 14, 0, 10, 2, 1, [], 0, 0],
    [14, 15, 0, 10, 2, 1, [], 0, 0],
    [15, 9, 0, 10, 2, 1, [], 0, 0],
    [16, 11, 0, 7.4, 1, 1, [99.6, 892.7, 100, 896.8], 0, 0],
    [0, 12, 0, 7.4, 1, 1, [], 0, 0],
    [14, 5, 0, 14, 4, 0, [194.1, 897.2, 193.8, 892.2], 0, 0],
    [5, 16, 0, 10, 2, 1, [], 0, 0],
    [0, 14, 0, 14, 4, 0, [198.5, 997.6, 198.5, 976.6], 0, 0],
    [17, 6, 0, 3.2, 1, 1, [238.4, 891.7, 193.8, 892.2], [-60, -60, -60, -60], 2],
    [18, 19, 0, 3.4, 1, 1, [194.1, 897.2], [-60, -60, -60], 2],
    [20, 18, 0, 3.8, 1, 1, [100, 896.8], [-60, -60, -60], 2],
    [19, 21, 0, 3.2, 1, 1, [238.2, 897.2], [-60, -60, -60], 2],
    [4, 15, 0, 7, 1, 1, [241.1, 888.4, 239.7, 889.5, 238.4, 891.7, 238, 892.5, 238.3, 897.6, 239.6, 900, 241.3, 901.9], 0, 0],
    [22, 23, 0, 7, 2, 0, [149.6, 1101.3, 155.9, 1092.5], 0, 0],
    [23, 0, 0, 7, 2, 0, [176.6, 1044.8, 185.2, 1029.8], 0, 0],
    [23, 24, 0, 7, 1, 1, [174.9, 1054.2, 179, 1050.9, 182.2, 1049.7, 184.8, 1049.8, 187.2, 1050.8, 189.5, 1052.9], 0, 0],
    [10, 24, 0, 14, 4, 0, [], 0, 0],
    [24, 0, 0, 14, 4, 0, [], 0, 0],
    [25, 26, 0, 10, 2, 1, [145.2, 1126.1, 147.1, 1120.4], 0, 0],
    [26, 22, 0, 10, 2, 1, [147.1, 1114.4, 145.2, 1108.8], 0, 0],
    [22, 13, 0, 10, 2, 1, [141.3, 1103.7, 135.9, 1100.2, 129.6, 1098.8, 123.2, 1099.5, 117.4, 1102.4], 0, 0],
    [13, 27, 0, 10, 2, 1, [], 0, 0],
    [27, 28, 0, 10, 2, 1, [110.3, 1113, 109.9, 1119.4, 111.4, 1125.1, 114.7, 1130.1], 0, 0],
    [28, 29, 0, 10, 2, 1, [119.3, 1133.8], 0, 0],
    [29, 30, 0, 10, 2, 1, [], 0, 0],
    [30, 31, 0, 10, 2, 1, [], 0, 0],
    [31, 25, 0, 10, 2, 1, [136.7, 1134.3], 0, 0],
    [10, 26, 0, 7.4, 1, 1, [], 0, 0]
  ];
  const net = networkOf({ nodes, links });
  const exit = net.edges.find((e) => Math.hypot(e.sx + e.dx * e.len - 185, e.sz + e.dz * e.len - 1031) < 2);
  assert.ok(exit, 'the exit up to the bend is kept');
  assert.equal(exit.moves.length, 1);
  const link = exit.moves[0].to;
  assert.ok(Math.hypot(link.sx - 185, link.sz - 1029) < 2, 'on round the bend, onto the short link');
  assert.ok(link.moves.length > 0, 'and from it onto Av. México');
});

test('two divided avenues crossing, a light at each crossing of their carriageways, make one junction', () => {
  // A (east-west): west-bound carriageway at z = -10, east-bound at z = 10; B (north-south): south-bound at x = -10,
  // north-bound at x = 10. They cross at four nodes 20 m apart, each with its lights, as OpenStreetMap draws Av.
  // Tecnológico across Lagos del Country; each carriageway turns into the other 200 m out (so every road has a way on)
  const nodes = [-10, -10, 10, -10, 10, 10, -10, 10, -200, -10, 200, -10, 200, 10, -200, 10, -10, -200, -10, 200, 10, 200, 10, -200];
  const one = (a, b) => [a, b, 0, 7, 2, 1, [], 0, 0];
  const links = [
    one(5, 1), one(1, 0), one(0, 4), // A west-bound
    one(7, 3), one(3, 2), one(2, 6), // A east-bound
    one(8, 0), one(0, 3), one(3, 9), // B south-bound
    one(10, 2), one(2, 1), one(1, 11), // B north-bound
    one(4, 7), one(6, 5), one(9, 10), one(11, 8) // the turns 200 m out
  ];
  const net = networkOf({ nodes, links, signals: [-10, -10, 10, -10, 10, 10, -10, 10] });
  const lit = net.nodes.filter((n) => n.signal);
  assert.equal(lit.length, 1, 'one signalised junction');
  const [n] = lit;
  assert.ok(Math.hypot(n.x, n.z) < 1, 'in the middle of the four');
  assert.ok(!net.edges.some((e) => e.from.signal && e.to.signal), 'no link left between two lights');
  // each avenue's two carriageways run as one road there: one group (one phase, sharing the box), the other avenue another
  const groupOf = (dx, dz) => new Set(n.in.filter((e) => Math.abs(e.dx * dx + e.dz * dz) > 0.9).map((e) => e.axisIndex));
  const a = groupOf(1, 0), b = groupOf(0, 1);
  assert.equal(a.size, 1, 'A in one group');
  assert.equal(b.size, 1, 'B in one group');
  assert.notDeepEqual([...a], [...b]);
});

// A driver on a long straight road (lane 1.8 m right of the centreline, curb 4.55 m), driven by the real IDM, lane
// keeping, dodging and curb stops (pickups real or stubbed), with the player as the traffic sees it. Its pose is set by
// hand (heading +z, the right to -x) as locate() would.
function roadHarness({ pickups, lanes = [1.8], lane = 0, half = 4.55 } = {}) {
  const idm = trafficModule('idm', { './constants.ts': constants, './occupancy.ts': { ahead: () => null } });
  const population = { retirePed: (ts, p) => { p.placed = false; p.ride = null; } };
  const curb = pickups ? trafficModule('pickups', { './constants.ts': constants, './idm.ts': idm, './population.ts': population }) : null;
  const driving = trafficModule('driving', {
    './constants.ts': constants,
    './signals.ts': { phaseOf: () => 'green', runsRed: (v) => v.onCall === true || v.sirenNear === true },
    './occupancy.ts': { ahead: () => null, cross() {}, straddle: () => 0 },
    './idm.ts': idm,
    './routing.ts': { nearestLane: (m, l) => l },
    './right-of-way.ts': { holdsOn: () => false, mergingAhead: () => null, pedsOut: () => null },
    './junctions.ts': { enter() {}, leave() {}, mayEnter: () => true, signalAhead: () => 0 },
    './pickups.ts': curb ?? { curbBrake: () => 0, curbside() {} },
    './crossings.ts': { crossingBrake: () => 0 },
    './topes.ts': { topeCap: () => Infinity, topeJolt: () => {} },
    './rail-crossings.ts': { railBrake: () => 0, railCap: () => Infinity }
  });
  const edge = { len: 600, lanes, half, occ: lanes.map(() => []), to: {}, sx: 0, sz: 0, dx: 0, dz: 1, rx: -1, rz: 0, stops: [] };
  const v = {
    bus: false, half: 2.25, halfWidth: 0.86, axle: 1.38, driver: constants.CAR_DRIVER, v0: 13, edge, lane, s: 50,
    speed: 12, acc: 0, gap: Infinity, leaderSpeed: 0, move: { to: edge, out: lanes.map(() => 0), turn: 'S' }, conn: null, cs: 0,
    trail: null, commit: null, claimed: false, yielding: false, wait: 0, laneTimer: 1e9, dl: 0, dlv: 0, x: -lanes[lane], z: 50,
    yaw: 0, wrecked: false, fleet: null, isTaxi: false, isPolice: false, pAhead: Infinity, pRight: 0, pSpeed: 0,
    pSide: 0, pHalfW: 0.86, pHalfL: 2.18, pParked: false, pSeen: 0, react: 0.5, distracted: 0, sirenNear: false, swerve: 0,
    stop: null, pullOver: 0, nextStop: 0, fare: 0
  };
  const ts = {
    clock: 0, caution: 1, headway: 1, roadGrip: 1, parked: [], sirens: [], peds: [], pedRoutes: { along: () => [] }, stopCells: new Map(),
    player: { active: false, x: 0, z: 0, vx: 0, vz: 0, halfW: 0.86, halfL: 2.18 }
  };
  const step = (dt = 1 / 60) => {
    ts.clock += dt;
    ts.player.x += ts.player.vx * dt;
    ts.player.z += ts.player.vz * dt;
    idm.relateToPlayer(ts, v);
    driving.drive(ts, v, dt);
    v.x = -(edge.lanes[v.lane] + v.dl);
    v.z = v.s;
  };
  return { ts, v, step, curb, idm };
}

test('a driver doesn\'t stop dead for the player passing alongside, but brakes for them ahead once seen', () => {
  const { ts, v, step, idm } = roadHarness();
  // the player's car overtaking close by on its left, level with it
  Object.assign(ts.player, { active: true, x: -1.8 + 1.9, z: 51, vx: 0, vz: 15 });
  step();
  assert.ok(v.speed > 11.5, `kept its speed (${v.speed.toFixed(2)} m/s)`);
  // ...and crossing its way ahead, quick enough to be gone before it gets there
  Object.assign(ts.player, { x: -1.8 + 1.5, z: 80, vx: -9, vz: 0 });
  idm.relateToPlayer(ts, v);
  assert.equal(idm.playerGap(v, 0), Infinity);
  // standing in its lane ahead: no braking for the reaction time, then braking
  Object.assign(ts.player, { x: -1.8, z: v.s + 30, vx: 0, vz: 0 });
  step();
  assert.ok(v.acc > -1, 'not braking before it has seen them');
  for (let i = 0; i < 40; i++) step();
  assert.ok(v.acc < -2, `braking once it has (${v.acc.toFixed(2)} m/s²)`);
});

test('a driver swerves to the right for the player coming head on in its lane, and not for oncoming traffic', () => {
  const head = roadHarness();
  Object.assign(head.ts.player, { active: true, x: -1.8, z: 150, vx: 0, vz: -12 });
  let closest = Infinity;
  for (let i = 0; i < 480 && head.ts.player.z > head.v.z - 6; i++) {
    head.step();
    if (Math.abs(head.ts.player.z - head.v.z) < 4.4) closest = Math.min(closest, Math.abs(head.ts.player.x - head.v.x));
  }
  assert.ok(head.v.dl > 0.9, `off to the right (${head.v.dl.toFixed(2)} m)`);
  assert.ok(head.v.dl < 4.55 - 1.8 - 0.86 + 0.01, 'not over the curb');
  assert.ok(closest > 0.86 + 0.86, `passed without touching (${closest.toFixed(2)} m apart, centre to centre)`);

  const oncoming = roadHarness();
  Object.assign(oncoming.ts.player, { active: true, x: 1.8, z: 100, vx: 0, vz: -12 });
  for (let i = 0; i < 180; i++) oncoming.step();
  assert.ok(Math.abs(oncoming.v.dl) < 0.05, 'kept to its lane');
  assert.ok(oncoming.v.speed > 11, 'and its speed');
});

test('a driver pulls over and crawls for a siren coming up behind it, and drives on once it has gone by', () => {
  // (the curb's own pickups.ts: what lets go of the pull over each frame)
  const { ts, v, step } = roadHarness({ pickups: true });
  Object.assign(v, { tx: 0, tz: 1 });
  // a fire truck 20 m behind, going its way (heading +z); one going the other way changes nothing
  const siren = { x: v.x, z: v.z - 20, heading: Math.PI };
  ts.sirens = [siren];
  for (let i = 0; i < 60; i++) step();
  assert.equal(v.sirenNear, false, 'not for one going the other way');
  siren.heading = 0;
  for (let i = 0; i < 60 * 4; i++) {
    siren.z = v.z - 20;
    step();
  }
  assert.ok(v.sirenNear);
  assert.ok(v.dl > 1, `over to the curb (${v.dl.toFixed(2)} m)`);
  assert.ok(v.dl < 4.55 - 1.8 - 0.86 + 0.01, 'not over it');
  assert.ok(v.speed < 3.5, `crawling (${v.speed.toFixed(2)} m/s)`);
  // gone by (and on ahead): back in its lane and on its way
  for (let i = 0; i < 60 * 6; i++) {
    siren.z = v.z + 30;
    step();
  }
  assert.equal(v.sirenNear, false);
  assert.ok(v.speed > 8 && v.dl < 0.3, `on its way (${v.speed.toFixed(2)} m/s, ${v.dl.toFixed(2)} m)`);
});

test('a combi pulls in for someone hailing it, waits while they get on, and drives on', () => {
  const { ts, v, step, curb } = roadHarness({ pickups: true });
  v.fleet = 'combi';
  v.react = 0.4; // (wants() salts each person's wish with it)
  const p = { placed: true, fallen: null, bail: null, ride: null, node: null, conversation: null, wish: 0, x: -5.6, z: 110, v: 1 };
  while ((p.wish * 9.7 + v.react * 31.3) % 1 >= 0.2) p.wish += 0.01; // (someone who wants this one)
  ts.peds.push(p);
  let stoppedAt = null;
  for (let i = 0; i < 60 * 30 && p.placed; i++) {
    step();
    if (p.ride) curb.rideStep(ts, p, 1 / 60);
    if (!stoppedAt && v.stop?.stopped) stoppedAt = { z: v.z, dl: v.dl };
  }
  assert.ok(stoppedAt, 'it stopped');
  assert.ok(Math.abs(stoppedAt.z + 0.1 - 110) < 1.5, `beside them (${stoppedAt.z.toFixed(2)})`);
  assert.ok(stoppedAt.dl > 1, `pulled in to the curb (${stoppedAt.dl.toFixed(2)} m)`);
  assert.equal(p.placed, false, 'they got on');
  for (let i = 0; i < 60 * 12; i++) step();
  assert.equal(v.stop, null);
  assert.ok(v.speed > 5 && v.dl < 0.3, 'back in its lane and on its way');
});

test('where the stops are mapped, a combi passes someone hailing it mid-block and pulls in at the stop for whoever waits', () => {
  const { ts, v, step, curb } = roadHarness({ pickups: true });
  v.fleet = 'combi';
  v.react = 0.4;
  const person = (z) => {
    const p = { placed: true, fallen: null, bail: null, ride: null, node: null, cross: null, conversation: null, wish: 0, x: -5.6, z, v: 1 };
    while ((p.wish * 9.7 + v.react * 31.3) % 1 >= 0.2) p.wish += 0.01;
    ts.peds.push(p);
    return p;
  };
  const hailing = person(110), waiting = person(201);
  const stop = { x: -5.9, z: 200, s: 200, edge: v.edge, shelter: true, bench: true, dx: 0, dz: 1 };
  v.edge.stops.push(stop);
  ts.stopCells.set(Math.floor(stop.x / 100) * 100003 + Math.floor(stop.z / 100), [stop]);
  let stoppedAt = null;
  for (let i = 0; i < 60 * 40 && waiting.placed; i++) {
    step();
    for (const p of ts.peds) if (p.ride) curb.rideStep(ts, p, 1 / 60);
    if (!stoppedAt && v.stop?.stopped) stoppedAt = v.z;
  }
  assert.ok(stoppedAt !== null, 'it stopped');
  assert.ok(Math.abs(stoppedAt + 0.1 - 200) < 1.5, `at the stop (${stoppedAt.toFixed(2)})`);
  assert.equal(waiting.placed, false, 'whoever waited there got on');
  assert.equal(hailing.placed, true, 'the one hailing it mid-block didn\'t');
});

test('a stop mapped round the corner, on another street, leaves a combi still taking someone hailing it', () => {
  const { ts, v, step, curb } = roadHarness({ pickups: true });
  v.fleet = 'combi';
  v.react = 0.4;
  const p = { placed: true, fallen: null, bail: null, ride: null, node: null, cross: null, conversation: null, wish: 0, x: -5.6, z: 110, v: 1 };
  while ((p.wish * 9.7 + v.react * 31.3) % 1 >= 0.2) p.wish += 0.01;
  ts.peds.push(p);
  // (40 m off, on a cross street of another name)
  const other = { name: 'Calle de Junto', stops: [] };
  const stop = { x: -40, z: 120, s: 30, edge: other, shelter: true, bench: true, dx: 1, dz: 0 };
  other.stops.push(stop);
  ts.stopCells.set(Math.floor(stop.x / 100) * 100003 + Math.floor(stop.z / 100), [stop]);
  assert.equal(curb.stopNear(ts, -1.8, 100, 250, v.edge), null);
  assert.equal(curb.stopNear(ts, -1.8, 100, 250), stop);
  for (let i = 0; i < 60 * 40 && p.placed; i++) {
    step();
    if (p.ride) curb.rideStep(ts, p, 1 / 60);
  }
  assert.equal(p.placed, false, 'they got on');
});

// The closest the player and v come side by side (m, centre to centre) as the player drives past it head on
function headOn(h, x, z, speed = 12) {
  Object.assign(h.ts.player, { active: true, x, z, vx: 0, vz: -speed });
  let closest = Infinity;
  for (let i = 0; i < 600 && h.ts.player.z > h.v.z - 6; i++) {
    h.step();
    if (Math.abs(h.ts.player.z - h.v.z) < 4.4) closest = Math.min(closest, Math.abs(h.ts.player.x - h.v.x));
  }
  return closest;
}

test('with no room to its right, a driver swerves left round the player coming head on', () => {
  // a one-way street's curb lane, 0.6 m from the curb
  const h = roadHarness({ lanes: [-3.03, 0, 3.03], lane: 2, half: 4.55 });
  const closest = headOn(h, -3.03, 150);
  assert.ok(h.v.dl < -1, `off to the left (${h.v.dl.toFixed(2)} m)`);
  assert.ok(closest > 0.86 + 0.86, `passed without touching (${closest.toFixed(2)} m apart)`);
});

test('a driver who sees the player head on late keeps swerving till they are past, and one standing still doesn\'t slide', () => {
  const late = roadHarness();
  // creeping along, the player rolling at it in its lane, a little left of its centre, pulling in 25 m off: once it
  // steers out of their path it holds on (they aren't forgotten, seconds later) till they are past
  late.v.speed = late.v.v0 = 5;
  Object.assign(late.ts.player, { active: true, x: -1.8 + 0.4, z: late.v.z + 25, vx: 0, vz: -3.5 });
  let swerved = false, letGo = false, apart = 0;
  for (let i = 0; i < 300 && late.v.pAhead > -(late.v.half + late.v.pHalfL); i++) {
    late.step();
    apart = Math.max(apart, Math.abs(late.v.pRight));
    if (late.v.swerve !== 0) swerved = true;
    else if (swerved && late.v.pAhead > -(late.v.half + late.v.pHalfL)) letGo = true;
  }
  assert.ok(apart > 0.86 + 0.86 + 0.25, 'out of their path');
  assert.ok(swerved && !letGo, 'swerved, and held it');
  assert.ok(late.v.dl > 1, `off to the right (${late.v.dl.toFixed(2)} m)`);

  // ...even having seen them only just long enough to react when it got out of their path
  const just = roadHarness();
  Object.assign(just.ts.player, { active: true, x: -1.8 + 0.4, z: just.v.z + 20, vx: 0, vz: -4 });
  Object.assign(just.v, { dl: 1.84, swerve: 1.84, pSeen: just.v.react + 0.005 });
  for (let i = 0; i < 30; i++) just.step();
  assert.notEqual(just.v.swerve, 0, 'still swerving');

  const standing = roadHarness();
  standing.v.speed = 0;
  standing.v.v0 = 0.01; // (waiting at a light)
  headOn(standing, -1.8, 100);
  assert.ok(Math.abs(standing.v.dl) < 0.05, `stayed put (${standing.v.dl.toFixed(2)} m)`);
});

test('a driver brakes for the player merging into its lane at an angle ahead', () => {
  const { ts, v, idm } = roadHarness();
  // 1.5 m to its right, moving over into its path at 1.6 m/s, 2 m/s slower
  Object.assign(ts.player, { active: true, x: -1.8 - 1.5, z: v.z + 14.4, vx: 1.6, vz: 10 });
  idm.relateToPlayer(ts, v);
  assert.ok(idm.playerGap(v, 0) < 15, 'in its way');
});

test('a combi pulls out again when whoever hailed it is knocked down', () => {
  const { ts, v, step } = roadHarness({ pickups: true });
  v.fleet = 'combi';
  v.react = 0.4;
  const p = { placed: true, fallen: null, bail: null, ride: null, node: null, conversation: null, wish: 0, x: -5.6, z: 110, v: 1 };
  while ((p.wish * 9.7 + v.react * 31.3) % 1 >= 0.2) p.wish += 0.01;
  ts.peds.push(p);
  for (let i = 0; i < 120 && !v.stop; i++) step();
  assert.ok(v.stop, 'pulling in for them');
  p.fallen = {}; // (run over: throwPed leaves a ragdoll)
  step();
  assert.equal(v.stop, null, 'gave up on them');
  assert.equal(p.ride, null);
});

// A one-way ring round a 400 m square (corner nodes 0-3), its south side (0 -> 1) bending at (200, -30)
const ring = (extra = {}) => ({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  links: [[0, 1, 0, 7, 2, 1, [200, -30], 0, 0], [1, 2, 0, 7, 2, 1, [], 0, 0], [2, 3, 0, 7, 2, 1, [], 0, 0], [3, 0, 0, 7, 2, 1, [], 0, 0]],
  ...extra
});

test('a signal with no junction near it stops the traffic at its own street\'s bend, painted as a crossing', () => {
  const net = networkOf(ring({ signals: [200, -30] }));
  const stop = net.nodes.find((n) => n.signal);
  assert.ok(stop, 'a signalised stop');
  assert.ok(stop.midblock && !stop.shape);
  assert.ok(Math.hypot(stop.x - 200, stop.z + 30) < 1);
  // its edges stop short of it, in the paint too (its stop bar and crosswalk)
  const into = net.paintEdges.find((e) => Math.hypot(e.to.x - 200, e.to.z + 30) < 1);
  assert.ok(into && !into.to.shape);
  assert.ok(into.len < into.span - 2, 'stopping short of the crossing');
  // a signal off the street (12 m out from the bend, past the roadway's edge) stops nobody
  assert.ok(!networkOf(ring({ signals: [200, -44] })).nodes.some((n) => n.signal));
});

test('a signal along a straight street, clear of its junctions, gets a stop of its own (a crossing\'s lights)', () => {
  // (the ring's east side runs straight from (400, 0) to (400, 400))
  const net = networkOf(ring({ signals: [401, 150] }));
  const stop = net.nodes.find((n) => n.signal);
  assert.ok(stop?.midblock, 'a signalised stop');
  assert.ok(Math.hypot(stop.x - 400, stop.z - 150) < 1);
  // one within 26 m of a junction is the junction's: no stop along the street for it
  assert.ok(!networkOf(ring({ signals: [400, 380] })).nodes.some((n) => n.midblock));
});

test('a street looping back to its own junction keeps its lanes, out to a station half way round and back', () => {
  // nodes 0 and 1 are 10 m apart (one junction once joined); a 300 m one-way loop from 1 round to 0, a road on from 0
  const loop = [];
  for (let k = 1; k < 12; k++) {
    const a = Math.PI * 2 * (k / 12);
    loop.push(5 + 60 * Math.sin(a), 60 - 60 * Math.cos(a));
  }
  const net = networkOf({ nodes: [0, 0, 10, 0, 300, 0], links: [[0, 1, 0, 7, 2, 0, [], 0, 0], [1, 0, 0, 7, 1, 1, loop, 0, 0], [0, 2, 0, 7, 2, 0, [], 0, 0]] });
  // the loop's far side, 120 m round from its junction, still has its lanes and paint
  assert.ok(paintAt(net, 5, 120).length > 0);
});
