# Wallet

[![CI](https://github.com/nuno-f-rocha-alb/Wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/nuno-f-rocha-alb/Wallet/actions/workflows/ci.yml)

Self-hosted, multi-user personal-finance PWA. Mobile-first and installable, runs as a
single Docker container behind your own reverse proxy + [Authelia](https://www.authelia.com/).
One transactions store + one fuel log + recurring rules; every summary, stat and projection
is derived by query. Money is integer cents end-to-end; nothing leaves your server.

## Features

- **Ledger** — accounts (cash / bank / credit-card / loan), a seeded category taxonomy,
  income/expense transactions, and transfers (incl. credit-card and loan payments).
- **Dashboard** — month income / expense / net, per-category breakdown, account balances,
  credit-card utilization.
- **Car** — vehicles + fuel log with derived **L/100km, €/L, €/km** and monthly car spend.
- **Plan** — recurring rules with month-end clamping, idempotent auto-post, a cashflow
  forecast, and pattern-detected rule suggestions.
- **Bank import** — statement **PDF** (Caixa Geral de Depósitos) or **CSV from any bank**
  (you map the columns). De-duplicates against existing rows; every batch is reversible.
- **Receipts** — snap a photo → **on-device OCR** (Tesseract, no cloud) → prefilled draft you
  confirm; the image is stored and thumbnailed on the transaction.
- **Stats** — monthly trend, fiscal-year rollup with year-over-year, savings rate, category
  drilldown (fiscal-year start is per-user).
- **Debt** — loan payoff projection with fixed→variable rates (e.g. a PT mortgage that goes
  Euribor-linked); optionally re-levels the payment at each reset to hold the term.
- **Data portability** — full JSON backup export/import + CSV export.
- Installable **PWA**, light/dark, works offline for reads.

## Stack

- **One container** — Node + [Fastify](https://fastify.dev/) serves the JSON API (`/api/*`)
  and the built PWA from the same process.
- **SQLite** via the built-in `node:sqlite` — no native module, no separate database.
- **Auth** — Authelia forward-auth in front. The app stores **no passwords**; it trusts the
  identity header from your proxy, auto-provisions a user, and scopes all data by user.
- **Web** — React + Vite PWA. On-device OCR assets are vendored and served same-origin under a
  strict Content-Security-Policy (no CDN calls).

## Quick start

```bash
cp .env.example .env      # optional — empty file is fine to start
docker compose up -d      # builds the image (or `--build` to force a rebuild)
```

Open <http://localhost:8080>. To use the **pre-built image** instead of building:

```bash
docker compose pull && docker compose up -d
# image: ghcr.io/nuno-f-rocha-alb/wallet:latest
```

### Try it without Authelia

Mock an identity so you can click around locally (dev only — ignored once a proxy is trusted):

```bash
AUTH_DEV_USER=me AUTH_DEV_EMAIL=me@example.com docker compose up -d
```

The first user provisioned is admin. `GET /api/health` returns `200` when it's up.

## Deploy behind Authelia (production)

The container binds to `127.0.0.1:8080` — put your reverse proxy in front and have it run
Authelia forward-auth, then set `TRUSTED_PROXIES` to the proxy's IP so identity headers are
honored (and can't be forged from anywhere else).

If the proxy is another Compose service, drop the `ports` mapping and share a network instead:

```yaml
services:
  wallet:
    image: ghcr.io/nuno-f-rocha-alb/wallet:latest
    expose: ["8080"]
    volumes: [wallet-data:/data]
    environment:
      TRUSTED_PROXIES: 172.18.0.0/16   # your proxy's IP / subnet
      ADMIN_EMAILS: you@example.com
    networks: [web]
```

Your proxy must forward the authenticated identity in the headers named by `AUTH_HEADER_*`
(Authelia's defaults — `Remote-User`, `Remote-Email`, `Remote-Name` — match out of the box).

**PWA / VPN access that skips Authelia:** an admin can issue a per-user bearer token; send it as
`Authorization: Bearer <token>` for direct API access.

## Configuration

All via environment variables (see [`.env.example`](.env.example)). All optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRUSTED_PROXIES` | *(empty)* | Comma-separated proxy IP(s) allowed to set identity headers. Empty = ignore all. `*` = trust any peer (**dev only**). |
| `AUTH_HEADER_USER` | `remote-user` | Header carrying the authenticated subject. |
| `AUTH_HEADER_EMAIL` | `remote-email` | Header carrying the email. |
| `AUTH_HEADER_NAME` | `remote-name` | Header carrying the display name. |
| `ADMIN_EMAILS` | *(empty)* | Comma-separated emails granted admin. The first-ever user is always admin. |
| `AUTH_DEV_USER` | *(empty)* | Forces every request to this identity (no Authelia). Ignored when `TRUSTED_PROXIES` is set. |
| `AUTH_DEV_EMAIL` | *(empty)* | Email for the dev user. |
| `DB_PATH` | `/data/wallet.db` | SQLite file (on the mounted volume). |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address inside the container. |
| `APP_VERSION` | `0.0.0` | Reported at `/api/health`. |

## Backup

Everything is one SQLite file on the `wallet-data` volume — back that up and you're done. For a
portable copy, use **Manage → Data → Export backup (JSON)** (or CSV), and **Restore** to import.

## Security

- Identity headers are honored **only** when the direct peer's IP is in `TRUSTED_PROXIES`.
  Empty = headers ignored (safe default). Trusting a direct client — or `*` — lets it forge
  `Remote-User`; `*` is **dev only**.
- `AUTH_DEV_USER` is ignored whenever `TRUSTED_PROXIES` is set, so it can't override Authelia.
- Data is isolated per user (enforced in the DB via owner-scoped composite keys, and in the
  service layer). Shared/household budgets are a future addition.
- Receipt OCR runs entirely on-device; its assets are vendored and served same-origin under a
  strict CSP. No receipt image or transaction ever leaves your server.
- Runs as a non-root user; the container binds to loopback by default.

## Develop

```bash
npm install
npm run dev:server   # Fastify on :8080  (set AUTH_DEV_USER to mock auth)
npm run dev:web      # Vite on :5173, proxies /api → :8080
```

Monorepo: `shared/` (types + pure logic, unit-tested), `server/` (Fastify + `node:sqlite`),
`web/` (React PWA). Database migrations are an append-only array in `server/src/db.ts`.

The gate CI enforces on every push (build the image only if it passes):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm run build` first vendors the OCR runtime (`npm run fetch:ocr`) — Tesseract worker/core from
`node_modules` plus the official `tessdata_fast` language models (pinned + SHA-256 verified) into
`web/public/tesseract/` (gitignored).

## License

[MIT](LICENSE) © 2026 Nuno Rocha.
