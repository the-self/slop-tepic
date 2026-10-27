const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
const { cruiserBody, driveCruiserBody, dropCruiserBody } = loadModule(read('js/sim/crime/cruiser-bodies.ts'), {
  imports: {
    '../../player/car-physics.ts': { steerLimit: (lock) => lock, suspensionOf: () => [1.4, 0.1] },
    '../weapons.ts': { wrapAngle },
    './constants.ts': { CRUISER: { accel: 7.5, brake: 14 }, clamp }
  }
});

// Jolt's vehicles as far as the patrol cars use them: added where asked, moved by shoves, read back as they are
function fakePhysics() {
  const log = { added: [], removed: [], shoves: [], placed: [] };
  const out = (x, z, heading, vx = 0, vz = 0) => ({
    x, y: 0, z, heading, vx, vy: 0, vz, qx: 0, qy: 0, qz: 0, qw: 1, forward: vx * Math.sin(heading) + vz * Math.cos(heading),
    uy: 1, hit: { speed: 0, other: null }
  });
  const physics = {
    add(def, x, y, z, yaw) {
      const v = { def, wheelbase: 2.6, out: out(x, z, yaw), input: null };
      log.added.push(v);
      return v;
    },
    remove(v) { log.removed.push(v); },
    shove(v, dvx, dvy, dvz, dwx, dwy, dwz, dx = 0, dz = 0) {
      log.shoves.push({ dvx, dvy, dvz, dx, dz });
      v.out.vx += dvx; v.out.vz += dvz; v.out.x += dx; v.out.z += dz;
    },
    place(v, x, y, z, yaw) { log.placed.push([x, z]); Object.assign(v.out, out(x, z, yaw)); },
    read: (v) => v.out
  };
  return { physics, log };
}
function cruiser(x, z, heading = 0, speed = 0) {
  const quat = { set() {} }, rot = { set() {} };
  return {
    faction: 'police', mass: 1600, halfW: 0.92, halfL: 2.3, x, y: 0, z, heading, speed, vx: 0, vz: 0, vy: 0, lift: 0, pitch: 0, roll: 0,
    body: null, mesh: { position: { set() {} }, quaternion: quat, rotation: rot }, tiltPivot: { rotation: rot }, position: { set() {} }
  };
}
const crimeAt = (physics, px, pz) => ({ physics, px, pz, groundAt: () => 0 });

test('a patrol car near the player is a car in Jolt, moving as it was; far off it drives on the map', () => {
  const { physics, log } = fakePhysics();
  const crime = crimeAt(physics, 0, 0);
  const far = cruiser(200, 0);
  assert.equal(cruiserBody(crime, far), null);
  assert.equal(log.added.length, 0);
  const near = cruiser(30, 0, Math.PI / 2, 12);
  const b = cruiserBody(crime, near);
  assert.ok(b);
  assert.equal(b.v.owner, near, 'its body knows whose it is (the player\'s crash reports it)');
  assert.equal(b.v.def.mass, 1600);
  assert.ok(Math.abs(log.shoves[0].dvx - 12) < 1e-9, 'set off at its speed');
  assert.ok(Math.abs(near.speed - 12) < 1e-9, 'read back: its speed along itself');
  // driven off past the far edge: out of Jolt, on the map from where it is
  b.v.out.x = 400;
  assert.equal(cruiserBody(crime, near), b, 'read where Jolt left it...');
  assert.equal(near.x, 400);
  assert.equal(cruiserBody(crime, near), null, '...and let go');
  assert.deepEqual(log.removed, [b.v]);
  assert.equal(near.body, null);
});

test('a shove of the traffic\'s or a blast after it was read goes into its body; set down elsewhere, it is placed', () => {
  const { physics, log } = fakePhysics();
  const crime = crimeAt(physics, 0, 0);
  const cr = cruiser(10, 0);
  const b = cruiserBody(crime, cr);
  log.shoves.length = 0;
  // the traffic shoved it 0.3 m aside and knocked it 2 m/s that way, and a blast threw it up
  cr.x += 0.3;
  cr.vx += 2;
  cr.vy = 6;
  cruiserBody(crime, cr);
  assert.equal(log.shoves.length, 1);
  const s = log.shoves[0];
  assert.ok(Math.abs(s.dx - 0.3) < 1e-9 && Math.abs(s.dvx - 2) < 1e-9 && s.dvy === 6);
  assert.equal(cr.vy, 0, 'the throw is carried in once');
  // an ambulance brought on out of sight (sim/emergency.ts): set down there, not dragged there
  cr.x = 60;
  cruiserBody(crime, cr);
  assert.deepEqual(log.placed, [[60, 0]]);
  dropCruiserBody(crime, cr);
  assert.deepEqual(log.removed, [b.v]);
});

test('its driver works the pedals and the wheel: towards the speed it wants, the wheel the way it wants to go', () => {
  const { physics } = fakePhysics();
  const cr = cruiser(10, 0);
  const b = cruiserBody(crimeAt(physics, 0, 0), cr);
  driveCruiserBody(cr, b, 20, 0.2, 1 / 30);
  assert.ok(Math.abs(b.input.force - 1600 * 7.5) < 1e-6, 'its acceleration from a standstill');
  assert.ok(b.input.steer < 0, 'turning left (+) is Jolt\'s -');
  driveCruiserBody(cr, b, 0, 0, 1 / 30);
  assert.equal(b.input.hold, true, 'standing: the brakes on');
});
