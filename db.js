const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS influencers (
      id serial PRIMARY KEY,
      handle text UNIQUE NOT NULL,
      name text NOT NULL,
      category text,
      active boolean DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS holders (
      wallet text PRIMARY KEY,
      balance numeric NOT NULL DEFAULT 0,
      influencer_id int REFERENCES influencers(id),
      tone text,
      is_seed boolean DEFAULT false,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id serial PRIMARY KEY,
      content text NOT NULL,
      brain jsonb NOT NULL,
      tone text,
      created_at timestamptz DEFAULT now(),
      posted boolean DEFAULT false
    );
  `);
  await pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS tweet_url text');
  await pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS reply_to text');
  await pool.query('CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v text)');
  await pool.query('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS score int DEFAULT 0');
  await pool.query(`
    ALTER TABLE influencers
      ADD COLUMN IF NOT EXISTS followers bigint DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tweets bigint DEFAULT 0,
      ADD COLUMN IF NOT EXISTS joined timestamptz
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS avatars (
      handle text PRIMARY KEY,
      img bytea NOT NULL,
      content_type text NOT NULL DEFAULT 'image/jpeg',
      fetched_at timestamptz DEFAULT now()
    );
  `);
}

const SEATS = 50;

// Мозг агента: вес инфлюенсера = сумма балансов выбравших его холдеров.
// Мешают мозг только топ-SEATS холдеров по балансу (50 мест на карте).
async function computeBrain() {
  const { rows } = await pool.query(`
    WITH top AS (
      SELECT * FROM holders WHERE balance >= $1 ORDER BY balance DESC LIMIT ${SEATS}
    )
    SELECT i.id, i.handle, i.name, COALESCE(SUM(h.balance), 0) AS weight
    FROM influencers i
    JOIN top h ON h.influencer_id = i.id
    WHERE i.active
    GROUP BY i.id
    ORDER BY weight DESC
  `, [Number(process.env.MIN_HOLD || 100000)]);
  const total = rows.reduce((s, r) => s + Number(r.weight), 0);
  return rows.map(r => ({
    id: r.id,
    handle: r.handle,
    name: r.name,
    weight: Number(r.weight),
    pct: total ? (Number(r.weight) / total) * 100 : 0,
  }));
}

async function toneMix() {
  const { rows } = await pool.query(`
    WITH top AS (
      SELECT * FROM holders WHERE balance >= $1 ORDER BY balance DESC LIMIT ${SEATS}
    )
    SELECT tone, SUM(balance) AS weight FROM top
    WHERE tone IS NOT NULL
    GROUP BY tone ORDER BY weight DESC
  `, [Number(process.env.MIN_HOLD || 100000)]);
  const total = rows.reduce((s, r) => s + Number(r.weight), 0);
  return rows.map(r => ({ tone: r.tone, pct: total ? (Number(r.weight) / total) * 100 : 0 }));
}

module.exports = { pool, init, computeBrain, toneMix, SEATS };
