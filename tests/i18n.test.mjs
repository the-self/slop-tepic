import assert from 'node:assert/strict';
import test from 'node:test';
import { en } from '../js/i18n/en.ts';
import { es } from '../js/i18n/es.ts';
import { currentLocale, cycleLocale, locales, onLocaleChange, setLocale, t, tName } from '../js/i18n/i18n.ts';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every language has every text, with the same placeholders', () => {
  for (const [code, table] of Object.entries({ es })) {
    assert.deepEqual(Object.keys(table).sort(), Object.keys(en).sort(), code);
    for (const key of Object.keys(en)) assert.deepEqual(placeholders(table[key]), placeholders(en[key]), `${code} ${key}`);
  }
});

test('t fills the placeholders, and leaves one it is not given as it is', () => {
  setLocale('en');
  assert.equal(t('toast.thief', { take: 300 }), 'A thief took $300! Catch the thief');
  assert.equal(t('map.counts', { streets: 12 }), '12 streets · {blocks} blocks');
  setLocale('es');
  assert.equal(t('toast.thief', { take: 300 }), '¡Un ratero se llevó $300! Atrápalo');
});

test('tName translates a key and passes a proper name through', () => {
  setLocale('es');
  assert.equal(tName('vehicle.police'), 'Patrulla');
  assert.equal(tName('Nisán Tsurito'), 'Nisán Tsurito');
});

test('the language button cycles through every language and tells the listeners', () => {
  assert.deepEqual(locales(), ['es', 'en']);
  setLocale('es');
  const heard = [];
  const off = onLocaleChange((l) => heard.push(l));
  cycleLocale();
  assert.equal(currentLocale(), 'en');
  cycleLocale();
  assert.equal(currentLocale(), 'es');
  off();
  cycleLocale();
  assert.deepEqual(heard, ['en', 'es']);
  setLocale('es');
});
