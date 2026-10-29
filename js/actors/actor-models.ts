import { CAR_PARTS, BODY_SPECS } from './vehicles/car-specs.ts';
import { carLayout, carBodyHalfWidthAt, buildCarSidePatch } from './vehicles/car-body.ts';
import { bodyDims, buildSteerableWheelGeo, buildCarGeometry, buildCarProxyGeometry } from './vehicles/car-geometry.ts';
import { createLoftedCarMaterial, createModelCarMaterial, createModelWheelMaterial } from './vehicles/car-material.ts';
import { buildLightbarGeometry, createLightbarMaterial } from './vehicles/lightbar.ts';
import {
  BUS_SPEC, buildLoftedBusBodyGeometry, buildBusSignGeometry, buildCombiSignGeometry, buildBusWheelGeo
} from './vehicles/bus-geometry.ts';
import {
  routeSignTexture, createRouteSignMaterial, busLiveryTexture, createBusWheelMaterial, createLoftedBusMaterial
} from './vehicles/bus-materials.ts';
import {
  buildHelicopterBodyGeometry, buildHelicopterMainRotorGeometry, buildHelicopterTailRotorGeometry
} from './vehicles/helicopter-geometry.ts';
import { createLoftedHelicopterMaterial } from './vehicles/helicopter-material.ts';
import { standingBox } from './vehicles/loft.ts';
import {
  COACH_SIZE, buildCoachBodyGeometry, buildCoachWheelsGeometry, buildCoachNameGeometry, coachNameTexture, createCoachMaterial,
  createCoachNameMaterial
} from './vehicles/coach.ts';
import {
  TRUCK_SIZE, buildTractorTrailerGeometry, buildTrailerNameGeometry, trailerNameTexture, createTractorTrailerMaterial,
  createTrailerNameMaterial
} from './vehicles/tractor-trailer.ts';
import {
  ROUTE_TRUCK_SIZE, buildRouteTruckGeometry, buildRouteTruckNameGeometry, routeTruckNameTexture, createRouteTruckMaterial,
  createRouteTruckNameMaterial
} from './vehicles/route-truck.ts';

export type { BloodUniforms } from './vehicles/car-blood-stains.ts';
export type { BusSpec } from './vehicles/bus-geometry.ts';

// js/actors/actor-models.ts
// Realistic 3D Lofted Vehicle Geometry + TSL Materials (the skinned, animated people are in pedestrians.ts)
// Ported and adapted from Three.js webgpu_generator_city:
// - LoftGeometry.js (skinning 3D cross-section rings with arc-length UVs, smooth seam normals & Newell caps)
// - CarGenerator.js (lofted sedan/taxi/SUV/NYPD bodies with circular wheel arches, curved cabin windscreens,
//   crowned roofs, LatheGeometry tyres & recessed 5-spoke alloy wheels, side mirrors, roof signs & TSL fascia/seams)
//
// The pieces are in vehicles/: loft.ts (LoftGeometry, part), car-specs.ts (CAR_PARTS, BODY_SPECS), car-body.ts (the
// body profile & glasshouse lofts), car-geometry.ts (a whole car's mesh), car-material.ts (+ tsl-shapes.ts,
// car-blood-stains.ts), lightbar.ts, bus-geometry.ts & bus-materials.ts, helicopter-geometry.ts &
// helicopter-material.ts, coach.ts (the intercity coach), tractor-trailer.ts (the supermarkets' tráiler), route-truck.ts
// (the bottler's camión repartidor) and lettering.ts (the names on their sides). This module is their public entry.

export {
  CAR_PARTS,
  BODY_SPECS,
  bodyDims,
  carLayout,
  carBodyHalfWidthAt,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  buildCarGeometry,
  buildCarProxyGeometry,
  createLoftedCarMaterial,
  createModelCarMaterial,
  createModelWheelMaterial,
  buildLightbarGeometry,
  createLightbarMaterial,
  BUS_SPEC,
  buildLoftedBusBodyGeometry,
  buildBusSignGeometry,
  routeSignTexture,
  createRouteSignMaterial,
  busLiveryTexture,
  buildCombiSignGeometry,
  buildBusWheelGeo,
  createBusWheelMaterial,
  createLoftedBusMaterial,
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial,
  standingBox,
  COACH_SIZE,
  buildCoachBodyGeometry,
  buildCoachWheelsGeometry,
  buildCoachNameGeometry,
  coachNameTexture,
  createCoachMaterial,
  createCoachNameMaterial,
  TRUCK_SIZE,
  buildTractorTrailerGeometry,
  buildTrailerNameGeometry,
  trailerNameTexture,
  createTractorTrailerMaterial,
  createTrailerNameMaterial,
  ROUTE_TRUCK_SIZE,
  buildRouteTruckGeometry,
  buildRouteTruckNameGeometry,
  routeTruckNameTexture,
  createRouteTruckMaterial,
  createRouteTruckNameMaterial
};
