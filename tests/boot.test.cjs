const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const test = require('node:test');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([^]*?)<\/script>/);
const entries = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)];
const build = readFileSync(join(root, 'tools/build.ts'), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test('the bundle starts after the import map and before the stylesheets', () => {
  assert.ok(importMap);
  const stylesheetIndex = html.indexOf('rel="stylesheet"');
  assert.equal(entries.length, 1);
  assert.ok(importMap.index < entries[0].index);
  assert.ok(entries[0].index < stylesheetIndex, 'the bundle starts loading early');
  assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin\s*\/>/);
  assert.equal([...html.matchAll(/<script\b/g)].length, 2, 'only the import map and the bundle are needed');
  const { imports } = JSON.parse(importMap[1]);
  assert.equal(imports.three, imports['three/webgpu'], 'Three.js aliases share one module instance');
});

test('the page loads the entry esbuild writes, and the import map serves what the bundle leaves out', () => {
  assert.equal(entries[0][1], './dist/main.js');
  assert.match(build, /entryPoints: \['js\/main\.ts', 'js\/world\/tile-worker\.ts'\]/);
  assert.match(build, /outdir: 'dist'/);
  assert.match(build, /entryNames: '\[name\]'/);
  const { imports } = JSON.parse(importMap[1]);
  for (const external of build.match(/external: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)) {
    const name = external[1].replace(/\*$/, '');
    assert.ok(Object.keys(imports).some((key) => key === name || key === name.replace(/\/$/, '') || key.startsWith(name)),
      `the import map serves ${external[1]}`);
  }
  // streaming.ts starts the worker by its bundled name, next to the chunk that holds the streamer
  const streaming = readFileSync(join(root, 'js/world/streaming.ts'), 'utf8');
  assert.match(streaming, /new Worker\(new URL\('\.\/tile-worker\.js', import\.meta\.url\), \{ type: 'module' \}\)/);
});

test('every relative import names a module file that exists, with its own extension', () => {
  const files = [...walk(join(root, 'js')), ...walk(join(root, 'shared'))].filter((path) => path.endsWith('.ts'));
  assert.ok(files.length > 100);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      assert.match(specifier, /\.(ts|js)$/, `${file} imports ${specifier} without its extension`);
      const target = resolve(dirname(file), specifier);
      assert.ok(existsSync(target), `${file} imports ${specifier}, which doesn't exist`);
      if (specifier.endsWith('.js')) {
        assert.ok(existsSync(target.replace(/\.js$/, '.d.ts')), `${specifier} is plain JavaScript and needs its .d.ts`);
      }
    }
  }
});
