// js/world/building-overrides.ts
// What is known of particular buildings from looking at them (photographs, a walk down the street) and that neither
// OpenStreetMap nor Overture records: near the Plaza Principal not one footprint carries a height, a storey count or
// a colour, so without this every house is guessed (its storeys and paint picked by chance). Read by
// tools/build-tepic-geodata.mjs, which finds the building each entry points at, and through GEO.overrides by
// js/world/buildings.ts, which then draws it as one building (no split into narrow houses) with these storeys & paint.
//
// Each entry is pinned to a point inside the building's footprint, in degrees (right-click the roof in Google Maps or
// OpenStreetMap and copy the coordinates), so it survives rebuilds of the map:
//   { lat, lon, storeys?: 1..12, paint?: '#rrggbb' (the facade's main colour), note?: where / what it is }
// Leave out what isn't known: a missing field keeps the guess. Group entries by street, north to south / west to east.

/** What is known of a building: a point inside its footprint (degrees), its storeys (1..12) and its facade's main
 *  colour ('#rrggbb'), and where / what it is. */
export interface BuildingOverrideEntry {
  lat: number;
  lon: number;
  storeys?: number;
  paint?: string;
  note?: string;
}

const BUILDING_OVERRIDES: BuildingOverrideEntry[] = [
  // Avenida México, the plaza's east side (example of the format; replace with what the photographs show):
  // { lat: 21.51225, lon: -104.89205, storeys: 2, paint: '#e8d7b0', note: 'Av. México y Lerdo, esquina noreste' },
];

export { BUILDING_OVERRIDES };
