import * as THREE from 'three/webgpu';
import {
  float,
  vec2,
  vec3,
  color,
  attribute,
  positionGeometry,
  positionWorld,
  normalWorld,
  normalGeometry,
  cameraPosition,
  sin,
  abs,
  floor,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  length,
  normalize,
  sign,
  uniformArray,
  int
} from 'three/tsl';
import { cityUniforms, hash2D, noise2D, lineAA, townFloorNode, canyonSkyAONode } from './shared.ts';
import type { Node } from 'three/webgpu';

// js/render/materials/mexican-house.ts
// The Mexican house facade material: Tepic's painted houses, shops, chain stores and big boxes.

/**
 * Mexican house TSL material (box-local, for createFacadeBoxes): rendered & painted walls, each house in its own colour
 * (the instance's tone), a darker plinth ("guardapolvo") and a pale coping on the parapet; a few windows per floor
 * with aluminium frames behind iron bars (rejas); on the street front's ground floor a door and a garage gate, or a
 * shop's rolled-down steel shutter (cortina); side & rear walls partly bare grey block (obra negra); flat concrete roofs,
 * some coated red (impermeabilizante). WALL_KINDS.chainStore fronts get a convenience store's glazing under a yellow
 * stripe and a red band. Big boxes (WALL_KINDS.bigFront / bigSide) are halls in pale metal cladding with a glazed
 * front under a dark canopy and a white membrane roof. Lit windows & open stores glow at night.
 */
let _mexicanHouseMat: THREE.MeshStandardNodeMaterial | null = null;
/** A chain store front's colours: its band and its stripe */
export interface ChainFacade {
  band: THREE.ColorRepresentation;
  stripe: THREE.ColorRepresentation;
}
export interface MexicanHouseOptions {
  floorHeight?: number; // m
  chains?: ChainFacade[];
  boxLocal?: boolean; // (always: the material is box-local)
}
// `chains`: [{ band, stripe }] colours of each chain store front (js/world/storefronts), picked by the wall kind
// WALL_KINDS.chainStore + its index
export function createMexicanHouseMaterial({ floorHeight = 3.0, chains = [] }: MexicanHouseOptions = {}): THREE.MeshStandardNodeMaterial {
  if (_mexicanHouseMat) return _mexicanHouseMat;
  const chainList = chains.length ? chains : [{ band: '#d8232a', stripe: '#f5a623' }];
  const chainBands = uniformArray<'color'>(chainList.map((c) => new THREE.Color(c.band)), 'color');
  const chainStripes = uniformArray<'color'>(chainList.map((c) => new THREE.Color(c.stripe)), 'color');
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.86 });
  const box = attribute('box', 'vec4'); // width, height, depth, seed + tone
  const faces = attribute('faces', 'vec4'); // WALL_KINDS of the -x, +x, -z & +z walls
  const fH = float(floorHeight);
  const PALETTE = [0xefe3c8, 0xe0a94a, 0xc8735f, 0xe59aa6, 0x8fc1d4, 0x9fd3b0, 0xf3efe6, 0xe8d36a, 0xe8836b, 0xb9a3cf, 0xd9c7a3, 0x7fb08a];

  // the wall's node graph, built once and shared by the colour, roughness & emissive outputs
  const wall = (() => {
    const n = normalGeometry;
    const nA = abs(n);
    const isRoof = step(0.75, nA.y);
    const alongZ = step(nA.z, nA.x); // a wall facing ±x runs along z
    const kind = mix(mix(faces.z, faces.w, step(0.0, n.z)), mix(faces.x, faces.y, step(0.0, n.x)), alongZ);
    const wallW = mix(box.x, box.z, alongZ);
    const along = mix(positionGeometry.x, positionGeometry.z, alongZ).add(0.5);
    const flip = mix(step(n.z, 0.0), step(0.0, n.x), alongZ);
    const sx = mix(along, float(1.0).sub(along), flip).mul(wallW); // metres along the wall from its left end
    const y = positionGeometry.y.add(0.5).mul(box.y); // metres above the ground
    const fromTop = box.y.sub(y);
    const tone = fract(box.w).sub(0.1).div(0.8);
    const seed = floor(box.w);
    const wallSeed = hash2D(vec2(seed, dot(n, vec3(3.1, 0.0, 7.7))));

    // which kind of wall
    const isChain = step(4.5, kind);
    const chainNo = int(clamp(floor(kind.sub(5.0).add(0.5)), 0.0, chainList.length - 1));
    const isBigSide = float(1.0).sub(step(-1.5, kind));
    const isBigFront = step(-1.5, kind).mul(float(1.0).sub(step(-0.5, kind)));
    const isBig = isBigSide.add(isBigFront);
    const isShop = step(-0.5, kind).mul(float(1.0).sub(step(0.5, kind)));
    const isEntry = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind)));
    const isFront = isShop.add(isEntry);
    const isBack = float(1.0).sub(isFront).sub(isChain).sub(isBig).max(0.0);
    const rawBlock = isBack.mul(step(wallSeed, 0.42));

    // the house's paint: its own where known (paint.w = 1), else the palette's by tone
    let paint: Node<'vec3'> | Node<'color'> = color(PALETTE[0]);
    const idx = floor(tone.mul(PALETTE.length));
    for (let i = 1; i < PALETTE.length; i++) paint = mix(paint, color(PALETTE[i]), step(i - 0.5, idx));
    // the centro's colonial houses (buildings.ts, within ~620 m of the Plaza Principal): limewash in the strong colours
    // of the centro (magenta, orange, ochre, terracotta, cream...), windows & doors framed in cantera, a darker
    // guardapolvo along the foot, a moulded cornice under the parapet, doors onto iron balconies upstairs
    const ownPaint = attribute('paint', 'vec4');
    const colonial = step(1.5, ownPaint.w);
    const COLONIAL = [0xc4304a, 0xe0703a, 0xd9a13d, 0xefe2c4, 0xa9452f, 0xe8c45a, 0xd65f7a, 0xf3ece0, 0x6f9bb2, 0xc9573c];
    let colonialPaint: Node<'vec3'> | Node<'color'> = color(COLONIAL[0]);
    const cIdx = floor(tone.mul(COLONIAL.length));
    for (let i = 1; i < COLONIAL.length; i++) colonialPaint = mix(colonialPaint, color(COLONIAL[i]), step(i - 0.5, cIdx));
    paint = mix(paint, colonialPaint, colonial);
    paint = mix(paint, ownPaint.xyz, mod(ownPaint.w, 2.0));
    const blockGrey = color(0x8e8b85);
    const mortar = max(lineAA(fract(y.div(0.2)).sub(0.5), 0.04), lineAA(fract(sx.div(0.4).add(step(0.5, fract(y.div(0.4))).mul(0.5))).sub(0.5), 0.02));
    const block = blockGrey.mul(float(1.0).sub(mortar.mul(0.25))).mul(hash2D(vec2(floor(sx.div(0.4)), floor(y.div(0.2)))).mul(0.12).add(0.94));
    let base = mix(paint, block, rawBlock);
    base = base.mul(float(1.0).sub(step(y, 0.45).mul(0.32).mul(float(1.0).sub(rawBlock)))); // plinth
    base = mix(base, mix(paint, color(0xfaf7f0), 0.6), step(fromTop, 0.22).mul(float(1.0).sub(rawBlock))); // coping
    // weathering: rain streaks under the parapet, dust at the foot
    const streak = noise2D(vec2(sx.mul(1.3), y.mul(0.08)).add(seed.mul(0.37)));
    base = base.mul(float(1.0).sub(smoothstep(0.55, 0.9, streak).mul(0.14)));

    // window cells: one every ~3.4 m, a window per floor (fewer on the back walls)
    const cells = max(floor(wallW.div(3.4)), 1.0);
    const sp = wallW.div(cells);
    const cellK = floor(sx.div(sp));
    const u = fract(sx.div(sp)).sub(0.5).mul(sp); // metres from the cell's centre
    const fl = floor(y.div(fH));
    const fv = y.sub(fl.mul(fH)); // height within the storey
    const ground = float(1.0).sub(step(1.0, fl));
    const doorK = mod(floor(tone.mul(13.0)), cells);
    const gateK = mod(doorK.add(1.0), cells);
    const hasGate = step(1.5, cells).mul(step(0.3, hash2D(vec2(seed, 9.1))));
    const door = isEntry.mul(ground).mul(step(abs(cellK.sub(doorK)), 0.5)).mul(step(abs(u), 0.5)).mul(step(fv, 2.15));
    const gateHalf = min(float(1.35), sp.mul(0.5).sub(0.25));
    const gate = isEntry.mul(ground).mul(hasGate).mul(step(abs(cellK.sub(gateK)), 0.5)).mul(step(abs(u), gateHalf)).mul(step(fv, 2.45));
    const cortina = isShop.mul(ground).mul(step(0.3, sx)).mul(step(sx, wallW.sub(0.3))).mul(step(fv, 2.55));
    const backWin = step(0.55, hash2D(vec2(cellK.add(seed), fl.add(wallSeed.mul(13.0)))));
    const freeCell = float(1.0).sub(ground.mul(isFront).mul(step(abs(cellK.sub(doorK)), 0.5).add(step(abs(cellK.sub(gateK)), 0.5).mul(hasGate)).min(1.0)));
    // (colonial: tall & narrow, on the ground floor from 0.8 m; upstairs doors from 0.35 m onto the balconies)
    const winHalf = mix(float(0.62), float(0.56), colonial);
    const winLo = mix(float(1.0), mix(float(0.8), float(0.35), step(0.5, fl)), colonial);
    const winHi = mix(float(2.2), float(2.55), colonial);
    // (whether this cell of this storey has a window at all; then the window's own rectangle)
    const winK = mix(float(1.0), backWin, isBack).mul(float(1.0).sub(rawBlock.mul(0.6)))
      .mul(freeCell).mul(float(1.0).sub(isShop.mul(ground))).mul(float(1.0).sub(isChain)).mul(float(1.0).sub(isBig)).mul(step(0.3, fromTop));
    const win = step(abs(u), winHalf).mul(step(winLo, fv)).mul(step(fv, winHi)).mul(winK);
    // frame, glass & bars
    const frame = win.mul(float(1.0).sub(step(abs(u), winHalf.sub(0.06)).mul(step(winLo.add(0.06), fv)).mul(step(fv, winHi.sub(0.06)))));
    const bars = win.mul(max(step(0.82, fract(u.mul(6.0).add(0.5))), step(0.88, fract(fv.sub(1.0).mul(1.6))))).mul(float(1.0).sub(colonial.mul(step(0.5, fl))));

    // THE ROOMS BEHIND THE GLASS (interior mapping): the eye's ray through the pane is followed into a box of a room
    // (or, behind a shop's open shutter, the shop) to whichever of its back wall, side walls, floor or ceiling it
    // meets first; a person stands or walks about in some, seen against the room on a plane part way in. Who is home
    // with the light on follows the hour (cityUniforms.uHour); a shop rolls its shutter up in its opening hours
    const hour = cityUniforms.uHour;
    const clock = cityUniforms.uClock;
    const nightFlag = step(0.1, kind).mul(isShop); // (WALL_KINDS.shop + 0.25: a taquería, a bar: open at night)
    const shopSeed = hash2D(vec2(seed, 31.7));
    const dayOpen = step(float(7.5).add(shopSeed.mul(2.0)), hour).mul(step(hour, float(19.5).add(shopSeed.mul(2.5))));
    const nightOpen = max(step(float(17.5).add(shopSeed), hour), step(hour, 1.5));
    const shopOpen = mix(dayOpen, max(dayOpen, nightOpen), nightFlag).mul(step(0.22, shopSeed)); // (some stay shut)
    const shopFront = isShop.mul(ground).mul(step(0.3, sx)).mul(step(sx, wallW.sub(0.3))).mul(step(fv, 2.3));
    const shopView = shopFront.mul(shopOpen);
    const roomSeed = hash2D(vec2(cellK.add(seed.mul(7.0)), fl.add(wallSeed.mul(5.0))));
    const roomSeed2 = hash2D(vec2(roomSeed.mul(13.1), seed));
    // the eye's ray in the wall's frame: across (to the right seen facing the wall), up, and into it
    const nW = normalWorld;
    const eye = normalize(positionWorld.sub(cameraPosition));
    const dU = dot(eye, normalize(vec3(nW.z, 0.0, nW.x.negate())));
    const dV = eye.y;
    const dIn = max(dot(eye, nW).negate(), 0.04);
    const shopU = sx.sub(wallW.mul(0.5)); // m from the shop front's middle
    const ru = mix(u, shopU, shopView);
    const RW = mix(float(1.6), wallW.mul(0.5).sub(0.2), shopView); // half the room's width
    const RD = mix(float(2.8).add(roomSeed.mul(1.6)), float(4.5), shopView); // its depth
    const RH = mix(float(2.6), float(2.7), shopView); // its ceiling over the floor
    const tBack = RD.div(dIn);
    const tSide = RW.sub(ru.mul(sign(dU).add(0.001))).div(abs(dU).max(0.001));
    const tY = mix(RH.sub(fv).div(dV.max(0.001)), fv.div(dV.negate().max(0.001)), step(dV, 0.0));
    const tHit = min(tBack, min(tSide, tY));
    const hu = ru.add(dU.mul(tHit)), hv = fv.add(dV.mul(tHit)), hd = dIn.mul(tHit);
    const onBack = step(tBack, min(tSide, tY));
    const onY = step(tY, min(tBack, tSide));
    const onFloor = onY.mul(step(dV, 0.0)), onCeil = onY.mul(float(1.0).sub(step(dV, 0.0)));
    const onSide = float(1.0).sub(onBack).sub(onY).max(0.0);
    // the room's paint, a tiled floor, a white ceiling, a sofa or a bed against the back wall, a doorway out of it
    const roomWall = mix(mix(color(0xe6d9bd), color(0xb9c9cf), step(0.4, roomSeed)), mix(color(0xe3b9ad), color(0xcfdcb3), step(0.75, roomSeed)), step(0.6, roomSeed));
    const tiles = mix(color(0x8c7b66), color(0xa39079), step(0.5, fract(floor(hu.mul(2.2)).add(floor(hd.mul(2.2))).mul(0.5))));
    const sofa = onBack.mul(step(hv, 0.85)).mul(step(abs(hu.add(roomSeed2.sub(0.5))), 0.9)).mul(float(1.0).sub(shopView));
    const doorway = onBack.mul(step(hv, 2.05)).mul(step(abs(hu.sub(mix(float(-0.9), float(0.9), step(0.5, roomSeed2)))), 0.42)).mul(float(1.0).sub(shopView));
    // a shop's back wall: shelves of goods in bands of colour
    const shelfRow = floor(hv.div(0.42));
    const goods = mix(mix(color(0xc8402e), color(0xe8b730), step(0.33, hash2D(vec2(floor(hu.mul(3.0)), shelfRow)))), mix(color(0x2f6fb0), color(0x3e9a4a), step(0.5, hash2D(vec2(shelfRow, floor(hu.mul(5.0)))))), step(0.66, hash2D(vec2(floor(hu.mul(3.0)), shelfRow.add(7.0)))));
    const shelves = mix(goods, color(0xd9d6cf), step(0.82, fract(hv.div(0.42))));
    let room = mix(roomWall.mul(mix(float(1.0), float(0.82), onSide)), tiles, onFloor);
    room = mix(room, color(0xf1ede5), onCeil);
    room = mix(room, mix(color(0x6b4a3a), color(0x3f4f6a), step(0.5, roomSeed2)), sofa);
    room = mix(room, color(0x4a3a2e), doorway);
    // (the goods on the side walls, and on the back wall over the counter; a doorway to the back room in its middle)
    const shelved = max(onSide.mul(step(0.3, hv)), onBack.mul(step(1.25, hv)).mul(step(0.7, abs(hu)))).mul(step(hv, 2.2));
    room = mix(room, shelves, shelved.mul(shopView));
    room = mix(room, color(0x3a2e26), onBack.mul(shopView).mul(step(abs(hu), 0.5)).mul(step(hv, 2.05)));
    // further in is darker: the light falls off from the front
    room = room.mul(mix(float(1.0), float(0.62), smoothstep(0.0, RD, hd)));
    // the light: a ceiling lamp in the middle (homes warm, a shop's tubes cold), or a television's blue flicker
    const lampDist = length(vec3(hu, hv.sub(RH), hd.sub(RD.mul(0.5))));
    const lamp = float(0.35).add(float(1.25).div(lampDist.mul(lampDist).mul(0.55).add(1.0)));
    const tv = step(0.72, roomSeed2).mul(float(1.0).sub(shopView));
    const flicker = noise2D(vec2(clock.mul(5.0), roomSeed.mul(40.0))).mul(0.6).add(0.55);
    const lampTint = mix(mix(color(0xffd7a0), color(0x9fb8ff).mul(flicker), tv), color(0xeef3ff), shopView);
    // someone in the room: standing, or walking slowly across it; in a shop, the shopkeeper behind the counter
    const present = mix(step(0.45, roomSeed2), float(1.0), shopView);
    const pDepth = mix(float(1.0).add(roomSeed.mul(1.3)), float(1.9), shopView);
    const tP = pDepth.div(dIn);
    const pu = ru.add(dU.mul(tP)), pv = fv.add(dV.mul(tP));
    const walkX = sin(clock.mul(float(0.12).add(roomSeed.mul(0.2))).add(roomSeed2.mul(40.0))).mul(mix(float(1.0), float(0.4), shopView));
    const px = pu.sub(walkX);
    const head = step(length(vec2(px, pv.sub(1.56))), 0.105);
    const torso = step(abs(px), 0.2).mul(step(0.88, pv)).mul(step(pv, 1.44)).mul(step(length(vec2(max(abs(px).sub(0.11), 0.0), max(pv.sub(1.33), 0.0))), 0.09));
    const legs = step(abs(abs(px).sub(0.085)), 0.07).mul(step(pv, 0.9));
    const person = max(head, max(torso, legs)).mul(present).mul(step(tP, tHit));
    const clothes = mix(mix(color(0x34507a), color(0x9a3a32), step(0.5, roomSeed)), mix(color(0xe9e4da), color(0x4f7a46), step(0.9, roomSeed2)), step(0.7, roomSeed2));
    room = mix(room, mix(clothes, color(0x9a6a4c), head), person);
    // a shop's counter across its front, in front of the shopkeeper
    const tC = float(1.2).div(dIn);
    const counter = shopView.mul(step(tC, tHit)).mul(step(fv.add(dV.mul(tC)), 1.0));
    room = mix(room, mix(color(0xdcdad4), color(0x7a8c96), step(0.75, fv.add(dV.mul(tC)))), counter);
    // curtains drawn part way across some windows (a lit room glows through them)
    const curtained = step(0.55, hash2D(vec2(roomSeed, 4.4))).mul(float(1.0).sub(shopView));
    const curtain = curtained.mul(step(float(0.12).add(roomSeed2.mul(0.38)), abs(u)));
    const curtainCol = mix(mix(color(0xd8c9a8), color(0x7c2a33), step(0.5, roomSeed2)), color(0x5a7088), step(0.8, roomSeed));
    // who is home with the light on: few by day, most in the evening, fewer after midnight, a few early risers
    const e = mod(hour.add(18.0), 24.0); // hours since 6:00
    const litProb = mix(float(0.08), float(0.62), smoothstep(11.0, 13.5, e)).mul(float(1.0).sub(smoothstep(17.0, 20.0, e).mul(0.85)))
      .add(float(1.0).sub(smoothstep(0.5, 2.5, e)).mul(0.25));
    const roomLit = max(step(hash2D(vec2(cellK.add(seed.mul(3.0)), fl.add(1.7))), litProb).mul(float(1.0).sub(shopView)), shopView);
    const pane = win.mul(float(1.0).sub(frame)).mul(float(1.0).sub(bars)).add(shopView).min(1.0);
    const lightOn = room.mul(lampTint).mul(lamp);
    const seen = mix(room, curtainCol, curtain); // (by day: the room as dim as it is against the sunlit street)

    let c = base;
    c = mix(c, mix(color(0x27323a), seen.mul(0.38), 0.7), win);
    c = mix(c, color(0xd6d6cf), frame);
    c = mix(c, color(0x1c1c1e), bars.mul(float(1.0).sub(frame)));
    // cantera round the colonial windows & doors (a band ~18 cm wide, a deeper lintel), the guardapolvo, the cornice
    const stoneHalf = winHalf.add(0.18);
    const opening = max(win, door);
    const canteraWin = step(abs(u), stoneHalf).mul(step(winLo.sub(0.12), fv)).mul(step(fv, winHi.add(0.3))).mul(step(0.5, winK)).mul(isFront);
    const canteraDoor = door.add(isEntry.mul(ground).mul(step(abs(cellK.sub(doorK)), 0.5)).mul(step(abs(u), 0.68)).mul(step(fv, 2.4))).min(1.0);
    const cantera = max(canteraWin, canteraDoor).mul(float(1.0).sub(opening)).mul(colonial).mul(float(1.0).sub(isRoof));
    // (the guardapolvo by the height over the street here, not over the box's foot: on a slope that is under the sidewalk)
    const overStreet = positionWorld.y.sub(townFloorNode(positionWorld.xz));
    const guardapolvo = colonial.mul(step(overStreet, 1.05)).mul(float(1.0).sub(isRoof));
    const cornice = colonial.mul(step(fromTop, 0.55)).mul(step(0.18, fromTop)).mul(float(1.0).sub(isRoof));
    const canteraTone = mix(color(0xb9a27f), color(0xcdb894), noise2D(vec2(sx.mul(2.1), y.mul(2.7)).add(seed)));
    c = mix(c, paint.mul(0.62), guardapolvo.mul(float(1.0).sub(opening)));
    c = mix(c, canteraTone, cantera);
    c = mix(c, mix(color(0xe9e1cf), color(0x8d8270), step(fromTop, 0.26)), cornice);
    // door & gate
    const doorTint = mix(color(0x5b3a26), color(0x2e3438), step(0.5, hash2D(vec2(seed, 3.3))));
    c = mix(c, doorTint.mul(float(1.0).sub(lineAA(fract(u.mul(2.0)).sub(0.5), 0.03).mul(0.3))), door);
    const gateTint = mix(color(0xdedad2), mix(color(0x7a2a22), color(0x34495e), step(0.5, hash2D(vec2(seed, 5.7)))), step(0.45, hash2D(vec2(seed, 7.9))));
    c = mix(c, gateTint.mul(float(1.0).sub(step(0.8, fract(u.mul(6.5))).mul(0.18))), gate);
    // steel shutter: down when the shop is shut, rolled up into its drum over the opening when it is open
    const drum = cortina.mul(step(2.3, fv));
    c = mix(c, color(0xaeb2b5).mul(float(1.0).sub(step(0.7, fract(fv.div(0.09))).mul(0.22))), max(cortina.mul(float(1.0).sub(shopOpen)), drum));
    c = mix(c, mix(color(0x2a3236), seen.mul(0.45), 0.75), shopView);

    // chain convenience store front: glazing between grey piers, a yellow stripe, a red band above
    const storeTop = box.y;
    const glazH = min(storeTop.mul(0.62), float(2.6));
    const pier = step(fract(sx.div(2.6)), 0.14);
    const glass = isChain.mul(step(y, glazH));
    const stripe = isChain.mul(step(glazH, y)).mul(step(y, glazH.add(0.45)));
    const band = isChain.mul(step(glazH.add(0.45), y));
    c = mix(c, mix(color(0x2c3e44), color(0x8a8f94), pier), glass);
    c = mix(c, chainStripes.element(chainNo), stripe);
    c = mix(c, chainBands.element(chainNo).mul(float(1.0).sub(step(0.97, fract(sx.div(2.0))).mul(0.3))), band);

    // big box: ribbed cladding in a pale neutral (white, sand, light or mid grey by the tone) over a concrete plinth,
    // a darker coping; the front glazed to ~4 m between piers every 7.5 m (mullions every 1.5 m), the doors in the
    // middle bay, a dark canopy over the glazing
    const panel = mix(mix(color(0xe9e6df), color(0xd6cfbf), step(0.3, tone)), mix(color(0xc3c8cb), color(0x9da5aa), step(0.85, tone)), step(0.6, tone));
    const rib = lineAA(fract(sx.div(0.6)).sub(0.5), 0.07).mul(isBigSide);
    let hall = panel.mul(float(1.0).sub(rib.mul(0.16)));
    hall = mix(hall, color(0x9a978f), step(y, 0.9)); // plinth
    hall = mix(hall, panel.mul(0.72), step(fromTop, 0.5)); // coping
    const hallGlazH = min(float(4.2), box.y.mul(0.55));
    const hallBays = max(floor(wallW.div(7.5)), 1.0);
    const hallBay = wallW.div(hallBays);
    const hallU = fract(sx.div(hallBay)).sub(0.5).mul(hallBay); // metres from the bay's centre
    const hallPier = step(hallBay.mul(0.5).sub(0.35), abs(hallU));
    const hallMull = lineAA(fract(sx.div(1.5)).sub(0.5), 0.05);
    const hallGlass = isBigFront.mul(step(y, hallGlazH)).mul(float(1.0).sub(hallPier)).mul(step(0.35, y));
    const hallDoors = hallGlass.mul(step(abs(floor(sx.div(hallBay)).sub(floor(hallBays.mul(0.5)))), 0.5)).mul(step(y, 2.6));
    const canopy = isBigFront.mul(step(hallGlazH, y)).mul(step(y, hallGlazH.add(0.7)));
    hall = mix(hall, color(0x3a3f44), canopy);
    hall = mix(hall, mix(color(0x2a3a42), color(0x8f979c), hallMull), hallGlass);
    hall = mix(hall, color(0x1f2a30), hallDoors);
    c = mix(c, hall, isBig);

    // roofs: concrete, some coated red; a big box's white membrane (a box over 900 m2 and 18 m across)
    const bigRoof = step(900.0, box.x.mul(box.z)).mul(step(18.0, min(box.x, box.z)));
    const roof = mix(mix(color(0x9c988f), color(0xa64b3d), step(hash2D(vec2(seed, 2.7)), 0.35)), color(0xd9d8d2), bigRoof)
      .mul(noise2D(positionWorld.xz.mul(0.4)).mul(0.12).add(0.94));
    // the lit rooms & open shops glow at night: the room as its lamp lights it, through the curtains a little
    const glowRoom = pane.mul(roomLit).mul(float(1.0).sub(isRoof));
    const glow = mix(lightOn, curtainCol.mul(lampTint).mul(0.45), curtain).mul(glowRoom);
    const storeGlass = glass.mul(float(1.0).sub(pier)).add(hallGlass.mul(float(1.0).sub(hallMull)));
    return { color: mix(c, roof, isRoof), glow, store: storeGlass.mul(float(1.0).sub(isRoof)), shiny: win.add(glass).add(hallGlass).add(shopView).min(1.0).mul(float(1.0).sub(isRoof)) };
  })();

  mat.colorNode = wall.color;
  mat.roughnessNode = mix(float(0.86), float(0.3), wall.shiny);
  mat.emissiveNode = wall.glow.mul(0.55).add(color(0xeef4ff).mul(wall.store).mul(0.35)).mul(smoothstep(0.35, 1.2, cityUniforms.uInteriorGlow));
  mat.aoNode = canyonSkyAONode();
  _mexicanHouseMat = mat;
  return mat;
}
