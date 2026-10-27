# tools/models/blender/tesla-model-y.py
# The Tesla Model Y (the 2025 one, "Juniper"), modelled by script (carlib.py): a smooth fastback crossover lofted through
# rounded sections, its nose bowed and its tail rounded in plan and in profile (no flat faces), the hood domed, the glass roof from the windshield's header to the rear window, the black-framed side glass closing
# in a point at the C pillar, the ducktail lip over the tail, round wheel arches; laid onto that skin: the slim light
# bar across the nose at the hood's edge, the head lamps in dark slots in the bumper with the air curtains' lines under
# them, the wide black intake and lip, the red bar under the lip with the lamps at its ends, the black lower bumper;
# body-coloured mirrors, flush shut lines and door handles, the cameras and the radar's cover, 19" spoked wheels. Real sizes (Tesla's data sheet): 4.797 m long, 1.920 m
# wide (no mirrors), 1.624 m high, a 2.890 m wheelbase, a 1.636 m track, 255/45 R19 tyres (0.71 m across).
#   blender -b --factory-startup -P tools/models/blender/tesla-model-y.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.40, -2.397
W = 0.96  # half the body's width
NOSE_DEEP, TAIL_R = 0.50, 0.40  # (how far back the nose's corners reach in plan; the tail's corners' radius)
AXLES = (1.505, -1.385)  # (a 0.895 m front overhang)
TYRE_R, TYRE_W, RIM = 0.356, 0.255, 0.241
TRACK = 1.636
ARCH = 0.41  # (the wheel arches' radius, round the axle)
SHELF = 0.07  # (how far the glass's sill, and the fenders' crests, sit in from the shoulder: m)
CROWN = 0.05  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.64  # (the roof's half-width between its rails)
HEADER, ROOF_END, REAR_GLASS, REAR_END = 0.36, -0.94, -0.99, -2.10  # (the windshield's top; the glass roof's end; the
# rear window from under the black band down to the lip)
B_POST, C_POST = (0.05, 0.13), (-0.97, -0.92)  # (the black posts between the side windows)
SHOULDER = 0.90  # (the widest point's height, the side's character line)


def lerp(points, y):
    """The polyline [(y, v)...] (y falling) at y"""
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y1 <= y <= y0:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return points[0][1] if y > points[0][0] else points[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# the centreline's top: the bumper's face up to the hood's leading edge (the face itself the sections' sides, curved
# in plan), the hood, the windshield, the roof's
# peak over the rear seats, the fastback down to the ducktail's lip, and the tail's face rounding out to the bumper
TOP = [(NOSE, 0.70), (2.39, 0.712), (2.36, 0.722), (2.30, 0.742), (2.22, 0.772), (2.0, 0.835),
       (1.60, 0.925), (1.30, 0.99), (1.20, 1.05), (0.95, 1.22), (0.65, 1.42), (0.40, 1.545), (0.10, 1.607),
       (-0.30, 1.624), (-0.70, 1.612), (-1.10, 1.56), (-1.50, 1.47), (-1.85, 1.33), (-2.08, 1.20), (-2.20, 1.155),
       (-2.28, 1.14), (-2.31, 1.135), (-2.32, 1.075), (-2.34, 0.99), (-2.365, 0.89), (-2.385, 0.78), (-2.393, 0.68), (TAIL, 0.58)]
BOTTOM = [(NOSE, 0.30), (2.39, 0.265), (2.36, 0.24), (2.30, 0.215), (2.15, 0.20), (1.0, 0.18), (-1.9, 0.18),
          (-2.10, 0.22), (-2.25, 0.27), (-2.36, 0.30), (-2.39, 0.36), (TAIL, 0.46)]
# the side's beltline: the fenders' tops along the hood (a little under its domed middle), the glass's sill, the
# tail's shoulder
BELT = [(NOSE, 0.655), (2.38, 0.685), (2.30, 0.712), (2.0, 0.81), (1.60, 0.90), (1.30, 0.965), (1.0, 1.04), (0.0, 1.065),
        (-1.00, 1.09), (-1.60, 1.11), (-2.05, 1.13), (TAIL, 1.0)]

COWL = 1.27  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03


def half_width(y):
    """The body's half-width in plan at y: the nose bowed, the tail's corners rounded"""
    if y > NOSE - NOSE_DEEP:
        # (a superellipse: the bumper's face broad and nearly flat across, its corners tight, as the photographs
        # from ahead show; its very tip a little short of its middle)
        t = min(0.995, (y - (NOSE - NOSE_DEEP)) / NOSE_DEEP)
        return W * (1 - t ** 4.5) ** (1 / 4.5)
    if y < TAIL + TAIL_R:
        t = ((TAIL + TAIL_R) - y) / TAIL_R
        return W - TAIL_R + TAIL_R * math.sqrt(max(0.0, 1 - t ** 2.4))
    return W


def smooth(t):
    t = clamp(t, 0, 1)
    return t * t * (3 - 2 * t)


def fender_rise(y):
    """How far the fenders' crests stand over the hood's dome along it (m): nothing at the cowl, most over the front
    wheels, where from ahead the fenders rise at the hood's corners, then down to the bar at the nose"""
    return 0.085 * smooth((y - COWL) / 0.5) * (1 - smooth((y - 2.26) / 0.12))


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005) + (fender_rise(y) if y > COWL else 0.0)
    # (round the nose and the tail the sides' tucks and the fenders' shelf fade out: there the sides are the
    # bumpers' faces, which run smooth from the lamps to the intake, not folded along the shoulder or the shelf)
    k = 1 - 0.85 * max(clamp((y - (NOSE - 0.45)) / 0.35, 0, 1), clamp(((TAIL + 0.35) - y) / 0.3, 0, 1))
    bw = w - SHELF * (0.15 + 0.85 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    z3 = bot + min(0.17, 0.32 * h)
    shoulder = clamp(SHOULDER, z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.6
    # the glass: from the sill up to the roof's edge, leaning in (the A and C pillars lean in to the roof); along the
    # hood and the tail no glass, the edge down on the sill: the hood's dome
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.45, 0, 1)
    # the windows' top: just under the roof's edge over the doors, then down behind the rear door, under the C
    # pillar's steel, to the sill (the quarter window closing in a point)
    run = math.hypot(rw - bw, edge - belt)
    band = 0.02 + run * clamp((C_POST[0] - 0.02 - y) / 0.75, 0, 1)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    if belt > top:
        # the hood sunk between the fenders' crests: their inner slope down to it, the hood crowned in its middle
        dip, f = belt - top, min(1.0, (belt - top) / 0.03)
        upper = [(bw, belt), (bw - 0.06, belt - 0.5 * dip), (bw - 0.06 - 0.14 * f, top - 0.008 * f),
                 (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
    return [(0, bot), (w - 0.12 * (0.5 + 0.5 * k), bot), (w - 0.05 * k, z2), (w - 0.012 * k, z3), (w, shoulder),
            (w - 0.025 * k, z5), (bw, belt), *upper, (0, top)]


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


A_TIP = where(lambda y: glass_rise(y) > 0.09, 0.6, COWL)  # (the A pillar's foot: the steel closes the point ahead)
QUARTER_END = where(lambda y: glass_rise(y) > 0.04, -1.0, -2.1)  # (the quarter window's point, under the C pillar)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it (black over the
    # doors, the C pillar's steel behind), 8 the roof's rail, 9-10 the top (hood, windshield, roof, rear window, lip,
    # tail)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'trim' if y > 2.30 or y < -2.30 else 'under'  # (the nose's chin under the intake, the tail's diffuser)
    if seg == 1:
        return 'trim'
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
        if HEADER - 0.05 < y < HEADER:
            return 'trim'  # (the header between the windshield and the glass roof)
        if ROOF_END < y < HEADER - 0.05:
            return 'glass:roof'
        if REAR_GLASS < y < ROOF_END:
            return 'trim'
        if REAR_END < y < REAR_GLASS:
            return 'glass:back'
    return 'paint'


# the stations: close together where the body curves fast (the nose's and the tail's ends, the lip) and over the
# wheel arches, every window's
# and post's edge exactly on one
edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, HEADER - 0.05, ROOF_END, REAR_GLASS, REAR_END, A_TIP, *B_POST, *C_POST,
         QUARTER_END, -2.31, -2.32]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)  # (over the arches: their cut leaves no long slivers that
    # shade in streaks)
    y -= 0.008 if end < 0.1 else 0.02 if arch else 0.025 if (y > NOSE - NOSE_DEEP - 0.05 or y < TAIL + TAIL_R + 0.05) else 0.08
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.005 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008, cap_rings=(0.012, 0.03, 0.07),
                frame={None: 0.022, 'windshield': 0.05, 'roof': 0.04, 'back': 0.04})

# ---- the wheel arches: round, cut out of the sides (their wells dark)
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.56, s * 1.4, 'under'))
car.cut(body, *wells)
# (no bevel: rounded off, the arches' edges bent the paint's normals at them down into the wells, dark streaks up the
# fenders; where the paint meets the wells is a fold of two materials, kept sharp)
car.tidy(body, 75, weighted=False)  # (smooth over every fold but the materials' borders: the nose's
# sections turn fast, and a fold kept sharp there showed as a crease down the bumper)


def side_x(y, z):
    """The body's side's x (right) at y and height z, from its section (between the sill's foot and the glass's sill)"""
    pts = section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


# ---- the shut lines: the doors' edges, the frunk's along the fenders, laid on the skin
seams = []
for s in (1, -1):
    for y in (A_TIP - 0.04, (B_POST[0] + B_POST[1]) / 2, -0.94):
        pts = [(s * side_x(y, z), y, z) for z in (0.36 + k * 0.05 for k in range(15)) if z < lerp(BELT, y) - 0.03]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.05), y, lerp(BELT, y)) for y in [2.25 - 0.05 * k for k in range(int((2.25 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)


def front(ob, offset=0.002):
    return car.onto(ob, body, offset, axis='-Y')


def rear(ob, offset=0.002, wrap=False):
    """(wrap: each point to its nearest on the skin, round the tail's corners, where a ray from behind would miss)"""
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


AHEAD, BEHIND, AT_TAIL = NOSE + 0.4, TAIL - 0.4, -2.37  # (the planes the nose's and the tail's decals are drawn in, then laid on)

# ---- the nose: the slim light bar across under the hood's edge (the frunk's gap a dark line over it), swelling at
# either end into the lamps' brows, which droop a little round the corners; the head lamps low in the bumper: a gloss
# black slot each, pointed inboard, its lamp at its outer end (a bright reflector's bezel round a lit lens), the air
# curtain's dark line curving down from there to the intake's corner; the wide black intake low down, the lip under it

bar = [(x / 40 * 0.885, 0.69 + 0.035 * smooth((abs(x / 40) - 0.7) / 0.3)) for x in range(-40, 41)]  # (its ends rising
# up the fenders' corners)
front(car.decal('gap', [(x, z + 0.011) for x, z in bar], 0.005, AHEAD, 'gloss', 1), 0.0015)
front(car.decal('lightbar', bar, lambda x, z: 0.008 + 0.012 * smooth((abs(x) - 0.55) / 0.25), AHEAD, 'light', 1), 0.003)
for s in (1, -1):
    slot = [(s * 0.50, 0.572), (s * 0.795, 0.540), (s * 0.795, 0.600), (s * 0.50, 0.580)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=50), 0.002)
    # (the lamp: one lit capsule across the slot's outer end, its reflector's silver round it, a fainter strip of
    # LEDs along the slot's top edge inboard)
    front(car.decal('headlamp', [(s * 0.665, 0.570), (s * 0.775, 0.570)], 0.044, AHEAD, 'headlamp', 1), 0.003)
    front(car.decal('beam', [(s * 0.682, 0.570), (s * 0.758, 0.570)], 0.02, AHEAD, 'beam', 1), 0.0042)
    front(car.decal('beam', [(s * 0.55, 0.5785), (s * 0.645, 0.5805)], 0.004, AHEAD, 'beam', 1), 0.0035)
    # (the air curtain: straight down the face's outer edge from the lamp, where it turns to the side)
    front(car.decal('curtain', [(s * 0.80, 0.545), (s * 0.80, 0.29)], 0.011, AHEAD, 'pocket', 1), 0.002)
front(car.panel('intake', [(-0.62, 0.35), (0.62, 0.35), (0.66, 0.255), (-0.66, 0.255)], AHEAD, 'pocket', 1, n=60, m=6))
for z in (0.276, 0.302, 0.328):  # (the intake's mesh: its bars across)
    front(car.decal('intake_bar', [(-0.60, z), (0.60, z)], 0.005, AHEAD, 'trim', 1), 0.0028)
front(car.decal('lip', [(-0.86, 0.225), (0.86, 0.225)], 0.035, AHEAD, 'trim', 1))

# ---- the tail: the thin red bar across under the lip, the lamps at its ends round the corners; the black lower bumper
# with its red reflectors
TAILBAR = 1.035
rear(car.decal('taillamp', [(-0.93, TAILBAR - 0.004), (0, TAILBAR), (0.93, TAILBAR - 0.004)], 0.012, AT_TAIL, 'lamp', -1), 0.003, wrap=True)
for s in (1, -1):
    cluster = [(s * 0.60, TAILBAR - 0.012), (s * 0.95, TAILBAR - 0.022), (s * 0.95, TAILBAR + 0.026), (s * 0.60, TAILBAR + 0.012)]
    rear(car.panel('lamp_end', cluster, AT_TAIL, 'lamp', -1, n=30), 0.003, wrap=True)
    inner = [(s * 0.62, TAILBAR - 0.003), (s * 0.94, TAILBAR - 0.007), (s * 0.94, TAILBAR + 0.008), (s * 0.62, TAILBAR + 0.005)]
    rear(car.panel('lampbright', inner, AT_TAIL, 'lampbright', -1, n=30), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.78, 0.47), (s * 0.84, 0.47), (s * 0.84, 0.50), (s * 0.78, 0.50)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
    rear(car.panel('reverse', [(s * 0.56, 0.455), (s * 0.66, 0.455), (s * 0.66, 0.47), (s * 0.56, 0.47)], BEHIND, 'white', -1, n=8, m=2), 0.004)
# the tailgate's shut line: down either side of the plate's panel from under the lamps, and across over the bumper
gate = [(-0.80, 1.015), (-0.80, 0.66), (-0.77, 0.61), (0.77, 0.61), (0.80, 0.66), (0.80, 1.015)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('camera', [(-0.025, 0.86), (0.025, 0.86), (0.025, 0.885), (-0.025, 0.885)], BEHIND, 'gloss', -1, n=4, m=2), 0.0025)
# the tow hook's round cover, low on the bumper's right
front(car.decal('sensor', [(-0.55 + 0.022 * math.cos(a * math.pi / 8), 0.47 + 0.022 * math.sin(a * math.pi / 8)) for a in range(17)], 0.004, AHEAD, 'pocket', 1), 0.0025)

# ---- the doors' flush handles (a slim recess's outline near each door's back edge), the side cameras behind the
# front arches
for s in (1, -1):
    for y0, y1 in ((0.40, 0.19), (-0.66, -0.87)):
        z = lerp(BELT, (y0 + y1) / 2) - 0.12
        loop = [(y0, z - 0.017), (y1 + 0.015, z - 0.017), (y1, z), (y1 + 0.015, z + 0.017), (y0, z + 0.017), (y0, z - 0.017)]
        h = car.strip('handle', [(s * (side_x(y, zz) + 0.01), y, zz) for y, zz in loop], (s, 0, 0), 0.004, 'trim')
        car.onto(h, body, 0.0015)
    cam = car.box('side_camera', (0, 0, 0), (0.01, 0.055, 0.03), 'gloss', bevel=0.004)
    cam.location = (s * (side_x(1.04, 0.96) + 0.002), 1.04, 0.96)
rear(car.panel('bumper', [(-0.88, 0.58), (0.88, 0.58), (0.88, 0.40), (-0.88, 0.40)], BEHIND, 'trim', -1, n=80, m=8))

# ---- the mirrors: rounded body-coloured caps on a black foot at the front of the door's window, the glass in their back
for s in (1, -1):
    D = A_TIP - 0.03
    z = lerp(BELT, D) + 0.03
    x0 = side_x(D, z - 0.04) - 0.04
    inner = [(D + 0.01, z), (D - 0.16, z), (D - 0.17, z + 0.10), (D - 0.06, z + 0.11), (D + 0.01, z + 0.06)]
    outer = [(D - 0.05, z + 0.01), (D - 0.17, z + 0.01), (D - 0.17, z + 0.095), (D - 0.09, z + 0.10), (D - 0.05, z + 0.06)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.13), 'paint')
    car.bevelled(m, 0.028, 4, angle=20)
    car.smooth(m, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.11, 0.002, 0.07), 'glass')
    g.location = (s * (W + 0.075), D - 0.1735, z + 0.05)
    car.box('mirror_foot', (s * (x0 + 0.03), D - 0.05, z + 0.01), (0.06, 0.10, 0.03), 'trim', bevel=0.006)

car.strip('wiper', [(x, WS_FOOT - 0.06, lerp(TOP, WS_FOOT - 0.06)) for x in (-0.70, 0.36)], (0, 0.5, 1), 0.02, 'trim', lift=0.01)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.05, 0.40), (1.70, 2.60, 0.04), 'interior')
car.soft_box('interior_dash', (0, 1.00, 0.92), (1.70, 0.40, 0.16), 'interior', bevel=0.05)
car.soft_box('screen', (0.04, 0.80, 1.08), (0.40, 0.025, 0.25), 'screen', bevel=0.008, tilt=-0.25)
car.soft_box('interior_console', (0, 0.35, 0.60), (0.24, 0.80, 0.24), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_door', (s * (W - 0.12), -0.10, 0.82), (0.06, 2.20, 0.30), 'interior', bevel=0.02)
    car.soft_box('interior_seat', (s * 0.40, 0.25, 0.62), (0.50, 0.52, 0.13), 'interior', bevel=0.045)
    car.soft_box('interior_seatback', (s * 0.40, -0.05, 0.95), (0.48, 0.12, 0.62), 'interior', bevel=0.045, tilt=0.22)
    car.soft_box('interior_headrest', (s * 0.40, -0.13, 1.32), (0.26, 0.10, 0.17), 'interior', bevel=0.04, tilt=0.22)
car.soft_box('interior_bench', (0, -0.75, 0.64), (1.50, 0.50, 0.13), 'interior', bevel=0.045)
car.soft_box('interior_benchback', (0, -1.05, 0.94), (1.50, 0.12, 0.55), 'interior', bevel=0.045, tilt=0.25)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.018, major_segments=40, minor_segments=10,
                                     location=(-0.40, 0.66, 0.96), rotation=(math.radians(65), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))
car.smooth(steering, 60)

# ---- the wheels: road tyres, their tread shallow; 19" rims, ten graphite spokes over a dark dish
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='spoke', segments=48, tread=0.007, lug=0.0, spokes=10)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 10), ('rear', 150, 10, 10.5), ('side', 92, 2, 11), ('nose', 0, 6, 8.5), ('tail', 180, 8, 8.5),
             ('high', 140, 32, 9), ('photo', 20, 4, 8.5, 45), ('lamp', 24, 3, 3.2, 50, (0.45, 2.1, 0.6)),
             ('face', 0, 2, 4.6, 50, (0, 2.2, 0.55))]
    pick = os.environ.get('VIEWS')  # (a quick look: VIEWS=front renders that one only)
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    car.hero(renders, 'model-y', paint=dict(base=(0.30, 0.31, 0.32), rough=0.14, metal=0.8, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
