// js/sim/traffic/bodies.ts
// Every vehicle's footprint on the ground, binned once a frame, for the people walking about to stop at or step round
import type { BodyBox } from './types.ts';
import type { TrafficState } from './state.ts';

// Every vehicle's footprint on the ground (the traffic's, the player's, those it left standing and the patrol cars),
// binned in BODY_CELL m cells once a frame: the people walking about stop at them or step round them (vehicleAt)
// instead of walking through a car standing in their way
const BODY_CELL = 8;
const BODY_REACH = 0.5; // m: the widest person a query asks about (each box is binned this much bigger)
const bodyKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
function addBody(ts: TrafficState, x: number, z: number, heading: number, hw: number, hl: number): void {
  let b = ts.bodyBoxes[ts.bodyCount++] as BodyBox | undefined;
  if (!b) ts.bodyBoxes.push((b = { x: 0, z: 0, sn: 0, cs: 1, hw: 0, hl: 0 }));
  b.x = x;
  b.z = z;
  b.sn = Math.sin(heading);
  b.cs = Math.cos(heading);
  b.hw = hw;
  b.hl = hl;
  const r = Math.hypot(hw, hl) + BODY_REACH;
  for (let ix = Math.floor((x - r) / BODY_CELL); ix <= Math.floor((x + r) / BODY_CELL); ix++) {
    for (let iz = Math.floor((z - r) / BODY_CELL); iz <= Math.floor((z + r) / BODY_CELL); iz++) {
      const k = bodyKey(ix, iz);
      let list = ts.bodyCells.get(k);
      if (!list) ts.bodyCells.set(k, (list = []));
      if (!list.length) ts.usedCells.push(list);
      list.push(b);
    }
  }
}
function gatherBodies(ts: TrafficState): void {
  for (const list of ts.usedCells) list.length = 0;
  ts.usedCells.length = 0;
  ts.bodyCount = 0;
  for (const v of ts.vehicles) {
    if (!v.edge || v.wreck) continue;
    addBody(ts, v.x, v.z, v.yaw + v.yawOffset, v.bus ? 1.3 : v.halfWidth, v.bus ? 5.72 : v.half);
  }
  for (const o of ts.parked) addBody(ts, o.x, o.z, o.heading || 0, o.halfW, o.halfL);
  if (ts.player.active && ts.player.mode !== 'person') addBody(ts, ts.player.x, ts.player.z, ts.player.heading, ts.player.halfW, ts.player.halfL);
}
// The vehicle a person of radius r (up to BODY_REACH) at (x, z) overlaps, as its box { x, z, sn, cs, hw, hl }, or null
function vehicleBoxAt(ts: TrafficState, x: number, z: number, r = 0.3): BodyBox | null {
  const list = ts.bodyCells.get(bodyKey(Math.floor(x / BODY_CELL), Math.floor(z / BODY_CELL)));
  if (!list) return null;
  for (const b of list) {
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx * b.sn + dz * b.cs) <= b.hl + r && Math.abs(dx * b.cs - dz * b.sn) <= b.hw + r) return b;
  }
  return null;
}
const vehicleAt = (ts: TrafficState, x: number, z: number, r = 0.3) => vehicleBoxAt(ts, x, z, r) !== null;
// Is the step from (x0, z0) to (x1, z1) into a vehicle? Not when already standing in one (a car that drove up onto
// someone): they walk on out of it rather than freeze there
const stepBlocked = (ts: TrafficState, x0: number, z0: number, x1: number, z1: number, r = 0.3) => vehicleAt(ts, x1, z1, r) && !vehicleAt(ts, x0, z0, r);

export { gatherBodies, vehicleBoxAt, vehicleAt, stepBlocked };
