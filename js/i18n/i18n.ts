// js/i18n/i18n.ts
// The game's languages: every text the player reads comes from one file per language (es.ts, en.ts; README.md says
// how to add one), looked up by key. Code asks for `t('toast.outOfGas')` or `t('prompt.buy', { item, price })`; the
// page's static text names its key in data-i18n attributes (data-i18n for the text, data-i18n-title,
// data-i18n-label for aria-label, data-i18n-placeholder, data-i18n-content). Choosing a language swaps the whole
// table: no code branches on the language. Free of three.js and of the DOM at load, so Node's tests import it.
import { en } from './en.ts';
import type { MessageKey, Messages } from './en.ts';
import { es } from './es.ts';

export type { MessageKey, Messages } from './en.ts';

/** Every language the game speaks, in the order the language button cycles through them */
const LOCALES = { es, en } satisfies Readonly<Record<string, Messages>>;
export type Locale = keyof typeof LOCALES;

/** Values put into a message's {placeholders} */
export type MessageParams = Readonly<Record<string, string | number>>;

const STORE_KEY = 'tepic-locale';
const PLACEHOLDER = /\{(\w+)\}/g;
const FALLBACK: Locale = 'es';

const isLocale = (code: unknown): code is Locale => typeof code === 'string' && Object.hasOwn(LOCALES, code);

function storedLocale(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null; // (no storage: Node, or storage blocked)
  }
}

// The saved choice, else the browser's first language the game speaks, else Spanish
const browserLanguages = typeof navigator === 'undefined' ? [] : navigator.languages.map((l) => l.slice(0, 2).toLowerCase());
let locale: Locale = [storedLocale(), ...browserLanguages].find(isLocale) ?? FALLBACK;
let messages: Messages = LOCALES[locale];
const listeners = new Set<(locale: Locale) => void>();

/** The language in use */
export function currentLocale(): Locale {
  return locale;
}

/** All the languages, in the language button's order */
export function locales(): readonly Locale[] {
  return Object.keys(LOCALES).filter(isLocale);
}

/** The text for `key` in the language in use, its {placeholders} filled from `params` */
export function t(key: MessageKey, params?: MessageParams): string {
  const text = messages[key];
  if (!params) return text;
  const values: Readonly<Partial<Record<string, string | number>>> = params; // (a placeholder it lacks stays as it is)
  return text.replace(PLACEHOLDER, (whole, name: string) => String(values[name] ?? whole));
}

/**
 * A name that may be a message key ('mode.person') or a proper name already (a car's 'Nisán Tsurito', a place's
 * 'Mercado Morelos'): the key's text, or the name as it is.
 */
export function tName(name: string): string {
  const table: Readonly<Partial<Record<string, string>>> = messages;
  return table[name] ?? name;
}

/** Calls `fn` with the new language whenever it changes; returns the unsubscribe */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Switches the language: remembers it, re-translates the page and tells the listeners */
export function setLocale(next: Locale): void {
  locale = next;
  messages = LOCALES[next];
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch { /* storage blocked: the choice lasts this visit */ }
  if (typeof document !== 'undefined') translatePage(document);
  for (const fn of listeners) fn(next);
}

/** Switches to the next language in the button's order */
export function cycleLocale(): void {
  const all = locales();
  setLocale(all[(all.indexOf(locale) + 1) % all.length]);
}

// What each data-i18n attribute (by its dataset name) sets on its element
const BINDINGS: readonly (readonly [attr: string, apply: (el: HTMLElement, text: string) => void])[] = [
  ['i18n', (el, text) => { el.textContent = text; }],
  ['i18nTitle', (el, text) => { el.title = text; }],
  ['i18nLabel', (el, text) => { el.setAttribute('aria-label', text); }],
  ['i18nPlaceholder', (el, text) => { el.setAttribute('placeholder', text); }],
  ['i18nContent', (el, text) => { el.setAttribute('content', text); }]
];
// (each dataset name's attribute: i18nTitle → [data-i18n-title])
const SELECTOR = BINDINGS.map(([attr]) => `[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`).join(', ');

/** Translates every element under `root` that names a key in a data-i18n attribute */
export function translatePage(root: Document | HTMLElement): void {
  if (root instanceof Document) root.documentElement.lang = locale;
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    for (const [attr, apply] of BINDINGS) {
      const key = el.dataset[attr];
      if (key) apply(el, tName(key));
    }
  }
}

/** Sets `el`'s text to `key`'s and keeps it translated when the language changes */
export function setText(el: HTMLElement, key: MessageKey): void {
  el.dataset.i18n = key;
  el.textContent = t(key);
}

/** Sets `el`'s title to `key`'s and keeps it translated when the language changes */
export function setTitle(el: HTMLElement, key: MessageKey): void {
  el.dataset.i18nTitle = key;
  el.title = t(key);
}

/** Sets `el`'s aria-label to `key`'s and keeps it translated when the language changes */
export function setLabel(el: HTMLElement, key: MessageKey): void {
  el.dataset.i18nLabel = key;
  el.setAttribute('aria-label', t(key));
}
