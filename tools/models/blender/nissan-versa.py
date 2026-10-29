# tools/models/blender/nissan-versa.py
# The Nissan Versa sedan (the third one, N18, 2020 on, built in Aguascalientes), modelled by script on the shell the
# everyday cars share (shell.py): a compact sedan, the roof's arc running down to a short trunk; laid onto it Nissan's
# face of these years: the V-motion grille, a black mesh shield between thick chrome strips running down its flanks,
# the boomerang head lamps swept back from its top corners, the black lower grille and the fog lamps' slots at the
# corners; the boomerang tail lamps reaching into the trunk lid. Real sizes (Nissan's data sheet): 4.495 m long, 1.740
# m wide (no mirrors), 1.465 m high, a 2.620 m wheelbase, a 1.530 m track, 195/65 R15 tyres (0.63 m across).
#   blender -b --factory-startup -P tools/models/blender/nissan-versa.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.2475, -2.2475, 0.82
TOP = [(NOSE, 0.61), (2.24, 0.645), (2.21, 0.675), (2.15, 0.70), (2.0, 0.73), (1.70, 0.78), (1.30, 0.84), (1.0, 0.88),
       (COWL, 0.905), (0.62, 1.03), (0.40, 1.19), (0.15, 1.36), (-0.02, 1.43), (-0.28, 1.465), (-0.58, 1.455),
       (-0.90, 1.40), (-1.08, 1.30), (-1.28, 1.17), (-1.47, 1.085), (-1.70, 1.065), (-1.98, 1.055), (-2.14, 1.05),
       (-2.20, 1.035), (-2.22, 0.99), (-2.235, 0.89), (-2.242, 0.77), (TAIL, 0.54)]
BOTTOM = [(NOSE, 0.35), (2.235, 0.30), (2.20, 0.26), (2.12, 0.22), (1.95, 0.19), (1.0, 0.16), (-1.7, 0.16), (-1.95, 0.20),
          (-2.14, 0.24), (-2.22, 0.28), (TAIL, 0.33)]
BELT = [(NOSE, 0.60), (2.235, 0.635), (2.15, 0.675), (1.9, 0.73), (1.5, 0.795), (1.1, 0.85), (COWL, 0.885), (0.3, 0.925),
        (-0.4, 0.95), (-1.0, 0.97), (-1.5, 0.99), (-2.0, 1.0), (-2.19, 0.985), (TAIL, 0.85)]

c = Shell('nissan-versa', nose=NOSE, tail=TAIL, half=0.87, nose_deep=0.50, tail_r=0.32, axles=(1.37, -1.25),
          tyre=(0.317, 0.195, 0.19), track=1.53, arch=0.355, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=-0.02, roof_end=-0.95, rear_end=-1.47, posts=[(-0.20, -0.12), (-1.00, -0.94)], quarter_run=0.28,
          shoulder=0.80, roof_half=0.55, edges=[-2.20, -2.22])
c.seams(deck=True)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.02

# ---- the face: the V-motion grille, a shield narrowing down, its black mesh; the chrome strips down its flanks from the
# lamps' inner ends, turning in under it; the boomerang lamps, a lit line along each one's top and down round its outer
# end; the black lower grille across the bumper, the fog lamps' slots at its ends
front(car.panel('grille', [(-0.38, 0.665), (0.38, 0.665), (0.28, 0.42), (-0.28, 0.42)], AHEAD, 'gloss', 1, n=50, m=24), 0.003)
for k in range(6):
    z = 0.45 + k * 0.036
    hw = 0.28 + 0.10 * (z - 0.42) / 0.245 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.005, AHEAD, 'trim', 1), 0.0038)
for s in (1, -1):
    front(car.decal('chrome_v', [(s * 0.42, 0.672), (s * 0.40, 0.62), (s * 0.31, 0.43), (s * 0.20, 0.405)], 0.035, AHEAD, 'chrome', 1), 0.0042)
    slot = [(s * 0.42, 0.685), (s * 0.82, 0.725), (s * 0.86, 0.645), (s * 0.44, 0.625)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=40, m=8), 0.0025)
    front(car.decal('lightbar', [(s * 0.46, 0.68), (s * 0.80, 0.715), (s * 0.84, 0.66)], 0.008, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.56, 0.665), (s * 0.70, 0.68)], 0.035, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('fog', [(s * 0.58, 0.44), (s * 0.78, 0.46), (s * 0.78, 0.40), (s * 0.60, 0.39)], AHEAD, 'gloss', 1, n=16), 0.002)
    front(car.decal('fog', [(s * 0.62, 0.42), (s * 0.74, 0.43)], 0.018, AHEAD, 'light', 1), 0.0035)
front(car.panel('lower_grille', [(-0.50, 0.38), (0.50, 0.38), (0.46, 0.31), (-0.46, 0.31)], AHEAD, 'gloss', 1, n=50, m=4))

# ---- the tail: the boomerang lamps round the trunk's corners, a lit line in each; the lid's shut line and its chrome
# bar; the black strip under the bumper
TAILLAMP = 0.93
for s in (1, -1):
    cluster = [(s * 0.46, TAILLAMP + 0.05), (s * 0.86, TAILLAMP + 0.06), (s * 0.86, TAILLAMP - 0.07), (s * 0.66, TAILLAMP - 0.02)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=40), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.50, TAILLAMP + 0.025), (s * 0.82, TAILLAMP + 0.035), (s * 0.84, TAILLAMP - 0.04)], 0.012, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reflector', [(s * 0.60, 0.42), (s * 0.76, 0.42), (s * 0.76, 0.44), (s * 0.60, 0.44)], BEHIND, 'lamp', -1, n=6, m=2), 0.004)
lid = [(-0.46, TAILLAMP + 0.05), (-0.46, 0.70), (-0.43, 0.67), (0.43, 0.67), (0.46, 0.70), (0.46, TAILLAMP + 0.05)]
rear(car.decal('seam', lid, 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('chrome_bar', [(-0.44, TAILLAMP + 0.015), (0.44, TAILLAMP + 0.015)], 0.014, BEHIND, 'chrome', -1), 0.0025)
rear(car.panel('diffuser', [(-0.78, 0.40), (0.78, 0.40), (0.72, 0.34), (-0.72, 0.34)], BEHIND, 'trim', -1, n=70, m=6))

c.handles(chrome=True)
c.mirrors()
c.wiper()
c.cabin()
c.wheels(spokes=8)  # (16" alloys: eight spokes)
# (Azul Cobalto)
c.finish(out, renders, blend, paint=dict(base=(0.03, 0.08, 0.24), rough=0.18, metal=0.6, coat=1.0))
