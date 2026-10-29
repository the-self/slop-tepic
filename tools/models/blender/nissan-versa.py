# tools/models/blender/nissan-versa.py
# The Nissan Versa (the N18, sold in Mexico since 2019 as the 2020 model, Tepic's commonest car), modelled by script
# (carlib.py): a rounded three-box sedan lofted through its sections, the shoulder's crease rising from the head lamps
# to the tail lamps, the long hood and raked windshield, the roof falling in one arc to the short trunk with its
# ducktail lip; the black-framed side glass, the "floating roof": a black panel behind the rear doors' glass under
# the body-coloured C pillar; laid onto that skin: the slim boomerang head lamps swept back along the fenders, the
# black shield between them with the chrome V-motion bar round the mesh grille (no badge: the game shows no
# brands), the lower grille and
# the fog lamps' pockets; the boomerang tail lamps wrapping round onto the trunk lid, the plate's recess, the black
# lower bumper; body-coloured mirrors on the doors, 16" alloys with five pairs of spokes. Real sizes (Nissan
# Mexicana's data sheet, Advance): 4.495 m long, 1.740 m wide (no mirrors), 1.465 m high, a 2.620 m wheelbase, a 1.52 m
# track, 205/55 R16 tyres (0.632 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-versa.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.2475, -2.2475
W = 0.87  # half the body's width
NOSE_DEEP, TAIL_R = 0.55, 0.40  # (how far back the nose's corners reach in plan; the tail's corners')
AXLES = (1.36, -1.26)  # (a 0.89 m front overhang, a 0.99 m rear one)
TYRE_R, TYRE_W, RIM = 0.316, 0.205, 0.203
TRACK = 1.52
ARCH = 0.37  # (the wheel arches' radius, round the axle)
SHELF = 0.075  # (how far the glass's sill sits in from the shoulder: m)
CROWN = 0.045  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.60  # (the roof's half-width between its rails)
COWL = 1.14  # (the hood's back edge, under the windshield's foot: over the front tyre's back)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = 0.36, -0.96, -1.84  # (the windshield's top; the rear window from the roof's end down to
# the trunk's deck)
B_POST = (-0.14, -0.06)  # (the black B pillar)
D_POST = (-0.83, -0.80)  # (the rear door glass's back edge; the floating roof's black panel behind it)


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


# the centreline's top: the grille's face leaning back up to the hood's leading edge (the face itself the sections'
# sides, curved in plan), the long hood, the windshield, the roof's arc down the rear window to the short deck, the
# ducktail's lip, and the tail's face down to the bumper
TOP = [(NOSE, 0.67), (2.246, 0.695), (2.24, 0.716), (2.23, 0.736), (2.215, 0.752), (2.195, 0.763), (2.16, 0.772),
       (2.12, 0.782), (2.05, 0.792), (1.90, 0.815), (1.60, 0.855), (1.35, 0.882), (COWL, 0.905),
       (1.00, 0.97), (0.85, 1.055), (0.65, 1.175), (0.50, 1.265), (HEADER, 1.342), (0.20, 1.41), (0.0, 1.452),
       (-0.20, 1.465), (-0.45, 1.452), (-0.70, 1.415), (-0.85, 1.38), (ROOF_END, 1.335), (-1.10, 1.29), (-1.30, 1.215),
       (-1.50, 1.148), (-1.70, 1.095), (REAR_END, 1.07), (-1.95, 1.058), (-2.05, 1.055), (-2.10, 1.056), (-2.15, 1.06),
       (-2.17, 1.056), (-2.185, 1.04), (-2.198, 1.01), (-2.21, 0.965), (-2.222, 0.90), (-2.232, 0.83), (-2.240, 0.76),
       (-2.245, 0.68), (TAIL, 0.56)]
BOTTOM = [(NOSE, 0.37), (2.245, 0.335), (2.236, 0.31), (2.22, 0.29), (2.195, 0.275), (2.16, 0.262), (2.10, 0.25), (1.95, 0.23),
          (1.70, 0.20), (1.0, 0.18), (-1.60, 0.18), (-1.90, 0.215), (-2.05, 0.24), (-2.14, 0.265), (-2.19, 0.29),
          (-2.22, 0.32), (-2.237, 0.345), (-2.245, 0.375), (TAIL, 0.40)]
# the side's beltline: along the hood under its edge, the glass's sill rising to the tail, along the deck's edge
BELT = [(NOSE, 0.66), (2.23, 0.725), (2.18, 0.757), (2.10, 0.772), (1.90, 0.80), (1.60, 0.835), (COWL, 0.88),
        (0.80, 0.915), (0.0, 0.955), (-0.80, 1.0), (-1.30, 1.03), (-1.80, 1.045), (-2.10, 1.045), (TAIL, 1.04)]
# the shoulder's crease, the widest line along the side: low over the front wheel, rising through the handles to the
# tail lamps
SHOULDER = [(NOSE, 0.70), (2.0, 0.72), (1.60, 0.755), (1.0, 0.80), (0.0, 0.85), (-1.0, 0.905), (-1.80, 0.93),
            (TAIL, 0.93)]


LOWER = [(1.0, 0.43), (0.0, 0.47), (-0.95, 0.52)]


def half_width(y):
    """The body's half-width in plan at y: the nose's face curved back to its corners, the tail's corners rounded"""
    if y > NOSE - NOSE_DEEP:
        t = min(0.995, (y - (NOSE - NOSE_DEEP)) / NOSE_DEEP)
        return W * (1 - t ** 2.4) ** (1 / 2.4)
    if y < TAIL + TAIL_R:
        t = min(0.995, ((TAIL + TAIL_R) - y) / TAIL_R)
        return W - TAIL_R + TAIL_R * (1 - t ** 2.3) ** (1 / 2.3)
    return W


def fender_rise(y):
    """How far the fenders' crests stand over the hood along it (m): nothing at the cowl, most over the front wheels"""
    return 0.02 * smooth((y - COWL) / 0.4) * (1 - smooth((y - 2.10) / 0.1))


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005) + (fender_rise(y) if y > COWL else 0.0)
    # (round the nose and the tail the sides' tucks and the shelf fade out: there the sides are the bumpers' faces)
    k = 1 - 0.85 * max(clamp((y - (NOSE - 0.42)) / 0.32, 0, 1), clamp(((TAIL + 0.34) - y) / 0.3, 0, 1))
    bw = w - SHELF * (0.15 + 0.85 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    # (the doors' lower crease, rising from behind the front wheel to the rear one; low round the ends)
    z3 = bot + min(0.15, 0.30 * h)
    z3 += (lerp(LOWER, y) - z3) * smooth((1.15 - abs(y - 0.05)) / 0.25)
    shoulder = clamp(lerp(SHOULDER, y), z3 + 0.15 * h, belt - min(0.07, 0.2 * h))
    z5 = shoulder + (belt - shoulder) * 0.55
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.42, 0, 1)
    # the windows' top: just under the roof's edge over the doors, then falling behind the rear doors to the floating
    # roof's black panel's point
    run = math.hypot(rw - bw, edge - belt)
    band = 0.016 + run * clamp((-1.06 - y) / 0.28, 0, 1) ** 1.2
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    # (the hood's two ridges, converging toward the grille's V, the hood's middle a shallow valley between them)
    ridge = 0.02 * smooth((y - COWL) / 0.35) * (1 - smooth((y - 2.08) / 0.12))
    rx = (0.45 - 0.12 * smooth((y - COWL) / (2.1 - COWL))) * rw if ridge > 0 else rw * 0.45
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
             (rx, top - crown * 0.08 + ridge)]
    if belt > top:
        dip, f = belt - top, min(1.0, (belt - top) / 0.03)
        upper = [(bw, belt), (bw - 0.06, belt - 0.5 * dip), (bw - 0.06 - 0.14 * f, top - 0.008 * f),
                 (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
    # (the lower door tucked in under the shoulder, the sill's foot further)
    kl = max(k, 0.6)  # (the lower corners rounded in all round, the bumpers' too)
    # (round the nose the bumper's cheeks swell round and its lower corners tuck in and lift, as the photographs from
    # ahead show: upright, the face read as a wall)
    q = smooth((y - (NOSE - 0.62)) / 0.42)
    lift = 0.035 * q
    return [(0, bot), (max(0.3 * w, w - 0.13 * (0.5 + 0.5 * kl) - 0.06 * q), bot), (max(0.5 * w, w - 0.065 * kl - 0.06 * q), z2 + lift),
            (max(0.7 * w, w - 0.032 * kl - 0.03 * q), z3 + 0.5 * lift), (w, shoulder), (w - 0.03 * k - 0.012 * q, z5), (bw, belt),
            *upper, (0, top)]


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


A_TIP = where(lambda y: glass_rise(y) > 0.06, 0.4, COWL)  # (the A pillar's foot: the steel closes the point ahead)
QUARTER_END = where(lambda y: glass_rise(y) > 0.035, -0.9, -1.7)  # (the floating roof's black panel's point)
SAIL = A_TIP - 0.13  # (the front door glass's black sail ahead of it, where the mirror stands)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it (the doors' black
    # frames), 8 the roof's rail, 9-10 the top (bumper, hood, windshield, roof, rear window, deck, tail)
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'paint' if y > NOSE - 0.10 or y < TAIL + 0.10 else 'under'
    if seg == 1:
        return 'paint' if y > NOSE - 0.30 or y < TAIL + 0.30 else 'trim'
    if seg == 6:
        if B_POST[0] < y < B_POST[1] or D_POST[0] < y < D_POST[1] or SAIL < y < A_TIP:
            return 'trim'
        if B_POST[1] < y < SAIL:
            return f'glass:front{side}'
        if D_POST[1] < y < B_POST[0]:
            return f'glass:rear{side}'
        if QUARTER_END < y < D_POST[0]:
            return f'glass:quarter{side}'
    if seg == 7:
        return 'trim' if QUARTER_END < y < A_TIP else 'paint'  # (black over the doors and the floating roof's panel)
    if seg >= 9:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END < y < ROOF_END:
            return 'glass:back'
    return 'paint'


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, ROOF_END, REAR_END, A_TIP, SAIL, *B_POST, *D_POST, QUARTER_END,
         -2.15, -2.17, -2.185]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.08 else 0.02 if arch else 0.025 if (y > NOSE - NOSE_DEEP - 0.05 or y < TAIL + TAIL_R + 0.05) else 0.07
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.005 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008, sharp=(3, 4, 10),
                cap_rings=(0.01, 0.025, 0.04), frame={None: 0.02, 'windshield': 0.045, 'back': 0.02, 'quarter': 0.012})

# the creases kept sharp, each only along its own stretch (smoothed, they melted away; kept sharp all round, the
# lower one and the shoulder crossed the tail as a box round the trunk lid): the shoulder from behind the head lamps
# to the tail lamps, the doors' lower crease between the arches, the hood's two ridges (its V)
CREASES = {4: (TAIL + 0.10, NOSE - 0.36), 3: (AXLES[1] + ARCH, AXLES[0] - ARCH), 10: (COWL + 0.08, 2.06)}
_bm = car.bmesh.new()
_bm.from_mesh(body.data)
for e in _bm.edges:
    if e.smooth:
        continue
    a, b = e.verts[0].co, e.verts[1].co
    yy, zz = (a.y + b.y) / 2, (a.z + b.z) / 2
    half = section(yy)
    j = min(CREASES, key=lambda k: abs(half[k][1] - zz))  # (which crease this edge is: the nearest in height)
    lo, hi = CREASES[j]
    if not (lo < yy < hi) or (j == 10 and half[10][1] <= lerp(TOP, yy) - CROWN * 0.08 + 1e-4):
        e.smooth = True  # (outside its stretch, or the roof's and the deck's line there, which has no ridge)
_bm.to_mesh(body.data)
_bm.free()

# ---- the wheel arches: round, cut out of the sides (their wells dark)
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + 0.02 + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.52, s * 1.3, 'under'))
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



# ---- the shut lines: the doors' edges, the hood's along the fenders, the trunk lid's
seams = []
for s in (1, -1):
    for y in (A_TIP + 0.02, (B_POST[0] + B_POST[1]) / 2, D_POST[0] - 0.03):
        pts = [(s * side_x(y, z), y, z) for z in (0.30 + k * 0.05 for k in range(16)) if z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.03), y, lerp(TOP, y)) for y in [2.10 - 0.05 * k for k in range(int((2.10 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
    # (the trunk lid's sides: along the deck in from its edges, narrowing to the shut line down through the lamps)
    deck = [(s * (W - SHELF - 0.03 + (0.585 - (W - SHELF - 0.03)) * smooth((REAR_END - 0.03 - y) / 0.30)), y, lerp(TOP, y))
            for y in [REAR_END - 0.03 - 0.025 * k for k in range(13)]]
    seams.append(car.strip('seam', deck, (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    car.onto(ob, body, 0.0015)

# ---- what is laid on the nose's and the tail's curved faces is drawn in their own unrolled frame: (g, z), g the
# distance round the body's outline in plan at that height, from the middle out round the corner and back along the
# side (on the flat of the face g is nearly x). A lamp so drawn sweeps round the corner onto the fender as the real
# one does, and never hangs off the body (a lamp projected from ahead missed the corner and stuck out in the air).


BVH = BVHTree.FromObject(body, car.bpy.context.evaluated_depsgraph_get())
CONTOURS = {}


def contour(z, end):
    """The body's outline in plan at height z round the nose (end 1) or the tail (-1), from its middle out round the
    corner and back along the side: [(g, x, y)], found by rays cast in at the skin from all round a point inside"""
    key = (round(z, 3), end)
    if key not in CONTOURS:
        c = Vector((0, end * (NOSE - 0.95), z))
        line, last = [], None
        for i in range(241):
            a = math.radians(i * 0.5)
            d = Vector((math.sin(a), end * math.cos(a), 0))
            hit = BVH.ray_cast(c + d * 3.0, -d, 3.0)[0]
            if hit is None:
                continue
            x, y = hit.x, hit.y
            g = x if last is None else last[0] + math.hypot(x - last[1], y - last[2])
            last = (g, x, y)
            line.append(last)
        # (each point's normal: square to the outline in plan, smooth along it; the faces' own normals jumped at the
        # section's creases and tore what was laid along them)
        out = []
        for i, (g, x, y) in enumerate(line):
            p0, p1 = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
            n = Vector((p1[2] - p0[2], -(p1[1] - p0[1]), 0))
            if n.dot(Vector((x, y - c.y, 0))) < 0:
                n = -n
            n = n.normalized() if n.length > 1e-9 else Vector((0, end, 0))
            out.append((g, x, y, n.x, n.y, 0.0))
        CONTOURS[key] = out
    return CONTOURS[key]


def unrolled(g, z, s, end, lift=0.0):
    """The point on the skin at (g, z) of the nose's (end 1) or tail's (-1) unrolled frame, on side s, `lift` m off it
    along the skin's normal there (the rays' own: laid on to the nearest point instead, a lamp's edge on the hood's
    fold snapped to either side of it and tore)"""
    line = contour(z, end)
    a = b = line[0] if g < line[0][0] else line[-1]
    f = 0.0
    for p0, p1 in zip(line, line[1:]):
        if p0[0] <= g <= p1[0]:
            a, b, f = p0, p1, ((g - p0[0]) / (p1[0] - p0[0]) if p1[0] > p0[0] else 0)
            break
    x, y = a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f
    n = Vector([a[3 + k] + (b[3 + k] - a[3 + k]) * f for k in range(3)]).normalized()
    return (s * (x + n.x * lift), y + n.y * lift, z + n.z * lift)


def resample(poly, n):
    """The polyline [(g, z)...] as n + 1 points evenly along it"""
    d = [0.0]
    for (a, b), (c, e) in zip(poly, poly[1:]):
        d.append(d[-1] + math.hypot(c - a, e - b))
    out = []
    for i in range(n + 1):
        t = d[-1] * i / n
        for k in range(len(poly) - 1):
            if d[k] <= t <= d[k + 1] or k == len(poly) - 2:
                f = (t - d[k]) / (d[k + 1] - d[k]) if d[k + 1] > d[k] else 0
                out.append((poly[k][0] + (poly[k + 1][0] - poly[k][0]) * f, poly[k][1] + (poly[k + 1][1] - poly[k][1]) * f))
                break
    return out


def patch(name, top, bot, role, s, end, offset=0.002, n=40, rows=3):
    """A filled shape on the nose (end 1) or the tail (-1) between its top and bottom edges [(g, z)...] (each from its
    inner end to its outer), on side s, laid `offset` m off the skin"""
    top, bot = resample(top, n), resample(bot, n)
    bm = car.bmesh.new()
    grid = [[bm.verts.new(unrolled(bg + (tg - bg) * r / rows, bz + (tz - bz) * r / rows, s, end, offset))
             for (tg, tz), (bg, bz) in zip(top, bot)] for r in range(rows + 1)]
    for r in range(rows):
        for i in range(n):
            f = bm.faces.new((grid[r][i], grid[r][i + 1], grid[r + 1][i + 1], grid[r + 1][i]))
            f.normal_update()
            c = f.calc_center_median()
            if f.normal.dot(Vector((c.x, c.y - end * 1.2, c.z - 0.6))) < 0:
                f.normal_flip()
    car.bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)  # (a pointed end's points together)
    ob = car.to_object(name, bm, [role])
    car.smooth(ob, 60)  # (flat facets of a lamp's chrome each caught their own reflection: a zigzag along it)
    return ob


AHEAD, BEHIND = NOSE + 0.4, TAIL - 0.4  # (the planes the face's middle's decals are drawn in, then laid on)

# ---- the nose: the hood's edge across over the face; the black shield between the lamps, the mesh grille in it
# inside the chrome V (plain, no badge), the lower grille under it; the slim boomerang head lamps from the shield's top
# corners out and round onto the fenders (a smoked housing, two projectors in chrome bowls inboard, a silver
# reflector outboard, chrome along its top and its bottom); the fog lamps' pockets low at the corners
for s in (1, -1):
    patch('seam', [(0.0, 0.776), (0.43, 0.778)], [(0.0, 0.772), (0.43, 0.774)], 'trim', s, 1, 0.0015, n=30, rows=1)
    top = [(0.425, 0.704), (0.55, 0.726), (0.65, 0.742), (0.75, 0.756), (0.85, 0.767), (0.95, 0.775), (1.05, 0.781), (1.14, 0.784)]
    bot = [(0.42, 0.640), (0.55, 0.643), (0.65, 0.651), (0.75, 0.663), (0.85, 0.680), (0.95, 0.705), (1.05, 0.742), (1.14, 0.786)]
    patch('lamp_housing', top, bot, 'gloss', s, 1, 0.003, n=36, rows=10)  # (rows close enough that none cuts
    # under the shoulder's crease, which runs through the lamp's outer end)
    # (inside the smoked housing, all filled tones, no dots or rings: the silver reflector's band along the lamp's
    # upper half, the one projector's bowl under it inboard, the amber strip at the outer end; the V's chrome
    # running on under the lamp)
    # (the reflector's band: along under the housing's top, tapering to points at both ends)
    patch('headlamp', [(0.50, 0.704), (0.56, 0.718), (0.70, 0.744), (0.85, 0.764), (0.96, 0.772)],
          [(0.50, 0.704), (0.56, 0.700), (0.70, 0.718), (0.85, 0.738), (0.96, 0.772)], 'headlamp', s, 1, 0.005, n=30, rows=4)
    # (the projector's bowl under it inboard: a rounded lens shape, filled)
    patch('chrome_bowl', [(0.575, 0.684), (0.59, 0.697), (0.62, 0.703), (0.655, 0.706), (0.685, 0.703), (0.70, 0.694)],
          [(0.575, 0.684), (0.59, 0.669), (0.62, 0.662), (0.655, 0.663), (0.685, 0.669), (0.70, 0.694)], 'chrome', s, 1, 0.005, n=16, rows=3)
    patch('amber', [(0.96, 0.776), (1.03, 0.781), (1.10, 0.784)], [(0.96, 0.760), (1.03, 0.768), (1.10, 0.781)], 'amber', s, 1, 0.005, n=12, rows=2)
    patch('chrome_brow', [(g, z + 0.010) for g, z in bot[:-1]], [(g, z + 0.003) for g, z in bot[:-1]], 'chrome', s, 1, 0.0055, n=36, rows=1)
    # the fog lamp's black pocket, low on the corner, rising outward, a lamp in it
    patch('fog_pocket', [(0.56, 0.338), (0.70, 0.342), (0.80, 0.356), (0.90, 0.378)], [(0.56, 0.296), (0.70, 0.296), (0.80, 0.306), (0.90, 0.33)], 'pocket', s, 1, 0.0025, n=24, rows=2)
    patch('fog', [(0.60, 0.330), (0.72, 0.333)], [(0.60, 0.306), (0.72, 0.306)], 'headlamp', s, 1, 0.0034, n=10, rows=2)
front(car.panel('shield', [(-0.43, 0.672), (0.43, 0.672), (0.48, 0.32), (-0.48, 0.32)], AHEAD, 'gloss', 1, n=30, m=8), 0.0022)
front(car.panel('shield', [(-0.48, 0.32), (0.48, 0.32), (0.45, 0.298), (-0.45, 0.298)], AHEAD, 'gloss', 1, n=30, m=2), 0.0026)
front(car.panel('grille', [(-0.38, 0.668), (0.38, 0.668), (0.21, 0.475), (-0.21, 0.475)], AHEAD, 'pocket', 1, n=24, m=4), 0.0032)
for i in range(-9, 10):  # (its mesh: bars both ways across it)
    x = i * 0.045
    for a, b in (((x - 0.09, 0.478), (x + 0.09, 0.664)), ((x + 0.09, 0.478), (x - 0.09, 0.664))):
        # (cut to the grille's trapezoid, so no bar sticks out past it)
        pts = [(a[0] + (b[0] - a[0]) * t / 20, a[1] + (b[1] - a[1]) * t / 20) for t in range(21)]
        pts = [(px, pz) for px, pz in pts if abs(px) < 0.21 + (0.38 - 0.21) * (pz - 0.475) / 0.193 - 0.01]
        if len(pts) > 1:
            front(car.decal('grille_bar', pts, 0.004, AHEAD, 'trim', 1, step=0.025), 0.0042)
vbar = [(-0.43, 0.660), (-0.37, 0.606), (-0.29, 0.522), (-0.23, 0.465), (-0.18, 0.453), (0, 0.451), (0.18, 0.453),
        (0.23, 0.465), (0.29, 0.522), (0.37, 0.606), (0.43, 0.660)]
front(car.decal('chrome_v', vbar, lambda x, z: 0.022 + 0.008 * smooth((abs(x) - 0.28) / 0.15), AHEAD, 'chrome', 1), 0.0045)
for z in (0.315, 0.345, 0.375, 0.405):  # (the lower grille's bars)
    front(car.decal('grille_bar', [(-0.42, z), (0.42, z)], 0.006, AHEAD, 'pocket', 1, step=0.03), 0.0034)

# ---- the tail: the boomerang lamps from the quarters round onto the trunk lid, tapering in to a point; the lid's
# shut line round the plate's recess; the black lower bumper with its reflectors
for s in (1, -1):
    top = [(0.40, 0.935), (0.55, 0.958), (0.70, 0.972), (0.85, 0.978), (0.95, 0.978), (1.05, 0.972), (1.15, 0.962)]
    bot = [(0.40, 0.915), (0.55, 0.895), (0.70, 0.865), (0.85, 0.845), (0.95, 0.845), (1.05, 0.885), (1.15, 0.962)]
    patch('lamp', top, bot, 'lamp', s, -1, 0.003, n=36, rows=5)
    patch('lampbright', [(g, z - 0.014) for g, z in top[2:-1]] + [(1.12, 0.955)], [(g, z - 0.034) for g, z in top[2:-1]] + [(1.12, 0.955)], 'lampbright', s, -1, 0.0042, n=24, rows=2)
    rear(car.panel('reflector', [(s * 0.60, 0.35), (s * 0.70, 0.35), (s * 0.70, 0.37), (s * 0.60, 0.37)], BEHIND, 'lamp', -1, n=8, m=2), 0.0045)
# (the trunk lid's shut line: up either side through the lamps (over them) to the deck, across under the plate)
rear(car.decal('seam', [(-0.585, 0.88), (-0.585, 0.645), (-0.56, 0.62), (0.56, 0.62), (0.585, 0.645), (0.585, 0.88)], 0.003, BEHIND, 'trim', -1), 0.0012)
for s in (1, -1):
    rear(car.decal('seam', [(s * 0.585, 0.88), (s * 0.585, 0.99)], 0.003, BEHIND, 'trim', -1), 0.005)
rear(car.panel('plate_recess', [(-0.21, 0.81), (0.21, 0.81), (0.21, 0.655), (-0.21, 0.655)], BEHIND, 'pocket', -1, n=20, m=4), 0.0015)
rear(car.panel('bumper', [(-0.74, 0.43), (0.74, 0.43), (0.70, 0.31), (-0.70, 0.31)], BEHIND, 'trim', -1, n=30, m=4), 0.0025)

# ---- the doors' body-coloured pull handles, each in its dark recess, on the shoulder's crease
for s in (1, -1):
    for y in (B_POST[0] + 0.30, D_POST[0] + 0.24):
        z = lerp(SHOULDER, y) - 0.035
        rec = car.strip('handle_recess', [(s * side_x(y, z - 0.012), y + 0.075, z - 0.012), (s * side_x(y, z - 0.012), y - 0.075, z - 0.012)], (s, 0, 0), 0.03, 'trim')
        car.onto(rec, body, 0.0012)
        h = car.box('paint_handle', (0, 0, 0), (0.016, 0.15, 0.026), 'paint', bevel=0.006)
        h.location = (s * (side_x(y, z) + 0.006), y, z)

# ---- the mirrors: body-coloured caps on black feet at the front windows' black sails
for s in (1, -1):
    D = A_TIP - 0.035
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.03) - 0.04
    inner = [(D + 0.01, z), (D - 0.15, z), (D - 0.16, z + 0.10), (D - 0.06, z + 0.11), (D + 0.01, z + 0.06)]
    outer = [(D - 0.05, z + 0.01), (D - 0.16, z + 0.01), (D - 0.16, z + 0.095), (D - 0.09, z + 0.10), (D - 0.05, z + 0.06)]
    m = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.115), 'paint')
    car.bevelled(m, 0.026, 4, angle=20)
    car.smooth(m, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.11, 0.002, 0.07), 'glass')
    g.location = (s * (W + 0.065), D - 0.1635, z + 0.05)
    car.box('mirror_foot', (s * (x0 + 0.03), D - 0.05, z + 0.01), (0.06, 0.10, 0.03), 'trim', bevel=0.006)

car.strip('wiper', [(x, WS_FOOT - 0.06, lerp(TOP, WS_FOOT - 0.06)) for x in (-0.66, 0.30)], (0, 0.5, 1), 0.02, 'trim', lift=0.01)
car.strip('wiper', [(x, WS_FOOT - 0.07, lerp(TOP, WS_FOOT - 0.07)) for x in (0.05, 0.62)], (0, 0.5, 1), 0.02, 'trim', lift=0.01)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.20, 0.36), (1.56, 2.40, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.85, 0.86), (1.56, 0.40, 0.15), 'interior', bevel=0.045)
for s in (1, -1):
    car.soft_box('interior_door', (s * (W - 0.12), -0.20, 0.78), (0.06, 2.10, 0.28), 'interior', bevel=0.02)
    car.soft_box('interior_seat', (s * 0.37, 0.15, 0.56), (0.48, 0.50, 0.12), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.37, -0.13, 0.88), (0.46, 0.12, 0.58), 'interior', bevel=0.04, tilt=0.22)
    car.soft_box('interior_headrest', (s * 0.37, -0.21, 1.22), (0.24, 0.10, 0.16), 'interior', bevel=0.035, tilt=0.22)
car.soft_box('interior_bench', (0, -0.85, 0.58), (1.40, 0.48, 0.12), 'interior', bevel=0.04)
car.soft_box('interior_benchback', (0, -1.13, 0.88), (1.40, 0.12, 0.52), 'interior', bevel=0.04, tilt=0.30)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=32, minor_segments=8,
                                     location=(-0.37, 0.55, 0.90), rotation=(math.radians(62), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))

# ---- the wheels: road tyres; 16" alloys, five pairs of machined spokes over a dark dish
for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.006, lug=0.0, spokes=10)

# (the alloys' spokes: five pairs splaying out from the hub to the rim, slender, in place of carlib's ten flat bars)
for ob in [o for o in car.bpy.data.objects if o.name.startswith('wheel_spokes')]:
    car.bpy.data.objects.remove(ob)
dish = car.material('dish')  # (the dark dish behind the spokes: 'wheel' in the game, its own colour)
dish.diffuse_color = (0.02, 0.02, 0.022, 1)
dish.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.02, 0.022, 1)
dish.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
for ob in [o for o in car.bpy.data.objects if o.name.startswith('wheel_cover')]:
    ob.data.materials[0] = dish


def alloy(x, yc):
    side = 1 if x > 0 else -1
    face = x + side * 0.49 * TYRE_W
    bm = car.bmesh.new()

    def at(r, a, out):  # (a point on the wheel's face at radius r, angle a, `out` m proud of the face's plane)
        return (face - side * (0.006 - out), yc + r * math.cos(a), TYRE_R + r * math.sin(a))

    def spoke(a0, a1, w0, w1, r0, r1, rise0, rise1):
        # (a slab from the hub, angle a0, to the rim, angle a1: w0 and w1 m wide there, standing rise0/rise1 m proud)
        quads = []
        for r, a, w, rise in ((r0, a0, w0, rise0), (r1, a1, w1, rise1)):
            da = w / 2 / r
            quads.append([at(r, a - da, rise), at(r, a + da, rise), at(r, a + da, rise - 0.016), at(r, a - da, rise - 0.016)])
        (p0, p1, p2, p3), (q0, q1, q2, q3) = [[bm.verts.new(v) for v in q] for q in quads]
        for f in ((p0, p1, q1, q0), (p1, p2, q2, q1), (p2, p3, q3, q2), (p3, p0, q0, q3), (p0, p3, p2, p1), (q0, q1, q2, q3)):
            bm.faces.new(f)

    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        for d in (-1, 1):
            spoke(a + d * 0.14, a + d * 0.20, 0.040, 0.054, 0.07, RIM - 0.008, 0.004, -0.002)
    n = 40  # (the rim's lip)
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        spoke(a0, a1, 0.022, 0.022, RIM - 0.002, RIM - 0.002, 0.0, 0.0)
    car.bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    car.bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = car.to_object('wheel_spokes', bm, ['alloy'])
    car.smooth(ob, 35)
    car.disc_mesh('wheel_hub', (face + side * 0.002, yc, TYRE_R), side, 0.085, 0.024, 'alloy', n=30)
    car.disc_mesh('wheel_badge', (face + side * 0.004, yc, TYRE_R), side, 0.032, 0.004, 'gloss', n=24)


for yc in AXLES:
    for s in (1, -1):
        alloy(s * TRACK / 2, yc)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    al = car.material('alloy').node_tree.nodes['Principled BSDF']  # (machined aluminium in the renders)
    al.inputs['Base Color'].default_value = (0.75, 0.76, 0.78, 1)
    al.inputs['Roughness'].default_value = 0.22
    al.inputs['Metallic'].default_value = 1.0
    views = [('photo', 324, 5, 8.0, 45), ('front', 35, 7, 9.5), ('rear', 145, 8, 9.5), ('side', 90, 2, 10.5),
             ('face', 0, 3, 4.4, 50, (0, 2.0, 0.55)), ('lamp', 30, 4, 2.6, 50, (0.55, 2.0, 0.65)),
             ('tail', 180, 6, 4.4, 50, (0, -2.0, 0.70)), ('high', 140, 32, 9), ('tail3q', 150, 8, 4.2, 50, (0.2, -1.9, 0.8))]
    pick = os.environ.get('VIEWS')  # (a quick look: VIEWS=front renders that one only)
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    car.HERO['headlamp'] = dict(base=(0.9, 0.91, 0.93), rough=0.22, metal=0.6)  # (the reflector's chrome reads bright,
    # as in the photographs, not as a mirror of the dark street)
    car.hero(renders, 'versa', paint=dict(base=(0.55, 0.56, 0.58), rough=0.18, metal=0.7, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
