# tools/models/blender/toyota-hilux.py
# The Toyota Hilux double cab (the eighth one, AN120, the 2021 facelift), modelled by script on the shell the everyday
# cars share (shell.py): the high flat hood, the four-door cab, its back glass upright, the bed cut out behind it with
# a black liner, the black flares round the arches; laid onto it the Hilux's face: the big trapezoid grille in its
# black honeycomb and chrome frame, the slim head lamps at its top corners, the fog lamps low in the bumper; the tall
# tail lamps at the bed's corners, the tailgate, the chrome step bumper. Real sizes (Toyota's data sheet): 5.325 m
# long, 1.855 m wide (no mirrors), 1.815 m high, a 3.085 m wheelbase, a 1.540 m track, 265/65 R17 tyres (0.77 m across).
#   blender -b --factory-startup -P tools/models/blender/toyota-hilux.py -- <out.glb> [<render dir> [<out.blend>]]
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
import carlib as car  # noqa: E402
from shell import Shell  # noqa: E402

out, renders, blend = car.args()
car.reset()

NOSE, TAIL, COWL = 2.6625, -2.6625, 1.05
CAB = -0.86  # (the cab's back, where the bed begins)
# the centreline's top: the nose up to the hood's edge, the hood, the windshield, the roof, the cab's back glass down to
# the bed's rails, the rails to the tailgate
TOP = [(NOSE, 0.98), (2.65, 1.03), (2.62, 1.07), (2.55, 1.10), (2.35, 1.13), (2.0, 1.165), (1.50, 1.21), (COWL, 1.245),
       (0.85, 1.37), (0.60, 1.55), (0.35, 1.72), (0.20, 1.79), (0.0, 1.815), (-0.55, 1.81), (-0.78, 1.795), (-0.81, 1.74),
       (-0.84, 1.42), (CAB, 1.30), (-0.92, 1.275), (-2.60, 1.27), (-2.64, 1.265), (-2.655, 1.24), (TAIL, 1.20)]
BOTTOM = [(NOSE, 0.48), (2.64, 0.43), (2.55, 0.38), (2.40, 0.34), (2.2, 0.31), (1.2, 0.29), (-0.84, 0.29), (-0.96, 0.56),
          (-2.40, 0.56), (-2.55, 0.52), (TAIL, 0.50)]
BELT = [(NOSE, 0.96), (2.64, 1.02), (2.45, 1.08), (2.0, 1.14), (1.5, 1.19), (COWL, 1.225), (0.5, 1.24), (-0.3, 1.25),
        (CAB, 1.26), (-0.92, 1.265), (-2.60, 1.265), (TAIL, 1.20)]

c = Shell('toyota-hilux', nose=NOSE, tail=TAIL, half=0.9275, nose_deep=0.40, tail_r=0.10, axles=(1.73, -1.355),
          tyre=(0.387, 0.265, 0.216), track=1.54, arch=0.45, top=TOP, bottom=BOTTOM, belt=BELT, cowl=COWL,
          header=0.18, roof_end=-0.80, rear_end=-0.85, posts=[(-0.06, 0.02), (-0.78, -0.72)], quarter=False,
          quarter_run=0.05, shoulder=1.06, shelf=0.05, crown=0.03, roof_half=0.68, fender=(0.02, None), waist=0.0,
          bed=(-0.92, -2.60, 0.88), edges=[-0.81, -0.84, -0.96, -2.64, -2.655])
c.arch_mouldings(0.08)
c.seams(cab_back=-0.89)
front, rear, AHEAD, BEHIND = c.front, c.rear, c.AHEAD, c.BEHIND
AT_TAIL = TAIL + 0.01

# ---- the face: the big trapezoid grille, wider at its top, its honeycomb behind thick black bars, a chrome frame; the
# slim head lamps out from its top corners, a lit line along each; the black lower bumper, the fog lamps in its corners,
# the silver skid plate
front(car.panel('grille', [(-0.52, 1.12), (0.52, 1.12), (0.42, 0.68), (-0.42, 0.68)], AHEAD, 'gloss', 1, n=60, m=24), 0.003)
for k in range(5):
    z = 0.74 + k * 0.08
    hw = 0.42 + 0.10 * (z - 0.68) / 0.44 - 0.03
    front(car.decal('grille_bar', [(-hw, z), (hw, z)], 0.03, AHEAD, 'trim', 1), 0.0038)
frame = [(-0.53, 1.125), (0.53, 1.125), (0.43, 0.675), (-0.43, 0.675), (-0.53, 1.125)]
front(car.decal('chrome_frame', frame, 0.03, AHEAD, 'chrome', 1), 0.0042)
for s in (1, -1):
    slot = [(s * 0.55, 1.135), (s * 0.88, 1.12), (s * 0.91, 1.03), (s * 0.55, 1.04)]
    front(car.panel('headlamp_slot', slot, AHEAD, 'gloss', 1, n=30), 0.002)
    front(car.decal('lightbar', [(s * 0.57, 1.05), (s * 0.88, 1.04)], 0.008, AHEAD, 'light', 1), 0.0035)
    front(car.decal('headlamp', [(s * 0.62, 1.09), (s * 0.82, 1.09)], 0.05, AHEAD, 'headlamp', 1), 0.003)
    front(car.panel('fog', [(s * 0.62, 0.60), (s * 0.82, 0.62), (s * 0.82, 0.56), (s * 0.64, 0.55)], AHEAD, 'gloss', 1, n=12), 0.002)
    front(car.decal('fog', [(s * 0.66, 0.585), (s * 0.79, 0.595)], 0.02, AHEAD, 'light', 1), 0.0035)
front(car.panel('bumper', [(-0.86, 0.66), (0.86, 0.66), (0.82, 0.52), (-0.82, 0.52)], AHEAD, 'trim', 1, n=80, m=6), 0.0015)
front(car.decal('skid', [(-0.38, 0.55), (0.38, 0.55)], 0.04, AHEAD, 'chrome', 1), 0.0028)

# ---- the tail: the tall lamps at the bed's corners, wrapping round them; the tailgate's shut lines and its handle;
# the chrome step bumper under it
for s in (1, -1):
    cluster = [(s * 0.80, 1.22), (s * 0.93, 1.22), (s * 0.93, 0.92), (s * 0.80, 0.92)]
    rear(car.panel('lamp', cluster, AT_TAIL, 'lamp', -1, n=12, m=20), 0.003, wrap=True)
    rear(car.decal('lampbright', [(s * 0.86, 1.19), (s * 0.86, 1.05)], 0.03, AT_TAIL, 'lampbright', -1), 0.0045, wrap=True)
    rear(car.panel('reverse', [(s * 0.82, 1.02), (s * 0.90, 1.02), (s * 0.90, 0.96), (s * 0.82, 0.96)], AT_TAIL, 'white', -1, n=6, m=4), 0.0045, wrap=True)
    rear(car.decal('seam', [(s * 0.78, 1.25), (s * 0.78, 0.66)], 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.decal('seam', [(-0.78, 0.66), (0.78, 0.66)], 0.004, BEHIND, 'trim', -1), 0.0015)
rear(car.panel('handle', [(-0.10, 1.17), (0.10, 1.17), (0.10, 1.13), (-0.10, 1.13)], BEHIND, 'trim', -1, n=8, m=2), 0.003)
car.box('chrome_bumper', (0, TAIL - 0.04, 0.575), (1.84, 0.14, 0.13), 'chrome', bevel=0.015)

c.handles(drop=0.13, chrome=True)
c.mirrors(scale=1.25, cap='chrome')
c.wiper()
c.cabin()
c.wheels(spokes=6, tread=0.013)  # (17" alloys: six spokes, all-terrain tyres)
# (Super White, the Hilux's)
c.finish(out, renders, blend, paint=dict(base=(0.80, 0.80, 0.78), rough=0.2, metal=0.0, coat=1.0))
