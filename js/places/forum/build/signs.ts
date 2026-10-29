// js/places/forum/build/signs.ts
// Forum Tepic's sign atlas: every name the mall shows (its shops', its anchors', the FORUM over its doors) drawn once
// into one canvas, a slot each, in the brand's colours where they're known and in a mall's usual ones otherwise; and
// the Huichol yarn painting over Liverpool's door (a canvas of its own).
import * as THREE from 'three/webgpu';

const COLS = 4, SLOT_W = 512, SLOT_H = 96;

/** A sign's colours: background, letters */
type SignLook = [string, string];
// The brands' colours (the parody names keep their chain's: storefronts/)
const LOOKS: Partial<Record<string, SignLook>> = {
  FORUM: ['#ffffff', '#1f2a44'],
  LIVERPUL: ['#e10098', '#ffffff'],
  SEARS: ['#ffffff', '#1d4f91'],
  CINEMEX: ['#c8102e', '#ffffff'],
  SUBURBIOS: ['#6d2077', '#ffffff'],
  COPPELITO: ['#ffd100', '#003a70'],
  'COPPELITO CANADÁ': ['#ffd100', '#003a70'],
  'BURGUER QUING': ['#d62300', '#f5ebdc'],
  SUBGÜEY: ['#008c15', '#ffc600'],
  STARBUCKS: ['#00704a', '#ffffff'],
  KFC: ['#e4002b', '#ffffff'],
  MINISO: ['#e60012', '#ffffff'],
  'C&A': ['#ffffff', '#1d3c8f'],
  TELCEL: ['#0033a0', '#ffffff'],
  SANTANDER: ['#ec0000', '#ffffff'],
  "CHILI'S": ['#b5121b', '#ffffff'],
  VANS: ['#111111', '#ffffff'],
  LOB: ['#111111', '#ffffff'],
  DEVLYN: ['#003b71', '#ffffff'],
  'PLAYCITY CASINO': ['#2b0a4f', '#ffcc00'],
  'FIESTA INN': ['#ffffff', '#c8102e'],
  MACSTORE: ['#f5f5f7', '#1d1d1f'],
  THRIFTY: ['#ffffff', '#d4202c']
};
// a mall's other signs: white on a colour, or a colour on white
const PALETTE: SignLook[] = [['#1b1b1b', '#ffffff'], ['#ffffff', '#1b1b1b'], ['#0b5a8a', '#ffffff'], ['#b0123c', '#ffffff'],
  ['#ffffff', '#b0123c'], ['#13795b', '#ffffff'], ['#d9a400', '#1b1b1b'], ['#5b2a86', '#ffffff'], ['#f2ece0', '#7a4b1c']];

const hashText = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The sign atlas: its texture and each name's slot as uv [u0, v0, u1, v1] */
export interface SignAtlas {
  texture: THREE.CanvasTexture;
  slot(name: string): [number, number, number, number];
  /** a name's colours (the shop's window takes its background) */
  look(name: string): SignLook;
}

export function createSignAtlas(names: Iterable<string>): SignAtlas {
  const list = [...new Set(names)];
  const rows = Math.ceil(list.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * SLOT_W;
  canvas.height = Math.max(1, rows) * SLOT_H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('forum: no 2D canvas context');
  const look = (name: string): SignLook => LOOKS[name] ?? PALETTE[hashText(name) % PALETTE.length];
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  list.forEach((name, i) => {
    const x0 = (i % COLS) * SLOT_W, y0 = Math.floor(i / COLS) * SLOT_H;
    const [bg, fg] = look(name);
    g.fillStyle = bg;
    g.fillRect(x0, y0, SLOT_W, SLOT_H);
    g.fillStyle = fg;
    let px = 62;
    do {
      g.font = `800 ${px}px Inter, Arial, sans-serif`;
      px -= 2;
    } while (px > 14 && g.measureText(name).width > SLOT_W - 40);
    g.fillText(name, x0 + SLOT_W / 2, y0 + SLOT_H / 2 + 2);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const index = new Map(list.map((n, i) => [n, i]));
  return {
    texture,
    look,
    slot(name: string) {
      const i = index.get(name) ?? 0;
      const u0 = (i % COLS) / COLS, v1 = 1 - Math.floor(i / COLS) / rows;
      return [u0 + 0.002, v1 - 1 / rows + 0.004, u0 + 1 / COLS - 0.002, v1 - 0.004];
    }
  };
}

/** The Huichol yarn painting: a deer and a sun in rings of colour, flowers, zigzag borders (as the one over Liverpool's
 *  door in the user's photograph: bright blues, yellow, red and pink on a deep blue) */
export function createMuralTexture(): THREE.CanvasTexture {
  const W = 1024, H = 384;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('forum: no 2D canvas context');
  g.fillStyle = '#16307a';
  g.fillRect(0, 0, W, H);
  // the yarn: rings of colour round each figure, drawn as concentric strokes
  const rings = (cx: number, cy: number, rx: number, ry: number, colours: string[]) => {
    colours.forEach((c, k) => {
      g.strokeStyle = c;
      g.lineWidth = 9;
      g.beginPath();
      g.ellipse(cx, cy, rx - k * 9, ry - k * 9, 0, 0, Math.PI * 2);
      g.stroke();
    });
  };
  rings(200, 190, 170, 150, ['#f7d117', '#e8372c', '#ff7ab6', '#2fb6e8', '#ffffff', '#f7d117', '#7bd14a', '#e8372c', '#2fb6e8', '#f7d117', '#ff7ab6']);
  rings(820, 190, 170, 150, ['#2fb6e8', '#f7d117', '#e8372c', '#7bd14a', '#ffffff', '#ff7ab6', '#f7d117', '#2fb6e8', '#e8372c', '#f7d117']);
  // the sun's rays in the middle
  g.save();
  g.translate(512, 190);
  for (let k = 0; k < 24; k++) {
    g.rotate(Math.PI / 12);
    g.fillStyle = k % 2 ? '#f7d117' : '#e8372c';
    g.beginPath();
    g.moveTo(40, -10);
    g.lineTo(130, 0);
    g.lineTo(40, 10);
    g.fill();
  }
  g.restore();
  rings(512, 190, 60, 60, ['#ffffff', '#2fb6e8', '#f7d117', '#e8372c', '#f7d117']);
  // flowers scattered between
  for (let k = 0; k < 26; k++) {
    const x = (k * 397) % W, y = 30 + ((k * 211) % (H - 60));
    if (Math.hypot(x - 512, y - 190) < 150) continue;
    const c = ['#ff7ab6', '#7bd14a', '#f7d117', '#ffffff'][k % 4];
    for (let p = 0; p < 6; p++) {
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(x + Math.cos(p) * 12, y + Math.sin(p) * 12, 10, 5, p, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e8372c';
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  // zigzag borders top & bottom
  for (const [y, c] of [[8, '#f7d117'], [H - 8, '#f7d117'], [20, '#e8372c'], [H - 20, '#e8372c']] as const) {
    g.strokeStyle = c;
    g.lineWidth = 6;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) g.lineTo(x, y + ((x / 16) % 2) * 8 - 4);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
