# tools/models/blender/nissan-kicks.py
# The Nissan Kicks (the first one, P15, with its 2021 face, built in Aguascalientes), modelled by script on the shell
# the everyday cars share (shell.py): a small crossover, its black roof floating over the glass and the black C post
# (the two-tone), the black cladding along the sills and round the arches, the roof rails; laid onto it the Kicks's
# face: the big V-motion grille between chrome strips, the slim head lamps over it, the black lower bumper with its fog
# lamps and silver skid plate; the boomerang tail lamps, the black lower bumper. Real sizes (Nissan's data sheet): 4.302
# m long, 1.760 m wide (no mirrors), 1.590 m high, a 2.620 m wheelbase, a 1.520 m track, 205/55 R17 tyres (0.66 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-kicks.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.151, -2.151, 0.92
TOP = [(NOSE, 0.78), (2.14, 0.82), (2.11, 0.85), (2.05, 0.88), (1.90, 0.91), (1.60, 0.955), (1.25, 1.00), (COWL, 1.04),
       (0.75, 1.17), (0.50, 1.35), (0.25, 1.50), (0.05, 1.565), (-0.25, 1.59), (-0.80, 1.59), (-1.30, 1.575),
       (-1.68, 1.55), (-1.73, 1.52), (-1.85, 1.38), (-1.98, 1.20), (-2.04, 1.10), (-2.09, 0.98), (-2.12, 0.86),
       (-2.14, 0.74), (TAIL, 0.62)]
BOTTOM = [(NOSE, 0.45), (2.14, 0.40), (2.10, 0.35), (2.0, 0.30), (1.8, 0.25), (1.0, 0.20), (-1.7, 0.20), (-1.92, 0.26),
          (-2.06, 0.33), (-2.13, 0.40), (TAIL, 0.46)]
BELT = [(NOSE, 0.76), (2.13, 0.82), (1.95, 0.88), (1.5, 0.95), (1.15, 1.00), (COWL, 1.03), (0.3, 1.06), (-0.5, 1.08),
        (-1.2, 1.10), (-1.65, 1.13), (-2.02, 1.14), (-2.10, 1.10), (TAIL, 0.98)]

c = Shell('nissan-kicks', nose=NOSE, tail=TAIL, half=0.88, nose_deep=0.45, tail_r=0.30, axles=(1.32, -1.30),
          tyre=(0.333, 0.205, 0.216), track=1.52, arch=0.39, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.04, roof_end=-1.72, rear_end=-2.03, posts=[(-0.22, -0.14), (-1.10, -1.03)], quarter_run=0.45,
          shoulder=0.88, shelf=0.08, roof_half=0.60, sill='clad', roof='trim', fender=(0.035, None),
          edges=[-2.04, -2.09])
c.arch_mouldings(0.07)
c.seams()
c.roof_rails(height=0.04)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.03

# ---- the face: the V-motion grille, a big shield of black mesh narrowing down, the chrome strips down its flanks; the
# slim lamps over its top corners, a lit line along each; the black lower bumper, the fog lamps in its corners, the skid
front(car.panel('grille', [(-0.40, 0.84), (0.40, 0.84), (0.28, 0.55), (-0.28, 0.55)], AHEAD, 'gloss', 1, n=50, m=24), 0.003)
for k in range(7):
    z = 0.58 + k * 0.036
    hw = 0.28 + 0.12 * (z - 0.55) / 0.29 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.005, AHEAD, 'trim', 1), 0.0038)
for s in (1, -1):
    front(car.decal('chrome_v', [(s * 0.44, 0.85), (s * 0.42, 0.79), (s * 0.31, 0.56), (s * 0.20, 0.535)], 0.04, AHEAD, 'chrome', 1), 0.0042)
    slot = [(s * 0.44, 0.875), (s * 0.82, 0.90), (s * 0.85, 0.83), (s * 0.46, 0.83)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('lightbar', [(s * 0.48, 0.865), (s * 0.80, 0.89), (s * 0.83, 0.84)], 0.007, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.58, 0.852), (s * 0.72, 0.862)], 0.03, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('fog', [(s * 0.58, 0.58), (s * 0.80, 0.60), (s * 0.80, 0.53), (s * 0.60, 0.52)], AHEAD, 'trim', 1, n=16), 0.002)
    front(car.decal('fog', [(s * 0.63, 0.555), (s * 0.76, 0.565)], 0.02, AHEAD, 'light', 1), 0.0035)
front(car.panel('bumper', [(-0.56, 0.52), (0.56, 0.52), (0.52, 0.42), (-0.52, 0.42)], AHEAD, 'trim', 1, n=60, m=6))
front(car.decal('skid', [(-0.36, 0.44), (0.36, 0.44)], 0.03, AHEAD, 'chrome', 1), 0.0028)

# ---- the tail: the boomerang lamps round the tailgate's corners; its shut line; the black lower bumper, its skid
TAILLAMP = 1.08
for s in (1, -1):
    cluster = [(s * 0.50, TAILLAMP + 0.05), (s * 0.86, TAILLAMP + 0.07), (s * 0.86, TAILLAMP - 0.07), (s * 0.66, TAILLAMP - 0.04)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.54, TAILLAMP + 0.03), (s * 0.82, TAILLAMP + 0.045), (s * 0.84, TAILLAMP - 0.05)], 0.012, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.62, 0.58), (s * 0.78, 0.58), (s * 0.78, 0.60), (s * 0.62, 0.60)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
gate = [(-0.50, 1.13), (-0.64, 1.10), (-0.66, 0.70), (-0.62, 0.66), (0.62, 0.66), (0.66, 0.70), (0.64, 1.10), (0.50, 1.13)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('bumper', [(-0.84, 0.64), (0.84, 0.64), (0.80, 0.47), (-0.80, 0.47)], BEHIND, 'trim', -1, n=70, m=8))
rear(car.decal('skid', [(-0.36, 0.51), (0.36, 0.51)], 0.03, BEHIND, 'chrome', -1), 0.0028)

c.handles(drop=0.11)
c.mirrors(cap='trim')
c.wiper()
c.cabin()
c.wheels(spokes=5, tread=0.008)  # (17" alloys: five twin spokes)
# (Azul Eléctrico, under its black roof)
c.finish(out, renders, blend, paint=dict(base=(0.04, 0.16, 0.42), rough=0.16, metal=0.6, coat=1.0))
