// tests/helpers/i18n.cjs
// The i18n module (js/i18n/i18n.ts) as the loadModule tests stub it: the real one, over the real tables, speaking
// English (the language the tests' expected texts are written in)
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadModule } = require('./module.cjs');

const read = (path) => readFileSync(join(__dirname, '../..', path), 'utf8');
const en = loadModule(read('js/i18n/en.ts'));
const es = loadModule(read('js/i18n/es.ts'), { imports: { './en.ts': en } });
const i18n = loadModule(read('js/i18n/i18n.ts'), { imports: { './en.ts': en, './es.ts': es } });
i18n.setLocale('en');

module.exports = { i18n };
