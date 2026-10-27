# tools/models/blender/tesla-cybertruck.py
# The Tesla Cybertruck, modelled by script (carlib.py): its satin stainless wedge of flat panels, the roof peaking over
# the front seats, the nose's corners cut back under a light bar that wraps round them, the black bumpers and skirt it
# stands on, chunky black arch flares with the all-terrain tyres out to their edges, the bed's side rails running down
# from the roof to the tail either side of its sunk roll-up cover, the shut lines cut into the steel, angular mirrors,
# six-spoke aero covers, and a cabin behind the glass. Real sizes (Tesla's data sheet): 5.68 m long, 2.03 m wide over
# the flares (no mirrors), 1.79 m high, a 3.81 m wheelbase, 285/65 R20 tyres (0.88 m across).
#   blender -b --factory-startup -P tools/models/blender/tesla-cybertruck.py -- <out.glb> [<render dir> [<out.blend>]]
# (tools/models/blender/tesla-cybertruck.blend is the model saved so, to open in Blender)
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.84, -2.84
APEX = 0.39  # (the roof's peak, over the B pillar)
W = 0.965  # half the body's width (the flares stand out to 1.015)
FLARE = 0.05  # (how far the flares stand out of the sides)
CORNER_FROM, CORNER_IN = 2.70, 0.27  # (the nose's corners folded back: the front's middle 1.39 m wide, then a
# facet either side out to the sides, 14 cm back)
AXLES = (1.905, -1.905)
TYRE_R, TYRE_W = 0.44, 0.30
TRACK = 2 * (W + FLARE - TYRE_W / 2 - 0.005)  # (the tyres out to the flares' edges)
CREASE = 1.22  # (where the sides fold in to the glass: the side windows' sill)
DIVIDER = 1.55  # (the black post between a quarter window and the door's, the mirror at its foot)
SKIRT = 0.68  # (the top of the black skirt along the sides)
BAND = 0.09  # (the steel band over the side glass, up the slope from the crease to the roof's edge, m)
BUMPER = 0.80  # (the top of the black front bumper, round the nose's corners to the front arches)
BUMPER_FROM = 2.45  # (where the skirt rises to it, ahead of the front arches)
BED_FROM, BED_DROP, RAIL = -0.88, 0.05, 0.09  # (the bed cover sunk 5 cm between rails 9 cm wide, behind the cab)


def lerp(points, y):
    """The polyline [(y, v)...] (y falling) at y"""
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y1 <= y <= y0:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return points[0][1] if y > points[0][0] else points[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


TOP = [(NOSE, 1.10), (APEX, 1.79), (TAIL, 1.17)]
# the bottom: the nose's upright steel face down to the bumper, the bumper's upright face down to its chin, the flat
# floor, the tailgate's foot
BOTTOM = [(NOSE, BUMPER), (NOSE - 0.02, 0.37), (2.62, 0.39), (BUMPER_FROM, 0.50), (-2.62, 0.52), (-2.74, 0.60), (TAIL, 0.62)]
ROOF_EDGE = [(NOSE, 0.68), (CORNER_FROM, 0.945), (APEX, 0.68), (TAIL, 0.90)]  # half-width of the top (the hood's
# corners folded back with the nose's)


def half_width(y):
    return W - CORNER_IN * clamp((y - CORNER_FROM) / (NOSE - CORNER_FROM), 0, 1)


def drop(y):
    return BED_DROP * clamp((BED_FROM - y) / 0.1, 0, 1)


def section(y):
    top, bot, xr, w = lerp(TOP, y), lerp(BOTTOM, y), lerp(ROOF_EDGE, y), half_width(y)
    crease = min(CREASE, top - 0.03)
    chamfer = min(0.07, (crease - bot) / 3) if bot < 0.6 else 0.0  # (the nose's face: square at the bumper)
    skirt = clamp(BUMPER if y > BUMPER_FROM + 0.04 else SKIRT, bot + chamfer, crease)
    d = drop(y)
    # (the side glass stops short of the roof's edge: a steel band of one width above the windows and up the A pillar,
    # its edges parallel to the windshield's)
    run = math.hypot(xr - w, top - crease)
    t = max(0.0, 1 - BAND / run) if run > 1e-6 else 0.0
    head = (w + (xr - w) * t, crease + (top - crease) * t)
    return [(0, bot), (w - chamfer, bot), (w, bot + chamfer), (w, skirt), (w, crease), head, (xr, top), (xr - RAIL, top),
            (xr - RAIL - 0.02, top - d), (0, top - d)]


def role(y, seg, side):
    # segments: 0 the floor (or the fascia), 1 its chamfer, 2 the skirt, 3 the side, 4 the side glass, 5 the steel
    # band over it, 6 the rail's top, 7 the bed's wall, 8 the top (hood, glass, cover)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'trim' if y > 2.62 or y < -2.62 else 'under'  # (the bumper's face and chin, black)
    if seg in (1, 2):
        return 'trim'
    if seg == 4:
        if 0.30 < y < 0.42:
            return 'trim'  # (the B pillar, black)
        if DIVIDER - 0.03 < y < DIVIDER + 0.03:
            return 'trim'  # (the post before the door's window)
        if DIVIDER + 0.03 < y < QUARTER_TIP:
            return f'glass:quarter{side}'
        if 0.42 < y < DIVIDER - 0.03:
            return f'glass:front{side}'
        if -0.85 < y < 0.30:
            return f'glass:rear{side}'
    if seg == 5:
        return 'paint'
    if seg >= 7 and y < BED_FROM - 0.05:
        return 'trim'  # (the bed's roll-up cover and the walls either side of it, matte black)
    if seg >= 6:
        if 0.50 < y < PILLAR:
            return 'glass:windshield'
        if -0.62 < y < 0.28:
            return 'glass:roof'
        if 0.28 < y < 0.50:
            return 'trim'  # (the header over the peak between the windshield and the glass roof, black)
    return 'paint'


def glass_run(y):
    """The slope from the sill to the roof's edge at y, m: the side glass is this less the band over it"""
    top, xr, w = lerp(TOP, y), lerp(ROOF_EDGE, y), half_width(y)
    return math.hypot(xr - w, top - min(CREASE, top - 0.03))


# The A pillars' foot, where the windshield begins: where the band of steel up the pillar (its edges parallel to the
# windshield's) comes down to the sill, so the quarter window closes in a straight-sided point there
lo, hi = DIVIDER, CORNER_FROM
for _ in range(40):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if glass_run(mid) > BAND + 0.003 else (lo, mid)
PILLAR = lo
# and the quarter window's glass stops where it is still 7 cm tall, short of that point (a frame wider than the glass
# folded into spikes there); the steel closes the point
lo, hi = DIVIDER, PILLAR
for _ in range(40):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if glass_run(mid) > BAND + 0.07 else (lo, mid)
QUARTER_TIP = lo

STATIONS = [NOSE, NOSE - 0.02, CORNER_FROM, 2.62, BUMPER_FROM + 0.04, BUMPER_FROM, PILLAR, QUARTER_TIP, DIVIDER + 0.03, DIVIDER - 0.03, 0.50, 0.42, APEX, 0.30, 0.28, -0.62, -0.85,
            BED_FROM, BED_FROM - 0.1, -2.62, -2.74, TAIL]
STATIONS = sorted(set(STATIONS), reverse=True)  # (nose to tail: one out of order folds the body through itself)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame={None: 0.035, 'windshield': 0.10, 'roof': 0.07, 'quarter1': 0.022, 'quarter-1': 0.022}, recess=0.01, sharp=(4, 5, 6),
                frame_role='trim')

# ---- the wheel arches: flat-topped trapezoids cut from the sides (the wells' walls trim), a chunky flare round each
wells = []
for yc in AXLES:
    outline = [(yc - 0.68, 0.0), (yc + 0.68, 0.0), (yc + 0.52, 0.88), (yc + 0.32, 1.02), (yc - 0.32, 1.02), (yc - 0.52, 0.88)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.62, s * 1.4, 'trim'))
    flare = [(yc - 0.60, 0.50), (yc - 0.52, 0.88), (yc - 0.32, 1.02), (yc + 0.32, 1.02), (yc + 0.52, 0.88), (yc + 0.60, 0.50)]
    f = car.band('flare', flare, W - 0.03, W + FLARE, 0.12, 'trim')
    car.bevelled(f, 0.012, 3)
    car.mirror_x(f)
car.cut(body, *wells)

# ---- the steel's edges rounded; the shut lines dark strips on it (cut in as grooves, their edges shaded as bright
# streaks, and a cut too many folded the body), the lamps in dark housings on its face
car.bevelled(body, 0.012, 4)
car.apply(body)

HOOD_N = (0, 1.79 - 1.10, NOSE - APEX)  # (the hood's normal: up, a little forward)
VAULT_N = (0, -(1.79 - 1.17), APEX - TAIL)  # (the vault's: up, a little back)
CUT_N = (NOSE - CORNER_FROM, CORNER_IN, 0)  # (the right cut corner's: out and ahead)


lines = []
for s in (1, -1):
    x = s * W
    lines += [
        ([(x, 1.47, SKIRT + 0.01), (x, 1.47, CREASE - 0.005)], (s, 0, 0)),  # the front door's leading edge
        ([(x, 0.33, SKIRT + 0.01), (x, 0.33, CREASE - 0.005)], (s, 0, 0)),  # the doors' meeting, at the B pillar
        ([(x, -0.86, SKIRT + 0.01), (x, -0.86, CREASE - 0.005)], (s, 0, 0)),  # the rear door's trailing edge
    ]
# the charge port's door, on the left behind the rear door
port = [(-W, -1.06, 0.96), (-W, -1.30, 0.96), (-W, -1.30, 1.06), (-W, -1.06, 1.06), (-W, -1.06, 0.96)]
lines.append((port, (-1, 0, 0)))
for points, normal in lines:
    car.strip('seam', points, normal, 0.0045, 'trim', lift=0.0012)
# the bed's roll-up cover: its slats across, every 11 cm (finer lines)
slats = []
y = BED_FROM - 0.14
while y > TAIL + 0.08:
    xr = lerp(ROOF_EDGE, y) - RAIL - 0.04
    z = lerp(TOP, y) - BED_DROP
    slats.append(([(-xr, y, z), (xr, y, z)], VAULT_N))
    y -= 0.11
for points, normal in slats:
    car.strip('slat', points, normal, 0.004, 'pocket', lift=0.0012)
# the light bar across the nose and back round its folded corners; the tail lamp across the tailgate's top
LIGHT = [(CORNER_FROM + 0.008, lerp(TOP, CORNER_FROM + 0.008) - 0.05), (NOSE, lerp(TOP, NOSE) - 0.05)]  # (to the sides' edge, no further)
front = []
for s in (1, -1):
    (y0, z0), (y1, z1) = LIGHT
    front.append(([(s * half_width(y0), y0, z0), (s * half_width(y1), y1, z1)], (s * CUT_N[0], CUT_N[1], 0)))
front.append(([(-half_width(NOSE), NOSE, LIGHT[1][1]), (half_width(NOSE), NOSE, LIGHT[1][1])], (0, 1, 0)))
CORNER = W - 0.03  # (the bar's ends, at the tail's corners)
TAIL_Z = 1.06
rear = [([(-CORNER, TAIL - 0.008, TAIL_Z), (CORNER, TAIL - 0.008, TAIL_Z)], (0, -1, 0))]
car.tidy(body)

# the lamps: their LEDs in a slim black housing standing just off the steel
car.bars('lightbar_housing', front, 0.034, 0.003, 'trim', inset=-0.001)
car.bars('lightbar', front, 0.024, 0.003, 'light', inset=-0.003)
# the tail: a black band across the tailgate's top, flush with the bed's cover, the red bar in it end to end and a
# its three bright lamps; a bright edge under it, over the plain steel of the tailgate
car.box('tail_band', (0, TAIL - 0.004, 1.06), (2 * W + 0.004, 0.012, 0.12), 'trim', bevel=0.003)
car.bars('tailbar', rear, 0.016, 0.003, 'lamp')  # (dim, all across: the tail light)
# its three bright lamps in it, at either end and in the middle (the brake and turn lamps)
for x0, x1 in ((-CORNER, -CORNER + 0.34), (-0.17, 0.17), (CORNER - 0.34, CORNER)):
    car.box('lampbright', ((x0 + x1) / 2, TAIL - 0.0125, TAIL_Z), (x1 - x0, 0.004, 0.022), 'lampbright')
car.box('tail_edge', (0, TAIL - 0.004, 0.997), (2 * W - 0.01, 0.010, 0.006), 'chrome')

# ---- the black bumpers: the rear one across the tail's foot; in the front one's face the grille's slats, the plate's
# recess, and amber lamps at its top corners under the steel
# the rear bumper: deep and black, standing out, the plate's recess in its top middle, red reflectors at its corners,
# a step in under it
car.box('bumper', (0, TAIL - 0.01, 0.55), (2 * W + 0.03, 0.12, 0.26), 'trim', bevel=0.014)
car.box('bumper_step', (0, TAIL + 0.03, 0.39), (2 * W - 0.12, 0.10, 0.07), 'pocket', bevel=0.01)
car.box('rear_plate_frame', (0, TAIL - 0.072, 0.59), (0.42, 0.006, 0.17), 'pocket', bevel=0.006)
for s in (1, -1):
    car.box('reflector', (s * (W - 0.10), TAIL - 0.072, 0.645), (0.12, 0.006, 0.022), 'lamp')
FACE = NOSE - 0.012  # (the bumper's face, nearly upright)
car.box('grille', (0, FACE, 0.50), (1.20, 0.014, 0.09), 'pocket')
car.box('grille_slat', (0, FACE + 0.006, 0.50), (1.18, 0.008, 0.006), 'trim')  # (its mesh: two rows of big cells)
for k in range(9):
    car.box('grille_post', (-0.56 + k * 0.14, FACE + 0.006, 0.50), (0.006, 0.008, 0.086), 'trim')
car.box('plate_frame', (0, FACE + 0.004, 0.68), (0.48, 0.012, 0.15), 'trim', bevel=0.01)
car.box('plate_recess', (0, FACE + 0.009, 0.68), (0.44, 0.006, 0.12), 'pocket', bevel=0.004)
for s in (1, -1):
    # (on the folded corners, just under the steel)
    x0, x1 = s * (half_width(NOSE) + 0.03), s * (W - 0.05)
    facet_y = lambda x: NOSE - (abs(x) - half_width(NOSE)) / CORNER_IN * (NOSE - CORNER_FROM)
    car.bars('turnlamp', [([(x0, facet_y(x0), 0.788), (x1, facet_y(x1), 0.788)], (s * CUT_N[0], CUT_N[1], 0))], 0.018, 0.003, 'amber', inset=-0.002)

# ---- the mirrors: black wedges sat on the door's window sill behind the post, their front sloping back to a flat
# top a third up the window, standing well out, the glass flush in the back face. The wiper parked along the windshield's foot.
for s in (1, -1):
    D = DIVIDER
    z = CREASE  # (on the sill)
    inner = [(D + 0.03, z + 0.005), (D - 0.19, z + 0.155), (D - 0.30, z + 0.16), (D - 0.31, z + 0.005)]
    outer = [(D - 0.01, z + 0.005), (D - 0.20, z + 0.14), (D - 0.29, z + 0.145), (D - 0.30, z + 0.005)]
    m = car.tapered('mirror', inner, s * (W - 0.005), outer, s * (W + 0.26), 'gloss')  # (glossy black plastic)
    car.bevelled(m, 0.008, 3, angle=20)
    car.smooth(m, 40)
    # the glass in the back face, flush with it and dark (a bright strip of it showed past the housing from ahead)
    g = car.box('mirror_glass', (0, 0, 0), (0.22, 0.002, 0.12), 'glass')
    g.location = (s * (W + 0.13), D - 0.3065, z + 0.08)
    g.rotation_euler = (0, 0, s * math.atan2(0.01, 0.265))
    car.box('camera', (s * (W + 0.008), 2.30, 1.06), (0.016, 0.05, 0.026), 'trim', bevel=0.005)

car.strip('wiper', [(x, PILLAR + 0.06, lerp(TOP, PILLAR + 0.06)) for x in (-0.72, 0.42)], HOOD_N, 0.022, 'trim', lift=0.012)

# ---- the cabin, seen through the glass
car.box('interior_floor', (0, 0.25, 0.56), (1.76, 2.40, 0.04), 'interior')
car.soft_box('interior_dash', (0, 1.38, 1.10), (1.76, 0.38, 0.14), 'interior', bevel=0.04)
car.soft_box('interior_dashtop', (0, 1.72, 1.08), (1.70, 0.50, 0.08), 'interior', bevel=0.03)  # (under the long windshield)
car.soft_box('screen', (0.04, 1.13, 1.30), (0.42, 0.025, 0.25), 'screen', bevel=0.008, tilt=-0.35)
car.soft_box('interior_console', (0, 0.72, 0.72), (0.24, 0.80, 0.26), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_door', (s * (W - 0.07), 0.25, 0.94), (0.06, 2.15, 0.30), 'interior', bevel=0.02)
    car.soft_box('interior_seat', (s * 0.42, 0.58, 0.76), (0.50, 0.52, 0.13), 'interior', bevel=0.045)
    car.soft_box('interior_seatback', (s * 0.42, 0.26, 1.10), (0.48, 0.12, 0.62), 'interior', bevel=0.045, tilt=0.22)
    car.soft_box('interior_headrest', (s * 0.42, 0.18, 1.48), (0.26, 0.10, 0.17), 'interior', bevel=0.04, tilt=0.22)
car.soft_box('interior_bench', (0, -0.42, 0.78), (1.55, 0.50, 0.13), 'interior', bevel=0.045)
car.soft_box('interior_benchback', (0, -0.74, 1.10), (1.55, 0.12, 0.55), 'interior', bevel=0.045, tilt=0.2)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.018, major_segments=40, minor_segments=10,
                                     location=(-0.42, 0.95, 1.10), rotation=(math.radians(65), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.scale = (1.0, 0.82, 1.0)  # (the squared-off steering wheel)
steering.data.materials.append(car.material('interior'))
car.smooth(steering, 60)
car.soft_box('interior_column', (-0.42, 1.08, 1.06), (0.07, 0.26, 0.07), 'interior', bevel=0.02, tilt=-0.4)

# ---- the wheels: chunky all-terrain tyres, their lugs down the sidewalls; flat aero covers faceted in seven petals
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, 0.285, segments=72, tread=0.024, lug=0.016, petals=7)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    car.hero(renders, 'cybertruck', views=[('front', 35, 7, 11), ('rear', 150, 10, 11.5), ('side', 92, 2, 12.5),
                                           ('close', 28, 4, 6.8), ('high', 140, 32, 9.5)])
