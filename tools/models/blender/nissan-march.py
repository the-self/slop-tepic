# tools/models/blender/nissan-march.py
# The Nissan March (the fourth one, K13, as built in Aguascalientes, with the 2021 face), modelled by script on the
# shell the everyday cars share (shell.py): a small round hatchback, the short sloping hood, the tall cabin and its
# domed roof, the hatch nearly upright, the thick C post; laid onto it the March's face: the V-motion grille between the
# big swept head lamps, the black lower grille; the tall tail lamps up the hatch's corners. Real sizes (Nissan's data
# sheet): 3.827 m long, 1.665 m wide (no mirrors), 1.510 m high, a 2.450 m wheelbase, a 1.470 m track, 175/60 R15 tyres
# (0.59 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-march.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 1.9135, -1.9135, 0.95
TOP = [(NOSE, 0.66), (1.905, 0.70), (1.88, 0.73), (1.82, 0.76), (1.65, 0.80), (1.40, 0.85), (1.10, 0.90), (COWL, 0.925),
       (0.75, 1.07), (0.55, 1.23), (0.35, 1.39), (0.15, 1.475), (-0.15, 1.51), (-0.60, 1.505), (-1.00, 1.48),
       (-1.35, 1.43), (-1.55, 1.38), (-1.62, 1.34), (-1.72, 1.22), (-1.80, 1.08), (-1.85, 0.98), (-1.885, 0.88),
       (-1.905, 0.76), (TAIL, 0.62)]
BOTTOM = [(NOSE, 0.36), (1.90, 0.31), (1.86, 0.27), (1.78, 0.23), (1.6, 0.20), (1.0, 0.16), (-1.4, 0.16), (-1.62, 0.20),
          (-1.80, 0.26), (-1.89, 0.32), (TAIL, 0.38)]
BELT = [(NOSE, 0.65), (1.90, 0.69), (1.82, 0.74), (1.6, 0.80), (1.3, 0.86), (COWL, 0.91), (0.4, 0.94), (-0.3, 0.965),
        (-1.0, 0.99), (-1.5, 1.01), (-1.80, 1.02), (-1.87, 0.98), (TAIL, 0.88)]

c = Shell('nissan-march', nose=NOSE, tail=TAIL, half=0.8325, nose_deep=0.50, tail_r=0.28, axles=(1.25, -1.20),
          tyre=(0.295, 0.175, 0.19), track=1.47, arch=0.34, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.13, roof_end=-1.60, rear_end=-1.86, posts=[(-0.10, -0.03), (-0.95, -0.88)], quarter=False,
          quarter_run=0.25, shoulder=0.83, roof_half=0.56, crown=0.05, edges=[-1.62, -1.85])
c.seams()
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the V-motion grille between the lamps, its chrome strips down its flanks; the big lamps swept back up the
# fenders, a lit line along each; the black lower grille, the fog lamps at its ends
front(car.panel('grille', [(-0.30, 0.755), (0.30, 0.755), (0.22, 0.56), (-0.22, 0.56)], AHEAD, 'gloss', 1, n=40, m=24), 0.003)
for k in range(5):
    z = 0.585 + k * 0.034
    hw = 0.22 + 0.08 * (z - 0.56) / 0.195 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.005, AHEAD, 'trim', 1), 0.0038)
for s in (1, -1):
    front(car.decal('chrome_v', [(s * 0.34, 0.765), (s * 0.32, 0.72), (s * 0.24, 0.56), (s * 0.14, 0.54)], 0.03, AHEAD, 'chrome', 1), 0.0042)
    slot = [(s * 0.34, 0.80), (s * 0.70, 0.83), (s * 0.78, 0.73), (s * 0.38, 0.72)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('headlamp', [(s * 0.48, 0.765), (s * 0.64, 0.775)], 0.05, AHEAD, 'headlamp', 1), 0.003)
    front(car.decal('lightbar', [(s * 0.38, 0.73), (s * 0.76, 0.74)], 0.007, AHEAD, 'light', 1), 0.0035)
    front(car.panel('fog', [(s * 0.52, 0.48), (s * 0.70, 0.49), (s * 0.70, 0.43), (s * 0.54, 0.42)], AHEAD, 'gloss', 1, n=16), 0.002)
    front(car.decal('fog', [(s * 0.56, 0.455), (s * 0.66, 0.46)], 0.02, AHEAD, 'light', 1), 0.0035)
front(car.panel('lower_grille', [(-0.44, 0.50), (0.44, 0.50), (0.40, 0.36), (-0.40, 0.36)], AHEAD, 'gloss', 1, n=40, m=6))

# ---- the tail: the tall lamps up the hatch's corners, wrapping round them; the hatch's shut line; the black lower
# bumper, its reflectors
for s in (1, -1):
    cluster = [(s * 0.62, 1.22), (s * 0.80, 1.20), (s * 0.82, 0.92), (s * 0.66, 0.92)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=16, m=20), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.70, 1.17), (s * 0.73, 1.00)], 0.03, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.66, 0.99), (s * 0.76, 0.99), (s * 0.77, 0.94), (s * 0.67, 0.94)], AT_TAIL, 'white', -1, n=6, m=4), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.56, 0.50), (s * 0.72, 0.50), (s * 0.72, 0.52), (s * 0.56, 0.52)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
gate = [(-0.60, 1.30), (-0.60, 0.70), (-0.56, 0.66), (0.56, 0.66), (0.60, 0.70), (0.60, 1.30)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('bumper', [(-0.78, 0.56), (0.78, 0.56), (0.74, 0.40), (-0.74, 0.40)], BEHIND, 'trim', -1, n=60, m=6))

c.handles()
c.mirrors(scale=0.95)
c.wiper()
c.cabin()
c.wheels(spokes=8)  # (15" alloys: eight spokes)
# (Amarillo, the March's)
c.finish(out, renders, blend, paint=dict(base=(0.72, 0.50, 0.03), rough=0.18, metal=0.3, coat=1.0))
