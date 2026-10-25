// tools/port-to-ts.ts — after merging a branch written before the move to TypeScript: renames the JavaScript modules
// it added (js/**/*.js, shared/*.js, server/**/*.js; never the generated js/world/city-geodata.js) to .ts, with git mv
// so history follows them, and rewrites every relative specifier that named them as .js (imports between modules,
// static and dynamic; the tests' and tools' paths and the import names tests stub). It only plans by default.
//
//   node tools/port-to-ts.ts            print the plan
//   node tools/port-to-ts.ts --apply    rename & rewrite
//
// Then type the renamed modules until `npm run check` passes: they come over with no types (tsc lists what's missing).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = new Set(['js/world/city-geodata.js']); // (plain JavaScript on purpose, typed by its .d.ts)
const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', 'data', 'dist']);
const apply = process.argv.includes('--apply');

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else out.push(full);
  }
  return out;
}

// 1. The modules still in JavaScript
const modules = ['js', 'shared', 'server'].flatMap((dir) => walk(path.join(ROOT, dir)))
  .filter((f) => f.endsWith('.js') && !GENERATED.has(rel(f)));
const renamed = new Set(modules.map(rel));
// a module already in TypeScript, or one about to be
const isTs = (relJs: string) => renamed.has(relJs) || existsSync(path.join(ROOT, relJs.replace(/\.js$/, '.ts')));

// 2. Rewrite the specifiers that name one of them as .js: in the modules, relative to the file; in the tests and
//    tools, any quoted path (or stubbed specifier) whose tail is such a module
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+?)\.js\2/g;
const LOOSE_RE = /(['"`])((?:\.{1,2}\/|)(?:[\w.-]+\/)*[\w.-]+)\.js\1/g;
const sources = [...['js', 'shared', 'server'].flatMap((dir) => walk(path.join(ROOT, dir))).filter((f) => /\.(ts|js)$/.test(f))];
const others = [...walk(path.join(ROOT, 'tests')), ...walk(path.join(ROOT, 'tools'))].filter((f) => /\.(mjs|cjs|js|ts)$/.test(f));
const tails = [...walk(path.join(ROOT, 'js')), ...walk(path.join(ROOT, 'shared')), ...walk(path.join(ROOT, 'server'))]
  .map(rel).filter((f) => /\.(ts|js)$/.test(f) && !GENERATED.has(f)).map((f) => f.replace(/\.(ts|js)$/, ''));

const rewritten = new Map<string, string>();
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(SPEC_RE, (all: string, head: string, quote: string, spec: string) => {
    const target = rel(path.resolve(path.dirname(file), `${spec}.js`));
    return !GENERATED.has(target) && isTs(target) ? `${head}${quote}${spec}.ts${quote}` : all;
  });
  if (next !== text) rewritten.set(file, next);
}
for (const file of others) {
  if (file === fileURLToPath(import.meta.url)) continue;
  const text = readFileSync(file, 'utf8');
  const next = text.replace(LOOSE_RE, (all: string, quote: string, spec: string) => {
    const tail = spec.replace(/^(?:\.{1,2}\/)+/, '');
    // (the tile worker is loaded by its bundled name, dist/tile-worker.ts)
    if (tail.endsWith('tile-worker') || tail.endsWith('city-geodata')) return all;
    return tails.some((t) => t === tail || t.endsWith(`/${tail}`)) ? `${quote}${spec}.ts${quote}` : all;
  });
  if (next !== text) rewritten.set(file, next);
}

// 3. Report / apply
console.log(modules.length ? `${modules.length} modules to rename:` : 'No JavaScript modules left to rename.');
for (const f of modules) console.log(`  ${rel(f)} → ${rel(f).replace(/\.js$/, '.ts')}`);
console.log(`${rewritten.size} files with specifiers to update${rewritten.size ? ':' : '.'}`);
for (const f of rewritten.keys()) console.log(`  ${rel(f)}`);
if (!apply) {
  if (modules.length || rewritten.size) console.log('\nDry run. Re-run with --apply to do it.');
  process.exit(0);
}
for (const [file, text] of rewritten) writeFileSync(file, text);
const inGit = existsSync(path.join(ROOT, '.git'));
for (const f of modules) {
  const to = f.replace(/\.js$/, '.ts');
  if (inGit) execFileSync('git', ['mv', rel(f), rel(to)], { cwd: ROOT });
  else renameSync(f, to);
}
console.log('\nDone. Now type the renamed modules: npm run check (tsc, ESLint and the tests) lists what is missing.');
