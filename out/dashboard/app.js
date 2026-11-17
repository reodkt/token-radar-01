// Radar v5 dashboard: CMC-grade board + detail + filter/sort, all client-side from window.RADAR.
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
  const pct = (v) => v == null ? '<span class="dim">—</span>' : `<span class="badge ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

  // Deterministic logo hue per protocol, so every row has a stable "coin face".
  const HUES = [212, 152, 28, 262, 342, 182, 12, 82, 232, 312];
  function hue(slug) {
    let h = 0;
    for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
    return HUES[h % HUES.length];
  }
  function logo(r) {
    const h = hue(r.slug);
    const letter = esc(r.name.charAt(0).toUpperCase());
    return `<span class="logo" style="background:hsl(${h},72%,46%)">${letter}</span>`;
  }
  // TVL share bar: this row's TVL against the board's largest, as a thin inline chart.
  const maxTVL = R.rows.reduce((m, r) => Math.max(m, r.tvl_usd || 0), 0);
  function tvlBar(r) {
    const w = Math.max(2, Math.round((r.tvl_usd / maxTVL) * 100));
    const h = hue(r.slug);
    return `<div class="tvlwrap"><span>${fmtUSD(r.tvl_usd)}</span><div class="tvlbar"><i style="width:${w}%;background:hsl(${h},70%,55%)"></i></div></div>`;
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

  function marketBar() {
    const total = R.rows.reduce((s, r) => s + (r.tvl_usd || 0), 0);
    const rising = R.rows.filter((r) => r.change_7d != null && r.change_7d > 0).length;
    const tracked = R.rows.filter((r) => r.change_7d != null).length;
    return `
      <div class="marketbar">
        <div class="mitem"><span>TVL on board</span><b>${fmtUSD(total)}</b></div>
        <div class="mitem"><span>7d movers up</span><b class="up">${rising}/${tracked}</b></div>
        <div class="mitem"><span>Protocols</span><b>${R.rows.length}</b></div>
        <div class="mitem"><span>Snapshot</span><b>${esc(R.as_of)}</b></div>
      </div>`;
  }

  function boardView() {
    const rows = filtered();
    const body = rows.map((r) => `
      <tr class="row" data-slug="${esc(r.slug)}">
        <td class="rank">${r.rank}</td>
        <td class="cell-name">${logo(r)}<span><span class="name">${esc(r.name)}</span><span class="sub">${esc(r.category || 'uncategorized')}</span></span></td>
        <td class="num cell-tvl">${tvlBar(r)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${r.age_days == null ? '<span class="dim">—</span>' : r.age_days + 'd'}</td>
        <td class="num iv cell-iv">${fmtUSD(r.implied_value_usd)}</td>
      </tr>`).join('');
    return `
      <div class="controls">
        <div class="search"><span class="sicon">⌕</span><input id="q" placeholder="Search protocols…" value="${esc(state.q)}"></div>
        <select id="cat"><option value="">All categories</option>${categories().map((c) => `<option${state.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="tablewrap">
      <table>
        <thead><tr>
          <th data-k="rank" class="${state.sort === 'rank' ? 'sorted' : ''}">#</th>
          <th data-k="name" class="${state.sort === 'name' ? 'sorted' : ''}">Protocol</th>
          <th data-k="tvl_usd" class="num ${state.sort === 'tvl_usd' ? 'sorted' : ''}">TVL</th>
          <th data-k="change_7d" class="num ${state.sort === 'change_7d' ? 'sorted' : ''}">7d %</th>
          <th data-k="age_days" class="num ${state.sort === 'age_days' ? 'sorted' : ''}">Age</th>
          <th data-k="implied_value_usd" class="num ${state.sort === 'implied_value_usd' ? 'sorted' : ''}">Implied value</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      </div>`;
  }

  function detailView(slug) {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return boardView();
    const steps = (r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
    const h = hue(r.slug);
    return `
      <button class="back" id="back">← Back to board</button>
      <div class="detail">
        <div class="dhead">
          <span class="logo big" style="background:hsl(${h},72%,46%)">${esc(r.name.charAt(0).toUpperCase())}</span>
          <div>
            <h2>${esc(r.name)}</h2>
            <p class="meta">Rank #${r.rank} · ${esc(r.category || 'uncategorized')} · ${r.chains.map(esc).join(', ')}${r.listed_at ? ' · tracked since ' + esc(r.listed_at) : ''}</p>
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
    document.body.innerHTML = `
      <div class="shell">
        <div class="top">
          <div class="brand"><span class="mark">◉</span> TOKEN RADAR</div>
          <div class="meta">model ${esc(R.model_version)} · ${R.watchlist_size} watchlisted · ${R.live_size} live tokens set aside</div>
        </div>
        ${marketBar()}
        <div id="board" tabindex="-1" aria-busy="true"></div>
        <p class="foot">Implied value is this model's own estimate from the sealed snapshot's figures — not a prediction that a token will be issued, and not financial advice. Always verify a protocol on its own site before depositing.</p>
      </div>`;
  }

  shell();
  render();
})();
