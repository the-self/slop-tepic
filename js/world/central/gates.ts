// js/world/central/gates.ts
// The Central's gates (central-plan.ts lays them out). On Av. Preparatoria the coaches' way in and way out, a caseta
// on the island between them, white over a grey zócalo with its window band, and an arm striped yellow & black across
// each (the photos); at the car parks' entrances a glazed caseta under its curved white canopy, ESTACIONAMIENTO on its
// ends, an arm striped red & white across the driveway; and on Preparatoria the totem with the lines lettered down it.
// An arm rises by itself for whatever vehicle comes to it either way (the player's, the traffic's, the coaches':
// `vehicleAt`), and comes down again a moment after it has gone.
import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, mix, smoothstep, step } from 'three/tsl';
import { groundHeight } from '../ground.ts';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { standingBox as box } from '../../actors/actor-models.ts';
import { busGate, carParkGates, GATE, centralAt, centralHeading } from '../central-plan.ts';
import { LINES, canvasTexture } from './site.ts';
import type { Caseta, GateArm } from '../central-plan.ts';
import type { CarPark } from '../parking.ts';
import type { Collider } from '../buildings.ts';

const UP = 1.45; // rad: an arm raised (83°)
const RAISE = 1.4; // rad/s
const LOWER = 0.9; // rad/s
const HOLD = 2.5; // s an arm stays up after the last vehicle has gone through
// m either side of an arm along the way in where a vehicle is looked for: well inside, but only just out over the street
// (the traffic driving by on it is not coming in; one that turns in is seen as it reaches the curb)
const PROBE = [-3, -1.2, 1.5, 4, 7];
const PIVOT_H = 0.95; // m: the arm's pivot over the ground
const NEAR = 260; // m: the arms are minded while the camera is this near
const ACROSS_WIDE = [0.25, 0.5, 0.75]; // where along a long arm (its share of its length) a vehicle is looked for
const ACROSS = [0.5];

/** A vehicle within r m of (x, z)? (the traffic's bodies: sim/traffic.ts vehicleAt) */
export type VehicleAt = (x: number, z: number, r: number) => boolean;

/** An arm as built: its plan, its pivot's group (turned to it, raised by its z), its angle (rad), how long it holds */
interface Arm extends GateArm {
  pivot: THREE.Group;
  angle: number;
  hold: number;
}

/** A parabolic vault `span` m across (local z), `width` m long (local x), rising `rise` m over its feet at y */
function vault(width: number, span: number, rise: number, y: number, z0: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const N = 12;
  const at = (k: number): [number, number] => {
    const s = k / N;
    return [z0 + s * span, y + rise * (1 - (2 * s - 1) ** 2)];
  };
  for (let k = 0; k < N; k++) {
    const [za, ya] = at(k), [zb, yb] = at(k + 1);
    pos.push(-width / 2, ya, za, width / 2, ya, za, width / 2, yb, zb, -width / 2, ya, za, width / 2, yb, zb, -width / 2, yb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function gateMaterials() {
  const p = attribute('position', 'vec3');
  // the coaches' caseta: white over a grey zócalo, its window band dark (lit at night)
  const booth = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const band = step(1.05, p.y).mul(step(p.y, 2.15));
  booth.colorNode = mix(mix(color(0xf1efe8), color(0x8f979e), step(p.y, 0.9)), color(0x1e2a33), band);
  booth.roughnessNode = mix(float(0.8), float(0.2), band);
  booth.emissiveNode = color(0xfff0d0).mul(band).mul(smoothstep(0.35, 1.2, cityUniforms.uInteriorGlow)).mul(0.6);
  // the car parks': glazed nearly all round over a low white wall
  const glassBooth = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  const glazed = step(0.95, p.y).mul(step(p.y, 2.25));
  glassBooth.colorNode = mix(color(0xeeece6), color(0x2a3a44), glazed);
  glassBooth.roughnessNode = mix(float(0.75), float(0.15), glazed);
  glassBooth.emissiveNode = color(0xfff0d0).mul(glazed).mul(smoothstep(0.35, 1.2, cityUniforms.uInteriorGlow)).mul(0.7);
  // the arms: bands every 45 cm along them
  const stripes = (a: number, b: number) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
    m.colorNode = mix(color(a), color(b), step(0.5, fract(p.x.div(0.9))));
    return m;
  };
  const parking = canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = '#1d5fb4';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, 10, 76, 76);
    ctx.fillStyle = '#1d5fb4';
    ctx.font = `900 64px Arial, sans-serif`;
    ctx.fillText('P', 48, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 46px Arial, sans-serif`;
    ctx.fillText('ESTACIONAMIENTO', 300, 52, 400);
  });
  const totem = canvasTexture(256, 1024, (ctx) => {
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(0, 0, 256, 1024);
    const row = 1024 / LINES.length;
    LINES.forEach(([name, , stripe, , ink], k) => {
      // (each name in its line's colour: its ink, or its swoosh's when its ink is white)
      ctx.fillStyle = ink.toLowerCase() === '#ffffff' ? `#${stripe.toString(16).padStart(6, '0')}` : ink;
      ctx.font = `italic 900 40px 'Arial Black', Arial, sans-serif`;
      ctx.fillText(name, 128, k * row + row / 2, 236);
    });
  });
  const sign = (map: THREE.Texture) => {
    const m = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.5 });
    m.emissiveNode = color(0xffffff).mul(smoothstep(0.5, 1.1, cityUniforms.uInteriorGlow).mul(0.5));
    return m;
  };
  return {
    booth, glassBooth, armBus: stripes(0xf2c200, 0x1b1b1b), armCar: stripes(0xf4f4f0, 0xc8161c),
    cabinet: new THREE.MeshStandardNodeMaterial({ color: 0xe8b51a, roughness: 0.5, metalness: 0.2 }),
    white: new THREE.MeshStandardNodeMaterial({ color: 0xf2f1ec, roughness: 0.6, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardNodeMaterial({ color: 0xe0a81f, roughness: 0.7 }),
    concrete: new THREE.MeshStandardNodeMaterial({ color: 0xb8b2a6, roughness: 0.9 }),
    dark: new THREE.MeshStandardNodeMaterial({ color: 0x2a2c2e, roughness: 0.6 }),
    parking: sign(parking), totem: sign(totem)
  };
}

/**
 * The gates into `group` (world). Returns their colliders, `update(dt, eyeX, eyeZ, vehicleAt)`, which raises & lowers
 * the arms, and `armBlocks(x, z, r)`: whether an arm not yet up stands within r m of (x, z) (a coach waits for it)
 */
function buildGates(group: THREE.Object3D, lots: readonly Pick<CarPark, 'entrances'>[]) {
  const mats = gateMaterials();
  const colliders: Collider[] = [];
  const obb = (x: number, z: number, hx: number, hz: number, yaw: number, y0: number, y1: number) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y0, maxY: y1, obb: { cx: x, cz: z, hx, hz, cs, sn } });
  };
  const place = (mesh: THREE.Mesh, x: number, y: number, z: number, yaw: number) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  const bus = busGate(), cars = carParkGates(lots);

  // The coaches' island on Preparatoria, a curb's height over the gate's concrete, its yellow edge
  {
    const [i0, i1] = GATE.island, u0 = GATE.u - 3.4, u1 = GATE.u + 0.2;
    const c = centralAt((u0 + u1) / 2, (i0 + i1) / 2);
    // (turned to the way in: its length, along v, is its x)
    place(new THREE.Mesh(box(i1 - i0, 0.5, u1 - u0, 0, -0.32, 0), mats.curb), c.x, groundHeight(c.x, c.z), c.z, centralHeading(1, 0));
  }
  // The casetas
  const casetas: Caseta[] = [...bus.casetas, ...cars.casetas];
  for (const k of casetas) {
    const y = groundHeight(k.x, k.z) + (k.canopy ? 0.02 : 0.18);
    place(new THREE.Mesh(box(k.w, k.h, k.d, 0, 0, 0), k.canopy ? mats.glassBooth : mats.booth), k.x, y, k.z, k.yaw);
    place(new THREE.Mesh(box(k.w + 0.5, 0.16, k.d + 0.5, 0, k.h, 0), mats.white), k.x, y, k.z, k.yaw);
    obb(k.x, k.z, k.w / 2, k.d / 2, k.yaw, y, y + k.h + 0.2);
    if (!k.canopy) continue;
    // the canopy: a white vault from behind the caseta out over the driveway, on two posts at its far edge
    const span = k.d + 4.6, z0 = -k.d / 2 - 0.6, w = k.w + 2.2;
    place(new THREE.Mesh(vault(w, span, 0.7, k.h + 0.35, z0), mats.white), k.x, y, k.z, k.yaw);
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw), rx = Math.cos(k.yaw), rz = -Math.sin(k.yaw);
    for (const side of [-1, 1]) {
      const px = k.x + fx * (z0 + span - 0.3) + rx * side * (w / 2 - 0.3), pz = k.z + fz * (z0 + span - 0.3) + rz * side * (w / 2 - 0.3);
      place(new THREE.Mesh(box(0.16, k.h + 0.4, 0.16, 0, 0, 0), mats.white), px, y, pz, k.yaw);
      obb(px, pz, 0.08, 0.08, k.yaw, y, y + k.h);
      // ESTACIONAMIENTO on the vault's ends
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.49).rotateY(side * Math.PI / 2), mats.parking);
      place(plate, k.x + rx * side * (w / 2 + 0.02) + fx * (z0 + span / 2), y + k.h + 0.12, k.z + rz * side * (w / 2 + 0.02) + fz * (z0 + span / 2), k.yaw);
    }
  }
  // The totem on the car park's corner of Preparatoria: the lines down both its faces over its dark foot
  for (const t of cars.totems) {
    const y = groundHeight(t.x, t.z);
    place(new THREE.Mesh(box(1.7, 1.0, 0.7, 0, 0, 0), mats.dark), t.x, y, t.z, t.yaw);
    place(new THREE.Mesh(box(1.7, 6.6, 0.6, 0, 1.0, 0), mats.white), t.x, y, t.z, t.yaw);
    for (const side of [0, Math.PI]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.4).rotateY(side).translate(0, 4.3, side ? -0.31 : 0.31), mats.totem);
      place(face, t.x, y, t.z, t.yaw);
    }
    obb(t.x, t.z, 0.85, 0.35, t.yaw, y, y + 7.6);
  }

  // The arms: each on its pivot's group (turned so its x runs along the arm, raised about its z), its yellow cabinet
  const arms: Arm[] = [...bus.arms, ...cars.arms].map((a) => {
    const y = groundHeight(a.x, a.z) + (a.kind === 'bus' ? 0.18 : 0.02);
    const yaw = Math.atan2(-a.az, a.ax);
    place(new THREE.Mesh(box(0.38, PIVOT_H + 0.15, 0.38, 0, 0, 0), mats.cabinet), a.x - a.ax * 0.1, y, a.z - a.az * 0.1, yaw);
    obb(a.x - a.ax * 0.1, a.z - a.az * 0.1, 0.2, 0.2, yaw, y, y + PIVOT_H + 0.15);
    const pivot = new THREE.Group();
    pivot.position.set(a.x, y + PIVOT_H, a.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(a.length, 0.1, 0.1).translate(a.length / 2 + 0.2, 0, 0), a.kind === 'bus' ? mats.armBus : mats.armCar);
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.set(0, yaw, 0, 'YZX');
    group.add(pivot);
    // its rest at the far side
    const tx = a.x + a.ax * (a.length + 0.2), tz = a.z + a.az * (a.length + 0.2);
    place(new THREE.Mesh(box(0.12, PIVOT_H - 0.05, 0.12, 0, 0, 0), mats.dark), tx, groundHeight(tx, tz), tz, yaw);
    return { ...a, pivot, angle: 0, hold: 0 };
  });

  /** Raises an arm a vehicle comes to (looked for along its way through, either side of it), lowers it after */
  function update(dt: number, eyeX: number, eyeZ: number, vehicleAt: VehicleAt): void {
    for (const a of arms) {
      if (Math.hypot(a.x - eyeX, a.z - eyeZ) > NEAR && a.angle === 0) continue;
      let seen = false;
      for (const s of PROBE) {
        for (const across of a.length > 7 ? ACROSS_WIDE : ACROSS) {
          const x = a.x + a.ax * a.length * across + a.tx * s, z = a.z + a.az * a.length * across + a.tz * s;
          if (vehicleAt(x, z, 1.2)) { seen = true; break; }
        }
        if (seen) break;
      }
      a.hold = seen ? HOLD : Math.max(0, a.hold - dt);
      const target = a.hold > 0 ? UP : 0;
      if (a.angle === target) continue;
      a.angle = target > a.angle ? Math.min(target, a.angle + RAISE * dt) : Math.max(target, a.angle - LOWER * dt);
      a.pivot.rotation.z = a.angle;
    }
  }

  /** Whether an arm short of up stands within r m of (x, z) (its length as it lies down): one that does is raised for
   *  whoever asks (a coach coming to it: the caseta lets it through) */
  function armBlocks(x: number, z: number, r: number): boolean {
    let blocks = false;
    for (const a of arms) {
      const t = Math.max(0, Math.min(a.length, (x - a.x) * a.ax + (z - a.z) * a.az));
      if (Math.hypot(a.x + a.ax * t - x, a.z + a.az * t - z) >= r) continue;
      a.hold = HOLD;
      if (a.angle <= 1.2) blocks = true;
    }
    return blocks;
  }

  return { colliders, update, armBlocks };
}

export { buildGates };
