# tools/models/blender/shell.py
# The body the everyday cars modelled by script share: the Mazdas' lines (mazda-3.py) made a tool, so a car's own
# script (toyota-corolla.py, nissan-versa.py...) gives its numbers and lays its face and tail onto it. The shell is lofted
# through cross-sections drawn from three profiles along the car (its centreline's top, its floor, its beltline) and
# its plan's half-width: the side swelling to its shoulder and drawn in under the glass, the glass sloping in to the
# roof's rails. Then its windows (the windshield, the side glass between black posts, a quarter light behind the last
# post, the back glass), the wheel arches cut, a pickup's bed cut, the shut lines, the handles, the mirrors, the wiper,
# the cabin seen through the glass in the renders, and the wheels.
# Blender's frame (carlib.py): metres, x to the car's right, y ahead (the nose to +y), z up from the ground.
import math
import os

import carlib as car


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


def where(f, lo, hi):
    """Where f turns from true (at lo's side) to false (at hi's), by halving"""
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(mid) else (lo, mid)
    return lo


def ring(cx, cz, rx, rz, n=24, a0=0.0, a1=360.0):
    """An ellipse's arc [(x, z)...] round (cx, cz), from a0 to a1 degrees: a round lamp, an exhaust's tip"""
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + rz * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
            for i in range(n + 1)]


class Shell:
    """A car's shell from its numbers (all m, y along the car from its middle):
    nose, tail: the body's ends; half: its half-width; nose_deep, tail_r: how far back the nose's corners reach in
    plan, the tail's corners' radius; axles (front, rear); tyre (radius, width, the wheel's radius); track; arch: the
    arches' radius round the axle; top, bottom, belt: the centreline's top, the floor and the beltline [(y, z)...] nose
    to tail; cowl: the hood's back edge; header: the windshield's top; roof_end, rear_end: the back glass's top and
    foot; posts: the black posts between the side windows [(back edge, front edge)...] front to back, the first the B
    post; quarter: a quarter light behind the last post (its top running down over quarter_run m), else the pillar is
    body; shoulder: the side's widest point's height; shelf: how far the glass's sill sits in from the shoulder; crown:
    the roof's crown over its rails; roof_half: the half-width between the rails; fender (rise, front end): the front
    fenders' crests over the hood; sill: 'black' between the arches, 'clad' all along, or 'paint'; band: the strip over
    the side glass ('trim' black, 'paint', 'chrome'); roof: 'paint' or 'trim' (a black roof, two-tone); bed (front,
    back, floor): a pickup's bed cut out of the shell behind the cab; waist: the side drawn in between the arches;
    a_tip: the glass's rise where the side glass's front point is; edges: more stations the profiles fold at."""

    def __init__(self, name, *, nose, tail, half, nose_deep, tail_r, axles, tyre, track, arch, top, bottom, belt, cowl,
                 header, roof_end, rear_end, posts, quarter=True, quarter_run=0.3, shoulder, shelf=0.085, crown=0.04,
                 roof_half=0.56, fender=(0.05, None), sill='black', band='trim', roof='paint', bed=None, waist=0.012,
                 a_tip=0.09, edges=(), frame=None, cap_rings=(0.012, 0.03, 0.07), wells_in=None, square_arches=False):
        self.name = name
        self.NOSE, self.TAIL, self.W = nose, tail, half
        self.NOSE_DEEP, self.TAIL_R = nose_deep, tail_r
        self.AXLES, self.TYRE, self.TRACK, self.ARCH = axles, tyre, track, arch
        self.TOP, self.BOTTOM, self.BELT = top, bottom, belt
        self.COWL, self.WS_FOOT, self.HEADER = cowl, cowl - 0.03, header
        self.ROOF_END, self.REAR_END = roof_end, rear_end
        self.POSTS, self.QUARTER, self.QUARTER_RUN = posts, quarter, quarter_run
        self.SHOULDER, self.SHELF, self.CROWN, self.ROOF_HALF = shoulder, shelf, crown, roof_half
        self.FENDER = (fender[0], fender[1] if fender[1] is not None else nose - 0.23)
        self.SILL, self.BAND, self.ROOF, self.BED, self.WAIST = sill, band, roof, bed, waist
        self.LAST = posts[-1]
        self.A_TIP = where(lambda y: self.glass_rise(y) > a_tip, 0.0, cowl)
        self.QUARTER_END = where(lambda y: self.glass_rise(y) > 0.04, self.LAST[0], tail + 0.4)
        self.AHEAD, self.BEHIND = nose + 0.4, tail - 0.4
        edges = [nose, tail, self.WS_FOOT, cowl, header, roof_end, rear_end, self.A_TIP, *[e for p in posts for e in p],
                 self.QUARTER_END, *edges]
        if bed:
            edges += [bed[0], bed[1]]
        grid, y = [], nose
        while y > tail:
            grid.append(y)
            end = min(nose - y, y - tail)
            near_arch = any(abs(y - yc) < arch + 0.05 for yc in axles)
            y -= 0.008 if end < 0.1 else 0.02 if near_arch else 0.025 if (y > nose - nose_deep - 0.05 or y < tail + tail_r + 0.05) else 0.07
        stations = sorted(set(edges + [g for g in grid if all(abs(g - e) > 0.005 for e in edges)]), reverse=True)
        self.body = car.loft('body', [(y, self.section(y)) for y in stations], self.role, frame_role='trim', recess=0.008,
                             cap_rings=cap_rings, frame=frame or {None: 0.022, 'windshield': 0.04, 'back': 0.015})
        self.cut_wells(wells_in if wells_in is not None else half - 0.38, square_arches)

    # ---- the shape
    def half_width(self, y):
        """The body's half-width in plan at y: the nose's long rounded corners, the tail's tighter ones, the waist"""
        W, NOSE, TAIL = self.W, self.NOSE, self.TAIL
        if y > NOSE - self.NOSE_DEEP:
            t = min(0.995, (y - (NOSE - self.NOSE_DEEP)) / self.NOSE_DEEP)
            return W * (1 - t ** 3.2) ** (1 / 3.2)
        if y < TAIL + self.TAIL_R:
            t = ((TAIL + self.TAIL_R) - y) / self.TAIL_R
            return W - self.TAIL_R + self.TAIL_R * math.sqrt(max(0.0, 1 - t ** 2.6))
        return W - self.WAIST * smooth((self.AXLES[0] - 0.4 - y) / 0.5) * smooth((y - self.AXLES[1] - 0.4) / 0.5)

    def fender_rise(self, y):
        """How far the fenders' crests stand over the hood along it (m): the front wheels' haunches"""
        rise, end = self.FENDER
        return rise * smooth((y - self.COWL - 0.1) / 0.45) * (1 - smooth((y - end) / 0.15))

    def belt(self, y):
        return min(lerp(self.BELT, y), lerp(self.TOP, y) - 0.005) + (self.fender_rise(y) if y > self.COWL else 0.0)

    def section(self, y):
        bot, top, w = lerp(self.BOTTOM, y), lerp(self.TOP, y), self.half_width(y)
        belt = self.belt(y)
        k = 1 - 0.85 * max(clamp((y - (self.NOSE - 0.45)) / 0.35, 0, 1), clamp(((self.TAIL + 0.3) - y) / 0.28, 0, 1))
        bw = w - self.SHELF * (0.15 + 0.85 * k)
        h = belt - bot
        z2 = bot + min(0.05, 0.12 * h)
        z3 = bot + min(0.16, 0.30 * h)
        shoulder = clamp(self.SHOULDER, z3 + 0.15 * h, belt - min(0.10, 0.25 * h))
        z5 = shoulder + (belt - shoulder) * 0.6
        crown = clamp(top - belt, 0.0, self.CROWN)
        edge = top - crown
        rw = bw - (bw - min(self.ROOF_HALF, bw)) * clamp((edge - belt) / 0.40, 0, 1)
        run = math.hypot(rw - bw, edge - belt)
        band = 0.03 + run * clamp((self.LAST[0] - 0.02 - y) / max(self.QUARTER_RUN, 0.01), 0, 1)
        t = clamp(1 - band / run, 0, 1) if run > 1e-6 else 0.0
        upper = [(bw + (rw - bw) * t, belt + (edge - belt) * t), (rw, edge), (rw - 0.06, top - crown * 0.3),
                 (rw * 0.45, top - crown * 0.08)]
        if belt > top:
            dip, f = belt - top, min(1.0, (belt - top) / 0.03)
            upper = [(bw, belt), (bw - 0.06, belt - 0.5 * dip), (bw - 0.06 - 0.14 * f, top - 0.008 * f),
                     (bw * (0.45 - 0.05 * f), top - 0.002 * f)]
        return [(0, bot), (w - 0.12 * (0.5 + 0.5 * k), bot), (w - 0.05 * k, z2), (w - 0.015 * k, z3), (w, shoulder),
                (w - 0.03 * k, z5), (bw, belt), *upper, (0, top)]

    def glass_rise(self, y):
        s = self.section(y)
        return s[7][1] - s[6][1]

    def side_x(self, y, z):
        """The side's x at (y, z), below the beltline"""
        pts = self.section(y)[2:7]
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            if z0 <= z <= z1:
                return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
        return pts[0][0] if z < pts[0][1] else pts[-1][0]

    def role(self, y, seg, side):
        # segments: 0 the floor, 1 the sill's foot, 2-5 the side, 6 the side glass, 7 the band over it, 8 the roof's
        # rail, 9-10 the top (hood, windshield, roof, back glass, trunk or bed)
        if seg < 0:
            return 'paint'
        if seg == 0:
            return 'trim' if y > self.NOSE - 0.08 or y < self.TAIL + 0.08 else 'under'
        if seg == 1:
            if self.SILL == 'clad':
                return 'trim'
            if self.SILL == 'black':
                return 'trim' if self.AXLES[1] - 0.55 < y < self.AXLES[0] + 0.5 else 'paint'
            return 'paint'
        windows = [(self.A_TIP, self.POSTS[0][1], 'front')]
        for i, ((ahead, _), (_, behind)) in enumerate(zip(self.POSTS, self.POSTS[1:])):
            windows.append((ahead, behind, 'rear' if i == 0 else f'mid{i}'))
        if seg == 6:
            if any(a < y < b for a, b in self.POSTS):
                return 'trim'
            for a, b, name in windows:
                if b < y < a:
                    return f'glass:{name}{side}'
            if self.QUARTER and self.QUARTER_END < y < self.LAST[0]:
                return f'glass:quarter{side}'
        if seg == 7:
            to = self.QUARTER_END if self.QUARTER else self.LAST[0]
            return self.BAND if to < y < self.A_TIP else 'paint'
        if seg >= 9:
            if self.HEADER < y < self.WS_FOOT:
                return 'glass:windshield'
            if self.REAR_END < y < self.ROOF_END:
                return 'glass:back'
        if seg >= 8 and self.ROOF == 'trim' and self.ROOF_END - 0.02 < y < self.HEADER + 0.02:
            return 'trim'
        return 'paint'

    # ---- the cuts
    def cut_wells(self, x_in, square):
        wells = []
        r, R = self.TYRE[0], self.ARCH
        for yc in self.AXLES:
            if square:  # (the squared-off arches of a rugged crossover: a flat top, cut corners)
                c = R * 0.42
                arc = [(yc + R, r), (yc + R, r + R - c), (yc + R - c, r + R), (yc - R + c, r + R), (yc - R, r + R - c), (yc - R, r)]
            else:
                arc = [(yc + R * math.cos(math.radians(a)), r + R * math.sin(math.radians(a))) for a in range(0, 181, 10)]
            outline = [(arc[0][0], -0.2)] + arc + [(arc[-1][0], -0.2)]
            for s in (1, -1):
                wells.append(car.prism('well', outline, s * x_in, s * 1.4, 'under'))
        if self.BED:  # (the bed: its walls 6 cm thick, its floor at the bed's floor, a black liner)
            y0, y1, floor = self.BED
            x = self.W - 0.06
            wells.append(car.prism('bed', [(y0, floor), (y0, 3.0), (y1, 3.0), (y1, floor)], -x, x, 'trim'))
        car.cut(self.body, *wells)
        car.tidy(self.body, 75, weighted=False)

    # ---- laying parts onto the body
    def front(self, ob, offset=0.002):
        return car.onto(ob, self.body, offset, axis='-Y')

    def rear(self, ob, offset=0.002, wrap=False):
        return car.onto(ob, self.body, offset, axis=None if wrap else 'Y')

    def side(self, ob, offset=0.002):
        return car.onto(ob, self.body, offset)

    def arch_mouldings(self, width=0.07, square=False):
        """The arches' black mouldings: a band round each, laid on the side"""
        r, R = self.TYRE[0], self.ARCH + 0.03
        for yc in self.AXLES:
            for s in (1, -1):
                if square:
                    c = R * 0.42
                    pts = [(yc + R, r - 0.02), (yc + R, r + R - c), (yc + R - c, r + R), (yc - R + c, r + R), (yc - R, r + R - c), (yc - R, r - 0.02)]
                    arc = []
                    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
                        n = max(1, int(math.hypot(y1 - y0, z1 - z0) / 0.03))
                        arc += [(s * 1.2, y0 + (y1 - y0) * i / n, z0 + (z1 - z0) * i / n) for i in range(n)]
                    arc.append((s * 1.2, *pts[-1]))
                else:
                    arc = [(s * 1.2, yc + R * math.cos(math.radians(a)), r + R * math.sin(math.radians(a))) for a in range(-5, 186, 5)]
                # (not below the body's foot: a pickup's bed stops short of the rear arch's ends)
                arc = [p for p in arc if p[2] > lerp(self.BOTTOM, p[1]) + 0.04]
                self.side(car.strip('arch', arc, (s, 0, 0), width, 'trim'))

    def seams(self, hood_from=None, deck=False, seam_from=None, cab_back=None):
        """The shut lines: the doors' edges, the hood's along the fenders, a trunk lid's, a pickup's cab off its bed"""
        bottom = (seam_from if seam_from is not None else lerp(self.BOTTOM, 0.0) + 0.17)
        doors = [self.A_TIP - 0.05] + [(a + b) / 2 for a, b in self.POSTS[:-1]] + [self.LAST[0] - 0.02]
        out = []
        for s in (1, -1):
            for y in doors + ([cab_back] if cab_back is not None else []):
                top = (lerp(self.TOP, y) - 0.02) if y == cab_back else self.belt(y) - 0.03
                pts = [(s * self.side_x(y, z), y, z) for z in (bottom + k * 0.05 for k in range(30)) if z < top]
                if len(pts) > 1:
                    out.append(car.strip('seam', pts, (s, 0, 0), 0.004, 'trim'))
            start = hood_from if hood_from is not None else self.NOSE - 0.11
            hood = [(s * (self.half_width(y) - self.SHELF - 0.04), y, self.belt(y)) for y in
                    [start - 0.05 * k for k in range(int((start - self.COWL) / 0.05) + 1)]]
            out.append(car.strip('seam', hood, (0, 0, 1), 0.004, 'trim'))
            if deck:
                lid = [(s * (self.half_width(y) - self.SHELF - 0.03), y, lerp(self.BELT, y)) for y in
                       [self.REAR_END - 0.05 - 0.05 * k for k in range(int((self.REAR_END - self.TAIL - 0.12) / 0.05))]]
                out.append(car.strip('seam', lid, (0, 0, 1), 0.004, 'trim'))
        for ob in out:
            car.onto(ob, self.body, 0.0015)

    def handles(self, drop=0.10, chrome=False):
        """A slim pull on each door, under the beltline near its back edge"""
        for s in (1, -1):
            for front, _ in self.POSTS:
                y1 = front + 0.05
                y0 = y1 + 0.18
                z = self.belt((y0 + y1) / 2) - drop
                loop = [(y0, z - 0.016), (y1 + 0.015, z - 0.016), (y1, z), (y1 + 0.015, z + 0.016), (y0, z + 0.016), (y0, z - 0.016)]
                h = car.strip('handle', [(s * (self.side_x(y, zz) + 0.01), y, zz) for y, zz in loop], (s, 0, 0), 0.004,
                              'chrome' if chrome else 'trim')
                car.onto(h, self.body, 0.0015)

    def mirrors(self, scale=1.0, cap='paint'):
        """Caps (body-coloured, or black) on a black foot at the door window's front corner"""
        for s in (1, -1):
            D = self.A_TIP - 0.03
            z = self.belt(D) + 0.02
            x0 = self.side_x(D, z - 0.04) - 0.04
            k = scale
            inner = [(D + 0.01, z), (D - 0.15 * k, z), (D - 0.16 * k, z + 0.09 * k), (D - 0.06 * k, z + 0.10 * k), (D + 0.01, z + 0.055 * k)]
            outer = [(D - 0.05 * k, z + 0.01), (D - 0.16 * k, z + 0.01), (D - 0.16 * k, z + 0.085 * k), (D - 0.09 * k, z + 0.09 * k), (D - 0.05 * k, z + 0.055 * k)]
            m = car.tapered(f'{cap}_mirror', inner, s * x0, outer, s * (self.W + 0.12 * k), cap)
            car.bevelled(m, 0.026, 4, angle=20)
            car.smooth(m, 60)
            g = car.box('mirror_glass', (0, 0, 0), (0.10 * k, 0.002, 0.065 * k), 'glass')
            g.location = (s * (self.W + 0.07 * k), D - 0.1635 * k, z + 0.045 * k)
            car.box('mirror_foot', (s * (x0 + 0.03), D - 0.05, z + 0.01), (0.06, 0.10, 0.03), 'trim', bevel=0.006)

    def roof_rails(self, height=0.05, inset=0.03):
        """A black rail along each of the roof's edges, from over the front doors to the back glass's top"""
        ys = [self.HEADER - 0.12 - 0.1 * k for k in range(int((self.HEADER - 0.12 - self.ROOF_END - 0.08) / 0.1) + 1)]
        x = self.section((ys[0] + ys[-1]) / 2)[8][0] - inset
        edge = [self.section(y)[8][1] for y in ys]
        outline = [(y, z - 0.01) for y, z in zip(ys, edge)][::-1] + [(y, z + height) for y, z in zip(ys, edge)]
        for s in (1, -1):
            rail = car.prism('trim_rail', outline, s * (x - 0.025), s * (x + 0.02), 'trim')
            car.bevelled(rail, 0.008, 2)

    def wiper(self):
        y = self.WS_FOOT - 0.05
        car.strip('wiper', [(x, y, lerp(self.TOP, y)) for x in (-0.65, 0.30)], (0, 0.5, 1), 0.02, 'trim', lift=0.01)

    def cabin(self, rows=2, seats=None):
        """The cabin, seen through the glass in the renders (dropped in the game: the glass is opaque there): the front
        seats at `seats` (y), or else by the B post"""
        floor = min(z for _, z in self.BOTTOM) + 0.25
        seat = floor + 0.19
        width = 2 * (self.W - 0.10)
        b = seats if seats is not None else (self.POSTS[0][0] + self.POSTS[0][1]) / 2
        car.box('interior_floor', (0, (self.COWL + self.LAST[0]) / 2 - 0.2, floor), (width, self.COWL - self.LAST[0], 0.04), 'interior')
        car.soft_box('interior_dash', (0, self.COWL - 0.22, lerp(self.TOP, self.COWL) - 0.04), (width, 0.40, 0.16), 'interior', bevel=0.05)
        for s in (1, -1):
            car.soft_box('interior_seat', (s * 0.39, b, seat), (0.48, 0.50, 0.12), 'interior', bevel=0.045)
            car.soft_box('interior_seatback', (s * 0.39, b - 0.30, seat + 0.32), (0.46, 0.12, 0.60), 'interior', bevel=0.045, tilt=0.22)
        if rows > 1:
            y = self.LAST[0] + 0.18
            car.soft_box('interior_bench', (0, y, seat + 0.01), (width - 0.2, 0.46, 0.12), 'interior', bevel=0.045)
            car.soft_box('interior_benchback', (0, y - 0.25, seat + 0.29), (width - 0.2, 0.12, 0.46), 'interior', bevel=0.045, tilt=0.25)

    def wheels(self, spokes=5, tread=0.007, cover='spoke'):
        r, w, rim = self.TYRE
        for yc in self.AXLES:
            for s in (1, -1):
                car.wheel('wheel', s * self.TRACK / 2, yc, r, w, rim, cover=cover, segments=48, tread=tread, lug=0.0, spokes=spokes)

    def finish(self, out, renders, blend, paint, tag=None):
        """Exported, saved, and (with a render folder) rendered: VIEWS=photo,side picks the views, SAMPLES their samples"""
        if out:
            car.export(out)
        if blend:
            car.save_blend(blend)
        if renders:
            views = [('front', 35, 7, 10), ('rear', 150, 10, 10.5), ('side', 92, 2, 11), ('nose', 0, 6, 8.5), ('tail', 180, 8, 8.5),
                     ('high', 140, 32, 9), ('photo', 20, 4, 8.5, 45), ('face', 0, 2, 4.6, 50, (0, self.NOSE - 0.2, 0.6))]
            pick = os.environ.get('VIEWS')
            if pick:
                views = [v for v in views if v[0] in pick.split(',')]
            car.hero(renders, tag or self.name, paint=paint, views=views, samples=int(os.environ.get('SAMPLES', '96')))
