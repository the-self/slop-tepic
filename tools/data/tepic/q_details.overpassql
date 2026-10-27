[out:json][timeout:240][bbox:21.370,-104.975,21.580,-104.750];
// The street-level details the other queries leave out. What they already carry is not asked again:
// q_land has every leisure / natural / landuse / waterway way (natural=water, tree_row, pools, pitches, dams & weirs),
// the amenity ways of schools, markets, bus stations & churches, and barrier=wall; q_pois the named tourism, historic &
// church nodes, the crossings, signals and street lamps; q_roads every highway way; q_buildings every building's tags
(
  // public transport: stops, platforms, the stations' nodes (their ways are in q_land)
  node["highway"="bus_stop"];
  node["public_transport"~"^(platform|stop_position)$"];
  way["public_transport"="platform"];
  node["amenity"="bus_station"];
  // speed bumps, humps, tables, cushions, rumble strips
  node["traffic_calming"];
  way["traffic_calming"];
  // single trees (the rows are ways in q_land)
  node["natural"="tree"];
  // power lines and what carries them
  way["power"~"^(line|minor_line)$"];
  node["power"~"^(tower|pole)$"];
  // street furniture
  node["amenity"~"^(bench|waste_basket|drinking_water|toilets|shelter)$"];
  way["amenity"~"^(bench|toilets|shelter)$"];
  node["man_made"="street_cabinet"];
  node["emergency"="fire_hydrant"];
  // businesses and services
  node["amenity"~"^(fuel|pharmacy|bank|atm|police|fire_station|clinic|doctors|dentist|townhall|library|post_office|marketplace|restaurant|fast_food|cafe|bar|ice_cream)$"];
  way["amenity"~"^(fuel|pharmacy|bank|atm|police|fire_station|clinic|doctors|dentist|townhall|library|post_office|restaurant|fast_food|cafe|bar|ice_cream)$"];
  node["shop"];
  way["shop"];
  // places: the unnamed ones (the named are in q_pois), churches without a name
  node["tourism"][!"name"];
  way["tourism"][!"name"];
  node["historic"][!"name"];
  way["historic"][!"name"];
  node["amenity"="place_of_worship"][!"name"];
  // sport mapped as a point (the areas are in q_land)
  node["leisure"~"^(swimming_pool|pitch|sports_centre|stadium|playground|fitness_station)$"];
  // water mapped as a point
  node["natural"="water"];
  node["waterway"~"^(dam|weir)$"];
  // fences, retaining walls, gates, bollards, kerbs (walls as ways are in q_land)
  way["barrier"~"^(fence|retaining_wall|gate|bollard|kerb)$"];
  node["barrier"~"^(wall|fence|gate|bollard|kerb|lift_gate|swing_gate)$"];
);
out geom tags;
