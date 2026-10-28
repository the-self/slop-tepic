# tools/models/blender/nissan-np300.py
# The Nissan NP300 (the D23 Navara as Mexico sells its work truck, the 2021 face), single cab with its cargo box,
# modelled by script (carlib.py): two lofts, the cab with its nose (the black bumper wrapping round to the front arches,
# the big black grille under the hood's lip, the hood, the raked windshield, the short roof, the upright back wall
# with its window) and the box behind it, a gap between (its sides, the rail along their tops, the tailgate, the bed
# hollowed out of it with its wheel tubs); the ladder frame, the leaf springs and the axle under them; laid onto that
# skin: the swept head lamps, the grille's mesh, the bumper's vents and intake, the tall tail lamps on the
# box's corners, the shut lines; the black step bumper behind, black mirrors and handles, the step into the box, four
# mud flaps, and 16" silver steel wheels. Real sizes (Nissan Mexicana's NP300 MY21 data sheet, the Pick-up): 5.332 m
# long, 1.790 m wide (no mirrors), 1.756 m high, a 3.150 m wheelbase, the box 2.391 x 1.594 m inside, 0.473 m deep,
# 1.133 m between the wheel tubs; 205 R16C tyres (0.73 m across); a 1.55 m track (the Navara single cab's on them).
#   blender -b --factory-startup -P tools/models/blender/nissan-np300.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()
# (the steel wheels' looks: silver paint on steel; their vent holes and hub dark)
car.LOOKS['hole'] = ((0.01, 0.01, 0.011), 0.6, 0.0)
car.HERO['hole'] = dict(base=(0.006, 0.006, 0.007), rough=0.6, metal=0.0)
car.HERO['projector'] = dict(base=(0.22, 0.23, 0.24), rough=0.3, metal=0.9)  # (the lamps' small projector, chrome-grey)
car.LOOKS['projector'] = ((0.3, 0.31, 0.32), 0.3, 0.9)
car.HERO['rim'] = dict(base=(0.62, 0.63, 0.64), rough=0.32, metal=0.85)
car.HERO['lamp'] = dict(base=(0.45, 0.01, 0.01), rough=0.08, metal=0.0, glow=((1.0, 0.03, 0.02), 0.5))  # (by day, unlit)

NOSE, TAIL = 2.666, -2.666
W = 0.895  # half the body's width (cab and box alike)
NOSE_R = 0.22  # (the nose's corners' radius in plan, at every height: round the face's, the bumper's and the hood's lip)
AXLES = (1.766, -1.384)  # (a 0.90 m front overhang)
TYRE_R, TYRE_W, RIM = 0.367, 0.205, 0.215  # (205 R16C: 0.73 m across; the steel wheel's face 0.43 m across)
TRACK = 1.55
ARCH = 0.45  # (the wheel arches' radius, round the axle)
SHELF = 0.065  # (how far the glass's sill sits in from the shoulder)
CROWN = 0.04
ROOF_HALF = 0.66
CAB_BACK = -0.01  # (the cab's back wall)
BOX_FRONT, BOX_REAR = -0.06, -2.55  # (the box's outer front wall and the tailgate's face; the step bumper behind it)
RAIL = 1.22  # (the top of the box's sides)
FLOOR = RAIL - 0.473  # (the bed's floor)
BOX_IN = 0.797  # (half the bed's inside width)
TUB_IN = 0.5665  # (half the width between the wheel tubs)
WS_FOOT, HEADER = 1.50, 0.62  # (the windshield's foot and top)
COWL = 1.535  # (the hood's back edge)
DOOR = (1.31, 0.17)  # (the door's leading and trailing edges)
SHOULDER = 1.03  # (the side's character line, the widest point)
BUMPER_SIDE = 0.855  # (the black bumper's top across the face, under the head lamps' inner ends)
BUMPER_END = 2.084  # (where its top, falling, meets the front arch)


def lerp(points, y):
    """The polyline [(y, v)...] (y falling) at y"""
    for (y0, v0), (y1, v1) in zip(points, points[1:]):
        if y1 <= y <= y0:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return points[0][1] if y > points[0][0] else points[-1][1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---- the cab: the centreline's top from the bumper's face up the grille under the hood's lip, the hood, the windshield,
# the short roof, to the back wall (the loft's end: its cap is the wall)
TOP = [(NOSE, 0.56), (2.664, 0.60), (2.657, 0.64), (2.647, 0.68), (2.636, 0.73), (2.624, 0.79), (2.6075, 0.855), (2.6036, 0.885), (2.598, 0.93), (2.590, 0.985), (2.582, 1.005), (2.570, 1.022), (2.55, 1.036), (2.50, 1.052),
       (2.40, 1.070), (2.0, 1.112), (1.62, 1.152), (1.53, 1.165), (WS_FOOT, 1.188), (1.25, 1.365), (1.0, 1.525), (0.80, 1.64), (HEADER, 1.71),
       (0.50, 1.738), (0.30, 1.752), (0.15, 1.756), (0.06, 1.75), (0.025, 1.742), (0.012, 1.73), (0.004, 1.70),
       (0.0, 1.62), (-0.003, 1.46), (-0.005, 1.30), (-0.007, 1.10), (-0.008, 0.90), (-0.009, 0.70), (CAB_BACK, 0.54)]
# (the back wall is the top falling there, its outline at each height the cab's section: the cap only a sliver)
BOTTOM = [(NOSE, 0.52), (2.664, 0.50), (2.65, 0.475), (2.62, 0.46), (2.50, 0.42), (2.30, 0.40), (2.0, 0.42),
          (1.40, 0.48), (0.02, 0.48), (CAB_BACK, 0.50)]
# the side's beltline: the hood's edge between the fenders, the glass's sill
BELT = [(NOSE, 0.55), (2.590, 0.98), (2.57, 1.012), (2.50, 1.042), (2.40, 1.060), (2.0, 1.105), (1.62, 1.145), (1.53, 1.162), (WS_FOOT, 1.178),
        (1.36, 1.19), (0.0, 1.235), (CAB_BACK, 1.235)]


def face_y(z):
    """How far forward the nose's face reaches at height z: the bumper's face, the grille's (set back), the hood's lip
    rounding back over its top"""
    if z <= TOP[0][1]:
        return NOSE
    for (y0, z0), (y1, z1) in zip(TOP, TOP[1:]):
        if y1 < 2.55:
            break
        if z0 <= z <= z1:
            return y0 + (y1 - y0) * (z - z0) / (z1 - z0) if z1 > z0 else y1
    return 2.55


def plan_x(x, y, z):
    """A section's point at (x, z) drawn in round the nose's corner: its corners, at each height, a superellipse ending
    flat on the face at that height (a corner rounded once in plan for every height met the set-back grille's face at
    an angle: a crease up the corner). The middle (|x| under W - NOSE_R) stays; what is out of it is drawn in."""
    flat = W - NOSE_R
    if x <= flat:
        return x
    t = (y - (face_y(z) - NOSE_R)) / NOSE_R
    if t <= 0:
        return x
    t = min(0.998, t)
    wz = NOSE_R * (1 - t ** 2.2) ** (1 / 2.2)
    return flat + (x - flat) * wz / NOSE_R


def half_width(y):
    """The cab's half-width in plan at y (the nose's corners are drawn in by plan_x, height by height): the back
    wall's corners rounded tight"""
    r = 0.03
    if y < CAB_BACK + r:
        t = min(0.995, ((CAB_BACK + r) - y) / r)
        return W - r + r * (1 - t ** 2) ** 0.5
    return W


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005)
    # (round the nose the sides' tucks fade out: there the sides are the bumper's and the face's)
    k = 1 - 0.85 * clamp((y - (NOSE - 0.36)) / 0.30, 0, 1)
    bw = w - SHELF * (0.15 + 0.85 * k)
    h = belt - bot
    z2 = bot + min(0.04, 0.10 * h)
    if y > BUMPER_END:
        # (the black bumper's top: under the lamps round the corners, then falling to meet the arch; ahead of where
        # the face drops under it, the whole section is bumper)
        # (as the photographs': level under the lamps' inner ends, rising round the corner under their lower edge,
        # then down to the arch)
        line = lerp([(NOSE, BUMPER_SIDE), (2.585, 0.862), (2.51, 0.888), (2.40, 0.918), (2.30, 0.928), (2.22, 0.90),
                     (BUMPER_END, 0.685)], y)
        z2 = bot + min(0.075, 0.25 * h)  # (the bumper's lower edge tucked under, round)
        z3 = max(min(line, belt - 0.008), z2 + 0.004)
        shoulder = clamp(SHOULDER, z3 + 0.004, belt - 0.004)
    else:
        z3 = clamp(bot + 0.11, z2 + 0.15 * h, bot + 0.55 * h)  # (the sill's)
        shoulder = clamp(SHOULDER, z3 + 0.15 * h, belt - min(0.12, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.55
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.40, 0, 1)
    run = math.hypot(rw - bw, edge - belt)
    band = 0.05  # (the door's painted frame over the glass)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    # the top: over the cab the roof's rail and crown; along the hood its two raised creases, running back from the
    # grille's ends, and the flat between them (no ridge down the middle)
    rail, mid = (rw - 0.06, top - crown * 0.3), (rw * 0.45, top - crown * 0.06)
    f = hood_creases(y)
    if f > 0:
        cx = crease_x(y)
        rail = (rail[0] + (cx - rail[0]) * f, rail[1] + (top + 0.016 - rail[1]) * f)
        mid = (mid[0] + (0.24 - mid[0]) * f, mid[1] + (top + 0.003 - mid[1]) * f)
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), rail, mid]
    if y > BUMPER_END:  # (the bumper's lower corner rounded under, not a square facet)
        tuck = 1 - 0.6 * k
        low = [(w - 0.11 * tuck - 0.04, bot), (w - 0.035 * tuck - 0.005, z2)]
    else:
        low = [(w - 0.07 * (0.4 + 0.6 * k), bot), (w - 0.03 * k, z2)]
    pts = [(0, bot), *low, (w - 0.012 * k, z3), (w, shoulder), (w - 0.022 * k, z5), (bw, belt), *upper, (0, top)]
    return [(plan_x(x, y, z), z) if x > 0 else (x, z) for x, z in pts]


def hood_creases(y):
    """How much of the hood's creases the section at y has (0 to 1): from just behind the hood's lip to the cowl"""
    return clamp((y - WS_FOOT) / 0.06, 0, 1) * clamp((2.575 - y) / 0.05, 0, 1)


def crease_x(y):
    """The hood's crease's x: over the grille's end at the front, a little in at the cowl"""
    return 0.49 - 0.05 * clamp((2.55 - y) / (2.55 - COWL), 0, 1)


def glass_rise(y):
    s = section(y)
    return s[7][1] - s[6][1]


def where(f, lo, hi):
    """The y between lo and hi where f turns false (true at lo)"""
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


A_TIP = where(lambda y: glass_rise(y) > 0.10, 0.9, WS_FOOT)  # (the A pillar's foot: the steel closes the point ahead)
FACE = 2.55  # (ahead of this the top is the nose's face)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's corner, 2 the lower side (the bumper round the nose), 3 the side to the
    # shoulder, 4-5 over it to the glass's sill, 6 the side glass, 7 the frame over it, 8 the roof's rail, 9-10 the top
    if seg < 0:
        return 'trim' if y > 0 else 'paint'
    if seg == 0:
        return 'trim' if y > NOSE - 0.25 else 'under'
    if y > FACE and lerp(TOP, y) < BUMPER_SIDE + 0.03:
        return 'trim'  # (the bumper's face, and the face behind the lamps' lower edge)
    if seg in (1, 2):
        return 'trim' if y > BUMPER_END else 'paint'
    if seg == 6:
        if DOOR[1] < y < A_TIP:
            return f'glass:door{side}'
        return 'paint'
    if seg >= 9 and HEADER < y < WS_FOOT:
        return 'glass:windshield'
    if seg >= 8 and WS_FOOT < y < COWL:
        return 'trim'  # (the cowl's black cover between the hood and the windshield)
    return 'paint'


edges = [y for y, _ in TOP] + [A_TIP, DOOR[1], BUMPER_END, 2.51, 2.40, 2.30, 2.22, COWL, CAB_BACK + 0.02]
grid = []
y = NOSE
while y > CAB_BACK:
    grid.append(y)
    end = NOSE - y
    arch = abs(y - AXLES[0]) < ARCH + 0.05
    y -= 0.008 if end < 0.06 else 0.02 if arch else 0.015 if end < NOSE_R + 0.05 else 0.06
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.004 for e in edges)]), reverse=True)
cab = car.loft('cab', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008,
               frame={None: 0.022, 'windshield': 0.045}, sharp=(4,))


def crease_sharp(ob):
    """The hood's creases kept sharp (smoothed, a crease that low melts away): the edges along the loft between its
    sections' crease points, where the hood has them"""
    pts = set()
    for y in STATIONS:
        if hood_creases(y) > 0.3:
            x, z = section(y)[9]
            pts |= {(round(sx * x, 4), round(y, 4), round(z, 4)) for sx in (1, -1)}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    key = lambda v: (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))
    for e in bm.edges:
        a, b = e.verts
        if key(a) in pts and key(b) in pts and abs(a.co.y - b.co.y) > 1e-4:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


crease_sharp(cab)

# ---- the box: its sides up to the rail, the front wall, the tailgate; the bed hollowed out of it
BOX_BOT = 0.53
BOX_R = 0.05  # (its corners' radius in plan)


def box_half(y):
    if y > BOX_FRONT - BOX_R:
        t = min(0.995, (y - (BOX_FRONT - BOX_R)) / BOX_R)
        return W - BOX_R + BOX_R * (1 - t ** 2) ** 0.5
    if y < BOX_REAR + BOX_R:
        t = min(0.995, ((BOX_REAR + BOX_R) - y) / BOX_R)
        return W - BOX_R + BOX_R * (1 - t ** 2) ** 0.5
    return W


def box_section(y):
    w = box_half(y)
    k = clamp((w - (W - BOX_R)) / BOX_R, 0, 1)  # (1 along the sides, less round the corners)
    return [(0, BOX_BOT), (w - 0.04 * k, BOX_BOT), (w - 0.012 * k, BOX_BOT + 0.04), (w - 0.010 * k, 0.80), (w, SHOULDER),
            (w - 0.018 * k, RAIL - 0.03), (w - 0.03 * k, RAIL), (0.5 * w, RAIL), (0, RAIL)]


def box_role(y, seg, side):
    return 'under' if seg == 0 else 'paint'


bs = [BOX_FRONT + 0.0]
y = BOX_FRONT
while y > BOX_REAR:
    near = min(BOX_FRONT - y, y - BOX_REAR)
    y -= 0.008 if near < BOX_R else 0.03 if abs(y - AXLES[1]) < ARCH + 0.05 else 0.08
    bs.append(max(y, BOX_REAR))
BS = sorted(set(round(v, 5) for v in bs), reverse=True)
box = car.loft('box', [(y, box_section(y)) for y in BS], box_role, cap_rings=(0.02, 0.06), sharp=(4,))

# ---- the wheel arches, cut from the cab (the front ones) and the box (the rear ones, with the bed) in one cut each
def arch(yc, x0, x1, role='under'):
    a = [(yc + ARCH * math.cos(math.radians(d)), TYRE_R + ARCH * math.sin(math.radians(d))) for d in range(0, 181, 10)]
    return car.prism('well', [(yc + ARCH, -0.2)] + a + [(yc - ARCH, -0.2)], x0, x1, role)


def cut_overlapping(body, *cutters):
    """carlib.cut for cutters that overlap each other (the bed and the rear arches): joined, they cross themselves, and
    the exact solver needs to be told (without it the bed stayed shut)"""
    bpy = car.bpy
    bpy.ops.object.select_all(action='DESELECT')
    for c in cutters:
        c.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join()
    mod = body.modifiers.new('cut', 'BOOLEAN')
    mod.operation, mod.object, mod.solver, mod.material_mode = 'DIFFERENCE', cutters[0], 'EXACT', 'TRANSFER'
    mod.use_self = True
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutters[0])


car.cut(cab, *[arch(AXLES[0], s * 0.50, s * 1.3) for s in (1, -1)])
bed = car.box('bed', (0, (BOX_FRONT - 0.04 + BOX_REAR + 0.06) / 2, FLOOR + 0.5), (2 * BOX_IN, (BOX_FRONT - 0.04) - (BOX_REAR + 0.06), 1.0), 'paint')
cut_overlapping(box, bed, *[arch(AXLES[1], s * 0.55, s * 1.3) for s in (1, -1)])
car.tidy(cab, 75, weighted=False)
car.tidy(box, 60, weighted=False)
for p in box.data.polygons:  # (the tailgate's and the front wall's flat faces flat: smoothed, the tailgate's n-gon
    # shaded in streaks)
    if abs(p.normal.y) > 0.98:
        p.use_smooth = False

# the wheel tubs inside the bed: a box over the arch, 0.25 m over the floor, its inner wall down to the box's floor
for s_ in (1, -1):
    yc = AXLES[1]
    tub = [(yc - 0.47, 0.83), (yc - 0.47, FLOOR + 0.20), (yc - 0.42, FLOOR + 0.25), (yc + 0.42, FLOOR + 0.25),
           (yc + 0.47, FLOOR + 0.20), (yc + 0.47, 0.83)]
    car.smooth(car.prism('tub', tub, s_ * 0.545, s_ * (BOX_IN + 0.004), 'paint'), 40)
    car.prism('tub_wall', [(yc - 0.47, BOX_BOT + 0.002), (yc + 0.47, BOX_BOT + 0.002), (yc + 0.47, 0.84), (yc - 0.47, 0.84)],
              s_ * 0.545, s_ * 0.56, 'paint')


def side_x(y, z):
    """The cab's side's x (right) at y and height z, from its section (between the sill's corner and the glass's sill)"""
    pts = section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


def box_x(y, z):
    pts = box_section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


AHEAD, BEHIND = NOSE + 0.4, TAIL - 0.4


def side_panel(name, corners, side, role, n=8, m=4):
    """A flat quad [(y, z)] * 4 standing beside the car (x = side * (W + 0.1)) facing out: laid onto a side by onto()"""
    (ay, az), (by, bz), (cy, cz), (dy, dz) = corners
    bm = bmesh.new()
    x = side * (W + 0.1)
    grid = [[bm.verts.new((x, ay + (by - ay) * u + ((dy + (cy - dy) * u) - (ay + (by - ay) * u)) * v,
                           az + (bz - az) * u + ((dz + (cz - dz) * u) - (az + (bz - az) * u)) * v))
             for u in (i / n for i in range(n + 1))] for v in (j / m for j in range(m + 1))]
    for j in range(m):
        for i in range(n):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.normal_update()
            if f.normal.x * side < 0:
                f.normal_flip()
    return car.to_object(name, bm, [role])


def front(ob, offset=0.002, wrap=False):
    return car.onto(ob, cab, offset, axis=None if wrap else '-Y')


def rear(ob, target, offset=0.002, wrap=False):
    return car.onto(ob, target, offset, axis=None if wrap else 'Y')


# ---- the nose: the big black grille under the hood's lip (its frame, its mesh), the swept head lamps at
# the corners (a gloss black housing, the chrome reflector, the lamps' bowls, the amber turn lamp wrapping round the
# corner), the bumper's corner vents, its top's edge, the plate's place and the intake under it
GRILLE = [(-0.40, 0.668), (0.40, 0.668), (0.49, 0.80), (0.50, 0.982), (-0.50, 0.982), (-0.49, 0.80)]


def poly_panel(name, outline, plane_y, role, facing, rings=4):
    """A flat convex polygon [(x, z)...] in the plane y = plane_y facing `facing`, in rings of quads round its middle
    (a fan's long thin triangles bent badly laid onto a curve): laid on by onto()"""
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    # (each edge cut in pieces 4 cm long or less, so the rings follow the face's curve)
    pts = []
    for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]):
        n = max(1, int(math.hypot(x1 - x0, z1 - z0) / 0.04))
        pts += [(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n) for i in range(n)]
    bm = bmesh.new()
    mid = bm.verts.new((cx, plane_y, cz))
    loops = [[bm.verts.new((cx + (x - cx) * (j + 1) / rings, plane_y, cz + (z - cz) * (j + 1) / rings)) for x, z in pts]
             for j in range(rings)]
    n = len(pts)
    faces = [bm.faces.new((mid, loops[0][i], loops[0][(i + 1) % n])) for i in range(n)]
    for l0, l1 in zip(loops, loops[1:]):
        faces += [bm.faces.new((l0[i], l1[i], l1[(i + 1) % n], l0[(i + 1) % n])) for i in range(n)]
    for f in faces:
        f.normal_update()
        if f.normal.y * facing < 0:
            f.normal_flip()
    return car.to_object(name, bm, [role])


def inset(outline, d):
    """The convex polygon `outline` shrunk d m toward its middle (roughly: each point along its line to the middle)"""
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    out = []
    for x, z in outline:
        r = math.hypot(x - cx, z - cz)
        out.append((x - (x - cx) * d / r, z - (z - cz) * d / r))
    return out


def grille_half(z):
    """The grille's half-width at height z"""
    return lerp([(1.0, 0.50), (0.80, 0.49), (0.668, 0.40)], z) if z > 0.668 else 0.40


LAY = 2.625  # (the plane the face's decals are drawn in, just ahead of the grille, and laid on its nearest)
front(poly_panel('grille', GRILLE, AHEAD, 'pocket', 1), 0.003)
# the grille's mesh: rows of slats 5 cm apart, and between each two short slanted ribs, every 9 cm, the rows offset by
# half a cell and leaning the other way, so the cells read as the photographs' offset trapezoids (no badge: the game
# shows no makes)
rows = [0.695 + 0.05 * i for i in range(6)]
for z in rows:
    hw = grille_half(z) - 0.03
    front(car.decal('grille_slat', [(-hw, z), (hw, z)], 0.012, AHEAD, 'gloss', 1, step=0.05), 0.0065)
for i, (z0, z1) in enumerate(zip(rows, rows[1:])):
    hw = min(grille_half(z0), grille_half(z1)) - 0.05
    lean = 0.012 if i % 2 else -0.012
    x = -hw + (0.045 if i % 2 else 0.0)
    while x <= hw:
        front(car.decal('grille_rib', [(x - lean, z0 + 0.004), (x + lean, z1 - 0.004)], 0.011, AHEAD, 'gloss', 1, step=0.05), 0.0065)
        x += 0.09
front(car.decal('grille_frame', GRILLE + GRILLE[:1], 0.04, AHEAD, 'gloss', 1, step=0.04), 0.0075)
front(car.panel('grille_top', [(-0.505, 0.948), (0.505, 0.948), (0.505, 0.985), (-0.505, 0.985)], AHEAD, 'gloss', 1, n=20, m=1), 0.0078)
CORNER = (0.675, 2.38, 0.22, 0.22)  # (the quarter ellipse the lamps are bent round before they are laid on: where it
# leaves the face (x), its middle's y, its radii across and along: the nose's corner at the lamps' height)


def round_corner(ob):
    """A decal drawn flat at y = LAY with the corner unrolled (|x| past the arc's start running on round it and then back
    along the side) bent round the nose's corner, so one lamp lies on face, corner and fender alike"""
    x0, yc, rx, ry = CORNER
    r = (rx + ry) / 2  # (the arc's length a quarter of a circle this round)
    for v in ob.data.vertices:
        e = abs(v.co.x) - x0
        if e <= 0:
            continue
        sign = 1 if v.co.x > 0 else -1
        a = min(e / r, math.pi / 2)
        back = max(0.0, e - r * math.pi / 2)
        v.co.x = sign * (x0 + rx * math.sin(a))
        v.co.y = yc + ry * math.cos(a) - back
    ob.data.update()
    return ob


def strip_panel(name, x0, x1, lower, upper, plane_y, role, facing, step=0.01, m=3):
    """A flat band in the plane y = plane_y from x0 to x1 between the heights lower(x) and upper(x) (polylines [(x, z)...],
    x rising), in columns `step` m wide (so it bends round a corner without its faces cutting across it)"""
    bm = bmesh.new()
    n = max(1, int(abs(x1 - x0) / step))
    cols = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        lo, hi = lerp_x(lower, abs(x)), lerp_x(upper, abs(x))
        cols.append([bm.verts.new((x, plane_y, lo + (hi - lo) * j / m)) for j in range(m + 1)])
    for a, b in zip(cols, cols[1:]):
        for j in range(m):
            f = bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            f.normal_update()
            if f.normal.y * facing < 0:
                f.normal_flip()
    return car.to_object(name, bm, [role])


def lerp_x(points, x):
    """The polyline [(x, v)...] (x rising) at x"""
    for (x0, v0), (x1, v1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    return points[0][1] if x < points[0][0] else points[-1][1]


# (the head lamp's edges, unrolled: x past 0.70 is round the corner and back along the fender)
# (the head lamp's edges, unrolled: x past 0.675 is round the corner, and past 1.02 back along the fender; its top
# under the hood's lip across the face, rising with the hood's edge along the fender)
LAMP_LO = [(0.50, 0.848), (0.62, 0.852), (0.75, 0.864), (0.88, 0.882), (1.00, 0.912), (1.10, 0.950), (1.17, 0.998)]
LAMP_HI = [(0.50, 0.978), (0.78, 0.976), (0.92, 0.988), (1.03, 1.004), (1.17, 1.010)]
def oval(ob, cx, k):
    """A disc drawn flat at y = LAY stretched k times across about x = cx"""
    for v in ob.data.vertices:
        v.co.x = cx + (v.co.x - cx) * k
    ob.data.update()
    return ob


for s in (1, -1):
    # (the lamp: an angular unit 0.12 m tall at its inner end beside the grille's top corner, tapering as it runs round
    # the corner and back along the fender under the hood's edge: a dark housing, the chrome reflector over most of it,
    # the projector's bowl and lens inboard, the amber turn lamp at its outer end; all filled, no outlines)
    front(round_corner(strip_panel('lamp_housing', s * 0.50, s * 1.17, LAMP_LO, LAMP_HI, LAY, 'gloss', 1)), 0.003, wrap=True)
    lo = [(x, z + 0.010) for x, z in LAMP_LO]
    hi = [(x, z - 0.009) for x, z in LAMP_HI]
    # (as the photographs show it from ahead: a dark smoked housing filling most of it, a small chrome-grey projector
    # inboard, a slim light strip along its upper edge, the amber turn lamp at the tail; no big bright bowl, which read
    # as a cartoon's eyes)
    top_lo = [(x, z - 0.024) for x, z in hi]
    front(round_corner(strip_panel('headlamp_strip', s * 0.53, s * 0.97, top_lo, hi, LAY, 'headlamp', 1, m=1)), 0.0045, wrap=True)
    front(round_corner(strip_panel('amber', s * 0.97, s * 1.13, lo, hi, LAY, 'amber', 1, m=2)), 0.0045, wrap=True)
    front(round_corner(oval(car.disc('projector', (s * 0.62, 0.902), 0.021, LAY, 'projector', 1), s * 0.62, 1.25)), 0.0050, wrap=True)
front(car.panel('intake', [(-0.42, 0.47), (0.42, 0.47), (0.38, 0.545), (-0.38, 0.545)], AHEAD, 'pocket', 1, n=24, m=3), 0.003)
front(car.decal('bumper_lip', [(-0.80, 0.462), (0.80, 0.462)], 0.012, AHEAD, 'gloss', 1), 0.002)

# ---- the cab's shut lines: the door's edges, the hood's along the fenders and across under the windshield
seams = []
for s in (1, -1):
    for y in DOOR:
        pts = [(s * side_x(y, z), y, z) for z in (0.52 + k * 0.05 for k in range(15)) if z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.0045, 'trim'))
    hood = [(s * plan_x(half_width(y) - SHELF - 0.015, y, lerp(BELT, y)), y, lerp(BELT, y) + 0.004) for y in [2.50 - 0.05 * k for k in range(22)] if y > COWL + 0.01]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.0045, 'trim'))
seams.append(car.strip('seam', [(x, COWL, lerp(TOP, COWL)) for x in (-0.70, 0.70)], (0, 0, 1), 0.0045, 'trim'))
for ob in seams:
    car.onto(ob, cab, 0.0015)

# ---- the back wall's window, black-framed
rear(car.panel('rear_frame', [(-0.60, 1.26), (0.60, 1.26), (0.61, 1.62), (-0.61, 1.62)], CAB_BACK - 0.3, 'trim', -1, n=20), cab, 0.002)
rear(car.panel('rear_window', [(-0.58, 1.28), (0.58, 1.28), (0.59, 1.60), (-0.59, 1.60)], CAB_BACK - 0.3, 'glass', -1, n=20), cab, 0.003)

# ---- the box's tail: the tall lamps on its corners (red, the white reversing lamp low inboard), the tailgate's shut
# lines, its latch; on the left side the fuel door, the step ahead of each rear wheel
for s in (1, -1):
    lamp = car.panel('lamp', [(s * 0.74, 0.80), (s * 0.905, 0.80), (s * 0.905, 1.17), (s * 0.74, 1.17)], BOX_REAR - 0.005, 'lamp', -1, n=10, m=16)
    rear(lamp, box, 0.003, wrap=True)
    rev = car.panel('reverse', [(s * 0.745, 0.905), (s * 0.835, 0.905), (s * 0.835, 1.005), (s * 0.745, 1.005)], BEHIND, 'white', -1, n=6, m=6)
    rear(rev, box, 0.0045)
    for z in (0.90, 1.01):  # (the lens's ridges either side of the reversing lamp)
        rear(car.decal('lamp_rib', [(s * 0.745, z), (s * 0.89, z)], 0.008, BOX_REAR - 0.005, 'gloss', -1), box, 0.0052, wrap=True)
    rear(car.decal('gate_seam', [(s * 0.735, 0.66), (s * 0.735, 1.215)], 0.005, BEHIND, 'trim', -1), box, 0.0015)
    car.onto(side_panel('step', [(AXLES[1] + 0.47, 0.548), (AXLES[1] + 0.70, 0.548), (AXLES[1] + 0.70, 0.645), (AXLES[1] + 0.47, 0.645)], s, 'pocket'), box, 0.003)
    # (the rail's lip along the bed's inside, a dark line under it)
    car.onto(car.strip('rail_lip', [(s * BOX_IN, y, RAIL - 0.022) for y in (BOX_FRONT - 0.04, AXLES[1], BOX_REAR + 0.06)], (-s, 0, 0), 0.012, 'trim'), box, 0.0015)
rear(car.decal('gate_seam', [(-0.735, 0.66), (0.735, 0.66)], 0.005, BEHIND, 'trim', -1), box, 0.0015)
rear(car.panel('latch', [(-0.10, 1.12), (0.10, 1.12), (0.10, 1.17), (-0.10, 1.17)], BEHIND, 'pocket', -1, n=6), box, 0.002)
fuel = [(-box_x(y, z), y, z) for y, z in ((BOX_FRONT - 0.30, 0.90), (BOX_FRONT - 0.30, 1.0), (BOX_FRONT - 0.48, 1.0), (BOX_FRONT - 0.48, 0.90), (BOX_FRONT - 0.30, 0.90))]
car.onto(car.strip('fuel', fuel, (-1, 0, 0), 0.004, 'trim'), box, 0.0012)  # (the fuel door's edge, on the left)
car.onto(car.strip('gate_top', [(x, BOX_REAR - 0.001, RAIL - 0.012) for x in (-0.80, 0.80)], (0, -1, 0), 0.006, 'trim'), box, 0.0012)

# ---- the arches' lips, standing a little out of the sides round the wheels
for yc, (a0, a1) in ((AXLES[0], (48, 162)), (AXLES[1], (25, 155))):
    lip = [(yc + (ARCH + 0.004) * math.cos(math.radians(d)), TYRE_R + (ARCH + 0.004) * math.sin(math.radians(d))) for d in range(a1, a0 - 1, -6)]
    f = car.band('paint_lip', lip, W - 0.04, W + 0.010, 0.045, 'paint')
    car.smooth(f, 40)
    car.mirror_x(f)

# ---- the black step bumper behind, the plate's recess in it
car.box('rear_bumper', (0, (BOX_REAR + TAIL) / 2 + 0.01, 0.53), (1.62, TAIL - BOX_REAR - 0.02, 0.18), 'trim', bevel=0.02)
car.box('rear_step', (0, (BOX_REAR + TAIL) / 2 + 0.01, 0.625), (1.40, -(TAIL - BOX_REAR - 0.02) + 0.004, 0.012), 'pocket')
for s in (1, -1):
    car.box('bumper_end', (s * 0.83, BOX_REAR - 0.04, 0.56), (0.10, 0.08, 0.14), 'trim', bevel=0.02)

# ---- the mirrors: black, on the door's sill at the A pillar, the glass in their back; the black door handles
for s in (1, -1):
    D = A_TIP - 0.05
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.05) - 0.02
    arm = car.tapered('mirror_arm', [(D + 0.02, z - 0.02), (D - 0.10, z - 0.02), (D - 0.10, z + 0.05), (D + 0.02, z + 0.05)], s * x0,
                      [(D - 0.02, z - 0.0), (D - 0.09, z - 0.0), (D - 0.09, z + 0.04), (D - 0.02, z + 0.04)], s * (W + 0.07), 'trim')
    head = car.box('mirror', (s * (W + 0.15), D - 0.07, z + 0.10), (0.20, 0.09, 0.19), 'trim', bevel=0.03)
    car.box('mirror_glass', (s * (W + 0.15), D - 0.1155, z + 0.10), (0.18, 0.002, 0.17), 'glass')
    hz = 1.07
    hy = DOOR[1] + 0.16
    car.box('handle', (s * (side_x(hy, hz) + 0.006), hy, hz), (0.014, 0.17, 0.035), 'trim', bevel=0.006)

car.strip('wiper', [(x, WS_FOOT - 0.06, lerp(TOP, WS_FOOT - 0.06) + 0.01) for x in (-0.66, 0.08)], (0, 0.6, 1), 0.02, 'trim', lift=0.01)
car.strip('wiper', [(x, WS_FOOT - 0.06, lerp(TOP, WS_FOOT - 0.06) + 0.01) for x in (0.10, 0.70)], (0, 0.6, 1), 0.02, 'trim', lift=0.01)

# ---- the mud flaps behind each wheel
for yc in AXLES:
    for s in (1, -1):
        car.box('flap', (s * (TRACK / 2 + 0.02), yc - ARCH - 0.02, 0.36), (0.22, 0.012, 0.36), 'trim', bevel=0.004)

# ---- under it: the ladder frame's rails, the cab's and box's floor pans, the leaf springs, the axle and its
# differential, the fuel tank and the exhaust (all within the wheels' inner faces: prepare-made.mjs takes what lies in a
# wheel's cylinder out to its side for the wheel)
for s in (1, -1):
    car.box('frame', (s * 0.46, -0.10, 0.42), (0.07, 4.70, 0.15), 'under')
    car.box('spring', (s * 0.50, AXLES[1], 0.36), (0.06, 1.25, 0.05), 'under')
car.box('axle', (0, AXLES[1], TYRE_R), (1.06, 0.10, 0.10), 'under')
car.box('diff', (0, AXLES[1] + 0.04, TYRE_R - 0.02), (0.28, 0.24, 0.24), 'under', bevel=0.04)
car.box('tank', (0, -0.55, 0.46), (0.7, 0.55, 0.24), 'under', bevel=0.03)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, 0.70, 0.52), (1.60, 1.40, 0.04), 'interior')
car.soft_box('interior_dash', (0, 1.25, 1.08), (1.60, 0.40, 0.18), 'interior', bevel=0.04)
car.soft_box('interior_seat', (0, 0.45, 0.80), (1.40, 0.50, 0.14), 'interior', bevel=0.04)
car.soft_box('interior_seatback', (0, 0.15, 1.12), (1.40, 0.12, 0.58), 'interior', bevel=0.04, tilt=0.18)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.19, minor_radius=0.018, major_segments=32, minor_segments=8,
                                     location=(-0.38, 1.00, 1.18), rotation=(math.radians(62), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))


# ---- the wheels: 205 R16C tyres; silver steel wheels, a dished face with a ring of vent holes round the hub, its
# six nuts
def disc_x(name, x, side, y, z, r, role, n=12, rings=2, depth=0.0):
    """A flat filled disc of radius r round (y, z) in the plane at x, facing `side` along x"""
    bm = bmesh.new()
    mid = bm.verts.new((x, y, z))
    loops = [[bm.verts.new((x, y + r * (j + 1) / rings * math.cos(2 * math.pi * i / n), z + r * (j + 1) / rings * math.sin(2 * math.pi * i / n)))
              for i in range(n)] for j in range(rings)]
    faces = [bm.faces.new((mid, loops[0][i], loops[0][(i + 1) % n])) for i in range(n)]
    for a, b in zip(loops, loops[1:]):
        faces += [bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])) for i in range(n)]
    for f in faces:
        f.normal_update()
        if f.normal.x * side < 0:
            f.normal_flip()
    return car.to_object(name, bm, [role])


def steel_wheel(x, yc):
    side = 1 if x > 0 else -1
    tyre, cover, cap = car.wheel('wheel', x, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.009, lug=0.0, petals=8)
    for ob in (cover, cap):
        car.bpy.data.objects.remove(ob)
    face = x + side * 0.49 * TYRE_W
    n = 48
    # (the dish: radius, how far in from the tyre's outer face)
    prof = [(RIM + 0.012, 0.0), (RIM - 0.006, 0.014), (RIM - 0.022, 0.036), (0.17, 0.046), (0.105, 0.042), (0.090, 0.030),
            (0.072, 0.024), (0.068, 0.010), (0.050, 0.006)]
    bm = bmesh.new()
    rings = [[bm.verts.new((face - side * d, yc + r * math.cos(2 * math.pi * s / n), TYRE_R + r * math.sin(2 * math.pi * s / n)))
              for s in range(n)] for r, d in prof]
    for a, b in zip(rings, rings[1:]):
        for s in range(n):
            bm.faces.new((a[s], a[(s + 1) % n], b[(s + 1) % n], b[s]))
    c = bm.verts.new((face - side * 0.006, yc, TYRE_R))
    for s in range(n):
        bm.faces.new((rings[-1][s], rings[-1][(s + 1) % n], c))
    back = [bm.verts.new((x - side * 0.49 * TYRE_W, yc + (RIM + 0.012) * math.cos(2 * math.pi * s / 24),
                          TYRE_R + (RIM + 0.012) * math.sin(2 * math.pi * s / 24))) for s in range(24)]
    bm.faces.new(back)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    dish = car.to_object('wheel_rim', bm, ['rim'])
    car.smooth(dish, 35)
    # the vent holes round the face, and the hub's six nuts
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        disc_x('hole', face - side * 0.0435, side, yc + 0.135 * math.cos(a), TYRE_R + 0.135 * math.sin(a), 0.021, 'hole')
    for k in range(6):
        a = 2 * math.pi * k / 6
        ob = car.disc_mesh('nut', (face - side * 0.008, yc + 0.058 * math.cos(a), TYRE_R + 0.058 * math.sin(a)), side, 0.011, 0.02, 'rim', n=6)
    disc_x('hub', face - side * 0.0055, side, yc, TYRE_R, 0.032, 'hole', n=16, rings=1)


for yc in AXLES:
    for s in (1, -1):
        steel_wheel(s * TRACK / 2, yc)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('photo', 320, 5, 8.0, 45), ('side', 270, 2, 11, 50), ('rear', 215, 7, 8.5, 45), ('face', 0, 2, 5.0, 50, (0, 2.4, 0.85)),
             ('lamp', 335, 4, 2.6, 50, (-0.60, 2.5, 0.92)), ('tail', 180, 6, 5.0, 50, (0, -2.5, 0.85)), ('top', 300, 35, 9, 45)]
    pick = os.environ.get('VIEWS')
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    paint = dict(base=(0.86, 0.87, 0.88), rough=0.22, metal=0.0, coat=0.8)  # (white, as most of them are)
    car.hero(renders, 'np300', paint=paint, views=views, samples=int(os.environ.get('SAMPLES', '96')))
