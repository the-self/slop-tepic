// js/app/teleport.ts
// Teleporting the player (the preset spots' buttons, the full map, a respawn): every way of arriving resets the same
// things, so the player lands at rest wherever it is, the input is released and the chase camera picks them up.

/** What a teleport moves and resets */
export interface TeleportTargets {
  controllers: { teleportActiveTo(x: number, z: number, heading?: number): { x: number; z: number } };
  touch: { reset(): void };
  gamepad: { reset(): void };
  cameras: { resetForTeleport(): void };
  /** the room the player is in, if any (they leave it, wherever the teleport lands) */
  room: () => { abandon(): void } | null;
  selectCamera: (id: 'chase', snap: boolean) => void;
}

/** Teleports the player to (x, z) facing `heading` (rad); returns where they landed (a safe spot near it) */
export type Teleport = (x: number, z: number, heading?: number) => { x: number; z: number };

export function createTeleport({ controllers, touch, gamepad, cameras, room, selectCamera }: TeleportTargets): Teleport {
  return (x, z, heading = Math.PI) => {
    room()?.abandon();
    const destination = controllers.teleportActiveTo(x, z, heading);
    touch.reset();
    gamepad.reset();
    cameras.resetForTeleport();
    selectCamera('chase', true);
    return destination;
  };
}

/** The teleport buttons (data-teleport="<spot>"): each takes the player to its spot and closes the menu */
export function wireTeleportButtons(buttons: Iterable<Element>, spots: Readonly<Record<string, { x: number; z: number; heading: number }>>,
  teleport: Teleport, closePopovers: () => void): void {
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const spot = spots[button.getAttribute('data-teleport') ?? ''] as { x: number; z: number; heading: number } | undefined;
      if (spot) teleport(spot.x, spot.z, spot.heading);
      closePopovers();
    });
  }
}
