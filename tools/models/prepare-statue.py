# tools/models/prepare-statue.py
# A statue from Meshy (an untextured image-to-3d mesh, +y up, its front towards +z) made ready for the game in Blender:
# simplified, scaled to its real height, its feet on the origin with the middle of its footprint over it, smooth
# shaded, and written as a glTF binary with one plain material (the game gives it its stone).
#
#   blender -b -P tools/models/prepare-statue.py -- <in.glb> <out.glb> --height 3.8 [--triangles 30000]
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
opt = dict(zip(argv[2::2], argv[3::2]))
height = float(opt['--height'])
triangles = int(opt.get('--triangles', 30000))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
statue = bpy.context.view_layer.objects.active
# bake its transform (and any parent's) into the vertices
statue.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh = statue.data
tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
if tris > triangles:
    dec = statue.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = triangles / tris
    bpy.ops.object.modifier_apply(modifier=dec.name)
# Blender's frame: z up, the front towards -y. The feet: the lowest 5% of the height
zs = [v.co.z for v in mesh.vertices]
z0, z1 = min(zs), max(zs)
feet = [v.co for v in mesh.vertices if v.co.z < z0 + (z1 - z0) * 0.05]
cx = (min(p.x for p in feet) + max(p.x for p in feet)) / 2
cy = (min(p.y for p in feet) + max(p.y for p in feet)) / 2
s = height / (z1 - z0)
for v in mesh.vertices:
    v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - z0) * s))
mesh.update()
bpy.ops.object.shade_smooth()
mesh.materials.clear()
mat = bpy.data.materials.new('stone')
mat.diffuse_color = (0.3, 0.31, 0.31, 1.0)
mesh.materials.append(mat)
print(f'[prepare-statue] {tris} triangles in, {sum(len(p.vertices) - 2 for p in mesh.polygons)} out, {height} m tall')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                          export_texcoords=False, export_materials='EXPORT', export_yup=True)
