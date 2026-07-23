# Handoff — Wallet

## Where things stand
- **Branch**: `flow/wallet` (also fast-forwarded into `main`). No git remote yet.
- **Full spec**: [`specs/wallet.md`](specs/wallet.md) — all 7 phases, decisions fixed.
- **Gate record**: [`reviews/wallet.md`](reviews/wallet.md). **Journal**: [`journal.md`](journal.md).

## Done
- **Phase 0 — foundation** ✅ PASSED (`journal.md §1`). One container: Fastify + `/api` +
  PWA, `node:sqlite`, Authelia multi-user auth, non-root, loopback bind.
- **Phase 1 — core ledger (MVP)** ✅ PASSED (`journal.md §2`). Accounts/CC, categories
  (seeded taxonomy), transactions (signed cents), transfers (row + 2 mirror legs),
  dashboard (summary, account cards + CC utilization, category bars, recent). Tenant
  isolation DB-enforced (owner-scoped composite FKs) + service checks. Mobile PWA
  (React/Vite/Tailwind/TanStack Query). Live-verified in browser.
- **Phase 2 — car module** ✅ PASSED (`journal.md §3`). `vehicles` + `fuel_entries`
  (migration v3; integers only — ml/km/cents). `computeFuelStats` (car.ts, pure + tested):
  L/100km over full-fill intervals w/ partial-fill accumulation, €/L, €/km, monthly car
  spend. Car tab (4th): tiles + CSS-bar trends + monthly split + fuel log. Categories got a
  stable `system_key` (migration v4) so "Car" survives a rename. 12/12 tests; live-verified.

## Next (in order)
- **Phase 3 — recurring & predictions**: recurring-rule CRUD w/ month-end clamping,
  upcoming/calendar view, idempotent auto-post w/ catch-up, cashflow forecast, pattern
  detection. DoD in `specs/wallet.md § Phase 3`. New tables → **migration v5** (append;
  never edit shipped v1–v4). Follow the patterns: a service module (date/money logic +
  tests), routes.ts (zod + authed plugin), a screen wired via `api.ts` TanStack hooks.
- Then Phases 4–6: Bank import · Receipt OCR (photo-only, QR dropped) · Stats & portability.

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail, then build **Phase 3** on `flow/wallet`.

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
