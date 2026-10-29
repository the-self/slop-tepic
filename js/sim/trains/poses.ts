// js/sim/trains/poses.ts
// Where each car of a train stands on the line: its two trucks on the rails (railway.ts railPoint), its body between
// them, turned along the chord they make (a long car cuts the curve as the real one does) and pitched on the town's
// slopes; its velocity along the line. No three.js here, so node --test imports it.
import { railPoint, RAIL_TOP } from '../../world/railway.ts';
import type { RailLine, RailPoint } from '../../world/railway.ts';
import { RAIL_CARS } from '../../models/trains.ts';
import type { TrainCar, TrainRun } from './schedule.ts';

/** A car where it stands: on the rails' top under its middle (m), its heading & pitch (rad: its front's way, nose up
 *  < 0 as three's x turn), its velocity (m/s), its run & car, and how far it is from the eye (m) */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  run: TrainRun | null;
  car: TrainCar | null;
  index: number;
  far: number;
}

const _front: RailPoint = { x: 0, z: 0, dx: 0, dz: 0 };
const _rear: RailPoint = { x: 0, z: 0, dx: 0, dz: 0 };

/**
 * Car `index` of run r, its head `head` m along `line`, into `out` (`ground(x, z)`: the town's floor there). False
 * when it is off the line (not yet on, or gone)
 */
function poseCar(line: RailLine, r: TrainRun, index: number, head: number, ground: (x: number, z: number) => number, out: CarPose): boolean {
  const car = r.cars[index];
  const s = head - r.dir * car.at;
  const half = RAIL_CARS[car.kind].length / 2;
  if (s < -half || s > line.length + half) return false;
  const t = RAIL_CARS[car.kind].trucks;
  railPoint(line, s + r.dir * t, _front);
  railPoint(line, s - r.dir * t, _rear);
  const dx = _front.x - _rear.x, dz = _front.z - _rear.z, d = Math.hypot(dx, dz) || 1;
  const yf = ground(_front.x, _front.z), yr = ground(_rear.x, _rear.z);
  out.x = (_front.x + _rear.x) / 2;
  out.z = (_front.z + _rear.z) / 2;
  out.y = (yf + yr) / 2 + RAIL_TOP;
  out.yaw = Math.atan2(dx, dz) + (car.flip ? Math.PI : 0);
  out.pitch = (car.flip ? 1 : -1) * Math.atan((yf - yr) / d);
  out.vx = (dx / d) * r.speed;
  out.vz = (dz / d) * r.speed;
  out.run = r;
  out.car = car;
  out.index = index;
  return true;
}

export { RAIL_TOP, poseCar };
