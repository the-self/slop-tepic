# tools/models/blender/nissan-tsuru.py
# The Nissan Tsuru (the B13 Sentra as Mexico built it to 2017), modelled by script (carlib.py): a boxy three-box sedan
# lofted through its sections, the shoulder's crease from the lamps to the tail, the lamps' and the grille's upright
# face under the hood's edge and the bumper standing out below it, the hood, the raked windshield, the flat roof, the
# rear window, the short trunk; the black-framed side glass, the rear doors' fixed quarter lights, the C pillar's
# steel; laid onto that skin: the rectangular head lamps with their corner lamps, the black grille, the bumper's ribs
# and intake, the wide tail lamps with their reversing lamps and the plate's recess between them, the side mouldings;
# body-coloured mirrors, black handles, 13" wheels under slotted hubcaps. With `--taxi`, the roof sign of the city's
# taxis. Real sizes (Nissan Mexicana): 4.325 m long, 1.650 m wide, 1.385 m high, a 2.430 m wheelbase, a 1.42 m track,
# 155/80 R13 tyres (0.58 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-tsuru.py -- <out.glb> [<render dir> [<out.blend>]] [--taxi]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
TAXI = '--taxi' in sys.argv
car.reset()

NOSE, TAIL = 2.163, -2.162
W = 0.825  # half the body's width
NOSE_R, TAIL_R = 0.42, 0.36  # (how far back the corners round off in plan: a box, but soft)
AXLES = (1.30, -1.13)  # (a 0.86 m front overhang)
TYRE_R, TYRE_W, RIM = 0.289, 0.155, 0.168
TRACK = 1.42
ARCH = 0.355  # (the wheel arches' radius, round the axle)
SHELF = 0.075  # (how far the glass's sill sits in from the shoulder: m; the shoulder rounds over to it)
CROWN = 0.05  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.56  # (the roof's half-width between its rails)
FACE, FACE_TOP = 2.085, 2.125  # (the lamps' and the grille's face, leaning back from the bumper's top to under the
# hood's rounded edge)
HEADER, ROOF_END, REAR_END = 0.03, -0.97, -1.50  # (the windshield's top; the rear window from the roof's end down
# to the trunk's deck)
B_POST, D_POST = (-0.14, -0.06), (-0.75, -0.72)  # (the B pillar; the post before the rear doors' fixed quarter lights)
SHOULDER = 0.78  # (the shoulder's crease, the widest point)


def lerp(points, y):
    """The polyline [(y, v)...] (y falling) at y"""
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y1 <= y <= y0:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return points[0][1] if y > points[0][0] else points[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def smooth(t):
    t = clamp(t, 0, 1)
    return t * t * (3 - 2 * t)


# the centreline's top: the bumper's top, the step up the lamps' face to the hood's edge, the hood, the windshield,
# the flat roof, the rear window, the trunk's deck, and down the tail's panel to the rear bumper's top
TOP = [(NOSE, 0.445), (2.161, 0.50), (2.158, 0.53), (2.145, 0.575), (FACE_TOP, 0.595), (2.105, 0.665), (FACE, 0.725), (2.06, 0.755),
       (2.0, 0.774), (1.85, 0.798), (1.50, 0.840), (1.20, 0.868),
       (0.75, 0.915), (0.50, 1.07), (0.25, 1.215), (0.10, 1.29), (HEADER, 1.322), (-0.08, 1.346), (-0.20, 1.365),
       (-0.50, 1.385), (-0.75, 1.375), (-0.88, 1.36), (ROOF_END, 1.33), (-1.05, 1.29), (-1.15, 1.225), (-1.30, 1.135),
       (-1.42, 1.055), (REAR_END, 1.0), (-1.58, 0.982), (-1.80, 0.973), (-2.00, 0.962), (-2.06, 0.955),
       (-2.085, 0.94), (-2.105, 0.91), (-2.118, 0.85), (-2.128, 0.75), (-2.133, 0.64), (-2.145, 0.60), (-2.155, 0.575),
       (-2.159, 0.54), (TAIL, 0.485)]
BOTTOM = [(NOSE, 0.405), (2.161, 0.35), (2.155, 0.29), (2.12, 0.235), (2.05, 0.21), (1.0, 0.17), (-1.80, 0.17), (-2.05, 0.22), (-2.13, 0.27),
          (-2.155, 0.33), (-2.159, 0.37), (TAIL, 0.43)]
# the side's beltline: along the hood just under its crown, the glass's sill, along the trunk's deck
BELT = [(NOSE, 0.44), (FACE_TOP, 0.585), (FACE, 0.71), (2.06, 0.735), (1.20, 0.845), (0.75, 0.895), (0.0, 0.915),
        (-1.0, 0.935), (REAR_END, 0.955), (-2.06, 0.935), (-2.105, 0.895), (-2.128, 0.74), (TAIL, 0.48)]
COWL = 0.75  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03


def half_width(y):
    """The body's half-width in plan at y: its corners rounded"""
    if y > NOSE - NOSE_R:
        t = min(0.995, (y - (NOSE - NOSE_R)) / NOSE_R)
        return W - NOSE_R + NOSE_R * (1 - t ** 3) ** (1 / 3)  # (a superellipse: the front broad, its corners soft)
    if y < TAIL + TAIL_R:
        t = min(0.995, ((TAIL + TAIL_R) - y) / TAIL_R)
        return W - TAIL_R + TAIL_R * (1 - t ** 3) ** (1 / 3)
    return W


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005)
    # (round the nose and the tail the sides' tucks fade out: there the sides are the bumpers' and the panels' faces)
    k = 1 - 0.8 * max(clamp((y - (NOSE - 0.40)) / 0.32, 0, 1), clamp(((TAIL + 0.36) - y) / 0.30, 0, 1))
    bw = w - SHELF * (0.2 + 0.8 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    z3 = bot + min(0.13, 0.30 * h)
    shoulder = clamp(SHOULDER, z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.5
    # the glass: from the sill up to the roof's edge, leaning in; along the hood and the trunk no glass, the edge down
    # on the sill
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.40, 0, 1)
    # the windows' top: just under the roof's edge over the doors, then down the C pillar behind the rear doors' fixed
    # quarter lights, to the sill
    run = math.hypot(rw - bw, edge - belt)
    band = 0.015 + run * clamp((D_POST[0] - 0.12 - y) / 0.42, 0, 1)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.05, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    return [(0, bot), (w - 0.10 * (0.5 + 0.5 * k), bot), (w - 0.035 * k, z2), (w - 0.01 * k, z3), (w, shoulder),
            (w - 0.03 * k, z5), (bw, belt), *upper, (0, top)]


def glass_rise(y):
    """How tall the side glass's slope is at y, sill to the windows' top: m"""
    s = section(y)
    return s[7][1] - s[6][1]


def where(f, lo, hi):
    """The y between lo and hi where f turns false (true at lo)"""
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


A_TIP = where(lambda y: glass_rise(y) > 0.08, 0.2, COWL)  # (the A pillar's foot: the steel closes the point ahead)
QUARTER_END = where(lambda y: glass_rise(y) > 0.04, -0.8, -1.6)  # (the quarter light's point, under the C pillar)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the roof's rail,
    # 9-10 the top (bumper, lamps' face, hood, windshield, roof, rear window, trunk, tail's panel)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'paint' if y > NOSE - 0.12 or y < TAIL + 0.12 else 'under'  # (the bumpers' undersides body-coloured)
    if seg == 1:
        return 'paint' if y > NOSE - 0.30 or y < TAIL + 0.30 else 'trim'
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
        return 'trim' if QUARTER_END < y < A_TIP else 'paint'  # (the doors' black window frames)
    if seg >= 9:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END < y < ROOF_END - 0.02:
            return 'glass:back'
    return 'paint'


# the stations: close together at the ends and over the arches, every window's and post's edge, and the faces' steps
# exactly on one
edges = [NOSE, TAIL, 2.161, 2.158, 2.155, -2.155, -2.159, 2.145, FACE_TOP, 2.105, FACE, 2.06, WS_FOOT, COWL, HEADER, ROOF_END - 0.02, REAR_END, A_TIP, *B_POST,
         *D_POST, QUARTER_END, -2.06, -2.085, -2.105, -2.118, -2.128, -2.133, -2.145]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.08 else 0.02 if arch else 0.025 if end < NOSE_R + 0.05 else 0.06
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.004 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008,
                frame={None: 0.022, 'windshield': 0.04, 'back': 0.035})

# ---- the wheel arches: round, cut out of the sides (their wells dark)
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
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


def rear(ob, offset=0.002, wrap=False):
    """(wrap: each point to its nearest on the skin, round the tail's corners, where a ray from behind would miss)"""
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


def onto(ob, offset=0.0015):
    return car.onto(ob, body, offset)


AHEAD, BEHIND = NOSE + 0.4, TAIL - 0.4  # (the planes the nose's and the tail's decals are drawn in, then laid on)

# ---- the shut lines: the doors' edges, the hood's along the fenders and across under the windshield, the trunk's
# round its lid; the side mouldings' two dark grooves along the doors
seams = []
for s in (1, -1):
    for y in (A_TIP - 0.03, (B_POST[0] + B_POST[1]) / 2, -0.98):
        pts = [(s * side_x(y, z), y, z) for z in (0.30 + k * 0.05 for k in range(14)) if z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.02), y, lerp(TOP, y)) for y in [2.06 - 0.05 * k for k in range(int((2.06 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
    deck = [(s * (half_width(y) - SHELF - 0.02), y, lerp(TOP, y)) for y in [REAR_END - 0.02 - 0.05 * k for k in range(12)]]
    seams.append(car.strip('seam', deck, (0, 0, 1), 0.004, 'trim'))
    for z in (0.43, 0.47):  # (the mouldings: from behind the front arch to before the rear one)
        pts = [(s * (side_x(y, z) + 0.002), y, z) for y in [AXLES[0] - ARCH - 0.04 - 0.05 * k for k in range(40)] if y > AXLES[1] + ARCH + 0.04]
        seams.append(car.strip('moulding', pts, (s, 0, 0), 0.005, 'trim'))
seams.append(car.strip('seam', [(x, COWL + 0.02, lerp(TOP, COWL + 0.02)) for x in (-0.68, 0.68)], (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    onto(ob)

# ---- the nose: on the face under the hood's edge, each head lamp a chrome reflector behind its clear lens: the
# round dipped beam's bowl inboard (its bulb's cap in the middle), the main beam's chamber outboard, all filled, no
# outlines (drawn lines read as a child's drawing); its corner lamp wrapping round to the side, an amber bulb in it;
# the black grille between them, its bars and its chrome frame; the bumper's ribs round its corners, its intake
for s in (1, -1):
    front(car.panel('lamp_housing', [(s * 0.285, 0.597), (s * 0.665, 0.597), (s * 0.665, 0.721), (s * 0.285, 0.721)], AHEAD, 'gloss', 1, n=30), 0.0025)
    front(car.panel('reflector', [(s * 0.293, 0.604), (s * 0.657, 0.604), (s * 0.657, 0.714), (s * 0.293, 0.714)], AHEAD, 'chrome', 1, n=30), 0.003)
    front(car.panel('headlamp', [(s * 0.43, 0.612), (s * 0.65, 0.612), (s * 0.65, 0.706), (s * 0.43, 0.706)], AHEAD, 'headlamp', 1, n=20), 0.0036)
    front(car.disc('headlamp', (s * 0.362, 0.659), 0.050, AHEAD, 'headlamp', 1), 0.0036)
    front(car.disc('bulb_cap', (s * 0.362, 0.659), 0.017, AHEAD, 'chrome', 1, rings=2), 0.0042)
    for z in (0.632, 0.659, 0.686):  # (the main beam's lens: its flutes, faint)
        front(car.decal('lens_flute', [(s * 0.44, z), (s * 0.64, z)], 0.003, AHEAD, 'chrome', 1), 0.0040)
    rear(car.panel('corner', [(s * 0.66, 0.600), (s * 0.84, 0.600), (s * 0.84, 0.718), (s * 0.66, 0.718)], NOSE - 0.02, 'headlamp', 1, n=24), 0.003, wrap=True)
    rear(car.panel('amber', [(s * 0.74, 0.648), (s * 0.79, 0.648), (s * 0.79, 0.672), (s * 0.74, 0.672)], NOSE - 0.02, 'amber', 1, n=6), 0.0045, wrap=True)
front(car.panel('grille', [(-0.29, 0.605), (0.29, 0.605), (0.29, 0.715), (-0.29, 0.715)], AHEAD, 'pocket', 1, n=30), 0.003)
for z in (0.625, 0.645, 0.665, 0.685, 0.703):
    front(car.decal('grille_bar', [(-0.28, z), (0.28, z)], 0.004, AHEAD, 'trim', 1), 0.0038)
front(car.decal('grille_frame', [(-0.29, 0.605), (0.29, 0.605), (0.29, 0.715), (-0.29, 0.715), (-0.29, 0.605)], 0.006, AHEAD, 'chrome', 1), 0.0042)
for z in (0.465, 0.495):  # (the bumper's ribs, either side of the plate, out to its corners)
    for s in (1, -1):
        front(car.decal('rib', [(s * 0.30, z), (s * 0.80, z)], 0.006, AHEAD, 'trim', 1), 0.0015)
front(car.decal('seam', [(-0.80, 0.592), (0.80, 0.592)], 0.005, AHEAD, 'trim', 1), 0.0015)  # (the bumper's top edge)
front(car.panel('intake', [(-0.42, 0.355), (0.42, 0.355), (0.40, 0.30), (-0.40, 0.30)], AHEAD, 'pocket', 1, n=30, m=3))

# ---- the tail: on the tail's panel the wide lamps (red outboard, the white reversing lamp, red again inboard) with the
# plate's recess between them, wrapping a little round the corners; the trunk lid's edge round them; the bumper's rib
for s in (1, -1):
    # (out to 0.80 m: past the panel's face the rays from behind meet the tail's rounded corner, so the lamps wrap
    # round it a little; further out they would miss the body and hang in the air)
    rear(car.panel('lamp', [(s * 0.27, 0.73), (s * 0.80, 0.73), (s * 0.80, 0.86), (s * 0.27, 0.86)], BEHIND, 'lamp', -1, n=50), 0.003)
    rear(car.panel('reverse', [(s * 0.45, 0.745), (s * 0.52, 0.745), (s * 0.52, 0.845), (s * 0.45, 0.845)], BEHIND, 'white', -1, n=8), 0.0045)
    rear(car.panel('amber', [(s * 0.27, 0.745), (s * 0.45, 0.745), (s * 0.45, 0.845), (s * 0.27, 0.845)], BEHIND, 'amber', -1, n=16), 0.0042)
    for x in (0.27, 0.45, 0.52):
        rear(car.decal('lamp_rib', [(s * x, 0.73), (s * x, 0.86)], 0.006, BEHIND, 'gloss', -1), 0.0048)
    rear(car.decal('rib', [(s * 0.20, 0.50), (s * 0.76, 0.50)], 0.006, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('plate_recess', [(-0.25, 0.70), (0.25, 0.70), (0.25, 0.88), (-0.25, 0.88)], BEHIND, 'pocket', -1, n=20), 0.0015)
rear(car.decal('seam', [(-0.76, 0.885), (0.76, 0.885)], 0.004, BEHIND, 'trim', -1), 0.0015)

# ---- the mirrors: body-coloured triangles at the front windows' corner, the glass in their back
for s in (1, -1):
    D = A_TIP + 0.02
    z = lerp(BELT, D) + 0.01
    x0 = side_x(D, z - 0.03) - 0.03
    inner = [(D + 0.02, z), (D - 0.13, z), (D - 0.13, z + 0.10), (D + 0.02, z + 0.04)]
    outer = [(D - 0.05, z + 0.01), (D - 0.13, z + 0.01), (D - 0.13, z + 0.09), (D - 0.05, z + 0.05)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.15), 'paint')
    car.bevelled(m, 0.015, 3, angle=20)
    car.smooth(m, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.09, 0.002, 0.06), 'glass')
    g.location = (s * (W + 0.09), D - 0.1335, z + 0.05)

# ---- the doors' black pull handles
for s in (1, -1):
    for y in (B_POST[0] + 0.22, -0.88):
        z = lerp(BELT, y) - 0.10
        h = car.box('handle', (0, 0, 0), (0.012, 0.14, 0.03), 'trim', bevel=0.004)
        h.location = (s * (side_x(y, z) + 0.004), y, z)

car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.62, 0.30)], (0, 0.5, 1), 0.018, 'trim', lift=0.01)

# ---- the taxi's roof sign: a lit box on a black base, over the front seats
if TAXI:
    sy = -0.30
    sz = lerp(TOP, sy)
    car.box('sign_base', (0, sy, sz + 0.015), (0.42, 0.14, 0.03), 'trim', bevel=0.008)
    sign = car.box('sign', (0, sy, sz + 0.095), (0.50, 0.12, 0.13), 'sign', bevel=0.02)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.20, 0.36), (1.50, 2.30, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.62, 0.84), (1.50, 0.40, 0.14), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.36, 0.05, 0.56), (0.46, 0.50, 0.12), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.36, -0.22, 0.86), (0.44, 0.12, 0.56), 'interior', bevel=0.04, tilt=0.22)
car.soft_box('interior_bench', (0, -0.85, 0.58), (1.36, 0.46, 0.12), 'interior', bevel=0.04)
car.soft_box('interior_benchback', (0, -1.12, 0.86), (1.36, 0.12, 0.50), 'interior', bevel=0.04, tilt=0.28)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=32, minor_segments=8,
                                     location=(-0.36, 0.42, 0.88), rotation=(math.radians(60), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))

# ---- the wheels: narrow road tyres; silver hubcaps, ten slots round their middles
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.006, lug=0.0, spokes=10)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 9), ('rear', 150, 10, 9.5), ('side', 92, 2, 10), ('face', 0, 2, 4.2, 50, (0, 2.0, 0.55)),
             ('lamp', 340, 4, 2.6, 50, (-0.45, 2.0, 0.62)),
             ('tail', 180, 6, 4.2, 50, (0, -2.0, 0.65)), ('photo', 318, 4, 7.5, 45)]
    pick = os.environ.get('VIEWS')  # (a quick look: VIEWS=front renders that one only)
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    paint = dict(base=(0.85, 0.48, 0.0), rough=0.2, metal=0.0, coat=0.8) if TAXI else dict(base=(0.55, 0.56, 0.58), rough=0.18, metal=0.7, coat=1.0)
    car.hero(renders, 'tsuru-taxi' if TAXI else 'tsuru', paint=paint, views=views, samples=int(os.environ.get('SAMPLES', '96')))
