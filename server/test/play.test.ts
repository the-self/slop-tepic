import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../index.ts';
import type { RankingList } from '../index.ts';
import { Crews } from '../crews.ts';
import { PlayerChecks } from '../checks.ts';
import { Vitals } from '../vitals.ts';
import { OP, encodeHello, encodeShot, encodeHit, encodeDown, encodeState } from '../../shared/protocol.ts';
import type { WirePose } from '../../shared/protocol.ts';
import { encodeCrew, encodePassive, encodeWanted, encodeLook, encodeUnits, CREW_MAX } from '../../shared/protocol-play.ts';
import { quiet, connect, pose, threePlayers } from './client.ts';

const pistol = { ox: 0, oy: 1.4, oz: 0, ex: 10, ey: 1.2, ez: 0, weapon: 'pistol', rocket: false };
const pistolAt = (x: number, z = 0) => ({ ...pistol, ex: x, ez: z });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

void test('crews: an invitation accepted puts both in one crew, mates can\'t hurt each other, and leaving breaks it up', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    a.ws.send(encodeCrew('invite', ids.b));
    const ask = await b.next(OP.CREW_ASK);
    assert.deepEqual(ask, { op: OP.CREW_ASK, from: ids.a, name: 'Ana' });
    b.ws.send(encodeCrew('accept', ids.a));
    const set = await a.next(OP.CREW_SET, (m) => m.members.length === 2);
    assert.ok(set.crew > 0);
    assert.deepEqual(set.members.map((m) => m.name).sort(), ['Ana', 'Beto']);
    assert.equal((await b.next(OP.CREW_SET)).crew, set.crew, 'both in the one crew');
    // Beto sees Ana's tag: her crew, which is his
    assert.equal((await b.next(OP.TAG, (m) => m.id === ids.a)).crew, set.crew);

    // a mate's shot doesn't hurt
    a.ws.send(encodeShot(pistol));
    a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    await wait(100);
    assert.ok(!b.frames.some((m) => m.op === OP.HURT), 'no friendly fire');

    // and Far, 2 km off, is still in Ana's view once he is in her crew
    a.ws.send(encodeCrew('invite', ids.far));
    far.ws.send(encodeCrew('accept', ids.a));
    await a.next(OP.TICK, (m) => m.info.some((i) => i.id === ids.far));

    b.ws.send(encodeCrew('leave'));
    assert.equal((await b.next(OP.CREW_SET, (m) => m.crew === 0)).members.length, 0);
    await a.next(OP.CREW_SET, (m) => m.members.length === 2 && !m.members.some((x) => x.id === ids.b));
    a.ws.send(encodeShot(pistol));
    a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    assert.equal((await b.next(OP.HURT)).damage, 34, 'out of the crew, fair game again');
    for (const c of [a, b, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a crew holds CREW_MAX at most, an invitation needs inviting, and one of two left alone is in none', () => {
  const crews = new Crews();
  assert.equal(crews.accept(2, 1, 0), null, 'never invited');
  assert.ok(crews.invite(1, 2, 0));
  assert.equal(crews.accept(2, 1, 61000), null, 'an invitation goes stale');
  for (let i = 2; i <= CREW_MAX; i++) {
    crews.invite(1, i, 0);
    assert.ok(crews.accept(i, 1, 0));
  }
  assert.equal(crews.mates(1).size, CREW_MAX);
  assert.ok(!crews.invite(1, 99, 0), 'full');
  for (let i = 2; i <= CREW_MAX; i++) crews.leave(i);
  assert.equal(crews.crew(1), 0, 'the last one left is in no crew');
});

void test('passive mode: no hits either way, and not right after a fight', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, ids } = await threePlayers(server.port);
    a.ws.send(encodeShot(pistol));
    a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    await b.next(OP.HURT);
    // Beto was just hurt: he can't duck out into passive mode yet
    b.ws.send(encodePassive(true));
    const refused = await b.next(OP.TAG, (m) => m.id === ids.b);
    assert.equal(refused.passive, false);
    // Ana, who hurt nobody... well, she did: neither can she. A third, fresh player can
    const c = connect(server.port);
    await c.opened;
    c.ws.send(encodeHello('nayarit', 'Carla'));
    const wc = await c.next(OP.WELCOME);
    c.ws.send(pose(5, 5, 'person'));
    c.ws.send(encodePassive(true));
    assert.equal((await c.next(OP.TAG, (m) => m.id === wc.id)).passive, true);
    assert.equal((await a.next(OP.TAG, (m) => m.id === wc.id)).passive, true, 'those who see her know it');
    a.ws.send(encodeShot(pistolAt(5, 5)));
    a.ws.send(encodeHit(wc.id, 34, 'pistol'));
    await wait(100);
    assert.ok(!c.frames.some((m) => m.op === OP.HURT), 'a player in passive mode is not hurt');
    for (const x of [a, b, c]) x.ws.close();
  } finally {
    await server.close();
  }
});

void test('the server holds hits to their weapon and kills to whoever landed the last hit', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    a.ws.send(encodeHit(ids.b, 34, 'pistol')); // no shot fired
    a.ws.send(encodeShot(pistol));
    a.ws.send(encodeHit(ids.b, 90, 'pistol')); // more than a pistol does
    a.ws.send(encodeHit(ids.b, 20, 'fists')); // a punch from 10 m
    await wait(100);
    assert.ok(!b.frames.some((m) => m.op === OP.HURT), 'none of those landed');
    // a burst far faster than the pistol fires: a few land, not all
    for (let i = 0; i < 30; i++) {
      a.ws.send(encodeShot(pistol));
      a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    }
    await wait(150);
    const landed = b.frames.filter((m) => m.op === OP.HURT).length;
    assert.ok(landed >= 2 && landed <= 10, `${String(landed)} of 30 landed`);
    // Far names Ana his killer, but she never hit him: nobody killed him
    far.ws.send(encodeDown(ids.a));
    assert.deepEqual(await b.next(OP.NOTE, (m) => m.a === 'Far'), { op: OP.NOTE, kind: 'died', a: 'Far', b: '' });
    for (const c of [a, b, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('moves no faster than the mode goes, a teleport now and then', () => {
  const checks = new PlayerChecks();
  const at = (x: number, m = 0): WirePose => ({ x: x * 100, y: 0, z: 0, h: 0, m, s: 0 });
  assert.ok(checks.move(null, at(0), 0));
  assert.ok(checks.move(at(0), at(8), 1000), 'a walk');
  assert.ok(checks.move(at(8), at(90), 1100), '82 m on foot at once: a teleport (a respawn nearby)');
  assert.ok(checks.move(at(90), at(2000), 1200), 'another, saved up');
  assert.ok(!checks.move(at(2000), at(4000), 1300), 'not a third straight away');
  assert.ok(!checks.move(at(2000), at(4000), 1400), 'nor while it has none');
  assert.ok(checks.move(at(2000), at(4000), 5400), 'one back after a few seconds: through, not stuck');
  assert.ok(checks.move(at(4000), at(4010, 1), 6400), 'a car');
});

void test('a profile: a token on the first visit, the same player with it next time, kills counted, the rankings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-profiles-'));
  let server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, dataDir: dir, log: quiet });
  let token: string;
  try {
    const { a, b, ids } = await threePlayers(server.port);
    const pa = await a.next(OP.PROFILE);
    assert.match(pa.token, /^[a-z2-7]{20}$/);
    token = pa.token;
    a.ws.send(encodeShot(pistol));
    a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    await b.next(OP.HURT);
    b.ws.send(encodeDown(ids.a));
    assert.equal((await a.next(OP.PROFILE, (m) => m.kills === 1)).best, 1);
    assert.equal((await b.next(OP.PROFILE, (m) => m.deaths === 1)).kills, 0);
    for (const c of [a, b]) c.ws.close();
    await wait(50);
  } finally {
    await server.close();
  }
  assert.ok(!fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8').includes(token), 'the file keeps no token');
  server = await createServer({ port: 0, tickHz: 20, dataDir: dir, log: quiet });
  try {
    const again = connect(server.port);
    await again.opened;
    again.ws.send(encodeHello('nayarit', 'Ana', '', '', token));
    const back = await again.next(OP.PROFILE);
    assert.deepEqual([back.token, back.kills], [token, 1], 'the same player, after a restart');
    const list = (await (await fetch(`http://127.0.0.1:${server.port}/rankings`)).json()) as RankingList;
    assert.deepEqual(list.rankings.map((r) => [r.name, r.kills, r.deaths]), [['Ana', 1, 0]]);
    again.ws.close();
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test('a car look, a wanted level and the police after a player reach those who see it, and a newcomer to its view', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, far, ids } = await threePlayers(server.port);
    const look = { body: 'suv', model: 'nissan-xtrail', paint: 0x2a5aa8, police: false };
    a.ws.send(encodeLook(look));
    a.ws.send(encodeWanted(3));
    a.ws.send(encodeUnits([{ kind: 'cruiser', x: 20, y: 0, z: 5, heading: 1, speed: 12 }]));
    assert.deepEqual((await b.next(OP.LOOK_SEEN)).look, look);
    assert.equal((await b.next(OP.TAG, (m) => m.id === ids.a)).stars, 3);
    const units = await b.next(OP.UNITS_SEEN);
    assert.equal(units.from, ids.a);
    assert.deepEqual([units.units[0].kind, units.units[0].x, units.units[0].speed], ['cruiser', 20, 12]);
    await wait(100);
    assert.ok(!far.frames.some((m) => m.op === OP.LOOK_SEEN || m.op === OP.UNITS_SEEN), 'Far is 2 km off');
    // Far drives into view: he learns all three
    far.ws.send(encodeState({ position: { x: 0, y: 0, z: 50 }, heading: 0, speed: 0 }, 'car'));
    assert.equal((await far.next(OP.LOOK_SEEN)).id, ids.a);
    assert.equal((await far.next(OP.TAG, (m) => m.id === ids.a)).stars, 3);
    await far.next(OP.UNITS_SEEN);
    for (const c of [a, b, far]) c.ws.close();
  } finally {
    await server.close();
  }
});

// A round of `weapon` from the shooter at the origin to (x, 0, z) m, in wire units
const round = (weapon: string, x = 20, z = 0, flags = 0) => ({ ox: 0, oy: 140, oz: 0, ex: x * 100, ey: 120, ez: z * 100, weapon, flags });
const at = (x: number, z = 0): WirePose => ({ x: x * 100, y: 0, z: z * 100, h: 0, m: 0, s: 0 });

void test('all of a player\'s guns together deal no more a second than the strongest alone, which still fires freely', () => {
  // a rifle at its own rate for 3 s: every round lands
  const fair = new PlayerChecks();
  let landed = 0;
  for (let t = 0; t < 3000; t += 125) {
    fair.shot(round('rifle'), at(0), t);
    if (fair.hit('rifle', 28, at(0), at(20), t)) landed++;
  }
  assert.equal(landed, 24, 'a rifle at 8 rounds a second');
  // pistol, SMG and rifle interleaved as fast as each fires: held to the one budget
  const cheat = new PlayerChecks();
  let damage = 0;
  for (let t = 0; t < 3000; t += 10) {
    for (const [kind, hp] of [['pistol', 34], ['smg', 16], ['rifle', 28]] as const) {
      cheat.shot(round(kind), at(0), t);
      if (cheat.hit(kind, hp, at(0), at(20), t)) damage += hp;
    }
  }
  assert.ok(damage <= 224 * 1.5 * 4, `${String(damage)} hit points in 3 s, a second saved up`);
  assert.ok(damage >= 224 * 3, 'the strongest gun\'s worth still lands');
});

void test('a hit stands on a shot the server saw: on its line, from where the shooter stood, one round one hit', () => {
  const c = new PlayerChecks();
  assert.ok(!c.hit('pistol', 34, at(0), at(20), 0), 'no shot at all');
  assert.ok(!c.shot(round('pistol'), at(500), 0), 'a shot from 500 m away from the shooter');
  assert.ok(!c.hit('pistol', 34, at(500), at(20), 10));
  assert.ok(c.shot(round('pistol', 20, 0), at(0), 100));
  assert.ok(!c.hit('pistol', 34, at(0), at(0, 20), 110), 'a target off its line');
  assert.ok(c.hit('pistol', 34, at(0), at(20), 120), 'the one it went at');
  assert.ok(!c.hit('pistol', 34, at(0), at(20), 130), 'the same round twice');
  // a blast: near a rocket's line, or where a round ended; not across the city
  assert.ok(c.shot(round('bazooka', 200, 0, 1), at(0), 200));
  assert.ok(c.hit('blast', 90, at(0), at(150, 6), 1500), 'beside the rocket\'s path');
  assert.ok(!c.hit('blast', 90, at(0), at(150, 60), 1600), '60 m off it');
  assert.ok(!c.hit('blast', 90, at(0), at(150, 6), 20000), 'long after');
});

void test('the server keeps the health: hits take it as the game does, reports only lower it, pickups come so often', () => {
  const v = new Vitals();
  v.hurt(40, 'person');
  assert.equal(v.health, 60);
  v.hurt(40, 'car');
  assert.equal(v.health, 38, 'a car shields 45%');
  v.report(100, 100);
  assert.deepEqual([v.health, v.armor], [38, 0], 'a game that says it is whole is not believed');
  v.report(20, 0);
  assert.equal(v.health, 20, 'the city\'s harm, believed');
  assert.ok(v.heal('health', 0));
  assert.ok(v.heal('health', 1));
  assert.ok(!v.heal('health', 2), 'two saved up, then one every 35 s');
  assert.equal(v.health, 100);
  v.hurt(100, 'person');
  assert.ok(v.spent && v.die(5000));
  assert.ok(!v.die(5001), 'dead once');
  assert.ok(!v.revive(6000));
  assert.ok(v.revive(9000) && v.health === 100);
});

void test('a god-mode client still dies, can\'t shoot while dead, and the kill counts once in a while', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    const { a, b, ids } = await threePlayers(server.port);
    // Beto's game ignores its hurts: the server counts them, and kills him on the third
    for (let i = 0; i < 3; i++) {
      a.ws.send(encodeShot(pistolAt(10)));
      a.ws.send(encodeHit(ids.b, 34, 'pistol'));
    }
    assert.deepEqual(await b.next(OP.KILLED), { op: OP.KILLED, by: ids.a });
    assert.deepEqual(await b.next(OP.NOTE, (m) => m.kind === 'killed'), { op: OP.NOTE, kind: 'killed', a: 'Ana', b: 'Beto' });
    assert.equal((await a.next(OP.PROFILE, (m) => m.kills === 1)).kills, 1);
    // dead, his shots strike nobody
    b.ws.send(encodeShot({ ox: 10, oy: 1.4, oz: 0, ex: 0, ey: 1.2, ez: 0, weapon: 'pistol', rocket: false }));
    b.ws.send(encodeHit(ids.a, 34, 'pistol'));
    await wait(100);
    assert.ok(!a.frames.some((m) => m.op === OP.HURT), 'a dead player hurts nobody');
    // his game says it died too: nothing more counted
    b.ws.send(encodeDown(ids.a));
    await wait(100);
    assert.equal(a.frames.filter((m) => m.op === OP.NOTE && m.kind === 'killed').length, 1);
    for (const c of [a, b]) c.ws.close();
  } finally {
    await server.close();
  }
});

void test('a client that keeps making hits it couldn\'t is kicked, and banned when it keeps coming back', async () => {
  const server = await createServer({ port: 0, tickHz: 20, viewRadius: 500, log: quiet });
  try {
    for (let round = 0; round < 3; round++) {
      const { a, b, far, ids } = await threePlayers(server.port);
      // (no shots: every hit refused)
      for (let i = 0; i < 45; i++) {
        a.ws.send(encodeHit(ids.b, 34, 'pistol'));
        if (i % 15 === 14) await wait(500); // (under the server's 40 messages a second)
      }
      const error = await a.next(OP.ERROR);
      assert.equal(error.code, round < 2 ? 'cheat' : 'banned');
      for (const c of [a, b, far]) c.ws.close();
      await wait(50);
    }
    // the same address can't come back
    const again = connect(server.port);
    await again.opened;
    again.ws.send(encodeHello('nayarit', 'Ana'));
    assert.equal((await again.next(OP.ERROR)).code, 'banned');
    again.ws.close();
  } finally {
    await server.close();
  }
});

void test('a page from before the token hears its version is old, instead of retrying forever', async () => {
  const server = await createServer({ port: 0, log: quiet });
  try {
    const old = connect(server.port);
    await old.opened;
    const hello = encodeHello('nayarit', 'Ana').slice(0, -1); // (no token)
    hello[1] = 7;
    old.ws.send(hello);
    assert.equal((await old.next(OP.ERROR)).code, 'version');
  } finally {
    await server.close();
  }
});
