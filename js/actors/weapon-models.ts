// js/actors/weapon-models.js
// The arsenal's 3D models (sim/weapons.js), built from profiles and tubes at their real sizes: a Colt 1911 in .38 Super
// with ivory grips (the escuadra of the corridos), an MP5, the cartel's AK-47 (the cuerno de chivo), an RPG-7, and the
// hands that hold them. Each weapon is one merged geometry whose vertices carry their finish (colour, metalness and
// roughness), so a gun is one draw whatever it is made of (createWeaponMaterial reads them). They are drawn in the
// player's and everyone else's hands (sim/crime.js) and baked into the wheel's and the HUD's icons (ui/weapon-icons.js).
//
// The hand frame: 1 unit = 1 m, the middle of the (rear) grip at the origin, +z along the barrel, +y up, +x the
// shooter's left.

import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// sRGB colour, metalness, roughness
const FINISH = {
  blued: [0x202226, 0.85, 0.36],
  steel: [0x4a4d52, 0.9, 0.3],
  bore: [0x050505, 0.2, 0.9],
  polymer: [0x1a1b1d, 0.05, 0.6],
  ivory: [0xe9dfca, 0.0, 0.32],
  walnut: [0x7a3d1c, 0.0, 0.48],
  bakelite: [0x8c3a17, 0.0, 0.4], // (the AK's orange-brown magazine)
  olive: [0x535a3c, 0.2, 0.62],
  warhead: [0x5f6646, 0.35, 0.5],
  skin: [0xa36a48, 0.0, 0.58],
  sleeve: [0x2f4766, 0.0, 0.92]
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Reverses each triangle of a non-indexed geometry (after a mirroring transform turned it inside out)
function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const n = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a.array[(i + 1) * n + k];
        a.array[(i + 1) * n + k] = a.array[(i + 2) * n + k];
        a.array[(i + 2) * n + k] = t;
      }
    }
  }
}

// Geometries collected with their finish, merged into one
class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, finish, matrix = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.clearGroups();
    if (matrix) {
      g.applyMatrix4(matrix);
      if (matrix.determinant() < 0) flipWinding(g);
    }
    const [hex, metal, rough] = FINISH[finish];
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const color = new Float32Array(n * 3);
    const pbr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
      pbr[i * 2] = metal;
      pbr[i * 2 + 1] = rough;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
    this.list.push(g);
    return this;
  }

  // A side profile ([z, y] points round its outline, optional holes) `width` thick, centred at x
  profile(points, width, finish, { x = 0, bevel = 0.0012, holes = [] } = {}) {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
    const depth = Math.max(0.0005, width - bevel * 2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4
    });
    // (the shape's x runs along +z, its y up, and the extrusion across, -x)
    g.rotateY(-Math.PI / 2);
    g.translate(x + depth / 2, 0, 0);
    return this.add(g, finish);
  }

  // A tube along z from z0 to z1 (radius r0 at z0, r1 at z1) with its axis at (x, y)
  tube(r0, r1, z0, z1, y, finish, { x = 0, seg = 16, open = false } = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, open);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, (z0 + z1) / 2);
    return this.add(g, finish);
  }

  box(w, h, l, x, y, z, finish, { rx = 0 } = {}) {
    const g = new THREE.BoxGeometry(w, h, l);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return this.add(g, finish);
  }

  // A rounded rod (capsule) from a to b
  rod(a, b, r, finish) {
    _v.subVectors(b, a);
    const len = _v.length();
    const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 3, 10);
    _q.setFromUnitVectors(UP, _v.normalize());
    _m.compose(_s.addVectors(a, b).multiplyScalar(0.5), _q, _v.set(1, 1, 1));
    g.applyMatrix4(_m);
    return this.add(g, finish);
  }

  // An ellipsoid of radii (rx, ry, rz) at (x, y, z)
  blob(rx, ry, rz, x, y, z, finish) {
    const g = new THREE.SphereGeometry(1, 14, 10);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    return this.add(g, finish);
  }

  // Everything added since `from`, transformed (a hand placed on its grip)
  transform(from, matrix) {
    const flip = matrix.determinant() < 0;
    for (let i = from; i < this.list.length; i++) {
      this.list[i].applyMatrix4(matrix);
      if (flip) flipWinding(this.list[i]);
    }
  }

  build() {
    const g = mergeGeometries(this.list);
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// =====================================================================================================================
// The guns. Each records where its grips are (for the hands) and where its muzzle is.
// =====================================================================================================================

// Colt M1911 in .38 Super: 216 mm long, the slide 23 mm wide, the grip raked back 18 degrees
function pistol(p) {
  // slide, its front a touch tapered, serrations at the back
  p.profile([[-0.055, 0.032], [0.162, 0.032], [0.162, 0.058], [0.156, 0.064], [-0.046, 0.064], [-0.055, 0.058]], 0.022, 'blued');
  for (let i = 0; i < 7; i++) p.box(0.0235, 0.022, 0.0016, 0, 0.049, -0.048 + i * 0.0042, 'polymer');
  p.box(0.002, 0.011, 0.032, -0.0112, 0.054, 0.022, 'bore'); // ejection port (the right side)
  p.tube(0.0098, 0.0098, 0.152, 0.163, 0.046, 'steel'); // barrel bushing
  p.tube(0.0058, 0.0058, 0.16, 0.1645, 0.046, 'steel');
  p.tube(0.0044, 0.0044, 0.162, 0.1652, 0.046, 'bore');
  p.box(0.0035, 0.006, 0.007, 0, 0.067, 0.152, 'blued'); // sights
  p.box(0.014, 0.006, 0.007, 0, 0.067, -0.04, 'blued');
  // frame: dust cover and the frame under the slide, the trigger guard
  p.profile([[-0.05, 0.033], [0.122, 0.033], [0.122, 0.022], [0.066, 0.021], [0.02, 0.021], [0.004, 0.012], [-0.05, 0.012]], 0.02, 'blued');
  p.profile([[0.008, 0.022], [0.064, 0.022], [0.066, 0.011], [0.058, -0.007], [0.022, -0.009], [0.008, 0.001]], 0.011, 'blued',
    { holes: [[[0.016, 0.017], [0.056, 0.017], [0.058, 0.009], [0.052, -0.003], [0.026, -0.004], [0.016, 0.003]]] });
  p.box(0.006, 0.016, 0.005, 0, 0.01, 0.03, 'steel', { rx: -0.2 }); // trigger
  // grip frame (front strap, back strap, the beavertail up behind the hammer) and its ivory panels
  p.profile([[0.012, 0.016], [-0.015, -0.074], [-0.058, -0.078], [-0.04, 0.012], [-0.066, 0.03], [-0.062, 0.037], [-0.046, 0.034], [-0.03, 0.016]], 0.024, 'blued');
  p.profile([[0.004, 0.006], [-0.017, -0.064], [-0.05, -0.067], [-0.034, 0.006]], 0.0285, 'ivory', { bevel: 0.0018 });
  p.box(0.023, 0.007, 0.036, 0, -0.08, -0.037, 'blued'); // magazine base
  p.box(0.008, 0.013, 0.011, 0, 0.066, -0.058, 'steel', { rx: 0.5 }); // hammer
  p.box(0.005, 0.009, 0.012, -0.012, 0.03, -0.01, 'steel'); // safety, by the thumb
  return { grips: [{ y: -0.03, z: -0.023, rake: 0.31, a: 0.024, b: 0.0145, trigger: [0.01, 0.03] }], muzzle: [0, 0.046, 0.165] };
}

// Heckler & Koch MP5A3: 550 mm stock in, a 30-round curved magazine, the polymer grip and handguard
function smg(p) {
  // receiver: a stamped tube, rounded on top
  p.profile([[-0.11, 0.022], [0.2, 0.022], [0.2, 0.068], [0.19, 0.078], [-0.1, 0.078], [-0.11, 0.07]], 0.034, 'blued', { bevel: 0.004 });
  p.tube(0.012, 0.012, 0.15, 0.31, 0.07, 'blued'); // cocking tube
  p.box(0.008, 0.006, 0.03, 0.017, 0.074, 0.27, 'steel'); // cocking handle (the left)
  p.profile([[0.16, 0.06], [0.305, 0.06], [0.31, 0.03], [0.3, 0.012], [0.17, 0.014], [0.155, 0.03]], 0.05, 'polymer', { bevel: 0.006 });
  p.tube(0.0085, 0.0085, 0.3, 0.37, 0.046, 'blued'); // barrel
  p.tube(0.012, 0.012, 0.35, 0.365, 0.046, 'blued');
  p.tube(0.005, 0.005, 0.365, 0.371, 0.046, 'bore');
  // front sight hood and rear drum sight
  p.box(0.004, 0.026, 0.01, 0.011, 0.088, 0.3, 'blued');
  p.box(0.004, 0.026, 0.01, -0.011, 0.088, 0.3, 'blued');
  p.box(0.026, 0.004, 0.01, 0, 0.1, 0.3, 'blued');
  const drum = new THREE.CylinderGeometry(0.016, 0.016, 0.03, 14).rotateZ(Math.PI / 2).translate(0, 0.093, -0.07);
  p.add(drum, 'blued');
  // magazine well and the curved magazine
  p.box(0.03, 0.03, 0.04, 0, 0.012, 0.11, 'blued');
  p.profile([[0.093, 0.0], [0.13, 0.0], [0.137, -0.06], [0.152, -0.115], [0.172, -0.165], [0.147, -0.176], [0.128, -0.128], [0.112, -0.07], [0.104, 0.0]], 0.022, 'blued');
  // trigger group and pistol grip
  p.profile([[-0.06, 0.024], [0.07, 0.024], [0.07, 0.006], [0.04, -0.012], [0.004, -0.014], [-0.06, 0.006]], 0.03, 'polymer', { bevel: 0.003 });
  p.profile([[0.012, 0.0], [-0.008, -0.09], [-0.052, -0.088], [-0.036, 0.0]], 0.031, 'polymer', { bevel: 0.004 });
  p.profile([[0.02, 0.006], [0.06, 0.006], [0.058, -0.012], [0.03, -0.014]], 0.012, 'polymer',
    { holes: [[[0.026, 0.0], [0.052, 0.0], [0.05, -0.007], [0.032, -0.008]]] });
  p.box(0.005, 0.014, 0.005, 0, -0.002, 0.036, 'steel', { rx: -0.2 });
  p.box(0.004, 0.012, 0.016, -0.017, 0.016, -0.02, 'steel'); // selector
  // retractable stock: two rods and the butt
  p.tube(0.0055, 0.0055, -0.27, -0.1, 0.06, 'steel', { x: 0.013 });
  p.tube(0.0055, 0.0055, -0.27, -0.1, 0.06, 'steel', { x: -0.013 });
  p.profile([[-0.265, 0.082], [-0.25, 0.082], [-0.25, -0.02], [-0.265, -0.03], [-0.285, -0.028], [-0.285, 0.078]], 0.04, 'polymer', { bevel: 0.004 });
  return {
    grips: [
      { y: -0.045, z: -0.022, rake: 0.22, a: 0.024, b: 0.0155, trigger: [-0.002, 0.036] },
      { support: true, y: 0.036, z: 0.235, a: 0.026, b: 0.025 }
    ],
    muzzle: [0, 0.046, 0.371]
  };
}

// Kalashnikov AK-47 (the cuerno de chivo, for its curved magazine): 880 mm, walnut stock and handguards
function rifle(p) {
  // receiver, the dust cover rounded over it, and the rear sight block
  p.profile([[-0.14, 0.02], [0.17, 0.02], [0.17, 0.066], [-0.14, 0.066]], 0.032, 'blued', { bevel: 0.002 });
  p.profile([[-0.14, 0.064], [0.13, 0.064], [0.135, 0.076], [0.12, 0.084], [-0.13, 0.084], [-0.14, 0.074]], 0.03, 'blued', { bevel: 0.004 });
  p.box(0.03, 0.022, 0.05, 0, 0.078, 0.165, 'blued');
  p.box(0.018, 0.006, 0.05, 0, 0.09, 0.165, 'blued', { rx: 0.06 });
  p.box(0.003, 0.012, 0.11, -0.0172, 0.06, 0.04, 'steel', { rx: 0.16 }); // the long safety lever (the right)
  p.box(0.012, 0.012, 0.03, -0.019, 0.07, 0.11, 'steel'); // charging handle
  // barrel, gas tube, gas block, front sight, slant brake
  p.tube(0.0095, 0.0095, 0.17, 0.6, 0.044, 'blued');
  p.tube(0.0105, 0.0105, 0.19, 0.44, 0.079, 'blued');
  p.box(0.022, 0.05, 0.03, 0, 0.062, 0.445, 'blued');
  p.box(0.018, 0.032, 0.022, 0, 0.068, 0.55, 'blued');
  p.box(0.004, 0.022, 0.004, 0, 0.094, 0.55, 'blued');
  p.tube(0.012, 0.0125, 0.6, 0.645, 0.044, 'blued');
  p.tube(0.006, 0.006, 0.644, 0.647, 0.044, 'bore');
  // walnut: the lower handguard (wider, with finger grooves), the upper over the gas tube, the stock
  p.profile([[0.18, 0.056], [0.41, 0.056], [0.42, 0.04], [0.4, 0.016], [0.19, 0.016], [0.178, 0.034]], 0.046, 'walnut', { bevel: 0.006 });
  p.profile([[0.2, 0.072], [0.4, 0.072], [0.404, 0.084], [0.39, 0.094], [0.21, 0.094], [0.2, 0.086]], 0.034, 'walnut', { bevel: 0.004 });
  p.profile([[-0.135, 0.07], [-0.135, 0.024], [-0.2, -0.004], [-0.47, -0.074], [-0.488, -0.072], [-0.49, 0.03], [-0.47, 0.042], [-0.3, 0.054]], 0.042, 'walnut', { bevel: 0.006 });
  p.profile([[-0.488, -0.075], [-0.481, -0.075], [-0.48, 0.042], [-0.488, 0.032]], 0.046, 'blued', { bevel: 0.001 }); // butt plate
  // magazine (orange bakelite) and its catch, trigger guard, trigger, pistol grip
  p.profile([[0.064, 0.022], [0.068, -0.03], [0.08, -0.09], [0.1, -0.145], [0.13, -0.2], [0.098, -0.218], [0.07, -0.168], [0.05, -0.112], [0.037, -0.055], [0.028, 0.022]], 0.026, 'bakelite', { bevel: 0.002 });
  p.box(0.012, 0.018, 0.012, 0, 0.012, 0.018, 'blued');
  p.profile([[-0.04, 0.022], [0.028, 0.022], [0.026, -0.008], [-0.03, -0.008]], 0.012, 'blued',
    { holes: [[[-0.026, 0.016], [0.022, 0.016], [0.02, 0.0], [-0.022, -0.002]]] });
  p.box(0.005, 0.016, 0.005, 0, 0.012, -0.004, 'steel', { rx: -0.25 });
  p.profile([[-0.03, 0.022], [-0.06, -0.075], [-0.094, -0.082], [-0.07, 0.022]], 0.03, 'walnut', { bevel: 0.004 });
  return {
    grips: [
      { y: -0.03, z: -0.06, rake: 0.32, a: 0.022, b: 0.015, trigger: [0.012, -0.004] },
      { support: true, y: 0.036, z: 0.3, a: 0.022, b: 0.024 }
    ],
    muzzle: [0, 0.044, 0.647]
  };
}

// RPG-7 with a PG-7V round: the 40 mm tube, its wooden heat shield, the venturi flaring out behind, two grips
function bazooka(p) {
  const Y = 0.11; // the tube's axis over the grip (it rides the shoulder)
  p.tube(0.021, 0.021, -0.52, 0.44, Y, 'olive');
  p.tube(0.024, 0.024, -0.4, -0.34, Y, 'olive'); // rings
  p.tube(0.024, 0.024, 0.38, 0.44, Y, 'olive');
  p.tube(0.034, 0.034, -0.12, 0.13, Y, 'walnut'); // heat shield
  p.tube(0.021, 0.05, -0.52, -0.66, Y, 'olive', { open: true }); // venturi, flaring back
  p.tube(0.0485, 0.0485, -0.67, -0.65, Y, 'olive', { open: true });
  // the round: tail, the warhead's body, its cone and fuze tip
  p.tube(0.016, 0.036, 0.44, 0.49, Y, 'warhead');
  p.tube(0.0425, 0.0425, 0.49, 0.6, Y, 'warhead');
  p.tube(0.0425, 0.015, 0.6, 0.74, Y, 'warhead');
  p.tube(0.01, 0.007, 0.74, 0.77, Y, 'steel');
  // sights and the optic on the left
  p.box(0.004, 0.03, 0.006, 0, Y + 0.035, 0.36, 'blued');
  p.box(0.012, 0.026, 0.008, 0, Y + 0.033, 0.06, 'blued');
  p.box(0.02, 0.04, 0.13, 0.04, Y + 0.02, 0.0, 'polymer', { rx: 0 });
  p.tube(0.012, 0.012, -0.08, -0.06, Y + 0.02, 'polymer', { x: 0.04 });
  // rear pistol grip with its trigger guard, the front grip
  p.profile([[-0.03, Y - 0.02], [0.04, Y - 0.02], [0.042, 0.02], [0.012, -0.004], [-0.03, 0.04]], 0.026, 'blued', { bevel: 0.002 });
  p.profile([[0.014, 0.022], [-0.016, -0.075], [-0.05, -0.078], [-0.03, 0.022]], 0.03, 'walnut', { bevel: 0.004 });
  p.profile([[0.012, 0.03], [0.07, 0.03], [0.066, 0.008], [0.03, 0.002]], 0.012, 'blued',
    { holes: [[[0.022, 0.024], [0.06, 0.024], [0.056, 0.014], [0.032, 0.01]]] });
  p.box(0.005, 0.016, 0.005, 0, 0.02, 0.034, 'steel', { rx: -0.2 });
  p.profile([[0.15, Y - 0.02], [0.2, Y - 0.02], [0.2, 0.05], [0.15, 0.05]], 0.022, 'olive');
  p.profile([[0.196, 0.056], [0.17, -0.04], [0.138, -0.044], [0.158, 0.056]], 0.03, 'walnut', { bevel: 0.004 });
  return {
    grips: [
      { y: -0.028, z: -0.018, rake: 0.3, a: 0.023, b: 0.0155, trigger: [0.02, 0.034] },
      { y: 0.006, z: 0.166, rake: 0.25, a: 0.022, b: 0.0155, left: true }
    ],
    muzzle: [0, Y, 0.44]
  };
}

const GUNS = { pistol, smg, rifle, bazooka };

// =====================================================================================================================
// Hands
// =====================================================================================================================

// [height up the grip, radius, phalanx lengths] for the index (top) to the little finger
const FINGERS = [
  [0.034, 0.0092, [0.046, 0.027, 0.021]],
  [0.012, 0.0095, [0.05, 0.031, 0.023]],
  [-0.01, 0.009, [0.047, 0.029, 0.022]],
  [-0.03, 0.008, [0.038, 0.023, 0.019]]
];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

// A right hand closed round a grip whose axis is +y, its front +z, of half depth a (z) and half width b (x): the back
// of the hand on its right (-x), the fingers round the front to the left, the thumb over the top along the left.
// `trigger` [y, z] puts the index finger on a trigger instead; `fist` closes it on nothing, the thumb across the front.
// Returns the wrist's point.
function hand(p, { a, b, trigger = null, fist = false }) {
  // a point round the grip: angle 0 on the right, pi/2 in front, pi on the left, `out` m off its surface
  const round = (out, phi, y, v) => v.set(-(b + out) * Math.cos(phi), y, (a + out) * Math.sin(phi));
  p.blob(0.017, 0.05, 0.038, -b - 0.011, 0.002, -a * 0.5 - 0.004, 'skin'); // palm & back of the hand
  p.blob(0.021, 0.036, 0.018, -b * 0.4 - 0.004, -0.012, -a - 0.009, 'skin'); // heel of the palm
  p.blob(0.017, 0.024, 0.02, -b * 0.3, 0.03, -a - 0.006, 'skin'); // ball of the thumb
  FINGERS.forEach(([y, r, [l1, l2, l3]], i) => {
    if (i === 0 && trigger) {
      // the trigger finger: along the frame, its tip curled onto the trigger
      const [ty, tz] = trigger;
      round(r * 1.5, -0.25, y + 0.006, _a);
      _b.set(-b - r * 0.4, ty + 0.004, tz - l2 * 0.9);
      _c.set(-b * 0.3, ty + 0.002, tz - 0.004);
      _d.set(0, ty - 0.008, tz + 0.004);
      p.rod(_a, _b, r, 'skin').rod(_b, _c, r * 0.95, 'skin').rod(_c, _d, r * 0.9, 'skin');
      return;
    }
    // each phalanx wraps a little further round (radians: its length over the grip's radius); a closed fist stops
    // with the tips in against the palm
    const L = l1 + l2 + l3;
    const span = Math.min(fist ? 4.4 : 3.6, L / ((a + b) / 2 + r));
    round(r * 1.7, -0.2, y, _a);
    round(r * 1.05, -0.2 + span * (l1 / L), y - 0.001, _b);
    round(r * 1.0, -0.2 + span * ((l1 + l2) / L), y - 0.003, _c);
    round(r * 1.0, -0.2 + span, y - 0.005, _d);
    p.rod(_a, _b, r, 'skin').rod(_b, _c, r * 0.94, 'skin').rod(_c, _d, r * 0.88, 'skin');
    p.blob(r * 1.15, r * 1.05, r * 1.15, _a.x, _a.y, _a.z, 'skin'); // knuckle
  });
  // the thumb
  if (fist) {
    _a.set(-b - 0.004, 0.034, -a - 0.002);
    _b.set(-b * 0.2, 0.03, a + 0.012);
    _c.set(b + 0.008, 0.022, a + 0.018);
    _d.set(b + 0.016, 0.016, a + 0.006);
  } else {
    _a.set(-b * 0.4, 0.034, -a - 0.002);
    _b.set(b * 0.4 + 0.004, 0.05, -a * 0.6);
    _c.set(b + 0.008, 0.054, -a * 0.02);
    _d.set(b + 0.009, 0.056, a * 0.5);
  }
  p.rod(_a, _b, 0.0115, 'skin').rod(_b, _c, 0.0105, 'skin').rod(_c, _d, 0.0098, 'skin');
  // the wrist, behind and below the palm
  p.blob(0.024, 0.026, 0.024, -b * 0.5 - 0.006, -0.004, -a - 0.03, 'skin');
  return new THREE.Vector3(-b * 0.5 - 0.006, -0.004, -a - 0.034);
}

// The forearm from the wrist out along `dir` (into the sleeve), `len` m of it
function forearm(p, wrist, dir, len = 0.42) {
  const d = dir.clone().normalize();
  const elbow = d.clone().multiplyScalar(len).add(wrist);
  const cuff = d.clone().multiplyScalar(0.11).add(wrist);
  p.rod(wrist, elbow, 0.025, 'skin');
  const sleeve = new THREE.CylinderGeometry(0.038, 0.042, Math.max(0.02, len - 0.11), 14, 1, false);
  _q.setFromUnitVectors(UP, d);
  _m.compose(cuff.clone().add(elbow).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  p.add(sleeve, 'sleeve', _m);
}

// A matrix placing a hand built round a +y grip onto the gun: on a raked grip at (0, y, z), or along the barrel under a
// handguard at (0, y, z) (the left hand, from below, its fingers up the right side)
function gripMatrix(g) {
  const m = new THREE.Matrix4();
  if (g.support) {
    // hand frame x (the thumb's side) -> up, y (the grip's axis) -> along the barrel, z (round the front) -> right
    m.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
  } else {
    m.makeRotationX(g.rake || 0); // (the top of a raked grip leans forward: a turn about x takes +y towards +z)
    if (g.left) m.premultiply(_m.makeScale(-1, 1, 1));
  }
  m.setPosition(0, g.y, g.z);
  return m;
}

// =====================================================================================================================
// What the rest of the game builds
// =====================================================================================================================

const WEAPON_MODELS = ['pistol', 'smg', 'rifle', 'bazooka'];

// The gun alone (null for the fists), with its muzzle in userData
function buildWeaponGeometry(id) {
  const make = GUNS[id];
  if (!make) return null;
  const p = new Parts();
  const info = make(p);
  const g = p.build();
  // (the middle of the grip at the origin, where the hand holds it)
  const c = info.grips[0];
  g.translate(0, -c.y, -c.z);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.muzzle = [info.muzzle[0], info.muzzle[1] - c.y, info.muzzle[2] - c.z];
  return g;
}

// The gun in the player's hands, as the wheel and the HUD show it, or the fist for the fists. `arms` adds the forearms
// in their sleeves (left out of userData.bounds, so a picture frames the gun and the hands)
function buildHeldGeometry(id, { arms = true } = {}) {
  const p = new Parts();
  const wrists = [];
  let centre = null;
  if (id === 'fists') {
    const from = p.list.length;
    const wrist = hand(p, { a: 0.008, b: 0.008, fist: true });
    const m = new THREE.Matrix4().makeRotationX(0.12);
    p.transform(from, m);
    wrists.push([wrist.applyMatrix4(m), new THREE.Vector3(-0.08, -0.12, -1), 0.42]);
  } else {
    const info = GUNS[id](p);
    centre = info.grips[0];
    for (const g of info.grips) {
      const from = p.list.length;
      const m = gripMatrix(g);
      // (the trigger, given on the gun, in the hand's frame)
      const trigger = g.trigger ? _a.set(0, g.trigger[0], g.trigger[1]).applyMatrix4(_m.copy(m).invert()) : null;
      const wrist = hand(p, { a: g.a, b: g.b, trigger: trigger && [trigger.y, trigger.z] }).applyMatrix4(m);
      p.transform(from, m);
      // the right forearm back and down from a long gun's grip (the elbow out to the side), straight back from a
      // pistol held out; the left under a handguard back towards the body
      const dir = g.support ? new THREE.Vector3(0.45, -0.55, -0.7)
        : g.left ? new THREE.Vector3(0.35, -0.6, -0.72)
          : id === 'pistol' ? new THREE.Vector3(-0.08, -0.16, -1) : new THREE.Vector3(-0.3, -0.62, -0.72);
      // (the support hand's arm, going off behind the gun, only as far as its cuff)
      wrists.push([wrist, dir, g.support || g.left ? 0.15 : 0.42]);
    }
  }
  // (the bounds before the arms go on)
  const bounds = new THREE.Box3();
  for (const g of p.list) {
    g.computeBoundingBox();
    bounds.union(g.boundingBox);
  }
  if (arms) for (const [w, dir, len] of wrists) forearm(p, w, dir, len);
  const g = p.build();
  if (centre) {
    g.translate(0, -centre.y, -centre.z);
    bounds.translate(_a.set(0, -centre.y, -centre.z));
  }
  g.userData.bounds = bounds;
  return g;
}

// One material for every gun: the finish comes with each vertex
function createWeaponMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('pbr', 'vec2');
  m.metalnessNode = pbr.x;
  m.roughnessNode = pbr.y;
  return m;
}

export { WEAPON_MODELS, buildWeaponGeometry, buildHeldGeometry, createWeaponMaterial };
