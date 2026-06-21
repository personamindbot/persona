require('dotenv').config();
const { pool, init } = require('./db');

// Топ-100 CT-аккаунтов с высоким engagement. Score — кураторский PERSONA score
// (прокси твиттер-скора: охваты/конверт трафика), правится тут или в БД.
const INFLUENCERS = [
  ['elonmusk', 'Elon Musk', 'wildcard', 99],
  ['blknoiz06', 'Ansem', 'memelord', 98],
  ['realDonaldTrump', 'Donald Trump', 'wildcard', 96],
  ['cobie', 'Cobie', 'trader', 95],
  ['GiganticRebirth', 'GCR', 'trader', 93],
  ['zachxbt', 'ZachXBT', 'analyst', 92],
  ['HsakaTrades', 'Hsaka', 'trader', 92],
  ['inversebrah', 'inversebrah', 'memelord', 91],
  ['VitalikButerin', 'Vitalik', 'founder', 91],
  ['MustStopMurad', 'Murad', 'analyst', 90],
  ['WatcherGuru', 'Watcher Guru', 'news', 90],
  ['cz_binance', 'CZ', 'founder', 90],
  ['theunipcs', 'Bull (theunipcs)', 'trader', 89],
  ['notthreadguy', 'ThreadGuy', 'memelord', 89],
  ['aixbt_agent', 'aixbt', 'ai-agent', 88],
  ['frankdegods', 'Frank', 'founder', 88],
  ['unusual_whales', 'Unusual Whales', 'news', 88],
  ['Cupseyy', 'Cupsey', 'trader', 87],
  ['saylor', 'Michael Saylor', 'founder', 87],
  ['traderpow', 'pow', 'trader', 86],
  ['SolJakey', 'Jakey', 'memelord', 86],
  ['CryptoHayes', 'Arthur Hayes', 'analyst', 86],
  ['CryptoKaleo', 'Kaleo', 'trader', 85],
  ['Pentosh1', 'Pentoshi', 'trader', 85],
  ['a1lon9', 'alon', 'founder', 85],
  ['DegenerateNews', 'Degenerate News', 'news', 85],
  ['lookonchain', 'Lookonchain', 'news', 84],
  ['aeyakovenko', 'toly', 'founder', 84],
  ['CryptoDonAlt', 'DonAlt', 'trader', 84],
  ['Rewkang', 'Andrew Kang', 'trader', 84],
  ['0xMert_', 'mert', 'founder', 83],
  ['truth_terminal', 'Truth Terminal', 'ai-agent', 82],
  ['WuBlockchain', 'Wu Blockchain', 'news', 82],
  ['gainzy222', 'gainzy', 'memelord', 82],
  ['balajis', 'Balaji', 'founder', 81],
  ['brian_armstrong', 'Brian Armstrong', 'founder', 80],
  ['weremeow', 'meow', 'founder', 80],
  ['RaoulGMI', 'Raoul Pal', 'analyst', 80],
  ['CL207', 'CL', 'trader', 80],
  ['jessepollak', 'Jesse Pollak', 'founder', 79],
  ['loomdart', 'loomdart', 'memelord', 79],
  ['ZssBecker', 'Alex Becker', 'trader', 79],
  ['rajgokal', 'Raj Gokal', 'founder', 78],
  ['APompliano', 'Pomp', 'analyst', 78],
  ['DegenSpartan', 'DegenSpartan', 'memelord', 78],
  ['ThinkingUSD', 'Flood', 'trader', 78],
  ['beeple', 'beeple', 'memelord', 78],
  ['shawmakesmagic', 'Shaw', 'founder', 77],
  ['PeterLBrandt', 'Peter Brandt', 'trader', 77],
  ['lightcrypto', 'light', 'trader', 77],
  ['MacnBTC', 'Mac', 'memelord', 77],
  ['armaniferrante', 'Armani', 'founder', 76],
  ['EmperorBTC', 'EmperorBTC', 'trader', 76],
  ['TheCryptoDog', 'The Crypto Dog', 'trader', 76],
  ['Tree_of_Alpha', 'Tree', 'trader', 76],
  ['orangie', 'Orangie', 'memelord', 76],
  ['crediblecrypto', 'Credible Crypto', 'trader', 75],
  ['TheFlowHorse', 'Horse', 'trader', 75],
  ['0xSisyphus', 'Sisyphus', 'trader', 75],
  ['KookCapitalLLC', 'Kook', 'memelord', 75],
  ['punk6529', '6529', 'analyst', 75],
  ['SmartContracter', 'Bluntz', 'trader', 74],
  ['Trader_XO', 'Trader XO', 'trader', 74],
  ['icebergy_', 'Icebergy', 'trader', 74],
  ['cmsholdings', 'CMS', 'trader', 74],
  ['zoomerfied', 'zoomer', 'memelord', 74],
  ['farokh', 'Farokh', 'memelord', 74],
  ['milesdeutscher', 'Miles Deutscher', 'analyst', 74],
  ['TraderMayne', 'Mayne', 'trader', 73],
  ['AltcoinSherpa', 'Altcoin Sherpa', 'trader', 73],
  ['Arthur_0x', 'Arthur (DeFiance)', 'trader', 73],
  ['Ga__ke', 'Gake', 'trader', 73],
  ['cryptunez', 'tunez', 'memelord', 73],
  ['CryptoGodJohn', 'CryptoGodJohn', 'memelord', 73],
  ['RyanSAdams', 'Ryan Sean Adams', 'analyst', 73],
  ['ColdBloodShill', 'ColdBloodShill', 'trader', 72],
  ['CryptoMichNL', 'Michael van de Poppe', 'analyst', 72],
  ['ShockedJS', 'Shocked JS', 'trader', 72],
  ['DefiIgnas', 'Ignas', 'analyst', 72],
  ['sassal0x', 'sassal', 'analyst', 72],
  ['DylanLeClair_', 'Dylan LeClair', 'analyst', 72],
  ['AndyAyrey', 'Andy Ayrey', 'founder', 72],
  ['PostyXBT', 'Posty', 'trader', 71],
  ['TheCrowtrades', 'Crow', 'trader', 71],
  ['Fiskantes', 'Fiskantes', 'trader', 71],
  ['adamscochran', 'Adam Cochran', 'analyst', 71],
  ['MoonOverlord', 'Moon Overlord', 'trader', 70],
  ['TechDev_52', 'TechDev', 'analyst', 70],
  ['TheDeFiEdge', 'DeFi Edge', 'analyst', 70],
  ['Loopifyyy', 'Loopify', 'memelord', 70],
  ['WClementeIII', 'Will Clemente', 'analyst', 70],
  ['based16z', 'based16z', 'memelord', 70],
  ['CryptoUB', 'UB', 'trader', 69],
  ['KoroushAK', 'Koroush AK', 'trader', 69],
  ['Route2FI', 'Route 2 FI', 'analyst', 69],
  ['iamDCinvestor', 'DCinvestor', 'analyst', 69],
  ['nebraskangooner', 'Nebraskan Gooner', 'trader', 68],
  ['blockgraze', 'blockgraze', 'analyst', 68],
  ['Zeneca', 'Zeneca', 'analyst', 68],
  ['EllioTrades', 'Ellio', 'trader', 68],
];

// Демо-холдеры для pre-launch: карта живая, мозг собирается, ленту есть из чего генерить.
const SEED_HOLDERS = [
  ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 2400000, 'blknoiz06', 'shitpost'],
  ['4Nd1mY6beyond8ZqsFY5cJcUgQPzXX9AnYZ8JMkAgD5tR', 1800000, 'elonmusk', 'shitpost'],
  ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 1500000, 'cobie', 'analyst'],
  ['3xJq7fVprMtcEHwYzCzcEfTWS8V2ULhYzXbCrHhpqkJd', 1200000, 'blknoiz06', 'analyst'],
  ['6dNUJ1DyqgyxCWbFqAsPvhu2sVMBRyxhKrFEwJcbSVdA', 900000, 'MustStopMurad', 'motivational'],
  ['8gQzHbTuLxKcVjyPmWFN2mCrEACx4TbxWpV3v1FbnBtq', 800000, 'elonmusk', 'shitpost'],
  ['2ZjTR6vTqTFcSxAgYmXAJb4dcBUv9jEhMcbTt5jn9GpS', 700000, 'HsakaTrades', 'analyst'],
  ['5mPxWkHnRgqLcYyBDvJTA9UxbFEwZNqKphdCcQ9SnJuE', 600000, 'cobie', 'motivational'],
  ['AKM8sBcy4QDkFXzJf2nWq7vRxTpU6hHGaEeYtDL5cZvw', 500000, 'Cupseyy', 'shitpost'],
  ['BNRk2wTyhPqcXvJm9zUdG3sYbAfLoK6EHV8xeCtD4rMa', 400000, 'blknoiz06', 'doomer'],
  ['CQWm5xUzjRtdYwKn3aVeH7uZcBgMpL9FJW2yfDsE6qNb', 300000, 'loomdart', 'doomer'],
  ['DTXn8yVAkStewZLp6bWfJ4vAdChNqM2GKY5zgEuF9rPc', 200000, 'notthreadguy', 'shitpost'],
];

async function run() {
  await init();
  for (const [handle, name, category, score] of INFLUENCERS) {
    await pool.query(`
      INSERT INTO influencers (handle, name, category, score) VALUES ($1, $2, $3, $4)
      ON CONFLICT (handle) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, score = EXCLUDED.score, active = true
    `, [handle, name, category, score]);
  }
  await pool.query('DELETE FROM holders WHERE is_seed');
  for (const [wallet, balance, handle, tone] of SEED_HOLDERS) {
    await pool.query(`
      INSERT INTO holders (wallet, balance, influencer_id, tone, is_seed)
      VALUES ($1, $2, (SELECT id FROM influencers WHERE handle = $3), $4, true)
      ON CONFLICT (wallet) DO NOTHING
    `, [wallet, balance, handle, tone]);
  }
  const c = await pool.query('SELECT (SELECT count(*) FROM influencers) AS i, (SELECT count(*) FROM holders) AS h');
  console.log(`seeded: ${c.rows[0].i} influencers, ${c.rows[0].h} holders`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
