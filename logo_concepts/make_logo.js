// Пиксель-мозг из тайлов с реальными аватарками инфлюенсеров (реф: grid_3x3 клетка 6).
// Собирается детерминированно: SVG с base64-аватарками → sharp → PNG.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BG = '#f4f2ec';
const INK = '#14120e';
const VIOLET = '#6c4cf5';

// Силуэт мозга: 0 = пусто, 1 = тайл. Хвостик-ствол внизу.
const SHAPE = [
  [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
];

// Топ по score — идут в аватарные клетки в шахматном порядке
const HANDLES = [
  'elonmusk', 'blknoiz06', 'realDonaldTrump', 'cobie', 'GiganticRebirth',
  'zachxbt', 'HsakaTrades', 'inversebrah', 'VitalikButerin', 'MustStopMurad',
  'cz_binance', 'theunipcs', 'notthreadguy', 'aixbt_agent', 'frankdegods',
  'Cupseyy', 'saylor', 'traderpow', 'SolJakey', 'CryptoHayes',
  'CryptoKaleo', 'Pentosh1', 'a1lon9', 'aeyakovenko', 'CryptoDonAlt',
  'Rewkang', '0xMert_', 'truth_terminal', 'gainzy222', 'balajis',
  'weremeow', 'RaoulGMI', 'CL207', 'loomdart', 'ZssBecker', 'shawmakesmagic',
];

const S = 96;   // тайл
const G = 3;    // зазор до чёрной подложки
const O = 10;   // толщина пиксель-обводки
const PAD = 60; // поля

async function fetchAvatar(handle) {
  try {
    const r = await fetch(`https://api.fxtwitter.com/${handle}`, { headers: { 'User-Agent': 'persona-logo' } });
    if (!r.ok) return null;
    const j = await r.json();
    let url = j.user && j.user.avatar_url;
    if (!url) return null;
    url = url.replace('_normal', '_200x200');
    const ir = await fetch(url);
    if (!ir.ok) return null;
    const buf = Buffer.from(await ir.arrayBuffer());
    // нормализуем в квадрат S — меньше base64, ровный кроп
    const png = await sharp(buf).resize(S, S, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

async function main() {
  console.log('fetching avatars...');
  const avatars = [];
  for (const h of HANDLES) {
    const a = await fetchAvatar(h);
    if (a) avatars.push(a);
    if (avatars.length >= 30) break;
  }
  console.log(`got ${avatars.length} avatars`);

  const rows = SHAPE.length, cols = SHAPE[0].length;
  const W = cols * S + PAD * 2, H = rows * S + PAD * 2;
  const px = (c) => PAD + c * S, py = (r) => PAD + r * S;

  let outline = '', tiles = '';
  let ai = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!SHAPE[r][c]) continue;
      outline += `<rect x="${px(c) - O}" y="${py(r) - O}" width="${S + 2 * O}" height="${S + 2 * O}" fill="${INK}"/>`;
      const isAvatar = (r + c) % 2 === 0 && ai < avatars.length;
      if (isAvatar) {
        tiles += `<image x="${px(c) + G}" y="${py(r) + G}" width="${S - 2 * G}" height="${S - 2 * G}" href="${avatars[ai++]}" preserveAspectRatio="xMidYMid slice"/>`;
      } else {
        tiles += `<rect x="${px(c) + G}" y="${py(r) + G}" width="${S - 2 * G}" height="${S - 2 * G}" fill="${VIOLET}"/>`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${outline}${tiles}
  </svg>`;

  const out = path.join(__dirname, 'logo_pixel_brain.png');
  await sharp(Buffer.from(svg)).resize(2048, null).png().toFile(out);
  console.log('saved', out, `(placed ${ai} avatars)`);

  // квадратная версия под аватарку токена (мозг по центру квадрата)
  const size = Math.max(W, H) + 40;
  const svgSq = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <g transform="translate(${(size - W) / 2},${(size - H) / 2})">${outline}${tiles}</g>
  </svg>`;
  const outSq = path.join(__dirname, 'logo_pixel_brain_square.png');
  await sharp(Buffer.from(svgSq)).resize(1024, 1024).png().toFile(outSq);
  console.log('saved', outSq);
}

main().catch(e => { console.error(e); process.exit(1); });
