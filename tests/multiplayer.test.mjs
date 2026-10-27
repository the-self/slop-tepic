import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OP,
  PROTOCOL_VERSION,
  STATE_BYTES,
  ROW_BYTES,
  sanitizeName,
  sanitizeChat,
  isRegion,
  encodeHello,
  encodeState,
  encodeChat,
  encodeShot,
  encodeHit,
  encodeDown,
  encodeSky,
  encodeSkySet,
  decodeClient,
  encodeWelcome,
  encodeTick,
  encodeError,
  encodeChatLine,
  encodeShotSeen,
  encodeHurt,
  encodeCreate,
  encodeRules,
  encodeRoom,
  sanitizeTitle,
  DEFAULT_RULES,
  decodeServer
} from '../shared/protocol.ts';
import { RoomManager } from '../server/rooms.ts';
import { SpatialGrid, nearestInView } from '../server/aoi.ts';

const entity = (x, y, z, heading, speed) => ({ position: { x, y, z }, heading, speed });

test('a pose round-trips through the 18-byte STATE frame at centimetre precision', () => {
  const frame = encodeState(entity(-1234.567, 12.345, 6543.21, -Math.PI / 2, 27.78), 'helicopter');
  assert.equal(frame.byteLength, STATE_BYTES);
  assert.equal(STATE_BYTES, 18);
  const msg = decodeClient(frame);
  assert.equal(msg.op, OP.STATE);
  assert.deepEqual(msg.state, { x: -123457, y: 1235, z: 654321, h: 49152, m: 3, s: 278 });
});

test('hello carries version, region and the raw name; the server-side sanitizer cleans it', () => {
  const msg = decodeClient(encodeHello('nayarit', '  Lalo\u200b   el\nTaxista  '));
  assert.deepEqual(msg, { op: OP.HELLO, version: PROTOCOL_VERSION, region: 'nayarit', name: '  Lalo\u200b   el\nTaxista  ', room: '', password: '' });
  assert.equal(sanitizeName(msg.name), 'Lalo el Taxista');
  assert.equal(sanitizeName('', 42), 'Player-0042');
  assert.equal(sanitizeName('ñandú '.repeat(10)).length <= 24, true);
  assert.equal(isRegion('valle-de-mexico'), true);
  assert.equal(isRegion('../etc'), false);
  assert.equal(isRegion(''), false);
});

test('malformed or out-of-range client frames are dropped, never thrown', () => {
  assert.equal(decodeClient(new Uint8Array([])), null);
  assert.equal(decodeClient(new Uint8Array([OP.STATE, 1, 2])), null, 'truncated pose');
  assert.equal(decodeClient(new Uint8Array([99])), null, 'unknown opcode');
  assert.equal(decodeClient(new Uint8Array([OP.HELLO, PROTOCOL_VERSION, 200, 97])), null, 'string overruns the frame');
  const badMode = encodeState(entity(0, 0, 0, 0, 0), 'car');
  badMode[15] = 9;
  assert.equal(decodeClient(badMode), null, 'mode index out of range');
  assert.equal(decodeClient(new Uint8Array(5000)), null, 'oversized');
});

test('a TICK frame carries departures, newcomers and only the moved poses', () => {
  const moved = [[7, { x: 100, y: 200, z: -300, h: 16384, m: 1, s: -55 }]];
  const frame = encodeTick(120, [3, 4], [[7, 'Lupita 🚕']], moved);
  assert.equal(frame.byteLength, 1 + 2 + 2 + 4 + 2 + 2 + 1 + new TextEncoder().encode('Lupita 🚕').length + 2 + ROW_BYTES);
  const msg = decodeServer(frame);
  assert.equal(msg.op, OP.TICK);
  assert.equal(msg.roomPlayers, 120);
  assert.deepEqual(msg.gone, [3, 4]);
  assert.deepEqual(msg.info, [{ id: 7, name: 'Lupita 🚕' }]);
  assert.equal(msg.moved.length, 1);
  const m = msg.moved[0];
  assert.equal(m.id, 7);
  assert.deepEqual([m.x, m.y, m.z, m.mode, m.speed], [1, 2, -3, 'car', -5.5]);
  assert.ok(Math.abs(m.heading - Math.PI / 2) < 1e-9);

  const room = { id: 'nayarit#2', title: '', code: '', locked: false, host: 0, rules: DEFAULT_RULES };
  assert.deepEqual(decodeServer(encodeWelcome(65535, 200, 10, room)), {
    op: OP.WELCOME, id: 65535, capacity: 200, tickHz: 10, room: 'nayarit#2', title: '', code: '', locked: false, host: 0, rules: { ...DEFAULT_RULES }
  });
  assert.deepEqual(decodeServer(encodeError('version')), { op: OP.ERROR, code: 'version' });
  assert.equal(decodeServer(frame.subarray(0, frame.length - 3)), null, 'truncated tick');
});

test('the room\'s sky travels as two indices; unknown names go as the real sky, unknown indices are dropped', () => {
  assert.deepEqual(decodeClient(encodeSky('twilight', 'fog')), { op: OP.SKY, sky: { time: 3, weather: 6 } });
  assert.deepEqual(decodeClient(encodeSky('dawn', 'snow')), { op: OP.SKY, sky: { time: 0, weather: 0 } });
  assert.equal(decodeClient(new Uint8Array([OP.SKY, 5, 0])), null, 'no such time of day');
  assert.equal(decodeClient(new Uint8Array([OP.SKY, 0, 7])), null, 'no such weather');
  assert.deepEqual(decodeServer(encodeSkySet(12, { time: 4, weather: 5 })), { op: OP.SKY_SET, from: 12, time: 'midnight', weather: 'storm' });
  assert.deepEqual(decodeServer(encodeSkySet(0, { time: 200, weather: 200 })), { op: OP.SKY_SET, from: 0, time: 'live', weather: 'live' },
    'a newer server\'s sky: the real one');
});

test('a full view of 64 moving players fits in about 1.2 KB per tick', () => {
  const moved = Array.from({ length: 64 }, (_, i) => [i + 1, { x: i, y: 0, z: i, h: 0, m: 1, s: 100 }]);
  const bytes = encodeTick(500, [], [], moved).byteLength;
  assert.equal(bytes, 9 + 64 * ROW_BYTES);
  assert.ok(bytes < 1300, `${bytes} bytes`);
});

test('rooms fill the busiest open mirror of a region, open the next when full and vanish when empty', () => {
  const rooms = new RoomManager({ capacity: 2 });
  const a = rooms.join('nayarit', { id: 1 });
  assert.equal(a.id, 'nayarit#1');
  assert.equal(rooms.join('nayarit', { id: 2 }).id, 'nayarit#1');
  const b = rooms.join('nayarit', { id: 3 });
  assert.equal(b.id, 'nayarit#2', 'a full room opens a mirror');
  assert.equal(rooms.join('jalisco', { id: 4 }).id, 'jalisco#1', 'regions never share rooms');
  rooms.leave(a, 1);
  assert.equal(rooms.join('nayarit', { id: 5 }).id, 'nayarit#1', 'a freed seat is reused before the emptier mirror');
  rooms.leave(b, 3);
  assert.equal(rooms.rooms.has('nayarit#2'), false, 'empty rooms close');
  assert.deepEqual(rooms.stats().players, 3);
  assert.equal(rooms.join('nayarit', { id: 6 }).id, 'nayarit#2', 'the lowest free mirror number is reused');
});

test('the area of interest returns the nearest players within the radius, capped', () => {
  const grid = new SpatialGrid(100);
  const positions = new Map();
  const put = (id, x, z) => {
    positions.set(id, { x, z });
    grid.update(id, x, z);
  };
  put(1, 0, 0);
  put(2, 50, 0);
  put(3, -250, 10);
  put(4, 0, 799);
  put(5, 900, 0);
  put(6, 30, 30);
  assert.deepEqual(nearestInView(grid, positions, 1, 800, 10), [6, 2, 3, 4]);
  assert.deepEqual(nearestInView(grid, positions, 1, 800, 2), [6, 2], 'capped to the nearest');
  put(2, 5000, 5000); // moved across cells
  assert.deepEqual(nearestInView(grid, positions, 1, 800, 10), [6, 3, 4]);
  grid.remove(6);
  assert.deepEqual(nearestInView(grid, positions, 1, 800, 10), [3, 4]);
  assert.equal(grid.cells.size, 5, 'emptied cells are dropped (one per remaining occupied cell)');
});

test('a passenger travels as its own mode, at the end of the list (the older modes keep their indices)', () => {
  const msg = decodeClient(encodeState(entity(1, 2, 3, 0, 4), 'passenger'));
  assert.equal(msg.state.m, 5);
  assert.equal(decodeClient(encodeState(entity(1, 2, 3, 0, 4), 'moto')).state.m, 4);
  const tick = decodeServer(encodeTick(1, [], [], [[7, msg.state]]));
  assert.equal(tick.moved[0].mode, 'passenger');
});

test('chat lines go out raw and come back cleaned, capped, with the speaker; empty ones are nothing', () => {
  assert.deepEqual(decodeClient(encodeChat('hola\n  carnal')), { op: OP.CHAT, text: 'hola\n  carnal' });
  assert.equal(sanitizeChat('  hola\n  carnal\u202e '), 'hola carnal');
  assert.equal(sanitizeChat(' \u200b\n '), '');
  assert.equal(Array.from(sanitizeChat('á'.repeat(500))).length, 140);
  assert.deepEqual(decodeServer(encodeChatLine(3, 'Lalo', 'vámonos')), { op: OP.CHAT_LINE, from: 3, name: 'Lalo', text: 'vámonos' });
});

test('a shot round-trips at centimetre precision; one that reaches too far or names a strange weapon is dropped', () => {
  const shot = { ox: 10.004, oy: 1.4, oz: -20, ex: 40.5, ey: 1.25, ez: -20, weapon: 'rifle', rocket: false };
  const msg = decodeClient(encodeShot(shot));
  assert.equal(msg.op, OP.SHOT);
  assert.deepEqual(msg.shot, { ox: 1000, oy: 140, oz: -2000, ex: 4050, ey: 125, ez: -2000, weapon: 'rifle', flags: 0 });
  const seen = decodeServer(encodeShotSeen(9, msg.shot));
  assert.deepEqual(seen, { op: OP.SHOT_SEEN, from: 9, shot: { ox: 10, oy: 1.4, oz: -20, ex: 40.5, ey: 1.25, ez: -20, weapon: 'rifle', rocket: false } });
  assert.equal(decodeClient(encodeShot({ ...shot, rocket: true })).shot.flags, 1);
  assert.equal(decodeClient(encodeShot({ ...shot, ex: 900 })), null, 'its ends ~890 m apart');
  assert.equal(decodeClient(encodeShot({ ...shot, weapon: '<img src=x>' })), null);
});

test('hits carry their target and capped damage; a death names its killer', () => {
  assert.deepEqual(decodeClient(encodeHit(12, 34.4)), { op: OP.HIT, target: 12, damage: 34 });
  assert.equal(decodeClient(encodeHit(12, 950)).damage, 100);
  assert.equal(decodeClient(encodeHit(0, 10)), null, 'nobody is player 0');
  assert.deepEqual(decodeClient(encodeDown(12)), { op: OP.DOWN, killer: 12 });
  assert.deepEqual(decodeServer(encodeHurt(4, 22)), { op: OP.HURT, from: 4, damage: 22 });
});

test('a room of one\'s own: CREATE carries its title, password, sky and rules; RULES and ROOM carry the changes', () => {
  const rules = { police: false, pvp: true };
  assert.deepEqual(decodeClient(encodeCreate('nayarit', 'Ana', { title: 'La banda', password: 'secreto', time: 'midnight', weather: 'storm', rules })), {
    op: OP.CREATE, version: PROTOCOL_VERSION, region: 'nayarit', name: 'Ana', title: 'La banda', password: 'secreto', sky: { time: 4, weather: 5 }, rules
  });
  assert.deepEqual(decodeClient(encodeHello('nayarit', 'Beto', 'K7Q2M', 'secreto')).room, 'K7Q2M');
  assert.deepEqual(decodeClient(encodeRules(rules)), { op: OP.RULES, rules });
  assert.deepEqual(decodeServer(encodeRoom(7, rules)), { op: OP.ROOM, host: 7, rules });
  const room = { id: 'nayarit~K7Q2M', title: 'La banda', code: 'K7Q2M', locked: true, host: 7, rules };
  const welcome = decodeServer(encodeWelcome(9, 200, 10, room));
  assert.equal(welcome.code, 'K7Q2M');
  assert.equal(welcome.locked, true);
  assert.deepEqual(welcome.rules, rules);
  const bad = encodeCreate('nayarit', 'Ana', { title: '', password: '', time: 'live', weather: 'live', rules });
  bad[bad.length - 3] = 99; // (a time of day nobody knows)
  assert.equal(decodeClient(bad), null);
  assert.equal(sanitizeTitle('  La\nbanda\u200b de la Loma, la mejor de todo Tepic  '), 'La banda de la Loma, la mejor de');
});

test('a player\'s own room: a code to find it by, its host passed on when it leaves, listed after the public ones', () => {
  const rooms = new RoomManager({ capacity: 2 });
  const pub = rooms.join('nayarit', { id: 1 });
  const own = rooms.create('nayarit', { id: 2 }, { title: 'La banda', password: null, sky: { time: 4, weather: 4 }, rules: { ...DEFAULT_RULES, police: false } });
  assert.match(own.code, /^[A-HJ-NP-Z2-9]{5}$/, 'five letters and digits, none to misread');
  assert.equal(own.id, `nayarit~${own.code}`);
  assert.equal(own.host, 2);
  assert.equal(rooms.find('nayarit', own.code.toLowerCase()), own, 'codes ignore case');
  assert.equal(rooms.find('nayarit', pub.id), pub, 'a public room by its id');
  assert.equal(rooms.find('jalisco', own.code), undefined, 'not from another region');
  assert.equal(rooms.join('nayarit', { id: 3 }), pub, 'the public seats never go to a player\'s own room');
  assert.equal(rooms.enter(own, { id: 4 }), true);
  assert.equal(rooms.enter(own, { id: 5 }), false, 'full');
  assert.deepEqual(rooms.list('nayarit').map((r) => [r.id, r.players, r.locked]), [[pub.id, 2], [own.id, 2]].map(([id, n]) => [id, n, false]));
  assert.equal(rooms.leave(own, 2), true, 'the host leaving hands it on...');
  assert.equal(own.host, 4, '...to the oldest player left');
  assert.equal(rooms.leave(own, 4), false);
  assert.equal(rooms.rooms.has(own.id), true, 'left empty, it waits for its players to come back...');
  assert.equal(rooms.enter(own, { id: 4 }), true);
  assert.equal(own.host, 4, '...the first one back hosting it');
  rooms.leave(own, 4);
  rooms.sweep(own.emptyAt + 1000, 5000);
  assert.equal(rooms.rooms.has(own.id), true);
  rooms.sweep(own.emptyAt + 6000, 5000);
  assert.equal(rooms.rooms.has(own.id), false, 'nobody came back in time: it closes');
});
