# Handoff — Wallet

## Where things stand
- **Branch**: `flow/wallet` (also fast-forwarded into `main`). No git remote yet.
- **Full spec**: [`specs/wallet.md`](specs/wallet.md) — all 7 phases, decisions fixed.
- **Gate record**: [`reviews/wallet.md`](reviews/wallet.md). **Journal**: [`journal.md`](journal.md).

## Done
- **Phase 0 — foundation** ✅ PASSED + committed (`journal.md §1`).
  One Docker container: Fastify serves `/api` + installable PWA. SQLite via built-in
  `node:sqlite`. Multi-user auth trusting Authelia's forwarded identity (per-user
  isolation, first user = admin, per-user bearer token, route-scoped auth plugin).
  Runs non-root; compose binds loopback. Gate green; CodeRabbit clean (incl. a
  @fastify/static CVE fix). Verified in-container: isolation, persistence, no bypass.

## Next (in order)
- **Phase 1 — core ledger (MVP)**: accounts (incl. credit cards), categories (seed the
  xlsx taxonomy per user), transactions (signed cents) CRUD, transfers (incl. CC
  payments), mobile quick-add, dashboard (month income/expense/net, per-category,
  account balances + CC utilization, basic charts). All routes user-scoped + zod.
  DoD in `specs/wallet.md § Phase 1`.
- Then Phases 2–6: Car stats · Recurring+predictions · Bank import · Receipt QR/OCR ·
  Stats & portability. (Phase 5 QR-first: PT AT receipt QR is plain-text, parse
  `A`/`F`/`O` — see spec.)

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail, then build **Phase 1** on `flow/wallet`.

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
