// Radar v3 dashboard: board + detail + filter/sort, all client-side from window.RADAR.
(function () {
  'use strict';
  const R = window.RADAR;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUSD = (n) => {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  };
  const pct = (v) => v == null ? '—' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;

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

  function arrow(key) {
    if (state.sort !== key) return '';
    return `<span class="arrow">${state.dir === 1 ? '▲' : '▼'}</span>`;
  }

  function boardView() {
    const rows = filtered();
    const body = rows.map((r) => `
      <tr class="row ${r.rank <= 3 ? 'top3' : ''}" data-slug="${esc(r.slug)}">
        <td class="rank">${r.rank}</td>
        <td><span class="name">${esc(r.name)}</span><span class="sub">${esc(r.category || 'uncategorized')} · ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}</span></td>
        <td class="num">${fmtUSD(r.tvl_usd)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${r.age_days == null ? '—' : r.age_days + 'd'}</td>
        <td class="num iv">${fmtUSD(r.implied_value_usd)}</td>
      </tr>`).join('');
    return `
      <div class="controls">
        <input id="q" placeholder="Search name, slug, category…" value="${esc(state.q)}" size="34">
        <select id="cat"><option value="">All categories</option>${categories().map((c) => `<option${state.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <span class="meta">${rows.length} of ${R.rows.length} protocols</span>
      </div>
      <table>
        <thead><tr>
          <th data-k="rank" class="${state.sort === 'rank' ? 'sorted' : ''}">#${arrow('rank')}</th>
          <th data-k="name" class="${state.sort === 'name' ? 'sorted' : ''}">Protocol${arrow('name')}</th>
          <th data-k="tvl_usd" class="${state.sort === 'tvl_usd' ? 'sorted' : ''}">TVL${arrow('tvl_usd')}</th>
          <th data-k="change_7d" class="${state.sort === 'change_7d' ? 'sorted' : ''}">7d${arrow('change_7d')}</th>
          <th data-k="age_days" class="${state.sort === 'age_days' ? 'sorted' : ''}">Age${arrow('age_days')}</th>
          <th data-k="implied_value_usd" class="${state.sort === 'implied_value_usd' ? 'sorted' : ''}">Implied value${arrow('implied_value_usd')}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  function detailView(slug) {
    const r = R.rows.find((x) => x.slug === slug);
    if (!r) return boardView();
    const steps = (r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
    return `
      <button class="back" id="back">← Back to board</button>
      <div class="detail">
        <h2>#${r.rank} · ${esc(r.name)}</h2>
        <p class="meta">${esc(r.category || 'uncategorized')} · ${r.chains.map(esc).join(', ')}${r.listed_at ? ' · tracked since ' + esc(r.listed_at) : ''}</p>
        <div class="grid">
          <div class="fact"><b>${fmtUSD(r.tvl_usd)}</b><span>TVL</span></div>
          <div class="fact"><b>${fmtUSD(r.implied_value_usd)}</b><span>Implied value</span></div>
          <div class="fact"><b>${pct(r.change_7d)}</b><span>7d change</span></div>
          <div class="fact"><b>${r.age_days == null ? '—' : r.age_days + ' days'}</b><span>Age</span></div>
          <div class="fact"><b>×${r.growth_multiplier}</b><span>Growth mult</span></div>
          <div class="fact"><b>×${r.maturity_multiplier}</b><span>Maturity mult</span></div>
          <div class="fact"><b>×${r.chain_multiplier}</b><span>Chain mult</span></div>
        </div>
        <h3>How to farm it</h3>
        <ol class="steps">${steps}</ol>
      </div>`;
  }

  function render() {
    const el = document.getElementById('board');
    el.innerHTML = state.view === 'detail' ? detailView(state.slug) : boardView();
    el.setAttribute('aria-busy', 'false');
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
  }

  function shell() {
    document.body.innerHTML = `
      <div class="shell">
        <div class="top">
          <div class="brand"><span class="dot">◉</span> TOKEN RADAR</div>
          <div class="meta">snapshot ${esc(R.as_of)} · model ${esc(R.model_version)}</div>
        </div>
        <div class="facts">
          <div class="fact"><b>${R.watchlist_size}</b><span>Watchlist</span></div>
          <div class="fact"><b>${R.board_size}</b><span>Board rows</span></div>
          <div class="fact"><b>${R.early_size}</b><span>Early finds</span></div>
          <div class="fact"><b>${R.live_size}</b><span>Live set aside</span></div>
        </div>
        <div id="board" tabindex="-1" aria-busy="true"></div>
        <p class="foot">Implied value is this model's own estimate from the sealed snapshot's figures — not a prediction that a token will be issued, and not financial advice. Always verify a protocol on its own site before depositing.</p>
      </div>`;
  }

  shell();
  render();
})();
