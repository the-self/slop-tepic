# tools/models/blender/nissan-march.py
# The Nissan March (K13, as Mexico sold it from its 2014 facelift on), modelled by script (carlib.py): a short, tall,
# bubbly five-door hatch lofted through rounded sections, its nose rounded in plan and in profile, the short domed
# hood, the long raked windshield, the high arched roof with the spoiler over the hatch's rear window, the near-upright
# tail; the black-framed side glass, the rear doors' fixed quarter lights behind their division bars, the wide body-
# coloured C pillars; laid onto that skin: the big swept-back head lamps up the fenders' corners (wrapped on by rays
# from inside the car), the facelift's grille with its chrome V and badge, the wide lower intake and the fog lamps'
# pockets, the tall tail lamps round the rear corners, the hatch's shut line, handle and badge; body-coloured mirrors,
# black handles, 14" steel wheels under hubcaps. Real sizes (Nissan Mexicana's data, the game's table): 3.83 m long,
# 1.665 m wide (no mirrors), 1.51 m high, a 2.450 m wheelbase, a 1.47 m track, 165/70 R14 tyres (0.587 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-march.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from mathutils import Vector  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 1.915, -1.915
W = 0.8325  # half the body's width
NOSE_DEEP, TAIL_DEEP = 0.48, 0.42  # (how far back the nose's and the tail's corners round off in plan)
AXLES = (1.14, -1.31)  # (a 0.775 m front overhang, a 0.605 m rear one)
TYRE_R, TYRE_W, RIM = 0.293, 0.165, 0.172
TRACK = 1.47
ARCH = 0.345  # (the wheel arches' radius, round the axle)
SHELF = 0.085  # (how far the glass's sill sits in from the shoulder: m)
CROWN = 0.055  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.585  # (the roof's half-width between its rails)
COWL = 1.24  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, REAR_GLASS, REAR_END = 0.15, -1.578, -1.75  # (the windshield's top; the rear window from under the spoiler
# down to the hatch's panel)
B_POST, D_POST = (-0.20, -0.12), (-1.015, -0.995)  # (the B pillar; the rear doors' division bars before the quarter lights)
SHOULDER = 0.80  # (the widest point's height)


_TANGENTS = {}


def lerp(points, y):
    """The profile [(y, v)...] (y falling) at y: a monotone cubic through its points (Fritsch-Carlson), not a polyline,
    whose kinks the clear coat showed as ripples across the hood"""
    key = id(points)
    if key not in _TANGENTS:
        d = [(v1 - v0) / (y1 - y0) for (y0, v0), (y1, v1) in zip(points, points[1:])]
        m = [d[0]] + [0.0 if a * b <= 0 else (a + b) / 2 for a, b in zip(d, d[1:])] + [d[-1]]
        for k, dk in enumerate(d):
            if dk == 0:
                m[k] = m[k + 1] = 0.0
                continue
            a, b = m[k] / dk, m[k + 1] / dk
            if a * a + b * b > 9:
                t = 3 / math.sqrt(a * a + b * b)
                m[k], m[k + 1] = t * a * dk, t * b * dk
        _TANGENTS[key] = m
    m = _TANGENTS[key]
    for k, ((y0, v0), (y1, v1)) in enumerate(zip(points, points[1:])):
        if y1 <= y <= y0:
            h = y1 - y0
            t = (y - y0) / h
            return ((2 * t ** 3 - 3 * t ** 2 + 1) * v0 + (t ** 3 - 2 * t ** 2 + t) * h * m[k]
                    + (-2 * t ** 3 + 3 * t ** 2) * v1 + (t ** 3 - t ** 2) * h * m[k + 1])
    return points[0][1] if y > points[0][0] else points[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def smooth(t):
    t = clamp(t, 0, 1)
    return t * t * (3 - 2 * t)


# the centreline's top: the bumper's nose, rounding up into the hood's front slope, the short hood, the long
# windshield, the arched roof, the spoiler's lip, the rear window, the hatch's panel and the rear bumper's top
TOP = [(NOSE, 0.62), (1.912, 0.67), (1.905, 0.715), (1.89, 0.76), (1.87, 0.795), (1.84, 0.825), (1.80, 0.85),
       (1.72, 0.88), (1.60, 0.912), (1.45, 0.95), (COWL, 0.99),
       (1.05, 1.085), (0.85, 1.178), (0.65, 1.268), (0.45, 1.35), (0.30, 1.41), (HEADER, 1.455), (0.05, 1.478),
       (-0.10, 1.497), (-0.30, 1.512), (-0.60, 1.513), (-0.80, 1.51), (-1.10, 1.50), (-1.35, 1.485), (-1.48, 1.47), (-1.54, 1.455), (-1.565, 1.44),
       (-1.575, 1.415), (REAR_GLASS, 1.40), (-1.63, 1.29), (-1.69, 1.17), (REAR_END, 1.045), (-1.79, 0.95),
       (-1.82, 0.85), (-1.84, 0.75), (-1.855, 0.69), (-1.87, 0.672), (-1.885, 0.662), (-1.90, 0.652), (-1.91, 0.64),
       (TAIL, 0.625)]
BOTTOM = [(NOSE, 0.36), (1.912, 0.335), (1.905, 0.315), (1.89, 0.29), (1.87, 0.265), (1.84, 0.245), (1.80, 0.228),
          (1.6, 0.20), (1.0, 0.17), (-1.5, 0.17), (-1.70, 0.20), (-1.80, 0.235), (-1.85, 0.26), (-1.88, 0.285),
          (-1.90, 0.31), (-1.91, 0.335), (TAIL, 0.36)]
# the side's beltline: along the hood under its middle (the fenders' crests rise over it: fender_rise), the glass's
# sill rising to the tail, round the tail's corners under the rear window
BELT = [(NOSE, 0.60), (1.90, 0.705), (1.87, 0.775), (1.83, 0.825), (1.79, 0.85), (1.70, 0.87), (1.50, 0.90),
        (1.40, 0.918), (COWL, 0.94), (0.90, 0.948), (0.60, 0.95), (0.0, 0.952), (-0.60, 0.97), (-1.00, 0.99), (-1.30, 1.01),
        (-1.55, 1.025), (-1.70, 1.03), (TAIL, 0.95)]


def fender_rise(y):
    """How far the fenders' crests stand over the hood along it (m): nothing at the cowl, most over the head lamps,
    whose brows from ahead stand at the hood's corners, then down round the nose"""
    return 0.028 * smooth((y - COWL) / 0.55) * (1 - smooth((y - 1.80) / 0.08))


def roof_half(y):
    """The roof's half-width between its rails: the greenhouse narrows toward the tail in plan"""
    return 0.585 - 0.10 * smooth((-0.5 - y) / 1.1)


def shelf(y):
    """How far the glass's sill sits in from the shoulder (m): more over the rear wheels, the haunches"""
    return SHELF + 0.03 * smooth((-0.7 - y) / 0.6)


def half_width(y):
    """The body's half-width in plan at y: the nose and the tail rounded (superellipses: broad across, soft corners)"""
    if y > NOSE - NOSE_DEEP:
        t = min(0.995, (y - (NOSE - NOSE_DEEP)) / NOSE_DEEP)
        return W * (1 - t ** 3.0) ** (1 / 3.0)
    if y < TAIL + TAIL_DEEP:
        t = min(0.995, ((TAIL + TAIL_DEEP) - y) / TAIL_DEEP)
        return W * (1 - t ** 3.2) ** (1 / 3.2)
    return W


def low_half(y):
    """The bumpers' lower half-width in plan at y: rounder at the nose than the lamps' level (a broader superellipse,
    reaching further back), the bumper's lower corners rounding back into the wheel arches"""
    if y > NOSE - 0.62:
        t = min(0.995, (y - (NOSE - 0.62)) / 0.62)
        return W * (1 - t ** 2.6) ** (1 / 2.6)
    return W


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005) + (fender_rise(y) if y > COWL else 0.0)
    # (round the nose and the tail the sides' tucks and the glass's shelf fade out: there the sides are the bumpers'
    # faces)
    k = 1 - 0.85 * max(clamp((y - (NOSE - 0.45)) / 0.35, 0, 1), clamp(((TAIL + 0.35) - y) / 0.3, 0, 1))
    tip = smooth(min(NOSE - 0.015 - y, y - TAIL - 0.015) / 0.08)  # (0 at the bumpers' very ends, where the caps are)
    bw = w - shelf(y) * (0.15 + 0.85 * k) - 0.07 * (1 - k) * tip  # (round the nose and the tail the top's corners
    # round off broadly, the lamps wrapping round them; not on the caps, which it folded)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    z3 = bot + min(0.15, 0.30 * h)
    shoulder = clamp(SHOULDER, z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.6
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(roof_half(y), bw)) * clamp((edge - belt) / 0.45, 0, 1)
    # the windows' top: just under the roof's edge over the doors, then down behind the division bar to the sill (the
    # quarter light closing in a point under the C pillar)
    run = math.hypot(rw - bw, edge - belt)
    band = 0.02 + run * clamp((D_POST[0] - 0.03 - y) / 0.32, 0, 1)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    if belt > top:
        # the hood sunk between the fenders' crests: their inner slope down to it, the hood crowned in its middle
        dip, f = belt - top, min(1.0, (belt - top) / 0.03)
        upper = [(bw, belt), (bw - 0.05, belt - 0.5 * dip), (bw - 0.05 - 0.14 * f, top - 0.006 * f),
                 (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
    # (two more points across the top between the roof's rail and its middle: the rear window's corners are rounded
    # on them, below)
    (ax_, az_), (bx_, bz_) = upper[2], upper[3]
    upper = upper[:3] + [(ax_ + (bx_ - ax_) * f, az_ + (bz_ - az_) * f) for f in (0.33, 0.66)] + upper[3:]
    wl = min(w, low_half(y))
    return [(0, bot), (max(0.01, wl - 0.12 * (0.5 + 0.5 * k)), bot), (wl - 0.05 * k, z2), (0.75 * w + 0.25 * wl - 0.012 * k, z3), (w, shoulder),
            (w - 0.03 * k, z5), (bw, belt), *upper, (0, top)]


def glass_rise(y):
    s = section(y)
    return s[7][1] - s[6][1]


def where(f, lo, hi):
    """The y between lo and hi where f turns false (true at lo)"""
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


A_TIP = where(lambda y: glass_rise(y) > 0.08, 0.3, COWL)  # (the A pillar's foot)
QUARTER_END = where(lambda y: glass_rise(y) > 0.10, -0.9, -1.6)  # (the quarter light's point, under the C pillar)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the roof's rail,
    # 9-10 the top (bumper, hood, windshield, roof, rear window, hatch)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'paint' if y > NOSE - 0.10 or y < TAIL + 0.10 else 'under'
    if seg == 6:
        if B_POST[0] < y < B_POST[1] or D_POST[0] < y < D_POST[1]:
            return 'trim'
        if B_POST[1] < y < A_TIP:
            return f'glass:front{side}'
        if D_POST[1] < y < B_POST[0]:
            return f'glass:rear{side}'
        if QUARTER_END < y < D_POST[0]:
            return f'glass:quarter{side}'
    if seg == 7:
        return 'paint'  # (the doors' frames body-coloured; only the B pillar and the division bars black)
    if seg >= 9:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END < y < REAR_GLASS:
            return 'glass:back'
    return 'paint'


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, REAR_GLASS, REAR_END, A_TIP, *B_POST, *D_POST, QUARTER_END,
         1.912, 1.905, 1.89, 1.87, -1.565, -1.575, -1.87, -1.885, -1.90, -1.91]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.06 else 0.02 if arch else 0.025 if (y > NOSE - NOSE_DEEP - 0.05 or y < TAIL + TAIL_DEEP + 0.05) else 0.065
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.004 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008,
                frame={None: 0.018, 'windshield': 0.028, 'back': 0.03})

# the rear window's top corners rounded: the pane's edge and its frame's outer edge, square in the loft's sections,
# drawn round a curve in each corner (seen from behind: a quadratic Bezier from the top edge to the side edge, the
# corner its control point), each point kept in the window's sloping plane
def round_corners(ob, r):
    me = ob.data
    names = [m.name for m in me.materials]
    near = lambda f: REAR_END - 0.05 < f.center.y < REAR_GLASS + 0.05 and f.center.z > 0.95
    sets = {'glass': set(), 'trim': set(), 'paint': set()}
    for f in me.polygons:
        if near(f) and names[f.material_index] in sets:
            sets[names[f.material_index]].update(f.vertices)
    for loop, radius in ((sets['glass'] & sets['trim'], r - 0.02), (sets['trim'] & sets['paint'], r)):
        for sg in (1, -1):
            vs = [me.vertices[i] for i in loop if me.vertices[i].co.x * sg > 0.05]
            if len(vs) < 4:
                continue
            P = lambda v: Vector((v.co.x * sg, v.co.z))
            c = max(vs, key=lambda v: 0.7 * P(v).x + P(v).y)
            top = max(vs, key=lambda v: P(v).y - 0.5 * P(v).x)
            foot = max(vs, key=lambda v: P(v).x - P(v).y)
            C = P(c)
            e1, e2 = (P(top) - C).normalized(), (P(foot) - C).normalized()
            slope = (foot.co.y - c.co.y) / (foot.co.z - c.co.z)  # (the window's lean: y per z)
            det = e1.x * e2.y - e1.y * e2.x
            A, B = C + e1 * radius, C + e2 * radius
            moves = []
            for v in vs:
                d = P(v) - C
                u, w = (d.x * e2.y - d.y * e2.x) / det, (e1.x * d.y - e1.y * d.x) / det  # (skew coordinates)
                if u < radius and w < radius and (abs(w) < 0.012 or abs(u) < 0.012):
                    t = 0.5 * (1 - u / radius) if abs(w) < 0.012 else 0.5 + 0.5 * w / radius
                    q = A * (1 - t) ** 2 + C * (2 * t * (1 - t)) + B * t ** 2
                    moves.append((v, q))
            for v, q in moves:
                dz = q.y - v.co.z
                v.co.x, v.co.z = q.x * sg, q.y
                v.co.y += slope * dz
    me.update()


round_corners(body, 0.11)

# the end caps domed a little forward (a flat cap shaded as a patch on the bumpers' middles)
rim = set()  # (the caps' outer rings, shared with the sides: they stay)
for e in body.data.edges:
    a, b = (body.data.vertices[i] for i in e.vertices)
    for end in (NOSE, TAIL):
        if (abs(a.co.y - end) < 1e-6) != (abs(b.co.y - end) < 1e-6):
            rim.add(a.index if abs(a.co.y - end) < 1e-6 else b.index)
for v in body.data.vertices:
    for end, sign in ((NOSE, 1), (TAIL, -1)):
        if abs(v.co.y - end) < 1e-6 and v.index not in rim:
            cap = [u.co for u in body.data.vertices if abs(u.co.y - end) < 1e-6]
            hx = max(abs(c.x) for c in cap)
            z0, z1 = min(c.z for c in cap), max(c.z for c in cap)
            fx = 1 - (v.co.x / hx) ** 2
            fz = 1 - ((v.co.z - (z0 + z1) / 2) / ((z1 - z0) / 2)) ** 2
            v.co.y += sign * 0.006 * max(0.0, fx) * max(0.0, fz)
body.data.update()
# (the caps' middles, n-gons, cut in triangles by ear clipping: drawn as they came, a concave one folded a triangle
# inside out, a dark speck on the bumper)
bm = car.bmesh.new()
bm.from_mesh(body.data)
# (the caps inset in rings, so their smoothing turns within them; the nose's profile rounds into its cap top and
# bottom, so the cap meets the sections without a crease: left whole, it shaded as a snout, and with a sharp edge as a
# patch under the grille)
for f in [f for f in bm.faces if len(f.verts) > 4 and (all(abs(v.co.y - TAIL) < 1e-6 for v in f.verts) or all(abs(v.co.y - NOSE) < 1e-6 for v in f.verts))]:
    done = 0.0
    for d in (0.01, 0.025, 0.045):
        f = car.bmesh.ops.inset_region(bm, faces=[f], thickness=d - done, depth=0, use_even_offset=True)['faces'] and f
        done = d
car.bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method='BEAUTY', ngon_method='EAR_CLIP')
# (then the caps and the last few millimetres of the sections smoothed along y only: the flat cap bends back into the
# sections round its edge, a gentle dome, where it met them at a fold that shaded as a patch on the bumper)
for end in (NOSE, TAIL):
    near_end = [v for v in bm.verts if abs(v.co.y - end) < 0.016]
    car.bmesh.ops.smooth_vert(bm, verts=near_end, factor=0.5, use_axis_x=False, use_axis_y=True, use_axis_z=False)
    for _ in range(11):
        car.bmesh.ops.smooth_vert(bm, verts=near_end, factor=0.5, use_axis_x=False, use_axis_y=True, use_axis_z=False)
bm.to_mesh(body.data)
bm.free()

# ---- the wheel arches: round, cut out of the sides (their wells dark)
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + 0.01 + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.50, s * 1.3, 'under'))
car.cut(body, *wells)
car.tidy(body, 75, weighted=False)


def side_x(y, z):
    """The body's side's x (right) at y and height z, from its section (between the sill's foot and the glass's sill)"""
    pts = section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


def front(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='-Y')


def rear(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='Y')


AHEAD, BEHIND = NOSE + 0.4, TAIL - 0.4


def fill(name, outline, role, n=64, rings=4):
    """A filled shape (star-shaped round its middle) in the plane y = 0 from its outline [(u, z)...], in rings of quads
    from its middle out (a fan's long triangles bent badly wrapped onto a curve): laid on by wrap()"""
    # (the outline resampled to n points evenly along it)
    pts = outline + [outline[0]]
    lens = [0.0]
    for (a, b), (c, d) in zip(pts, pts[1:]):
        lens.append(lens[-1] + math.hypot(c - a, d - b))
    ring = []
    for i in range(n):
        s = lens[-1] * i / n
        j = max(k for k in range(len(lens) - 1) if lens[k] <= s)
        f = (s - lens[j]) / max(1e-9, lens[j + 1] - lens[j])
        ring.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f))
    cu = sum(p[0] for p in ring) / n
    cz = sum(p[1] for p in ring) / n
    bm = car.bmesh.new()
    mid = bm.verts.new((cu, 0, cz))
    loops = [[bm.verts.new((cu + (u - cu) * (j + 1) / rings, 0, cz + (z - cz) * (j + 1) / rings)) for u, z in ring]
             for j in range(rings)]
    for i in range(n):
        bm.faces.new((mid, loops[0][i], loops[0][(i + 1) % n]))
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
    return car.to_object(name, bm, [role])


def facing(bm, axis):
    """Every face of the open surface turned toward `axis`"""
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(Vector(axis)) < 0:
            f.normal_flip()


def wrap(ob, centre, facing, offset=0.003, R=0.5):
    """`ob` drawn in the plane y = 0 in (u, z), wrapped onto the body round a vertical axis through `centre` (x, y): u
    the arc (m) on a cylinder R m round it (about the arc on the skin, when R is the corner's radius), u = 0 straight
    ahead (`facing` 1) or behind (-1), u > 0 round to the right. For a lamp that wraps round the car's corner, where a
    ray along y would graze the side: each point where a level ray in from its angle toward the axis meets the skin,
    `offset` m out, its height kept"""
    cx, cy = centre
    for v in ob.data.vertices:
        a = v.co.x / R
        d = Vector((math.sin(a), facing * math.cos(a), 0))
        t = Vector((cx, cy, v.co.z)) + d * (R + 1.0)
        hit, loc, nrm, _ = body.ray_cast(t, -d, distance=R + 1.0)
        if not hit:
            print('wrap: missed at', tuple(round(c, 3) for c in t))
            v.co = t
            continue
        if nrm.dot(d) < 0:
            nrm = -nrm
        v.co = loc + nrm * offset
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.update()
    for p in ob.data.polygons:  # (each face turned out, away from the axis)
        c = p.center
        if p.normal.dot(Vector((c.x - cx, c.y - cy, 0))) < 0:
            p.flip()
    ob.data.update()
    # (the skin's own smooth normals under it: a long thin lamp's faces bent round a corner shaded in shards)
    mod = ob.modifiers.new('normals', 'DATA_TRANSFER')
    mod.object = body
    mod.use_loop_data = True
    mod.data_types_loops = {'CUSTOM_NORMAL'}
    mod.loop_mapping = 'POLYINTERP_NEAREST'
    car.apply(ob)
    return ob


def mirror(outline):
    return [(-u, z) for u, z in reversed(outline)]


# ---- the nose: the head lamps, big almond shapes swept back and up the fenders' corners from beside the grille,
# each a clear lens over a chrome reflector, the main beam's bowl in its middle, the amber indicator at its inner end
HEAD_C, HEAD_R = (0.38, 1.42), 0.48  # (the head lamps' axis, about their corner's centre in plan: right side)
HEAD = [(-0.03, 0.805), (0.10, 0.830), (0.25, 0.856), (0.40, 0.875), (0.52, 0.882), (0.62, 0.883), (0.72, 0.882),
        (0.80, 0.875), (0.83, 0.862), (0.80, 0.84), (0.70, 0.808), (0.60, 0.775), (0.50, 0.742), (0.38, 0.712), (0.26, 0.69),
        (0.14, 0.678), (0.04, 0.685), (-0.02, 0.71), (-0.045, 0.76)]
# (inside the clear lens, in filled tones, never outlines: the dark housing filling its lower and inner part, the
# chrome reflector's bowl over it a lighter zone, the small bright projector in the bowl, the dipped beam's smaller
# bowl outboard, the amber indicator at the inner corner)
HOUSING = [(0.01, 0.712), (0.06, 0.697), (0.14, 0.69), (0.26, 0.70), (0.38, 0.72), (0.48, 0.748), (0.44, 0.765),
           (0.30, 0.762), (0.16, 0.758), (0.05, 0.762), (0.01, 0.755)]
AMBER = [(0.005, 0.722), (0.085, 0.712), (0.095, 0.762), (0.005, 0.775)]
car.material('bowl')  # (the reflectors' chrome-grey: no brighter than the lens, so the lamp reads as clear glass over
# chrome, not a white eye with a pupil)
for m_ in (car.bpy.data.materials['bowl'],):
    m_.diffuse_color = (0.50, 0.51, 0.53, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.50, 0.51, 0.53, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.85
    m_.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.32
car.material('clearlamp')  # (the lens over the reflectors: clear glass reads silver-grey, not white)
for m_ in (car.bpy.data.materials['clearlamp'],):
    m_.diffuse_color = (0.55, 0.57, 0.6, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.55, 0.57, 0.6, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.85
    m_.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.12
car.material('housing')  # (dark graphite, its own colour in the game: lighter than the trim's black)
for m_ in (car.bpy.data.materials['housing'],):
    m_.diffuse_color = (0.10, 0.10, 0.11, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.10, 0.10, 0.11, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.3
for s in (1, -1):
    c = (s * HEAD_C[0], HEAD_C[1])
    side = (lambda o: o) if s > 0 else mirror
    wrap(fill('clearlamp', side(HEAD), 'clearlamp', n=64, rings=6), c, 1, 0.006, HEAD_R)
    wrap(fill('housing', side(HOUSING), 'housing', n=48, rings=3), c, 1, 0.0075, HEAD_R)
    wrap(fill('amber', side(AMBER), 'amber', n=16, rings=2), c, 1, 0.0095, HEAD_R)

# the facelift's grille under the hood's front edge: a black mesh between the lamps, the chrome V from its top corners
# down to the middle of its lower edge (no badge: the game shows no brands)
front(car.panel('grille', [(-0.35, 0.752), (0.35, 0.752), (0.26, 0.625), (-0.26, 0.625)], AHEAD, 'pocket', 1, n=24, m=4), 0.002)
for z in (0.65, 0.675, 0.70, 0.725):
    front(car.decal('grille_bar', [(-0.30, z), (0.30, z)], 0.004, AHEAD, 'trim', 1, step=0.03), 0.0028)
front(car.decal('chrome_v', [(-0.30, 0.738), (-0.07, 0.634), (0.07, 0.634), (0.30, 0.738)], 0.016, AHEAD, 'chrome', 1), 0.0035)
# the hood's front edge over the grille and the lamps
front(car.decal('seam', [(-0.40, 0.782), (-0.30, 0.766), (0.0, 0.76), (0.30, 0.766), (0.40, 0.782)], 0.005, AHEAD, 'gloss', 1, step=0.03), 0.0015)
# the lower bumper: the wide black intake (the plate on its bar), its mesh; the fog lamps' pockets at the corners; the lip
front(car.panel('intake', [(-0.43, 0.465), (0.43, 0.465), (0.37, 0.30), (-0.37, 0.30)], AHEAD, 'pocket', 1, n=30, m=6), 0.003)
for z in (0.33, 0.37, 0.41, 0.44):
    hx = 0.37 + 0.06 * (z - 0.29) / 0.175 - 0.02  # (inside the intake's slanted ends)
    front(car.decal('intake_bar', [(-hx, z), (hx, z)], 0.005, AHEAD, 'trim', 1, step=0.03), 0.0045)
for s in (1, -1):
    fog = [(s * 0.55, 0.38), (s * 0.70, 0.41), (s * 0.68, 0.31), (s * 0.57, 0.29)]
    front(car.panel('fog', fog if s > 0 else fog[::-1], AHEAD, 'pocket', 1, n=12, m=6), 0.0035)
front(car.decal('lip', [(-0.70, 0.245), (0.70, 0.245)], 0.03, AHEAD, 'trim', 1, step=0.03))

# ---- the tail: the tall lamps round the rear corners (red, a clear reversing lamp in their lower inner part); the
# hatch's shut line up their inner edges and across over the bumper; the hatch's handle and badge; the high stop lamp
# on the spoiler; the bumper's plate recess and reflectors
TAIL_C, TAIL_LR = (0.50, -1.55), 0.40
TAILLAMP = [(0.09, 0.75), (0.30, 0.75), (0.46, 0.755), (0.50, 0.79), (0.50, 1.02), (0.46, 1.07), (0.36, 1.10),
            (0.22, 1.11), (0.12, 1.105), (0.09, 1.085)]
for s in (1, -1):
    c = (s * TAIL_C[0], TAIL_C[1])
    sh = TAILLAMP if s > 0 else mirror(TAILLAMP)
    cu = sum(u for u, _ in sh) / len(sh)
    cz = sum(z for _, z in sh) / len(sh)
    wrap(fill('lamp', sh, 'lamp', n=72, rings=5), c, -1, 0.004, TAIL_LR)
    rev = [(0.11, 0.83), (0.36, 0.83), (0.36, 0.90), (0.11, 0.90)]
    wrap(fill('reverse', rev if s > 0 else mirror(rev), 'white', n=32, rings=3), c, -1, 0.0075, TAIL_LR)
    rear(car.panel('reflector', [(s * 0.62, 0.40), (s * 0.72, 0.40), (s * 0.72, 0.425), (s * 0.62, 0.425)][::s], BEHIND, 'lamp', -1, n=6, m=2), 0.003)
gate = [(-0.575, 1.05), (-0.575, 0.66), (-0.545, 0.625), (0.545, 0.625), (0.575, 0.66), (0.575, 1.05)]
rear(car.decal('seam', gate, 0.005, BEHIND, 'gloss', -1), 0.0015)
rear(car.panel('handle', [(-0.10, 0.70), (0.10, 0.70), (0.10, 0.735), (-0.10, 0.735)], BEHIND, 'gloss', -1, n=8, m=2), 0.0025)
rear(car.panel('stoplamp', [(-0.11, 1.39), (0.11, 1.39), (0.11, 1.405), (-0.11, 1.405)], BEHIND, 'lamp', -1, n=8, m=2), 0.003)
rear(car.decal('lip', [(-0.72, 0.30), (0.72, 0.30)], 0.04, BEHIND, 'trim', -1, step=0.03))

# ---- the shut lines: the doors' edges, the hood's along the fenders' crests
seams = []


def arch_top(y):
    """The wheel well's top at y (0 where there is none)"""
    return max([TYRE_R + 0.01 + math.sqrt(max(0.0, ARCH ** 2 - (y - yc) ** 2)) for yc in AXLES if abs(y - yc) < ARCH] + [0.0])


for s in (1, -1):
    for y in (A_TIP - 0.03, (B_POST[0] + B_POST[1]) / 2, (D_POST[0] + D_POST[1]) / 2):
        pts = [(s * side_x(y, z), y, z) for z in (0.30 + k * 0.04 for k in range(20)) if arch_top(y) + 0.02 < z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = []
    for y in [1.75 - 0.05 * k for k in range(int((1.75 - COWL) / 0.05) + 1)]:
        x, z = section(y)[8]
        hood.append((s * x, y, z))
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)

# ---- the doors' black pull handles, the side repeaters behind the front arches
for s in (1, -1):
    for y in (B_POST[0] + 0.24, -0.70):
        z = lerp(BELT, y) - 0.09
        h = car.box('handle', (0, 0, 0), (0.014, 0.13, 0.028), 'trim', bevel=0.005)
        h.location = (s * (side_x(y, z) + 0.004), y, z)
    rep = car.box('amber_repeater', (0, 0, 0), (0.006, 0.04, 0.018), 'amber', bevel=0.003)
    ry = (AXLES[0] - ARCH + A_TIP - 0.03) / 2  # (between the arch and the door's front edge)
    rep.location = (s * (side_x(ry, 0.80) + 0.001), ry, 0.80)

# ---- the mirrors: body-coloured on a black foot at the front of the door's window, the glass in their back
for s in (1, -1):
    D = A_TIP + 0.02
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.03) - 0.04
    inner = [(D + 0.01, z), (D - 0.12, z), (D - 0.13, z + 0.085), (D - 0.05, z + 0.095), (D + 0.01, z + 0.05)]
    outer = [(D - 0.035, z + 0.012), (D - 0.13, z + 0.012), (D - 0.13, z + 0.078), (D - 0.07, z + 0.086), (D - 0.035, z + 0.05)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.12), 'paint')
    car.bevelled(m, 0.03, 5, angle=20)
    car.smooth(m, 70)
    g = car.box('mirror_glass', (0, 0, 0), (0.08, 0.002, 0.055), 'glass')
    g.location = (s * (W + 0.07), D - 0.1335, z + 0.047)

car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.62, 0.30)], (0, 0.5, 1), 0.018, 'trim', lift=0.01)
rear(car.decal('wiper', [(0.0, 1.08), (0.32, 1.15)], 0.016, BEHIND, 'trim', -1, step=0.03), 0.012)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.30, 0.36), (1.50, 2.30, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.62, 0.90), (1.50, 0.40, 0.16), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.36, -0.05, 0.58), (0.46, 0.50, 0.12), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.36, -0.32, 0.90), (0.44, 0.12, 0.58), 'interior', bevel=0.04, tilt=0.2)
    car.soft_box('interior_headrest', (s * 0.36, -0.38, 1.26), (0.24, 0.10, 0.16), 'interior', bevel=0.04, tilt=0.2)
car.soft_box('interior_bench', (0, -1.00, 0.60), (1.24, 0.46, 0.12), 'interior', bevel=0.04)
car.soft_box('interior_benchback', (0, -1.25, 0.86), (1.20, 0.12, 0.46), 'interior', bevel=0.04, tilt=0.2)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=32, minor_segments=8,
                                     location=(-0.36, 0.40, 0.95), rotation=(math.radians(62), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))

# ---- the wheels: narrow road tyres on steel wheels under silver plastic hubcaps, seven split spokes each over a dark
# dish (its own material, 'dish': prepare-made's 'wheel', keeping its dark colour; a part it calls 'rim' turns silver)
car.material('dish')
for m_ in (car.bpy.data.materials['dish'],):
    m_.diffuse_color = (0.025, 0.025, 0.028, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.025, 0.025, 0.028, 1)
    m_.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7


def hubcap(x, y, side, spokes=8, n=64):
    """A hubcap on the wheel at (x, y): a silver dished cover (its lip standing proud, sloping out to a domed hub) with
    `spokes` split spokes: the dark slots between them, and a narrow slit splitting each down its middle, laid on it;
    and the wheel closed on its inner face"""
    face, zc = x + side * 0.49 * TYRE_W, TYRE_R
    ax = (side, 0, 0)
    # (the cover's profile: radius, offset out from the tyre's face)
    prof = [(RIM + 0.012, -0.004), (RIM + 0.002, 0.003), (RIM - 0.014, 0.003), (RIM - 0.03, -0.003), (0.085, 0.005),
            (0.07, 0.008), (0.045, 0.0105), (0.02, 0.012)]  # (kept within the tyre's bulge: standing out of the
    # fender, prepare-made drew the wheel 2 cm in)

    def out_at(r):
        for (r0, d0), (r1, d1) in zip(prof, prof[1:]):
            if r1 <= r <= r0:
                return d0 + (d1 - d0) * (r - r0) / (r1 - r0)
        return prof[-1][1]

    def at(r, a, lift=0.0):
        return (face + side * (out_at(r) + lift), y + r * math.cos(a), zc + r * math.sin(a))

    bm = car.bmesh.new()
    rings = [[bm.verts.new(at(r, 2 * math.pi * i / n)) for i in range(n)] for r, _ in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    top = bm.verts.new((face + side * 0.0125, y, zc))
    for i in range(n):
        bm.faces.new((rings[-1][i], rings[-1][(i + 1) % n], top))
    facing(bm, ax)
    silver = car.to_object('rim_cap', bm, ['rim'])
    car.smooth(silver, 40)
    # the slots, dark, in the cover: a wide one between each two spokes, a slit splitting each spoke
    bm = car.bmesh.new()
    step = 2 * math.pi / spokes

    def patch(r0, r1, a0i, a1i, a0o, a1o, m=4, l=3):
        grid = [[bm.verts.new(at(r0 + (r1 - r0) * j / m, (a0i + (a0o - a0i) * j / m) + ((a1i + (a1o - a1i) * j / m) - (a0i + (a0o - a0i) * j / m)) * q / l, 0.0015))
                 for q in range(l + 1)] for j in range(m + 1)]
        for j in range(m):
            for q in range(l):
                bm.faces.new((grid[j][q], grid[j][q + 1], grid[j + 1][q + 1], grid[j + 1][q]))

    for kk in range(spokes):
        a = step * kk + math.pi / 2
        patch(0.095, RIM - 0.036, a + 0.20, a + step - 0.20, a + 0.13, a + step - 0.13)
        patch(0.10, RIM - 0.042, a - 0.012, a + 0.012, a - 0.03, a + 0.03, l=1)
    facing(bm, ax)
    car.to_object('wheel_slots', bm, ['dish'])
    bm = car.bmesh.new()
    back = [bm.verts.new((x - side * 0.49 * TYRE_W, y + (RIM + 0.012) * math.cos(2 * math.pi * i / n), zc + (RIM + 0.012) * math.sin(2 * math.pi * i / n))) for i in range(n)]
    bm.faces.new(back)
    facing(bm, (-side, 0, 0))
    car.to_object('wheel_back', bm, ['dish'])


for yc in AXLES:
    for s in (1, -1):
        tyre, disc, cap = car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.006, lug=0.0, petals=8)
        car.bpy.data.objects.remove(disc)
        car.bpy.data.objects.remove(cap)
        hubcap(s * TRACK / 2, yc, s)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('photo', -55, 3, 7.5, 45), ('side', 92, 2, 10), ('rear', 145, 8, 8.5), ('front', 30, 7, 8.5),
             ('face', 0, 2, 4.0, 50, (0, 1.8, 0.6)), ('lamp', -32, 4, 2.4, 50, (-0.55, 1.7, 0.72)),
             ('tail', 180, 6, 4.0, 50, (0, -1.8, 0.8)), ('quarter', 110, 8, 1.8, 50, (0.75, -1.3, 1.15)),
             ('bumper', -40, 20, 1.2, 50, (0, 1.9, 0.5)), ('wheel', 70, 5, 1.6, 50, (0.8, 1.14, 0.3))]
    pick = os.environ.get('VIEWS')
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    car.hero(renders, 'march', paint=dict(base=(0.03, 0.22, 0.30), rough=0.18, metal=0.6, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
