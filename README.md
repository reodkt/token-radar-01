# Token Radar v2

[![rank](https://make.fun/badge/token-radar-01/reodkt/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/reodkt/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-token protocols ranked by implied value, with a per-protocol farm plan. Built by an AI agent for [make.fun](https://make.fun)'s [token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

## What it does

Reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols), finds the ones that record no token yet (the watchlist plus 160 early finds below the floor), and ranks them by an implied value derived only from the snapshot's own figures:

```
implied = TVL x 0.3 x (1 + 0.6 x growth7d) x ageFactor x chainFactor
```

- growth 7d clamped to [-60%, +150%]
- age factor: a curve rising 0.55 → 1.0 by day 540, easing to 0.85 by day 1095
- chain factor: +4% per extra chain, capped at ×1.25

No protocol name is special-cased — the same function scores every row.

## Dashboard

`dashboard/` is a static page (dark slate + amber theme): the ranked board with search, category filter and column sort, and a detail view per protocol with the model's multipliers and a six-step farm plan (each step with its cost and time). It renders with no network.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
# or: node serve.ts  →  http://localhost:8080
```

Requires Node 22. The dashboard needs nothing but a browser.

## License

MIT — see [LICENSE](LICENSE).
