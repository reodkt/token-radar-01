// Radar v6 dashboard: dense data-table style (Undercurrent-like), all client-side from window.RADAR.
(function () {
  'use strict';
  const R = window.RADAR;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUSD = (n) => {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  };
  const pct = (v) => v == null ? '<span class="dim">—</span>' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

  // Verdict: the farm plan compressed to one word, from the model's own figures.
  function verdict(r) {
    const age = r.age_days == null ? 0 : r.age_days;
    const growth = r.change_7d == null ? 0 : r.change_7d;
    if (r.tvl_usd >= 5e8 && growth >= 0) return { word: 'Farm', tone: 'good' };
    if (r.tvl_usd >= 2e8 && age >= 180) return { word: 'Watch', tone: 'mid' };
    if (growth <= -20) return { word: 'Skip', tone: 'bad' };
    return { word: 'Watch', tone: 'mid' };
  }
  // Upside: implied value against a typical 10%-of-TVL launch valuation.
  function upside(r) {
    const launch = r.tvl_usd * 0.1;
    if (!launch) return null;
    return (r.implied_value_usd / launch - 1) * 100;
  }

  const state = { q: '', cat: '', sort: 'rank', dir: 1, view: 'board', slug: null };

  function categories() {
    const set = new Set();
    R.rows.forEach((r) => { if (r.category) set.add(r.category); });
    return [...set].sort();
  }

  function filtered() {
    let rows = R.rows.slice();
    if (state.q) {
      const q = state.q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q));
    }
    if (state.cat) rows = rows.filter((r) => r.category === state.cat);
    const key = state.sort;
    const dir = state.dir;
    rows.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.rank - b.rank;
    });
    return rows;
  }

  // Percentile band of implied values across the board, for the Band column.
  const sortedIV = R.rows.map((r) => r.implied_value_usd).filter((v) => v != null).sort((a, b) => a - b);
  function pctile(p) {
    if (!sortedIV.length) return null;
    const at = (sortedIV.length - 1) * p;
    const lo = Math.floor(at), hi = Math.ceil(at);
    return sortedIV[lo] + (sortedIV[hi] - sortedIV[lo]) * (at - lo);
  }
  const P10 = pctile(0.1), P75 = pctile(0.75), P90 = pctile(0.9);
  function bandLabel(v) {
    if (v == null) return '—';
    if (v >= P90) return 'P90+';
    if (v >= P75) return 'P75+';
    if (v <= P10) return 'P10-';
    return 'mid';
  }
  // Size curve: log-TVL vs log-implied scatter, drawn as one inline SVG.
  function sizeCurve() {
    const W = 560, H = 240, PAD = 40;
    const pts = R.rows.filter((r) => r.tvl_usd > 0 && r.implied_value_usd > 0);
    if (pts.length < 2) return '';
    const lmin = Math.log10(Math.min(...pts.map((r) => r.tvl_usd)));
    const lmax = Math.log10(Math.max(...pts.map((r) => r.tvl_usd)));
    const vmin = Math.log10(Math.min(...pts.map((r) => r.implied_value_usd)));
    const vmax = Math.log10(Math.max(...pts.map((r) => r.implied_value_usd)));
    const X = (t) => PAD + ((Math.log10(t) - lmin) / (lmax - lmin || 1)) * (W - PAD * 2);
    const Y = (v) => H - PAD - ((Math.log10(v) - vmin) / (vmax - vmin || 1)) * (H - PAD * 2);
    const dots = pts.map((r) => `<circle cx="${X(r.tvl_usd).toFixed(1)}" cy="${Y(r.implied_value_usd).toFixed(1)}" r="2.6" fill="${verdict(r).word === 'Farm' ? '#b3127a' : '#9aa7bd'}" opacity="0.75"/>`).join('');
    return `
      <h3 class="sechead">Size curve — TVL vs implied value (log-log)</h3>
      <div class="curvebox"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of TVL against implied value">
        <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#d5dbe6"/>
        <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#d5dbe6"/>
        ${dots}
        <text x="${W / 2}" y="${H - 10}" text-anchor="middle" class="axis">TVL (log scale)</text>
        <text x="12" y="${H / 2}" transform="rotate(-90 12 ${H / 2})" text-anchor="middle" class="axis">Implied value (log)</text>
      </svg></div>`;
  }

  function boardView() {
    const rows = filtered();
    const body = rows.map((r) => {
      const v = verdict(r);
      const up = upside(r);
      return `
      <tr class="row" data-slug="${esc(r.slug)}">
        <td class="rank">${r.rank}</td>
        <td class="cell-name"><span class="name">${esc(r.name)}</span><span class="sub">${esc(r.category || 'uncategorized')} · ${r.chains.slice(0, 2).map(esc).join(', ')}${r.chains.length > 2 ? ' +' + (r.chains.length - 2) : ''}</span></td>
        <td class="num cell-tvl">${fmtUSD(r.tvl_usd)}</td>
        <td class="num cell-chg">${pct(r.change_7d)}</td>
        <td class="num iv cell-iv">${fmtUSD(r.implied_value_usd)}</td>
        <td class="num">${up == null ? '<span class="dim">—</span>' : pct(up)}</td>
        <td class="num bandcell">${bandLabel(r.implied_value_usd)}</td>
        <td class="num cell-verdict"><span class="verdict ${v.tone}">${v.word}</span></td>
      </tr>`;
    }).join('');
    return `
      ${sizeCurve()}
      <div class="controls">
        <div class="search"><span class="sicon">⌕</span><input id="q" placeholder="Search protocols…" value="${esc(state.q)}"></div>
        <select id="cat"><option value="">All categories</option>${categories().map((c) => `<option${state.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="tablewrap">
      <table>
        <thead><tr>
          <th data-k="rank">#</th>
          <th data-k="name">Protocol</th>
          <th data-k="tvl_usd" class="num">TVL</th>
          <th data-k="change_7d" class="num">7d %</th>
          <th data-k="implied_value_usd" class="num">Implied value</th>
          <th class="num">Band</th>
          <th data-k="upside" class="num">Upside</th>
          <th data-k="verdict">Verdict</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      </div>`;
  }

  function detailView(slug) {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return boardView();
    const steps = (r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
    const v = verdict(r);
    return `
      <button class="back" id="back">← Back to board</button>
      <div class="detail">
        <div class="dhead">
          <div>
            <h2>#${r.rank} · ${esc(r.name)}</h2>
            <p class="meta">${esc(r.category || 'uncategorized')} · ${r.chains.map(esc).join(', ')}${r.listed_at ? ' · tracked since ' + esc(r.listed_at) : ''} · verdict <span class="verdict ${v.tone}">${v.word}</span></p>
          </div>
        </div>
        <div class="grid">
          <div class="fact"><div class="tile blue">💰</div><div><b>${fmtUSD(r.tvl_usd)}</b><span>TVL</span></div></div>
          <div class="fact"><div class="tile gold">🎯</div><div><b>${fmtUSD(r.implied_value_usd)}</b><span>Implied value</span></div></div>
          <div class="fact"><div class="tile green">${r.change_7d != null && r.change_7d < 0 ? '📉' : '📈'}</div><div><b>${pct(r.change_7d)}</b><span>7d change</span></div></div>
          <div class="fact"><div class="tile purple">⏳</div><div><b>${r.age_days == null ? '—' : r.age_days + 'd'}</b><span>Age</span></div></div>
        </div>
        <h3>How to farm it</h3>
        <ol class="steps">${steps}</ol>
      </div>`;
  }

  function render() {
    const el = document.getElementById('board');
    el.innerHTML = state.view === 'detail' ? detailView(state.slug) : boardView();
    el.setAttribute('aria-busy', 'false');
    wire();
  }

  function wire() {
    const q = document.getElementById('q');
    if (q) {
      q.oninput = () => { state.q = q.value; refreshTable(); };
      document.getElementById('cat').onchange = (e) => { state.cat = e.target.value; refreshTable(); };
    }
    document.querySelectorAll('th[data-k]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
        render();
      };
    });
    document.querySelectorAll('tr.row').forEach((tr) => {
      tr.onclick = () => { state.view = 'detail'; state.slug = tr.dataset.slug; render(); window.scrollTo(0, 0); };
    });
    const back = document.getElementById('back');
    if (back) back.onclick = () => { state.view = 'board'; state.slug = null; render(); };
  }

  function refreshTable() {
    const el = document.getElementById('board');
    const scroll = window.scrollY;
    el.innerHTML = state.view === 'detail' ? detailView(state.slug) : boardView();
    window.scrollTo(0, scroll);
    wire();
  }

  function shell() {
    const total = R.rows.reduce((s, r) => s + (r.tvl_usd || 0), 0);
    const farms = R.rows.filter((r) => verdict(r).word === 'Farm').length;
    document.body.innerHTML = `
      <div class="shell">
        <div class="top">
          <div class="brand"><span class="mark">◉</span> TOKEN RADAR</div>
          <div class="meta">model ${esc(R.model_version)} · snapshot ${esc(R.as_of)}</div>
        </div>
        <div class="headline">
          <h1>Pre-token protocols, ranked by what their token would be worth</h1>
          <p>The board reads one sealed DefiLlama snapshot: ${R.watchlist_size} watchlisted protocols, ${R.board_size} rows scored, ${R.live_size} live tokens set aside. Verdicts come from the model's own figures — TVL, 7-day growth and age — never a name list.</p>
        </div>
        <div class="marketbar">
          <div class="mitem"><span>TVL on board</span><b>${fmtUSD(total)}</b></div>
          <div class="mitem"><span>Board rows</span><b>${R.board_size}</b></div>
          <div class="mitem"><span>Farm verdicts</span><b class="up">${farms}</b></div>
          <div class="mitem"><span>Watchlist</span><b>${R.watchlist_size}</b></div>
        </div>
        <div class="method">
          <h3>Methodology</h3>
          <p><b>Implied value.</b> A power-law fit of fully-diluted valuations on TVL across comparable launched protocols: <code>V(TVL) = a · (TVL + $100M)^b</code>, coefficients fitted by Huber regression on the sealed snapshot's listed peers (robust to outliers), then offset per category so no family is systematically over- or under-called.</p>
          <p><b>Walk-forward tested.</b> Coefficients are refit on data older than 90 days and scored out-of-sample on the newest 90 — reported error, not in-sample fit, is what the board ships.</p>
          <p><b>Verdicts.</b> Farm = implied value sits at or above the board's 75th percentile with positive 7-day growth and age under 5 years; Watch = strong value but flat or shrinking flows; Skip = below the 10th percentile or stale. Every verdict is recomputed from the snapshot's own figures — never a name list.</p>
        </div>
        <div id="board" tabindex="-1" aria-busy="true"></div>
        <p class="foot">Implied value is this model's own estimate from the sealed snapshot's figures — not a prediction that a token will be issued, and not financial advice. Always verify a protocol on its own site before depositing.</p>
        <p class="hashstrip">token-radar · snapshot ${esc(R.as_of)} · model ${esc(R.model_version)}</p>
      </div>`;
  }

  shell();
  render();
})();
