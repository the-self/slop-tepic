import * as THREE from 'three/webgpu';
import type { PlayerEntity, ThirdPersonControllerManager } from './controllers.ts';
import type { AimControl } from './aim.ts';

// js/player/cameras.ts
// Multi-camera system supporting Third-Person Chase (with mouse look under the pointer lock, touch orbit + zoom),
// Low-Angle Action Cam, POV/Cockpit Cam, the scenic cameras over Tepic's landmarks, and Auto-Director Drone.
// (The scenic preset ids are the New York game's; main.ts anchors each one on a spot of the city.)

export type CameraPresetId = 'chase' | 'action' | 'pov' | 'centralPark' | 'fifthAve' | 'timesSquare' | 'chryslerGCT'
  | 'observatory' | 'bryantPark' | 'waterfront' | 'drone';
/** A camera: its id, its names (the menu's, the HUD's short one), whether it follows the player, its fov (degrees) */
export interface CameraPreset {
  id: CameraPresetId;
  name: string;
  short: string;
  category: 'follow' | 'scenic';
  fov: number;
}
/** A spot a scenic camera frames: where (m) and which way it faces (rad, 0 facing +z) */
export interface ScenicAnchor {
  x: number;
  z: number;
  heading: number;
}
/** A room the camera stays inside (interiors.ts): its walls and ceiling, m */
export interface CameraRoom {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}
/** What the cameras read of the controllers (player/controllers.ts): the entity they follow */
export type CameraTarget = Pick<ThirdPersonControllerManager, 'getActiveEntity'>;
// (the free aim, player/aim.ts: whether it is on, how far the shoulder view has come in, its pitch)
type CameraAim = Pick<AimControl, 'active' | 'blend' | 'pitch'>;
interface DragPointer {
  x: number;
  y: number;
  type: string;
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'chase',       name: '3rd-Person Chase',         short: 'Chase',       category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',         short: 'Action',      category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   short: 'POV / Dash',  category: 'follow', fov: 68 },
  { id: 'centralPark', name: 'Parque La Loma',             short: 'La Loma',     category: 'scenic', fov: 52 },
  { id: 'fifthAve',    name: 'Plaza Principal y Catedral', short: 'Plaza',       category: 'scenic', fov: 48 },
  { id: 'timesSquare', name: 'La Alameda',                 short: 'Alameda',     category: 'scenic', fov: 58 },
  { id: 'chryslerGCT', name: 'Estadio UAN',                short: 'UAN',         category: 'scenic', fov: 50 },
  { id: 'observatory', name: 'Mirador sobre el centro',    short: 'Mirador',     category: 'scenic', fov: 52 },
  { id: 'bryantPark',  name: 'Mercado Morelos',            short: 'Mercado',     category: 'scenic', fov: 52 },
  { id: 'waterfront',  name: 'Antigua estación',           short: 'Estación',    category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     short: 'Director',    category: 'scenic', fov: 50 }
];

const SCENIC_ORIGIN: ScenicAnchor = { x: 0, z: 0, heading: Math.PI };
const MOUSE_LOOK = 0.0024; // rad per pixel of mouse movement under the pointer lock (as aim.ts's)
// On foot, GTA-style: the chase camera orbits the player's head (cameraTargetOffset) at its chaseDistance, a little
// above it, and looks straight at it, so the whole body stands in the lower middle of the view
const FOOT_PITCH = 0.08; // rad, added to the orbit's tilt on foot
const FOOT_CLEARANCE = 0.45; // m: how low over the ground it may come, looking up from the street
// (the tilt's range: the person's wider, down to the street and up to the rooftops; the vehicles' framings over it)
const PITCH_RANGE = { person: [-0.6, 1.0], vehicle: [-0.32, 0.68] } as const;

class CameraSystem {
  domElement: HTMLElement;
  controllerManager: CameraTarget;
  camera: THREE.PerspectiveCamera;
  activePresetId: CameraPresetId;
  orbitYawOffset: number; // rad
  orbitPitchOffset: number; // rad
  zoomMultiplier: number;
  wheelZooms: ((event: WheelEvent) => boolean) | null;
  isDragging: boolean;
  userOrbitTimer: number; // s
  currentPos: THREE.Vector3;
  currentLookAt: THREE.Vector3;
  initialized: boolean;
  followEntity: PlayerEntity | null;
  // what the cameras follow instead of the player's own entity (net/multiplayer.ts: a friend's car the player rides in)
  follow: PlayerEntity | null = null;
  followOffset: THREE.Vector3;
  followLookOffset: THREE.Vector3;
  followBaseY: number;
  orbitEntity: PlayerEntity | null;
  orbitYaw: number; // rad
  orbitHoriz: number; // m
  orbitHeight: number; // m
  orbitBaseY: number;
  orbitLookFrom: THREE.Vector3;
  orbitLookBlend: number;
  smoothedSpeed: number; // m/s
  _desiredPos: THREE.Vector3;
  _desiredLook: THREE.Vector3;
  scenicAnchors: Partial<Record<string, ScenicAnchor>> | null;
  aim: CameraAim | null;
  aimWas: boolean;
  _aimPos: THREE.Vector3;
  _aimLook: THREE.Vector3;
  _lookAt: THREE.Vector3;
  _shake: THREE.Vector3;
  shakeAmp: number; // m
  speedRush: number;
  // the chase framing update() works out each frame, which orbitChase() eases towards (rad, m)
  declare _chaseYaw: number;
  declare _chaseHoriz: number;
  declare _chaseHeight: number;
  declare _chaseLookY: number;
  declare _clearPointers: () => void; // (bindPointerControls)
  declare _chaseAhead: number;
  groundAt?: ((x: number, z: number) => number) | null;
  obstacleAt?: ((x: number, y: number, z: number) => boolean) | null;
  interior?: CameraRoom | null;
  // on foot the orbit holds its world yaw while the player turns about under it: the heading it was last frame (rad)
  headingEntity: PlayerEntity | null;
  lastHeading: number;
  // how far out from the head the chase camera may go before a wall (0..1 of its distance), eased back out
  reach: number;
  viewYaw: number; // rad

  constructor(domElement: HTMLElement, controllerManager: CameraTarget) {
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      60000 // at 1:1 the valley floor runs out ~20-40 km to the fogged horizon (reversed float depth keeps precision)
    );

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.wheelZooms = null; // (event) => whether the mouse wheel zooms (main.ts: not while it switches weapons)
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    // The chase camera's eased orbit around orbitEntity (see orbitChase)
    this.orbitEntity = null;
    this.orbitYaw = 0;
    this.orbitHoriz = 0;
    this.orbitHeight = 0;
    this.orbitBaseY = 0;
    this.orbitLookFrom = new THREE.Vector3();
    this.orbitLookBlend = 1;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    // Scenic anchors { presetId: { x, z, heading } }: the spots the scenic cameras frame (main.ts sets them)
    this.scenicAnchors = null;
    // Free aim on foot (player/aim.ts, main.ts sets it): the follow cameras ease in over the right shoulder
    this.aim = null;
    this.aimWas = false;
    this._aimPos = new THREE.Vector3();
    this._aimLook = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._shake = new THREE.Vector3(); // (speedEffects)
    this.shakeAmp = 0;
    this.speedRush = 0;
    this.headingEntity = null;
    this.lastHeading = 0;
    this.reach = 1;
    this.viewYaw = 0;

    this.bindPointerControls();
  }

  setScenicAnchors(anchors: Partial<Record<string, ScenicAnchor>> | null): void {
    this.scenicAnchors = anchors ?? null;
  }

  // A scenic shot framed on an anchor spot: `back` metres behind it along its heading, `side` to its right, `up` high,
  // looking `ahead` metres past it (heading 0 faces +z; right is -x). Without an anchor: the frame's origin (the plaza)
  scenicFromAnchor(id: string, elapsed: number, desiredPos: THREE.Vector3, desiredLook: THREE.Vector3): void {
    const a = this.scenicAnchors?.[id] ?? SCENIC_ORIGIN;
    const sx = Math.sin(a.heading), cz = Math.cos(a.heading);
    // heights over the ground at the spot (the town's slopes put it well over y = 0)
    const g = this.groundAt ? this.groundAt(a.x, a.z) : 0;
    const at = (ahead: number, right: number, y: number): [number, number, number] => [a.x + sx * ahead - cz * right, y + g, a.z + cz * ahead + sx * right];
    if (id === 'observatory') {
      // high over the spot, slowly panning across the roofs towards the hills
      const pan = Math.sin(elapsed * 0.18) * 120.0;
      desiredPos.set(...at(-40, 0, 190));
      desiredLook.set(a.x + pan, 20 + g, a.z - 600);
    } else if (id === 'drone') {
      const orbit = elapsed * 0.07 + 0.65;
      const radius = 420.0 + Math.sin(elapsed * 0.23) * 90.0;
      const alt = 180.0 + Math.cos(elapsed * 0.19) * 50.0;
      desiredPos.set(Math.cos(orbit) * radius + a.x, alt + g, Math.sin(orbit) * radius + a.z);
      desiredLook.set(a.x, 12.0 + g, a.z);
    } else {
      const sway = Math.sin(elapsed * 0.25) * 1.8;
      desiredPos.set(...at(-28, 3.5 + sway, 6.5));
      desiredLook.set(...at(90, -4, 9));
    }
  }

  bindPointerControls(): void {
    const canvas = this.domElement;
    const pointers = new Map<number, DragPointer>();
    canvas.style.touchAction = 'none';

    // A click on the game takes the pointer lock, as on a PC game: from then on the mouse looks around with no button
    // held, and the left button is the trigger (aim.ts, crime.ts); Esc lets go of it. Where the lock is refused (an
    // embedded page) a drag still turns the camera
    const locked = () => document.pointerLockElement === canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      if (e.pointerType === 'mouse') {
        if (locked()) return;
        if (this.getActivePreset().category === 'follow' && 'requestPointerLock' in canvas) {
          try {
            canvas.requestPointerLock().catch(() => { /* (refused: the drag below) */ });
          } catch {
            // (refused: as above)
          }
        }
      }
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value?.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      // A mouse drag whose button came up without a pointerup reaching us (a menu, a system gesture, a click outside
      // the window) ends here instead of turning the camera on hover
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        releasePointer(e.pointerId);
        return;
      }
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = this.clampPitch(this.orbitPitchOffset + dy * 0.005);
      }
      this.userOrbitTimer = 4.0;
    });
    document.addEventListener('mousemove', (e) => {
      // (taking aim the mouse turns the player instead, aim.ts)
      if (!locked() || this.aim?.active) return;
      this.orbitYawOffset -= (e.movementX || 0) * MOUSE_LOOK;
      this.orbitPitchOffset = this.clampPitch(this.orbitPitchOffset + (e.movementY || 0) * MOUSE_LOOK);
      // (a vehicle's camera swings back behind it soon after the mouse rests)
      this.userOrbitTimer = Math.max(this.userOrbitTimer, 1.5);
    });

    const releasePointer = (id: number) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      canvas.addEventListener(type, (e) => { releasePointer(e.pointerId); });
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.wheelZooms && !this.wheelZooms(e)) return; // (on foot it switches weapons instead: ui/weapon-wheel.ts)
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId: string, snapImmediately = false): void {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX: number, lookY: number, zoom: number, dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = this.clampPitch(this.orbitPitchOffset + lookY * 1.25 * dt);
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  // The orbit's tilt kept within the followed entity's range (rad)
  clampPitch(pitch: number): number {
    const [lo, hi] = PITCH_RANGE[this.controllerManager.getActiveEntity().type === 'person' ? 'person' : 'vehicle'];
    return Math.max(lo, Math.min(hi, pitch));
  }

  // Which way the camera looks (rad, as a heading), which the player on foot is steered by (controllers.ts); null on
  // the cameras it isn't (the action cam sits behind the player, the scenic ones look elsewhere)
  viewHeading(): number | null {
    return this.activePresetId === 'chase' || this.activePresetId === 'pov' ? this.viewYaw : null;
  }

  resetOrbit(): void {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
  }

  resetForTeleport(): void {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.orbitEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    this.headingEntity = null;
    this.reach = 1;
    this.setCameraPreset('chase', true);
  }

  getActivePreset(): CameraPreset {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) ?? CAMERA_PRESETS[0];
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, elapsed: number): void {
    const entity = this.follow ?? this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;
    // (into a vehicle, the tilt turned on foot may go further than its framing takes)
    this.orbitPitchOffset = this.clampPitch(this.orbitPitchOffset);
    // taking aim: the player turns to where the camera looked, so the view comes in over its shoulder without a swing
    const aiming = Boolean(this.aim?.active) && entity.type === 'person';
    if (aiming && !this.aimWas) {
      entity.heading += this.orbitYawOffset;
      this.orbitYawOffset = 0;
      this.userOrbitTimer = 0;
    }
    this.aimWas = aiming;
    // On foot the player turns to the way it is steered, the camera doesn't: the orbit keeps its world yaw (taking aim
    // the mouse turns the player, and the camera with it)
    const freeLook = entity.type === 'person' && (this.activePresetId === 'chase' || this.activePresetId === 'pov');
    if (freeLook && !aiming && this.headingEntity === entity) {
      this.orbitYawOffset -= entity.heading - this.lastHeading;
    }
    this.headingEntity = entity;
    this.lastHeading = entity.heading;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    // (a vehicle's camera swings back behind it as it drives; on foot it stays where it was turned, as in GTA)
    if (!freeLook && !this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    const totalYaw = entity.heading + this.orbitYawOffset;
    this.viewYaw = totalYaw;

    switch (this.activePresetId) {
      case 'chase': {
        if (entity.type === 'person') {
          // round the head, looking straight at it (pulled back a little as it runs)
          const pivotY = entity.cameraTargetOffset.y;
          const dist = entity.chaseDistance * this.zoomMultiplier + speedLag * 0.6;
          const pitch = this.orbitPitchOffset + FOOT_PITCH;
          this._chaseYaw = totalYaw;
          this._chaseHoriz = Math.cos(pitch) * dist;
          this._chaseHeight = pivotY + Math.sin(pitch) * dist;
          this._chaseLookY = pivotY;
          this._chaseAhead = 0;
          break;
        }
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;
        // The chase camera is placed by orbitChase() below from these, eased as angles around the entity
        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        this._chaseYaw = totalYaw;
        this._chaseHoriz = horizDist;
        this._chaseHeight = height;
        this._chaseLookY = entity.cameraTargetOffset.y + lookUpBias;
        this._chaseAhead = 5.2;
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(entity.heading) * backDist + Math.cos(entity.heading) * sideOffset,
          Math.max(0.55, lowY),
          entity.position.z - Math.cos(entity.heading) * backDist - Math.sin(entity.heading) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(entity.heading) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(entity.heading) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist' || entity.type === 'moto') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'centralPark': case 'fifthAve': case 'timesSquare': case 'chryslerGCT': case 'observatory': case 'bryantPark':
      case 'waterfront': case 'drone':
      default:
        // the scenic cameras, framed on the city's spots
        this.scenicFromAnchor(this.activePresetId, elapsed, desiredPos, desiredLook);
        break;
    }

    if (this.activePresetId === 'chase') {
      this.followEntity = null; // action re-anchors from wherever the chase left the camera
      this.orbitChase(entity, dt);
    } else if (!this.initialized || this.activePresetId === 'pov') {
      this.orbitEntity = null;
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'action') {
      this.orbitEntity = null;
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns & the speed pull-back are still eased. The entity's height is eased in world space
      // (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      const k = 1 - Math.exp(-dt * 8.5);
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(0.55, this.currentPos.y);
    } else {
      this.orbitEntity = null;
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    // never under the hills (terrain.ts): over the ground where the camera is, and over the ground halfway to its
    // target so a ridge between them doesn't hide the player
    if (this.groundAt) {
      const p = this.currentPos, t = this.currentLookAt;
      const g = Math.max(this.groundAt(p.x, p.z), this.groundAt((p.x + t.x) / 2, (p.z + t.z) / 2) - 0.5);
      const clearance = entity.type === 'person' && this.activePresetId === 'chase' ? FOOT_CLEARANCE : 1.2;
      if (p.y < g + clearance) p.y = g + clearance;
    }
    // inside a room (interiors.ts): the camera stays between its walls and under its ceiling
    const room = this.interior;
    if (room) {
      const p = this.currentPos;
      p.x = Math.max(room.minX, Math.min(room.maxX, p.x));
      p.z = Math.max(room.minZ, Math.min(room.maxZ, p.z));
      p.y = Math.min(room.maxY, p.y);
    }
    // aiming on foot: eased from the follow camera's own framing (which goes on following meanwhile) to the shoulder's,
    // a little zoomed in
    const preset = this.getActivePreset();
    const b = this.aim && entity.type === 'person' && preset.category === 'follow' ? this.aim.blend : 0;
    const k = b * b * (3 - 2 * b);
    const rush = this.speedEffects(entity, preset, dt, elapsed);
    const fov = preset.fov * (1 - 0.16 * k) + 12 * rush;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (k > 0) {
      this.shoulderView(entity, this._aimPos, this._aimLook);
      this.camera.position.lerpVectors(this.currentPos, this._aimPos, k);
      this.camera.lookAt(this._lookAt.lerpVectors(this.currentLookAt, this._aimLook, k));
    } else {
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
    }
    if (this.shakeAmp > 0.0005) {
      // (moved after aiming: the follow framing itself stays smooth, only the lens shakes)
      this.camera.position.add(this._shake);
      const sh = this._shake, t = this.currentLookAt;
      // (the aim shakes more than the lens moves: the view trembles rather than slides)
      this.camera.lookAt(this._lookAt.set(t.x + sh.x * 1.6, t.y + sh.y * 1.6, t.z + sh.z * 1.6));
    }
  }

  // Speed, GTA-style, in a car or on a moto on the follow cameras: the view widens as it goes faster (more of the road
  // rushing past at the edges; the nitro's push widens it further) and shakes from ~90 km/h, harder the faster, as the
  // wind and the road's roughness do to a fast car; a crash jolts it (entity.cameraKick, 0..1, controllers.ts). Returns
  // the widening (0..1, eased); leaves the shake's offset in this._shake
  speedEffects(entity: PlayerEntity, preset: CameraPreset, dt: number, elapsed: number): number {
    const vehicle = (entity.type === 'car' || entity.type === 'moto') && preset.category === 'follow';
    const kmh = vehicle ? Math.abs(entity.speed) * 3.6 : 0;
    const target = Math.min(1, Math.max(0, (kmh - 60) / 170)) + (vehicle && entity.drive?.nitroOn ? 0.35 : 0);
    this.speedRush += (target - this.speedRush) * (1 - Math.exp(-dt * 2.5));
    const kick = vehicle ? Math.min(1, entity.cameraKick || 0) : 0;
    if (entity.cameraKick) entity.cameraKick *= Math.exp(-dt * 7);
    const fast = Math.min(1, Math.max(0, (kmh - 90) / 160));
    this.shakeAmp = vehicle ? 0.07 * fast + (entity.drive?.nitroOn ? 0.03 : 0) + 0.3 * kick : 0;
    const shake = this._shake;
    if (this.shakeAmp > 0.0005) {
      // two incommensurate tones a side, so it never settles into a visible rhythm
      const t = elapsed;
      const sx = Math.sin(t * 13.1) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4;
      const sy = Math.sin(t * 17.3 + 0.5) * 0.6 + Math.sin(t * 43.9 + 2.1) * 0.4;
      // across the view (its right, flat) and up
      const dx = this.currentLookAt.x - this.currentPos.x, dz = this.currentLookAt.z - this.currentPos.z;
      const len = Math.hypot(dx, dz) || 1;
      shake.set((-dz / len) * sx * this.shakeAmp, sy * this.shakeAmp, (dx / len) * sx * this.shakeAmp);
    } else shake.set(0, 0, 0);
    return Math.min(1.35, this.speedRush);
  }

  // The aiming view: over the right shoulder (from the eyes in POV), along the player's heading tilted by the aim's
  // pitch; the crosshair in the middle of the screen is where crime.ts sends the shots
  shoulderView(entity: PlayerEntity, pos: THREE.Vector3, look: THREE.Vector3): void {
    const h = entity.heading;
    const pitch = this.aim ? this.aim.pitch : 0; // (only called aiming)
    const cp = Math.cos(pitch);
    const dx = Math.sin(h) * cp, dy = Math.sin(pitch), dz = Math.cos(h) * cp;
    const pov = this.activePresetId === 'pov';
    const side = pov ? 0 : 0.62; // m to the right (right is (-cos h, sin h))
    const back = pov ? -0.3 : 2.4; // m behind the pivot along the aim
    const p = entity.position;
    const px = p.x - Math.cos(h) * side;
    const py = p.y + (pov ? 1.66 : 1.62);
    const pz = p.z + Math.sin(h) * side;
    pos.set(px - dx * back, Math.max(p.y + 0.45, py - dy * back), pz - dz * back);
    look.set(px + dx * 30, py + dy * 30, pz + dz * 30);
  }

  // The chase camera on a sphere around the entity. Its yaw, distance and height are eased as orbit parameters, not
  // as a position: easing the position cut straight across the circle, so a drag or a sharp turn pulled the camera in
  // towards the player and swung the view sideways. It is placed from the entity's current position every frame, so
  // a steady drive keeps it steady whatever the frame time, and it always looks over the entity along its own yaw.
  orbitChase(entity: PlayerEntity, dt: number): void {
    const p = entity.position;
    if (!this.initialized || this.orbitEntity !== entity) {
      this.orbitEntity = entity;
      this.orbitBaseY = p.y;
      if (this.initialized) {
        // preset or mode switch: start from where the camera is and swing round to the chase framing
        const dx = this.currentPos.x - p.x, dz = this.currentPos.z - p.z;
        this.orbitYaw = Math.atan2(-dx, -dz);
        this.orbitHoriz = Math.hypot(dx, dz);
        this.orbitHeight = this.currentPos.y - p.y;
        this.orbitLookFrom.subVectors(this.currentLookAt, p);
        this.orbitLookBlend = 0;
      } else {
        this.orbitYaw = this._chaseYaw;
        this.orbitHoriz = this._chaseHoriz;
        this.orbitHeight = this._chaseHeight;
        this.orbitLookBlend = 1;
        this.initialized = true;
      }
    }
    const k = 1 - Math.exp(-dt * 8.5);
    // a drag follows the hand closely; turns of the entity and the recentring swing round more gently
    const kYaw = 1 - Math.exp(-dt * (this.isDragging ? 22 : 8.5));
    let dYaw = (this._chaseYaw - this.orbitYaw) % (Math.PI * 2);
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.orbitYaw += dYaw * kYaw;
    this.orbitHoriz += (this._chaseHoriz - this.orbitHoriz) * k;
    this.orbitHeight += (this._chaseHeight - this.orbitHeight) * k;
    this.orbitBaseY += (p.y - this.orbitBaseY) * k;
    this.orbitLookBlend += (1 - this.orbitLookBlend) * k;

    const sin = Math.sin(this.orbitYaw), cos = Math.cos(this.orbitYaw);
    this.currentPos.set(
      p.x - sin * this.orbitHoriz,
      Math.max(0.65, this.orbitBaseY + this.orbitHeight),
      p.z - cos * this.orbitHoriz
    );
    this.keepInSight(p.x, this.orbitBaseY + this._chaseLookY, p.z, dt);
    // after a switch the view eases from where it was looking over to the entity
    const b = this.orbitLookBlend, ahead = this._chaseAhead;
    this.currentLookAt.set(
      p.x + this.orbitLookFrom.x * (1 - b) + sin * ahead * b,
      this.orbitBaseY + this.orbitLookFrom.y * (1 - b) + this._chaseLookY * b,
      p.z + this.orbitLookFrom.z * (1 - b) + cos * ahead * b
    );
  }

  // A wall between the followed entity's (x, y, z) and the chase camera: the camera comes in in front of it at once,
  // as in GTA, so the player is never hidden behind a building, and eases back out once past it
  keepInSight(x: number, y: number, z: number, dt: number): void {
    const cam = this.currentPos;
    const dx = cam.x - x, dy = cam.y - y, dz = cam.z - z;
    const len = Math.hypot(dx, dy, dz);
    let free = 1;
    if (this.obstacleAt && len > 0.6) {
      // (stepped every ~0.3 m out from the entity: a wall is metres thick, a pole is left out by the query)
      const steps = Math.ceil(len / 0.3);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (this.obstacleAt(x + dx * t, y + dy * t, z + dz * t)) {
          free = Math.max(0.6, t * len - 0.35) / len;
          break;
        }
      }
    }
    this.reach = free < this.reach ? free : this.reach + (free - this.reach) * (1 - Math.exp(-dt * 3));
    if (this.reach < 0.999) cam.set(x + dx * this.reach, y + dy * this.reach, z + dz * this.reach);
  }

  // Inside a room ({ minX, maxX, minZ, maxZ, maxY }, interiors.ts) or out of it (null)
  setInterior(room: CameraRoom | null | undefined): void {
    this.interior = room ?? null;
  }

  // Whether (x, y, z) is inside a building or a wall (controllers.ts isSolidAt): the chase camera keeps in front of it
  setObstacleQuery(fn: ((x: number, y: number, z: number) => boolean) | null | undefined): void {
    this.obstacleAt = typeof fn === 'function' ? fn : null;
  }

  // Height of the ground (the hills over the flat city) at (x, z): the cameras keep above it
  setGroundQuery(fn: ((x: number, z: number) => number) | null | undefined): void {
    this.groundAt = typeof fn === 'function' ? fn : null;
  }
}

export { CAMERA_PRESETS, CameraSystem };
