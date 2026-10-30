import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../index.ts';
import type { Health, RoomList } from '../index.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OP, PROTOCOL_VERSION, DEFAULT_RULES, encodeHello, encodeCreate, encodeRules, encodeChat, encodeShot, encodeHit, encodeDown, encodeSky } from '../../shared/protocol.ts';
import { quiet, connect, pose, threePlayers } from './client.ts';

void test('two players in one region see each other, deltas skip parked players, and leaving notifies', async () => {
  const server = await createServer({ port: 0, tickHz: 20, log: quiet });
  try {
    const a = connect(server.port);
    const b = connect(server.port);
    await Promise.all([a.opened, b.opened]);
    a.ws.send(encodeHello('nayarit', 'Ana'));
    b.ws.send(encodeHello('nayarit', 'Beto'));
    const wa = await a.next(OP.WELCOME);
    const wb = await b.next(OP.WELCOME);
    assert.equal(wa.room, 'nayarit#1');
    assert.equal(wb.room, 'nayarit#1');

    a.ws.send(pose(10, 20));
    b.ws.send(pose(15, 20, 'person'));
    const seen = await a.next(OP.TICK, (m) => m.moved.some((p) => p.id === wb.id));
    assert.deepEqual(seen.info, [{ id: wb.id, name: 'Beto' }]);
    const beto = seen.moved.find((p) => p.id === wb.id);
    assert.ok(beto);
    assert.deepEqual([beto.x, beto.z, beto.mode, beto.speed], [15, 20, 'person', 5]);
    assert.equal(seen.roomPlayers, 2);

    // Beto parks: resending the same pose must not produce more moved rows for Ana
    b.ws.send(pose(15, 20, 'person'));
    const before = a.frames.length;
    await new Promise((r) => setTimeout(r, 200));
    const later = a.frames.slice(before).filter((m) => m.op === OP.TICK);
    assert.ok(later.length >= 2, 'ticks keep coming');
    assert.ok(later.every((m) => m.moved.length === 0), 'an unchanged pose is not resent');

    b.ws.send(pose(16, 20, 'person'));
    await a.next(OP.TICK, (m) => m.moved.some((p) => p.id === wb.id && p.x === 16));

    b.ws.close();
    await a.next(OP.TICK, (m) => m.gone.includes(wb.id));
  } finally {
    await server.close();
  }
});

void test('players far apart or in other regions are out of view', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const [a, far, other] = [connect(server.port), connect(server.port), connect(server.port)];
    await Promise.all([a.opened, far.opened, other.opened]);
    a.ws.send(encodeHello('nayarit', 'A'));
    far.ws.send(encodeHello('nayarit', 'Far'));
    other.ws.send(encodeHello('jalisco', 'Other'));
    await Promise.all([a, far, other].map((c) => c.next(OP.WELCOME)));
    a.ws.send(pose(0, 0));
    far.ws.send(pose(0, 900));
    other.ws.send(pose(5, 5));
    await new Promise((r) => setTimeout(r, 250));
    const ticks = a.frames.filter((m) => m.op === OP.TICK);
    assert.ok(ticks.length > 0);
    assert.ok(ticks.every((m) => m.info.length === 0 && m.moved.length === 0), 'nobody is in view');
    assert.equal(ticks[ticks.length - 1].roomPlayers, 2, 'the jalisco player is in another room');

    far.ws.send(pose(0, 300)); // drives into view
    const t = await a.next(OP.TICK, (m) => m.info.some((i) => i.name === 'Far'));
    assert.equal(t.moved[0].z, 300);
    for (const c of [a, far, other]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a near player\'s poses come every tick, a far one\'s every third (by updateEvery), however it moves', async () => {
  // (ticked by hand: the timer's 100 s apart)
  const server = await createServer({ port: 0, tickHz: 0.01, log: quiet });
  try {
    const [a, near, far] = [connect(server.port), connect(server.port), connect(server.port)];
    await Promise.all([a.opened, near.opened, far.opened]);
    a.ws.send(encodeHello('nayarit', 'A'));
    near.ws.send(encodeHello('nayarit', 'Near'));
    far.ws.send(encodeHello('nayarit', 'Far'));
    const [wa, wn, wf] = await Promise.all([a, near, far].map((c) => c.next(OP.WELCOME)));
    // (waits on what happened, not on a delay: a loaded machine only makes it slower)
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
      assert.ok(done(), 'it came');
    };
    const at = (id: number) => server.players.get(id)?.state?.x;
    let seenNear = 0, seenFar = 0;
    for (let i = 0; i < 12; i++) {
      a.ws.send(pose(0, 0));
      near.ws.send(pose(50 + i, 0)); // 50 m off
      far.ws.send(pose(600 + i, 0)); // 600 m off
      await until(() => at(wa.id) === 0 && at(wn.id) === (50 + i) * 100 && at(wf.id) === (600 + i) * 100);
      const before = a.frames.length;
      server.tick();
      await until(() => a.frames.slice(before).some((m) => m.op === OP.TICK));
      for (const m of a.frames.slice(before)) {
        if (m.op !== OP.TICK) continue;
        if (m.moved.some((p) => p.id === wn.id)) seenNear++;
        if (m.moved.some((p) => p.id === wf.id)) seenFar++;
      }
    }
    assert.equal(seenNear, 12, 'every tick');
    assert.ok(seenFar >= 4 && seenFar <= 5, `about a third: ${String(seenFar)} (its first pose at once, then every third)`);
    for (const c of [a, near, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a full room opens a mirror; a wrong protocol version or region is refused', async () => {
  const server = await createServer({ port: 0, capacity: 1, log: quiet });
  try {
    const [a, b] = [connect(server.port), connect(server.port)];
    await Promise.all([a.opened, b.opened]);
    a.ws.send(encodeHello('nayarit', 'A'));
    assert.equal((await a.next(OP.WELCOME)).room, 'nayarit#1');
    b.ws.send(encodeHello('nayarit', 'B'));
    assert.equal((await b.next(OP.WELCOME)).room, 'nayarit#2');

    const old = connect(server.port);
    await old.opened;
    const hello = encodeHello('nayarit', 'Old');
    hello[1] = PROTOCOL_VERSION - 1;
    old.ws.send(hello);
    assert.equal((await old.next(OP.ERROR)).code, 'version');
    assert.equal((await old.closed).code, 1008);

    const bad = connect(server.port);
    await bad.opened;
    bad.ws.send(encodeHello('../../etc', 'X'));
    assert.equal((await bad.next(OP.ERROR)).code, 'region');

    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const stats = (await res.json()) as Health;
    assert.equal(stats.players, 2);
    assert.deepEqual(stats.rooms.map((r) => r.id).sort(), ['nayarit#1', 'nayarit#2']);
    a.ws.close();
    b.ws.close();
  } finally {
    await server.close();
  }
});

void test('a client flooding messages is disconnected', async () => {
  const server = await createServer({ port: 0, log: quiet });
  try {
    const c = connect(server.port);
    await c.opened;
    c.ws.send(encodeHello('nayarit', 'Spam'));
    await c.next(OP.WELCOME);
    for (let i = 0; i < 200; i++) c.ws.send(pose(i, 0));
    assert.equal((await c.next(OP.ERROR)).code, 'rate');
    await c.closed;
  } finally {
    await server.close();
  }
});

// Two players in nayarit#1 who see each other (and a third, Far, 2 km off, out of view), poses sent and seen
void test('chat lines reach the whole room, cleaned, and a chatterbox is held back', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    a.ws.send(encodeChat('  hola\nBeto\u200b  '));
    const line = await far.next(OP.CHAT_LINE);
    assert.deepEqual(line, { op: OP.CHAT_LINE, from: ids.a, name: 'Ana', text: 'hola Beto' }, 'out of view, still in the room');
    await a.next(OP.CHAT_LINE, (m) => m.text === 'hola Beto'); // (the speaker hears it back: one order for everyone)
    a.ws.send(encodeChat('   '));
    for (let i = 0; i < 9; i++) b.ws.send(encodeChat(`spam ${i}`));
    await new Promise((r) => setTimeout(r, 150));
    const spam = a.frames.filter((m) => m.op === OP.CHAT_LINE && m.text.startsWith('spam'));
    assert.equal(spam.length, 5, 'a burst of five, then a line a second');
    assert.ok(!a.frames.some((m) => m.op === OP.CHAT_LINE && m.text === ''), 'nothing visible: nothing said');
    for (const c of [a, b, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a shot goes to those who see the shooter; a hit reaches its target within reach; a death is told', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    a.ws.send(encodeShot({ ox: 0, oy: 1.4, oz: 0, ex: 10, ey: 1.2, ez: 0, weapon: 'pistol', rocket: false }));
    const seen = await b.next(OP.SHOT_SEEN);
    assert.equal(seen.from, ids.a);
    assert.deepEqual(seen.shot, { ox: 0, oy: 1.4, oz: 0, ex: 10, ey: 1.2, ez: 0, weapon: 'pistol', rocket: false });
    a.ws.send(encodeShot({ ox: 0, oy: 1, oz: 0, ex: 0, ey: 1, ez: 5000, weapon: 'pistol', rocket: false })); // (5 km: dropped)
    a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    const hurt = await b.next(OP.HURT);
    assert.deepEqual(hurt, { op: OP.HURT, from: ids.a, damage: 34 });
    a.ws.send(encodeHit(ids.far, 34, 'pistol')); // 2 km off: not believed
    a.ws.send(encodeHit(ids.a, 34, 'pistol')); // itself: ignored
    b.ws.send(encodeDown(ids.a));
    const told = await far.next(OP.NOTE);
    assert.deepEqual(told, { op: OP.NOTE, kind: 'killed', a: 'Ana', b: 'Beto' }, 'the clients word it, each in its language');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.frames.filter((m) => m.op === OP.SHOT_SEEN).length, 1, 'the 5 km shot was dropped');
    assert.ok(!far.frames.some((m) => m.op === OP.SHOT_SEEN || m.op === OP.HURT), 'Far neither saw the shot nor was hit');
    assert.ok(!a.frames.some((m) => m.op === OP.SHOT_SEEN || m.op === OP.HURT), 'the shooter hears nothing back');
    for (const c of [a, b, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('the sky is the room\'s: a newcomer gets it, a change reaches everyone in the room and no other room', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    assert.deepEqual(await a.next(OP.SKY_SET), { op: OP.SKY_SET, from: 0, time: 'live', weather: 'live' }, 'a new room starts on the real sky');
    a.ws.send(encodeSky('midnight', 'rain'));
    const set = await far.next(OP.SKY_SET, (m) => m.from === ids.a);
    assert.deepEqual(set, { op: OP.SKY_SET, from: ids.a, time: 'midnight', weather: 'rain' }, 'out of view, still in the room');
    await a.next(OP.SKY_SET, (m) => m.from === ids.a); // (the one who changed it hears it back: one order for everyone)
    assert.deepEqual(await b.next(OP.NOTE), { op: OP.NOTE, kind: 'sky', a: 'Ana', b: '' });
    const late = connect(server.port);
    await late.opened;
    late.ws.send(encodeHello('nayarit', 'Late'));
    await late.next(OP.WELCOME);
    assert.deepEqual(await late.next(OP.SKY_SET), { op: OP.SKY_SET, from: 0, time: 'midnight', weather: 'rain' }, 'joining, the room\'s sky');
    const other = connect(server.port);
    await other.opened;
    other.ws.send(encodeHello('jalisco', 'Otro'));
    assert.deepEqual(await other.next(OP.SKY_SET), { op: OP.SKY_SET, from: 0, time: 'live', weather: 'live' }, 'another region keeps its own');
    const bad = new Uint8Array([OP.SKY, 99, 0]);
    b.ws.send(bad); // (no such time of day: dropped)
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.frames.filter((m) => m.op === OP.SKY_SET).length, 2, 'the room\'s on joining, and Ana\'s change');
    for (const c of [a, b, far, late, other]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a player opens a room of their own: friends join by its code and password, only the host sets its sky and rules, PvP off stops hits', async () => {
  const server = await createServer({ port: 0, tickHz: 20, log: quiet });
  try {
    const [ana, beto, intruso, carla] = [connect(server.port), connect(server.port), connect(server.port), connect(server.port)];
    await Promise.all([ana.opened, beto.opened, intruso.opened, carla.opened]);
    const rules = { ...DEFAULT_RULES, pvp: false };
    ana.ws.send(encodeCreate('nayarit', 'Ana', { title: '  La banda ', password: 'tacos', time: 'midnight', weather: 'rain', rules }));
    const made = await ana.next(OP.WELCOME);
    assert.equal(made.title, 'La banda');
    assert.equal(made.locked, true);
    assert.equal(made.host, made.id, 'whoever opens it hosts it');
    assert.deepEqual(made.rules, rules);
    assert.deepEqual(await ana.next(OP.SKY_SET), { op: OP.SKY_SET, from: 0, time: 'midnight', weather: 'rain' }, 'it starts on its own sky');

    intruso.ws.send(encodeHello('nayarit', 'Intruso', made.code, 'nachos'));
    assert.equal((await intruso.next(OP.ERROR)).code, 'password');
    beto.ws.send(encodeHello('nayarit', 'Beto', made.code.toLowerCase(), 'tacos'));
    const joined = await beto.next(OP.WELCOME);
    assert.equal(joined.room, made.room);
    assert.deepEqual(joined.rules, rules, 'the room\'s rules, to whoever comes in...');
    assert.equal((await beto.next(OP.SKY_SET)).weather, 'rain', '...and its sky');
    carla.ws.send(encodeHello('nayarit', 'Carla', 'ZZZZZ'));
    assert.equal((await carla.next(OP.ERROR)).code, 'room');

    // listed (no public room is open yet), its password never
    const list = (await (await fetch(`http://127.0.0.1:${server.port}/rooms?region=nayarit`)).json()) as RoomList;
    assert.deepEqual(list.rooms.map((r) => [r.title, r.code, r.players, r.locked, r.weather]), [['La banda', made.code, 2, true, 'rain']]);
    assert.ok(!JSON.stringify(list).includes('tacos'));
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/rooms?region=../x`)).status, 400);

    // only the host changes the sky and the rules; everyone hears them
    beto.ws.send(encodeSky('midday', 'fog'));
    beto.ws.send(encodeRules({ police: false, pvp: true }));
    ana.ws.send(encodeSky('live', 'storm'));
    ana.ws.send(encodeRules({ police: false, pvp: false }));
    assert.deepEqual(await beto.next(OP.SKY_SET, (m) => m.from === made.id), { op: OP.SKY_SET, from: made.id, time: 'live', weather: 'storm' });
    assert.deepEqual(await beto.next(OP.ROOM), { op: OP.ROOM, host: made.id, rules: { police: false, pvp: false } });
    assert.ok(!beto.frames.some((m) => m.op === OP.SKY_SET && m.weather === 'fog'), 'a guest doesn\'t set the sky');

    // PvP off: a hit reaches nobody
    ana.ws.send(pose(0, 0, 'person'));
    beto.ws.send(pose(5, 0, 'person'));
    await ana.next(OP.TICK, (m) => m.moved.some((p) => p.id === joined.id));
    ana.ws.send(encodeHit(joined.id, 20, 'fists'));
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!beto.frames.some((m) => m.op === OP.HURT), 'no PvP in this room');

    // the host leaves: Beto hosts it now
    ana.ws.close();
    const handed = await beto.next(OP.ROOM, (m) => m.host === joined.id);
    assert.equal(handed.host, joined.id);
    beto.ws.close();
  } finally {
    await server.close();
  }
});

void test('with a static folder the server is the game page too, and serves nothing else of the folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Slop</title>');
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"Slop"}');
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'main.js'), 'console.log(1);');
  fs.mkdirSync(path.join(root, 'server'));
  fs.writeFileSync(path.join(root, 'server', 'index.ts'), 'secret');
  fs.writeFileSync(path.join(root, '.env'), 'secret');
  const server = await createServer({ port: 0, staticDir: root, log: quiet });
  try {
    const get = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /Slop/);
    const js = await get('/dist/main.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    const manifest = await get('/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get('content-type') ?? '', /manifest\+json/);
    for (const p of ['/server/index.ts', '/.env', '/dist/../server/index.ts', '/dist/%2e%2e/server/index.ts', '/dist/..%2fserver%2findex.ts', '/package.json']) {
      const res = await get(p);
      assert.equal(res.status, 404, p);
      assert.doesNotMatch(await res.text(), /secret/, p);
    }
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
