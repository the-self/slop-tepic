# Landmark models

3D models of Tepic's landmarks, each standing on its real lot in place of the generic houses
(`js/world/landmark-models.js`). Everything else in the city stays procedural.

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

Add an entry to `LANDMARK_MODELS` in `js/world/landmark-models.js`:

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
`js/world/tepic-landmarks.js`) and the nave behind stays drawn. Clean such a model up as above:
crop the neighbours, scale it to a known height, and simplify it.

## Credits

- `catedral.glb`: made with [Meshy](https://www.meshy.ai/) (Meshy 7.1) from
  [a photograph by Nheyob](https://commons.wikimedia.org/wiki/File:Catedral_de_la_Pur%C3%ADsima_Concepci%C3%B3n_(Tepic,_Nayarit)_-_facade.jpg),
  Wikimedia Commons, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The
  model is shared under the same licence. Scaled to 40 m at the crosses of the towers.

Models taken from Google Maps, Street View or Google's 3D tiles can't be used: their licence
doesn't allow copying them.
