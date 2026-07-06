// Баннер 3:1 (X header): полотно тайлов в стиле лого — все 100 инфлов из кэша БД,
// фиолетовые тайлы в шахматку, подпись "persona" в правом нижнем углу.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sharp = require('sharp');
const path = require('path');
const { Pool } = require('pg');

const INK = '#14120e';
const VIOLET = '#6c4cf5';
const SOFT = '#efeaff';
const BGP = '#f4f2ec';

const COLS = 21, ROWS = 7, S = 148, G = 4;
const W = COLS * S, H = ROWS * S;

// детерминированный шаффл
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const initialTile = (h) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="${SOFT}"/><text x="${S / 2}" y="${S / 2 + 22}" font-family="Menlo, monospace" font-size="64" font-weight="bold" fill="${VIOLET}" text-anchor="middle">${(h || '?')[0].toUpperCase()}</text></svg>`,
);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(`
    SELECT i.handle, i.score, a.img FROM influencers i
    LEFT JOIN avatars a ON a.handle = i.handle
    WHERE i.active ORDER BY i.score DESC LIMIT 100
  `);
  await pool.end();
  console.log(`influencers: ${rows.length}, with avatar: ${rows.filter(r => r.img).length}`);

  const tiles = [];
  for (const r of rows) {
    const src = r.img || initialTile(r.handle);
    const png = await sharp(src).resize(S - 2 * G, S - 2 * G, { fit: 'cover' }).png().toBuffer();
    tiles.push(`data:image/png;base64,${png.toString('base64')}`);
  }

  // позиции: резервируем правый нижний блок 3x1 под подпись
  const reserved = new Set([`${ROWS - 1}:${COLS - 1}`, `${ROWS - 1}:${COLS - 2}`, `${ROWS - 1}:${COLS - 3}`]);
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!reserved.has(`${r}:${c}`)) cells.push([r, c]);
  const rand = mulberry32(64);
  cells.sort(() => rand() - 0.5);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${INK}"/>`;
  cells.forEach(([r, c], i) => {
    const x = c * S + G, y = r * S + G, sz = S - 2 * G;
    if (i < tiles.length) {
      svg += `<image x="${x}" y="${y}" width="${sz}" height="${sz}" href="${tiles[i]}" preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      svg += `<rect x="${x}" y="${y}" width="${sz}" height="${sz}" fill="${VIOLET}"/>`;
    }
  });
  // подпись persona: спокойная плашка на 3 тайла
  const px = (COLS - 3) * S + G, py = (ROWS - 1) * S + G, pw = 3 * S - 2 * G, ph = S - 2 * G;
  svg += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${BGP}"/>
    <text x="${px + pw / 2}" y="${py + ph / 2 + 18}" font-family="Menlo, monospace" font-size="68" font-weight="bold" letter-spacing="8" fill="${INK}" text-anchor="middle">persona</text>
  </svg>`;

  const out = path.join(__dirname, 'banner_3000x1000.png');
  await sharp(Buffer.from(svg)).png().toFile(out);
  await sharp(Buffer.from(svg)).resize(1500, 500).png().toFile(path.join(__dirname, 'banner_1500x500.png'));
  console.log('saved', out, '+ banner_1500x500.png');
}

main().catch(e => { console.error(e); process.exit(1); });
