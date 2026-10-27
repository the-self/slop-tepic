# Languages

Every text the player reads lives in one file per language, looked up by key:

- `en.ts`: English. It sets the keys every language has (`MessageKey`).
- `es.ts`: Español, the default (when neither the saved choice nor the browser's languages match one the game speaks).
- `i18n.ts`: picks the language, looks the texts up and translates the page.

## Use a text

In code: `t('toast.outOfGas')`, or with placeholders `t('prompt.buy', { item, price })` for
`'Comprar {item} (${price})'`. Never branch on the language: each file says it its own way.

Text set once on an element (a label built in code) goes through `setText(el, key)` (`setTitle`, `setLabel` for the
title and the aria-label), so it is re-translated when the player changes the language. In `index.html` the element
names its key: `data-i18n="tool.map"` for its text, `data-i18n-title`, `data-i18n-label` (aria-label),
`data-i18n-placeholder`, `data-i18n-content` (a meta tag).

Proper names (streets, places, the cars, the gangs) are not translated. Where a field holds either a key or a name
(a camera's name, a vehicle's label), `tName(name)` gives the key's text or the name as it is.

## Add a text

1. Add the key and its English to `en.ts`.
2. Add it to every other language: `npm run typecheck` says which file lacks it.

## Add a language

1. Copy `en.ts` to `<code>.ts` (`fr.ts`), name its table (`export const fr: Messages = { … }`, importing `Messages`
   from `./en.ts` as `es.ts` does) and translate every text. Keep the `{placeholders}` as they are.
2. Add it to `LOCALES` in `i18n.ts`: `{ es, en, fr }`. The order is the order the language button cycles through.

That's all: the language button and the browser's language pick it up.
