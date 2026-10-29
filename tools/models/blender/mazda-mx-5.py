# tools/models/blender/mazda-mx-5.py
# The Mazda MX-5 (the fourth one, ND, 2015 on), modelled by script (carlib.py) on the Mazda 3's lines (mazda-3.py): a
# small roadster, the long low hood between the front fenders' high crests, the cabin far back, its black cloth top
# with a small rear window, the short deck over the rear wheels' haunches; the low wide grille, the slim lamps swept
# back over it, the round tail lamps. Real sizes (Mazda's data sheet): 3.915 m long, 1.735 m wide (no mirrors), 1.235
# m high, a 2.310 m wheelbase, a 1.495 m track, 205/45 R17 tyres (0.62 m across).
#   blender -b --factory-startup -P tools/models/blender/mazda-mx-5.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 1.9575, -1.9575
W = 0.867  # half the body's width
NOSE_DEEP, TAIL_R = 0.50, 0.34  # (how far back the nose's corners reach in plan; the tail's corners' radius)
AXLES = (1.235, -1.075)  # (a 0.72 m front overhang)
TYRE_R, TYRE_W, RIM = 0.308, 0.205, 0.216
TRACK = 1.495
ARCH = 0.355  # (the wheel arches' radius, round the axle)
SHELF = 0.10  # (how far the glass's sill, and the fenders' crests, sit in from the shoulder: m)
CROWN = 0.035  # (the top's crown, its middle over its edges)
ROOF_HALF = 0.55  # (the top's half-width between its edges)
COWL = 0.30  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = -0.12, -0.86, -1.02  # (the windshield's top; the cloth top's rear window, top & foot)
B_POST = (-0.66, -0.62)  # (where the door's glass ends: the top's side behind)
TOP_END = -1.10  # (where the cloth top meets the deck)
SHOULDER = 0.62  # (the widest point's height)


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


# the centreline's top: the face up to the hood's leading edge, the long low hood, the raked windshield, the cloth top
# falling to the deck, the short deck, the tail's face
TOP = [(NOSE, 0.50), (1.95, 0.535), (1.92, 0.57), (1.86, 0.60), (1.70, 0.635), (1.40, 0.675), (1.00, 0.715),
       (0.60, 0.75), (COWL, 0.78), (0.15, 0.89), (0.0, 1.01), (HEADER, 1.12), (-0.25, 1.185), (-0.45, 1.225),
       (-0.65, 1.235), (-0.80, 1.20), (ROOF_END, 1.165), (-0.95, 1.07), (REAR_END, 0.97), (TOP_END, 0.91),
       (-1.25, 0.895), (-1.55, 0.885), (-1.78, 0.875), (-1.86, 0.855), (-1.91, 0.80), (-1.94, 0.70), (TAIL, 0.58)]
BOTTOM = [(NOSE, 0.30), (1.94, 0.25), (1.88, 0.20), (1.70, 0.16), (1.0, 0.125), (-1.4, 0.125), (-1.70, 0.17),
          (-1.86, 0.22), (-1.93, 0.28), (TAIL, 0.34)]
# the side's beltline: the front fenders' crests, high over the wheels, the door's sill, the rear haunches
BELT = [(NOSE, 0.48), (1.92, 0.55), (1.75, 0.615), (1.45, 0.67), (1.10, 0.70), (0.70, 0.72), (COWL, 0.74),
        (-0.30, 0.755), (-0.80, 0.78), (-1.20, 0.84), (-1.55, 0.86), (-1.80, 0.85), (-1.90, 0.80), (TAIL, 0.70)]


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
    """How far the fenders' crests stand over the hood along it (m): the front wheels' high haunches"""
    return 0.07 * smooth((y - COWL - 0.05) / 0.35) * (1 - smooth((y - 1.72) / 0.18))


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
    band = 0.03 + run * clamp((B_POST[0] - 0.02 - y) / 0.25, 0, 1)
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


A_TIP = where(lambda y: glass_rise(y) > 0.07, -0.4, COWL)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the top's edge,
    # 9-10 the top (hood, windshield, cloth top, rear window, deck)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'trim' if y > 1.88 or y < -1.88 else 'under'
    if seg == 1:
        return 'paint'
    cloth = TOP_END < y < HEADER  # (the cloth top: black)
    if seg == 6:
        if B_POST[1] < y < A_TIP:
            return f'glass:front{side}'
        return 'trim' if cloth else 'paint'
    if seg in (7, 8):
        return 'trim' if cloth else 'paint'
    if seg >= 9:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END + 0.02 < y < ROOF_END - 0.02:
            return 'glass:back'
        if cloth:
            return 'trim'
    return 'paint'


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, ROOF_END, REAR_END, ROOF_END - 0.02, REAR_END + 0.02, TOP_END, A_TIP, *B_POST, -1.86, -1.91]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.1 else 0.02 if arch else 0.025 if (y > NOSE - NOSE_DEEP - 0.05 or y < TAIL + TAIL_R + 0.05) else 0.07
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.005 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008, cap_rings=(0.012, 0.03, 0.07),
                frame={None: 0.018, 'windshield': 0.035, 'back': 0.012})

# ---- the wheel arches
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.50, s * 1.4, 'under'))
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
    for y in (A_TIP - 0.05, B_POST[0] - 0.06):
        pts = [(s * side_x(y, z), y, z) for z in (0.26 + k * 0.05 for k in range(15)) if z < lerp(BELT, y) - 0.03]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.05), y, lerp(BELT, y) + fender_rise(y)) for y in [1.80 - 0.05 * k for k in range(int((1.80 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)


def front(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='-Y')


def rear(ob, offset=0.002, wrap=False):
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


AHEAD, BEHIND, AT_TAIL = NOSE + 0.4, TAIL - 0.4, -1.92

# ---- the nose: the low wide grille, a smiling pentagon under the nose; the slim lamps swept back and up over its top
# corners, round the fenders; the small black corner vents, the lip
front(car.panel('grille', [(-0.30, 0.43), (0.30, 0.43), (0.42, 0.27), (-0.42, 0.27)], AHEAD, 'gloss', 1, n=60, m=8))
for k in range(5):
    z = 0.29 + k * 0.03
    hw = 0.30 + 0.12 * (1 - (z - 0.27) / 0.16) - 0.02
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.003, AHEAD, 'trim', 1), 0.0028)
for s in (1, -1):
    slot = [(s * 0.40, 0.475), (s * 0.80, 0.545), (s * 0.82, 0.505), (s * 0.44, 0.445)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=50), 0.002)
    front(car.decal('lightbar', [(s * 0.46, 0.462), (s * 0.79, 0.52)], 0.006, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.58, 0.488), (s * 0.70, 0.51)], 0.022, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('side_intake', [(s * 0.55, 0.36), (s * 0.74, 0.38), (s * 0.74, 0.30), (s * 0.56, 0.29)], AHEAD, 'gloss', 1, n=20), 0.002)
front(car.decal('lip', [(-0.72, 0.24), (0.72, 0.24)], 0.025, AHEAD, 'trim', 1))

# ---- the tail: round lamps at the corners, a lit ring each with its dark middle; the trunk lid's shut line; the black
# diffuser with its two exhaust tips
TAILLAMP = 0.78
for s in (1, -1):
    disc = [(s * 0.70 + 0.075 * math.cos(a * math.pi / 12), TAILLAMP + 0.06 * math.sin(a * math.pi / 12)) for a in range(25)]
    rear(car.decal('lamp', disc, 0.05, AT_TAIL, 'lamp', -1), 0.003, wrap=True)
    ring = [(s * 0.70 + 0.05 * math.cos(a * math.pi / 12), TAILLAMP + 0.04 * math.sin(a * math.pi / 12)) for a in range(25)]
    rear(car.decal('lampbright', ring, 0.01, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    tip = [(s * 0.32 + 0.04 * math.cos(a * math.pi / 10), 0.33 + 0.026 * math.sin(a * math.pi / 10)) for a in range(21)]
    rear(car.decal('exhaust', tip, 0.014, BEHIND, 'chrome', -1), 0.004)
lid = [(-0.52, 0.86), (-0.52, 0.66), (-0.49, 0.63), (0.49, 0.63), (0.52, 0.66), (0.52, 0.86)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('diffuser', [(-0.76, 0.40), (0.76, 0.40), (0.70, 0.30), (-0.70, 0.30)], BEHIND, 'trim', -1, n=80, m=6))

# ---- the door handle: a slim pull under the beltline near the door's back edge
for s in (1, -1):
    y0, y1 = -0.40, -0.56
    z = lerp(BELT, (y0 + y1) / 2) - 0.08
    loop = [(y0, z - 0.015), (y1 + 0.015, z - 0.015), (y1, z), (y1 + 0.015, z + 0.015), (y0, z + 0.015), (y0, z - 0.015)]
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
car.box('interior_floor', (0, -0.35, 0.30), (1.40, 1.20, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.15, 0.70), (1.40, 0.35, 0.14), 'interior', bevel=0.05)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.33, -0.45, 0.42), (0.46, 0.48, 0.10), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.33, -0.72, 0.72), (0.44, 0.12, 0.56), 'interior', bevel=0.04, tilt=0.25)

# ---- the wheels: 17" alloys, ten slim spokes over a dark dish
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='spoke', segments=48, tread=0.007, lug=0.0, spokes=10)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 10), ('rear', 150, 10, 10.5), ('side', 92, 2, 11), ('nose', 0, 6, 8.5), ('tail', 180, 8, 8.5),
             ('high', 140, 32, 9), ('photo', 20, 4, 8.0, 45), ('face', 0, 2, 4.2, 50, (0, 1.8, 0.45))]
    pick = os.environ.get('VIEWS')
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    # (Soul Red Crystal, Mazda's own colour)
    car.hero(renders, 'mazda-mx-5', paint=dict(base=(0.45, 0.02, 0.03), rough=0.12, metal=0.5, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
