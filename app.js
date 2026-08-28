/* ============================================================
   app.js — gate, live results, scoring, rendering.
   ============================================================ */

const PIT_ID = '23';
const COL_W = 62;
const CACHE_KEY = 'pit' + SEASON + ':results';
const UNLOCK_KEY = 'pit' + SEASON + ':unlocked';
const SEEN_KEY = 'pit' + SEASON + ':seenIntro';

const $ = sel => document.querySelector(sel);
const players = Object.keys(PREDICTIONS);

/* ---------- gate ---------- */

async function sha256(text) {
  if (!window.crypto || !crypto.subtle) throw new Error('insecure-context');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function setupGate() {
  const form = $('#gate-form');
  const input = $('#pass');
  const msg = $('#gate-msg');

  const submit = async () => {
    const value = input.value.trim();
    if (!value) return;
    msg.textContent = '';
    try {
      const hash = await sha256(value.toLowerCase());
      if (hash === PASS_HASH) {
        sessionStorage.setItem(UNLOCK_KEY, '1');
        openBoard(true);
      } else {
        msg.textContent = 'That passphrase does not match. Try again.';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        input.select();
      }
    } catch (err) {
      msg.textContent = 'This page needs to run over https or localhost to check the passphrase.';
    }
  };

  $('#unlock').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function openBoard(playIntro) {
  $('#gate').classList.add('gone');
  const reveal = () => {
    $('#skip').classList.add('gone');
    $('#app').classList.add('in');
    document.body.classList.add('boarded');
    BridgeScene.freeze();
    sessionStorage.setItem(SEEN_KEY, '1');
  };
  const seen = sessionStorage.getItem(SEEN_KEY);
  if (playIntro && !seen && BridgeScene.isReady() && !BridgeScene.prefersReduced()) {
    $('#skip').classList.remove('gone');
    BridgeScene.fly(reveal);
  } else {
    reveal();
  }
}

/* ---------- results ---------- */

function parseFeed(data) {
  const out = {};
  (data.events || []).forEach(ev => {
    if (!ev.seasonType || ev.seasonType.type !== 2) return;
    const comp = (ev.competitions || [])[0];
    if (!comp) return;
    const pit = (comp.competitors || []).find(c => c.id === PIT_ID);
    const opp = (comp.competitors || []).find(c => c.id !== PIT_ID);
    const st = (comp.status && comp.status.type) || {};
    let result = null;
    if (st.completed) {
      if (pit && pit.winner === true) result = 'W';
      else if (opp && opp.winner === true) result = 'L';
      else result = 'T';
    }
    out[ev.week.number] = {
      date: ev.date,
      result,
      state: st.state || 'pre',
      detail: st.shortDetail || '',
      pitScore: pit && pit.score ? pit.score.displayValue : null,
      oppScore: opp && opp.score ? opp.score.displayValue : null,
      opp: opp && opp.team ? opp.team.abbreviation : null
    };
  });
  return out;
}

async function fetchResults() {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/pit/schedule' +
    '?season=' + SEASON + '&seasontype=2';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('feed ' + res.status);
  const live = parseFeed(await res.json());
  if (!Object.keys(live).length) throw new Error('feed empty');
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), live }));
  return { live, source: 'live', at: Date.now() };
}

function fallbackResults() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (raw && raw.live) return { live: raw.live, source: 'cache', at: raw.at };
  } catch (e) { /* ignore */ }
  const live = {};
  Object.keys(MANUAL_RESULTS).forEach(w => { live[w] = { result: MANUAL_RESULTS[w], state: 'post', detail: 'Final' }; });
  return { live, source: 'manual', at: null };
}

/* ---------- scoring ---------- */

function buildGames(live) {
  return SCHEDULE.map(g => Object.assign({}, g, live[g.week] || {}));
}

function scoreSeason(games) {
  const done = games.filter(g => g.result);
  const actualW = done.filter(g => g.result === 'W').length;
  const actualL = done.filter(g => g.result === 'L').length;
  const actualT = done.filter(g => g.result === 'T').length;
  const remaining = games.length - done.length;

  const rows = players.map(name => {
    const picks = PREDICTIONS[name];
    let correct = 0, wrong = 0;
    const cells = games.map(g => {
      const pick = picks[g.week] || null;
      let state = 'pending';
      if (g.result === 'T') state = 'tie';
      else if (g.result) {
        if (pick === g.result) { state = 'hit'; correct++; } else { state = 'miss'; wrong++; }
      }
      return { week: g.week, pick, state };
    });
    const values = Object.keys(picks).map(k => picks[k]);
    const predW = values.filter(p => p === 'W').length;
    const predL = values.length - predW;
    const exactAlive = predW >= actualW && predW <= actualW + remaining;
    return { name, correct, wrong, played: correct + wrong, cells, predW, predL, exactAlive };
  });

  const seasonOver = remaining === 0;
  rows.sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    if (seasonOver) {
      const ea = a.predW === actualW ? 0 : 1;
      const eb = b.predW === actualW ? 0 : 1;
      if (ea !== eb) return ea - eb;
    }
    return a.name.localeCompare(b.name);
  });

  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (prev === null || r.correct !== prev) { rank = i + 1; prev = r.correct; }
    r.rank = rank;
  });

  return { rows, actualW, actualL, actualT, remaining, played: done.length, total: games.length };
}

function splitInfo(game) {
  const picks = players.map(n => PREDICTIONS[n][game.week]);
  const w = picks.filter(p => p === 'W').length;
  return { w, l: picks.length - w, split: w !== 0 && w !== picks.length };
}

/* ---------- rendering ---------- */

function label(game) {
  return (game.site === 'away' ? '@' : game.site === 'neutral' ? 'vs ' : '') + game.opp;
}

function shortDate(iso) {
  const d = new Date(/T/.test(iso) ? iso : iso + 'T12:00:00');
  if (isNaN(d)) return '';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function chainPath(width, height) {
  const halfTotal = width / 2;
  const halfMain = halfTotal * 0.519;
  const deck = height - 52;
  const top = 26;
  const mid = 74;
  const y = x => {
    const ax = Math.abs(x);
    if (ax <= halfMain) { const u = ax / halfMain; return mid - (mid - top) * u * u; }
    const u = (ax - halfMain) / (halfTotal - halfMain);
    return top + (deck - 4 - top) * Math.pow(u, 1.35);
  };
  let d = '';
  for (let x = -halfTotal; x <= halfTotal; x += 4) {
    d += (d ? ' L' : 'M') + (x + halfTotal).toFixed(1) + ' ' + y(x).toFixed(1);
  }
  return { d, deck, top, halfMain, halfTotal, yAt: x => y(x - halfTotal) };
}

function renderSpan(games, season) {
  const width = games.length * COL_W;
  const height = 168;
  const geo = chainPath(width, height);
  const nextIdx = games.findIndex(g => !g.result);
  const byeIdx = games.findIndex(g => g.week === 10);

  let ticks = '';
  games.forEach((g, i) => {
    const cx = i * COL_W + COL_W / 2;
    const done = !!g.result;
    const isNext = i === nextIdx;
    const cls = done ? (g.result === 'W' ? 'tk win' : g.result === 'L' ? 'tk loss' : 'tk tie') : 'tk';
    ticks += '<line class="hanger' + (done ? ' on' : '') + '" x1="' + cx + '" y1="' + geo.yAt(cx).toFixed(1) +
      '" x2="' + cx + '" y2="' + (geo.deck - 6) + '"/>';
    ticks += '<circle class="' + cls + (isNext ? ' next' : '') + '" cx="' + cx + '" cy="' + geo.deck + '" r="5"/>';
  });

  const towerX = [geo.halfTotal - geo.halfMain, geo.halfTotal + geo.halfMain];
  const towers = towerX.map(x =>
    '<line class="tower" x1="' + x.toFixed(1) + '" y1="' + (geo.top - 8) + '" x2="' + x.toFixed(1) + '" y2="' + (geo.deck + 16) + '"/>' +
    '<line class="tower thin" x1="' + (x - 9).toFixed(1) + '" y1="' + (geo.top + 14) + '" x2="' + (x + 9).toFixed(1) + '" y2="' + (geo.top + 14) + '"/>'
  ).join('');

  const bye = byeIdx > 0
    ? '<line class="bye" x1="' + (byeIdx * COL_W) + '" y1="' + (geo.deck - 26) + '" x2="' + (byeIdx * COL_W) + '" y2="' + (geo.deck + 22) + '"/>' +
      '<text class="bye-t" x="' + (byeIdx * COL_W) + '" y="' + (geo.deck + 36) + '">BYE</text>'
    : '';

  return '<svg class="span" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Season progress along the bridge deck">' +
    '<path class="chain" d="' + geo.d + '"/>' + towers + ticks +
    '<line class="deck" x1="0" y1="' + geo.deck + '" x2="' + width + '" y2="' + geo.deck + '"/>' +
    bye +
    '</svg>';
}

function renderStandings(season) {
  const leader = season.rows[0];
  const cards = season.rows.map(r => {
    const pct = r.played ? Math.round((r.correct / r.played) * 100) : 0;
    const gap = r.correct - leader.correct;
    const badge = season.remaining === 0
      ? (r.predW === season.actualW ? '<span class="pill on">Called the record</span>' : '')
      : (r.exactAlive ? '<span class="pill on">' + r.predW + '-' + r.predL + ' still live</span>'
                      : '<span class="pill off">' + r.predW + '-' + r.predL + ' out of reach</span>');
    return '<article class="card' + (r.rank === 1 && r.played ? ' lead' : '') + '">' +
      '<div class="card-top"><span class="rk">' + r.rank + '</span><h3>' + r.name + '</h3></div>' +
      '<p class="big">' + r.correct + '<span class="of">/ ' + r.played + '</span></p>' +
      '<p class="sub">' + (r.played ? pct + '% correct' : 'no games played') +
      (gap < 0 ? ' &middot; ' + gap + ' back' : '') + '</p>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      badge + '</article>';
  }).join('');
  $('#standings').innerHTML = cards;
}

function renderBoard(games, season) {
  const width = games.length * COL_W;
  let head = '<div class="cell hd nm">Week</div>';
  let res = '<div class="cell hd nm">Result</div>';

  games.forEach(g => {
    const sp = splitInfo(g);
    head += '<div class="cell hd' + (sp.split ? ' split' : '') + '">' +
      '<b>' + g.week + '</b><span>' + label(g) + '</span><i>' + shortDate(g.date) + '</i></div>';
    if (g.result) {
      res += '<div class="cell rs ' + (g.result === 'W' ? 'win' : g.result === 'L' ? 'loss' : 'tie') + '">' +
        '<b>' + g.result + '</b><span>' + (g.pitScore ? g.pitScore + '-' + g.oppScore : '') + '</span></div>';
    } else if (g.state === 'in') {
      res += '<div class="cell rs live"><b>LIVE</b><span>' + (g.pitScore ? g.pitScore + '-' + g.oppScore : '') + '</span></div>';
    } else {
      res += '<div class="cell rs pend"><b>&middot;</b></div>';
    }
  });

  const rows = season.rows.map(r => {
    let html = '<div class="cell nm plyr">' + r.name + '</div>';
    r.cells.forEach(c => {
      html += '<div class="cell pk ' + c.state + '">' + (c.pick || '&ndash;') + '</div>';
    });
    return html;
  }).join('');

  $('#board').innerHTML =
    '<div class="grid" style="grid-template-columns:132px repeat(' + games.length + ',' + COL_W + 'px)">' +
    '<div class="cell nm blank"></div>' +
    '<div class="span-cell" style="grid-column: span ' + games.length + '; width:' + width + 'px">' +
    renderSpan(games, season) + '</div>' +
    head + res + rows +
    '</div>';
}

function renderSwing(games, season) {
  const open = games.filter(g => !g.result && splitInfo(g).split);
  const decided = games.filter(g => g.result && splitInfo(g).split);
  if (!open.length && !decided.length) { $('#swing').innerHTML = ''; return; }

  const chip = g => {
    const sp = splitInfo(g);
    const who = players.filter(n => PREDICTIONS[n][g.week] === 'W');
    const notWho = players.filter(n => PREDICTIONS[n][g.week] === 'L');
    return '<li><b>Wk ' + g.week + ' ' + label(g) + '</b>' +
      '<span class="w">W: ' + (who.join(', ') || 'none') + '</span>' +
      '<span class="l">L: ' + (notWho.join(', ') || 'none') + '</span>' +
      (g.result ? '<em class="' + (g.result === 'W' ? 'win' : 'loss') + '">' + g.result + '</em>' : '') +
      '</li>';
  };

  $('#swing').innerHTML =
    '<h2>Where this gets decided</h2>' +
    '<p class="lede">' + (open.length + decided.length) + ' of ' + games.length +
    ' games have a split in the room. Everything else is a wash.</p>' +
    '<ul class="swings">' + open.map(chip).join('') + decided.map(chip).join('') + '</ul>';
}

function renderMeta(season, meta) {
  const rec = season.actualW + '-' + season.actualL + (season.actualT ? '-' + season.actualT : '');
  $('#record').innerHTML = season.played
    ? '<b>' + rec + '</b><span>through ' + season.played + ' of ' + season.total + '</span>'
    : '<b>0-0</b><span>Week 1 kicks off ' + shortDate(SCHEDULE[0].date) + '</span>';

  const when = meta.at ? new Date(meta.at).toLocaleString('en-US',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const src = meta.source === 'live' ? 'Live scores' :
    meta.source === 'cache' ? 'Cached scores, live feed unreachable' :
    'Manual results from data.js';
  $('#status').innerHTML = src + (when ? ' &middot; updated ' + when : '');
}

/* ---------- boot ---------- */

async function refresh() {
  let meta;
  try { meta = await fetchResults(); }
  catch (err) { meta = fallbackResults(); }
  const games = buildGames(meta.live);
  const season = scoreSeason(games);
  renderMeta(season, meta);
  renderStandings(season);
  renderBoard(games, season);
  renderSwing(games, season);
}

function boot() {
  const ok = BridgeScene.init($('#scene'));
  if (!ok) document.body.classList.add('no-3d');

  setupGate();
  $('#skip').addEventListener('click', () => BridgeScene.skip());
  $('#refresh').addEventListener('click', () => { $('#refresh').classList.add('spin'); refresh().finally(() => setTimeout(() => $('#refresh').classList.remove('spin'), 600)); });
  $('#replay').addEventListener('click', () => {
    if (!BridgeScene.isReady()) return;
    document.body.classList.remove('boarded');
    $('#app').classList.remove('in');
    $('#skip').classList.remove('gone');
    BridgeScene.resume();
    BridgeScene.fly(() => {
      $('#skip').classList.add('gone');
      $('#app').classList.add('in');
      document.body.classList.add('boarded');
      BridgeScene.freeze();
    });
  });

  if (sessionStorage.getItem(UNLOCK_KEY)) openBoard(false);
  else $('#pass').focus();

  refresh();
  setInterval(refresh, 90000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

document.addEventListener('DOMContentLoaded', boot);
