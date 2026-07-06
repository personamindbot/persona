// Прозрачный фон для логип.png: флад-филл от краёв (светлые тайлы внутри мозга не трогаем)
const sharp = require('sharp');

const SRC = '/Users/nikita/Desktop/hood_2/логип.png';
const TOL = 42;

async function main() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const idx = (x, y) => (y * W + x) * 4;
  const bg = [data[0], data[1], data[2]];
  const close = (i) =>
    Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < TOL * 3;

  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push([x, 0], [x, H - 1]); }
  for (let y = 0; y < H; y++) { stack.push([0, y], [W - 1, y]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const p = y * W + x;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!close(i)) continue;
    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const base = sharp(data, { raw: { width: W, height: H, channels: 4 } }).png();
  const trimmed = await base.trim().toBuffer();
  await sharp(trimmed).toFile('/Users/nikita/Desktop/persona/public/logo.png');
  await sharp(trimmed).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile('/Users/nikita/Desktop/persona/public/favicon.png');
  console.log('saved public/logo.png + public/favicon.png');
}

main().catch(e => { console.error(e); process.exit(1); });
