// Radar v2: skor nilai implisit dari angka snapshot sendiri (tvl, growth 7d, umur, chain spread).
// Model: implied = tvl * MULT_BASE * (1 + w_g * g) * ageFactor * chainFactor
//   g          = growth 7d di-clamp [-60, +150]
//   ageFactor  = kurva S: protokol terlalu muda (<30h) & terlalu tua (>3th) dapat diskon
//   chainFactor= 1 + 0.04 * (jumlah chain - 1), cap 1.25 — multi-chain = distribusi user lebih luas
// Tidak ada nama protokol yang di-hardcode; setiap baris dinilai fungsi yang sama.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  mult_base: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_min_days: number;
  age_sweet_days: number;
  age_max_days: number;
  chain_bonus: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  mult_base: 0.3,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  age_min_days: 30,
  age_sweet_days: 540,
  age_max_days: 1095,
  chain_bonus: 0.04,
  chain_cap: 1.25,
};

export const MODEL_VERSION = 'radar-v2-own';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Faktor umur: naik dari 0.55 di age_min ke 1.0 di age_sweet, lalu turun ke 0.85 di age_max. */
export function ageFactor(age: number | null, m: ModelConstants): number {
  const d = age ?? m.age_sweet_days / 2;
  if (d <= m.age_min_days) return 0.55;
  if (d >= m.age_max_days) return 0.85;
  if (d <= m.age_sweet_days) return 0.55 + 0.45 * (d - m.age_min_days) / (m.age_sweet_days - m.age_min_days);
  return 1 - 0.15 * (d - m.age_sweet_days) / (m.age_max_days - m.age_sweet_days);
}

/** Faktor sebaran chain: 1 di satu chain, +4% tiap chain ekstra, cap chain_cap. */
export function chainFactor(chains: string[], m: ModelConstants): number {
  return Math.min(m.chain_cap, 1 + Math.max(0, chains.length - 1) * m.chain_bonus);
}

/** Nilai implisit satu protokol. */
export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const maturityMult = ageFactor(age, m);
  const chainMult = chainFactor(p.chains, m);
  const base = p.tvl_usd * m.mult_base;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** Protokol yang layak dinilai: benar-benar pre-token (tanpa gecko, tanpa symbol, tanpa mcap). */
export function isRankable(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export interface BoardSummary { watchlist_size: number; board_size: number; early_size: number; live_size: number; }

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.mult_base,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    { text: `Open a dedicated wallet for this farm, funded only with what you plan to deposit, and keep its seed offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital plus $2-$8 of gas`, time: '15 minutes to set up' },
    { text: `Return weekly and make one qualifying action — a top-up, a swap, or a vote — so the wallet stays active across snapshots.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Keep the position open for ${hold} days so your activity spans more than one snapshot window.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Check the protocol's own announcements channel weekly for a points program or token vote, and claim only from links it publishes.`, cost: 'no fee to check', time: '5 minutes a week' },
    { text: `Log the wallet, dates and every transaction in a farm log, so you can repeat or unwind the position without guessing.`, cost: 'nothing but the time', time: '5 minutes after each action' },
  ];
}

/** The dashboard's live view: protocols whose token already trades, by market cap. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isRankable(p) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The whole radar: parse, score, rank, and package for the dashboard. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot, model);
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    mcap_usd: r.mcap_usd,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    chain_multiplier: r.model.chain_multiplier,
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: Math.max(0, board.length - snapshot.watchlist.length),
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** Parse and validate the sealed snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Partial<Snapshot>;
  if (!raw || typeof raw !== 'object') throw new SnapshotError('the snapshot is not an object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new SnapshotError('as_of is not a UTC date');
  if (typeof raw.floor_usd !== 'number' || !Number.isFinite(raw.floor_usd)) throw new SnapshotError('floor_usd is not a number');
  if (!Array.isArray(raw.protocols) || raw.protocols.length === 0) throw new SnapshotError('protocols is not a non-empty array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.length === 0) throw new SnapshotError('watchlist is not a non-empty array');
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new SnapshotError('a protocol has no slug');
    if (typeof p.name !== 'string' || p.name.length === 0) throw new SnapshotError(`protocol ${p.slug} has no name`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`protocol ${p.slug} has no tvl_usd`);
  }
  return raw as Snapshot;
}

/** The gate's own board checks, as one issue string or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows, more than 4000`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank < 1) return `slug ${row.slug} has a bad rank`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) return `slug ${row.slug} has a bad implied value`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) return `slug ${row.slug} has ${row.farm_steps?.length} farm steps, outside 3..12`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `slug ${row.slug} has a farm step of ${t.length} characters, outside 20..600`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${board.length}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on a smaller implied value`;
  }
  const index = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
    if (!index.has(slug)) return `watchlist slug ${slug} is not one of the snapshot's protocols`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && values.size === 1) return 'every row carries the same implied value: the board ranks nothing';
  return null;
}

/** data.js: the dashboard's one script, holding the radar as a global. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
