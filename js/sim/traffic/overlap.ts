// js/sim/traffic/overlap.ts
// The box test between a vehicle and the player (or any other box): a 4-axis 2D SAT, three-free

// Physical 4-axis 2D SAT OBB test between a vehicle (half extents halfW x halfL, heading rotY) and the player.
// Returns the minimum translation axis (pointing from the vehicle towards the player), or null if they don't overlap.
const satHit = { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 };
function overlapWithPlayer(relX: number, relZ: number, rotY: number, halfW: number, halfL: number, pH: number, pHalfW: number, pHalfL: number) {
  const sinY = Math.sin(rotY);
  const cosY = Math.cos(rotY);
  const localX = relX * cosY - relZ * sinY;
  const localZ = relX * sinY + relZ * cosY;
  const pSin = Math.sin(pH);
  const pCos = Math.cos(pH);
  const pLocalX = relX * pCos - relZ * pSin;
  const pLocalZ = relX * pSin + relZ * pCos;
  const alignCos = Math.abs(Math.cos(pH - rotY));
  const alignSin = Math.abs(Math.sin(pH - rotY));

  const extX = halfW + pHalfW * alignCos + pHalfL * alignSin;
  const extZ = halfL + pHalfW * alignSin + pHalfL * alignCos;
  const pExtX = pHalfW + halfW * alignCos + halfL * alignSin;
  const pExtZ = pHalfL + halfW * alignSin + halfL * alignCos;

  const penX = extX - Math.abs(localX);
  const penZ = extZ - Math.abs(localZ);
  const pPenX = pExtX - Math.abs(pLocalX);
  const pPenZ = pExtZ - Math.abs(pLocalZ);
  if (!(penX > 0 && penZ > 0 && pPenX > 0 && pPenZ > 0)) return null;

  let nx, nz, pen;
  if (penX < penZ) {
    const signX = localX >= 0 ? 1 : -1;
    nx = cosY * signX;
    nz = -sinY * signX;
    pen = penX;
  } else {
    const signZ = localZ >= 0 ? 1 : -1;
    nx = sinY * signZ;
    nz = cosY * signZ;
    pen = penZ;
  }
  if (pPenX < pen) {
    const signPX = pLocalX >= 0 ? 1 : -1;
    nx = pCos * signPX;
    nz = -pSin * signPX;
    pen = pPenX;
  }
  if (pPenZ < pen) {
    const signPZ = pLocalZ >= 0 ? 1 : -1;
    nx = pSin * signPZ;
    nz = pCos * signPZ;
    pen = pPenZ;
  }

  satHit.nx = nx;
  satHit.nz = nz;
  satHit.pen = pen;
  satHit.localX = localX;
  satHit.localZ = localZ;
  satHit.pSin = pSin;
  satHit.pCos = pCos;
  return satHit;
}

export { overlapWithPlayer };
