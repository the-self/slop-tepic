// shared/wire.ts
// The byte writer and reader the multiplayer protocol's frames are made with (shared/protocol.ts and
// shared/protocol-play.ts): fixed-width little-endian integers, strings as a u8 byte length and their UTF-8 bytes,
// a pose and a shot in wire units. Free of the DOM and of Node, as the protocol is.

/** A pose in wire units: x/y/z in centimetres, h in 1/65536 turns, m the MODES index, s the speed in dm/s */
export interface WirePose {
  x: number;
  y: number;
  z: number;
  h: number;
  m: number;
  s: number;
}

/** A shot's two ends in wire units (cm), its weapon's id and flags (SHOT_ROCKET) */
export interface WireShot {
  ox: number;
  oy: number;
  oz: number;
  ex: number;
  ey: number;
  ez: number;
  weapon: string;
  flags: number;
}

/** What decodeClient / decodeServer read: a whole frame, as a byte view or its buffer */
export type FrameData = Uint8Array | ArrayBuffer;

const WEAPON_MAX = 16; // characters in a weapon's id

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

// Growable little-endian byte writer
class Writer {
  bytes: Uint8Array<ArrayBuffer>;
  view: DataView;
  at: number;

  constructor(size = 256) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  room(n: number): void {
    if (this.at + n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.at + n));
    bigger.set(this.bytes);
    this.bytes = bigger;
    this.view = new DataView(bigger.buffer);
  }
  u8(v: number): void { this.room(1); this.view.setUint8(this.at, v); this.at += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.at, v, true); this.at += 2; }
  i16(v: number): void { this.room(2); this.view.setInt16(this.at, v, true); this.at += 2; }
  i32(v: number): void { this.room(4); this.view.setInt32(this.at, v, true); this.at += 4; }
  u32(v: number): void { this.room(4); this.view.setUint32(this.at, v >>> 0, true); this.at += 4; }
  str(s: string): void {
    let b = utf8.encode(s);
    if (b.length > 255) b = b.subarray(0, 255);
    this.u8(b.length);
    this.room(b.length);
    this.bytes.set(b, this.at);
    this.at += b.length;
  }
  pose(st: WirePose): void {
    this.i32(st.x); this.i32(st.y); this.i32(st.z); this.u16(st.h); this.u8(st.m); this.i16(st.s);
  }
  shot(s: WireShot): void {
    this.i32(s.ox); this.i32(s.oy); this.i32(s.oz); this.i32(s.ex); this.i32(s.ey); this.i32(s.ez);
    this.str(Array.from(s.weapon).slice(0, WEAPON_MAX).join(''));
    this.u8(s.flags);
  }
  done(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.at);
  }
}

// Bounds-checked reader; any overrun throws RangeError, which decoders turn into "malformed"
class Reader {
  bytes: Uint8Array;
  view: DataView;
  at: number;

  constructor(data: FrameData) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }
  /** Whether bytes are left to read (an older peer's frame ends before a newer one's last fields) */
  more(): boolean { return this.at < this.bytes.length; }
  u8(): number { const v = this.view.getUint8(this.at); this.at += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  i16(): number { const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  i32(): number { const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  u32(): number { const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  str(): string {
    const n = this.u8();
    if (this.at + n > this.bytes.length) throw new RangeError('string overruns frame');
    const s = utf8Decode.decode(this.bytes.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
  pose(): WirePose {
    return { x: this.i32(), y: this.i32(), z: this.i32(), h: this.u16(), m: this.u8(), s: this.i16() };
  }
  shot(): WireShot {
    return { ox: this.i32(), oy: this.i32(), oz: this.i32(), ex: this.i32(), ey: this.i32(), ez: this.i32(), weapon: this.str(), flags: this.u8() };
  }
}

const TURN = 2 * Math.PI;
const toCm = (m: number) => Math.round(m * 100);
const toHeading = (rad: number) => Math.round((((rad % TURN) + TURN) % TURN) / TURN * 65536) & 0xffff;
const fromHeading = (h: number) => (h / 65536) * TURN;
const toSpeed = (ms: number) => Math.max(-32768, Math.min(32767, Math.round(ms * 10)));
const capped = (text: string, max: number) => Array.from(text).slice(0, max).join('');

export { Writer, Reader, WEAPON_MAX, TURN, toCm, toHeading, fromHeading, toSpeed, capped };
