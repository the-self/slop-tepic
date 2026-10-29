# tools/models/blender/toyota-supra.py
# The Toyota GR Supra (the fifth one, A90, 2019 on), modelled by script on the shell the everyday cars share
# (shell.py): a two-seat coupe, the very long low hood between the front fenders' crests, the cabin far back under its
# double-bubble roof, the wide rear haunches, the ducktail; laid onto it the Supra's face: the big central intake, the
# two side intakes, the head lamps with their three round lenses each; the slim tail lamps under the ducktail, the
# black diffuser between the two exhaust tips. Real sizes (Toyota's data sheet): 4.379 m long, 1.854 m wide (no
# mirrors), 1.292 m high, a 2.470 m wheelbase, a 1.594 m track, 255/35 R19 tyres (0.66 m across).
#   blender -b --factory-startup -P tools/models/blender/toyota-supra.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell, ring  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.1895, -2.1895, 0.15
TOP = [(NOSE, 0.48), (2.18, 0.52), (2.15, 0.56), (2.08, 0.59), (1.95, 0.62), (1.60, 0.68), (1.20, 0.74), (0.80, 0.80),
       (0.40, 0.85), (COWL, 0.88), (0.0, 0.97), (-0.15, 1.07), (-0.30, 1.17), (-0.45, 1.25), (-0.62, 1.29), (-0.82, 1.28),
       (-0.98, 1.24), (-1.15, 1.14), (-1.35, 1.03), (-1.50, 0.975), (-1.75, 0.955), (-1.95, 0.95), (-2.08, 0.965),
       (-2.13, 0.97), (-2.16, 0.93), (-2.18, 0.82), (-2.187, 0.70), (TAIL, 0.50)]
BOTTOM = [(NOSE, 0.28), (2.17, 0.23), (2.12, 0.19), (2.0, 0.15), (1.6, 0.12), (-1.5, 0.12), (-1.85, 0.16), (-2.05, 0.21),
          (-2.15, 0.27), (TAIL, 0.33)]
BELT = [(NOSE, 0.47), (2.17, 0.51), (2.08, 0.565), (1.85, 0.62), (1.50, 0.68), (1.10, 0.74), (0.60, 0.79), (COWL, 0.83),
        (-0.30, 0.86), (-0.80, 0.88), (-1.20, 0.91), (-1.60, 0.93), (-1.95, 0.94), (-2.10, 0.93), (TAIL, 0.75)]

c = Shell('toyota-supra', nose=NOSE, tail=TAIL, half=0.927, nose_deep=0.55, tail_r=0.36, axles=(1.19, -1.28),
          tyre=(0.33, 0.255, 0.241), track=1.594, arch=0.365, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=-0.45, roof_end=-1.00, rear_end=-1.48, posts=[(-0.84, -0.80)], quarter_run=0.30, shoulder=0.64,
          shelf=0.11, crown=0.05, roof_half=0.50, fender=(0.07, 1.95), waist=0.03, a_tip=0.07, sill='paint',
          edges=[-2.13, -2.16, -2.18])
c.seams(seam_from=0.24)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the big central intake, a trapezoid widening down, its mesh; the side intakes at the corners; the lamps
# swept up and back over them, three round lenses in each over a lit line
front(car.panel('grille', [(-0.38, 0.42), (0.38, 0.42), (0.46, 0.25), (-0.46, 0.25)], AHEAD, 'gloss', 1, n=60, m=24), 0.003)
for k in range(4):
    z = 0.28 + k * 0.035
    front(car.decal('grille_bar', [(-0.40, z), (0.40, z)], 0.004, AHEAD, 'trim', 1), 0.0038)
front(car.panel('nose_slot', [(-0.16, 0.47), (0.16, 0.47), (0.13, 0.45), (-0.13, 0.45)], AHEAD, 'gloss', 1, n=16, m=2))
for s in (1, -1):
    front(car.panel('intake', [(s * 0.58, 0.43), (s * 0.86, 0.47), (s * 0.86, 0.28), (s * 0.56, 0.26)], AHEAD, 'gloss', 1, n=20), 0.002)
    slot = [(s * 0.48, 0.545), (s * 0.84, 0.615), (s * 0.90, 0.54), (s * 0.54, 0.495)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    for k in range(3):
        cx, cz = s * (0.60 + 0.085 * k), 0.535 + 0.016 * k
        front(car.decal('headlamp', ring(cx, cz, 0.032, 0.022, n=16), 0.012, AHEAD, 'headlamp', 1), 0.003)
    front(car.decal('lightbar', [(s * 0.52, 0.505), (s * 0.88, 0.555)], 0.006, AHEAD, 'light', 1), 0.0035)

# ---- the tail: the slim lamps under the ducktail, wrapping round the corners; the black diffuser, the reversing lamp
# in its middle, the exhaust tips either side
TAILLAMP = 0.86
for s in (1, -1):
    cluster = [(s * 0.40, TAILLAMP + 0.02), (s * 0.92, TAILLAMP + 0.05), (s * 0.92, TAILLAMP - 0.03), (s * 0.48, TAILLAMP - 0.02)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.46, TAILLAMP + 0.005), (s * 0.90, TAILLAMP + 0.025)], 0.010, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.decal('exhaust', ring(s * 0.40, 0.34, 0.045, 0.045, n=20), 0.014, BEHIND, 'chrome', -1), 0.004)
    rear(car.panel('vent', [(s * 0.66, 0.50), (s * 0.88, 0.52), (s * 0.86, 0.40), (s * 0.68, 0.40)], BEHIND, 'gloss', -1, n=12), 0.003)
rear(car.panel('diffuser', [(-0.84, 0.40), (0.84, 0.40), (0.74, 0.27), (-0.74, 0.27)], BEHIND, 'trim', -1, n=80, m=8))
rear(car.panel('reverse', [(-0.04, 0.39), (0.04, 0.39), (0.04, 0.33), (-0.04, 0.33)], BEHIND, 'white', -1, n=4, m=4), 0.004)

c.handles(drop=0.08)
c.mirrors(scale=0.9)
c.wiper()
c.cabin(rows=1, seats=-0.50)
c.wheels(spokes=10, tread=0.006)  # (19" forged alloys: ten slim spokes)
# (Renaissance Red)
c.finish(out, renders, blend, paint=dict(base=(0.42, 0.01, 0.015), rough=0.12, metal=0.4, coat=1.0))
