# Handoff — Wallet

## Where things stand
- **Branch**: `main`. Remote: **public** `nuno-f-rocha-alb/Wallet` (history rewritten — SHAs differ from any pre-purge clone).
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
- **Phase 4 — bank import (PDF)** ✅ PASSED, MERGED `@ 4e89373` (`journal.md §5`). `bank.ts`
  (dedup index; CGD parser, PDF-only; merchant memory; reversible batch), migration v6.
- **Phase 5 — receipt capture (photo + OCR)** ✅ PASSED, MERGED `@ 19c0af6` (`journal.md §6`).
  On-device Tesseract → pure `parseReceipt` (IVA-incl. total/date/merchant) → confirmed draft →
  transaction + receipt image (user-scoped SQLite BLOB, migration v7). Smoke-tested in-browser.
  Also fixed the dark native `<select>` popup on Windows Chromium. CodeRabbit 0 findings.

- **Phase 6 — statistics & data portability** ✅ PASSED, MERGED `@ af38e4f` (`journal.md §7`).
  `stats.ts` (trend, FY + prev-FY YoY, category breakdown; honors `fy_start_month`) and
  `backup.ts` (JSON export/import over all user tables, ids preserved; CSV export). Stats tab +
  Manage **Data** section. CodeRabbit found a **SQL injection** (INSERT column names built from
  untrusted backup keys) → schema-derived column whitelist + zod envelope + regression test.
- **Debt tracker** ✅ MERGED `@ 0e6f4e3` (`journal.md §8`) — see below.
- **Deferred backlog + repo/CI** ✅ (`journal.md §9`) — see below.

## Phase 4 — bank import (MERGED to `main` @ `4e89373`)
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

## Debt tracker (additive, journal `§8`) — built on request after Phase 6
Loans are accounts (`loan`/`credit_card`) with terms: migration **v8** (`interest_rate_bps`,
`monthly_payment_cents`) + **v9** (`rate_variable_from`, `variable_rate_bps` — one fixed→variable
switch, for PT mortgages that go Euribor-linked). `shared/debt.ts` `amortize` (pure, tested)
simulates month-by-month honoring the switch; `GET /api/debt`; Plan tab **Debts** section;
AccountForm gains rate/payment + a collapsible variable-rate section. **CodeRabbit 0 findings**
after 4 iterations. Migration **v10** adds `term_end_month`: set it and a rate reset **re-levels
the payment** over the months left (what PT lenders do), landing on the contractual month; leave
it blank to project a fixed payment with a drifting term. Both modes are labelled in the UI.

## Repo & CI (journal `§9`)
**Private** GitHub repo `nuno-f-rocha-alb/Wallet` (remote `origin`). `.github/workflows/ci.yml`:
gate (typecheck/lint/test/build) → build & push image to **ghcr.io/nuno-f-rocha-alb/wallet**
(`latest`, `sha-<short>`, semver on `v*` tags). PRs run the gate only. First run green.
- ✅ **History purged** (journal `§10`): `git filter-repo --replace-text` scrubbed the real NIB +
  balance from every commit, SHAs remapped, force-pushed. Repo is now **public**. The pre-purge
  history is backed up at `scratchpad/wallet-pre-purge.bundle`.
- `npm run build` runs `fetch:ocr` first (downloads ~6 MB of official, SHA-256-pinned traineddata);
  the Docker build bakes them in. `web/public/tesseract/` is gitignored.

## Next — queued task
✅ **Auto opening-balance from CSV** — DONE (`journal.md §11`, branch `flow/csv-opening-balance` →
merged). Reads the CSV "Saldo contabilístico" running-balance column and, opt-in, adjusts the
account's opening balance so a CSV import reconciles to the bank to the cent (no migration; folds
into `commitImport`). The "available/held amount" display stays deferred.

*No queued task.* Backlog below is all deferred/optional.

All 7 spec phases, the debt tracker, and the whole deferred backlog (payment recalc, receipt
thumbnails, generic CSV import, self-hosted OCR + CSP) are **done and merged**. Receipt scan
against the self-hosted assets was smoke-tested by the owner on localhost — works. Repo is public.
Latest import fix: commit no longer fuzzy-dedups rows against their own batch (`2d4bd20`).

**Not planned** (owner's call): **investments** (buys/sells, realized P/L, DCA) — "keep it in
backup", i.e. an idea on file, not scheduled.

**Still deferred** from the spec: household sharing, offline writes, cloud AI OCR, multi-currency FX.

**Nice-to-haves**: per-bank CSV mapping memory; more PDF bank parsers; receipt lightbox.

## Gate commands (must pass before a phase lands)
```
npm run typecheck && npm run lint && npm test && npm run build
docker compose build            # + `docker compose up` for integration phases
# CodeRabbit (Debian WSL, CLI 0.7.0):
wsl -d Debian -e sh -lc "cd /mnt/c/Users/nunob/Repositorios/Wallet && coderabbit review --uncommitted --include-untracked --base main"
```

## Resume line
Open a new session in this repo, say **resume flow**; read `handoff.md` +
`specs/wallet.md` + the `journal.md` tail. **Everything is built, CodeRabbit-clean and merged to
`main`, pushed to a **public** GitHub repo with CI publishing a GHCR image on push, and git
history scrubbed of real financial data.** Only the spec's Deferred list and the (unwanted)
investments module remain.

## Gotchas (this machine)
- Node 25 local; `node:sqlite` loaded via `createRequire` so Vite/vitest don't choke.
- CodeRabbit CLI is in **Debian WSL** (0.7.0 syntax: `--uncommitted --include-untracked
  --base main`), needs a valid `HEAD` and a base branch (`main` exists).
- Docker Desktop may need starting; daemon at `npipe:////./pipe/dockerDesktopLinuxEngine`.
