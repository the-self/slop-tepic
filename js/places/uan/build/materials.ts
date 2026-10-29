// js/places/uan/build/materials.ts
// What the UAN's campus is made of: the university's blue and white paint, the rubble stone of the old walls & the
// arches (a texture painted on a canvas, 2 m to a tile), the cantera trims, the steel of the rejas and the chain-link
// (see-through: cut out by their bars & wires, the wire's coverage left to the scene pass's multisampling far off), the
// louvred windows, the roofs, and the lettering on the portals (painted on a canvas, standing clear of its plane).
import * as THREE from 'three/webgpu';
import { color, float, floor, fract, fwidth, length, max, min, mix, mx_noise_float, positionWorld, sin, smoothstep, step, texture, uv, vec2, vec3 } from 'three/tsl';
import { bumpNormal } from '../../../render/materials/shared.ts';
import { cityUniforms } from '../../../render/tsl-materials.ts';
import type { Node } from 'three/webgpu';

/** The UAN's blue (its logo's, the piers', the buildings' bands) */
export const UAN_BLUE = 0x6882ad;
const STONE_TILE = 2.8; // m of wall per tile of the stone texture
/** m: the rejas' panels, rail to rail */
export const REJA_H = 1.5;
/** m: the corridors' railings */
export const RAIL_H = 1.0;

/** The campus's materials, made once */
export interface UanMaterials {
  blue: THREE.Material;
  /** the walls' white, a bone white */
  white: THREE.Material;
  /** the frame's white (columns, slabs, eaves, pilasters), cleaner than the walls' */
  trim: THREE.Material;
  stone: THREE.Material;
  /** the same rubble stone whitewashed (José María Mercado's) */
  cal: THREE.Material;
  /** the sidewalks along the walls: grey concrete in 1 m squares, or painted red (Revolución's) */
  sidewalk: THREE.Material;
  sidewalkRed: THREE.Material;
  /** the canal's railing: steel pipe painted a pale, weathered green-white */
  pipe: THREE.Material;
  cantera: THREE.Material;
  coping: THREE.Material;
  steel: THREE.Material;
  reja: THREE.Material;
  chainLink: THREE.Material;
  louvres: THREE.Material;
  windows: THREE.Material;
  railing: THREE.Material;
  glass: THREE.Material;
  door: THREE.Material;
  doorSteel: THREE.Material;
  plaque: THREE.Material;
  roofRed: THREE.Material;
  roofGrey: THREE.Material;
  vault: THREE.Material;
  concrete: THREE.Material;
  yellow: THREE.Material;
  gold: THREE.Material;
  lamp: THREE.Material;
}

// The rubble stone, seamless over a square tile: rounded stones of the valley's browns, greys & reddish purples in
// rough courses, set in pale mortar (as on Revolución's & 12 de Octubre's walls, from street photographs)
function stoneTexture(): THREE.CanvasTexture {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (!g) throw new Error('[uan] no 2D canvas for the stone');
  g.fillStyle = '#77736a';
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const tones = ['#5c4b3f', '#6e5a49', '#4f4744', '#7a6957', '#5f4f4c', '#6d4a44', '#574d48', '#7b6f64', '#4a3c37', '#665d56', '#7a4f4a', '#5d5866'];
  const stone = (cx: number, cy: number, rx: number, ry: number) => {
    const n = 7 + Math.floor(rnd() * 4), pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.5, r = 0.62 + rnd() * 0.38;
      pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
    }
    const tone = tones[Math.floor(rnd() * tones.length)];
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const x = cx + dx, y = cy + dy;
        if (x + rx < 0 || x - rx > S || y + ry < 0 || y - ry > S) continue;
        g.beginPath();
        pts.forEach(([px, py], k) => {
          const [qx, qy] = pts[(k + 1) % n];
          if (k === 0) g.moveTo(x + (px + pts[n - 1][0]) / 2, y + (py + pts[n - 1][1]) / 2);
          g.quadraticCurveTo(x + px, y + py, x + (px + qx) / 2, y + (py + qy) / 2);
        });
        g.closePath();
        const grad = g.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
        grad.addColorStop(0, '#ffffff1c');
        grad.addColorStop(0.5, '#00000000');
        grad.addColorStop(1, '#00000038');
        g.fillStyle = tone;
        g.fill();
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = '#00000030';
        g.lineWidth = 2;
        g.stroke();
      }
    }
  };
  // courses ~14 cm to 30 cm high (on a 2.8 m tile: 512 px), stones 20 to 60 cm long
  for (let y = 0; y < S;) {
    const h = 26 + rnd() * 30;
    for (let x = rnd() * 30; x < S;) {
      const w = 34 + rnd() * 80;
      stone(x + w / 2, y + h / 2 + (rnd() - 0.5) * 8, w / 2 + 2, h / 2 + 2 + rnd() * 6);
      x += w + rnd() * 3;
    }
    y += h + 2;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function createUanMaterials(): UanMaterials {
  const std = (hex: number, roughness = 0.9, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });
  // the paints on rendered block (aplanado), weathered (world space, so every piece runs on into the next): the
  // render's fine grain, felt in the light up close (its relief fading out where a pixel spans more than a few cm, so
  // it never shimmers), broad blotches where the paint has faded, rain streaks down the walls
  const painted = (hex: number) => {
    const m = std(hex, 0.93);
    const p = positionWorld, px = length(fwidth(p)); // (m a pixel)
    const near = smoothstep(0.04, 0.008, px);
    const grain = mx_noise_float(p.mul(18.0)).mul(near);
    const blotch = mx_noise_float(p.mul(0.4).add(3.1));
    const streak = mx_noise_float(vec3(p.x.mul(1.6), p.y.mul(0.09), p.z.mul(1.6)).add(7.7));
    m.colorNode = color(hex).mul(grain.mul(0.035).add(blotch.mul(0.045)).add(streak.mul(0.04)).add(0.97));
    m.normalNode = bumpNormal(mx_noise_float(p.mul(22.0)).mul(0.0022).mul(near));
    return m;
  };
  const stoneTex = stoneTexture();
  const stone = std(0xffffff, 0.92);
  stone.colorNode = texture(stoneTex, uv().div(STONE_TILE));
  // (the lime lets the stones show through, thinner on their faces than in the joints)
  const cal = std(0xffffff, 0.95);
  cal.colorNode = mix(texture(stoneTex, uv().div(STONE_TILE)).rgb, color(0xe8e5dc), 0.78);
  // the sidewalks (uv in metres on their top: the joints every 1 m), worn
  const paving = (hex: number) => {
    const m = std(hex, 0.9);
    const joint = max(cover(uv().x, 0.012), cover(uv().y, 0.012));
    m.colorNode = color(hex).mul(mx_noise_float(positionWorld.mul(0.8)).mul(0.06).add(0.97)).mul(joint.mul(0.25).oneMinus());
    return m;
  };
  // steel bars: vertical every 12 cm (2.5 cm square), rails along the top & the foot (uv in metres: u along, v up)
  const reja = std(0xd6d9dc, 0.45, 0.5);
  reja.side = THREE.DoubleSide;
  reja.alphaToCoverage = true;
  {
    const u = uv().x, v = uv().y;
    const rail = step(v, 0.05).add(step(REJA_H - 0.05, v));
    reja.opacityNode = max(cover(u.div(0.12), 0.025 / 0.12), rail);
  }
  // chain-link: wires diagonal both ways in 6 cm diamonds
  const chainLink = std(0x9aa0a4, 0.5, 0.6);
  chainLink.side = THREE.DoubleSide;
  chainLink.alphaToCoverage = true;
  {
    const u = uv().x, v = uv().y;
    const a = cover(u.add(v).div(0.085), 0.006 / 0.085), b = cover(u.sub(v).div(0.085), 0.006 / 0.085);
    chainLink.opacityNode = max(a, b);
  }
  // louvred windows: aluminium slats every 10 cm before dark glass, a mullion every 1.5 m; lit from inside at night
  const louvres = std(0xffffff, 0.4, 0.3);
  {
    const u = uv().x, v = uv().y;
    const slat = cover(v.div(0.1).add(0.5), 0.45); // (the slats' haze far off, no moiré)
    const mullion = step(0.95, fract(u.div(1.5)));
    louvres.colorNode = mix(mix(color(0x2c3640), color(0xb8bec4), slat), color(0xcfd3d6), mullion);
    louvres.emissiveNode = color(0xffe2a8).mul(cityUniforms.uInteriorGlow).mul(float(1).sub(slat).mul(0.35));
  }
  // windows in white aluminium: a mullion every 0.9 m, a transom, the frame; dark glass, and behind it below the
  // transom each window's curtains (navy, slate, a pale grey, or none), as in the classrooms' photographs (uv in
  // metres: u along, v up from the strip's middle; the strips 1.6 m high)
  // (a dim specular: glass reflects less of the sky than the paint's default 4% at a glance, and this keeps it dark)
  const windows = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.2, metalness: 0, specularIntensity: 0.35 });
  {
    const u = uv().x, v = uv().y;
    const frame = max(max(cover(u.div(0.9), 0.07 / 0.9), cover(v.sub(0.25).div(4), 0.06 / 4)), step(0.73, v.abs()));
    const room = fract(sin(floor(u.div(3.6)).mul(12.9898)).mul(43758.5453)); // (0..1, the window's own: ~a bay)
    const curtain = mix(mix(color(0x26324e), color(0x4d5a6e), step(0.45, room)), color(0x8d939a), step(0.8, room));
    const drawn = step(v, 0.25).mul(step(room, 0.9)); // (below the transom; one window in ten bare)
    const glass = mix(color(0x10161c), curtain.mul(0.45), drawn);
    windows.colorNode = mix(glass, color(0xe2e4e3), frame);
    windows.roughnessNode = mix(float(0.2), float(0.45), frame);
    windows.metalnessNode = frame.mul(0.6);
    windows.emissiveNode = color(0xffe2a8).mul(cityUniforms.uInteriorGlow).mul(float(1).sub(frame).mul(0.4));
  }
  // the classrooms' doors: white sheet steel pressed in horizontal ribs every 10 cm (uv in metres, v up)
  const doorSteel = std(0xdcd9d0, 0.5, 0.25);
  doorSteel.colorNode = color(0xdcd9d0).mul(cover(uv().y.div(0.1), 0.25).mul(0.12).oneMinus());
  // the corridors' railings: white bars every 14 cm between a rail at the foot & the top
  const railing = std(0xf2f2ee, 0.5);
  railing.side = THREE.DoubleSide;
  railing.alphaToCoverage = true;
  railing.opacityNode = max(cover(uv().x.div(0.14), 0.028 / 0.14), step(uv().y, 0.05).add(step(RAIL_H - 0.06, uv().y)));
  const glass = std(0x26323e, 0.25, 0.2);
  glass.emissiveNode = color(0xffe2a8).mul(cityUniforms.uInteriorGlow).mul(0.25);
  // the domos' vaults: white sheet metal in ribs along the vault every 30 cm
  const vault = std(0xe4e7e8, 0.55, 0.35);
  vault.colorNode = color(0xe4e7e8).mul(step(0.8, fract(uv().x.div(0.3))).mul(0.06).add(0.94));
  // the floodlights: dull by day, bright after dusk
  const lamp = new THREE.MeshBasicNodeMaterial();
  lamp.colorNode = mix(color(0x9aa3a8), color(0xfff4dc).mul(3.0), smoothstep(0.3, 1.0, cityUniforms.uInteriorGlow));
  return {
    blue: painted(UAN_BLUE), white: painted(0xd9d5ca), trim: painted(0xf2f1ec), stone, cal,
    sidewalk: paving(0xb9b5ac), sidewalkRed: paving(0x9a5a4e), pipe: painted(0xdde4dc), cantera: std(0x97897a, 0.85), coping: std(0x9d998f, 0.9),
    steel: std(0x9aa0a4, 0.45, 0.6), reja, chainLink, louvres, windows, railing, glass, door: std(0x3b4752, 0.5, 0.4), doorSteel,
    plaque: std(0x24406e, 0.5),
    roofRed: std(0x9a5442), roofGrey: std(0xb9b6ae), vault, concrete: std(0xb5b1a8), yellow: std(0xe0b326, 0.8),
    gold: std(0xc9a24a, 0.35, 0.85), lamp
  };
}

// How much of a pixel lines `w` wide (a share of their period) cover at x (in periods, the lines on its integers): 1
// on one, its edge smoothed over the pixel's width; and far off, where a pixel spans a period or more, the share of it
// they cover (the wires' haze)
function cover(x: Node<'float'>, w: number) {
  const f = fract(x), d = min(f, float(1).sub(f)); // (to the nearest line, in periods)
  const fw = max(fwidth(x), 1e-4); // (periods a pixel)
  const line = float(1).sub(smoothstep(0, fw, d.sub(w / 2)));
  return mix(line, float(w), smoothstep(0.5, 2.0, fw));
}

// Draws `text` in `ink` centred in the canvas box (x, y, w, h px), as big as fills `fill` of its height and fits its width
function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, ink: string, fill: number, weight: number, font: string): void {
  let px = h * fill;
  do { g.font = `${weight} ${px}px ${font}`; px -= 2; } while (px > 8 && g.measureText(text).width > w * 0.94);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + px * 0.04);
}

// Letters on a canvas as a material: transparent but for them, a hair before the face they stand on; `at` maps the
// mesh's UVs to the canvas's
function letters(c: HTMLCanvasElement, at: (t: ReturnType<typeof uv>) => Node<'vec2'>): THREE.Material {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, transparent: true, depthWrite: false });
  const t = texture(tex, at(uv()));
  mat.colorNode = t.rgb;
  mat.opacityNode = t.a;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  return mat;
}

// A canvas of w x h px
function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('[uan] no 2D canvas for the lettering');
  return { c, g };
}

/**
 * A text on a sign board as a material: `text` in `ink` on transparent, for a kit's plane `w` x `h` m (its canvas 64 px
 * to the metre), the letters filling `fill` of the board's height. Letters only: they stand on the board's own face, a
 * hair before it
 */
function letteringMaterial(text: string, w: number, h: number, ink: string, { fill = 0.62, weight = 800, font = 'Arial, Helvetica, sans-serif' } = {}): THREE.Material {
  const PX = 64, { c, g } = canvas(Math.min(4096, Math.round(w * PX)), Math.round(h * PX));
  drawText(g, text, 0, 0, c.width, c.height, ink, fill, weight, font);
  return letters(c, (t) => t.div(vec2(w, h))); // (the kit's planes carry UVs in metres)
}

/** The buildings' names on their boards, all in one atlas: the material, and each board's UVs in it [u0, v0, u1, v1] */
export interface NameBoards {
  mat: THREE.Material;
  rects: [number, number, number, number][];
}

/** `boards` [text, w, h] (m): the names in the UAN's blue, a row of the atlas (64 px high) each, as wide as its board */
function nameBoards(boards: readonly [string, number, number][]): NameBoards | null {
  if (!boards.length) return null;
  const W = 2048, ROW = 64, { c, g } = canvas(W, ROW * boards.length);
  const rects = boards.map(([text, w, h], i): [number, number, number, number] => {
    const pw = Math.min(W, Math.round((ROW * w) / h));
    drawText(g, text, 0, i * ROW, pw, ROW, '#1d4aa8', 0.62, 700, 'Arial, Helvetica, sans-serif');
    return [0, 1 - ((i + 1) * ROW) / c.height, pw / W, 1 - (i * ROW) / c.height];
  });
  return { mat: letters(c, (t) => t), rects };
}

export { createUanMaterials, letteringMaterial, nameBoards };
