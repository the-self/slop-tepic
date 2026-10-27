// js/net/motion.ts
// Where a remote player has got to past the last pose received (net/multiplayer.ts draws the far ones there between
// their sparser poses: protocol.ts updateEvery). Carried on at the velocity its last two poses show, which holds its
// walker's sidestep, its car's slide or its helicopter's drift, none of which its heading and speed tell; a vehicle
// whose last pose stands still stays put (its last step was its braking). Three-free: node --test imports it as it is.

/** A received pose: metres, radians, m/s, stamped with the performance.now() ms it arrived at */
export interface TimedPose {
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
}

/** A point on the ground (m), written by extrapolate */
export interface GroundPoint {
  x: number;
  z: number;
}

/**
 * Where the player of poses `prev` (the one before, if any) and `last` is `ahead` s past `last`, into `out`. The ticks
 * between the two are counted whole (`tickMs` each): the server sends poses on its ticks, so packets the network
 * bunched or spread still give the velocity they were sent at. With one pose, along its heading at its speed.
 * `vehicle`: a car, bicycle or moto, which doesn't sidestep, so stands still once its speed is 0.
 */
export function extrapolate(prev: TimedPose | undefined, last: TimedPose, ahead: number, tickMs: number, vehicle: boolean,
  out: GroundPoint): GroundPoint {
  out.x = last.x;
  out.z = last.z;
  if (ahead <= 0 || (vehicle && last.speed === 0)) return out;
  if (!prev) {
    out.x += Math.sin(last.heading) * last.speed * ahead;
    out.z += Math.cos(last.heading) * last.speed * ahead;
    return out;
  }
  const dt = Math.max(1, Math.round((last.t - prev.t) / tickMs)) * tickMs / 1000;
  out.x += ((last.x - prev.x) / dt) * ahead;
  out.z += ((last.z - prev.z) / dt) * ahead;
  return out;
}
