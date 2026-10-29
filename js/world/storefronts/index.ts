// js/world/storefronts: one module per kind of chain store, read by the city data builder (tools/build-tepic-geodata.mjs,
// which finds each store's building in Overture Maps' places) and by the game (js/world/buildings.ts, which draws its front).
// Each storefront: { id, match (RegExp on the business's name or brand), name (the parody name on the sign), sign
// { bg, fg, border, stripe? } (CSS colours), facade { band, stripe, glazing } (the front's colours), pylon? { pole,
// height } (a pole sign at the corner), big (a supermarket or department store: its sign runs along the whole front),
// dealer? (a car dealer: the models on show in its lot, agencias.ts) }.
// To add a chain: write a module like oxxo.ts, list it below, and rebuild the city data. Earlier entries win; new ones
// go at the end (the city data names a chain by its place in the list).
import oxxo from './oxxo.ts';
import soriana from './soriana.ts';
import walmart from './walmart.ts';
import ley from './ley.ts';
import bodegaAurrera from './bodega-aurrera.ts';
import farmacias from './farmacias.ts';
import tiendas from './tiendas.ts';
import agencias from './agencias.ts';

/** A chain store's look: its sign's and its front's CSS colours, a pole sign at the corner of the lot (height m), and
 *  whether it is a big box (its sign runs along the whole front). */
export interface Storefront {
  id: string;
  /** on the business's name or brand */
  match: RegExp;
  /** the parody name on the sign */
  name: string;
  sign: { bg: string; fg: string; border: string; stripe?: string };
  /** glaze: m the glazing runs up the front (2.6 when left out: a convenience store's) */
  facade: { band: string; stripe: string; glazing: boolean; glaze?: number };
  pylon?: { pole: string; height: number };
  big: boolean;
  /** a car dealer: the models on show in its lot (models/cars ids) */
  dealer?: readonly string[];
}
/** A storefront module's entry (`big` false when left out). */
export type StorefrontSpec = Omit<Storefront, 'big'> & { big?: boolean };

const STOREFRONTS: Storefront[] = [oxxo, soriana, walmart, ley, bodegaAurrera, ...farmacias, ...tiendas, ...agencias].map((s) => ({ big: false, ...s }));

export { STOREFRONTS };
