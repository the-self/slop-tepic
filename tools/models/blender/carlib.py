# tools/models/blender/carlib.py
# What the cars modelled in Blender by script (tools/models/blender/<id>.py) are made of: a body lofted through cross-
# sections, its windows inset in frames, wheel arches cut, the wheels, and a few review renders. Every part's material
# is named for its role (paint, glass, trim, light, lamp, tyre, rim...), which tools/models/prepare-made.mjs reads to
# make the game's file. Run one with
#   blender -b --factory-startup -P tools/models/blender/<id>.py -- <out.glb> [<render dir> [<out.blend>]]
# Blender's frame: metres, x to the car's right, y ahead (the nose to +y), z up from the ground.
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

# The roles' looks in the review renders only (prepare-made.mjs gives each role its own in the game)
LOOKS = {
    'paint': ((0.62, 0.64, 0.66), 0.3, 0.0),
    'glass': ((0.02, 0.025, 0.03), 0.05, 0.0),
    'trim': ((0.03, 0.03, 0.035), 0.55, 0.0),
    'gloss': ((0.01, 0.01, 0.012), 0.15, 0.0),
    'under': ((0.02, 0.02, 0.02), 0.9, 0.0),
    'chrome': ((0.8, 0.8, 0.82), 0.12, 1.0),
    'light': ((0.9, 0.92, 0.95), 0.1, 0.6),
    'lamp': ((0.6, 0.02, 0.02), 0.15, 0.0),
    'amber': ((0.9, 0.4, 0.05), 0.15, 0.0),
    'white': ((0.9, 0.9, 0.9), 0.15, 0.0),
    'tyre': ((0.02, 0.02, 0.02), 0.85, 0.0),
    'rim': ((0.55, 0.56, 0.58), 0.3, 0.9),
    'aero': ((0.05, 0.05, 0.055), 0.4, 0.0),
}


def args():
    """The script's own arguments (after Blender's --): the out .glb, and optionally a folder for review renders and a
    .blend to save the model in (to open and work on in Blender); '' skips one"""
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    pick = lambda i: (a[i] or None) if len(a) > i else None
    return pick(0), pick(1), pick(2)


def save_blend(path):
    """The scene saved as a .blend (compressed), the model as it was built, before any review render's sky and ground"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), compress=True, copy=True)
    print(f'saved {path}')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    """The material named `name` (its role: the part of the name before any '_'), made once"""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_backface_culling = True  # (exported single-sided: prepare-made.mjs turns a double-sided one's faces to face
    # away from the car's middle, which turned the tyres' inner faces inside out)
    rgb, rough, metal = LOOKS.get(name.split('_')[0], ((0.5, 0.5, 0.5), 0.5, 0.0))
    m.diffuse_color = (*rgb, 1)
    tree = m.node_tree
    bsdf = tree.nodes.get('Principled BSDF') if tree else None
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
    return m


def to_object(name, bm, mats):
    """A new object of the bmesh, its faces' material indices into `mats` (names)"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for n in mats:
        me.materials.append(material(n))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def loft(name, stations, role_of, frame=0.035, recess=0.008, frame_role='paint', sharp=()):
    """A closed body lofted through `stations`, [(y, half)...] nose to tail or tail to nose: `half` the right half of
    the cross-section at y, [(x, z)...] from the bottom's middle (x = 0) round the side to the top's middle (x = 0),
    every station with as many points. role_of(y, seg, side) names each face between two stations: `seg` the segment of
    the half-section (0 from the bottom), `side` 1 right, -1 left; a name 'glass:<window>' makes the faces of each
    window one pane, inset `frame` m in from its edge (or frame[<window>], a dict's default its None key) and `recess`
    m into the body, the ring the inset leaves its frame (`frame_role`). `sharp`: the half-section's points whose
    edges along the body are folds too shallow to bevel, kept sharp (smoothed, they bent the panels' shading).
    The ends are capped flat: role_of(y, -1, 0) names them."""
    bm = bmesh.new()
    m = len(stations[0][1])
    rings = []
    for y, half in stations:
        assert len(half) == m, f'station at y {y}: {len(half)} points, not {m}'
        pts = list(half) + [(-x, z) for x, z in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, y, z)) for x, z in pts])
    n = len(rings[0])
    names = []
    groups = {}  # window -> its index in the faces' 'window' layer (1 on)
    win = bm.faces.layers.int.new('window')

    def index(role):
        mat = role.split(':')[0]
        if mat not in names:
            names.append(mat)
        return names.index(mat)

    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        ym = (stations[i][0] + stations[i + 1][0]) / 2
        for k in range(n):
            k2 = (k + 1) % n
            seg, side = (k, 1) if k < m - 1 else (2 * m - 3 - k, -1)
            f = bm.faces.new((a[k], a[k2], b[k2], b[k]))
            role = role_of(ym, seg, side)
            f.material_index = index(role)
            if role.startswith('glass:'):
                f[win] = groups.setdefault(role, len(groups) + 1)
    for i in range(len(rings) - 1):
        for k in sharp:
            for j in (k, 2 * m - 2 - k):
                e = bm.edges.get((rings[i][j], rings[i + 1][j]))
                if e:
                    e.smooth = False
    for ring, y in ((rings[0], stations[0][0]), (rings[-1], stations[-1][0])):
        f = bm.faces.new(ring)
        f.material_index = index(role_of(y, -1, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # the points that fall together merged first (a window closing in a point, a section's zero-length side): an inset
    # of a face with a zero-length edge bent its frame out of line
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-4)
    # each window an inset pane; the ring the inset makes is its frame (`frame_role`: the body's paint, or black)
    rim = index(frame_role)
    for key, i in groups.items():
        faces = [f for f in bm.faces if f[win] == i]
        width = frame.get(key.split(':')[1], frame.get(None, 0.035)) if isinstance(frame, dict) else frame
        out = bmesh.ops.inset_region(bm, faces=faces, thickness=width, depth=-recess, use_even_offset=True)
        for f in out['faces']:
            f.material_index = rim
            f[win] = 0
    return to_object(name, bm, names)


def prism(name, outline, x0, x1, role):
    """A prism across x (x0 to x1) of `outline`, [(y, z)...] counter-clockwise seen from +x"""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in outline]
    b = [bm.verts.new((x1, y, z)) for y, z in outline]
    k = len(outline)
    for i in range(k):
        bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, [role])


def cut(body, *cutters):
    """The cutters' volumes taken out of the body, all in one cut (one at a time, the exact solver once read a body
    cut on one side as inside out on the other and added the next cutter to it); the faces they leave are of the
    cutters' materials"""
    cutter = cutters[0]
    if len(cutters) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for c in cutters:
            c.select_set(True)
        bpy.context.view_layer.objects.active = cutter
        bpy.ops.object.join()
    mod = body.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    mod.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)


def band(name, outline, x_in, x_out, width, role):
    """A flat strip `width` m wide along the open polyline `outline` [(y, z)...] (to its left, going along it), from x_in
    to x_out across: a wheel arch's flare, a lamp's bar seen from the side"""
    inner = []
    for i, (y, z) in enumerate(outline):
        a = outline[max(0, i - 1)]
        b = outline[min(len(outline) - 1, i + 1)]
        d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        inner.append((y - d.y * width, z + d.x * width))
    bm = bmesh.new()
    rows = []
    for x in (x_in, x_out):
        rows.append(([bm.verts.new((x, y, z)) for y, z in outline], [bm.verts.new((x, y, z)) for y, z in inner]))
    (ai, bi), (ao, bo) = rows
    for i in range(len(outline) - 1):
        bm.faces.new((ao[i], ao[i + 1], bo[i + 1], bo[i]))  # outer face
        bm.faces.new((ai[i + 1], ai[i], bi[i], bi[i + 1]))  # inner face
        bm.faces.new((ai[i], ai[i + 1], ao[i + 1], ao[i]))  # outer edge
        bm.faces.new((bi[i + 1], bi[i], bo[i], bo[i + 1]))  # inner edge
    for j in (0, len(outline) - 1):
        bm.faces.new((ai[j], ao[j], bo[j], bi[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, [role])


def slab(p0, p1, normal, width, depth, bm=None):
    """A thin box from p0 to p1 (its ends `width`/2 past them), `width` across on a surface of `normal` and `depth`
    either side of it: added to `bm` if given, else its own bmesh"""
    own = bm is None
    bm = bm or bmesh.new()
    p0, p1, n = Vector(p0), Vector(p1), Vector(normal).normalized()
    along = (p1 - p0).normalized()
    across = along.cross(n).normalized()
    half = (p1 - p0).length / 2 + width / 2
    c = (p0 + p1) / 2
    vs = [bm.verts.new(c + along * (a * half) + across * (b * width / 2) + n * (d * depth))
          for a in (-1, 1) for b in (-1, 1) for d in (-1, 1)]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in q])
    return bm if own else None


def grooves(body, lines, width=0.0045, depth=0.004, role='trim'):
    """Shut lines cut into the body: `lines` [(points [(x, y, z)...], normal)...], each a groove `width` m wide and
    `depth` m deep along the polyline on a surface of that normal, its walls of `role` (dark: they read as gaps)"""
    bm = bmesh.new()
    for points, normal in lines:
        for p0, p1 in zip(points, points[1:]):
            slab(p0, p1, normal, width, depth, bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cutter = to_object('grooves', bm, [role])
    mod = body.modifiers.new('grooves', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    mod.use_self = True
    mod.material_mode = 'TRANSFER'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)


def bars(name, lines, width, depth, role, inset=0.0):
    """Slabs along `lines` [(points, normal)...] (as grooves takes them), their middles `inset` m into the surface:
    a lamp's LEDs or its lens, in the channel grooves cut"""
    bm = bmesh.new()
    for points, normal in lines:
        n = Vector(normal).normalized()
        pts = [Vector(p) - n * inset for p in points]
        for p0, p1 in zip(pts, pts[1:]):
            slab(p0, p1, n, width, depth, bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, [role])


def apply(ob):
    """Its modifiers made into its mesh (a bevel, before grooves are cut through it)"""
    bpy.context.view_layer.objects.active = ob
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def tapered(name, inner, x0, outer, x1, role):
    """A prism across x from the outline `inner` [(y, z)...] at x0 to `outer` (as many points) at x1: a mirror's
    blade, a step"""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in inner]
    b = [bm.verts.new((x1, y, z)) for y, z in outer]
    k = len(inner)
    for i in range(k):
        bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, [role])


def soft_box(name, centre, size, role, bevel=0.03, tilt=0.0, segments=3):
    """A box rounded `bevel` m at every edge, turned `tilt` rad about x (a seat's back, a screen)"""
    ob = box(name, (0, 0, 0), size, role)
    bevelled(ob, bevel, segments, angle=10)
    ob.rotation_euler = (tilt, 0, 0)
    ob.location = centre
    smooth(ob, 60)
    return ob


def box(name, centre, size, role, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((centre[0] + v.co.x * size[0], centre[1] + v.co.y * size[1], centre[2] + v.co.z * size[2]))
    ob = to_object(name, bm, [role])
    if bevel:
        bevelled(ob, bevel, 2)
    return ob


def wheel(name, x, y, radius, width, rim, cover='aero', segments=120, tread=0.014, petals=8, spokes=0, lug=0.006):
    """A tyre on its axle across x at (x, y, radius): its shoulders rounded, an all-terrain tread `tread` m deep (two
    grooves round it, staggered blocks across, the shoulder lugs running down onto the sidewall), and on its outer face
    a wheel cover `rim` m in radius dished in `petals` faceted petals round a hexagonal cap, or (`spokes`) a black
    dish under that many flat spokes and a lip: the tyre's material 'tyre', the cover's `cover` (the dish 'pocket'),
    the cap 'trim'"""
    side = 1 if x > 0 else -1
    bm = bmesh.new()
    # (the tyre's profile, from the inner face's rim round the tread to the outer face's rim: (radius, offset out,
    # which blocks it is part of: 0 none, 1 the shoulders', 2 the middle row's))
    prof = [(rim + 0.01, -0.5, 0), (radius - 0.075, -0.5, 0), (radius - 0.045, -0.5, 1), (radius - 0.016, -0.47, 1),
            (radius, -0.40, 1), (radius, -0.14, 1), (radius - tread, -0.12, 0), (radius - tread, -0.07, 0),
            (radius, -0.05, 2), (radius, 0.05, 2), (radius - tread, 0.07, 0), (radius - tread, 0.12, 0),
            (radius, 0.14, 1), (radius, 0.40, 1), (radius - 0.016, 0.47, 1), (radius - 0.045, 0.5, 1),
            (radius - 0.075, 0.5, 0), (rim + 0.01, 0.5, 0)]
    rings = []
    for s in range(segments):
        a = 2 * math.pi * s / segments
        c, sn = math.cos(a), math.sin(a)
        ring = []
        for r, o, kind in prof:
            # (each block 3 rings long, a 1-ring gap after it; the middle row's blocks halfway between the shoulders')
            sunk = kind and ((s if kind == 1 else s + 2) % 4 == 3)
            d = tread * 0.8 if sunk else 0
            if sunk and r < radius - 0.01:  # (on the sidewall the lugs stand proud of a sunk face, not into it)
                d = lug
            ring.append(bm.verts.new((x + side * o * width, y + (r - d) * c, radius + (r - d) * sn)))
        rings.append(ring)
    for s in range(segments):
        a, b = rings[s], rings[(s + 1) % segments]
        for k in range(len(prof) - 1):
            bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    tyre = to_object(name + '_tyre', bm, ['tyre'])
    # the cover: a lip, then petals sloping in to the cap, each petal two flat facets; the inner face a plain disc
    bm = bmesh.new()
    n = petals * 6
    face = x + side * 0.49 * width

    def ring(r, inward, ridge=0.0):
        out = []
        for s in range(n):
            a = 2 * math.pi * s / n
            k = (s % 6) / 6  # (where in its petal: 0 its edge, 0.5 its middle)
            depth = inward + ridge * (1 - abs(2 * k - 1))  # (a petal's middle sunk deeper: its two facets)
            out.append(bm.verts.new((face - side * depth, y + r * math.cos(a), radius + r * math.sin(a))))
        return out

    if spokes:
        rings = [ring(rim + 0.012, 0.0), ring(rim - 0.01, 0.004), ring(0.3 * rim, 0.018)]
    else:
        rings = [ring(rim + 0.012, 0.0), ring(rim - 0.006, -0.01), ring(rim - 0.022, -0.004), ring(rim - 0.03, 0.004),
                 ring(0.62 * rim, 0.02, 0.012), ring(0.36 * rim, 0.03, 0.006), ring(0.3 * rim, 0.03)]
    for a, b in zip(rings, rings[1:]):
        for s in range(n):
            bm.faces.new((a[s], a[(s + 1) % n], b[(s + 1) % n], b[s]))
    centre = bm.verts.new((face - side * 0.03, y, radius))
    for s in range(n):
        bm.faces.new((rings[-1][s], rings[-1][(s + 1) % n], centre))
    inner = [bm.verts.new((x - side * 0.49 * width, y + (rim + 0.012) * math.cos(2 * math.pi * s / n), radius + (rim + 0.012) * math.sin(2 * math.pi * s / n)))
             for s in range(n)]
    bm.faces.new(inner)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    disc = to_object(name + '_cover', bm, ['pocket' if spokes else cover])
    for p in disc.data.polygons:
        p.use_smooth = False  # (the petals' facets stay crisp)
    if spokes:
        # the spokes out from the hub, and the lip round the rim, standing out of the black dish
        bm = bmesh.new()
        axis = (side, 0, 0)
        at = face - side * 0.006
        for k in range(spokes):
            a = 2 * math.pi * k / spokes + math.pi / 2
            c, sn = math.cos(a), math.sin(a)
            slab((at, y + 0.07 * c, radius + 0.07 * sn), (at, y + (rim - 0.03) * c, radius + (rim - 0.03) * sn), axis, 0.07, 0.012, bm)
        ring_n = 30
        for k in range(ring_n):
            a0, a1 = 2 * math.pi * k / ring_n, 2 * math.pi * (k + 1) / ring_n
            r = rim - 0.012
            slab((at, y + r * math.cos(a0), radius + r * math.sin(a0)), (at, y + r * math.cos(a1), radius + r * math.sin(a1)), axis, 0.03, 0.012, bm)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bevelled(to_object(name + '_spokes', bm, [cover]), 0.004, 2)
    cap = disc_mesh(name + '_cap', (face - side * 0.022, y, radius), side, 0.075, 0.016, cover, n=6)
    bevelled(cap, 0.004, 2)
    smooth(tyre, 50)
    return tyre, disc, cap


def disc_mesh(name, centre, side, r, depth, role, n=32):
    """A short cylinder across x, its outer face (to `side`) at centre's x"""
    bm = bmesh.new()
    cx, cy, cz = centre
    out = [bm.verts.new((cx, cy + r * math.cos(2 * math.pi * s / n), cz + r * math.sin(2 * math.pi * s / n))) for s in range(n)]
    back = [bm.verts.new((cx - side * depth, v.co.y, v.co.z)) for v in out]
    bm.faces.new(out)
    bm.faces.new(back[::-1])
    for s in range(n):
        bm.faces.new((out[s], back[s], back[(s + 1) % n], out[(s + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, [role])


def strip(name, points, normal, width, role, lift=0.0015):
    """A thin flat strip `width` m wide along the polyline `points` [(x, y, z)...] on a surface of `normal`, lifted
    `lift` m off it: a panel's shut line, a seal, a wiper blade"""
    nrm = Vector(normal).normalized()
    bm = bmesh.new()
    rows = []
    for i, p in enumerate(points):
        a, b = Vector(points[max(0, i - 1)]), Vector(points[min(len(points) - 1, i + 1)])
        across = (b - a).cross(nrm).normalized() * (width / 2)
        c = Vector(p) + nrm * lift
        rows.append((bm.verts.new(c - across), bm.verts.new(c + across)))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        f = bm.faces.new((a0, b0, b1, a1))
        f.normal_update()
        if f.normal.dot(nrm) < 0:
            f.normal_flip()
    return to_object(name, bm, [role])


def bevelled(ob, width, segments=2, angle=30):
    """Its edges sharper than `angle` degrees rounded off `width` m, so they catch the light as a real panel's do"""
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = True
    mod.miter_outer = 'MITER_ARC'
    return ob


def smooth(ob, angle=40):
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle), keep_sharp_edges=True)
    ob.select_set(False)


def tidy(ob, angle=30):
    """A body after its cuts: every face turned out again (a boolean leaves some turned in, which show the cabin's
    dark lining as smudges), smooth across its bevels but its panels flat: normals weighted by the faces' areas, so a
    big flat panel keeps its own and the bevels round off into it (plain smoothing bent the panels' normals at their
    edges, a smeared shading across them)"""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for e in bm.edges:  # (where one material meets another, a fold: kept sharp)
        if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.validate()
    smooth(ob, angle)
    mod = ob.modifiers.new('weighted', 'WEIGHTED_NORMAL')
    mod.mode = 'FACE_AREA'
    mod.weight = 100
    mod.keep_sharp = True
    return ob


def mirror_x(ob):
    """A copy of the object mirrored to the car's other side"""
    copy = ob.copy()
    copy.data = ob.data.copy()
    copy.name = ob.name + '_l'
    bpy.context.scene.collection.objects.link(copy)
    for v in copy.data.vertices:
        v.co.x = -v.co.x
    copy.data.flip_normals()
    return copy


def export(path):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_materials='EXPORT', export_normals=True)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'exported {path}: about {tris} triangles before the bevels')


def render(folder, name, views=None, paint=None, size=(960, 540)):
    """Review renders of the car from round it: `views` [(tag, azimuth deg from the nose, elevation deg, distance m)]"""
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    if paint:
        p = bpy.data.materials.get('paint')
        if p and p.node_tree:
            p.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*paint, 1)
    world = bpy.data.worlds.new('sky')
    scene.world = world
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    ground = to_object('ground', bm, ['ground'])
    gm = bpy.data.materials['ground']
    if gm.node_tree:
        gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.32, 0.33, 1)
        gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 45
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.75))
    for tag, az, el, dist in views or [('front', 35, 12, 9), ('rear', 145, 12, 9), ('side', 90, 3, 9.5), ('nose', 0, 6, 8),
                                       ('top', 60, 45, 9), ('tail', 180, 6, 8)]:
        a, e = math.radians(az), math.radians(el)
        cam.location = target + Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(folder, f'{name}-{tag}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)


# The review's materials in the hero renders: brushed stainless or a paint, tinted glass, lit lamps
HERO = {
    'glass': dict(base=(0.13, 0.14, 0.15), rough=0.0, metal=0.0, clear=1.0),  # (tinted, see-through, cleanly reflecting)
    'lens': dict(base=(1, 1, 1), rough=0.02, metal=0.0, clear=1.0),
    'interior': dict(base=(0.025, 0.025, 0.027), rough=0.75, metal=0.0),
    'screen': dict(base=(0.01, 0.01, 0.012), rough=0.08, metal=0.0, glow=((0.35, 0.45, 0.6), 0.6)),
    'chrome': dict(base=(0.85, 0.85, 0.86), rough=0.1, metal=1.0),
    'trim': dict(base=(0.01, 0.01, 0.011), rough=0.55, metal=0.0),
    'gloss': dict(base=(0.006, 0.006, 0.007), rough=0.28, metal=0.0),
    'under': dict(base=(0.01, 0.01, 0.01), rough=0.9, metal=0.0),
    'tyre': dict(base=(0.007, 0.007, 0.008), rough=0.92, metal=0.0, spec=0.15),
    'aero': dict(base=(0.03, 0.031, 0.034), rough=0.45, metal=0.2),
    'pocket': dict(base=(0.008, 0.008, 0.009), rough=0.6, metal=0.0),
    'light': dict(base=(1, 1, 1), rough=0.1, metal=0.0, glow=((1.0, 0.97, 0.92), 8.0)),
    'lamp': dict(base=(0.5, 0.0, 0.0), rough=0.1, metal=0.0, glow=((1.0, 0.03, 0.02), 3.0)),
    'lampbright': dict(base=(0.6, 0.0, 0.0), rough=0.1, metal=0.0, glow=((1.0, 0.05, 0.03), 14.0)),
    'amber': dict(base=(0.6, 0.25, 0.02), rough=0.1, metal=0.0, glow=((1.0, 0.45, 0.08), 3.0)),
    'plate': dict(base=(0.85, 0.86, 0.84), rough=0.4, metal=0.0),
}


def hero(folder, name, paint=dict(base=(0.56, 0.57, 0.58), rough=0.26, metal=1.0, aniso=0.6), views=None,
         size=(1600, 900), samples=96):
    """Good renders, to judge the model by: Cycles, a real sky and sun, the materials as they would be"""
    os.makedirs(folder, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception as e:  # (no GPU: the CPU renders it, slower)
        print('cycles on the cpu:', e)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0.4
    looks = dict(HERO, paint=paint)
    for m in bpy.data.materials:
        look = looks.get(m.name.split('_')[0].split('.')[0])
        bsdf = m.node_tree.nodes.get('Principled BSDF') if m.node_tree else None
        if not look or not bsdf:
            continue
        bsdf.inputs['Base Color'].default_value = (*look['base'], 1)
        bsdf.inputs['Roughness'].default_value = look['rough']
        bsdf.inputs['Metallic'].default_value = look['metal']
        if 'aniso' in look and 'Anisotropic' in bsdf.inputs:
            bsdf.inputs['Anisotropic'].default_value = look['aniso']
        if 'spec' in look and 'Specular IOR Level' in bsdf.inputs:
            bsdf.inputs['Specular IOR Level'].default_value = look['spec']  # (rubber: hardly a sheen)
        if 'clear' in look:
            bsdf.inputs['Transmission Weight'].default_value = look['clear']
            bsdf.inputs['IOR'].default_value = 1.5
        if 'glow' in look:
            bsdf.inputs['Emission Color'].default_value = (*look['glow'][0], 1)
            bsdf.inputs['Emission Strength'].default_value = look['glow'][1]
    brushed(bpy.data.materials.get('paint'))
    world = bpy.data.worlds.new('sky')
    scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    # (a bright hazy day, as the makers' photographs: a white sky brighter overhead, a soft sun)
    coords = nodes.new('ShaderNodeTexCoord')
    up = nodes.new('ShaderNodeSeparateXYZ')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.47
    ramp.color_ramp.elements[0].color = (0.18, 0.18, 0.19, 1)  # (below the horizon: the ground's)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = (0.62, 0.63, 0.65, 1)  # (a grey horizon: the upright faces mid-grey, as photographed)
    top = ramp.color_ramp.elements.new(0.95)
    top.color = (1.0, 1.0, 1.02, 1)  # (the bright white overhead the hood and the roof catch)
    links.new(coords.outputs['Generated'], up.inputs['Vector'])
    height = nodes.new('ShaderNodeMapRange')  # (a direction's height, -1 to 1, to 0 to 1: the horizon at 0.5)
    height.inputs['From Min'].default_value = -1.0
    links.new(up.outputs['Z'], height.inputs['Value'])
    links.new(height.outputs['Result'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], nodes['Background'].inputs['Color'])
    nodes['Background'].inputs['Strength'].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 1.0
    sun.data.angle = math.radians(8)  # (soft-edged shadows)
    sun.rotation_euler = (math.radians(42), 0, math.radians(200))
    scene.collection.objects.link(sun)
    glow(scene)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    ground = to_object('ground', bm, ['asphalt'])
    g = bpy.data.materials['asphalt'].node_tree.nodes['Principled BSDF']
    g.inputs['Base Color'].default_value = (0.05, 0.05, 0.053, 1)  # (asphalt)
    g.inputs['Roughness'].default_value = 0.85
    gt = bpy.data.materials['asphalt'].node_tree
    grain = gt.nodes.new('ShaderNodeTexNoise')
    grain.inputs['Scale'].default_value = 400
    grain.inputs['Detail'].default_value = 8
    bump = gt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.25
    gt.links.new(grain.outputs['Fac'], bump.inputs['Height'])
    gt.links.new(bump.outputs['Normal'], g.inputs['Normal'])
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 55
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.8))
    for view in views or [('front', 38, 8, 11), ('rear', 150, 10, 11.5), ('side', 92, 2, 12.5)]:
        tag, az, el, dist = view[:4]
        cam.data.lens = view[4] if len(view) > 4 else 55  # (a fifth: the lens, mm)
        target = Vector(view[5]) if len(view) > 5 else Vector((0, 0, 0.8))  # (a sixth: what it looks at)
        a, e = math.radians(az), math.radians(el)
        cam.location = target + Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(folder, f'{name}-{tag}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)


def brushed(m):
    """Stainless steel's brushing in the hero renders: fine streaks along the car (y) in its roughness and bump"""
    if not m or not m.node_tree:
        return
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    coords = nodes.new('ShaderNodeTexCoord')
    stretch = nodes.new('ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (5000, 4, 5000)  # (hair-fine streaks along the car, no blotches)
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.0
    noise.inputs['Detail'].default_value = 4
    links.new(coords.outputs['Object'], stretch.inputs['Vector'])
    links.new(stretch.outputs['Vector'], noise.inputs['Vector'])
    rough = nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.22  # (satin: a soft reflection, not a mirror's, and even)
    rough.inputs['To Max'].default_value = 0.27
    links.new(noise.outputs['Fac'], rough.inputs['Value'])
    links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.012
    bump.inputs['Distance'].default_value = 0.0005
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # (the shell's inside, seen through the glass, is the cabin's dark lining, not steel)
    geo = nodes.new('ShaderNodeNewGeometry')
    lining = nodes.new('ShaderNodeBsdfDiffuse')
    lining.inputs['Color'].default_value = (0.02, 0.02, 0.022, 1)
    mix = nodes.new('ShaderNodeMixShader')
    output = nodes['Material Output']
    links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
    links.new(bsdf.outputs['BSDF'], mix.inputs[1])
    links.new(lining.outputs['BSDF'], mix.inputs[2])
    links.new(mix.outputs['Shader'], output.inputs['Surface'])


def glow(scene):
    """A soft glare round what is brighter than the sky (the lamps), as a camera's lens makes: without it a lit LED reads
    as white paint"""
    try:
        tree = bpy.data.node_groups.new('glow', 'CompositorNodeTree')
        scene.compositing_node_group = tree
        tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        layers = tree.nodes.new('CompositorNodeRLayers')
        glare = tree.nodes.new('CompositorNodeGlare')
        out = tree.nodes.new('NodeGroupOutput')
        for name, value in (('Type', 'Fog Glow'), ('Quality', 'High'), ('Threshold', 2.0), ('Strength', 0.2), ('Size', 0.3)):
            sock = glare.inputs.get(name)
            if sock is not None:
                sock.default_value = value
        tree.links.new(layers.outputs['Image'], glare.inputs['Image'])
        tree.links.new(glare.outputs['Image'], out.inputs[0])
    except Exception as e:  # (an older Blender's compositor: the renders without the glow)
        print('no glow:', e)
