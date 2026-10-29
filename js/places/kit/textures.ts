// js/places/kit/textures.ts
// The places' signs drawn on a canvas: the Central's name over its front, its lines' boards, its KFC's.
import * as THREE from 'three/webgpu';

/** A canvas texture `w` × `h` px drawn by `draw` (text centred on the point it is drawn at) */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for a place\'s signs');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
