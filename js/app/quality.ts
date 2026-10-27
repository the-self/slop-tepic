// js/app/quality.ts
// The graphics tier: 'high' on a computer, 'low' on a touch screen (input/touch-controls.ts' TOUCH_SCREEN), or
// whichever `?quality=high|low` asks for. Measured on an M3 MacBook (2026-10-27, street level): the frame is bound by the CPU's
// draws (~12 µs each, ~1150 in the view) more than by its pixels, and among the GPU's passes the shadow cascades
// (~4 ms) and the screen-space reflections (~2 ms) cost the most. A phone has a few times less of both, so 'low'
// draws the props nearer, renders a smaller shadow map and leaves the reflections (and the attachments they read) out.
// Three-free: node --test imports it as it is.

export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  /** the sun's shadow map, per cascade (px; the device's limits may make it smaller) */
  shadowMapSize: number;
  /** screen-space reflections on the glossy surfaces (render-pipeline.ts) */
  ssr: boolean;
  /** scales how far the small props are drawn (render/scene-culling.ts) */
  propDistance: number;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', shadowMapSize: 3072, ssr: true, propDistance: 1 },
  // (1536 px over the near cascade's ~80 m: ~5 cm texels, still sharp under a car)
  low: { tier: 'low', shadowMapSize: 1536, ssr: false, propDistance: 0.6 }
};

const isTier = (name: string | null): name is QualityTier => name === 'high' || name === 'low';

/** The tier `requested` (the URL's `?quality=`), else 'low' on a touch screen (`touchScreen`) */
export function pickQuality(requested: string | null, touchScreen: boolean): QualitySettings {
  return TIERS[isTier(requested) ? requested : touchScreen ? 'low' : 'high'];
}
