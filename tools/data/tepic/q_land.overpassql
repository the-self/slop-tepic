[out:json][timeout:240];
(
  way["leisure"](21.370,-104.975,21.580,-104.750);
  relation["leisure"](21.370,-104.975,21.580,-104.750);
  way["landuse"](21.370,-104.975,21.580,-104.750);
  relation["landuse"](21.370,-104.975,21.580,-104.750);
  way["natural"](21.370,-104.975,21.580,-104.750);
  relation["natural"](21.370,-104.975,21.580,-104.750);
  way["waterway"](21.370,-104.975,21.580,-104.750);
  way["railway"](21.370,-104.975,21.580,-104.750);
  way["aeroway"](21.370,-104.975,21.580,-104.750);
  way["amenity"~"^(school|university|college|hospital|marketplace|bus_station|place_of_worship|parking)$"](21.370,-104.975,21.580,-104.750);
  relation["amenity"~"^(school|university|college|hospital|marketplace|bus_station|place_of_worship)$"](21.370,-104.975,21.580,-104.750);
  way["man_made"~"^(bridge|tower|water_tower)$"](21.370,-104.975,21.580,-104.750);
  way["barrier"="wall"](21.370,-104.975,21.580,-104.750);
);
out geom tags;
