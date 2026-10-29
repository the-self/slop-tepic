# tools/models/blender/toyota-yaris.py
# The Toyota Yaris sedan (the XP150 "Ativ", 2018 facelift, the one sold in Mexico from Thailand), modelled by script on
# the shell the everyday cars share (shell.py): a small sedan, the cabin tall and upright for its size, the short high
# trunk; laid onto it the Yaris's face: a thin chrome bar of an upper grille between the swept head lamps, the big black
# trapezoid of the lower grille reaching out to the fog lamps at the corners; the tail lamps wrapping round the trunk's
# corners. Real sizes (Toyota's data sheet): 4.425 m long, 1.730 m wide (no mirrors), 1.475 m high, a 2.550 m
# wheelbase, a 1.480 m track, 185/60 R15 tyres (0.60 m across).
#   blender -b --factory-startup -P tools/models/blender/toyota-yaris.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.2125, -2.2125, 0.80
TOP = [(NOSE, 0.60), (2.205, 0.635), (2.18, 0.665), (2.12, 0.69), (2.0, 0.72), (1.70, 0.77), (1.30, 0.83), (1.00, 0.87),
       (COWL, 0.905), (0.62, 1.03), (0.40, 1.19), (0.18, 1.34), (0.0, 1.42), (-0.25, 1.475), (-0.55, 1.47), (-0.88, 1.41),
       (-1.05, 1.31), (-1.25, 1.18), (-1.45, 1.09), (-1.70, 1.07), (-1.95, 1.06), (-2.10, 1.055), (-2.17, 1.04),
       (-2.19, 0.99), (-2.205, 0.89), (-2.21, 0.77), (TAIL, 0.54)]
BOTTOM = [(NOSE, 0.35), (2.20, 0.30), (2.16, 0.26), (2.08, 0.22), (1.9, 0.19), (1.0, 0.165), (-1.7, 0.165), (-1.95, 0.20),
          (-2.12, 0.24), (-2.19, 0.28), (TAIL, 0.33)]
BELT = [(NOSE, 0.59), (2.20, 0.625), (2.12, 0.665), (1.9, 0.72), (1.5, 0.79), (1.1, 0.85), (COWL, 0.89), (0.3, 0.93),
        (-0.4, 0.955), (-1.0, 0.975), (-1.5, 0.995), (-2.0, 1.005), (-2.16, 0.99), (TAIL, 0.85)]

c = Shell('toyota-yaris', nose=NOSE, tail=TAIL, half=0.865, nose_deep=0.50, tail_r=0.32, axles=(1.33, -1.22),
          tyre=(0.30, 0.185, 0.19), track=1.48, arch=0.345, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=-0.02, roof_end=-0.92, rear_end=-1.45, posts=[(-0.20, -0.12), (-0.98, -0.92)], quarter_run=0.28,
          shoulder=0.80, roof_half=0.55, edges=[-2.17, -2.19])
c.seams(deck=True)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the chrome bar between the lamps over a thin black slot; the lamps swept back and up round the corners;
# the big black lower grille, narrow at its top and spreading to the bumper's corners, its mesh, the fog lamps in its
# outer ends
front(car.panel('upper_grille', [(-0.32, 0.64), (0.32, 0.64), (0.28, 0.605), (-0.28, 0.605)], AHEAD, 'gloss', 1, n=30, m=24), 0.003)
front(car.decal('chrome_bar', [(-0.33, 0.645), (0.33, 0.645)], 0.012, AHEAD, 'chrome', 1), 0.003)
for s in (1, -1):
    slot = [(s * 0.32, 0.665), (s * 0.76, 0.705), (s * 0.82, 0.635), (s * 0.36, 0.61)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('headlamp', [(s * 0.48, 0.645), (s * 0.66, 0.665)], 0.035, AHEAD, 'headlamp', 1), 0.003)
    front(car.decal('lightbar', [(s * 0.38, 0.618), (s * 0.78, 0.648)], 0.006, AHEAD, 'light', 1), 0.0035)
    front(car.panel('fog', [(s * 0.60, 0.43), (s * 0.72, 0.435), (s * 0.72, 0.405), (s * 0.60, 0.40)], AHEAD, 'light', 1, n=8, m=2), 0.0035)
front(car.panel('grille', [(-0.40, 0.555), (0.40, 0.555), (0.76, 0.33), (-0.76, 0.33)], AHEAD, 'gloss', 1, n=70, m=24), 0.003)
for k in range(5):
    z = 0.36 + k * 0.035
    hw = 0.40 + 0.36 * (0.555 - z) / 0.225 - 0.06
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.004, AHEAD, 'trim', 1), 0.0038)
front(car.decal('lip', [(-0.74, 0.295), (0.74, 0.295)], 0.02, AHEAD, 'trim', 1))

# ---- the tail: the lamps round the trunk's corners, a lit bar in each; the lid's shut line and chrome bar; the black
# strip under the bumper
TAILLAMP = 0.93
for s in (1, -1):
    cluster = [(s * 0.44, TAILLAMP + 0.05), (s * 0.86, TAILLAMP + 0.06), (s * 0.86, TAILLAMP - 0.06), (s * 0.52, TAILLAMP - 0.03)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.50, TAILLAMP + 0.02), (s * 0.84, TAILLAMP + 0.03)], 0.012, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.56, TAILLAMP - 0.025), (s * 0.64, TAILLAMP - 0.03), (s * 0.64, TAILLAMP - 0.005), (s * 0.56, TAILLAMP)], AT_TAIL, 'white', -1, n=6, m=2), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.60, 0.42), (s * 0.76, 0.42), (s * 0.76, 0.44), (s * 0.60, 0.44)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
lid = [(-0.44, TAILLAMP + 0.05), (-0.44, 0.70), (-0.41, 0.67), (0.41, 0.67), (0.44, 0.70), (0.44, TAILLAMP + 0.05)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.42, TAILLAMP + 0.01), (0.42, TAILLAMP + 0.01)], 0.012, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('diffuser', [(-0.76, 0.40), (0.76, 0.40), (0.70, 0.34), (-0.70, 0.34)], BEHIND, 'trim', -1, n=70, m=6))

c.handles()
c.mirrors()
c.wiper()
c.cabin()
c.wheels(spokes=6)  # (15" alloys: six twin spokes)
# (Silver Metallic)
c.finish(out, renders, blend, paint=dict(base=(0.56, 0.57, 0.58), rough=0.22, metal=0.9, coat=1.0))
