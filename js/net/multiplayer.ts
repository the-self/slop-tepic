import * as THREE from 'three/webgpu';
import { PersonCrowd, PersonRig } from '../sim/pedestrians.ts';
import { isTypingInField } from '../world/city-config.ts';
import { PLAYER_PERSON } from '../player/controllers/constants.ts';
import {
  SEND_HZ,
  OP,
  CHAT_MAX,
  encodeHello,
  encodeCreate,
  encodeSettings,
  encodeState,
  encodeChat,
  encodeShot,
  encodeHit,
  encodeDown,
  decodeServer
} from '../../shared/protocol.ts';
import type { Mode, MovedPlayer, PoseSource, RoomSettings, ServerMessage, Shot } from '../../shared/protocol.ts';
import { NAME_KEY, settingsSummary } from './lobby.ts';
import type { CurrentRoom, RoomEntry } from './lobby.ts';
import type { CrimeSystem, RemoteTarget } from '../sim/crime.ts';
import type { CarEntity, PersonEntity, PlayerEntity } from '../player/controllers.ts';
import { onLocaleChange, setLabel, setText, t } from '../i18n/i18n.ts';

// js/net/multiplayer.ts
// Browser side of the room server (server/index.ts), loaded only with ?multiplayer=1 (see main.ts). Sends the active
// player's pose SEND_HZ times a second, keeps a local list of the players the server says are in view, and draws them
// INTERP_DELAY_MS in the past, interpolating between the poses it received so 10 Hz updates look smooth. And what the
// players do to each other: a chat (Enter), shots seen and heard, the hits the player's shots, blows and blasts land
// on the others (sim/crime.ts traces them against their poses) and theirs on the player, who killed whom, and riding
// in a friend's car (F by it: the camera rides along, and F again gets out). Which room it plays in is the lobby's
// (net/lobby.ts): the region's public rooms, a friend's by its code, or the player's own, whose settings (weather,
// hour, police, PvP) everyone in it plays with (onSettings: main.ts applies them).
//
//   ?multiplayer=1               connect (to the page's own server, tools/play.ts; ws://<host>:8787 from localhost)
//   &mp-server=wss://host/path   another server
//   &mp-region=nayarit           room region (default: this map's, see DEFAULT_REGION)
//   &mp-name=Lalo                display name (remembered)

const DEFAULT_REGION = 'nayarit'; // the map this checkout builds (Tepic); each city's map will name its own region
const DEFAULT_PORT = 8787;
const INTERP_DELAY_MS = 200; // two server ticks: a late packet still has a pose to blend toward
const SNAP_DISTANCE = 60; // m between updates beyond which a player teleported instead of moving
const KEEPALIVE_MS = 2000; // resend an unchanged pose this often
const MAX_REMOTE_PEOPLE = 96; // walkers + cyclists' riders drawn by the shared crowd
const LABEL_DISTANCE = 140; // m within which name tags show
const RETRY_MAX_MS = 10000;
const RIDE_REACH = 3.2; // m from a friend's car to get in
const KILL_WINDOW_MS = 10000; // a player's hit this recent killed the player
const CHAT_LINES = 8; // lines kept on screen
const CHAT_FADE_MS = 15000; // a line fades after this long
// A remote player's body to shots, per mode: half width & length (m; a person's is a circle, BODY_R in crime.ts) and height
const BODIES: Partial<Record<Mode, { halfW: number; halfL: number; height: number }>> = {
  car: { halfW: 0.95, halfL: 2.3, height: 1.6 },
  cyclist: { halfW: 0.4, halfL: 0.95, height: 1.75 },
  moto: { halfW: 0.45, halfL: 1.05, height: 1.7 },
  helicopter: { halfW: 1.4, halfL: 5.5, height: 3.4 }
};

const _v = new THREE.Vector3();
const _view = new THREE.Vector3();

// The local player's meshes a remote player's look is cloned from (player/controllers.ts entities)
interface EntityLook {
  mesh: THREE.Object3D;
  leanPivot?: THREE.Object3D; // cyclist & moto: the frame that leans into turns
  mainRotorPivot?: THREE.Object3D; // helicopter
  tailRotorPivot?: THREE.Object3D;
}
type BikeFrame = Parameters<PersonRig['ride']>[2];
interface BikeLook extends EntityLook {
  bikeFrame: BikeFrame; // where a rider's hands, seat & feet go (PersonRig.ride)
}
/** Out-param of groundTilt: radians, for an Euler of order YXZ */
export interface GroundTilt {
  pitch: number;
  roll: number;
}

/** What multiplayer uses of the controller manager (player/controllers.ts ThirdPersonControllerManager) */
export interface MultiplayerControllers {
  entities: Readonly<Partial<Record<Mode, EntityLook>>> & {
    readonly cyclist: BikeLook;
    readonly moto: BikeLook;
    readonly car: CarEntity;
    readonly person: PersonEntity;
  };
  activeMode: string;
  seated: boolean; // riding in a friend's car: the walker stands still, out of sight
  syncOccupants(): void;
  resetInput(): void;
  getActiveEntity(): PoseSource;
  getGroundHeight(x: number, z: number, mode?: string): number;
  groundTilt(x: number, z: number, heading: number, along: number, across: number, out: GroundTilt): GroundTilt;
}

/** What multiplayer uses of sim/crime.ts's CrimeSystem: the player's state, its targets and hooks, its hurts, the shots seen */
export type MultiplayerCrime = Pick<CrimeSystem, 'state' | 'remotes' | 'onPlayerShot' | 'onRemoteHit' | 'fireBlocked' | 'hurt' | 'showShot' | 'toast'>;
/** What multiplayer uses of player/cameras.ts's CameraSystem: what it follows instead of the player's own entity */
export interface MultiplayerCameras {
  follow: PlayerEntity | null;
  resetForTeleport(): void;
}

export interface MultiplayerOptions {
  scene: THREE.Scene;
  controllers: MultiplayerControllers;
  camera: THREE.Camera;
  crime?: MultiplayerCrime | null;
  cameras?: MultiplayerCameras | null;
  url: string; // ws:// or wss://
  region?: string;
  name?: string;
  entry?: RoomEntry; // the room to go into (default: the region's public rooms)
}

export type MultiplayerStatus = 'connecting' | 'online' | 'offline' | 'error';

/** A remote player's pose: metres, radians, m/s */
export interface RemotePose {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
}
/** A received pose, stamped with the performance.now() ms it arrived at */
interface PoseSample extends RemotePose {
  t: number;
}

const lerpAngle = (a: number, b: number, t: number) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * t;

// The node at the same child-index path in a clone as `node` is in `root`
function counterpart(root: THREE.Object3D, clone: THREE.Object3D, node: THREE.Object3D | undefined): THREE.Object3D | undefined {
  const path: number[] = [];
  for (let n: THREE.Object3D | null | undefined = node; n && n !== root; n = n.parent) {
    if (!n.parent) return undefined; // (not under root)
    path.unshift(n.parent.children.indexOf(n));
  }
  let c: THREE.Object3D | undefined = clone;
  for (const i of path) c = c?.children.at(i); // (i ≥ 0: an indexOf of a child that is there)
  return c;
}

// A visual copy of a player entity's mesh sharing its geometry & materials, without its lights (dozens of remote
// headlamps would swamp the clustered light budget)
function cloneVisual(entity: EntityLook): THREE.Object3D {
  const copy = entity.mesh.clone(true);
  const lights: THREE.Light[] = [];
  copy.traverse((o) => {
    if (o instanceof THREE.Light) lights.push(o);
  });
  for (const l of lights) l.removeFromParent();
  return copy;
}

class RemotePlayer {
  id: number;
  name: string;
  mode: Mode | null;
  samples: PoseSample[];
  visual: THREE.Object3D | null;
  rig: PersonRig | null;
  label: HTMLDivElement | null;
  pedalPhase: number; // rad
  pose: RemotePose;
  // the parts of `visual` that move, found by counterpart() in the local player's mesh
  leanPivot?: THREE.Object3D;
  mainRotor?: THREE.Object3D;
  tailRotor?: THREE.Object3D;

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
    this.mode = null;
    this.samples = []; // { t, x, y, z, heading, speed }, oldest first
    this.visual = null;
    this.rig = null;
    this.label = null;
    this.pedalPhase = 0;
    this.pose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  }

  push(t: number, s: MovedPlayer, tickMs: number): void {
    const last = this.samples.at(-1);
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > SNAP_DISTANCE) this.samples.length = 0;
    else if (last && t - last.t > tickMs * 2.5) {
      // it stood still (the server sent nothing): start the new motion from a fresh copy, not a minutes-long glide
      this.samples.push({ ...last, t: t - tickMs });
    }
    this.samples.push({ t, x: s.x, y: s.y, z: s.z, heading: s.heading, speed: s.speed });
    if (this.samples.length > 6) this.samples.shift();
  }

  // Pose at renderTime: between the two samples around it, else held at the nearest end
  sample(renderTime: number): RemotePose {
    const s = this.samples;
    const p = this.pose;
    if (s.length === 0) return p;
    let a = s[0];
    let b = s[0];
    if (renderTime >= s[s.length - 1].t) {
      a = b = s[s.length - 1];
    } else {
      for (let i = 1; i < s.length; i++) {
        if (s[i].t >= renderTime) {
          a = s[i - 1];
          b = s[i];
          break;
        }
      }
    }
    const t = b.t > a.t ? Math.min(1, Math.max(0, (renderTime - a.t) / (b.t - a.t))) : 1;
    p.x = a.x + (b.x - a.x) * t;
    p.y = a.y + (b.y - a.y) * t;
    p.z = a.z + (b.z - a.z) * t;
    p.heading = lerpAngle(a.heading, b.heading, t);
    p.speed = a.speed + (b.speed - a.speed) * t;
    return p;
  }
}

class Multiplayer {
  scene: THREE.Scene;
  controllers: MultiplayerControllers;
  camera: THREE.Camera;
  url: string;
  region: string;
  name: string;
  ws: WebSocket | null;
  id: number;
  room: string;
  roomPlayers: number;
  tickMs: number; // ms between server ticks
  remotes: Map<number, RemotePlayer>;
  status: MultiplayerStatus;
  retryMs: number;
  stopped: boolean;
  lastSent: Uint8Array | null;
  lastSentAt: number; // performance.now() ms
  nextSendAt: number;
  crowd: PersonCrowd;
  _tilt: GroundTilt;
  badge: HTMLDivElement;
  labels: HTMLDivElement;
  crime: MultiplayerCrime | null;
  cameras: MultiplayerCameras | null;
  targets: RemoteTarget[]; // the others as crime's shots find them (reused objects, crime.remotes)
  lastHurtBy: number; // the player whose hit last struck the player, and when (performance.now() ms)
  lastHurtAt: number;
  playing: boolean; // the player was alive last frame (crime.state 'play')
  rideId: number; // the friend whose car the player rides in (0: none)
  ride: CarEntity; // what the camera follows riding: the player's own car's look, at the friend's car's pose
  chat: HTMLDivElement;
  chatLog: HTMLDivElement;
  chatInput: HTMLInputElement;
  entry: RoomEntry;
  /** the room the player is in (WELCOME; null till then) */
  current: (CurrentRoom & { hostId: number }) | null;
  roomsButton: HTMLButtonElement;
  /** the room's settings arrived or changed: the weather, hour & police are main.ts's to apply */
  onSettings: ((settings: RoomSettings) => void) | null;
  /** the server turned the player away from the room ('room', 'password', 'roomfull', 'wait'): main.ts reopens the lobby */
  onRejected: ((code: string) => void) | null;
  /** the HUD's Rooms button: main.ts opens the lobby */
  onLobby: (() => void) | null;

  constructor({ scene, controllers, camera, crime = null, cameras = null, url, region = DEFAULT_REGION, name = '', entry = { kind: 'public' } }: MultiplayerOptions) {
    this.scene = scene;
    this.controllers = controllers;
    this.camera = camera;
    this.crime = crime;
    this.cameras = cameras;
    this.targets = [];
    this.lastHurtBy = 0;
    this.lastHurtAt = -Infinity;
    this.playing = true;
    this.rideId = 0;
    this.ride = { ...controllers.entities.car, position: new THREE.Vector3(), heading: 0, speed: 0, cameraKick: 0 };
    this.url = url;
    this.region = region;
    this.name = name;
    this.entry = entry;
    this.current = null;
    this.onSettings = null;
    this.onRejected = null;
    this.onLobby = null;
    this.ws = null;
    this.id = 0;
    this.room = '';
    this.roomPlayers = 0;
    this.tickMs = 100;
    this.remotes = new Map(); // id → RemotePlayer
    this.status = 'connecting';
    this.retryMs = 1000;
    this.stopped = false;
    this.lastSent = null;
    this.lastSentAt = 0;
    this.nextSendAt = 0;

    // (the others are drawn as everyone sees themselves: the player's person model, once it loads)
    this.crowd = new PersonCrowd(MAX_REMOTE_PEOPLE, { farDistance: 40, model: PLAYER_PERSON });
    this._tilt = { pitch: 0, roll: 0 };
    this.crowd.meshes.forEach((m) => scene.add(m));

    this.badge = document.createElement('div');
    this.badge.className = 'mp-badge';
    this.badge.setAttribute('role', 'status');
    this.labels = document.createElement('div');
    this.labels.className = 'mp-labels';
    document.body.append(this.labels);
    // under the brand panel, top left, so it never collides with the toolbar
    (document.querySelector('.hud-top-left') ?? document.body).append(this.badge);
    // the rooms: which one the player is in, its code, another to go to (net/lobby.ts)
    this.roomsButton = document.createElement('button');
    this.roomsButton.type = 'button';
    this.roomsButton.className = 'mp-rooms-btn';
    setText(this.roomsButton, 'mp.rooms');
    this.roomsButton.addEventListener('click', () => { this.onLobby?.(); });
    this.badge.after(this.roomsButton);
    this.renderBadge();
    onLocaleChange(() => { this.renderBadge(); }); // (in the new language)
    [this.chat, this.chatLog, this.chatInput] = this.buildChat();
    if (crime) {
      crime.remotes = this.targets;
      crime.onPlayerShot = (shot: Shot) => { this.sendFrame(encodeShot(shot)); };
      crime.onRemoteHit = (id: number, damage: number) => { if (damage >= 1) this.sendFrame(encodeHit(id, damage)); };
    }
    this.connect();
  }

  // The room's settings: PvP here (with it off, the player's shots pass through the others), the rest main.ts's
  applySettings(settings: RoomSettings, announce: boolean): void {
    if (this.crime) this.crime.remotes = settings.pvp ? this.targets : NO_TARGETS;
    this.onSettings?.(settings);
    if (announce) this.crime?.toast(t('mp.roomChanged', { summary: settingsSummary(settings) }));
  }

  // The host's new settings for the room (the server ignores anyone else's)
  sendSettings(settings: RoomSettings): void {
    if (this.current?.host) this.sendFrame(encodeSettings(settings));
  }

  // Leaves the room for `entry` (another the lobby chose): a fresh connection, the others in view dropped
  rejoin(entry: RoomEntry, name = this.name): void {
    this.entry = entry;
    this.name = name;
    this.current = null;
    const ws = this.ws;
    this.ws = null; // (its onclose then sees it is no longer the one in use: no retry)
    this.clearRemotes();
    if (ws) ws.close();
    this.stopped = false;
    this.retryMs = 1000;
    this.connect();
  }

  // A frame to the server, when connected and in the room
  sendFrame(frame: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'online') this.ws.send(frame);
  }

  // The chat: the lines said in the room (bottom left), and a field Enter opens (Enter again says it, Esc lets it go)
  buildChat(): [HTMLDivElement, HTMLDivElement, HTMLInputElement] {
    const chat = document.createElement('div');
    chat.className = 'mp-chat';
    const log = document.createElement('div');
    log.className = 'mp-chat-log';
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const input = document.createElement('input');
    input.className = 'mp-chat-input';
    input.type = 'text';
    input.maxLength = CHAT_MAX;
    input.dataset.i18nPlaceholder = 'mp.chatPlaceholder';
    input.placeholder = t('mp.chatPlaceholder');
    setLabel(input, 'mp.chat');
    input.hidden = true;
    const button = document.createElement('button');
    button.className = 'mp-chat-btn';
    button.type = 'button';
    setText(button, 'mp.chat');
    chat.append(log, input, button);
    // over the minimap, bottom left (in the HUD's column there)
    (document.querySelector('.hud-bottom-left') ?? document.body).prepend(chat);
    const open = () => {
      input.hidden = false;
      button.hidden = true;
      this.controllers.resetInput(); // (whatever key was held stays held otherwise)
      input.focus();
    };
    const close = () => {
      input.value = '';
      input.hidden = true;
      button.hidden = false;
      input.blur();
    };
    button.addEventListener('click', open);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || !input.hidden || isTypingInField(e)) return;
      e.preventDefault();
      open();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (the game's keys stay out of it)
      if (e.code === 'Escape') close();
      if (e.code !== 'Enter') return;
      const text = input.value.trim();
      if (text) this.sendFrame(encodeChat(text));
      close();
    });
    input.addEventListener('blur', () => { if (!input.value) close(); });
    return [chat, log, input];
  }

  // A line in the chat (from 0: the server's, like who killed whom); the oldest go past CHAT_LINES, each fades in time
  addChatLine(from: number, name: string, text: string): void {
    const line = document.createElement('div');
    line.className = from ? 'mp-chat-line' : 'mp-chat-line mp-chat-system';
    if (from) {
      const who = document.createElement('span');
      who.className = 'mp-chat-name';
      who.textContent = from === this.id ? t('mp.you', { name }) : name;
      line.append(who, document.createTextNode(` ${text}`));
    } else {
      line.textContent = text;
    }
    this.chatLog.append(line);
    while (this.chatLog.childElementCount > CHAT_LINES) this.chatLog.firstElementChild?.remove();
    setTimeout(() => { line.classList.add('mp-chat-old'); }, CHAT_FADE_MS);
  }

  connect(): void {
    if (this.stopped) return;
    this.status = 'connecting';
    this.renderBadge();
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.status = 'error';
      this.renderBadge(err instanceof Error ? err.message : undefined);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const entry = this.entry;
      ws.send(entry.kind === 'create' ? encodeCreate(this.region, this.name, entry.spec)
        : entry.kind === 'join' ? encodeHello(this.region, this.name, entry.room, entry.password)
          : encodeHello(this.region, this.name));
      this.lastSent = null;
    };
    ws.onmessage = (e: MessageEvent<unknown>) => {
      if (!(e.data instanceof ArrayBuffer)) return; // (binaryType 'arraybuffer': anything else is a text frame)
      const msg = decodeServer(e.data);
      if (msg) this.receive(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearRemotes();
      if (this.stopped) return;
      this.status = 'offline';
      this.renderBadge();
      setTimeout(() => { this.connect(); }, this.retryMs);
      this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    };
  }

  receive(msg: ServerMessage): void {
    if (msg.op === OP.WELCOME) {
      this.id = msg.id;
      this.room = msg.title || msg.room;
      this.tickMs = 1000 / Math.max(1, msg.tickHz);
      this.status = 'online';
      this.retryMs = 1000;
      // a room the player opened is one to come back to by its code (the connection drops, the room stays)
      if (this.entry.kind === 'create') this.entry = { kind: 'join', room: msg.code, password: this.entry.spec.password };
      this.current = { title: msg.title, code: msg.code, host: msg.host === msg.id, hostId: msg.host, settings: msg.settings };
      this.applySettings(msg.settings, false);
      this.renderBadge();
      return;
    }
    if (msg.op === OP.ROOM) {
      const room = this.current;
      if (!room) return;
      const changed = settingsSummary(msg.settings) !== settingsSummary(room.settings);
      room.host = msg.host === this.id;
      if (room.host && room.hostId !== msg.host) this.crime?.toast(t('mp.host'));
      room.hostId = msg.host;
      room.settings = msg.settings;
      if (changed) this.applySettings(msg.settings, true);
      return;
    }
    if (msg.op === OP.ERROR) {
      // a version mismatch or a rejected region won't fix itself by retrying, nor a room that turned the player away
      // (main.ts reopens the lobby with why)
      if (msg.code === 'version' || msg.code === 'region' || REJECTIONS.has(msg.code)) this.stopped = true;
      this.status = 'error';
      this.renderBadge(msg.code);
      if (REJECTIONS.has(msg.code)) this.onRejected?.(msg.code);
      return;
    }
    if (msg.op === OP.CHAT_LINE) {
      this.addChatLine(msg.from, msg.name, msg.text);
      return;
    }
    if (msg.op === OP.SHOT_SEEN) {
      this.crime?.showShot(msg.shot);
      return;
    }
    if (msg.op === OP.HURT) {
      // from where the shooter is now (the blood & the flash point back at it)
      const by = this.remotes.get(msg.from);
      const crime = this.crime;
      if (crime?.state !== 'play') return;
      this.lastHurtBy = msg.from;
      this.lastHurtAt = performance.now();
      const p = by?.samples.at(-1);
      if (p) crime.hurt(msg.damage, p.x, p.z);
      else crime.hurt(msg.damage);
      return;
    }
    const now = performance.now();
    this.roomPlayers = msg.roomPlayers;
    for (const id of msg.gone) this.removeRemote(id);
    for (const { id, name } of msg.info) {
      if (!this.remotes.has(id)) this.remotes.set(id, new RemotePlayer(id, name));
    }
    for (const s of msg.moved) {
      const r = this.remotes.get(s.id);
      if (!r) continue;
      if (r.mode !== s.mode) this.setMode(r, s.mode);
      r.push(now, s, this.tickMs);
    }
    this.renderBadge();
  }

  setMode(r: RemotePlayer, mode: Mode): void {
    if (r.visual) r.visual.removeFromParent();
    r.visual = null;
    r.mode = mode;
    const entity = this.controllers.entities[mode];
    if (mode !== 'person' && entity) {
      r.visual = cloneVisual(entity);
      if (mode === 'cyclist' || mode === 'moto') r.leanPivot = counterpart(entity.mesh, r.visual, entity.leanPivot);
      if (mode === 'helicopter') {
        r.mainRotor = counterpart(entity.mesh, r.visual, entity.mainRotorPivot);
        r.tailRotor = counterpart(entity.mesh, r.visual, entity.tailRotorPivot);
      }
      this.scene.add(r.visual);
    }
    if ((mode === 'person' || mode === 'cyclist' || mode === 'moto') && !r.rig) {
      // every remote player keeps one look, seeded by its id
      r.rig = new PersonRig({ seed: 7.3 + r.id * 1.618, scale: 0.96 + (r.id % 7) * 0.012, girth: 0.95 + (r.id % 5) * 0.03, hair: (r.id % 4) * 0.08 });
    }
  }

  removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (this.rideId === id) {
      this.seat(); // (where the car was last)
      this.leaveRide();
    }
    if (r.visual) r.visual.removeFromParent();
    if (r.label) r.label.remove();
    this.remotes.delete(id);
  }

  clearRemotes(): void {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.roomPlayers = 0;
  }

  // Once a frame from the main loop, after the local controllers moved
  update(dt: number, _elapsed: number): void {
    const now = performance.now();
    this.sendPose(now);
    this.watchDeath(now);

    const renderTime = now - INTERP_DELAY_MS;
    const cam = this.camera;
    const targets = this.targets;
    let n = 0;
    this.crowd.begin();
    for (const r of this.remotes.values()) {
      if (!r.mode || r.samples.length === 0) continue;
      const p = r.sample(renderTime);
      // a passenger rides inside its driver's car: nothing of it to draw or to shoot, its name over the car
      if (r.mode === 'passenger') {
        this.placeLabel(r, p, Math.hypot(p.x - cam.position.x, p.z - cam.position.z));
        continue;
      }
      const t = targets[n] ?? (targets[n] = { id: 0, x: 0, y: 0, z: 0, heading: 0, person: true, halfW: 0, halfL: 0, height: 1.85 });
      n++;
      const body = BODIES[r.mode];
      t.id = r.id;
      t.x = p.x;
      t.y = p.y;
      t.z = p.z;
      t.heading = p.heading;
      t.person = !body;
      t.halfW = body?.halfW ?? 0;
      t.halfL = body?.halfL ?? 0;
      t.height = body?.height ?? 1.85;
      const dist = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
      if (r.visual) {
        r.visual.position.set(p.x, p.y, p.z);
        r.visual.rotation.y = p.heading;
        // a car or bicycle lies on the slope under its wheels, as the local player's does (controllers.ts tiltToGround)
        if (r.mode === 'car' || r.mode === 'cyclist' || r.mode === 'moto') {
          const car = r.mode === 'car';
          const t = this.controllers.groundTilt(p.x, p.z, p.heading, car ? 1.35 : 0.55, car ? 0.8 : 0.3, this._tilt);
          r.visual.rotation.order = 'YXZ';
          r.visual.rotation.x = t.pitch;
          r.visual.rotation.z = car ? t.roll : 0;
        }
      }
      if (r.mode === 'person' && r.rig) {
        const air = p.y - this.controllers.getGroundHeight(p.x, p.z, 'person');
        r.rig.update(dt, p.x, p.z, p.heading, groundFor, this.controllers, air > 0.05 ? air : 0);
        this.crowd.add(r.rig, dist);
      } else if (r.mode === 'cyclist' && r.leanPivot && r.rig) {
        r.pedalPhase += (p.speed / 0.35 / 3.2) * dt;
        r.rig.ride(r.leanPivot, r.pedalPhase, this.controllers.entities.cyclist.bikeFrame);
        this.crowd.add(r.rig, dist);
      } else if (r.mode === 'moto' && r.leanPivot && r.rig) {
        r.rig.ride(r.leanPivot, 0, this.controllers.entities.moto.bikeFrame);
        this.crowd.add(r.rig, dist);
      } else if (r.mode === 'helicopter') {
        if (r.mainRotor) r.mainRotor.rotation.y += dt * 24.0;
        if (r.tailRotor) r.tailRotor.rotation.x += dt * 32.0;
      }
      this.placeLabel(r, p, dist);
    }
    targets.length = n;
    this.crowd.end();
  }

  // The player killed (crime.state turned 'wasted'): the room hears it, and by whom when another player's hit was
  // the last to strike it, lately
  watchDeath(now: number): void {
    const crime = this.crime;
    if (!crime) return;
    const playing = crime.state === 'play';
    if (this.playing && crime.state === 'wasted') {
      const killer = now - this.lastHurtAt < KILL_WINDOW_MS && this.remotes.has(this.lastHurtBy) ? this.lastHurtBy : 0;
      this.sendFrame(encodeDown(killer));
      if (this.rideId) this.leaveRide();
    }
    this.playing = playing;
  }

  // ---- riding in a friend's car -----------------------------------------------------------------------------------

  // The friend whose car the walker stands by, to get in with (F, app/boarding.ts): { id, name } or null
  rideTarget(): { id: number; name: string } | null {
    if (this.rideId || this.controllers.activeMode !== 'person') return null;
    const p = this.controllers.entities.person.position;
    let best: RemotePlayer | null = null;
    let bestD = RIDE_REACH;
    for (const r of this.remotes.values()) {
      const s = r.samples.at(-1);
      if (r.mode !== 'car' || !s) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z) - 1.0; // (from its side, not its middle)
      if (d < bestD) {
        best = r;
        bestD = d;
      }
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  get riding(): boolean {
    return this.rideId !== 0;
  }

  // Into friend `id`'s car: the walker stays put out of sight (no traffic runs into it, the police find nobody there),
  // the camera rides along with the car (seat), and the others see a passenger there
  startRide(id: number): void {
    const r = this.remotes.get(id);
    if (r?.mode !== 'car' || this.controllers.activeMode !== 'person') return;
    this.rideId = id;
    this.controllers.seated = true;
    this.controllers.resetInput();
    this.controllers.entities.person.mesh.visible = false;
    for (const m of this.controllers.entities.person.crowd.meshes) m.visible = false;
    if (this.crime) this.crime.fireBlocked = true;
    this.seat();
    if (this.cameras) {
      this.cameras.follow = this.ride;
      this.cameras.resetForTeleport();
    }
    this.crime?.toast(t('toast.rideIn', { name: r.name }));
  }

  // Out of the car: the walker stands at its right-hand door (where the car is now), the camera back on it
  leaveRide(): void {
    if (!this.rideId) return;
    const c = this.ride;
    const p = this.controllers.entities.person;
    // (right of the heading is (-cos, sin))
    p.position.set(c.position.x - Math.cos(c.heading) * 1.6, c.position.y, c.position.z + Math.sin(c.heading) * 1.6);
    p.position.y = this.controllers.getGroundHeight(p.position.x, p.position.z, 'person');
    p.heading = c.heading;
    p.speed = 0;
    this.rideId = 0;
    this.controllers.seated = false;
    this.controllers.syncOccupants();
    if (this.crime) this.crime.fireBlocked = false;
    if (this.cameras) {
      this.cameras.follow = null;
      this.cameras.resetForTeleport();
    }
  }

  // Before the cameras, each frame: the ride at the friend's car's pose (drawn INTERP_DELAY_MS back, as the car is),
  // or out of it when the friend got out, drove off in something else or left
  seat(): void {
    if (!this.rideId) return;
    const r = this.remotes.get(this.rideId);
    if (r?.mode !== 'car') {
      this.leaveRide();
      return;
    }
    const p = r.sample(performance.now() - INTERP_DELAY_MS);
    this.ride.position.set(p.x, p.y, p.z);
    this.ride.heading = p.heading;
    this.ride.speed = p.speed;
  }

  sendPose(now: number): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN || this.status !== 'online' || now < this.nextSendAt) return;
    this.nextSendAt = now + 1000 / SEND_HZ;
    // (riding: the friend's car's pose, as a passenger)
    const frame = this.rideId ? encodeState(this.ride, 'passenger') : encodeState(this.controllers.getActiveEntity(), this.controllers.activeMode);
    const same = this.lastSent?.length === frame.length && this.lastSent.every((b, i) => b === frame[i]);
    if (same && now - this.lastSentAt < KEEPALIVE_MS) return;
    ws.send(frame);
    this.lastSent = frame;
    this.lastSentAt = now;
  }

  placeLabel(r: RemotePlayer, p: RemotePose, dist: number): void {
    const show = dist < LABEL_DISTANCE;
    if (show && !r.label) {
      const label = document.createElement('div');
      label.className = 'mp-label';
      label.textContent = r.name;
      this.labels.append(label);
      r.label = label;
    }
    if (!r.label) return;
    const height = r.mode === 'helicopter' ? 3.6 : r.mode === 'car' ? 2.2 : r.mode === 'passenger' ? 2.6 : 2.25;
    _v.set(p.x, p.y + height, p.z);
    // (in front of the camera, by its view space: with the reversed depth buffer a point behind it still projects to
    // a depth inside (-1, 1), so its tag showed in the middle of the screen)
    const ahead = _view.copy(_v).applyMatrix4(this.camera.matrixWorldInverse).z < -0.1;
    _v.project(this.camera);
    const visible = show && ahead && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    r.label.hidden = !visible;
    if (!visible) return;
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    r.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    r.label.style.opacity = String(Math.max(0.35, 1 - dist / LABEL_DISTANCE));
  }

  renderBadge(detail = ''): void {
    const text = {
      connecting: t('mp.connecting'),
      online: t(this.roomPlayers === 1 ? 'mp.onlineOne' : 'mp.online', { room: this.room, count: this.roomPlayers }),
      offline: t('mp.offline'),
      error: detail ? t('mp.errorDetail', { detail }) : t('mp.error')
    }[this.status];
    if (this.badge.textContent !== text) this.badge.textContent = text;
    this.badge.dataset.status = this.status;
  }
}

// The errors that turn the player away from a room rather than from the server: the lobby is the way on
const REJECTIONS: ReadonlySet<string> = new Set(['room', 'password', 'roomfull', 'wait']);
const NO_TARGETS: RemoteTarget[] = []; // (a room without PvP: the player's shots find nobody)

const groundFor = (controllers: MultiplayerControllers, x: number, z: number) => controllers.getGroundHeight(x, z, 'person');

// Reads ?multiplayer & friends; returns null when multiplayer is off or there is no server to reach. The server is
// &mp-server, else (from localhost) the one on DEFAULT_PORT, else the page's own (tools/play.ts serves both)
function multiplayerOptions(search = location.search, host = location.hostname, origin = location.origin): (Pick<MultiplayerOptions, 'url' | 'region' | 'name'> & { roomsUrl: string }) | null {
  const params = new URLSearchParams(search);
  if (!params.has('multiplayer') || params.get('multiplayer') === '0') return null;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  const own = /^https?:\/\//.test(origin) ? origin.replace(/^http/, 'ws') : null;
  const url = params.get('mp-server') || (local ? `ws://${host}:${String(DEFAULT_PORT)}` : own);
  if (!url || !/^wss?:\/\//.test(url)) return null;
  let name = params.get('mp-name') || '';
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else name = localStorage.getItem(NAME_KEY) || '';
  } catch {
    // storage blocked: the server hands out a numbered name
  }
  // (the first time, the lobby asks for it: the others see it over the player's head)
  // the flat city (?slopes=0) is a world of its own: everyone else stands up to 300 m higher on the town's slopes
  // (the region name is 32 characters at most, the suffix included)
  const base = params.get('mp-region') || DEFAULT_REGION;
  const region = params.get('slopes') === '0' ? `${base.slice(0, 27)}-flat` : base;
  // the room list, over http(s) from the same server
  const rooms = new URL(url);
  rooms.protocol = rooms.protocol === 'wss:' ? 'https:' : 'http:';
  rooms.pathname = '/rooms';
  rooms.search = `?region=${encodeURIComponent(region)}`;
  return { url, region, name, roomsUrl: rooms.toString() };
}

export { Multiplayer, RemotePlayer, multiplayerOptions, DEFAULT_REGION };
