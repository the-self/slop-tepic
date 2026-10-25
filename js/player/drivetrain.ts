// js/player/drivetrain.ts
// The player's car as a machine: engine torque curve, gearbox (automatic or manual), clutch launch, rev limiter,
// nitro, brakes, tyre traction, aerodynamic drag and rolling resistance, built from each car model's real figures. It turns the driver's inputs
// into the car's speed along its heading, its engine revs and the gear it is in (the HUD's tachometer, the engine's
// sound). Plain numbers, no three.js, so node --test runs it (tests/drivetrain.test.mjs).
//
// Units: metres, seconds, kilograms, newtons, newton-metres, rpm. Speeds in m/s along the car's heading (negative
// in reverse).

import type { CarBody, CarClass, CarModel } from '../models/cars/index.ts';

/** A car or moto model (js/models/cars/README.md) with the drivetrain buildSpec memoized on it */
export type DriveModel = CarModel & { _spec?: DriveSpec };

/** A class's tyres, brakes & gearbox: friction coefficient, ABS braking (m/s²), s an automatic takes to shift */
export interface DriveClass {
  grip: number;
  brake: number;
  shift: number;
}

/** A car's drivetrain, built from its model (buildSpec). Units as the header's */
export interface DriveSpec {
  name: string; // the model's id
  label: string; // its name, for the HUD
  electric: boolean;
  mass: number; // kg
  rolling: number; // rolling resistance coefficient
  wheelRadius: number; // m
  driven: number; // share of the weight on the driven wheels while accelerating
  grip: number; // tyre friction coefficient
  brake: number; // m/s² of ABS braking
  shiftTime: number; // s
  idle: number; // rpm
  redline: number; // rpm
  launch: number; // rpm the clutch slips at pulling away
  torque: [number, number][]; // the torque curve: [rpm, N·m] points
  gears: number[]; // gearbox ratios, first to top
  reverse: number; // ratio
  final: number; // final drive ratio
  efficiency: number; // of the driveline, 0..1
  wheelbase: number; // m
  steerLock: number; // rad
  engineBrake: number; // N·m at the redline off the throttle
  regen: number; // N of an electric car's regenerative braking
  vmax: number; // m/s behind a limiter, Infinity without one
  dragArea: number; // m², Cd·A
  nitro: boolean;
  pull: number; // the drive force's calibration (calibratePull)
  drive: CarModel['drive'];
  cls: CarClass;
}

/** The drivetrain's running state (createDriveState): gear (-1 reverse, 0 neutral, 1..n), revs, nitro tank 0..1 */
export interface DriveState {
  gear: number;
  rpm: number;
  manual: boolean; // the manual gearbox (E / Q, T)
  shift: number; // s left of the shift under way (no drive meanwhile)
  lock: number; // s before an automatic may shift again
  nitro: number;
  nitroOn: boolean;
  load: number; // 0..1, the engine sound's
  limiter: boolean;
  wheelspin: boolean;
  braking: boolean;
  reversing: boolean;
  power: number; // 0..1, what the damage leaves of the engine
}

/** One step's inputs to stepDrive (see there) */
export interface DriveInput {
  throttle?: number;
  brake?: number;
  handbrake?: boolean;
  nitro?: boolean;
  shift?: number;
  slope?: number;
  power?: number;
  grip?: number;
}


const G = 9.81;
const AIR = 1.2; // kg/m³, air density near sea level (Tepic sits at ~920 m: ~1.08, close enough)
const RPM_PER_RAD_S = 60 / (2 * Math.PI);

// Tyres, brakes & gearbox by class (friction coefficient, ABS braking in m/s², s an automatic takes to shift): economy
// tyres, family cars, trucks, premium sedans, sports cars, supercars on semi-slicks
// (a class the table leaves out drives on economy tyres)
const CLASSES: Readonly<Partial<Record<CarClass, DriveClass>>> & { readonly economy: DriveClass } = {
  economy: { grip: 0.9, brake: 8.3, shift: 0.28 },
  family: { grip: 0.93, brake: 8.6, shift: 0.26 },
  truck: { grip: 0.85, brake: 7.8, shift: 0.3 },
  premium: { grip: 0.98, brake: 9.2, shift: 0.18 },
  sport: { grip: 1.05, brake: 9.8, shift: 0.12 },
  super: { grip: 1.15, brake: 10.6, shift: 0.06 }, // (dual-clutch boxes)
  moto: { grip: 1.0, brake: 7.5, shift: 0.14 }
};
// Dynamic tyre radius (m) by body shape
const WHEEL_RADIUS: Readonly<Partial<Record<CarBody, number>>> = { moto: 0.29, sedan: 0.31, taxi: 0.29, hatch: 0.3, coupe: 0.34, fastback: 0.34, suv: 0.36, pickup: 0.38, van: 0.33, wedge: 0.44,
  crossover: 0.37, supercar: 0.34, offroad: 0.46 };
// Weight on the driven wheels while accelerating: a front-drive car's ~60 % on the front lightens as it squats, a
// rear-drive car's rear gains it, all-wheel drive uses all of it
const DRIVEN: Readonly<Record<CarModel['drive'], number>> = { fwd: 0.56, rwd: 0.62, awd: 1.0 };
const EFFICIENCY: Readonly<Record<CarModel['drive'], number>> = { fwd: 0.9, rwd: 0.88, awd: 0.85 };

// Gear ratios for an n-speed box: a short first, an overdrive top, the steps closing up towards the top
function gearRatios(n: number): number[] {
  if (n <= 1) return [1];
  const first = n <= 5 ? 3.45 : n === 6 ? 3.6 : n <= 8 ? 4.4 : 4.7;
  const top = n <= 5 ? 0.78 : n === 6 ? 0.72 : n === 7 ? 0.68 : n === 8 ? 0.67 : 0.62;
  return Array.from({ length: n }, (_, i) => first * Math.pow(top / first, Math.pow(i / (n - 1), 0.82)));
}

// The engine's torque curve from its data-sheet peaks: rising to peak torque (a turbo holds it on a plateau), then
// falling off as power peaks and the revs reach the redline. An electric motor: full torque from 0 rpm up to where it
// reaches full power, constant power from there
function torqueCurve(m: DriveModel, idle: number): [number, number][] {
  const [kW, powerRpm] = m.power;
  const [peak, peakRpm] = m.torque;
  const atPower = (rpm: number, k = 1) => k * kW * 1000 / (rpm / RPM_PER_RAD_S);
  if (m.electric) {
    const base = Math.min(m.redline * 0.6, kW * 1000 / peak * RPM_PER_RAD_S);
    const pts: [number, number][] = [[0, peak], [base, peak]];
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const rpm = base + (m.redline - base) * f;
      pts.push([rpm, atPower(rpm, f === 1 ? 0.9 : 1)]);
    }
    return pts;
  }
  const tq = Math.min(peakRpm, powerRpm * 0.85);
  const pts: [number, number][] = [[idle, peak * 0.6], [(idle + tq) / 2, peak * 0.86], [tq, peak]];
  if (tq < powerRpm * 0.5) pts.push([powerRpm * 0.75, Math.min(peak, atPower(powerRpm * 0.75, 0.97))]); // (a turbo)
  pts.push([powerRpm, Math.min(peak, atPower(powerRpm))]);
  if (m.redline > powerRpm + 100) pts.push([m.redline, Math.min(peak, atPower(m.redline, 0.9))]);
  return pts;
}

/**
 * The drivetrain of a car model (js/models/cars, README.md there) from its real figures: the torque curve, gear ratios
 * & final drive geared so its top gear reaches the top speed, and the drag area that makes its power hold it there,
 * so each car tops out at its maker's top speed (or its limiter). Memoized on the model.
 */
function buildSpec(m: DriveModel): DriveSpec {
  if (m._spec) return m._spec;
  const cls = CLASSES[m.class] ?? CLASSES.economy;
  const r = m.wheelRadius || WHEEL_RADIUS[m.body] || 0.32;
  const idle = m.electric ? 0 : m.redline > 7000 ? 900 : 750;
  const vmax = m.top / 3.6;
  const gears = gearRatios(m.electric ? 1 : m.gears);
  const n = gears.length;
  // top gear reaches the redline a little past the top speed (well past it behind a limiter, or with many gears)
  const reach = vmax * (m.limited ? 1.1 : 1.03) * (n > 6 ? 1 + 0.05 * (n - 6) : 1);
  const final = m.redline / RPM_PER_RAD_S * r / (reach * gears[n - 1]);
  const efficiency = m.electric ? 0.92 : EFFICIENCY[m.drive] || 0.88;
  const rolling = m.class === 'truck' ? 0.014 : 0.012;
  const spec: DriveSpec = {
    name: m.id, label: m.name, electric: Boolean(m.electric), mass: m.mass, rolling, wheelRadius: r,
    driven: DRIVEN[m.drive] || 0.6, grip: cls.grip, brake: cls.brake, shiftTime: cls.shift,
    idle, redline: m.redline, launch: m.electric ? 0 : Math.min(m.redline * 0.5, Math.max(2000, m.torque[1] * 0.8)),
    torque: torqueCurve(m, idle), gears, reverse: gears[0], final, efficiency,
    wheelbase: m.size[0] * 0.6, steerLock: m.size[0] > 5.2 ? 0.52 : 0.58,
    engineBrake: m.torque[0] * 0.2, regen: m.electric ? 0.12 * m.mass * G : 0,
    vmax: m.limited ? vmax : Infinity, dragArea: 0.7,
    // a nitrous kit: the sports cars and supercars come with one (not an electric), the rest of the traffic doesn't;
    // a model's `nitro` says otherwise
    nitro: m.nitro ?? (!m.electric && (m.class === 'sport' || m.class === 'super')),
    pull: 1, // (see calibratePull)
    drive: m.drive, cls: m.class
  };
  fitDrag(spec, m);
  if (m.accel) calibratePull(spec, m, m.accel);
  m._spec = spec;
  return spec;
}

// Drag area so that the power at the top-speed revs (in top gear) just holds the top speed (or a little over the
// limiter): P·η = (Crr·m·g + ½ρ·CdA·v²)·v
function fitDrag(spec: DriveSpec, m: DriveModel): void {
  const vmax = m.top / 3.6;
  const v = m.limited ? vmax * 1.06 : vmax;
  const rpm = wheelRpm(spec, spec.gears.length, v);
  const power = torqueAt(spec, Math.min(rpm, m.redline)) * spec.pull * rpm / RPM_PER_RAD_S * spec.efficiency;
  const rolling = spec.rolling * m.mass * G;
  spec.dragArea = Math.max(m.body === 'moto' ? 0.3 : 0.4, Math.min(1.8, (power - rolling * v) / (0.5 * AIR * v * v * v)));
}

// Seconds from a standstill to 100 km/h at full throttle (no nitro), or Infinity
function zeroTo100(spec: DriveSpec, dt = 1 / 30): number {
  const d = createDriveState(spec);
  const input = { throttle: 1, power: 1 };
  let v = 0;
  for (let t = dt; t < 30; t += dt) {
    v = stepDrive(d, spec, input, v, dt);
    if (v >= 100 / 3.6) return t;
  }
  return Infinity;
}

// The figures above leave out what makes a fast car fast off the line (launch control, sticky tyres, the weight
// thrown onto the driven wheels, an electric car's motors' own reductions) and a slow one slow (the CVT, the
// part-throttle maps): `pull` scales the drive force (and the tyres' launch grip, never below the class's) until the car
// does its maker's 0-100 km/h (`accel`, s), with the drag refitted each time so it still tops out where it should
const PULL_MIN = 0.3, PULL_MAX = 4;
function calibratePull(spec: DriveSpec, m: DriveModel, accel: number): void {
  let lo = PULL_MIN, hi = PULL_MAX;
  for (let i = 0; i < 16; i++) {
    spec.pull = (lo + hi) / 2;
    fitDrag(spec, m);
    if (zeroTo100(spec) > accel) lo = spec.pull;
    else hi = spec.pull;
  }
  spec.pull = (lo + hi) / 2;
  fitDrag(spec, m);
}

const NITRO_BURN = 0.24; // tank per second at full nitro (a full tank lasts ~4 s)
const NITRO_REFILL = 0.045; // tank per second while not in use (~22 s from empty)
const NITRO_POWER = 1.65; // engine torque multiplier while it flows
const SHIFT_TIME = { auto: 0.28, manual: 0.16 }; // s with the clutch out (no drive)
const SHIFT_LOCK = 0.55; // s an automatic waits before shifting again (no hunting around a shift point)

function torqueAt(spec: DriveSpec, rpm: number): number {
  const t = spec.torque;
  if (rpm <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (rpm <= t[i][0]) {
      const k = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k;
    }
  }
  return t[t.length - 1][1];
}

// Overall ratio (gearbox × final drive) in gear g: -1 reverse, 0 neutral, 1..n
function ratioOf(spec: DriveSpec, gear: number): number {
  if (gear === 0) return 0;
  return (gear < 0 ? spec.reverse : spec.gears[gear - 1]) * spec.final;
}

// Engine rpm with the clutch closed in gear g at speed v
function wheelRpm(spec: DriveSpec, gear: number, v: number): number {
  return Math.abs(v) / spec.wheelRadius * ratioOf(spec, gear) * RPM_PER_RAD_S;
}

// The speed (m/s) the engine reaches in gear g at its redline: the top of each gear
function gearTopSpeed(spec: DriveSpec, gear: number): number {
  return spec.redline / RPM_PER_RAD_S * spec.wheelRadius / ratioOf(spec, gear);
}

function createDriveState(spec: DriveSpec): DriveState {
  return {
    gear: 1, rpm: spec.idle, manual: false, shift: 0, lock: 0, nitro: spec.nitro ? 1 : 0, nitroOn: false,
    load: 0, limiter: false, wheelspin: false, braking: false, reversing: false, power: 1
  };
}

// Engages gear g if the engine can take it (a manual downshift that would over-rev it is refused)
function selectGear(d: DriveState, spec: DriveSpec, gear: number, v: number): boolean {
  const n = spec.gears.length;
  gear = Math.max(-1, Math.min(n, gear));
  if (gear === d.gear) return false;
  if (gear > 0 && gear < d.gear && wheelRpm(spec, gear, v) > spec.redline + 200) return false;
  d.gear = gear;
  d.shift = Math.min(spec.shiftTime || SHIFT_TIME.auto, d.manual ? SHIFT_TIME.manual : SHIFT_TIME.auto);
  d.lock = SHIFT_LOCK;
  return true;
}

// The automatic's shift schedule: up near the redline under full throttle and early when cruising, down when the
// revs sag (kickdown under full throttle), never into a gear that would over-rev
function autoShift(d: DriveState, spec: DriveSpec, v: number, throttle: number): void {
  if (d.gear < 1 || d.lock > 0) return;
  const n = spec.gears.length;
  const rpm = wheelRpm(spec, d.gear, v);
  const up = spec.redline * (0.5 + 0.44 * throttle);
  const down = spec.redline * (0.24 + 0.36 * throttle);
  if (d.gear < n && rpm > up) selectGear(d, spec, d.gear + 1, v);
  else if (d.gear > 1 && rpm < down && wheelRpm(spec, d.gear - 1, v) < up * 0.92) selectGear(d, spec, d.gear - 1, v);
}

/**
 * One step of the car along its heading. `input`: throttle 0..1 (W), brake 0..1 (S), handbrake, nitro (booleans),
 * shift (+1 / -1 for a manual shift this frame, 0 otherwise), slope (m/s² the hill adds along the heading), power
 * (0..1, what the damage leaves of the engine), grip (0..1, what the road leaves of the tyres' dry grip: a wet one
 * ~0.7, see weather.ts wetGrip). Returns the new speed; d holds the gear, revs and the rest.
 */
function stepDrive(d: DriveState, spec: DriveSpec, input: DriveInput, v: number, dt: number): number {
  const throttleKey = input.throttle || 0;
  const brakeKey = input.brake || 0;
  d.lock = Math.max(0, d.lock - dt);
  d.shift = Math.max(0, d.shift - dt);
  d.power = input.power ?? 1;

  // S at a standstill selects reverse and W selects first again; otherwise S brakes going forwards and W going back
  let throttle = 0, brake = 0;
  if (d.gear < 0) {
    if (throttleKey && v > -0.6) { d.gear = 1; d.shift = 0; }
    else { throttle = brakeKey; brake = throttleKey; }
  }
  if (d.gear >= 0) {
    if (brakeKey && v < 0.6 && !throttleKey) { d.gear = -1; d.shift = 0; throttle = brakeKey; }
    else { throttle = throttleKey; brake = brakeKey; }
  }
  if (d.gear === 0) d.gear = 1; // (neutral only exists between shifts)
  if (input.shift && d.gear > 0 && !spec.electric) {
    d.manual = true;
    selectGear(d, spec, d.gear + input.shift, v);
  }
  if (!d.manual) autoShift(d, spec, v, throttle);

  const dir = d.gear < 0 ? -1 : 1;
  const ratio = ratioOf(spec, d.gear);
  const coupled = wheelRpm(spec, d.gear, v);
  // Pulling away the clutch slips (the converter, in an automatic): the engine holds its launch revs and its torque
  // reaches the wheels until the car catches up with it
  const slipping = !spec.electric && (d.gear === 1 || d.gear === -1) && coupled < spec.launch && throttle > 0;
  let rpm = Math.max(spec.idle, slipping ? spec.launch : coupled);
  d.limiter = coupled >= spec.redline;
  d.nitroOn = Boolean(spec.nitro && input.nitro && throttle > 0 && d.nitro > 0 && d.gear > 0 && d.power > 0);
  if (spec.nitro) d.nitro = d.nitroOn ? Math.max(0, d.nitro - NITRO_BURN * dt) : Math.min(1, d.nitro + NITRO_REFILL * dt);

  // Drive force at the wheels, cut while shifting and by the rev limiter, limited by what the tyres can put down
  let drive = 0;
  if (!d.shift && !d.limiter && throttle > 0 && !(d.gear > 0 && v >= spec.vmax)) {
    const torque = torqueAt(spec, Math.min(rpm, spec.redline)) * spec.pull * throttle * (d.nitroOn ? NITRO_POWER : 1) * d.power;
    drive = torque * ratio * spec.efficiency / spec.wheelRadius;
  }
  // Traction control holds the tyres at their limit; with far more torque than that they still break loose
  const grip = input.grip ?? 1;
  const traction = spec.grip * grip * spec.mass * G * spec.driven * Math.max(1, spec.pull);
  d.wheelspin = drive > traction * 1.25;
  if (d.wheelspin) rpm = Math.min(spec.redline, rpm + Math.min(1, drive / traction - 1.25) * 1500); // the engine flares
  if (drive > traction) drive = traction * (d.wheelspin ? 0.88 : 0.97);

  // Everything that slows the car: brakes (ABS, close to the tyres' limit), handbrake (locked rear wheels),
  // engine braking off the throttle, rolling resistance, air drag
  const speed = Math.abs(v);
  let resist = 0;
  if (brake > 0) resist += brake * spec.brake * grip * spec.mass;
  if (input.handbrake) resist += 0.45 * grip * spec.mass * G * 0.5;
  if (!throttle && !d.shift) {
    // off the throttle: engine braking, or an electric car's regenerative braking (fading out as it stops)
    resist += spec.electric ? spec.regen * Math.min(1, speed / 5) : spec.engineBrake * (rpm / spec.redline) * ratio / spec.wheelRadius;
  }
  if (speed > 0.05) resist += spec.rolling * spec.mass * G + 0.5 * AIR * spec.dragArea * speed * speed;

  // A car held standing (no keys, not rolling) keeps its handbrake on: the hill doesn't move it
  const slope = throttle || speed > 0.3 ? (input.slope || 0) : 0;
  let next = v + (dir * drive / spec.mass + slope) * dt;
  // resistance only ever brings the speed towards zero, never through it
  const slow = resist / spec.mass * dt;
  next = Math.abs(next) <= slow ? 0 : next - Math.sign(next) * slow;

  // The revs the tachometer & engine sound follow: quick to rise, a little slower to fall, dipping to the new gear
  // during a shift; bouncing on the limiter
  const target = d.limiter ? spec.redline - 250 * Math.random() : Math.max(spec.idle, slipping || d.wheelspin ? rpm
    : Math.max(wheelRpm(spec, d.gear, next), !throttle && speed < 1 ? spec.idle : 0));
  const blipped = d.shift ? wheelRpm(spec, d.gear, next) : target;
  d.rpm += (Math.max(spec.idle, Math.min(spec.redline, blipped)) - d.rpm) * (1 - Math.exp(-dt * (blipped > d.rpm ? 14 : 9)));
  d.load = d.shift ? 0.2 : throttle * (d.nitroOn ? 1 : 0.9) * d.power;
  d.braking = brake > 0 || Boolean(input.handbrake);
  d.reversing = d.gear < 0;
  return next;
}

// What the HUD shows for the gear: R, D (an electric car's one gear) or the gear's number
function gearLabel(d: DriveState, spec: DriveSpec | null = null): string {
  return d.gear < 0 ? 'R' : spec?.electric ? 'D' : String(d.gear);
}

export {
  CLASSES,
  buildSpec,
  gearRatios,
  torqueAt,
  ratioOf,
  wheelRpm,
  gearTopSpeed,
  createDriveState,
  selectGear,
  stepDrive,
  gearLabel,
  zeroTo100
};
