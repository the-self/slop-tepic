// tools/play.ts — play together over the internet from this computer: builds the game, starts the room server
// (server/index.ts) serving the game's page as well, and opens a Cloudflare quick tunnel to it, which gives a public
// https:// address, free and with no account (https matters: browsers only allow WebGPU on secure pages). Whoever
// opens that address with ?multiplayer=1 plays in the same room. Stop it with Ctrl+C.
//   npm run play                 (needs cloudflared: brew install cloudflared; without it, only this network can join)
//   PORT=8787                    the local port
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from '../server/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const say = (line: string) => { console.log(line); };

say('Compilando el juego...');
const build = spawnSync(process.execPath, ['tools/build.ts'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = await createServer({ port, staticDir: root });
say(`\nServidor listo en http://localhost:${String(server.port)}`);
say(`  Tú (en esta compu):  http://localhost:${String(server.port)}/?multiplayer=1`);
// (another computer on this network: its http page has no WebGPU, so it goes through the tunnel too)
const lan = Object.values(os.networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal);
if (lan) say(`  (en esta red también llega a http://${lan.address}:${String(server.port)}, pero sin https el navegador no usa WebGPU)`);

const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${String(server.port)}`], { cwd: root });
tunnel.on('error', () => {
  say('\nNo encontré cloudflared, así que nadie de fuera puede entrar todavía. Instálalo y vuelve a correr npm run play:');
  say('  brew install cloudflared');
});
// cloudflared prints the address it got (https://<words>.trycloudflare.com) in its log, on stderr
let shared = false;
const watch = (chunk: Buffer) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
  if (!url || shared) return;
  shared = true;
  say('\n==============================================================');
  say(' Manda este enlace a tu hermano (Chrome o Edge en una compu):');
  say(`   ${url}/?multiplayer=1`);
  say(' Tú puedes entrar por el mismo enlace o por localhost.');
  say(' Mientras esta ventana esté abierta, el juego sigue en línea.');
  say('==============================================================\n');
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);

const stop = () => {
  tunnel.kill();
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
