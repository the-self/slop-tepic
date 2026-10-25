# Making 3D assets for the game

How the Catedral's model (`catedral.glb`) was made, and the traps it fell into on the way. Follow it for any
model from a photograph or a prompt: a landmark, a prop, a car or a person. The human-facing guide is
[README.md](README.md); this file is the working method.

## The rule that matters most

An image-to-3D model is only good on the side the image shows. Meshy invents everything else (backs, sides,
roofs), and it brings along whatever stood next to the subject. So:

- Use the model only for the side that was photographed. Cut the rest off and draw it in code, as
  `tepic-landmarks.js` does with the Catedral's nave, dome and apse.
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

- **Simple landmarks** go in `LANDMARK_MODELS` (`js/world/landmark-models.js`). A model with drawn parts gets
  its own builder, like `CATEDRAL_MODEL` and `PLAN` in `js/world/tepic-landmarks.js`. Keep the drawn version
  until the file loads, so the place is never empty if it fails.
- **OpenStreetMap outlines** take in annexes (the Catedral's includes the casona). Don't centre on the outline's
  box. Find the real front: the outline's edge furthest towards the street or plaza. Then measure the plan in
  the building's own frame.
- **Streets are not square to buildings.** Check the curb island the building stands on
  (`blockAt(x, z).poly`, from `js/world/city-config.js`). Keep every front at least the sidewalk's width
  (`GEO.frame.sidewalk`, 2.2 m) behind it. `frontRuns()` lays buildings along a curb that turns, and the church
  stands back (`setback`) when its OpenStreetMap front crosses the curb.
- **Generic houses**: `LANDMARK_RESERVES` keeps them off. A house is dropped if its centre is inside a reserve,
  and so is any house part that reaches more than ~1.2 m into one (`buildings.js`). Make each reserve the exact
  footprint, not a big box: a box also deletes the real neighbours.
- **Late-loading models**: the landmarks' world matrices are frozen once the city is built
  (`freezeStaticMatrices`, `render/scene-culling.js`). Call `model.updateMatrixWorld(true)` after adding the
  model, or it draws at the origin, under the ground.
- **Uploaded geometry**: after the first frames, the renderer releases the CPU copies of static geometry
  (`scene-culling.js`). Calling `computeBoundingBox()` on such a mesh then gives NaN bounds, and the mesh is
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

- **Cars are in.** The ten best sellers (Versa, Aveo, March, NP300, Vento, Gol, Kicks, Onix, Yaris, Rio) are
  Meshy models in `assets/models/cars/`. They were drawn white from prompts (`tools/models/jobs/cars/`, 18
  credits each), then prepared with `prepare.mjs --length <its real length> --yaw 90 --wheel <tyre radius> --ratio 1 --texture 1024`.
  Meshy's front view has every car's nose at -x, and the game's cars face +z.
  - **Data**: a car model's `glb` field (`js/models/cars/`) names its file.
  - **Traffic**: `sim/traffic.js` loads those files in the background. Near the camera (`CAR_PROXY_DISTANCE`) such
    a car is drawn with its own instanced mesh, at scale 1, with its wheels in it. Beyond that distance it is
    its body shape's ~250-triangle stand-in, as before.
  - **Paint mask**: `prepare.mjs` bakes one into each car's metallic-roughness texture (R: the mask, G: the
    roughness). The mask is the texture's white areas, minus the wheels, grown 3 px over edges and seams.
    `createModelCarMaterial` (`actors/actor-models.js`) paints the instance's colour through it, following the
    texture's brightness, and lights the red lamps at the back with the brake.
  - **Two mistakes not to repeat**: a plain "paint where it's white" threshold left pale stripes along every
    edge and seam, and it painted the silver rims too. The wheels are found where the tyres touch the ground;
    `--wheel` must be the real tyre radius, from the tyre size, or the disc also takes the fender's paint.
  - **Not done yet**: these cars don't crumple and their wheels don't turn. The prompts asked for no badges,
    but Nano Banana still drew some on the grilles.
  - **Adding one**: a job, the preparation, the `glb` field. Check that the nose faces +z (`.claude/cars.html`
    shows the prepared cars side by side) and that the paint takes.
- **People**: pedestrians are one instanced, GPU-skinned crowd on a 15-bone skeleton (`sim/pedestrians.js`), with
  outfits from a per-person seed. A Meshy person in A-pose has to be skinned to those bones: two bones and a
  weight per vertex, from the bind pose. Each model is one fixed look, and the morphs (build, female
  proportions, hair) are lost. The pilot is `tools/models/jobs/person.json`.
