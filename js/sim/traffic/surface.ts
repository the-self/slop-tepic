// js/sim/traffic/surface.ts
// The ground under the traffic: the hills (terrain.ts), the surface under something at a height (a bridge's deck), and
// the lift of the road a vehicle drives on (road-network.ts)
import { edgeLift } from '../../world/road-network.ts';
import type { HillQuery, SurfaceQuery, Vehicle } from './types.ts';
import type { TrafficState } from './state.ts';

// Height of the hills over the flat city (terrain.ts): roads & sidewalks climbing them carry their traffic up
const hillAt = (ts: TrafficState, x: number, z: number): number => (ts.hillQuery ? ts.hillQuery(x, z) : 0);
function setHillQuery(ts: TrafficState, fn: HillQuery | null): void {
  ts.hillQuery = typeof fn === 'function' ? fn : null;
}
// The surface under something at height y: the ground, or a bridge's deck it is on (ground.ts surfaceHeight)
const surfaceAt = (ts: TrafficState, x: number, z: number, y: number): number => (ts.surfaceQuery ? ts.surfaceQuery(x, z, y) : hillAt(ts, x, z));
function setSurfaceQuery(ts: TrafficState, fn: SurfaceQuery | null): void {
  ts.surfaceQuery = typeof fn === 'function' ? fn : null;
}
// The lift (m over the ground) of the road v drives on at (x, z): up a ramp or over a bridge (road-network.ts), at a
// junction its node's
function roadLift(v: Vehicle, x: number, z: number): number {
  const e = v.edge;
  if (!e) return 0;
  if (v.conn) return e.to.lift || 0;
  return e.lift ? edgeLift(e, (x - e.x0) * e.dx + (z - e.z0) * e.dz) : 0;
}

export { hillAt, setHillQuery, surfaceAt, setSurfaceQuery, roadLift };
