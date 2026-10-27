# Landmark models

3D models of Tepic's landmarks, each standing on its real lot in place of the generic houses
(`js/world/landmark-models.ts`). Everything else in the city stays procedural.

## Making one

1. **Capture** the building with a phone photogrammetry app (Polycam, RealityScan, Luma): walk all
   the way round it once at street level and once from across the street. Overcast light or shade
   works best, since harsh sun bakes shadows into the texture. Or model it by hand (Blender).
2. **Clean it up** in Blender: delete the street, cars and people around it, and close any holes.
   Set the origin to the middle of the footprint at ground level, with +Y up and the main facade
   facing +Z. Use metres.
3. **Make it light:** decimate to roughly 20–60k triangles, with one or two textures of at most
   2048 px (JPEG inside the .glb). Aim for under 5 MB per model; the whole repository is about 30 MB.
4. **Export** as glTF binary (`.glb`) into this folder, named in kebab-case
   (`presidencia-municipal.glb`).

## Placing it

Add an entry to `LANDMARK_MODELS` in `js/world/landmark-models.ts`:

```js
{ name: 'Presidencia Municipal', file: 'assets/models/presidencia-municipal.glb',
  lat: 21.51195, lon: -104.89305, heading: 90, size: [38, 26], height: 12 },
```

- `lat`, `lon`: the footprint's centre. Right-click the roof in Google Maps or OpenStreetMap to
  copy its coordinates.
- `heading`: the compass bearing (degrees clockwise from north) that the main facade faces.
- `size`: the footprint's width along the facade and its depth, in metres. Houses whose centres
  fall in that lot are not generated, and a collider of that size and `height` keeps players and
  cars out.
- Optional: `scale` (if the file isn't in metres) and `lift` (to raise it off the ground).

Reload the game. The lot clears at once, and the model appears as soon as it has loaded.

## From one photograph

An image-to-3D service (Meshy, Hunyuan3D, TRELLIS) makes a model from a single photograph in a
few minutes. The side it sees comes out well; the back and the sides are guessed, and the
buildings next door come along. `catedral.glb` was made this way, from a photograph of the
facade, so it replaces only the Catedral's front and towers (`CATEDRAL_MODEL` in
`js/world/tepic-landmarks.ts`) and the church behind them stays drawn. Clean such a model up as above:
crop the neighbours, scale it to a known height, and simplify it.

## Credits

- `catedral.glb`: made with [Meshy](https://www.meshy.ai/) (Meshy 7.1) from
  [a photograph by Nheyob](https://commons.wikimedia.org/wiki/File:Catedral_de_la_Pur%C3%ADsima_Concepci%C3%B3n_(Tepic,_Nayarit)_-_facade.jpg),
  Wikimedia Commons, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The
  model is shared under the same licence. Scaled to 40 m at the crosses of the towers, and cut
  9.5 m behind the facade: the rest of the church, the casona and the portales are drawn.

- `cars/*.glb`, eight of them: the commonest traffic cars, made with Meshy from images Meshy (Nano Banana) drew from
  the prompts in `tools/models/jobs/cars/`: seven with Meshy T2.5 smart topology from one image, the Versa with Meshy
  7.1 from four views.
- `cars/*.glb`, four of them, made by hand, from Sketchfab under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  (changed: rescaled to the real car, the interior and the lamps' lenses dropped, each part a new colour, the normals
  smoothed, simplified: `tools/models/prepare-made.mjs`, each one's `tools/models/jobs/cars/<id>.made.json`):
  - `nissan-tsuru.glb`: ["Nissan Tsuru"](https://sketchfab.com/3d-models/nissan-tsuru-59d6b88fbdc24041a2652b12eab7ceb6)
    by Meet The Colors the User TAD (@kotris666);
  - `chevrolet-onix.glb`: ["chevrolet onix"](https://sketchfab.com/3d-models/chevrolet-onix-bfd798c2695847b28ab681d42abc7056)
    by uzb_rx7;
  - `nissan-np300.glb`: ["Nissan Navara 2021 Calibre E"](https://sketchfab.com/3d-models/nissan-navara-2021-calibre-e-2a877fdf866b4dbb8b0aa4dd9ef2319d)
    by Asadawut.Kaewma;
  - `volkswagen-virtus.glb`: ["2022 Volkswagen Virtus GT"](https://sketchfab.com/3d-models/2022-volkswagen-virtus-gt-3955e5c050f843398b49b2b21ab2f232)
    by BHP3D.
- `people/player.glb`: the player, made with Meshy (Meshy 7.1, multi-image-to-3d) from a front and a back view that
  Meshy (Nano Banana Pro) drew from the prompts in `tools/models/jobs/people/player.json`; reposed into the crowd's bind
  pose and skinned to its 15 bones by `tools/models/prepare-person.mjs`.
- `people/player-rigged.glb`: the same model as Meshy rigged it (meshy_rig) with clips from Meshy's animation library
  (walking, running, Idle 3, Walk Backward, Regular Jump, Walk Left with Gun, Walk Backward with Gun 1), made one
  file by `tools/models/prepare-rigged-person.mjs`.

- `hermana-agua.glb`: the woman over the fountain in the glorieta by the Parque La Loma, made with Meshy (Meshy 7.1,
  untextured: the game gives her stone) from an image Meshy drew (Nano Banana Pro, then edited to her pose: her head
  bowed over the water cupped in her hands), and prepared in Blender by `tools/models/prepare-statue.py` (simplified to
  30k triangles, 3.8 m tall, her feet on the origin). The user's photographs were only a reference for the pose.

Models taken from Google Maps, Street View or Google's 3D tiles can't be used: their licence
doesn't allow copying them.
