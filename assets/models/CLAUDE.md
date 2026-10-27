# Making 3D assets for the game

How the Catedral's model (`catedral.glb`) was made, and the traps it fell into on the way. Follow it for any
model from a photograph or a prompt: a landmark, a prop, a car or a person. The human-facing guide is
[README.md](README.md); this file is the working method.

## The rule that matters most

An image-to-3D model is only good on the side the image shows. Meshy invents everything else (backs, sides,
roofs), and it brings along whatever stood next to the subject. So:

- Use the model only for the side that was photographed. Cut the rest off and draw it in code, as
  `tepic-landmarks.ts` does with the Catedral's nave, dome and apse.
- People judge a landmark by the whole block, from street level: its neighbours, its atrium, the street in
  front of it. A perfect front on an empty lot still looks wrong. Draw the neighbours too: the casona, the
  portales.
- Look at Meshy's four `preview_*.png` renders before you prepare a model. Expect the front to come out well and
  the back to be made up.

## 1. The image

- **A photograph**: from Wikimedia Commons, with a free licence. Find candidates through the API
  (`commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&prop=imageinfo&iiprop=size|extmetadata`).
  Look at them before you pick one. A good photo is taken in daylight, shows the whole subject with nothing in
  front of it (trees, people, columns, fountains), and has neighbours you can crop off. Download a ~2048 px
  thumbnail (`Special:FilePath/<name>?width=…`), never the full original. Ask the user before downloading.
- **Never** use Google Maps, Street View or Google's 3D tiles as an input: their licence forbids copying them.
  Street View screenshots the user sends are reference only, for proportions, colours and what stands where.
- **A prompt** (props, generic cars, people): `tools/models/meshy.mjs` draws the image first with Nano Banana.
  Ask for a plain white background with `remove_background: true`. Ask for no logos, badges or plates. Use a
  three-quarter view for objects, and `pose_mode: "a-pose"` with the whole body in frame for people. See
  `tools/models/jobs/`.
- **Credits**: every source goes into the credits in `README.md` and `assets/models/README.md`. Under CC BY-SA
  the `.glb` is shared under the same licence.

## 2. Meshy

- **The key** lives in `~/.config/meshy/env` (`MESHY_API_KEY=msy_…`). Never put it in the repository; `.env` is
  gitignored for the same reason. If it's missing, have the user write it with a hidden `read -rs` in their
  Terminal app (not `!` in the chat, which can't read input).
- **The MCP server** `meshy` (`@meshy-ai/meshy-mcp-server`) is registered in `~/.claude.json`, started through
  `~/.config/meshy/run-mcp.sh`, which reads the key file. It is there in new sessions. Without it, use
  `node tools/models/meshy.mjs <job.json> <out-dir>`, and `--balance` to check the credits.
- **Credits** (Oct 2026): a textured model costs 30 with `meshy-7.1`, or 15 with `meshy-t2.5` smart topology. An
  image costs 3. Say what a job will cost before running it.
- **Settings**:
  - A building: `ai_model: "meshy-7.1"`, `should_remesh: true`, `target_polycount: 60000`,
    `texture_resolution: "2k"`, `enable_pbr: false`. The Catedral used these (`jobs/catedral.json`).
  - A prop, car or person: `model_type: "smart-topology"`, `ai_model: "meshy-t2.5"`, 5–15k faces.
- Leave `texture_prompt` out when the image should give the colours: it overrides the image.

## 3. Preparing it

Install the tools once with `(cd tools/models && npm install)`, then:

```bash
node tools/models/prepare.mjs model.glb assets/models/<name>.glb --height <m> [--cut <m>] [--ratio 0.6]
```

The script:

- crops to the front's width, which drops the neighbours;
- cuts everything more than `--cut` m behind the front;
- scales to `--height`, the real height to the top. Look it up and say where the figure comes from;
- puts the origin at the foot of the front's middle, with the front on z = 0 facing +z and the building towards
  -z;
- simplifies, sets metalness to 0, and makes the texture a JPEG of at most 2048 px.

Use `--keep-width` for props that stand alone.

- **Where to cut**: print the model's z-range per height band (each 3–5 m of height). Cut where the real part
  ends. The Catedral's towers end 8.5 m behind the facade, so it was cut at 9.5 m.
- **Budget**: 20–60k triangles for a building, under 5 MB, one 2048 px texture.
- **No quantization, Draco or meshopt compression.** Three.js's WebGPU backend has no 3-wide 16-bit vertex
  format: quantized positions came out NaN and the model never drew. No decoder is wired into the loader for
  the other two.

## 4. Putting it in the game

- **Simple landmarks** go in `LANDMARK_MODELS` (`js/world/landmark-models.ts`). A model with drawn parts gets
  its own builder, like `CATEDRAL_MODEL` and `PLAN` in `js/world/tepic-landmarks.ts`. Keep the drawn version
  until the file loads, so the place is never empty if it fails.
- **OpenStreetMap outlines** take in annexes (the Catedral's includes the casona). Don't centre on the outline's
  box. Find the real front: the outline's edge furthest towards the street or plaza. Then measure the plan in
  the building's own frame.
- **Streets are not square to buildings.** Check the curb island the building stands on
  (`blockAt(x, z).poly`, from `js/world/city-config.ts`). Keep every front at least the sidewalk's width
  (`GEO.frame.sidewalk`, 2.2 m) behind it. `frontRuns()` lays buildings along a curb that turns, and the church
  stands back (`setback`) when its OpenStreetMap front crosses the curb.
- **Generic houses**: `LANDMARK_RESERVES` keeps them off. A house is dropped if its centre is inside a reserve,
  and so is any house part that reaches more than ~1.2 m into one (`world/buildings/houses.ts`). Make each reserve the exact
  footprint, not a big box: a box also deletes the real neighbours.
- **Late-loading models**: the landmarks' world matrices are frozen once the city is built
  (`freezeStaticMatrices`, `render/scene-culling.ts`). Call `model.updateMatrixWorld(true)` after adding the
  model, or it draws at the origin, under the ground.
- **Uploaded geometry**: after the first frames, the renderer releases the CPU copies of static geometry
  (`scene-culling.ts`). Calling `computeBoundingBox()` on such a mesh then gives NaN bounds, and the mesh is
  culled for good. Don't, not even while debugging.
- **Merging**: when you merge drawn pieces, clone non-indexed geometries before `applyMatrix4`. A geometry
  shared by several pieces, such as a balustrade panel or an arch band, is otherwise transformed once per piece.
- **Dynamic imports**: write `const loading = import('…')`. A line that starts with `import(` breaks
  `tests/helpers/module.cjs`.

## 5. Checking it

- **Look at it in the game** from street level and from above: the front, the sides, the back, the neighbours.
  Compare with the user's photos.
- **When the Browser pane is hidden**, use the no-cache server and the helpers in `.claude/`: drive frames by
  hand and POST captures to `/__shot`.
- **When the pane is shown**, the game's own loop overrides the camera. Pause it with
  `renderer.setAnimationLoop(null)`, and step the loop with times later than `performance.now()`: earlier times
  render nothing. `toDataURL` can still return a stale frame there, so trust numbers more than pictures:
  - **Triangles**: sum them for the landmark's group and compare with the scene's (~18M visible). The whole
    Catedral block is ~60k.
  - **Overlaps**: test the generic houses' colliders (`__slop.cityBlocks.colliders`, their `obb`) against
    `LANDMARK_RESERVES`, sampled 0.8 m inside each house. Expect none.
  - **The street**: `tests/catedral.test.cjs` checks that every corner is on the block and every front is
    behind the sidewalk. Write the same kind of test for a new landmark.
- **fps**: check the HUD's fps, and run `node --test tests/*.test.*`.

## Cars and people

- **Only the cars modelled in Blender are files** (2026-10-27): `cars/tesla-cybertruck.glb`, `cars/tesla-model-y.glb` and the Tsuru's two
  (`nissan-tsuru.glb`, the taxi with its roof sign, and `nissan-tsuru-particular.glb`), modelled by script (`tools/models/blender/`, below). Every other car is drawn with its procedural body shape (`js/actors/actor-models.ts`,
  `models/bodies.ts`). The ten Meshy cars and the four from Sketchfab below were taken out, files and jobs: they
  looked worse than the body shapes, and the heavy ones cost the game too much (the Onix 111k triangles, 13 MB). What
  was learnt making them stays here; their files and jobs are in git's history (before 2026-10-27).
- **Cars from Meshy (removed).** The ten best sellers (Versa, Aveo, March, NP300, Vento, Gol, Kicks, Onix, Yaris, Rio)
  were Meshy models in `assets/models/cars/`. Nine were drawn white from one prompt each (`tools/models/jobs/cars/`, 18
  credits, Meshy T2.5 smart topology, ~8k triangles). The Versa is the pilot of the better way: four views drawn in a
  key colour, magenta, and one multi-image-to-3d with Meshy 7.1 at its best (Ultra geometry, 4K texture, PBR: 71
  credits, its job says how; the standard 2K one was visibly lumpier, and its rims plainer). Each was prepared with
  `prepare.mjs --length <its real length> --yaw 90 --wheel <tyre radius>` (the nine: `--ratio 1 --texture 1024`; the
  Versa: `--ratio 0.6 --texture 2048`, ~67k triangles, 4.3 MB). Meshy's front view has every car's nose at -x, and the game's cars face +z.
  - **Data**: a car model's `glb` field (`js/models/cars/`) names its file.
  - **Loading**: `actors/vehicles/car-files.ts` loads every file once, in the background, for the traffic and the
    player's car alike: a car taken from the traffic is the model it was. Until a file loads (or if it fails) the
    body shape draws it.
  - **Traffic**: near the camera (`CAR_PROXY_DISTANCE`, 90 m) such a car is its own instanced mesh at scale 1
    (`sim/traffic/meshes.ts`, `render.ts`); beyond, its body shape's ~250-triangle stand-in.
  - **Levels of detail**: a heavy car (20k triangles or more) carries two lighter levels in its file,
    `tools/models/add-lods.mjs` (`lod1`, ~30%; `lod2`, ~10%, its corners joined by place so the colour seams don't
    stop the simplifier, each triangle one colour; and their wheels). The traffic draws the file's own to 25 m, `lod1`
    to 50 m and `lod2` to 90 m (`MODEL_LOD_DISTANCES`); the player's car
    is always the full one. Run it again after preparing a car again: it replaces the levels. Up close the levels look
    rough, as they should.
  - **Wheels**: `prepare.mjs` copies the front wheel on the +x side out as a mesh of its own, `wheel`, its axle on the
    origin. Then it presses all four into a flat dark wall just inside the tyres, the wheel well, so the body stays
    closed. Where the wheels go is in the body mesh's extras: `{ wheels: { x, z: [front, rear], radius } }`. The
    game draws that wheel at the four corners, mirrored on the -x side, and turns and steers it.
  - **Paint mask**: `prepare.mjs` bakes one into each car's metallic-roughness texture (R: the mask, G: the
    roughness). `createModelCarMaterial` (`actors/vehicles/car-material.ts`) paints the instance's colour through it,
    following the texture's brightness, and lights the red lamps at the back with the brake.
    - A car drawn in **magenta** is masked by its hue. Meshy's atlas is hundreds of small islands packed edge to
      edge, and each island's rim takes in its neighbours' colours. Repainted, that showed as white and black lines
      all over the paint, worse with distance (the mipmaps). So the car is unwrapped again with xatlas
      (`xatlasjs`), into charts with gutters, and its texture is baked into the new atlas. A triangle that is a third
      or more magenta is paint all over; one with a little magenta has its pale texels painted too (the seams Meshy
      left pale). The glass and the black trim get a low roughness for the sky's reflections, and what is bright grey
      and not paint (the rims, the lamps' chrome) metal, in the mask's B.
    - Its painted sheet metal is smoothed (Taubin, 5 rounds, `smoothPaint`): Meshy's surfaces are lumpy, and the
      clear coat (`createModelCarMaterial`) mirrors every lump. More rounds round off the body's character lines.
    - The colour is read from Meshy's 4K texture and baked at `--texture`: Meshy's own normal and metal-roughness
      maps are dropped (their atlas is the one replaced).
    - A car drawn **white** is masked by its white areas, grown 3 px over edges and seams. That still leaves pale
      lines: remake such a car in magenta.
  - **Tried and dropped**: a Blender pass (sorting faces into paint, glass, trim, chrome and lamps from the texture,
    Laplacian smoothing, decimation, normals by angle) came out worse: faceted panels, a zigzag edge along the
    windscreen, stray specks. The parts' borders are only as good as Meshy's texture.
  - **Mistakes not to repeat**: a plain "paint where it's white" threshold left pale stripes along every edge and
    seam, and it painted the silver rims too. `--wheel` must be the real tyre radius, from the tyre size, or the
    wells take the fenders. Judge a car in the game, under its sky light: a viewer without an environment map makes
    every car look flat and dull.
  - **Not done yet**: the files' cars don't crumple, and the player's shows no blood. The nine white ones still
    have pale lines in the paint.
  - **Adding one**: a job, the preparation, the `glb` field. Check that the nose faces +z, that the wheels sit in
    their arches and that the paint takes (a page that draws one prepared car in six colours, with its wheels where
    its extras say, is quick to write: GLTFLoader plus an `onBeforeCompile` doing the material's mix).
- **Cars made by hand beat the AI ones.** A free model from Sketchfab, made by a person, comes in parts with a
  material each (body, glass, tyres, rims, chrome, lamps) and clean lines. Four were in: the private Tsuru
  (`nissan-tsuru-particular`), the Onix, the NP300 (a Navara 2021) and the Virtus (`volkswagen-virtus`, the Vento's
  successor). `tools/models/prepare-made.mjs` makes such a model the same kind of file as the Meshy ones: each part's
  material a cell of a small palette texture (its colour, roughness, metal and paint mask; a textured part its
  texture's mean colour), the paint exactly the body's faces, the glass opaque and dark, the normals smoothed under
  40°, the front +x wheel apart. Each car's command, source and author are in `tools/models/jobs/cars/<id>.made.json`,
  and its parts' roles in `<id>.roles.json` (now only the Blender cars', which go through the same tool; the four
  Sketchfab cars were removed with the Meshy ones).
  - **Writing a car's roles**: run it with `--report` first, each part's box in metres. The interior goes (`drop`):
    the glass is opaque. Lamp lenses over their reflectors go too. A second shell under the paint (the Onix's) is a
    `backing`, pushed 4 mm in, or it fights the paint.
  - **Wheels** are found by shape: the parts named as wheels, or else what touches the ground (with `--wheel`, the
    tyres' radius), set four axles; whatever else lies inside a wheel's cylinder is wheel too, the tyre beyond 68% of
    the radius, the rim within. Only what lies on its wheel's side counts, named or not: a model's tyre material
    may hold a spare wheel, or an axle across the car (the NP300's made its wheel 1.8 m wide, stuck out both sides).
    A tyre whose outer face stands out of the fender over its axle is drawn that much further in (the NP300's, 7 cm).
  - **Double-sided models** are often wound any which way, and the game draws one side: a material with a third of
    its faces turned in has them turned out (away from the car's middle). Holes in the paint mean this.
  - **Interior by place**: when a model's material names don't say what is interior (the Virtus's are scrambled:
    "seatbelt_holder_part" covers the whole car), `--cabin` drops what lies inside the glass's box instead. Dropping
    by name took its front bumper's grille and plate with it.
  - **Lamps**: lenses drawn in the windows' material show black (the glass is opaque): `--lenses` drops the glass at
    the car's ends below its windows. A material shared by head and tail lamps is `lamps`: white in front, red behind
    (red lights with the brake).
  - **Plates**: `--plates yFront,yRear` adds a Nayarit plate (30.5 × 15.2 cm, its number from the file's name) on
    each bumper at those heights, in front of whatever the rays meet across its width. Find the heights with
    `--probe x,y,z`; drop the model's own plates.
  - **Heavy models**: `--faces` simplifies before anything else (so the normals fit the simplified faces), `--error`
    lets it go further. The nose is the head lamps' end; `--flip` when the lamps aren't named.
  - **Rejected, and why**: two Merc_TV models (Aveo, March) had no wheels, only one tyre at the origin; a Polo sedan
    had none either; a Gol came from the uploader of a re-uploaded paid Tsuru.
  - **Licences**: only CC BY (or CC0); credit it in `README.md` and `assets/models/README.md`. Not "NonCommercial",
    not Sketchfab's "Free Standard" (no redistribution in a public repository), and not re-uploads of paid models
    (a Hum3D plate on a "free" car gives one away).
  - **Downloading** needs a Sketchfab login (the user's, in their browser): the API's download is 401 without one.
- **People**: pedestrians are one instanced, GPU-skinned crowd on a 15-bone skeleton (`sim/pedestrians.ts`), with
  outfits from a per-person seed. A crowd can be drawn as a person model instead (`PersonCrowd`'s `model`, loaded by
  `actors/person-files.ts`): each model is one fixed look, and the morphs (build, female proportions, hair) are lost.
  The player was the first (`people/player.glb`, `tools/models/jobs/people/player.json`); the others in multiplayer
  still see it so. The player itself is now that model as Meshy rigged and animated it (below: **Rigged by Meshy**).
  - **Drawing it**: Nano Banana Pro in A-pose, a front view (text-to-image) and a back view (image-to-image with that
    task as the reference), then Meshy 7.1 multi-image-to-3d on the two (Ultra geometry, 4K texture: 35 credits).
    **No side profile**: an arm held out to the side hangs straight down in profile, and Meshy made one arm reach
    forward and the other back. Check the arms in a point splat (front and side) before preparing it.
  - **Preparing it**: `node tools/models/prepare-person.mjs model.glb assets/models/people/<name>.glb [--debug bones.png]`
    scales it to 1.75 m, finds its joints from its shape (the crotch and the armpits where its legs and arms stop
    reaching each other over the mesh's edges; the shoulder 5 cm under the shoulder's top on the arm's line, which runs
    from the fingertips through the forearm; the elbow and wrist at the game's proportions; the hips at the game's
    0.92 m, since jeans hang their crotch low; the chin where the neck's profile steps out), weights each vertex by the
    drawn body's rules along its limb, blurs the weights over the mesh's edges, and turns the limbs into the game's
    bind pose. `--debug` draws the bones each vertex follows, before and after.
  - **Traps**: a chin below the drawn body's 1.52 m left the jaw with the chest, and the mouth stretched open at every
    turn of the head (hence the chin rule). Stretching the legs to the game's lengths from a crotch-based hip squashed
    the hips by 10 cm. Meshy brightens the colours: its heather-grey t-shirt reads almost white in the midday sun. The
    far level is simplified with its corners joined by place: Meshy's atlas seams stopped the simplifier at ~12k
    triangles. The skeleton and its weights are `js/sim/person-skeleton.ts`, shared with the drawn body: prepare the
    models again if they change.
  - **Loading**: the loading screen waits (8 s at most) for the player's body before the shaders compile, so its
    pipelines are built with the rest. Remote players (`net/multiplayer.ts`) are drawn as `people/player.glb`.
  - **Rigged by Meshy** (`people/player-rigged.glb`, `actors/person-body.ts`): the crowd's procedural walk on a
    scanned body looked like a puppet, so the player is Meshy's own rig (`meshy_rig` on the multi-image task, 5
    credits: 24 bones, Hips to the toes, its walk and run free) moved by clips from its library (`meshy_animate`, 3
    credits each; take the `_inplace` ones: the game moves the body). `node tools/models/prepare-rigged-person.mjs
    rigged.glb assets/models/people/<name>.glb walk=walking.glb run=running.glb idle=idle.glb:<clip>...` makes one
    file of the body (simplified to 30k triangles, a 2K JPEG) and the clips by the names the game plays them for.
    One SkinnedMesh with an AnimationMixer: the clips blend by speed, kept in step with the ground (the strides in
    `person-body.ts`, measured on the clips), and the jump plays only its flight. What no clip does comes from the
    crowd's rig, its bones' turns copied over by name (`follow`): the arms raised to aim or punch (over the clips),
    riding a bike or a moto, the ragdoll. Look at a library clip's GIF before buying it: Meshy's "Idle" fidgets and
    turns round; "Idle 3" (243) stands still.
    **Trap**: never `skeleton.pose()` on a Meshy rig: the hips' parent is the Armature (scale 0.01), not a bone, so
    pose() gives the hips the armature's scale again and the body shrinks to a dot (only its shadow shows).
- **Cars modelled by script in Blender** (`tools/models/blender/<id>.py`, on `carlib.py`): when no good model exists,
  write one. The Cybertruck is the first: a body lofted through cross-sections (straight lines between a few
  stations, as its flat panels are), its windows inset panes with black frames, wheel arches cut, edges bevelled,
  shut lines and slats as dark strips, lamps as bars on the steel, wheels with lugged tyres and petalled covers; each
  part's material named for its role (paint, glass, trim, light, lamp, amber, tyre, aero...), which
  `prepare-made.mjs` reads (`<id>.roles.json` maps the rest). `blender -b --factory-startup -P <script> -- <out.glb>
  [<render dir>]` exports it and, with a folder, renders it in Cycles (`carlib.hero`) to judge it against photographs
  from the same camera (a view's lens and target can be set).
  - **Traps**: stations must run nose to tail (one out of order folds the body through itself: the script sorts
    them). Cut every wheel well in one boolean (cut one at a time, the exact solver once read the body as inside
    out and added the next cutter to it). Don't cut shut lines into the steel: a groove's edges shade as bright
    streaks and a cut too many broke the body; dark strips on it read the same. Merge the points that fall together
    before insetting windows (a zero-length edge bent a window's frame). Folds too shallow to bevel (the sill) are
    marked sharp, or the smoothing bends the panels' shading into smears. A window's frame wider than its glass
    folds into spikes: stop the glass where it is still taller than its frame.
  - **Judging it**: the photographs' light matters as much as the shape: a bright hazy sky, a grey horizon, dark
    asphalt (`carlib.hero`); a flat grey sky made the steel read as white plastic. Compare crops of the same parts.
    `VIEWS=front,side SAMPLES=40` renders just those views, quickly, to iterate on.
  - **A rounded car** (the Model Y): its sections are many points round, the stations close where it curves fast
    (8 mm at the nose's and the tail's tips, 2 cm over the arches). The bumper's face is the sections' sides, upright,
    the nose's plan a superellipse (broad and nearly flat across, tight corners, as photographs from straight ahead
    show; a round bow and a nose where the top and bottom profiles met in a point both looked wrong, a flat shelf or
    a pinched snout), the sides' tucks and the fenders' shelf faded out there (else they fold across the face as a
    wave or a V). The end caps are inset in rings (`loft(cap_rings=...)`, after the duplicate points are merged):
    one broad n-gon shaded as a lighter patch, and a cap closed to a sliver made a keel down the nose. The hood
    sinks between the fenders' crests (`fender_rise`), which from ahead rise at its corners with the light bar's
    ends; the side windows' top is a point of its own on the section, so the quarter window can close in a point
    under the C pillar. Judge the front from straight ahead and close up (`face`, `lamp` views) against a photograph
    from ahead: the 3/4 view hid all of this.
  - **An old boxy car** (the Tsuru): the same tools, but its faces are steps of the top profile (the lamps' face
    under the hood's edge, the tail's panel), its corners in plan a softer superellipse, and its bumpers rounded in
    profile too, so the end caps are slivers (cap rings on a cap thinner than them tore it). Squared off, it read as
    a box: the real one is soft everywhere. Lamps are filled shapes (a chrome reflector, a lens, a round lamp's bowl,
    `carlib.disc`), never outlines: drawn rings and lines read as a child's drawing. One script, two files: `--taxi`
    adds the roof sign; the player's taxi draws its file too (car-looks.ts), its door badges hidden. No bevel on the body: the arches' rounded edges bent the
    paint's normals into dark streaks up the fenders, and weighted normals (`tidy(..., weighted=False)`) smeared a
    body curved all over. Lamps, slots, intakes and bumpers are drawn flat in a plane before the car (`decal`,
    `panel`) and laid onto the skin (`onto`: a shrinkwrap, projected along y, or to the nearest point round a corner,
    where a ray from behind would miss and leave the decal hanging in the air).
