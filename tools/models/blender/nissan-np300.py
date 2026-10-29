# tools/models/blender/nissan-np300.py
# The Nissan NP300 (the D23 Frontier's work truck, built in Cuernavaca), single cab with the long bed, as Tepic's
# trades drive it: modelled by script on the shell the everyday cars share (shell.py): the high flat hood, the short
# two-door cab, its back glass upright, the long bed cut out behind it with a black liner; laid onto it the NP300's
# face: the chrome V-motion grille, its bars across, the big boomerang head lamps, the black bumper; the tall tail lamps
# at the bed's corners, the tailgate, the black step bumper; steel wheels. Real sizes (Nissan's data sheet): 5.230 m
# long, 1.850 m wide (no mirrors), 1.780 m high, a 3.150 m wheelbase, a 1.570 m track, 205 R16 tyres (0.72 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-np300.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.615, -2.615, 1.10
CAB = -0.37  # (the cab's back, where the bed begins)
TOP = [(NOSE, 0.98), (2.60, 1.03), (2.57, 1.07), (2.50, 1.10), (2.30, 1.13), (1.90, 1.17), (1.40, 1.21), (COWL, 1.24),
       (0.92, 1.36), (0.70, 1.53), (0.45, 1.70), (0.28, 1.765), (0.05, 1.78), (-0.25, 1.775), (-0.30, 1.74),
       (-0.34, 1.42), (CAB, 1.30), (-0.42, 1.255), (-2.56, 1.25), (-2.60, 1.245), (-2.61, 1.22), (TAIL, 1.18)]
BOTTOM = [(NOSE, 0.48), (2.60, 0.43), (2.52, 0.38), (2.36, 0.34), (2.15, 0.32), (1.2, 0.30), (-0.36, 0.30), (-0.46, 0.58),
          (-2.40, 0.58), (-2.55, 0.55), (TAIL, 0.52)]
BELT = [(NOSE, 0.96), (2.60, 1.02), (2.40, 1.08), (1.9, 1.14), (1.4, 1.19), (COWL, 1.21), (0.5, 1.225), (CAB, 1.235),
        (-0.42, 1.25), (-2.56, 1.25), (TAIL, 1.18)]

c = Shell('nissan-np300', nose=NOSE, tail=TAIL, half=0.925, nose_deep=0.42, tail_r=0.10, axles=(1.63, -1.52),
          tyre=(0.36, 0.205, 0.203), track=1.57, arch=0.43, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.26, roof_end=-0.29, rear_end=-0.35, posts=[(-0.27, -0.22)], quarter=False, quarter_run=0.05,
          shoulder=1.05, shelf=0.05, crown=0.03, roof_half=0.68, fender=(0.02, None), waist=0.0, sill='paint',
          bed=(-0.43, -2.565, 0.86), edges=[-0.30, -0.34, -0.46, -2.60, -2.61])
c.seams(cab_back=-0.40)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.01

# ---- the face: the grille, its black mesh behind three chrome bars across, the chrome V round its flanks and foot; the
# big boomerang lamps, wrapping round the corners, a lit line in each; the black bumper, its fog lamps' blanks
front(car.panel('grille', [(-0.50, 1.12), (0.50, 1.12), (0.40, 0.80), (-0.40, 0.80)], AHEAD, 'gloss', 1, n=50, m=24), 0.003)
for k in range(3):
    z = 0.87 + k * 0.08
    hw = 0.40 + 0.10 * (z - 0.80) / 0.32 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.02, AHEAD, 'chrome', 1), 0.003)
v = [(-0.53, 1.13), (-0.42, 0.79), (-0.20, 0.77), (0.20, 0.77), (0.42, 0.79), (0.53, 1.13)]
front(car.decal('chrome_v', v, 0.04, AHEAD, 'chrome', 1), 0.0042)
for s in (1, -1):
    slot = [(s * 0.54, 1.14), (s * 0.88, 1.13), (s * 0.91, 0.98), (s * 0.60, 0.97)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=30), 0.002)
    front(car.decal('headlamp', [(s * 0.62, 1.07), (s * 0.80, 1.07)], 0.07, AHEAD, 'headlamp', 1), 0.003)
    front(car.decal('lightbar', [(s * 0.58, 1.125), (s * 0.86, 1.12), (s * 0.89, 1.00)], 0.008, AHEAD, 'light', 1), 0.0035)
    front(car.panel('blank', [(s * 0.62, 0.66), (s * 0.80, 0.67), (s * 0.80, 0.60), (s * 0.64, 0.59)], AHEAD, 'gloss', 1, n=12), 0.002)
front(car.panel('bumper', [(-0.86, 0.74), (0.86, 0.74), (0.82, 0.50), (-0.82, 0.50)], AHEAD, 'trim', 1, n=80, m=8), 0.0015)

# ---- the tail: the tall lamps at the bed's corners, wrapping round them; the tailgate's shut lines and its handle; the
# black step bumper
for s in (1, -1):
    cluster = [(s * 0.80, 1.20), (s * 0.925, 1.20), (s * 0.925, 0.90), (s * 0.80, 0.90)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=12, m=20), 0.003, wrap=True)
    rear(car.panel('amber', [(s * 0.82, 1.08), (s * 0.91, 1.08), (s * 0.91, 1.02), (s * 0.82, 1.02)], AT_TAIL, 'amber', -1, n=6, m=4), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.82, 1.00), (s * 0.91, 1.00), (s * 0.91, 0.95), (s * 0.82, 0.95)], AT_TAIL, 'white', -1, n=6, m=4), 0.0045, wrap=True)
    rear(car.decal('seam', [(s * 0.78, 1.23), (s * 0.78, 0.66)], 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('seam', [(-0.78, 0.66), (0.78, 0.66)], 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('handle', [(-0.10, 1.15), (0.10, 1.15), (0.10, 1.11), (-0.10, 1.11)], BEHIND, 'trim', -1, n=8, m=2), 0.003)
car.box('trim_bumper', (0, TAIL - 0.04, 0.585), (1.80, 0.14, 0.13), 'trim', bevel=0.015)

c.handles(drop=0.13)
c.mirrors(scale=1.25, cap='trim')
c.wiper()
c.cabin(rows=1, seats=-0.05)
c.wheels(spokes=8, tread=0.012)  # (16" steel wheels, their eight slots)
# (Blanco, as most of them are)
c.finish(out, renders, blend, paint=dict(base=(0.80, 0.80, 0.79), rough=0.25, metal=0.0, coat=0.8))
