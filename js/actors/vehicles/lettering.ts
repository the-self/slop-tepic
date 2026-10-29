// js/actors/vehicles/lettering.ts
// Names lettered on vehicles from an atlas: one row per name, in its ink edged in another colour on clear, and the
// material that cuts a row of it out by a per-instance attribute. The camiones' route signs (bus-materials.ts), the
// coaches' lines (coach.ts) and the tráilers' chains (tractor-trailer.ts) are lettered with it.
import * as THREE from 'three/webgpu';
import { float, vec2, attribute, texture, uv } from 'three/tsl';

/** How an atlas is lettered: its width & a row's height (px), the type's largest size (px) and its CSS font without
 *  the size (`900 Georgia, serif`), how wide a name may run (px, a longer one is set smaller), the edge's stroke (px) */
export interface LetteringStyle {
  width: number;
  row: number;
  size: number;
  font: string;
  fit: number;
  edge: number;
}

/** The atlas: `rows` [text, ink, edge] (CSS colours), lettered in `style` */
export function letteringAtlas(rows: readonly (readonly [text: string, ink: string, edge: string])[], style: LetteringStyle): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = style.width;
  canvas.height = style.row * Math.max(1, rows.length);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the vehicles\' lettering');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const [weight, ...family] = style.font.split(' ');
  rows.forEach(([text, ink, edge], row) => {
    let size = style.size;
    ctx.font = `${weight} ${size}px ${family.join(' ')}`;
    const w = ctx.measureText(text).width;
    if (w > style.fit) {
      size = Math.floor((size * style.fit) / w);
      ctx.font = `${weight} ${size}px ${family.join(' ')}`;
    }
    const y = row * style.row + style.row / 2 + 2;
    ctx.lineWidth = style.edge;
    ctx.strokeStyle = edge;
    ctx.strokeText(text, style.width / 2, y);
    ctx.fillStyle = ink;
    ctx.fillText(text, style.width / 2, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The lettering's material over an atlas of `rows` rows: the row named by the per-instance attribute `rowAttribute`,
 *  cut out of the clear; with `fadeAttribute`, faded too by that per-instance attribute (0..1, dithered) */
export function createLetteringMaterial(tex: THREE.Texture, rows: number, rowAttribute: string, roughness = 0.5, fadeAttribute?: string): THREE.MeshStandardNodeMaterial {
  const row = attribute(rowAttribute, 'float');
  const t = texture(tex, vec2(uv().x, uv().y.add(float(rows - 1).sub(row)).div(rows)));
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = t.rgb;
  mat.opacityNode = fadeAttribute ? t.a.mul(attribute(fadeAttribute, 'float')) : t.a;
  mat.alphaTest = 0.5;
  mat.alphaHash = Boolean(fadeAttribute);
  mat.roughnessNode = float(roughness);
  mat.metalnessNode = float(0.0);
  return mat;
}
