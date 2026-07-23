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
  (React/Vite/Tailwind/TanStack Query). 9/9 tests; live-verified in browser.

## Next (in order)
- **Phase 2 — car module**: vehicles, fuel log (date, odometer, liters, total price),
  derived **L/100km** (consecutive full-fill odometer deltas; partial fills accumulate
  into the next full fill), **€/L**, **€/km**, monthly car spend (fuel + Car-category
  costs − reimbursements), car stats screen + charts. DoD in `specs/wallet.md § Phase 2`.
  New tables → migration v3 (append; never edit shipped v1/v2). Follow the established
  patterns: service.ts (money logic + tests), routes.ts (zod + authed plugin), a screen
  wired via `api.ts` TanStack hooks.
- Then Phases 3–6: Recurring+predictions · Bank import · Receipt OCR (photo-only, QR
  dropped) · Stats & portability.

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail, then build **Phase 2** on `flow/wallet`.

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
