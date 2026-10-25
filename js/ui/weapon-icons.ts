// js/ui/weapon-icons.js
// The arsenal's pictures, baked once from its 3D models (actors/weapon-models.js) after the city is on screen: each
// weapon on its own for the wheel's slots and the quick switch (ui/weapon-wheel.js), the same in the player's hand for
// the HUD (ui/crime-hud.js), and a full turn of the weapon for the middle of the wheel. The game's own renderer draws them off screen into a render target, between frames, at
// twice the size (halved again on a canvas: antialiased), lit by a studio room rather than the city's sky.

import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPON_ORDER } from '../sim/weapons.ts';
import { buildWeaponGeometry, buildHeldGeometry, createWeaponMaterial } from '../actors/weapon-models.ts';

const ICON = [320, 160]; // px of a picture in the hand
const SPIN = [256, 128]; // px of each frame of the turn
const SPIN_FRAMES = 24;
const ICON_VIEW = new THREE.Vector3(-1, 0.2, 0.12).normalize(); // from the gun's right, a little above and in front
const FIST_VIEW = new THREE.Vector3(-0.7, 0.3, 0.75).normalize(); // the fist from ahead, its knuckles and thumb
const SPIN_VIEW = new THREE.Vector3(-1, 0.32, 0).normalize();
const MARGIN = 1.06;

const _box = new THREE.Box3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

class WeaponIcons {
  constructor(renderer) {
    this.renderer = renderer;
    this.ready = false;
    this.icons = {}; // id -> { canvas, url }: the weapon alone
    this.held = {}; // id -> { canvas, url }: in the hand
    this.spins = {}; // id -> a canvas of SPIN_FRAMES frames, one under the other
    this.frames = SPIN_FRAMES;
    this.spinSize = SPIN;
    this.listeners = [];
    this.baking = null;
  }

  // The picture of a weapon alone, or (`held`) in the hand
  url(id, held = false) {
    return (held ? this.held : this.icons)[id]?.url || null;
  }

  onReady(fn) {
    if (this.ready) fn(this);
    else this.listeners.push(fn);
  }

  // Draws frame `i` of a weapon's turn onto a 2D context (false until it has been baked)
  drawSpin(ctx, id, i) {
    const sheet = this.spins[id];
    if (!sheet) return false;
    const [w, h] = SPIN;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(sheet, 0, (i % SPIN_FRAMES) * h, w, h, 0, 0, ctx.canvas.width, ctx.canvas.height);
    return true;
  }

  bake() {
    this.baking ??= this.run().catch((e) => console.warn('[weapon-icons] could not bake the weapon pictures', e));
    return this.baking;
  }

  async run() {
    const r = this.renderer;
    if (!r?.readRenderTargetPixelsAsync || typeof document === 'undefined') return;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 0.85;
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(-1.2, 2, 1.1);
    const rim = new THREE.DirectionalLight(0xc4d8ff, 1.8);
    rim.position.set(1.3, 0.9, -1.6);
    scene.add(key, rim);
    const material = createWeaponMaterial();
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = false;
    pivot.add(mesh);
    scene.add(pivot);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    const targets = {
      icon: new THREE.RenderTarget(ICON[0] * 2, ICON[1] * 2),
      spin: new THREE.RenderTarget(SPIN[0] * 2, SPIN[1] * 2)
    };
    for (const t of Object.values(targets)) t.texture.colorSpace = THREE.SRGBColorSpace;
    const flipRows = !r.backend?.isWebGPUBackend; // (WebGL reads back bottom row first)

    // one frame: drawn now, read back later (the copies run in the order they were asked for)
    const shoot = (target) => {
      const before = r.getRenderTarget();
      const clear = r.getClearColor(new THREE.Color());
      const alpha = r.getClearAlpha();
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, camera);
      const read = r.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
      r.setRenderTarget(before);
      r.setClearColor(clear, alpha);
      return read;
    };

    let compiled = false;
    for (const id of WEAPON_ORDER) {
      // in the hand: framed on the gun and the hands, the forearms running off the edge
      const held = buildHeldGeometry(id);
      mesh.geometry = held;
      mesh.position.set(0, 0, 0);
      pivot.rotation.set(0, 0, 0);
      held.userData.bounds.getCenter(_c);
      frame(camera, id === 'fists' ? FIST_VIEW : ICON_VIEW, _c, cornersOf(held.userData.bounds), ICON[0] / ICON[1]);
      if (!compiled) {
        await r.compileAsync(scene, camera);
        compiled = true;
      }
      const inHand = toCanvas(await shoot(targets.icon), targets.icon, ICON, flipRows);
      this.held[id] = { canvas: inHand, url: inHand.toDataURL('image/png') };
      held.dispose();

      // alone: the gun (the bare fist for the fists), from the same side
      const gun = buildWeaponGeometry(id) || buildHeldGeometry(id, { arms: false });
      mesh.geometry = gun;
      gun.computeBoundingBox();
      gun.boundingBox.getCenter(_c);
      frame(camera, id === 'fists' ? FIST_VIEW : ICON_VIEW, _c, cornersOf(gun.boundingBox), ICON[0] / ICON[1]);
      const alone = toCanvas(await shoot(targets.icon), targets.icon, ICON, flipRows);
      this.icons[id] = { canvas: alone, url: alone.toDataURL('image/png') };

      // the turn: the same turning about its middle, one scale for the whole turn
      gun.boundingBox.getCenter(_c);
      mesh.position.copy(_c).negate();
      const corners = [];
      const local = cornersOf(_box.copy(gun.boundingBox).translate(_p.copy(_c).negate()));
      for (let f = 0; f < SPIN_FRAMES; f++) {
        const yaw = (f / SPIN_FRAMES) * Math.PI * 2;
        for (const v of local) corners.push(v.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw));
      }
      frame(camera, SPIN_VIEW, _p.set(0, 0, 0), corners, SPIN[0] / SPIN[1]);
      const reads = [];
      for (let f = 0; f < SPIN_FRAMES; f++) {
        pivot.rotation.y = (f / SPIN_FRAMES) * Math.PI * 2;
        pivot.updateMatrixWorld(true);
        reads.push(shoot(targets.spin));
      }
      const sheet = document.createElement('canvas');
      sheet.width = SPIN[0];
      sheet.height = SPIN[1] * SPIN_FRAMES;
      const ctx = sheet.getContext('2d');
      const pixels = await Promise.all(reads);
      pixels.forEach((px, f) => ctx.drawImage(toCanvas(px, targets.spin, SPIN, flipRows), 0, f * SPIN[1]));
      this.spins[id] = sheet;
      gun.dispose();
      // (a breath between weapons, for the frames in between)
      await new Promise((done) => setTimeout(done, 0));
    }

    for (const t of Object.values(targets)) t.dispose();
    material.dispose();
    env.dispose();
    pmrem.dispose();
    room.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.ready = true;
    for (const fn of this.listeners.splice(0)) fn(this);
  }
}

function cornersOf(box) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  }
  return out;
}

// An orthographic camera looking at `centre` from along `view`, just wide enough for `points` at this aspect
function frame(camera, view, centre, points, aspect) {
  camera.position.copy(view).multiplyScalar(4).add(centre);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const inv = camera.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of points) {
    _p.copy(v).applyMatrix4(inv);
    x0 = Math.min(x0, _p.x);
    x1 = Math.max(x1, _p.x);
    y0 = Math.min(y0, _p.y);
    y1 = Math.max(y1, _p.y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = Math.max((x1 - x0) / 2, ((y1 - y0) / 2) * aspect) * MARGIN;
  camera.left = cx - hw;
  camera.right = cx + hw;
  camera.top = cy + hw / aspect;
  camera.bottom = cy - hw / aspect;
  camera.updateProjectionMatrix();
}

// Read-back pixels at twice the size into a canvas of `size`
function toCanvas(pixels, target, [w, h], flipRows) {
  const full = document.createElement('canvas');
  full.width = target.width;
  full.height = target.height;
  const data = new ImageData(target.width, target.height);
  const row = target.width * 4;
  const stride = pixels.length / target.height; // (rows may be padded)
  for (let y = 0; y < target.height; y++) {
    const from = (flipRows ? target.height - 1 - y : y) * stride;
    data.data.set(pixels.subarray(from, from + row), y * row);
  }
  full.getContext('2d').putImageData(data, 0, 0);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, w, h);
  return out;
}

export { WeaponIcons };
