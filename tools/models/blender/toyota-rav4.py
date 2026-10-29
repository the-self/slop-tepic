# tools/models/blender/toyota-rav4.py
# The Toyota RAV4 (the fifth one, XA50, 2019 on), modelled by script on the shell the everyday cars share (shell.py):
# a squared-off crossover, the hood high and flat, the roof level to the spoiler over the raked tailgate glass, the
# kicked-up quarter light behind the C post, the black cladding along the sills and round the squared wheel arches,
# the roof rails; laid onto it the RAV4's face: the angular head lamps, the slim black upper grille between them, the
# big trapezoid of the lower grille, the black vents at its corners, the silver skid plate; the slim tail lamps across
# the tailgate's corners, the black lower bumper. Real sizes (Toyota's data sheet): 4.600 m long, 1.855 m wide (no
# mirrors), 1.685 m high, a 2.690 m wheelbase, a 1.605 m track, 225/65 R17 tyres (0.72 m across).
#   blender -b --factory-startup -P tools/models/blender/toyota-rav4.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.30, -2.30, 0.90
TOP = [(NOSE, 0.82), (2.29, 0.86), (2.26, 0.89), (2.20, 0.92), (2.05, 0.95), (1.70, 0.995), (1.30, 1.04), (COWL, 1.085),
       (0.75, 1.20), (0.50, 1.38), (0.25, 1.55), (0.05, 1.645), (-0.25, 1.685), (-0.80, 1.685), (-1.40, 1.675),
       (-1.80, 1.65), (-1.85, 1.62), (-1.98, 1.47), (-2.12, 1.27), (-2.18, 1.17), (-2.23, 1.05), (-2.26, 0.92),
       (-2.285, 0.78), (TAIL, 0.64)]
BOTTOM = [(NOSE, 0.47), (2.29, 0.42), (2.24, 0.37), (2.12, 0.32), (1.90, 0.27), (1.0, 0.21), (-1.8, 0.21), (-2.05, 0.28),
          (-2.20, 0.35), (-2.27, 0.42), (TAIL, 0.48)]
BELT = [(NOSE, 0.80), (2.28, 0.85), (2.08, 0.91), (1.6, 0.97), (1.2, 1.02), (COWL, 1.06), (0.3, 1.09), (-0.5, 1.11),
        (-1.2, 1.13), (-1.75, 1.16), (-2.15, 1.17), (-2.25, 1.12), (TAIL, 1.0)]

c = Shell('toyota-rav4', nose=NOSE, tail=TAIL, half=0.9275, nose_deep=0.42, tail_r=0.30, axles=(1.36, -1.33),
          tyre=(0.362, 0.225, 0.216), track=1.605, arch=0.42, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.02, roof_end=-1.84, rear_end=-2.17, posts=[(-0.26, -0.17), (-1.17, -1.10)], quarter_run=0.55,
          shoulder=0.93, shelf=0.08, roof_half=0.63, fender=(0.03, None), sill='clad', square_arches=True,
          edges=[-2.18, -2.23])
c.arch_mouldings(0.09, square=True)
c.seams()
c.roof_rails()
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.03

# ---- the face: the lamps angular, a lit L along each one's top and down its inner end; the slim black upper grille
# between them; the big lower grille, a trapezoid in a black frame; the vents at its corners; the skid plate
front(car.panel('upper_grille', [(-0.38, 0.865), (0.38, 0.865), (0.34, 0.80), (-0.34, 0.80)], AHEAD, 'gloss', 1, n=40, m=24), 0.003)
for s in (1, -1):
    slot = [(s * 0.36, 0.875), (s * 0.86, 0.905), (s * 0.90, 0.83), (s * 0.42, 0.795)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('lightbar', [(s * 0.42, 0.80), (s * 0.40, 0.86), (s * 0.84, 0.895)], 0.008, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.56, 0.845), (s * 0.74, 0.86)], 0.04, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('vent', [(s * 0.68, 0.72), (s * 0.88, 0.74), (s * 0.86, 0.46), (s * 0.72, 0.46)], AHEAD, 'trim', 1, n=20), 0.002)
    front(car.panel('fog', [(s * 0.74, 0.53), (s * 0.84, 0.535), (s * 0.84, 0.51), (s * 0.74, 0.505)], AHEAD, 'light', 1, n=8, m=2), 0.0035)
front(car.panel('grille', [(-0.56, 0.73), (0.56, 0.73), (0.64, 0.44), (-0.64, 0.44)], AHEAD, 'gloss', 1, n=70, m=24), 0.003)
for k in range(7):
    z = 0.47 + k * 0.036
    hw = 0.56 + 0.08 * (0.73 - z) / 0.29 - 0.05
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.005, AHEAD, 'trim', 1), 0.0038)
front(car.decal('skid', [(-0.50, 0.40), (0.50, 0.40)], 0.04, AHEAD, 'chrome', 1), 0.0028)

# ---- the tail: the slim lamps across the tailgate's corners, wrapping round them, a lit line in each; the tailgate's
# shut line; the black lower bumper, its reflectors
TAILLAMP = 1.10
for s in (1, -1):
    cluster = [(s * 0.46, TAILLAMP + 0.03), (s * 0.92, TAILLAMP + 0.06), (s * 0.92, TAILLAMP - 0.05), (s * 0.52, TAILLAMP - 0.03)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.50, TAILLAMP + 0.012), (s * 0.90, TAILLAMP + 0.035)], 0.012, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.58, TAILLAMP - 0.02), (s * 0.68, TAILLAMP - 0.025), (s * 0.68, TAILLAMP - 0.005), (s * 0.58, TAILLAMP)], AT_TAIL, 'white', -1, n=6, m=2), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.66, 0.60), (s * 0.82, 0.60), (s * 0.82, 0.625), (s * 0.66, 0.625)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
gate = [(-0.46, 1.16), (-0.70, 1.13), (-0.72, 0.72), (-0.68, 0.68), (0.68, 0.68), (0.72, 0.72), (0.70, 1.13), (0.46, 1.16)]
rear(car.decal('seam', gate, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('bumper', [(-0.90, 0.66), (0.90, 0.66), (0.86, 0.48), (-0.86, 0.48)], BEHIND, 'trim', -1, n=80, m=8))
rear(car.decal('skid', [(-0.40, 0.52), (0.40, 0.52)], 0.03, BEHIND, 'chrome', -1), 0.0028)

c.handles(drop=0.12)
c.mirrors(scale=1.1)
c.wiper()
c.cabin()
c.wheels(spokes=5, tread=0.009)  # (17" alloys: five split spokes)
# (Lunar Rock, the RAV4's khaki grey)
c.finish(out, renders, blend, paint=dict(base=(0.30, 0.31, 0.28), rough=0.25, metal=0.4, coat=1.0))
