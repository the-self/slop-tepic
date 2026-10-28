# tools/models/blender/chevrolet-aveo.py
# The Chevrolet Aveo as Mexico sold it from 2018 to 2023 (the third Chevrolet Sail, built by SAIC-GM in China),
# modelled by script (carlib.py): a rounded three-box sedan lofted through its sections, the nose rounded in plan and
# in profile, the shoulder's crease from the head lamps to the tail lamps, the hood sloping down to the lamps, the
# raked windshield, the arched roof, the long rear window down to the short high trunk; the black-framed side glass,
# the mirrors' black sails, the rear doors' quarter lights behind a slim post, the C pillar's steel; laid onto that
# skin (wrapped round its corners by rays, `skin` below): the swept-back head lamps reaching into the fenders (clear
# lenses over their reflectors' chambers), the black slot under the hood's edge with a plain bar across it where the
# badge is (no brands in the game), the six-sided slatted grille under it, the fog lamps' blank housings and the low
# intake; the trapezoid tail lamps wrapping round the corners, the trunk lid's plate recess and its shut lines;
# body-coloured mirrors and handles, 14" steel wheels under five-split-spoke hubcaps (the LS, the commonest). Real sizes (GM; Wikipedia's Chevrolet Sail, third generation; Autocosmos México's Aveo LS): 4.300 m
# long, 1.735 m wide (no mirrors), 1.504 m high, a 2.500 m wheelbase, a 1.477 m front and 1.468 m rear track,
# 185/60 R14 tyres (0.578 m across).
#   blender -b --factory-startup -P tools/models/blender/chevrolet-aveo.py -- <out.glb> [<render dir> [<out.blend>]]
import math
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL = 2.150, -2.150
W = 0.8675  # half the body's width
NOSE_R, TAIL_R = 0.44, 0.50  # (how far back the corners round off in plan)
NOSE_P, TAIL_P = 2.7, 2.2  # (the corners' superellipse exponents: rounder than the Tsuru's)
AXLES = (1.30, -1.20)  # (a 0.85 m front overhang, 0.95 m behind)
TYRE_R, TYRE_W, RIM = 0.289, 0.185, 0.178
TRACK = 1.472
ARCH = 0.345  # (the wheel arches' radius, round the axle)
SHELF = 0.085  # (how far the glass's sill sits in from the shoulder: m)
CROWN = 0.055  # (the roof's crown, its middle over its edges)
ROOF_HALF = 0.585  # (the roof's half-width between its rails)
COWL = 0.93  # (the hood's back edge, under the windshield's foot)
WS_FOOT = COWL - 0.03
HEADER, ROOF_END, REAR_END = 0.17, -0.93, -1.62  # (the windshield's top; the rear window from the roof's end down to
# the trunk's deck)
SAIL = 0.13  # (the mirror's black triangle ahead of the front door's glass: m along)
B_POST, D_POST = (-0.20, -0.12), (-0.79, -0.76)  # (the B pillar; the slim post before the quarter lights)


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


# the centreline's top: the bumper's rounded face up to the hood's leading edge over the grille's slot, the hood
# sloping down to it, the windshield, the arched roof, the long rear window, the short trunk's deck and its lip, and
# down the trunk lid's face to the bumper
TOP = [(NOSE, 0.50), (2.148, 0.55), (2.143, 0.60), (2.134, 0.65), (2.122, 0.70), (2.105, 0.745), (2.085, 0.785),
       (2.06, 0.812), (2.03, 0.828), (2.00, 0.838), (1.85, 0.862), (1.60, 0.900), (1.30, 0.945), (1.05, 0.985),
       (COWL, 0.998), (0.80, 1.065), (0.60, 1.175), (0.40, 1.29), (0.25, 1.372), (HEADER, 1.41), (0.05, 1.452), (-0.10, 1.478),
       (-0.35, 1.500), (-0.60, 1.498), (-0.80, 1.482), (ROOF_END, 1.462), (-1.02, 1.425), (-1.15, 1.345),
       (-1.30, 1.27), (-1.45, 1.20), (-1.55, 1.15), (REAR_END, 1.122), (-1.70, 1.105), (-1.85, 1.10), (-1.98, 1.106),
       (-2.025, 1.112), (-2.05, 1.095), (-2.075, 1.055), (-2.092, 1.00), (-2.104, 0.92), (-2.112, 0.835),
       (-2.118, 0.765), (-2.130, 0.72), (-2.140, 0.68), (-2.147, 0.62), (TAIL, 0.56)]
BOTTOM = [(NOSE, 0.46), (2.148, 0.40), (2.14, 0.34), (2.122, 0.285), (2.09, 0.245), (2.02, 0.215), (1.90, 0.20),
          (1.0, 0.165), (-1.55, 0.17), (-1.85, 0.20), (-2.0, 0.235), (-2.09, 0.28), (-2.13, 0.34), (-2.146, 0.42),
          (TAIL, 0.50)]
# the side's beltline: along the fenders' tops by the hood, the glass's sill rising gently to the rear, along the
# trunk's deck, and down round the tail
BELT = [(NOSE, 0.48), (2.12, 0.68), (2.09, 0.745), (2.04, 0.795), (1.85, 0.83), (1.30, 0.915), (COWL, 0.962),
        (0.0, 0.992), (-0.80, 1.022), (-1.30, 1.042), (REAR_END, 1.058), (-1.98, 1.058), (-2.05, 1.025),
        (-2.09, 0.96), (-2.11, 0.82), (TAIL, 0.52)]
# the shoulder's crease, the widest point: low along the front fender behind the lamps, rising to the tail lamps
SHOULDER = [(NOSE, 0.72), (1.80, 0.775), (1.30, 0.820), (0.0, 0.858), (-1.20, 0.893), (-1.90, 0.915), (TAIL, 0.91)]


def corner(t, r, p):
    return r * (1 - min(0.995, t) ** p) ** (1 / p)


def half_width(y):
    """The body's half-width in plan at y: its corners rounded (superellipses)"""
    if y > NOSE - NOSE_R:
        return W - NOSE_R + corner((y - (NOSE - NOSE_R)) / NOSE_R, NOSE_R, NOSE_P)
    if y < TAIL + TAIL_R:
        return W - TAIL_R + corner(((TAIL + TAIL_R) - y) / TAIL_R, TAIL_R, TAIL_P)
    return W


def fender_rise(y):
    """How far the fenders' crests stand over the hood along it (m): nothing at the cowl, most over the front wheels,
    where from ahead the lamps' outer ends rise with them, then down round the nose"""
    return 0.03 * smooth((y - COWL) / 0.5) * (1 - smooth((y - 2.04) / 0.08))


def section(y):
    bot, top, w = lerp(BOTTOM, y), lerp(TOP, y), half_width(y)
    belt = min(lerp(BELT, y), top - 0.005) + (fender_rise(y) if y > COWL else 0.0)
    # (round the nose and the tail the sides' tucks fade out: there the sides are the bumpers' faces)
    k = 1 - 0.85 * max(smooth((y - (NOSE - 0.45)) / 0.35), smooth(((TAIL + 0.38) - y) / 0.32))  # (eased: a kink in it
    # showed as a crease down the fender)
    bw = w - SHELF * (0.15 + 0.85 * k)
    h = belt - bot
    z2 = bot + min(0.05, 0.12 * h)
    z3 = bot + min(0.15, 0.32 * h)
    shoulder = clamp(lerp(SHOULDER, y), z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
    z5 = shoulder + (belt - shoulder) * 0.55
    crown = clamp(top - belt, 0.0, CROWN)
    edge = top - crown
    rw = bw - (bw - min(ROOF_HALF, bw)) * clamp((edge - belt) / 0.42, 0, 1)
    # the windows' top: just under the roof's edge over the doors, then down the C pillar behind the quarter lights
    run = math.hypot(rw - bw, edge - belt)
    band = 0.018 + run * clamp((D_POST[0] - 0.10 - y) / 0.36, 0, 1)
    t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
    upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
             (rw * 0.45, top - crown * 0.08)]
    if belt > top:
        # the hood a little under the fenders' crests: their inner slope down to it, the hood crowned in its middle
        dip, f = belt - top, min(1.0, (belt - top) / 0.02)
        upper = [(bw, belt), (bw - 0.05, belt - 0.5 * dip), (bw - 0.05 - 0.12 * f, top - 0.006 * f),
                 (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
    e = 1 - k  # (round the ends the bumpers' lower corners tuck in)
    # (the shoulder's crease runs from the head lamp's tip to the tail lamp's and fades out before them: under a lamp
    # its downward face tore the lamp's lower edge)
    kc = (1 - smooth((y - 1.52) / 0.18)) * (1 - smooth((-1.45 - y) / 0.15))
    return [(0, bot), (w - 0.12 * (0.5 + 0.5 * k) - 0.10 * e, bot), (w - 0.04 * k - 0.08 * e, z2), (w - 0.02 * k - 0.03 * e, z3),
            (w - 0.028 * kc, shoulder - 0.035 * k - 0.001), (w, shoulder), (w - 0.014 * kc, shoulder + 0.010 * k + 0.001),
            (w - 0.05 * k, z5), (bw, belt), *upper, (0, top)]


def glass_rise(y):
    s = section(y)
    return s[9][1] - s[8][1]


def where(f, lo, hi):
    """The y between lo and hi where f turns false (true at lo)"""
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


A_TIP = where(lambda y: glass_rise(y) > 0.08, 0.2, COWL)  # (the A pillar's foot)
QUARTER_END = where(lambda y: glass_rise(y) > 0.04, -0.8, -1.6)  # (the quarter light's point, under the C pillar)


def role(y, seg, side):
    # segments: 0 the floor, 1 the sill's foot, 2-7 the side (4 and 5 the shoulder's crease: the dip under it, the
    # ridge), 8 the side glass, 9 the band over it, 10 the roof's rail, 11-12 the top
    if seg < 0:
        return 'paint'
    if seg == 0:
        return 'paint' if y > NOSE - 0.12 or y < TAIL + 0.12 else 'under'
    if seg == 1:
        return 'paint' if y > AXLES[0] - ARCH or y < AXLES[1] + ARCH else 'under'
    if seg == 8:
        if B_POST[0] < y < B_POST[1] or D_POST[0] < y < D_POST[1] or A_TIP - SAIL < y < A_TIP:
            return 'trim'
        if B_POST[1] < y < A_TIP - SAIL:
            return f'glass:front{side}'
        if D_POST[1] < y < B_POST[0]:
            return f'glass:rear{side}'
        if QUARTER_END < y < D_POST[0]:
            return f'glass:quarter{side}'
    if seg == 9:
        return 'trim' if QUARTER_END < y < A_TIP else 'paint'
    if seg >= 11:
        if HEADER < y < WS_FOOT:
            return 'glass:windshield'
        if REAR_END < y < ROOF_END - 0.02:
            return 'glass:back'
    return 'paint'


edges = [NOSE, TAIL, WS_FOOT, COWL, HEADER, ROOF_END - 0.02, REAR_END, A_TIP, A_TIP - SAIL, *B_POST, *D_POST,
         QUARTER_END, -2.025, -2.05, -2.075, -2.092, -2.104, -2.112, -2.118, -2.13, -2.14]
grid = []
y = NOSE
while y > TAIL:
    grid.append(y)
    end = min(NOSE - y, y - TAIL)
    arch = any(abs(y - yc) < ARCH + 0.05 for yc in AXLES)
    y -= 0.008 if end < 0.06 else 0.016 if end < 0.14 else 0.02 if arch else 0.03 if end < NOSE_R + 0.05 else 0.06
STATIONS = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.004 for e in edges)]), reverse=True)
body = car.loft('body', [(y, section(y)) for y in STATIONS], role, frame_role='trim', recess=0.008,
                frame={None: 0.022, 'windshield': 0.045, 'back': 0.04})

# ---- the wheel arches: round, cut out of the sides (their wells dark)
wells = []
for yc in AXLES:
    arc = [(yc + ARCH * math.cos(math.radians(a)), TYRE_R + 0.005 + ARCH * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    outline = [(yc + ARCH, -0.2)] + arc + [(yc - ARCH, -0.2)]
    for s in (1, -1):
        wells.append(car.prism('well', outline, s * 0.52, s * 1.3, 'under'))
car.cut(body, *wells)
car.tidy(body, 75, weighted=False)

# ---- laying parts onto the skin by rays: the nose's and the tail's lamps wrap round their corners, which a
# projection along y misses and a nearest-point wrap smears
_tree = []


def tree():
    if not _tree:
        _tree.append(BVHTree.FromObject(body, car.bpy.context.evaluated_depsgraph_get()))
    return _tree[0]


def ray(u, z, end, s):
    """The ray that finds the skin at `u` (m along the outline from the middle: across the end's face, round its
    corner, then along the side) and height z, at the nose (end 1) or the tail (-1), on side s"""
    r = NOSE_R if end > 0 else TAIL_R
    cx = W - r
    cy = NOSE - r if end > 0 else TAIL + r
    if u <= cx:
        return Vector((s * u, cy + end * 3, z)), Vector((0, -end, 0))
    a = (u - cx) / r
    if a <= math.pi / 2:
        d = Vector((s * math.sin(a), end * math.cos(a), 0))
        return Vector((s * cx, cy, z)) + d * 3, -d
    along = (u - cx) - r * math.pi / 2
    return Vector((s * 3, cy - end * along, z)), Vector((-s, 0, 0))


def skin(name, bottom, top, role, end, s=1, offset=0.003, n=40, m=4):
    """A part laid on the skin by rays (`ray`): between the polylines `bottom` and `top` [(u, z)...] (u rising, both
    over the same span), cut n along by m across, `offset` m off the surface"""
    import bmesh
    u0, u1 = bottom[0][0], bottom[-1][0]

    def at(poly, u):  # (the polyline's z at u: its upright segments, a rectangle's sides, skipped)
        for (a0, b0), (a1, b1) in zip(poly, poly[1:]):
            if a1 - a0 > 1e-9 and a0 - 1e-9 <= u <= a1 + 1e-9:
                return b0 + (b1 - b0) * (u - a0) / (a1 - a0)
        return poly[0][1] if u <= poly[0][0] else poly[-1][1]

    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        u = u0 + (u1 - u0) * i / n
        zb, zt = at(bottom, u), at(top, u)
        row = []
        for j in range(m + 1):
            z = zb + (zt - zb) * j / m
            o, d = ray(u, z, end, s)
            hit, nrm, _, _ = tree().ray_cast(o, d, 6.0)
            if hit is None:
                hit, nrm = o + d * 3, -d
            row.append((bm.verts.new(hit + nrm * offset), nrm))
        rows.append(row)
    for i in range(n):
        for j in range(m):
            a, b, c, d = rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]
            f = bm.faces.new((a[0], b[0], c[0], d[0]))
            f.normal_update()
            if f.normal.dot(a[1] + c[1]) < 0:
                f.normal_flip()
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    ob = car.to_object(name, bm, [role])
    car.smooth(ob, 60)
    return ob


def edge(u, end, s=1, lo=0.55, hi=1.3, facing=0.5):
    """How high the end's face reaches at u: the highest z (scanning up from lo) where the skin still faces out along
    the ray (its normal within ~60° of it), where it turns over into the hood or the deck"""
    def out(z):
        o, d = ray(u, z, end, s)
        hit, nrm, _, _ = tree().ray_cast(o, d, 6.0)
        return hit is not None and nrm.dot(-d) >= facing

    z = lo
    while z < hi and out(z + 0.01):
        z += 0.01
    return where(out, z, z + 0.01)  # (then to the millimetre)


def under_edge(points, end, s=1, margin=0.010):
    """The polyline [(u, z)...] kept under the face's edge (`edge`), `margin` m below it"""
    tops = [edge(u, end, s) - margin for u, _ in points]
    tops = [min(tops[max(0, i - 2):i + 3]) for i in range(len(tops))]  # (the lowest nearby, then smoothed: the skin's
    tops = [sum(tops[max(0, i - 3):i + 4]) / len(tops[max(0, i - 3):i + 4]) for i in range(len(tops))]  # facets step it)
    return [(u, min(z, t)) for (u, z), t in zip(points, tops)]


def outline(points, step=0.012):
    """A closed shape [(u, z)...] split into its bottom and top polylines over u (its leftmost and rightmost points
    shared), for skin()"""
    i0 = min(range(len(points)), key=lambda i: points[i][0])
    pts = points[i0:] + points[:i0]
    i1 = max(range(len(pts)), key=lambda i: pts[i][0])
    a, b = pts[:i1 + 1], [pts[0]] + pts[i1:][::-1]
    lower, upper = (a, b) if sum(z for _, z in a) / len(a) < sum(z for _, z in b) / len(b) else (b, a)
    return lower, upper


def side_x(y, z):
    pts = section(y)[2:9]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


def onto(ob, offset=0.0015):
    return car.onto(ob, body, offset)


# ---- the shut lines: the doors' edges, the hood's along the fenders, the trunk lid's round its deck
seams = []
for s in (1, -1):
    for y in (A_TIP - 0.02, (B_POST[0] + B_POST[1]) / 2, -0.99):
        pts = [(s * side_x(y, z), y, z) for z in (0.30 + k * 0.05 for k in range(14)) if z < lerp(BELT, y) - 0.02]
        seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
    hood = [(s * (half_width(y) - SHELF - 0.05), y, lerp(TOP, y)) for y in [1.95 - 0.05 * k for k in range(int((1.95 - COWL) / 0.05) + 1)]]
    seams.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
    deck = [(s * (half_width(y) - SHELF - 0.03), y, lerp(TOP, y)) for y in [REAR_END - 0.03 - 0.05 * k for k in range(9)]]
    seams.append(car.strip('seam', deck, (0, 0, 1), 0.004, 'trim'))
    # (the rear bumper's edge on the side: from under the tail lamp down to the arch)
    pts = [(s * side_x(-1.86 + 0.30 * t, 0.84 - 0.24 * t), -1.86 + 0.30 * t, 0.84 - 0.24 * t) for t in (i / 12 for i in range(13))]
    seams.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
seams.append(car.strip('seam', [(x, COWL + 0.03, lerp(TOP, COWL + 0.03)) for x in (-0.66, 0.66)], (0, 0, 1), 0.004, 'trim'))
seams.append(car.strip('seam', [(x, REAR_END - 0.03, lerp(TOP, REAR_END - 0.03)) for x in (-0.62, 0.62)], (0, 0, 1), 0.004, 'trim'))
for ob in seams:
    onto(ob)

# ---- the nose: the head lamps swept back from beside the grille round the corners into the fenders, each a clear lens
# over a chrome reflector: its own outline (blunt beside the grille, pointed at its outer tip up on the fender, the
# lower edge sweeping up to it, the top the hood's edge), and inside it the reflector's chambers as filled tones: a
# graphite band along its lower edge, the low beam's brighter chrome bowl, the amber at the outer
# end. Between them the thin black slot under the hood's edge (a plain body-coloured bar across its middle, where the
# maker's badge is: the game shows no brands) and the six-sided black grille under it with its slats; low on the
# bumper the wide intake with its two bars and the fog lamps' blank housings at the corners. Everything stays inside
# the face's edge (`under_edge`), so nothing hangs over the hood or the fender.
LAMP_U = [0.31 + 0.017 * i for i in range(51)]  # (the lamp's span, u: 0.31 beside the grille to 1.16 on the fender)


def sweep(points, us):
    """The polyline [(u, z)...] sampled at us"""
    return [(u, lerp([(-a, b) for a, b in points], -u)) for u in us]


for s in (1, -1):
    top = under_edge([(u, 0.95) for u in LAMP_U], 1, s, margin=0.012)
    tip = top[-1][1]
    low = sweep([(0.31, 0.745), (0.315, 0.722), (0.33, 0.705), (0.36, 0.690), (0.50, 0.675), (0.66, 0.675),
                 (0.80, 0.690), (0.92, 0.716), (1.02, 0.752), (1.10, 0.800), (1.16, tip)], LAMP_U)
    top = [(u, max(z, b)) for (u, z), (_, b) in zip(top, low)]
    # (the lens: clear glass over a chrome reflector, so a chrome grey all over, not white: its own material,
    # 'reflector', the game's 'light')
    skin('reflector', low, top, 'reflector', 1, s, 0.004, n=48, m=6)
    chrome = car.material('reflector')
    chrome.diffuse_color = (0.42, 0.43, 0.45, 1)
    bsdf = chrome.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.42, 0.43, 0.45, 1)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.18

    def band(u0, u1, z0, z1, n=24):
        """A band inside the lamp between u0 and u1, z0 to z1 m over its lower edge, its ends rounded off"""
        us = [u0 + (u1 - u0) * i / n for i in range(n + 1)]
        out_lo, out_hi = [], []
        for (u, zl), (_, zh) in zip(sweep(low, us), sweep(top, us)):
            t = min(u - u0, u1 - u) / 0.025  # (round the ends: the band closes over its last 2.5 cm)
            r = math.sqrt(max(0.0, 1 - (1 - min(1.0, t)) ** 2))
            a, b = zl + z0, min(zl + z1, zh - 0.008)
            mid, half = (a + b) / 2, max(0.0, (b - a) / 2) * r
            out_lo.append((u, mid - half))
            out_hi.append((u, mid + half))
        return out_lo, out_hi

    # (the graphite housing: a band along the lens's lower edge, from its inner end out under the bowl, not round it)
    lo, hi = band(0.32, 0.86, 0.006, 0.036)
    skin('housing', lo, hi, 'housing', 1, s, 0.0060, n=34, m=2)
    grey = car.material('housing')  # (its own colour in the game, 'own': graphite, half metal)
    grey.diffuse_color = (0.15, 0.155, 0.16, 1)
    bsdf = grey.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.15, 0.155, 0.16, 1)
    bsdf.inputs['Metallic'].default_value = 0.5
    bsdf.inputs['Roughness'].default_value = 0.3
    # (the low beam's bowl: a brighter chrome ellipse straight on the reflector, over the housing's band; no ring,
    # no surround, no bulb as a dot)
    cu, ru = 0.50, 0.075
    zl, zh = lerp([(-a, b) for a, b in low], -cu), lerp([(-a, b) for a, b in top], -cu)
    cz, rz = (zl + 0.034 + zh) / 2, (zh - zl - 0.034) / 2 - 0.010
    ell = [(cu + ru * math.cos(a * math.pi / 12), cz + rz * math.sin(a * math.pi / 12)) for a in range(24)]
    lo, hi = outline(ell)
    skin('bowl', lo, hi, 'bowl', 1, s, 0.0070, n=16, m=3)
    bowl = car.material('bowl')  # (a chrome a shade brighter than the reflector's: the game's 'chrome')
    bowl.diffuse_color = (0.58, 0.59, 0.61, 1)
    bsdf = bowl.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.58, 0.59, 0.61, 1)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.14
    # (the amber in the middle of the lens where it turns round the corner)
    lo, hi = band(0.95, 1.045, 0.024, 0.075, n=16)
    skin('amber', lo, hi, 'amber', 1, s, 0.0075, n=20, m=4)
    # the fog lamps' blank housings, low on the bumper's corners
    fog = [(0.56, 0.305), (0.76, 0.300), (0.81, 0.335), (0.80, 0.398), (0.60, 0.402), (0.545, 0.37)]
    lo, hi = outline(fog)
    skin('pocket', lo, hi, 'pocket', 1, s, 0.0025, n=24, m=3)
# the slot under the hood's edge, between the lamps' inner ends, and the plain bar across its middle
us = [-0.33 + 0.022 * i for i in range(31)]
hi = under_edge([(u, 0.95) for u in us], 1, 1, margin=0.012)
skin('pocket', [(u, 0.762) for u in us], hi, 'pocket', 1, 1, 0.0025, n=40, m=2)
skin('paint_bar', [(-0.075, 0.740), (0.075, 0.740)], [(-0.075, 0.800), (0.075, 0.800)], 'paint', 1, 1, 0.0045, n=10, m=3)
# the grille: six-sided, wide at the top under the slot, its lower corners rounded; a gloss frame, slats across
lo = [(-0.375, 0.705), (-0.335, 0.585), (-0.31, 0.553), (-0.27, 0.538), (0.27, 0.538), (0.31, 0.553), (0.335, 0.585), (0.375, 0.705)]
hi = [(-0.375, 0.705), (-0.36, 0.732), (0.36, 0.732), (0.375, 0.705)]
skin('grille_frame', lo, hi, 'gloss', 1, 1, 0.0025, n=36, m=4)
lo2 = [(-0.36, 0.705), (-0.322, 0.592), (-0.30, 0.565), (-0.265, 0.552), (0.265, 0.552), (0.30, 0.565), (0.322, 0.592), (0.36, 0.705)]
hi2 = [(-0.36, 0.705), (-0.348, 0.719), (0.348, 0.719), (0.36, 0.705)]
skin('grille', lo2, hi2, 'pocket', 1, 1, 0.0035, n=36, m=4)
for z in (0.575, 0.603, 0.631, 0.659, 0.687):
    w = lerp([(0.705, 0.36), (0.592, 0.322), (0.565, 0.30), (0.552, 0.265)], z) - 0.014
    skin('grille_bar', [(-w, z - 0.005), (w, z - 0.005)], [(-w, z + 0.005), (w, z + 0.005)], 'gloss', 1, 1, 0.0045, n=30, m=1)
# the low intake, the plate over its middle; its two body-coloured bars across
skin('pocket', [(-0.50, 0.300), (0.50, 0.300)], [(-0.48, 0.395), (0.48, 0.395)], 'pocket', 1, 1, 0.0025, n=40, m=3)
for z in (0.331, 0.364):
    skin('paint_bar', [(-0.49, z - 0.006), (0.49, z - 0.006)], [(-0.49, z + 0.006), (0.49, z + 0.006)], 'paint', 1, 1, 0.0045, n=40, m=1)

# ---- the tail: the lamps on the corners, trapezoids (upright beside the trunk lid, the top along the deck's edge, the
# lower edge slanting up outward) wrapping round onto the quarters to a point; a clear reversing lamp in the inner
# lower corner, a brighter band across the top; the trunk lid's shut lines beside them and across over the bumper,
# its plate recess; the bumper's crease
TAIL_U = [0.42 + 0.018 * i for i in range(51)]
for s in (1, -1):
    top = [(u, min(z, 1.05)) for u, z in under_edge([(u, 1.2) for u in TAIL_U], -1, s, margin=0.016)]
    tip = top[-1][1]
    low = sweep([(0.42, 0.865), (0.70, 0.885), (0.95, 0.928), (1.15, 0.975), (1.32, tip)], TAIL_U)
    top = [(u, max(z, b)) for (u, z), (_, b) in zip(top, low)]
    skin('lamp', low, top, 'lamp', -1, s, 0.003, n=44, m=5)
    us = [0.43 + 0.012 * i for i in range(21)]
    lo = [(u, z + 0.008) for u, z in sweep(low, us)]
    skin('reverse', lo, [(u, z + 0.045) for u, z in lo], 'white', -1, s, 0.0042, n=20, m=2)
    # (the tail and stop lamp's chamber: the lens's upper part from the lid to round the corner, brighter)
    us = [0.45 + 0.025 * i for i in range(25)]
    hi = [(u, z - 0.014) for u, z in sweep(top, us)]
    lo = [(u, max(zb + 0.060 - 0.035 * smooth((u - 0.75) / 0.3), zb + 0.016)) for u, zb in sweep(low, us)]
    lo = [(u, min(z, zh - 0.01)) for (u, z), (_, zh) in zip(lo, hi)]
    skin('lampbright', lo, hi, 'lampbright', -1, s, 0.0045, n=36, m=3)
    # the lid's shut line down the lamp's inner edge
    skin('seam', [(0.402, 0.74), (0.405, 1.04)], [(0.406, 0.74), (0.409, 1.04)], 'trim', -1, s, 0.0015, n=1, m=20)
skin('seam', [(-0.405, 0.738), (0.405, 0.738)], [(-0.405, 0.742), (0.405, 0.742)], 'trim', -1, 1, 0.0015, n=40, m=1)
skin('plate_recess', [(-0.24, 0.757), (0.24, 0.757)], [(-0.24, 0.927), (0.24, 0.927)], 'pocket', -1, 1, 0.0015, n=20, m=4)
skin('seam', [(-0.80, 0.62), (0.80, 0.62)], [(-0.80, 0.624), (0.80, 0.624)], 'trim', -1, 1, 0.0015, n=60, m=1)

# ---- the mirrors: body-coloured caps on the black sails ahead of the front doors' glass, the glass in their back
for s in (1, -1):
    D = A_TIP - 0.03
    z = lerp(BELT, D) + 0.02
    x0 = side_x(D, z - 0.03) - 0.03
    inner = [(D + 0.01, z), (D - 0.15, z), (D - 0.16, z + 0.10), (D - 0.05, z + 0.11), (D + 0.01, z + 0.05)]
    outer = [(D - 0.05, z + 0.01), (D - 0.16, z + 0.01), (D - 0.16, z + 0.095), (D - 0.08, z + 0.10), (D - 0.05, z + 0.05)]
    mm = car.tapered('paint_mirror', inner, s * x0, outer, s * (W + 0.16), 'paint')
    car.bevelled(mm, 0.025, 3, angle=20)
    car.smooth(mm, 60)
    g = car.box('mirror_glass', (0, 0, 0), (0.11, 0.002, 0.07), 'glass')
    g.location = (s * (W + 0.10), D - 0.1635, z + 0.05)
    car.box('mirror_foot', (s * (x0 + 0.02), D - 0.04, z + 0.01), (0.05, 0.09, 0.03), 'trim', bevel=0.006)

# ---- the doors' handles (body-coloured, a dark recess behind), the side repeater on the front fender, the fuel door
for s in (1, -1):
    for y in (-0.04, -0.62):  # (near each door's back edge)
        z = lerp(SHOULDER, y) + 0.012
        x = side_x(y, z)
        rec = car.box('trim_handle', (0, 0, 0), (0.006, 0.15, 0.035), 'trim')
        rec.location = (s * (x - 0.001), y - 0.07, z)
        h = car.box('paint_handle', (0, 0, 0), (0.016, 0.13, 0.026), 'paint', bevel=0.006)
        h.location = (s * (x + 0.006), y - 0.07, z)
    rz = 0.80
    rep = car.box('chrome_repeater', (0, 0, 0), (0.008, 0.05, 0.016), 'chrome', bevel=0.004)
    rep.location = (s * (side_x(AXLES[0] - ARCH - 0.10, rz) + 0.002), AXLES[0] - ARCH - 0.10, rz)
fy, fz = -1.28, 0.86
fuel = [(math.cos(a * math.pi / 12) * 0.075 + fy, math.sin(a * math.pi / 12) * 0.075 + fz) for a in range(25)]
onto(car.strip('seam', [(side_x(py, pz), py, pz) for py, pz in fuel], (1, 0, 0), 0.004, 'trim'))

car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (-0.66, 0.30)], (0, 0.5, 1), 0.018, 'trim', lift=0.01)
car.strip('wiper', [(x, WS_FOOT - 0.05, lerp(TOP, WS_FOOT - 0.05)) for x in (0.10, 0.62)], (0, 0.5, 1), 0.018, 'trim', lift=0.01)

# ---- the cabin, seen through the glass (dropped in the game: the glass is opaque there)
car.box('interior_floor', (0, -0.20, 0.36), (1.56, 2.30, 0.04), 'interior')
car.soft_box('interior_dash', (0, 0.72, 0.88), (1.56, 0.40, 0.16), 'interior', bevel=0.04)
for s in (1, -1):
    car.soft_box('interior_seat', (s * 0.37, 0.15, 0.56), (0.48, 0.50, 0.12), 'interior', bevel=0.04)
    car.soft_box('interior_seatback', (s * 0.37, -0.13, 0.88), (0.46, 0.12, 0.60), 'interior', bevel=0.04, tilt=0.22)
    car.soft_box('interior_headrest', (s * 0.37, -0.20, 1.24), (0.24, 0.10, 0.16), 'interior', bevel=0.04, tilt=0.22)
car.soft_box('interior_bench', (0, -0.78, 0.58), (1.40, 0.46, 0.12), 'interior', bevel=0.04)
car.soft_box('interior_benchback', (0, -1.05, 0.88), (1.40, 0.12, 0.52), 'interior', bevel=0.04, tilt=0.30)
car.bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.017, major_segments=32, minor_segments=8,
                                     location=(-0.37, 0.50, 0.92), rotation=(math.radians(62), 0, 0))
steering = car.bpy.context.active_object
steering.name = 'interior_wheel'
steering.data.materials.append(car.material('interior'))

# ---- the wheels: 185/60 R14 on steel wheels under silver hubcaps, five split spokes
# (carlib's cover is ten even spokes round a hexagonal cap, which read as a gear: the Aveo LS's hubcap is five split
# spokes, smooth silver: a rim ring, a domed hub, each spoke's pair diverging from the hub to the ring, all over the
# dark dish carlib's cover leaves)


def hubcap(x, yc, s):
    import bmesh
    bm = bmesh.new()
    at = x + s * 0.49 * TYRE_W - s * 0.008  # (the cover's face, just before the dish; kept low, a centimetre at most
    # proud of the tyre's wall: prouder, prepare-made.mjs reads it as a tyre standing out of the fender and tucks it in)
    n = 60

    def p(r, a, out=0.0):
        return (at + s * out, yc + r * math.cos(a), TYRE_R + r * math.sin(a))

    def quad(a, b, c, d):
        bm.faces.new([bm.verts.new(v) for v in (a, b, c, d)])

    # the ring: its face, sloping a little out from its rim to its inner edge, and its lip back to the tyre
    r0, r1 = RIM + 0.004, RIM - 0.032
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        quad(p(r0, a0, 0.0), p(r0, a1, 0.0), p(r1, a1, 0.006), p(r1, a0, 0.006))
        quad(p(r1, a0, 0.006), p(r1, a1, 0.006), p(r1, a1, -0.004), p(r1, a0, -0.004))
        quad(p(r0, a1, -0.012), p(r0, a1, 0.0), p(r0, a0, 0.0), p(r0, a0, -0.012))
    # the hub: a low dome
    rings = [(0.060, 0.007), (0.045, 0.011), (0.026, 0.013)]
    for k in range(32):
        a0, a1 = 2 * math.pi * k / 32, 2 * math.pi * (k + 1) / 32
        quad(p(0.060, a0, -0.004), p(0.060, a1, -0.004), p(0.060, a1, 0.007), p(0.060, a0, 0.007))
        for (ra, oa), (rb, ob) in zip(rings, rings[1:]):
            quad(p(ra, a0, oa), p(ra, a1, oa), p(rb, a1, ob), p(rb, a0, ob))
        bm.faces.new([bm.verts.new(p(0.026, a0, 0.013)), bm.verts.new(p(0.026, a1, 0.013)), bm.verts.new(p(0.0, 0.0, 0.014))])
    # the spokes: five pairs, each spoke a strip from the hub to the ring, its face crowned, its sides down to the dish
    for k in range(5):
        for side in (-1, 1):
            base = 2 * math.pi * k / 5 + math.pi / 2
            ah, ar = base + side * 0.12, base + side * 0.17  # (the pair's spokes part from the hub to the ring)
            steps = 6
            prev = None
            for i in range(steps + 1):
                t = i / steps
                r = 0.056 + (r1 + 0.004 - 0.056) * t
                a = ah + (ar - ah) * t
                half = (0.016 + 0.006 * t) / r  # (its half-width: m, as an angle)
                out = 0.008 - 0.002 * t
                row = (p(r, a - half, out - 0.006), p(r, a - half, out), p(r, a, out + 0.003), p(r, a + half, out),
                       p(r, a + half, out - 0.006))
                if prev:
                    for j in range(4):
                        quad(prev[j], row[j], row[j + 1], prev[j + 1])
                prev = row
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = car.to_object('wheel_hubcap', bm, ['rim'])
    car.smooth(ob, 35)
    return ob


for yc in AXLES:
    for s in (1, -1):
        car.wheel('wheel', s * TRACK / 2, yc, TYRE_R, TYRE_W, RIM, cover='rim', segments=48, tread=0.006, lug=0.0, spokes=10)
        for ob in [o for o in car.bpy.data.objects if o.name.startswith(('wheel_spokes', 'wheel_cap'))]:
            car.bpy.data.objects.remove(ob)
        hubcap(s * TRACK / 2, yc, s)

if out:
    car.export(out)
if blend:
    car.save_blend(blend)
if renders:
    views = [('front', 35, 7, 9), ('rear', 140, 8, 8.5), ('side', 90, 2, 10.5), ('flank', 110, 14, 6.5, 50, (0.6, -0.3, 0.75)), ('face', 0, 2, 4.4, 50, (0, 2.0, 0.55)),
             ('lamp', 30, 4, 2.6, 50, (0.55, 2.0, 0.72)), ('tail', 180, 5, 4.4, 50, (0, -2.0, 0.72)),
             ('photo', 40, 9, 3.9, 26, (0.25, 0.9, 0.72)),
             ('lampside', 72, 5, 2.4, 50, (0.75, 1.75, 0.74)), ('wheel', 90, 3, 1.5, 50, (0.8, 1.30, 0.30))]
    pick = os.environ.get('VIEWS')
    if pick:
        views = [v for v in views if v[0] in pick.split(',')]
    car.hero(renders, 'aveo', paint=dict(base=(0.32, 0.015, 0.02), rough=0.2, metal=0.4, coat=1.0), views=views,
             samples=int(os.environ.get('SAMPLES', '96')))
