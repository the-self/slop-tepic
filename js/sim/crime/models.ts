// js/sim/crime/models.ts
// The street crime's models (sim/crime.ts), built once and parked out of sight until used: the guns in the player's
// and everyone else's hands, the patrol cars, the cartel's and the army's trucks, and the police helicopter.
import * as THREE from 'three/webgpu';
import type { StreetGun } from '../crime-rules.ts';
import {
  BODY_SPECS, buildCarGeometry, createLoftedCarMaterial, buildLightbarGeometry,
  buildHelicopterBodyGeometry, buildHelicopterMainRotorGeometry, buildHelicopterTailRotorGeometry, createLoftedHelicopterMaterial
} from '../../actors/actor-models.ts';
import { WEAPON_MODELS, buildWeaponGeometry, createWeaponMaterial } from '../../actors/weapon-models.ts';
import { createContactShadowMaterial } from '../../render/tsl-materials.ts';
import { MAX_AGENTS, MAX_CRUISERS, MAX_TRUCKS, MAX_ARMY, PARKED_Y, GRIP_REACH, CRUISER, CRUISER_HP, HELI_HP, NPC_GUN, zero } from './constants.ts';
import type { Faction, Helicopter } from './types.ts';

// (the fire trucks & ambulances are sim/emergency.ts's own models)
type CrimeFaction = Exclude<Faction, 'fire' | 'ambulance'>;
import type { CrimeSystem } from '../crime.ts';

export function buildGuns(crime: CrimeSystem): void {
  // (actors/weapon-models.ts: one material, the finish in each gun's vertices)
  const material = createWeaponMaterial();
  // the player's: one of each, its grip a hand's breadth on from the rig's wrist
  crime.playerGuns = {};
  for (const id of WEAPON_MODELS) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(buildWeaponGeometry(id), material);
    mesh.position.set(0, -0.012, GRIP_REACH);
    mesh.castShadow = true;
    g.add(mesh);
    g.position.y = PARKED_Y;
    crime.scene.add(g);
    crime.playerGuns[id] = g;
  }
  // everyone else's: one instanced draw per kind of gun they carry
  crime.npcGuns = {};
  // (NPC_GUN's keys are the StreetGuns)
  for (const id of Object.keys(NPC_GUN) as StreetGun[]) {
    const mesh = new THREE.InstancedMesh(buildWeaponGeometry(id).translate(0, -0.012, GRIP_REACH), material, MAX_AGENTS);
    mesh.name = `CrimeGuns-${id}`;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.count = 1;
    mesh.setMatrixAt(0, zero);
    crime.scene.add(mesh);
    crime.npcGuns[id] = { mesh, count: 0 };
  }
}

export function buildCruisers(crime: CrimeSystem): void {
  const spec = BODY_SPECS.sedan;
  // (a paint of its own: the material cache shares a colour's material, and the player's stolen cruiser sets its
  // brake lights on the one it gets)
  const mat = createLoftedCarMaterial(spec, 0xf6f9fd);
  // (the uniform createLoftedCarMaterial keeps in userData for a car of a colour of its own)
  const carState = mat.userData.carState as { value: THREE.Vector4 } | undefined;
  if (carState) carState.value.set(0, 0, 0, 1); // police livery
  // the cartel's black SUVs and the army's olive-drab ones, without a light bar
  const truckSpec = Object.hasOwn(BODY_SPECS, 'suv') ? BODY_SPECS.suv : spec; // (a Record: TS takes any key to be there)
  const truckBody = buildCarGeometry(truckSpec, true);
  const body = buildCarGeometry(spec, true);
  const looks: Record<CrimeFaction, { body: THREE.BufferGeometry; paint: THREE.Material; name: string }> = {
    police: { body, paint: mat, name: 'PoliceCruiser' },
    narco: { body: truckBody, paint: createLoftedCarMaterial(truckSpec, 0x0c0d0f), name: 'CartelTruck' },
    army: { body: truckBody, paint: createLoftedCarMaterial(truckSpec, 0x4a5130), name: 'ArmyTruck' }
  };
  const bar = buildLightbarGeometry(spec);
  const barMat = crime.bars.lit;
  const shadowGeo = new THREE.PlaneGeometry(2.3, 5.2).rotateX(-Math.PI / 2);
  const shadowMat = createContactShadowMaterial();
  // a burnt-out wreck that is never driven, parked out of sight, so that material compiles at load too
  const parkedWreck = new THREE.Mesh(body, crime.burnt);
  parkedWreck.position.y = PARKED_Y;
  crime.scene.add(parkedWreck);
  // (and a light bar switched off, cruisers.ts standDown)
  const parkedBar = new THREE.Mesh(bar, crime.bars.dark);
  parkedBar.position.y = PARKED_Y;
  crime.scene.add(parkedBar);
  const fleet: [CrimeFaction, number][] = [['police', MAX_CRUISERS], ['narco', MAX_TRUCKS], ['army', MAX_ARMY]];
  for (const [faction, n] of fleet) {
    const look = looks[faction];
    for (let i = 0; i < n; i++) {
      const root = new THREE.Group();
      root.name = look.name;
      const tiltPivot = new THREE.Group();
      root.add(tiltPivot);
      const bodyMesh = new THREE.Mesh(look.body, look.paint);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      const lightbar = new THREE.Mesh(bar, barMat);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.y = 0.02;
      shadow.renderOrder = 998;
      tiltPivot.add(bodyMesh);
      if (faction === 'police') tiltPivot.add(lightbar);
      root.add(shadow);
      root.position.y = PARKED_Y;
      crime.scene.add(root);
      crime.cruisers.push({
        active: false, mesh: root, tiltPivot, bodyMesh, lightbar, paint: look.paint, faction,
        x: 0, y: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, halfW: CRUISER.halfW, halfL: CRUISER.halfL,
        mass: CRUISER.mass, type: 'car', police: faction !== 'narco', hp: CRUISER_HP[faction], wreck: 0, state: 'chase', path: null, pathI: 0,
        replan: 0, stuckT: 0, checkX: 0, checkZ: 0, reverseT: 0, deployed: false, crew: [], aboard: 0, life: 0, pitch: 0, roll: 0,
        hw: CRUISER.halfW, hl: CRUISER.halfL, stuckCount: 0, slowT: 0, startX: 0, startZ: 0, goalX: 0, goalZ: 0, passSide: 0, lift: 0, vy: 0,
        position: new THREE.Vector3() // (for the audio: crashes & sirens)
      });
    }
  }
}

// The police helicopter: the player's own model (actors/actor-models.ts) with red & blue beacons under its belly,
// parked out of sight until four stars call it
export function buildHelicopter(crime: CrimeSystem): Helicopter {
  const mat = createLoftedHelicopterMaterial();
  const root = new THREE.Group();
  root.name = 'PoliceHelicopter';
  const tiltPivot = new THREE.Group();
  root.add(tiltPivot);
  const body = new THREE.Mesh(buildHelicopterBodyGeometry(), mat);
  body.castShadow = true;
  tiltPivot.add(body);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.66, -0.35);
  const blades = new THREE.Mesh(buildHelicopterMainRotorGeometry(), mat);
  blades.castShadow = true;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32),
    new THREE.MeshBasicNodeMaterial({ color: 0xc8d8e8, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
  rotor.add(blades, disc);
  const tail = new THREE.Group();
  tail.position.set(0.18, 2.02, -5.62);
  tail.add(new THREE.Mesh(buildHelicopterTailRotorGeometry(), mat));
  const beacon = new THREE.SphereGeometry(0.11, 8, 6);
  const red = new THREE.Mesh(beacon, new THREE.MeshBasicNodeMaterial({ color: 0xff2424 }));
  const blue = new THREE.Mesh(beacon, new THREE.MeshBasicNodeMaterial({ color: 0x2a5cff }));
  red.position.set(0.45, 0.3, 0.9);
  blue.position.set(-0.45, 0.3, 0.9);
  tiltPivot.add(rotor, tail, red, blue);
  root.position.y = PARKED_Y;
  crime.scene.add(root);
  return {
    type: 'helicopter', active: false, state: 'chase', mesh: root, tiltPivot, rotor, tail, red, blue,
    x: 0, y: PARKED_Y, z: 0, heading: 0, speed: 0, vx: 0, vy: 0, vz: 0, hp: HELI_HP, orbit: 0, life: 0,
    pitch: 0, roll: 0, spin: 0, cooldown: 2, burst: 0,
    position: new THREE.Vector3(0, PARKED_Y, 0)
  };
}
