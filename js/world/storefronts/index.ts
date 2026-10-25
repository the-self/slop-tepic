// js/world/storefronts: one module per kind of chain store, read by the city data builder (tools/build-tepic-geodata.mjs,
// which finds each store's building in Overture Maps' places) and by the game (js/world/buildings.js, which draws its front).
// Each storefront: { id, match (RegExp on the business's name or brand), name (the parody name on the sign), sign
// { bg, fg, border, stripe? } (CSS colours), facade { band, stripe, glazing } (the front's colours), pylon? { pole,
// height } (a pole sign at the corner), big (a supermarket or department store: its sign runs along the whole front) }.
// To add a chain: write a module like oxxo.js, list it below, and rebuild the city data. Earlier entries win.
import oxxo from './oxxo.ts';
import soriana from './soriana.ts';
import walmart from './walmart.ts';
import ley from './ley.ts';
import bodegaAurrera from './bodega-aurrera.ts';
import farmacias from './farmacias.ts';
import tiendas from './tiendas.ts';

const STOREFRONTS = [oxxo, soriana, walmart, ley, bodegaAurrera, ...farmacias, ...tiendas].map((s) => ({ big: false, ...s }));

export { STOREFRONTS };
