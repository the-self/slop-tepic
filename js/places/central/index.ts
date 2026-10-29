// js/places/central/index.ts
// Builds the Central de Autobuses (plan.ts lays it out, plan-runs.ts its coaches' paths): the terminal along Av.
// Insurgentes, walked into from the car park and through to the andén (build/terminal.ts); the patio's concrete, the
// andenes' and the patio's bays painted yellow, the white wall over its grey zócalo closed all round it but for the
// gate on Av. Preparatoria; the casetas and their arms at the gate and the car parks' entrances, rising by themselves
// for whoever comes (build/gates.ts); the coaches of the lines that leave from it standing in their bays, instanced,
// drawn while the camera is within SHOW m, and those that come and go, out on their lines' highways and in from them
// (build/runs.ts). The walls, the furniture, the casetas and the coaches stop the player. Its travellers are life.ts's.
import * as THREE from 'three/webgpu';
import { GEO } from '../../world/city-geodata.js';
import { liftAt } from '../../world/ground.ts';
import { slopeTilt, turnedBox } from '../../world/standing.ts';
import { drapeGeometry } from '../../world/drape.ts';
import { FlatLayer, fillLot, paintLine, pavedHeight } from '../../world/car-parks.ts';
import { carParks } from '../../world/parking.ts';
import { CENTRAL_CLAIMS, TERMINAL, PATIO_PTS, WALLS, COACH_L, COACH_W, centralAt, coachBays, parkCoaches } from './plan.ts';
import { Kit, WORLD } from '../kit/pieces.ts';
import { LINES } from './build/site.ts';
import { buildTerminal } from './build/terminal.ts';
import { buildGates } from './build/gates.ts';
import { buildRuns } from './build/runs.ts';
import { createPavementMaterial, createRoadPaintMaterial } from '../../render/tsl-materials.ts';
import {
  buildCoachBodyGeometry, buildCoachWheelsGeometry, buildCoachNameGeometry, coachNameTexture, createBusWheelMaterial,
  createCoachMaterial, createCoachNameMaterial,
  standingBox as box // (a box w × h × d (m) standing on y, centred on (u, v) of the frame)
} from '../../actors/actor-models.ts';
import type { Collider, Footprint } from '../../world/buildings.ts';
import type { PlaceContext, PlaceSpec } from '../place.ts';
import type { CentralSite } from './build/site.ts';
import type { VehicleAt } from './build/gates.ts';
import type { Blocked, RunObstacle } from './build/runs.ts';

const SHOW = 700; // m from the camera within which the coaches are drawn
const PATIO_WALL_H = 3.2; // m: the wall round the patio (the photos' on Calle Dr. Martínez)
const ZOCALO = 1.1; // m: its grey foot
const WALL_PIECE = 10; // m: the patio's walls are laid in lengths of this, each on its ground
const YELLOW = new THREE.Color(0xe8ad22);

/** A coach as drawn: where (m, on the ground), its turn & tilt (rad), its line */
interface PlacedCoach {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  line: number;
}

/**
 * The Central into the scene (its patio's ground & paint to `streamer` when there is one, laid tile by tile round the
 * camera). Returns its colliders, its buildings' footprints for the maps, `update(dt, eyeX, eyeZ, playerX, playerZ, vehicleAt, blocked, someoneAt)`, which shows the coaches while the camera is
 * near, opens the doors and raises the arms for who comes and drives the coaches' runs, `addObstacles(list)`, the
 * coaches out on the streets for the traffic to stop behind, and `setRouter(router)`, which finds the lines' roads out
 * of town
 */
function buildCentral({ scene, streamer }: PlaceContext) {
  const group = new THREE.Group();
  group.name = 'CentralDeAutobuses';
  scene.add(group);
  const colliders: Collider[] = [];

  // the frame's turn: its u along the world's (UX, UZ), v along (VX, VZ)
  const o = centralAt(0, 0), e = centralAt(1, 0);
  const yaw = Math.atan2(-(e.z - o.z), e.x - o.x);
  const [u0, u1, v0, v1] = TERMINAL;
  const mid = centralAt((u0 + u1) / 2, (v0 + v1) / 2);
  const patioY = pavedHeight(mid.x, mid.z);
  // the hall's floor: over the ground at its highest corner (the site dips ~1 m under its middle: its plinth shows
  // there, and nothing of it is buried on the car park's side)
  const floorY = patioY + Math.max(...[[u0, v0], [u1, v0], [u1, v1], [u0, v1], [(u0 + u1) / 2, (v0 + v1) / 2]].map(([u, v]) => {
    const p = centralAt(u, v);
    return liftAt(p.x, p.z);
  }));
  // The terminal's frame, turned into place on its floor
  const hall = new THREE.Group();
  hall.name = 'CentralTerminal';
  hall.position.set(o.x, floorY, o.z);
  hall.rotation.y = yaw;
  group.add(hall);
  const site: CentralSite = {
    hall, floorY, colliders,
    // the patio's height at (u, v) over the hall's floor (m)
    ground: (u, v) => {
      const p = centralAt(u, v);
      return liftAt(p.x, p.z) + patioY - floorY;
    },
    // an oriented box of the frame (u0..u1 × v0..v1, from y0 to y1 over the floor) that stops the player
    collide: (a0, a1, b0, b1, y0, y1) => {
      const c = centralAt((a0 + a1) / 2, (b0 + b1) / 2);
      const collider = turnedBox(c.x, c.z, (a1 - a0) / 2, (b1 - b0) / 2, yaw, floorY + y0, floorY + y1);
      colliders.push(collider);
      return collider;
    }
  };

  // The patio's concrete, and the bays' yellow lines on it
  const paved = new FlatLayer(), paint = new FlatLayer();
  fillLot(paved, { pts: PATIO_PTS }, patioY, { pave: [3] });
  const bays = coachBays();
  for (const bay of bays) for (const [a, b] of bay.lines) paintLine(paint, a.x, a.z, b.x, b.z, patioY + 0.012, YELLOW);
  const layers: [FlatLayer, THREE.Material, string, number][] = [
    [paved, createPavementMaterial(), 'CentralPatio', 0],
    [paint, createRoadPaintMaterial(), 'CentralPaint', -1]
  ];
  for (const [layer, material, name, renderOrder] of layers) {
    const g = layer.geometry();
    if (!g) continue;
    if (streamer) {
      streamer.addLayer(g, material, { name, renderOrder });
      continue;
    }
    const mesh = new THREE.Mesh(drapeGeometry(g), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.renderOrder = renderOrder;
    group.add(mesh);
  }

  // The terminal: its shell, its front, the KFC, the umbrellas over the andén, its inside
  const terminal = buildTerminal(site);
  // The patio's walls, square to the frame, in lengths of WALL_PIECE m each on the ground under it (their foot down
  // into it: the patio slopes): white over a grey zócalo, a coping along their top
  const walls = new Kit({ cell: Infinity });
  const zocalo = new THREE.MeshStandardNodeMaterial({ color: 0x8b939a, roughness: 0.88 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xefede7, roughness: 0.88 });
  for (const [a0, b0, a1, b1] of WALLS) {
    const alongU = b0 === b1, from = alongU ? Math.min(a0, a1) : Math.min(b0, b1), to = alongU ? Math.max(a0, a1) : Math.max(b0, b1);
    const n = Math.ceil((to - from) / WALL_PIECE);
    for (let k = 0; k < n; k++) {
      const s = from + ((to - from) * k) / n, t = from + ((to - from) * (k + 1)) / n, m = (s + t) / 2;
      const [cu, cv] = alongU ? [m, b0] : [a0, m];
      const y = site.ground(cu, cv);
      const [w, d] = alongU ? [t - s + 0.2, 0.25] : [0.25, t - s + 0.2];
      walls.add(box(w, ZOCALO + 1, d, cu, y - 1, cv), zocalo, WORLD, 0, 0, 0);
      walls.add(box(w, PATIO_WALL_H - ZOCALO, d, cu, y + ZOCALO, cv), white, WORLD, 0, 0, 0);
      walls.add(box(alongU ? w : 0.4, 0.12, alongU ? 0.4 : d, cu, y + PATIO_WALL_H, cv), white, WORLD, 0, 0, 0);
      if (alongU) site.collide(s, t, b0 - 0.12, b0 + 0.12, y - 1, y + PATIO_WALL_H);
      else site.collide(a0 - 0.12, a0 + 0.12, s, t, y - 1, y + PATIO_WALL_H);
    }
  }
  walls.build(hall);

  // The gates on Preparatoria and at the car parks' entrances
  const gates = buildGates(group, carParks(GEO.parking));
  for (const c of gates.colliders) colliders.push(c);

  // The coaches standing in the bays, each on the ground under it (the runs' bays left to theirs)
  const nameTex = coachNameTexture(LINES.map(([name, , , , ink, edge]) => [name, ink, edge] as const));
  const coachMats = { body: createCoachMaterial(), wheels: createBusWheelMaterial(), names: createCoachNameMaterial(nameTex, LINES.length) };
  // (the runs' names fade with them: build/runs.ts)
  const runs = buildRuns(group, bays, patioY, { ...coachMats, names: createCoachNameMaterial(nameTex, LINES.length, 'coachFade') });
  for (const c of runs.colliders) colliders.push(c);
  const parked = parkCoaches(bays, LINES.length, runs.bays);
  // (the andén's, for the people boarding them: life.ts)
  const andenCoaches = parked.filter(({ bay }) => bay.row === 0).map(({ bay }) => ({ x: bay.x, z: bay.z, heading: bay.heading }));
  const coaches: PlacedCoach[] = parked.map(({ bay, line }) => {
    const y = liftAt(bay.x, bay.z) + patioY;
    return { x: bay.x, y, z: bay.z, yaw: bay.heading, ...slopeTilt(bay.x, bay.z, bay.heading, 4), line };
  });
  const count = coaches.length;
  const bodyGeo = buildCoachBodyGeometry();
  const body = new THREE.InstancedMesh(bodyGeo, coachMats.body, count);
  const wheels = new THREE.InstancedMesh(buildCoachWheelsGeometry(), coachMats.wheels, count);
  const names = new THREE.InstancedMesh(buildCoachNameGeometry(), coachMats.names, count);
  const paints = { coachBody: new Float32Array(count * 3), coachStripe: new Float32Array(count * 3), coachStripe2: new Float32Array(count * 3) };
  const rows = new Float32Array(count);
  const dummy = new THREE.Object3D(), c = new THREE.Color();
  coaches.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    dummy.updateMatrix();
    for (const m of [body, wheels, names]) m.setMatrixAt(i, dummy.matrix);
    const [, b, s1, s2] = LINES[p.line];
    for (const [k, hex] of [['coachBody', b], ['coachStripe', s1], ['coachStripe2', s2]] as const) {
      c.setHex(hex);
      paints[k].set([c.r, c.g, c.b], i * 3);
    }
    rows[i] = p.line;
    // (it stops the player: its turned box, short of its roof)
    colliders.push(turnedBox(p.x, p.z, COACH_W / 2, COACH_L / 2, p.yaw, p.y, p.y + 3.3));
  });
  for (const [k, a] of Object.entries(paints)) bodyGeo.setAttribute(k, new THREE.InstancedBufferAttribute(a, 3));
  names.geometry.setAttribute('coachName', new THREE.InstancedBufferAttribute(rows, 1));
  for (const m of [body, wheels, names]) {
    m.castShadow = m !== names;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    group.add(m);
  }
  body.name = 'CentralCoaches';

  /**
   * One frame: the parked coaches shown while the camera at (eyeX, eyeZ) is within SHOW m; the doors opening for the
   * player at (playerX, playerZ) or anyone else coming (`someoneAt`); the arms rising for the vehicles at them
   * (`vehicleAt`); the runs' coaches stepped on, stopping for what is `blocked` ahead of them
   */
  function update(dt: number, eyeX: number, eyeZ: number, playerX: number, playerZ: number, vehicleAt: VehicleAt, blocked: Blocked,
    someoneAt: Blocked): void {
    const near = Math.hypot(eyeX - mid.x, eyeZ - mid.z) < SHOW;
    body.visible = wheels.visible = names.visible = near;
    if (near) terminal.update(dt, playerX, playerZ, someoneAt);
    gates.update(dt, eyeX, eyeZ, vehicleAt);
    runs.update(dt, eyeX, eyeZ, blocked, gates.armBlocks);
  }

  /** The coaches out on their runs, for the traffic to stop behind (sim/traffic.ts setParked) */
  function addObstacles<T>(list: (T | RunObstacle)[]): (T | RunObstacle)[] {
    return runs.addObstacles(list);
  }

  // (what the maps read of a block: ui/city-map.ts MapBlock)
  const map: { footprints: Footprint[] } = { footprints: terminal.footprints };
  console.info(`[central] ${bays.length} bays, ${count} coaches parked, ${runs.bays.length} on their runs`);
  return { group, colliders, map, andenCoaches, update, addObstacles, setRouter: runs.setRouter };
}

type CentralBuild = ReturnType<typeof buildCentral>;

/** The Central de Autobuses as app/city.ts builds it */
const CENTRAL_PLACE: PlaceSpec<CentralBuild> = { claims: CENTRAL_CLAIMS, build: buildCentral };

export type { CentralBuild };
export { CENTRAL_PLACE, buildCentral };
