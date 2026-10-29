import assert from 'node:assert/strict';
import test from 'node:test';
import { GEO } from '../js/world/city-geodata.js';
import { carParks, displayStalls, inCarPark } from '../js/world/parking.ts';
import { STOREFRONTS } from '../js/world/storefronts/index.ts';
import { CAR_MODEL_BY_ID } from '../js/models/cars/index.ts';

// The car dealers (agencias): their makes (js/world/storefronts/agencias.ts), their showrooms and lots in the geodata
// (tools/build-tepic-geodata.mjs), and the cars laid out on show in a lot (parking.ts displayStalls)

const rect = (x0, z0, x1, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];
const MAKES = STOREFRONTS.filter((sf) => sf.dealer);

test('every make shows models the game has, under a name of its own', () => {
  assert.ok(MAKES.length >= 15);
  for (const sf of MAKES) {
    assert.ok(sf.dealer.length > 0, sf.id);
    for (const id of sf.dealer) assert.ok(CAR_MODEL_BY_ID[id], `${sf.id}: no car model '${id}'`);
    assert.ok(sf.pylon && sf.facade.glazing, `${sf.id}: a glazed showroom and a pole sign`);
  }
  assert.equal(new Set(STOREFRONTS.map((sf) => sf.name)).size, STOREFRONTS.length, 'no two chains under one name');
});

test('a dealer\'s cars stand in a row along its street edge, noses out, turned a little', () => {
  // θ = 0: the rows along x; the street to the south (+z) of a 30 x 7 m lot
  const [lot] = carParks([['Agencia', 1, 0, rect(0, 0, 30, 7), []]]);
  const stalls = displayStalls(lot, 1);
  assert.equal(stalls.length, Math.floor((30 - 1) / 3.6));
  for (const s of stalls) {
    assert.ok(inCarPark(lot, s.x, s.z));
    assert.ok(Math.cos(s.heading) > 0.8, 'facing the street (+z)');
    assert.ok(Math.abs(Math.sin(s.heading)) > 0.2, 'angled to it');
    assert.ok(!s.lineA && !s.lineB, 'no lines painted');
  }
  assert.equal(new Set(stalls.map((s) => s.z)).size, 1, 'one row');
  // the street to the north: the same row by the north edge, facing it
  const north = displayStalls(lot, -1);
  for (const s of north) assert.ok(Math.cos(s.heading) < -0.8 && s.z < 3.5);
  // deep enough for two rows, never more
  const [deep] = carParks([['Agencia', 1, 0, rect(0, 0, 30, 20), []]]);
  assert.equal(new Set(displayStalls(deep, 1).map((s) => s.z)).size, 2);
  const [shallow] = carParks([['Agencia', 1, 0, rect(0, 0, 30, 5), []]]);
  assert.deepEqual(displayStalls(shallow, 1), []);
});

test('no car on show stands in the way in', () => {
  // a 6 m driveway from the curb 3 m south, straight in (-z) at x = 15
  const way = [15, 10, -Math.PI / 2 * 1000, 6, [15, 10, 15, 6.5]];
  const [lot] = carParks([['Agencia', 1, 0, rect(0, 0, 30, 7), [way]]]);
  const stalls = displayStalls(lot, 1);
  assert.ok(stalls.length > 0 && stalls.length < displayStalls(carParks([['Agencia', 1, 0, rect(0, 0, 30, 7), []]])[0], 1).length);
  for (const s of stalls) assert.ok(Math.abs(s.x - 15) > 3.5, `${s.x}`);
});

test('Insurgentes\' dealers are in the geodata: a showroom under its make\'s sign, most with a lot in front', () => {
  const HS = GEO.houseStride;
  const lots = carParks(GEO.parking);
  const seen = new Set();
  let withLot = 0;
  for (let k = 0; k < GEO.dealers.length; k += 4) {
    const [house, store, lot, depth] = GEO.dealers.slice(k, k + 4);
    const sf = STOREFRONTS[store];
    assert.ok(sf?.dealer, `make ${store}`);
    seen.add(sf.id);
    // the showroom carries the make's sign
    const sign = GEO.signs[GEO.houses[house * HS + 7] - 1];
    assert.ok(sign?.chain && sign.store === store, `${sf.name}'s showroom`);
    if (lot < 0) continue;
    withLot++;
    const l = lots[lot];
    assert.ok(l.name.includes(sf.name) && l.surface === 1);
    assert.ok(depth >= 6 && depth <= 14);
    // the lot lies off the showroom, on its street side
    const hx = GEO.houses[house * HS] / 10, hz = GEO.houses[house * HS + 1] / 10;
    assert.ok(!inCarPark(l, hx, hz));
    assert.ok(displayStalls(l, ((l.minX + l.maxX) / 2 - hx) * l.vx + ((l.minZ + l.maxZ) / 2 - hz) * l.vz >= 0 ? 1 : -1).length >= 1, sf.name);
  }
  for (const id of ['masda', 'totoya', 'nisan', 'chebo', 'vochowagen', 'jonda', 'quiubo', 'jiundai', 'forro']) assert.ok(seen.has(id), id);
  assert.ok(withLot >= 12, `${withLot}`);
});
