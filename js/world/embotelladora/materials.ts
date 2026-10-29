// js/world/embotelladora/materials.ts
// The bottling plant's materials, drawn on the UV in metres the building kit gives its boxes & planes (building-kit.ts: u
// along a piece, v up): the shed's grey cladding in ribs, its pale roof, the front's white render & cream pilasters,
// the red bar fence and the gate's red steel, the guard booth's & the canopy's brown, the brick of the wall on
// Hamburgo between its concrete frame, the precast slabs on Otranto, the chain-link, the hedges & the ficus clipped
// into shapes, the glass (lit inside at night), the depot's louvres and red shutters, the posts striped red & white;
// and the brand's name, lettered.
import * as THREE from 'three/webgpu';
import { color, float, floor, fract, max, mix, mx_noise_float, positionWorld, sin, smoothstep, step, texture, uv, vertexColor } from 'three/tsl';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { Tint } from '../building-kit.ts';
import { lineCover as cover } from '../../render/materials/shared.ts';
import type { Node } from 'three/webgpu';

/** The name on the plant & its trucks: the brand's, as the game letters the chains (a parody, like the stores') */
export const BRAND = 'Koka-Kola';
/** The brand's red */
export const BRAND_RED = '#e4141f';
/** A script for the name, falling back on what the machine has */
export const BRAND_FONT = `'Brush Script MT', 'Snell Roundhand', 'Segoe Script', 'Apple Chancery', cursive`;

const std = (hex: number, roughness = 0.9, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });

// The plain colours' shared materials, each piece's colour on its vertices (building-kit.ts Tint): the paints on render
// and the concrete, weathered a little (world space: every piece runs on into the next); the painted steel; the leaves
function tinted(roughness: number, metalness: number, grain: Node<'float'> | null = null): THREE.MeshStandardNodeMaterial {
  const m = std(0xffffff, roughness, metalness);
  m.colorNode = grain ? vertexColor().mul(grain) : vertexColor();
  return m;
}

// A see-through panel (bars, chain-link) on its plane: `opacity` its pattern, both sides drawn
function openwork(hex: number, opacity: Node<'float'>, roughness = 0.5, metalness = 0.4): THREE.MeshStandardNodeMaterial {
  const m = std(hex, roughness, metalness);
  m.side = THREE.DoubleSide;
  m.alphaToCoverage = true;
  m.opacityNode = opacity;
  return m;
}

export type PlantMaterials = ReturnType<typeof createPlantMaterials>;

/** The plant's materials. `barsH`: the red fence's height (m, its rails at its foot & top) */
export function createPlantMaterials(barsH: number) {
  const u = uv().x, v = uv().y;
  const render = tinted(0.9, 0, mx_noise_float(positionWorld.mul(0.35)).mul(0.06).add(0.98));
  const steel = tinted(0.5, 0.28);
  const leafy = tinted(0.85, 0, mx_noise_float(positionWorld.mul(3.2)).mul(0.3).add(mx_noise_float(positionWorld.mul(0.7).add(5.3)).mul(0.12)).add(0.85));
  const white = new Tint(render, 0xf0eee7), cream = new Tint(render, 0xeadb9e), depotWall = new Tint(render, 0xe0d2ab);
  // the cladding: grey sheet in trapezoidal ribs every 20 cm along the wall
  const cladding = std(0x8d9195, 0.55, 0.35);
  cladding.colorNode = color(0x8d9195).mul(float(1).sub(cover(u.div(0.2), 0.3).mul(0.18)));
  // the roofs: pale sheet in ribs every 30 cm (its top's uv: u along the piece, v across it)
  const roof = std(0xc9cbca, 0.6, 0.25);
  roof.colorNode = color(0xc9cbca).mul(float(1).sub(cover(v.div(0.3), 0.25).mul(0.12)));
  const concrete = new Tint(render, 0xa6a39b);
  // the precast wall's slabs, stacked 50 cm high between its posts
  const precast = std(0xc2bfb5, 0.92);
  precast.colorNode = color(0xc2bfb5).mul(mx_noise_float(positionWorld.mul(0.6)).mul(0.06).add(0.97))
    .mul(float(1).sub(cover(v.div(0.5), 0.04).mul(0.3)));
  // brick: courses 9 cm high, bricks 28 cm long laid half over half, each its own shade; the mortar's joints
  const brick = std(0xc4814a, 0.92);
  {
    const course = floor(v.div(0.09));
    const along = u.div(0.28).add(fract(course.mul(0.5)));
    const shade = fract(sin(floor(along).mul(12.9898).add(course.mul(78.233))).mul(43758.5453));
    const joint = max(cover(v.div(0.09), 0.012 / 0.09 * 1.4), cover(along, 0.012 / 0.28 * 1.4));
    brick.colorNode = mix(color(0xc4814a).mul(shade.mul(0.16).add(0.9)), color(0xd8cdb8), joint);
  }
  const red = new Tint(steel, 0xd0141f);
  // the red fence: square bars every 13 cm, a rail along its foot & its top
  const bars = openwork(0xd0141f, max(cover(u.div(0.13), 0.035 / 0.13), step(v, 0.07).add(step(barsH - 0.08, v))), 0.45, 0.25);
  // chain-link: wires diagonal both ways in 6 cm diamonds
  const chain = openwork(0x9aa0a4, max(cover(u.add(v).div(0.085), 0.07), cover(u.sub(v).div(0.085), 0.07)), 0.5, 0.6);
  // the gate's mesh behind its frame: a fine grid of red wire
  const mesh = openwork(0xc0121c, max(cover(u.div(0.15), 0.05), cover(v.div(0.15), 0.05)), 0.5, 0.3);
  const brown = new Tint(render, 0x5a3c2d);
  // the canopy's soffit: slats across it every 50 cm
  const soffit = std(0x7b5a45, 0.8);
  soffit.colorNode = color(0x7b5a45).mul(float(1).sub(cover(u.div(0.5), 0.2).mul(0.35)));
  // the posts by the gate: red & white in a spiral (the cylinder's uv: u round it, v up it), as the photographs show
  const striped = std(0xffffff, 0.5);
  striped.colorNode = mix(color(0xd0141f), color(0xf4f4f2), step(0.5, fract(positionWorld.y.div(0.7).add(u))));
  // glass: dark, a mullion every 1.5 m, lit from inside at night
  const glass = std(0x1d2a35, 0.12, 0.5);
  {
    const mullion = cover(u.div(1.5), 0.05);
    glass.colorNode = mix(color(0x1d2a35), color(0xd8dadb), mullion);
    glass.emissiveNode = color(0xffe2a8).mul(smoothstep(0.35, 1.0, cityUniforms.uInteriorGlow)).mul(float(1).sub(mullion).mul(0.45));
  }
  // the tower's glass: clear, the hall's light through it at night
  const towerGlass = std(0x3d5866, 0.06, 0.6);
  towerGlass.emissiveNode = color(0xfff0d0).mul(smoothstep(0.35, 1.0, cityUniforms.uInteriorGlow)).mul(0.6);
  // the depot's louvred band (slats every 12 cm) and its red roll-up shutters (slats every 8 cm)
  const louvres = std(0x5c4838, 0.6, 0.2);
  louvres.colorNode = color(0x5c4838).mul(float(1).sub(cover(v.div(0.12), 0.3).mul(0.4)));
  const shutter = std(0xc8141c, 0.5, 0.3);
  shutter.colorNode = color(0xc8141c).mul(float(1).sub(cover(v.div(0.08), 0.25).mul(0.3)));
  // the hedges & the ficus: leafy greens
  const hedge = new Tint(leafy, 0x24401b), ficus = new Tint(leafy, 0x355f22);
  const tank = new Tint(steel, 0xeeeeea);
  return {
    white, cream, depotWall, cladding, roof, concrete, precast, brick, red, bars, chain, mesh, brown, soffit, striped,
    glass, towerGlass, louvres, shutter, hedge, ficus, tank, dark: new Tint(steel, 0x2a2c2e)
  };
}

/** The brand's name in its script, `ink` on clear, with the wave under it; `w` × `h` px */
export function brandTexture(ink: string, w = 1024, h = 320): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the bottler\'s name');
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let px = h * 0.78;
  do { ctx.font = `italic 700 ${px}px ${BRAND_FONT}`; px -= 4; } while (px > 20 && ctx.measureText(BRAND).width > w * 0.92);
  ctx.fillText(BRAND, w / 2, h * 0.44);
  // the wave (the dynamic ribbon) under the name
  ctx.lineWidth = h * 0.045;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.86);
  ctx.bezierCurveTo(w * 0.35, h * 0.7, w * 0.6, h * 0.98, w * 0.9, h * 0.78);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A sign's material: the name `tex` cut out of the clear, lit a little at night */
export function createBrandMaterial(tex: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.5, metalness: 0, transparent: false, alphaTest: 0.5 });
  m.emissiveNode = texture(tex).rgb.mul(smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow).mul(0.6));
  return m;
}
