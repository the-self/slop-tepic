// js/world/hash.ts
// A fixed pseudo-random number in [0, 1) for a place (x, z) and a key k: what is planted, put out or thrown where in
// the city (the yards' trees, the camellón's, the stalls, the parties, the rooms) comes out the same on every load.
// Free of three.js, for node --test.

function hash(x: number, z: number, k = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// The street furniture's (street-details.ts, the CFE's poles, trees.ts' per-tree variation): for (x, k, z), the same
// numbers they were planted by before this module, so every lamp, transformer and tree stays where it was
function hashPos(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export { hash, hashPos };
