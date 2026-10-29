# tools/models/blender/mazda-cx-5.py
# The Mazda CX-5 (the second one, KF, 2017 on), modelled by script (carlib.py) on the Mazda 3's lines (mazda-3.py): a
# taller crossover, the long hood rising to a raked windshield, the roof running level to the spoiler over the
# tailgate's glass, the black arches and sills; the same Kodo face (the shield grille with its chrome wing running up
# into the slim head lamps), the tail lamps' twin rings across the tailgate's corners, the black lower bumper. Real
# sizes (Mazda's data sheet): 4.575 m long, 1.845 m wide (no mirrors), 1.680 m high, a 2.700 m wheelbase, a 1.595 m
# track, 225/55 R19 tyres (0.73 m across).
#   blender -b --factory-startup -P tools/models/blender/mazda-cx-5.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.2875, -2.2875
W = 0.922  # half the body's width
NOSE_DEEP, TAIL_R = 0.50, 0.34  # (how far back the nose's corners reach in plan; the tail's corners' radius)
AXLES = (1.36, -1.34)  # (a 0.93 m front overhang)
TYRE_R, TYRE_W, RIM = 0.365, 0.225, 0.241
TRACK = 1.595
ARCH = 0.425  # (the wheel arches' radius, round the axle)
SHELF = 0.08  # (how far the glass's sill, and the fenders' crests, sit in from the shoulder: m)
CROWN = 0.04  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.62  # (the roof's half-width between its rails)
COWL = 0.86  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = 0.0, -1.80, -2.14  # (the windshield's top; the roof's end over the tailgate's glass; its foot)
B_POST, C_POST = (-0.26, -0.17), (-1.17, -1.10)  # (the black posts between the side windows)
QUARTER_RUN = 0.62  # (how far back the quarter window's top runs down to its point, from the C post)
SHOULDER = 0.92  # (the widest point's height)


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


# the centreline's top: the face up to the hood's leading edge, the long hood rising to the cowl, the windshield, the
# roof nearly level to the spoiler, the tailgate's glass, the tailgate down to the bumper
TOP = [(NOSE, 0.78), (2.28, 0.82), (2.25, 0.855), (2.18, 0.885), (2.0, 0.925), (1.60, 0.98), (1.20, 1.03),
       (COWL, 1.075), (0.65, 1.21), (0.40, 1.39), (0.15, 1.56), (-0.10, 1.64), (-0.40, 1.678), (-0.90, 1.675),
       (-1.40, 1.655), (-1.75, 1.625), (-1.80, 1.60), (-1.95, 1.47), (-2.10, 1.30), (-2.16, 1.22), (-2.21, 1.13),
       (-2.245, 1.02), (-2.265, 0.88), (-2.28, 0.74), (TAIL, 0.62)]
BOTTOM = [(NOSE, 0.46), (2.27, 0.41), (2.22, 0.36), (2.10, 0.31), (1.85, 0.26), (1.0, 0.215), (-1.8, 0.215),
          (-2.05, 0.27), (-2.20, 0.33), (-2.27, 0.40), (TAIL, 0.46)]
# the side's beltline: the fenders' tops along the hood, the glass's sill rising to the tail
BELT = [(NOSE, 0.76), (2.26, 0.82), (2.05, 0.88), (1.60, 0.955), (1.20, 1.01), (COWL, 1.05), (0.30, 1.08),
        (-0.50, 1.10), (-1.20, 1.13), (-1.80, 1.16), (-2.15, 1.17), (-2.25, 1.12), (TAIL, 1.0)]


def half_width(y):
    """The body's half-width in plan at y: the nose's long rounded corners, the tail's tighter ones"""
    if y > NOSE - NOSE_DEEP:
        t = min(0.995, (y - (NOSE - NOSE_DEEP)) / NOSE_DEEP)
        return W * (1 - t ** 3.2) ** (1 / 3.2)
    if y < TAIL + TAIL_R:
        t = ((TAIL + TAIL_R) - y) / TAIL_R
        return W - TAIL_R + TAIL_R * math.sqrt(max(0.0, 1 - t ** 2.6))
    # (the waist: the side drawn in a little between the arches, the Kodo's reflections)
    return W - 0.012 * smooth((AXLES[0] - 0.4 - y) / 0.5) * smooth((y - AXLES[1] - 0.4) / 0.5)


def fender_rise(y):
    """How far the fenders' crests stand over the hood along it (m): the front wheels' haunches"""
    return 0.045 * smooth((y - COWL - 0.1) / 0.45) * (1 - smooth((y - 2.08) / 0.15))


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005) + (fender_rise(y) if y > COWL else 0.0)
    k = 1 - 0.85 * max(clamp((y - (NOSE - 0.45)) / 0.35, 0, 1), clamp(((TAIL + 0.3) - y) / 0.28, 0, 1))
    bw = w - SHELF * (0.15 + 0.85 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    z3 = bot + min(0.16, 0.30 * h)
    shoulder = clamp(SHOULDER, z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.6
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.40, 0, 1)
    run = math.hypot(rw - bw, edge - belt)
    band = 0.03 + run * clamp((C_POST[0] - 0.02 - y) / QUARTER_RUN, 0, 1)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    if belt > top:
        dip, f = belt - top, min(1.0, (belt - top) / 0.03)
        upper = [(bw, belt), (bw - 0.06, belt - 0.5 * dip), (bw - 0.06 - 0.14 * f, top - 0.008 * f),
                 (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
    return [(0, bot), (w - 0.12 * (0.5 + 0.5 * k), bot), (w - 0.05 * k, z2), (w - 0.015 * k, z3), (w, shoulder),
            (w - 0.03 * k, z5), (bw, belt), *upper, (0, top)]


def glass_rise(y):
    s = section(y)
    return s[7][1] - s[6][1]


def where(f, lo, hi):
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


A_TIP = where(lambda y: glass_rise(y) > 0.09, 0.0, COWL)
QUARTER_END = where(lambda y: glass_rise(y) > 0.04, C_POST[0], -1.9)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the roof's
    # rail, 9-10 the top (hood, windshield, roof, rear window, trunk)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'trim' if y > 2.25 or y < -2.25 else 'under'
    if seg == 1:
        return 'trim'  # (the black cladding along the sill, round the bumpers' corners)
    if seg == 6:
        if B_POST[0] < y < B_POST[1] or C_POST[0] < y < C_POST[1]:
            return 'trim'
        if B_POST[1] < y < A_TIP:
            return f'glass:front{side}'
        if C_POST[1] < y < B_POST[0]:
            return f'glass:rear{side}'
        if QUARTER_END < y < C_POST[0]:
            return f'glass:quarter{side}'
    if seg == 7:
        return 'trim' if C_POST[0] < y < A_TIP else 'paint'
    if seg >= 9:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END < y < ROOF_END:
            return 'glass:back'
    return 'paint'


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, ROOF_END, REAR_END, A_TIP, *B_POST, *C_POST, QUARTER_END, -2.21, -2.245]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.1 else 0.02 if arch else 0.025 if (y > NOSE - NOSE_DEEP - 0.05 or y < TAIL + TAIL_R + 0.05) else 0.07
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.005 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008, cap_rings=(0.012, 0.03, 0.07),
                frame={None: 0.022, 'windshield': 0.04, 'back': 0.015})

# ---- the wheel arches
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.52, s * 1.4, 'under'))
car.cut(body, *wells)
car.tidy(body, 75, weighted=False)
# (the arches' black mouldings: a band round each, laid on the side)
for yc in AXLES:
    for s in (1, -1):
        arc = [(s * 1.2, yc + (ARCH + 0.03) * math.cos(math.radians(a)), TYRE_R + (ARCH + 0.03) * math.sin(math.radians(a))) for a in range(-5, 186, 5)]
        car.onto(car.strip('arch', arc, (s, 0, 0), 0.07, 'trim'), body, 0.002)


def side_x(y, z):
    pts = section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


# ---- the shut lines: the doors' edges, the hood's along the fenders, the trunk lid's
seams = []
for s in (1, -1):
    for y in (A_TIP - 0.05, (B_POST[0] + B_POST[1]) / 2, C_POST[0] - 0.02):
        pts = [(s * side_x(y, z), y, z) for z in (0.40 + k * 0.05 for k in range(15)) if z < lerp(BELT, y) - 0.03]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.04), y, lerp(BELT, y) + fender_rise(y)) for y in [2.22 - 0.05 * k for k in range(int((2.22 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)


def front(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='-Y')


def rear(ob, offset=0.002, wrap=False):
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


AHEAD, BEHIND, AT_TAIL = NOSE + 0.4, TAIL - 0.4, -2.27

# ---- the nose: the shield grille, tall, its top under the hood's edge, flaring out down its sides; its mesh of fine
# black bars; the chrome wing along its foot and up its flanks into the head lamps; the slim lamps swept back; the
# black lower bumper with the fog lamps' slots at its corners and a silver skid plate across
GRILLE_TOP, GRILLE_FOOT = 0.725, 0.47
front(car.panel('grille', [(-0.37, GRILLE_TOP), (0.37, GRILLE_TOP), (0.45, GRILLE_FOOT + 0.06), (-0.45, GRILLE_FOOT + 0.06)], AHEAD, 'gloss', 1, n=60, m=8))
front(car.panel('grille_foot', [(-0.45, GRILLE_FOOT + 0.065), (0.45, GRILLE_FOOT + 0.065), (0.38, GRILLE_FOOT), (-0.38, GRILLE_FOOT)], AHEAD, 'gloss', 1, n=60, m=3))
for k in range(8):  # (its fine mesh: thin bars across, a dull glint each)
    z = GRILLE_FOOT + 0.04 + k * 0.032
    hw = 0.37 + 0.08 * (1 - (z - GRILLE_FOOT) / (GRILLE_TOP - GRILLE_FOOT)) - 0.025
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.003, AHEAD, 'trim', 1), 0.0028)
wing = [(-0.64, GRILLE_TOP - 0.012), (-0.44, GRILLE_TOP - 0.02), (-0.455, GRILLE_FOOT + 0.07), (-0.39, GRILLE_FOOT - 0.006),
        (0.39, GRILLE_FOOT - 0.006), (0.455, GRILLE_FOOT + 0.07), (0.44, GRILLE_TOP - 0.02), (0.64, GRILLE_TOP - 0.012)]
front(car.decal('chrome_wing', wing, 0.012, AHEAD, 'chrome', 1), 0.003)
for s in (1, -1):
    slot = [(s * 0.40, GRILLE_TOP + 0.014), (s * 0.86, 0.81), (s * 0.88, 0.775), (s * 0.44, GRILLE_TOP - 0.008)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=50), 0.002)
    front(car.decal('lightbar', [(s * 0.46, GRILLE_TOP + 0.002), (s * 0.84, 0.786)], 0.007, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.62, 0.775), (s * 0.76, 0.784)], 0.024, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('fog', [(s * 0.62, 0.50), (s * 0.84, 0.52), (s * 0.84, 0.45), (s * 0.64, 0.44)], AHEAD, 'gloss', 1, n=20), 0.002)
front(car.panel('bumper', [(-0.88, 0.44), (0.88, 0.44), (0.84, 0.30), (-0.84, 0.30)], AHEAD, 'trim', 1, n=80, m=6))
front(car.decal('skid', [(-0.40, 0.335), (0.40, 0.335)], 0.035, AHEAD, 'chrome', 1), 0.0028)

# ---- the tail: the lamps across the tailgate's corners, wrapping round them, two lit rings in each; the tailgate's
# shut line; the black lower bumper with its two exhaust tips
TAILLAMP = 1.08
for s in (1, -1):
    cluster = [(s * 0.52, TAILLAMP + 0.035), (s * 0.94, TAILLAMP + 0.05), (s * 0.94, TAILLAMP - 0.045), (s * 0.57, TAILLAMP - 0.04)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    for cx in (0.68, 0.83):
        ring = [(s * cx + 0.045 * math.cos(a * math.pi / 12), TAILLAMP + 0.004 + 0.034 * math.sin(a * math.pi / 12)) for a in range(25)]
        rear(car.decal('lampbright', ring, 0.009, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.54, TAILLAMP - 0.035), (s * 0.60, TAILLAMP - 0.035), (s * 0.60, TAILLAMP), (s * 0.54, TAILLAMP)], AT_TAIL, 'white', -1, n=6, m=2), 0.0045, wrap=True)
    tip = [(s * 0.50 + 0.045 * math.cos(a * math.pi / 10), 0.50 + 0.028 * math.sin(a * math.pi / 10)) for a in range(21)]
    rear(car.decal('exhaust', tip, 0.014, BEHIND, 'chrome', -1), 0.004)
gate = [(-0.74, 1.12), (-0.74, 0.70), (-0.70, 0.66), (0.70, 0.66), (0.74, 0.70), (0.74, 1.12)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.50, 1.02), (0.50, 1.02)], 0.01, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('bumper', [(-0.88, 0.64), (0.88, 0.64), (0.84, 0.47), (-0.84, 0.47)], BEHIND, 'trim', -1, n=80, m=8))

# ---- the door handles: a slim pull on each door, under the beltline near its back edge
for s in (1, -1):
    for y0, y1 in ((-0.02, -0.20), (-0.88, -1.06)):
        z = lerp(BELT, (y0 + y1) / 2) - 0.10
        loop = [(y0, z - 0.016), (y1 + 0.015, z - 0.016), (y1, z), (y1 + 0.015, z + 0.016), (y0, z + 0.016), (y0, z - 0.016)]
        h = car.strip('handle', [(s * (side_x(y, zz) + 0.01), y, zz) for y, zz in loop], (s, 0, 0), 0.004, 'trim')
        car.onto(h, body, 0.0015)

# ---- the mirrors: body-coloured caps on a black foot at the door window's front corner
for s in (1, -1):
    D = A_TIP - 0.03
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.04) - 0.04
    inner = [(D + 0.01, z), (D - 0.15, z), (D - 0.16, z + 0.09), (D - 0.06, z + 0.10), (D + 0.01, z + 0.055)]
    outer = [(D - 0.05, z + 0.01), (D - 0.16, z + 0.01), (D - 0.16, z + 0.085), (D - 0.09, z + 0.09), (D - 0.05, z + 0.055)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.12), 'paint')
    car.bevelled(m, 0.026, 4, angle=20)
    car.smooth(m, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.10, 0.002, 0.065), 'glass')
    g.location = (s * (W + 0.07), D - 0.1635, z + 0.045)
    car.box('mirror_foot', (s * (x0 + 0.03), D - 0.05, z + 0.01), (0.06, 0.10, 0.03), 'trim', bevel=0.006)

car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.65, 0.30)], (0, 0.5, 1), 0.02, 'trim', lift=0.01)

# ---- the cabin, seen through the glass in the renders (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.40, 0.50), (1.65, 2.60, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.60, 1.02), (1.65, 0.40, 0.16), 'interior', bevel=0.05)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.40, -0.20, 0.72), (0.48, 0.50, 0.12), 'interior', bevel=0.045)
    car.soft_box('interior_seatback', (s * 0.40, -0.50, 1.05), (0.46, 0.12, 0.62), 'interior', bevel=0.045, tilt=0.2)
car.soft_box('interior_bench', (0, -1.05, 0.74), (1.45, 0.48, 0.12), 'interior', bevel=0.045)
car.soft_box('interior_benchback', (0, -1.32, 1.05), (1.45, 0.12, 0.58), 'interior', bevel=0.045, tilt=0.2)

# ---- the wheels: 19" alloys, five broad spokes over a dark dish
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='spoke', segments=48, tread=0.008, lug=0.0, spokes=5)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 10), ('rear', 150, 10, 10.5), ('side', 92, 2, 11), ('nose', 0, 6, 8.5), ('tail', 180, 8, 8.5),
             ('high', 140, 32, 9), ('photo', 20, 4, 8.5, 45), ('face', 0, 2, 4.6, 50, (0, 2.1, 0.5))]
    pick = os.environ.get('VIEWS')
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    # (Soul Red Crystal, Mazda's own colour)
    car.hero(renders, 'mazda-cx-5', paint=dict(base=(0.45, 0.02, 0.03), rough=0.12, metal=0.5, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
