require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { TwitterApi } = require('twitter-api-v2');
const { pool, init, computeBrain, toneMix } = require('./db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const INTERVAL = Number(process.env.POST_INTERVAL_MS || 300000);

// Реальный постинг в X: EXECUTE=true + OAuth1-ключи.
// Генерация каждые INTERVAL для ленты сайта, в X — не чаще TWEET_INTERVAL_MS
// (дефолт 90 мин, лимит Free-тира X API 500 постов/мес).
const EXECUTE = process.env.EXECUTE === 'true';
const TWEET_INTERVAL = Number(process.env.TWEET_INTERVAL_MS || 5400000);
let tw = null;
let twUsername = null;
if (EXECUTE && process.env.TW_APP_KEY) {
  tw = new TwitterApi({
    appKey: process.env.TW_APP_KEY,
    appSecret: process.env.TW_APP_SECRET,
    accessToken: process.env.TW_ACCESS_TOKEN,
    accessSecret: process.env.TW_ACCESS_SECRET,
  });
}

async function maybeTweet(postId, content) {
  if (!tw) return;
  const { rows } = await pool.query('SELECT MAX(created_at) AS t FROM posts WHERE posted');
  const last = rows[0].t ? new Date(rows[0].t).getTime() : 0;
  if (Date.now() - last < TWEET_INTERVAL) return;
  try {
    if (!twUsername) twUsername = (await tw.v2.me()).data.username;
    const r = await tw.v2.tweet(content);
    const url = `https://x.com/${twUsername}/status/${r.data.id}`;
    await pool.query('UPDATE posts SET posted = true, tweet_url = $2 WHERE id = $1', [postId, url]);
    console.log('tweeted:', url);
  } catch (e) {
    console.error('tweet failed:', e.message);
  }
}

function brainPrompt(brain, tones, recent) {
  const top = brain.slice(0, 6);
  const mix = top.map(b => `- ${b.name} (@${b.handle}): ${b.pct.toFixed(1)}% of the brain`).join('\n');
  const toneLine = tones.length
    ? tones.map(t => `${t.tone} ${t.pct.toFixed(0)}%`).join(', ')
    : 'analyst 100%';
  const avoid = recent.length
    ? `\n\nYour recent posts, do not repeat their ideas or structure:\n${recent.map(p => `- ${p.content}`).join('\n')}`
    : '';
  return `You are PERSONA, an AI agent whose personality is crowd-built by token holders. Each holder stakes their choice of a crypto twitter influencer, and your voice right now is this weighted blend:

${mix}

Tone mix voted by holders: ${toneLine}.

Write exactly ONE tweet as PERSONA. Channel the blend: borrow the hooks, rhythm, takes and attitude of the top influencers proportionally to their weight, the heaviest one should dominate the voice. Topics: crypto twitter life, markets, memecoins, AI agents, your own strange existence as a crowd-owned mind.

Rules:
- under 280 characters
- no hashtags, no emojis, no dashes
- lowercase is fine, CT-native style
- never mention the blend, the weights or that you are imitating anyone
- output ONLY the tweet text${avoid}`;
}

async function generatePost() {
  const [brain, tones] = await Promise.all([computeBrain(), toneMix()]);
  if (!brain.length) {
    console.log('brain is empty, skip');
    return;
  }
  const { rows: recent } = await pool.query('SELECT content FROM posts ORDER BY id DESC LIMIT 8');
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: brainPrompt(brain, tones, recent) }],
  });
  const textBlock = msg.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error(`no text block in response, stop_reason=${msg.stop_reason}`);
  const content = textBlock.text.trim().replace(/^["']|["']$/g, '');
  const dominantTone = tones.length ? tones[0].tone : 'analyst';
  const ins = await pool.query(
    'INSERT INTO posts (content, brain, tone, posted) VALUES ($1, $2, $3, false) RETURNING id',
    [content, JSON.stringify(brain.slice(0, 6).map(b => ({ handle: b.handle, name: b.name, pct: +b.pct.toFixed(1) }))), dominantTone],
  );
  console.log(`posted: ${content.slice(0, 80)}...`);
  await maybeTweet(ins.rows[0].id, content);
}

// ---- ответы на упоминания: агент отвечает тегнувшим, ответ дублируется в ленту сайта ----
const MENTIONS_POLL_MS = Number(process.env.MENTIONS_POLL_MS || 900000); // 15 мин — щадит лимиты чтения X API
const MAX_REPLIES_PER_POLL = 3;
let twUserId = null;

function replyPrompt(brain, tones, author, text) {
  const top = brain.slice(0, 6);
  const mix = top.map(b => `- ${b.name} (@${b.handle}): ${b.pct.toFixed(1)}%`).join('\n');
  return `You are PERSONA, an AI agent on crypto twitter whose voice is a crowd-built blend:

${mix}

@${author} mentioned you in this tweet:
"${text}"

Write exactly ONE reply as PERSONA. Stay in your blended voice, be sharp and human, engage with what they actually said. Under 240 characters. No hashtags, no emojis, no dashes. Never reveal you are imitating anyone. Output ONLY the reply text.`;
}

async function pollMentions() {
  if (!tw) return;
  if (!twUserId) {
    const me = await tw.v2.me();
    twUserId = me.data.id;
    twUsername = me.data.username;
  }
  const { rows } = await pool.query("SELECT v FROM kv WHERE k = 'last_mention_id'");
  const sinceId = rows.length ? rows[0].v : null;
  const opts = { max_results: 20, 'tweet.fields': 'author_id', expansions: 'author_id' };
  if (sinceId) opts.since_id = sinceId;
  const res = await tw.v2.userMentionTimeline(twUserId, opts);
  const mentions = res.tweets || [];
  if (!mentions.length) return;
  await pool.query(
    "INSERT INTO kv (k, v) VALUES ('last_mention_id', $1) ON CONFLICT (k) DO UPDATE SET v = $1",
    [mentions[0].id],
  );
  if (!sinceId) return; // первый запуск: только фиксируем позицию, на старое не отвечаем

  const users = Object.fromEntries((res.includes?.users || []).map(u => [u.id, u.username]));
  const [brain, tones] = await Promise.all([computeBrain(), toneMix()]);
  let replied = 0;
  for (const m of mentions.reverse()) {
    if (replied >= MAX_REPLIES_PER_POLL) break;
    const author = users[m.author_id];
    if (!author || author.toLowerCase() === (twUsername || '').toLowerCase()) continue;
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: replyPrompt(brain, tones, author, m.text) }],
      });
      const textBlock = msg.content.find(b => b.type === 'text');
      if (!textBlock) continue;
      const reply = textBlock.text.trim().replace(/^["']|["']$/g, '');
      const r = await tw.v2.reply(reply, m.id);
      const url = `https://x.com/${twUsername}/status/${r.data.id}`;
      await pool.query(
        'INSERT INTO posts (content, brain, tone, posted, tweet_url, reply_to) VALUES ($1, $2, $3, true, $4, $5)',
        [reply, JSON.stringify(brain.slice(0, 6).map(b => ({ handle: b.handle, name: b.name, pct: +b.pct.toFixed(1) }))), 'reply', url, author],
      );
      console.log(`replied to @${author}: ${url}`);
      replied++;
    } catch (e) {
      console.error('reply failed:', e.message);
    }
  }
}

async function mentionsLoop() {
  try {
    await pollMentions();
  } catch (e) {
    console.error('mentions poll failed:', e.message);
  }
  setTimeout(mentionsLoop, MENTIONS_POLL_MS);
}

// ---- инсайты: почему мозг говорит так, как говорит (для вкладки GRAPH и окна VOICE) ----
const INSIGHTS_REFRESH_MS = Number(process.env.INSIGHTS_REFRESH_MS || 1800000);

async function refreshInsights() {
  const [brain, tones] = await Promise.all([computeBrain(), toneMix()]);
  if (!brain.length) return;
  const top = brain.slice(0, 6);
  const mix = top.map(b => `- ${b.name} (@${b.handle}): ${b.pct.toFixed(1)}%`).join('\n');
  const toneLine = tones.map(t => `${t.tone} ${t.pct.toFixed(0)}%`).join(', ') || 'analyst 100%';
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `PERSONA is an AI agent whose voice is a weighted blend of crypto twitter influencers, staked by token holders.

Current brain:
${mix}

Tone votes: ${toneLine}.

Return STRICT JSON only, no markdown fences:
{
  "voice_summary": "2-3 sentences describing how PERSONA talks right now, in plain english, human tone",
  "dominant_tone": "one word",
  "notes": [
    {"handle": "...", "takes": "what stylistic trait PERSONA absorbs from this influencer, 4-8 words", "why": "why this trait won, referencing their weight or nature, 6-12 words"}
  ]
}
One note per influencer listed above.`,
    }],
  });
  const textBlock = msg.content.find(b => b.type === 'text');
  if (!textBlock) return;
  const raw = textBlock.text.trim().replace(/^```json?\s*|```$/g, '');
  const parsed = JSON.parse(raw);
  parsed.brain = top.map(b => ({ handle: b.handle, name: b.name, pct: +b.pct.toFixed(1) }));
  parsed.tones = tones.map(t => ({ tone: t.tone, pct: +t.pct.toFixed(1) }));
  parsed.updated_at = new Date().toISOString();
  await pool.query(
    "INSERT INTO kv (k, v) VALUES ('insights', $1) ON CONFLICT (k) DO UPDATE SET v = $1",
    [JSON.stringify(parsed)],
  );
  console.log('insights refreshed');
}

async function insightsLoop() {
  try {
    await refreshInsights();
  } catch (e) {
    console.error('insights failed:', e.message);
  }
  setTimeout(insightsLoop, INSIGHTS_REFRESH_MS);
}

async function loop() {
  try {
    await generatePost();
  } catch (e) {
    console.error('generate failed:', e.message);
  }
  setTimeout(loop, INTERVAL);
}

// Ре-верификация балансов после лонча: продал ниже MIN_HOLD → пузырь исчезает сам
const { getTokenBalance } = require('./rpc');
const REVERIFY_MS = Number(process.env.REVERIFY_MS || 300000);

async function reverifyBalances() {
  if (!process.env.TOKEN_CA || !process.env.RPC_URL) return; // pre-launch: демо-балансы не трогаем
  const { rows } = await pool.query('SELECT wallet FROM holders WHERE NOT is_seed');
  for (const { wallet } of rows) {
    try {
      const balance = await getTokenBalance(wallet);
      await pool.query('UPDATE holders SET balance = $2, updated_at = now() WHERE wallet = $1', [wallet, balance]);
    } catch (e) {
      console.error('reverify failed:', wallet, e.message);
    }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function reverifyLoop() {
  try {
    await reverifyBalances();
  } catch (e) {
    console.error('reverify loop failed:', e.message);
  }
  setTimeout(reverifyLoop, REVERIFY_MS);
}

init().then(() => {
  console.log(`persona worker: model=${MODEL}, interval=${INTERVAL}ms, execute=${EXECUTE}`);
  loop();
  reverifyLoop();
  insightsLoop();
  if (tw) mentionsLoop();
});
