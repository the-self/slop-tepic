// js/app/city.ts
// Builds the city into the scene, in the order its parts depend on each other: the streamed ground (tiles laid round
// the camera by workers, world/streaming.ts; ?stream=0 lays all of them at start-up), the streets, the floor painted
// beyond the tiles, the hills, the rivers, the landmarks, the blocks and stores, the car parks, the street details, the
// traffic on the road network, the paint, the pavements, the airport and the overpasses; and gathers what the player
// collides with.
import type * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { ISLAND_BOUNDS } from '../world/city-config.ts';
import { buildCityGrid } from '../world/city-grid.ts';
import { buildCityBlocks } from '../world/buildings.ts';
import { buildStreetDetails } from '../world/street-details.ts';
import { createTrafficSystem, createHighwayTraffic } from '../sim/traffic.ts';
import { buildRoadPaint } from '../world/road-paint.ts';
import { buildPavements } from '../world/pavements.ts';
import { buildBridges } from '../world/bridges.ts';
import { buildFootbridges } from '../world/footbridges.ts';
import { buildAirport } from '../world/airport.ts';
import { buildLandmarkModels } from '../world/landmark-models.ts';
import { buildStores } from '../world/store-interiors.ts';
import { buildTerrain } from '../world/terrain.ts';
import { buildRiverChannels } from '../world/river-channels.ts';
import { liftAt, SLOPES, LATTICE, deckHoles } from '../world/ground.ts';
import { TileStreamer } from '../world/streaming.ts';
import { paintFarGround, farGroundColor } from '../world/far-ground.ts';
import { buildTepicLandmarks } from '../world/tepic-landmarks.ts';
import { buildCotos } from '../world/cotos.ts';
import { buildCarParks } from '../world/car-parks.ts';
import { buildBusShelters } from '../world/bus-shelters.ts';
import { buildPowerLines } from '../world/power-lines.ts';
import { buildPools } from '../world/pools.ts';
import { buildFootways } from '../world/footways.ts';
import { GEO } from '../world/city-geodata.js';
import type { Collider } from '../world/buildings.ts';

export type City = ReturnType<typeof buildCity>;

// Elevated building sections that clear even a bus (m over the ground under them) don't obstruct ground traffic
const TRAFFIC_CLEARANCE = 3.5;

/** `stream`: lay the heavy ground layers tile by tile round the camera (false: all at start-up); `mark` ends a phase */
export function buildCity(scene: THREE.Scene, { stream, mark }: { stream: boolean; mark: (label: string) => void }) {
  const box = { x0: ISLAND_BOUNDS.minX, x1: ISLAND_BOUNDS.maxX, z0: ISLAND_BOUNDS.minZ, z1: ISLAND_BOUNDS.maxZ };
  const holes = deckHoles(); // (the river channels' and the open underpasses')
  const streamer = stream ? new TileStreamer({
    scene,
    lattice: SLOPES ? LATTICE : null,
    ground: SLOPES ? GEO.ground : null,
    box,
    holes: holes.length ? Float32Array.from(holes) : null,
    workers: Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2))
  }) : null;
  const cityGrid = buildCityGrid(scene, streamer);
  mark('cityGrid');
  // Beyond the streamed tiles the city's floor is painted with the streets, lots & parks they lay (far-ground.ts): the
  // hills' floor under them on the slopes, the valley floor in the flat city
  const farGround = streamer ? paintFarGround({ open: cityGrid.open, box }) : null;
  const valley = cityGrid.valley.material;
  if (farGround && !SLOPES) valley.colorNode = farGroundColor(farGround, color(valley.color));
  mark('farGround');
  // The hills around the valley (Tepic: Cerro de San Juan, Cerro de la Cruz...), over the flat city, and the floor
  // under the streamed tiles not loaded
  buildTerrain(scene, { mask: streamer?.mask ?? null, far: farGround });
  mark('terrain');
  // The Río Mololoa & the arroyos in their channels, under the deck the city grid opened over them
  const rivers = buildRiverChannels(scene);
  mark('rivers');
  const { colliders: landmarkColliders } = buildTepicLandmarks(scene);
  // (and the landmarks made as 3D models, world/landmark-models.ts: their lots now, the models as they load)
  const { colliders: modelColliders } = buildLandmarkModels(scene);
  mark('landmarks');
  const cityBlocks = buildCityBlocks(scene);
  // The big chain stores you can walk into: their walls, door, shelves & tills (world/store-interiors.ts)
  const stores = buildStores(scene, cityBlocks.stores);
  mark('blocks');
  // The gated communities' walls & guard booths (the houses inside are among the blocks')
  const { colliders: cotoColliders } = buildCotos(scene);
  // The supermarkets', plazas' & hospitals' car parks: their asphalt & stalls, and the cars parked in them
  const carParks = buildCarParks(scene, streamer);
  // (and the swimming pools in the lots)
  buildPools(scene);
  mark('carParks');
  const colliders: Collider[] = [...landmarkColliders, ...modelColliders, ...cityBlocks.colliders, ...stores.colliders, ...cotoColliders, ...cityGrid.colliders];
  // (one by one, like the bridges' below)
  for (const c of carParks.colliders) colliders.push(c);

  // (no yard tree in a store's hall or a car park)
  const streetDetails = buildStreetDetails(scene, [...stores.reserves, carParks]);
  mark('streetDetails');
  // Buildings turned along non-grid streets have oriented colliders whose world bounds reach past their lots: they stay
  // inside the property line anyway, so the road network (lanes & sidewalks) doesn't need them.
  const traffic = createTrafficSystem(scene, cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...colliders.filter((c) => !c.obb && c.minY - liftAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) < TRAFFIC_CLEARANCE)
  ]);
  mark('traffic');
  // Mast-arm traffic signals at the signalised junctions of a city off the grid (the grid's are built with the streets)
  streetDetails.addJunctionSignals(traffic.network, colliders); // (their poles stop the player)
  // The paradas on the sidewalks, by the curb the camiones & combis pull in to (their backs & benches stop the player)
  for (const c of buildBusShelters(scene, traffic.network.edges).colliders) colliders.push(c);
  const highwayTraffic = createHighwayTraffic(scene, cityGrid.highwayLanes);
  buildRoadPaint(scene, traffic.network, streamer);
  buildPavements(scene, streamer); // (the empedrado, adoquín, earth & concrete streets, under the paint)
  buildFootways(scene, streamer); // (the walks, andadores, paths, pedestrian streets & steps)
  buildAirport(scene); // (the runway, taxiways & apron south-east of town, and the airliners at the gates)
  mark('roadPaint');
  // The overpasses, their ramps & the railway; their walls, parapets & piers stop the player (not the traffic's
  // footprints: the lanes on and under them stay open)
  const bridges = buildBridges(scene);
  // (one by one: spread into push(), tens of thousands of them overflow the call stack)
  for (const c of bridges.colliders) colliders.push(c);
  // The puentes peatonales over the main roads: their railings, stairs & columns stop the player and the vehicles
  for (const c of buildFootbridges(scene).colliders) colliders.push(c);
  // The CFE's concrete poles stop the player (not the traffic: they stand on the sidewalks' outer edge)
  for (const c of streetDetails.colliders) colliders.push(c);
  // The high-voltage lines over the valley & the hills; their towers in the town stop the player
  for (const c of buildPowerLines(scene).colliders) colliders.push(c);
  mark('bridges');
  return { streamer, cityGrid, farGround, rivers, cityBlocks, stores, carParks, streetDetails, traffic, highwayTraffic, bridges, colliders };
}
