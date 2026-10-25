// js/world/buildings/sign-atlas.ts
// The shop sign atlas: its canvas pages (page 0 the chains & trades for good, the others the businesses' own names
// handed out around the camera by sign-slots.ts), the sign drawn into a slot, and the chain stores' pole signs.
import * as THREE from 'three/webgpu';
import { attribute, texture } from 'three/tsl';
import { atlasSlotUV } from '../../render/tsl-materials.ts';
import { GEO } from '../city-geodata.js';
import { createSignSlots } from '../sign-slots.ts';
import { MAX_AWNINGS } from './detail-pools.ts';
import type { SignFace } from '../city-geodata.js';
import type { SignSlots } from '../sign-slots.ts';
import type { AtlasPage, Collider, Pylon } from './types.ts';

const SIGNS = GEO.signs; // shop sign faces (chains under parody names, local businesses, trades)

// 5B. Shop sign atlas (city-geodata.js `signs`: chains under parody names, trades, local businesses), in pages of
//     one canvas texture each, each sign box picking its page (its mesh) and slot (per instance). Page 0 holds the
//     chains & trades for good; the businesses' own names (some 6,600) come and go in the other pages, drawn in as
//     they come within NAME_RADIUS (js/world/sign-slots.ts), and past it or with the pages full show their trade
const ATLAS_COLS = 8;
const SLOT_W = 256;
const SLOT_H = 40;
const NAME_PAGES = 6;
const NAME_PAGE_ROWS = 16; // 128 names a page (2048 x 640 px)
const NAME_RADIUS = 220; // m (a 0.6 m sign is a few pixels high further out: its trade's sign reads the same)

function drawSign(ctx: CanvasRenderingContext2D, sg: SignFace, slot: number) {
  const x0 = (slot % ATLAS_COLS) * SLOT_W;
  const y0 = Math.floor(slot / ATLAS_COLS) * SLOT_H;
  ctx.fillStyle = sg.bg;
  ctx.fillRect(x0, y0, SLOT_W, SLOT_H);
  if (sg.stripe) {
    // a logo between two stripes (OKSO)
    ctx.fillStyle = sg.stripe;
    ctx.fillRect(x0, y0, SLOT_W, 6);
    ctx.fillRect(x0, y0 + SLOT_H - 6, SLOT_W, 6);
  } else {
    ctx.strokeStyle = sg.border || sg.fg;
    ctx.lineWidth = sg.chain ? 4 : 2;
    ctx.strokeRect(x0 + 3, y0 + 3, SLOT_W - 6, SLOT_H - 6);
  }
  ctx.fillStyle = sg.fg;
  let px = sg.chain ? 26 : 22;
  const weight = sg.chain ? '900' : '800';
  do {
    ctx.font = `${weight} ${px}px Inter, Arial, sans-serif`;
    px--;
  } while (px > 9 && ctx.measureText(sg.text).width > SLOT_W - 18);
  ctx.fillText(sg.text, x0 + SLOT_W / 2, y0 + SLOT_H / 2 + 1);
}

function atlasPage(group: THREE.Group, unitBox: THREE.BoxGeometry, rows: number): AtlasPage {
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS * SLOT_W;
  c.height = rows * SLOT_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('buildings: no 2D canvas context');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = unitBox.clone();
  const slots = new THREE.InstancedBufferAttribute(new Float32Array(MAX_AWNINGS), 1);
  geo.setAttribute('signSlot', slots);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = texture(tex, atlasSlotUV(attribute('signSlot', 'float'), ATLAS_COLS, rows));
  const inst = new THREE.InstancedMesh(geo, mat, MAX_AWNINGS);
  inst.frustumCulled = false;
  inst.count = 0;
  group.add(inst);
  return { ctx, tex, inst, slots, count: 0 };
}

/** The atlas's pages (none in a city without signs) and the name slots, the chains' pole signs added to `group` */
function createSignAtlas(group: THREE.Group, unitBox: THREE.BoxGeometry, dummy: THREE.Object3D, pylons: Pylon[], colliders: Collider[]): { atlasPages: AtlasPage[]; signSlots: SignSlots } {
  let fixedSigns = SIGNS.findIndex((sg) => sg.trade);
  if (fixedSigns < 0) fixedSigns = SIGNS.length;
  const atlasPages: AtlasPage[] = [];
  const signSlots = createSignSlots(NAME_PAGES, ATLAS_COLS * NAME_PAGE_ROWS);
  if (SIGNS.length) {
    const fixed = atlasPage(group, unitBox, Math.max(1, Math.ceil(fixedSigns / ATLAS_COLS)));
    for (let k = 0; k < fixedSigns; k++) drawSign(fixed.ctx, SIGNS[k], k);
    atlasPages.push(fixed);
    if (fixedSigns < SIGNS.length) for (let p = 0; p < NAME_PAGES; p++) atlasPages.push(atlasPage(group, unitBox, NAME_PAGE_ROWS));
    const mat = fixed.inst.material;

    // 5C. Chain stores' pole signs: a tall pole at the corner of the front with the logo box on top (both faces)
    if (pylons.length) {
      const poleInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 10).translate(0, 0.5, 0), new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.3 }), pylons.length);
      const signGeo = unitBox.clone();
      const pylonSlots = new THREE.InstancedBufferAttribute(new Float32Array(pylons.length), 1);
      signGeo.setAttribute('signSlot', pylonSlots);
      const signInst = new THREE.InstancedMesh(signGeo, mat, pylons.length);
      pylons.forEach((p, k) => {
        // at one end of the front, out on the sidewalk
        const endU = (p.along * 0.5 - 0.8) * (p.ov ? 1 : 0), endV = (p.along * 0.5 - 0.8) * (p.ou ? 1 : 0);
        const x = p.front[0] + endU * p.cs + endV * p.sn, z = p.front[1] - endU * p.sn + endV * p.cs;
        const H = p.pylon.height;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(x, p.y, z);
        dummy.scale.set(1, H, 1);
        dummy.updateMatrix();
        poleInst.setMatrixAt(k, dummy.matrix);
        poleInst.setColorAt(k, new THREE.Color(p.pylon.pole));
        dummy.rotation.set(0, p.ry + Math.PI / 2, 0); // its faces towards the street both ways
        dummy.position.set(x, p.y + H + 0.55, z);
        dummy.scale.set(0.35, 1.1, 2.6);
        dummy.updateMatrix();
        signInst.setMatrixAt(k, dummy.matrix);
        pylonSlots.setX(k, p.slot);
        colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, minY: p.y, maxY: p.y + H });
      });
      poleInst.castShadow = signInst.castShadow = true;
      group.add(poleInst, signInst);
    }
  }
  return { atlasPages, signSlots };
}

export { NAME_RADIUS, drawSign, createSignAtlas };
