require('dotenv').config();
const express = require('express');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { pool, init, computeBrain, toneMix, SEATS } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const MIN_HOLD = Number(process.env.MIN_HOLD || 100000);
const TONES = ['shitpost', 'analyst', 'doomer', 'motivational'];
const demoMode = () => !process.env.TOKEN_CA;

// Pre-launch: детерминированный демо-баланс из адреса кошелька (100k..3M).
// При лонче TOKEN_CA появится в env и баланс будет читаться он-чейн.
function demoBalance(wallet) {
  let h = 0;
  for (const c of wallet) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 100000 + (h % 30) * 100000;
}

const { getTokenBalance } = require('./rpc');

async function getBalance(wallet) {
  if (demoMode() || !process.env.RPC_URL) return demoBalance(wallet);
  try {
    return await getTokenBalance(wallet);
  } catch (e) {
    // минт ещё не залаунчен / RPC-сбой: баланс честно 0, стейк не проходит
    console.error('getBalance rpc failed:', e.message);
    return 0;
  }
}

function verifySig(wallet, message, signature) {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(wallet),
    );
  } catch {
    return false;
  }
}

// ---- Аватарки: прокси с кэшем в Postgres (unavatar рейт-лимитит, поэтому fxtwitter → pbs.twimg.com) ----
const initialSvg = (h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#efeaff"/><text x="48" y="62" font-family="monospace" font-size="40" font-weight="bold" fill="#6c4cf5" text-anchor="middle">${(h || '?')[0].toUpperCase()}</text></svg>`;

async function fetchAvatarRemote(handle) {
  let user = null;
  try {
    const r = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': 'persona-avatar-cache' },
    });
    if (r.ok) {
      const j = await r.json();
      user = j.user || null;
      let url = user && user.avatar_url;
      if (url) {
        url = url.replace('_normal', '_200x200');
        const ir = await fetch(url);
        if (ir.ok) return { buf: Buffer.from(await ir.arrayBuffer()), ct: ir.headers.get('content-type') || 'image/jpeg', user };
      }
    }
  } catch {}
  try {
    const u = await fetch(`https://unavatar.io/twitter/${encodeURIComponent(handle)}?fallback=false`);
    if (u.ok) return { buf: Buffer.from(await u.arrayBuffer()), ct: u.headers.get('content-type') || 'image/png', user };
  } catch {}
  return user ? { buf: null, ct: null, user } : null;
}

// Реальные метрики X-аккаунта (followers/tweets/joined) — из того же fxtwitter-ответа
async function saveMetrics(handle, user) {
  if (!user) return;
  await pool.query(
    'UPDATE influencers SET followers = $2, tweets = $3, joined = $4 WHERE handle = $1',
    [handle, user.followers || 0, user.tweets || 0, user.joined ? new Date(user.joined) : null],
  );
}

app.get('/avatar/:handle', async (req, res) => {
  const handle = req.params.handle.replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
  try {
    let { rows } = await pool.query('SELECT img, content_type FROM avatars WHERE handle = $1', [handle]);
    if (!rows.length) {
      const got = await fetchAvatarRemote(handle);
      if (got && got.buf) {
        await pool.query(
          'INSERT INTO avatars (handle, img, content_type) VALUES ($1, $2, $3) ON CONFLICT (handle) DO NOTHING',
          [handle, got.buf, got.ct],
        );
        rows = [{ img: got.buf, content_type: got.ct }];
      }
      if (got) await saveMetrics(handle, got.user).catch(() => {});
    }
    if (rows.length) {
      res.set('Content-Type', rows[0].content_type);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(rows[0].img);
    }
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(initialSvg(handle));
  } catch (e) {
    console.error('avatar failed:', handle, e.message);
    res.set('Content-Type', 'image/svg+xml');
    res.send(initialSvg(handle));
  }
});

// Прогрев кэша: добираем недостающие аватарки по одной, не душим fxtwitter
async function prefetchAvatars() {
  const { rows } = await pool.query(`
    SELECT i.handle FROM influencers i
    LEFT JOIN avatars a ON a.handle = i.handle
    WHERE i.active AND (a.handle IS NULL OR i.followers = 0)
  `);
  if (!rows.length) return;
  console.log(`prefetching ${rows.length} avatars/metrics...`);
  for (const { handle } of rows) {
    const got = await fetchAvatarRemote(handle);
    if (got && got.buf) {
      await pool.query(
        'INSERT INTO avatars (handle, img, content_type) VALUES ($1, $2, $3) ON CONFLICT (handle) DO NOTHING',
        [handle, got.buf, got.ct],
      );
    }
    if (got) await saveMetrics(handle, got.user).catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
  }
  console.log('avatar prefetch done');
}

app.get('/api/state', async (_req, res) => {
  try {
    const [influencers, holders, seatCount, brain, tones] = await Promise.all([
      pool.query(`
        SELECT i.id, i.handle, i.name, i.category, i.score,
               i.followers, i.tweets, i.joined,
               COUNT(h.wallet) AS minds
        FROM influencers i LEFT JOIN holders h ON h.influencer_id = i.id AND h.balance >= $1
        WHERE i.active
        GROUP BY i.id
        ORDER BY i.score DESC, i.name
      `, [MIN_HOLD]),
      pool.query(`
        SELECT h.wallet, h.balance, h.tone, h.is_seed, h.updated_at, i.handle AS influencer_handle, i.name AS influencer_name
        FROM holders h LEFT JOIN influencers i ON i.id = h.influencer_id
        WHERE h.balance >= $1 ORDER BY h.balance DESC LIMIT ${SEATS}
      `, [MIN_HOLD]),
      pool.query('SELECT COUNT(*) AS c FROM holders WHERE balance >= $1', [MIN_HOLD]),
      computeBrain(),
      toneMix(),
    ]);
    res.json({
      config: { minHold: MIN_HOLD, demoMode: demoMode(), tones: TONES, seats: SEATS },
      seatsTaken: Math.min(Number(seatCount.rows[0].c), SEATS),
      influencers: influencers.rows,
      holders: holders.rows.map(h => ({
        wallet: h.wallet,
        walletShort: h.wallet.slice(0, 4) + '..' + h.wallet.slice(-4),
        balance: Number(h.balance),
        tone: h.tone,
        isSeed: h.is_seed,
        stakedAt: h.updated_at,
        influencer: h.influencer_handle ? { handle: h.influencer_handle, name: h.influencer_name } : null,
      })),
      brain,
      tones,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'state failed' });
  }
});

app.post('/api/holder', async (req, res) => {
  try {
    const { wallet, message, signature, influencerId, tone } = req.body || {};
    if (!wallet || !message || !signature) return res.status(400).json({ error: 'wallet, message, signature required' });
    if (!message.includes(wallet)) return res.status(400).json({ error: 'message must contain wallet' });
    if (!verifySig(wallet, message, signature)) return res.status(401).json({ error: 'bad signature' });
    if (tone && !TONES.includes(tone)) return res.status(400).json({ error: 'bad tone' });

    const balance = await getBalance(wallet);
    if (balance < MIN_HOLD) return res.status(403).json({ error: `need at least ${MIN_HOLD} tokens`, balance });

    if (influencerId) {
      const inf = await pool.query('SELECT id FROM influencers WHERE id = $1 AND active', [influencerId]);
      if (!inf.rows.length) return res.status(400).json({ error: 'unknown influencer' });
    }

    await pool.query(`
      INSERT INTO holders (wallet, balance, influencer_id, tone, is_seed, updated_at)
      VALUES ($1, $2, $3, $4, false, now())
      ON CONFLICT (wallet) DO UPDATE SET
        balance = EXCLUDED.balance,
        influencer_id = COALESCE(EXCLUDED.influencer_id, holders.influencer_id),
        tone = COALESCE(EXCLUDED.tone, holders.tone),
        is_seed = false,
        updated_at = now()
    `, [wallet, balance, influencerId || null, tone || null]);

    res.json({ ok: true, balance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'holder failed' });
  }
});

app.get('/api/insights', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT v FROM kv WHERE k = 'insights'");
    res.json(rows.length ? JSON.parse(rows[0].v) : null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'insights failed' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { rows } = await pool.query(
      'SELECT id, content, brain, tone, created_at, posted, tweet_url, reply_to FROM posts ORDER BY id DESC LIMIT $1', [limit],
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'posts failed' });
  }
});

const PORT = process.env.PORT || 3000;
init().then(() => {
  app.listen(PORT, () => console.log(`persona web on :${PORT} (demo=${demoMode()})`));
  prefetchAvatars().catch(e => console.error('prefetch failed:', e.message));
});
