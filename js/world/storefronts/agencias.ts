// The new-car dealers (agencias), most of them along Av. Insurgentes Poniente: a showroom glazed two storeys up in
// the make's colours under its parody name (the cars' own joke on the make: models/cars), a tall pole sign out on the sidewalk,
// and in front the lot with the make's cars on show (js/world/car-parks.ts). `dealer`: the models on show, by id.
// The data builder only takes a car dealer's place for one of these (Overture's auto_dealer, OpenStreetMap's
// shop=car), never a body shop or a parts store that names the make.
import type { StorefrontSpec } from './index.ts';

const agencia = (id: string, match: RegExp, name: string, bg: string, fg: string, border: string, band: string, stripe: string,
  dealer: string[]): StorefrontSpec => ({
  id, match, name, sign: { bg, fg, border }, facade: { band, stripe, glazing: true, glaze: 5.2 }, pylon: { pole: '#c9ccd1', height: 9 }, dealer
});
export default [
  agencia('masda', /\bmazda\b/i, 'MÁSDÁ', '#101010', '#e6e6e6', '#9a9a9a', '#151515', '#9a9a9a', ['mazda-3', 'mazda-cx-5', 'mazda-mx-5']),
  agencia('totoya', /\btoyota\b/i, 'TOTOYA', '#ffffff', '#eb0a1e', '#eb0a1e', '#eb0a1e', '#ffffff',
    ['toyota-yaris', 'toyota-corolla', 'toyota-rav4', 'toyota-hilux', 'toyota-supra']),
  agencia('nisan', /\bnissan\b/i, 'NISÁN', '#1a1a1a', '#ffffff', '#c3002f', '#2b2b2b', '#c3002f',
    ['nissan-versa', 'nissan-march', 'nissan-sentra', 'nissan-kicks', 'nissan-x-trail', 'nissan-np300']),
  agencia('chebo', /\bchevrolet\b/i, 'CHEBO', '#2a2a2a', '#d1a12a', '#d1a12a', '#2a2a2a', '#d1a12a',
    ['chevrolet-aveo', 'chevrolet-onix', 'chevrolet-tracker', 'chevrolet-tahoe', 'chevrolet-silverado', 'chevrolet-camaro-ss']),
  agencia('buik-geemece', /\b(?:buick|gmc)\b/i, 'BUIK GEEMECÉ', '#1a1a1a', '#ffffff', '#cc0000', '#1a1a1a', '#cc0000', ['gmc-sierra']),
  agencia('vochowagen', /\b(?:volkswagen|vw)\b/i, 'VOCHOWAGEN', '#001e50', '#ffffff', '#ffffff', '#001e50', '#5ab4e6',
    ['volkswagen-virtus', 'volkswagen-jetta', 'volkswagen-tiguan', 'volkswagen-golf-gti', 'volkswagen-gol']),
  agencia('jonda', /\bhonda\b/i, 'JONDA', '#ffffff', '#cc0000', '#cc0000', '#d8d8d8', '#cc0000', ['honda-civic', 'honda-cr-v', 'honda-hr-v']),
  agencia('quiubo', /\bkia\b/i, 'QUIUBO', '#05141f', '#ffffff', '#ffffff', '#05141f', '#bb162b', ['kia-rio', 'kia-sportage']),
  agencia('jiundai', /\bhyundai\b/i, 'JIUNDÁI', '#002c5f', '#ffffff', '#ffffff', '#002c5f', '#00aad2', ['hyundai-grand-i10', 'hyundai-tucson']),
  agencia('forro', /\bford\b/i, 'FORRO', '#003478', '#ffffff', '#ffffff', '#003478', '#ffffff', ['ford-ranger', 'ford-lobo', 'ford-bronco', 'ford-mustang-gt']),
  agencia('yip-ramon-doch', /\b(?:jeep|dodge|ram|chrysler|peugeot|fiat)\b/i, 'YIP · RAMÓN · DOCH', '#000000', '#ffffff', '#ffffff', '#111111', '#8a8d91',
    ['jeep-wrangler', 'ram-700', 'ram-1500', 'dodge-challenger-hellcat']),
  agencia('mitsubichi', /\bmitsubishi\b/i, 'MITSUBICHI', '#ffffff', '#e60012', '#e60012', '#e60012', '#1a1a1a', ['mitsubishi-l200', 'mitsubishi-xpander']),
  agencia('reno', /\brenault\b/i, 'RENÓ', '#efdf00', '#000000', '#000000', '#1a1a1a', '#efdf00', ['renault-kwid', 'renault-duster']),
  agencia('suzuqui', /\bsuzuki\b/i, 'SUZUQUI', '#ffffff', '#e30613', '#003399', '#003399', '#e30613', ['suzuki-swift', 'suzuki-vitara']),
  agencia('yac', /\bjac\b/i, 'YAC', '#ffffff', '#c8102e', '#c8102e', '#c8102e', '#ffffff', ['jac-sei4-pro']),
  agencia('chirei', /\b(?:chirey|chery|omoda|jaecoo)\b/i, 'CHIRÉI', '#0d2c54', '#ffffff', '#ffffff', '#0d2c54', '#7a9cc6',
    ['chirey-tiggo-4-pro', 'chirey-tiggo-7-pro']),
  agencia('changan', /\bchangan\b/i, 'CHANGÁN', '#0047ab', '#ffffff', '#ffffff', '#0047ab', '#c9ccd1', ['changan-cs35-plus']),
  agencia('yili', /\bgeely\b/i, 'YILI', '#1c3f94', '#ffffff', '#ffffff', '#1c3f94', '#c9ccd1', ['geely-coolray']),
  agencia('megusta', /\bmg\b/i, 'MEGUSTA', '#a6192e', '#ffffff', '#ffffff', '#1a1a1a', '#a6192e', ['mg-5', 'mg-zs']),
  agencia('siat', /\bseat\b/i, 'SÍAT', '#1a1a1a', '#ffffff', '#ea5a28', '#1a1a1a', '#ea5a28', ['seat-ibiza']),
  agencia('baidi', /\bbyd\b/i, 'BAIDÍ', '#ffffff', '#1a1a1a', '#1a1a1a', '#e8e8e8', '#1a1a1a', ['byd-dolphin-mini'])
];
