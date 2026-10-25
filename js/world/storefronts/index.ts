// js/world/storefronts: one module per kind of chain store, read by the city data builder (tools/build-tepic-geodata.mjs,
// which finds each store's building in Overture Maps' places) and by the game (js/world/buildings.ts, which draws its front).
// Each storefront: { id, match (RegExp on the business's name or brand), name (the parody name on the sign), sign
// { bg, fg, border, stripe? } (CSS colours), facade { band, stripe, glazing } (the front's colours), pylon? { pole,
// height } (a pole sign at the corner), big (a supermarket or department store: its sign runs along the whole front) }.
// To add a chain: write a module like oxxo.ts, list it below, and rebuild the city data. Earlier entries win.
import oxxo from './oxxo.ts';
import soriana from './soriana.ts';
import walmart from './walmart.ts';
import ley from './ley.ts';
import bodegaAurrera from './bodega-aurrera.ts';
import farmacias from './farmacias.ts';
import tiendas from './tiendas.ts';

/** A chain store's look: its sign's and its front's CSS colours, a pole sign at the corner of the lot (height m), and
 *  whether it is a big box (its sign runs along the whole front). */
export interface Storefront {
  id: string;
  /** on the business's name or brand */
  match: RegExp;
  /** the parody name on the sign */
  name: string;
  sign: { bg: string; fg: string; border: string; stripe?: string };
  facade: { band: string; stripe: string; glazing: boolean };
  pylon?: { pole: string; height: number };
  big: boolean;
}
/** A storefront module's entry (`big` false when left out). */
export type StorefrontSpec = Omit<Storefront, 'big'> & { big?: boolean };

const STOREFRONTS: Storefront[] = [oxxo, soriana, walmart, ley, bodegaAurrera, ...farmacias, ...tiendas].map((s) => ({ big: false, ...s }));

export { STOREFRONTS };
