// js/world/forum/materials.ts
// Forum Tepic's materials: outside the cream render in panels, the ochre feature panels, the glass of the entrances &
// clerestories with their mullions, the roof (its underside the ceiling's white panels); inside the polished floor, the
// orange columns, the gallery slabs, the balustrades' glass, the shops' lit windows (their goods drawn on the glass, each
// locale's colour off its `aShop` attribute), the sign atlas, the escalators. The indoor surfaces carry their own light
// (they stand in the roof's shadow): an emissive share of their colour, as store-interiors.ts's.
import * as THREE from 'three/webgpu';
import {
  abs, atan, attribute, color, float, floor, fract, frontFacing, length, max, mix, normalGeometry, positionWorld, sin, smoothstep, step, texture, uv, vec2, vec3
} from 'three/tsl';
import { cityUniforms } from '../../render/tsl-materials.ts';
import { ESCALATOR_SPEED } from '../forum-plan.ts';

type ColorNode = THREE.Node<'vec3'> | THREE.Node<'color'>;

// a lit-from-within surface: its colour, and that much of it again as emissive
function lit(c: ColorNode, glow: number, { roughness = 0.8, metalness = 0, side = THREE.FrontSide }: { roughness?: number; metalness?: number; side?: THREE.Side } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness, metalness, side });
  mat.colorNode = c;
  mat.emissiveNode = c.mul(glow);
  return mat;
}

// The cream render outside, in big panels (a joint every 3 m up, 6 m across), its foot a grey band
function createRenderMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const p = positionWorld;
  const joint = max(step(0.985, fract(p.y.div(3.0))), step(0.992, fract(p.x.add(p.z).div(6.0))));
  mat.colorNode = mix(color(0xe2d5bb), color(0xb3a78f), joint.mul(0.6));
  return mat;
}

// The ochre panels (Liverpool's, the entrances' sides), a fine joint every 1.5 m
function createOchreMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  const joint = step(0.98, fract(positionWorld.y.div(1.5)));
  mat.colorNode = mix(color(0xc98f2c), color(0x8a5f1c), joint.mul(0.5));
  return mat;
}

// Glass in a grid of mullions (`cell` m wide, 1.6 m high), tinted, half see-through; lit warm from inside at night
function createGlassMaterial(tint: number, cell: number, opacity = 0.45) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.55, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const p = positionWorld;
  const gx = abs(fract(p.x.add(p.z).div(cell)).sub(0.5)), gy = abs(fract(p.y.div(1.6)).sub(0.5));
  const mullion = max(step(0.47, gx), step(0.46, gy));
  mat.colorNode = mix(color(tint), color(0xd9dcdf), mullion);
  mat.opacityNode = mix(float(opacity), float(1.0), mullion);
  mat.emissiveNode = color(0xffe2b0).mul(float(1.0).sub(mullion)).mul(cityUniforms.uInteriorGlow.sub(0.35).max(0.0).mul(0.25));
  return mat;
}

// The roof: a pale membrane on top; seen from below, the ceiling's white panels with lines of light
function createRoofMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const p = positionWorld;
  const g = abs(fract(p.xz.div(1.2)).sub(0.5));
  const panel = smoothstep(0.46, 0.49, max(g.x, g.y));
  const strip = step(0.92, fract(p.x.sub(p.z).div(7.2)));
  const ceiling = mix(mix(color(0xe8e1d4), color(0xc4bcae), panel), color(0xfff4dc), strip);
  const top = color(0xb7b5ae);
  const up = frontFacing;
  mat.colorNode = mix(ceiling, top, float(up));
  mat.emissiveNode = mix(ceiling.mul(0.22).add(color(0xffe7bd).mul(strip.mul(0.5))), color(0x000000), float(up));
  return mat;
}

// The polished floor: cream tiles of 60 cm, a band of darker beige every 6 m; the slabs' tops share it, their edges white
function createFloorMaterial() {
  // (half its colour its own light: indoors the city's light probe, the sky's, would turn the beige blue)
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  const p = positionWorld;
  const g = abs(fract(p.xz.div(0.6)).sub(0.5));
  const joint = smoothstep(0.47, 0.49, max(g.x, g.y));
  const b = abs(fract(p.xz.div(6.0)).sub(0.5));
  const band = step(0.44, max(b.x, b.y));
  const tile = mix(mix(color(0xd6bf98), color(0x9c7550), band), color(0xa38a68), joint);
  const top = step(0.5, normalGeometry.y);
  const c = mix(color(0xe6ddcc), tile, top);
  mat.colorNode = c.mul(mix(float(1), float(0.55), top));
  mat.emissiveNode = c.mul(mix(float(0.14), float(0.42), top));
  return mat;
}

// a shop's back wall: white, a touch of its colour
const wallTone = (col: THREE.Node<'vec3'>) => mix(color(0xfbf8f2), col, 0.35);

// The shops' windows: on the glass, the shop behind it lit up (uv in metres: x along the front, y up): its back wall
// in the locale's colour, shelves of goods, racks, the frame of the glass every 2.4 m and the door in the middle
function createShopWindowMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.3 });
  const shop = attribute('aShop', 'vec4'); // rgb: the shop's colour; w: its seed (0..1) and kind (> 1: an anchor)
  const q = uv();
  const seed = fract(shop.w);
  const col = vec3(shop.x, shop.y, shop.z);
  // shelves of goods (a level every 0.45 m from 0.5 to 2.3 m), goods hashed per 12 cm: the shop's colour, white,
  // black and a few bright ones
  const level = floor(q.y.div(0.45));
  const inShelf = step(0.5, q.y).mul(step(q.y, 2.3));
  const h = fract(sin(floor(q.x.div(0.12)).mul(12.9898).add(level.mul(78.233)).add(seed.mul(437.0))).mul(43758.5453));
  const bright = mix(mix(color(0x2b62b8), color(0xf5a623), step(0.33, fract(h.mul(7.0)))), color(0x1f9a3c), step(0.66, fract(h.mul(7.0))));
  let goods: THREE.Node<'vec3'> = mix(col.mul(0.8), color(0xf2efe9), step(0.35, h));
  goods = mix(goods, color(0x2c2f36), step(0.6, h));
  goods = mix(goods, bright, step(0.8, h));
  // (the packs stand a little short of the shelf over them)
  goods = mix(goods, wallTone(col), step(0.78, fract(q.y.div(0.45))));
  const shelfLine = step(0.9, fract(q.y.div(0.45)));
  // racks of clothes (vertical strokes) in some shops, shelves in the rest
  const racks = step(0.5, seed);
  const stroke = step(0.55, fract(q.x.div(0.09))).mul(step(0.9, q.y)).mul(step(q.y, 1.9));
  const wall = wallTone(col);
  const shelves = mix(mix(wall, goods, inShelf), color(0x9a9da3), shelfLine.mul(inShelf));
  const rackView = mix(wall, mix(col, color(0x2b2b2b), step(0.5, h)), stroke);
  let c: THREE.Node<'vec3'> = mix(shelves, rackView, racks);
  // the floor inside, darker, and a lighter glow near the ceiling
  c = mix(c, col.mul(0.4).add(0.35), step(q.y, 0.35));
  // the frame: a mullion every 2.4 m, a transom at 3.2 m; the door's opening in the middle (darker glass)
  const mull = step(0.975, fract(q.x.div(2.4))).max(step(abs(q.y.sub(3.2)), 0.04));
  c = mix(c, color(0x3d4148), mull);
  mat.colorNode = c;
  mat.emissiveNode = c.mul(mix(float(0.75), float(0.55), mull));
  return mat;
}

// The signs: the atlas' slot (uv), lit
function createSignMaterial(atlas: THREE.Texture) {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = texture(atlas, uv()).rgb.mul(1.15);
  return mat;
}

// The Huichol yarn painting over Liverpool's door, from its canvas
function createMuralMaterial(art: THREE.Texture) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const c = texture(art, uv()).rgb;
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.45);
  return mat;
}

// The Fiesta Inn's tower: cream between rows of windows (3.2 m a floor, a window every 1.8 m), lit at night
function createHotelMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  const p = positionWorld;
  const fy = fract(p.y.div(3.2)), fx = fract(p.x.add(p.z).div(1.8));
  const win = step(0.3, fy).mul(step(fy, 0.8)).mul(step(0.18, fx)).mul(step(fx, 0.82));
  const lit = step(0.55, fract(sin(floor(p.y.div(3.2)).mul(91.7).add(floor(p.x.add(p.z).div(1.8)).mul(17.3))).mul(43758.5453)));
  mat.colorNode = mix(color(0xe7dfcd), color(0x37414b), win);
  mat.emissiveNode = color(0xffd9a0).mul(win.mul(lit).mul(cityUniforms.uInteriorGlow.sub(0.35).max(0.0)));
  return mat;
}

// The sidewalk round the mall: poured concrete in 1.5 m squares
function createApronMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const g = abs(fract(positionWorld.xz.div(1.5)).sub(0.5));
  mat.colorNode = mix(color(0xc9c4b8), color(0x9e998e), smoothstep(0.46, 0.49, max(g.x, g.y)));
  return mat;
}

// The columns' feet: brown granite, speckled
function createGraniteMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.3 });
  const p = positionWorld;
  const speck = fract(sin(floor(p.x.mul(40)).mul(12.9898).add(floor(p.y.mul(40)).mul(78.233)).add(floor(p.z.mul(40)).mul(37.719))).mul(43758.5453));
  const c = mix(color(0x5e4030), color(0x9a7a62), step(0.7, speck)).mul(mix(float(1), float(0.6), step(0.93, speck)));
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.12);
  return mat;
}

// A shop's floor: light wood planks or big pale tiles, by its seed (its aShop attribute's)
function createRoomFloorMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
  const shop = attribute('aShop', 'vec4');
  const p = positionWorld;
  const plank = fract(p.x.add(p.z).div(0.18)), board = floor(p.x.add(p.z).div(0.18));
  const grain = fract(sin(board.mul(91.7)).mul(43758.5453));
  const wood = mix(color(0xa9784b), color(0xc99a68), grain).mul(mix(float(0.8), float(1), step(0.06, plank)));
  const g = abs(fract(p.xz.div(0.8)).sub(0.5));
  const tile = mix(color(0xe9e1d2), color(0xb5aa98), step(0.48, max(g.x, g.y)));
  const c = mix(wood, tile, step(0.5, fract(shop.w.mul(7.0))));
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.2);
  return mat;
}

// A shop's walls: cream with a wash of its colour, a darker skirting
function createRoomWallMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  const shop = attribute('aShop', 'vec4');
  const c = mix(color(0xefe7d8), vec3(shop.x, shop.y, shop.z), 0.3).mul(mix(float(0.55), float(1), step(0.15, uv().y)));
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.3);
  return mat;
}

// The rotunda's dome: white outside; under it, as the photograph shows it, rings of little coloured pieces hung round
// its centre (cx, cz), red, orange, yellow, green, blue, purple & pink from its middle out, lit
function createDomeMaterial(cx: number, cz: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  const d = positionWorld.xz.sub(vec2(cx, cz));
  const r = length(d), ring = floor(r.div(1.15));
  const palette = [0xe8322c, 0xf28a1e, 0xf6d02a, 0x3fae49, 0x2f7fd8, 0x7a3fb0, 0xe8569e];
  const k = fract(ring.div(palette.length));
  let rings: THREE.Node<'vec3'> | THREE.Node<'color'> = color(palette[0]);
  for (let i = 1; i < palette.length; i++) rings = mix(rings, color(palette[i]), step(i / palette.length - 0.01, k));
  // (the pieces: small squares round each ring, the white ceiling between them)
  const around = fract(atan(d.y, d.x).mul(r.mul(3.0)).div(6.2832)), across = fract(r.div(1.15));
  const piece = step(0.18, around).mul(step(around, 0.82)).mul(step(0.15, across)).mul(step(across, 0.85));
  const under = mix(color(0xf1ebe0), rings, piece.mul(step(r, 13.5)));
  const up = float(frontFacing);
  mat.colorNode = mix(under, color(0xd9d6cf), up);
  mat.emissiveNode = under.mul(0.45).mul(float(1).sub(up));
  return mat;
}

// An escalator's steps: dark treads with their grooves, a yellow edge to each, running `dir` (+1 up from the foot, -1
// down) at ESCALATOR_SPEED along it (uv: x along the steps from the foot, m), on the town's clock
function createStepsMaterial(dir: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.4 });
  const s = uv().x.sub(cityUniforms.uClock.mul(ESCALATOR_SPEED * dir));
  const step0 = fract(s.div(0.4));
  const groove = step(0.5, fract(uv().y.div(0.06)));
  const edge = step(0.9, step0);
  const c = mix(mix(color(0x2a2c30), color(0x45484e), groove), color(0xe8c228), edge);
  mat.colorNode = c;
  mat.emissiveNode = c.mul(0.2);
  return mat;
}

/** Every material the mall is drawn with */
function createForumMaterials(atlas: THREE.Texture, mural: THREE.Texture, rotunda: { x: number; z: number }) {
  return {
    render: createRenderMaterial(),
    dome: createDomeMaterial(rotunda.x, rotunda.z),
    ochre: createOchreMaterial(),
    base: new THREE.MeshStandardNodeMaterial({ color: 0x77797c, roughness: 0.8 }),
    canopy: new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ef, roughness: 0.5 }),
    glass: createGlassMaterial(0x5d7f8f, 2.0),
    lantern: createGlassMaterial(0x8fb0bc, 1.5, 0.3),
    roof: createRoofMaterial(),
    floor: createFloorMaterial(),
    white: lit(color(0xe6ddcc), 0.14),
    column: lit(color(0xe57a2a), 0.2, { roughness: 0.5 }),
    granite: createGraniteMaterial(),
    wood: lit(color(0x7a5232), 0.12, { roughness: 0.55 }),
    shopGlass: createGlassMaterial(0xc9d9d6, 2.4, 0.16),
    roomFloor: createRoomFloorMaterial(),
    roomWall: createRoomWallMaterial(),
    railGlass: createGlassMaterial(0xcfe3dc, 50, 0.22),
    steel: new THREE.MeshStandardNodeMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide }),
    dark: lit(color(0x2e3136), 0.2, { roughness: 0.6, side: THREE.DoubleSide }),
    stepsUp: createStepsMaterial(1),
    stepsDown: createStepsMaterial(-1),
    cladding: lit(color(0x8e949b), 0.25, { roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
    window: createShopWindowMaterial(),
    sign: createSignMaterial(atlas),
    mural: createMuralMaterial(mural),
    hotel: createHotelMaterial(),
    plant: lit(color(0x4a3a2a), 0.15),
    apron: createApronMaterial(),
    seat: lit(color(0xe8742a), 0.3, { roughness: 0.6 })
  };
}
export type ForumMaterials = ReturnType<typeof createForumMaterials>;

export { createForumMaterials };
