// js/world/forum/interior.ts
// Forum Tepic inside: the polished floor, the shops' fronts on both floors (their lit windows, the signs over them,
// white pilasters & fascias), the anchors' wide fronts (Liverpool under its Huichol painting, Sears, the Cinemex,
// Suburbia, the casino), the food court's stalls & tables, the gallery slabs and their glass balustrades, the orange
// columns, the escalators, the kiosks and planters.
import * as THREE from 'three/webgpu';
import { FLOOR, FORUM, GLASS, LEVEL, PANE, RAIL, ROOF, SIGN, SLAB, segmentBox } from '../forum-plan.ts';
import { ForumGeo, addMesh } from './kit.ts';
import type { Frontage, ForumPlan } from '../forum-plan.ts';
import type { ForumMaterials } from './materials.ts';
import type { SignAtlas } from './signs.ts';

type Vec2 = [number, number];

const _c = new THREE.Color();
// a shop's colour for its window (the more colourful of its sign's two) and its seed
function shopTag(atlas: SignAtlas, name: string, seed: number): [number, number, number, number] {
  const [bg, fg] = atlas.look(name);
  const sat = (s: string) => { _c.setStyle(s); const hsl = { h: 0, s: 0, l: 0 }; _c.getHSL(hsl); return hsl.s * (1 - Math.abs(hsl.l * 2 - 1)); };
  _c.setStyle(sat(bg) >= sat(fg) ? bg : fg);
  return [_c.r, _c.g, _c.b, (Math.sin(seed * 91.3) * 0.5 + 0.5) * 0.98];
}

export function buildInterior(group: THREE.Group, mats: ForumMaterials, atlas: SignAtlas, base: (x: number, z: number) => number): void {
  const P: ForumPlan = FORUM;
  const floor = new ForumGeo(), slab = new ForumGeo(), white = new ForumGeo(), ochre = new ForumGeo(), win = new ForumGeo();
  const signs = new ForumGeo(), column = new ForumGeo(), railGlass = new ForumGeo(), steel = new ForumGeo(), dark = new ForumGeo();
  const plant = new ForumGeo(), seat = new ForumGeo(), mural = new ForumGeo(), cladding = new ForumGeo();
  const glass = new ForumGeo(), wood = new ForumGeo(), roomFloor = new ForumGeo(), roomWall = new ForumGeo(), granite = new ForumGeo();
  const stepsUp = new ForumGeo(), stepsDown = new ForumGeo();

  // a sign of the atlas on the front a → b at its middle, `w` x `h`, its middle y (over the floor under it)
  const sign = (f: Frontage, t: number, name: string, w: number, h: number, ym: number) => {
    const dx = f.bx - f.ax, dz = f.bz - f.az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const mx = f.ax + dx * t, mz = f.az + dz * t, y = base(mx, mz) + ym;
    const [u0, v0, u1, v1] = atlas.slot(name);
    // (face() lays the uv rect left to right as we face it: the atlas reads the right way round)
    signs.face(mx - ux * w / 2 + f.nx * 0.08, mz - uz * w / 2 + f.nz * 0.08, mx + ux * w / 2 + f.nx * 0.08, mz + uz * w / 2 + f.nz * 0.08, y - h / 2, y + h / 2, f.nx, f.nz, [u0, v0, u1, v1]);
  };

  // THE FLOOR: the mall's outline, the food court beyond it, the entrances' boxes (over the block's lawns, which lie a
  // hair over its sidewalk, and over the lots)
  floor.polygon(P.buildings[0].ring, [], () => FLOOR + 0.02);
  for (const f of P.floors) floor.polygon(f, [], () => FLOOR + 0.02);
  for (const e of P.entrances) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L;
    floor.polygon([[e.ax - dx * 0.3, e.az - dz * 0.3], [e.bx + dx * 0.3, e.bz + dz * 0.3], [e.bx + dx * 0.3 + e.nx * (e.out + 2), e.bz + dz * 0.3 + e.nz * (e.out + 2)],
      [e.ax - dx * 0.3 + e.nx * (e.out + 2), e.az - dz * 0.3 + e.nz * (e.out + 2)]], [], () => FLOOR + 0.03);
  }

  // A locale's room, a0 to a1 m along front f and `d` deep: its floor, walls, ceiling, shelves & counter (an anchor's
  // racks down its floor too); `tag` its colour & seed
  const shopRoom = (f: Frontage, a0: number, a1: number, d: number, tag: [number, number, number, number], anchor: boolean) => {
    const L = Math.hypot(f.bx - f.ax, f.bz - f.az), ux = (f.bx - f.ax) / L, uz = (f.bz - f.az) / L;
    const at = (a: number, b: number): Vec2 => [f.ax + ux * a - f.nx * b, f.az + uz * a - f.nz * b];
    const top = f.y0 === 0 && f.y1 === LEVEL ? LEVEL - SLAB : f.y1;
    const H = Math.min(anchor ? 6.2 : 4.4, top - f.y0 - 0.3);
    const [mx, mz] = at((a0 + a1) / 2, d / 2), y = base(mx, mz) + f.y0;
    const ring = [at(a0, 0), at(a1, 0), at(a1, d), at(a0, d)];
    roomFloor.tag = tag;
    roomFloor.polygon(ring, [], (x, z) => base(x, z) + f.y0 + (f.y0 ? 0.012 : 0.03));
    roomFloor.tag = null;
    white.polygon(ring, [], () => y + H, true);
    roomWall.tag = tag;
    const wall = (p: Vec2, q: Vec2, nx: number, nz: number) => { roomWall.face(p[0], p[1], q[0], q[1], y, y + H, nx, nz); };
    wall(at(a0 + 0.2, 0), at(a0 + 0.2, d), ux, uz);
    wall(at(a1 - 0.2, 0), at(a1 - 0.2, d), -ux, -uz);
    wall(at(a0, d - 0.2), at(a1, d - 0.2), f.nx, f.nz);
    roomWall.tag = null;
    // the shelves, goods on every face (the windows' goods: win's pattern in the shop's colour), the counter
    win.tag = tag;
    const shelf = (p: Vec2, q: Vec2, thick: number, h: number) => { win.box(segmentBox(p[0], p[1], q[0], q[1], thick, 0, h), y, 0b011111); };
    shelf(at(a0 + 0.2, d - 0.55), at(a1 - 0.2, d - 0.55), 0.6, 2.2);
    if (d > 4) {
      shelf(at(a0 + 0.55, 2), at(a0 + 0.55, d - 1), 0.6, 2.2);
      shelf(at(a1 - 0.55, 2), at(a1 - 0.55, d - 1), 0.6, 2.2);
    }
    // (an aisle kept clear down the middle, from the doorway to the counter)
    if (anchor && d > 12) for (let a = 3; a < a1 - a0 - 3; a += 4) if (Math.abs(a - (a1 - a0) / 2) > 2.5) shelf(at(a0 + a, 5), at(a0 + a, d - 5), 0.7, 1.4);
    win.tag = null;
    if (d < 6.5) return;
    const half = Math.min(1.6, (a1 - a0) / 2 - 1.5), [cx, cz] = at((a0 + a1) / 2, d - 2.6);
    wood.box(segmentBox(cx - ux * half, cz - uz * half, cx + ux * half, cz + uz * half, 0.7, 0, 1.05), y, 0b011111);
  };

  // THE FRONTS, and the rooms behind them: each locale's glass either side of its doorway (or across it, where it has
  // no room), the white fascia over it with its sign; in its room a floor of wood or tiles, walls in a wash of its
  // colour, a ceiling with its lights, shelves of goods along the back and sides, a counter, an anchor's racks
  let seed = 0;
  for (const f of P.frontages) {
    const dx = f.bx - f.ax, dz = f.bz - f.az, L = Math.hypot(dx, dz);
    if (L < 0.2) continue;
    const ux = dx / L, uz = dz / L;
    // a face along the front from a to b metres, `out` m off it (+: into the walkway, -: into the room)
    const piece = (a: number, b: number, g: ForumGeo, y0: number, y1: number, out = 0, nx = f.nx, nz = f.nz) => {
      const ax = f.ax + ux * a + f.nx * out, az = f.az + uz * a + f.nz * out, bx = f.ax + ux * b + f.nx * out, bz = f.az + uz * b + f.nz * out;
      const y = base((ax + bx) / 2, (az + bz) / 2);
      g.face(ax, az, bx, bz, y + y0, y + y1, nx, nz);
    };
    // the top of a front's wall: under the slab for a ground floor's shops with an upper floor over them
    const top = f.y0 === 0 && f.y1 === LEVEL ? LEVEL - SLAB : f.y1;
    if (f.kind === 'blank') {
      piece(0, L, white, f.y0, f.y1);
      continue;
    }
    if (f.kind === 'stalls') {
      const n = f.names.length;
      for (let k = 0; k < n; k++) {
        const a0 = (L * k) / n, a1 = (L * (k + 1)) / n;
        win.tag = shopTag(atlas, f.names[k], ++seed);
        piece(a0 + 0.1, a1 - 0.1, win, f.y0, f.y0 + 3.0);
        win.tag = null;
        const mx = f.ax + ux * (a0 + a1) / 2, mz = f.az + uz * (a0 + a1) / 2;
        dark.box({ cx: mx + f.nx * 0.55, cz: mz + f.nz * 0.55, hu: L / n / 2 - 0.15, hv: 0.4, cs: ux, sn: -uz, y0: 0, y1: 1.08 }, base(mx, mz) + f.y0, 0b011111);
        wood.box({ cx: mx + f.nx * 0.55, cz: mz + f.nz * 0.55, hu: L / n / 2 - 0.1, hv: 0.45, cs: ux, sn: -uz, y0: 1.08, y1: 1.14 }, base(mx, mz) + f.y0);
        sign(f, (a0 + a1) / 2 / L, f.names[k], L / n - 0.5, 0.8, f.y0 + 3.55);
      }
      piece(0, L, white, f.y0 + 3.0, f.y1);
      continue;
    }
    const anchor = f.kind === 'anchor', liverpool = f === P.liverpool;
    const n = f.names.length, w = L / n;
    // (an anchor's glass is lower, its fascia a band for its big sign; Liverpool's upstairs under its painting)
    const glassTop = liverpool ? 3.0 : anchor ? 3.6 : GLASS;
    for (let k = 0; k < n; k++) {
      const a0 = w * k, a1 = w * (k + 1), name = f.names[k];
      const room = k < f.rooms.length ? f.rooms[k] : { depth: 0, door: 0 };
      const tag = shopTag(atlas, name, ++seed + (anchor ? 0.6 : 0));
      if (room.depth) {
        const side = (w - room.door) / 2;
        // (downstairs the glass under the transom is the breakable panes': forum.ts draws them)
        if (f.y0 > 0) {
          piece(a0 + 0.2, a0 + side, glass, f.y0, f.y0 + glassTop);
          piece(a1 - side, a1 - 0.2, glass, f.y0, f.y0 + glassTop);
          piece(a0 + side, a1 - side, glass, f.y0 + PANE, f.y0 + glassTop);
        } else piece(a0 + 0.2, a1 - 0.2, glass, PANE, glassTop);
        for (const a of [a0 + side, a1 - side]) {
          const px = f.ax + ux * a, pz = f.az + uz * a;
          dark.box({ cx: px, cz: pz, hu: 0.06, hv: 0.1, cs: ux, sn: -uz, y0: f.y0, y1: f.y0 + glassTop }, base(px, pz), 0b011111);
        }
        shopRoom(f, a0, a1, room.depth, tag, anchor);
      } else {
        win.tag = tag;
        piece(a0 + 0.2, a1 - 0.2, win, f.y0, f.y0 + glassTop);
        win.tag = null;
      }
      piece(a0, a1, liverpool ? ochre : white, f.y0 + glassTop, top);
      if (liverpool) {
        // (its name is on its front downstairs; upstairs the painting over its glass)
      } else if (anchor) {
        const sw = Math.min(L * 0.5, 11);
        sign(f, 0.5, name, sw, Math.min(sw / 5.3, top - f.y0 - glassTop - 0.3), f.y0 + glassTop + Math.min(sw / 5.3, top - f.y0 - glassTop - 0.3) / 2 + 0.2);
      } else {
        sign(f, (a0 + a1) / 2 / L, name, Math.min(w - 1.2, 6.2), SIGN[1] - SIGN[0], f.y0 + (SIGN[0] + SIGN[1]) / 2);
      }
      // a pilaster between this locale and the next, and at the run's ends
      for (const a of k === 0 ? [a0, a1] : [a1]) {
        const px = f.ax + ux * a, pz = f.az + uz * a;
        white.box({ cx: px + f.nx * 0.1, cz: pz + f.nz * 0.1, hu: 0.2, hv: 0.12, cs: ux, sn: -uz, y0: f.y0, y1: top }, base(px, pz), 0b011111);
      }
    }
    if (liverpool) {
      const mw = Math.min(L * 0.75, 2.67 * (top - f.y0 - glassTop - 0.6)), mx = f.ax + dx / 2, mz = f.az + dz / 2, y = base(mx, mz) + f.y0 + glassTop + 0.3;
      mural.face(mx - ux * mw / 2 + f.nx * 0.06, mz - uz * mw / 2 + f.nz * 0.06, mx + ux * mw / 2 + f.nx * 0.06, mz + uz * mw / 2 + f.nz * 0.06, y, y + mw / 2.67, f.nx, f.nz, [0, 0, 1, 1]);
    }
  }

  // THE UPPER FLOOR: the slabs (their tops the floor's tiles, laid on the town's floor; their undersides & edges white),
  // the balustrades' glass with a steel rail on top
  for (const s of P.slabs) {
    slab.polygon(s.ring, s.hole ? [s.hole] : [], () => FLOOR + LEVEL);
    white.polygon(s.ring, s.hole ? [s.hole] : [], (x, z) => base(x, z) + LEVEL - SLAB, true);
    const inHole = (x: number, z: number) => {
      const h = s.hole;
      if (!h) return false;
      let c = false;
      for (let p = 0, q = h.length - 1; p < h.length; q = p++) {
        const [xi, zi] = h[p], [xj, zj] = h[q];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    const edges = (ring: Vec2[]) => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i], L = Math.hypot(bx - ax, bz - az) || 1;
        let nx = (bz - az) / L, nz = -(bx - ax) / L;
        // (away from the slab: out of its outline, into its hole)
        const mx = (ax + bx) / 2 + nx * 0.2, mz = (az + bz) / 2 + nz * 0.2;
        let inOuter = false;
        for (let p = 0, q = s.ring.length - 1; p < s.ring.length; q = p++) {
          const [xi, zi] = s.ring[p], [xj, zj] = s.ring[q];
          if (zi > mz !== zj > mz && mx < ((xj - xi) * (mz - zi)) / (zj - zi) + xi) inOuter = !inOuter;
        }
        if (inOuter && !inHole(mx, mz)) { nx = -nx; nz = -nz; }
        const y = base((ax + bx) / 2, (az + bz) / 2);
        white.face(ax, az, bx, bz, y + LEVEL - SLAB, y + LEVEL, nx, nz);
      }
    };
    edges(s.ring);
    if (s.hole) edges(s.hole);
  }
  for (const r of P.rails) {
    const y = base((r.ax + r.bx) / 2, (r.az + r.bz) / 2), L = Math.hypot(r.bx - r.ax, r.bz - r.az) || 1;
    const ux = (r.bx - r.ax) / L, uz = (r.bz - r.az) / L;
    railGlass.face(r.ax, r.az, r.bx, r.bz, y + LEVEL, y + LEVEL + RAIL - 0.06, -uz, ux);
    steel.box({ cx: (r.ax + r.bx) / 2, cz: (r.az + r.bz) / 2, hu: L / 2, hv: 0.04, cs: ux, sn: -uz, y0: LEVEL + RAIL - 0.06, y1: LEVEL + RAIL }, y);
  }

  // THE COLUMNS
  for (const c of P.columns) {
    const y = base(c.x, c.z), box = { cx: c.x, cz: c.z, hu: 0.5, hv: 0.5, cs: c.cs, sn: c.sn };
    granite.box({ ...box, hu: 0.53, hv: 0.53, y0: 0, y1: 1.3 }, y, 0b011111);
    column.box({ ...box, y0: 1.3, y1: ROOF }, y, 0b001111);
  }

  // THE ESCALATORS: a steel truss under a band of dark steps, glass sides with black handrails, level at either end
  for (const e of P.escalators) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = (e.bx - e.ax) / L, dz = (e.bz - e.az) / L, px = -dz, pz = dx;
    const S = [0, 1.2, L - 1.2, L], H = [0, 0, LEVEL, LEVEL];
    const pt = (s: number, side: number, up: number): [number, number, number] => {
      const x = e.ax + dx * s + px * side, z = e.az + dz * s + pz * side;
      const k = s <= 1.2 ? 0 : s >= L - 1.2 ? LEVEL : (LEVEL * (s - 1.2)) / (L - 2.4);
      return [x, base(x, z) + k + up, z];
    };
    const half = e.width / 2;
    for (let i = 0; i + 1 < S.length; i++) {
      const s0 = S[i], s1 = S[i + 1], rise = H[i + 1] - H[i], run = s1 - s0, nl = Math.hypot(rise, run) || 1;
      const ny = run / nl, nh = -rise / nl; // (the steps' normal: up, leaning back)
      // (the steps: uv along them from the foot, the material running them up or down)
      const s0u = i === 0 ? 0 : i === 1 ? 1.2 : 1.2 + Math.hypot(LEVEL, L - 2.4);
      (e.up ? stepsUp : stepsDown).quad(pt(s0, half, 0.02), pt(s1, half, 0.02), pt(s1, -half, 0.02), pt(s0, -half, 0.02), [dx * nh, ny, dz * nh],
        [[s0u, 0], [s0u + nl, 0], [s0u + nl, e.width], [s0u, e.width]]);
      for (const side of [1, -1]) {
        const o = side * (half + 0.08);
        railGlass.quad(pt(s0, o, 0.05), pt(s1, o, 0.05), pt(s1, o, 1.0), pt(s0, o, 1.0), [px * side, 0, pz * side], [[0, 0], [nl, 0], [nl, 1], [0, 1]]);
        dark.quad(pt(s0, o - 0.05, 1.0), pt(s0, o + 0.05, 1.0), pt(s1, o + 0.05, 1.0), pt(s1, o - 0.05, 1.0), [0, 1, 0], [[0, 0], [0.1, 0], [0.1, nl], [0, nl]]);
        if (rise > 0) {
          // the truss's side under the incline, down to the floor at its foot
          cladding.quad(pt(s0, o, 0), pt(s1, o, 0), pt(s1, o, -rise), pt(s0, o, 0), [px * side, 0, pz * side], [[0, 0], [nl, 0], [nl, rise], [0, 0]]);
        }
      }
    }
  }

  // THE FOOD COURT'S TABLES upstairs: white round tops on a post, four orange chairs round each
  for (const [x, z] of P.tables) {
    const y = base(x, z) + LEVEL;
    white.cylinder(x, z, 0.5, y + 0.72, y + 0.76, 10);
    steel.cylinder(x, z, 0.05, y, y + 0.72, 6);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 2 * Math.PI + 0.4, cx = x + Math.cos(a) * 0.85, cz = z + Math.sin(a) * 0.85, cs = Math.cos(a), sn = -Math.sin(a);
      seat.box({ cx, cz, hu: 0.22, hv: 0.22, cs, sn, y0: 0.42, y1: 0.47 }, y);
      seat.box({ cx: cx + Math.cos(a) * 0.2, cz: cz + Math.sin(a) * 0.2, hu: 0.03, hv: 0.22, cs, sn, y0: 0.47, y1: 0.9 }, y);
      steel.cylinder(cx, cz, 0.03, y, y + 0.42, 4);
    }
  }
  // THE KIOSKS: a white counter, a dark vitrine on it, the name over it on two posts
  for (const k of P.kiosks) {
    const y = base(k.x, k.z), box = { cx: k.x, cz: k.z, hu: 1.6, hv: 1.0, cs: k.cs, sn: k.sn };
    wood.box({ ...box, y0: 0, y1: 1.0 }, y);
    railGlass.box({ ...box, hu: 1.5, hv: 0.9, y0: 1.0, y1: 1.45 }, y);
    const ax = k.x - k.cs * 1.5, az = k.z + k.sn * 1.5, bx = k.x + k.cs * 1.5, bz = k.z - k.sn * 1.5;
    for (const [px, pz] of [[ax, az], [bx, bz]]) steel.cylinder(px, pz, 0.04, y + 1.45, y + 2.3, 6);
    const [u0, v0, u1, v1] = atlas.slot(k.name);
    const nx = k.sn, nz = k.cs; // (the kiosk's long sides face along its local z)
    signs.face(ax + nx * 0.03, az + nz * 0.03, bx + nx * 0.03, bz + nz * 0.03, y + 2.0, y + 2.55, nx, nz, [u0, v0, u1, v1]);
    signs.face(ax - nx * 0.03, az - nz * 0.03, bx - nx * 0.03, bz - nz * 0.03, y + 2.0, y + 2.55, -nx, -nz, [u0, v0, u1, v1]);
  }
  // THE PLANTERS: a round grey pot, its soil (the palm in it is street-details.ts's, forum-plan.ts palms)
  for (const [x, z] of P.planters) {
    const y = base(x, z);
    steel.cylinder(x, z, 1.05, y, y + 0.8, 16);
    plant.cylinder(x, z, 0.95, y + 0.8, y + 0.83, 16);
  }

  addMesh(group, floor, mats.floor, 'ForumFloor', { drape: true, shadows: false });
  addMesh(group, slab, mats.floor, 'ForumGalleries', { drape: true });
  addMesh(group, white, mats.white, 'ForumWhite');
  addMesh(group, ochre, mats.ochre, 'ForumInsideOchre');
  addMesh(group, win, mats.window, 'ForumShopWindows', { shadows: false });
  addMesh(group, signs, mats.sign, 'ForumShopSigns', { shadows: false });
  addMesh(group, column, mats.column, 'ForumColumns');
  addMesh(group, railGlass, mats.railGlass, 'ForumRailGlass', { shadows: false });
  addMesh(group, steel, mats.steel, 'ForumSteel');
  addMesh(group, dark, mats.dark, 'ForumDark');
  addMesh(group, plant, mats.plant, 'ForumPlants');
  addMesh(group, seat, mats.seat, 'ForumSeats');
  addMesh(group, mural, mats.mural, 'ForumMural', { shadows: false });
  addMesh(group, cladding, mats.cladding, 'ForumEscalatorSides');
  addMesh(group, glass, mats.shopGlass, 'ForumShopGlass', { shadows: false });
  addMesh(group, stepsUp, mats.stepsUp, 'ForumEscalatorStepsUp');
  addMesh(group, stepsDown, mats.stepsDown, 'ForumEscalatorStepsDown');
  addMesh(group, wood, mats.wood, 'ForumWood');
  addMesh(group, roomFloor, mats.roomFloor, 'ForumShopFloors', { shadows: false });
  addMesh(group, roomWall, mats.roomWall, 'ForumShopWalls', { shadows: false });
  addMesh(group, granite, mats.granite, 'ForumColumnFeet');
}
