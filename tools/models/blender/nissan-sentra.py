# tools/models/blender/nissan-sentra.py
# The Nissan Sentra (the eighth one, B18, 2020 on, built in Aguascalientes), modelled by script on the shell the
# everyday cars share (shell.py): low and wide, the long hood, the roof's arc running far back to a short trunk, its
# black roof floating over the glass (the two-tone); laid onto it the Sentra's face: the big V-motion grille, wide at
# its top, in a black mesh between chrome strips down its flanks, the slim boomerang head lamps, the black C-shaped
# intakes at the corners; the slim boomerang tail lamps, the black diffuser. Real sizes (Nissan's data sheet): 4.641 m
# long, 1.815 m wide (no mirrors), 1.447 m high, a 2.712 m wheelbase, a 1.565 m track, 215/50 R17 tyres (0.65 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-sentra.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.3205, -2.3205, 0.80
TOP = [(NOSE, 0.59), (2.315, 0.625), (2.29, 0.655), (2.24, 0.68), (2.13, 0.71), (1.90, 0.75), (1.50, 0.81), (1.10, 0.865),
       (COWL, 0.905), (0.60, 1.03), (0.36, 1.19), (0.10, 1.34), (-0.10, 1.415), (-0.36, 1.447), (-0.66, 1.437),
       (-0.96, 1.38), (-1.16, 1.27), (-1.36, 1.15), (-1.54, 1.07), (-1.80, 1.05), (-2.08, 1.04), (-2.22, 1.035),
       (-2.28, 1.02), (-2.30, 0.97), (-2.312, 0.87), (-2.318, 0.75), (TAIL, 0.52)]
BOTTOM = [(NOSE, 0.34), (2.31, 0.29), (2.28, 0.25), (2.20, 0.21), (2.03, 0.18), (1.0, 0.15), (-1.8, 0.15), (-2.05, 0.19),
          (-2.22, 0.23), (-2.30, 0.27), (TAIL, 0.32)]
BELT = [(NOSE, 0.58), (2.31, 0.615), (2.24, 0.655), (2.04, 0.71), (1.6, 0.785), (1.2, 0.845), (COWL, 0.885), (0.3, 0.925),
        (-0.4, 0.95), (-1.0, 0.97), (-1.6, 0.99), (-2.1, 1.0), (-2.27, 0.985), (TAIL, 0.85)]

c = Shell('nissan-sentra', nose=NOSE, tail=TAIL, half=0.9075, nose_deep=0.55, tail_r=0.36, axles=(1.40, -1.312),
          tyre=(0.326, 0.215, 0.216), track=1.565, arch=0.365, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=-0.04, roof_end=-0.98, rear_end=-1.54, posts=[(-0.22, -0.14), (-1.06, -1.00)], quarter_run=0.30,
          shoulder=0.79, roof='trim', edges=[-2.28, -2.30])
c.seams(deck=True)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the big V-motion grille, wide at its top under the hood's edge and narrowing down, its black mesh; the
# chrome strips down its flanks from the lamps' inner ends; the slim lamps swept back, a lit boomerang in each; the
# black C-shaped intakes at the corners; the lip
front(car.panel('grille', [(-0.44, 0.60), (0.44, 0.60), (0.30, 0.33), (-0.30, 0.33)], AHEAD, 'gloss', 1, n=60, m=24), 0.003)
for k in range(7):
    z = 0.36 + k * 0.034
    hw = 0.30 + 0.14 * (z - 0.33) / 0.27 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.005, AHEAD, 'trim', 1), 0.0038)
for s in (1, -1):
    front(car.decal('chrome_v', [(s * 0.47, 0.61), (s * 0.45, 0.56), (s * 0.33, 0.34), (s * 0.22, 0.315)], 0.035, AHEAD, 'chrome', 1), 0.0042)
    slot = [(s * 0.46, 0.625), (s * 0.84, 0.655), (s * 0.88, 0.595), (s * 0.48, 0.585)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('lightbar', [(s * 0.50, 0.62), (s * 0.82, 0.648), (s * 0.86, 0.60)], 0.007, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.60, 0.608), (s * 0.74, 0.62)], 0.025, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('intake', [(s * 0.56, 0.52), (s * 0.82, 0.55), (s * 0.80, 0.33), (s * 0.58, 0.32)], AHEAD, 'gloss', 1, n=20), 0.002)
    front(car.decal('fog', [(s * 0.66, 0.36), (s * 0.78, 0.37)], 0.015, AHEAD, 'light', 1), 0.0035)
front(car.decal('lip', [(-0.80, 0.27), (0.80, 0.27)], 0.025, AHEAD, 'trim', 1))

# ---- the tail: the slim boomerang lamps round the corners and onto the lid; the lid's shut line; the black diffuser
TAILLAMP = 0.95
for s in (1, -1):
    cluster = [(s * 0.40, TAILLAMP + 0.035), (s * 0.90, TAILLAMP + 0.05), (s * 0.90, TAILLAMP - 0.06), (s * 0.70, TAILLAMP - 0.015)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.44, TAILLAMP + 0.018), (s * 0.86, TAILLAMP + 0.03), (s * 0.88, TAILLAMP - 0.035)], 0.010, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.64, 0.40), (s * 0.82, 0.40), (s * 0.82, 0.42), (s * 0.64, 0.42)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
lid = [(-0.40, TAILLAMP + 0.035), (-0.44, 0.71), (-0.41, 0.68), (0.41, 0.68), (0.44, 0.71), (0.40, TAILLAMP + 0.035)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('diffuser', [(-0.84, 0.42), (0.84, 0.42), (0.78, 0.33), (-0.78, 0.33)], BEHIND, 'trim', -1, n=80, m=6))

c.handles(chrome=True)
c.mirrors(cap='trim')
c.wiper()
c.cabin()
c.wheels(spokes=10)  # (17" alloys: ten spokes)
# (Monarch Orange, under its black roof)
c.finish(out, renders, blend, paint=dict(base=(0.55, 0.12, 0.02), rough=0.15, metal=0.5, coat=1.0))
