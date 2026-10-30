// server/test/client.ts
// What the server's tests share: a test client that records every frame it is sent, and a room of three players
// (two near each other, one 2 km off).
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { OP, encodeHello, encodeState, decodeServer } from '../../shared/protocol.ts';
import type { ServerMessage } from '../../shared/protocol.ts';

export const quiet = () => { /* the tests don't print the joins & leaves */ };

type ServerOp = ServerMessage['op'];
type Frame<O extends ServerOp> = Extract<ServerMessage, { op: O }>;
interface Waiter {
  match: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
}

// A test client that records every decoded frame and lets a test wait for one of an opcode matching a predicate
export function connect(port: number) {
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

export const pose = (x: number, z: number, mode = 'car') => encodeState({ position: { x, y: 0, z }, heading: 0, speed: 5 }, mode);

export async function threePlayers(port: number) {
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
