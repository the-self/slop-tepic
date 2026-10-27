// js/sim/traffic/near.ts
// The roads and signals around the focus to place vehicles and pedestrians on, weighed by the hour (traffic-demand.ts)
import { AVENUE, busyFactor, carDensity, peopleDensity, roadClass } from '../traffic-demand.ts';
import { NEAR_RADIUS, NUM_CARS, NUM_PEDS, clamp } from './constants.ts';
import type { TrafficEdge } from './types.ts';
import type { TrafficState } from './state.ts';

// The hour of the day (local, 0-24; app/frame-loop.ts setHour) sets how much traffic and how many people are out
// (traffic-demand.ts). Each near edge is weighed by the metres of it within NEAR_RADIUS: a car is placed on one by
// its lane-km × its class's density (the avenues, not the colonias' streets), a cyclist likewise but never on an
// avenue, a pedestrian by its sidewalk-km × its crowd (cumulative, for pickWeighted); their totals are how many cars
// and people the hour has around the focus.
function setHour(ts: TrafficState, h: number): void {
  if (Number.isFinite(h)) ts.hour = ((h % 24) + 24) % 24;
}
// Metres of edge e within `r` of the focus
function inRange(ts: TrafficState, e: TrafficEdge, r: number): number {
  const fx = ts.focusX - e.sx, fz = ts.focusZ - e.sz;
  const along = fx * e.dx + fz * e.dz;
  const across2 = fx * fx + fz * fz - along * along;
  if (across2 >= r * r) return 0;
  const half = Math.sqrt(r * r - across2);
  return Math.max(0, Math.min(e.len, along + half) - Math.max(0, along - half));
}
function weighNear(ts: TrafficState): void {
  ts.weighedHour = ts.hour;
  ts.nearCarWeights.length = 0;
  ts.nearBikeWeights.length = 0;
  ts.nearPedWeights.length = 0;
  let cars = 0;
  let bikes = 0;
  let people = 0;
  for (const e of ts.nearEdges) {
    const km = inRange(ts, e, NEAR_RADIUS) / 1000;
    const c = (e.roadClass ??= roadClass(e));
    const here = km * e.lanes.length * carDensity(c, ts.hour) * busyFactor(e.name);
    cars += here;
    if (c !== AVENUE) bikes += here;
    people += km * peopleDensity(c, ts.hour);
    ts.nearCarWeights.push(cars);
    ts.nearBikeWeights.push(bikes);
    ts.nearPedWeights.push(people);
  }
  ts.carTarget = Math.min(NUM_CARS, Math.round(cars));
  ts.pedTarget = Math.min(NUM_PEDS, Math.round(people));
}
// An item of `list` at random by its cumulative `weights` (uniformly while they are all 0)
function pickWeighted<T>(list: readonly T[], weights: readonly number[]): T | undefined {
  const total = weights.length ? weights[weights.length - 1] : 0;
  if (!(total > 0)) return list[Math.floor(Math.random() * list.length)];
  const r = Math.random() * total;
  let lo = 0;
  let hi = weights.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (weights[mid] > r) hi = mid;
    else lo = mid + 1;
  }
  return list[lo];
}
// Edges and signalized intersections around the focus, to place vehicles and pedestrians on: gathered afresh once the
// focus has moved 40 m
function refreshNear(ts: TrafficState): void {
  const moved = Math.hypot(ts.focusX - ts.nearX, ts.focusZ - ts.nearZ) >= 40;
  if (!moved) {
    // (the hour moved on: weighed afresh every 6 minutes of it)
    if (!(Math.abs(ts.hour - ts.weighedHour) < 0.1)) weighNear(ts);
    return;
  }
  ts.nearX = ts.focusX;
  ts.nearZ = ts.focusZ;
  ts.nearEdges.length = 0;
  ts.nearTransitEdges.length = 0;
  ts.nearSignals.length = 0;
  for (const e of ts.edges) {
    const s = clamp((ts.focusX - e.sx) * e.dx + (ts.focusZ - e.sz) * e.dz, 0, e.len);
    const dx = e.sx + e.dx * s - ts.focusX, dz = e.sz + e.dz * s - ts.focusZ;
    if (dx * dx + dz * dz < NEAR_RADIUS * NEAR_RADIUS) {
      ts.nearEdges.push(e);
      if (e.transit) ts.nearTransitEdges.push(e);
    }
  }
  for (const n of ts.nodes) {
    const dx = n.x - ts.focusX, dz = n.z - ts.focusZ;
    if (n.signal && dx * dx + dz * dz < NEAR_RADIUS * NEAR_RADIUS) ts.nearSignals.push(n);
  }
  weighNear(ts);
}

export { setHour, pickWeighted, refreshNear };
