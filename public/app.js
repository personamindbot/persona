/* PERSONA frontend: bubble map + influencers table + brain composition + live feed */

const $ = (id) => document.getElementById(id);

// Аватар с гарантированным фоллбэком: unavatar → инлайн-SVG с инициалом
const initialSvg = (h) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#efeaff"/><text x="24" y="31" font-family="monospace" font-size="20" font-weight="bold" fill="#6c4cf5" text-anchor="middle">${(h || '?')[0].toUpperCase()}</text></svg>`,
);
// Аватарки идут через наш /avatar/:handle (кэш в Postgres на бэке),
// сервер сам отдаёт SVG-инициал если источник недоступен
const avatar = (h) => `/avatar/${encodeURIComponent(h)}`;
// страховка на сетевую ошибку самого прокси
document.addEventListener('error', (e) => {
  const el = e.target;
  const tag = (el.tagName || '').toLowerCase();
  if (el.dataset && el.dataset.fb) return;
  if (tag === 'img' && (el.src || '').includes('/avatar/')) {
    el.dataset.fb = '1';
    const m = el.src.match(/avatar\/([^?/]+)/);
    el.src = initialSvg(m ? decodeURIComponent(m[1]) : '?');
  } else if (tag === 'image') {
    const href = el.getAttribute('href') || '';
    if (!href.includes('/avatar/')) return;
    el.dataset.fb = '1';
    const m = href.match(/avatar\/([^?/]+)/);
    el.setAttribute('href', initialSvg(m ? decodeURIComponent(m[1]) : '?'));
  }
}, true);

let STATE = null;
let myWallet = null;
let selInfluencer = null;
let selTone = null;
let lastPostId = 0;

/* ---------- base58 (для подписи Phantom) ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  for (const byte of bytes) { if (byte === 0) digits.push(0); else break; }
  return digits.reverse().map(d => B58[d]).join('');
}

/* ---------- data ---------- */
async function fetchState() {
  const r = await fetch('/api/state');
  STATE = await r.json();
  renderTop();
  renderBrain();
  renderTones();
  renderMap();
  renderInfluencers();
}

async function fetchPosts() {
  const r = await fetch('/api/posts?limit=30');
  const posts = await r.json();
  renderFeed(posts);
}

const fmt = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
};
const ageYears = (joined) => {
  if (!joined) return '—';
  const y = (Date.now() - new Date(joined).getTime()) / 31557600000;
  return y >= 1 ? y.toFixed(0) + 'y' : Math.max(1, Math.round(y * 12)) + 'mo';
};

/* ---------- renders ---------- */
function renderTop() {
  $('statSeats').textContent = `${STATE.seatsTaken}/${STATE.config.seats}`;
  const total = STATE.holders.reduce((s, h) => s + h.balance, 0);
  $('statSupply').textContent = (total / 1e6).toFixed(2) + 'M';
}

function renderBrain() {
  const el = $('brainList');
  el.innerHTML = STATE.brain.map(b => `
    <a class="brain-row" href="https://x.com/${b.handle}" target="_blank" rel="noopener">
      <img src="${avatar(b.handle)}" alt="">
      <div class="brain-meta">
        <div class="brain-name">${b.name} <img src="svg/X-dark.svg" class="brand-icon xsm" alt="X"></div>
        <div class="brain-handle">@${b.handle}</div>
        <div class="brain-bar"><i style="width:${b.pct.toFixed(1)}%"></i></div>
      </div>
      <div class="brain-pct">${b.pct.toFixed(1)}%</div>
    </a>
  `).join('') || '<div class="brain-handle">brain is empty. claim a seat.</div>';
}

// Аудио-дорожка: псевдослучайные (детерминированные) палки, закрашенные до pct
function toneWaveSvg(tone, pct) {
  const N = 36;
  const seed = [...tone].reduce((s, c) => s + c.charCodeAt(0), 0);
  let bars = '';
  for (let i = 0; i < N; i++) {
    const h = 4 + 16 * Math.abs(Math.sin(i * 1.7 + seed) * Math.sin(i * 0.53 + seed * 2));
    const on = i / N < pct / 100;
    bars += `<rect x="${i * (100 / N)}%" y="${(22 - h) / 2}" width="1.6%" height="${h.toFixed(1)}"
      fill="${on ? 'var(--accent)' : 'var(--line)'}" style="animation-delay:${(i * 0.07).toFixed(2)}s"/>`;
  }
  return `<svg class="tone-wave" preserveAspectRatio="none">${bars}</svg>`;
}

function renderTones() {
  const el = $('toneList');
  el.innerHTML = STATE.tones.map(t => `
    <div class="tone-row">
      <span class="tone-name">${t.tone}</span>
      ${toneWaveSvg(t.tone, t.pct)}
      <span class="tone-pct">${t.pct.toFixed(0)}%</span>
    </div>
  `).join('') || '<div class="brain-handle">no votes yet</div>';
}

function renderInfluencers() {
  const brainById = Object.fromEntries(STATE.brain.map(b => [b.id, b.pct]));
  $('infRows').innerHTML = STATE.influencers.map((inf, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>
        <div class="inf-cell">
          <img src="${avatar(inf.handle)}" loading="lazy" alt="">
          <div>
            <a href="https://x.com/${inf.handle}" target="_blank" rel="noopener"><img src="svg/X-dark.svg" class="brand-icon" alt="X"> ${inf.name}</a>
            <div class="ih">@${inf.handle}</div>
          </div>
        </div>
      </td>
      <td><span class="cat-chip">${inf.category || ''}</span></td>
      <td><span class="score-val">${inf.score}</span></td>
      <td>${fmt(inf.followers)}</td>
      <td>${fmt(inf.tweets)}</td>
      <td>${ageYears(inf.joined)}</td>
      <td><span class="brain-val">${brainById[inf.id] ? brainById[inf.id].toFixed(1) + '%' : '—'}</span></td>
      <td>${inf.minds > 0 ? inf.minds : '—'}</td>
    </tr>
  `).join('');
}

// X-виджет: реально запощенный твит, клик ведёт на него
function tweetCard(p) {
  return `
    <a class="tweet-card live" href="${p.tweet_url}" target="_blank" rel="noopener">
      <div class="tw-head">
        <img class="tw-avatar" src="logo.png" alt="">
        <div class="tw-names">
          <span class="tw-name">PERSONA</span>
          <span class="tw-handle">@personamindbot · ${new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <img class="tw-x" src="svg/X-dark.svg" alt="X">
      </div>
      ${p.reply_to ? `<div class="tw-replyto">↳ replying to <a href="https://x.com/${p.reply_to}" target="_blank" rel="noopener" onclick="event.stopPropagation()">@${p.reply_to}</a></div>` : ''}
      <div class="post-content">${escapeHtml(p.content)}</div>
    </a>`;
}

// размышление: внутренний поток, без X — только мысль и из кого она собрана
function thoughtCard(p, hollow) {
  return `
    <div class="thought-card ${hollow ? 'newest' : ''}">
      <div class="post-content">${hollow ? '' : escapeHtml(p.content)}</div>
      <div class="post-meta">
        <span class="pm-tone">${p.tone || ''}</span>
        <span>${(p.brain || []).slice(0, 3).map(b =>
          `<a class="pm-inf" href="https://x.com/${b.handle}" target="_blank" rel="noopener">@${b.handle}</a> ${b.pct}%`
        ).join(' · ')}</span>
        <span>${new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>`;
}

function renderFeed(posts) {
  const tweets = posts.filter(p => p.tweet_url);
  const thoughts = posts.filter(p => !p.tweet_url);
  $('tweetsFeed').innerHTML = tweets.length
    ? tweets.map(tweetCard).join('')
    : '<div class="brain-handle">nothing posted to X yet.</div>';
  const el = $('feed');
  if (!thoughts.length) {
    el.innerHTML = '<div class="brain-handle">the mind has not spoken yet.</div>';
    return;
  }
  const newest = thoughts[0];
  const isNew = newest.id !== lastPostId;
  lastPostId = newest.id;
  lastPostAt = new Date(posts[0].created_at).getTime();
  el.innerHTML = thoughts.map((p, i) => thoughtCard(p, i === 0 && isNew)).join('');
  if (isNew) typewrite(el.querySelector('.thought-card.newest .post-content'), newest.content);
}

/* ---------- thinking-состояние между постами ---------- */
let lastPostAt = 0;
const THINK_PHRASES = [
  'absorbing the timeline',
  'weighing {n} minds',
  'channeling @{h}',
  'drafting a take',
  'arguing with itself',
  'reading the room',
  'compiling opinions into one voice',
];
setInterval(() => {
  const el = $('thinkingText');
  if (!el || !STATE) return;
  const p = THINK_PHRASES[Math.floor(Math.random() * THINK_PHRASES.length)]
    .replace('{n}', STATE.brain.length)
    .replace('{h}', STATE.brain.length ? STATE.brain[Math.floor(Math.random() * Math.min(3, STATE.brain.length))].handle : 'nobody');
  el.textContent = p;
  // только что запостил — коротко показываем «posted», потом снова думает
  $('thinking').classList.toggle('fresh', Date.now() - lastPostAt < 45000);
}, 4000);

function typewrite(node, text, i = 0) {
  if (!node) return;
  node.textContent = text.slice(0, i);
  if (i <= text.length) setTimeout(() => typewrite(node, text, i + 1), 18);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- bubble map (d3 force) ---------- */
let sim = null;
const LABEL_MIN_R = 22; // мелкие пузыри без подписи, чтобы не наслаивались
function renderMap() {
  const svg = d3.select('#map');
  const wrap = $('mapWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  const maxBal = d3.max(STATE.holders, h => h.balance) || 1;
  const rScale = d3.scaleSqrt().domain([0, maxBal]).range([12, Math.min(W, H) / 8]);
  // все 50 мест на карте: занятые — аватарки, свободные — призрачные слоты
  const empties = Array.from(
    { length: Math.max(0, (STATE.config.seats || 50) - STATE.holders.length) },
    (_, i) => ({ wallet: 'seat-' + i, empty: true, balance: 0, r: 13 }),
  );
  const nodes = [...STATE.holders.map(h => ({ ...h, r: rScale(h.balance) })), ...empties];

  const defs = svg.selectAll('defs').data([0]).join('defs');
  defs.selectAll('clipPath').data(nodes, d => d.wallet).join(
    enter => {
      const cp = enter.append('clipPath').attr('id', d => 'clip-' + d.wallet.slice(0, 8));
      cp.append('circle');
      return cp;
    },
  ).select('circle').attr('r', d => d.r * 0.72);

  // Нити: холдеры одного инфлюенсера связаны с крупнейшим из них (хабом)
  const byInf = {};
  nodes.forEach(n => {
    if (!n.influencer) return;
    (byInf[n.influencer.handle] = byInf[n.influencer.handle] || []).push(n);
  });
  const links = [];
  Object.values(byInf).forEach(group => {
    const hub = group.reduce((a, b) => (a.balance >= b.balance ? a : b));
    group.forEach(n => { if (n !== hub) links.push({ source: hub, target: n }); });
  });
  const threads = svg.selectAll('path.thread').data(links, d => d.source.wallet + '-' + d.target.wallet)
    .join('path').attr('class', 'thread').lower();

  const g = svg.selectAll('g.bubble').data(nodes, d => d.wallet).join(
    enter => {
      const b = enter.append('g').attr('class', 'bubble');
      b.append('circle').attr('class', 'ring');
      b.append('image');
      b.append('text').attr('text-anchor', 'middle');
      b.on('mousemove', (ev, d) => showTip(ev, d)).on('mouseleave', hideTip);
      b.on('click', (_ev, d) => d.empty ? claimSeat() : openHolderModal(d));
      return b;
    },
  );
  g.classed('mine', d => d.wallet === myWallet);
  g.classed('empty', d => !!d.empty);
  g.select('circle.ring').attr('r', d => d.r);
  g.select('image')
    .attr('href', d => (!d.empty && d.influencer) ? avatar(d.influencer.handle) : '')
    .attr('x', d => -d.r * 0.72).attr('y', d => -d.r * 0.72)
    .attr('width', d => d.r * 1.44).attr('height', d => d.r * 1.44)
    .attr('clip-path', d => `url(#clip-${d.wallet.slice(0, 8)})`);
  g.select('text')
    .attr('y', d => d.r + 11)
    .attr('font-size', d => Math.min(11, Math.max(9, d.r / 5)))
    .text(d => (!d.empty && d.r >= LABEL_MIN_R) ? d.walletShort : '');

  // Отступ коллизии учитывает подпись под пузырём — пузыри и подписи не перекрываются.
  // alphaTarget держит симуляцию живой, float покачивает пузыри как в невесомости.
  nodes.forEach((n, i) => { n.phase = (i * 2.399) % (Math.PI * 2); });
  if (sim) sim.stop();
  sim = d3.forceSimulation(nodes)
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('charge', d3.forceManyBody().strength(2))
    .force('collide', d3.forceCollide(d => d.r + (d.r >= LABEL_MIN_R ? 20 : 8)).strength(1).iterations(3))
    .force('x', d3.forceX(W / 2).strength(0.05))
    .force('y', d3.forceY(H / 2).strength(0.07))
    .force('float', () => {
      const t = performance.now() / 1000;
      nodes.forEach(n => {
        n.vx += Math.sin(t * 0.7 + n.phase) * 0.012;
        n.vy += Math.cos(t * 0.55 + n.phase * 1.3) * 0.012;
      });
    })
    .alphaTarget(0.03).alphaDecay(0.05)
    .on('tick', () => {
      g.attr('transform', d => {
        d.x = Math.max(d.r + 2, Math.min(W - d.r - 2, d.x));
        d.y = Math.max(d.r + 2, Math.min(H - d.r - 22, d.y));
        return `translate(${d.x},${d.y})`;
      });
      threads.attr('d', d => {
        const mx = (d.source.x + d.target.x) / 2, my = (d.source.y + d.target.y) / 2;
        const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(26, len * 0.18);
        return `M${d.source.x},${d.source.y} Q${mx - dy / len * bend},${my + dx / len * bend} ${d.target.x},${d.target.y}`;
      });
    });
}

// клик по свободному месту: коннект → модалка стейка
async function claimSeat() {
  if (!myWallet) return connect();
  openModal();
}

function showTip(ev, d) {
  const t = $('tooltip');
  t.classList.remove('hidden');
  t.innerHTML = d.empty
    ? '<div>open seat</div><div class="t-accent">stake 100k+ PERSONA to claim</div>'
    : `
    <div>${d.walletShort}${d.isSeed ? ' <span class="t-accent">(sim)</span>' : ''}</div>
    <div>${(d.balance / 1000).toFixed(0)}k PERSONA</div>
    <div class="t-accent">${d.influencer ? '@' + d.influencer.handle : 'no pick yet'} · ${d.tone || ''}</div>
  `;
  const rect = $('mapWrap').getBoundingClientRect();
  t.style.left = (ev.clientX - rect.left + 14) + 'px';
  t.style.top = (ev.clientY - rect.top + 8) + 'px';
}
function hideTip() { $('tooltip').classList.add('hidden'); }

/* ---------- holder modal (клик по пузырю) ---------- */
function openHolderModal(d) {
  hideTip();
  const rank = STATE.holders.findIndex(h => h.wallet === d.wallet) + 1;
  const totalTop = STATE.holders.reduce((s, h) => s + h.balance, 0);
  $('hmRank').textContent = rank;
  $('hmAvatar').src = d.influencer ? avatar(d.influencer.handle) : '';
  $('hmInfName').textContent = d.influencer ? d.influencer.name : 'no pick yet';
  $('hmInfHandle').textContent = d.influencer ? d.influencer.handle : '';
  $('hmInfLink').href = d.influencer ? `https://x.com/${d.influencer.handle}` : '#';
  const inf = d.influencer ? STATE.influencers.find(i => i.handle === d.influencer.handle) : null;
  $('hmFoll').textContent = inf ? `${fmt(inf.followers)} followers · score ${inf.score}` : '';
  $('hmWallet').textContent = d.wallet.slice(0, 8) + '...' + d.wallet.slice(-8);
  $('hmWalletLink').href = `https://solscan.io/account/${d.wallet}`;
  $('hmBalance').textContent = d.balance.toLocaleString('en-US');
  $('hmShare').textContent = totalTop ? ((d.balance / totalTop) * 100).toFixed(2) + '%' : '—';
  $('hmTone').textContent = d.tone || '—';
  $('hmStaked').textContent = d.stakedAt ? new Date(d.stakedAt).toLocaleString() : '—';
  $('hmSim').classList.toggle('hidden', !d.isSeed);
  $('holderModal').classList.remove('hidden');
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab[data-view]').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const view = t.dataset.view;
  $('map').classList.toggle('hidden', view !== 'map');
  $('graphView').classList.toggle('hidden', view !== 'graph');
  $('infView').classList.toggle('hidden', view !== 'inf');
  if (view === 'graph') renderGraph();
});

/* ---------- insights: граф связей + текущий голос ---------- */
let INSIGHTS = null;
async function fetchInsights() {
  try {
    const r = await fetch('/api/insights');
    INSIGHTS = await r.json();
    if (!$('graphView').classList.contains('hidden')) renderGraph();
  } catch {}
}

function wrapText(text, max) {
  const words = (text || '').split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 4);
}

function renderGraph() {
  const svg = d3.select('#graphView');
  const wrap = $('mapWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  svg.selectAll('*').remove();
  if (!INSIGHTS || !INSIGHTS.brain || !INSIGHTS.brain.length) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
      .attr('font-size', 13).attr('fill', 'var(--muted)')
      .text('the mind is still forming. insights arrive soon.');
    return;
  }
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 130;
  const notes = Object.fromEntries((INSIGHTS.notes || []).map(n => [String(n.handle || '').replace(/^@/, ''), n]));
  const nodes = INSIGHTS.brain.map((b, i) => {
    const a = -Math.PI / 2 + (i / INSIGHTS.brain.length) * Math.PI * 2;
    return { ...b, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, note: notes[b.handle] };
  });

  // нити от мозга к инфлюенсерам, толщина по весу
  nodes.forEach(n => {
    const mx = (cx + n.x) / 2, my = (cy + n.y) / 2;
    const dx = n.x - cx, dy = n.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    svg.append('path')
      .attr('class', 'g-thread')
      .attr('stroke-width', Math.max(1.2, n.pct / 8))
      .attr('d', `M${cx},${cy} Q${mx - dy / len * 30},${my + dx / len * 30} ${n.x},${n.y}`);
  });

  // центр: мозг
  const c = svg.append('g');
  c.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 62).attr('class', 'g-center');
  c.append('image').attr('href', 'logo.png')
    .attr('x', cx - 46).attr('y', cy - 46).attr('width', 92).attr('height', 92);
  c.append('text').attr('x', cx).attr('y', cy + 84).attr('text-anchor', 'middle')
    .attr('font-size', 12).attr('font-weight', 700).attr('fill', 'var(--ink)').text('PERSONA');

  // узлы-инфлюенсеры с объяснениями
  nodes.forEach(n => {
    const g = svg.append('g').attr('class', 'g-node').style('cursor', 'pointer')
      .on('click', () => window.open(`https://x.com/${n.handle}`, '_blank'));
    g.append('circle').attr('cx', n.x).attr('cy', n.y).attr('r', 30).attr('class', 'g-ring');
    g.append('clipPath').attr('id', 'gclip-' + n.handle)
      .append('circle').attr('cx', n.x).attr('cy', n.y).attr('r', 26);
    g.append('image').attr('href', avatar(n.handle))
      .attr('x', n.x - 26).attr('y', n.y - 26).attr('width', 52).attr('height', 52)
      .attr('clip-path', `url(#gclip-${n.handle})`);
    g.append('text').attr('x', n.x).attr('y', n.y - 40).attr('text-anchor', 'middle')
      .attr('font-size', 12).attr('font-weight', 700).attr('fill', 'var(--ink)')
      .text(`${n.name} · ${n.pct}%`);
    if (n.note) {
      const lines = [...wrapText('takes ' + n.note.takes, 30), ...wrapText('why: ' + n.note.why, 30)];
      lines.forEach((line, li) => {
        g.append('text').attr('x', n.x).attr('y', n.y + 46 + li * 13).attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('fill', li < wrapText('takes ' + n.note.takes, 30).length ? 'var(--accent)' : 'var(--muted)')
          .text(line);
      });
    }
  });
}

/* ---------- окно текущего голоса ---------- */
$('voiceBtn').onclick = () => {
  if (!INSIGHTS) return;
  $('voiceUpdated').textContent = INSIGHTS.updated_at ? new Date(INSIGHTS.updated_at).toLocaleString() : '—';
  $('voiceDominant').innerHTML = `<span class="stamp">${(INSIGHTS.dominant_tone || 'analyst').toUpperCase()}</span>`;
  $('voiceSummary').textContent = INSIGHTS.voice_summary || '';
  $('voiceTones').innerHTML = (INSIGHTS.tones || []).map(t => `
    <div class="tone-row">
      <span class="tone-name">${t.tone}</span>
      ${toneWaveSvg(t.tone, t.pct)}
      <span class="tone-pct">${t.pct.toFixed(0)}%</span>
    </div>
  `).join('');
  $('voiceModal').classList.remove('hidden');
};
$('voiceClose').onclick = () => $('voiceModal').classList.add('hidden');
$('voiceModal').onclick = (e) => { if (e.target === $('voiceModal')) $('voiceModal').classList.add('hidden'); };

/* ---------- wallet + stake modal ---------- */
async function connect() {
  if (!window.solana || !window.solana.isPhantom) {
    alert('Phantom not found. Install it first.');
    return;
  }
  const resp = await window.solana.connect();
  myWallet = resp.publicKey.toString();
  $('connectBtn').textContent = myWallet.slice(0, 4) + '..' + myWallet.slice(-4);
  openModal();
}

function infCardHtml(i) {
  return `
    <div class="inf-card" data-id="${i.id}" data-search="${(i.name + ' ' + i.handle).toLowerCase()}">
      <img src="${avatar(i.handle)}" loading="lazy" alt="">
      <div><div class="ic-name">${i.name}</div><div class="ic-handle">@${i.handle} · ${fmt(i.followers)}</div></div>
      <a class="ic-x" href="https://x.com/${i.handle}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><img src="svg/X-dark.svg" alt="X"></a>
    </div>
  `;
}

function openModal() {
  $('modal').classList.remove('hidden');
  $('modalWallet').textContent = myWallet.slice(0, 4) + '..' + myWallet.slice(-4);
  const mine = STATE.holders.find(h => h.wallet === myWallet);
  $('modalBalance').textContent = mine ? (mine.balance / 1000).toFixed(0) + 'k' : '(will be checked on stake)';
  $('infSearch').value = '';
  $('infGrid').innerHTML = STATE.influencers.map(infCardHtml).join('');
  $('toneGrid').innerHTML = STATE.config.tones.map(t => `
    <div class="tone-card" data-tone="${t}">${t}</div>
  `).join('');
  document.querySelectorAll('.inf-card').forEach(c => c.onclick = () => {
    document.querySelectorAll('.inf-card').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    selInfluencer = Number(c.dataset.id);
    updateStakeBtn();
  });
  document.querySelectorAll('.tone-card').forEach(c => c.onclick = () => {
    document.querySelectorAll('.tone-card').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    selTone = c.dataset.tone;
    updateStakeBtn();
  });
}

$('infSearch') && ($('infSearch').oninput = () => {
  const q = $('infSearch').value.toLowerCase().trim();
  document.querySelectorAll('.inf-card').forEach(c => {
    c.style.display = !q || c.dataset.search.includes(q) ? '' : 'none';
  });
});

function updateStakeBtn() { $('stakeBtn').disabled = !(selInfluencer && selTone); }

async function stake() {
  const msg = $('modalMsg');
  msg.classList.remove('err');
  try {
    msg.textContent = 'sign the message in Phantom...';
    const message = `PERSONA claim: ${myWallet} at ${Date.now()}`;
    const encoded = new TextEncoder().encode(message);
    const signed = await window.solana.signMessage(encoded, 'utf8');
    const signature = b58encode(signed.signature);
    msg.textContent = 'claiming your seat...';
    const r = await fetch('/api/holder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: myWallet, message, signature, influencerId: selInfluencer, tone: selTone }),
    });
    const data = await r.json();
    if (r.status === 403) {
      msg.classList.add('err');
      msg.innerHTML = `<span class="stamp">NOT ENOUGH PERSONA</span> need ${fmt(STATE.config.minHold)}+ to claim a seat · your balance ${fmt(data.balance || 0)}`;
      return;
    }
    if (!r.ok) throw new Error(data.error || 'stake failed');
    msg.textContent = `seat claimed. balance ${(data.balance / 1000).toFixed(0)}k. the brain is updating.`;
    await fetchState();
    setTimeout(() => $('modal').classList.add('hidden'), 1400);
  } catch (e) {
    msg.classList.add('err');
    msg.textContent = e.message;
  }
}

/* ---------- wiring ---------- */
$('connectBtn').onclick = connect;
$('modalClose').onclick = () => $('modal').classList.add('hidden');
$('hmClose').onclick = () => $('holderModal').classList.add('hidden');
$('holderModal').onclick = (e) => { if (e.target === $('holderModal')) $('holderModal').classList.add('hidden'); };
$('stakeBtn').onclick = stake;
window.addEventListener('resize', () => STATE && renderMap());

fetchState().then(fetchPosts).then(fetchInsights);
setInterval(fetchState, 20000);
setInterval(fetchPosts, 15000);
setInterval(fetchInsights, 60000);
