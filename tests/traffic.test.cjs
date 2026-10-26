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
    driver: { b: 3 }, half: 2.25, wait: 0, commit: null, isPolice: false };
  const state = { phase: 'red', occupied: false, pedestrians: false, space: true, conflict: false };
  const ts = { connector: () => ({ len: 20 }) };
  const junctions = trafficModule('junctions', {
    './constants.ts': constants,
    './signals.ts': { phaseOf: () => state.phase },
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

test('police pass red and amber signals while ordinary cars stop', () => {
  const { car, state, mayEnter, signalAhead } = intersectionHarness();
  for (const phase of ['red', 'amber']) {
    state.phase = phase;
    car.isPolice = false;
    assert.equal(mayEnter(car, 18), false);
    assert.equal(signalAhead(car, car.edge, 18), -3);
    car.isPolice = true;
    assert.equal(mayEnter(car, 18), true);
    assert.equal(signalAhead(car, car.edge, 18), 0);
  }
});

test('police still wait for crossing traffic, pedestrians and a blocked exit', () => {
  const { car, state, mayEnter } = intersectionHarness();
  car.isPolice = true;
  for (const [key, blocked] of [['occupied', true], ['pedestrians', true], ['space', false], ['conflict', true]]) {
    const initial = state[key];
    state[key] = blocked;
    assert.equal(mayEnter(car, 18), false, key);
    state[key] = initial;
  }
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

test('left turns account for oncoming police even when their signal is red', () => {
  const edge = { to: { signal: true }, through: 0, len: 100, occ: [] };
  const car = { edge, move: { turn: 'S', out: [0] }, lane: 0, speed: 10, half: 2.25, isPolice: false };
  edge.occ.push([{ v: car, s: 85 }]);
  const rightOfWay = trafficModule('right-of-way', {
    './signals.ts': { phaseOf: () => 'red' },
    './occupancy.ts': { leadOf: (list) => list.at(-1) }
  });
  const yieldOncoming = (o, impatient) => rightOfWay.yieldOncoming({}, o, impatient);
  assert.equal(yieldOncoming(edge, false), false);
  car.isPolice = true;
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
    transit: { paths: [] }, vehicles: [], wallAt: null,
    // (the hour's weighing, traffic-demand.js: uniform here)
    nearCarWeights: [], nearPedWeights: [],
    sidewalkTrack: () => false, crosswalkTrack: () => false
  };
  const globals = { Math: Object.assign(Object.create(Math), { random: () => 0.5 }) };
  const near = trafficModule('near', {
    './constants.ts': constants,
    '../traffic-demand.ts': { roadClass: () => 'street', carDensity: () => 0, peopleDensity: () => 0, busyFactor: () => 1 }
  }, globals);
  const spawning = trafficModule('spawning', {
    './constants.ts': constants,
    './surface.ts': { hillAt: () => 0 },
    './view.ts': { visible: (...args) => ts.visible(...args) },
    './near.ts': { pickWeighted: (list) => list[Math.floor(Math.random() * list.length)] },
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
  const combi = { half: 2.45, fleet: 'combi', path: null };
  assert.equal(spawnVehicle(combi, 0, 350, false), true);
  assert.equal(combi.edge, onRoute);
  assert.equal(combi.path, shared);
  assert.equal(combi.pathS, 1250, 'its cursor starts where the road ends on the route');
  assert.equal(combi.sign, 3);
  // ...and never within a headway of the last unit of its route: no convoys of one route
  Object.assign(combi, { x: 0, z: onRoute.sz + combi.s }); // (where it was placed: the stub doesn't locate it)
  context.vehicles.push(combi);
  const next = { half: 2.45, fleet: 'combi', path: null };
  assert.equal(spawnVehicle(next, 0, 350, false), false, 'the route already has a combi here');
  combi.x += 400;
  assert.equal(spawnVehicle(next, 0, 350, false), true);
  assert.equal(next.path, shared);
  context.vehicles.length = 0;

  context.nearTransitEdges.length = 0;
  context.nearTransitEdges.push(busRoad);
  const other = { half: 2.45, fleet: 'combi', path: null };
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
    imports: { './city-config.ts': { ISLAND_BOUNDS: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } }, './city-geodata.js': { GEO: {} } }
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

// A driver on a long straight road (lane 1.8 m right of the centreline, curb 4.55 m), driven by the real IDM, lane
// keeping, dodging and curb stops (pickups real or stubbed), with the player as the traffic sees it. Its pose is set by
// hand (heading +z, the right to -x) as locate() would.
function roadHarness({ pickups, lanes = [1.8], lane = 0, half = 4.55 } = {}) {
  const idm = trafficModule('idm', { './constants.ts': constants, './occupancy.ts': { ahead: () => null } });
  const population = { retirePed: (ts, p) => { p.placed = false; p.ride = null; } };
  const curb = pickups ? trafficModule('pickups', { './constants.ts': constants, './idm.ts': idm, './population.ts': population }) : null;
  const driving = trafficModule('driving', {
    './constants.ts': constants,
    './signals.ts': { phaseOf: () => 'green' },
    './occupancy.ts': { ahead: () => null, cross() {}, straddle: () => 0 },
    './idm.ts': idm,
    './routing.ts': { nearestLane: (m, l) => l },
    './right-of-way.ts': { holdsOn: () => false, mergingAhead: () => null, pedsOut: () => null },
    './junctions.ts': { enter() {}, leave() {}, mayEnter: () => true, signalAhead: () => 0 },
    './pickups.ts': curb ?? { curbBrake: () => 0, curbside() {} }
  });
  const edge = { len: 600, lanes, half, occ: lanes.map(() => []), to: {}, sx: 0, sz: 0, dx: 0, dz: 1, rx: -1, rz: 0 };
  const v = {
    bus: false, half: 2.25, halfWidth: 0.86, axle: 1.38, driver: constants.CAR_DRIVER, v0: 13, edge, lane, s: 50,
    speed: 12, acc: 0, gap: Infinity, leaderSpeed: 0, move: { to: edge, out: lanes.map(() => 0), turn: 'S' }, conn: null, cs: 0,
    trail: null, commit: null, claimed: false, yielding: false, wait: 0, laneTimer: 1e9, dl: 0, dlv: 0, x: -lanes[lane], z: 50,
    yaw: 0, wrecked: false, fleet: null, isTaxi: false, isPolice: false, pAhead: Infinity, pRight: 0, pSpeed: 0,
    pSide: 0, pHalfW: 0.86, pHalfL: 2.18, pParked: false, pSeen: 0, react: 0.5, swerve: 0, stop: null, pullOver: 0,
    nextStop: 0, fare: 0
  };
  const ts = {
    clock: 0, caution: 1, headway: 1, roadGrip: 1, parked: [], peds: [], pedRoutes: { along: () => [] },
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
