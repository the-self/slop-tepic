// js/actors/person-body.ts
// The player's body as Meshy rigged it (tools/models/prepare-rigged-person.mjs: its own 24 bones, Hips to the toes),
// moved by Meshy's motion-captured clips: standing, walking and running (in step with the ground they cover), walking
// back, stepping sideways and back with a gun, and the jump while in the air. What no clip does comes from the game's
// own rig (sim/pedestrians.ts PersonRig), its bones' turns copied onto these: the arms raised where the crosshair is
// over the clips (aiming, punching), and the whole body astride a bike or a moto, or lying as a ragdoll (follow).
// One body, loaded once in the background; until it loads (or if it fails) the player is the crowd's person.
import * as THREE from 'three/webgpu';
import { BONE, LIMB, SIDES } from '../sim/person-skeleton.ts';
import type { PersonRig } from '../sim/pedestrians.ts';

// The rig's bones each of these follows (follow): [bone, bone, how far from the first to the second's turn]
const FOLLOWS: Record<string, readonly [a: number, b: number, t: number]> = {
  Hips: [BONE.PELVIS, BONE.PELVIS, 0],
  Spine02: [BONE.PELVIS, BONE.CHEST, 0.35],
  Spine01: [BONE.PELVIS, BONE.CHEST, 0.7],
  Spine: [BONE.CHEST, BONE.CHEST, 0],
  neck: [BONE.CHEST, BONE.HEAD, 0.5],
  Head: [BONE.HEAD, BONE.HEAD, 0]
};
SIDES.forEach((_, k) => {
  const side = k === 0 ? 'Left' : 'Right'; // (the rig's left, +x, is the body's: both face +z)
  FOLLOWS[`${side}Shoulder`] = [BONE.CHEST, BONE.CHEST, 0];
  FOLLOWS[`${side}Arm`] = [LIMB.upperArm[k], LIMB.upperArm[k], 0];
  FOLLOWS[`${side}ForeArm`] = [LIMB.forearm[k], LIMB.forearm[k], 0];
  FOLLOWS[`${side}Hand`] = [LIMB.forearm[k], LIMB.forearm[k], 0];
  FOLLOWS[`${side}UpLeg`] = [LIMB.thigh[k], LIMB.thigh[k], 0];
  FOLLOWS[`${side}Leg`] = [LIMB.shin[k], LIMB.shin[k], 0];
  FOLLOWS[`${side}Foot`] = [LIMB.foot[k], LIMB.foot[k], 0];
  FOLLOWS[`${side}ToeBase`] = [LIMB.toe[k], LIMB.toe[k], 0];
});
// A limb bone's length points from it to the next joint, here and in the rig's bind pose: [bone, next, rig bone, its next]
const SEGMENTS: [string, string, number, number][] = [];
SIDES.forEach((_, k) => {
  const side = k === 0 ? 'Left' : 'Right';
  SEGMENTS.push(
    [`${side}Arm`, `${side}ForeArm`, LIMB.upperArm[k], LIMB.forearm[k]],
    [`${side}ForeArm`, `${side}Hand`, LIMB.upperArm[k], LIMB.forearm[k]], // (the rig's arm hangs straight in its bind)
    [`${side}UpLeg`, `${side}Leg`, LIMB.thigh[k], LIMB.shin[k]],
    [`${side}Leg`, `${side}Foot`, LIMB.shin[k], LIMB.foot[k]],
    [`${side}Foot`, `${side}ToeBase`, LIMB.foot[k], LIMB.toe[k]]
  );
});
// ...and those with no next joint turn as the one before them
const SAME_AS: Record<string, string> = { LeftHand: 'LeftForeArm', RightHand: 'RightForeArm', LeftToeBase: 'LeftFoot', RightToeBase: 'RightFoot' };
// The arms, raised over the clips while aiming or punching: [upper arm, forearm, hand] per side
const ARMS = [['LeftArm', 'LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm', 'RightHand']] as const;

const CLIPS = ['idle', 'walk', 'run', 'walk_back', 'walk_back_gun', 'strafe', 'jump'] as const;
type ClipName = (typeof CLIPS)[number];

// The clips' gait, measured on them (how fast a planted foot goes back under the hips, by the length of their cycle):
// m covered in one cycle (two steps), and the speeds the walk turns into the run over (m/s)
const WALK_STRIDE = 1.57; // (1.47 m/s)
const RUN_STRIDE = 3.42; // (5.1 m/s: the player's run, 4.4 m/s, a little slower)
const BACK_STRIDE = 1.11;
const STRAFE_STRIDE = 1.11;
const WALK_TOP = 1.6;
const RUN_FROM = 3.2;
const MAX_CADENCE = 1.6; // the most a clip is sped up (a sprint covers the rest with longer strides than the clip's)
// The jump: when its feet leave the ground and land again (s into the clip, as its hips rise and fall), and how long
// the player's jump is in the air (controllers/person.ts: up at 5.2 m/s, down at 14.5 m/s²)
const JUMP_OFF = 0.64;
const JUMP_LAND = 1.02;
const JUMP_AIR = (2 * 5.2) / 14.5;

const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _va = new THREE.Vector3();
const _m = new THREE.Matrix4();

// (three's classes test as `any`-typed: these say what they found)
function isSkinned(o: THREE.Object3D): o is THREE.SkinnedMesh {
  return o instanceof THREE.SkinnedMesh;
}
function isBone(o: THREE.Object3D | null): o is THREE.Bone {
  return o instanceof THREE.Bone;
}

/** The body Meshy made for the player, posed by its clips (walk) or by a rig of the game's (follow) */
export class PersonBody {
  /** in the scene: the body posed in world space (its root on the player's feet while walking) */
  readonly root: THREE.Object3D;
  private readonly armature: THREE.Object3D;
  private readonly bones: THREE.Bone[];
  private readonly parentOf: number[]; // each bone's parent's index (-1: the armature)
  private readonly restLocal: THREE.Quaternion[];
  private readonly restWorld: THREE.Quaternion[];
  private readonly align: THREE.Quaternion[]; // a bone's rest length turned onto the rig bone's bind length
  private readonly follows: (readonly [number, number, number] | null)[];
  private readonly world: THREE.Quaternion[]; // (scratch: each bone's turn in the world as it is posed)
  private readonly hipsRest: THREE.Vector3; // the hips' joint at rest (m, standing at the origin facing +z)
  private readonly hips: THREE.Bone;
  private readonly hand: THREE.Bone;
  private readonly head: THREE.Bone;
  private readonly headRest: THREE.Vector3; // its joint at rest (m)
  private readonly arms: number[][];
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<ClipName, THREE.AnimationAction>;
  private phase = 0;
  private airTime = 0;
  private jump = 0;

  constructor(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    this.root = gltf.scene;
    this.root.name = 'PlayerBody';
    const found: THREE.SkinnedMesh[] = [];
    this.root.traverse((o) => {
      if (isSkinned(o)) found.push(o);
    });
    const mesh = found.at(0);
    if (!mesh) throw new Error('the body has no skinned mesh');
    mesh.frustumCulled = false; // (its bounds are its rest pose's: a ragdoll lies far from them)
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.bones = mesh.skeleton.bones;
    const named = (name: string) => {
      const i = this.bones.findIndex((b) => b.name === name);
      if (i < 0) throw new Error(`the body has no ${name}`);
      return i;
    };
    const hips = this.bones[named('Hips')];
    if (!hips.parent) throw new Error('the body\'s hips have no armature');
    this.armature = hips.parent;
    this.hips = hips;
    this.hand = this.bones[named('RightHand')];
    this.parentOf = this.bones.map((b) => (isBone(b.parent) ? this.bones.indexOf(b.parent) : -1));

    // the rest pose, as the file's bones stand (not skeleton.pose(): that puts the armature's scale on the hips again):
    // each bone's turn (its own and in the world) and joint
    this.root.updateMatrixWorld(true);
    this.restLocal = this.bones.map((b) => b.quaternion.clone());
    this.restWorld = this.bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    const restJoint = this.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    this.hipsRest = restJoint[this.bones.indexOf(hips)].clone();
    this.head = this.bones[named('Head')];
    this.headRest = restJoint[this.bones.indexOf(this.head)].clone();
    this.world = this.bones.map(() => new THREE.Quaternion());
    this.follows = this.bones.map((b) => (b.name in FOLLOWS ? FOLLOWS[b.name] : null));
    this.arms = ARMS.map((arm) => arm.map(named));
    this.align = this.bones.map(() => new THREE.Quaternion());
    this.mixer = new THREE.AnimationMixer(this.root);
    const clip = (name: ClipName) => {
      const c = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!c) throw new Error(`the body has no clip ${name}`);
      // (the jump's hips stay where they are: the player's own jump lifts the body)
      if (name === 'jump') c.tracks = c.tracks.filter((t) => t.name !== 'Hips.position');
      const action = this.mixer.clipAction(c);
      action.play();
      action.timeScale = 0; // (its time set by hand, walk)
      action.setEffectiveWeight(0);
      return action;
    };
    const actions: Partial<Record<ClipName, THREE.AnimationAction>> = {};
    for (const name of CLIPS) actions[name] = clip(name);
    this.actions = actions as Record<ClipName, THREE.AnimationAction>; // (every name was just set)
    this.alignTo = restJoint;
  }

  // (the alignment needs the rig's bind joints: worked out the first time a rig is followed)
  private alignTo: THREE.Vector3[] | null;
  private aligned(rig: PersonRig): void {
    const rest = this.alignTo;
    if (!rest) return;
    this.alignTo = null;
    const j = rig.bind;
    for (const [bone, next, rb, rn] of SEGMENTS) {
      const i = this.bones.findIndex((b) => b.name === bone), n = this.bones.findIndex((b) => b.name === next);
      _v.copy(rest[n]).sub(rest[i]).normalize();
      _va.copy(j[rn]).sub(j[rb]).normalize();
      this.align[i].setFromUnitVectors(_v, _va);
    }
    for (const [bone, like] of Object.entries(SAME_AS)) {
      const i = this.bones.findIndex((b) => b.name === bone), n = this.bones.findIndex((b) => b.name === like);
      this.align[i].copy(this.align[n]);
    }
  }

  // the turn `rig` gives bone i in the world: its rig bone's turn, onto this bone's rest length
  private rigTurn(rig: PersonRig, i: number, a: number, b: number, t: number, out: THREE.Quaternion): THREE.Quaternion {
    const pose = rig.pose;
    out.set(pose[a * 8], pose[a * 8 + 1], pose[a * 8 + 2], pose[a * 8 + 3]);
    if (t > 0) out.slerp(_qb.set(pose[b * 8], pose[b * 8 + 1], pose[b * 8 + 2], pose[b * 8 + 3]), t);
    return out.multiply(this.align[i]).multiply(this.restWorld[i]);
  }

  // bone i turned `turn` in the world, its parent's world turn already in `this.world`
  private setTurn(i: number, turn: THREE.Quaternion): void {
    const p = this.parentOf[i];
    if (p < 0) this.armature.getWorldQuaternion(_qParent);
    else _qParent.copy(this.world[p]);
    this.bones[i].quaternion.copy(_qParent.invert()).multiply(turn);
    this.world[i].copy(turn);
  }

  /** Posed as `rig` is (astride a bike or a moto, a ragdoll): its bones' turns and the pelvis's place, in world space */
  follow(rig: PersonRig): void {
    this.aligned(rig);
    for (const a of CLIPS) this.actions[a].setEffectiveWeight(0);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.bones.length; i++) {
      const f = this.follows[i];
      if (f) this.setTurn(i, this.rigTurn(rig, i, f[0], f[1], f[2], _q));
      else this.setTurn(i, _q.copy(this.world[this.parentOf[i]]).multiply(this.restLocal[i]));
    }
    // the hips where the rig's pelvis puts them (its pose maps a bind point v to q·v·s + t)
    const pose = rig.pose, o = BONE.PELVIS * 8;
    _v.copy(this.hipsRest).applyQuaternion(_qa.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3])).multiplyScalar(pose[o + 7]);
    _v.x += pose[o + 4];
    _v.y += pose[o + 5];
    _v.z += pose[o + 6];
    this.hips.position.copy(_v.applyMatrix4(_m.copy(this.armature.matrixWorld).invert()));
    this.root.updateMatrixWorld(true);
    // a rider's helmet goes on this head, not the rig's (its neck is this body's length: frame.ts reads it after)
    if (rig.headPosition) {
      const o = BONE.HEAD * 8;
      _qa.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
      this.head.getWorldPosition(rig.headPosition).add(_va.copy(rig.bind[BONE.HEAD]).sub(this.headRest).applyQuaternion(_qa));
    }
  }

  /**
   * On foot at (x, y, z) facing `heading` (rad, 0 facing +z): the clips by how fast it goes ahead (`forward`, m/s, < 0
   * backwards) and to its right (`strafe`, m/s), the jump while `air` m off the ground, and the arms raised over them as
   * far as `rig` aims (PersonRig aim, aimBoth: the arms it solves). Puts rig.handPosition on this body's right wrist.
   */
  walk(dt: number, x: number, y: number, z: number, heading: number, forward: number, strafe: number, air: number, rig: PersonRig): void {
    this.aligned(rig);
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, heading, 0);
    const moving = Math.hypot(forward, strafe);
    const aiming = rig.aim;

    // in the air: the jump's flight, from its feet leaving the ground to its landing, over the player's time up there
    this.airTime = air > 0.05 ? this.airTime + dt : 0;
    this.jump += ((air > 0.12 ? 1 : 0) - this.jump) * Math.min(1, dt * 12);

    // the gait: one cycle every stride covered, whichever clip it is in
    const share = moving > 1e-3 ? 1 / (Math.abs(forward) + Math.abs(strafe)) : 0;
    const ahead = Math.max(0, forward) * share, back = Math.max(0, -forward) * share, side = Math.abs(strafe) * share;
    const run = THREE.MathUtils.smoothstep(forward, WALK_TOP, RUN_FROM);
    const stride = ahead * (WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * run) + back * BACK_STRIDE + side * STRAFE_STRIDE;
    const cycle = ahead * ((1 - run) * this.length('walk') + run * this.length('run')) + back * this.length('walk_back') + side * this.length('strafe');
    const pace = cycle > 0 ? Math.min(moving, (stride / cycle) * MAX_CADENCE) : 0; // (m/s the clips step at, at most)
    if (stride > 0) this.phase = (this.phase + (dt * pace) / stride) % 1;

    const go = THREE.MathUtils.smoothstep(moving, 0.05, 0.7) * (1 - this.jump);
    this.set('idle', (1 - go) * (1 - this.jump), 0);
    this.set('walk', go * ahead * (1 - run), this.phase);
    this.set('run', go * ahead * run, this.phase);
    this.set('walk_back', go * back * (1 - aiming), this.phase);
    this.set('walk_back_gun', go * back * aiming, this.phase);
    // (the clip steps to the left: played backwards, to the right)
    this.set('strafe', go * side, strafe < 0 ? this.phase : 1 - this.phase);
    this.set('jump', this.jump, (JUMP_OFF + (JUMP_LAND - JUMP_OFF) * Math.min(1, this.airTime / JUMP_AIR)) / this.length('jump'));
    // (the idle clip's own time, so it breathes and shifts its weight)
    const idle = this.actions.idle;
    idle.time = (idle.time + dt) % this.length('idle');
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);

    // the arms the rig raises (the gun arm, both for a long gun), over the clips' as far as it aims
    if (aiming > 0.01) {
      for (let k = 0; k < 2; k++) {
        const w = aiming * (SIDES[k] < 0 || rig.aimBoth ? 1 : 0);
        if (w <= 0) continue;
        for (const i of this.arms[k]) {
          const f = this.follows[i];
          if (!f) continue;
          this.bones[i].parent?.getWorldQuaternion(_qParent);
          this.bones[i].getWorldQuaternion(_qa);
          this.rigTurn(rig, i, f[0], f[1], f[2], _q);
          this.bones[i].quaternion.copy(_qParent.invert()).multiply(_qa.slerp(_q, w));
          this.bones[i].updateMatrixWorld(true);
        }
      }
    }
    // the gun's hand: where it is, and turned as the rig's forearm would be to put it there (sim/crime/player.ts)
    this.hand.getWorldPosition(rig.handPosition);
    const h = this.bones.indexOf(this.hand);
    this.hand.getWorldQuaternion(_q);
    (rig.handTurn ??= new THREE.Quaternion()).copy(_q).multiply(_qa.copy(this.restWorld[h]).invert()).multiply(_qb.copy(this.align[h]).invert());
  }

  private length(name: ClipName): number {
    return this.actions[name].getClip().duration;
  }

  // a clip's share of the pose and where in it (0..1 of its length)
  private set(name: ClipName, weight: number, at: number): void {
    const a = this.actions[name];
    a.setEffectiveWeight(weight);
    if (name !== 'idle') a.time = at * a.getClip().duration;
  }
}

const bodies = new Map<string, Promise<PersonBody>>();

/** The body at `url`, loading it the first time it is asked for (a load that failed is tried again the next time) */
export function loadPersonBody(url: string): Promise<PersonBody> {
  const known = bodies.get(url);
  if (known) return known;
  const body = import('three/addons/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
    .then((gltf) => new PersonBody(gltf));
  bodies.set(url, body);
  void body.catch(() => {
    if (bodies.get(url) === body) bodies.delete(url);
  });
  return body;
}
