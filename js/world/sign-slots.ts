// js/world/sign-slots.ts
// The slots of the shop sign atlas that hold the businesses' own names (city-geodata.js `signs` with a `trade`: some
// 6,600 of them, from Overture Maps' places), handed out around the camera. js/world/buildings.ts draws each name into
// its slot when it first comes near and keeps it there until the slot is wanted for another: the least recently seen
// name gives way. The atlas is split into pages (a canvas texture each), and a page whose slots changed is uploaded
// whole, so new names go into a page already being redrawn this pass, else into the page with the most room (empty
// slots first), to keep each pass to a page or two. Plain data (no three.js), so node --test reaches it.

/**
 * The name slots of the sign atlas. begin() starts a pass (one streaming update); acquire(sign) returns the slot
 * (0 .. pages * perPage - 1) holding that sign, drawing it in if new, or -1 when every slot is taken by a sign seen this
 * pass (the caller falls back to the trade's sign). After the pass, `dirty` holds the pages to upload and `drawn` the
 * slots & signs to draw (flat: slot, sign, slot, sign...). Signs are indices into city-geodata.js `signs`.
 */
export interface SignSlots {
  begin(): void;
  acquire(sign: number): number;
  dirty: Set<number>;
  drawn: number[];
  perPage: number;
}

/** `pages`: pages of the atlas given to names; `perPage`: slots per page. */
function createSignSlots(pages: number, perPage: number): SignSlots {
  const n = pages * perPage;
  const owner = new Int32Array(n).fill(-1); // the sign in each slot (-1: none yet)
  const stamp = new Int32Array(n).fill(-1); // the pass that last asked for it
  const slotOf = new Map<number, number>(); // sign -> slot
  const dirty = new Set<number>();
  const drawn: number[] = [];
  let pass = 0;

  // the oldest slot of page p not asked for this pass (-1: none)
  function oldestIn(p: number): number {
    let best = -1;
    for (let s = p * perPage, e = s + perPage; s < e; s++) {
      if (stamp[s] < pass && (best < 0 || stamp[s] < stamp[best])) best = s;
    }
    return best;
  }

  function pick(): number {
    for (const p of dirty) {
      const s = oldestIn(p);
      if (s >= 0) return s;
    }
    // (slots never used before the ones holding a name that may come back)
    let bestPage = -1, room = 0;
    for (let p = 0; p < pages; p++) {
      let r = 0;
      for (let s = p * perPage, e = s + perPage; s < e; s++) if (stamp[s] < pass) r += owner[s] < 0 ? n : 1;
      if (r > room) { room = r; bestPage = p; }
    }
    return bestPage < 0 ? -1 : oldestIn(bestPage);
  }

  return {
    perPage,
    dirty,
    drawn,
    begin() {
      pass++;
      dirty.clear();
      drawn.length = 0;
    },
    acquire(sign: number) {
      let s = slotOf.get(sign);
      if (s !== undefined) {
        stamp[s] = pass;
        return s;
      }
      s = pick();
      if (s < 0) return -1;
      if (owner[s] >= 0) slotOf.delete(owner[s]);
      owner[s] = sign;
      stamp[s] = pass;
      slotOf.set(sign, s);
      dirty.add(Math.floor(s / perPage));
      drawn.push(s, sign);
      return s;
    }
  };
}

export { createSignSlots };
