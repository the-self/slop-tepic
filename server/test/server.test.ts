import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createServer } from '../index.ts';
import type { Health } from '../index.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OP, PROTOCOL_VERSION, encodeHello, encodeState, encodeChat, encodeShot, encodeHit, encodeDown, encodeSky, decodeServer } from '../../shared/protocol.ts';
import type { ServerMessage } from '../../shared/protocol.ts';

const quiet = () => { /* the tests don't print the joins & leaves */ };

type ServerOp = ServerMessage['op'];
type Frame<O extends ServerOp> = Extract<ServerMessage, { op: O }>;
interface Waiter {
  match: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
}

// A test client that records every decoded frame and lets a test wait for one of an opcode matching a predicate
function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: ServerMessage[] = [];
  const waiters: Waiter[] = [];
  ws.on('message', (data) => {
    const msg = decodeServer(new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : data));
    assert.ok(msg, 'the server sends well-formed frames');
    frames.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const next = <O extends ServerOp>(op: O, match: (m: Frame<O>) => boolean = () => true, ms = 2000) =>
    new Promise<Frame<O>>((resolve, reject) => {
      const isOp = (m: ServerMessage): m is Frame<O> => m.op === op;
      const wanted = (m: ServerMessage): m is Frame<O> => isOp(m) && match(m);
      const found = frames.find(wanted);
      if (found) {
        resolve(found);
        return;
      }
      const w: Waiter = { match: wanted, resolve: (m) => { if (wanted(m)) resolve(m); } };
      waiters.push(w);
      setTimeout(() => { reject(new Error('timed out waiting for a frame')); }, ms);
    });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.on('close', (code, reason) => { resolve({ code, reason: reason.toString() }); }));
  const opened = new Promise<void>((resolve) => ws.on('open', resolve));
  return { ws, frames, next, closed, opened };
}

const pose = (x: number, z: number, mode = 'car') => encodeState({ position: { x, y: 0, z }, heading: 0, speed: 5 }, mode);

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
async function threePlayers(port: number) {
  const [a, b, far] = [connect(port), connect(port), connect(port)];
  await Promise.all([a.opened, b.opened, far.opened]);
  a.ws.send(encodeHello('nayarit', 'Ana'));
  b.ws.send(encodeHello('nayarit', 'Beto'));
  far.ws.send(encodeHello('nayarit', 'Far'));
  const [wa, wb, wf] = await Promise.all([a.next(OP.WELCOME), b.next(OP.WELCOME), far.next(OP.WELCOME)]);
  a.ws.send(pose(0, 0, 'person'));
  b.ws.send(pose(10, 0, 'person'));
  far.ws.send(pose(0, 2000, 'person'));
  await a.next(OP.TICK, (m) => m.moved.some((p) => p.id === wb.id));
  await b.next(OP.TICK, (m) => m.moved.some((p) => p.id === wa.id));
  return { a, b, far, ids: { a: wa.id, b: wb.id, far: wf.id } };
}

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
    a.ws.send(encodeHit(ids.b, 34));
    const hurt = await b.next(OP.HURT);
    assert.deepEqual(hurt, { op: OP.HURT, from: ids.a, damage: 34 });
    a.ws.send(encodeHit(ids.far, 34)); // 2 km off: not believed
    a.ws.send(encodeHit(ids.a, 34)); // itself: ignored
    b.ws.send(encodeDown(ids.a));
    const told = await far.next(OP.CHAT_LINE);
    assert.deepEqual(told, { op: OP.CHAT_LINE, from: 0, name: '', text: 'Ana mató a Beto' });
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
    assert.deepEqual(await b.next(OP.CHAT_LINE, (m) => m.from === 0), { op: OP.CHAT_LINE, from: 0, name: '', text: 'Ana cambió el clima' });
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

void test('with a static folder the server is the game page too, and serves nothing else of the folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-static-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Slop</title>');
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
