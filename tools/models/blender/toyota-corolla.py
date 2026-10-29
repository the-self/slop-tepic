# tools/models/blender/toyota-corolla.py
# The Toyota Corolla sedan (the twelfth one, E210, 2019 on), modelled by script on the shell the everyday cars share
# (shell.py): the short hood, the cabin's long arc of a roof, the high short trunk; laid onto it the Corolla's face:
# the thin black slot of an upper grille between the slim angular head lamps, the big trapezoid of a lower grille in
# its honeycomb across the bumper, the black C-shaped vents at its corners; the wide tail lamps reaching into the trunk
# lid, the black strip low on the rear bumper. Real sizes (Toyota's data sheet): 4.630 m long, 1.780 m wide (no
# mirrors), 1.435 m high, a 2.700 m wheelbase, a 1.531 m track, 205/55 R16 tyres (0.63 m across).
#   blender -b --factory-startup -P tools/models/blender/toyota-corolla.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.315, -2.315, 0.85
# the centreline's top: the nose up to the hood's edge, the hood, the windshield, the roof's long arc, the back glass,
# the trunk's deck and its lip, the tail's face
TOP = [(NOSE, 0.60), (2.31, 0.635), (2.28, 0.665), (2.22, 0.69), (2.10, 0.72), (1.80, 0.77), (1.40, 0.83), (1.10, 0.87),
       (COWL, 0.905), (0.65, 1.02), (0.40, 1.17), (0.15, 1.32), (-0.05, 1.395), (-0.30, 1.435), (-0.60, 1.43),
       (-0.98, 1.37), (-1.18, 1.27), (-1.38, 1.15), (-1.58, 1.075), (-1.80, 1.058), (-2.05, 1.045), (-2.20, 1.04),
       (-2.27, 1.025), (-2.29, 0.98), (-2.305, 0.88), (-2.312, 0.76), (TAIL, 0.53)]
BOTTOM = [(NOSE, 0.34), (2.30, 0.29), (2.26, 0.25), (2.18, 0.21), (2.0, 0.18), (1.0, 0.16), (-1.8, 0.16), (-2.05, 0.19),
          (-2.22, 0.23), (-2.29, 0.27), (TAIL, 0.32)]
BELT = [(NOSE, 0.59), (2.30, 0.625), (2.22, 0.665), (2.0, 0.72), (1.6, 0.79), (1.2, 0.85), (COWL, 0.89), (0.3, 0.925),
        (-0.4, 0.95), (-1.0, 0.97), (-1.6, 0.99), (-2.1, 1.0), (-2.26, 0.99), (TAIL, 0.85)]

c = Shell('toyota-corolla', nose=NOSE, tail=TAIL, half=0.89, nose_deep=0.52, tail_r=0.34, axles=(1.385, -1.315),
          tyre=(0.316, 0.205, 0.203), track=1.531, arch=0.355, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=-0.02, roof_end=-1.01, rear_end=-1.58, posts=[(-0.22, -0.13), (-1.06, -1.00)], quarter_run=0.30,
          shoulder=0.80, edges=[-2.27, -2.29])
c.seams(deck=True)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the slim upper grille, a black slot with a chrome bar along its top, between the lamps; the lamps
# narrow and angular, swept back round the corners, each its LED's lit line along its top and a projector inside; the
# big lower grille, a trapezoid widening down, its honeycomb; the black vents at its corners, a fog lamp in each
front(car.panel('upper_grille', [(-0.36, 0.635), (0.36, 0.635), (0.30, 0.595), (-0.30, 0.595)], AHEAD, 'gloss', 1, n=40, m=24), 0.003)
front(car.decal('chrome_bar', [(-0.36, 0.638), (0.36, 0.638)], 0.008, AHEAD, 'chrome', 1), 0.003)
for s in (1, -1):
    slot = [(s * 0.34, 0.655), (s * 0.80, 0.70), (s * 0.86, 0.64), (s * 0.40, 0.605)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('lightbar', [(s * 0.40, 0.648), (s * 0.78, 0.692)], 0.007, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.52, 0.640), (s * 0.66, 0.655)], 0.030, AHEAD, 'headlamp', 1), 0.003)
    vent = [(s * 0.60, 0.52), (s * 0.82, 0.55), (s * 0.80, 0.33), (s * 0.60, 0.33)]
    front(car.panel('vent', vent, AHEAD, 'trim', 1, n=20), 0.002)
    front(car.panel('fog', [(s * 0.66, 0.415), (s * 0.77, 0.42), (s * 0.77, 0.395), (s * 0.66, 0.39)], AHEAD, 'light', 1, n=8, m=2), 0.0035)
front(car.panel('grille', [(-0.50, 0.53), (0.50, 0.53), (0.56, 0.31), (-0.56, 0.31)], AHEAD, 'gloss', 1, n=60, m=24), 0.003)
for k in range(6):  # (its honeycomb: rows of short black bars, staggered)
    z = 0.345 + k * 0.032
    hw = 0.50 + 0.06 * (0.53 - z) / 0.22 - 0.04
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.004, AHEAD, 'trim', 1), 0.0038)
front(car.decal('lip', [(-0.80, 0.27), (0.80, 0.27)], 0.025, AHEAD, 'trim', 1))

# ---- the tail: the wide lamps, sharp-ended, wrapping round the corners and in onto the trunk lid, a lit line inside
# each; the lid's shut line; the black strip low on the bumper with the reflectors at its ends
TAILLAMP = 0.94
for s in (1, -1):
    cluster = [(s * 0.36, TAILLAMP + 0.05), (s * 0.90, TAILLAMP + 0.07), (s * 0.90, TAILLAMP - 0.07), (s * 0.44, TAILLAMP - 0.01)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.44, TAILLAMP + 0.018), (s * 0.70, TAILLAMP + 0.03), (s * 0.88, TAILLAMP + 0.012)],
                   0.010, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.62, TAILLAMP - 0.03), (s * 0.70, TAILLAMP - 0.032), (s * 0.70, TAILLAMP - 0.005), (s * 0.62, TAILLAMP)], AT_TAIL, 'white', -1, n=6, m=2), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.62, 0.42), (s * 0.80, 0.42), (s * 0.80, 0.44), (s * 0.62, 0.44)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
lid = [(-0.36, TAILLAMP + 0.05), (-0.42, TAILLAMP - 0.02), (-0.42, 0.72), (-0.39, 0.69), (0.39, 0.69), (0.42, 0.72), (0.42, TAILLAMP - 0.02), (0.36, TAILLAMP + 0.05)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.36, TAILLAMP + 0.02), (0.36, TAILLAMP + 0.02)], 0.012, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('diffuser', [(-0.82, 0.40), (0.82, 0.40), (0.76, 0.33), (-0.76, 0.33)], BEHIND, 'trim', -1, n=80, m=6))

c.handles()
c.mirrors()
c.wiper()
c.cabin()
c.wheels(spokes=10)  # (16" alloys: ten slim spokes)
# (Supersonic Red)
c.finish(out, renders, blend, paint=dict(base=(0.38, 0.015, 0.02), rough=0.15, metal=0.5, coat=1.0))
