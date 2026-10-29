# tools/models/blender/mazda-3.py
# The Mazda 3 sedan (the fourth one, BP, 2019 on: Kodo design), modelled by script (carlib.py): a long low hood, the
# cabin set back with a steep windshield, the roof running down into a short trunk with a ducktail lip, the side's
# smooth surfaces under a high beltline, small side glass with a chrome-free black surround, round wheel arches; laid
# onto that skin: the big shield grille, the slim head lamps swept back from its top corners with the chrome wing
# under the grille running into them, the small black side intakes, the tail lamps' twin rings at the trunk's corners,
# the black diffuser with its two exhaust tips. Real sizes (Mazda's data sheet): 4.662 m long, 1.797 m wide (no
# mirrors), 1.445 m high, a 2.725 m wheelbase, a 1.570 m track, 215/45 R18 tyres (0.65 m across).
#   blender -b --factory-startup -P tools/models/blender/mazda-3.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.331, -2.331
W = 0.898  # half the body's width
NOSE_DEEP, TAIL_R = 0.55, 0.36  # (how far back the nose's corners reach in plan; the tail's corners' radius)
AXLES = (1.40, -1.325)  # (a 0.93 m front overhang)
TYRE_R, TYRE_W, RIM = 0.325, 0.215, 0.229
TRACK = 1.570
ARCH = 0.375  # (the wheel arches' radius, round the axle)
SHELF = 0.085  # (how far the glass's sill, and the fenders' crests, sit in from the shoulder: m)
CROWN = 0.04  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.56  # (the roof's half-width between its rails)
COWL = 0.76  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = -0.08, -0.93, -1.50  # (the windshield's top; the roof's end, where the rear window starts; its
# foot on the trunk)
B_POST, C_POST = (-0.24, -0.15), (-1.05, -0.99)  # (the black posts between the side windows)
QUARTER_RUN = 0.32  # (how far back the quarter window's top runs down to its point, from the C post)
SHOULDER = 0.80  # (the widest point's height)


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


# the centreline's top: the shark nose's face up to the hood's leading edge, the long hood rising to the cowl, the
# windshield, the roof's peak over the front seats, the rear window down to the trunk, the short deck and its lip, the
# tail's face down to the bumper
TOP = [(NOSE, 0.585), (2.325, 0.615), (2.30, 0.645), (2.25, 0.672), (2.15, 0.70), (1.90, 0.745), (1.50, 0.81),
       (1.10, 0.87), (COWL, 0.915), (0.55, 1.04), (0.30, 1.19), (0.05, 1.33), (-0.15, 1.41), (-0.40, 1.445),
       (-0.65, 1.435), (-0.93, 1.38), (-1.15, 1.27), (-1.35, 1.15), (-1.50, 1.075), (-1.70, 1.055), (-2.00, 1.045),
       (-2.18, 1.04), (-2.25, 1.035), (-2.28, 1.02), (-2.30, 0.97), (-2.315, 0.88), (-2.325, 0.76), (-2.33, 0.64),
       (TAIL, 0.52)]
BOTTOM = [(NOSE, 0.36), (2.32, 0.31), (2.29, 0.27), (2.22, 0.23), (2.05, 0.19), (1.0, 0.155), (-1.8, 0.155),
          (-2.05, 0.19), (-2.22, 0.23), (-2.30, 0.27), (TAIL, 0.32)]
# the side's beltline: the fenders' tops along the hood, the glass's sill rising gently to the tail
BELT = [(NOSE, 0.57), (2.32, 0.60), (2.25, 0.64), (2.05, 0.70), (1.60, 0.785), (1.20, 0.85), (COWL, 0.90),
        (0.30, 0.94), (-0.40, 0.965), (-1.00, 0.985), (-1.60, 1.005), (-2.10, 1.015), (-2.26, 1.0), (TAIL, 0.86)]


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
    return 0.05 * smooth((y - COWL - 0.1) / 0.45) * (1 - smooth((y - 2.10) / 0.15))


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
        return 'trim' if abs(y) < 1.9 else 'paint'  # (a black sill between the arches)
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


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, ROOF_END, REAR_END, A_TIP, *B_POST, *C_POST, QUARTER_END, -2.28, -2.30]
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
        pts = [(s * side_x(y, z), y, z) for z in (0.33 + k * 0.05 for k in range(15)) if z < lerp(BELT, y) - 0.03]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.04), y, lerp(BELT, y) + fender_rise(y)) for y in [2.22 - 0.05 * k for k in range(int((2.22 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
    deck = [(s * (half_width(y) - SHELF - 0.03), y, lerp(BELT, y)) for y in [REAR_END - 0.05 - 0.05 * k for k in range(14)]]
    seams.append(car.strip('seam', deck, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)


def front(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='-Y')


def rear(ob, offset=0.002, wrap=False):
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


AHEAD, BEHIND, AT_TAIL = NOSE + 0.4, TAIL - 0.4, -2.30

# ---- the nose: the shield grille, wide and deep, its top under the hood's edge, flaring out down its sides to a broad
# rounded foot; its mesh of fine black bars; the chrome wing along its foot, sweeping up its sides into the head lamps'
# inner ends; the head lamps slim and swept back round the corners, each a lit strip along its top (the daytime light)
# over a dark lens; the small black intakes low at the corners, and the lip across under the grille
GRILLE_TOP, GRILLE_FOOT = 0.555, 0.30
front(car.panel('grille', [(-0.33, GRILLE_TOP), (0.33, GRILLE_TOP), (0.40, GRILLE_FOOT + 0.05), (-0.40, GRILLE_FOOT + 0.05)], AHEAD, 'gloss', 1, n=60, m=8))
front(car.panel('grille_foot', [(-0.40, GRILLE_FOOT + 0.055), (0.40, GRILLE_FOOT + 0.055), (0.34, GRILLE_FOOT), (-0.34, GRILLE_FOOT)], AHEAD, 'gloss', 1, n=60, m=3))
for k in range(7):  # (its fine mesh: thin bars across, a dull glint each)
    z = GRILLE_FOOT + 0.035 + k * 0.03
    hw = 0.33 + 0.07 * (1 - (z - GRILLE_FOOT) / (GRILLE_TOP - GRILLE_FOOT)) - 0.025
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.003, AHEAD, 'trim', 1), 0.0028)
# (the wing: along the grille's foot, up its flanks and out under the lamps)
wing = [(-0.60, GRILLE_TOP - 0.012), (-0.40, GRILLE_TOP - 0.02), (-0.405, GRILLE_FOOT + 0.06), (-0.35, GRILLE_FOOT - 0.006),
        (0.35, GRILLE_FOOT - 0.006), (0.405, GRILLE_FOOT + 0.06), (0.40, GRILLE_TOP - 0.02), (0.60, GRILLE_TOP - 0.012)]
front(car.decal('chrome_wing', wing, 0.010, AHEAD, 'chrome', 1), 0.003)
for s in (1, -1):
    # (the lamp: a slim slot over the wing's end, from the grille's top corner out round the fender's corner, rising)
    slot = [(s * 0.36, GRILLE_TOP + 0.012), (s * 0.82, 0.60), (s * 0.84, 0.572), (s * 0.40, GRILLE_TOP - 0.006)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=50), 0.002)
    front(car.decal('lightbar', [(s * 0.42, GRILLE_TOP + 0.002), (s * 0.80, 0.578)], 0.006, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.58, 0.572), (s * 0.70, 0.580)], 0.020, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('side_intake', [(s * 0.58, 0.34), (s * 0.78, 0.36), (s * 0.78, 0.29), (s * 0.60, 0.285)], AHEAD, 'gloss', 1, n=20), 0.002)
front(car.decal('lip', [(-0.78, 0.25), (0.78, 0.25)], 0.03, AHEAD, 'trim', 1))

# ---- the tail: the lamps at the trunk's corners, wrapping round them: a dark red cluster, two lit rings in each (the
# Kodo's round lamps), the trunk lid's shut line between; the black diffuser low on the bumper, its two exhaust tips
TAILLAMP = 0.94
for s in (1, -1):
    cluster = [(s * 0.50, TAILLAMP + 0.03), (s * 0.91, TAILLAMP + 0.045), (s * 0.91, TAILLAMP - 0.04), (s * 0.55, TAILLAMP - 0.035)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    for cx in (0.66, 0.80):
        ring = [(s * cx + 0.045 * math.cos(a * math.pi / 12), TAILLAMP + 0.004 + 0.032 * math.sin(a * math.pi / 12)) for a in range(25)]
        rear(car.decal('lampbright', ring, 0.009, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.52, TAILLAMP - 0.03), (s * 0.58, TAILLAMP - 0.03), (s * 0.58, TAILLAMP + 0.0), (s * 0.52, TAILLAMP + 0.0)], AT_TAIL, 'white', -1, n=6, m=2), 0.0045, wrap=True)
    tip = [(s * 0.48 + 0.042 * math.cos(a * math.pi / 10), 0.38 + 0.026 * math.sin(a * math.pi / 10)) for a in range(21)]
    rear(car.decal('exhaust', tip, 0.014, BEHIND, 'chrome', -1), 0.004)
lid = [(-0.50, TAILLAMP + 0.045), (-0.50, 0.70), (-0.47, 0.67), (0.47, 0.67), (0.50, 0.70), (0.50, TAILLAMP + 0.045)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.48, 0.885), (0.48, 0.885)], 0.01, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('diffuser', [(-0.84, 0.43), (0.84, 0.43), (0.78, 0.335), (-0.78, 0.335)], BEHIND, 'trim', -1, n=80, m=8))
rear(car.panel('reflector', [(-0.84, 0.43), (-0.74, 0.43), (-0.74, 0.45), (-0.84, 0.45)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
rear(car.panel('reflector', [(0.74, 0.43), (0.84, 0.43), (0.84, 0.45), (0.74, 0.45)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)

# ---- the door handles: a slim pull on each door, under the beltline near its back edge
for s in (1, -1):
    for y0, y1 in ((-0.02, -0.20), (-0.80, -0.98)):
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
car.box('interior_floor', (0, -0.20, 0.40), (1.60, 2.10, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.55, 0.88), (1.60, 0.40, 0.16), 'interior', bevel=0.05)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.38, -0.20, 0.58), (0.48, 0.50, 0.12), 'interior', bevel=0.045)
    car.soft_box('interior_seatback', (s * 0.38, -0.50, 0.90), (0.46, 0.12, 0.60), 'interior', bevel=0.045, tilt=0.22)
car.soft_box('interior_bench', (0, -0.85, 0.58), (1.40, 0.46, 0.12), 'interior', bevel=0.045)
car.soft_box('interior_benchback', (0, -1.10, 0.86), (1.40, 0.12, 0.44), 'interior', bevel=0.045, tilt=0.3)

# ---- the wheels: 18" alloys, ten slim spokes in pairs over a dark dish
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='spoke', segments=48, tread=0.007, lug=0.0, spokes=10)

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
    car.hero(renders, 'mazda-3', paint=dict(base=(0.45, 0.02, 0.03), rough=0.12, metal=0.5, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
