// GUALMART: the hypermarket (Walmart). Grey-blue front, blue band, a yellow spark beside the name.
import type { StorefrontSpec } from './index.ts';

export default {
  id: 'gualmart',
  match: /\bwal-?mart\b/i,
  name: 'GUALMART',
  sign: { bg: '#0071ce', fg: '#ffffff', border: '#ffc220' },
  facade: { band: '#0071ce', stripe: '#ffc220', glazing: true },
  big: true
} satisfies StorefrontSpec;
