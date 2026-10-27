// js/world/mapped-lamps.ts
// The street lamps OpenStreetMap maps (city-geodata.js `lamps`) looked up by place: round one, the lamps the game
// guesses (street-details.ts' down the streets, city-grid.ts' round the parks' walks) aren't put up, as the map knows
// better there. Free of three.js, for the tests.

const LAMP_REPLACE = 45; // m round a mapped lamp no guessed one stands
const LAMP_CELL = 50; // m, the cells of the lookup

/** Whether (x, z) is within `reach` m of one of the lamps of `flat` ([x0, z0, x1, z1, ...], m) */
function lampFinder(flat: readonly number[], reach = LAMP_REPLACE): (x: number, z: number) => boolean {
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  for (let k = 0; k + 1 < flat.length; k += 2) {
    const c = key(Math.floor(flat[k] / LAMP_CELL), Math.floor(flat[k + 1] / LAMP_CELL));
    let list = cells.get(c);
    if (!list) cells.set(c, (list = []));
    list.push(flat[k], flat[k + 1]);
  }
  const n = Math.ceil(reach / LAMP_CELL);
  return (x, z) => {
    const ix = Math.floor(x / LAMP_CELL), iz = Math.floor(z / LAMP_CELL);
    for (let a = -n; a <= n; a++) {
      for (let b = -n; b <= n; b++) {
        const list = cells.get(key(ix + a, iz + b));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) if (Math.hypot(list[k] - x, list[k + 1] - z) < reach) return true;
      }
    }
    return false;
  };
}

export { lampFinder, LAMP_REPLACE };
