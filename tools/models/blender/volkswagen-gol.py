# tools/models/blender/volkswagen-gol.py
# The Volkswagen Gol hatchback (the G6/G7, 2013-2023, built in Brazil and sold all over Mexico), modelled by script
# (carlib.py): a five-door hatch lofted through its sections, the crisp shoulder line from the head lamps to the tail
# lamps, the short sloping hood, the raked windshield, the roof falling to the spoiler over the raked rear window, the
# upright hatch, the bumpers standing out under the lamps; the black-framed side glass, the small quarter light behind
# the rear door; laid onto that skin: the swept head lamps joined by the black two-bar grille (no badges), the
# bumper's wide lower intake and its corner pockets, the wide tail lamps on the body's corners wrapping round to the
# sides, the hatch's shut line between them, the bumper's plate recess; the mirrors, black handles, 14" steel wheels
# under slotted hubcaps (the Trendline's). Real sizes (VW do Brasil; Wikipedia's Gol infobox): 3.892 m long, 1.656 m
# wide (no mirrors), 1.452 m high, a 2.465 m wheelbase, a 1.42 m track, 175/70 R14 tyres (0.60 m across).
#   blender -b --factory-startup -P tools/models/blender/volkswagen-gol.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 1.946, -1.946
W = 0.828  # half the body's width
NOSE_R, TAIL_R = 0.50, 0.34  # (how far back the corners round off in plan)
AXLES = (1.161, -1.304)  # (a 0.785 m front overhang, 0.642 m behind)
TYRE_R, TYRE_W, RIM = 0.300, 0.175, 0.178
TRACK = 1.42
ARCH = 0.35  # (the wheel arches' radius, round the axle)
SHELF = 0.055  # (how far the glass's sill sits in from the shoulder: m)
CROWN = 0.045  # (the roof's crown, its middle over its edges)
COWL = 0.80  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = 0.0, -1.52, -1.86  # (the windshield's top; the rear window from under the spoiler down to the
# hatch's face)
B_POST, D_POST = (-0.13, -0.05), (-0.86, -0.82)  # (the B pillar; the rear door's post before the quarter light)


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


# the centreline's top: the bumper's face, the lamps' and the grille's face leaning back under the hood's edge, the
# hood, the windshield, the roof, the spoiler, the rear window, the hatch, the bumper's top and its face
TOP = [(NOSE, 0.42), (1.945, 0.47), (1.940, 0.515), (1.932, 0.555), (1.918, 0.595), (1.90, 0.625), (1.878, 0.655),
       (1.855, 0.69), (1.833, 0.725), (1.812, 0.755), (1.795, 0.773), (1.775, 0.783), (1.74, 0.792), (1.60, 0.815),
       (1.30, 0.868), (1.0, 0.91), (COWL, 0.94), (0.60, 1.07), (0.40, 1.19), (0.20, 1.305), (0.08, 1.37),
       (HEADER, 1.40), (-0.10, 1.428), (-0.35, 1.448), (-0.55, 1.452), (-0.85, 1.443), (-1.10, 1.425), (-1.32, 1.402),
       (ROOF_END, 1.38), (-1.56, 1.355), (-1.65, 1.28), (-1.75, 1.20), (-1.83, 1.13), (REAR_END, 1.10), (-1.875, 1.07),
       (-1.885, 1.02), (-1.895, 0.94), (-1.90, 0.86), (-1.905, 0.78), (-1.912, 0.75), (-1.925, 0.735), (-1.937, 0.71),
       (-1.943, 0.67), (TAIL, 0.58)]
BOTTOM = [(NOSE, 0.40), (1.945, 0.35), (1.94, 0.31), (1.928, 0.275), (1.91, 0.25), (1.85, 0.232), (1.6, 0.21),
          (1.0, 0.19), (-1.0, 0.19), (-1.6, 0.22), (-1.80, 0.25), (-1.88, 0.27), (-1.925, 0.31), (-1.94, 0.37),
          (-1.945, 0.45), (TAIL, 0.53)]
# the side's beltline: the fenders' tops along the hood, the glass's sill rising to the rear, the tail lamps' tops (at the
# nose and the tail over the top, so the sides run up to it: a beltline just under it there twisted the faces' quads)
BELT = [(NOSE, 0.80), (1.76, 0.775), (1.40, 0.82),
        (1.0, 0.875), (COWL, 0.91), (0.0, 0.945), (-0.80, 0.975), (-1.20, 1.0), (-1.50, 1.02), (-1.70, 1.02),
        (-1.86, 1.0), (-1.90, 0.975), (TAIL, 0.96)]
# the shoulder's crease, the side's widest line: from the head lamps' back to the tail lamps' tops, rising
CREASE = 0.46  # (the low crease's height along the doors, m: 0.35 m under the handles)
SHOULDER = [(1.78, 0.72), (1.50, 0.765), (1.0, 0.805), (0.0, 0.85), (-1.0, 0.885), (-1.60, 0.915), (TAIL, 0.93)]
# the roof's half-width between its rails, narrower over the rear window
ROOF = [(0.3, 0.60), (-0.4, 0.62), (-1.2, 0.605), (ROOF_END, 0.585), (REAR_END, 0.65), (TAIL, 0.67)]


def half_width(y):
    """The body's half-width in plan at y: its corners rounded"""
    if y > NOSE - NOSE_R:
        t = min(0.995, (y - (NOSE - NOSE_R)) / NOSE_R)
        return W - NOSE_R + NOSE_R * (1 - t ** 2.3) ** (1 / 2.3)  # (a superellipse: the front broad, its corners soft)
    if y < TAIL + TAIL_R:
        t = min(0.995, ((TAIL + TAIL_R) - y) / TAIL_R)
        return W - TAIL_R + TAIL_R * (1 - t ** 3) ** (1 / 3)
    return W


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005)
    # (round the nose and the tail the sides' tucks fade out: there the sides are the bumpers' and the panels' faces)
    k = 1 - max(smooth((y - (NOSE - 0.45)) / 0.33), smooth(((TAIL + 0.34) - y) / 0.28))
    bw = w - SHELF * (0.2 + 0.8 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    # the low crease along the doors, between the arches (the side tucks in under it); fore and aft of them, over the
    # fenders and the bumpers' corners, no crease (fading round those corners, it streaked their shading)
    c = smooth((y - (AXLES[1] + ARCH - 0.12)) / 0.12) * smooth(((AXLES[0] - ARCH + 0.12) - y) / 0.12)
    z3 = bot + min(0.13, 0.30 * h) + (min(CREASE, bot + 0.45 * h) - bot - min(0.13, 0.30 * h)) * c
    shoulder = clamp(lerp(SHOULDER, y), z3 + 0.15 * h, belt - min(0.07, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.5
    # the glass: from the sill up to the roof's edge, leaning in; along the hood and the hatch no glass
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    roof = min(lerp(ROOF, y), bw)
    lean = 0.40 - 0.24 * smooth((-1.0 - y) / 0.7)  # (the C pillars turn in fast over the tail)
    rw = bw - (bw - roof) * clamp((edge - belt) / lean, 0, 1)
    if y < ROOF_END + 0.05:
        rw = roof  # (over the rear window and the hatch's top: the window a trapezoid, broader at its foot, the C
        # pillars and the shoulders over the lamps rounding in to it)
    # the windows' top: just under the roof's edge over the doors, then down behind the rear door, the quarter light
    # closing in a point under the C pillar
    run = math.hypot(rw - bw, edge - belt)
    band = 0.015 + run * smooth((D_POST[0] - 0.02 - y) / 0.44) ** 0.7
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    rail = 0.05 - 0.03 * smooth((ROOF_END + 0.05 - y) / 0.1)  # (narrow over the rear window, wide to its C pillars)
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - rail, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    if y > COWL:
        # the hood's two creases, from the grille's corners back to the windshield's foot, a ridge over its flat middle
        f = smooth((y - COWL) / 0.20) * (1 - smooth((y - 1.70) / 0.05))
        cx = 0.345 + 0.10 * clamp((1.74 - y) / (1.74 - COWL), 0, 1)
        upper[-1] = (min(cx, upper[-2][0] - 0.04), top + 0.007 * f)
    return [(0, bot), (w - 0.10 * (0.5 + 0.5 * k), bot), (w - (0.035 + 0.045 * c) * k, z2), (w - 0.012 * k, z3), (w, shoulder),
            (w - 0.022 * k, z5), (bw, belt), *upper, (0, top)]


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


A_TIP = where(lambda y: glass_rise(y) > 0.08, 0.3, COWL)  # (the A pillar's foot: the steel closes the point ahead)
QUARTER_END = where(lambda y: glass_rise(y) > 0.025, -0.9, -1.6)  # (the quarter light's point, under the C pillar)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the roof's rail,
    # 9-10 the top (bumper, lamps' face, hood, windshield, roof, rear window, hatch)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'paint' if y > NOSE - 0.10 or y < TAIL + 0.10 else 'under'
    if seg == 1:
        return 'paint'  # (the sills body-coloured, no cladding)
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


# the stations: close together at the ends and over the arches, every window's and post's edge exactly on one
edges = [NOSE, TAIL, 1.945, 1.940, 1.932, 1.918, 1.90, 1.878, 1.855, 1.833, 1.812, 1.795, 1.775, WS_FOOT, COWL, HEADER,
         ROOF_END - 0.02, REAR_END, A_TIP, *B_POST, *D_POST, QUARTER_END, -1.875, -1.885, -1.895, -1.90, -1.905,
         -1.912, -1.925, -1.937, -1.943]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.08 else 0.012 if (end < 0.20 or NOSE - 0.45 < y) else 0.02 if arch else 0.025 if end < NOSE_R + 0.05 else 0.06
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


def crease(ob):
    """The shoulder's crease kept sharp along the doors and the fenders (smoothed, the fold blurs into a soft roll;
    the real one catches the light as a line), not round the nose and the tail, where it would crease the faces"""
    bm = car.bmesh.new()
    bm.from_mesh(ob.data)
    on = {}
    for v in bm.verts:
        y = v.co.y
        if not (TAIL + 0.36 < y < NOSE - 0.52):
            continue
        sec = section(y)
        sx, sz = sec[4]
        on[v] = abs(abs(v.co.x) - sx) < 1e-4 and abs(v.co.z - sz) < 1e-4
        if AXLES[1] + ARCH + 0.03 < y < AXLES[0] - ARCH - 0.03:  # (the low crease, between the arches)
            lx, lz = sec[3]
            on[v] = on[v] or (abs(abs(v.co.x) - lx) < 1e-4 and abs(v.co.z - lz) < 1e-4)
        if COWL + 0.08 < y < 1.70:  # (and the hood's creases)
            hx, hz = sec[10]
            on[v] = on[v] or (abs(abs(v.co.x) - hx) < 1e-4 and abs(v.co.z - hz) < 1e-4)
    for e in bm.edges:
        a, b = e.verts
        if on.get(a) and on.get(b):
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


crease(body)
car.tidy(body, 88, weighted=False)  # (smooth over all but the materials' borders and the creases: at 75 the
# nose's and the tail's corners, where the sides turn into the faces near that angle, shaded in a patchwork)


def side_x(y, z):
    """The body's side's x (right) at y and height z, from its section (between the sill's foot and the glass's sill)"""
    pts = section(y)[2:7]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


def front(ob, offset=0.002, wrap=False):
    return car.onto(ob, body, offset, axis=None if wrap else '-Y')


def rear(ob, offset=0.002, wrap=False):
    """(wrap: each point to its nearest on the skin, round the tail's corners, where a ray from behind would miss)"""
    return car.onto(ob, body, offset, axis=None if wrap else 'Y')


def onto(ob, offset=0.0015):
    return car.onto(ob, body, offset)


AHEAD, BEHIND = NOSE + 0.4, TAIL - 0.4  # (the planes the nose's and the tail's decals are drawn in, then laid on)

# ---- the shut lines: the doors' edges, the hood's along the fenders, the fuel flap
seams = []
for s in (1, -1):
    for y in (A_TIP - 0.03, (B_POST[0] + B_POST[1]) / 2):
        pts = [(s * side_x(y, z), y, z) for z in (0.26 + k * 0.05 for k in range(16)) if z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    # (the rear door's back edge: down from the quarter light's post, round in front of the rear arch)
    yb = (D_POST[0] + D_POST[1]) / 2
    back = [(yb, z) for z in (lerp(BELT, yb) - 0.02, 0.90, 0.80, 0.70)] + [(yb - 0.04, 0.665), (yb - 0.10, 0.648)]
    back += [(AXLES[1] + (ARCH + 0.045) * math.cos(math.radians(a)), TYRE_R + (ARCH + 0.045) * math.sin(math.radians(a))) for a in (52, 40, 28, 15, 0)]
    back.append((AXLES[1] + ARCH + 0.045, 0.24))
    seams.append(car.strip('seam', [(s * side_x(y, z), y, z) for y, z in back], (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.015), y, lerp(BELT, y)) for y in [1.74 - 0.05 * k for k in range(int((1.74 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
fuel = [(-1.35 + 0.075 * math.cos(a * math.pi / 12), 0.86 + 0.075 * math.sin(a * math.pi / 12)) for a in range(25)]
seams.append(car.strip('seam', [(side_x(y, z), y, z) for y, z in fuel], (1, 0, 0), 0.004, 'trim'))
seams.append(car.strip('seam', [(x, COWL + 0.02, lerp(TOP, COWL + 0.02)) for x in (-0.70, 0.70)], (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    onto(ob)

def plan_path(end, inward):
    """The body's outline in plan round one end, as [(x, y)...] from the middle out: across the face at y = `end`, then
    back along the rounded corner and the side (`inward` -1 from the nose, 1 from the tail) to 0.6 m in"""
    pts = [(0.0, end)]
    edge = half_width(end)
    pts += [(edge * k / 20, end) for k in range(1, 21)]
    pts += [(half_width(end + inward * 0.005 * k), end + inward * 0.005 * k) for k in range(1, 121)]
    run = [0.0]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        run.append(run[-1] + math.hypot(x1 - x0, y1 - y0))
    return pts, run


def along(path, u):
    """The point (x, y) `u` m along a plan_path from the middle"""
    pts, run = path
    for (p0, p1), (r0, r1) in zip(zip(pts, pts[1:]), zip(run, run[1:])):
        if u <= r1:
            f = (u - r0) / (r1 - r0)
            return p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f
    return pts[-1]


def wrapped(name, corners, path, s, role, n=40, m=6, offset=0.003):
    """A lamp drawn as a quad [(u, z)] * 4, u along the plan's outline round an end (`path`, from plan_path) and z up,
    on the side `s` (1 right, -1 left), laid onto the skin round the corner (each point to its nearest on it): a lamp
    that wraps from the face round onto the side, where a ray from ahead would miss"""
    (au, az), (bu, bz), (cu, cz), (du, dz) = corners
    bm = car.bmesh.new()
    grid = []
    for j in range(m + 1):
        v = j / m
        row = []
        for i in range(n + 1):
            t = i / n
            u = au + (bu - au) * t + ((du + (cu - du) * t) - (au + (bu - au) * t)) * v
            z = az + (bz - az) * t + ((dz + (cz - dz) * t) - (az + (bz - az) * t)) * v
            x, y = along(path, u)
            row.append(bm.verts.new((s * x, y, z)))
        grid.append(row)
    mid = path[0][0][1]
    for j in range(m):
        for i in range(n):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.normal_update()
            c = f.calc_center_median()
            outward = car.Vector((c.x, c.y - (mid - math.copysign(0.6, mid)), 0))
            if f.normal.dot(outward) < 0:
                f.normal_flip()
    ob = car.to_object(name, bm, [role])
    return car.onto(ob, body, offset)



from mathutils.bvhtree import BVHTree  # noqa: E402
SKIN = BVHTree.FromObject(body, car.bpy.context.evaluated_depsgraph_get())


def lay(ob, path, s, offset=0.003):
    """`ob`, drawn flat with x = u (m along a plan_path's outline from the middle) and z up, laid onto the skin on the
    side `s`: each point cast at its own height straight in along the outline's normal, so a lamp follows the face round
    its corner onto the side and never folds over onto the hood (a point to its nearest on the skin did, at the lamps'
    tops). Faces turned to face out"""
    bm = car.bmesh.new()
    bm.from_mesh(ob.data)
    hits = {}
    for v in bm.verts:
        u, z = v.co.x, v.co.z
        (x0, y0), (x1, y1) = along(path, max(0.0, u - 0.005)), along(path, u + 0.005)
        tx, ty = x1 - x0, y1 - y0
        n = car.Vector((-ty, tx, 0)).normalized()
        px, py = along(path, u)
        mid = path[0][0][1]
        if n.y * (py - (mid - math.copysign(0.6, mid))) + n.x * px < 0:
            n = -n
        n.x *= s
        origin = car.Vector((s * px, py, z)) + n * 0.4
        hit, normal, _, _ = SKIN.ray_cast(origin, -n, 1.0)
        if hit is None:
            hit, normal, _, _ = SKIN.find_nearest(origin - n * 0.4)
        v.co = hit + normal * offset
        hits[v] = normal
    for f in bm.faces:
        f.normal_update()
        out = sum((hits[v] for v in f.verts), car.Vector())
        if f.normal.dot(out) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def band(name, top, bot, u0, u1, role, n=40, m=4):
    """A flat shape drawn as x = u, z between the polylines bot(u) and top(u) [(u, z)...], for lay()"""
    bm = car.bmesh.new()
    rows = []
    for j in range(m + 1):
        row = []
        for i in range(n + 1):
            u = u0 + (u1 - u0) * i / n
            zb, zt = lerp(bot[::-1], u), lerp(top[::-1], u)
            row.append(bm.verts.new((u, 0.0, zb + (zt - zb) * j / m)))
        rows.append(row)
    for j in range(m):
        for i in range(n):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    return car.to_object(name, bm, [role])


LAMP_FACE, BUMPER_FACE = plan_path(1.81, -1), plan_path(1.925, -1)  # (the plans the head lamps and the bumper are laid on)
TAIL_FACE = plan_path(-1.90, 1)
NOSE_FACE = LAMP_FACE

# ---- the nose: the head lamps, big swept-back units: the inner end meeting the grille at its height, the top along the
# hood's shut line, out round the corner and back along the fender, tallest at the outer end (0.17 m) and rounded
# there; a black housing, the chrome reflector filling it, the round projector bowl inboard, the main beam's smaller
# one outboard, the indicator's amber in the inner chamber; the grille between them, black, its two plain bars across;
# the bumper's crease under them; the wide black trapezoid intake low down, its slats, the fog lamps' housings at its
# corners with their silver fins
LAMP_TOP = [(0.335, 0.778), (0.55, 0.782), (0.70, 0.779), (0.85, 0.774), (0.95, 0.770), (0.99, 0.762), (1.00, 0.745)]
LAMP_BOT = [(0.335, 0.648), (0.55, 0.640), (0.72, 0.622), (0.86, 0.603), (0.95, 0.606), (0.99, 0.635), (1.00, 0.70)]
for s in (1, -1):
    lay(band('lamp_housing', LAMP_TOP, LAMP_BOT, 0.335, 1.0, 'gloss', n=32, m=5), LAMP_FACE, s, 0.0025)
    # (the chrome reflector filling the lamp to within 3 mm of its edge: the lamp's shape is the chrome against the
    # paint, a hairline seam round it, never a drawn border)
    inner_top = [(u, z - 0.003) for u, z in LAMP_TOP]
    inner_bot = [(u, z + 0.003) for u, z in LAMP_BOT[:-1]] + [(1.0, LAMP_BOT[-1][1] + 0.01)]
    lay(band('reflector', inner_top, inner_bot, 0.338, 0.996, 'chrome', n=30, m=5), LAMP_FACE, s, 0.0042)
    # the lamp's dark lower chamber, filled, the bottom third of it (the smoked part under the chrome, as photographed:
    # it gives the lamp its weight against the paint)
    low_bot = [(u, z + 0.003) for u, z in LAMP_BOT[:-2]] + [(0.97, 0.66)]
    low_top = [(u, z + 0.045) for u, z in LAMP_BOT[:-2]] + [(0.97, 0.69)]
    lay(band('lamp_chamber', low_top, low_bot, 0.338, 0.97, 'gloss', n=28, m=2), LAMP_FACE, s, 0.0049)
    # the projector's big bowl inboard: a filled bright disc, its lens a shade darker in the middle (no ring round it);
    # the main beam's reflector a long brighter zone outboard
    lay(car.disc('headlamp', (0.49, 0.711), 0.054, 0.0, 'headlamp', 1, rings=2), LAMP_FACE, s, 0.0056)
    lay(car.disc('bulb_cap', (0.49, 0.711), 0.026, 0.0, 'chrome', 1, rings=1), LAMP_FACE, s, 0.0064)
    lay(band('headlamp', [(0.60, 0.758), (0.80, 0.752), (0.90, 0.748)], [(0.60, 0.668), (0.80, 0.640), (0.90, 0.636)],
             0.60, 0.90, 'headlamp', n=16, m=3), LAMP_FACE, s, 0.0056)
    lay(car.panel('amber', [(0.375, 0.735), (0.43, 0.737), (0.43, 0.762), (0.375, 0.760)], 0.0, 'amber', 1, n=6, m=2), LAMP_FACE, s, 0.0058)
front(car.panel('grille', [(-0.335, 0.648), (0.335, 0.648), (0.335, 0.778), (-0.335, 0.778)], AHEAD, 'pocket', 1, n=24, m=2), 0.003)
for z in (0.690, 0.735):  # (the grille's two bars across, plain: no maker's badge)
    front(car.decal('grille_bar', [(-0.325, z), (0.325, z)], 0.010, AHEAD, 'chrome', 1), 0.0042)
# the lower intake: a wide black trapezoid across the bumper, broader at its foot, its slats; at its corners the fog
# lamps' housings, a round lamp each between silver fins
INTAKE_TOP = [(0.0, 0.432), (0.45, 0.432), (0.62, 0.448), (0.70, 0.452)]
INTAKE_BOT = [(0.0, 0.292), (0.55, 0.292), (0.68, 0.30), (0.74, 0.318)]  # (above the bumper's underside: a
# point cast below it misses the skin)
for s in (1, -1):
    lay(band('intake', INTAKE_TOP, INTAKE_BOT, 0.0, 0.72, 'pocket', n=36, m=4), BUMPER_FACE, s, 0.0025)
    for z in (0.33, 0.37, 0.405):
        lay(car.decal('intake_bar', [(0.0, z), (0.43, z)], 0.008, 0.0, 'gloss', 1), BUMPER_FACE, s, 0.0035)
    lay(car.disc('foglamp', (0.585, 0.36), 0.038, 0.0, 'gloss', 1, rings=2), BUMPER_FACE, s, 0.0035)
    lay(car.disc('foglamp_lens', (0.585, 0.36), 0.026, 0.0, 'chrome', 1, rings=1), BUMPER_FACE, s, 0.004)
    for z in (0.41,):
        lay(car.decal('fog_fin', [(0.49, z), (0.535, z), (0.635, z + 0.004), (0.67, z + 0.008)], 0.012, 0.0, 'paint', 1), BUMPER_FACE, s, 0.004)
    lay(car.decal('fog_divider', [(0.465, 0.305), (0.465, 0.425)], 0.016, 0.0, 'paint', 1), BUMPER_FACE, s, 0.004)
front(car.decal('lip', [(-0.62, 0.262), (0.62, 0.262)], 0.012, AHEAD, 'trim', 1), 0.0015)

# ---- the tail: the wide lamps on the body's corners, wrapping round onto the sides to a point, red with the
# reversing lamp's white low inboard; the hatch's shut line down their inner edges and across over the bumper; the
# badge; the bumper's top edge and its plate recess, the reflectors low down
for s in (1, -1):
    wrapped('lamp', [(0.545, 0.770), (0.76, 0.775), (0.76, 0.985), (0.630, 0.985)], TAIL_FACE, s, 'lamp', n=14, m=6)
    wrapped('lamp', [(0.76, 0.775), (1.02, 0.90), (1.02, 0.975), (0.76, 0.985)], TAIL_FACE, s, 'lamp', n=16, m=6)
    wrapped('lampbright', [(0.62, 0.905), (0.95, 0.925), (0.95, 0.950), (0.625, 0.950)], TAIL_FACE, s, 'lampbright', n=20, m=2, offset=0.0042)
    wrapped('reverse', [(0.56, 0.782), (0.70, 0.784), (0.70, 0.835), (0.575, 0.835)], TAIL_FACE, s, 'white', n=8, m=3, offset=0.0042)
    rear(car.panel('reflector', [(s * 0.62, 0.285), (s * 0.72, 0.285), (s * 0.72, 0.305), (s * 0.62, 0.305)], BEHIND, 'lamp', -1, n=6, m=2), 0.003)
gate = [(-0.60, 1.10), (-0.632, 0.99), (-0.548, 0.765), (-0.50, 0.738), (0.50, 0.738), (0.548, 0.765), (0.632, 0.99), (0.60, 1.10)]
rear(car.decal('seam', gate, 0.005, BEHIND, 'trim', -1), 0.0015)
recess = [(-0.48, 0.40), (-0.44, 0.555), (-0.36, 0.575), (0.36, 0.575), (0.44, 0.555), (0.48, 0.40)]
rear(car.decal('seam', recess, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('seam', [(-0.76, 0.34), (0.76, 0.34)], 0.005, BEHIND, 'trim', -1), 0.0015)

# ---- the spoiler: the roof run on past the rear window's top, its ends tapering down the C pillars; the high brake
# lamp in its back
spoiler = [(ROOF_END + 0.08, lerp(TOP, ROOF_END + 0.08) - 0.006), (ROOF_END - 0.10, 1.376), (ROOF_END - 0.14, 1.36),
           (ROOF_END - 0.125, 1.336), (ROOF_END - 0.02, 1.35)]
tip = [(ROOF_END + 0.08, lerp(TOP, ROOF_END + 0.08) - 0.03), (ROOF_END - 0.08, 1.354), (ROOF_END - 0.11, 1.346),
       (ROOF_END - 0.10, 1.33), (ROOF_END - 0.02, 1.336)]
for s in (1, -1):
    sp = car.tapered('paint_spoiler', spoiler, 0.0, tip, s * 0.575, 'paint')
    car.bevelled(sp, 0.01, 2, angle=25)
    car.smooth(sp, 60)
rear(car.decal('brake', [(-0.14, 1.352), (0.14, 1.352)], 0.012, BEHIND, 'lamp', -1), 0.002)

# ---- the mirrors: body-coloured on a black foot at the front windows' corner, the glass in their back
for s in (1, -1):
    D = A_TIP - 0.02
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.03) - 0.03
    inner = [(D + 0.02, z), (D - 0.15, z), (D - 0.16, z + 0.11), (D - 0.05, z + 0.12), (D + 0.02, z + 0.06)]
    outer = [(D - 0.05, z + 0.01), (D - 0.16, z + 0.01), (D - 0.16, z + 0.10), (D - 0.09, z + 0.11), (D - 0.05, z + 0.06)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.15), 'paint')
    car.bevelled(m, 0.022, 3, angle=20)
    car.smooth(m, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.10, 0.002, 0.07), 'glass')
    g.location = (s * (W + 0.09), D - 0.1635, z + 0.055)
    car.box('mirror_foot', (s * (x0 + 0.02), D - 0.04, z + 0.01), (0.05, 0.10, 0.03), 'trim', bevel=0.006)

# ---- the doors' black pull handles, just under the shoulder's crease
for s in (1, -1):
    for y in (B_POST[0] + 0.25, D_POST[1] + 0.10):
        z = lerp(SHOULDER, y) - 0.035
        h = car.box('handle', (0, 0, 0), (0.014, 0.13, 0.03), 'trim', bevel=0.005)
        h.location = (s * (side_x(y, z) + 0.004), y, z)

car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.64, 0.28)], (0, 0.5, 1), 0.018, 'trim', lift=0.01)
car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.05, 0.62)], (0, 0.5, 1), 0.018, 'trim', lift=0.012)
car.strip('wiper', [(0.02 + 0.30 * k / 6, -1.80 + 0.13 * k / 6, lerp(TOP, -1.80 + 0.13 * k / 6) + 0.012) for k in range(7)], (0, -1, 1), 0.016, 'trim', lift=0.0)
car.box('antenna', (0, ROOF_END + 0.10, lerp(TOP, ROOF_END + 0.10) + 0.10), (0.008, 0.008, 0.20), 'trim')

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.30, 0.36), (1.50, 2.30, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.62, 0.88), (1.50, 0.40, 0.14), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.36, 0.0, 0.56), (0.46, 0.50, 0.12), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.36, -0.27, 0.90), (0.44, 0.12, 0.60), 'interior', bevel=0.04, tilt=0.22)
car.soft_box('interior_bench', (0, -0.92, 0.58), (1.36, 0.46, 0.12), 'interior', bevel=0.04)
car.soft_box('interior_benchback', (0, -1.20, 0.90), (1.36, 0.12, 0.55), 'interior', bevel=0.04, tilt=0.20)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=32, minor_segments=8,
                                     location=(-0.36, 0.42, 0.92), rotation=(math.radians(60), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))

# ---- the wheels: 175/70 R14 tyres on steel wheels under slotted silver hubcaps
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.006, lug=0.0, spokes=8)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 9), ('real', 322, 10, 6.5, 35), ('rear', 215, 7, 8.5, 45), ('side', 92, 2, 10), ('face', 0, 2, 4.0, 50, (0, 1.8, 0.6)),
             ('lamp', 30, 4, 2.4, 50, (0.50, 1.85, 0.70)), ('tail', 180, 4, 4.2, 50, (0, -1.8, 0.75)),
             ('photo', 38, 6, 6.0, 35)]
    pick = os.environ.get('VIEWS')  # (a quick look: VIEWS=front renders that one only)
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    car.hero(renders, 'gol', paint=dict(base=(0.55, 0.56, 0.58), rough=0.18, metal=0.7, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
