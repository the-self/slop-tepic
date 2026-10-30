// js/app/install/multiplayer.ts
// Multiplayer (?multiplayer=1, see net/multiplayer.ts) loads only when asked for, so single-player pays nothing: the
// lobby, then the room. The room's sky goes on the bus (`roomSky`, install/sky.ts); its rules to the crime.
import type { Multiplayer } from '../../net/multiplayer.ts';
import type { Boot } from './boot.ts';
import type { PlayerParts } from './player.ts';
import type { CrimeParts } from './crime.ts';
import type { ControlsParts } from './controls.ts';

/** The room the player is in: none until the lobby has let them into one (`current`), and the others' cars */
export type NetParts = Awaited<ReturnType<typeof installMultiplayer>>;

export async function installMultiplayer({ params, scene, events, controllers, cameras, crime, boarding }:
  Boot & PlayerParts & CrimeParts & ControlsParts) {
  const net: { current: Multiplayer | null } = { current: null };
  // ...and its others' cars (net/remote-cars.ts) made now, one drawn out of sight till the first frame is through, so
  // the shader precompile and the warm-up frame build their instanced pipelines, not the first car into view
  const remoteCars = params.has('multiplayer')
    ? new (await import('../../net/remote-cars.ts')).RemoteCarFleet(scene, controllers.entities.car.mesh)
    : null;
  remoteCars?.prime();
  if (params.has('multiplayer')) {
    Promise.all([import('../../net/multiplayer.ts'), import('../../net/lobby.ts')])
      .then(async ([{ Multiplayer, multiplayerOptions }, { openLobby }]) => {
        const options = multiplayerOptions();
        if (!options) {
          console.info('[mp] no server to connect to: add &mp-server=wss://… (or serve from localhost)');
          return;
        }
        // the lobby first: the player's name and the room to play in (net/lobby.ts)
        const { roomsUrl, ...connection } = options;
        const lobby = (more: Partial<Parameters<typeof openLobby>[0]> = {}) => {
          controllers.resetInput(); // (whatever key was held stays held otherwise)
          return openLobby({ roomsUrl, name: net.current?.name ?? connection.name ?? '', profile: net.current?.play.profile, ...more });
        };
        const first = await lobby();
        if (!first) return;
        const mp = new Multiplayer({
          scene, controllers, camera: cameras.camera, crime, cameras,
          ...connection, name: first.name, entry: first.entry, cars: remoteCars,
          // (the room's sky, everyone's: on joining, and whenever someone in the room changes it)
          onSky: (time, weather) => { events.emit('roomSky', { time, weather }); }
        });
        net.current = mp;
        boarding.ride = mp; // (F by a friend's car: in with them)
        // a room without police: crimes raise no wanted level (PvP is net/multiplayer.ts's own)
        mp.onRules = (rules) => {
          crime.policeOff = !rules.police;
          if (!rules.police) crime.wanted.clear();
        };
        const go = (choice: Awaited<ReturnType<typeof openLobby>>) => { if (choice) mp.rejoin(choice.entry, choice.name); };
        mp.onRejected = (code) => { void lobby({ error: code }).then(go); };
        mp.onLobby = () => {
          void lobby({
            current: mp.current,
            onSave: ({ time, weather, rules }) => {
              mp.setSky(time, weather);
              mp.sendRules(rules);
            }
          }).then(go);
        };
      })
      .catch((err: unknown) => { console.warn('[mp] could not start multiplayer:', err); });
  }
  return { net, remoteCars };
}
