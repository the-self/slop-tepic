// js/world/central/runs.ts
// The coaches that come and go at the Central (central-runs.ts lays their runs): each stands in its bay a while, its
// passengers boarding, backs out, drives out through the gate and away on its line's road out of Tepic, fading out as
// it nears the far end of it (or once it is far out of sight); a while later a coach of another line comes in from the
// far end of its own road, fading in, through the gate to the bay. With no router to find their roads (setRouter) they
// go round the block instead. A coach stops for what stands in its way (a vehicle ahead, someone on foot: `blocked`;
// an arm of the gate not yet up: `armBlocks`), pushing on after a while stuck, and the traffic stops behind it
// (addObstacles: as for the player's cars, sim/traffic.ts setParked). Drawn instanced as the parked coaches, faded by
// a dither (alpha hash) per coach; standing in its bay it stops the player (its collider, let go while it is out).
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { groundHeight } from '../ground.ts';
import { COACH_L, COACH_W, inCentral } from '../central-plan.ts';
import { STEP, coachRuns, departure, arrival, nextWait, runRoom } from '../central-runs.ts';
import { hash } from '../hash.ts';
import { LINES } from './site.ts';
import { buildCoachBodyGeometry, buildCoachWheelsGeometry, buildCoachNameGeometry } from '../../actors/actor-models.ts';
import type { CoachBay } from '../central-plan.ts';
import type { CoachRun, RunPath, Router } from '../central-runs.ts';
import type { Collider } from '../buildings.ts';

const SHOW = 2500; // m from the camera within which they are drawn (the fog has them long before)
const HARD_BRAKE = 4; // m/s²: stopping for something in the way
const ACCEL = 0.8; // m/s²
const BRAKE = 1.1; // m/s²
const STUCK = 8; // s held up by a vehicle before it pushes on through (a jam it is itself the cause of)
const PUSH = 4; // s it then ignores the vehicles round it
const LOOK = [2.2, 5, 8]; // m ahead of its nose (or its tail, backing) where it looks for something in its way
const FADE_OUT = 350; // m before the far end of its road a leaving coach fades out over
const FADE_IN = 250; // m an arriving one fades in over
const GONE_FAR = 2200; // m from the camera past which a leaving coach is let go (out of sight, short of its road's end)
const COME_FROM = 1400; // m of its road before the gate an arriving coach comes in from (farther while the camera is near)

/** What the traffic steers round (sim/traffic.ts ParkedVehicle): a moving coach's box */
export interface RunObstacle {
  x: number;
  z: number;
  halfW: number;
  halfL: number;
  heading: number;
}

/** Something in the way at (x, z), within r m? */
export type Blocked = (x: number, z: number, r: number) => boolean;

interface RunState {
  run: CoachRun;
  /** in its bay, backing out of it, a breath before driving off, leaving (or round the block), away, coming in */
  phase: 'wait' | 'out' | 'pause' | 'go' | 'gone' | 'come';
  /** s left waiting, pausing or away */
  t: number;
  /** the path it drives off on or comes in along (`go`, `come`), m along the path it is on, its speed along it (m/s) */
  path: RunPath;
  s: number;
  speed: number;
  /** m along an arriving coach's path where it came in from (it fades in from there) */
  from: number;
  /** its line now (it changes as one leaves and another comes) */
  line: number;
  stuck: number;
  push: number;
  laps: number;
  fade: number;
  box: RunObstacle;
  collider: Collider & { broken?: boolean };
  /** the roads found for each line, out and in (null: none) */
  outs: Map<number, RunPath | null>;
  ins: Map<number, RunPath | null>;
}

/** The coaches' materials, shared with the parked ones (central.ts); the names' faded by `coachFade` already */
export interface CoachMaterials {
  body: THREE.MeshStandardNodeMaterial;
  wheels: THREE.MeshStandardNodeMaterial;
  names: THREE.MeshStandardNodeMaterial;
}

/** An opaque material as `m` drawn faded by the per-instance `coachFade` (0 gone .. 1 there), dithered */
function faded(m: THREE.MeshStandardNodeMaterial): THREE.MeshStandardNodeMaterial {
  const c = m.clone();
  c.opacityNode = attribute('coachFade', 'float');
  c.alphaHash = true;
  return c;
}

/**
 * The coaches of the runs into `group`, of the bays `bays`, on the patio at `patioY` m over the ground. Returns the
 * bays to leave empty of parked coaches (theirs & their neighbours'), their colliders, `update(dt, eyeX, eyeZ,
 * blocked, armBlocks)`, `addObstacles(list)` and `setRouter(router)`
 */
function buildRuns(group: THREE.Object3D, bays: readonly CoachBay[], patioY: number, mats: CoachMaterials) {
  const runs = coachRuns(bays, LINES.length);
  let router: Router | null = null;
  const states: RunState[] = runs.map((run) => {
    const { x, z, heading } = run.bay;
    const hx = COACH_W / 2, hz = COACH_L / 2, cs = Math.cos(heading), sn = Math.sin(heading);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    const y = groundHeight(x, z) + patioY;
    return {
      run, phase: 'wait', t: run.wait, path: run.loop, s: 0, speed: 0, from: 0, line: run.line, stuck: 0, push: 0, laps: 0, fade: 1,
      box: { x, z, halfW: hx, halfL: hz, heading },
      collider: { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y, maxY: y + 3.3, obb: { cx: x, cz: z, hx, hz, cs, sn } },
      outs: new Map(), ins: new Map()
    };
  });

  const n = states.length;
  const bodyGeo = buildCoachBodyGeometry(), wheelGeo = buildCoachWheelsGeometry(), nameGeo = buildCoachNameGeometry();
  const body = new THREE.InstancedMesh(bodyGeo, faded(mats.body), n);
  const wheels = new THREE.InstancedMesh(wheelGeo, faded(mats.wheels), n);
  const names = new THREE.InstancedMesh(nameGeo, mats.names, n);
  const paints = { coachBody: new Float32Array(n * 3), coachStripe: new Float32Array(n * 3), coachStripe2: new Float32Array(n * 3) };
  const paintAttrs = Object.entries(paints).map(([k, a]) => {
    const attr = new THREE.InstancedBufferAttribute(a, 3);
    bodyGeo.setAttribute(k, attr);
    return attr;
  });
  const rows = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  nameGeo.setAttribute('coachName', rows);
  const fades = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
  for (const g of [bodyGeo, wheelGeo, nameGeo]) g.setAttribute('coachFade', fades);
  const c = new THREE.Color();
  /** Paints coach i in its line's livery, its name on its sides */
  const paint = (i: number) => {
    const [, b, s1, s2] = LINES[states[i].line];
    [b, s1, s2].forEach((hex, k) => {
      c.setHex(hex);
      paintAttrs[k].setXYZ(i, c.r, c.g, c.b);
      paintAttrs[k].needsUpdate = true;
    });
    rows.setX(i, states[i].line);
    rows.needsUpdate = true;
  };
  for (let i = 0; i < n; i++) paint(i);
  const meshes = [body, wheels, names];
  for (const m of meshes) {
    m.castShadow = m !== names;
    m.receiveShadow = true;
    m.frustumCulled = false; // (they move: a few of them, no bounds kept up)
    group.add(m);
  }
  body.name = 'CentralRunCoaches';
  const dummy = new THREE.Object3D();

  /** Where a run's coach is along `path` at s m: its box's middle and heading (interpolated between samples) */
  function pose(st: RunState, path: RunPath, s: number): void {
    const f = Math.max(0, Math.min(path.x.length - 1, s / STEP));
    const i = Math.min(path.x.length - 2, Math.floor(f)), k = f - i;
    st.box.x = path.x[i] + (path.x[i + 1] - path.x[i]) * k;
    st.box.z = path.z[i] + (path.z[i + 1] - path.z[i]) * k;
    let dh = path.heading[i + 1] - path.heading[i];
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    st.box.heading = path.heading[i] + dh * k;
  }

  /** Something in its way: ahead of its nose (or behind its tail, backing), within the look's reach */
  function inTheWay(st: RunState, path: RunPath, blocked: Blocked, armBlocks: Blocked): boolean {
    const back = path.reverse ? -1 : 1;
    const fx = Math.sin(st.box.heading) * back, fz = Math.cos(st.box.heading) * back;
    const ex = st.box.x + fx * COACH_L / 2, ez = st.box.z + fz * COACH_L / 2;
    if (armBlocks(ex + fx * 3, ez + fz * 3, 2.5)) return true;
    if (st.push > 0) return false;
    for (const d of LOOK) if (blocked(ex + fx * d, ez + fz * d, 1.0)) return true;
    return false;
  }

  /** Its road out for its line now (found once: the router's search is long), or round the block */
  function outbound(st: RunState): RunPath {
    if (!router) return st.run.loop;
    let p = st.outs.get(st.line);
    if (p === undefined) st.outs.set(st.line, (p = departure(st.run, LINES[st.line][6], router)));
    return p ?? st.run.loop;
  }
  function inbound(st: RunState): RunPath | null {
    if (!router) return null;
    let p = st.ins.get(st.line);
    if (p === undefined) st.ins.set(st.line, (p = arrival(st.run, LINES[st.line][6], router)));
    return p;
  }

  /** Steps the runs on by dt s; draws them while the camera at (eyeX, eyeZ) is near */
  function update(dt: number, eyeX: number, eyeZ: number, blocked: Blocked, armBlocks: Blocked): void {
    let shown = false;
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      if (st.phase === 'wait' || st.phase === 'pause') {
        st.t -= dt;
        if (st.t <= 0) {
          st.phase = st.phase === 'wait' ? 'out' : 'go';
          if (st.phase === 'go') st.path = outbound(st);
          st.s = 0;
          st.speed = 0;
        }
      } else if (st.phase === 'gone') {
        st.t -= dt;
        if (st.t <= 0) {
          // another line's coach on its way in: from COME_FROM m out, farther back while the camera is by there
          st.line = Math.floor(hash(st.run.bay.x + st.laps, st.run.bay.z, 65) * LINES.length) % LINES.length;
          paint(i);
          const path = inbound(st);
          if (path) {
            let s = Math.max(0, path.length - COME_FROM);
            pose(st, path, s);
            while (s > 0 && Math.hypot(st.box.x - eyeX, st.box.z - eyeZ) < 500) {
              s = Math.max(0, s - 400);
              pose(st, path, s);
            }
            st.phase = 'come';
            st.path = path;
            st.s = st.from = s;
            st.speed = path.speed[Math.round(s / STEP)];
          } else if (Math.hypot(st.run.bay.x - eyeX, st.run.bay.z - eyeZ) > 250) {
            // (no road found: back in its bay while nobody is looking)
            st.phase = 'wait';
            st.t = nextWait(st.run, ++st.laps);
            pose(st, st.run.loop, st.run.loop.length);
          } else st.t = 10;
        }
      } else {
        const path = st.phase === 'out' ? st.run.out : st.path;
        const stop = inTheWay(st, path, blocked, armBlocks);
        st.push = Math.max(0, st.push - dt);
        st.stuck = stop ? st.stuck + dt : 0;
        if (st.stuck > STUCK) {
          st.push = PUSH;
          st.stuck = 0;
        }
        const f = Math.min(path.speed.length - 1, Math.round(st.s / STEP));
        // (a crawl at least till it is there: the profile's last samples brake it to nothing just short of its end)
        const target = stop ? 0 : Math.max(path.speed[f], 0.4);
        st.speed = target < st.speed ? Math.max(target, st.speed - (stop ? HARD_BRAKE : BRAKE) * dt) : Math.min(target, st.speed + ACCEL * dt);
        st.s += st.speed * dt;
        pose(st, path, st.s);
        const leaving = st.phase === 'go' && path !== st.run.loop;
        if (leaving && st.s > 400 && Math.hypot(st.box.x - eyeX, st.box.z - eyeZ) > GONE_FAR) st.s = path.length;
        if (st.s >= path.length - 0.05) {
          if (st.phase === 'out') {
            st.phase = 'pause';
            st.t = 1.2;
          } else if (leaving) {
            st.phase = 'gone';
            st.t = 20 + 40 * hash(st.run.bay.x, st.laps, 66);
          } else {
            st.phase = 'wait';
            st.t = nextWait(st.run, ++st.laps);
          }
        }
      }
      st.collider.broken = st.phase !== 'wait';
      // faded out towards the far end of its road, in from where it came in, not there while it's away
      st.fade = st.phase === 'gone' ? 0
        : st.phase === 'go' && st.path !== st.run.loop ? Math.min(1, (st.path.length - st.s) / FADE_OUT)
          : st.phase === 'come' ? Math.min(1, (st.s - st.from) / FADE_IN) : 1;
      fades.setX(i, st.fade);
      if (st.fade <= 0 || Math.hypot(st.box.x - eyeX, st.box.z - eyeZ) > SHOW) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
        dummy.scale.setScalar(1);
        continue;
      }
      shown = true;
      // on the ground under it (the patio's paving inside the block), tilted with it
      const { x, z, heading } = st.box;
      const lift = inCentral(x, z) ? patioY : 0.02;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const ahead = (groundHeight(x + fx * 4, z + fz * 4) - groundHeight(x - fx * 4, z - fz * 4)) / 8;
      const right = (groundHeight(x + fz, z - fx) - groundHeight(x - fz, z + fx)) / 2;
      dummy.position.set(x, groundHeight(x, z) + lift, z);
      dummy.rotation.set(-Math.atan(ahead), heading, Math.atan(right), 'YXZ');
      dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, dummy.matrix);
    }
    body.visible = wheels.visible = names.visible = shown;
    fades.needsUpdate = true;
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }

  /** The coaches out on their runs, for the traffic to stop behind (sim/traffic.ts setParked) */
  function addObstacles<T>(list: (T | RunObstacle)[]): (T | RunObstacle)[] {
    for (const st of states) if (st.phase === 'out' || st.phase === 'go' || st.phase === 'come') list.push(st.box);
    return list;
  }

  /** The road network's router (sim/crime/road-graph.ts route), for the lines' roads out of town */
  function setRouter(r: Router | null): void {
    router = r;
  }

  // first drawn in their bays
  update(0, states[0]?.box.x ?? 0, states[0]?.box.z ?? 0, () => false, () => false);
  return { bays: runRoom(bays), colliders: states.map((s) => s.collider), update, addObstacles, setRouter };
}

export { buildRuns };
