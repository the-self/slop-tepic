# tools/models/blender/nissan-x-trail.py
# The Nissan X-Trail (the fourth one, T33, 2023 on), modelled by script on the shell the everyday cars share
# (shell.py): a family crossover, the high flat hood, the roof level to the spoiler over the raked tailgate glass, the
# quarter light behind the C post, the black roof (the two-tone), the cladding and the arches' mouldings, the roof
# rails; laid onto it the X-Trail's split face: the slim lit bars high at the hood's corners, the head lamps low in the
# bumper beside the big V-motion grille, its chrome strips; the slim tail lamps across the tailgate's corners. Real sizes
# (Nissan's data sheet): 4.680 m long, 1.840 m wide (no mirrors), 1.720 m high, a 2.705 m wheelbase, a 1.590 m track,
# 235/60 R18 tyres (0.74 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-x-trail.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.34, -2.34, 0.95
TOP = [(NOSE, 0.86), (2.33, 0.90), (2.30, 0.93), (2.24, 0.96), (2.10, 0.99), (1.75, 1.04), (1.35, 1.09), (COWL, 1.13),
       (0.78, 1.26), (0.55, 1.44), (0.30, 1.61), (0.10, 1.69), (-0.20, 1.72), (-0.90, 1.72), (-1.50, 1.705),
       (-1.88, 1.68), (-1.93, 1.65), (-2.05, 1.50), (-2.18, 1.30), (-2.24, 1.20), (-2.28, 1.08), (-2.31, 0.94),
       (-2.33, 0.80), (TAIL, 0.66)]
BOTTOM = [(NOSE, 0.50), (2.33, 0.45), (2.28, 0.40), (2.16, 0.34), (1.95, 0.28), (1.0, 0.21), (-1.8, 0.21), (-2.05, 0.28),
          (-2.22, 0.35), (-2.30, 0.43), (TAIL, 0.50)]
BELT = [(NOSE, 0.84), (2.32, 0.89), (2.12, 0.95), (1.6, 1.02), (1.2, 1.07), (COWL, 1.10), (0.3, 1.12), (-0.5, 1.135),
        (-1.2, 1.15), (-1.85, 1.17), (-2.22, 1.18), (-2.30, 1.13), (TAIL, 1.02)]

c = Shell('nissan-x-trail', nose=NOSE, tail=TAIL, half=0.92, nose_deep=0.45, tail_r=0.32, axles=(1.39, -1.315),
          tyre=(0.37, 0.235, 0.229), track=1.59, arch=0.43, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.08, roof_end=-1.92, rear_end=-2.23, posts=[(-0.24, -0.15), (-1.20, -1.12)], quarter_run=0.55,
          shoulder=0.96, shelf=0.08, roof_half=0.63, sill='clad', roof='trim', fender=(0.03, None), edges=[-2.24, -2.28])
c.arch_mouldings(0.08)
c.seams()
c.roof_rails()
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.03

# ---- the face: the big V-motion grille, its black mesh, the chrome strips down its flanks; the slim lit bars high at
# the hood's corners; the head lamps low beside the grille, dark blocks with their lenses; the black lower bumper, the
# skid plate
front(car.panel('grille', [(-0.46, 0.92), (0.46, 0.92), (0.36, 0.52), (-0.36, 0.52)], AHEAD, 'gloss', 1, n=60, m=24), 0.003)
for k in range(9):
    z = 0.55 + k * 0.04
    hw = 0.36 + 0.10 * (z - 0.52) / 0.40 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.006, AHEAD, 'trim', 1), 0.0038)
for s in (1, -1):
    front(car.decal('chrome_v', [(s * 0.50, 0.93), (s * 0.48, 0.86), (s * 0.39, 0.53), (s * 0.26, 0.50)], 0.04, AHEAD, 'chrome', 1), 0.0042)
    front(car.panel('drl_slot', [(s * 0.50, 0.955), (s * 0.86, 0.975), (s * 0.88, 0.935), (s * 0.52, 0.925)], AHEAD, 'gloss', 1, n=30, m=2), 0.002)
    front(car.decal('lightbar', [(s * 0.53, 0.94), (s * 0.86, 0.955)], 0.012, AHEAD, 'light', 1), 0.0035)
    front(car.panel('headlamp_slot', [(s * 0.56, 0.86), (s * 0.84, 0.87), (s * 0.84, 0.74), (s * 0.58, 0.74)], AHEAD, 'gloss', 1, n=24), 0.002)
    for k in range(3):
        front(car.decal('headlamp', [(s * (0.60 + 0.075 * k), 0.80), (s * (0.645 + 0.075 * k), 0.80)], 0.04, AHEAD, 'headlamp', 1), 0.003)
front(car.panel('bumper', [(-0.80, 0.50), (0.80, 0.50), (0.76, 0.40), (-0.76, 0.40)], AHEAD, 'trim', 1, n=70, m=6))
front(car.decal('skid', [(-0.40, 0.43), (0.40, 0.43)], 0.035, AHEAD, 'chrome', 1), 0.0028)

# ---- the tail: the slim lamps across the tailgate's corners, wrapping; its shut line; the black lower bumper
TAILLAMP = 1.12
for s in (1, -1):
    cluster = [(s * 0.44, TAILLAMP + 0.035), (s * 0.94, TAILLAMP + 0.06), (s * 0.94, TAILLAMP - 0.05), (s * 0.50, TAILLAMP - 0.025)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.48, TAILLAMP + 0.012), (s * 0.70, TAILLAMP + 0.03), (s * 0.92, TAILLAMP + 0.03)], 0.012, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.66, 0.62), (s * 0.82, 0.62), (s * 0.82, 0.645), (s * 0.66, 0.645)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
gate = [(-0.44, 1.17), (-0.72, 1.15), (-0.74, 0.74), (-0.70, 0.70), (0.70, 0.70), (0.74, 0.74), (0.72, 1.15), (0.44, 1.17)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.44, TAILLAMP + 0.0), (0.44, TAILLAMP + 0.0)], 0.012, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('bumper', [(-0.88, 0.68), (0.88, 0.68), (0.84, 0.50), (-0.84, 0.50)], BEHIND, 'trim', -1, n=80, m=8))
rear(car.decal('skid', [(-0.42, 0.54), (0.42, 0.54)], 0.03, BEHIND, 'chrome', -1), 0.0028)

c.handles(drop=0.12, chrome=True)
c.mirrors(scale=1.1, cap='trim')
c.wiper()
c.cabin()
c.wheels(spokes=5, tread=0.009)  # (18" alloys: five split spokes)
# (Blanco Perla, under its black roof)
c.finish(out, renders, blend, paint=dict(base=(0.80, 0.80, 0.78), rough=0.18, metal=0.2, coat=1.0))
