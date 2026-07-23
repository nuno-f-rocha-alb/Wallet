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
- **Phase 3 — recurring & predictions** ✅ PASSED (`journal.md §4`). `recurring_rules`
  (migration v5). `recurring.ts` pure core (tested): `occurrencesBetween` (month-end clamp +
  yearly), `projectForecast` (rules + 6-mo avg, no double-count), `detectRecurring`.
  Idempotent auto-post (external_ref `recur:<id>:<date>` + `last_posted_date`), fires on app
  open. Plan tab (5th): forecast bars, suggestions w/ prefill, upcoming, rules. 20/20 tests.

## Phase 4 — bank import (COMMITTED on `flow/wallet` @ `f5b4479`, NOT yet on `main`)
Built this session (journal `§5`), gate green (typecheck/lint/**29 tests**/build), **CodeRabbit
0 findings** (2 major + 2 minor fixed: category-ownership validation, O(n) dedup index,
IBAN/spaced-NIB ref, pdf.js `doc.destroy`). Committed but **held back from `main`** pending the
manual browser smoke test below.
- migration **v6**: `bank_imports` + `transactions.import_id` (ON DELETE CASCADE → reversible).
- `server/src/bank.ts` (+ `bank.test.ts`): pure dedup (exact ref + fuzzy ±1 day), synthesized
  refs, merchant memory; preview/commit/list/revert. All 4 DoD cases tested.
- `shared/parsers.ts` (+ `parsers.test.ts`): pluggable bank registry, **CGD** parser.
  Validated on the real 123-row June statement (amounts reconcile to the account total).
- `web/src/lib/extractPdf.ts` (pdf.js in a worker), `ImportFlow.tsx`, Manage "Import PDF" +
  Undo list. `pdfjs-dist` added to web.

### To finish Phase 4
1. ✅ CodeRabbit — clean (0 findings).
2. **Manual browser smoke test** (the one un-automated step — no `file_upload` on the agent's
   browser surface): `AUTH_DEV_USER=alice DB_PATH=… PORT=8080 npm run dev:server` + `npm run
   dev:web`, open Manage → Import PDF → pick the target account → upload a CGD statement →
   confirm the review table shows new/duplicate rows with category suggestions → Import →
   check balances → Undo (removes the batch). Re-import the same file → all rows show as
   duplicates (0 imported).
3. **Merge to `main`** once the smoke test passes: `git switch main && git merge --ff-only
   flow/wallet`.
4. Optional later: opening-balance regex on the real CGD layout; generic CSV path; more banks.
- **Do not commit the real statement or its data** — only the synthetic fixture in
  `shared/parsers.test.ts`.

## Next (after Phase 4)
- Phases 5–6: Receipt OCR (photo-only, QR dropped) · Stats & portability.

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail. **Phase 4 is committed on `flow/wallet` (`f5b4479`),
CodeRabbit-clean, but NOT on `main`** — do the manual browser smoke test, merge to `main`,
then move to Phase 5 (receipt OCR, photo-only).

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
