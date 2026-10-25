// tools/build.ts — bundles the TypeScript client for the browser with esbuild: js/main.ts and the tile worker
// (js/world/tile-worker.ts) into dist/, with the multiplayer client split into its own chunk (it loads on demand,
// net/multiplayer.ts). three.js and Jolt stay out of the bundle: the page's import map serves them from jsDelivr.
//   node tools/build.ts            one minified build, for the page as it is published
//   node tools/build.ts --serve    rebuilds on every change and serves the repo at http://localhost:8765
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const serve = process.argv.includes('--serve');
const port = Number(process.env.PORT ?? 8765);

// The generated map data (9 MB, world/city-geodata.js) stays a file of its own next to the bundle, so a change to the
// code doesn't make returning players download the city again.
const GEODATA = 'js/world/city-geodata.js';
const geodata: esbuild.Plugin = {
  name: 'geodata',
  setup(build) {
    build.onResolve({ filter: /\/city-geodata\.js$/ }, () => ({ path: './city-geodata.js', external: true }));
    build.onEnd(() => {
      mkdirSync('dist', { recursive: true });
      copyFileSync(GEODATA, 'dist/city-geodata.js');
    });
  },
};

const options: esbuild.BuildOptions = {
  entryPoints: ['js/main.ts', 'js/world/tile-worker.ts'],
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  // WebGPU browsers only (Chrome 113+, Safari 26, Firefox 141): no need to lower modern syntax
  target: ['es2024'],
  // streaming.ts starts the worker at new URL('./tile-worker.ts', import.meta.url), so the worker, the entry and
  // their shared chunks all sit side by side in dist/
  entryNames: '[name]',
  chunkNames: '[name]-[hash]',
  external: ['three', 'three/*', 'jolt-physics'],
  sourcemap: 'linked',
  minify: !serve,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [geodata],
};

// A fresh dist/ each time: the chunks' names carry their content's hash, so the last build's would stay behind
rmSync('dist', { recursive: true, force: true });
if (serve) {
  const context = await esbuild.context(options);
  await context.watch();
  const { hosts } = await context.serve({ servedir: '.', port });
  console.log(`Slop Tepic on http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}`);
} else {
  await esbuild.build(options);
}
