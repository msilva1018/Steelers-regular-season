/* ============================================================
   app.js — gate, live results, scoring, rendering.
   ============================================================ */

const PIT_ID = '23';
const COL_W = 62;
const CACHE_KEY = 'pit' + SEASON + ':results';
const UNLOCK_KEY = 'pit' + SEASON + ':unlocked';
const MANUAL_KEY = 'pit' + SEASON + ':manual';
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

/* Precedence, lowest to highest:
     schedule -> live feed -> MANUAL_RESULTS in data.js -> this browser's
     overrides from the manual panel. Anything entered by hand is an
     explicit instruction, so it beats the feed. */
function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) { return {}; }
}

function saveOverrides(ov) {
  try { localStorage.setItem(MANUAL_KEY, JSON.stringify(ov)); } catch (e) { /* ignore */ }
}

function setOverride(week, value) {
  const ov = loadOverrides();
  if (value) ov[week] = value; else delete ov[week];
  saveOverrides(ov);
  paint();
}

function buildGames(live) {
  const ov = loadOverrides();
  return SCHEDULE.map(g => {
    const out = Object.assign({}, g, live[g.week] || {});
    const forced = ov[g.week] || MANUAL_RESULTS[g.week] || null;
    if (forced) {
      out.result = forced;
      out.state = 'post';
      out.detail = 'Entered by hand';
      out.manual = true;
      out.byBrowser = !!ov[g.week];
      out.pitScore = null;
      out.oppScore = null;
    }
    return out;
  });
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
      res += '<div class="cell rs ' + (g.result === 'W' ? 'win' : g.result === 'L' ? 'loss' : 'tie') +
        (g.manual ? ' man' : '') + '">' +
        '<b>' + g.result + '</b><span>' +
        (g.manual ? 'by hand' : (g.pitScore ? g.pitScore + '-' + g.oppScore : '')) +
        '</span></div>';
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
  const n = Object.keys(loadOverrides()).length;
  $('#status').innerHTML = src + (when ? ' &middot; updated ' + when : '') +
    (n ? ' &middot; <b class="ovr">' + n + ' entered by hand</b>' : '');
}

/* ---------- manual entry ---------- */

function renderManual(games) {
  const ov = loadOverrides();
  const rows = games.map(g => {
    const cur = ov[g.week] || null;
    const fromFile = !cur && MANUAL_RESULTS[g.week] ? MANUAL_RESULTS[g.week] : null;
    const feed = !cur && !fromFile && g.result ? g.result : null;
    const btn = v => '<button type="button" data-week="' + g.week + '" data-set="' + v + '"' +
      (cur === v ? ' class="on"' : '') + '>' + v + '</button>';
    let note = '';
    if (fromFile) note = 'data.js: ' + fromFile;
    else if (feed) note = 'feed: ' + feed;
    return '<li>' +
      '<span class="wk">' + g.week + '</span>' +
      '<span class="opp">' + label(g) + '</span>' +
      '<span class="note">' + note + '</span>' +
      '<span class="set">' + btn('W') + btn('L') + btn('T') +
        '<button type="button" data-week="' + g.week + '" data-set="auto"' +
        (cur ? '' : ' class="on"') + '>Auto</button></span>' +
      '</li>';
  }).join('');

  const n = Object.keys(ov).length;
  $('#manual').innerHTML =
    '<h2>Enter results by hand</h2>' +
    '<p class="lede">Use this if the live feed stalls. Anything you set here beats the feed ' +
    'and is saved in <b>this browser only</b>, so the others will not see it. To publish a ' +
    'result to everyone, hit Copy and paste the line into <code>data.js</code>, then commit.</p>' +
    '<ul class="manual-list">' + rows + '</ul>' +
    '<div class="manual-foot">' +
      '<button type="button" id="manual-copy">Copy line for data.js</button>' +
      '<button type="button" id="manual-clear"' + (n ? '' : ' disabled') + '>' +
        'Clear ' + (n ? n + ' override' + (n === 1 ? '' : 's') : 'overrides') + '</button>' +
      '<span id="manual-said"></span>' +
    '</div>';
}

function manualLine() {
  const ov = loadOverrides();
  const merged = Object.assign({}, MANUAL_RESULTS, ov);
  const weeks = Object.keys(merged).map(Number).sort((x, y) => x - y);
  if (!weeks.length) return 'const MANUAL_RESULTS = {};';
  return 'const MANUAL_RESULTS = { ' +
    weeks.map(w => w + ": '" + merged[w] + "'").join(', ') + ' };';
}

/* ---------- the guy in the corner ----------
   One parameter drives the whole figure: t from -1 (the season has
   gone badly and he has stopped going to the gym) to +1 (the season
   is going well and he has not stopped). The silhouette is built
   from half-widths at fixed heights, so it morphs continuously
   instead of snapping between poses. */

const CX = 60;

function physiqueT(season) {
  const swing = season.actualW - season.actualL;
  return Math.max(-1, Math.min(1, swing / 7));
}

function physiqueLabel(t) {
  if (t <= -0.62) return 'Taking it hard';
  if (t <= -0.22) return 'Letting himself go';
  if (t <   0.22) return 'Holding steady';
  if (t <   0.62) return 'Putting in work';
  return 'Absolutely jacked';
}

/* smooth vertical spline through [x,y] stations, horizontal tangents */
function spline(pts) {
  let d = '';
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i], my = (p[1] + c[1]) / 2;
    d += 'C' + p[0].toFixed(1) + ' ' + my.toFixed(1) +
         ' ' + c[0].toFixed(1) + ' ' + my.toFixed(1) +
         ' ' + c[0].toFixed(1) + ' ' + c[1].toFixed(1);
  }
  return d;
}

function guySvg(t) {
  const j = Math.max(0, t);   /* jacked */
  const f = Math.max(0, -t);  /* not jacked */

  const shW    = 26 + 12.0 * j +  3.0 * f;
  const trapW  = 8 + 7.5 * j + 2.5 * f;
  const chestW = 25 + 14.5 * j +  9.0 * f;
  const ribW   = 21 +  5.5 * j + 16.5 * f;
  const waistW = 18 -  5.0 * j + 22.0 * f;
  const bellyW = 17 -  5.5 * j + 26.0 * f;
  const hipW   = 18 +  0.5 * j + 13.0 * f;

  const neckW  = 11 + 5.0 * j + 6.0 * f;
  const headRx = 13 + 2.6 * f;
  const headRy = 14.5 + 0.8 * f;

  const spread = 3 + 6.0 * j + 10.0 * f;
  const upW    = 9 + 5.5 * j + 5.0 * f;
  const bulge  = 2 + 5.5 * j + 1.5 * f;
  const faW    = 7 + 5.5 * j + 3.0 * f;
  const cuffY  = 89 - 9 * j;

  const thighW = 11 + 4.0 * j + 7.0 * f;
  const calfW  = 8 + 2.5 * j + 3.0 * f;

  /* torso silhouette */
  const st = [[trapW, 49], [shW, 59], [chestW, 71], [ribW, 85], [waistW, 100], [bellyW, 112], [hipW, 124]];
  const right = st.map(function (s) { return [CX + s[0], s[1]]; });
  const left = st.slice().reverse().map(function (s) { return [CX - s[0], s[1]]; });
  const torso = 'M' + right[0][0].toFixed(1) + ' ' + right[0][1] + spline(right) +
    'L' + left[0][0].toFixed(1) + ' ' + left[0][1] + spline(left) + 'Z';

  /* arms, one per side */
  function arm(sign) {
    const sx = CX + sign * shW * 0.90;
    const ex = sx + sign * spread;
    const wx = ex + sign * 1.5;
    const sleeve =
      'M' + (sx - sign * upW / 2).toFixed(1) + ' 58' +
      'L' + (sx + sign * upW / 2).toFixed(1) + ' 58' +
      'Q' + (ex + sign * (upW / 2 + bulge)).toFixed(1) + ' ' + (cuffY - 16).toFixed(1) + ' ' +
            (ex + sign * faW / 2).toFixed(1) + ' ' + cuffY.toFixed(1) +
      'L' + (ex - sign * faW / 2).toFixed(1) + ' ' + cuffY.toFixed(1) +
      'Q' + (sx - sign * (upW / 2 + 0.5)).toFixed(1) + ' ' + (cuffY - 15).toFixed(1) + ' ' +
            (sx - sign * upW / 2).toFixed(1) + ' 58Z';
    /* forearm bulges just below the cuff when there is something to bulge */
    const fore =
      'M' + (ex - sign * faW / 2).toFixed(1) + ' ' + (cuffY - 1).toFixed(1) +
      'L' + (ex + sign * faW / 2).toFixed(1) + ' ' + (cuffY - 1).toFixed(1) +
      'Q' + (ex + sign * (faW / 2 + 2.5 * j)).toFixed(1) + ' ' + (cuffY + 9).toFixed(1) + ' ' +
            (wx + sign * faW * 0.36).toFixed(1) + ' 112' +
      'L' + (wx - sign * faW * 0.36).toFixed(1) + ' 112' +
      'Q' + (ex - sign * faW * 0.55).toFixed(1) + ' ' + (cuffY + 9).toFixed(1) + ' ' +
            (ex - sign * faW / 2).toFixed(1) + ' ' + (cuffY - 1).toFixed(1) + 'Z';
    return '<path d="' + fore + '" fill="#c39a76"/>' +
           '<path d="' + sleeve + '" fill="#20272e" stroke="#586773" stroke-width="1.1"/>' +
           '<rect x="' + (ex - sign * faW / 2 - (sign > 0 ? 0 : faW)).toFixed(1) +
             '" y="' + (cuffY - 4).toFixed(1) + '" width="' + faW.toFixed(1) +
             '" height="4.5" fill="#c9a12b"/>' +
           '<circle cx="' + wx.toFixed(1) + '" cy="115" r="' + (4.2 + 1.2 * j).toFixed(1) +
             '" fill="#c39a76"/>';
  }

  /* legs */
  function leg(sign) {
    const hx = CX + sign * hipW * 0.44;
    const kx = CX + sign * (hipW * 0.44 + 1);
    const pants =
      'M' + (hx - thighW / 2).toFixed(1) + ' 122' +
      'L' + (hx + thighW / 2).toFixed(1) + ' 122' +
      'L' + (kx + calfW / 2).toFixed(1) + ' 152' +
      'L' + (kx - calfW / 2).toFixed(1) + ' 152Z';
    const sock =
      'M' + (kx - calfW / 2).toFixed(1) + ' 151' +
      'L' + (kx + calfW / 2).toFixed(1) + ' 151' +
      'L' + (kx + calfW * 0.40).toFixed(1) + ' 176' +
      'L' + (kx - calfW * 0.40).toFixed(1) + ' 176Z';
    return '<path d="' + pants + '" fill="#c9a12b"/>' +
           '<path d="' + sock + '" fill="#12161a"/>' +
           '<rect x="' + (kx - calfW / 2).toFixed(1) + '" y="155" width="' +
             calfW.toFixed(1) + '" height="3" fill="#c9a12b"/>' +
           '<path d="M' + (kx - calfW * 0.40 - 1).toFixed(1) + ' 176 L' +
             (kx + calfW * 0.40 + 3.5).toFixed(1) + ' 176 L' +
             (kx + calfW * 0.40 + 4.5).toFixed(1) + ' 182 L' +
             (kx - calfW * 0.40 - 2).toFixed(1) + ' 182Z" fill="#2b3238"/>';
  }

  /* head, with the face doing a little of the work */
  const headCy = 32;
  const mouthY = headCy + 7.5;
  const mouthCurve = 3.0 * t;
  const browTilt = 1.6 * f;
  const chin = f > 0.42
    ? '<path d="M' + (CX - headRx * 0.62).toFixed(1) + ' ' + (headCy + headRy * 0.80).toFixed(1) +
      ' Q' + CX + ' ' + (headCy + headRy + 3.4 * f).toFixed(1) + ' ' +
      (CX + headRx * 0.62).toFixed(1) + ' ' + (headCy + headRy * 0.80).toFixed(1) +
      '" fill="#b98e6b"/>'
    : '';

  const numSize = 22 + 4 * j + 3 * f;

  return '' +
  '<svg viewBox="0 0 120 190" xmlns="http://www.w3.org/2000/svg" role="img" ' +
       'aria-label="Fan physique tracking the season record">' +
    leg(-1) + leg(1) +
    '<rect x="' + (CX - neckW / 2).toFixed(1) + '" y="42" width="' + neckW.toFixed(1) +
      '" height="18" rx="' + (neckW / 3).toFixed(1) + '" fill="#b98e6b"/>' +
    '<path d="' + torso + '" fill="#20272e" stroke="#5b6a76" stroke-width="1.2"/>' +
    /* collar */
    '<path d="M' + (CX - neckW / 2 - 5).toFixed(1) + ' 57 Q' + CX + ' 66 ' +
      (CX + neckW / 2 + 5).toFixed(1) + ' 57" stroke="#c9a12b" stroke-width="3" fill="none"/>' +
    '<text class="num" x="' + CX + '" y="' + (92 + 2 * f).toFixed(1) + '" font-size="' +
      numSize.toFixed(1) + '" text-anchor="middle">26</text>' +
    /* pec line when he is training, belly fold when he is not */
    '<g stroke="#0f1418" stroke-width="1.3" fill="none" stroke-linecap="round">' +
      '<path d="M' + (CX - chestW * 0.52).toFixed(1) + ' 74 Q' + CX + ' 80 ' +
        (CX + chestW * 0.52).toFixed(1) + ' 74" opacity="' + (j * 0.85).toFixed(2) + '"/>' +
      '<path d="M' + CX + ' 70 L' + CX + ' ' + (70 + 16 * j).toFixed(1) +
        '" opacity="' + (j * 0.6).toFixed(2) + '"/>' +
      '<path d="M' + (CX - bellyW * 0.55).toFixed(1) + ' 105 Q' + CX + ' 112 ' +
        (CX + bellyW * 0.55).toFixed(1) + ' 105" opacity="' + (f * 0.8).toFixed(2) + '"/>' +
    '</g>' +
    arm(-1) + arm(1) +
    chin +
    '<ellipse cx="' + CX + '" cy="' + headCy + '" rx="' + headRx.toFixed(1) +
      '" ry="' + headRy.toFixed(1) + '" fill="#c39a76"/>' +
    '<ellipse cx="' + (CX - headRx - 0.6).toFixed(1) + '" cy="' + (headCy + 1) +
      '" rx="2.2" ry="3.2" fill="#b98e6b"/>' +
    '<ellipse cx="' + (CX + headRx + 0.6).toFixed(1) + '" cy="' + (headCy + 1) +
      '" rx="2.2" ry="3.2" fill="#b98e6b"/>' +
    /* hair */
    '<path d="M' + (CX - headRx * 1.02).toFixed(1) + ' ' + (headCy - 2.5).toFixed(1) +
      ' Q' + CX + ' ' + (headCy - headRy * 2.05).toFixed(1) + ' ' +
      (CX + headRx * 1.02).toFixed(1) + ' ' + (headCy - 2.5).toFixed(1) +
      ' Q' + CX + ' ' + (headCy - headRy * 0.72).toFixed(1) + ' ' +
      (CX - headRx * 1.02).toFixed(1) + ' ' + (headCy - 2.5).toFixed(1) +
      'Z" fill="#2b2320"/>' +
    /* eyes and brows */
    '<circle cx="' + (CX - 4.6).toFixed(1) + '" cy="' + (headCy + 1).toFixed(1) + '" r="1.5" fill="#20272c"/>' +
    '<circle cx="' + (CX + 4.6).toFixed(1) + '" cy="' + (headCy + 1).toFixed(1) + '" r="1.5" fill="#20272c"/>' +
    '<path d="M' + (CX - 7).toFixed(1) + ' ' + (headCy - 3.6 + browTilt).toFixed(1) +
      ' L' + (CX - 2.2).toFixed(1) + ' ' + (headCy - 4.4).toFixed(1) +
      '" stroke="#2b2320" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M' + (CX + 7).toFixed(1) + ' ' + (headCy - 3.6 + browTilt).toFixed(1) +
      ' L' + (CX + 2.2).toFixed(1) + ' ' + (headCy - 4.4).toFixed(1) +
      '" stroke="#2b2320" stroke-width="1.3" stroke-linecap="round"/>' +
    /* mouth */
    '<path d="M' + (CX - 4.2).toFixed(1) + ' ' + mouthY.toFixed(1) +
      ' Q' + CX + ' ' + (mouthY + mouthCurve).toFixed(1) + ' ' +
      (CX + 4.2).toFixed(1) + ' ' + mouthY.toFixed(1) +
      '" stroke="#8a6047" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
  '</svg>';
}

let guyShown = 0, guyTarget = 0, guyFrom = 0, guyStart = 0, guyRaf = null, guyRecord = '0-0';
const GUY_MS = 900;

function paintGuy() {
  const art = $('#guy-art');
  if (!art) return;
  art.innerHTML = guySvg(guyShown);
  $('#guy-label').innerHTML =
    '<b>' + physiqueLabel(guyShown) + '</b><span>' + guyRecord + '</span>';
}

/* time based, so it lands on the target regardless of frame rate */
function stepGuy(now) {
  const p = Math.min((now - guyStart) / GUY_MS, 1);
  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  guyShown = guyFrom + (guyTarget - guyFrom) * e;
  paintGuy();
  guyRaf = p < 1 ? requestAnimationFrame(stepGuy) : null;
}

function renderGuy(season) {
  guyRecord = season.actualW + '-' + season.actualL +
    (season.actualT ? '-' + season.actualT : '');
  const next = physiqueT(season);
  if (Math.abs(next - guyTarget) < 0.0005 && guyRaf === null) { paintGuy(); return; }
  guyFrom = guyShown;
  guyTarget = next;
  guyStart = performance.now();
  if (guyRaf === null) guyRaf = requestAnimationFrame(stepGuy);
}

/* ---------- boot ---------- */

let lastMeta = null;

function paint() {
  if (!lastMeta) return;
  const games = buildGames(lastMeta.live);
  const season = scoreSeason(games);
  renderMeta(season, lastMeta);
  renderStandings(season);
  renderBoard(games, season);
  renderSwing(games, season);
  renderGuy(season);
  renderManual(games);
}

async function refresh() {
  try { lastMeta = await fetchResults(); }
  catch (err) { lastMeta = fallbackResults(); }
  paint();
}

function boot() {
  const ok = BridgeScene.init($('#scene'));
  if (!ok) document.body.classList.add('no-3d');

  setupGate();
  $('#skip').addEventListener('click', () => BridgeScene.skip());
  $('#manual-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('manual-open');
    $('#manual-toggle').textContent = open ? 'Hide manual entry' : 'Enter results';
    if (open) $('#manual').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#manual').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'manual-clear') {
      saveOverrides({});
      paint();
      return;
    }
    if (b.id === 'manual-copy') {
      const line = manualLine();
      const say = msg => { const el = $('#manual-said'); if (el) el.textContent = msg; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(line).then(
          () => say('Copied. Paste over the MANUAL_RESULTS line in data.js.'),
          () => say(line)
        );
      } else {
        say(line);
      }
      return;
    }
    const wk = b.getAttribute('data-week');
    const set = b.getAttribute('data-set');
    if (wk && set) setOverride(wk, set === 'auto' ? null : set);
  });

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
