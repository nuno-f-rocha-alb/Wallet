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
- **Phase 4 — bank import (PDF)** ✅ PASSED, MERGED `@ a442c6e` (`journal.md §5`). `bank.ts`
  (dedup index; CGD parser, PDF-only; merchant memory; reversible batch), migration v6.
- **Phase 5 — receipt capture (photo + OCR)** ✅ PASSED, MERGED `@ 9722340` (`journal.md §6`).
  On-device Tesseract → pure `parseReceipt` (IVA-incl. total/date/merchant) → confirmed draft →
  transaction + receipt image (user-scoped SQLite BLOB, migration v7). Smoke-tested in-browser.
  Also fixed the dark native `<select>` popup on Windows Chromium. CodeRabbit 0 findings.

## Phase 6 — statistics & data portability (COMMITTED on `flow/wallet`, NOT yet on `main`)
Built this session (journal `§7`). Gate: typecheck/lint/**42 tests**/build/`docker compose build`
all green; live-verified (`/api/stats`, `/api/export[.csv]`, `/api/import/backup`). **CodeRabbit
0 findings** (fixed 1 critical + 1 major: SQL-injection via untrusted backup column keys →
schema-derived column whitelist + zod envelope validation + regression test).
- `server/src/stats.ts` (+ test): pure FY/rate math + `getStats` (trend, FY + prev-FY YoY, FY
  category breakdown; honors per-user `fy_start_month`).
- `server/src/backup.ts` (+ test): generic JSON export/import over all 9 user tables (ids
  preserved, receipts base64; import wipes+restores under `defer_foreign_keys`), CSV export.
- Routes `GET /api/stats`, `GET /api/export`(+`.csv`), `POST /api/import/backup`.
- `web`: `Stats.tsx` (6th tab: FY tiles, net-by-month bars, expense breakdown); Manage **Data**
  section (Export JSON/CSV, Restore w/ confirm).
- **Deferred** (not in the objective gate, surfaced): investment tracking + debt/payoff tracker.

### To finish Phase 6
1. CodeRabbit clean (re-run pending) → fix Critical/relevant.
2. **Merge to `main`**: `git switch main && git merge --ff-only flow/wallet`.
3. Decide on the deferred investments + debt tracker (own phase if wanted).

## Phase 4 — bank import (MERGED to `main` @ `a442c6e`)
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

Phase 4 passed its manual smoke test and merged to `main` (§4/§5 done). Optional later:
opening-balance regex on the real CGD layout; generic CSV path; more banks. **Do not commit the
real statement or its data** — only the synthetic fixture in `shared/parsers.test.ts`.

## Next (after Phase 6)
All 7 spec phases (0–6) built. Remaining, all **deferred** (build only if asked):
- **Investments** (buys/sells, realized P/L, DCA) and **debt/payoff tracker** — Phase 6 narrative,
  cut from the objective gate; each is a new-table subsystem.
- Spec's Deferred list: household sharing, offline writes, cloud OCR, multi-currency FX.
- Odds & ends: self-host Tesseract assets (+CSP); receipt thumbnail on the tx row; generic CSV
  bank import; opening-balance regex on the real CGD layout.

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail. **Phase 6 (stats & portability) is committed on
`flow/wallet`, NOT yet on `main`, CodeRabbit re-run pending.** Confirm CodeRabbit is clean, merge
to `main` (`git switch main && git merge --ff-only flow/wallet`). All 7 phases then built; only the
deferred items (investments, debt tracker, etc.) remain.

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
